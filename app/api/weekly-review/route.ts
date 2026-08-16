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

// Same allowlist as /api/mission, and exact for the same reason: this is family
// data and "*" would let any page on the internet read — and POST to — it.
const ALLOWED_ORIGIN = "https://jade-bombolone-82d172.netlify.app";

// Carried by every response path, including the 400s and the 503. `Vary: Origin`
// is not decoration: without it a CDN is free to hand one origin's cached
// response to another, which is how an allowlist of one degrades into "*".
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Vary": "Origin",
} as const;

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

export interface WeeklyReviewPayload {
  weekKey: string;
  items: ReviewItem[];
  /** The ticked keys alone, for a caller that only needs the set. */
  ticked: ItemKey[];
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
    headers: { "Cache-Control": NO_STORE, ...CORS_HEADERS },
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
async function readWeek(weekKey: string): Promise<WeeklyReviewPayload> {
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
async function captureSnapshot(origin: string, weekKey: string): Promise<Record<string, unknown>> {
  const [mission, pocketsmith] = await Promise.all([
    readJson(`${origin}/api/mission`),
    readJson(`${origin}/api/pocketsmith`),
  ]);

  const weekly = (mission?.weekly as Record<string, unknown> | undefined) ?? null;

  const lastWeek = (pocketsmith?.lastWeek as Record<string, unknown> | undefined) ?? undefined;
  const rawSpend = lastWeek?.totalSpending;
  const lastWeekTotalSpend =
    typeof rawSpend === "number" && Number.isFinite(rawSpend) ? rawSpend : null;

  return {
    capturedAt: new Date().toISOString(),
    weekKey,
    weekly,
    finance: {
      lastWeekTotalSpend,
      // Same function the hero figure on the dashboard wears, so the recorded
      // tier can never disagree with the tier that was on the screen.
      lastWeekTier: lastWeekTotalSpend === null ? null : spendTier(lastWeekTotalSpend),
    },
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
 * Mirror one row into the Weekly Review Log. Never throws.
 *
 * Supabase is the source of truth and this runs AFTER it has committed, so
 * every failure path here is a log line and a return. Leaving notion_page_id
 * null on a failed create is the retry: the next write for the same
 * week_key+item_key sees no id and creates the page again, which is why a
 * Notion outage costs the mirror a beat rather than the row forever.
 */
async function mirrorToNotion(row: Row): Promise<void> {
  if (!NOTION_TOKEN) {
    console.error("[weekly-review] Notion mirror skipped: missing NOTION_TOKEN");
    return;
  }

  const headers = {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  try {
    const properties = notionProperties(row);

    if (row.notion_page_id) {
      const response = await fetch(`https://api.notion.com/v1/pages/${row.notion_page_id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties }),
        signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error(
          "[weekly-review] Notion update failed:",
          response.status,
          await response.text(),
        );
      }
      return;
    }

    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: WEEKLY_REVIEW_LOG_DS },
        properties,
      }),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error("[weekly-review] Notion create failed:", response.status, await response.text());
      return;
    }

    const created = (await response.json()) as { id?: string };
    if (!created.id) return;

    // Store the id so the next write updates this page instead of creating a
    // second one. This is what keeps four writes in a week to one Notion row.
    const supabase = serviceClient();
    const { error } = await supabase
      .from(TABLE)
      .update({ notion_page_id: created.id })
      .eq("week_key", row.week_key)
      .eq("item_key", row.item_key);

    if (error) console.error("[weekly-review] notion_page_id write-back failed:", error.message);
  } catch (e) {
    console.error("[weekly-review] Notion mirror error:", e instanceof Error ? e.message : String(e));
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

/* ── handlers ────────────────────────────────────────────────────────────── */

export async function GET(request: Request) {
  try {
    const weeks = parseWeeks(new URL(request.url).searchParams.get("weeks"));
    const weekKey = currentWeekKey();
    const payload = await readWeek(weekKey);

    // weeks=1 returns EXACTLY the original shape — no `history` key at all, not
    // an empty one. The mission board reads this response and an added key is a
    // change it did not ask for.
    if (weeks <= 1) return json(payload, 200);

    return json({ ...payload, history: await readHistory(weekKey, weeks - 1) }, 200);
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
  } = (body ?? {}) as Record<string, unknown>;

  if (!isItemKey(bodyItemKey)) {
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
      write.snapshot = await captureSnapshot(new URL(request.url).origin, weekKey);
    } else if (mode === "untick") {
      // Null the timestamp, keep the row. Unticking something that was never
      // ticked writes a row that is already in the unticked state, which is a
      // success — there is no such thing as a failed untick.
      write.ticked_at = null;
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
    // caps itself at NOTION_TIMEOUT_MS, so the worst case is a late response,
    // never a failed tick.
    if (saved) await mirrorToNotion(saved as Row);

    // The whole updated set, read back from the table rather than assembled from
    // what we just sent. The response is then the database's account of the
    // week, not this handler's optimistic guess at it.
    return json(await readWeek(weekKey), 200);
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
      ...CORS_HEADERS,
    },
  });
}
