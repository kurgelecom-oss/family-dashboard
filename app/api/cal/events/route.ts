import { NextResponse } from 'next/server';
import { canEditFamily } from '../../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../../lib/family-db';

/* Events made on the family calendar (/board). Reads are open like every other
   board read; writes need the family PIN session. Never CDN-cached. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
const CALS = ['family', 'taylan', 'nihal', 'ansar'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Body = { id?: string; cal?: string; title?: string; startISO?: string; endISO?: string; allDay?: boolean; notes?: string };

function clean(b: Body) {
  const title = String(b.title ?? '').trim().slice(0, 200), notes = String(b.notes ?? '').slice(0, 2000);
  const s = Date.parse(String(b.startISO)), e = Date.parse(String(b.endISO));
  if (!title) throw new Error('Give the event a title');
  if (!CALS.includes(String(b.cal))) throw new Error('Unknown calendar');
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) throw new Error('The end must be after the start');
  return { cal: String(b.cal), title, notes, starts_at: new Date(s), ends_at: new Date(e), all_day: !!b.allDay };
}

const row = (r: Record<string, unknown>) => ({ id: r.id, cal: r.cal, title: r.title, notes: r.notes, allDay: r.all_day, startISO: (r.starts_at as Date).toISOString(), endISO: (r.ends_at as Date).toISOString() });

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams, from = q.get('from') ?? '', to = q.get('to') ?? '';
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: 'from/to required' }, { status: 400, headers: noStore });
  // Day bounds padded a day each side; the client places events by Melbourne wall time.
  const rows = await familyDb()`select * from fds_cal_events where workspace=${familyWorkspace()} and ends_at >= ${from}::date - 1 and starts_at < ${to}::date + 1 order by starts_at`;
  return NextResponse.json({ events: rows.map(row) }, { headers: noStore });
}

async function guard(request: Request) { return (await canEditFamily(request)) ? null : NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers: noStore }); }

export async function POST(request: Request) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const v = clean(await request.json());
    const [r] = await familyDb()`insert into fds_cal_events ${familyDb()({ ...v, workspace: familyWorkspace() })} returning *`;
    return NextResponse.json({ event: row(r) }, { headers: noStore });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save' }, { status: 400, headers: noStore }); }
}

export async function PATCH(request: Request) {
  const denied = await guard(request); if (denied) return denied;
  try {
    const b = await request.json() as Body, v = clean(b);
    const [r] = await familyDb()`update fds_cal_events set ${familyDb()(v)}, updated_at=now() where id=${String(b.id)} and workspace=${familyWorkspace()} returning *`;
    if (!r) return NextResponse.json({ error: 'That event is gone' }, { status: 404, headers: noStore });
    return NextResponse.json({ event: row(r) }, { headers: noStore });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save' }, { status: 400, headers: noStore }); }
}

export async function DELETE(request: Request) {
  const denied = await guard(request); if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400, headers: noStore });
  await familyDb()`delete from fds_cal_events where id=${id} and workspace=${familyWorkspace()}`;
  return NextResponse.json({ ok: true }, { headers: noStore });
}
