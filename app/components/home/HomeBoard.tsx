'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import './home.css';
import { demoMoney, demoNow } from './demo';
import { PopupStage, usePopups, type Popup } from './Popups';
import { chime, soundReady, unlockSound } from './sound';
import { familyWrite } from '../FamilyEditGate';
import { RAG_LABEL, conversionRag, goalRag, listRag, paceRag, type Rag } from './rag';
import { DayTicker } from './DayTicker';
import { AGENT, tickerRows, type June, type Order, type Row } from './ticker-rows';
import type { AgentAction, JuneStep } from '../../lib/agent-feed';

/* The family home board. One screen: an announcement bar, a column per person,
   a shared band (store · goals · calendar), a ticker and a sky rail.

   Three kinds of motion, each with a job:
     · pop-ups (Popups.tsx) — something happened or is about to; the main event
     · live motion — clock, now-bars, countdowns, sun/moon, ticker: time passing
     · ambient — slow background drift, orbits, shimmer: the board is running
   Colours: green / amber / red against pace (rag.ts), never against the whole day.
   Polling pauses while the tab is hidden (Netlify bills per request).
   ?demo=1 renders a weekday fixture so the layout can be judged on a weekend. */

export type Item = { id: string; title: string; done: boolean; count: string | null; auto?: boolean; source?: string; feeds?: string | null };
export type Tasks = { done: number; total: number; items: Item[] } | null;
export type Slot = { title: string; emoji: string; category: string; start: string; end: string; ticked: boolean | null };
export type NowFeed = {
  generatedAt: string; weekday: string;
  ansar: { day: Slot[]; nextDay: { weekday: string; slots: { title: string; emoji: string; start: string }[] } | null; habits: Tasks; schoolTicks: { done: number; total: number } | null };
  nihal: Tasks; taylan: Tasks;
  week?: { people: { id: string; days: { date: string; pct: number | null }[] }[]; pace: { key: string; label: string; value: string; of: string | null; pct: number | null; state: 'good' | 'warn' | null; stateLabel: string; note: string }[] } | null;
  prayer: { next: { name: string; at: string; leaderName: string; suras: string[] }; today: { prayer: string; name: string; at: string; leaderName: string }[] } | null;
  calendar: { id: string; subject: string; startISO: string; isAllDay: boolean; who: string }[] | null;
  store: { currency: string; today: { label: string; orders: number; revenue: number; sessions: number | null; conversion: number | null } | null; week: { date: string; revenue: number; orders: number }[]; weekRevenue: number; weekOrders: number; avgOrders: number; avgRevenue: number; dayFraction: number } | null;
  ads?: { live: boolean; activeAds: number; reason: string | null } | null;
  order?: Order; june?: June;
  agents?: { june: { date: string; steps: (Pick<JuneStep, 'id' | 'label' | 'due'> & { state: string | null; at: string | null })[] } | null; actions: AgentAction[] } | null;
};
export type Money = {
  unlocked: boolean; asOf: string;
  goals: { label: string; short: string; target: number; pct: number; now?: number }[];
  cash?: { bank: number; cardDebt: number; net: number };
  week_income?: { business: number; wages: number; businessSpend: number; takeHome: number };
  headline?: string | null; bills?: { date: string; title: string; amount: number }[];
};

const TZ = 'Australia/Melbourne';
const noop = () => () => {};
const NOW_POLL = 60_000, MONEY_POLL = 10 * 60_000, ROTATE = 8000;
const DAY_START = 5, DAY_END = 22; // the rail spans 5 am – 10 pm
const WEEKDAY: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const WHO: Record<string, string> = { TAYLAN: 'TK', NIHAL: 'Nihal', ANSAR: 'Ansar' };

const fmtTime = (iso: string | Date) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase();
const fmtDay = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-AU')}`;
const mins = (ms: number) => Math.max(0, Math.round(ms / 60000));
const until = (ms: number) => { const m = mins(ms); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`; };
/** Live countdown: d h m beyond the hour, mm:ss inside it. */
const clockDown = (ms: number) => { if (ms <= 0) return 'now'; const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60; return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s` : `${m}:${String(sec).padStart(2, '0')}`; };
const short = (title: string) => title.replace(/^Block \d+ — /, '');

/** Hour of day (fractional) in Melbourne. */
function melHour(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return +p.hour + +p.minute / 60 + +p.second / 3600;
}
const railPct = (d: Date) => Math.min(100, Math.max(0, (melHour(d) - DAY_START) / (DAY_END - DAY_START) * 100));
const ragCls = (r: Rag) => r ? ` rag-${r}` : '';

/** The board's sky: background and drifting colours follow the sun, from the
 *  prayer times. Sunrise is taken as Fajr + 88 min (Guidance's gap on 25 Oct). */
