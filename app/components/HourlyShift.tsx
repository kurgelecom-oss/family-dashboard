'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import './hourly-shift.css';
import { TZ } from '../lib/cal-time';

/* Every hour, on the hour, the home board hands the TV to the calendar for 30
   seconds and takes it back — with a motion wipe each way. Lives in the root
   layout, which survives client navigation, so one overlay covers the old page,
   the route changes underneath it, and the same overlay reveals the new page.
   If someone touches the calendar during its 30 s, it stays (they're using it).
   Test it any time with /?shift=now. Only "/" starts it; other routes never move. */

type Phase = 'idle' | 'cover' | 'reveal';
const COVER_MS = 1100, REVEAL_MS = 1000, STAY_MS = 30_000;
const hourKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(new Date());
const minuteNow = () => Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, minute: 'numeric' }).format(new Date()));
const clockNow = () => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date()).replace(' ', '').toLowerCase();

export default function HourlyShift() {
  const path = usePathname(), router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [label, setLabel] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const trip = useRef<{ to: '/board' | '/'; } | null>(null);
  const away = useRef(false); // true while the calendar is on screen because of the hourly shift
  const fired = useRef('');

  function go(to: '/board' | '/') {
    if (trip.current) return;
    trip.current = { to };
    setLabel(to === '/board' ? 'Calendar' : 'Dashboard');
    setPhase('cover');
    setTimeout(() => router.push(to === '/board' ? '/board?view=week' : '/'), COVER_MS);
  }

  // The route changed under the cover → reveal the new page once it has had a moment to paint.
  useEffect(() => {
    const t = trip.current;
    if (!t || (t.to === '/board' ? !path.startsWith('/board') : path !== '/')) return;
    const r = setTimeout(() => {
      setPhase('reveal');
      setTimeout(() => { setPhase('idle'); trip.current = null; }, REVEAL_MS);
      if (t.to === '/board') { away.current = true; setLeft(STAY_MS / 1000); } else { away.current = false; setLeft(null); }
    }, 600);
    return () => clearTimeout(r);
  }, [path]);

  // On the hour from "/" (and /?shift=now for a test).
  useEffect(() => {
    router.prefetch('/board');
    const tick = () => {
      if (path !== '/' || document.hidden || trip.current) return;
      const k = hourKey();
      if (minuteNow() === 0 && fired.current !== k) { fired.current = k; go('/board'); }
    };
    if (path === '/' && new URLSearchParams(window.location.search).get('shift') === 'now') { history.replaceState(null, '', '/'); go('/board'); }
    const i = setInterval(tick, 5000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go/router are stable for this purpose
  }, [path]);

  // 30 s on the calendar, then home — unless someone starts using it.
  useEffect(() => {
    if (left === null) return;
    if (!away.current || !path.startsWith('/board')) { setLeft(null); away.current = false; return; }
    if (left <= 0) { away.current = false; setLeft(null); go('/'); return; }
    const t = setTimeout(() => setLeft(l => (l === null ? null : l - 1)), 1000);
    const stay = () => { away.current = false; setLeft(null); };
    window.addEventListener('pointerdown', stay, { once: true });
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', stay); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, path]);

  return <>
    {phase !== 'idle' && <div className={`hs-layer ${phase}`} aria-hidden="true">
      <i className="hs-disc d1" /><i className="hs-disc d2" /><i className="hs-disc d3" />
      <div className="hs-word"><small>{clockNow()}</small><b>{label}</b></div>
      <div className="hs-sweep" />
    </div>}
    {left !== null && left > 0 && phase === 'idle' && <div className="hs-pill" role="status"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle className="fg" cx="18" cy="18" r="15" style={{ strokeDashoffset: 94.25 * (1 - left / (STAY_MS / 1000)) }} /></svg>Back to the dashboard in {left}s · tap anywhere to stay</div>}
  </>;
}
