'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/* The board's pop-ups — its most important job: tell the room what just
   happened or what's about to. One at a time, from a queue, so nothing is
   missed and nothing piles up; a prayer jumps the queue. Every kind has its
   own shape and motion so the room can tell them apart from across it. */

export type Popup =
  | { kind: 'prayer'; name: string; minutes: number; leader: string; suras: string[]; now?: boolean }
  | { kind: 'tick'; who: string; title: string; warn?: boolean }
  | { kind: 'block'; emoji: string; title: string; done: number; total: number }
  | { kind: 'complete'; who: string; total: number }
  | { kind: 'order'; added: number; orders: number; revenue: number }
  | { kind: 'event'; title: string; minutes: number; when: string }
  | { kind: 'brief'; hour: string; lines: string[] }
  | { kind: 'goal'; short: string; label: string; now: string | null };

const SHOW_MS: Record<Popup['kind'], number> = { goal: 13000, prayer: 14000, tick: 7000, block: 8000, complete: 9000, order: 7500, event: 9000, brief: 11000 };
const OUT_MS = 600;

export function usePopups() {
  const [queue, setQueue] = useState<(Popup & { id: number })[]>([]);
  const push = useCallback((p: Popup) => setQueue(q => {
    const item = { ...p, id: Date.now() + Math.random() };
    // Prayer goes straight to the front (after whatever is showing now).
    return p.kind === 'prayer' || p.kind === 'goal' ? [...q.slice(0, 1), item, ...q.slice(1)] : [...q, item].slice(0, 12);
  }), []);
  const done = useCallback(() => setQueue(q => q.slice(1)), []);
  return { current: queue[0] ?? null, waiting: Math.max(0, queue.length - 1), push, done };
}

function Confetti({ n = 14 }: { n?: number }) {
  return <i className="pp-confetti" aria-hidden="true">{Array.from({ length: n }, (_, i) => <b key={i} style={{ '--a': `${(360 / n) * i}deg`, '--d': `${70 + (i % 3) * 30}px`, '--c': ['#b8612f', '#2b5d57', '#f0b089', '#557a75'][i % 4] } as React.CSSProperties} />)}</i>;
}

function Roll({ from, to, prefix = '' }: { from: number; to: number; prefix?: string }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    const t0 = performance.now(), dur = 1400;
    let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / dur); setV(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  return <>{prefix}{Math.round(v).toLocaleString('en-AU')}</>;
}

export function PopupStage({ current, waiting, done, onShow }: { current: (Popup & { id: number }) | null; waiting: number; done: () => void; onShow?: (p: Popup) => void }) {
  // Keyed by id: each pop-up mounts fresh, so its own leave timer starts clean.
  return current ? <PopupView key={current.id} p={current} waiting={waiting} done={done} onShow={onShow} /> : null;
}