type Sky = { name: string; bg: string; b: [string, string, string] };
const SKIES: Record<string, Sky> = {
  night: { name: 'Night', bg: '#eee9e1', b: ['#9fb0c4', '#b9b3cf', '#c9d3dc'] },
  dawn: { name: 'Dawn', bg: '#f8ebdf', b: ['#f4b49a', '#f7d3a8', '#e7c3c9'] },
  day: { name: 'Day', bg: '#f6f1e8', b: ['#f0b089', '#9cc3b9', '#e9c9a6'] },
  golden: { name: 'Golden hour', bg: '#f8ecd9', b: ['#f0a860', '#e9b98a', '#f3cf8e'] },
  dusk: { name: 'Dusk', bg: '#f1e7e5', b: ['#c79bb0', '#a3a4cf', '#e0b7a4'] },
};
function skyAt(now: Date, times: { prayer: string; at: string }[]): Sky {
  const t = (p: string) => { const x = times.find(y => y.prayer === p); return x ? new Date(x.at).getTime() : null; };
  const f = t('fajr'), m = t('maghrib'), i = t('isha'), n = now.getTime();
  if (f === null || m === null || i === null) return SKIES.day;
  const sunrise = f + 88 * 60000;
  if (n < f || n >= i) return SKIES.night;
  if (n < sunrise + 60 * 60000) return SKIES.dawn;
  if (n < m - 90 * 60000) return SKIES.day;
  if (n < m) return SKIES.golden;
  return SKIES.dusk;
}

/** The ad account's pulse: the line beats only while Meta confirms ads are
   delivering. Stopped, or Meta unreadable, = a flat red line. An order spikes it. */
function Heartbeat({ live, spike }: { live: boolean; spike: boolean }) {
  const unit = 'h18 l6 -14 l6 26 l6 -18 l4 6 h20';
  return (
    <div className={'hb-heart' + (live ? spike ? ' spike' : '' : ' flat')}>
      <svg viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true"><path d={live ? `M0 22 ${Array.from({ length: 7 }, () => unit).join(' ')}` : 'M0 22 H800'} /></svg>
    </div>
  );
}

function Ring({ done, total, rag, active }: { done: number; total: number; rag: Rag; active: boolean }) {
  const r = 26, c = 2 * Math.PI * r, pct = total ? done / total : 0;
  return (
    <div className={'hb-ring' + ragCls(rag) + (active ? ' active' : '')} aria-label={`${done} of ${total} done${rag ? `, ${RAG_LABEL[rag]}` : ''}`}>
      <svg viewBox="0 0 64 64"><circle className="orbit" cx="32" cy="32" r="31" /><circle className="bg" cx="32" cy="32" r={r} /><circle className="fg" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} /></svg>
      <span>{total ? `${done}/${total}` : '—'}</span>
    </div>
  );
}

function Pill({ rag }: { rag: Rag }) {
  return rag ? <span className={'hb-pill' + ragCls(rag)}><i />{RAG_LABEL[rag]}</span> : null;
}

