import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";
import {
  HOUSEHOLD_TZ,
  zoneToday,
  daysBetween,
  addDays,
  isoDate,
  parseCivilDate,
  type CivilDate,
} from "../../lib/time";
import { cycleDurationDays } from "../../lib/cycle-duration";

/* ────────────────────────────────────────────────────────────────────────────
   /api/cycle — the discreet cycle tracker behind the small red nav button.

   Backed by public.cycle_starts (append-only; one row per button press).
   GET  → current state while a tracker is running, else activeDay null,
          plus expectedInDays when the NEXT start is predicted within ±3 days
          (needs at least two recorded starts to have a gap to average).
   POST → record today (Sydney) as a new start. Refused with 409 while a
          tracker is already active, so a stray second tap cannot restart it.

   Deliberately unlabeled in every response — this payload renders on a family
   TV. GET ?history=1 returns the full log with per-gap lengths and summary
   stats; it feeds the long-press panel behind the button and nothing renders
   from it unless someone deliberately opens that panel.

   CORS: the mission page (jade-bombolone) carries the same button, so this
   route allows exactly that one browser origin — same posture as /api/mission,
   for the same reason: exact origin, never "*", Vary: Origin always. The POST
   is a simple request (no custom headers, no body), so no preflight fires, but
   OPTIONS is answered anyway so a future header can't silently break it.

   Same caching posture as /api/incident: force-dynamic, no-store. A wall
   display must never show yesterday's day count.
   ──────────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "cycle_starts";

/** How many recent starts feed the prediction. */
const HISTORY_LIMIT = 12;

/** How many starts the ?history=1 log returns — ten years of monthly presses. */
const FULL_HISTORY_LIMIT = 120;

/** A gap outside this range is a data blip, not a cycle — it is ignored. */
const SANE_GAP_MIN = 15;
const SANE_GAP_MAX = 60;

/** The heads-up shows this many days either side of the expected start. */
const HEADS_UP_WINDOW = 3;

const ALLOWED_ORIGIN = "https://jade-bombolone-82d172.netlify.app";

/* ── Notion mirror ───────────────────────────────────────────────────────────
   Every successful press also lands a row in the "Cycle Log" database on the
   Cycle page (NIHAL → Home Hub), so the history is readable in Notion next to
   the operating guide. Best-effort by design: Supabase stays the source of
   truth, and a Notion failure must never break the button — every call here
   is wrapped, bounded by a timeout, and ignored on error.

   The data-source id is not a secret (useless without NOTION_TOKEN, which
   lives in Netlify env like every other Notion route here uses). */
const NOTION_CYCLE_SOURCE = "ae2a2c28-b967-4ce4-bde2-59ca193ed874";
const NOTION_TIMEOUT_MS = 4000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function notionHeaders(token: string) {
  return {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": "2025-09-03",
    "Content-Type": "application/json",
  };
}

/** Create the new start's row, and stamp the finished cycle's length onto the
    previous row (found by its exact start date). */
