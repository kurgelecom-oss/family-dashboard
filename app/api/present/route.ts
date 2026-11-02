import { NextResponse } from 'next/server';
import { canEditFamily } from '../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../lib/family-db';
import { PEOPLE, personById } from '../../present/topics';
import { TZ } from '../../lib/cal-time';

/* Present wheel. GET → this week's spins + every topic ever drawn.
   POST { person } → the SERVER picks the slice (one spin per person per week,
   never a topic they already had) and the wheel animates to it.
   DELETE { person } → clear this week's spin; needs the family PIN. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

/** Monday of the current week in Melbourne, as YYYY-MM-DD. */
function weekStart(now = new Date()) {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function state() {
  const rows = await familyDb()`select person, week_start::text as week, topic, kind, spun_at from fds_present_spins where workspace=${familyWorkspace()} order by week_start desc`;
  const week = weekStart();
  const current = Object.fromEntries(rows.filter(r => r.week === week).map(r => [r.person, { topic: r.topic, kind: r.kind, spunAt: r.spun_at }]));
  const history = Object.fromEntries(PEOPLE.map(p => [p.id, rows.filter(r => r.person === p.id).map(r => ({ week: r.week, topic: r.topic, kind: r.kind }))]));
  return { week, current, history };
}

export async function GET() {
  return NextResponse.json(await state(), { headers: noStore });
}

async function personFrom(request: Request) {
  try { return personById(String((await request.json()).person ?? '')); } catch { return undefined; }
}

export async function POST(request: Request) {
  const person = await personFrom(request);
  if (!person) return NextResponse.json({ error: 'Unknown person' }, { status: 400, headers: noStore });
  const { week, current, history } = await state();
  if (current[person.id]) return NextResponse.json({ error: 'Already spun this week', ...current[person.id] }, { status: 409, headers: noStore });
  const drawn = new Set(history[person.id].map(h => h.topic));
  // The wild card can come up again; a topic or shock only once per person, ever.
  const open = person.slices.map((s, i) => ({ s, i })).filter(({ s }) => s.k === 'wild' || !drawn.has(s.t));
  const pick = open[Math.floor(Math.random() * open.length)];
  const res = await familyDb()`insert into fds_present_spins (workspace, person, week_start, topic, kind) values (${familyWorkspace()}, ${person.id}, ${week}, ${pick.s.t}, ${pick.s.k}) on conflict do nothing returning topic`;
  if (!res.length) return NextResponse.json({ error: 'Already spun this week' }, { status: 409, headers: noStore });
  return NextResponse.json({ index: pick.i, topic: pick.s.t, kind: pick.s.k, week }, { headers: noStore });
}

export async function DELETE(request: Request) {
  if (!(await canEditFamily(request))) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers: noStore });
  const person = await personFrom(request);
  if (!person) return NextResponse.json({ error: 'Unknown person' }, { status: 400, headers: noStore });
  await familyDb()`delete from fds_present_spins where workspace=${familyWorkspace()} and person=${person.id} and week_start=${weekStart()}`;
  return NextResponse.json({ ok: true }, { headers: noStore });
}
