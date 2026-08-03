"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";
import { isActionsPayload } from "../lib/payload-guards";
import {
  LAUNCHPAD_API,
  type LaunchpadEntryRecord,
  type LaunchpadTestRecord,
} from "../lib/launchpad";

/* ════════════════════════════════════════════════════════════════════════════
   Column C — FAMILY GOALS / THE CLOCK.

   Two panels. Family Goals keeps its TARGETS in localStorage but no longer
   holds a hand-typed savings figure: the money side is funded from realised
   business profit read live from Launchpad. THE CLOCK still reads
   GET /api/actions — which is why this file keeps fetching that route even
   though the Actions panel it used to feed has been removed from this column.
   The route itself is untouched and still serves its other data.

   Goals and time only: this column renders ZERO currency in its panel bodies by
   design. Money lives in column B. The one sanctioned exception is the Family
   Goals Edit toggle, which reveals the amount inputs on demand; if a dollar
   figure shows up anywhere else here, something is wired to the wrong payload.
   ══════════════════════════════════════════════════════════════════════════ */

interface ActionItem {
  id: string;
  title: string;
  priority: string | null;
  type: string | null;
  area: string | null;
  dueDate: string | null;
  daysPastDue: number | null;
  completed: boolean;
  completedDate: string | null;
  overdue: boolean;
}

interface InputItem {
  id: string;
  title: string;
  type: string | null;
  area: string | null;
  doneToday: boolean;
  streak: number;
}

interface ClockTests {
  completed: number;
  target: number;
  lastCompletedDate: string | null;
  gapFromDate: string;
  daysSinceLastCompleted: number;
  everCompleted: boolean;
}

interface ActionsPayload {
  generatedAt: string;
  timeZone: string;
  today: string;
  settings?: SettingsMap;
  actions: {
    decisionDue: { name: string; reason: string } | null;
    ranked: ActionItem[];
    pendingCount: number;
    doneToday: number;
  };
  inputs: InputItem[];
  clock: {
    daysLeftInWeek: number;
    daysLeftInMonth: number;
    daysToTractionEnd: number;
    tractionEndDate: string;
    yearElapsedPct: number;
    tests: ClockTests;
  };
}

const REFRESH_MS = 5 * 60 * 1000;

/* ── Shared chrome ────────────────────────────────────────────────────────── */

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

