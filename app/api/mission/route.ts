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
   /api/mission — read-only. Two Notion sources, no database, no Supabase.

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

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 10_000;

const DAILY_POINTS_ID = "4431302a-75ed-479f-a5f4-3bfd5e0a4e68";
const PRODUCT_VALIDATION_ID = "1d35429a-fa90-81a0-bf47-000b7fe8803d";

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

export interface SourceError {
  source: string;
  error: string;
}

export interface MissionPayload {
  today: string;
  weekStart: string;
  daily: { T: DailyPoint[]; N: DailyPoint[] };
  weekly: {
    validationsThisWeek: number;
    testsLoggedThisWeek: number;
    validationQueue: QueuedValidation[];
  };
  errors: SourceError[];
}

/* ── Notion property readers ─────────────────────────────────────────────────
   Written tolerant of the underlying property TYPE on purpose. The two data
   sources below are not currently shared with the integration this token
   belongs to, so their schemas could not be inspected while building — only
   their property NAMES are known, from the spec. A reader that accepts
   status|select|multi_select|people|rich_text|title for a text field costs
   nothing and means the route starts returning real rows the moment the
   databases are shared, without a second deploy to correct a type guess.
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
        name: textOf(propOf(row, "Name", "Product", "Title")) || "(untitled)",
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

/* ── handler ─────────────────────────────────────────────────────────────── */

export async function GET() {
  const today = zoneToday(new Date());
  const todayIso = isoDate(today);
  const weekStart = isoDate(mondayOfWeek(today));

  // Settled, not raced: Daily and Weekly are independent sections and one dead
  // source must degrade only itself. A 500 here would take down a page whose
  // other half is perfectly healthy.
  const [dailyResult, weeklyResult] = await Promise.allSettled([
    fetchSource(DAILY_POINTS_ID, "Daily points"),
    fetchSource(PRODUCT_VALIDATION_ID, "Product Validation"),
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

  const payload: MissionPayload = { today: todayIso, weekStart, daily, weekly, errors };

  // Both sources down is an outage, not a quiet week: returning 200 would make a
  // dead token indistinguishable from a genuinely empty board to anything that
  // does not read `errors`. One survivor is still a 200 — that is the whole
  // point of degrading per section.
  const status = errors.length === 2 ? 503 : 200;

  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": NO_STORE },
  });
}
