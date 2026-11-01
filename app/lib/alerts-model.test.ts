import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, dueAlerts, iconFor, look, type AlertEvent } from './alerts-model.ts';

const at = (iso: string) => Date.parse(iso);
const ev = (key: string, start: string, end: string, extra: Partial<AlertEvent> = {}): AlertEvent => ({ key, title: key, startISO: start, endISO: end, cal: 'family', ...extra });
const football = ev('football', '2026-11-06T06:30:00Z', '2026-11-06T09:00:00Z');
const none = () => false;

test('only events someone switched on pop up', () => {
  assert.equal(dueAlerts([football], {}, at('2026-11-06T06:25:00Z'), none).length, 0);
  assert.equal(dueAlerts([football], { football: 'popup' }, at('2026-11-06T06:25:00Z'), none).length, 1);
});

test('fires 10 minutes before, stays through the event, gone after it ends', () => {
  const on = { football: 'popup' as const };
  assert.equal(dueAlerts([football], on, at('2026-11-06T06:19:59Z'), none).length, 0, '10 min 1 s before: not yet');
  assert.equal(dueAlerts([football], on, at('2026-11-06T06:20:00Z'), none).length, 1, 'exactly 10 min before');
  assert.equal(dueAlerts([football], on, at('2026-11-06T08:59:00Z'), none).length, 1, 'still on during the event');
  assert.equal(dueAlerts([football], on, at('2026-11-06T09:00:00Z'), none).length, 0, 'clears itself at the end');
});

test('a zero-length reminder still shows for 15 minutes', () => {
  const r = ev('pills', '2026-11-06T08:00:00Z', '2026-11-06T08:00:00Z');
  assert.equal(dueAlerts([r], { pills: 'popout' }, at('2026-11-06T08:14:00Z'), none).length, 1);
  assert.equal(dueAlerts([r], { pills: 'popout' }, at('2026-11-06T08:15:00Z'), none).length, 0);
});

test('Press me to clear removes it; all-day events never take over the screen', () => {
  const on = { football: 'popup' as const, holiday: 'popup' as const };
  const holiday = ev('holiday', '2026-11-05T13:00:00Z', '2026-11-06T13:00:00Z', { allDay: true });
  assert.equal(dueAlerts([football, holiday], on, at('2026-11-06T06:30:00Z'), e => e.key === 'football').length, 0);
});

test('pop-ups queue before pop-outs, then soonest first', () => {
  const a = ev('a', '2026-11-06T06:30:00Z', '2026-11-06T07:00:00Z'), b = ev('b', '2026-11-06T06:25:00Z', '2026-11-06T07:00:00Z'), c = ev('c', '2026-11-06T06:20:00Z', '2026-11-06T07:00:00Z');
  const order = dueAlerts([a, b, c], { a: 'popup', b: 'popup', c: 'popout' }, at('2026-11-06T06:22:00Z'), none).map(e => e.key);
  assert.deepEqual(order, ['b', 'a', 'c']);
});

test('each series keeps the same look every week, and different events spread across all five scenes', () => {
  assert.deepEqual(look('outlook-NIHAL-football'), look('outlook-NIHAL-football'));
  const seen = new Set(Array.from({ length: 40 }, (_, i) => look(`board-${i}`).scene));
  assert.equal(seen.size, SCENES.length);
  assert.equal(look('anything', 'waves').scene, 'waves', 'demo can force a scene');
});

test('icons follow the title', () => {
  assert.equal(iconFor('Ansar Indoor Football'), '⚽');
  assert.equal(iconFor('Seera | Yasir Qadhi'), '🕌');
  assert.equal(iconFor('Call Adam'), '📞');
  assert.equal(iconFor('Making ads'), '🎬');
  assert.equal(iconFor('Product research'), '🔎');
  assert.equal(iconFor('Nick mentorship call'), '🎓');
  assert.equal(iconFor('Something else'), '📅');
});
