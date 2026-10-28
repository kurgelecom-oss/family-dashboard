/* Nihal's daily order of priority, read from Ecom Launchpad — the same list and
   the same ticks Nihal OS shows. Nothing about the list is defined here: the
   items come from Launchpad's GET /entry-form, the ticks from its /checklists
   row for (current test, today). A tick here is a tick in Nihal OS and back.

   Server only: the API needs the agent key (LP_API_KEY = mission-control's
   .mc_agent_key, see mission-control/docs/ONE-OS.md). */

const API = 'https://product-test-engine.netlify.app/api';
const RUNNING = ['Live', 'Iterating'];

type Def = { key: string; label: string; details?: string[]; level_up?: number; automated?: string };
type Form = { operating_log: { sequence?: { open_at_once: number }; lists: { list: string; items: Def[] }[] } };
type Summary = { test: { id: string; name: string; status: string; created_at?: string } };
type Row = { execute_items: { key: string; checked: boolean; skipped?: boolean }[] };

export type OrderItem = { key: string; label: string; details: string[]; levelUp: number | null; automated: string | null; done: boolean; open: boolean; step: number };
export type DailyOrder = { testId: string; product: string; date: string; items: OrderItem[] };

/** Launchpad keys days by Sydney's date. */
export const launchpadToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

async function lp<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.LP_API_KEY;
  if (!key) throw new Error('LP_API_KEY not set');
  const r = await fetch(API + path, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init?.headers } });
  if (!r.ok) throw new Error(`launchpad ${r.status}`);
  return r.json() as Promise<T>;
}

/** Which items can be ticked now: the first `openAtOnce` unticked core items;
    the level-ups once every core item is done. Same rule as Nihal OS (dailyOrderState). */
export function openKeys(defs: Def[], done: (k: string) => boolean, openAtOnce = 2) {
  const core = defs.filter(d => !d.level_up), ups = defs.filter(d => d.level_up);
  const coreDone = core.every(d => done(d.key));
  return new Set(coreDone ? ups.filter(d => !done(d.key)).map(d => d.key) : core.filter(d => !done(d.key)).slice(0, Math.max(1, openAtOnce)).map(d => d.key));
}

export async function readDailyOrder(now = new Date()): Promise<DailyOrder | null> {
  const [form, all] = await Promise.all([lp<Form>('/entry-form'), lp<Summary[]>('/summary')]);
  const test = all.filter(s => RUNNING.includes(s.test.status)).sort((a, b) => String(b.test.created_at ?? '').localeCompare(String(a.test.created_at ?? '')))[0]?.test;
  if (!test) return null;
  const date = launchpadToday(now);
  // Reading a day creates its empty row in Launchpad, as Nihal OS does.
  const row = await lp<Row>(`/checklists?test_id=${test.id}&date=${date}`);
  const defs = form.operating_log.lists.find(l => l.list === 'execute')?.items ?? [];
  const done = (k: string) => !!row.execute_items.find(i => i.key === k)?.checked;
  const open = openKeys(defs, done, form.operating_log.sequence?.open_at_once);
  return {
    testId: test.id, product: test.name, date,
    items: defs.map((d, i) => ({ key: d.key, label: d.label, details: d.details ?? [], levelUp: d.level_up ?? null, automated: d.automated ?? null, done: done(d.key), open: open.has(d.key), step: i + 1 })),
  };
}

/** Tick one item for today. Refuses automated items and items not open yet, so the order holds. */
export async function tickDailyOrder(key: string, checked: boolean): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const order = await readDailyOrder();
  const item = order?.items.find(i => i.key === key);
  if (!order || !item) return { ok: false, status: 404, error: 'That task is not on today’s order' };
  if (item.automated) return { ok: false, status: 409, error: 'This one ticks itself' };
  if (checked && !item.open && !item.done) return { ok: false, status: 409, error: 'Finish the task above first' };
  await lp('/checklists', { method: 'PATCH', body: JSON.stringify({ test_id: order.testId, date: order.date, list: 'execute', key, checked }) });
  return { ok: true };
}
