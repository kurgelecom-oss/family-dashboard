import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";
import { HOUSEHOLD_TZ, zoneToday, daysBetween, isoDate, parseCivilDate } from "../../lib/time";

/* ────────────────────────────────────────────────────────────────────────────
   /api/cycle — the discreet 7-day tracker behind the small red nav button.

   Backed by public.cycle_starts (append-only; one row per button press).
   GET  → current state: activeDay 1–7 while a tracker is running, else null.
   POST → record today (Sydney) as a new start. Refused with 409 while a
          tracker is already active, so a stray second tap cannot restart it.

   Deliberately unlabeled in every response — this payload renders on a family
   TV. No history endpoint; trends stay in the table until someone asks.

   Same posture as /api/incident: force-dynamic, no-store. A wall display must
   never show yesterday's day count.
   ──────────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "cycle_starts";

/** Days the tracker stays visible, day 1 through day 7 inclusive. */
const ACTIVE_DAYS = 7;

interface CycleState {
  activeDay: number | null;
  startedOn: string | null;
}

async function readState(): Promise<CycleState | { error: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("started_on")
    .order("started_on", { ascending: false })
    .limit(1);

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { activeDay: null, startedOn: null };

  const startedOn = String(data[0].started_on);
  const started = parseCivilDate(startedOn);
  if (started === null) return { error: `unparseable started_on: ${startedOn}` };

  const since = daysBetween(started, zoneToday(new Date(), HOUSEHOLD_TZ));
  // Day 1 is the press day itself. Negative `since` (a future-dated row)
  // reads as not active rather than as a tracker that never expires.
  const activeDay = since >= 0 && since < ACTIVE_DAYS ? since + 1 : null;
  return { activeDay, startedOn };
}

export async function GET() {
  const state = await readState();
  if ("error" in state) {
    return NextResponse.json(state, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const state = await readState();
  if ("error" in state) {
    return NextResponse.json(state, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Mis-press protection: while a tracker is running the button is inert.
  if (state.activeDay !== null) {
    return NextResponse.json(state, {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const today = isoDate(zoneToday(new Date(), HOUSEHOLD_TZ));
  const { error } = await supabase.from(TABLE).insert({ started_on: today });
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { activeDay: 1, startedOn: today } satisfies CycleState,
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
