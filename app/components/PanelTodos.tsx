"use client";

import { useEffect, useState } from "react";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";
import { isActionsPayload } from "../lib/payload-guards";
import {
  LAUNCHPAD_API,
  type LaunchpadEntryRecord,
  type LaunchpadTestRecord,
} from "../lib/launchpad";

/* ════════════════════════════════════════════════════════════════════════════
   Column C — THE CLOCK, plus the family-goals STORE.

   The Family Goals PANEL is gone (RESTRUCTURE-SPEC §5): reward goals render on
   /money now, and Column C's content on the TV is carried by the Table chip /
   hero / Family lane. What survives here is:

   - The goals STORE — localStorage `familyGoals.v1` via readGoals / writeGoals /
     subscribeGoals, the allocate() waterfall, and useBusinessProfit (the
     Launchpad-funded pot). /money imports all of it; the storage key and
     behaviour are unchanged.
   - ClockPanel — the Clock sub-panel, exactly as it was. It reads
     GET /api/actions; the same `data.clock` payload feeds the face's traction
     bar, the Family lane's Traction row (via useFaceData) and /table's clock
     tile. The route itself is untouched.
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

/* ── The family-goals STORE (no panel — /money renders the UI) ────────────────
   Five goals, funded two different ways.

   FOUR are auto-funded from money the business actually made: the reward pot
   is a split of cumulative contribution profit read live from Launchpad (see
   useBusinessProfit below), poured top-down through the targets. ONE — Night
   out — is behaviour-linked: earned by running product test #1, no dollar
   target, no share of the pot.

   Targets stay browser-local (localStorage `familyGoals.v1`) — there is no
   goals API, so targets do not sync between devices. The funding side does: it
   is derived from the same Launchpad data every screen reads. /money's Rewards
   tile is the only consumer of this store.
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

export interface GoalRow {
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
 * `genuineTest`, which is null until the Launchpad read resolves.
 */
export function allocate(
  state: GoalsState,
  pot: number | null,
  genuineTest: boolean | null,
): {
  rows: GoalRow[];
  totalTarget: number;
  overallPct: number | null;
} {
  let remaining = Math.max(0, pot ?? 0);
  let nextClaimed = false;

  const rows: GoalRow[] = GOAL_DEFS.map((def) => {
    if (def.key === "nightOut") {
      if (genuineTest === null) {
        return {
          key: def.key,
          label: def.label,
          target: null,
          pct: 0,
          state: "locked",
          note: "Checking Launchpad…",
        };
      }
      return genuineTest
        ? {
            key: def.key,
            label: def.label,
            target: null,
            pct: 100,
            state: "earned",
            note: "Test #1 counts — earned",
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

/**
 * How long a Live/Iterating test may go unfed before it stops counting as a
 * test anyone is actually running. Not a fresh magic number: TEST_STALE_RED_DAYS
 * is the repo's existing "this test is dead" threshold, already used by
 * /api/ecom to decide whether a stale test still proves activity.
 */
const GENUINE_TEST_MAX_STALE_DAYS = SETTING_DEFAULTS.TEST_STALE_RED_DAYS;

interface ProfitRead {
  /** Cumulative contribution profit; null while loading or after a failure. */
  cumulative: number | null;
  /**
   * True once a GENUINE test exists — see isGenuineTest. Null while loading.
   * Named for the question it answers: not "is something Live" (an abandoned
   * test stays Live forever) but "has a test actually been run".
   */
  genuineTest: boolean | null;
  /** Sydney wall-clock stamp of the successful read. */
  readAt: string | null;
  error: string | null;
}

const EMPTY_PROFIT: ProfitRead = {
  cumulative: null,
  genuineTest: null,
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
export function sydneyStamp(at: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/** Today's Sydney civil date as "YYYY-MM-DD". en-CA formats exactly that way. */
function sydneyTodayISO(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Whole days between two civil dates. Both are plain "YYYY-MM-DD" strings, so
 * this is pure calendar arithmetic through Date.UTC — no timezone and no offset
 * constant (which would be wrong for the months Sydney is on AEDT). Same helper
 * shape as inclusiveDays in /api/ecom/product.
 */
function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return null;
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Newest entry_date for a test, or null if it has never been fed. */
function lastEntryDate(entries: LaunchpadEntryRecord[]): string | null {
  let newest: string | null = null;
  for (const e of entries) {
    if (typeof e.entry_date !== "string" || !e.entry_date) continue;
    // Ordering is not guaranteed by the API, so take the max rather than .at(-1).
    if (newest === null || e.entry_date.localeCompare(newest) > 0) newest = e.entry_date;
  }
  return newest;
}

/**
 * Does this test prove a product test was actually run?
 *
 * Both rules first require the test to have been FED at least once — one shared
 * check, not two, so the two paths can never drift apart:
 *
 *   (a) Live/Iterating AND fed within GENUINE_TEST_MAX_STALE_DAYS — running now.
 *   (b) Killed/Scaled — a verdict was reached, so it was run A to Z.
 *
 * A Live test whose newest entry has gone stale is an abandoned test, not a
 * running one: nobody kills a test they walked away from, so status alone
 * would let a dead campaign unlock the reward forever. That was the bug.
 *
 * A verdict on a test with no entry rows is a verdict on nothing — a shell
 * killed at setup was never run, whatever its status says.
 *
 * The fixture exclusion is upstream and untouched — only TRADING_STATUSES tests
 * are ever passed in here, so the Setup-status backtest artifact never reaches
 * this check.
 */
function isGenuineTest(
  test: LaunchpadTestRecord,
  entries: LaunchpadEntryRecord[],
  todayISO: string,
): boolean {
  const last = lastEntryDate(entries);
  if (last === null) return false; // created-empty shell — never fed

  if (COMPLETED_STATUSES.has(test.status)) return true;
  if (!RUNNING_STATUSES.has(test.status)) return false;

  const staleDays = daysBetweenISO(last, todayISO);
  // An unparseable date is not evidence of freshness.
  if (staleDays === null) return false;
  return staleDays <= GENUINE_TEST_MAX_STALE_DAYS;
}

export function useBusinessProfit(): ProfitRead {
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

        // Today resolved once, in Sydney, and shared by every staleness check.
        const todayISO = sydneyTodayISO(new Date());
        const genuineTest = loaded.some((x) => isGenuineTest(x.test, x.entries, todayISO));

        const cumulative = loaded.reduce((s, x) => s + testContribution(x.test, x.entries), 0);

        if (!cancelled) {
          setRead({
            cumulative: Math.round(cumulative * 100) / 100,
            genuineTest,
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

export function readGoals(): GoalsState {
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
export const readGoalsServer = (): GoalsState => EMPTY_GOALS;

export function writeGoals(next: GoalsState): void {
  goalsCache = next;
  try {
    window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — values hold for this session only */
  }
  goalsListeners.forEach((l) => l());
}

export function subscribeGoals(onChange: () => void): () => void {
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
    // a large gap under the stats. Padding is untouched, so the @media height
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

  // The goals panel is gone (spec §5) — this component IS the Clock now. It
  // degrades to a shell when /api/actions fails, exactly as before.
  if (error) {
    return (
      <ShellCard
        title="The Clock"
        badge="⚠ Error"
        badgeClass="badge-red"
        message={`Action data unavailable — ${error}`}
      />
    );
  }

  if (!data) {
    return <ShellCard title="The Clock" badge="Loading…" badgeClass="badge-cyan" message="…" />;
  }

  return <ClockPanel data={data} settings={data.settings} />;
}
