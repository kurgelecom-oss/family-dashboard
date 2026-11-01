import { NextResponse } from 'next/server';
import { ACCOUNTS, fetchEvents, getAccessToken, toISO } from '../../lib/graph-cal';
import { parseIcs } from '../../lib/ics';
import { GET as boardGET } from '../board/route';
import type { Block } from '../board/route';
import { addDays, range, weekdayShort, zonedToISO } from '../../lib/cal-time';

/* /api/cal?from=YYYY-MM-DD&to=YYYY-MM-DD (to exclusive) — every READ-ONLY calendar
   for the /board family calendar, in one shape:
     · Outlook (Graph) for TK, Nihal and Ansar — same refresh tokens as /api/calendar
     · Google secret iCal feeds from FAMILY_ICS_FEEDS ("kurgel|https://…ics,family|https://…ics")
     · the Notion weekly routines that /api/board serves, placed on real dates
   Events made on the TV live in /api/cal/events and are never mixed into this
   cached response, so an edit shows at once instead of after the CDN window. */

export const dynamic = 'force-dynamic';

export type ExtEvent = { id: string; cal: string; title: string; startISO: string; endISO: string; allDay: boolean; source: 'outlook' | 'google' | 'routine'; link?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams, from = q.get('from') ?? '', to = q.get('to') ?? '';
  if (!DAY.test(from) || !DAY.test(to) || to <= from || to > addDays(from, 45)) return NextResponse.json({ error: 'from/to must be YYYY-MM-DD, at most 45 days apart' }, { status: 400 });
  const fromISO = zonedToISO(from, 0), toISO_ = zonedToISO(to, 0);
  const events: ExtEvent[] = [], errors: string[] = [], missing: string[] = [];

  const outlook = ACCOUNTS.map(async a => {
    const refresh = process.env[a.envKey];
    if (!refresh) { missing.push(a.email); return; }
    const raw = await fetchEvents(await getAccessToken(refresh), fromISO, toISO_, 250);
    for (const e of raw) if (!e.isCancelled && e.responseStatus?.response !== 'declined')
      events.push({ id: `${a.key}-${e.id}`, cal: a.key.toLowerCase(), title: e.subject?.trim() || '(No title)', startISO: toISO(e.start.dateTime), endISO: toISO(e.end.dateTime), allDay: !!e.isAllDay, source: 'outlook', link: e.webLink });
  });

  const feeds = (process.env.FAMILY_ICS_FEEDS ?? '').split(',').map(s => s.trim()).filter(Boolean).map(async spec => {
    const [label, url] = spec.split('|');
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${label} feed ${res.status}`);
    for (const e of parseIcs(await res.text(), fromISO, toISO_)) events.push({ id: `${label}-${e.uid}`, cal: label === 'family' ? 'family' : 'kurgel', title: e.title, startISO: e.startISO, endISO: e.endISO, allDay: e.allDay, source: 'google' });
  });
  if (!process.env.FAMILY_ICS_FEEDS) missing.push('Google (FAMILY_ICS_FEEDS)');

  const routines = (async () => {
    const res = await boardGET(new Request('http://local/api/board'));
    if (!res.ok) throw new Error(`routines ${res.status}`);
    const { blocks } = await res.json() as { blocks: Block[] };
    for (const day of range(from, Math.round((Date.parse(to) - Date.parse(from)) / 864e5))) {
      const wd = weekdayShort(day);
      for (const b of blocks) {
        if (b.startMin === null || !(b.date ? b.date === day : b.day === wd)) continue;
        const end = b.endMin !== null && b.endMin > b.startMin ? b.endMin : b.startMin + 30;
        events.push({ id: `routine-${b.person}-${b.layer}-${day}-${b.startMin}-${b.title}`, cal: 'routine', title: `${b.person[0].toUpperCase()}${b.person.slice(1)} · ${b.title}`, startISO: zonedToISO(day, b.startMin), endISO: zonedToISO(day, end), allDay: false, source: 'routine' });
      }
    }
  })();

  (await Promise.allSettled([...outlook, ...feeds, routines])).forEach(r => { if (r.status === 'rejected') errors.push(String(r.reason).slice(0, 200)); });

  // A shared invitation shows once: same title and start = same event.
  const seen = new Set<string>();
  const unique = events.sort((a, b) => a.startISO.localeCompare(b.startISO)).filter(e => { const k = `${e.title.toLowerCase()}|${e.startISO}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return NextResponse.json({ events: unique, errors, missing }, { headers: {
    'Cache-Control': errors.length && !unique.length ? 'no-store' : 'public, s-maxage=120, stale-while-revalidate=120',
    // Netlify keys its edge cache without query strings unless told; without this every week would share one entry.
    'Netlify-Vary': 'query=from|to',
  } });
}
