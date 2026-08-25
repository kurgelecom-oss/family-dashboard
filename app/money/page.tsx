"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import DrillChrome from "../components/DrillChrome";
import { isPocketSmithPayload, isPeriod, isRec } from "../lib/payload-guards";
import {
  allocate,
  readGoals,
  readGoalsServer,
  subscribeGoals,
  writeGoals,
  useBusinessProfit,
} from "../components/PanelTodos";

/* ════════════════════════════════════════════════════════════════════════════
   /money — Column A's drill-down. RESTRUCTURE-SPEC §4.

   One fetch to /api/pocketsmith (the same payload PanelFinance reads, plus the
   additive lastQuarter/previousQuarter pair), re-polled on PanelFinance's own
   10-minute cadence. Layout and data loading copy the /board route pattern:
   full-viewport scroll container under the nav + strip, one load function, one
   interval.

   The rewards tile moves here from Column C. It reads and writes the SAME
   state the face's goals panel uses — localStorage `familyGoals.v1` through
   PanelTodos's exported store — plus one new sibling key for the editable
   saved-pot override, which the face never reads and therefore cannot clobber.
   Dollars are visible here by design: the zero-currency rule retires with the
   goals panel (spec §2).
   ══════════════════════════════════════════════════════════════════════════ */

interface CategoryBreakdown {
  title: string;
  amount: number;
  percent: number;
}

interface PeriodSummary {
  startDate: string;
  endDate: string;
  totalSpending: number;
  totalIncome: number;
  difference: number;
  savingsRate: number;
  uncategorisedTotal: number;
  transactionCount: number;
  categories: CategoryBreakdown[];
}

interface AccountSummary {
  name: string;
  institution: string;
  balance: number;
}

interface MoneyPayload {
  today: string;
  lastWeek: PeriodSummary;
  previousWeek: PeriodSummary;
  lastMonth: PeriodSummary;
  previousMonth: PeriodSummary;
  lastQuarter: PeriodSummary;
  previousQuarter: PeriodSummary;
  accounts: AccountSummary[];
  totalBalance: number;
}

/** PanelFinance's cadence — the route caches for 30 minutes. */
const REFRESH_MS = 10 * 60 * 1000;

type PeriodKey = "week" | "month" | "quarter";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "3 months" },
];

/* ── Formatting — PanelFinance's money(), cents kept ─────────────────────── */

