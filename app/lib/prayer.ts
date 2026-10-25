/* Home Prayer Board — the read side the dashboard needs: today's leader and
   suras for the next recited prayer (Fajr, Maghrib, Isha).

   Prayer times are calculated, not fetched, with the SAME settings as tk's
   Guidance app on the Mac mini (com.batoulapps.GuidanceMac prefs, read
   25 Oct 2026): Oak Park VIC, method 3 = Muslim World League (Fajr 18°,
   Isha 17°), Maghrib = sunset, plus Guidance's own minute adjustments.
   Checked against Guidance's menu for 25 Oct (4:46 / 7:53 / 9:16).
   If tk changes Guidance's location or adjustments, copy them here.
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

const LAT = -37.71938916977013, LNG = 144.9128350675565, TZ = 'Australia/Melbourne';
/** Guidance's kBAUserDefaultsAdjustment* values, in minutes. */
const ADJUST: Record<PrayerId, number> = { fajr: -2, maghrib: 6, isha: -1 };
const rad = Math.PI / 180;

/** Local civil date (y, m, d) and weekday in Melbourne. */
function melDate(at: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

/** Sun's declination (radians) and equation of time (minutes) at a Julian day — Meeus, low precision. */
function sun(jd: number) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + 36000.76983 * T) * rad, M = (357.52911 + 35999.05029 * T) * rad;
  const e = 0.016708634 - 0.000042037 * T;
  const C = ((1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M)) * rad;
  const om = (125.04 - 1934.136 * T) * rad;
  const lambda = L0 + C - (0.00569 + 0.00478 * Math.sin(om)) * rad;
  const eps = (23.439291 - 0.0130042 * T + 0.00256 * Math.cos(om)) * rad;
  const y = Math.tan(eps / 2) ** 2;
  const eqt = 4 / rad * (y * Math.sin(2 * L0) - 2 * e * Math.sin(M) + 4 * e * y * Math.sin(M) * Math.cos(2 * L0) - 0.5 * y * y * Math.sin(4 * L0) - 1.25 * e * e * Math.sin(2 * M));
  return { dec: Math.asin(Math.sin(eps) * Math.sin(lambda)), eqt };
}

/** Fajr, sunset and Isha for one civil date, as instants. Each is solved at its own
 *  moment (two passes), because the sun's declination drifts through the day. */
export function prayerTimes(y: number, m: number, d: number): Record<PrayerId, Date> {
  const jd0 = Date.UTC(y, m - 1, d) / 864e5 + 2440587.5; // Julian day at 0h UTC
  const solve = (angle: number, side: -1 | 1) => {
    let t = 720 - 4 * LNG; // minutes after 0h UTC, first guess = solar noon
    for (let i = 0; i < 3; i++) {
      const { dec, eqt } = sun(jd0 + t / 1440);
      const cosH = (Math.sin(-angle * rad) - Math.sin(LAT * rad) * Math.sin(dec)) / (Math.cos(LAT * rad) * Math.cos(dec));
      t = 720 - 4 * LNG - eqt + side * Math.acos(cosH) / rad * 4;
    }
    return t;
  };
  // Rounded to the minute, as Guidance shows them.
  const at = (min: number, p: PrayerId) => new Date(Date.UTC(y, m - 1, d) + Math.round(min + ADJUST[p]) * 60000);
  return { fajr: at(solve(18, -1), 'fajr'), maghrib: at(solve(0.833, 1), 'maghrib'), isha: at(solve(17, 1), 'isha') };
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
