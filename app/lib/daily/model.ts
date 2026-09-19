/* ════════════════════════════════════════════════════════════════════════════
   "Today, together." — the daily screen's pure logic. No I/O, no React.

   Every task on the daily screen moves one of the Sunday review's numbers, so
   the weekday screen and the weekend review tell the same story. Three kinds:
     · config tasks  — table 8 · Family Daily Tasks (Notion), one row each.
                       `auto` names the app that ticks it; blank = tapped by hand.
     · Ansar's list  — his real habits (table 4) and completions, read-only here;
                       he ticks them in his own app, some behind a parent PIN.
     · pace tiles    — the Sunday numbers so far, straight from the weekly report.

   Only `import type` below: node --test runs this file directly.
   ══════════════════════════════════════════════════════════════════════════ */
import type { MemberId, WeeklyReport } from '../sunday/model';

export const AUTO_KINDS = ['quran', 'discoveries', 'os_opens', 'mentorship', 'validated'] as const;
export type AutoKind = typeof AUTO_KINDS[number];
export type TaskMember = Exclude<MemberId, 'ansar'>;

/** Sunday targets the pace tiles measure against. Change them here. */
export const WEEK_TARGETS = { discoveries: 5, validations: 3, launched: 1 } as const;
/** Ansar's Mon–Fri points needed for Saturday screen time (ansar-habits-tracker weekend.ts). */
export const ANSAR_BENCH = 34;

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayShort = (iso: string) => DAY_SHORT[new Date(iso + 'T12:00:00Z').getUTCDay()];
export const dayLong = (iso: string) => DAY_LONG[new Date(iso + 'T12:00:00Z').getUTCDay()];

export interface TaskRow { id: string; member: TaskMember; title: string; order: number; days: string[]; feeds: string; auto: AutoKind | null; link: string | null }
export interface HabitRow { id: string; name: string; block: string; order: number; days: string[] }
export interface DailyTask { id: string; title: string; feeds: string; source: string; auto: boolean; done: boolean; href: string | null; count?: string }
export interface TaskGroup { name: string | null; tasks: DailyTask[] }
export interface DayBar { date: string; pct: number | null; future: boolean }
export interface DailyPerson { id: MemberId; name: string; focus: string; href: string; groups: TaskGroup[]; done: number; total: number; week: DayBar[] }
export interface PaceTile { key: string; label: string; value: string; of: string | null; pct: number | null; state: 'good' | 'warn' | null; stateLabel: string; note: string; href: string }
export interface DailyPayload { today: string; weekday: string; dayOfWeek: number; people: DailyPerson[]; pace: PaceTile[]; ticksAvailable: boolean; generatedAt: string }

const FOCUS: Record<MemberId, string> = { taylan: 'Build & launch', nihal: 'Find & learn', ansar: 'Learn & grow', ayah: 'Little steps' };
const HOME: Record<MemberId, string> = {
  taylan: 'https://creative-os-318.netlify.app/mission-control',
  nihal: 'https://nihal-os-control-room.netlify.app/#homeschool',
  ansar: 'https://ansar-habits-tracker.netlify.app/',
  ayah: 'https://quran-os.netlify.app/m/ayah',
};
const AUTO_SOURCE: Record<AutoKind, string> = { quran: 'Quran OS', discoveries: 'surface log', os_opens: 'Nihal OS', mentorship: 'Origins', validated: 'pipeline' };
const ANSAR_TRACKER = 'https://ansar-habits-tracker.netlify.app/';
const BLOCKS: { id: string; name: string }[] = [
  { id: 'pre', name: 'Morning' }, { id: 'school', name: 'Homeschool' },
  { id: 'push', name: 'Saturday Push' }, { id: 'arvo', name: 'Afternoon & evening' },
];
/** A block with more habits than this shows as one summary row with a count. */
const SUMMARY_OVER = 3;

/** Monday = 1 … Sunday = 7. */
export function dayOfWeek(iso: string) { const d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }

/** Does this task apply on that date? Empty Days = every day. */
export function appliesOn(days: string[], iso: string) { return days.length === 0 || days.includes(dayShort(iso)); }

/** Has the named app recorded this task for that date? */
export function autoDone(kind: AutoKind, member: MemberId, date: string, report: WeeklyReport | null): boolean {
  if (!report) return false;
  if (kind === 'quran') {
    const p = report.people.find(x => x.id === member);
    return !!p?.quran.available && (p.quran.days.find(d => d.date === date)?.sessions ?? 0) > 0;
  }
  const metric = report.people.flatMap(p => p.metrics).find(m => m.key === kind);
  if (!metric) return false;
  if (metric.daily) return (metric.daily.find(d => d.date === date)?.count ?? 0) > 0;
  return (metric.perDay?.[date] ?? 0) > 0;
}

function defaultLink(kind: AutoKind | null, member: MemberId, report: WeeklyReport | null): string | null {
  if (kind === 'quran') return `https://quran-os.netlify.app/m/${member}`;
  if (!kind) return null;
  return report?.people.flatMap(p => p.metrics).find(m => m.key === kind)?.href ?? null;
}

/** One person's config-task list for a date. `ticked` = hand-ticked task ids for that date. */
export function configTasks(member: TaskMember, date: string, rows: TaskRow[], report: WeeklyReport | null, ticked: Set<string>): DailyTask[] {
  return rows.filter(r => r.member === member && appliesOn(r.days, date)).sort((a, b) => a.order - b.order).map(r => ({
    id: r.id, title: r.title, feeds: r.feeds,
    source: r.auto ? `auto · ${AUTO_SOURCE[r.auto]}` : 'tap',
    auto: r.auto !== null,
    done: r.auto ? autoDone(r.auto, member, date, report) : ticked.has(r.id),
    href: r.link ?? defaultLink(r.auto, member, report),
  }));
}

/** Ansar's day, grouped by block. Big blocks collapse to one row with a count. */
export function ansarGroups(date: string, habits: HabitRow[], completed: Set<string>): TaskGroup[] {
  const today = habits.filter(h => appliesOn(h.days, date));
  return BLOCKS.map((b): TaskGroup | null => {
    const list = today.filter(h => h.block === b.id).sort((x, y) => x.order - y.order);
    if (!list.length) return null;
    if (list.length > SUMMARY_OVER) {
      const n = list.filter(h => completed.has(h.id)).length;
      return { name: null, tasks: [{ id: `block-${b.id}`, title: `${b.name} habits`, feeds: 'Week score', source: 'auto · Ansar OS', auto: true, done: n === list.length, href: ANSAR_TRACKER, count: `${n} / ${list.length}` }] };
    }
    return { name: b.name, tasks: list.map(h => ({ id: h.id, title: h.name, feeds: b.id === 'push' ? 'Saturday unlock' : 'Week score', source: b.id === 'push' ? 'parent PIN · Ansar OS' : 'auto · Ansar OS', auto: true, done: completed.has(h.id), href: ANSAR_TRACKER })) };
  }).filter((g): g is TaskGroup => g !== null)
    // Summary rows sit together under one "Habits" heading instead of one heading each.
    .reduce<TaskGroup[]>((out, g) => {
      const last = out[out.length - 1];
      if (g.name === null && last && last.name === 'Habits') last.tasks.push(...g.tasks);
      else out.push(g.name === null ? { name: 'Habits', tasks: g.tasks } : g);
      return out;
    }, []);
}

const flat = (groups: TaskGroup[]) => groups.flatMap(g => g.tasks);
/** Share of a day's list that got done; null when nothing was scheduled. */
export function share(groups: TaskGroup[]) { const all = flat(groups); return all.length ? all.filter(t => t.done).length / all.length : null; }