function money(n: number) {
  const abs = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function rangeLabel(startDate: string, endDate: string) {
  const [, sm, sd] = startDate.split("-").map(Number);
  const [, em, ed] = endDate.split("-").map(Number);
  return sm === em
    ? `${sd}-${ed} ${MONTHS[sm - 1]}`
    : `${sd} ${MONTHS[sm - 1]} - ${ed} ${MONTHS[em - 1]}`;
}

/** PocketSmith transaction search for one category over one date window —
 *  the exact URL shape my.pocketsmith.com's own deep links use. */
function pocketsmithSearchUrl(keywords: string, startDate: string, endDate: string): string {
  const q = new URLSearchParams({
    "search[by_date_quantifier]": "range",
    "search[by_keywords]": keywords,
    "search[custom_date_range_start_date]": startDate,
    "search[custom_date_range_end_date]": endDate,
    "search[date_range]": "custom",
  });
  return `https://my.pocketsmith.com/transactions/search?${q.toString()}`;
}

const POCKETSMITH_ACCOUNT_SUMMARY = "https://my.pocketsmith.com/account_summary";

/* ── Saved-pot override — sibling localStorage key ────────────────────────────
   The goals panel stores targets/people/split in `familyGoals.v1` and computes
   the pot live from Launchpad profit. The pot override lives in its own key in
   the SAME storage: writing it into familyGoals.v1 would be silently dropped by
   the face's normalise-on-write (which emits only the three known fields), so a
   sibling key is the one arrangement the two surfaces cannot corrupt.
   ──────────────────────────────────────────────────────────────────────────── */

const POT_OVERRIDE_KEY = "familyGoals.savedPot.v1";

let potCache: number | null | undefined;
const potListeners = new Set<() => void>();

function readPotOverride(): number | null {
  if (potCache !== undefined) return potCache;
  try {
    const raw = window.localStorage.getItem(POT_OVERRIDE_KEY);
    const n = raw === null ? NaN : Number.parseFloat(raw);
    potCache = Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    potCache = null;
  }
  return potCache;
}

const readPotOverrideServer = (): number | null => null;

function writePotOverride(next: number | null): void {
  potCache = next;
  try {
    if (next === null) window.localStorage.removeItem(POT_OVERRIDE_KEY);
    else window.localStorage.setItem(POT_OVERRIDE_KEY, String(next));
  } catch {
    /* storage blocked — holds for this session only */
  }
  potListeners.forEach((l) => l());
}

function subscribePotOverride(onChange: () => void): () => void {
  potListeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === POT_OVERRIDE_KEY) {
      potCache = undefined;
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    potListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/* ── Small pieces ─────────────────────────────────────────────────────────── */

const tileStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
};

function TileTitle({ children, badge }: { children: string; badge?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div className="card-title">{children}</div>
      {badge ? <span className="badge badge-cyan">{badge}</span> : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: string;
  sub?: string;
}) {
  return (
    <div style={tileStyle}>
      <div className="card-title">{label}</div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          color: tone,
          lineHeight: 1.2,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{sub}</div> : null}
    </div>
  );
}

/** Spending change vs the prior period. Spending less is good = green. */
function spendChange(current: number, prior: number): { text: string; tone: string } {
  if (prior <= 0) return { text: "no prior period", tone: "var(--text-muted)" };
  const diff = current - prior;
  const less = diff < 0;
  const pct = Math.abs(diff / prior) * 100;
  return {
    text: `${less ? "▼" : "▲"} ${pct.toFixed(1)}% (${money(Math.abs(diff))}) ${less ? "less" : "more"} than prior`,
    tone: less ? "var(--green)" : "var(--red)",
  };
}

const editInput: CSSProperties = {
  width: 110,
  minHeight: 40,
  background: "var(--bg-inner)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
  padding: "6px 10px",
  flexShrink: 0,
};

/* ── Rewards tile — the goals panel, moved here, dollars visible ─────────── */

function RewardsTile() {
  const state = useSyncExternalStore(subscribeGoals, readGoals, readGoalsServer);
  const potOverride = useSyncExternalStore(
    subscribePotOverride,
    readPotOverride,
    readPotOverrideServer,
  );
  const [editing, setEditing] = useState(false);
  const profit = useBusinessProfit();

  const toNum = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };

  const setTarget = (key: "docklands" | "trip" | "crown", raw: string) => {
    const s = readGoals();
    writeGoals({ ...s, targets: { ...s.targets, [key]: toNum(raw) } });
  };
  const setPeople = (raw: string) => {
    const s = readGoals();
    writeGoals({ ...s, people: Math.max(0, Math.floor(toNum(raw) ?? 0)) });
  };

  /** Computed pot: Launchpad contribution profit × split — the default. */
  const computedPot =
    profit.cumulative === null
      ? null
      : (Math.max(0, profit.cumulative) * state.rewardSplitPct) / 100;

  const pot = potOverride ?? computedPot;
  const { rows, totalTarget, overallPct } = allocate(state, pot, profit.genuineTest);

  return (
    <div style={tileStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="card-title">Rewards</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`badge ${overallPct === null ? "badge-amber" : "badge-cyan"}`}>
            {overallPct === null ? "No data" : `${Math.round(Math.min(overallPct, 999))}%`}
          </span>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            style={{
              minHeight: 48,
              padding: "0 16px",
              border: "1px solid var(--border)",
              background: editing ? "rgba(0,212,255,0.12)" : "transparent",
              color: editing ? "var(--cyan)" : "var(--text-secondary)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {editing ? "Done" : "Edit targets"}
          </button>
        </div>
      </div>

      {/* Saved pot — dollars, editable. Override stored; computed is default. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          background: "var(--bg-inner)",
          borderRadius: 8,
          padding: "10px 12px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Saved pot
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: pot === null ? "var(--text-muted)" : "var(--cyan)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pot === null ? "—" : money(pot)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {potOverride !== null
              ? `manual override · computed is ${computedPot === null ? "—" : money(computedPot)}`
              : profit.error
                ? `profit read failed — ${profit.error}`
                : `computed: business profit × ${state.rewardSplitPct}% split`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Set pot $</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={50}
            value={potOverride === null ? "" : potOverride}
            placeholder={computedPot === null ? "—" : String(Math.round(computedPot))}
            onChange={(e) => writePotOverride(toNum(e.target.value))}
            style={editInput}
          />
        </label>
        {potOverride !== null ? (
          <button
            type="button"
            onClick={() => writePotOverride(null)}
            style={{
              minHeight: 48,
              padding: "0 14px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Use computed
          </button>
        ) : null}
      </div>

      {/* Five goals, funding order, with dollars and % each. */}
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            background: "var(--bg-inner)",
            borderRadius: 8,
            borderLeft: `3px solid ${
              row.state === "funded" || row.state === "earned"
                ? "var(--green)"
                : row.state === "next" || row.state === "progress"
                  ? "var(--cyan)"
                  : "var(--text-muted)"
            }`,
            padding: "8px 12px",
            minHeight: 48,
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--text-primary)",
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.label}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row.target !== null ? money(row.target) : (row.note ?? "—")}
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 800,
                color:
                  row.target !== null || row.note !== undefined
                    ? "var(--cyan)"
                    : "var(--text-muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row.target !== null || row.note !== undefined ? `${Math.round(row.pct)}%` : "—"}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(100, row.pct)}%`,
                background:
                  row.state === "funded" || row.state === "earned" ? "var(--green)" : "var(--cyan)",
              }}
            />
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Total target {totalTarget > 0 ? money(totalTarget) : "—"} · pot fills top-down · Night out
        is earned by running test #1
      </div>

      {editing ? (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {(
            [
              ["docklands", "1 · Docklands move"],
              ["trip", "2 · Sydney or QLD trip"],
              ["crown", "3 · Crown weekend"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={50}
                  value={state.targets[key] === null ? "" : (state.targets[key] as number)}
                  placeholder="—"
                  onChange={(e) => setTarget(key, e.target.value)}
                  style={editInput}
                />
              </span>
            </label>
          ))}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              5 · Shopping spree — people ($250 each)
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={state.people}
              onChange={(e) => setPeople(e.target.value)}
              style={editInput}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

function isMoneyPayload(p: unknown): p is MoneyPayload {
  return (
    isPocketSmithPayload(p) &&
    isRec(p) &&
    isPeriod((p as Record<string, unknown>)["lastQuarter"]) &&
    isPeriod((p as Record<string, unknown>)["previousQuarter"])
  );
}

export default function MoneyPage() {
  const [data, setData] = useState<MoneyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("week");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pocketsmith");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (payload?.error) throw new Error(String(payload.error));
      if (!isMoneyPayload(payload)) throw new Error("Unexpected payload shape");
      setData(payload);
      setError(null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const current =
    data === null
      ? null
      : period === "week"
        ? { now: data.lastWeek, prior: data.previousWeek }
        : period === "month"
          ? { now: data.lastMonth, prior: data.previousMonth }
          : { now: data.lastQuarter, prior: data.previousQuarter };

  const change = current
    ? spendChange(current.now.totalSpending, current.prior.totalSpending)
    : null;

  return (
    <div
      tabIndex={0}
      aria-label="Money — scrollable"
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
        title="Kurgel Money"
        right={
          <div role="radiogroup" aria-label="Period" style={{ display: "flex", gap: 6 }}>
            {PERIODS.map((p) => {
              const on = period === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPeriod(p.key)}
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
                  {p.label}
                </button>
              );
            })}
          </div>
        }
      />

      {error ? (
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
          PocketSmith unavailable — {error}
        </div>
      ) : null}

      {!data && !error ? (
        <div style={{ ...tileStyle, color: "var(--text-secondary)", fontSize: 15 }}>
          Loading money…
        </div>
      ) : null}

      {data && current ? (
        <>
          {/* Three tiles — Earned / Spent / Saved */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <StatTile
              label="Earned"
              value={money(current.now.totalIncome)}
              tone="var(--green)"
              sub={rangeLabel(current.now.startDate, current.now.endDate)}
            />
            <div style={tileStyle}>
              <div className="card-title">Spent</div>
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
                {money(current.now.totalSpending)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {current.now.transactionCount} transactions
              </div>
              {change ? (
                <div style={{ fontSize: 12, fontWeight: 600, color: change.tone }}>
                  {change.text}
                </div>
              ) : null}
            </div>
            <StatTile
              label="Saved"
              value={money(current.now.difference)}
              tone={current.now.difference >= 0 ? "var(--cyan)" : "var(--red)"}
              sub={`${current.now.savingsRate.toFixed(1)}% of income`}
            />
          </div>

          {/* Categories + Accounts */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div style={tileStyle}>
              <TileTitle badge={rangeLabel(current.now.startDate, current.now.endDate)}>
                Categories
              </TileTitle>
              {current.now.categories.length === 0 && current.now.uncategorisedTotal <= 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  No spending in this period.
                </div>
              ) : null}
              {current.now.categories.map((c) => (
                <a
                  key={c.title}
                  href={pocketsmithSearchUrl(c.title, current.now.startDate, current.now.endDate)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open ${c.title} transactions in PocketSmith`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 48,
                    textDecoration: "none",
                    borderBottom: "1px solid var(--border)",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      width: 140,
                      fontSize: 13,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {c.title}
                  </span>
                  <span className="hbar-track">
                    <span
                      className="hbar-fill"
                      style={{
                        display: "block",
                        width: `${Math.min(c.percent, 100)}%`,
                        background: "var(--cyan)",
                      }}
                    />
                  </span>
                  <span
                    style={{
                      width: 90,
                      textAlign: "right",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {money(c.amount)}
                  </span>
                </a>
              ))}
              {/* Uncategorised — amber, always its own row when non-zero. */}
              {current.now.uncategorisedTotal > 0 ? (
                <a
                  href="https://my.pocketsmith.com/transactions/uncategorised"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open uncategorised transactions in PocketSmith"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    minHeight: 48,
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--amber)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Uncategorised
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--amber)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {money(current.now.uncategorisedTotal)}
                  </span>
                </a>
              ) : null}
            </div>

            <div style={tileStyle}>
              <TileTitle>Accounts</TileTitle>
              {data.accounts.map((a, i) => (
                <a
                  key={`${a.name}-${a.institution}`}
                  href={POCKETSMITH_ACCOUNT_SUMMARY}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the account summary in PocketSmith"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    minHeight: 48,
                    textDecoration: "none",
                    borderBottom:
                      i === data.accounts.length - 1 ? "none" : "1px solid var(--border)",
                    minWidth: 0,
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 13,
                        color: "var(--text-primary)",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.name}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                      {a.institution}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: a.balance < 0 ? "var(--red)" : "var(--text-primary)",
                      fontVariantNumeric: "tabular-nums",
                      flexShrink: 0,
                    }}
                  >
                    {money(a.balance)}
                  </span>
                </a>
              ))}
              {/* Hairline, then the total in cyan. */}
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Total
                </span>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: data.totalBalance < 0 ? "var(--red)" : "var(--cyan)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {money(data.totalBalance)}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Rewards — bottom of the column, independent of the PocketSmith read. */}
      <RewardsTile />
    </div>
  );
}
