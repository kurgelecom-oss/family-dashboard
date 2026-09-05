import { NextResponse } from "next/server";
import { zoneToday, saturdayOfWeek, isoDate } from "../../lib/time";
import { serviceClient } from "../../lib/supabase-server";
import { spendTier } from "../../components/spend-tier";

/* ────────────────────────────────────────────────────────────────────────────
   /api/weekly-review — GET and POST. Four fixed weekly review items, reviewed
   once each per Sydney review week.

   The week runs SATURDAY → FRIDAY and week_key is the DATE of that Saturday
   (`2026-08-15`), not an ISO week number. The family meeting is Saturday
   morning, so the week has to turn over as the meeting starts; an ISO
   Monday-anchored week rolled over on Sunday night and put Saturday's meeting
   at the END of the week it was reviewing.

   Backed by public.weekly_reviews, PK (week_key, item_key). There is no reset
   job and there is no cron, by design: a new week produces a new week_key, that
   key matches no rows, and all four items reappear unticked on their own.

   `ticked` is DERIVED from ticked_at being non-null — it is not a column. That
   is what makes untick lossless: unticking nulls the timestamp and keeps the
   row, so the decision, the snapshot and the Notion page id all survive being
   unticked and re-ticked. Deleting the row on untick would throw all three
   away and orphan a Notion page nothing could ever update again.

   The table has RLS on with no policies, so it is unreachable under the anon
   key. Every read and write here goes through the service role client in
   app/lib/supabase-server.ts, which is server-only and never reaches the
   browser. The client sends a week key and an item key and gets back the set;
   it never holds a Supabase credential of any kind.

   Date logic goes through app/lib/time.ts — Intl-based, Australia/Sydney, and
   therefore correct across the AEST/AEDT boundary. No hardcoded offset appears
   in this file.
   ──────────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";

// A tick is state that changes the moment someone taps it. Caching this at the
// browser or the CDN would show one person's screen a box the other already
// ticked, which is the exact per-device drift the mission board was rebuilt to
// remove.
const NO_STORE = "no-store";

const TABLE = "weekly_reviews";

/**
 * The four items, in display order. This array is the whole allowlist — an
 * item_key that is not in it is rejected rather than stored, so a typo in a
 * client cannot quietly create a fifth item that then renders as a mystery row
 * nobody can untick.
 */
const ITEM_KEYS = [
  "finances",
  "homeschool",
  "ecom_product_logs",
  "origins_sessions",
] as const;

type ItemKey = (typeof ITEM_KEYS)[number];

/**
 * Display labels, exact. These are the `Item` select options in the Notion
 * Weekly Review Log — Notion creates a NEW option for any label that does not
 * match one it already has, so a casing slip here silently forks the select
 * into "Ecom Product Logs" and "Ecom product logs" and the two never group.
 */
const ITEM_LABELS: Record<ItemKey, string> = {
  finances: "Finances",
  homeschool: "Homeschool",
  ecom_product_logs: "Ecom Product Logs",
  origins_sessions: "Origins Sessions",
};

function isItemKey(value: unknown): value is ItemKey {
  return typeof value === "string" && (ITEM_KEYS as readonly string[]).includes(value);
}

/** The Sydney review week's Saturday, as `YYYY-MM-DD`. */
function currentWeekKey(): string {
  return isoDate(saturdayOfWeek(zoneToday(new Date())));
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

export interface ReviewItem {
  key: ItemKey;
  ticked: boolean;
  /** ISO-8601 instant, or null when the item is not ticked. */
  tickedAt: string | null;
  tickedBy: string | null;
  /** Numbers as they stood at tick time, or null when never ticked. */
  snapshot: Record<string, unknown> | null;
  decision: string | null;
}

export interface HistoryWeek {
  weekKey: string;
  items: Array<{
    key: ItemKey;
    ticked: boolean;
    tickedAt: string | null;
    decision: string | null;
  }>;
}

/**
 * How long since a product test was actually FINISHED, and how many have been.
 *
 * `testsRun` counts completed tests and nothing else. It is deliberately not
 * backfilled from validations or product logs — those are different activities
 * and a week can be full of them while no test ran at all. Zero is a real
 * answer here and the honest one.
 */
export interface LastTest {
  /** Days since the last completed test, or since go-live when none ever was. */
  daysSince: number;
  /** Completed tests to date. Zero is a valid, meaningful answer. */
  testsRun: number;
  /** false → `daysSince` counts from Launchpad go-live, not from a test. */
  everCompleted: boolean;
  /** The `YYYY-MM-DD` the count runs from — a test date, or go-live. */
  since: string;
}

/**
 * What the Notion mirror did on THIS request.
 *
 * It exists because the mirror is deliberately unable to fail a tick, and an
 * unfailable thing that only logs is a thing that dies quietly — the way this
 * one did, mirroring nothing for days behind a stale page id while every write
 * returned 200. The tick still succeeds; the response now says whether the copy
 * of it reached Notion, so a dead mirror is visible on the very next write
 * instead of being discovered weeks later by noticing the log is empty.
 */
export interface MirrorStatus {
  /** false = the mirror did not complete. The tick still succeeded. */
  ok: boolean;
  /** Short, stable reason when `ok` is false; null when it worked. */
  reason: string | null;
  /** The page written, when there was one. */
  pageId?: string;
  /**
   * Extra pages found for this week+item beyond the one updated. Reported even
   * on success — the mirror completing does not make duplicate pages fine, and
   * nothing else in the system would ever mention them.
   */
  duplicates?: string[];
}

export interface WeeklyReviewPayload {
  weekKey: string;
  items: ReviewItem[];
  /** The ticked keys alone, for a caller that only needs the set. */
  ticked: ItemKey[];
  /** The week's one sentence, or null when unset. */
  focus: string | null;
  /** Null when /api/actions could not be read — never a fabricated zero. */
  lastTest: LastTest | null;
  /** Mirror result for this request; null when no mirror ran (every GET). */
  mirror: MirrorStatus | null;
  /** Present only when `weeks` > 1. Past weeks, newest first. */
  history?: HistoryWeek[];
}

type Row = {
  week_key: string;
  item_key: string;
  ticked_at: string | null;
  ticked_by: string | null;
  snapshot: Record<string, unknown> | null;
  decision: string | null;
  notion_page_id: string | null;
};

const ROW_COLUMNS = "week_key,item_key,ticked_at,ticked_by,snapshot,decision,notion_page_id";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": NO_STORE },
  });
}

