/* ════════════════════════════════════════════════════════════════════════════
   ANSAR FC scoring — the single canonical implementation.

   MIRRORED FILE. This file exists byte-for-byte identical in two repos:

         family-dashboard/app/lib/scoring.ts
         ansar-habits-tracker/app/lib/scoring.ts

   BOTH COPIES MUST STAY IDENTICAL. They are separate deploys reading the same
   Supabase `habit_completions` rows, so a change to one alone makes the same
   day score differently depending on which screen you look at — the exact bug
   this file was created to end. Change one, copy to the other, and run
   scripts/check-scoring-sync.sh before committing.

   Canonical logic is ansar-habits-tracker's: `homeschool_session` alone awards
   5. The older family-dashboard split (3 + 1 for readtheory&khan + 1 for
   journal) is retired — same 5-point ceiling, but it required three habits to
   reach what one habit now earns.

   Block-based, NOT per-habit sums. Daily max 10, or 11 on a training day.
   ══════════════════════════════════════════════════════════════════════════ */

export const SOCCER_DAYS = ["Monday", "Wednesday"];

/**
 * Weekly max = 55 (incl. +3 streak bonus for 5 Perfect Days Mon–Fri).
 *
 * 55, not 56, because 56 was never reachable. A perfect week is Mon 11 + Tue 10
 * + Wed 11 + Thu 10 + Fri 10 = 52 — 11 on the two SOCCER_DAYS, 10 otherwise —
 * plus the 3-point streak bonus. The old 56 left one point no combination of
 * ticks could earn, so "Week total / 56" could never read full.
 */
export const WEEKLY_MAX = 55;

/**
 * Tier boundaries. Only `min` and `label` live here — the point at which a tier
 * is reached is shared truth, but each surface owns its own presentation
 * (colours, emoji, descriptions) because they are styled to different palettes.
 * Do not move colour tokens into this file: family-dashboard resolves them from
 * globals.css and ansar-habits-tracker uses its own Real Madrid accents.
 */
export const THRESHOLDS = [
  { min: 42, label: "First Team" },
  { min: 34, label: "Bench" },
  { min: 26, label: "Reserves" },
  { min: 0,  label: "Training Ground" },
];

export function getThreshold(pts: number) {
  return THRESHOLDS.find(t => pts >= t.min) || THRESHOLDS[THRESHOLDS.length - 1];
}

/**
 * The habits visible on a given day: every non-conditional habit, plus the
 * conditional soccer session on training days.
 */
export function visibleIds(dayName: string, baseIds: string[]): string[] {
  return SOCCER_DAYS.includes(dayName) ? [...baseIds, "soccer_training"] : baseIds;
}

export interface DayScore {
  total: number;
  /** Per-block subtotals, keyed by the block ids used in ansar-habits-tracker. */
  blocks: Record<string, number>;
  perfect: boolean;
}

/**
 * Score one day.
 *
 * @param completedIds habit ids ticked that day
 * @param dayName      weekday name, e.g. "Monday"
 * @param preIds       ids of the morning-habits block — all-or-nothing, worth 2
 * @param baseIds      ids of every non-conditional habit, for the perfect-day check
 *
 * preIds/baseIds are passed in rather than hardcoded because the two surfaces
 * source their habit list differently: family-dashboard reads it from Notion via
 * /api/habits, ansar-habits-tracker builds it locally. The arithmetic below is
 * identical either way.
 */
export function scoreDay(
  completedIds: Set<string>,
  dayName: string,
  preIds: string[],
  baseIds: string[],
): DayScore {
  const hasSoccer = SOCCER_DAYS.includes(dayName);

  // All-or-nothing. The length guard matters: if the habit list failed to load
  // and preIds is empty, `[].every()` is true and the block would award 2 points
  // for nothing.
  const pre = preIds.length > 0 && preIds.every(id => completedIds.has(id)) ? 2 : 0;

  let school = 0;
  if (completedIds.has("homeschool_session")) school += 5;

  let arvo = 0;
  if (completedIds.has("btn_cornell")) arvo += 1;
  if (completedIds.has("all_namaz")) arvo += 1;

  const conditional = hasSoccer && completedIds.has("soccer_training") ? 1 : 0;

  const ids = visibleIds(dayName, baseIds);
  const perfect = ids.length > 0 && ids.every(id => completedIds.has(id));
  const bonus = perfect ? 1 : 0;

  return {
    total: pre + school + arvo + conditional + bonus,
    blocks: {
      pre_homeschool: pre,
      homeschool: school,
      afternoon_evening: arvo,
      conditional,
    },
    perfect,
  };
}