async function mirrorToNotion(todayIso: string, prevIso: string | null): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  if (!token) return;

  try {
    const month = MONTHS[Number(todayIso.slice(5, 7)) - 1] ?? "";
    await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: NOTION_CYCLE_SOURCE },
        properties: {
          "Name": { title: [{ text: { content: `${month} ${todayIso.slice(0, 4)}` } }] },
          "Start date": { date: { start: todayIso } },
          "Source": { select: { name: "Red button" } },
          "Within normal range": { select: { name: "Pending next press" } },
        },
      }),
    });
  } catch {
    // Mirror only; the press already succeeded in Supabase.
  }

  if (prevIso === null) return;
  try {
    const prev = parseCivilDate(prevIso);
    const today = parseCivilDate(todayIso);
    if (prev === null || today === null) return;
    const gap = daysBetween(prev, today);
    const verdict =
      gap >= 21 && gap <= 35 ? "Yes"
      : gap >= SANE_GAP_MIN && gap <= SANE_GAP_MAX ? "Watch"
      : "Excluded blip";

    const query = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_CYCLE_SOURCE}/query`, {
      method: "POST",
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      body: JSON.stringify({
        page_size: 1,
        filter: { property: "Start date", date: { equals: prevIso } },
      }),
    });
    if (!query.ok) return;
    const rows = (await query.json()) as { results?: { id?: string }[] };
    const pageId = rows.results?.[0]?.id;
    if (!pageId) return;

    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: notionHeaders(token),
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      body: JSON.stringify({
        properties: {
          "Cycle length (days)": { number: gap },
          "Within normal range": { select: { name: verdict } },
        },
      }),
    });
  } catch {
    // Same posture: the length backfills by hand if this ever misses.
  }
}

const BASE_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Vary": "Origin",
  "Cache-Control": "no-store",
} as const;

interface CycleState {
  activeDay: number | null;
  totalDays: number | null;
  startedOn: string | null;
  /** Signed days until the predicted next start, only within ±HEADS_UP_WINDOW
      and only while no tracker is active; otherwise null. Negative = overdue. */
  expectedInDays: number | null;
}

function respond(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: BASE_HEADERS });
}

async function readState(): Promise<CycleState | { error: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("started_on")
    .order("started_on", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { activeDay: null, totalDays: null, startedOn: null, expectedInDays: null };
  }

  const starts: CivilDate[] = [];
  for (const row of data) {
    const parsed = parseCivilDate(String(row.started_on));
    if (parsed === null) return { error: `unparseable started_on: ${row.started_on}` };
    starts.push(parsed);
  }

  const today = zoneToday(new Date(), HOUSEHOLD_TZ);
  const latest = starts[0];
  const since = daysBetween(latest, today);
  const latestIso = isoDate(latest);
  const durationDays = cycleDurationDays(latestIso);
  // Day 1 is the press day itself. Negative `since` (a future-dated row)
  // reads as not active rather than as a tracker that never expires.
  const activeDay = since >= 0 && since < durationDays ? since + 1 : null;

  /* Prediction: average the sane gaps between consecutive starts (newest-first
     rows, so gap = row[i] - row[i+1]). One sane gap is enough to predict, more
     just steadies the average. Suppressed entirely while a tracker is active —
     the pill already owns the surface. */
  let expectedInDays: number | null = null;
  if (activeDay === null) {
    const gaps: number[] = [];
    for (let i = 0; i + 1 < starts.length; i++) {
      const gap = daysBetween(starts[i + 1], starts[i]);
      if (gap >= SANE_GAP_MIN && gap <= SANE_GAP_MAX) gaps.push(gap);
    }
    if (gaps.length > 0) {
      const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      const expected = addDays(latest, avg);
      const delta = daysBetween(today, expected);
      if (Math.abs(delta) <= HEADS_UP_WINDOW) expectedInDays = delta;
    }
  }

  return {
    activeDay,
    totalDays: activeDay === null ? null : durationDays,
    startedOn: latestIso,
    expectedInDays,
  };
}

/* ?history=1 payload. Gaps outside the sane range appear in the log (flagged
   sane: false) but never feed the stats — a data blip stays visible without
   skewing the averages. */
interface CycleHistoryEntry {
  startedOn: string;
  /** Days until the NEXT recorded start; null for the latest entry. */
  gapDays: number | null;
  sane: boolean;
}

interface CycleHistory {
  entries: CycleHistoryEntry[]; // newest first
  count: number;
  avgGap: number | null;
  minGap: number | null;
  maxGap: number | null;
  lastStart: string | null;
  /** lastStart + avgGap, the projected next press. */
  expectedNext: string | null;
  /** Days from today until expectedNext; negative = overdue. */
  expectedInDays: number | null;
}

async function readHistory(): Promise<CycleHistory | { error: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("started_on")
    .order("started_on", { ascending: false })
    .limit(FULL_HISTORY_LIMIT);

  if (error) return { error: error.message };

  const starts: CivilDate[] = [];
  for (const row of data ?? []) {
    const parsed = parseCivilDate(String(row.started_on));
    if (parsed === null) return { error: `unparseable started_on: ${row.started_on}` };
    starts.push(parsed);
  }

  const entries: CycleHistoryEntry[] = [];
  const saneGaps: number[] = [];
  for (let i = 0; i < starts.length; i++) {
    // Newest-first rows: the gap belonging to row i is the distance forward
    // to the next-newer start, so the latest row has no gap yet.
    const gap = i === 0 ? null : daysBetween(starts[i], starts[i - 1]);
    const sane = gap !== null && gap >= SANE_GAP_MIN && gap <= SANE_GAP_MAX;
    if (gap !== null && sane) saneGaps.push(gap);
    entries.push({ startedOn: isoDate(starts[i]), gapDays: gap, sane });
  }

  let avgGap: number | null = null;
  let expectedNext: string | null = null;
  let expectedInDays: number | null = null;
  if (saneGaps.length > 0) {
    avgGap = Math.round(saneGaps.reduce((a, b) => a + b, 0) / saneGaps.length);
    const expected = addDays(starts[0], avgGap);
    expectedNext = isoDate(expected);
    expectedInDays = daysBetween(zoneToday(new Date(), HOUSEHOLD_TZ), expected);
  }

  return {
    entries,
    count: starts.length,
    avgGap,
    minGap: saneGaps.length > 0 ? Math.min(...saneGaps) : null,
    maxGap: saneGaps.length > 0 ? Math.max(...saneGaps) : null,
    lastStart: starts.length > 0 ? isoDate(starts[0]) : null,
    expectedNext,
    expectedInDays,
  };
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("history") === "1") {
    const history = await readHistory();
    if ("error" in history) return respond(history, 503);
    return respond(history);
  }
  const state = await readState();
  if ("error" in state) return respond(state, 503);
  return respond(state);
}

export async function POST() {
  const state = await readState();
  if ("error" in state) return respond(state, 503);

  // Mis-press protection: while a tracker is running the button is inert.
  if (state.activeDay !== null) return respond(state, 409);

  const today = isoDate(zoneToday(new Date(), HOUSEHOLD_TZ));
  const { error } = await supabase.from(TABLE).insert({ started_on: today });
  if (error) return respond({ error: error.message }, 503);

  // Awaited (serverless kills work after the response), but never fatal.
  await mirrorToNotion(today, state.startedOn);

  return respond(
    {
      activeDay: 1,
      totalDays: cycleDurationDays(today),
      startedOn: today,
      expectedInDays: null,
    } satisfies CycleState,
    201,
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...BASE_HEADERS,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
