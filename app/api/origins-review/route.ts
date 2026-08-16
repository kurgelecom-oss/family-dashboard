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
   /api/origins-review — one review week of the ORIGINS course, per lane, plus
   the state of every action item.

   Read-only. One Notion source, no database, no Supabase.

   RELATIONSHIP TO /api/origins — they read the SAME data source
   (3a3a6e65-2cb3-40ba-810a-b19406e8b085) and this route does not replace it.
   /api/origins answers "where is each lane right now" for OriginsStrip: next
   lesson, days since last completion, silent/build state, and a thisWeek count
   over the ISO Monday–Sunday week with no parameter. This route answers a
   different question for the weekly review: a named week_key, the Sunday–
   Saturday window ending on it, and the action-item backlog including rows that
   claim to be complete without proof. Neither count substitutes for the other,
   and the two thisWeek figures WILL differ — they are cut from different weeks
   by design, not by accident.
   ──────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";

/** "Origins Lesson Index" — the same source /api/origins reads. */
const ORIGINS_LESSON_INDEX_DS = "3a3a6e65-2cb3-40ba-810a-b19406e8b085";

/** Lessons expected per lane, per week. Mirrors WEEKLY_TARGET in /api/origins. */
const WEEKLY_TARGET = 5;

/** Rows that count toward a lane's weekly lesson total. Action Items do not. */
const LESSON_TYPES = new Set(["Training", "New/Updated"]);
const TYPE_ACTION_ITEM = "Action Item";

const STATUS_COMPLETE = "Complete";
const STATUS_IN_PROGRESS = "In Progress";
const STATUS_NOT_STARTED = "Not Started";

/** Every Status the index is allowed to carry. Anything else throws. */
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  STATUS_NOT_STARTED,
  STATUS_IN_PROGRESS,
  STATUS_COMPLETE,
]);

/** The two lanes. A row with no Completed By is counted, but not against a target. */
const LANES = ["Taylan", "Nihal"] as const;

/* ── Notion property readers ─────────────────────────────────────────────── */

