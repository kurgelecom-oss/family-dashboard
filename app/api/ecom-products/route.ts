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
   /api/ecom-products — product logs for one ecom week, plus the all-time
   disposition of everything ever logged.

   Read-only. One Notion source, no database, no Supabase.

   NOT app/api/ecom/route.ts, which already exists, reads Shopify and
   PocketSmith for revenue and P&L, and is untouched by this route.

   CACHING: force-dynamic, matching app/api/mission and app/api/homeschool.
   The force-static + revalidate pattern the other Notion routes use is wrong
   for anything taking a query parameter — a prerendered route sees empty search
   params and then serves that one body for every week. Measured doing exactly
   that on /api/homeschool before it was caught.
   ──────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";

/** "Product Validation Database". */
const PRODUCT_VALIDATION_DS = "1d35429a-fa90-81a0-bf47-000b7fe8803d";

/** Products logged in a week: three is the floor, five the stretch. */
const WEEKLY_TARGET = 3;
const WEEKLY_TARGET_MAX = 5;

/* ── disposition ─────────────────────────────────────────────────────────── */

/**
 * Every Select option, in the order the pipeline runs.
 *
 * Listed explicitly rather than discovered from the data so byStatus always
 * carries all eight keys — a status with no rows still reports 0 instead of
 * vanishing, which is what makes two runs comparable.
 */
const STATUSES = [
  "New",
  "Reviewing",
  "Shortlisted",
  "Tested",
  "Launched",
  "Rejected",
  "Dismissed",
] as const;

type Status = (typeof STATUSES)[number];

/** The key byStatus uses for a row whose Select is empty. */
const UNSET = "unset";

type Bucket = "launched" | "shortlisted" | "concluded" | "killed" | "untouched";

/**
 * Status → disposition. Locked mapping, and deliberately exhaustive: a value
 * that is not in here is not silently bucketed, it makes the count fail its own
 * assertion below. Adding a Select option in Notion must break loudly here
 * rather than quietly land in "untouched".
 *
 * Tested stands alone as `concluded`, and that separation is the point of this
 * mapping rather than an accident of it. A tested product is a test that RAN
 * AND FINISHED — it is history, and the pipeline has already moved past it.
 * Folding it in with Shortlisted and Launched read as momentum and made a
 * backlog of finished tests look like a live pipeline; 32 of the 60 rows are
 * Tested, so that single bucket choice was over half the picture.
 */
const DISPOSITION: Record<Status, Bucket> = {
  Launched: "launched",
  Shortlisted: "shortlisted",
  Tested: "concluded",
  Rejected: "killed",
  Dismissed: "killed",
  New: "untouched",
  Reviewing: "untouched",
};

/* ── Notion property readers ─────────────────────────────────────────────── */

