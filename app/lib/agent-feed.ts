/* What the agents did, for the home board's pop-ups (tk 28 Oct 2026: "do the same with our agents when they action
   something ... June and include all her pop-ups ... and include Gary's executions too").

   Two sources, both in Mission Control's cos_mission_control table:
     · June's day: row "automations", doc.june.steps — each step ticked by the code that did it (agents/june_day.py)
     · agent jobs: rows of kind "job". GARY and JUNE report every run, so all their reports count. The other seats
       report a status every few minutes (SARA's inbox, VERA's pulse), so only their real finished jobs count.
   Repeats that are not actions ("waiting for the next folder", "already written") are dropped. "Daily order:" jobs are
   left out because the ticker's own ticks already pop. Pure: node --test runs it. */

export type JuneStep = { id: string; label: string; due: string; state?: string; at?: string; note?: string };
export type AgentAction = { id: string; who: string; text: string; warn: boolean; at: string };
type JobRow = { id: string; updated_at: string; doc: { agent?: string; status?: string; action?: string; result?: string } };

const LOUD = new Set(['gary', 'june']);
const NOT_AN_ACTION = /already (written|uploaded|ticked)|waiting for the next folder|nothing to (do|guard|upload)|no new ad folder/i;
const WARN = /could not|couldn't|failed|blocked|stopped|error|not proven|alert/i;
const NAME: Record<string, string> = { gary: 'GARY', june: 'JUNE', nora: 'NORA', vera: 'VERA', sara: 'SARA', bob: 'BOB', cleo: 'CLEO', tara: 'TARA' };

/** One line a person can read on a TV: the first line of the result, without the VERDICT tail. */
const line = (s: string) => s.split('\n')[0].split(' | ')[0].trim().slice(0, 140);

export function agentActions(rows: JobRow[]): AgentAction[] {
  const out: AgentAction[] = [];
  for (const r of rows) {
    const { agent = '', status, action = '', result = '' } = r.doc ?? {};
    if (status !== 'done' || action.startsWith('Daily order:')) continue;
    if (action === 'STATUS REPORT' && !LOUD.has(agent)) continue;
    const text = line(result || action);
    if (!text || NOT_AN_ACTION.test(text)) continue;
    out.push({ id: r.id, who: NAME[agent] ?? agent.toUpperCase(), text, warn: WARN.test(text), at: r.updated_at });
  }
  return out;
}

/** The PostgREST query for the last 18 hours of jobs worth reading. */
export function jobsQuery(now: Date) {
  const since = new Date(now.getTime() - 18 * 3600e3).toISOString();
  return `cos_mission_control?kind=eq.job&updated_at=gte.${since}&or=(doc->>agent.in.(gary,june),doc->>action.neq.STATUS%20REPORT)&select=id,doc,updated_at&order=updated_at.desc&limit=40`;
}
