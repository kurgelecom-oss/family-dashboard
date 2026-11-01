import { NextResponse } from 'next/server';
import { canEditFamily } from '../../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../../lib/family-db';

/* Pen ink drawn over a calendar page. One row per page, saved whole. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
const SCOPE = /^(day|week|month|year):[0-9-]{4,10}$/;
type Stroke = { c: string; w: number; p: unknown[] };
const MAX_BYTES = 400_000; // a heavily-inked week is ~100 kB; this stops a runaway page, not real use

export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get('scope') ?? '';
  if (!SCOPE.test(scope)) return NextResponse.json({ error: 'Bad scope' }, { status: 400, headers: noStore });
  const [r] = await familyDb()`select strokes from fds_cal_ink where workspace=${familyWorkspace()} and scope=${scope}`;
  return NextResponse.json({ strokes: r?.strokes ?? [] }, { headers: noStore });
}

export async function PUT(request: Request) {
  if (!(await canEditFamily(request))) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers: noStore });
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'Too much ink on one page — clear some first' }, { status: 413, headers: noStore });
  let body: { scope?: string; strokes?: unknown };
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Bad ink' }, { status: 400, headers: noStore }); }
  const { scope, strokes } = body;
  const okStroke = (s: unknown) => !!s && typeof (s as Stroke).c === 'string' && /^#[0-9a-f]{6}$/i.test((s as Stroke).c) && typeof (s as Stroke).w === 'number' && Array.isArray((s as Stroke).p) && (s as Stroke).p.every(n => typeof n === 'number');
  if (!SCOPE.test(String(scope)) || !Array.isArray(strokes) || !strokes.every(okStroke)) return NextResponse.json({ error: 'Bad ink' }, { status: 400, headers: noStore });
  await familyDb()`insert into fds_cal_ink (workspace, scope, strokes) values (${familyWorkspace()}, ${String(scope)}, ${familyDb().json(strokes as never)})
    on conflict (workspace, scope) do update set strokes=excluded.strokes, updated_at=now()`;
  return NextResponse.json({ ok: true }, { headers: noStore });
}
