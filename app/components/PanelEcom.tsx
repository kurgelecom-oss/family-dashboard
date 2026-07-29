"use client";

import { useEffect, useState } from "react";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";
import { isEcomPayload } from "../lib/payload-guards";

/* ════════════════════════════════════════════════════════════════════════════
   Column B — TODAY / ACTIVE TEST / MONTH · P&L.

   Reads GET /api/ecom, which reconciles Shopify (revenue, the system of record
   for money collected) with the ECOM Launchpad (ad spend and test state). No
   mock and no fallback: an unreachable route says so rather than showing a
   figure that looks measured.
   ══════════════════════════════════════════════════════════════════════════ */

interface TodayStats {
  revenue: number;
  orders: number;
  aov: number | null;
  cogs: number;
  adSpend: number;
  /** The true window the ad-spend figure covers, so the label can't lie. */
  adSpendWindow: "TODAY" | "MTD";
  adSpendMtd: number;
  contribution: number;
  /** Three-state diagnosis resolved server-side. */
  activityState: "LIVE" | "AWAITING" | "NONE";
  lookbackDays: number;
  lookbackHadActivity: boolean;
  testIsFresh: boolean;
  testIsAlive: boolean;
}

interface ActiveTest {
  present: true;
  id: string;
  name: string;
  status: string;
  dayNumber: number;
  lastEntryDate: string | null;
  staleDays: number | null;
  cumulativeSpend: number;
  entryWindowLow: number | null;
  entryWindowHigh: number | null;
  testRevenue: number;
  testOrders: number;
  targetCpa: number | null;
  validationMinPurchases: number | null;
}

interface NoTest {
  present: false;
  testsComplete: number;
  testsTarget: number;
  sinceDate: string;
  daysSince: number;
}

interface DailyContribution {
  date: string;
  contribution: number;
}

interface MonthPl {
  /** False whenever COGS came from the hand-entered Launchpad bundle table. */
  cogsVerified: boolean;
  cogsSource: string;
  revenue: number;
  orders: number;
  cogs: number;
  grossProfit: number;
  adSpend: number;
  contribution: number;
  target: number;
  targetPercent: number;
  revenueSource: string;
  adSpendSource: string;
  dailyContribution: DailyContribution[];
}

interface EcomPayload {
  generatedAt: string;
  timeZone: string;
  today: string;
  /** Resolved server-side from the Notion settings data source. */
  settings?: SettingsMap;
  todayStats: TodayStats;
  test: ActiveTest | NoTest;
  month: MonthPl;
}

const REFRESH_MS = 5 * 60 * 1000;

/* ── Formatting ───────────────────────────────────────────────────────────── */

