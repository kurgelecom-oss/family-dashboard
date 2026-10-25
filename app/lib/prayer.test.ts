import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prayerTimes } from './prayer.ts';

// Guidance app (Oak Park, MWL + tk's adjustments) showed these for Sun 25 Oct 2026.
test('prayer times match the Guidance app to within a minute', () => {
  const t = prayerTimes(2026, 10, 25);
  const local = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit', hour12: false }).format(d);
  const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const [p, want] of [['fajr', '04:46'], ['maghrib', '19:53'], ['isha', '21:16']] as const) {
    assert.ok(Math.abs(mins(local(t[p])) - mins(want)) <= 1, `${p} was ${local(t[p])}`);
  }
});
