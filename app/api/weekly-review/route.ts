import { NextResponse } from "next/server";
import { zoneToday, isoWeekKey } from "../../lib/time";
import { serviceClient } from "../../lib/supabase-server";

/* ────────────────────────────────────────────────────────────────────────────
   /api/weekly-review — GET and POST. Four fixed weekly review items, ticked
   once each per Sydney ISO week.

   Backed by public.weekly_reviews, PK (week_key, item_key). There is no reset
   job and there is no cron, by design: a new week produces a new week_key, that
   key matches no rows, and all four items reappear unticked on their own. The
   absence of a row IS the unticked state, so nothing has to run at midnight on
   Sunday for Monday to be correct — including the Mondays when nobody opened
   the page all week.

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
// data and "*" would let any page on the internet read — and POST to — it. The
// CORS already in this repo is not a wildcard, so there is nothing to leave
// alone here; matching what exists means matching the exact origin.
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

function isItemKey(value: unknown): value is ItemKey {
  return typeof value === "string" && (ITEM_KEYS as readonly string[]).includes(value);
}

/** The Sydney ISO week key right now — `2026-W33`. */
function currentWeekKey(): string {
  return isoWeekKey(zoneToday(new Date()));
}

export interface ReviewItem {
  key: ItemKey;
  ticked: boolean;
  /** ISO-8601 instant, or null when the item is not ticked. */
  tickedAt: string | null;
  tickedBy: string | null;
}

export interface WeeklyReviewPayload {
  weekKey: string;
  items: ReviewItem[];
  /** The ticked keys alone, for a caller that only needs the set. */
  ticked: ItemKey[];
}

type Row = { item_key: string; ticked_at: string | null; ticked_by: string | null };

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": NO_STORE, ...CORS_HEADERS },
  });
}

/**
 * The four items for `weekKey`, ticked state filled in from whatever rows exist.
 *
 * Always returns four items in ITEM_KEYS order regardless of what the table
 * holds. Two consequences, both wanted: a week with no rows renders as four
 * unticked boxes rather than an empty list, and a stray row whose item_key is
 * no longer one of the four is ignored on read instead of surfacing as an item
 * the UI has no name for.
 */
async function readWeek(weekKey: string): Promise<WeeklyReviewPayload> {
  const supabase = serviceClient();

  const { data, error } = await supabase
    .from(TABLE)
    .select("item_key, ticked_at, ticked_by")
    .eq("week_key", weekKey);

  if (error) throw new Error(error.message);

  const byKey = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) byKey.set(row.item_key, row);

  const items: ReviewItem[] = ITEM_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      ticked: row !== undefined,
      tickedAt: row?.ticked_at ?? null,
      tickedBy: row?.ticked_by ?? null,
    };
  });

  return {
    weekKey,
    items,
    ticked: items.filter((i) => i.ticked).map((i) => i.key),
  };
}

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

export async function GET() {
  try {
    return json(await readWeek(currentWeekKey()), 200);
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

  const { week_key: bodyWeekKey, item_key: bodyItemKey, ticked_by: bodyTickedBy } =
    (body ?? {}) as Record<string, unknown>;

  if (!isItemKey(bodyItemKey)) {
    return json(
      { error: `Unknown item_key. Expected one of: ${ITEM_KEYS.join(", ")}`, weekKey },
      400,
    );
  }

  // Only the current week is writable. A client holding a stale key — a tab left
  // open across Sunday midnight is the ordinary case, not the exotic one — would
  // otherwise silently tick LAST week, where nobody will ever see it and where
  // it cannot be undone from the UI. Rejecting tells the client to refresh.
  if (bodyWeekKey !== weekKey) {
    return json(
      { error: `week_key must be the current Sydney week (${weekKey})`, weekKey },
      409,
    );
  }

  const tickedBy =
    typeof bodyTickedBy === "string" && bodyTickedBy.trim() !== ""
      ? bodyTickedBy.trim().slice(0, 120)
      : null;

  try {
    const supabase = serviceClient();

    // Upsert, not insert: ticking an already-ticked item is a no-op the UI is
    // allowed to send (a double tap, two devices at once) and must not fail on a
    // primary key collision. onConflict names the composite PK explicitly — left
    // to infer it, PostgREST targets the single-column default and the write
    // fails on a table keyed by two.
    const { error } = await supabase.from(TABLE).upsert(
      {
        week_key: weekKey,
        item_key: bodyItemKey,
        ticked_at: new Date().toISOString(),
        ticked_by: tickedBy,
      },
      { onConflict: "week_key,item_key" },
    );

    if (error) throw new Error(error.message);

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
