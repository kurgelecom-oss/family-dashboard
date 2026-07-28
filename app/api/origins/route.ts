import { NextResponse } from "next/server";
import {
  CivilDate,
  daysBetween,
  isoDate,
  mondayOfWeek,
  parseCivilDate,
  zoneToday,
} from "../../lib/time";

/* ────────────────────────────────────────────────────────────────────────────
   /api/origins — read-only view of the ORIGINS course tracker.

   Caching follows /api/board, NOT /api/habits. `force-static` + `revalidate`
   prerenders the handler and bakes whatever it returned at build time: a build
   without NOTION_TOKEN would serve a permanently-failed payload as HTTP 200 for
   the full window. That is survivable for a single panel; it is not survivable
   here, because OriginsStrip renders on every route and a baked failure would
   kill the strip silently and invisibly across the whole dashboard.

   So: rendered per request, 300s declared per response, failure path never
   cached, plus a module-level cache that bounds how often Notion is actually
   queried however many requests arrive.
   ──────────────────────────────────────────────────────────────────────────── */
export const dynamic = "force-dynamic";

const ORIGINS_DATA_SOURCE = "3a3a6e65-2cb3-40ba-810a-b19406e8b085";
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";

const CACHE_FAIL = "no-store";
const SWR_SECONDS = 300;
const CACHE_TTL_MS = 300_000;

/** Lessons expected per lane, per week. */
export const WEEKLY_TARGET = 5;

/** Days without a completion before a lane is called silent. */
const SILENT_AFTER_DAYS = 5;

export type Owner = "taylan" | "nihal" | "both";
export type Lane = "taylan" | "nihal";
export type LaneState = "onpace" | "behind" | "build" | "silent";

/**
 * Owner is not a Notion property — it is a property of the module. Modules 7
 * and 8 belong to both lanes, so those rows are counted in each: they are work
 * both people are expected to do, not work to be split between them.
 */
export const OWNER_MAP: Record<number, Owner> = {
  1: "taylan", 2: "taylan", 5: "taylan", 9: "taylan", 10: "taylan", 11: "taylan",
  3: "nihal", 4: "nihal", 6: "nihal", 12: "nihal",
  7: "both", 8: "both",
};

export interface Row {
  pageId: string;
  lesson: string;
  module: string;
  moduleNo: number;
  lessonNo: number;
  type: string;
  status: string;
  done: boolean;
  completedOn: string | null;
  proof: string | null;
  owner: Owner;
}

export interface NextLesson {
  pageId: string;
  lesson: string;
  module: string;
  moduleNo: number;
  lessonNo: number;
  type: string;
  isBuild: boolean;
}

export interface LaneSummary {
  total: number;
  completed: number;
  thisWeek: number;
  weeklyTarget: number;
  daysSinceLast: number | null;
  next: NextLesson | null;
  state: LaneState;
}

export interface OriginsPayload {
  taylan: LaneSummary;
  nihal: LaneSummary;
  updatedAt: string;
}

/* ── Notion read ─────────────────────────────────────────────────────────── */

interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const titleOf = (p: any): string => p?.title?.[0]?.plain_text ?? "";
const selectOf = (p: any): string => p?.select?.name ?? "";

/**
 * Every row, following `has_more`. The data source holds 105 rows and Notion's
 * page size caps at 100, so this always paginates at least once — a single
 * unpaginated call would silently drop the tail and under-report both lanes.
 */
