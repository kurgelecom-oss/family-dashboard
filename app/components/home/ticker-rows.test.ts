import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickerRows } from './ticker-rows.ts';
import { openKeys } from '../../lib/daily-order.ts';

const item = (id: string, title: string, done = false, source?: string, feeds?: string) => ({ id, title, done, count: null, auto: !!source, source, feeds });
const ord = (key: string, step: number, o: Partial<{ done: boolean; open: boolean; levelUp: number; automated: string }> = {}) =>
  ({ key, label: key, details: [], levelUp: o.levelUp ?? null, automated: o.automated ?? null, done: !!o.done, open: !!o.open, step });

test('daily order opens two at a time, level-ups after the core', () => {
  const defs = [{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }, { key: 'c', label: 'c' }, { key: 'u', label: 'u', level_up: 1 }];
  assert.deepEqual([...openKeys(defs, k => k === 'a')], ['b', 'c']);
  assert.deepEqual([...openKeys(defs, k => k !== 'u')], ['u']);
});

test('ticker merges twins, orders sections and locks unopened steps', () => {
  const nihal = { done: 0, total: 3, items: [item('q', 'Quran session', false, 'auto · Quran OS'), item('o', 'Watch one Origins session', true, 'auto · Origins'), item('t', 'Ecom talk with TK: what worked and why', false, undefined, 'Ecom · JUNE daily report')] };
  const tk = { done: 0, total: 1, items: [item('k', 'Build block')] };
  const order = { testId: 'x', product: 'P', date: '2026-10-28', items: [ord('meta_report', 1, { automated: 'GARY ticks this', open: true }), ord('pdp_check', 2), ord('customer_emails', 6), ord('levelup_origins', 3, { levelUp: 2 })] };
  const june = { date: '2026-10-27', headline: 'Calm cards sold cheapest', worked: [{ ad: 'ad-1', why: 'quiet' }], lessons: [], next: [] };
  const rows = tickerRows(nihal, tk, order, june);
  assert.deepEqual(rows.map(r => r.id), ['q', 'lp-meta_report', 'lp-pdp_check', 'lp-levelup_origins', 't', 'k']);
  assert.equal(rows[1].tick, null);
  assert.equal(rows[1].talk, 'JUNE · Calm cards sold cheapest');
  assert.equal(rows[2].locked, true);
  assert.equal(rows[3].done, true, 'Origins done in its app ticks the level-up row');
  assert.match(rows[4].talk ?? '', /ad-1/);
  assert.equal(rows[5].who, 'TK');
});
