import { NextResponse } from "next/server";
import {
  addDays,
  isoDate,
  parseCivilDate,
  saturdayOfWeek,
  zoneToday,
  type CivilDate,
} from "../../lib/time";
import { fetchSource, type NotionPage } from "../../lib/notion";

/* ────────────────────────────────────────────────────────────────────────────
   /api/homeschool — Ansar's work submissions for one school week.

   Read-only. One Notion source, no database, no Supabase.

   CACHING: force-dynamic, matching app/api/mission — the other Notion-backed
   routes (habits, schedule, settings, actions, dashboard-settings) are
   force-static with a revalidate window, and that pattern is WRONG here for one
   specific reason: every one of them takes zero query parameters. This route
   takes week_key. A force-static route is prerendered, its search params are
   empty at render time, and the cached body is then served for every week — it
   was measured doing exactly that, answering a request for 2026-08-22 with the
   2026-08-15 window and no error anywhere. A silently wrong week is the worst
   possible failure for a route whose entire job is bounding one.

   So the two Notion patterns in this repo are: static when the answer is the
   same for everyone, dynamic when it depends on the request. This is the
   second kind.
   ──────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";

/** "Work Log — Master Record". */
const WORK_LOG_DS = "3f93b40d-6cdc-44dc-9197-779758f9150c";

/**
 * Four learning days at four blocks each. Friday is flex and scores nothing,
 * which is why this is 16 and not 20 — the window still RUNS to Friday, because
 * work submitted on the flex day is still work; it just was not required.
 */
const EXPECTED_SUBMISSIONS = 16;

/** The eight numbered learning areas. "Not applicable" is not one of them. */
const LEARNING_AREAS_TOTAL = 8;

const LOG_TYPE_WORK = "Work submission";
const STUDENT = "Ansar";
const NOT_APPLICABLE = "Not applicable";
/** Seed rows are excluded outright — they are not work and not a data problem. */
const FLAG_SEED = "Test / seed data";

/* ── Notion property readers ─────────────────────────────────────────────── */