export async function fetchAllRows(): Promise<Row[]> {
  if (!NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");

  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const res = await fetch(
      `https://api.notion.com/v1/data_sources/${ORIGINS_DATA_SOURCE}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Notion ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages.map((page) => {
    const p = page.properties as Record<string, any>;
    const moduleNo = p["Module No"]?.number ?? 0;
    return {
      pageId: page.id,
      lesson: titleOf(p["Lesson"]),
      module: selectOf(p["Module"]),
      moduleNo,
      lessonNo: p["Lesson No"]?.number ?? 0,
      type: selectOf(p["Type"]),
      status: selectOf(p["Status"]),
      done: p["Done"]?.checkbox === true,
      completedOn: p["Completed On"]?.date?.start ?? null,
      proof: p["Proof"]?.url ?? null,
      // A module outside the map falls to "both" rather than silently to one
      // lane — an unowned row should surface in front of both people, not
      // disappear into one person's backlog.
      owner: OWNER_MAP[moduleNo] ?? "both",
    };
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Lane maths ──────────────────────────────────────────────────────────── */

export function summarise(rows: Row[], lane: Lane, today: CivilDate): LaneSummary {
  const mine = rows.filter((r) => r.owner === lane || r.owner === "both");
  const weekStart = mondayOfWeek(today);
  const completed = mine.filter((r) => r.done);

  // Monday 00:00 onward. A Completed On dated in the future still counts: it is
  // data entry, not a clock, and quietly dropping it would make the count lie.
  const thisWeek = completed.filter((r) => {
    const c = parseCivilDate(r.completedOn);
    return c !== null && daysBetween(weekStart, c) >= 0;
  }).length;

  const stamps = completed
    .map((r) => parseCivilDate(r.completedOn))
    .filter((c): c is CivilDate => c !== null);

  // Most recent completion. Clamped at 0 so a future-dated row reads as "today"
  // rather than a negative day count.
  const daysSinceLast = stamps.length
    ? Math.max(0, Math.min(...stamps.map((c) => daysBetween(c, today))))
    : null;

  // Lowest Module No, then lowest Lesson No, among rows not yet done.
  const next =
    mine
      .filter((r) => !r.done)
      .sort((a, b) => a.moduleNo - b.moduleNo || a.lessonNo - b.lessonNo)[0] ?? null;

  const isBuild = next?.type === "Action Item";

  // Precedence is fixed: silent beats build beats behind.
  // `daysSinceLast === null` (nothing ever completed) is NOT silent — silence is
  // measured from a last completion, and there isn't one to measure from.
  let state: LaneState;
  if (daysSinceLast !== null && daysSinceLast >= SILENT_AFTER_DAYS) state = "silent";
  else if (isBuild) state = "build";
  else if (thisWeek < WEEKLY_TARGET) state = "behind";
  else state = "onpace";

  return {
    total: mine.length,
    completed: completed.length,
    thisWeek,
    weeklyTarget: WEEKLY_TARGET,
    daysSinceLast,
    next: next
      ? {
          pageId: next.pageId,
          lesson: next.lesson,
          module: next.module,
          moduleNo: next.moduleNo,
          lessonNo: next.lessonNo,
          type: next.type,
          isBuild,
        }
      : null,
    state,
  };
}

/* ── Cache ───────────────────────────────────────────────────────────────── */

let cached: { payload: OriginsPayload; expiresAt: number } | null = null;

function cacheControlFor(entry: { expiresAt: number } | null): string {
  const remaining = entry ? Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)) : 0;
  return `public, s-maxage=${remaining}, stale-while-revalidate=${SWR_SECONDS}`;
}

/**
 * Dropped by the write route so a tick shows up on the next read instead of up
 * to 300s later. Only clears this server instance's copy — the CDN entry still
 * ages out on its own, which is why the strip refetches with `?refresh=1`.
 */
export function invalidateOriginsCache() {
  cached = null;
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";

  if (!force && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": cacheControlFor(cached),
        "X-Origins-Cache": "hit",
        "Netlify-Vary": "query=refresh",
      },
    });
  }

  try {
    const rows = await fetchAllRows();
    const today = zoneToday(new Date());

    const payload: OriginsPayload = {
      taylan: summarise(rows, "taylan", today),
      nihal: summarise(rows, "nihal", today),
      updatedAt: new Date().toISOString(),
    };

    cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": force ? CACHE_FAIL : cacheControlFor(cached),
        "X-Origins-Cache": "miss",
        "X-Origins-Today": isoDate(today),
        "X-Origins-Rows": String(rows.length),
        "Netlify-Vary": "query=refresh",
      },
    });
  } catch (error) {
    console.error("[/api/origins]", error);
    // 503 and never cached: a credential outage must not outlive its own cause,
    // and this strip is on every route.
    return NextResponse.json(
      { error: "origins_unavailable", message: String(error) },
      {
        status: 503,
        headers: { "Cache-Control": CACHE_FAIL, "Netlify-Vary": "query=refresh" },
      },
    );
  }
}
