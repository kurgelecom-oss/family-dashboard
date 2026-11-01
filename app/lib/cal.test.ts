import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, monthGrid, startOfWeek, wall, zonedToISO } from './cal-time.ts';
import { parseIcs } from './ics.ts';

test('Melbourne wall time round-trips across both DST states', () => {
  assert.equal(zonedToISO('2026-07-01', 9 * 60), '2026-06-30T23:00:00.000Z'); // AEST +10
  assert.equal(zonedToISO('2026-11-01', 9 * 60), '2026-10-31T22:00:00.000Z'); // AEDT +11
  assert.deepEqual(wall('2026-10-31T22:00:00.000Z'), { day: '2026-11-01', min: 540 });
});

test('weeks start Monday and month grids are 6x7', () => {
  assert.equal(startOfWeek('2026-11-01'), '2026-10-26');
  const g = monthGrid('2026-11-15');
  assert.equal(g.length, 42); assert.equal(g[0], '2026-10-26');
  assert.equal(clock(720, true), 'Noon'); assert.equal(clock(570), '9:30 am');
});

const ics = (body: string) => `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${body}\nEND:VEVENT\nEND:VCALENDAR`;

test('ics: TZID times, all-day dates and weekly rules with EXDATE', () => {
  const one = parseIcs(ics('UID:a\nSUMMARY:Dentist\\, Ansar\nDTSTART;TZID=Australia/Melbourne:20261103T150000\nDTEND;TZID=Australia/Melbourne:20261103T160000'), '2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z');
  assert.equal(one.length, 1); assert.equal(one[0].title, 'Dentist, Ansar'); assert.deepEqual(wall(one[0].startISO), { day: '2026-11-03', min: 900 });
  const allDay = parseIcs(ics('UID:b\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20261104\nDTEND;VALUE=DATE:20261105'), '2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z');
  assert.equal(allDay[0].allDay, true); assert.equal(wall(allDay[0].startISO).day, '2026-11-04');
  const weekly = parseIcs(ics('UID:c\nSUMMARY:Swim\nDTSTART;TZID=Australia/Melbourne:20260701T170000\nDTEND;TZID=Australia/Melbourne:20260701T180000\nRRULE:FREQ=WEEKLY;BYDAY=WE,FR\nEXDATE;TZID=Australia/Melbourne:20261104T170000'), '2026-11-02T00:00:00+11:00', '2026-11-09T00:00:00+11:00');
  // Wed 4 Nov is excluded; Fri 6 Nov remains, still at 5 pm after the DST change.
  assert.deepEqual(weekly.map(e => wall(e.startISO)), [{ day: '2026-11-06', min: 1020 }]);
});