function selectOf(prop: unknown): string | null {
  const p = prop as { select?: { name?: string } | null } | undefined;
  const name = p?.select?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

/** A url property, or null when absent OR present-but-blank. */
function urlOf(prop: unknown): string | null {
  const p = prop as { url?: string | null } | undefined;
  const u = p?.url;
  return typeof u === "string" && u.trim() !== "" ? u.trim() : null;
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

export interface ReviewWeek {
  /** Sunday, `YYYY-MM-DD`. */
  weekStart: string;
  /** Saturday — the week_key itself, `YYYY-MM-DD`. */
  weekEnd: string;
}

/**
 * The seven days ENDING on the review Saturday: Sunday through Saturday.
 *
 * Same shape as /api/ecom-products and deliberately NOT the homeschool window,
 * which ends the day before week_key because a school week finishes on Friday.
 * Course lessons run right up to the review itself, so the Saturday is inside
 * the window.
 *
 * Arithmetic runs on app/lib/time's civil-date helpers, which anchor to UTC for
 * day counting and use Intl with Australia/Sydney for "what day is it". No
 * offset constant anywhere in this path: Sydney is UTC+10 half the year and
 * UTC+11 the other half, and a constant would slide the window by a day.
 */
export function reviewWeekOf(saturday: CivilDate): ReviewWeek {
  return {
    weekStart: isoDate(addDays(saturday, -6)),
    weekEnd: isoDate(saturday),
  };
}

/* ── shaping ─────────────────────────────────────────────────────────────── */

export interface LaneCount {
  lessonsThisWeek: number;
  target: number;
}

export interface OriginsReview extends ReviewWeek {
  lanes: {
    Taylan: LaneCount;
    Nihal: LaneCount;
    /** No target: unattributed work is a data problem, not someone's quota. */
    unassigned: { lessonsThisWeek: number };
  };
  actionItems: {
    total: number;
    complete: number;
    outstanding: number;
    /** Status says Complete, Proof is empty. The subset driving outstanding up. */
    completeWithoutProof: number;
  };
  allTime: {
    total: number;
    complete: number;
    inProgress: number;
    notStarted: number;
  };
}

/**
 * One review week, plus the action-item backlog behind it.
 *
 * STATUS IS THE TRUTH AND `Done` IS NOT READ. The index carries both a Status
 * select and a Done checkbox for the same fact and they disagree on real rows.
 * Reading "whichever is set", or requiring both to agree, would produce a number
 * nobody could reconcile against the Notion view — so exactly one column wins
 * and the other is not touched anywhere in this file.
 *
 * An action item is complete only when Status says Complete AND a Proof URL
 * exists. Everything else is outstanding — including a row marked Complete with
 * no proof, which is precisely the case worth surfacing: it looks finished on
 * the board and is not evidenced.
 */
export function summariseOrigins(pages: NotionPage[], week: ReviewWeek): OriginsReview {
  const inWindow = (day: string | null) =>
    day !== null && day >= week.weekStart && day <= week.weekEnd;

  const lessons: Record<string, number> = { Taylan: 0, Nihal: 0, unassigned: 0 };

  let aiTotal = 0;
  let aiComplete = 0;
  let aiOutstanding = 0;
  let aiCompleteWithoutProof = 0;

  let complete = 0;
  let inProgress = 0;
  let notStarted = 0;

  const unknownStatuses = new Set<string>();

  for (const page of pages) {
    const props = page.properties ?? {};

    const type = selectOf(props["Type"]);
    const status = selectOf(props["Status"]);
    const proof = urlOf(props["Proof"]);

    // A Status the index is not supposed to have is collected rather than
    // guessed at; the throw below names every one of them at once.
    if (status !== null && !KNOWN_STATUSES.has(status)) unknownStatuses.add(status);

    // All-time status split, across every row whatever its type. An empty
    // Status reads as not started — nothing has happened to that row.
    if (status === STATUS_COMPLETE) complete++;
    else if (status === STATUS_IN_PROGRESS) inProgress++;
    else if (status === STATUS_NOT_STARTED || status === null) notStarted++;

    if (type === TYPE_ACTION_ITEM) {
      aiTotal++;
      const evidenced = status === STATUS_COMPLETE && proof !== null;
      if (evidenced) aiComplete++;
      else aiOutstanding++;
      if (status === STATUS_COMPLETE && proof === null) aiCompleteWithoutProof++;
      // Action items never reach the lane counts — keeping them out is the
      // whole reason they are tallied separately.
      continue;
    }

    if (type !== null && !LESSON_TYPES.has(type)) continue;
    if (status !== STATUS_COMPLETE) continue;
    if (!inWindow(dateOf(props["Completed On"]))) continue;

    const lane = selectOf(props["Completed By"]);
    const key = lane !== null && (LANES as readonly string[]).includes(lane) ? lane : "unassigned";
    lessons[key]++;
  }

  if (unknownStatuses.size > 0) {
    throw new Error(
      `Unmapped Status value(s) in the Origins Lesson Index: ` +
        `${[...unknownStatuses].sort().join(", ")}. ` +
        `Expected one of: ${[...KNOWN_STATUSES].join(", ")}.`,
    );
  }

  if (aiComplete + aiOutstanding !== aiTotal) {
    throw new Error(
      `Action items do not balance: complete ${aiComplete} + outstanding ` +
        `${aiOutstanding} = ${aiComplete + aiOutstanding}, total ${aiTotal}.`,
    );
  }

  return {
    ...week,
    lanes: {
      Taylan: { lessonsThisWeek: lessons.Taylan, target: WEEKLY_TARGET },
      Nihal: { lessonsThisWeek: lessons.Nihal, target: WEEKLY_TARGET },
      unassigned: { lessonsThisWeek: lessons.unassigned },
    },
    actionItems: {
      total: aiTotal,
      complete: aiComplete,
      outstanding: aiOutstanding,
      completeWithoutProof: aiCompleteWithoutProof,
    },
    allTime: { total: pages.length, complete, inProgress, notStarted },
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

    const week = reviewWeekOf(saturday);
    const pages = await fetchSource(ORIGINS_LESSON_INDEX_DS, "Origins Lesson Index");

    return NextResponse.json(summariseOrigins(pages, week));
  } catch (error) {
    console.error("Error building origins review payload:", error);
    return NextResponse.json({ error: "Failed to fetch origins review data" }, { status: 500 });
  }
}