function PopupView({ p, waiting, done, onShow }: { p: Popup; waiting: number; done: () => void; onShow?: (p: Popup) => void }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { onShow?.(p); }, [p, onShow]);
  useEffect(() => {
    timer.current = setTimeout(() => { setLeaving(true); timer.current = setTimeout(done, OUT_MS); }, SHOW_MS[p.kind]);
    return () => clearTimeout(timer.current);
  }, [p, done]);
  const cls = `pp pp-${p.kind}${leaving ? ' out' : ''}`;
  const more = waiting > 0 && <span className="pp-more">+{waiting} more</span>;

  if (p.kind === 'goal') return (
    <div className={'pp-veil pp-goalveil' + (leaving ? ' out' : '')} role="alert">
      <i className="pp-rain" aria-hidden="true">{Array.from({ length: 70 }, (_, i) => <b key={i} style={{ '--x': `${(i * 37) % 100}vw`, '--t': `${2.6 + (i % 7) * 0.45}s`, '--dl': `${(i % 10) * 0.18}s`, '--c': ['#b8612f', '#2b5d57', '#f0b089', '#557a75', '#e9c46a'][i % 5], '--r': `${(i * 53) % 360}deg` } as React.CSSProperties} />)}</i>
      <div className={'pp pp-goal' + (leaving ? ' out' : '')}>
        <span className="pp-eye">Goal reached</span>
        <h2>{p.short}</h2><p>{p.label}</p>{p.now && <small>{p.now}</small>}
        <div className="pp-stairs" aria-hidden="true"><i /><i /><i /></div>{more}
      </div>
    </div>
  );

  if (p.kind === 'prayer') return (
    <div className={'pp-veil' + (leaving ? ' out' : '')} role="alert">
      <div className={cls}>
        <svg className="pp-arch" viewBox="0 0 200 240" aria-hidden="true">
          <path d="M20 236 V110 C20 50 100 8 100 8 C100 8 180 50 180 110 V236" />
          <path d="M44 236 V118 C44 72 100 40 100 40 C100 40 156 72 156 118 V236" />
          <circle className="moon" cx="100" cy="96" r="18" /><circle className="bite" cx="109" cy="89" r="15" />
        </svg>
        <div className="pp-pray-body">
          <span className="pp-eye">{p.now ? 'It is time' : `In ${p.minutes} min`}</span>
          <h2>{p.name}</h2>
          <p className="pp-lead"><b>{p.leader}</b> leads</p>
          <div className="pp-suras">{p.suras.map((s, i) => <span key={s + i} style={{ animationDelay: `${0.9 + i * 0.25}s` }}>{i === 0 ? '1st' : '2nd'} rak&apos;ah · {s}</span>)}</div>
        </div>
        {more}
      </div>
    </div>
  );

  if (p.kind === 'tick') return (
    <div className={cls + (p.warn ? ' warn' : '')} role="status">
      <div className="pp-icon"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23" />{p.warn ? <path d="M26 14 v15 M26 36 v1" /> : <path d="M15 27 l7 7 l15 -16" />}</svg>{!p.warn && <Confetti />}</div>
      <div><span className="pp-eye">{p.who} · {p.warn ? 'needs a look' : 'just done'}</span><b>{p.title}</b></div>{more}
    </div>
  );

  if (p.kind === 'block') return (
    <div className={cls} role="status">
      <div className="pp-emoji">{p.emoji}</div>
      <div className="pp-grow"><span className="pp-eye">Ansar finished a block</span><b>{p.title}</b>
        <div className="pp-segs">{Array.from({ length: p.total }, (_, i) => <i key={i} className={i < p.done - 1 ? 'on' : i === p.done - 1 ? 'new' : ''} />)}</div>
        <small>{p.done} of {p.total} blocks today</small></div>{more}
    </div>
  );

  if (p.kind === 'complete') return (
    <div className={cls} role="status">
      <div className="pp-burst" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ '--a': `${i * 30}deg` } as React.CSSProperties} />)}<span>★</span></div>
      <span className="pp-eye">Whole list done</span><h3>{p.who} finished today</h3><small>{p.total} of {p.total} ✓</small>{more}
    </div>
  );

  if (p.kind === 'order') return (
    <div className={cls} role="status">
      <div className="pp-bag">🛍<span className="pp-coin">+{p.added}</span></div>
      <div><span className="pp-eye">{p.added === 1 ? 'New order' : `${p.added} new orders`}</span><b><Roll from={p.orders - p.added} to={p.orders} /> orders today</b><small>US$<Roll from={0} to={p.revenue} /> so far</small></div>{more}
    </div>
  );

  if (p.kind === 'event') return (
    <div className={cls} role="status">
      <div className="pp-cal"><span>{p.when.split(' ')[0]}</span><b>{p.minutes}</b><small>min</small></div>
      <div><span className="pp-eye">Starting soon</span><b>{p.title}</b><small>{p.when}</small></div>{more}
    </div>
  );

  return (
    <div className={cls} role="status">
      <span className="pp-eye">{p.hour} · what&apos;s next</span>
      <ul>{p.lines.map((l, i) => <li key={i} style={{ animationDelay: `${0.25 + i * 0.35}s` }}>{l}</li>)}</ul>{more}
    </div>
  );
}
