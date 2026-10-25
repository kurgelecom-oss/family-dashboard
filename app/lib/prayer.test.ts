import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prayerTimes } from './prayer.ts';

// Melbourne, 25 Oct 2026 (AEDT): published MWL times are roughly Fajr 4:50, Maghrib 7:45, Isha 9:10.
test('Melbourne prayer times land within 10 minutes of published MWL times', () => {
  const t = prayerTimes(2026, 10, 25);
  const local = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit', hour12: false }).format(d);
  const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const [p, want] of [['fajr', '04:50'], ['maghrib', '19:45'], ['isha', '21:10']] as const) {
    assert.ok(Math.abs(mins(local(t[p])) - mins(want)) <= 10, `${p} was ${local(t[p])}`);
  }
});