/* ── reads ───────────────────────────────────────────────────────────────── */

/**
 * The four items for `weekKey`, state filled in from whatever rows exist.
 *
 * Always returns four items in ITEM_KEYS order regardless of what the table
 * holds. Two consequences, both wanted: a week with no rows renders as four
 * unticked boxes rather than an empty list, and a stray row whose item_key is
 * no longer one of the four is ignored on read instead of surfacing as an item
 * the UI has no name for.
 */
/**
 * The part of the payload that comes from weekly_reviews alone. Split out so
 * readWeek is not forced to know about the focus table or /api/actions — the
 * two additions are assembled around it in buildPayload, not inside it.
 */
type WeekCore = Pick<WeeklyReviewPayload, "weekKey" | "items" | "ticked">;

async function readWeek(weekKey: string): Promise<WeekCore> {
  const supabase = serviceClient();
  const { data, error } = await supabase.from(TABLE).select(ROW_COLUMNS).eq("week_key", weekKey);

  if (error) throw new Error(error.message);

  const byKey = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) byKey.set(row.item_key, row);

  const items: ReviewItem[] = ITEM_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      // Derived, never stored. A row that exists with a null ticked_at is an
      // UNTICKED item that is keeping its decision and snapshot — reading
      // presence-of-row as "ticked" would resurrect every unticked item.
      ticked: row?.ticked_at != null,
      tickedAt: row?.ticked_at ?? null,
      tickedBy: row?.ticked_by ?? null,
      snapshot: row?.snapshot ?? null,
      decision: row?.decision ?? null,
    };
  });

  return {
    weekKey,
    items,
    ticked: items.filter((i) => i.ticked).map((i) => i.key),
  };
}

/** Hard ceiling on `weeks`, current week included. */
const MAX_WEEKS = 26;

function parseWeeks(raw: string | null): number {
  if (raw === null) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_WEEKS, Math.max(1, Math.floor(n)));
}

/**
 * Past weeks, newest first, at most `count` of them.
 *
 * week_key is a `YYYY-MM-DD` date string, so a plain string comparison IS a
 * chronological one — zero-padded ISO dates sort lexicographically in date
 * order, which is why the key was chosen in that shape.
 */
async function readHistory(currentKey: string, count: number): Promise<HistoryWeek[]> {
  if (count <= 0) return [];

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select(ROW_COLUMNS)
    .lt("week_key", currentKey)
    .order("week_key", { ascending: false })
    // One spare week of rows so the oldest group in the window is whole rather
    // than truncated mid-week by the row limit.
    .limit((MAX_WEEKS + 1) * ITEM_KEYS.length);

  if (error) throw new Error(error.message);

  const byWeek = new Map<string, Map<string, Row>>();
  for (const row of (data ?? []) as Row[]) {
    let week = byWeek.get(row.week_key);
    if (!week) {
      week = new Map<string, Row>();
      byWeek.set(row.week_key, week);
    }
    week.set(row.item_key, row);
  }

  return [...byWeek.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, count)
    .map((weekKey) => {
      const week = byWeek.get(weekKey)!;
      return {
        weekKey,
        items: ITEM_KEYS.map((key) => {
          const row = week.get(key);
          return {
            key,
            ticked: row?.ticked_at != null,
            tickedAt: row?.ticked_at ?? null,
            decision: row?.decision ?? null,
          };
        }),
      };
    });
}

/* ── snapshot ────────────────────────────────────────────────────────────── */

