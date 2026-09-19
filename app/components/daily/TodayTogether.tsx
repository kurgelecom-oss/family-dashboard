'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { familyWrite } from '../FamilyEditGate';
import { CycleTracker, IncidentCounter } from '../TopNav';
import { buildFaceModel, useFaceData } from '../face/useFaceData';
import type { DailyPayload, DailyPerson, DailyTask, PaceTile } from '../../lib/daily/model';
import './daily.css';

/* ════════════════════════════════════════════════════════════════════════════
   "Today, together." — the daily family screen (replaced the rotating
   face frames on 19 Sep 2026). Same visual language as the Sunday "Gather"
   review, because every task here moves one of Sunday's numbers.

   · Tasks come from /api/daily. Dashed boxes tick themselves from their app;
     solid boxes are tapped (family PIN). Ansar's rows are his own habits,
     ticked in his app.
   · Nihal's card carries the incident counter and the unlabeled cycle switch
     (long-press for its history) — the same components the top bar used, so
     the Supabase log, the Notion mirror and the intermission softening all
     keep working. The top bar hides its copy on this screen.
   · The business strip keeps the old tiles' links: Week → /money,
     Test → /business, Tryliare → /table. Ansar's streak stays unlinked.
   ══════════════════════════════════════════════════════════════════════════ */

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const THEME_KEY = 'family-daily-theme';
type ThemeChoice = 'auto' | 'day' | 'night';

function melbourneHour(now: Date) {
  return Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Australia/Melbourne' }).format(now));
}
const clockLabel = (now: Date) => new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' }).format(now);
const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

function Tile({ t }: { t: PaceTile }) {
  return (
    <a className="dd-tile" href={t.href} target="_blank" rel="noopener noreferrer">
      <span className="dd-tile-label">{t.label}</span>
      <span className="dd-tile-val"><strong>{t.value}</strong>{t.of && <span>{t.of}</span>}</span>
      <span className="dd-bar"><i style={{ width: `${t.pct ?? 0}%` }} data-state={t.state ?? undefined} /></span>
      <small><b data-state={t.state ?? undefined}>{t.stateLabel}</b> · {t.note}</small>
    </a>
  );
}

function TaskRow({ task, onTick, busy }: { task: DailyTask; onTick: (t: DailyTask) => void; busy: boolean }) {
  const title = task.href
    ? <a href={task.href} target="_blank" rel="noopener noreferrer">{task.title}</a>
    : <span>{task.title}</span>;
  return (
    <li className={`dd-task${task.done ? ' done' : ''}${task.auto ? ' auto' : ''}`}>
      <button
        type="button"
        className="dd-check"
        aria-pressed={task.done}
        aria-label={`${task.title}${task.auto ? ' (ticks itself)' : ''}`}
        title={task.auto ? 'Ticks itself from the linked app' : task.done ? 'Tap to untick' : 'Tap to tick'}
        disabled={task.auto || busy}
        onClick={() => onTick(task)}
      >✓</button>
      <div>
        <b>{title}</b>
        <small><span className="dd-feeds">→ {task.feeds || 'Today'}</span><span>· {task.source}</span></small>
      </div>
      {task.count && <span className="dd-count">{task.count}</span>}
    </li>
  );
}

function PersonCard({ p, todayIdx, onTick, busyId }: { p: DailyPerson; todayIdx: number; onTick: (t: DailyTask) => void; busyId: string | null }) {
  const pct = p.total ? p.done / p.total : 0;
  return (
    <article className="dd-person" data-person={p.id}>
      <div className="dd-ph">
        <div>
          <span className="dd-initial">{p.name[0]}</span>
          <div>
            <h2><a href={p.href} target="_blank" rel="noopener noreferrer">{p.name}</a></h2>
            <span className="dd-focus">{p.focus}</span>
          </div>
        </div>
        <div className="dd-ring" style={{ ['--p' as string]: pct }} role="img" aria-label={`${p.done} of ${p.total} done today`}>
          <span>{p.total ? `${p.done}/${p.total}` : '—'}</span>
        </div>
      </div>
      {p.id === 'nihal' && <div className="dd-signals"><IncidentCounter /><CycleTracker /></div>}
      <div className="dd-list">
        {p.total === 0 && <p className="dd-empty">{p.id === 'ansar' ? 'Rest day.' : 'Nothing on the list today.'}</p>}
        {p.groups.map((g, i) => (
          <div key={i}>
            {g.name && <div className="dd-group">{g.name}</div>}
            <ul className="dd-tasks">{g.tasks.map(t => <TaskRow key={t.id} task={t} onTick={onTick} busy={busyId === t.id} />)}</ul>
          </div>
        ))}
      </div>
      <div className="dd-week">
        <div className="dd-week-lbl"><span>This week</span><span>full bar = whole list done</span></div>
        <div className="dd-days">
          {p.week.map((d, i) => d.future || d.pct === null
            ? <i key={d.date} className={d.future ? 'future' : 'rest'} title={`${DAY_LETTERS[i]}: ${d.future ? 'still to come' : 'nothing scheduled'}`} />
            : <i key={d.date} className={`${d.pct >= 1 ? 'full' : ''}${i === todayIdx ? ' today' : ''}`} style={{ height: `${Math.max(10, d.pct * 100)}%` }} title={`${DAY_LETTERS[i]}: ${Math.round(d.pct * 100)}% of the list`} />)}
        </div>
        <div className="dd-dnames">{DAY_LETTERS.map((d, i) => <span key={i}>{d}</span>)}</div>
      </div>
    </article>
  );
}