/** A count + label pair for THE CLOCK. Counts only — never currency. */
function ClockStat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="stat-cell" style={{ padding: "5px 7px", minWidth: 0 }}>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1.2,
          color: tone ?? "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      <div
        className="stat-sublabel"
        style={{
          marginTop: 2,
          fontSize: 9,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ── Panel 1 — FAMILY GOALS ───────────────────────────────────────────────────
   Five goals, funded two different ways.

   FOUR are auto-funded from money the business actually made. Nothing here is
   typed by hand any more: the reward pot is a split of cumulative contribution
   profit read live from Launchpad (see useBusinessProfit below), poured
   top-down through the targets. A hand-entered "saved so far" was the previous
   model and is gone — it let the panel claim progress no bank account backed.

   ONE — Night out — is behaviour-linked, not money-linked. It is earned by
   running product test #1 and nothing else, so it carries no dollar target and
   takes no share of the pot.

   Zero currency in the body, per the column rule: every goal row shows a bar, a
   percentage and a state — never a dollar figure. The amounts live behind the
   Edit toggle, the only place a "$" is allowed to appear.

   Targets stay browser-local (localStorage) — there is no goals API, so targets
   do not sync between devices. The funding side does: it is derived from the
   same Launchpad data every screen reads.
   ──────────────────────────────────────────────────────────────────────────── */

const GOALS_STORAGE_KEY = "familyGoals.v1";

/** $250 a head, so the spree target tracks the people count. */
const SPREE_PER_PERSON = 250;
const DEFAULT_PEOPLE = 4;

/**
 * The whole pot by default — the identity, not an invented fraction. There is
 * no reward-split key in the Notion settings and no split convention anywhere
 * in this repo, so inventing "20%" here would be fabricating a family rule.
 * 100% is the honest starting point and the Edit form dials it down.
 */
const DEFAULT_REWARD_SPLIT_PCT = 100;

type GoalKey = "docklands" | "trip" | "crown" | "nightOut" | "spree";

/**
 * Editable dollar targets. The spree is computed from `people`, and `nightOut`
 * is behaviour-linked — neither is stored, so neither is a TargetKey.
 */
type TargetKey = Exclude<GoalKey, "spree" | "nightOut">;

/** Priority order IS the waterfall order — goal 1 fills before goal 2. */
const GOAL_DEFS: { key: GoalKey; label: string }[] = [
  { key: "docklands", label: "Docklands move" },
  { key: "trip", label: "Sydney or QLD trip" },
  { key: "crown", label: "Crown weekend" },
  { key: "nightOut", label: "Night out" },
  { key: "spree", label: "Shopping spree" },
];

const TARGET_KEYS: TargetKey[] = ["docklands", "trip", "crown"];

interface GoalsState {
  targets: Record<TargetKey, number | null>;
  people: number;
  /** Share of cumulative profit that becomes reward money, 0–100. */
  rewardSplitPct: number;
}

/** Targets start unset — null, never 0, so "no target yet" reads as itself. */
const EMPTY_GOALS: GoalsState = {
  targets: { docklands: null, trip: null, crown: null },
  people: DEFAULT_PEOPLE,
  rewardSplitPct: DEFAULT_REWARD_SPLIT_PCT,
};

const numOrNull = (x: unknown): boolean =>
  x === null || (typeof x === "number" && Number.isFinite(x));

/**
 * Anything in localStorage is untrusted input — validate before adopting it.
 * `rewardSplitPct` is tolerated when absent so records written before the
 * auto-funding rework still load with their targets intact; normaliseGoals
 * fills it in. Retired keys (`saved`, `targets.nightOut`) are simply ignored
 * and drop out on the next write.
 */
function isGoalsState(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const t = o["targets"];
  if (typeof t !== "object" || t === null) return false;
  const tt = t as Record<string, unknown>;
  if (!TARGET_KEYS.every((k) => tt[k] === undefined || numOrNull(tt[k]))) return false;
  if (typeof o["people"] !== "number" || !Number.isFinite(o["people"])) return false;
  const split = o["rewardSplitPct"];
  return split === undefined || (typeof split === "number" && Number.isFinite(split));
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** Coerce a validated record into a complete, in-range GoalsState. */
function normaliseGoals(v: unknown): GoalsState {
  const o = v as Record<string, unknown>;
  const tt = o["targets"] as Record<string, unknown>;
  const targets = { docklands: null, trip: null, crown: null } as Record<TargetKey, number | null>;
  for (const k of TARGET_KEYS) {
    const raw = tt[k];
    targets[k] = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  const split = o["rewardSplitPct"];
  return {
    targets,
    people: o["people"] as number,
    rewardSplitPct:
      typeof split === "number" && Number.isFinite(split)
        ? clampPct(split)
        : DEFAULT_REWARD_SPLIT_PCT,
  };
}

type GoalState = "funded" | "progress" | "next" | "pending" | "unset" | "earned" | "locked";

const STATE_META: Record<GoalState, { label: string; cls: string; tone?: string; bar: string }> = {
  funded: { label: "Funded", cls: "badge badge-green", bar: "var(--green)" },
  progress: { label: "In progress", cls: "badge badge-cyan", bar: "var(--cyan)" },
  next: { label: "Next", cls: "badge badge-amber", bar: "var(--amber)" },
  pending: {
    label: "Not started",
    cls: "badge",
    tone: "var(--text-muted)",
    bar: "var(--text-muted)",
  },
  unset: {
    label: "Set target",
    cls: "badge",
    tone: "var(--text-muted)",
    bar: "var(--text-muted)",
  },
  earned: { label: "Earned", cls: "badge badge-green", bar: "var(--green)" },
  locked: {
    label: "Locked",
    cls: "badge",
    tone: "var(--text-muted)",
    bar: "var(--text-muted)",
  },
};

interface GoalRow {
  key: GoalKey;
  label: string;
  target: number | null;
  pct: number;
  state: GoalState;
  /** Set on behaviour-linked rows only — the sentence under the bar. */
  note?: string;
}

/** Dollar target for a goal — computed for the spree, stored for the rest. */
function targetOf(state: GoalsState, key: GoalKey): number | null {
  if (key === "nightOut") return null; // behaviour-linked, never a dollar goal
  if (key !== "spree") return state.targets[key as TargetKey];
  const people = Math.max(0, Math.floor(state.people));
  return people > 0 ? people * SPREE_PER_PERSON : null;
}

/**
 * Top-down waterfall: fill goal 1 to its target, spill the remainder into goal
 * 2, and so on. An unset target cannot be filled and cannot stop the spill —
 * otherwise one blank field would stall every goal below it.
 *
 * `pot` is the reward money available, or null while the profit read is still
 * in flight / has failed. Null is NOT zero: a null pot renders "—" rather than
 * asserting nothing has been earned.
 *
 * Night out is skipped entirely — it consumes no pot and is decided by
 * `testRunning`, which is null until the Launchpad read resolves.
 */
function allocate(
  state: GoalsState,
  pot: number | null,
  testRunning: boolean | null,
): {
  rows: GoalRow[];
  totalTarget: number;
  overallPct: number | null;
} {
  let remaining = Math.max(0, pot ?? 0);
  let nextClaimed = false;

  const rows: GoalRow[] = GOAL_DEFS.map((def) => {
    if (def.key === "nightOut") {
      if (testRunning === null) {
        return {
          key: def.key,
          label: def.label,
          target: null,
          pct: 0,
          state: "locked",
          note: "Checking Launchpad…",
        };
      }
      return testRunning
        ? {
            key: def.key,
            label: def.label,
            target: null,
            pct: 100,
            state: "earned",
            note: "Test #1 is running — earned",
          }
        : {
            key: def.key,
            label: def.label,
            target: null,
            pct: 0,
            state: "locked",
            note: "Run test #1 to unlock",
          };
    }

    const target = targetOf(state, def.key);
    if (target === null || target <= 0) {
      return { key: def.key, label: def.label, target: null, pct: 0, state: "unset" };
    }
    const allocated = Math.min(remaining, target);
    remaining -= allocated;

    let s: GoalState;
    if (allocated >= target) s = "funded";
    else if (allocated > 0) s = "progress";
    else if (!nextClaimed) {
      s = "next";
      nextClaimed = true;
    } else s = "pending";

    return { key: def.key, label: def.label, target, pct: (allocated / target) * 100, state: s };
  });

  const totalTarget = rows.reduce((sum, r) => sum + (r.target ?? 0), 0);
  const funded = Math.max(0, pot ?? 0);
  return {
    rows,
    totalTarget,
    overallPct: totalTarget > 0 && pot !== null ? (funded / totalTarget) * 100 : null,
  };
}

/* ── Business profit — the funding source ─────────────────────────────────────
   Cumulative CONTRIBUTION PROFIT (revenue − COGS − ad spend) summed over every
   Launchpad test that represents real trading. This is not a new definition of
   profit: it is the same arithmetic app/api/ecom/product/route.ts already
   performs per test, and the same contribution figure /api/ecom reports for the
   month, just accumulated over each test's whole life.

   WHICH TESTS COUNT is the repo's own existing status convention, mirrored from
   app/api/actions/route.ts — running (Live, Iterating) plus finished (Killed,
   Scaled). That is load-bearing, not tidiness: Launchpad permanently holds a
   "Setup" fixture (GHKCU-BACKTEST-REPLAY, a Phase D verification artifact)
   whose replayed entries carry hundreds of dollars of synthetic profit. Summing
   every test indiscriminately would pour that fiction straight into the family
   reward pot.

   Read client-side, cross-origin: the Launchpad API answers with
   `access-control-allow-origin: *`, so the browser reaches it directly and no
   new server route is needed.
   ──────────────────────────────────────────────────────────────────────────── */

const RUNNING_STATUSES = new Set(["Live", "Iterating"]);
const COMPLETED_STATUSES = new Set(["Killed", "Scaled"]);
const TRADING_STATUSES = new Set([...RUNNING_STATUSES, ...COMPLETED_STATUSES]);

interface ProfitRead {
  /** Cumulative contribution profit; null while loading or after a failure. */
  cumulative: number | null;
  /** True once a Live/Iterating test has at least one real entry row. */
  testRunning: boolean | null;
  /** Sydney wall-clock stamp of the successful read. */
  readAt: string | null;
  error: string | null;
}

const EMPTY_PROFIT: ProfitRead = {
  cumulative: null,
  testRunning: null,
  readAt: null,
  error: null,
};

/** Contribution profit over a test's whole life — the /api/ecom/product math. */
function testContribution(test: LaunchpadTestRecord, entries: LaunchpadEntryRecord[]): number {
  const bundles = test.bundles_config ?? [];
  let revenue = 0;
  let spend = 0;
  let orders = 0;
  let bundleUnits = 0;
  let bundleCogs = 0;

  for (const e of entries) {
    revenue += e.revenue ?? 0;
    spend += e.meta_spend ?? 0;
    orders += e.orders ?? 0;
    for (const b of e.bundle_breakdown ?? []) {
      const n = b.count ?? 0;
      if (n <= 0) continue;
      bundleUnits += n;
      // A 2x line is a 2-pack with its own COGS, not two singles.
      const def = bundles.find((x) => x.id === b.bundle_id);
      if (def) bundleCogs += n * def.cogs;
    }
  }

  // Bundle mix is the accurate basis; per-unit × orders is the flat estimate.
  const cogs = bundleUnits > 0 ? bundleCogs : (test.cogs_per_unit ?? 0) * orders;
  return revenue - cogs - spend;
}

/** Sydney wall clock via Intl — never a fixed offset, which is wrong half the year. */
function sydneyStamp(at: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

function useBusinessProfit(): ProfitRead {
  const [read, setRead] = useState<ProfitRead>(EMPTY_PROFIT);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const testsRes = await fetch(`${LAUNCHPAD_API}/tests`, {
          headers: { Accept: "application/json" },
        });
        if (!testsRes.ok) throw new Error(`HTTP ${testsRes.status}`);
        const tests = (await testsRes.json()) as LaunchpadTestRecord[];
        if (!Array.isArray(tests)) throw new Error("Unexpected tests payload");

        const trading = tests.filter((t) => TRADING_STATUSES.has(t.status));

        // /entries requires test_id — omitting it is a 400 upstream, not an
        // empty list. One request per trading test, in parallel.
        const loaded = await Promise.all(
          trading.map(async (t) => {
            const res = await fetch(
              `${LAUNCHPAD_API}/entries?test_id=${encodeURIComponent(t.id)}`,
              { headers: { Accept: "application/json" } },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const entries = (await res.json()) as LaunchpadEntryRecord[];
            return { test: t, entries: Array.isArray(entries) ? entries : [] };
          }),
        );

        // A test that exists but has never been fed is a created-empty shell,
        // not a running test. One real entry row is the bar.
        const testRunning = loaded.some(
          (x) => RUNNING_STATUSES.has(x.test.status) && x.entries.length > 0,
        );
        const cumulative = loaded.reduce((s, x) => s + testContribution(x.test, x.entries), 0);

        if (!cancelled) {
          setRead({
            cumulative: Math.round(cumulative * 100) / 100,
            testRunning,
            readAt: sydneyStamp(new Date()),
            error: null,
          });
        }
      } catch (e) {
        // No invented fallback: an unknown pot stays null and renders as "—".
        if (!cancelled) {
          setRead({
            ...EMPTY_PROFIT,
            error: e instanceof Error ? e.message : "Unknown error",
          });
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

  return read;
}

/* ── localStorage as an external store ────────────────────────────────────────
   Read through useSyncExternalStore rather than an effect: it gives a stable
   server snapshot (so hydration cannot mismatch), needs no "hydrated" flag, and
   picks up edits made in another tab for free.
   ──────────────────────────────────────────────────────────────────────────── */

/** Referentially stable snapshot — useSyncExternalStore requires that. */
let goalsCache: GoalsState | null = null;
const goalsListeners = new Set<() => void>();

function readGoals(): GoalsState {
  if (goalsCache) return goalsCache;
  try {
    const raw = window.localStorage.getItem(GOALS_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isGoalsState(parsed)) {
        goalsCache = normaliseGoals(parsed);
        return goalsCache;
      }
    }
  } catch {
    /* unreadable or blocked storage — fall through to the empty state */
  }
  goalsCache = EMPTY_GOALS;
  return goalsCache;
}

/** The server has no storage, so it always renders the unset state. */
const readGoalsServer = (): GoalsState => EMPTY_GOALS;

function writeGoals(next: GoalsState): void {
  goalsCache = next;
  try {
    window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — values hold for this session only */
  }
  goalsListeners.forEach((l) => l());
}

function subscribeGoals(onChange: () => void): () => void {
  goalsListeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === GOALS_STORAGE_KEY) {
      goalsCache = null; // force a re-read of what the other tab wrote
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    goalsListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const numberInput: CSSProperties = {
  width: 82,
  background: "var(--bg-inner)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: 11,
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
  padding: "3px 6px",
  flexShrink: 0,
};

/** One label + number input row, shown only while editing. */
function EditRow({
  label,
  value,
  onChange,
  prefix,
  whole,
}: {
  label: string;
  value: number | null;
  onChange: (raw: string) => void;
  prefix?: string;
  whole?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "space-between",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10.5,
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
      <span style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
        {prefix && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min={whole ? 1 : 0}
          step={whole ? 1 : 50}
          value={value === null ? "" : value}
          placeholder="—"
          onChange={(e) => onChange(e.target.value)}
          style={numberInput}
        />
      </span>
    </label>
  );
}

function FamilyGoalsPanel() {
  const state = useSyncExternalStore(subscribeGoals, readGoals, readGoalsServer);
  const [editing, setEditing] = useState(false);
  const profit = useBusinessProfit();

  /** Every edit writes straight through to storage — nothing to flush later. */
  const update = (fn: (s: GoalsState) => GoalsState) => writeGoals(fn(readGoals()));

  const toNum = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };

  const setTarget = (key: TargetKey, raw: string) =>
    update((s) => ({ ...s, targets: { ...s.targets, [key]: toNum(raw) } }));

  const setPeople = (raw: string) =>
    update((s) => ({ ...s, people: Math.max(0, Math.floor(toNum(raw) ?? 0)) }));

  const setSplit = (raw: string) =>
    update((s) => ({ ...s, rewardSplitPct: clampPct(toNum(raw) ?? DEFAULT_REWARD_SPLIT_PCT) }));

  /**
   * The reward pot. A loss is not negative reward money — it is no reward
   * money — so the pot floors at zero rather than running the waterfall
   * backwards. Null (loading/failed) stays null and is rendered as "—".
   */
  const pot =
    profit.cumulative === null
      ? null
      : (Math.max(0, profit.cumulative) * state.rewardSplitPct) / 100;

  const { rows, overallPct } = allocate(state, pot, profit.testRunning);
  const spreeTarget = targetOf(state, "spree");
  const anyTargetSet = rows.some((r) => r.target !== null);

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">Family Goals</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span className={`badge ${overallPct === null ? "badge-amber" : "badge-cyan"}`}>
            {/* Two different reasons for "no number", named separately — the
                badge previously said "No targets" for both. */}
            {overallPct !== null
              ? `${Math.round(Math.min(overallPct, 999))}%`
              : anyTargetSet
                ? "No data"
                : "No targets"}
          </span>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            title={editing ? "Hide the amounts" : "Edit targets and saved amount"}
            style={{
              appearance: "none",
              border: "1px solid var(--border)",
              background: editing ? "rgba(0,212,255,0.12)" : "transparent",
              color: editing ? "var(--cyan)" : "var(--text-muted)",
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "3px 7px",
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1.2,
            }}
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {/* Hero — the one number that answers "how close are we". Sits in its own
            recessed block so it reads as a summary, not another goal row. */}
        <div
          style={{
            flexShrink: 0,
            background: "var(--bg-inner)",
            borderRadius: 6,
            padding: "8px 10px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              How close are we
            </span>
            <span
              style={{
                fontSize: 24,
                fontWeight: 800,
                lineHeight: 1,
                color: overallPct === null ? "var(--text-muted)" : "var(--cyan)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {overallPct === null ? "—" : `${Math.round(overallPct)}%`}
            </span>
          </div>
          <div className="progress-track thick">
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(100, overallPct ?? 0)}%`,
                background: "var(--cyan)",
              }}
            />
          </div>
        </div>

        {/* One honest line about the funding source. Percentages and states,
            never a dollar figure — the amounts stay behind Edit. */}
        <div
          style={{
            fontSize: 10,
            color: profit.error ? "var(--amber)" : "var(--text-muted)",
            flexShrink: 0,
            lineHeight: 1.4,
          }}
        >
          {profit.error
            ? `Profit read failed — ${profit.error}. Funded % unknown.`
            : profit.cumulative === null
              ? "Reading business profit…"
              : !anyTargetSet
                ? "Auto-funded from business profit — open Edit to set targets."
                : `Auto-funded from business profit · ${state.rewardSplitPct}% split${
                    profit.readAt ? ` · read ${profit.readAt} Sydney` : ""
                  }`}
        </div>

        {/* The five goals, in funding order. Bars and percentages only — the
            amounts stay behind Edit. Hidden while editing so the form always
            fits the card instead of forcing a scroll. */}
        {!editing &&
          rows.map((row, i) => {
            const meta = STATE_META[row.state];
            return (
              <div
                key={row.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: 5,
                  // Shrinking The Clock to its content handed this card the
                  // slack. The rows share it equally so the card is exactly
                  // filled at any viewport height — no dead gap at the bottom,
                  // and no scroll. Content is centred, so a taller row reads as
                  // breathing room rather than a top-aligned row with a hole
                  // under it. minHeight is the floor on short screens.
                  flex: "1 1 0",
                  minHeight: 38,
                  background: "var(--bg-inner)",
                  borderRadius: 6,
                  padding: "6px 9px",
                }}
              >
                {/* Fixed columns so the percentage and state align down the
                    list — a flex row let variable badge widths ragged them. */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "10px minmax(0, 1fr) 34px 72px",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {row.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      color:
                        row.target === null && row.note === undefined
                          ? "var(--text-muted)"
                          : "var(--text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                      textAlign: "right",
                    }}
                  >
                    {/* Behaviour-linked rows (note set) carry a real 0/100 —
                        only a money goal with no target renders as unknown. */}
                    {row.target === null && row.note === undefined
                      ? "—"
                      : `${Math.round(row.pct)}%`}
                  </span>
                  <span
                    className={meta.cls}
                    style={{
                      ...(meta.tone ? { color: meta.tone } : {}),
                      justifySelf: "end",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, row.pct)}%`, background: meta.bar }}
                  />
                </div>
                {/* Behaviour-linked rows say what earns them. Money rows have
                    nothing to add here — their bar is the whole story. */}
                {row.note && (
                  <div
                    style={{
                      fontSize: 9,
                      lineHeight: 1.2,
                      color: row.state === "earned" ? "var(--green)" : "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.note}
                  </div>
                )}
              </div>
            );
          })}

        {/* The only place amounts appear. Collapsed by default so the panel
            itself stays currency-free. */}
        {editing && (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 5,
              marginTop: 1,
              display: "flex",
              flexDirection: "column",
              gap: 3,
              flexShrink: 0,
            }}
          >
            {/* No "saved so far" input: the pot is business profit, not a
                number anyone types. Targets and the split are the only knobs. */}
            <EditRow
              label="1 · Docklands move"
              value={state.targets.docklands}
              onChange={(r) => setTarget("docklands", r)}
              prefix="$"
            />
            <EditRow
              label="2 · Sydney or QLD trip"
              value={state.targets.trip}
              onChange={(r) => setTarget("trip", r)}
              prefix="$"
            />
            <EditRow
              label="3 · Crown weekend"
              value={state.targets.crown}
              onChange={(r) => setTarget("crown", r)}
              prefix="$"
            />
            <EditRow
              label="5 · Shopping spree — people"
              value={state.people}
              onChange={setPeople}
              whole
            />
            <EditRow
              label="Reward split of profit (%)"
              value={state.rewardSplitPct}
              onChange={setSplit}
              whole
            />
            {/* Two lines, so opening Edit does not push the form into a scroll. */}
            <div
              style={{
                fontSize: 9,
                color: "var(--text-muted)",
                lineHeight: 1.3,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Spree = ${SPREE_PER_PERSON} × {Math.max(0, Math.floor(state.people))} ={" "}
              {spreeTarget === null ? "—" : `$${spreeTarget.toLocaleString("en-AU")}`} · pot fills
              top-down
              <br />
              Profit{" "}
              {profit.cumulative === null
                ? "—"
                : // Sign outside the symbol — "$-93.84" reads as a typo.
                  `${profit.cumulative < 0 ? "−" : ""}$${Math.abs(
                    profit.cumulative,
                  ).toLocaleString("en-AU")}`} · pot{" "}
              {pot === null ? "—" : `$${Math.round(pot).toLocaleString("en-AU")}`} · 4 · Night out is
              earned by running test #1
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Panel 2 — THE CLOCK (untouched) ──────────────────────────────────────── */

function ClockPanel({ data, settings }: { data: ActionsPayload; settings?: SettingsMap }) {
  const c = data.clock;
  const gapAmber = getSetting(settings, "TEST_GAP_AMBER_DAYS", SETTING_DEFAULTS.TEST_GAP_AMBER_DAYS);
  const gapRed = getSetting(settings, "TEST_GAP_RED_DAYS", SETTING_DEFAULTS.TEST_GAP_RED_DAYS);

  const gap = c.tests.daysSinceLastCompleted;
  const gapTone =
    gap > gapRed ? "var(--red)" : gap > gapAmber ? "var(--amber)" : "var(--text-secondary)";

  return (
    // flex "0 0 auto" so the card is only as tall as its content. `.card` is
    // flex:1 by default, which stretched this panel to half the column and left
    // a large gap under the stats. The slack now goes to Family Goals above,
    // which has rows to breathe with. Padding is untouched, so the @media height
    // tiers still apply.
    <div className="card" style={{ flex: "0 0 auto" }}>
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">The Clock</div>
        <span className="badge badge-cyan">{c.yearElapsedPct.toFixed(1)}% of year</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          minHeight: 0,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <ClockStat value={String(c.daysLeftInWeek)} label="Days left · week" />
          <ClockStat value={String(c.daysLeftInMonth)} label="Days left · month" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <ClockStat
            value={String(c.daysToTractionEnd)}
            label="Days to traction end"
            tone="var(--cyan)"
          />
          <ClockStat
            value={`${c.yearElapsedPct.toFixed(0)}%`}
            label="Year elapsed"
            tone="var(--amber)"
          />
        </div>

        {/* Product tests — counts, live from the Launchpad API. `marginTop:auto`
            used to shove this to the card's bottom edge; that was the dead gap. */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 5 }}>
          <div
            style={{
              fontSize: 9,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 2,
            }}
          >
            Product tests
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                lineHeight: 1.2,
                color: c.tests.completed >= c.tests.target ? "var(--green)" : "var(--text-primary)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {c.tests.completed} of {c.tests.target}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>complete</span>
          </div>
          <div style={{ fontSize: 10, color: gapTone, fontWeight: 600, lineHeight: 1.3 }}>
            {gap} days since {c.tests.everCompleted ? "last completed test" : "Launchpad go-live"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Column ───────────────────────────────────────────────────────────────── */

/** Delegates to the shared guards so the contract is testable in isolation. */
function isRenderable(p: unknown): p is ActionsPayload {
  return isActionsPayload(p);
}

export default function PanelTodos() {
  const [data, setData] = useState<ActionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/actions");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.error) throw new Error(String(payload.error));
        if (!isRenderable(payload)) throw new Error("Unexpected payload shape");
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (e) {
        // No invented fallback numbers — the panels say what failed.
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

  // Family Goals has no API dependency, so it renders for real even when
  // /api/actions is down — only THE CLOCK degrades to a shell. The column keeps
  // two cards in every state, so it never reflows when data arrives.
  if (error) {
    return (
      <>
        <FamilyGoalsPanel />
        <ShellCard
          title="The Clock"
          badge="⚠ Error"
          badgeClass="badge-red"
          message={`Action data unavailable — ${error}`}
        />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <FamilyGoalsPanel />
        <ShellCard title="The Clock" badge="Loading…" badgeClass="badge-cyan" message="…" />
      </>
    );
  }

  const settings = data.settings;

  return (
    <>
      <FamilyGoalsPanel />
      <ClockPanel data={data} settings={settings} />
    </>
  );
}