/**
 * How long either internal read gets before the tick gives up on it. Short on
 * purpose: a snapshot is a nice-to-have record and the tick is the thing the
 * person is standing there waiting for.
 */
const SNAPSHOT_TIMEOUT_MS = 4000;

async function readJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ── days since the last real test ───────────────────────────────────────── */

/**
 * The "N days since …" figure, READ from /api/actions rather than recomputed.
 *
 * That route already owns this calculation — app/api/actions/route.ts builds
 * clock.tests from LAUNCHPAD_GO_LIVE_DATE and the completed-test dates, and
 * PanelTodos renders it on the dashboard as "N days since last completed test"
 * / "… since Launchpad go-live". Recomputing it here would put a second answer
 * to the same question in the codebase, and the two would drift the first time
 * the go-live setting or the completed-status list changed. Reading the route
 * means the wall display and this endpoint cannot disagree, by construction.
 *
 * Null on any failure. A missing figure is honest; a zero would be a lie that
 * reads as "a test finished today".
 */
async function readLastTest(origin: string): Promise<LastTest | null> {
  const actions = await readJson(`${origin}/api/actions`);
  const clock = actions?.clock as Record<string, unknown> | undefined;
  const tests = clock?.tests as Record<string, unknown> | undefined;
  if (!tests) return null;

  const daysSince = tests.daysSinceLastCompleted;
  const testsRun = tests.completed;
  if (typeof daysSince !== "number" || typeof testsRun !== "number") return null;

  return {
    daysSince,
    testsRun,
    everCompleted: tests.everCompleted === true,
    since: typeof tests.gapFromDate === "string" ? tests.gapFromDate : "",
  };
}

/* ── the one thing ───────────────────────────────────────────────────────── */

const FOCUS_TABLE = "week_focus";

/** Cap on a sentence that has to stay readable on a wall from across a room. */
const FOCUS_MAX = 280;

/**
 * True when the failure is "that table does not exist yet".
 *
 * public.week_focus is created by hand in the SQL editor, so between this code
 * deploying and that statement being run the table is genuinely absent. Naming
 * that case lets the route say so instead of returning an opaque 500 that looks
 * like a bug in the handler.
 */
function isMissingFocusTable(message: string): boolean {
  // Two different components report this, in two different wordings. Postgres
  // itself raises 42P01 "relation ... does not exist"; PostgREST, which is what
  // supabase-js actually talks to, answers PGRST205 "Could not find the table
  // ... in the schema cache" before the query ever reaches Postgres. Matching
  // only the Postgres form let the real-world case through as an opaque 500.
  return (
    /relation .*week_focus.* does not exist/i.test(message) ||
    /could not find the table .*week_focus/i.test(message) ||
    message.includes("42P01") ||
    message.includes("PGRST205")
  );
}

/**
 * The week's sentence, or null.
 *
 * Degrades to null rather than throwing: the focus is one field on a payload
 * whose main job is the four items, and a missing table must not take the whole
 * GET — and with it the mission site's tick bar — down with it.
 */
