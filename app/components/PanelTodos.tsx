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

export interface GoalRow {
  key: GoalKey;
  label: string;
  target: number | null;
  pct: number;
  state: GoalState;
  /** Set on behaviour-linked rows only — the sentence under the bar. */
  note?: string;
}

/* ── Quest-log presentation ───────────────────────────────────────────────────
   Everything below here is DECORATION. Not one value feeds a calculation: the
   rows still come from allocate(), the percentages are still its percentages,
   and the Night out state is still whatever the gate decided. A tier stamp is
   a sticker on a card, not a fact about the goal.

   The tier hexes are deliberately LOCAL. Gold/silver/bronze are cosmetic
   labels, so promoting them to globals.css would put three decorative colours
   next to --cyan and --green, which are semantic and load-bearing. They stay
   here where their scope is obvious.
   ──────────────────────────────────────────────────────────────────────────── */

const TIER_GOLD = "#d4af37";
const TIER_SILVER = "#c0c0c0";
const TIER_BRONZE = "#cd7f32";

const QUEST_TIER: Record<GoalKey, { label: string; colour: string }> = {
  docklands: { label: "Gold", colour: TIER_GOLD },
  trip: { label: "Gold", colour: TIER_GOLD },
  crown: { label: "Silver", colour: TIER_SILVER },
  nightOut: { label: "Starter", colour: "var(--cyan)" },
  spree: { label: "Bronze", colour: TIER_BRONZE },
};

/**
 * One glyph per quest, drawn inline. No icon package and no emoji: emoji
 * render at the mercy of the platform font and would land differently on the
 * Samsung Flip than on the Mac mini, which is the one thing a wall display
 * cannot afford.
 */
const QUEST_GLYPH: Record<GoalKey, string> = {
  docklands: "M3 11 L12 4 L21 11 M5.5 9.5 V20 H18.5 V9.5",
  trip: "M2 13 L22 4 L14 21 L11.5 14.5 Z",
  crown: "M3 19 L5 7 L9.5 12 L12 5 L14.5 12 L19 7 L21 19 Z",
  nightOut: "M20.5 14.5 A8.5 8.5 0 1 1 9.5 3.5 A6.8 6.8 0 0 0 20.5 14.5 Z",
  spree: "M6 8 H18 L19 20.5 H5 Z M9 8 V6.2 A3 3 0 0 1 15 6.2 V8",
};

function QuestGlyph({ path, colour }: { path: string; colour: string }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colour}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <path d={path} />
    </svg>
  );
}

/** Shown on quests that cannot be worked on yet. */
function LockGlyph({ colour }: { colour: string }) {
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colour}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <path d="M7.5 10.5 V7 A4.5 4.5 0 0 1 16.5 7 V10.5" />
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    </svg>
  );
}

/** The accent a quest card is drawn in. Derived from state, never from tier. */
function questAccent(state: GoalState): string {
  if (state === "earned" || state === "funded") return "var(--green)";
  if (state === "next" || state === "progress") return "var(--cyan)";
  return "var(--text-muted)";
}

/** Quests nobody can act on yet recede, so the active one reads first. */
const isDimmed = (state: GoalState): boolean =>
  state === "locked" || state === "pending" || state === "unset";

/**
 * The quest objective, phrased as an instruction.
 *
 * Behaviour-linked rows are keyed off `row.state` — the same state the row
 * badge and the overlay read, so the objective cannot say "run test #1" while
 * the badge says EARNED. The gate itself is not consulted here; by the time a
 * row exists the gate has already spoken.
 */
function objectiveOf(row: GoalRow): string {
  if (row.key === "nightOut") {
    if (row.state === "earned") return "Objective complete: test #1 run";
    // The in-flight row carries its own copy; anything else is the locked case.
    if (row.note === "Checking Launchpad…") return row.note;
    return "Objective: run test #1";
  }
  if (row.target === null) return "Objective: set a target";
  return "Objective: fund from profit";
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

  const { rows, overallPct } = allocate(state, pot, profit.genuineTest);
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

        {/* The five quests, in funding order. Bars and percentages only — the
            amounts stay behind Edit. Hidden while editing so the form always
            fits the card instead of forcing a scroll.

            The percentage and the status label live on SEPARATE LINES, and that
            is the fix, not a style preference: they used to share one grid whose
            badge track was a fixed 72px. "NOT STARTED" needs 93px, so it
            overflowed 15px left across the 34px percentage cell and the two
            rendered on top of each other as "0%OT STARTED". Nothing here pins a
            text width — the name flexes and truncates, the chips size to their
            own content, and the percentage owns its own row end. */}
        {!editing &&
          rows.map((row) => {
            const meta = STATE_META[row.state];
            const tier = QUEST_TIER[row.key];
            const accent = questAccent(row.state);
            const dimmed = isDimmed(row.state);
            const active = row.state === "next";
            // Behaviour-linked rows carry a real 0/100; only a money goal with
            // no target has no honest percentage to show.
            const showPct = row.target !== null || row.note !== undefined;

            return (
              <div
                key={row.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: 4,
                  // Shrinking The Clock to its content handed this card the
                  // slack. The quests share it equally so the card is exactly
                  // filled at any viewport height — no dead gap at the bottom,
                  // and no scroll. Content is centred, so a taller card reads as
                  // breathing room rather than a top-aligned one with a hole
                  // under it. minHeight is the floor on short screens.
                  flex: "1 1 0",
                  minHeight: 44,
                  background: active
                    ? "color-mix(in srgb, var(--cyan) 8%, var(--bg-inner))"
                    : "var(--bg-inner)",
                  // The active quest is the only card that earns a border.
                  border: `1px solid ${active ? "var(--cyan)" : "transparent"}`,
                  borderLeft: `2px solid ${active ? "var(--cyan)" : accent}`,
                  borderRadius: 6,
                  padding: "5px 8px",
                  opacity: dimmed ? 0.66 : 1,
                  minWidth: 0,
                }}
              >
                {/* Line 1 — glyph, quest name, tier stamp. */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <QuestGlyph path={QUEST_GLYPH[row.key]} colour={accent} />
                  <span
                    style={{
                      fontSize: active ? 12.5 : 11.5,
                      fontWeight: active ? 700 : 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      // minWidth:0 is what lets the NAME give way instead of
                      // shoving a neighbour, which is how the old overlap began.
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {row.label}
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.09em",
                      textTransform: "uppercase",
                      color: tier.colour,
                      border: `1px solid ${tier.colour}`,
                      borderRadius: 3,
                      padding: "1px 4px",
                      lineHeight: 1.35,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tier.label}
                  </span>
                </div>

                {/* Line 2 — objective on the left, percentage on the right.
                    Both flex children: the objective truncates, the percentage
                    never shrinks, so they cannot collide at any width. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  {dimmed && <LockGlyph colour="var(--text-muted)" />}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 9.5,
                      lineHeight: 1.25,
                      color: row.state === "earned" ? "var(--green)" : "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {objectiveOf(row)}
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 700,
                      color: showPct ? accent : "var(--text-muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {showPct ? `${Math.round(row.pct)}%` : "—"}
                  </span>
                </div>

                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, row.pct)}%`, background: meta.bar }}
                  />
                </div>

                {/* Line 3 — the status word, on its own line and nowhere near
                    the percentage. */}
                <div style={{ display: "flex", minWidth: 0 }}>
                  <span
                    className={meta.cls}
                    style={{
                      ...(meta.tone ? { color: meta.tone } : {}),
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
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
