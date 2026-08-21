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

/* ────────────────────────────────────────────────────────────────────────────
   /api/cycle — the discreet 7-day tracker behind the small red nav button.

   Backed by public.cycle_starts (append-only; one row per button press).
   GET  → current state: activeDay 1–7 while a tracker is running, else null,
          plus expectedInDays when the NEXT start is predicted within ±3 days
          (needs at least two recorded starts to have a gap to average).
   POST → record today (Sydney) as a new start. Refused with 409 while a
          tracker is already active, so a stray second tap cannot restart it.

   Deliberately unlabeled in every response — this payload renders on a family
   TV. No history endpoint; trends stay in the table until someone asks.

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

/** Days the tracker stays visible, day 1 through day 7 inclusive. */
const ACTIVE_DAYS = 7;

/** How many recent starts feed the prediction. */
const HISTORY_LIMIT = 12;

/** A gap outside this range is a data blip, not a cycle — it is ignored. */
const SANE_GAP_MIN = 15;
const SANE_GAP_MAX = 60;

/** The heads-up shows this many days either side of the expected start. */
const HEADS_UP_WINDOW = 3;

const ALLOWED_ORIGIN = "https://jade-bombolone-82d172.netlify.app";

const BASE_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Vary": "Origin",
  "Cache-Control": "no-store",
} as const;

interface CycleState {
  activeDay: number | null;
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
    return { activeDay: null, startedOn: null, expectedInDays: null };
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
  // Day 1 is the press day itself. Negative `since` (a future-dated row)
  // reads as not active rather than as a tracker that never expires.
  const activeDay = since >= 0 && since < ACTIVE_DAYS ? since + 1 : null;

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

  return { activeDay, startedOn: isoDate(latest), expectedInDays };
}

export async function GET() {
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

  return respond(
    { activeDay: 1, startedOn: today, expectedInDays: null } satisfies CycleState,
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
