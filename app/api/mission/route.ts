import { NextResponse } from "next/server";
import {
  HOUSEHOLD_TZ,
  zoneToday,
  mondayOfWeek,
  isoDate,
  daysBetween,
  parseCivilDate,
  type CivilDate,
} from "../../lib/time";

/* ────────────────────────────────────────────────────────────────────────────
   /api/mission — read-only. Four Notion sources, no database, no Supabase.

   Mirrors app/api/board/route.ts's Notion posture exactly (same endpoint shape,
   same Notion-Version, same AbortSignal timeout, same allSettled degradation)
   but deliberately does NOT copy its caching: /board earns a 300s edge+memory
   cache because eight sources are expensive and the week changes slowly. This
   route is two sources behind a wall-mounted TV that must never show yesterday,
   so it is force-dynamic + no-store on every path. No revalidate, no
   Netlify-Vary — there is no cache-varying query parameter to declare.

   All date logic goes through app/lib/time.ts, which is Intl-based and therefore
   correct across the AEST/AEDT boundary. No hardcoded UTC offset appears in this
   file, and getWeekStart() from app/lib/supabase.ts is deliberately not used —
   it is Melbourne-based and reconstructs dates through `new Date(string)`.
   ──────────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";

// This route writes nothing and caches nothing. Every response, success or
// failure, is uncacheable at both the browser and the CDN.
const NO_STORE = "no-store";

// The single browser origin allowed to read this route cross-origin: the wall
// display at jade-bombolone-82d172.netlify.app. Exact, never "*" — this payload
// is family data, and "*" would let any page on the internet read it.
const ALLOWED_ORIGIN = "https://jade-bombolone-82d172.netlify.app";

// Carried by every response path, including the 503. `Vary: Origin` is not
// decoration: without it a CDN is free to hand one origin's cached response to
// another, which is how an allowlist of one silently degrades into "*".
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Vary": "Origin",
} as const;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 10_000;

const DAILY_POINTS_ID = "4431302a-75ed-479f-a5f4-3bfd5e0a4e68";
const PRODUCT_VALIDATION_ID = "1d35429a-fa90-81a0-bf47-000b7fe8803d";
const MISSION_GOALS_ID = "22f0eed5-7556-4758-b171-328d273485f3";
const BOARD_NOTES_ID = "89bc2000-11da-4bcf-bc4b-ef37c7359abe";

// The all-failed threshold for the 503. Named rather than inlined as `=== 4` so
// that adding a fifth source surfaces this line as something to update, instead
// of silently leaving a route that can never report a total outage again. Board
// Notes is what made it four: left at three, a route with every source dead
// would count four errors, miss the threshold, and hand back a 200 full of
// empty sections — exactly the outage this number exists to catch.
const SOURCE_COUNT = 4;

/* ── payload ─────────────────────────────────────────────────────────────── */

export interface DailyPoint {
  point: string;
  pillar: string;
  owner: string;
  raisedIso: string | null;
  ageDays: number | null;
}

export interface QueuedValidation {
  name: string;
  createdIso: string;
  ageDays: number;
}

/** What a counted goal reads its number from. "none" is a text-only goal. */
export type CountsFrom =
  | "tests_logged"
  | "validations_logged"
  | "validation_queue"
  | "none";

export interface Goal {
  goal: string;
  /** Numeric target, or null when the goal has no number behind it. */
  target: number | null;
  /** Shown in place of a number — "1-3", "2/day". "" when absent. */
  targetText: string;
  countsFrom: CountsFrom;
  sort: number;
}

export interface GoalsPayload {
  weekly: { T: Goal[]; N: Goal[]; Both: Goal[] };
  monthly: Goal[];
  longTerm: Goal[];
}

export interface Note {
  note: string;
  /** `YYYY-MM-DD` in Sydney, or null when Added is blank. */
  addedIso: string | null;
  pinned: boolean;
}

export interface SourceError {
  source: string;
  error: string;
}

export interface MissionPayload {
  today: string;
  weekStart: string;
  daily: { T: DailyPoint[]; N: DailyPoint[] };
  // These three names are load-bearing: the page maps a goal's countsFrom onto
  // them. Renaming one silently turns every counted goal into a zero.
  weekly: {
    validationsThisWeek: number;
    testsLoggedThisWeek: number;
    validationQueue: QueuedValidation[];
  };
  goals: GoalsPayload;
  notes: Note[];
  errors: SourceError[];
}

