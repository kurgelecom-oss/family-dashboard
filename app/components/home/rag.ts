/* Green / amber / red for the home board. Pure, no React: node --test runs it.
   One rule everywhere: compare what happened with what should have happened
   by now, so a 9 am screen isn't red just because the day has barely started. */

export type Rag = 'good' | 'warn' | 'bad' | null;

/** Ahead of or on pace = good; at least 60% of pace = warn; below = bad. */
export function paceRag(actual: number, expected: number): Rag {
  if (!(expected > 0)) return actual > 0 ? 'good' : null;
  const r = actual / expected;
  return r >= 1 ? 'good' : r >= 0.6 ? 'warn' : 'bad';
}

/** Share of a household day (6 am – 9 pm, Melbourne) that has passed, 0–1. */
export function dayShare(hour: number, start = 6, end = 21) {
  return Math.min(1, Math.max(0, (hour - start) / (end - start)));
}

/** A person's list: done items vs the share of the day gone. Before 6 am nothing is due. */
export function listRag(done: number, total: number, hour: number): Rag {
  if (!total) return null;
  if (done === total) return 'good';
  return paceRag(done, total * dayShare(hour));
}

/** Store conversion, percent: 3%+ is working, 2–3% watch it, under 2% is a problem. */
export function conversionRag(pct: number | null): Rag {
  if (pct === null) return null;
  return pct >= 3 ? 'good' : pct >= 2 ? 'warn' : 'bad';
}

/** A goal's progress, percent. */
export function goalRag(pct: number): Rag {
  return pct >= 100 ? 'good' : pct >= 50 ? 'warn' : 'bad';
}

export const RAG_LABEL: Record<Exclude<Rag, null>, string> = { good: 'On track', warn: 'Watch', bad: 'Behind' };
