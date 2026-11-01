/* Calendar time maths for /board. Pure, shared by server and client.
   Days are "YYYY-MM-DD" strings (calendar days, no zone). Instants are ISO
   strings. The household zone is resolved with Intl, never a fixed offset. */

export const TZ = 'Australia/Melbourne';

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Wall-clock day and minute-of-day in Melbourne for an instant. */
export function wall(iso: string | Date): { day: string; min: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

/** Melbourne wall time (day + minutes) for a zone → UTC ISO. Two passes settle DST edges. */
export function zonedToISO(day: string, min: number, tz = TZ): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, 0, min);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    t += target - seen;
  }
  return new Date(t).toISOString();
}

const asDate = (day: string) => new Date(day + 'T12:00:00Z');
const asDay = (d: Date) => d.toISOString().slice(0, 10);

export const today = () => wall(new Date()).day;
export const addDays = (day: string, n: number) => { const d = asDate(day); d.setUTCDate(d.getUTCDate() + n); return asDay(d); };
export const addMonths = (day: string, n: number) => { const d = asDate(day.slice(0, 8) + '01'); d.setUTCMonth(d.getUTCMonth() + n); return asDay(d); };
/** 0 = Monday … 6 = Sunday. The household week starts Monday. */
export const weekdayMon = (day: string) => (asDate(day).getUTCDay() + 6) % 7;
export const startOfWeek = (day: string) => addDays(day, -weekdayMon(day));
export const startOfMonth = (day: string) => day.slice(0, 8) + '01';
export const daysInMonth = (day: string) => { const d = asDate(startOfMonth(day)); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.getUTCDate(); };
export const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** The 6×7 grid a month view shows, Monday first. */
export const monthGrid = (day: string) => range(startOfWeek(startOfMonth(day)), 42);

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-AU', { ...o, timeZone: 'UTC' });
const monthLong = fmt({ month: 'long' }), wdShort = fmt({ weekday: 'short' }), wdLong = fmt({ weekday: 'long' }), monthShort = fmt({ month: 'short' });
export const monthName = (day: string) => monthLong.format(asDate(day));
export const monthAbbr = (day: string) => monthShort.format(asDate(day));
export const weekdayShort = (day: string) => wdShort.format(asDate(day));
export const weekdayLong = (day: string) => wdLong.format(asDate(day));
export const dayNum = (day: string) => Number(day.slice(8));

/** "9 am", "9:30 am", "Noon" — Apple's style. */
export function clock(min: number, noon = false): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  if (noon && h === 12 && m === 0) return 'Noon';
  const h12 = h % 12 || 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
}