function BusinessStrip() {
  const data = useFaceData();
  const m = useMemo(() => buildFaceModel(data), [data]);
  return (
    <section className="dd-panel dd-biz" aria-label="The business">
      <a className="dd-biz-main" href="/business">
        <span className="dd-biz-label">{m.nextAction ?? 'The test'}</span>
        <strong>{m.headline}</strong>
        <span className="dd-bar"><i style={{ width: `${m.tractionPct}%` }} /></span>
        <small>{m.tractionDays !== null ? `${m.tractionDays} days left` : ''}</small>
      </a>
      <a href="/money"><span className="dd-biz-label">Week</span><strong>{m.weekSpend ?? '—'}</strong><small>{m.weekEnded !== null ? `ended ${m.weekEnded}` : 'last week'}</small></a>
      <a href="/business"><span className="dd-biz-label">Test</span><strong data-stale={m.testStale || undefined}>{m.testWord}</strong><small>{m.testContext}</small></a>
      <a href="/table"><span className="dd-biz-label">{m.storeName}</span><strong>{m.storeOrders} <em>orders</em></strong><small>{m.storeContext}</small></a>
      <div><span className="dd-biz-label">Ansar</span><strong>{m.streak !== null ? `${m.streak} day streak` : '—'}</strong><small>{m.todayPct !== null ? `${m.todayPct}% today` : 'Ansar OS'}</small></div>
    </section>
  );
}

export default function TodayTogether() {
  const [data, setData] = useState<DailyPayload | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Mounted client-side only (SundayShell renders nothing until its first effect), so storage is safe here.
  const [choice, setChoice] = useState<ThemeChoice>(() => { try { const s = localStorage.getItem(THEME_KEY); return s === 'day' || s === 'night' ? s : 'auto'; } catch { return 'auto'; } });
  const pending = useRef(false);

  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      const r = await fetch('/api/daily', { cache: 'no-store' });
      if (!r.ok) throw new Error('Today’s list is unavailable. It will retry.');
      setData(await r.json()); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unavailable'); }
    finally { pending.current = false; }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const poll = setInterval(() => void load(), 60000);
    const clock = setInterval(() => setNow(new Date()), 15000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const hour = melbourneHour(now);
  const night = choice === 'night' || (choice === 'auto' && (hour >= 19 || hour < 6));
  function cycleTheme() {
    const next: ThemeChoice = choice === 'auto' ? (night ? 'day' : 'night') : choice === 'day' ? 'night' : 'auto';
    setChoice(next);
    try { if (next === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch {}
  }

  async function tick(task: DailyTask) {
    if (task.auto || !data) return;
    setBusyId(task.id);
    const flip = (done: boolean) => setData(d => d && ({ ...d, people: d.people.map(p => {
      const groups = p.groups.map(g => ({ ...g, tasks: g.tasks.map(t => t.id === task.id ? { ...t, done } : t) }));
      const all = groups.flatMap(g => g.tasks);
      return { ...p, groups, done: all.filter(t => t.done).length };
    }) }));
    flip(!task.done);
    try {
      const r = await familyWrite('/api/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, done: !task.done }) });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || 'Tick not saved'); }
      void load();
    } catch (e) { flip(task.done); setError(e instanceof Error ? e.message : 'Tick not saved'); }
    finally { setBusyId(null); }
  }

  const all = data?.people.flatMap(p => p.groups.flatMap(g => g.tasks)) ?? [];
  const done = all.filter(t => t.done).length;

  return (
    <main className="dd-root" data-theme={night ? 'night' : 'day'}>
      <header className="dd-hero">
        <div>
          <div className="dd-edition">Kurgel family <span /> Daily</div>
          <h1>Today, together.</h1>
          <p>{data ? dateLabel(data.today) : ' '} <span>{clockLabel(now)}{data ? ` · Day ${data.dayOfWeek} of 7 · every tick today shows up in Sunday’s review` : ''}</span>{data && !data.ticksAvailable && <span className="dd-note" role="status"> · hand ticks can’t be saved yet</span>}</p>
        </div>
        <div className="dd-hero-right">
          <div className="dd-total">
            <strong>{data ? done : '—'}</strong>
            <span>of {all.length || '—'} tasks done<br />across our family today</span>
            <span className="dd-bar"><i style={{ width: `${all.length ? done / all.length * 100 : 0}%` }} /></span>
          </div>
          <button className="dd-theme" type="button" onClick={cycleTheme} title="Auto switches to night at 7pm">{choice === 'auto' ? `Auto · ${night ? 'night' : 'day'}` : choice === 'day' ? 'Day' : 'Night'}</button>
        </div>
      </header>

      {error && <p className="dd-error" role="alert">{error}</p>}

      <section className="dd-panel" aria-labelledby="dd-pace-h">
        <h2 id="dd-pace-h" className="dd-section-h">Heading into Sunday</h2>
        <div className="dd-pace">{data ? data.pace.map(t => <Tile key={t.key} t={t} />) : <p className="dd-empty">Bringing the week together…</p>}</div>
      </section>

      <section className="dd-people">
        {data?.people.map(p => <PersonCard key={p.id} p={p} todayIdx={data.dayOfWeek - 1} onTick={tick} busyId={busyId} />)}
      </section>

      <BusinessStrip />
    </main>
  );
}