async function readFocus(weekKey: string): Promise<string | null> {
  try {
    const supabase = serviceClient();
    const { data, error } = await supabase
      .from(FOCUS_TABLE)
      .select("focus")
      .eq("week_key", weekKey)
      .maybeSingle();

    if (error) {
      console.error("[weekly-review] focus read failed:", error.message);
      return null;
    }
    return (data as { focus: string | null } | null)?.focus ?? null;
  } catch (e) {
    console.error("[weekly-review] focus read error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * The numbers as they stand, read from this deployment's OWN routes.
 *
 * Server-side and never from the request body: a snapshot exists to be the
 * record nobody can argue with, and a client-supplied figure is exactly the
 * thing that record has to be immune to.
 *
 * Every field degrades to null independently and nothing here throws. A tick
 * whose snapshot could not be read is still a tick — the timestamp is the fact
 * that matters and the numbers are the commentary.
 */
/**
 * The finance block for a FINANCES tick.
 *
 * Everything here is read off the /api/pocketsmith payload rather than worked
 * out again: that route already owns the control-class split, the runway and
 * the two week windows they are measured over, and a second implementation of
 * any of them here would be a second answer to the same question — the exact
 * mistake readLastTest exists to avoid.
 *
 * Null in, null out. A snapshot that could not read the numbers says so; it
 * does not record zeroes, which would read as a week that spent nothing.
 */
function financeBlock(pocketsmith: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!pocketsmith) return null;

  const lastWeek = (pocketsmith.lastWeek as Record<string, unknown> | undefined) ?? undefined;
  const rawSpend = lastWeek?.totalSpending;
  const lastWeekTotalSpend =
    typeof rawSpend === "number" && Number.isFinite(rawSpend) ? rawSpend : null;

  const control = (pocketsmith.controlSpend as Record<string, unknown> | undefined) ?? undefined;

  return {
    lastWeekTotalSpend,
    // Same function the hero figure on the dashboard wears, so the recorded
    // tier can never disagree with the tier that was on the screen.
    lastWeekTier: lastWeekTotalSpend === null ? null : spendTier(lastWeekTotalSpend),
    // Passed through verbatim, both windows, so the snapshot holds the split as
    // the route computed it rather than a reduction of it.
    controlSpend: {
      lastWeek: (control?.lastWeek as Record<string, unknown> | undefined) ?? null,
      previousWeek: (control?.previousWeek as Record<string, unknown> | undefined) ?? null,
    },
    runway: (pocketsmith.runway as Record<string, unknown> | undefined) ?? null,
  };
}

async function captureSnapshot(
  origin: string,
  weekKey: string,
  itemKey: ItemKey,
): Promise<Record<string, unknown>> {
  const [mission, pocketsmith, homeschool, ecom, origins] = await Promise.all([
    readJson(`${origin}/api/mission`),
    readJson(`${origin}/api/pocketsmith`),
    // Only the homeschool tick pays for this read. The week is named
    // explicitly rather than left to the route's default, so a tick landing
    // either side of the Saturday turnover still records the week it belongs
    // to instead of whichever one the server happens to think is current.
    itemKey === "homeschool"
      ? readJson(`${origin}/api/homeschool?week_key=${encodeURIComponent(weekKey)}`)
      : Promise.resolve(null),
    // Likewise scoped to its own item. Note this route reads a DIFFERENT window
    // out of the same week_key — Sunday to Saturday inclusive, where homeschool
    // reads the Mon–Fri before it. Each route owns its own definition and
    // nothing here reconciles them, because they are not meant to agree.
    itemKey === "ecom_product_logs"
      ? readJson(`${origin}/api/ecom-products?week_key=${encodeURIComponent(weekKey)}`)
      : Promise.resolve(null),
    // Same Sunday–Saturday window as ecom. Note this reads /api/origins-review,
    // NOT /api/origins — the latter serves OriginsStrip off an ISO Monday week
    // with no week_key and cannot answer for a named review week.
    itemKey === "origins_sessions"
      ? readJson(`${origin}/api/origins-review?week_key=${encodeURIComponent(weekKey)}`)
      : Promise.resolve(null),
  ]);

  const weekly = (mission?.weekly as Record<string, unknown> | undefined) ?? null;

  // FINANCES gets the full block: the control-class split and the runway are
  // what that review is actually about. Ecom and origins keep the exact
  // two-field shape they have always recorded — every branch here is scoped to
  // one item and must not rewrite what the others mean.
  if (itemKey === "finances") {
    return {
      capturedAt: new Date().toISOString(),
      weekKey,
      weekly,
      finance: financeBlock(pocketsmith),
    };
  }

  const lastWeek = (pocketsmith?.lastWeek as Record<string, unknown> | undefined) ?? undefined;
  const rawSpend = lastWeek?.totalSpending;
  const lastWeekTotalSpend =
    typeof rawSpend === "number" && Number.isFinite(rawSpend) ? rawSpend : null;

  // The two-field finance record every non-finances item has always carried.
  // Ecom and origins get exactly this and nothing else; homeschool gets it plus
  // its own block, so nothing that was being recorded stops being recorded.
  const legacyFinance = {
    lastWeekTotalSpend,
    // Same function the hero figure on the dashboard wears, so the recorded
    // tier can never disagree with the tier that was on the screen.
    lastWeekTier: lastWeekTotalSpend === null ? null : spendTier(lastWeekTotalSpend),
  };

  if (itemKey === "homeschool") {
    return {
      capturedAt: new Date().toISOString(),
      weekKey,
      weekly,
      finance: legacyFinance,
      // Passed through verbatim, or null. /api/homeschool already owns the
      // window arithmetic and every count in here; re-deriving any of it would
      // put a second answer to the same question in the codebase.
      //
      // Null on any failure — a 4s timeout, a Notion outage, a 400, a 500. The
      // tick is what the person is standing there waiting for and it completes
      // regardless; a snapshot missing its numbers is a snapshot, while a tick
      // that would not save because a Notion database was slow is a broken app.
      homeschool,
    };
  }

  if (itemKey === "ecom_product_logs") {
    return {
      capturedAt: new Date().toISOString(),
      weekKey,
      weekly,
      finance: legacyFinance,
      // Passed through verbatim, or null — so the five-bucket disposition, the
      // stale-date count and the week window arrive exactly as the route
      // computed them, and this block needs no edit when that shape changes.
      // /api/ecom-products owns the mapping and the assertion that the buckets
      // account for every row; re-deriving any of it here would put a second
      // answer to the same question in the codebase.
      //
      // Null on any failure — a 4s timeout, a Notion outage, a 400, a 500, or
      // the route's own disposition assertion tripping. The tick is what the
      // person is standing there waiting for and it completes regardless.
      ecom,
    };
  }

  if (itemKey === "origins_sessions") {
    return {
      capturedAt: new Date().toISOString(),
      weekKey,
      weekly,
      finance: legacyFinance,
      // Passed through verbatim, or null. /api/origins-review owns the window,
      // the Status-over-Done rule and the action-item proof test; re-deriving
      // any of it here would put a second answer to the same question in the
      // codebase — and this one has two columns disagreeing already.
      //
      // Null on any failure — a 4s timeout, a Notion outage, a 400, a 500, or
      // the route's own assertions tripping. The tick completes regardless.
      origins,
    };
  }

  return {
    capturedAt: new Date().toISOString(),
    weekKey,
    weekly,
    finance: legacyFinance,
  };
}

/** The snapshot as one short line of prose, for the Notion Snapshot field. */
function renderSnapshot(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "";

  const weekly = (snapshot.weekly as Record<string, unknown> | null) ?? null;
  const finance = (snapshot.finance as Record<string, unknown> | null) ?? null;

  const num = (v: unknown) => (typeof v === "number" ? String(v) : "—");
  const spend = finance?.lastWeekTotalSpend;
  const tier = finance?.lastWeekTier;

  const money =
    typeof spend === "number"
      ? `$${spend.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "—";

  return [
    `Validations ${num(weekly?.validationsThisWeek)}`,
    `Tests ${num(weekly?.testsLoggedThisWeek)}`,
    `Products ${num(weekly?.productsLoggedThisWeek)}`,
    `Last week spend ${money} (tier ${num(tier)})`,
    `captured ${String(snapshot.capturedAt ?? "—")}`,
  ].join(" · ");
}

/* ── Notion mirror ───────────────────────────────────────────────────────── */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";
const WEEKLY_REVIEW_LOG_DS = "005a35a4-c292-45ee-a563-94646cdd7b75";

/**
 * Shorter than the snapshot timeout, and deliberately so: Notion is a MIRROR.
 * Supabase has already committed by the time this runs, so every millisecond
 * spent here is a millisecond the person waits for a write that is already done.
 */
const NOTION_TIMEOUT_MS = 3000;

function notionProperties(row: Row) {
  const label = ITEM_LABELS[row.item_key as ItemKey];
  const snapshotText = renderSnapshot(row.snapshot);

  return {
    "Entry": { title: [{ text: { content: `${label} — ${row.week_key}` } }] },
    "Week": { date: { start: row.week_key } },
    "Item": { select: { name: label } },
    "Reviewed": { checkbox: row.ticked_at != null },
    "Reviewed At": { date: row.ticked_at ? { start: row.ticked_at } : null },
    "Decision": {
      rich_text: row.decision ? [{ text: { content: row.decision.slice(0, 2000) } }] : [],
    },
    "Snapshot": {
      rich_text: snapshotText ? [{ text: { content: snapshotText.slice(0, 2000) } }] : [],
    },
  };
}
/**
 * How long the WHOLE mirror gets, across however many Notion calls it makes.
 *
 * A per-request timeout is no longer enough: deduping can cost a failed PATCH,
 * then a query, then a second PATCH. Three 3s requests would be a nine-second
 * tail on a write Supabase finished long ago. This is one budget for the lot —
 * each call gets whatever is left, and when it runs out the mirror stops.
 */
const NOTION_BUDGET_MS = 4000;

/** Milliseconds left in the budget, floored so a call is never given ~0ms. */
function remaining(deadline: number): number {
  return Math.max(400, deadline - Date.now());
}

/**
 * Pages already in the log for this row's week AND item, oldest first.
 *
 * This is the dedupe. The log itself is asked what exists rather than trusting
 * notion_page_id to have survived, which is the whole bug: that column is a
 * cache on a row that gets deleted, cleared and recreated, and every time it
 * came back empty the mirror created a second page beside the live one.
 *
 * Returns [] on any failure — the caller treats "cannot tell" as "do not
 * create", so a query outage can never manufacture a duplicate.
 */
async function findNotionPages(
  row: Row,
  headers: Record<string, string>,
  deadline: number,
): Promise<Array<{ id: string; created_time: string }> | null> {
  const response = await fetch(
    `https://api.notion.com/v1/data_sources/${WEEKLY_REVIEW_LOG_DS}/query`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        filter: {
          and: [
            { property: "Week", date: { equals: row.week_key } },
            { property: "Item", select: { equals: ITEM_LABELS[row.item_key as ItemKey] } },
          ],
        },
        // Oldest first, so "the one we keep" is stable across runs rather than
        // whichever page the API happened to list first.
        sorts: [{ timestamp: "created_time", direction: "ascending" }],
        page_size: 20,
      }),
      signal: AbortSignal.timeout(remaining(deadline)),
    },
  );

  if (!response.ok) {
    console.error("[weekly-review] Notion dedupe query failed:", response.status, await response.text());
    return null;
  }

  const data = (await response.json()) as { results?: Array<{ id: string; created_time: string }> };
  return (data.results ?? []).map((r) => ({ id: r.id, created_time: r.created_time }));
}