/* ── Notion property readers ─────────────────────────────────────────────────
   Tolerant of the underlying property TYPE on purpose. Both schemas have since
   been read back from the live sources and match what these readers expect:

     Daily Discussion Points — Point:title, Owner:select [T|N|Both],
       Pillar:select, Raised:date, Status:select [Open|Discussed|Closed]
     Product Validation — Product Name:title, Created time:created_time,
       Validated by T:date

   The breadth is kept rather than narrowed to those exact types: a Notion
   select promoted to a status, or a text field retyped, is a one-click change
   in the UI that would otherwise silently empty a column on the wall.
   ──────────────────────────────────────────────────────────────────────────── */

type NotionProp = unknown;
type NotionPage = {
  id?: string;
  created_time?: string;
  properties?: Record<string, NotionProp>;
};

/** First property present under any of `names`. Notion names are exact. */
function propOf(page: NotionPage, ...names: string[]): NotionProp {
  const props = page.properties;
  if (!props) return undefined;
  for (const name of names) {
    if (props[name] !== undefined) return props[name];
  }
  return undefined;
}

/** Any text-bearing property, flattened to a plain string. "" when absent. */
function textOf(prop: NotionProp): string {
  if (prop === undefined || prop === null) return "";
  if (typeof prop === "string") return prop.trim();

  const p = prop as {
    title?: { plain_text?: string }[];
    rich_text?: { plain_text?: string }[];
    select?: { name?: string } | null;
    status?: { name?: string } | null;
    multi_select?: { name?: string }[];
    people?: { name?: string }[];
    formula?: { string?: string | null; number?: number | null };
    number?: number | null;
    name?: string;
  };

  // Joins every chunk: Notion splits rich_text and title at each formatting
  // boundary, so reading only [0] truncates at the first bold word.
  if (Array.isArray(p.title)) return p.title.map((t) => t.plain_text ?? "").join("").trim();
  if (Array.isArray(p.rich_text)) {
    return p.rich_text.map((t) => t.plain_text ?? "").join("").trim();
  }
  if (p.status && typeof p.status.name === "string") return p.status.name.trim();
  if (p.select && typeof p.select.name === "string") return p.select.name.trim();
  if (Array.isArray(p.multi_select)) {
    return p.multi_select.map((s) => s.name ?? "").filter(Boolean).join(", ").trim();
  }
  if (Array.isArray(p.people)) {
    return p.people.map((s) => s.name ?? "").filter(Boolean).join(", ").trim();
  }
  if (p.formula) {
    if (typeof p.formula.string === "string") return p.formula.string.trim();
    if (typeof p.formula.number === "number") return String(p.formula.number);
  }
  if (typeof p.number === "number") return String(p.number);
  if (typeof p.name === "string") return p.name.trim();
  return "";
}

/**
 * A numeric property, or null when it is genuinely blank.
 *
 * null and 0 must stay distinguishable: a blank Target means "this goal has no
 * number behind it" and must render as text, while 0 would be a real target
 * that is already met. Coercing one into the other is how a text-only goal ends
 * up displaying a fabricated "0 / 0".
 */
function numberOf(prop: NotionProp): number | null {
  if (prop === undefined || prop === null) return null;
  const p = prop as { number?: number | null; formula?: { number?: number | null } };
  if (typeof p.number === "number") return p.number;
  if (typeof p.formula?.number === "number") return p.formula.number;
  return null;
}

/** A checkbox property. Absent reads as false — an unset Active is not active. */
function boolOf(prop: NotionProp): boolean {
  if (prop === undefined || prop === null) return false;
  const p = prop as { checkbox?: boolean; formula?: { boolean?: boolean } };
  if (typeof p.checkbox === "boolean") return p.checkbox;
  if (typeof p.formula?.boolean === "boolean") return p.formula.boolean;
  return false;
}

/** A UTC instant → the calendar date it falls on in Sydney. */
function instantToSydneyIso(instant: string): string | null {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return isoDate(zoneToday(d, HOUSEHOLD_TZ));
}

/**
 * A property's calendar date as `YYYY-MM-DD` in Sydney, or null.
 *
 * The two Notion shapes are handled differently on purpose:
 *
 *   date property      — "2026-08-10" or "2026-08-10T09:00:00.000+10:00". The
 *                        calendar date is what the user typed; slicing to 10
 *                        keeps it exactly and never re-reads it through another
 *                        zone. Same treatment /board and /week give the field.
 *
 *   created_time /     — a UTC instant, not a calendar date. "2026-08-09T23:30Z"
 *   last_edited_time     IS 10 August in Sydney, so this must be converted, not
 *                        sliced. zoneToday() does that through Intl, which is
 *                        why the conversion is DST-correct without an offset.
 */
