"use client";

import { useEffect, useState } from "react";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";
import { isPocketSmithPayload } from "../lib/payload-guards";

/* ════════════════════════════════════════════════════════════════════════════
   Left column — LAST WEEK / LAST MONTH / ACCOUNTS.

   Reads GET /api/pocketsmith. There is deliberately NO mock and NO fallback
   data: if the fetch fails the panels say so, because a finance panel quietly
   showing stale or invented numbers is worse than one that shows nothing.
   ══════════════════════════════════════════════════════════════════════════ */

interface CategoryBreakdown {
  title: string;
  amount: number;
  percent: number;
}

interface PeriodSummary {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalSpending: number;
  totalIncome: number;
  difference: number;
  savingsRate: number;
  categorisedTotal: number;
  uncategorisedTotal: number;
  transactionCount: number;
  incomeTransactionCount: number;
  allTransactionCount: number;
  categories: CategoryBreakdown[];
}

interface AccountSummary {
  name: string;
  institution: string;
  type: string;
  balance: number;
}

interface PocketSmithPayload {
  generatedAt: string;
  timeZone: string;
  today: string;
  /** Resolved server-side from the Notion settings data source. */
  settings?: SettingsMap;
  lastWeek: PeriodSummary;
  previousWeek: PeriodSummary;
  lastMonth: PeriodSummary;
  previousMonth: PeriodSummary;
  accounts: AccountSummary[];
  totalBalance: number;
}

/** The route caches for 30 minutes; re-poll a little more often than that. */
const REFRESH_MS = 10 * 60 * 1000;

