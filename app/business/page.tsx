"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import DrillChrome from "../components/DrillChrome";
import { isEcomPayload } from "../lib/payload-guards";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";
import {
  LAUNCHPAD_API,
  type LaunchpadEntryRecord,
  type LaunchpadTestRecord,
} from "../lib/launchpad";

/* ════════════════════════════════════════════════════════════════════════════
   /business — Column B's drill-down. RESTRUCTURE-SPEC §4.

   Two reads, PanelEcom's own cadence (5 min):
     · /api/ecom — the payload Column B already renders (revenue as currently
       wired, PocketSmith-settled Meta charges, month P&L).
     · Launchpad direct from the browser (CORS `*`, same as the goals panel's
       profit read) — the tests list for the selector and the product-tests
       queue, and the entry log for the selected test.

   Layout and data loading copy the /board route pattern.
   ══════════════════════════════════════════════════════════════════════════ */

interface TodayStats {
  activityState: "LIVE" | "AWAITING" | "NONE";
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
}

interface NoTest {
  present: false;
  testsComplete: number;
  testsTarget: number;
  sinceDate: string;
  daysSince: number;
}

interface MonthPl {
  cogsVerified: boolean;
  revenue: number;
  cogs: number;
  grossProfit: number;
  adSpend: number;
  contribution: number;
  revenueSource: string;
  adSpendSource: string;
}

interface EcomPayload {
  today: string;
  settings?: SettingsMap;
  todayStats: TodayStats;
  test: ActiveTest | NoTest;
  month: MonthPl;
}

const REFRESH_MS = 5 * 60 * 1000;

/** Launchpad's own status convention — mirrored from /api/actions. */
const RUNNING_STATUSES = new Set(["Live", "Iterating"]);
const COMPLETED_STATUSES = new Set(["Killed", "Scaled"]);

/* ── Formatting ───────────────────────────────────────────────────────────── */

