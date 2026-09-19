import { NextResponse } from 'next/server';
import { canEditFamily } from '../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../lib/family-db';
import { fetchSource, type NotionPage } from '../../lib/notion';
import { supabase } from '../../lib/supabase';
import { buildWeeklyReport } from '../../lib/sunday/data';
import { civilDay, weekFor, type WeeklyReport } from '../../lib/sunday/model';
import {
  AUTO_KINDS, ansarGroups, appliesOn, configTasks, dayLong, dayOfWeek, paceTiles, person, share,
  type AutoKind, type DailyPayload, type DayBar, type HabitRow, type TaskGroup, type TaskMember, type TaskRow,
} from '../../lib/daily/model';

/* "Today, together." — the daily screen's one feed.
   GET  → everyone's list for today, the week's bars, and the Sunday pace tiles.
   POST → tick / untick a hand-ticked task for today (family PIN, same gate as
          the weekly review's entries). Auto tasks and Ansar's habits refuse. */

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
/** 📋 8 · Family Daily Tasks, under the ANSAR OS Control Room. */
const TASKS_SOURCE = 'e3c5fa8d-3666-4f6f-b2b9-59940b415ffe';
const FAMILY = 'https://kurgel-dashboard.netlify.app';
const NAMES: Record<string, string> = { taylan: 'Taylan', nihal: 'Nihal', ansar: 'Ansar', ayah: 'Ayah' };

type Prop = { title?: { plain_text: string }[]; rich_text?: { plain_text: string }[]; select?: { name?: string } | null; multi_select?: { name: string }[]; number?: number | null; url?: string | null; checkbox?: boolean };
const prop = (row: NotionPage, k: string) => (row.properties?.[k] ?? {}) as Prop;
const text = (p: Prop) => (p.title ?? p.rich_text ?? []).map(x => x.plain_text).join('').trim();

function taskRows(rows: NotionPage[]): TaskRow[] {
  return rows.filter(r => prop(r, 'Active').checkbox === true).flatMap(r => {
    const member = prop(r, 'Person').select?.name?.toLowerCase();
    const title = text(prop(r, 'Task'));
    if (!r.id || !title || (member !== 'taylan' && member !== 'nihal' && member !== 'ayah')) return [];
    const auto = prop(r, 'Auto').select?.name ?? null;
    return [{
      id: r.id.replace(/-/g, ''), member: member as TaskMember, title,
      order: prop(r, 'Order').number ?? 99,
      days: (prop(r, 'Days').multi_select ?? []).map(d => d.name),
      feeds: text(prop(r, 'Feeds')),
      auto: auto && (AUTO_KINDS as readonly string[]).includes(auto) ? auto as AutoKind : null,
      link: prop(r, 'Link').url ?? null,
    }];
  });
}

async function habitCompletions(start: string, end: string) {
  const { data, error } = await supabase.from('habit_completions').select('habit_id,completed_date').gte('completed_date', start).lte('completed_date', end).limit(2000);
  if (error) throw new Error('Habits unavailable');
  return data as { habit_id: string; completed_date: string }[];
}

export async function GET() {
  const today = civilDay(), week = weekFor(today), db = familyDb();
  const [report, tasks, roster, done, ticks] = await Promise.allSettled([
    buildWeeklyReport(today),
    fetchSource(TASKS_SOURCE, 'Family Daily Tasks').then(taskRows),
    fetch(`${FAMILY}/api/habits`, { cache: 'no-store', signal: AbortSignal.timeout(12000) }).then(r => { if (!r.ok) throw new Error('Habits unavailable'); return r.json() as Promise<HabitRow[]>; }),
    habitCompletions(week.start, today),
    db`select day::text as day, task_id from fds_daily_ticks where workspace=${familyWorkspace()} and day between ${week.start} and ${today}`,
  ] as const);

  const r: WeeklyReport | null = report.status === 'fulfilled' ? report.value : null;
  const rows = tasks.status === 'fulfilled' ? tasks.value : [];
  const habits = roster.status === 'fulfilled' ? roster.value : [];
  const completions = done.status === 'fulfilled' ? done.value : [];
  const tickRows = ticks.status === 'fulfilled' ? ticks.value as unknown as { day: string; task_id: string }[] : [];
  const ticked = (date: string) => new Set(tickRows.filter(t => t.day === date).map(t => t.task_id));
  const completed = (date: string) => new Set(completions.filter(c => c.completed_date === date).map(c => c.habit_id));

  const groupsFor = (id: string, date: string): TaskGroup[] => id === 'ansar'
    ? ansarGroups(date, habits, completed(date))
    : [{ name: null, tasks: configTasks(id as TaskMember, date, rows, r, ticked(date)) }].filter(g => g.tasks.length);

  const people = (['taylan', 'nihal', 'ansar', 'ayah'] as const).map(id => {
    const week7: DayBar[] = week.days.map(date => date > today
      ? { date, pct: null, future: true }
      : { date, pct: share(groupsFor(id, date)), future: false });
    return person(id, NAMES[id], groupsFor(id, today), week7);
  });

  const payload: DailyPayload = {
    today, weekday: dayLong(today), dayOfWeek: dayOfWeek(today), people,
    pace: paceTiles(r, today), ticksAvailable: ticks.status === 'fulfilled',
    generatedAt: new Date().toISOString(),
  };
  return NextResponse.json(payload, { headers });
}

export async function POST(request: Request) {
  if (!await canEditFamily(request)) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers });
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Use this dashboard to tick tasks' }, { status: 403, headers });
  const body = await request.json().catch(() => null) as { taskId?: unknown; done?: unknown } | null;
  const taskId = typeof body?.taskId === 'string' ? body.taskId.replace(/-/g, '') : '';
  if (!/^[a-f0-9]{32}$/.test(taskId) || typeof body?.done !== 'boolean') return NextResponse.json({ error: 'Invalid tick' }, { status: 400, headers });

  const today = civilDay();
  let row: TaskRow | undefined;
  try { row = taskRows(await fetchSource(TASKS_SOURCE, 'Family Daily Tasks')).find(t => t.id === taskId); }
  catch { return NextResponse.json({ error: 'Task list unavailable. Try again.' }, { status: 503, headers }); }
  if (!row || row.auto || !appliesOn(row.days, today)) return NextResponse.json({ error: 'This task ticks itself or is not on today’s list' }, { status: 409, headers });

  try {
    const db = familyDb();
    if (body.done) await db`insert into fds_daily_ticks (workspace,day,task_id,member) values (${familyWorkspace()},${today},${taskId},${row.member}) on conflict do nothing`;
    else await db`delete from fds_daily_ticks where workspace=${familyWorkspace()} and day=${today} and task_id=${taskId}`;
    return NextResponse.json({ saved: true }, { headers });
  } catch { return NextResponse.json({ error: 'Tick was not saved. Please retry.' }, { status: 503, headers }); }
}
