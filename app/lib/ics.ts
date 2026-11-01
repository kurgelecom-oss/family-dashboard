/* Minimal iCalendar (.ics) reader for Google's secret calendar addresses.
   Handles DTSTART/DTEND in UTC, TZID or all-day form, EXDATE, and RRULE with
   FREQ DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL, COUNT, UNTIL, BYDAY (weekly only).
   Known limit: no BYSETPOS, no BYDAY on monthly rules ("2nd Tuesday"), no
   RECURRENCE-ID overrides — a moved single occurrence shows at its old time too. */
import { addDays, zonedToISO } from './cal-time.ts';

export type IcsEvent = { uid: string; series: string; title: string; startISO: string; endISO: string; allDay: boolean };

type Prop = { value: string; params: Record<string, string> };

function unfold(text: string) { return text.replace(/\r?\n[ \t]/g, ''); }

function parseLine(line: string): [string, Prop] | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  return [name.toUpperCase(), { value: line.slice(colon + 1), params: Object.fromEntries(params.map(p => { const i = p.indexOf('='); return [p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, '')]; })) }];
}

/** → [ISO, allDay]. Floating times are read as the household zone. */
function when(p: Prop): [string, boolean] {
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) { const day = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`; return [zonedToISO(day, 0), true]; }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return ['', false]; // unparseable → Date.parse('') is NaN and the caller skips it
  if (m[7]) return [new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString(), false];
  return [zonedToISO(`${m[1]}-${m[2]}-${m[3]}`, +m[4] * 60 + +m[5], p.params.TZID || undefined), false];
}

const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function parseIcs(text: string, fromISO: string, toISO: string): IcsEvent[] {
  const from = Date.parse(fromISO), to = Date.parse(toISO), out: IcsEvent[] = [];
  const blocks = unfold(text).split(/BEGIN:VEVENT/).slice(1).map(b => b.split(/END:VEVENT/)[0]);
  for (const block of blocks) {
    const props = new Map<string, Prop>(); const ex = new Set<number>();
    for (const line of block.split(/\r?\n/)) {
      const p = parseLine(line); if (!p) continue;
      if (p[0] === 'EXDATE') p[1].value.split(',').forEach(v => ex.add(Date.parse(when({ value: v, params: p[1].params })[0])));
      else if (!props.has(p[0])) props.set(p[0], p[1]);
    }
    const ds = props.get('DTSTART'); if (!ds || props.get('STATUS')?.value === 'CANCELLED') continue;
    const [startISO, allDay] = when(ds);
    const de = props.get('DTEND');
    const start = Date.parse(startISO);
    const dur = de ? Date.parse(when(de)[0]) - start : allDay ? 864e5 : 0;
    if (!Number.isFinite(start)) continue;
    const title = unescape(props.get('SUMMARY')?.value ?? '(No title)'), uid = props.get('UID')?.value ?? title + startISO;
    const push = (s: number) => { if (s < to && s + dur > from && !ex.has(s)) out.push({ uid: `${uid}-${s}`, series: uid, title, startISO: new Date(s).toISOString(), endISO: new Date(s + dur).toISOString(), allDay }); };
    const rule = props.get('RRULE')?.value;
    if (!rule) { push(start); continue; }
    const r = Object.fromEntries(rule.split(';').map(kv => kv.split('=')));
    const interval = Math.max(1, Number(r.INTERVAL) || 1), count = Number(r.COUNT) || Infinity;
    // A date-only UNTIL includes that whole day.
    const until = r.UNTIL ? Date.parse(when({ value: r.UNTIL, params: {} })[0]) + (/^\d{8}$/.test(r.UNTIL) ? 864e5 - 1 : 0) : Infinity;
    // Step by wall-clock day in the event's own zone so DST never shifts the time of day.
    const tz = ds.params.TZID;
    const base = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(start));
    const bp = Object.fromEntries(base.map(x => [x.type, x.value]));
    const baseDay = `${bp.year}-${bp.month}-${bp.day}`, baseMin = allDay ? 0 : Number(bp.hour) * 60 + Number(bp.minute);
    const at = (day: string) => ds.value.endsWith('Z') && !tz ? Date.parse(zonedToISO(day, baseMin, 'UTC')) : Date.parse(zonedToISO(day, baseMin, tz));
    const byday: string[] = r.FREQ === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',') : [];
    let n = 0;
    for (let i = 0; n < count && i < 5000; i++) {
      let days: string[];
      if (r.FREQ === 'DAILY') days = [addDays(baseDay, i * interval)];
      else if (r.FREQ === 'WEEKLY') {
        const wk = addDays(baseDay, i * 7 * interval);
        const mon = addDays(wk, -((new Date(wk + 'T12:00:00Z').getUTCDay() + 6) % 7));
        days = byday.length ? byday.map(d => addDays(mon, DAYS.indexOf(d.slice(-2)))).filter(d => d >= baseDay).sort() : [wk];
      } else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
        const d = new Date(baseDay + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + i * interval * (r.FREQ === 'YEARLY' ? 12 : 1));
        days = d.getUTCDate() === Number(baseDay.slice(8)) ? [d.toISOString().slice(0, 10)] : [];
      } else { push(start); break; }
      let stop = false;
      for (const day of days) { const s = at(day); if (s > until || n >= count || s >= to) { stop = true; break; } n++; push(s); }
      if (stop) break;
    }
  }
  return out;
}
