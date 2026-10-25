import { NextResponse } from 'next/server';
import { GET as dailyGET } from '../daily/route';
import { GET as calendarGET } from '../calendar/route';
import { GET as shopifyGET } from '../shopify-daily/route';
import { GET as scheduleGET } from '../schedule/route';
import { readBoard } from '../../lib/prayer-store';
import { nextPrayer, todaysPrayers } from '../../lib/prayer';
import type { DailyPayload, DailyPerson } from '../../lib/daily/model';

/* /api/now — the home board's one feed. Everything public the board shows, in
   one request, so a TV polling once a minute costs one function call, not six.
   The other routes are called in-process (their GET handlers are plain
   functions), never over HTTP.

   Cached 60 s at the CDN: every screen in the house shares one upstream read
   per minute. Money is NOT here — it is PIN-gated, in /api/money-board.
   Each section fails alone: a dead source is null and the board says so. */

export const dynamic = 'force-dynamic';
const TZ = 'Australia/Melbourne';
const ANSAR = 'https://ansar-habits-tracker.netlify.app';

async function json<T>(p: Promise<Response>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json() as Promise<T>;
}

/** "8:45am" on today's Melbourne date → instant. */
function todayAt(clock: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(clock.trim());
  if (!m) return null;
  const h = (+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
  // Offset of Melbourne from UTC right now, in minutes; good for the whole school day.
  const offset = (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(now.getTime() / 60000) * 60000) / 60000;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, h, +m[2]) - offset * 60000);
}

type ScheduleRow = { entry: string; days: string[] | null; date: string | null; start: string; end: string; category: string; emoji: string };
type SchoolBlocks = { blocks: { rowId: string; name: string }[]; done: string[] };

const tasks = (p: DailyPerson | undefined) => p ? {
  done: p.done, total: p.total,
  items: p.groups.flatMap(g => g.tasks).map(t => ({ id: t.id, title: t.title, done: t.done, count: 'count' in t ? (t as { count?: string }).count ?? null : null })),
} : null;

export async function GET() {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short' }).format(now);
  const [daily, calendar, shop, schedule, school, board] = await Promise.allSettled([
    json<DailyPayload>(dailyGET()),
    json<{ events: { id: string; subject: string; startISO: string; isAllDay: boolean; account: string }[] }>(calendarGET()),
    json<{ timezone: string; days: { date: string; label: string; isToday: boolean; orders: number; revenue: number; sessions: number | null; conversion: number | null }[] }>(shopifyGET()),
    json<ScheduleRow[]>(scheduleGET()),
    fetch(`${ANSAR}/api/school-block`, { cache: 'no-store', signal: AbortSignal.timeout(10000) }).then(r => r.json() as Promise<SchoolBlocks>),
    readBoard(),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>) => r.status === 'fulfilled' ? r.value : null;

  const d = ok(daily), sb = ok(school), b = ok(board), cal = ok(calendar), s = ok(shop), sch = ok(schedule);
  const doneBlocks = new Set((sb?.blocks ?? []).filter(x => sb?.done.includes(x.rowId)).map(x => x.name.split('—')[0].trim()));

  const slotsFor = (wd: string) => (sch ?? []).filter(e => e.days?.includes(wd));
  // Weekends: show the next school day's plan instead of an empty column.
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const nextWd = slotsFor(weekday).length ? null : [1, 2, 3, 4, 5, 6].map(i => WEEK[(WEEK.indexOf(weekday) + i) % 7]).find(wd => slotsFor(wd).length) ?? null;
  const nextDay = nextWd ? {
    weekday: nextWd,
    slots: slotsFor(nextWd).filter(e => e.category === 'Learning' || e.category === 'Meal')
      .sort((x, y) => (todayAt(x.start, now)?.getTime() ?? 0) - (todayAt(y.start, now)?.getTime() ?? 0))
      .map(e => ({ title: e.entry, emoji: e.emoji, start: e.start })),
  } : null;

  const ansarDay = slotsFor(weekday)
    .map(e => {
      const start = todayAt(e.start, now), end = todayAt(e.end, now);
      const blockKey = e.entry.split('—')[0].trim();
      return start && end ? {
        title: e.entry, emoji: e.emoji, category: e.category, start: start.toISOString(), end: end.toISOString(),
        // Ticked = Ansar recorded this block in his app. Otherwise the clock is all we know.
        ticked: /^Block \d/.test(blockKey) ? doneBlocks.has(blockKey) : null,
      } : null;
    })
    .filter(Boolean)
    .sort((x, y) => x!.start.localeCompare(y!.start));

  const person = (id: string) => d?.people.find(p => p.id === id);
  const store = s ? (() => {
    const today = s.days.find(x => x.isToday) ?? s.days[0];
    const week = s.days.slice(0, 7);
    // Pace: the six full days before today, and how far through the store's day we are.
    const prior = s.days.filter(x => !x.isToday).slice(0, 6);
    const avg = (k: 'orders' | 'revenue') => prior.length ? prior.reduce((a, x) => a + x[k], 0) / prior.length : 0;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone || 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
    return {
      currency: 'USD',
      today: today ? { label: today.label, orders: today.orders, revenue: today.revenue, sessions: today.sessions, conversion: today.conversion } : null,
      week: week.map(x => ({ date: x.date, revenue: x.revenue, orders: x.orders })).reverse(),
      weekRevenue: week.reduce((a, x) => a + x.revenue, 0),
      weekOrders: week.reduce((a, x) => a + x.orders, 0),
      avgOrders: avg('orders'), avgRevenue: avg('revenue'),
      dayFraction: (+p.hour + +p.minute / 60) / 24,
    };
  })() : null;

  const body = {
    generatedAt: now.toISOString(),
    weekday,
    ansar: { day: ansarDay, nextDay, habits: tasks(person('ansar')), schoolTicks: sb ? { done: sb.done.length, total: sb.blocks.length } : null },
    nihal: tasks(person('nihal')),
    taylan: tasks(person('taylan')),
    prayer: b ? { next: nextPrayer(b, now), today: todaysPrayers(b, now) } : null,
    calendar: cal ? cal.events.filter(e => new Date(e.startISO).getTime() > now.getTime() - 3600e3).sort((x, y) => x.startISO.localeCompare(y.startISO)).slice(0, 5)
      .map(e => ({ id: e.id, subject: e.subject, startISO: e.startISO, isAllDay: e.isAllDay, who: e.account })) : null,
    store,
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } });
}
