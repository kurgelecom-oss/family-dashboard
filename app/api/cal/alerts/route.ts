import { NextResponse } from 'next/server';
import { canEditFamily } from '../../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../../lib/family-db';

/* Which calendar events pop up. GET → { alerts: { [seriesKey]: 'popup' | 'popout' } }.
   PUT { key, mode: 'off' | 'popup' | 'popout' } needs the family PIN session. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
  const rows = await familyDb()`select key, mode from fds_cal_alerts where workspace=${familyWorkspace()}`;
  return NextResponse.json({ alerts: Object.fromEntries(rows.map(r => [r.key, r.mode])) }, { headers: noStore });
}

export async function PUT(request: Request) {
  if (!(await canEditFamily(request))) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers: noStore });
  let b: { key?: unknown; mode?: unknown };
  try { b = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore }); }
  const key = String(b.key ?? ''), mode = String(b.mode ?? '');
  if (key.length < 3 || key.length > 400 || !['off', 'popup', 'popout'].includes(mode)) return NextResponse.json({ error: 'Bad alert' }, { status: 400, headers: noStore });
  if (mode === 'off') await familyDb()`delete from fds_cal_alerts where workspace=${familyWorkspace()} and key=${key}`;
  else await familyDb()`insert into fds_cal_alerts (workspace, key, mode) values (${familyWorkspace()}, ${key}, ${mode}) on conflict (workspace, key) do update set mode=excluded.mode, updated_at=now()`;
  return NextResponse.json({ ok: true }, { headers: noStore });
}
