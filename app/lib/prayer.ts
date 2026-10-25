/* Home Prayer Board — the read side the dashboard needs: today's leader and
   suras for the next recited prayer (Fajr, Maghrib, Isha).

   Prayer times are calculated, not fetched: Melbourne, Muslim World League
   angles (Fajr 18°, Isha 17°), Maghrib = sunset. Accurate to a minute or two,
   which is enough for "who leads next"; it is not a timetable to pray by.
   Pure — no I/O — so node --test can run it. */

export type Leader = 'tk' | 'an' | 'try';
export type PrayerId = 'fajr' | 'maghrib' | 'isha';
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface PrayerBoard {
  v: 2; seed?: boolean; updated: string;
  rota: Record<DayKey, Record<PrayerId, Leader>>;
  cells: Record<DayKey, Record<PrayerId, [string, string]>>;
}

export const LEADER_NAME: Record<Leader, string> = { tk: 'TK', an: 'Ansar', try: 'Ansar (trial)' };
const DAYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PRAYER_NAME: Record<PrayerId, string> = { fajr: 'Fajr', maghrib: 'Maghrib', isha: 'Isha' };

const SURAHS: [number, string][] = [[78, 'An-Naba'], [79, "An-Nazi'at"], [80, "'Abasa"], [81, 'At-Takwir'], [82, 'Al-Infitar'], [83, 'Al-Mutaffifin'], [84, 'Al-Inshiqaq'], [85, 'Al-Buruj'], [86, 'At-Tariq'], [87, "Al-A'la"], [88, 'Al-Ghashiyah'], [89, 'Al-Fajr'], [90, 'Al-Balad'], [91, 'Ash-Shams'], [92, 'Al-Layl'], [93, 'Ad-Duha'], [94, 'Ash-Sharh'], [95, 'At-Tin'], [96, "Al-'Alaq"], [97, 'Al-Qadr'], [98, 'Al-Bayyinah'], [99, 'Az-Zalzalah'], [100, "Al-'Adiyat"], [101, "Al-Qari'ah"], [102, 'At-Takathur'], [103, "Al-'Asr"], [104, 'Al-Humazah'], [105, 'Al-Fil'], [106, 'Quraysh'], [107, "Al-Ma'un"], [108, 'Al-Kawthar'], [109, 'Al-Kafirun'], [110, 'An-Nasr'], [111, 'Al-Masad'], [112, 'Al-Ikhlas'], [113, 'Al-Falaq'], [114, 'An-Nas']];
const EXTRAS: Record<string, string> = { kursi: 'Ayat al-Kursi', r1: 'Amana ar-Rasul 285', r2: 'Amana ar-Rasul 286', k1: 'Al-Kahf 1–5', k2: 'Al-Kahf 6–10', s32: 'As-Sajdah', s76: 'Al-Insan' };
export const suraName = (id: string) => EXTRAS[id] ?? SURAHS.find(s => String(s[0]) === id)?.[1] ?? '—';

const LAT = -37.8136, LNG = 144.9631, TZ = 'Australia/Melbourne';
const rad = Math.PI / 180;

/** Local civil date (y, m, d) and weekday in Melbourne. */
function melDate(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

/** Fajr, sunset and Isha for one civil date, as instants. NOAA-style approximation. */
export function prayerTimes(y: number, m: number, d: number): Record<PrayerId, Date> {
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const g = (2 * Math.PI / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const noon = 720 - 4 * LNG - eqt; // minutes after UTC midnight
  const ha = (angle: number) => Math.acos((Math.sin(-angle * rad) - Math.sin(LAT * rad) * Math.sin(dec)) / (Math.cos(LAT * rad) * Math.cos(dec))) / rad * 4;
  const at = (min: number) => new Date(Date.UTC(y, m - 1, d) + min * 60000);
  return { fajr: at(noon - ha(18)), maghrib: at(noon + ha(0.833)), isha: at(noon + ha(17)) };
}

export interface NextPrayer { prayer: PrayerId; name: string; at: string; day: DayKey; leader: Leader; leaderName: string; suras: string[] }

/** The next recited prayer from `now`, today or tomorrow's Fajr. */
export function nextPrayer(board: PrayerBoard, now = new Date()): NextPrayer {
  for (let offset = 0; offset < 2; offset++) {
    const { y, m, d } = melDate(new Date(now.getTime() + offset * 864e5));
    const times = prayerTimes(y, m, d);
    const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    for (const p of ['fajr', 'maghrib', 'isha'] as PrayerId[]) {
      if (times[p] <= now) continue;
      const leader = board.rota[day][p];
      return { prayer: p, name: PRAYER_NAME[p], at: times[p].toISOString(), day, leader, leaderName: LEADER_NAME[leader], suras: board.cells[day][p].map(suraName) };
    }
  }
  throw new Error('No prayer in the next two days');
}

/** Today's three recited prayers, for the day rail. */
export function todaysPrayers(board: PrayerBoard, now = new Date()) {
  const { y, m, d } = melDate(now);
  const times = prayerTimes(y, m, d);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return (['fajr', 'maghrib', 'isha'] as PrayerId[]).map(p => ({ prayer: p, name: PRAYER_NAME[p], at: times[p].toISOString(), leaderName: LEADER_NAME[board.rota[day][p]] }));
}

/** Shape check for a board arriving from the editor (trust boundary). */
export function isBoard(x: unknown): x is PrayerBoard {
  const b = x as PrayerBoard;
  const keys: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return !!b && b.v === 2 && typeof b.updated === 'string' && keys.every(d =>
    (['fajr', 'maghrib', 'isha'] as PrayerId[]).every(p =>
      ['tk', 'an', 'try'].includes(b.rota?.[d]?.[p]) &&
      Array.isArray(b.cells?.[d]?.[p]) && b.cells[d][p].length === 2 &&
      b.cells[d][p].every(id => typeof id === 'string' && id.length <= 8)));
}