/** PATCH one page's properties. True on success. */
async function patchNotionPage(
  pageId: string,
  properties: unknown,
  headers: Record<string, string>,
  deadline: number,
): Promise<boolean> {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ properties }),
    signal: AbortSignal.timeout(remaining(deadline)),
  });
  if (!response.ok) {
    console.error("[weekly-review] Notion update failed:", response.status, await response.text());
    return false;
  }
  return true;
}

/** Cache a page id on the row so the next write takes the fast path. */
async function cacheNotionPageId(row: Row, pageId: string): Promise<void> {
  const { error } = await serviceClient()
    .from(TABLE)
    .update({ notion_page_id: pageId })
    .eq("week_key", row.week_key)
    .eq("item_key", row.item_key);
  if (error) console.error("[weekly-review] notion_page_id write-back failed:", error.message);
}

/**
 * Mirror one row into the Weekly Review Log. Never throws.
 *
 * Three steps, in order of cost:
 *   1. notion_page_id, if set — one PATCH and done. A stale id no longer ends
 *      the attempt: a page deleted in Notion used to fail here and stop, which
 *      silently killed the mirror for that row forever.
 *   2. Otherwise ASK THE LOG what exists for this week+item. One match is
 *      updated and its id cached. More than one is reported and the OLDEST is
 *      updated — the extras are left exactly as they are, because deleting
 *      someone's Notion pages is not this function's call to make.
 *   3. Create only when the log genuinely holds nothing for this week+item.
 *
 * Supabase is the source of truth and this runs AFTER it commits, so every
 * failure path is a log line and a return. The tick has already succeeded.
 */
