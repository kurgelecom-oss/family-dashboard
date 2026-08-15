/* ────────────────────────────────────────────────────────────────────────────
   Civil-date arithmetic in a named IANA zone.

   Lifted (behaviour-identical) from the private helpers in
   app/api/pocketsmith/route.ts, which is the most rigorous of the four AEST
   implementations in this repo. That route still carries its own copy — this
   module is the shared home for new code, and pocketsmith should be pointed at
   it in a separate, deliberate change rather than as a side effect of the
   ORIGINS build.

   The other three implementations, for the record:
     - getAestHour()  in Header.tsx / week/page.tsx — hour only, client only
     - getTodayDate() in lib/supabase.ts            — Australia/Melbourne
     - todayIn()      in api/actions/route.ts       — same shape, private
   ──────────────────────────────────────────────────────────────────────────── */

export interface CivilDate {
  y: number;
  m: number; // 1-12
  d: number;
}

/** The zone the household runs on. Same offset and DST rules as Melbourne. */
export const HOUSEHOLD_TZ = "Australia/Sydney";

/**
 * Today's calendar date as seen in `timeZone`.
 *
 * Intl does the zone conversion, so this stays correct across the AEST/AEDT
 * boundary. Do NOT reintroduce a hardcoded UTC+10 offset here — that silently
 * reports the wrong day for the ~5 months Sydney is on AEDT (UTC+11), which
 * would shift the Mon–Sun window by a whole day.
 */
export function zoneToday(now: Date, timeZone: string = HOUSEHOLD_TZ): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const part = (type: string) => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return a ${type} part`);
    return Number(found.value);
  };

  return { y: part("year"), m: part("month"), d: part("day") };
}

// Calendar arithmetic below is done on a UTC anchor. A civil date's day-of-week
// and day-count arithmetic are zone-independent, so anchoring to UTC keeps the
// maths DST-proof — the only zone-aware step is zoneToday() above.
const toAnchor = (c: CivilDate) => new Date(Date.UTC(c.y, c.m - 1, c.d));

const fromAnchor = (d: Date): CivilDate => ({
  y: d.getUTCFullYear(),
  m: d.getUTCMonth() + 1,
  d: d.getUTCDate(),
});

export function addDays(c: CivilDate, days: number): CivilDate {
  const anchor = toAnchor(c);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return fromAnchor(anchor);
}

/** `YYYY-MM-DD`. */
export const isoDate = (c: CivilDate) =>
  `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;

/** Monday of the ISO week containing `c`. */
export function mondayOfWeek(c: CivilDate): CivilDate {
  const dow = toAnchor(c).getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0 … Sun=6
  return addDays(c, -daysSinceMonday);
}

/**
 * Whole days from `from` to `to`, both civil dates. Negative if `to` precedes
 * `from`. Uses the same UTC anchor, so DST never adds or drops an hour that
 * could round a day boundary the wrong way.
 */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  const ms = toAnchor(to).getTime() - toAnchor(from).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * The ISO-8601 week key containing `c` — `2026-W33`.
 *
 * Built on mondayOfWeek() rather than beside it: there is exactly one
 * Monday-start rule in this repo and this reuses it instead of restating it.
 *
 * The year in the key is the ISO WEEK-year, not the calendar year, and the two
 * genuinely differ at the turn: 2027-01-01 is a Friday, so it belongs to the
 * week whose Thursday is 2026-12-31 and its key is `2026-W53`. Taking the
 * calendar year instead would emit `2027-W53`, a key that does not exist and
 * which would strand that week's ticks in a row nothing ever reads back.
 * Anchoring on the week's Thursday is what makes the week-year correct: the
 * Thursday always falls in the ISO year the whole week belongs to.
 */
export function isoWeekKey(c: CivilDate): string {
  const thursday = addDays(mondayOfWeek(c), 3);
  const jan1: CivilDate = { y: thursday.y, m: 1, d: 1 };
  const week = Math.floor(daysBetween(jan1, thursday) / 7) + 1;
  return `${thursday.y}-W${String(week).padStart(2, "0")}`;
}

/**
 * Parse a `YYYY-MM-DD` prefix into a CivilDate.
 *
 * Notion date values arrive either bare ("2026-07-28") or with a time and
 * offset ("2026-07-28T09:00:00.000+10:00"). Slicing to the date prefix keeps
 * the calendar date exactly as Notion recorded it and never re-interprets it
 * through the server's zone. Returns null on anything that is not a real date.
 */
export function parseCivilDate(value: string | null | undefined): CivilDate | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const c = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  // Reject impossible dates (e.g. 2026-02-31) by round-tripping the anchor.
  const back = fromAnchor(toAnchor(c));
  if (back.y !== c.y || back.m !== c.m || back.d !== c.d) return null;
  return c;
}
