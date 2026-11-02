'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import './fajr.css';
import { TZ } from '../lib/cal-time';
import { prayerTimes } from '../lib/prayer';

/* Fajr screen (tk, 2 Nov 2026). Turn the TV on before sunrise and the boards
   ("/" and the calendar) don't start: a dim, warm screen with two lit lanterns
   shows Fajr and sunrise instead. The sky warms slowly from Fajr towards sunrise,
   and at sunrise it fades away into the dashboard on its own.
   The window is 3 am to sunrise (the end-of-day wrap owns 10 pm to 3 am).
   Times come from the prayer board's own calculation (lib/prayer).
   Test with ?fajr=now (tap to close in test mode only). */

const ymd = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at).map(x => [x.type, Number(x.value)])) as Record<string, number>;
const clock = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase();

function morning(now = new Date()) {
  const p = ymd(now), t = prayerTimes(p.year, p.month, p.day);
  return { fajr: t.fajr, sunrise: t.sunrise, on: p.hour >= 3 && now < t.sunrise };
}

function Lantern({ id, glow }: { id: string; glow: string }) {
  return (
    <svg className={'fj-lantern ' + id} viewBox="0 0 200 470" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-fire`} cx="100" cy="320" r="150" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff1c4" /><stop offset=".18" stopColor={glow} /><stop offset=".55" stopColor="#b4541a" /><stop offset="1" stopColor="#2a1206" />
        </radialGradient>
        <pattern id={`${id}-lace`} width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="26" height="26" fill="#fff" />
          <rect x="6" y="6" width="14" height="14" fill="#000" />
          <rect x="6" y="6" width="14" height="14" fill="#000" transform="rotate(45 13 13)" />
          <circle cx="0" cy="0" r="3.2" fill="#000" /><circle cx="26" cy="0" r="3.2" fill="#000" /><circle cx="0" cy="26" r="3.2" fill="#000" /><circle cx="26" cy="26" r="3.2" fill="#000" />
          <circle cx="13" cy="13" r="2.4" fill="#fff" />
        </pattern>
        <mask id={`${id}-holes`} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="470"><rect width="200" height="470" fill={`url(#${id}-lace)`} /></mask>
        <linearGradient id={`${id}-metal`} x1="0" x2="1"><stop offset="0" stopColor="#1a120c" /><stop offset=".5" stopColor="#3a2a1a" /><stop offset="1" stopColor="#140d08" /></linearGradient>
      </defs>
      {/* light inside, seen through the lattice */}
      <g className="fj-fire">
        <path d="M44 156 C44 116 82 96 100 52 C118 96 156 116 156 156 Z" fill={`url(#${id}-fire)`} />
        <rect x="50" y="166" width="100" height="214" fill={`url(#${id}-fire)`} />
      </g>
      {/* pierced metal: cap and body */}
      <path d="M44 156 C44 116 82 96 100 52 C118 96 156 116 156 156 Z" fill={`url(#${id}-metal)`} mask={`url(#${id}-holes)`} />
      <rect x="50" y="166" width="100" height="214" fill={`url(#${id}-metal)`} mask={`url(#${id}-holes)`} />
      {/* frame */}
      <g fill="none" stroke="#2b1e13" strokeLinejoin="round">
        <path d="M44 156 C44 116 82 96 100 52 C118 96 156 116 156 156" strokeWidth="7" />
        <rect x="50" y="166" width="100" height="214" strokeWidth="9" />
        <path d="M100 166 V380" strokeWidth="5" />
      </g>
      <rect x="36" y="152" width="128" height="16" rx="3" fill="#2b1e13" />
      <path d="M40 380 H160 L150 404 H50 Z" fill="#24180f" />
      <rect x="54" y="404" width="14" height="10" fill="#1c130c" /><rect x="132" y="404" width="14" height="10" fill="#1c130c" />
      <circle cx="100" cy="46" r="7" fill="#2b1e13" />
      <circle cx="100" cy="24" r="15" fill="none" stroke="#2b1e13" strokeWidth="5" />
      {/* candle */}
      <g className="fj-candle">
        <rect x="86" y="318" width="28" height="52" rx="3" fill="#f3dcb0" opacity=".72" />
        <path className="fj-flame" d="M100 290 C108 302 110 310 100 318 C90 310 92 302 100 290 Z" fill="#fff4cf" />
      </g>
    </svg>
  );
}

export default function FajrScreen() {
  const path = usePathname();
  const [state, setState] = useState<{ fajr: Date; sunrise: Date; now: Date; test: boolean } | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const test = new URLSearchParams(window.location.search).get('fajr') === 'now';
    const check = () => {
      const now = new Date(), m = morning(now);
      if (test) { setState({ fajr: m.fajr, sunrise: m.sunrise, now: new Date(m.fajr.getTime() + 0.35 * (m.sunrise.getTime() - m.fajr.getTime())), test }); return; }
      if (path !== '/' && !path.startsWith('/board')) { setState(null); return; }
      if (m.on) { setLeaving(false); setState({ ...m, now, test }); }
      else setState(s => { if (s) { setLeaving(true); setTimeout(() => { setState(null); setLeaving(false); }, 4000); } return s; });
    };
    check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [path]);

  if (!state) return null;
  const { fajr, sunrise, now } = state;
  const dawn = Math.max(0, Math.min(1, (now.getTime() - fajr.getTime()) / (sunrise.getTime() - fajr.getTime())));
  const before = now < fajr;
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const mins = Math.max(0, Math.round((sunrise.getTime() - now.getTime()) / 60_000));

  return (
    <div className={'fj' + (leaving ? ' out' : '')} style={{ ['--dawn' as string]: dawn }} role="dialog" aria-modal aria-labelledby="fj-h"
      onClick={state.test ? () => setState(null) : undefined}>
      <i className="fj-sky" aria-hidden="true" />
      <i className="fj-stars" aria-hidden="true">{Array.from({ length: 46 }, (_, i) => <b key={i} style={{ left: `${(i * 37 + 11) % 100}%`, top: `${(i * 53 + 7) % 46}%`, animationDelay: `${(i % 9) * 0.7}s`, opacity: 0.25 + (i % 4) * 0.12 } as React.CSSProperties} />)}</i>
      <i className="fj-wall" aria-hidden="true" />
      <header className="fj-text">
        <p className="fj-eye">{day}</p>
        <h1 id="fj-h">Fajr</h1>
        <p className="fj-ar" lang="ar" dir="rtl">ٱلصَّلَاةُ خَيْرٌ مِنَ ٱلنَّوْمِ</p>
        <p className="fj-tr">Prayer is better than sleep.</p>
      </header>
      <div className="fj-scene" aria-hidden="true">
        <i className="fj-pool" />
        <Lantern id="fj-a" glow="#ffb347" />
        <Lantern id="fj-b" glow="#ffa63a" />
      </div>
      <footer className="fj-times">
        <span><small>Fajr</small>{clock(fajr)}</span>
        <i className="fj-track"><b style={{ width: `${dawn * 100}%` }} /></i>
        <span><small>Sunrise</small>{clock(sunrise)}</span>
        <p>{before ? `Fajr comes in at ${clock(fajr)}.` : `The dashboard opens at sunrise${mins ? ` · ${mins} min` : ''}.`}</p>
      </footer>
    </div>
  );
}