async function mirrorToNotion(row: Row): Promise<MirrorStatus> {
  if (!NOTION_TOKEN) {
    console.error("[weekly-review] Notion mirror skipped: missing NOTION_TOKEN");
    return { ok: false, reason: "missing_token" };
  }

  const headers = {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
  const deadline = Date.now() + NOTION_BUDGET_MS;

  try {
    const properties = notionProperties(row);

    // 1 — fast path on the cached id.
    if (row.notion_page_id) {
      if (await patchNotionPage(row.notion_page_id, properties, headers, deadline)) {
        return { ok: true, reason: null, pageId: row.notion_page_id };
      }
      // The cached id is stale (page deleted or archived). Fall through and
      // find out what is actually in the log rather than giving up.
      console.error("[weekly-review] cached notion_page_id is stale, re-resolving:", row.notion_page_id);
    }

    // 2 — resolve by week + item.
    const found = await findNotionPages(row, headers, deadline);

    // null means the query itself failed. "Cannot tell" must never become
    // "create another one" — that is precisely how duplicates were born.
    if (found === null) return { ok: false, reason: "lookup_failed" };

    if (found.length > 0) {
      const oldest = found[0];
      const extras = found.slice(1).map((p) => p.id);

      if (extras.length > 0) {
        console.error(
          `[weekly-review] ${found.length} Notion pages match ${row.week_key}/${row.item_key}; ` +
            `updating oldest ${oldest.id}, leaving untouched: ${extras.join(", ")}`,
        );
      }

      if (!(await patchNotionPage(oldest.id, properties, headers, deadline))) {
        return { ok: false, reason: "update_failed", duplicates: extras };
      }

      await cacheNotionPageId(row, oldest.id);
      // Duplicates are reported even on success: the mirror DID complete, and
      // the extra pages are a fact about the log that someone has to see.
      return { ok: true, reason: null, pageId: oldest.id, duplicates: extras };
    }

    // 3 — nothing exists for this week+item, so create it.
    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: WEEKLY_REVIEW_LOG_DS },
        properties,
      }),
      signal: AbortSignal.timeout(remaining(deadline)),
    });

    if (!response.ok) {
      console.error("[weekly-review] Notion create failed:", response.status, await response.text());
      return { ok: false, reason: `create_failed_${response.status}` };
    }

    const created = (await response.json()) as { id?: string };
    if (!created.id) return { ok: false, reason: "create_returned_no_id" };

    await cacheNotionPageId(row, created.id);
    return { ok: true, reason: null, pageId: created.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[weekly-review] Notion mirror error:", message);
    // TimeoutError is the budget expiring, which is the single most likely way
    // this fails in the wild and the one most worth naming distinctly.
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, reason: timedOut ? "timeout" : `error: ${message}` };
  }
}

/* ── errors ──────────────────────────────────────────────────────────────── */

/**
 * A thrown error → the right status.
 *
 * A missing environment variable is a 503 that names the variable: the route is
 * correctly deployed and temporarily unable to serve, which is a different fact
 * from a bug, and the operator needs the variable's name to fix it in one step.
 */
function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error("[weekly-review]", message);
  const missingEnv = message.startsWith("Missing ");
  return json({ error: message }, missingEnv ? 503 : 500);
}

/**
 * The whole payload for one week. The single place the response is assembled,
 * so GET and POST cannot drift into returning different shapes.
 *
 * The three reads are concurrent and two of the three degrade to null on their
 * own, which is what keeps a missing focus table or a slow /api/actions from
 * delaying — or failing — the part callers actually depend on: the four items.
 */