export function person(id: MemberId, name: string, groups: TaskGroup[], week: DayBar[]): DailyPerson {
  const all = flat(groups);
  return { id, name, focus: FOCUS[id], href: HOME[id], groups, done: all.filter(t => t.done).length, total: all.length, week };
}

/** Where the Sunday numbers stand, judged against an even pace through the week. */
export function paceTiles(report: WeeklyReport | null, today: string): PaceTile[] {
  if (!report) return [];
  const elapsed = dayOfWeek(today) / 7;
  const judge = (value: number | null, target: number): PaceTile['state'] => value === null ? null : value >= target * elapsed ? 'good' : 'warn';
  const label = (value: number | null, target: number) => value === null ? 'Not connected' : value >= target ? 'Done ✓' : value >= target * elapsed ? 'On pace' : 'Behind';
  const pct = (value: number | null, target: number) => value === null ? null : Math.min(100, Math.round(value / target * 100));
  const metric = (member: MemberId, key: string) => report.people.find(p => p.id === member)?.metrics.find(m => m.key === key);

  const quranDays = report.people.every(p => p.quran.available) ? report.people.reduce((n, p) => n + p.quran.totalDays, 0) : null;
  const quranMax = report.people.length * 7;
  const { discoveries, validations, launched } = report.shared;

  const school = metric('ansar', 'school_score');
  const points = Number(/^(\d+)\s*\/\s*\d+/.exec(school?.detail ?? '')?.[1] ?? NaN);
  const hasPoints = Number.isFinite(points);

  const sleepers = report.people.map(p => ({ name: p.name, v: p.metrics.find(m => m.key === 'sleep')?.value ?? null })).filter((s): s is { name: string; v: number } => s.v !== null);
  const sleep = sleepers.length ? sleepers.reduce((n, s) => n + s.v, 0) : null;

  const tile = (key: string, labelText: string, value: number | null, target: number, note: string, href: string): PaceTile =>
    ({ key, label: labelText, value: value === null ? '—' : String(value), of: `/ ${target}`, pct: pct(value, target), state: judge(value, target), stateLabel: label(value, target), note, href });

  return [
    tile('quran', 'Quran days · family', quranDays, quranMax, report.people.map(p => `${p.name} ${p.quran.available ? p.quran.totalDays : '—'}`).join(' · '), 'https://quran-os.netlify.app/'),
    tile('discoveries', 'Products found', discoveries, WEEK_TARGETS.discoveries, 'Nihal’s surface log', metric('nihal', 'discoveries')?.href ?? 'https://kurgel-dashboard.netlify.app/'),
    tile('validated', 'Products validated', validations, WEEK_TARGETS.validations, 'shared pipeline', 'https://kurgel-dashboard.netlify.app/business'),
    tile('launched', 'Products launched', launched, WEEK_TARGETS.launched, 'first launch in the test log', 'https://ecom-launchpad-mentor.netlify.app/'),
    { key: 'ansar', label: 'Ansar week score', value: school?.value == null ? '—' : `${school.value}%`, of: hasPoints ? `${points} / 55` : null, pct: school?.value ?? null, state: hasPoints ? (points >= ANSAR_BENCH ? 'good' : 'warn') : null, stateLabel: hasPoints ? (points >= ANSAR_BENCH ? 'Saturday unlocked' : 'Below Bench') : 'Not connected', note: `Bench is ${ANSAR_BENCH}`, href: ANSAR_TRACKER },
    { key: 'sleep', label: 'Back to sleep', value: sleep === null ? '—' : String(sleep), of: 'mornings', pct: sleep === null ? null : Math.min(100, Math.round(sleep / 14 * 100)), state: sleep === null ? null : sleep === 0 ? 'good' : 'warn', stateLabel: sleep === null ? 'Not entered' : sleep === 0 ? 'None ✓' : 'Aim for 0', note: sleepers.map(s => `${s.name} ${s.v}`).join(' · ') || 'entered on the weekly review', href: 'https://kurgel-dashboard.netlify.app/?theme=gather' },
  ];
}