function money(n: number) {
  const abs = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

/** Compact form for the hero, which has the least horizontal room. */
function moneyShort(n: number) {
  const abs = Math.abs(n);
  const body =
    abs >= 1000
      ? `$${(abs / 1000).toFixed(1)}k`
      : `$${abs.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${n < 0 ? "-" : ""}${body}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function dayLabel(isoDate: string) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function monthLabel(isoDate: string) {
  const [y, m] = isoDate.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Breakeven ROAS — the multiple at which contribution turns positive.
 *
 * Gross margin ratio = (revenue − COGS) / revenue, so breakeven ROAS is its
 * reciprocal: below this, every extra dollar of ad spend loses money.
 */
function breakevenRoas(revenue: number, cogs: number): number | null {
  if (revenue <= 0) return null;
  const marginRatio = (revenue - cogs) / revenue;
  if (marginRatio <= 0) return null;
  return 1 / marginRatio;
}

/**
 * ROAS colour against its breakeven: below breakeven is losing money on every
 * extra ad dollar (red), within 10% above is too thin to call a win (amber),
 * clear of that is green.
 */
function roasTone(roas: number | null, breakeven: number | null, amberBandPct: number): string {
  if (roas === null || breakeven === null) return "var(--text-muted)";
  if (roas < breakeven) return "var(--red)";
  if (roas < breakeven * (1 + amberBandPct / 100)) return "var(--amber)";
  return "var(--green)";
}

/**
 * 30-day daily-contribution sparkline. Zero is drawn as a baseline so
 * loss-making days read as below the line rather than just "lower".
 */
function ContributionSparkline({ series }: { series: DailyContribution[] }) {
  const H = 48;
  const W = 240;
  const PAD = 2;

  if (series.length === 0) {
    return (
      <div style={{ height: H, display: "flex", alignItems: "center", fontSize: 10, color: "var(--text-muted)" }}>
        no contribution history
      </div>
    );
  }

  const values = series.map((d) => d.contribution);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const xOf = (i: number) => PAD + (i / Math.max(series.length - 1, 1)) * (W - PAD * 2);
  const yOf = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const zeroY = yOf(0);

  const line = series.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(d.contribution)}`).join(" ");

  return (
    <div style={{ height: H, position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      >
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--border)" strokeWidth="1" />
        <path d={line} fill="none" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" />
        {series.map((d, i) =>
          d.contribution === 0 ? null : (
            <circle
              key={d.date}
              cx={xOf(i)}
              cy={yOf(d.contribution)}
              r="1.6"
              fill={d.contribution >= 0 ? "var(--green)" : "var(--red)"}
            />
          ),
        )}
      </svg>
    </div>
  );
}

/** Status badge colour. Only tokens — no new colours. */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "Live":
    case "Scaled":
      return "badge-green";
    case "Iterating":
    case "Setup":
      return "badge-cyan";
    case "Paused-Exit":
      return "badge-amber";
    case "Killed":
      return "badge-red";
    default:
      return "badge-cyan";
  }
}

/* ── Small building blocks ────────────────────────────────────────────────── */

function ShellCard({
  title,
  badge,
  badgeClass,
  message,
}: {
  title: string;
  badge: string;
  badgeClass: string;
  message: string;
}) {
  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">{title}</div>
        <span className={`badge ${badgeClass}`}>{badge}</span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: "var(--text-muted)",
          textAlign: "center",
          padding: "0 8px",
        }}
      >
        {message}
      </div>
    </div>
  );
}

/** One label/value pair in the TODAY strip. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stat-cell" style={{ padding: "5px 6px", minWidth: 0 }}>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.2,
          color: tone ?? "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      <div
        className="stat-sublabel"
        style={{
          marginTop: 2,
          fontSize: 9,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function LabelledRow({
  label,
  value,
  tone,
  last,
  marker,
}: {
  label: string;
  value: string;
  tone?: string;
  last?: boolean;
  marker?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "2px 0",
        borderBottom: last ? "none" : "1px solid var(--border)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}
      >
        {label}
      </span>
      {marker && (
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: "var(--amber)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {marker}
        </span>
      )}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: tone ?? "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Panel 1 — TODAY ──────────────────────────────────────────────────────── */