function selectOf(prop: unknown): string | null {
  const p = prop as { select?: { name?: string } | null } | undefined;
  const name = p?.select?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

function checkboxOf(prop: unknown): boolean {
  const p = prop as { checkbox?: boolean } | undefined;
  return p?.checkbox === true;
}

/**
 * A date property's start, as a civil `YYYY-MM-DD`.
 *
 * Sliced to ten characters because Notion returns either a bare date or a full
 * timestamp depending on how the row was written, and the day is the only part
 * this route has any use for.
 */
function dateOf(prop: unknown): string | null {
  const p = prop as { date?: { start?: string } | null } | undefined;
  const start = p?.date?.start;
  return typeof start === "string" && start.length >= 10 ? start.slice(0, 10) : null;
}

/* ── the week window ─────────────────────────────────────────────────────── */

export interface SchoolWeek {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: string;
  /** Friday, `YYYY-MM-DD`. */
  weekEnd: string;
}

/**
 * The Monday–Friday immediately BEFORE the review Saturday.
 *
 * week_key names the Saturday the review happens on, and the work being
 * reviewed is the week that has just finished — so Monday is five days back and
 * Friday is one. Both ends inclusive.
 *
 * The arithmetic runs on app/lib/time's civil-date helpers, which anchor to UTC
 * for day counting and use Intl with Australia/Sydney for "what day is it".
 * There is no offset constant anywhere in this path, and there must not be:
 * Sydney is UTC+10 for half the year and UTC+11 for the other half, and a
 * hardcoded offset would slide the window by a day for months at a time.
 */
export function schoolWeekOf(saturday: CivilDate): SchoolWeek {
  return {
    weekStart: isoDate(addDays(saturday, -5)),
    weekEnd: isoDate(addDays(saturday, -1)),
  };
}

/* ── shaping ─────────────────────────────────────────────────────────────── */

export interface HomeschoolWeek extends SchoolWeek {
  submissions: number;
  expected: number;
  areasCovered: string[];
  areasCount: number;
  areasTotal: number;
  withoutEvidence: number;
  backfilled: number;
  flagged: number;
}

/**
 * Count one school week out of the whole log.
 *
 * The filter is applied HERE rather than as a Notion query filter: fetchSource
 * reads a data source whole, and the log is small enough that one read plus a
 * local filter is cheaper than a bespoke query — and far easier to reason about
 * when a count looks wrong, because every row is in hand.
 *
 * `Date of work` is the truth and the "Week" select column is ignored on
 * purpose. Week is hand-set and drifts; a row typed into the wrong week would
 * otherwise land in the wrong review, which is exactly the failure this route
 * exists to make visible.
 */
export function summariseWeek(pages: NotionPage[], week: SchoolWeek): HomeschoolWeek {
  const areas = new Set<string>();
  let submissions = 0;
  let withoutEvidence = 0;
  let backfilled = 0;
  let flagged = 0;

  for (const page of pages) {
    const props = page.properties ?? {};

    if (selectOf(props["Log type"]) !== LOG_TYPE_WORK) continue;
    if (selectOf(props["Student"]) !== STUDENT) continue;

    const flag = selectOf(props["Flag"]);
    if (flag === FLAG_SEED) continue;

    // Inclusive both ends. Plain string comparison is correct and total on
    // zero-padded YYYY-MM-DD, which is the only form dateOf returns.
    const day = dateOf(props["Date of work"]);
    if (day === null) continue;
    if (day < week.weekStart || day > week.weekEnd) continue;

    submissions++;
    if (!checkboxOf(props["Has evidence"])) withoutEvidence++;
    if (checkboxOf(props["Backfilled"])) backfilled++;
    // Seed rows already left above, so any surviving flag is a real one.
    if (flag !== null) flagged++;

    const area = selectOf(props["Learning area"]);
    if (area !== null && area !== NOT_APPLICABLE) areas.add(area);
  }

  // Sorted so the list is stable between requests — the option names are
  // number-prefixed precisely so this orders the way the curriculum does.
  const areasCovered = [...areas].sort();

  return {
    ...week,
    submissions,
    expected: EXPECTED_SUBMISSIONS,
    areasCovered,
    areasCount: areasCovered.length,
    areasTotal: LEARNING_AREAS_TOTAL,
    withoutEvidence,
    backfilled,
    flagged,
  };
}

/* ── handler ─────────────────────────────────────────────────────────────── */

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("week_key");

    // Defaults to the current review week, so the route is useful without a
    // parameter and callers that already hold a week_key stay authoritative.
    const saturday = raw === null ? saturdayOfWeek(zoneToday(new Date())) : parseCivilDate(raw);

    if (saturday === null) {
      return NextResponse.json({ error: "week_key must be a YYYY-MM-DD date" }, { status: 400 });
    }

    /*
     * week_key names a SATURDAY, and the whole window is derived by counting
     * backwards from it. A Wednesday would produce a Friday-to-Tuesday window
     * without complaining — a silently wrong answer that looks entirely normal,
     * which is the worst shape a bug can take here. Rejected instead.
     */
    if (new Date(Date.UTC(saturday.y, saturday.m - 1, saturday.d)).getUTCDay() !== 6) {
      return NextResponse.json(
        { error: `week_key must be a Saturday; ${isoDate(saturday)} is not` },
        { status: 400 },
      );
    }

    const week = schoolWeekOf(saturday);
    const pages = await fetchSource(WORK_LOG_DS, "Work Log — Master Record");

    return NextResponse.json(summariseWeek(pages, week));
  } catch (error) {
    console.error("Error building homeschool payload:", error);
    return NextResponse.json({ error: "Failed to fetch homeschool data" }, { status: 500 });
  }
}
