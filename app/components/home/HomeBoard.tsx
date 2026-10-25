'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import './home.css';
import { demoMoney, demoNow } from './demo';

/* The family home board. One screen: an announcement bar, a column per person,
   a shared band (store · goals · calendar) and a rail that walks through the day.

   Motion is reserved for change: a tick, an order, a prayer coming up. The clock,
   the "now" bar and the rail move with time; everything else moves only when the
   data does. Polling pauses while the tab is hidden (Netlify bills per request).
   ?demo=1 renders a weekday fixture so the layout can be judged on a weekend. */

export type Item = { id: string; title: string; done: boolean; count: string | null };
export type Tasks = { done: number; total: number; items: Item[] } | null;
export type Slot = { title: string; emoji: string; category: string; start: string; end: string; ticked: boolean | null };
export type NowFeed = {
  generatedAt: string; weekday: string;
  ansar: { day: Slot[]; habits: Tasks; schoolTicks: { done: number; total: number } | null };
  nihal: Tasks; taylan: Tasks;
  prayer: { next: { name: string; at: string; leaderName: string; suras: string[] }; today: { prayer: string; name: string; at: string; leaderName: string }[] } | null;
  calendar: { id: string; subject: string; startISO: string; isAllDay: boolean; who: string }[] | null;
  store: { currency: string; today: { label: string; orders: number; revenue: number; sessions: number | null; conversion: number | null } | null; week: { date: string; revenue: number; orders: number }[]; weekRevenue: number; weekOrders: number } | null;
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

const fmtTime = (iso: string | Date) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase();
const fmtDay = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
const money = (n: number, cur = '$') => `${n < 0 ? '−' : ''}${cur}${Math.abs(Math.round(n)).toLocaleString('en-AU')}`;
const mins = (ms: number) => Math.max(0, Math.round(ms / 60000));
const until = (ms: number) => { const m = mins(ms); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"}`; };
const WHO: Record<string, string> = { TAYLAN: 'TK', NIHAL: 'Nihal', ANSAR: 'Ansar' };

/** Hour of day (fractional) in Melbourne. */
function melHour(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return +p.hour + +p.minute / 60;
}
const railPct = (d: Date) => Math.min(100, Math.max(0, (melHour(d) - DAY_START) / (DAY_END - DAY_START) * 100));

function Ring({ done, total }: { done: number; total: number }) {
  const r = 26, c = 2 * Math.PI * r, pct = total ? done / total : 0;
  return (
    <div className={'hb-ring' + (total && done === total ? ' full' : '')} aria-label={`${done} of ${total} done`}>
      <svg viewBox="0 0 64 64"><circle className="bg" cx="32" cy="32" r={r} /><circle className="fg" cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} /></svg>
      <span>{total ? `${done}/${total}` : '—'}</span>
    </div>
  );
}

type Toast = { id: number; icon: string; title: string; note: string; tone?: 'clay' | 'teal'; out?: boolean };

export default function HomeBoard() {
  // Client-only board: the clock and ?demo differ between server and browser, so
  // nothing renders until mounted (a TV never needs the server HTML).
  const demo = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has('demo'), () => null);
  const [feed, setFeed] = useState<NowFeed | null>(null);
  const [cash, setCash] = useState<Money | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [slide, setSlide] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const prev = useRef<NowFeed | null>(null);
  const warned = useRef<string>('');

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts(list => list.map(x => x.id === id ? { ...x, out: true } : x)), 8000);
    setTimeout(() => setToasts(list => list.filter(x => x.id !== id)), 8600);
  }, []);

  /** Compare two feeds and announce what changed since the last one. */
  const announce = useCallback((a: NowFeed, b: NowFeed) => {
    const newly: string[] = [];
    const people: [string, (f: NowFeed) => Tasks][] = [['Ansar', f => f.ansar.habits], ['Nihal', f => f.nihal], ['TK', f => f.taylan]];
    for (const [name, pick] of people) {
      const before = new Set(pick(a)?.items.filter(i => i.done).map(i => i.id));
      for (const item of pick(b)?.items ?? []) if (item.done && !before.has(item.id)) {
        newly.push(item.id);
        toast({ icon: '✓', title: `${name} · ${item.title}`, note: 'just ticked', tone: 'teal' });
      }
      const p = pick(b);
      if (p && p.total && p.done === p.total && (pick(a)?.done ?? 0) < p.total) toast({ icon: '★', title: `${name} finished the day's list`, note: `${p.total} of ${p.total}`, tone: 'clay' });
    }
    const beforeBlocks = new Set(a.ansar.day.filter(s => s.ticked).map(s => s.title));
    for (const s of b.ansar.day) if (s.ticked && !beforeBlocks.has(s.title)) { newly.push(s.title); toast({ icon: s.emoji || '✓', title: `Ansar · ${s.title}`, note: 'block done', tone: 'teal' }); }
    const o1 = a.store?.today?.orders ?? 0, o2 = b.store?.today?.orders ?? 0;
    if (b.store?.today && a.store?.today?.label === b.store.today.label && o2 > o1) toast({ icon: '🛍', title: `${o2 - o1 === 1 ? 'New order' : `${o2 - o1} new orders`}`, note: `${o2} today · US$${Math.round(b.store.today.revenue)}` });
    if (newly.length) { setFresh(new Set(newly)); setTimeout(() => setFresh(new Set()), 2600); }
  }, [toast]);

  const loadNow = useCallback(async () => {
    try {
      const next: NowFeed = demo ? demoNow(prev.current) : await fetch('/api/now', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); });
      if (prev.current) announce(prev.current, next);
      prev.current = next; setFeed(next); setFailed(false);
    } catch { setFailed(true); }
  }, [announce, demo]);

  const loadMoney = useCallback(async () => {
    try { setCash(demo ? demoMoney : await fetch('/api/money-board', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); })); } catch { /* keep the last good one */ }
  }, [demo]);

  // Polling, paused while hidden; a returning tab refreshes at once.
  useEffect(() => {
    if (demo === null) return;
    let a: ReturnType<typeof setInterval> | undefined, b: ReturnType<typeof setInterval> | undefined;
    const start = () => { stop(); loadNow(); loadMoney(); a = setInterval(loadNow, demo ? 15_000 : NOW_POLL); b = setInterval(loadMoney, MONEY_POLL); };
    const stop = () => { clearInterval(a); clearInterval(b); };
    const vis = () => document.hidden ? stop() : start();
    start(); document.addEventListener('visibilitychange', vis);
    return () => { stop(); document.removeEventListener('visibilitychange', vis); };
  }, [loadNow, loadMoney, demo]);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // Announcement bar: a rotating set of the most useful next things.
  const messages = useMemo(() => {
    const out: { key: string; tag: string; node: React.ReactNode; soon?: boolean }[] = [];
    const p = feed?.prayer?.next;
    if (p) {
      const left = new Date(p.at).getTime() - now.getTime();
      out.push({ key: 'prayer', tag: left < 20 * 60000 ? `In ${until(left)}` : 'Next prayer', soon: left < 20 * 60000, node: <><b>{p.name} · {fmtTime(p.at)}</b><i>·</i>{p.leaderName} leads<i>·</i>{p.suras.join(' + ')}</> });
    }
    const ev = feed?.calendar?.[0];
    if (ev) out.push({ key: 'cal', tag: 'Coming up', node: <><b>{ev.subject.trim()}</b><i>·</i>{fmtDay(ev.startISO)}, {fmtTime(ev.startISO)}</> });
    const slot = feed?.ansar.day.find(s => new Date(s.start) <= now && now < new Date(s.end));
    if (slot) out.push({ key: 'ansar', tag: 'Ansar now', node: <><b>{slot.emoji} {slot.title}</b><i>·</i>until {fmtTime(slot.end)}</> });
    if (cash?.unlocked && cash.headline) out.push({ key: 'money', tag: 'Money', node: <b>{cash.headline}</b> });
    const st = feed?.store?.today;
    if (st) out.push({ key: 'store', tag: 'Store', node: <><b>{st.orders} orders · US${Math.round(st.revenue).toLocaleString('en-AU')}</b><i>·</i>{st.label} (store time)</> });
    return out;
  }, [feed, cash, now]);

  useEffect(() => { const t = setInterval(() => setSlide(s => s + 1), ROTATE); return () => clearInterval(t); }, []);
  // A prayer inside 20 minutes holds the bar instead of rotating away.
  const soon = messages.find(m => m.soon);
  const shown = soon ?? messages[slide % Math.max(1, messages.length)];
  useEffect(() => {
    const p = feed?.prayer?.next;
    if (soon && p && warned.current !== p.at) { warned.current = p.at; toast({ icon: '🕌', title: `${p.name} in ${until(new Date(p.at).getTime() - Date.now())}`, note: `${p.leaderName} leads · ${p.suras.join(' + ')}`, tone: 'clay' }); }
  }, [soon, feed, toast]);

  async function unlock() {
    const ok = await new Promise<boolean>(resolve => window.dispatchEvent(new CustomEvent('family-edit-unlock', { detail: { resolve } })));
    if (ok) loadMoney();
  }

  const day = feed?.ansar.day ?? [];
  const current = day.find(s => new Date(s.start) <= now && now < new Date(s.end));
  const upcoming = day.find(s => new Date(s.start) > now);
  const nextTask = (t: Tasks | undefined) => t?.items.find(i => !i.done);

  const personCard = (name: string, sub: string, t: Tasks | undefined) => {
    const n = nextTask(t);
    return (
      <section className="hb-card">
        <div className="hb-head"><div><h2>{name}</h2><p>{sub}</p></div><Ring done={t?.done ?? 0} total={t?.total ?? 0} /></div>
        {t === undefined ? <p className="hb-empty">Loading…</p> : t === null ? <p className="hb-empty">Not available right now.</p> : !t.total ? <div className="hb-now idle"><span className="hb-eye">Today</span><strong>Rest day — nothing scheduled</strong></div> : <>
          <div className={'hb-now' + (n ? '' : ' idle')}><span className="hb-eye">{n ? <><i className="hb-pulse" />Up next</> : 'Today'}</span><strong>{n ? n.title : 'All done today ✓'}</strong>{n && <small>{t.total - t.done} left of {t.total}</small>}</div>
          <ul className="hb-list">{t.items.map(i => <li key={i.id} className={'hb-item' + (i.done ? ' done' : '') + (i === n ? ' now' : '') + (fresh.has(i.id) ? ' fresh' : '')}><span className="hb-check" /><span>{i.title}</span><span className="t">{i.count ?? ''}</span></li>)}</ul>
        </>}
      </section>
    );
  };

  // Breaks drop out of the list; the list starts one row before "now" so the current block is always on screen.
  const lessons = day.filter(s => !/^break$/i.test(s.title.replace(/[^a-z]/gi, '')));
  const at = lessons.findIndex(s => new Date(s.end) > now);
  const list = at > 1 ? lessons.slice(at - 1) : lessons;
  const rail = railPct(now);

  if (demo === null) return <main className="hb" />;
  return (
    <main className="hb">
      <div className="hb-bar">
        <div className={'hb-ann' + (shown?.soon ? ' soon' : '')}>
          {shown?.key === 'prayer' ? <a className="hb-tag" href="/prayer.html" title="Open the prayer board">{shown.tag}</a> : <span className="hb-tag">{shown?.tag ?? 'Today'}</span>}
          <div className="hb-msg">{shown ? <span key={shown.key + (soon ? '' : slide)}>{shown.node}</span> : <span>Loading the day…</span>}</div>
          {!soon && messages.length > 1 && <div className="hb-dots">{messages.map((m, i) => <i key={m.key} className={i === slide % messages.length ? 'on' : ''} />)}</div>}
        </div>
        <div className="hb-clock"><div className="hb-num">{fmtTime(now)}</div><div>{new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</div></div>
      </div>

      <div className="hb-people">
        <section className="hb-card">
          <div className="hb-head"><div><h2>Ansar</h2><p>Homeschool{feed?.ansar.schoolTicks?.total ? ` · ${feed.ansar.schoolTicks.done}/${feed.ansar.schoolTicks.total} blocks ticked` : ''}</p></div><Ring done={feed?.ansar.habits?.done ?? 0} total={feed?.ansar.habits?.total ?? 0} /></div>
          {!feed ? <p className="hb-empty">Loading…</p> : !day.length ? <div className="hb-now idle"><span className="hb-eye">Today</span><strong>No school today</strong><small>Habits {feed.ansar.habits?.done ?? 0}/{feed.ansar.habits?.total ?? 0}</small></div> : <>
            <div className={'hb-now' + (current ? '' : ' idle')}>
              <span className="hb-eye">{current ? <><i className="hb-pulse" />Now · until {fmtTime(current.end)}</> : now < new Date(day[0].start) ? `Starts ${fmtTime(day[0].start)}` : 'School day finished'}</span>
              <strong>{current ? `${current.emoji} ${current.title}` : upcoming ? `${upcoming.emoji} ${upcoming.title}` : 'Done for today'}</strong>
              {current && <><div className="hb-prog"><i style={{ width: `${Math.min(100, (now.getTime() - new Date(current.start).getTime()) / (new Date(current.end).getTime() - new Date(current.start).getTime()) * 100)}%` }} /></div><small>{until(new Date(current.end).getTime() - now.getTime())} left{current.ticked === true ? ' · ticked ✓' : current.ticked === false ? ' · not ticked yet' : ''}</small></>}
            </div>
            {current && upcoming && <p className="hb-next">Next <b>{upcoming.emoji} {upcoming.title}</b> at {fmtTime(upcoming.start)}</p>}
            <ul className="hb-list">{list.map(s => {
              const isNow = s === current, past = new Date(s.end) <= now;
              const cls = s.ticked ? ' done' : isNow ? ' now' : past ? ' passed' : '';
              return <li key={s.title + s.start} className={'hb-item' + cls + (fresh.has(s.title) ? ' fresh' : '')}><span className="hb-check" /><span>{s.emoji} {s.title}</span><span className="t">{past && s.ticked === false ? 'not ticked' : fmtTime(s.start)}</span></li>;
            })}</ul>
          </>}
        </section>
        {personCard('Nihal', 'Find & learn', feed?.nihal)}
        {personCard('TK', 'Build & launch', feed?.taylan)}
      </div>

      <div className="hb-band">
        <section className="hb-tile">
          <header><h3>Store</h3><small>{feed?.store?.today ? `${feed.store.today.label} · US$, store time` : ''}</small></header>
          {!feed?.store ? <p className="hb-empty">{feed ? 'Shopify not available right now.' : 'Loading…'}</p> : <>
            <div className="hb-stats">
              <div><span>Orders today</span><b className="hb-num">{feed.store.today?.orders ?? 0}</b></div>
              <div><span>Revenue today</span><b className="hb-num">${Math.round(feed.store.today?.revenue ?? 0).toLocaleString('en-AU')}</b></div>
              <div><span>Conversion</span><b className="hb-num">{feed.store.today?.conversion != null ? `${feed.store.today.conversion.toFixed(1)}%` : '—'}</b></div>
            </div>
            <div className="hb-bars" aria-label="Revenue, last seven days">{(() => { const max = Math.max(1, ...feed.store!.week.map(w => w.revenue)); return feed.store!.week.map(w => <div key={w.date}><i style={{ height: `${Math.max(4, w.revenue / max * 100)}%` }} title={`US$${Math.round(w.revenue)}`} /><span>{new Intl.DateTimeFormat('en-AU', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(w.date + 'T12:00:00Z'))}</span></div>); })()}</div>
            <div className="hb-money"><span>7 days</span><b>US${Math.round(feed.store.weekRevenue).toLocaleString('en-AU')} · {feed.store.weekOrders} orders</b></div>
          </>}
        </section>

        <section className="hb-tile">
          <header><h3>Our goals</h3>{cash && !cash.unlocked ? <button className="hb-unlock" onClick={unlock}>Unlock numbers</button> : <small>{cash ? `CLEO · ${fmtDay(cash.asOf)}` : ''}</small>}</header>
          {cash?.unlocked && cash.headline && <p className="hb-headline">{cash.headline}</p>}
          <div className="hb-stairs">{(cash?.goals ?? []).map((g, i) => (
            <div className="hb-step" key={i}>
              <i className="fill" style={{ height: `${g.pct}%` }} />
              <span className="hb-num">{g.short}</span><small>{i === 2 ? 'weekly business take-home' : 'net of card debt'}</small>
              <em>{g.now !== undefined ? `${money(g.now)} · ` : ''}{g.pct}%</em>
            </div>
          ))}</div>
          {cash?.unlocked && cash.cash && cash.week_income && <div className="hb-money">
            <span>Bank <b>{money(cash.cash.bank)}</b></span><span>Cards <b>{money(-cash.cash.cardDebt)}</b></span><span>Wages <b>{money(cash.week_income.wages)}</b>/wk</span>
          </div>}
          {!cash && <p className="hb-empty">Loading…</p>}
        </section>

        <section className="hb-tile">
          <header><h3>Coming up</h3><small>family calendars</small></header>
          {!feed?.calendar?.length ? <p className="hb-empty">{feed ? (feed.calendar ? 'Nothing booked.' : 'Calendar not available.') : 'Loading…'}</p> :
            <ul className="hb-cal">{feed.calendar.slice(0, 4).map((e, i) => <li key={e.id}><b>{e.subject.trim()}</b><span>{fmtDay(e.startISO)}{e.isAllDay ? '' : `, ${fmtTime(e.startISO)}`}{i === 0 ? ` · in ${until(new Date(e.startISO).getTime() - now.getTime())}` : ''}</span><em>{WHO[e.who] ?? e.who}</em></li>)}</ul>}
        </section>
      </div>

      <div className="hb-rail" aria-hidden="true">
        <div className="hb-track"><i style={{ width: `${rail}%` }} /></div>
        {feed?.prayer?.today.map(p => { const x = railPct(new Date(p.at)); return x > 0 && x < 100 ? <div key={p.prayer} className={'hb-mark pray' + (new Date(p.at) < now ? ' past' : '')} style={{ left: `${x}%` }}><b>{p.name}</b> {fmtTime(p.at)} · {p.leaderName}</div> : null; })}
        {day.length > 0 && [day[0], day.find(s => /homeschool ends/i.test(s.title)) ?? day[day.length - 1]].map((s, i) => <div key={i} className={'hb-mark low' + (new Date(s.start) < now ? ' past' : '')} style={{ left: `${railPct(new Date(s.start))}%` }}>{i === 0 ? 'School' : 'School ends'} {fmtTime(s.start)}</div>)}
        <div className="hb-nowdot" style={{ left: `${rail}%` }} />
        <span className="hb-rail-lbl" style={{ left: 0 }}>5am</span><span className="hb-rail-lbl" style={{ right: 0 }}>10pm</span>
      </div>

      <div className="hb-toasts" role="status" aria-live="polite">{toasts.map(t => <div key={t.id} className={'hb-toast' + (t.tone ? ` ${t.tone}` : '') + (t.out ? ' out' : '')}><span>{t.icon}</span><div><b>{t.title}</b><small>{t.note}</small></div></div>)}</div>
      {(failed || demo) && <p className="hb-stale">{demo ? 'Demo data — remove ?demo to see the live board.' : `Connection lost — showing ${feed ? `data from ${fmtTime(feed.generatedAt)}` : 'nothing yet'}. Retrying.`}</p>}
    </main>
  );
}