/* ── Formatting ───────────────────────────────────────────────────────────── */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Money with cents kept — a spend panel that rounds is a spend panel that lies. */
function money(n: number) {
  const abs = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

const parts = (isoDate: string) => isoDate.split("-").map(Number);

/** "13-19 JUL", or "29 JUN-5 JUL" when the window straddles two months. */
function rangeLabel(startDate: string, endDate: string) {
  const [, sm, sd] = parts(startDate);
  const [, em, ed] = parts(endDate);
  return sm === em
    ? `${sd}-${ed} ${MONTHS[sm - 1]}`
    : `${sd} ${MONTHS[sm - 1]}-${ed} ${MONTHS[em - 1]}`;
}

/** "25 JUL" */
function dayLabel(isoDate: string) {
  const [, m, d] = parts(isoDate);
  return `${d} ${MONTHS[m - 1]}`;
}

/* ── Shared pieces ────────────────────────────────────────────────────────── */

const UNCATEGORISED = "Uncategorised";

/**
 * Spending delta against the prior period.
 *
 * The colour is a judgement, the arrow is a direction, and for SPENDING they
 * run opposite to each other: spending less is good. `.delta.up` is the green
 * class and `.delta.down` is the red one (globals.css), so a fall in spending
 * gets the green `.up` class with a ▼ arrow. Do not "fix" this to match.
 */
function SpendDelta({ current, prior }: { current: number; prior: number }) {
  if (prior <= 0) {
    return (
      <div className="delta" style={{ color: "var(--text-muted)", marginTop: 2 }}>
        — no prior period
      </div>
    );
  }

  const diff = current - prior;
  const spentLess = diff < 0;
  const percent = Math.abs(diff / prior) * 100;

  return (
    <div className={`delta ${spentLess ? "up" : "down"}`} style={{ marginTop: 2 }}>
      {spentLess ? "▼" : "▲"} {percent.toFixed(1)}% ({money(Math.abs(diff))}){" "}
      {spentLess ? "less" : "more"} than prior
    </div>
  );
}

/** Earned / Spent / Saved, reusing the existing .stat-cell treatment. */
function TripleStat({ period }: { period: PeriodSummary }) {
  const saved = period.difference;
  // Overridden inline rather than in globals.css: .stat-cell / .stat-num /
  // .stat-sublabel are shared with columns B and C, which are out of scope and
  // have height to spare. Only this column is starved.
  const cell = { padding: "3px 7px" };
  const num = { fontSize: 16 };
  const label = { marginTop: 1, fontSize: 10, lineHeight: 1.1 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, flexShrink: 0 }}>
      <div className="stat-cell" style={cell}>
        <div className="stat-num sm green" style={num}>{money(period.totalIncome)}</div>
        <div className="stat-sublabel" style={label}>
          Earned
        </div>
      </div>
      <div className="stat-cell" style={cell}>
        <div className="stat-num sm" style={num}>{money(period.totalSpending)}</div>
        <div className="stat-sublabel" style={label}>
          Spent
        </div>
      </div>
      <div className="stat-cell" style={cell}>
        <div className={`stat-num sm ${saved >= 0 ? "cyan" : "red"}`} style={num}>{money(saved)}</div>
        <div className="stat-sublabel" style={label}>
          Saved {period.savingsRate.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

/** One category row: name, share bar, amount — the existing .hbar-* language. */
function CategoryRow({ category, tone }: { category: CategoryBreakdown; tone: string }) {
  return (
    // 2px between rows, and line boxes trimmed to 1.15. Font size is untouched:
    // four category rows per card is the data, and it stays.
    <div className="hbar-row" style={{ marginBottom: 2 }}>
      <div className="hbar-label" style={{ width: 84, fontSize: 11, lineHeight: 1.15 }}>
        {category.title}
      </div>
      <div className="hbar-track">
        <div
          className="hbar-fill"
          style={{ width: `${Math.min(category.percent, 100)}%`, background: tone }}
        />
      </div>
      <div className="hbar-value" style={{ width: 66, fontSize: 11, lineHeight: 1.15 }}>
        {money(category.amount)}
      </div>
    </div>
  );
}

/** Card chrome shared by the loading and error states, so heights never jump. */
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

/**
 * A spending period panel. Panels 1 and 2 are the same component — the only
 * difference is which window and which comparison period get passed in.
 */

/**
 * "Open →" header link.
 *
 * Style copied verbatim from the HOMESCHOOL WEEK header link
 * (PanelHomeschoolWeek.tsx) — same amber token, font size, letter spacing,
 * padding, radius, border and arrow glyph. That badge is inline-styled rather
 * than a shared component, so matching it means duplicating the style object;
 * extracting it would mean editing column D, which is out of scope here.
 */
function OpenLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontSize: 10,
        color: "var(--amber)",
        textDecoration: "none",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: "rgba(245,166,35,0.1)",
        // 1px, not 2: this badge carries a 1px border that .badge does not, so
        // matching padding made it 21px against every other header's 19px and
        // LAST WEEK's header stood 2px taller than its neighbours'. The border
        // pays for the padding.
        padding: "1px 7px",
        borderRadius: 4,
        border: "1px solid rgba(245,166,35,0.2)",
        display: "inline-flex",
      }}
    >
      Open →
    </a>
  );
}

function PeriodPanel({
  title,
  period,
  prior,
  tone,
  headerLink,
  includeUncategorised,
}: {
  title: string;
  period: PeriodSummary;
  prior: PeriodSummary;
  tone: string;
  headerLink?: string;
  includeUncategorised: boolean;
}) {
  // The route already reports uncategorised separately; filter defensively so a
  // shape change can never render the same money twice.
  const top = period.categories.filter((c) => c.title !== UNCATEGORISED).slice(0, 4);
  const uncategorised = period.uncategorisedTotal;
  const hasUncategorised = uncategorised > 0;

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span className="badge badge-cyan">{rangeLabel(period.startDate, period.endDate)}</span>
          {headerLink && <OpenLink href={headerLink} />}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          // 2px, not 4: five gaps per card across two cards is 20px of pure air,
          // and this column is the one that runs out of room.
          gap: 2,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Hero — total spent */}
        <div
          style={{
            // 34 -> 28. Still comfortably the largest thing in the card (the next
            // is 18px), and the line-height below is unchanged: the height comes
            // out of the glyph, never out of the line box.
            fontSize: 28,
            fontWeight: 700,
            color: tone,
            // 1.2 keeps the glyph ink inside the line box; at 1.1 the "$" tail
            // overhangs by 2px and reads as clipped.
            lineHeight: 1.2,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
          }}
        >
          {money(period.totalSpending)}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          spent · {period.transactionCount} transactions
        </div>

        <SpendDelta current={period.totalSpending} prior={prior.totalSpending} />

        <TripleStat period={period} />

        {/* Category breakdown */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 5, marginTop: 1 }}>
          {top.map((c) => (
            <CategoryRow key={c.title} category={c} tone={tone} />
          ))}
        </div>

        {/* Uncategorised — rendered even at zero while INCLUDE_UNCATEGORISED is
            on. PocketSmith's own widget hides this row, which quietly hides real
            money, so the setting defaults to true. */}
        {includeUncategorised && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            borderTop: "1px solid var(--border)",
            paddingTop: 4,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: hasUncategorised ? "var(--amber)" : "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Uncategorised
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: hasUncategorised ? "var(--amber)" : "var(--text-muted)",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {money(uncategorised)}
          </span>
        </div>
        )}
      </div>
    </div>
  );
}

