/* The home board ticker's rows, pure so node --test can run it (ticker-rows.test.ts).
   Order: Nihal's morning tasks, her daily order of priority (Launchpad, the same
   ticks as Nihal OS), the ecom talk, then TK's list. The two level-ups that repeat
   a Notion task (product research, Origins) show once, done if either is. */
import type { Item, Tasks } from './HomeBoard';
import type { OrderItem } from '../../lib/daily-order';

/** Daily-order steps left off the board (tk 28 Oct 2026). They stay in Launchpad and Nihal OS,
    so the level-ups still open only once Nihal ticks them there. */
const HIDDEN = new Set(['customer_emails']);
/** Steps an agent ticks in Launchpad when it has done them (mission-control agents/daily_order.py). Still tappable by hand. */
export const AGENT: Record<string, string> = { meta_report: 'GARY', competitor_check: 'NORA', pdp_check: 'VERA', make_ads: 'JUNE' };

export type June = { date: string; headline: string | null; worked: { ad: string; why: string }[]; lessons: string[]; next: string[] } | null;
export type Order = { testId: string; product: string; date: string; items: OrderItem[] } | null;

export type Row = {
  id: string; title: string; who: 'Nihal' | 'TK'; done: boolean;
  step?: string; talk?: string | null; hint?: string;
  tick: { kind: 'order'; key: string } | { kind: 'task'; id: string } | null;
  locked?: boolean;
};

/** Builds the ticker's rows. Pure: the board's tests can call it. */
export function tickerRows(nihal: Tasks | undefined, taylan: Tasks | undefined, order: Order | undefined, june: June | undefined): Row[] {
  const n = nihal?.items ?? [], t = taylan?.items ?? [];
  const twin = (key: string) => key === 'levelup_research' ? n.find(i => /surface log/i.test(i.source ?? '')) : key === 'levelup_origins' ? n.find(i => /origins/i.test(i.source ?? '')) : undefined;
  const twins = new Set((order?.items ?? []).map(o => twin(o.key)?.id).filter(Boolean));
  const isTalk = (i: Item) => /ecom/i.test(i.feeds ?? '') && /talk/i.test(i.title);
  const task = (i: Item, who: Row['who']): Row => ({
    id: i.id, title: i.title, who, done: i.done, talk: null,
    hint: i.auto ? i.source ?? 'auto' : undefined,
    tick: i.auto ? null : { kind: 'task', id: i.id },
  });
  const talkFor = (key: string) => key === 'meta_report' && june?.headline ? `JUNE · ${june.headline}`
    : key === 'make_ads' && june?.next[0] ? `Next batch · ${june.next[0]}`
    : key === 'pdp_check' && june?.lessons[0] ? `Lesson · ${june.lessons[0]}` : null;

  const ord: Row[] = (order?.items ?? []).filter(o => !HIDDEN.has(o.key)).map(o => {
    const tw = twin(o.key);
    return {
      id: `lp-${o.key}`, title: o.label, who: 'Nihal', done: o.done || !!tw?.done,
      step: o.levelUp ? `+${o.levelUp}` : String(o.step),
      talk: talkFor(o.key) ?? (o.details.length ? o.details.join(' · ') : null),
      hint: o.automated ? `auto · ${o.automated.split(' ')[0]}` : AGENT[o.key] && !o.done ? `auto · ${AGENT[o.key]}` : o.done || o.open ? undefined : o.levelUp ? 'after the six' : 'opens in order',
      tick: o.automated ? null : { kind: 'order', key: o.key },
      locked: !o.automated && !o.open && !o.done,
    };
  });
  const talk = n.filter(isTalk).map(i => ({ ...task(i, 'Nihal'), talk: june?.worked[0] ? `Worked · ${june.worked[0].ad}: ${june.worked[0].why}` : june?.headline ?? null }));
  return [
    ...n.filter(i => !twins.has(i.id) && !isTalk(i)).map(i => task(i, 'Nihal')),
    ...ord,
    ...talk,
    ...t.map(i => task(i, 'TK')),
  ];
}
