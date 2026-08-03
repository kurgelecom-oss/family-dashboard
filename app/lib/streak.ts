/* ════════════════════════════════════════════════════════════════════════════
   ANSAR FC day streak — the single canonical implementation.

   MIRRORED FILE. This file exists byte-for-byte identical in two repos:

         family-dashboard/app/lib/streak.ts
         ansar-habits-tracker/app/lib/streak.ts

   BOTH COPIES MUST STAY IDENTICAL, for the same reason scoring.ts must: they
   are separate deploys reading the same Supabase `habit_completions` rows, so a
   change to one alone makes the same history report a different streak
   depending on which screen you look at. Change one, copy to the other, and run
   scripts/check-scoring-sync.sh before committing.

   That drift is not hypothetical — it is why this file exists. The rule used to
   live inline in three places (the tracker's board, and the dashboard's
   WeekProgressStrip and PanelHabits), kept in agreement by a comment reading
   "same rule as the tracker". When the tracker moved to a weekday-only streak,
   the other two silently kept the old calendar-day rule and reported 8 where
   the tracker reported 14.

   SELF-CONTAINED ON PURPOSE. No imports, exactly like scoring.ts. The two repos
   have incompatible time modules — the tracker's app/lib/time.ts works on
   "YYYY-MM-DD" strings, the dashboard's works on CivilDate objects — so a
   shared file importing either one could not be byte-identical in both. The
   calendar arithmetic below is therefore inlined.
   ══════════════════════════════════════════════════════════════════════════ */

/** Completions needed in a day for it to extend the streak. */
export const STREAK_QUALIFY_MIN = 5;

/** How far back to walk. Callers should fetch at least this many days of rows. */
export const STREAK_LOOKBACK_DAYS = 60;

/** Rows-per-day, keyed by Sydney calendar date "YYYY-MM-DD". */
export type CompletionsByDate = Record<string, number>;

/** "YYYY-MM-DD" for a UTC-anchored calendar date. */
function isoKey(anchor: Date): string {
  const y = anchor.getUTCFullYear();
  const m = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  const d = String(anchor.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Consecutive qualifying WEEKDAYS ending at `todaySydneyDate`.
 *
 * WEEKDAY-ONLY, WEEKEND-NEUTRAL. Habits are Mon–Fri in Notion, so a weekend
 * records zero completions and can never clear the qualifying bar. Counting
 * calendar days would therefore break the streak every Saturday and cap it at
 * five forever. Saturday and Sunday are skipped outright instead: they neither
 * add to the streak nor reset it, and a historical weekend row cannot inflate
 * it either, because a skipped day is never counted whatever it contains.
 *
 * A non-qualifying WEEKDAY still resets, which is the whole point of a streak.
 *
 * THE GRACE. The most recent weekday is allowed to fall short without ending
 * the streak, because a day still in progress is not a failed day. It belongs
 * to the most recent *weekday* rather than to "today": on a Saturday that is
 * Friday, which is what makes a weekend report the number Friday did — whether
 * or not Friday was ever completed. Without it, an incomplete Friday would read
 * 13 on Friday and 0 on Saturday.
 *
 * PURE. No clock is read here — `new Date(Date.UTC(...))` below constructs a
 * specific calendar date from explicit components, it never asks what day it
 * is. The caller supplies the Sydney date, so this returns the same answer on a
 * Sydney iPad and a UTC build box. Day-of-week is read off the same UTC anchor,
 * which is zone-independent for a civil date.
 *
 * @param completionsByDate rows per Sydney date, "YYYY-MM-DD" -> count
 * @param todaySydneyDate   today in Australia/Sydney, "YYYY-MM-DD"
 */
export function calculateStreak(
  completionsByDate: CompletionsByDate,
  todaySydneyDate: string,
): number {
  const [y, m, d] = todaySydneyDate.split("-").map(Number);
  if (!y || !m || !d) return 0;   // unparseable date -> no streak, never a crash

  let streak = 0;
  let graceAvailable = true;

  for (let i = 0; i <= STREAK_LOOKBACK_DAYS; i++) {
    const day = new Date(Date.UTC(y, m - 1, d));
    day.setUTCDate(day.getUTCDate() - i);

    const dow = day.getUTCDay();              // 0 = Sunday ... 6 = Saturday
    if (dow === 0 || dow === 6) continue;     // weekend: neither adds nor resets

    if ((completionsByDate[isoKey(day)] || 0) >= STREAK_QUALIFY_MIN) {
      streak++;
      graceAvailable = false;
      continue;
    }
    if (graceAvailable) {                     // most recent weekday, in progress
      graceAvailable = false;
      continue;
    }
    break;                                    // a finished weekday that fell short
  }

  return streak;
}