/* ── Panel 3 — Accounts ───────────────────────────────────────────────────── */

function AccountsPanel({ data }: { data: PocketSmithPayload }) {
  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">Accounts</div>
        <span className="badge badge-cyan">as at {dayLabel(data.today)}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          {data.accounts.map((account, i) => (
            <div
              key={`${account.name}-${account.institution}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                // Density, not deletion: the row carries no vertical padding and
                // rides tight line boxes so all six accounts fit. Font sizes are
                // untouched — this is a 65" panel read from across the room, and
                // legibility comes from glyph size, not from the air around it.
                padding: 0,
                borderBottom:
                  i === data.accounts.length - 1 ? "none" : "1px solid var(--border)",
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.15,
                    color: "var(--text-primary)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {account.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    lineHeight: 1.1,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {account.institution}
                </div>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  // Negative balances use the red token; everything else stays
                  // on the standard text token.
                  color: account.balance < 0 ? "var(--red)" : "var(--text-primary)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {money(account.balance)}
              </span>
            </div>
          ))}
        </div>

        {/* Total — visually separated from the account rows */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-inner)",
            borderRadius: 6,
            padding: "7px 10px",
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}
          >
            Total Balance
          </span>
          <span
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: data.totalBalance < 0 ? "var(--red)" : "var(--cyan)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
              flexShrink: 0,
            }}
          >
            {money(data.totalBalance)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Column ───────────────────────────────────────────────────────────────── */

/** Delegates to the shared guards so the contract is testable in isolation. */
function isRenderable(p: unknown): p is PocketSmithPayload {
  return isPocketSmithPayload(p);
}

export default function PanelFinance() {
  const [data, setData] = useState<PocketSmithPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/pocketsmith");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json();
        if (payload?.error) throw new Error(String(payload.error));
        if (!isRenderable(payload)) throw new Error("Unexpected payload shape");

        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (e) {
        // No fallback to stale or invented figures — surface the failure.
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
        {["Last Week", "Last Month", "Accounts"].map((title) => (
          <ShellCard
            key={title}
            title={title}
            badge="⚠ Error"
            badgeClass="badge-red"
            message={`PocketSmith unavailable — ${error}`}
          />
        ))}
      </>
    );
  }

  if (!data) {
    return (
      <>
        {["Last Week", "Last Month", "Accounts"].map((title) => (
          <ShellCard key={title} title={title} badge="Loading…" badgeClass="badge-cyan" message="…" />
        ))}
      </>
    );
  }

  const settings = data.settings;
  const pocketsmithUrl = getSetting(
    settings,
    "POCKETSMITH_DASHBOARD_URL",
    SETTING_DEFAULTS.POCKETSMITH_DASHBOARD_URL,
  );
  const includeUncategorised = getSetting(
    settings,
    "INCLUDE_UNCATEGORISED",
    SETTING_DEFAULTS.INCLUDE_UNCATEGORISED,
  );

  return (
    <>
      <PeriodPanel
        title="Last Week"
        period={data.lastWeek}
        prior={data.previousWeek}
        tone="var(--cyan)"
        headerLink={pocketsmithUrl}
        includeUncategorised={includeUncategorised}
      />
      <PeriodPanel
        title="Last Month"
        period={data.lastMonth}
        prior={data.previousMonth}
        tone="var(--amber)"
        includeUncategorised={includeUncategorised}
      />
      <AccountsPanel data={data} />
    </>
  );
}
