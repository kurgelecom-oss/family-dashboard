import { NextResponse } from 'next/server';
import { canEditFamily } from '../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../lib/family-db';
import { measureGoals, openGoals, type Goal } from '../../lib/goal-measures';

/* /api/goals — the family goals master list (fds_goals).
   GET   → open goals in rank order, each with a TV-safe measure (%, count, trend; never a balance).
   PUT   { goals: [...] } → replace the open list in this order (family PIN). Settled goals are never touched.
   POST  { id, outcome: 'done' | 'missed' } → settle a goal (family PIN); it leaves the bar and stays as history. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
const RANGES = new Set(['wk', '1m', '3m', '6m', '12m']);
const METRICS = new Set(['none', 'income_wk', 'omega_wk', 'tests_wk', 'net', 'proof', 'date']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Measures read CLEO + every Launchpad test; the bar polls, so one computation serves all screens for a minute.
let cache: { at: number; ws: string; goals: Goal[] } | null = null;
async function current(fresh = false) {
  const ws = familyWorkspace();
  if (!fresh && cache && cache.ws === ws && Date.now() - cache.at < 60_000) return cache.goals;
  const goals = await measureGoals(await openGoals());
  cache = { at: Date.now(), ws, goals };
  return goals;
}

export async function GET() {
  try { return NextResponse.json({ goals: await current(), asOf: new Date(cache?.at ?? Date.now()).toISOString() }, { headers: noStore }); }
  catch { return NextResponse.json({ error: 'Goals unavailable' }, { status: 503, headers: noStore }); }
}

type In = { id?: unknown; goal?: unknown; short?: unknown; range?: unknown; priority?: unknown; how?: unknown; metric?: unknown; target?: unknown; due?: unknown };
function clean(g: In) {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const goal = str(g.goal, 200), short = str(g.short, 40) || goal.slice(0, 40), range = String(g.range ?? '');
  if (!goal || !RANGES.has(range)) return null;
  const priority = [1, 2, 3, 4].includes(Number(g.priority)) ? Number(g.priority) : null;
  const metric = METRICS.has(String(g.metric)) ? String(g.metric) : 'none';
  const target = g.target === null || g.target === undefined || g.target === '' ? null : Number(g.target);
  const due = typeof g.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.due) ? g.due : null;
  if (target !== null && !Number.isFinite(target)) return null;
  return { id: typeof g.id === 'string' && UUID.test(g.id) ? g.id : null, goal, short, range, priority, how: str(g.how, 500), metric, target, due: range === 'wk' ? null : due };
}

export async function PUT(request: Request) {
  if (!(await canEditFamily(request))) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers: noStore });
  let body: { goals?: In[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore }); }
  if (!Array.isArray(body.goals) || body.goals.length > 10) return NextResponse.json({ error: 'Up to 10 goals' }, { status: 400, headers: noStore });
  const list = body.goals.map(clean);
  if (list.some(g => !g)) return NextResponse.json({ error: 'Each goal needs text and a range' }, { status: 400, headers: noStore });
  const ws = familyWorkspace();
  await familyDb().begin(async tx => {
    const keep = list.map(g => g!.id).filter(Boolean) as string[];
    await tx`delete from fds_goals where workspace=${ws} and status='open' and not (id = any(${keep}::uuid[]))`;
    for (const [i, g] of list.entries()) {
      const v = g!;
      if (v.id) await tx`update fds_goals set rank=${i + 1}, goal=${v.goal}, short=${v.short}, range=${v.range}, priority=${v.priority}, how=${v.how}, metric=${v.metric}, target=${v.target}, due=${v.due}, updated_at=now() where id=${v.id} and workspace=${ws} and status='open'`;
      else await tx`insert into fds_goals(workspace,rank,goal,short,range,priority,how,metric,target,due) values(${ws},${i + 1},${v.goal},${v.short},${v.range},${v.priority},${v.how},${v.metric},${v.target},${v.due})`;
    }
  });
  return NextResponse.json({ goals: await current(true) }, { headers: noStore });
}

export async function POST(request: Request) {
  if (!(await canEditFamily(request))) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers: noStore });
  let body: { id?: unknown; outcome?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore }); }
  if (typeof body.id !== 'string' || !UUID.test(body.id) || (body.outcome !== 'done' && body.outcome !== 'missed')) return NextResponse.json({ error: 'Bad request' }, { status: 400, headers: noStore });
  const res = await familyDb()`update fds_goals set status=${body.outcome}, settled_at=now(), updated_at=now() where id=${body.id} and workspace=${familyWorkspace()} and status='open' returning id`;
  if (!res.length) return NextResponse.json({ error: 'Goal not found' }, { status: 404, headers: noStore });
  return NextResponse.json({ goals: await current(true) }, { headers: noStore });
}
