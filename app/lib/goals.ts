/* FAMILY CHALLENGES SNAPSHOT — hand-built words for the /sunday goal designs.
   The goals themselves moved to the master list (fds_goals, 3 Nov 2026):
   read them from /api/goals or lib/goal-measures.ts, never hard-code them here. */
export const SNAPSHOT = {
  asOf: '1 Oct 2026',
  challenges: ['Accepting average and being comfortable', 'Not feeling urgency', 'Lack of speed in execution'],
  flips: ["We don't settle.", 'Today matters.', 'Decide, then do it now.'],
};

/** One goal as the story, email and /sunday designs show it: never a balance. */
export type GoalLine = { short: string; label: string; val: string | null };
export const goalLine = (g: { short: string; goal: string; measure: { pct?: number; txt?: string; hit?: boolean } | null }): GoalLine =>
  ({ short: g.short, label: g.goal, val: g.measure?.hit ? 'hit' : g.measure?.txt ?? (g.measure?.pct !== undefined ? `${g.measure.pct}%` : null) });