function selectOf(prop: unknown): string | null {
  const p = prop as { select?: { name?: string } | null } | undefined;
  const name = p?.select?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
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

export interface EcomWeek {
  /** Sunday, `YYYY-MM-DD`. */
  weekStart: string;
  /** Saturday — the week_key itself, `YYYY-MM-DD`. */
  weekEnd: string;
}

/**
 * The seven days ENDING on the review Saturday: Sunday through Saturday.
 *
 * This is NOT the homeschool window and must not be made to match it.
 * /api/homeschool reviews the Mon–Fri school week that finished before the
 * Saturday, so its window ends the day BEFORE week_key. Product logging has no
 * school week and no flex day — it runs right up to the review itself, so the
 * Saturday is inside the window rather than after it. Same week_key, two
 * genuinely different questions.
 *
 * Arithmetic runs on app/lib/time's civil-date helpers, which anchor to UTC for
 * day counting and use Intl with Australia/Sydney for "what day is it". No
 * offset constant anywhere in this path: Sydney is UTC+10 half the year and
 * UTC+11 the other half, and a constant would slide the window by a day.
 */
export function ecomWeekOf(saturday: CivilDate): EcomWeek {
  return {
    weekStart: isoDate(addDays(saturday, -6)),
    weekEnd: isoDate(saturday),
  };
}

/* ── shaping ─────────────────────────────────────────────────────────────── */

export interface AllTime {
  total: number;
  launched: number;
  shortlisted: number;
  concluded: number;
  killed: number;
  untouched: number;
  /**
   * Rows with no Submission Date at all — currently 48 of 60.
   *
   * Reported because it is the answer to "why is loggedThisWeek zero". Without
   * it a zero reads as a quiet week; with it, a zero reads as a source where
   * most rows were never dated in the first place.
   */
  staleSubmissionDates: number;
  byStatus: Record<string, number>;
}

export interface EcomProducts extends EcomWeek {
  loggedThisWeek: number;
  target: number;
  targetMax: number;
  allTime: AllTime;
}

/**
 * Count one ecom week, and the whole pipeline behind it.
 *
 * byStatus is the raw per-option tally and exists to be checked against: the
 * three buckets are a lossy reading of it, so publishing both means a
 * disagreement is visible rather than something to take on trust.
 *
 * The three buckets are asserted to sum to total. That assertion is the point
 * of the exhaustive DISPOSITION map — an unrecognised Select option cannot be
 * absorbed into a bucket, so it lands nowhere, the sum breaks, and the route
 * fails loudly instead of quietly under-reporting a disposition.
 */
export function summariseProducts(pages: NotionPage[], week: EcomWeek): EcomProducts {
  const inWindow = (day: string | null) =>
    day !== null && day >= week.weekStart && day <= week.weekEnd;

  const byStatus: Record<string, number> = { [UNSET]: 0 };
  for (const s of STATUSES) byStatus[s] = 0;

  let loggedThisWeek = 0;
  let staleSubmissionDates = 0;
  let launched = 0;
  let shortlisted = 0;
  let concluded = 0;
  let killed = 0;
  let untouched = 0;

  for (const page of pages) {
    const props = page.properties ?? {};

    const submitted = dateOf(props["Submission Date"]);
    if (submitted === null) staleSubmissionDates++;
    else if (inWindow(submitted)) loggedThisWeek++;

    // All-time: every row counts, whatever its dates say.
    const status = selectOf(props["Select"]);

    if (status === null) {
      byStatus[UNSET]++;
      untouched++;
      continue;
    }

    // An option Notion has but this file does not still gets a byStatus entry,
    // so the audit trail names it — and gets no bucket, so the assertion trips.
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    switch (DISPOSITION[status as Status]) {
      case "launched":
        launched++;
        break;
      case "shortlisted":
        shortlisted++;
        break;
      case "concluded":
        concluded++;
        break;
      case "killed":
        killed++;
        break;
      case "untouched":
        untouched++;
        break;
    }
  }

  const total = pages.length;
  const bucketed = launched + shortlisted + concluded + killed + untouched;

  if (bucketed !== total) {
    const unknown = Object.keys(byStatus).filter((k) => k !== UNSET && !(k in DISPOSITION));
    throw new Error(
      `Disposition does not account for every row: ` +
        `launched ${launched} + shortlisted ${shortlisted} + concluded ${concluded} ` +
        `+ killed ${killed} + untouched ${untouched} = ${bucketed}, total ${total}.` +
        (unknown.length ? ` Unmapped Select options: ${unknown.join(", ")}.` : ""),
    );
  }

  return {
    ...week,
    loggedThisWeek,
    target: WEEKLY_TARGET,
    targetMax: WEEKLY_TARGET_MAX,
    allTime: {
      total,
      launched,
      shortlisted,
      concluded,
      killed,
      untouched,
      staleSubmissionDates,
      byStatus,
    },
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
     * week_key names a SATURDAY and the window is counted back from it. A
     * Wednesday would produce a Thursday-to-Wednesday window without
     * complaining — a silently wrong answer that looks entirely normal, which
     * is the worst shape a bug can take here. Rejected instead.
     */
    if (new Date(Date.UTC(saturday.y, saturday.m - 1, saturday.d)).getUTCDay() !== 6) {
      return NextResponse.json(
        { error: `week_key must be a Saturday; ${isoDate(saturday)} is not` },
        { status: 400 },
      );
    }

    const week = ecomWeekOf(saturday);
    const pages = await fetchSource(PRODUCT_VALIDATION_DS, "Product Validation Database");

    return NextResponse.json(summariseProducts(pages, week));
  } catch (error) {
    console.error("Error building ecom products payload:", error);
    return NextResponse.json({ error: "Failed to fetch ecom product data" }, { status: 500 });
  }
}
