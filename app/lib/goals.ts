/* FAMILY GOALS SNAPSHOT — a hand-built picture of where the family is, not a
   data feed. Claude edits SNAPSHOT below each time tk asks for a refresh; no
   Notion, no API. `now` values are dollars; null hides the progress line.
   Shared by the three Family goals designs and the weekly story. */
export const SNAPSHOT = {
  asOf: '1 Oct 2026',
  challenges: ['Accepting average and being comfortable', 'Not feeling urgency', 'Lack of speed in execution'],
  flips: ["We don't settle.", 'Today matters.', 'Decide, then do it now.'],
  goals: [
    { label: 'in the bank', short: '$5k', full: '$5,000', target: 5000, now: null as number | null, nowLabel: 'Now' },
    { label: 'in the bank', short: '$10k', full: '$10,000', target: 10000, now: null as number | null, nowLabel: 'Now' },
    { label: 'weekly income', short: '$3k', full: '$3,000', target: 3000, now: null as number | null, nowLabel: 'Last week' },
  ],
};