function dateIsoOf(prop: NotionProp): string | null {
  if (prop === undefined || prop === null) return null;
  const p = prop as {
    date?: { start?: string | null } | null;
    created_time?: string;
    last_edited_time?: string;
    formula?: { date?: { start?: string | null } | null };
  };

  const start = p.date?.start ?? p.formula?.date?.start ?? null;
  if (typeof start === "string" && start) return start.slice(0, 10);

  const instant = p.created_time ?? p.last_edited_time;
  if (typeof instant === "string" && instant) return instantToSydneyIso(instant);

  return null;
}

/* ── fetch ───────────────────────────────────────────────────────────────── */

/**
 * Every row of one data source. Verbatim the request shape /api/board uses:
 * POST /v1/data_sources/{id}/query, bearer token, Notion-Version 2025-09-03,
 * cursor pagination bounded by MAX_PAGES, and a per-request abort so one
 * unresponsive source cannot hold the whole route open.
 */
async function fetchSource(id: string, label: string): Promise<NotionPage[]> {
  if (!NOTION_TOKEN) {
    throw new Error("Missing NOTION_TOKEN");
  }

  const rows: NotionPage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${id}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
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
    rows.push(...((data.results ?? []) as NotionPage[]));

    if (!data.has_more || !data.next_cursor) return rows;
    cursor = data.next_cursor;
  }

  throw new Error(`Exceeded ${MAX_PAGES} pages for ${label}`);
}

/* ── shaping ─────────────────────────────────────────────────────────────── */

/**
 * Owner → the columns that row belongs in.
 *
 * "Both" is not a third column: it is a row that genuinely belongs to each
 * person and is rendered under each. Matching is prefix-based and
 * case-insensitive so "T", "Taylan", "taylan" and "Taylan K" all land in T
 * without this route holding a list of spellings Notion is free to change.
 */
function ownersOf(owner: string): ("T" | "N")[] {
  const o = owner.trim().toLowerCase();
  if (!o) return [];
  if (o.startsWith("both")) return ["T", "N"];
  if (o === "t" || o.startsWith("taylan")) return ["T"];
  if (o === "n" || o.startsWith("nihal")) return ["N"];
  return [];
}

function shapeDaily(rows: NotionPage[], today: CivilDate): { T: DailyPoint[]; N: DailyPoint[] } {
  const out: { T: DailyPoint[]; N: DailyPoint[] } = { T: [], N: [] };

  for (const row of rows) {
    if (textOf(propOf(row, "Status")).toLowerCase() !== "open") continue;

    const raisedIso = dateIsoOf(propOf(row, "Raised"));
    const raised = parseCivilDate(raisedIso);

    const point: DailyPoint = {
      point: textOf(propOf(row, "Point", "Name", "Title")) || "(untitled)",
      pillar: textOf(propOf(row, "Pillar")),
      owner: textOf(propOf(row, "Owner")),
      raisedIso,
      // Null rather than 0 when Raised is blank: "raised today" and "no date
      // recorded" must not render as the same "0d".
      ageDays: raised ? daysBetween(raised, today) : null,
    };

    for (const key of ownersOf(point.owner)) out[key].push(point);
  }

  // Oldest Raised first. Rows with no Raised date sort last — an undated row
  // has no claim to the top of a list ordered by age.
  const byOldest = (a: DailyPoint, b: DailyPoint) => {
    if (a.raisedIso === b.raisedIso) return 0;
    if (a.raisedIso === null) return 1;
    if (b.raisedIso === null) return -1;
    return a.raisedIso < b.raisedIso ? -1 : 1;
  };
  out.T.sort(byOldest);
  out.N.sort(byOldest);
  return out;
}

