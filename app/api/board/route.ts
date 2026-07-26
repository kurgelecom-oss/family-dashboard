import { NextResponse } from "next/server";

// Rendered per request; the 300s cache is declared per response instead (cacheControlFor).
//
// This was `force-static` + `revalidate = 300`. It cannot stay that way and also honour
// BOARD-SPEC's "total failure must be 503 and must not be cached": force-static prerenders
// the handler and caches the result, so a build without NOTION_TOKEN baked the all-eight-
// failed payload and served it as HTTP 200 for 300s (observed — see BOARD-LEDGER Findings
// 2026-07-26). A baked response cannot be conditionally uncacheable. Rendering per request
// and setting Cache-Control per response keeps the same 300s lifetime on the success path
// while letting the failure path opt out. cacheComponents is not enabled, so the legacy
// `dynamic` segment config still applies.
export const dynamic = "force-dynamic";

// Total failure: never cached, so a credential outage cannot outlive its own cause.
const CACHE_FAIL = "no-store";
const SWR_SECONDS = 300;

// Origin-side cap. force-dynamic runs the handler on every CDN miss, so the downstream
// Cache-Control alone does not bound how often Notion is queried. This module-level entry
// restores that bound: eight Notion queries per 300s per warm server instance, however many
// requests arrive. Deliberately module scope, not a request-scoped memo — the point is to
// survive between requests.
const CACHE_TTL_MS = 300_000;

const NOTION_TOKEN = process.env.NOTION_TOKEN;

interface SourceDef {
  person: string;
  layer: string;
  id: string;
  shape: "layer" | "weekly";
}

// These are DATA SOURCE ids, not database ids — GET /v1/databases/{id} 404s for
// them, only POST /v1/data_sources/{id}/query works. Ids are pinned here rather
// than read from env because BOARD-SPEC.md fixes the owner→layer→id mapping and a
// mistyped env var would silently attach a layer to the wrong person.
//
// `shape` selects how a row is read:
//   "layer"  — Block/title, Day single-select, Start, End, Notes
//   "weekly" — Entry/title, Days multi-select, Date, Start, End, Notes, Category, Detail, Emoji
const SOURCES: readonly SourceDef[] = [
  { person: "taylan", layer: "work", id: "7e90f275-70d4-480a-b504-b8be3444b7f5", shape: "layer" },
  { person: "taylan", layer: "personal", id: "2b062576-79ee-4b7a-8acd-805aaf044f8b", shape: "layer" },
  { person: "taylan", layer: "ecom", id: "cd0e72dd-fb69-4599-95be-202ee1446770", shape: "layer" },
  { person: "nihal", layer: "home", id: "52767310-b8e8-4827-bf66-ae08a9a68120", shape: "layer" },
  { person: "nihal", layer: "personal", id: "e959c33a-968e-4da3-a1f5-f10e65acc094", shape: "layer" },
  { person: "nihal", layer: "ecom", id: "dc07abb4-803e-4058-95f2-10dd473402fa", shape: "layer" },
  { person: "nihal", layer: "ayah", id: "a2d13dcd-ce40-4899-b211-bba55eed3b50", shape: "layer" },
  { person: "ansar", layer: "homeschool", id: "63550d99-ab80-4c2d-914d-d7df6d2f95a9", shape: "weekly" },
];

/**
 * One block on the board. `category`, `detail` and `emoji` only ever come from the
 * Weekly Schedule shape, so they are optional and absent on the seven layer sources.
 *
 * `start`/`end` are the original display strings and are deliberately not normalised —
 * layer sources store "14:00", the Weekly Schedule stores "9:05am". `startMin`/`endMin`
 * are the parsed equivalents and are what renderers must sort and position on.
 */
export interface Block {
  person: string;
  layer: string;
  /** Recurring weekday, e.g. "Mon". Empty on a one-off block, which is placed by `date`. */
  day: string;
  /** "YYYY-MM-DD" for a one-off dated occurrence; null on recurring and all layer sources. */
  date: string | null;
  start: string;
  end: string;
  /** Minutes from midnight, or null when the display string is absent or unparseable. */
  startMin: number | null;
  endMin: number | null;
  title: string;
  notes: string;
  category?: string;
  detail?: string;
  emoji?: string;
}