function money(n: number) {
  const abs = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function dayLabel(isoDate: string) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Today's Sydney civil date, "YYYY-MM-DD", via Intl — never an offset. */
function sydneyTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return null;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Breakeven ROAS — reciprocal of the gross-margin ratio (PanelEcom's math). */
function breakevenRoas(revenue: number, cogs: number): number | null {
  if (revenue <= 0) return null;
  const marginRatio = (revenue - cogs) / revenue;
  if (marginRatio <= 0) return null;
  return 1 / marginRatio;
}

/* ── Tiles ────────────────────────────────────────────────────────────────────
   Tiles are `.drill-tile` (globals.css) — sizing lives in the stylesheet so the
   drill-tile height tiers apply. Never reintroduce inline padding/gap here:
   inline styles beat the @media tiers (CLAUDE.md). */

function Row({
  label,
  value,
  tone,
  marker,
}: {
  label: string;
  value: string;
  tone?: string;
  marker?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "6px 0",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {marker ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--amber)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            flexShrink: 0,
          }}
        >
          {marker}
        </span>
      ) : null}
      <span
        style={{
          fontSize: 14,
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

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 18px",
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-highlight)",
  color: "var(--text-primary)",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function BusinessPage() {
  const [data, setData] = useState<EcomPayload | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [tests, setTests] = useState<LaunchpadTestRecord[] | null>(null);
  const [testsError, setTestsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LaunchpadEntryRecord[] | null>(null);

  const load = useCallback(async () => {
    // /api/ecom and the Launchpad tests list fail independently — one going
    // down must not blank the other's tiles.
    try {
      const res = await fetch("/api/ecom");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (payload?.error) throw new Error(String(payload.error));
      if (!isEcomPayload(payload)) throw new Error("Unexpected payload shape");
      setData(payload as EcomPayload);
      setDataError(null);
    } catch (e) {
      setData(null);
      setDataError(e instanceof Error ? e.message : "Unknown error");
    }

    try {
      const res = await fetch(`${LAUNCHPAD_API}/tests`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as LaunchpadTestRecord[];
      if (!Array.isArray(list)) throw new Error("Unexpected tests payload");
      setTests(list);
      setTestsError(null);
    } catch (e) {
      setTests(null);
      setTestsError(e instanceof Error ? e.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const running = useMemo(
    () => (tests ?? []).filter((t) => RUNNING_STATUSES.has(t.status)),
    [tests],
  );

  // Default selection: the API's active test when present, else the newest
  // running test. The selector below only renders when there is a choice.
  const activeId = data?.test.present ? data.test.id : null;
  const effectiveId =
    selectedId ??
    activeId ??
    ([...running].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null);

  useEffect(() => {
    if (!effectiveId) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${LAUNCHPAD_API}/entries?test_id=${encodeURIComponent(effectiveId)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()) as LaunchpadEntryRecord[];
        if (!cancelled) setEntries(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setEntries(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, tests]);

  const settings = data?.settings;
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
  const testsTarget = getSetting(
    settings,
    "TESTS_TARGET_COUNT",
    SETTING_DEFAULTS.TESTS_TARGET_COUNT,
  );
  const goLive = getSetting(
    settings,
    "LAUNCHPAD_GO_LIVE_DATE",
    SETTING_DEFAULTS.LAUNCHPAD_GO_LIVE_DATE,
  );

  const todayISO = sydneyTodayISO();

  /* ---- selected test, computed from the Launchpad rows -------------------- */
  const selectedTest = (tests ?? []).find((t) => t.id === effectiveId) ?? null;
  const sortedEntries = useMemo(
    () => [...(entries ?? [])].sort((a, b) => b.entry_date.localeCompare(a.entry_date)), // newest first
    [entries],
  );

  const testView = useMemo(() => {
    if (!selectedTest) return null;
    const spend = sortedEntries.reduce((s, e) => s + (e.meta_spend ?? 0), 0);
    const revenue = sortedEntries.reduce((s, e) => s + (e.revenue ?? 0), 0);
    const lastEntry = sortedEntries[0]?.entry_date ?? null;
    const staleDays = lastEntry ? daysBetweenISO(lastEntry, todayISO) : null;
    const firstEntry = sortedEntries.at(-1)?.entry_date ?? null;
    const dayNumber = firstEntry ? (daysBetweenISO(firstEntry, todayISO) ?? 0) + 1 : 0;
    // Same shapes PanelEcom renders for the active test.
    const low = (selectedTest as { entry_window_low?: number | null }).entry_window_low ?? null;
    const high = (selectedTest as { entry_window_high?: number | null }).entry_window_high ?? null;
    const roas = spend > 0 ? revenue / spend : null;
    const be = breakevenRoas(revenue, revenue * 0.282);
    const insideWindow = low !== null && high !== null && spend >= low && spend <= high;
    const nextGate =
      low === null
        ? "—"
        : insideWindow
          ? "Entry-window verdict"
          : spend < low
            ? `Reach $${low} entry window`
            : "Exit / scale decision";
    const stale = staleDays !== null && staleDays > staleRedDays;
    return {
      spend,
      revenue,
      lastEntry,
      staleDays,
      dayNumber,
      low,
      high,
      roas,
      be,
      nextGate,
      stale,
    };
  }, [selectedTest, sortedEntries, todayISO, staleRedDays]);

  /* ---- campaign status pill ----------------------------------------------- */
  const activity = data?.todayStats.activityState ?? null;
  const pill =
    activity === "LIVE"
      ? { label: "Campaigns live", cls: "badge-green" }
      : activity === "AWAITING"
        ? { label: "Awaiting data", cls: "badge-cyan" }
        : { label: "No campaigns live", cls: "badge-amber" };

  /* ---- product tests ------------------------------------------------------ */
  const completedCount = (tests ?? []).filter((t) => COMPLETED_STATUSES.has(t.status)).length;
  const daysSinceGoLive = daysBetweenISO(String(goLive), todayISO);
  // Validated-not-run: created in Launchpad but never spent a dollar. The
  // permanent Setup-status backtest fixture carries first_spend_at, so the
  // never-spent filter excludes it without naming it.
  const queue = (tests ?? []).filter((t) => t.status === "Setup" && !t.first_spend_at);

  return (
    <div
      tabIndex={0}
      aria-label="Business — scrollable"
      style={{
        marginTop: "calc(var(--nav-h) + var(--strip-h))",
        height: "calc(100dvh - var(--nav-h) - var(--strip-h))",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--border) transparent",
        background: "var(--bg-base)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <DrillChrome
        title="Kurgel Business"
        right={
          <span className={`badge ${pill.cls}`} style={{ fontSize: 12, padding: "8px 14px" }}>
            {pill.label}
          </span>
        }
      />

      {dataError ? (
        <div
          role="alert"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--red)",
            flexShrink: 0,
          }}
        >
          Ecom data unavailable — {dataError}
        </div>
      ) : null}
      {testsError ? (
        <div
          role="alert"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--red)",
            flexShrink: 0,
          }}
        >
          Launchpad unavailable — {testsError}
        </div>
      ) : null}

      {/* Test selector — only when more than one test exists. */}
      {running.length > 1 ? (
        <div
          role="radiogroup"
          aria-label="Which test to show"
          style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}
        >
          {running.map((t) => {
            const on = t.id === effectiveId;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSelectedId(t.id)}
                style={{
                  minHeight: 48,
                  padding: "0 18px",
                  fontSize: 13,
                  fontWeight: 800,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: on ? "var(--bg-highlight)" : "transparent",
                  color: on ? "var(--cyan)" : "var(--text-muted)",
                  border: `1px solid ${on ? "var(--cyan)" : "var(--border)"}`,
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 12,
          flexShrink: 0,
          alignItems: "start",
        }}
      >
        {/* ── Active test tile ─────────────────────────────────────────────── */}
        <div className="drill-tile">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div className="card-title">Active test</div>
            {selectedTest && testView ? (
              <span className={`badge ${testView.stale ? "badge-red" : "badge-green"}`}>
                {testView.stale ? "Stale" : "Running"}
              </span>
            ) : (
              <span className="badge badge-amber">Idle</span>
            )}
          </div>

          {!selectedTest || !testView ? (
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              {tests === null ? "Loading tests…" : "No test is running."}
              {data && !data.test.present ? (
                <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)" }}>
                  {data.test.daysSince} days since {dayLabel(data.test.sinceDate)}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selectedTest.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Day {testView.dayNumber}
                {testView.lastEntry ? <> · last entry {dayLabel(testView.lastEntry)}</> : null}
                {testView.staleDays !== null ? (
                  <span
                    style={{
                      color:
                        testView.staleDays > staleRedDays
                          ? "var(--red)"
                          : testView.staleDays > staleAmberDays
                            ? "var(--amber)"
                            : "var(--text-secondary)",
                      fontWeight: 600,
                    }}
                  >
                    {" "}
                    · {testView.staleDays} {testView.staleDays === 1 ? "day" : "days"} silent
                  </span>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href="https://product-test-engine.netlify.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={buttonStyle}
                >
                  Open in Launchpad ↗
                </a>
                <a
                  href={`/profit.html?test=${encodeURIComponent(selectedTest.id)}`}
                  style={buttonStyle}
                >
                  Open in calculator ↗
                </a>
              </div>

              {/* Spend vs entry window, window floor marked. */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Spend vs ${testView.low ?? 0}–{testView.high ?? 0}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {money(testView.spend)}
                </span>
              </div>
              <div className="progress-track thick" style={{ position: "relative" }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${
                      testView.high && testView.high > 0
                        ? Math.min((testView.spend / testView.high) * 100, 100)
                        : 0
                    }%`,
                    background: "var(--cyan)",
                  }}
                />
                {testView.low !== null && testView.high ? (
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.min((testView.low / testView.high) * 100, 100)}%`,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "var(--amber)",
                    }}
                  />
                ) : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="stat-cell" style={{ padding: "8px 10px" }}>
                  <div
                    className="stat-num sm"
                    style={{
                      color:
                        testView.roas !== null &&
                        testView.be !== null &&
                        testView.roas < testView.be
                          ? "var(--red)"
                          : "var(--text-primary)",
                    }}
                  >
                    {testView.roas === null ? "—" : `${testView.roas.toFixed(2)}×`}
                  </div>
                  <div className="stat-sublabel">ROAS</div>
                </div>
                <div className="stat-cell" style={{ padding: "8px 10px" }}>
                  <div className="stat-num sm" style={{ color: "var(--text-secondary)" }}>
                    {testView.be === null ? "—" : `${testView.be.toFixed(2)}×`}
                  </div>
                  <div className="stat-sublabel">Breakeven</div>
                </div>
              </div>

              <Row label="Next gate" value={testView.nextGate} />

              {/* Entry log — newest first, scrolls. */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 6,
                  maxHeight: 260,
                  overflowY: "auto",
                  scrollbarWidth: "thin",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 4,
                  }}
                >
                  Entry log
                </div>
                {entries === null ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Could not load entries.
                  </div>
                ) : sortedEntries.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No entries yet.</div>
                ) : (
                  sortedEntries.map((e) => (
                    <div
                      key={e.entry_date}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "5px 0",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span style={{ width: 78, color: "var(--text-secondary)", flexShrink: 0 }}>
                        {dayLabel(e.entry_date)}
                      </span>
                      <span style={{ flex: 1, color: "var(--amber)" }}>
                        spend {money(e.meta_spend ?? 0)}
                      </span>
                      <span style={{ flex: 1, color: "var(--text-primary)" }}>
                        rev {money(e.revenue ?? 0)}
                      </span>
                      <span
                        style={{ width: 64, textAlign: "right", color: "var(--text-secondary)" }}
                      >
                        {e.orders ?? 0} ord
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* ── P&L tile ───────────────────────────────────────────────────── */}
          <div className="drill-tile">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div className="card-title">Month · P&amp;L</div>
              {data ? <span className="badge badge-cyan">{dayLabel(data.today)}</span> : null}
            </div>
            {!data ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {dataError ? "Unavailable." : "Loading…"}
              </div>
            ) : (
              <>
                <Row
                  label={`Revenue · ${data.month.revenueSource}`}
                  value={money(data.month.revenue)}
                />
                <Row
                  label="COGS"
                  value={`-${money(data.month.cogs)}`}
                  marker={data.month.cogsVerified === false ? "Unverified" : undefined}
                />
                <Row
                  label="Ad spend · settled"
                  value={`-${money(data.month.adSpend)}`}
                  tone="var(--amber)"
                />
                <div style={{ borderTop: "1px solid var(--border)" }} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Contribution</span>
                  <span
                    style={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: data.month.contribution >= 0 ? "var(--green)" : "var(--red)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {money(data.month.contribution)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* ── Product tests tile ─────────────────────────────────────────── */}
          <div className="drill-tile">
            <div className="card-title">Product tests</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color:
                    completedCount >= Number(testsTarget) ? "var(--green)" : "var(--text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {completedCount} of {String(testsTarget)}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>complete</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {daysSinceGoLive === null ? "—" : daysSinceGoLive} days since Launchpad go-live
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                Queue — validated, not run
              </div>
              {tests === null ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {testsError ? "Unavailable." : "Loading…"}
                </div>
              ) : queue.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Queue is empty.</div>
              ) : (
                queue.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      minHeight: 40,
                      borderBottom: "1px solid var(--border)",
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {t.name}
                    </span>
                    <span
                      style={{
                        color: "var(--text-muted)",
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(() => {
                        const created = t.created_at?.slice(0, 10);
                        const age = created ? daysBetweenISO(created, todayISO) : null;
                        return age === null ? "—" : `${age}d`;
                      })()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