async function buildPayload(weekKey: string, origin: string): Promise<WeeklyReviewPayload> {
  const [core, focus, lastTest] = await Promise.all([
    readWeek(weekKey),
    readFocus(weekKey),
    readLastTest(origin),
  ]);

  // `core` is spread first and untouched: items and ticked come through exactly
  // as the table gave them, with the two new keys added alongside weekKey.
  // mirror defaults to null: no mirror runs on a read. POST overrides it with
  // the real result after it has written.
  return { ...core, focus, lastTest, mirror: null };
}

/* ── handlers ────────────────────────────────────────────────────────────── */

export async function GET(request: Request) {
  try {
    const weeks = parseWeeks(new URL(request.url).searchParams.get("weeks"));
    const weekKey = currentWeekKey();
    const body = await buildPayload(weekKey, new URL(request.url).origin);

    // weeks=1 still carries no `history` key at all, not an empty one.
    if (weeks <= 1) return json(body, 200);

    return json({ ...body, history: await readHistory(weekKey, weeks - 1) }, 200);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const weekKey = currentWeekKey();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON", weekKey }, 400);
  }

  const {
    week_key: bodyWeekKey,
    item_key: bodyItemKey,
    ticked: bodyTicked,
    decision: bodyDecision,
    focus: bodyFocus,
  } = (body ?? {}) as Record<string, unknown>;

  const focusProvided = bodyFocus !== undefined;

  if (focusProvided && typeof bodyFocus !== "string") {
    return json({ error: "focus must be a string when present", weekKey }, 400);
  }

  /*
   * A focus-only write carries no item_key, so the item_key check has to be
   * skipped for it — but ONLY for it. A body with neither an item_key nor a
   * focus is still the old "unknown item_key" 400, and a body that names an
   * item_key still has it validated even when a focus rides along. Setting the
   * week's sentence must never require naming an item it has nothing to do with.
   */
  const itemIntended = bodyItemKey !== undefined || !focusProvided;

  if (itemIntended && !isItemKey(bodyItemKey)) {
    return json(
      { error: `Unknown item_key. Expected one of: ${ITEM_KEYS.join(", ")}`, weekKey },
      400,
    );
  }

  // Only the current week is writable. A client holding a stale key — a tab left
  // open across the Saturday turnover is the ordinary case, not the exotic one —
  // would otherwise silently tick LAST week, where nobody will ever see it and
  // where it cannot be undone from the UI. Rejecting tells the client to refresh.
  if (bodyWeekKey !== weekKey) {
    return json(
      { error: `week_key must be the current Sydney review week (${weekKey})`, weekKey },
      409,
    );
  }

  if (bodyTicked !== undefined && typeof bodyTicked !== "boolean") {
    return json({ error: "ticked must be a boolean when present", weekKey }, 400);
  }

  if (bodyDecision !== undefined && typeof bodyDecision !== "string") {
    return json({ error: "decision must be a string when present", weekKey }, 400);
  }

  const decisionProvided = bodyDecision !== undefined;
  // An explicit empty string CLEARS the decision; absent leaves it alone. Those
  // are different requests and the column stores the difference as null vs
  // untouched, so resolving "" to null here is the clear, not a lost value.
  const decisionValue = decisionProvided
    ? (bodyDecision as string).trim() === ""
      ? null
      : (bodyDecision as string).slice(0, 4000)
    : undefined;

  /*
   * Three modes, and the middle one is why this is not a boolean:
   *   tick    — ticked true, or nothing said at all
   *   untick  — ticked false
   *   touch   — ticked not said but a decision was, so the tick state is NOT
   *             the subject of the request and must survive it untouched
   *
   * Without `touch`, saving a decision on an unticked row would tick it, which
   * is the opposite of what "save a decision without ticking it" means.
   */
  const mode =
    bodyTicked !== undefined ? (bodyTicked ? "tick" : "untick") : decisionProvided ? "touch" : "tick";

  try {
    /*
     * FOCUS — written first, and entirely on its own.
     *
     * It touches week_focus and never weekly_reviews, so no item row is read,
     * written or upserted on this path: setting the week's sentence cannot tick
     * anything, cannot untick anything, and cannot disturb a decision. When a
     * focus arrives with no item_key the handler stops after this block.
     */
    if (focusProvided) {
      const raw = bodyFocus as string;
      // Empty string CLEARS. Stored as null so GET's "unset" and "cleared" are
      // the same answer rather than two states the caller has to tell apart.
      const focusValue = raw.trim() === "" ? null : raw.slice(0, FOCUS_MAX);

      const { error: focusError } = await serviceClient()
        .from(FOCUS_TABLE)
        .upsert(
          { week_key: weekKey, focus: focusValue, updated_at: new Date().toISOString() },
          { onConflict: "week_key" },
        );

      if (focusError) {
        if (isMissingFocusTable(focusError.message)) {
          return json(
            {
              error:
                "public.week_focus does not exist yet — run the CREATE TABLE in the Supabase SQL editor",
              weekKey,
            },
            503,
          );
        }
        throw new Error(focusError.message);
      }

      // Focus-only request: nothing about an item was asked for, so nothing
      // about an item is touched.
      if (!isItemKey(bodyItemKey)) {
        return json(await buildPayload(weekKey, new URL(request.url).origin), 200);
      }
    }

    // Past the focus-only early return above, so bodyItemKey is a validated
    // ItemKey: the 400 at the top rejected anything else whenever an item was
    // intended, and the only path reaching here without one has already
    // returned. Asserted rather than re-tested so no new response path appears
    // — the uses below already rely on exactly this invariant.
    const itemKey = bodyItemKey as ItemKey;

    const supabase = serviceClient();

    // Only the columns this request is actually about. PostgREST's upsert
    // updates exactly the columns present in the payload, so an omitted column
    // is a PRESERVED column — that is what keeps snapshot, decision and
    // notion_page_id alive across an untick.
    const write: Record<string, unknown> = { week_key: weekKey, item_key: bodyItemKey };

    if (mode === "tick") {
      write.ticked_at = new Date().toISOString();
      // Overwritten on every re-tick, by design: the snapshot records the
      // numbers at the moment of the tick that stands, not the first one ever.
      write.snapshot = await captureSnapshot(new URL(request.url).origin, weekKey, itemKey);
    } else if (mode === "untick") {
      // Null the timestamp, keep the row. Unticking something that was never
      // ticked writes a row that is already in the unticked state, which is a
      // success — there is no such thing as a failed untick.
      write.ticked_at = null;
    } else {
      /*
       * TOUCH — decision only, tick state must not move.
       *
       * ticked_at is written EXPLICITLY here rather than omitted, and the
       * difference is not cosmetic. Omitting a column preserves it on the
       * UPDATE half of an upsert, but on the INSERT half the column takes its
       * DEFAULT — and weekly_reviews.ticked_at still carries DEFAULT now() from
       * when it was NOT NULL. So a decision saved on an item with no row yet
       * silently ticked it, stamped with the moment the decision was typed.
       *
       * Reading the current value first and writing it back makes the outcome
       * identical on both halves of the upsert and independent of whatever
       * default the column happens to hold.
       */
      const { data: current, error: currentError } = await supabase
        .from(TABLE)
        .select("ticked_at")
        .eq("week_key", weekKey)
        .eq("item_key", bodyItemKey)
        .maybeSingle();

      if (currentError) throw new Error(currentError.message);

      write.ticked_at = (current as { ticked_at: string | null } | null)?.ticked_at ?? null;
    }

    if (decisionProvided) write.decision = decisionValue;

    // Upsert, not insert: ticking an already-ticked item is a no-op the UI is
    // allowed to send (a double tap, two devices at once) and must not fail on a
    // primary key collision. onConflict names the composite PK explicitly — left
    // to infer it, PostgREST targets the single-column default and the write
    // fails on a table keyed by two.
    const { error: writeError } = await supabase
      .from(TABLE)
      .upsert(write, { onConflict: "week_key,item_key" });

    if (writeError) throw new Error(writeError.message);

    // Read the committed row back before mirroring, so Notion is fed the
    // database's version of the row rather than this handler's guess at it —
    // including the notion_page_id and the fields this request did not touch.
    const { data: saved, error: readError } = await supabase
      .from(TABLE)
      .select(ROW_COLUMNS)
      .eq("week_key", weekKey)
      .eq("item_key", bodyItemKey)
      .maybeSingle();

    if (readError) throw new Error(readError.message);

    // Awaited, but bounded and swallowing: a serverless function that returns
    // before its background work is done gets frozen mid-flight, so fire-and-
    // forget would lose the mirror outright. mirrorToNotion never throws and
    // caps itself at NOTION_BUDGET_MS, so the worst case is a late response,
    // never a failed tick.
    //
    // Its verdict is KEPT rather than discarded. The tick's success and the
    // mirror's success are two different facts, and collapsing them into one
    // 200 is what let the mirror die unnoticed.
    const mirror: MirrorStatus | null = saved ? await mirrorToNotion(saved as Row) : null;

    // The whole updated set, read back from the table rather than assembled from
    // what we just sent. The response is then the database's account of the
    // week, not this handler's optimistic guess at it — and it is built by the
    // same function GET uses, so the two can never answer in different shapes.
    // `mirror` is layered on top: still a 200, still a successful tick, with the
    // mirror's own outcome stated beside it.
    const payload = await buildPayload(weekKey, new URL(request.url).origin);
    return json({ ...payload, mirror }, 200);
  } catch (e) {
    return fail(e);
  }
}

/**
 * CORS preflight. 204 with no body — the browser reads only the headers.
 *
 * Allow-Headers carries Content-Type because the POST sends JSON, and a JSON
 * content type is not a CORS-safelisted request header: without this line the
 * preflight passes and the POST that follows is blocked by the browser.
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": NO_STORE,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