function TodayPanel({ data, settings }: { data: EcomPayload; settings?: SettingsMap }) {
  const t = data.todayStats;

  const labelAwaiting = getSetting(
    settings,
    "LABEL_AWAITING_DATA",
    SETTING_DEFAULTS.LABEL_AWAITING_DATA,
  );
  const labelNoCampaigns = getSetting(
    settings,
    "LABEL_NO_CAMPAIGNS",
    SETTING_DEFAULTS.LABEL_NO_CAMPAIGNS,
  );

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">Today</div>
        <span className="badge badge-cyan">{dayLabel(data.today)}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {t.activityState !== "LIVE" ? (
          <>
            {/* AWAITING vs NONE are different diagnoses. Ad spend is settled
                bank cash and lags Meta by days, so a zero today usually means
                "not settled yet", not "nothing running". */}
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: t.activityState === "AWAITING" ? "var(--text-muted)" : "var(--amber)",
                lineHeight: 1.2,
                letterSpacing: "-0.01em",
              }}
            >
              {t.activityState === "AWAITING" ? labelAwaiting : labelNoCampaigns}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {t.activityState === "AWAITING"
                ? `no orders or settled spend today · activity within ${t.lookbackDays}d`
                : `nothing in the last ${t.lookbackDays} days and no active test`}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: 30,
                fontWeight: 700,
                color: "var(--cyan)",
                lineHeight: 1.2,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {money(t.revenue)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              revenue · {t.orders} {t.orders === 1 ? "order" : "orders"}
            </div>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
          <Metric label="Revenue" value={money(t.revenue)} />
          <Metric label="Orders" value={String(t.orders)} />
          <Metric label="AOV" value={t.aov === null ? "—" : money(t.aov)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <Metric
            // The label carries the true window. PocketSmith settles daily, so
            // this is a real same-day figure rather than a month total wearing
            // a daily label.
            label={`Ad Spend (${t.adSpendWindow})`}
            value={money(t.adSpend)}
            tone="var(--amber)"
          />
          <Metric
            label="Contribution"
            value={money(t.contribution)}
            tone={t.contribution >= 0 ? "var(--green)" : "var(--red)"}
          />
        </div>

        <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.3 }}>
          Ad spend is bank-settled Meta charges · {money(t.adSpendMtd)} MTD
        </div>
      </div>
    </div>
  );
}

/* ── Panel 2 — ACTIVE TEST ────────────────────────────────────────────────── */