function shapeWeekly(
  rows: NotionPage[],
  weekStart: string,
  todayIso: string,
  today: CivilDate,
): MissionPayload["weekly"] {
  // Inclusive both ends. Both operands are `YYYY-MM-DD`, so lexicographic
  // comparison is chronological — no Date objects, no zone to get wrong.
  const inWeek = (iso: string | null): iso is string =>
    iso !== null && iso >= weekStart && iso <= todayIso;

  let validationsThisWeek = 0;
  let testsLoggedThisWeek = 0;
  const validationQueue: QueuedValidation[] = [];

  for (const row of rows) {
    // Prefer a property literally named "Created time"; fall back to the page's
    // own created_time, which every Notion page carries even when the database
    // does not surface it as a column.
    const createdIso =
      dateIsoOf(propOf(row, "Created time", "Created")) ??
      (row.created_time ? instantToSydneyIso(row.created_time) : null);
    const validatedIso = dateIsoOf(propOf(row, "Validated by T"));

    if (inWeek(createdIso)) validationsThisWeek++;
    if (inWeek(validatedIso)) testsLoggedThisWeek++;

    if (inWeek(createdIso) && validatedIso === null) {
      const created = parseCivilDate(createdIso);
      validationQueue.push({
        // "Product Name" is the actual title property, confirmed against the
        // live schema. The fallbacks stay for the usual Notion title spellings.
        name: textOf(propOf(row, "Product Name", "Name", "Product", "Title")) || "(untitled)",
        createdIso,
        ageDays: created ? daysBetween(created, today) : 0,
      });
    }
  }

  validationQueue.sort((a, b) =>
    a.createdIso < b.createdIso ? -1 : a.createdIso > b.createdIso ? 1 : 0,
  );

  return { validationsThisWeek, testsLoggedThisWeek, validationQueue };
}

/** Notion's "Counts From" value → the union, defaulting to text-only. */
function countsFromOf(raw: string): CountsFrom {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "tests_logged" || v === "validations_logged" || v === "validation_queue") {
    return v;
  }
  // Anything unrecognised is text-only on purpose. A typo'd select option must
  // not silently bind a goal to the wrong counter — showing no number is a
  // visible gap, showing the wrong number is not.
  return "none";
}

/**
 * Active goals, grouped by band and owner, sorted by Sort ascending.
 *
 * Band and Owner are matched case-insensitively so renaming a select option's
 * capitalisation in Notion cannot empty a band.
 */
function shapeGoals(rows: NotionPage[]): GoalsPayload {
  const out: GoalsPayload = {
    weekly: { T: [], N: [], Both: [] },
    monthly: [],
    longTerm: [],
  };

  for (const row of rows) {
    if (!boolOf(propOf(row, "Active"))) continue;

    const goal: Goal = {
      goal: textOf(propOf(row, "Goal", "Name", "Title")) || "(untitled)",
      target: numberOf(propOf(row, "Target")),
      targetText: textOf(propOf(row, "Target Text")),
      countsFrom: countsFromOf(textOf(propOf(row, "Counts From"))),
      // Unsorted rows sink to the bottom rather than jumping to the top, which
      // is what 0 would do.
      sort: numberOf(propOf(row, "Sort")) ?? Number.MAX_SAFE_INTEGER,
    };

    const band = textOf(propOf(row, "Band")).trim().toLowerCase();

    if (band === "weekly") {
      const owner = textOf(propOf(row, "Owner")).trim().toLowerCase();
      if (owner.startsWith("both")) out.weekly.Both.push(goal);
      else if (owner === "t" || owner.startsWith("taylan")) out.weekly.T.push(goal);
      else if (owner === "n" || owner.startsWith("nihal")) out.weekly.N.push(goal);
      // A Weekly goal with no recognised Owner has no column to live in. It is
      // dropped rather than guessed at — a goal shown under the wrong person is
      // worse than one that is visibly missing from Notion.
    } else if (band === "monthly") {
      out.monthly.push(goal);
    } else if (band === "long term" || band === "longterm" || band === "long-term") {
      out.longTerm.push(goal);
    }
  }

  const bySort = (a: Goal, b: Goal) => a.sort - b.sort;
  out.weekly.T.sort(bySort);
  out.weekly.N.sort(bySort);
  out.weekly.Both.sort(bySort);
  out.monthly.sort(bySort);
  out.longTerm.sort(bySort);

  return out;
}

/**
 * Active notes, pinned first, then newest Added first.
 *
 * Active is read through boolOf(), which treats an absent checkbox as false —
 * a row that has not been deliberately switched on does not reach the wall.
 *
 * Sorting is done here rather than by a Notion `sorts` clause so the order is a
 * property of this route, not of a database view anyone can reorder in the UI.
 * Both keys are compared as strings: addedIso is `YYYY-MM-DD`, so lexicographic
 * comparison is chronological and needs no Date objects and no zone.
 */
