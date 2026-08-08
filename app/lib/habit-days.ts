/* ════════════════════════════════════════════════════════════════════════════
   WHICH HABITS APPLY ON WHICH DAY — the dashboard's copy of the rule.

   Pure. No I/O, no Notion, no Supabase, no React. Imported by PanelHabits.tsx
   and WeekProgressStrip.tsx, which is the entire reason it is a module and not
   two private helpers: the streak rule lived inline in exactly those two
   components plus the tracker, held in agreement by a comment reading "same rule
   as the tracker", and all three drifted — see the note in app/lib/streak.ts.
   One copy per repo is the most this rule gets.

   The rule itself, matching ansar-habits-tracker/app/lib/days.ts:

     • "Days" set        → the habit applies only on those days.
     • "Days" empty      → applies EVERY day, except…
     • …conditional block with Days empty → falls back to SOCCER_DAYS.

   WHY THIS IS NOT A BYTE-FOR-BYTE MIRROR of the tracker's days.ts. The two repos
   name their blocks differently — this one uses the short ids /api/habits maps
   to ("pre", "school", "arvo", "conditional"), the tracker uses the long ones
   ("pre_homeschool", "homeschool", "afternoon_evening", "conditional"). Only the
   conditional id happens to match. A shared file would have to agree on block
   ids first, which is a larger change than this one. The ARITHMETIC that must
   never drift already lives in the genuinely mirrored app/lib/scoring.ts, and
   check-scoring-sync.sh guards that pair; this file is deliberately NOT on that
   list.

   SOCCER_DAYS is imported from scoring.ts rather than restated, the same way the
   tracker's days.ts consumes it. scoring.ts is READ-ONLY here — it is mirrored
   byte-for-byte with the tracker and must not be modified.
   ══════════════════════════════════════════════════════════════════════════ */

import { SOCCER_DAYS } from "./scoring";

/** The block id /api/habits assigns to the Notion "Conditional" select. */
export const BLOCK_CONDITIONAL = "conditional";

/** The only two fields the day rule reads. The panels' Habit type satisfies it. */
export interface DayScoped {
  block: string;
  days: string[];
}

/**
 * Does this habit apply on `weekday`?
 *
 * @param weekday full name, e.g. "Saturday". Notion stores the three-letter form
 *                ("Sat"), so it is truncated here rather than at every call site.
 *
 * A habit whose `days` is missing — an /api/habits response predating the field,
 * or a cached one — reads as empty, i.e. "every day". That is the same permissive
 * default the field itself carries, so a stale cache degrades to the old
 * behaviour for one render rather than emptying the board.
 */
export function habitAppliesOn(habit: DayScoped, weekday: string): boolean {
  const days = habit.days ?? [];
  if (days.length > 0) return days.includes(weekday.slice(0, 3));
  if (habit.block === BLOCK_CONDITIONAL) return SOCCER_DAYS.includes(weekday);
  return true;
}

/**
 * The habits that apply on `weekday`. Generic so callers keep their own richer
 * type rather than being widened to DayScoped on the way out.
 */
export function habitsOnDay<T extends DayScoped>(habits: T[], weekday: string): T[] {
  return habits.filter(h => habitAppliesOn(h, weekday));
}