function ActiveTestPanel({
  test,
  settings,
}: {
  test: ActiveTest | NoTest;
  settings?: SettingsMap;
}) {
  if (!test.present) {
    return (
      <div className="card">
        <div className="card-header" style={{ marginBottom: 5 }}>
          <div className="card-title">Active Test</div>
          <span className="badge badge-amber">Idle</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "var(--amber)",
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
            }}
          >
            NO TEST RUNNING
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {test.testsComplete} of {test.testsTarget} tests complete
          </div>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 5, marginTop: 2 }}>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: "var(--text-primary)",
                lineHeight: 1.2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {test.daysSince}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              days since {dayLabel(test.sinceDate)} — no test has run yet
            </div>
          </div>
        </div>
      </div>
    );
  }

  const low = test.entryWindowLow ?? 0;
  const high = test.entryWindowHigh ?? 0;
  const windowPct = high > 0 ? Math.min((test.cumulativeSpend / high) * 100, 100) : 0;
  const lowMarkPct = high > 0 ? Math.min((low / high) * 100, 100) : 0;
  const insideWindow = test.cumulativeSpend >= low && test.cumulativeSpend <= high;

  const roas = test.cumulativeSpend > 0 ? test.testRevenue / test.cumulativeSpend : null;
  // Breakeven for the test uses the same margin basis as the month panel.
  const be = breakevenRoas(test.testRevenue, test.testRevenue * 0.282);

  // The gate the test is actually waiting on: it cannot be judged until
  // cumulative spend clears the bottom of the entry window.
  const nextGate = insideWindow
    ? "Entry-window verdict"
    : test.cumulativeSpend < low
      ? `Reach $${low} entry window`
      : "Exit / scale decision";

  /*
   * Staleness. A test can sit in "Live" indefinitely while nobody feeds it, so
   * the status alone is not the truth — the gap since the last entry is. Both
   * thresholds and the day count are computed, never hardcoded.
   *   beyond TEST_STALE_RED_DAYS   → not being run at all (red)
   *   beyond TEST_STALE_AMBER_DAYS → running but behind on entries (amber)
   */
  const staleAmberDays = getSetting(
    settings,
    "TEST_STALE_AMBER_DAYS",
    SETTING_DEFAULTS.TEST_STALE_AMBER_DAYS,
  );
  const staleRedDays = getSetting(
    settings,
    "TEST_STALE_RED_DAYS",
    SETTING_DEFAULTS.TEST_STALE_RED_DAYS,
  );

  const amberBandPctTest = getSetting(
    settings,
    "BREAKEVEN_AMBER_BAND_PCT",
    SETTING_DEFAULTS.BREAKEVEN_AMBER_BAND_PCT,
  );

  const stale = test.staleDays;
  const abandoned = stale !== null && stale > staleRedDays;
  const lagging = stale !== null && stale > staleAmberDays && !abandoned;

  const badgeLabel = abandoned
    ? "Stale"
    : lagging
      ? `${test.status} · Stale`
      : test.status;
  const badgeClass = abandoned
    ? "badge-red"
    : lagging
      ? "badge-amber"
      : statusBadgeClass(test.status);

  const staleLine = abandoned
    ? `No entry in ${stale} days · test not being run`
    : lagging
      ? `No entry in ${stale} days`
      : null;
  const staleTone = abandoned ? "var(--red)" : "var(--amber)";

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">Active Test</div>
        <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            lineHeight: 1.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {test.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          Day {test.dayNumber}
          {/* The last entry date is shown explicitly so the gap is legible at a
              glance, not just implied by a day count. */}
          {test.lastEntryDate && <> · last entry {dayLabel(test.lastEntryDate)}</>}
        </div>

        {staleLine && (
          <div style={{ fontSize: 11, fontWeight: 600, color: staleTone, lineHeight: 1.3 }}>
            {staleLine}
          </div>
        )}

        {/* Cumulative spend against the entry window */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Spend vs ${low}–{high}
          </span>
          <span
            style={{
              fontSize: 10,
              color: insideWindow ? "var(--green)" : "var(--amber)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {money(test.cumulativeSpend)}
          </span>
        </div>
        <div className="progress-track thick" style={{ position: "relative" }}>
          <div
            className="progress-fill"
            style={{
              width: `${windowPct}%`,
              background: insideWindow ? "var(--green)" : "var(--cyan)",
            }}
          />
          {/* entry-window floor marker */}
          <div
            style={{
              position: "absolute",
              left: `${lowMarkPct}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: "var(--amber)",
            }}
          />
        </div>

        {/* ROAS against breakeven */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 2 }}>
          <Metric
            label="ROAS"
            value={roas === null ? "—" : `${roas.toFixed(2)}×`}
            tone={roasTone(roas, be, staleAmberDays >= 0 ? amberBandPctTest : 10)}
          />
          <Metric
            label="Breakeven"
            value={be === null ? "—" : `${be.toFixed(2)}×`}
            tone="var(--text-muted)"
          />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 4, marginTop: 1 }}>
          <LabelledRow label="Next gate" value={nextGate} last />
        </div>
      </div>
    </div>
  );
}

/* ── Panel 3 — MONTH · P&L ────────────────────────────────────────────────── */

function MonthPanel({ data, settings }: { data: EcomPayload; settings?: SettingsMap }) {
  const m = data.month;
  const roas = m.adSpend > 0 ? m.revenue / m.adSpend : null;
  const be = breakevenRoas(m.revenue, m.cogs);
  const amberBandPct = getSetting(
    settings,
    "BREAKEVEN_AMBER_BAND_PCT",
    SETTING_DEFAULTS.BREAKEVEN_AMBER_BAND_PCT,
  );
  const unverifiedLabel = getSetting(
    settings,
    "LABEL_COGS_UNVERIFIED",
    SETTING_DEFAULTS.LABEL_COGS_UNVERIFIED,
  );
  // A derived number inherits the trust level of its worst input: contribution
  // and breakeven are both functions of COGS, so an unverified COGS makes both
  // of them unverified too. Marking only the COGS row would imply the headline
  // is sound when it is not.
  const unverified = m.cogsVerified === false;

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">Month · P&amp;L</div>
        <span className="badge badge-cyan">{monthLabel(data.today)}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* flexShrink:0 — these four rows are the ledger and must never be
            compressed to make room for the chart below them. */}
        <div style={{ flexShrink: 0 }}>
          <LabelledRow
            // One canonical revenue figure, labelled with its source so it can
            // never again sit unexplained beside a different number.
            label={`Revenue · ${m.revenueSource}`}
            value={money(m.revenue)}
          />
          <LabelledRow
            label="COGS"
            value={`-${money(m.cogs)}`}
            marker={unverified ? unverifiedLabel : undefined}
          />
          <LabelledRow label="Gross Profit" value={money(m.grossProfit)} tone="var(--green)" />
          <LabelledRow
            label="Ad Spend · Settled"
            value={`-${money(m.adSpend)}`}
            tone="var(--amber)"
            last
          />
        </div>

        {/* The figure is bank truth, but settlement lags ad delivery by a few
            days — say so, or it reads as live Meta reporting. */}
        <div style={{ fontSize: 9, color: "var(--text-muted)", lineHeight: 1.3 }}>
          {m.adSpendSource} · settled charges, lags Meta delivery by a few days
        </div>

        {/* Hero — contribution profit, the largest text in the panel */}
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 5,
            marginTop: 1,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                lineHeight: 1.2,
                color: m.contribution >= 0 ? "var(--green)" : "var(--red)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {moneyShort(m.contribution)}
            </div>
            <div
              className="stat-sublabel"
              style={{ marginTop: 2, fontSize: 10, whiteSpace: "nowrap" }}
            >
              Contribution Profit
              {unverified && (
                <span style={{ color: "var(--amber)", fontWeight: 700 }}> · {unverifiedLabel}</span>
              )}
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1.2,
                color: roasTone(roas, be, amberBandPct),
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {roas === null ? "—" : `${roas.toFixed(2)}×`}
            </div>
            <div
              className="stat-sublabel"
              style={{ marginTop: 2, fontSize: 10, whiteSpace: "nowrap" }}
            >
              ROAS · be {be === null ? "—" : `${be.toFixed(2)}×`}
              {unverified && (
                <span style={{ color: "var(--amber)", fontWeight: 700 }}> ·&nbsp;UNVERIFIED</span>
              )}
            </div>
          </div>
        </div>

        {/* 30-day daily contribution — replaces the actual-vs-target pace chart */}
        <div style={{ marginTop: 2 }}>
          <div
            style={{
              fontSize: 9,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            Daily contribution · 30d
          </div>
          <ContributionSparkline series={m.dailyContribution} />
        </div>

        {/* Footer — progress to the monthly revenue target */}
        <div style={{ marginTop: "auto", paddingTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Target ${(m.target / 1000).toFixed(0)}k
            </span>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-secondary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {money(m.revenue)} · {m.targetPercent.toFixed(1)}%
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${m.targetPercent}%`, background: "var(--cyan)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Column ───────────────────────────────────────────────────────────────── */

/** Delegates to the shared guards so the contract is testable in isolation. */
function isRenderable(p: unknown): p is EcomPayload {
  return isEcomPayload(p);
}

export default function PanelEcom() {
  const [data, setData] = useState<EcomPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/ecom");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.error) throw new Error(String(payload.error));
        if (!isRenderable(payload)) throw new Error("Unexpected payload shape");
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      }
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <>
        {["Today", "Active Test", "Month · P&L"].map((title) => (
          <ShellCard
            key={title}
            title={title}
            badge="⚠ Error"
            badgeClass="badge-red"
            message={`Ecom data unavailable — ${error}`}
          />
        ))}
      </>
    );
  }

  if (!data) {
    return (
      <>
        {["Today", "Active Test", "Month · P&L"].map((title) => (
          <ShellCard
            key={title}
            title={title}
            badge="Loading…"
            badgeClass="badge-cyan"
            message="…"
          />
        ))}
      </>
    );
  }

  const settings = data.settings;

  return (
    <>
      <TodayPanel data={data} settings={settings} />
      <ActiveTestPanel test={data.test} settings={settings} />
      <MonthPanel data={data} settings={settings} />
    </>
  );
}