interface SourceError {
  person: string;
  layer: string;
  error: string;
}

export interface BoardPayload {
  blocks: Block[];
  errors: SourceError[];
}

// Notion caps a query page at 100 rows. Every source is well under that today, but a
// silent truncation would look identical to a genuinely short week, so page through.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 10_000;

type NotionProp = unknown;
type NotionPage = { properties?: Record<string, NotionProp> };

// Joins every chunk, not just the first. Notion splits a rich_text value at each
// formatting boundary, so bolding one word inside a note turns it into two chunks —
// reading only `[0]` would silently truncate it at the first bit of formatting.
function plainText(prop: NotionProp): string {
  const rich = (prop as { rich_text?: { plain_text?: string }[] } | undefined)?.rich_text;
  if (!rich) return "";
  return rich.map((t) => t.plain_text ?? "").join("");
}

function titleText(prop: NotionProp): string | null {
  const title = (prop as { title?: { plain_text?: string }[] } | undefined)?.title;
  if (!title) return null;
  return title.map((t) => t.plain_text ?? "").join("") || null;
}

function selectName(prop: NotionProp): string {
  return (prop as { select?: { name?: string } } | undefined)?.select?.name ?? "";
}

function multiSelectNames(prop: NotionProp): string[] {
  const items = (prop as { multi_select?: { name?: string }[] } | undefined)?.multi_select ?? [];
  return items.map((s) => s.name ?? "").filter(Boolean);
}

/**
 * The calendar-date half of a Notion date property, as "YYYY-MM-DD".
 *
 * Notion returns either a bare date ("2026-07-29") or a full timestamp with an offset
 * ("2026-07-29T09:00:00.000+10:00"). Slicing to 10 keeps the calendar date exactly as
 * entered and never shifts it across a timezone boundary — the same treatment
 * `/api/schedule` gives the field (route.ts:51), so /board and /week agree on the day.
 */
function dateStart(prop: NotionProp): string | null {
  const value = (prop as { date?: { start?: string } | null } | undefined)?.date;
  return value?.start?.slice(0, 10) ?? null;
}

/**
 * A display time as minutes from midnight, or null if it cannot be read.
 *
 * Handles both shapes' formats: 24-hour "14:00" (layer sources) and 12-hour "9:05am" /
 * "9am" / "12:30 PM" (Weekly Schedule). Out-of-range values ("25:00", "9:75pm") are
 * rejected rather than wrapped, because a silently wrong sort key is worse than an
 * absent one. null is never coerced to 0 — "no time given" must stay distinguishable
 * from midnight, or untimed blocks would sort to the top of the day as if they were.
 */