function shapeNotes(rows: NotionPage[]): Note[] {
  const out: Note[] = [];

  for (const row of rows) {
    if (!boolOf(propOf(row, "Active"))) continue;

    out.push({
      note: textOf(propOf(row, "Note", "Name", "Title")) || "(untitled)",
      addedIso: dateIsoOf(propOf(row, "Added")),
      pinned: boolOf(propOf(row, "Pinned")),
    });
  }

  out.sort((a, b) => {
    // Pinned is the primary key and outranks recency entirely: a pinned note
    // from last month still sits above an unpinned one added this morning.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    // Undated notes sink below every dated one rather than floating to the top,
    // which is where an empty string would put them under a plain descending
    // compare.
    if (a.addedIso === b.addedIso) return 0;
    if (a.addedIso === null) return 1;
    if (b.addedIso === null) return -1;
    return a.addedIso > b.addedIso ? -1 : 1;
  });

  return out;
}

/* ── handler ─────────────────────────────────────────────────────────────── */

export async function GET() {
  const today = zoneToday(new Date());
  const todayIso = isoDate(today);
  const weekStart = isoDate(mondayOfWeek(today));

  // Settled, not raced: the four sections are independent and one dead source
  // must degrade only itself. A 500 here would take down a page whose other
  // three quarters are perfectly healthy.
  const [dailyResult, weeklyResult, goalsResult, notesResult] = await Promise.allSettled([
    fetchSource(DAILY_POINTS_ID, "Daily points"),
    fetchSource(PRODUCT_VALIDATION_ID, "Product Validation"),
    fetchSource(MISSION_GOALS_ID, "Mission Goals"),
    fetchSource(BOARD_NOTES_ID, "Board Notes"),
  ]);

  const errors: SourceError[] = [];

  let daily: MissionPayload["daily"] = { T: [], N: [] };
  if (dailyResult.status === "fulfilled") {
    daily = shapeDaily(dailyResult.value, today);
  } else {
    const message =
      dailyResult.reason instanceof Error
        ? dailyResult.reason.message
        : String(dailyResult.reason);
    console.error("Error fetching Daily points:", message);
    errors.push({ source: "Daily points", error: message });
  }

  let weekly: MissionPayload["weekly"] = {
    validationsThisWeek: 0,
    testsLoggedThisWeek: 0,
    validationQueue: [],
  };
  if (weeklyResult.status === "fulfilled") {
    weekly = shapeWeekly(weeklyResult.value, weekStart, todayIso, today);
  } else {
    const message =
      weeklyResult.reason instanceof Error
        ? weeklyResult.reason.message
        : String(weeklyResult.reason);
    console.error("Error fetching Product Validation:", message);
    errors.push({ source: "Product Validation", error: message });
  }

  let goals: GoalsPayload = {
    weekly: { T: [], N: [], Both: [] },
    monthly: [],
    longTerm: [],
  };
  if (goalsResult.status === "fulfilled") {
    goals = shapeGoals(goalsResult.value);
  } else {
    const message =
      goalsResult.reason instanceof Error
        ? goalsResult.reason.message
        : String(goalsResult.reason);
    console.error("Error fetching Mission Goals:", message);
    errors.push({ source: "Mission Goals", error: message });
  }

  let notes: Note[] = [];
  if (notesResult.status === "fulfilled") {
    notes = shapeNotes(notesResult.value);
  } else {
    const message =
      notesResult.reason instanceof Error
        ? notesResult.reason.message
        : String(notesResult.reason);
    console.error("Error fetching Board Notes:", message);
    errors.push({ source: "Board Notes", error: message });
  }

  const payload: MissionPayload = {
    today: todayIso,
    weekStart,
    daily,
    weekly,
    goals,
    notes,
    errors,
  };

  // Every source down is an outage, not a quiet week: returning 200 would make a
  // dead token indistinguishable from a genuinely empty board to anything that
  // does not read `errors`. One survivor is still a 200 — that is the whole
  // point of degrading per section.
  const status = errors.length === SOURCE_COUNT ? 503 : 200;

  // One return serves both statuses, so the CORS pair is on the 503 by
  // construction rather than by remembering to repeat it.
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": NO_STORE, ...CORS_HEADERS },
  });
}

/**
 * CORS preflight. 204 with no body — the browser reads only the headers.
 *
 * Methods are GET and OPTIONS and nothing more: this route has no other verb,
 * and advertising one it does not implement is how a read-only surface starts
 * looking writable. No-store for the same reason every other path is: this file
 * caches nothing anywhere.
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": NO_STORE,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      ...CORS_HEADERS,
    },
  });
}
