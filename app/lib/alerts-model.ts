/* Calendar pop-up rules, pure (node --test runs them): when an alert is due,
   which order they show in, and the look each event series gets. */

export type AlertMode = 'popup' | 'popout';
export type AlertEvent = { key: string; title: string; startISO: string; endISO: string; cal: string; allDay?: boolean; scene?: Scene };
type Live = AlertEvent & { mode: AlertMode; preview?: boolean };

export const LEAD_MS = 10 * 60_000;
export const CAL_LABEL: Record<string, string> = { family: 'Family', taylan: 'TK', nihal: 'Nihal', ansar: 'Ansar', kurgel: 'Kurgel', routine: 'Routine' };
export const CAL_HUE: Record<string, string> = { family: '#b8612f', taylan: '#1f4a45', nihal: '#a8456b', ansar: '#c98a1b', kurgel: '#6b4f9e', routine: '#7a7468' };
export const ACCENTS = ['#f0b089', '#7fd1c2', '#ffd36e', '#c9b6ff', '#ff9aa8', '#9fd47e'];
export const SCENES = ['orbit', 'burst', 'waves', 'tiles', 'aurora'] as const;
export type Scene = typeof SCENES[number];

const ICONS: [RegExp, string][] = [
  [/football|soccer|futsal/i, '⚽'], [/swim/i, '🏊'], [/gym|train|run\b|walk/i, '🏃'], [/birthday|🎂/i, '🎂'],
  [/call|phone|zoom|meet/i, '📞'], [/doctor|dentist|gp\b|clinic|hospital/i, '🩺'], [/school|homeschool|vrqa|class|lesson/i, '🎒'],
  [/seera|barzakh|qur|quran|halaqa|masjid|salah|prayer|jumu/i, '🕌'], [/dinner|lunch|breakfast|eat|bbq/i, '🍽️'],
  [/flight|airport|travel/i, '✈️'], [/shop|groceries|market/i, '🛒'], [/pay|bill|bank|card|tax|revolut/i, '💳'],
  [/export|file|notion|report/i, '📁'], [/family|alignment/i, '🏡'], [/drive|depot|pick ?up|drop/i, '🚗'],
];
export const iconFor = (t: string) => ICONS.find(([re]) => re.test(t))?.[1] ?? '📅';

export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Scene and accent for an event: the raw hash's low bits cluster for similar keys, so mix first. */
export function look(key: string, scene?: Scene) { const r = rng(hash(key)); const picked = SCENES[Math.floor(r() * SCENES.length)]; return { scene: scene ?? picked, accent: ACCENTS[Math.floor(r() * ACCENTS.length)] }; }

/** Due = switched on, timed, inside [start − 10 min, max(end, start + 15 min)), not cleared.
    Pop-ups before pop-outs, then soonest first. */
export function dueAlerts(events: AlertEvent[], alerts: Record<string, AlertMode>, now: number, cleared: (e: AlertEvent) => boolean) {
  return events.filter(e => alerts[e.key] && !e.allDay && now >= Date.parse(e.startISO) - LEAD_MS && now < Math.max(Date.parse(e.endISO), Date.parse(e.startISO) + 15 * 60_000) && !cleared(e))
    .map(e => ({ ...e, mode: alerts[e.key] }))
    .sort((a, b) => Number(a.mode === 'popout') - Number(b.mode === 'popout') || a.startISO.localeCompare(b.startISO));
}