function parseMinutes(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  const twelve = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (twelve) {
    const h = parseInt(twelve[1], 10);
    const min = parseInt(twelve[2] ?? "0", 10);
    if (h < 1 || h > 12 || min > 59) return null;
    return ((h % 12) + (twelve[3].toLowerCase() === "p" ? 12 : 0)) * 60 + min;
  }

  const twentyFour = s.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    const h = parseInt(twentyFour[1], 10);
    const min = parseInt(twentyFour[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  return null;
}

/**
 * Maps one Notion row to the blocks it occurs as, for either shape.
 *
 * The layer shape carries a single-select `Day`, so it yields exactly one block. The
 * Weekly Schedule carries a multi-select `Days`, so a row spanning Mon–Thu fans out into
 * four, and additionally a `Date` for a one-off occurrence.
 *
 * Recurring and one-off are independent, matching how /week places an entry — it shows a
 * row in a column when its `days[]` matches *or* its `date` equals that column's calendar
 * date (app/week/page.tsx:172-179). So a row with both yields its recurring blocks *and*
 * one dated block; a row with only a `Date` yields just the dated block, where before it
 * yielded nothing at all. The dated block carries `day: ""` because its placement comes
 * from `date`, not from a weekday name. A row with neither cannot be placed and yields
 * nothing.
 */
function mapRow(page: NotionPage, source: SourceDef): Block[] {
  const props = page.properties ?? {};

  const weekly = source.shape === "weekly";
  const days = weekly ? multiSelectNames(props.Days) : [selectName(props.Day)].filter(Boolean);
  // Only the Weekly Schedule has a Date property; the seven layer sources never do.
  const date = weekly ? dateStart(props.Date) : null;

  if (days.length === 0 && date === null) return [];

  // `Block` on layer sources, `Entry` on the Weekly Schedule. Falling back to whichever
  // property is actually the title keeps a renamed column from emptying the board.
  const title =
    titleText(props.Block) ??
    titleText(props.Entry) ??
    Object.values(props).map(titleText).find((t) => t !== null) ??
    "Untitled";

  const start = plainText(props.Start);
  const end = plainText(props.End);

  const base: Block = {
    person: source.person,
    layer: source.layer,
    day: "",
    date: null,
    // Verbatim display strings — the route stays a reader, and picking a single display
    // format remains the renderer's call. startMin/endMin carry the sortable form.
    start,
    end,
    startMin: parseMinutes(start),
    endMin: parseMinutes(end),
    title,
    notes: plainText(props.Notes),
  };

  if (weekly) {
    const category = selectName(props.Category);
    const detail = plainText(props.Detail);
    const emoji = plainText(props.Emoji);
    if (category) base.category = category;
    if (detail) base.detail = detail;
    if (emoji) base.emoji = emoji;
  }

  const blocks = days.map((day) => ({ ...base, day }));
  if (date !== null) blocks.push({ ...base, date });
  return blocks;
}

async function fetchSource(source: SourceDef): Promise<Block[]> {
  if (!NOTION_TOKEN) {
    throw new Error("Missing NOTION_TOKEN");
  }

  const blocks: Block[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${source.id}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        cursor ? { page_size: PAGE_SIZE, start_cursor: cursor } : { page_size: PAGE_SIZE },
      ),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Notion API ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    for (const row of (data.results ?? []) as NotionPage[]) {
      blocks.push(...mapRow(row, source));
    }

    if (!data.has_more || !data.next_cursor) return blocks;
    cursor = data.next_cursor;
  }

  throw new Error(`Exceeded ${MAX_PAGES} pages`);
}

/** Query all eight sources once. Never rejects — failures land in `errors`. */
async function loadBoard(): Promise<BoardPayload> {
  // All eight in flight at once. Settled, not raced: one dead source must not take the
  // other seven down with it — the board degrades a layer at a time, never wholesale.
  const results = await Promise.allSettled(SOURCES.map(fetchSource));

  const blocks: Block[] = [];
  const errors: SourceError[] = [];

  results.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === "fulfilled") {
      blocks.push(...result.value);
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Error fetching ${source.person}/${source.layer}:`, message);
      errors.push({ person: source.person, layer: source.layer, error: message });
    }
  });

  return { blocks, errors };
}

/**
 * The one cached payload, or null when cold or expired.
 *
 * `seq` is the sequence number of the load that produced it. A forced refresh can run
 * alongside an ordinary one, so two loads may be in flight and may finish out of order;
 * `seq` stops the slower, older read from overwriting the newer one's result.
 */
let cached: { payload: BoardPayload; expiresAt: number; seq: number } | null = null;

/** Monotonic, so ordering never depends on a clock that can tie or go backwards. */
let loadSeq = 0;

/**
 * The refresh currently in progress, or null.
 *
 * Without this, N requests arriving together on a cold cache would each fire eight Notion
 * queries — "at most once per 300s" would hold only for requests that arrive after the
 * first one has already finished. Coalescing onto a single promise makes the bound true
 * under concurrency, which is exactly when a cache is most needed.
 */
let inFlight: Promise<BoardPayload> | null = null;

/**
 * Success-path Cache-Control, with `s-maxage` set to what is LEFT of the in-memory entry's
 * TTL rather than a flat 300.
 *
 * The two caches are in series. A flat `s-maxage=300` on a payload already 299s old would
 * let the CDN hold it 300s more, so worst-case age at the client would be the module TTL
 * plus the CDN TTL — the in-memory cache would be buying an origin-side request cap with
 * up to 300s of extra staleness. Handing the CDN only the remaining lifetime keeps the
 * total the same as before the cache existed: at most 300s fresh, plus the unchanged
 * stale-while-revalidate window.
 */
function cacheControlFor(entry: { expiresAt: number } | null): string {
  const remaining = entry ? Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)) : 0;
  return `public, s-maxage=${remaining}, stale-while-revalidate=${SWR_SECONDS}`;
}

/**
 * Load the board, optionally forcing a genuinely new read.
 *
 * `force` exists because coalescing is wrong for a manual refresh. An ordinary request is
 * happy to adopt a load already running — the data is as fresh as anything it would fetch
 * itself. A `?refresh=1` request is not: `/board` polls every 300s and re-fetches on every
 * mount, so a load started *before* the button was pressed is very likely to predate the
 * Notion edit the user is trying to see. Adopting it would return pre-edit data, re-prime
 * the shared entry with it for a full TTL, and report `X-Board-Cache: refresh` while doing
 * so — the button appearing to work while leaving the user in exactly the state it exists
 * to escape. So a forced refresh always starts its own read.
 */
function refresh(force = false): Promise<BoardPayload> {
  if (!force && inFlight) return inFlight;

  const seq = ++loadSeq;

  const run: Promise<BoardPayload> = loadBoard()
    .then((payload) => {
      // A total failure must never be cached. Caching it would pin an outage in memory for
      // 300s past its cause and starve the retry that would clear it — the same trap the
      // 503 exists to escape, just moved from the CDN into the process. Partial failure IS
      // cached: it is a real board with a named gap, not an outage.
      //
      // The seq check matters only when a forced read overlaps an ordinary one: whichever
      // started later wins, so a slow older read cannot clobber a fresher result and
      // silently undo the refresh.
      if (payload.errors.length < SOURCES.length && (cached === null || seq > cached.seq)) {
        cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS, seq };
      }
      return payload;
    })
    .finally(() => {
      // Only clear the slot if it is still ours — a forced refresh may have replaced it.
      if (inFlight === run) inFlight = null;
    });

  inFlight = run;
  return run;
}

export async function GET(request: Request) {
  // ?refresh=1 — the manual override for "I just changed Notion and want to see it now".
  // Without it the only ways out of a warm entry are waiting up to 300s or recycling the
  // instance, and a browser reload does neither: the staleness is at the origin, not in
  // the browser cache. Skips the read, not the write — refresh() repopulates `cached`, so
  // one person pressing Refresh re-primes the board for everyone on that instance.
  const force = new URL(request.url).searchParams.get("refresh") === "1";

  // Read `cached` once: refresh() reassigns it, so re-reading below could see a different
  // entry than the one the freshness check passed on.
  const entry = cached;
  const hit = !force && entry !== null && entry.expiresAt > Date.now();
  const payload = entry !== null && hit ? entry.payload : await refresh(force);

  // Every source down is an outage, not an empty week. Returning 200 here makes a dead
  // token indistinguishable from a genuinely empty board to anything that does not read
  // `errors`, so it is a 503 — and an uncached one, at both layers, so it clears the moment
  // Notion or the credential recovers. `errors` is still populated: the 503 body names
  // every failure. Partial failure is untouched — one surviving source is still a 200.
  if (payload.errors.length === SOURCES.length) {
    return NextResponse.json(payload, {
      status: 503,
      headers: { "Cache-Control": CACHE_FAIL, "X-Board-Cache": "bypass" },
    });
  }

  // A forced refresh is never itself cacheable. `?refresh=1` is a distinct URL, so caching
  // it could not poison plain `/api/board` — but a CDN-cached refresh response would mean
  // the second press of the button never reaches the origin, which is the one thing the
  // button exists to do. The in-memory entry it just wrote is still shared with everyone.
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": force ? CACHE_FAIL : cacheControlFor(cached),
      "X-Board-Cache": force ? "refresh" : hit ? "hit" : "miss",
    },
  });
}