/** Number that rolls to its new value instead of jumping. */
function Count({ value, prefix = '', decimals = 0, suffix = '' }: { value: number; prefix?: string; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 1200); setShown(a + (value - a) * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); else from.current = value; };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{shown.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

export default function HomeBoard() {
  // Client-only board: the clock and ?demo differ between server and browser.
  const demo = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has('demo'), () => null);
  const [feed, setFeed] = useState<NowFeed | null>(null);
  const [cash, setCash] = useState<Money | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [slide, setSlide] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [gotAt, setGotAt] = useState<number | null>(null);
  const prev = useRef<NowFeed | null>(null);
  const fired = useRef<Set<string>>(new Set());
  const [ticks, setTicks] = useState<Record<string, { done: boolean; at: number }>>({});
  const mine = useRef<Set<string>>(new Set());
  const [spikeAt, setSpikeAt] = useState(0);
  const [sound, setSound] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const popups = usePopups();
  // Fit to screen, never scroll: if the content is taller than the window, the whole
  // board scales down evenly (and widens by the same factor) until it fits.
  const boxRef = useRef<HTMLElement>(null), fitRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (demo === null) return;
    const box = boxRef.current, el = fitRef.current;
    if (!box || !el) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (window.innerWidth < 900) { setScale(1); return; } // phones stack and scroll
        const cs = getComputedStyle(box);
        const avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const next = Math.min(1, avail / el.offsetHeight);
        setScale(prev => Math.abs(prev - next) < 0.004 ? prev : next);
      });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el); ro.observe(box);
    fit();
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [demo]);
  const { push } = popups;

  /** Compare two feeds and pop up what changed since the last one. */
  const announce = useCallback((a: NowFeed, b: NowFeed) => {
    const newly: string[] = [];
    const people: [string, (f: NowFeed) => Tasks][] = [['Ansar', f => f.ansar.habits], ['Nihal', f => f.nihal], ['TK', f => f.taylan]];
    for (const [who, pick] of people) {
      const before = new Set(pick(a)?.items.filter(i => i.done).map(i => i.id));
      for (const item of pick(b)?.items ?? []) if (item.done && !before.has(item.id) && !mine.current.delete(item.id)) { newly.push(item.id); push({ kind: 'tick', who, title: item.title }); }
      const p = pick(b);
      if (p && p.total && p.done === p.total && (pick(a)?.done ?? 0) < p.total) push({ kind: 'complete', who, total: p.total });
    }
    const beforeOrder = new Set(a.order?.items.filter(i => i.done).map(i => i.key));
    for (const o of b.order?.items ?? []) if (o.done && !beforeOrder.has(o.key) && !mine.current.delete(`lp-${o.key}`)) { newly.push(`lp-${o.key}`); push({ kind: 'tick', who: AGENT[o.key] ?? 'Nihal', title: o.label }); }
    // The agents: each June step the code ticks, and every action GARY, JUNE and the other seats finish.
    const juneBefore = new Map(a.agents?.june?.steps.map(x => [x.id, x.state]));
    for (const x of b.agents?.june?.steps ?? []) if ((x.state === 'done' || x.state === 'fail') && juneBefore.get(x.id) !== x.state && a.agents?.june) push({ kind: 'tick', who: 'JUNE', title: x.label, warn: x.state === 'fail' });
    const seen = new Set(a.agents?.actions.map(x => x.id));
    if (a.agents) for (const x of [...(b.agents?.actions ?? [])].reverse()) if (!seen.has(x.id)) push({ kind: 'tick', who: x.who, title: x.text, warn: x.warn });
    const beforeBlocks = new Set(a.ansar.day.filter(s => s.ticked).map(s => s.title));
    const blocks = b.ansar.day.filter(s => s.ticked !== null);
    for (const s of blocks) if (s.ticked && !beforeBlocks.has(s.title)) { newly.push(s.title); push({ kind: 'block', emoji: s.emoji, title: s.title, done: blocks.filter(x => x.ticked).length, total: blocks.length }); }
    const o1 = a.store?.today?.orders ?? 0, o2 = b.store?.today?.orders ?? 0;
    if (b.store?.today && a.store?.today?.label === b.store.today.label && o2 > o1) { push({ kind: 'order', added: o2 - o1, orders: o2, revenue: b.store.today.revenue }); setSpikeAt(Date.now()); }
    if (newly.length) { setFresh(new Set(newly)); setTimeout(() => setFresh(new Set()), 2600); }
  }, [push]);

  const loadNow = useCallback(async () => {
    try {
      const next: NowFeed = demo ? demoNow(prev.current) : await fetch('/api/now', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); });
      if (prev.current) announce(prev.current, next);
      prev.current = next; setFeed(next); setFailed(false); setGotAt(Date.now());
    } catch { setFailed(true); }
  }, [announce, demo]);

  const loadMoney = useCallback(async () => {
    let m: Money;
    try { m = demo ? demoMoney : await fetch('/api/money-board', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }); } catch { return; /* keep the last good one */ }
    setCash(m);
    // A goal step reached is celebrated once per device: the weekly goal once per CLEO week, the bank goals once ever.
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem('hb-goals-seen') || '[]'); } catch { /* private window */ }
    m.goals.forEach((g, i) => {
      const key = i === 2 ? `${g.short}-${m.asOf.slice(0, 10)}` : g.short;
      if (g.pct >= 100 && (demo || !seen.includes(key))) {
        seen.push(key);
        push({ kind: 'goal', short: g.short, label: i === 2 ? 'weekly business take-home' : 'in the bank, net of card debt', now: g.now !== undefined ? `${money(g.now)} this week` : null });
      }
    });
    try { localStorage.setItem('hb-goals-seen', JSON.stringify(seen.slice(-40))); } catch { /* private window */ }
  }, [demo, push]);

  // Polling, paused while hidden; a returning tab refreshes at once.
  useEffect(() => {
    if (demo === null) return;
    let a: ReturnType<typeof setInterval> | undefined, b: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(a); clearInterval(b); };
    const start = () => { stop(); loadNow(); loadMoney(); a = setInterval(loadNow, demo ? 15_000 : NOW_POLL); b = setInterval(loadMoney, MONEY_POLL); };
    const vis = () => document.hidden ? stop() : start();
    start(); document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, [loadNow, loadMoney, demo]);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setSlide(s => s + 1), ROTATE); return () => clearInterval(t); }, []);

  // Sound: remembered per device; after a reload the browser needs one tap anywhere to allow it.
  useEffect(() => {
    let on = false;
    try { on = localStorage.getItem('hb-sound') === 'on'; } catch { /* private window */ }
    if (!on) return;
    const t = setTimeout(() => { setSound(true); unlockSound(); setSoundBlocked(!soundReady()); }, 0);
    const tap = () => { unlockSound(); setTimeout(() => setSoundBlocked(!soundReady()), 200); };
    window.addEventListener('pointerdown', tap);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', tap); };
  }, []);
  function toggleSound() {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem('hb-sound', next ? 'on' : 'off'); } catch { /* private window */ }
    if (next) { unlockSound(); setTimeout(() => { setSoundBlocked(!soundReady()); chime(); }, 150); }
  }
  const onShow = useCallback((p: Popup) => { if (sound && (p.kind === 'prayer' || p.kind === 'goal')) chime(); }, [sound]);

  /** Tap a ticker row to tick or untick it (family PIN). Hand tasks write /api/daily;
      the daily order writes Launchpad through /api/daily-order, so Nihal OS sees it too. */
  async function tickRow(row: Row) {
    if (!row.tick) return;
    const done = row.done;
    setTicks(t => ({ ...t, [row.id]: { done: !done, at: Date.now() } }));
    if (!done) mine.current.add(row.id);
    const req = row.tick.kind === 'order'
      ? familyWrite('/api/daily-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: row.tick.key, checked: !done }) })
      : familyWrite('/api/daily', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: row.tick.id, done: !done }) });
    const r = await req.catch(() => null);
    if (!r?.ok) { mine.current.delete(row.id); setTicks(t => { const c = { ...t }; delete c[row.id]; return c; }); return; }
    if (!done) { push({ kind: 'tick', who: 'You', title: row.title }); setFresh(new Set([row.id])); setTimeout(() => setFresh(new Set()), 2600); }
  }

  const day = useMemo(() => feed?.ansar.day ?? [], [feed]);
  const current = day.find(s => new Date(s.start) <= now && now < new Date(s.end));
  const upcoming = day.find(s => new Date(s.start) > now && !/break/i.test(s.title));
  const doneBlocks = day.filter(s => s.ticked);
  const lastDone = doneBlocks[doneBlocks.length - 1];
  const nextTask = (t: Tasks | undefined) => t?.items.find(i => !i.done);
  const nextEvent = feed?.calendar?.find(e => new Date(e.startISO) > now);
  const prayer = feed?.prayer?.next;
  const prayerMs = prayer ? new Date(prayer.at).getTime() - now.getTime() : Infinity;
  const eventMs = nextEvent ? new Date(nextEvent.startISO).getTime() - now.getTime() : Infinity;

  // Time-based pop-ups: prayer at 20 / 5 / 0 min, events at 60 / 15 min, an hourly brief.
  const minuteKey = Math.floor(now.getTime() / 60000);
  useEffect(() => {
    if (!feed) return;
    const once = (key: string, p: Popup) => { if (!fired.current.has(key)) { fired.current.add(key); push(p); } };
    const t = Date.now();
    if (prayer) {
      const left = new Date(prayer.at).getTime() - t;
      const base = { kind: 'prayer' as const, name: prayer.name, leader: prayer.leaderName, suras: prayer.suras };
      if (left <= 20 * 60000 && left > 6 * 60000) once(`p20-${prayer.at}`, { ...base, minutes: mins(left) });
      if (left <= 5 * 60000 && left > 60000) once(`p5-${prayer.at}`, { ...base, minutes: mins(left) });
    }
    for (const p of feed.prayer?.today ?? []) {
      const since = t - new Date(p.at).getTime();
      if (since >= 0 && since < 3 * 60000) once(`p0-${p.at}`, { kind: 'prayer', name: p.name, leader: p.leaderName, suras: [], minutes: 0, now: true });
    }
    if (nextEvent) {
      const left = new Date(nextEvent.startISO).getTime() - t;
      const ev = { kind: 'event' as const, title: nextEvent.subject.trim(), when: `${fmtDay(nextEvent.startISO)} · ${fmtTime(nextEvent.startISO)}` };
      if (left <= 60 * 60000 && left > 16 * 60000) once(`e60-${nextEvent.id}`, { ...ev, minutes: mins(left) });
      if (left <= 15 * 60000 && left > 0) once(`e15-${nextEvent.id}`, { ...ev, minutes: mins(left) });
    }
    // The brief: on the hour from 6 am to 9 pm, and once shortly after the board opens.
    const h = melHour(new Date(t));
    if ((h >= 6 && h < 21.5 && h % 1 < 2 / 60) || !fired.current.has('brief-open')) {
      fired.current.add('brief-open');
      const lines: string[] = [];
      if (prayer) lines.push(`🕌 ${prayer.name} ${fmtTime(prayer.at)} · ${prayer.leaderName} leads`);
      if (current) lines.push(`${current.emoji} Ansar: ${current.title}${upcoming ? `, then ${short(upcoming.title)}` : ''}`);
      else if (upcoming) lines.push(`${upcoming.emoji} Ansar next: ${upcoming.title} at ${fmtTime(upcoming.start)}`);
      const n = nextTask(feed.nihal), k = nextTask(feed.taylan);
      if (n) lines.push(`Nihal next: ${n.title}`);
      if (k) lines.push(`TK next: ${k.title}`);
      if (nextEvent) lines.push(`📅 ${nextEvent.subject.trim()} · ${fmtDay(nextEvent.startISO)}`);
      if (lines.length) once(`brief-${new Date(t).toISOString().slice(0, 13)}`, { kind: 'brief', hour: fmtTime(new Date(t)), lines: lines.slice(0, 5) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checked once a minute, not every second
  }, [minuteKey, feed]);

  // Announcement bar. A prayer inside 20 min or an event inside the hour takes it over; otherwise it rotates.
  const takeover = prayerMs <= 20 * 60000 ? 'prayer' : eventMs <= 60 * 60000 ? 'event' : null;
  const messages = useMemo(() => {
    const out: { key: string; tag: string; node: React.ReactNode }[] = [];
    if (day.length) out.push({
      key: 'ansar', tag: 'Ansar', node: <>
        {lastDone && <span className="hb-flow done">✓ {short(lastDone.title)}</span>}
        <b>{current ? `${current.emoji} ${current.title}` : upcoming ? `Next: ${upcoming.emoji} ${upcoming.title}` : 'School done for today'}</b>
        {current && upcoming && <span className="hb-flow">then {short(upcoming.title)} {fmtTime(upcoming.start)}</span>}
      </>,
    });
    const n = nextTask(feed?.nihal), k = nextTask(feed?.taylan);
    if (n || k) out.push({ key: 'next', tag: 'Up next', node: <>{n && <><b>Nihal</b>{n.title}</>}{n && k && <i>·</i>}{k && <><b>TK</b>{k.title}</>}</> });
    if (nextEvent && eventMs < 7 * 864e5) out.push({ key: 'cal', tag: 'Coming up', node: <><b>{nextEvent.subject.trim()}</b><i>·</i>{fmtDay(nextEvent.startISO)}, {fmtTime(nextEvent.startISO)}<i>·</i>in {until(eventMs)}</> });
    const s = feed?.store;
    if (s?.today) out.push({ key: 'store', tag: 'Store', node: <><b>{s.today.orders} orders · US${Math.round(s.today.revenue).toLocaleString('en-AU')}</b><i>·</i>{s.today.orders >= s.avgOrders * s.dayFraction ? 'ahead of' : 'behind'} the 7-day pace</> });
    if (cash?.unlocked && cash.headline) out.push({ key: 'money', tag: 'Money', node: <b>{cash.headline}</b> });
    return out;
  }, [feed, cash, day, current, upcoming, lastDone, nextEvent, eventMs]);
  const shown = messages[slide % Math.max(1, messages.length)];

  async function unlock() {
    const ok = await new Promise<boolean>(resolve => window.dispatchEvent(new CustomEvent('family-edit-unlock', { detail: { resolve } })));
    if (ok) loadMoney();
  }

  if (demo === null) return <main ref={boxRef} className="hb" />;

  const hour = melHour(now);
  const isSunday = feed?.weekday === 'Sun';
  // The ticker: a tap shows at once; the CDN-cached feed catches up within ~90 s.
  const rows = feed ? tickerRows(feed.nihal, feed.taylan, feed.order, feed.june).map(r => { const o = ticks[r.id]; return o && now.getTime() - o.at < 90_000 ? { ...r, done: o.done } : r; }) : [];
  const weekView = (id: string, keys: string[]) => {
    const w = feed?.week, days = w?.people.find(p => p.id === id)?.days.filter(d => d.pct !== null) ?? [];
    const avg = days.length ? Math.round(days.reduce((a, d) => a + (d.pct ?? 0), 0) / days.length * 100) : null;
    const best = days.reduce<{ date: string; pct: number | null } | null>((b, d) => (d.pct ?? 0) > (b?.pct ?? -1) ? d : b, null);
    return (
      <div className="hb-week">
        <div className="hb-week-head"><span className="hb-eye">This week</span><b className={'hb-num' + ragCls(avg === null ? null : goalRag(avg))}>{avg === null ? '—' : `${avg}%`}</b><small>{best && best.pct ? `best ${new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(new Date(best.date + 'T12:00:00Z'))}` : 'of the daily list, Mon–Sat'}</small></div>
        <div className="hb-week-bars">{days.map((d, i) => <div key={d.date} className={ragCls(goalRag(Math.round((d.pct ?? 0) * 100)))}><i style={{ height: `${Math.max(4, (d.pct ?? 0) * 100)}%`, animationDelay: `${i * 0.08}s` }} /><span>{new Intl.DateTimeFormat('en-AU', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(d.date + 'T12:00:00Z'))}</span></div>)}</div>
        <ul className="hb-week-tiles">{(w?.pace ?? []).filter(x => keys.includes(x.key)).map(x => <li key={x.key} className={ragCls(x.state === 'good' ? 'good' : x.state === 'warn' ? 'bad' : null)}><span>{x.label}</span><b>{x.value}{x.of ? <small> {x.of}</small> : null}</b><em>{x.stateLabel}</em></li>)}</ul>
      </div>
    );
  };

  // Ansar's list: breaks drop out, and it starts one row before "now" so the current block stays on screen.
  const lessons = day.filter(s => !/^break$/i.test(s.title.replace(/[^a-z]/gi, '')));
  const firstOpen = lessons.findIndex(s => new Date(s.end) > now);
  const list = firstOpen > 1 ? lessons.slice(firstOpen - 1) : lessons;
  const due = day.filter(s => s.ticked !== null && new Date(s.end) <= now);
  const blockRag: Rag = due.length ? paceRag(due.filter(s => s.ticked).length, due.length) : null;
  const rail = railPct(now);
  const times = feed?.prayer?.today ?? [];
  const maghrib = times.find(p => p.prayer === 'maghrib'), fajr = times.find(p => p.prayer === 'fajr');
  const isNight = !!maghrib && !!fajr && (now >= new Date(maghrib.at) || now < new Date(fajr.at));
  const sky = skyAt(now, times);
  const st = feed?.store;
  const ads = feed?.ads ?? null;
  const ordersRag = st?.today ? paceRag(st.today.orders, st.avgOrders * st.dayFraction) : null;
  const revenueRag = st?.today ? paceRag(st.today.revenue, st.avgRevenue * st.dayFraction) : null;
  const convRag = conversionRag(st?.today?.conversion ?? null);
  const nextGoal = cash?.goals.findIndex(g => g.pct < 100) ?? -1;
  const ago = gotAt ? Math.max(0, Math.round((now.getTime() - gotAt) / 1000)) : null;

  const ticker: string[] = [
    ...times.map(p => `🕌 ${p.name} ${fmtTime(p.at)} · ${p.leaderName}`),
    ...(feed ? ([['Ansar', feed.ansar.habits], ['Nihal', feed.nihal], ['TK', feed.taylan]] as const).flatMap(([who, t]) => (t?.items ?? []).filter(i => i.done).map(i => `✓ ${who} · ${i.title}`)) : []),
    ...doneBlocks.map(s => `${s.emoji} Ansar finished ${s.title}`),
    ...(feed?.calendar ?? []).slice(0, 3).map(e => `📅 ${e.subject.trim()} · ${fmtDay(e.startISO)}`),
    ...(st ? [`🛍 7 days · US$${Math.round(st.weekRevenue).toLocaleString('en-AU')} · ${st.weekOrders} orders`] : []),
  ];

  return (
    <main ref={boxRef} className={'hb' + (isNight ? ' night' : '')} style={{ '--sky': sky.bg, '--b1': sky.b[0], '--b2': sky.b[1], '--b3': sky.b[2] } as React.CSSProperties}>
      <div className="hb-amb" aria-hidden="true"><i /><i /><i /></div>
      <div className="hb-fit" ref={fitRef} style={scale < 1 ? { width: `${100 / scale}%`, transform: `scale(${scale})` } : undefined}>

      <div className="hb-bar">
        {takeover === 'prayer' && prayer ? (
          <div className="hb-ann takeover clay" role="status">
            <span className="hb-tag">🕌 {prayer.name}</span>
            <div className="hb-msg"><span><b>{clockDown(prayerMs)}</b><i>·</i>{prayer.leaderName} leads<i>·</i>{prayer.suras.join(' + ')}</span></div>
          </div>
        ) : takeover === 'event' && nextEvent ? (
          <div className="hb-ann takeover teal" role="status">
            <span className="hb-tag">📅 Starting soon</span>
            <div className="hb-msg"><span><b>{nextEvent.subject.trim()}</b><i>·</i>in {clockDown(eventMs)}</span></div>
          </div>
        ) : (
          <div className="hb-ann">
            {prayer && <a className="hb-chip" href="/prayer.html" title="Open the prayer board"><span>🕌</span><b>{prayer.name} {fmtTime(prayer.at)}</b><small>{prayer.leaderName} · in {until(prayerMs)}</small></a>}
            <span className="hb-tag">{shown?.tag ?? 'Today'}</span>
            <div className="hb-msg">{shown ? <span key={shown.key + slide}>{shown.node}</span> : <span>Loading the day…</span>}</div>
            {messages.length > 1 && <div className="hb-dots">{messages.map((m, i) => <i key={m.key} className={i === slide % messages.length ? 'on' : ''} />)}</div>}
          </div>
        )}
        <div className="hb-clock">
          <div className="hb-num">{fmtTime(now)}</div>
          <div className="hb-clock-meta">
          <div className="hb-sec"><i style={{ width: `${now.getSeconds() / 59 * 100}%` }} /></div>
          <div>{new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</div>
          <div>
          <button className={'hb-sound' + (sound ? ' on' : '') + (sound && soundBlocked ? ' blocked' : '')} onClick={toggleSound} title={sound && soundBlocked ? 'Tap anywhere to allow sound' : 'Chime for prayers and goals'}>{sound ? (soundBlocked ? '🔈 Tap for sound' : '🔔 Sound on') : '🔕 Sound off'}</button>
          <div className={'hb-live' + (failed ? ' off' : '')}><i />{failed ? 'Reconnecting' : demo ? 'Demo' : ago === null ? 'Connecting' : `Live · ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago`}</div>
          </div>
          </div>
        </div>
      </div>

      <div className="hb-people">
        <section className="hb-card">
          <div className="hb-head"><div><h2>Ansar</h2><p>Homeschool{feed?.ansar.schoolTicks?.total ? ` · ${feed.ansar.schoolTicks.done}/${feed.ansar.schoolTicks.total} blocks ticked` : ''} <Pill rag={blockRag} /></p></div>
            {!isSunday && <Ring done={feed?.ansar.habits?.done ?? 0} total={feed?.ansar.habits?.total ?? 0} rag={feed?.ansar.habits ? listRag(feed.ansar.habits.done, feed.ansar.habits.total, hour) : null} active={!!current} />}</div>
          {!feed ? <p className="hb-empty">Loading…</p> : !day.length ? <>
            {isSunday ? weekView('ansar', ['ansar']) : <div className="hb-now idle"><span className="hb-eye">Today</span><strong>No school today</strong><small>Habits {feed.ansar.habits?.done ?? 0}/{feed.ansar.habits?.total ?? 0}</small></div>}
            {feed.ansar.nextDay && <div className="hb-plan"><span className="hb-eye">{WEEKDAY[feed.ansar.nextDay.weekday]}&apos;s plan</span>
              <ul>{feed.ansar.nextDay.slots.map(s => <li key={s.title}><small>{s.start}</small><b>{s.emoji} {short(s.title)}</b></li>)}</ul></div>}
          </> : <>
            <div className="hb-flowrow">
              <div className="done"><span>Done</span><b>{lastDone ? `${lastDone.emoji} ${short(lastDone.title)}` : '—'}</b></div>
              <div className="now"><span>Now</span><b>{current ? `${current.emoji} ${short(current.title)}` : '—'}</b></div>
              <div className="next"><span>Next</span><b>{upcoming ? `${upcoming.emoji} ${short(upcoming.title)}` : '—'}</b></div>
            </div>
            <div className={'hb-now' + (current ? '' : ' idle')}>
              <span className="hb-eye">{current ? <><i className="hb-pulse" />Now · until {fmtTime(current.end)}</> : now < new Date(day[0].start) ? `Starts ${fmtTime(day[0].start)}` : 'School day finished'}</span>
              <strong>{current ? `${current.emoji} ${current.title}` : upcoming ? `${upcoming.emoji} ${upcoming.title}` : 'Done for today'}</strong>
              {current && <><div className="hb-prog"><i style={{ width: `${Math.min(100, (now.getTime() - new Date(current.start).getTime()) / (new Date(current.end).getTime() - new Date(current.start).getTime()) * 100)}%` }} /></div>
                <small>{clockDown(new Date(current.end).getTime() - now.getTime())} left{current.ticked === true ? ' · ticked ✓' : current.ticked === false ? ' · not ticked yet' : ''}</small></>}
            </div>
            <ul className="hb-list">{list.slice(0, 4).map(s => {
              const isNow = s === current, past = new Date(s.end) <= now;
              const cls = s.ticked ? ' done' : isNow ? ' now' : past && s.ticked === false ? ' missed' : past ? ' passed' : '';
              return <li key={s.title + s.start} className={'hb-item' + cls + (fresh.has(s.title) ? ' fresh' : '')}><span className="hb-check" /><span>{s.emoji} {s.title}</span><span className="t">{past && s.ticked === false ? 'not ticked' : fmtTime(s.start)}</span></li>;
            })}{list.length > 4 && <li className="hb-more">then {list.slice(4).map(s => short(s.title)).join(' · ')}</li>}</ul>
          </>}
        </section>
        <DayTicker rows={rows} fresh={fresh} onTick={tickRow} title="Today's list" sub={`Nihal & TK${feed?.order ? ` · ${feed.order.product}` : ''}${feed?.june ? ` · JUNE ${feed.june.date.slice(8)}/${feed.june.date.slice(5, 7)}` : ''}`} />
      </div>

      <div className="hb-band">
        <section className="hb-tile">
          <header><h3>Store</h3><small>{st?.today ? `${st.today.label} · US$, store time` : ''}</small></header>
          {!st ? <p className="hb-empty">{feed ? 'Shopify not available right now.' : 'Loading…'}</p> : <>
            <div className="hb-stats">
              <div className={ragCls(ordersRag)}><span><i className="dot" />Orders</span><b className="hb-num"><Count value={st.today?.orders ?? 0} /></b><small>pace {Math.round(st.avgOrders * st.dayFraction)}</small></div>
              <div className={ragCls(revenueRag)}><span><i className="dot" />Revenue</span><b className="hb-num"><Count value={st.today?.revenue ?? 0} prefix="$" /></b><small>pace ${Math.round(st.avgRevenue * st.dayFraction)}</small></div>
              <div className={ragCls(convRag)}><span><i className="dot" />Conversion</span><b className="hb-num">{st.today?.conversion != null ? <Count value={st.today.conversion} decimals={1} suffix="%" /> : '—'}</b><small>target 3%</small></div>
            </div>
            {feed && <div className={'hb-pulse-row' + (ads?.live ? '' : ' down')} role="status"><Heartbeat live={!!ads?.live} spike={now.getTime() - spikeAt < 4000} /><small>{ads?.live ? <><b>Ads live</b> · {ads.activeAds} running</> : <b>{ads ? `Ads stopped · ${ads.reason}` : 'Ads unknown · Meta not answering'}</b>}</small></div>}
            <div className="hb-bars" aria-label="Revenue, last seven days">{(() => { const max = Math.max(1, ...st.week.map(w => w.revenue)); return st.week.map((w, i) => <div key={w.date} className={i === st.week.length - 1 ? 'today' : ''}><i style={{ height: `${Math.max(4, w.revenue / max * 100)}%` }} title={`US$${Math.round(w.revenue)}`} /><span>{new Intl.DateTimeFormat('en-AU', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(w.date + 'T12:00:00Z'))}</span></div>); })()}</div>
            <div className="hb-money"><span>7 days</span><b>US${Math.round(st.weekRevenue).toLocaleString('en-AU')} · {st.weekOrders} orders</b></div>
          </>}
        </section>

        <section className="hb-tile">
          <header><h3>Our goals</h3>{cash && !cash.unlocked ? <button className="hb-unlock" onClick={unlock}>🔒 Show numbers</button> : <small>{cash ? `CLEO · ${fmtDay(cash.asOf)}` : ''}</small>}</header>
          {cash?.unlocked && cash.headline && <p className="hb-headline">{cash.headline}</p>}
          <div className="hb-stairs">{(cash?.goals ?? []).map((g, i) => (
            <div className={'hb-step' + ragCls(goalRag(g.pct))} key={i}>
              {i === nextGoal && <span className="hb-flag" aria-hidden="true">⚑</span>}
              <i className="fill" style={{ height: `${g.pct}%` }} />
              <span className="hb-num">{g.short}</span><small>{i === 2 ? 'weekly business take-home' : 'net of card debt'}</small>
              <em><i className="dot" />{g.now !== undefined ? `${money(g.now)} · ` : ''}{g.pct}%</em>
            </div>
          ))}</div>
          {cash?.unlocked && cash.cash && cash.week_income ? <div className="hb-money">
            <span>Bank <b>{money(cash.cash.bank)}</b></span><span className="neg">Cards <b>{money(-cash.cash.cardDebt)}</b></span><span className={cash.cash.net < 0 ? 'neg' : ''}>Net <b>{money(cash.cash.net)}</b></span><span>Wages <b>{money(cash.week_income.wages)}</b>/wk</span>
          </div> : cash && <p className="hb-locked">Balances stay hidden until this screen is unlocked with the family PIN.</p>}
          {!cash && <p className="hb-empty">Loading…</p>}
        </section>

        <section className="hb-tile">
          <header><h3>Coming up</h3><small>family calendars</small></header>
          {!feed?.calendar?.length ? <p className="hb-empty">{feed ? (feed.calendar ? 'Nothing booked.' : 'Calendar not available.') : 'Loading…'}</p> :
            <ul className="hb-cal">{feed.calendar.slice(0, 3).map((e, i) => <li key={e.id} className={i === 0 ? 'first' : ''}><b>{e.subject.trim()}</b><span>{fmtDay(e.startISO)}{e.isAllDay ? '' : `, ${fmtTime(e.startISO)}`}{i === 0 && <span className="hb-cd"> · in {clockDown(new Date(e.startISO).getTime() - now.getTime())}</span>}</span><em>{WHO[e.who] ?? e.who}</em></li>)}</ul>}
        </section>
      </div>

      <div className="hb-ticker" aria-hidden="true"><div style={{ animationDuration: `${Math.max(40, ticker.length * 7)}s` }}>{[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}</div></div>

      <div className="hb-rail" aria-hidden="true">
        <div className="hb-track"><i style={{ width: `${rail}%` }} /></div>
        {times.map(p => { const x = railPct(new Date(p.at)); return x > 0 && x < 100 ? <div key={p.prayer} className={'hb-mark pray' + (new Date(p.at) < now ? ' past' : '')} style={{ left: `${x}%` }}><b>{p.name}</b> {fmtTime(p.at)} · {p.leaderName}</div> : null; })}
        {day.length > 0 && [day[0], day.find(s => /homeschool ends/i.test(s.title)) ?? day[day.length - 1]].map((s, i) => <div key={i} className={'hb-mark low' + (new Date(s.start) < now ? ' past' : '')} style={{ left: `${railPct(new Date(s.start))}%` }}>{i === 0 ? 'School' : 'School ends'} {fmtTime(s.start)}</div>)}
        <div className={'hb-sun' + (isNight ? ' moon' : '')} style={{ left: `${rail}%` }} />
        <span className="hb-rail-lbl" style={{ left: 0 }}>5am · {sky.name}</span><span className="hb-rail-lbl" style={{ right: 0 }}>10pm</span>
      </div>

      </div>

      <PopupStage current={popups.current} waiting={popups.waiting} done={popups.done} onShow={onShow} />
      {demo && <p className="hb-stale">Demo data — remove ?demo to see the live board.</p>}
    </main>
  );
}
