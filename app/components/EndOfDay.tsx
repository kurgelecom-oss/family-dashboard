'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import './end-of-day.css';
import { TZ } from '../lib/cal-time';

/* End-of-day wrap (tk, 2 Nov 2026). At 10 pm the TV boards ("/" and the calendar)
   show one quiet full-room card: the day is done, close the dashboard, turn the
   screens off. It stays up until someone taps it, then not again that night.
   The night runs 10 pm to 5 am, so a board opened at 11 pm still gets it.
   Test any time with ?wrap=now. */

const KEY = 'eod-wrapped';
const parts = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(x => [x.type, x.value]));
/** The evening this night belongs to (1 am still counts as the evening before). */
const nightOf = (now = new Date()) => { const p = parts(new Date(now.getTime() - 5 * 3600_000)); return `${p.year}-${p.month}-${p.day}`; };
const isWrapTime = (now = new Date()) => { const h = Number(parts(now).hour); return h >= 22 || h < 5; };

export default function EndOfDay() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get('wrap') === 'now';
    const check = () => {
      if (forced) { setOpen(true); return; }
      if (path !== '/' && !path.startsWith('/board')) return;
      if (isWrapTime() && localStorage.getItem(KEY) !== nightOf()) setOpen(true);
    };
    check();
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  function close() {
    localStorage.setItem(KEY, nightOf());
    setLeaving(true);
    setTimeout(() => { setOpen(false); setLeaving(false); }, 900);
  }

  if (!open) return null;
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(now).replace(' ', '').toLowerCase();
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(now.getTime() - 5 * 3600_000));

  return (
    <div className={'eod' + (leaving ? ' out' : '')} role="dialog" aria-modal aria-labelledby="eod-h" onClick={close}>
      <article className="eod-card">
        <svg className="eod-moon" viewBox="0 0 64 64" aria-hidden="true"><path d="M42 8a26 26 0 1 0 14 40A22 22 0 0 1 42 8Z" /></svg>
        <p className="eod-eye">{time} · {day}</p>
        <h1 id="eod-h">That&rsquo;s the day.</h1>
        <p className="eod-sub">End of day wrap. Time to switch off.</p>
        <i className="eod-rule" aria-hidden="true" />
        <ol className="eod-steps">
          <li><span>01</span>Close the dashboard</li>
          <li><span>02</span>Turn off the TV and every screen</li>
        </ol>
        <p className="eod-foot">Rest well. See you at Fajr.</p>
        <button className="eod-btn" onClick={e => { e.stopPropagation(); close(); }} autoFocus>Done for tonight</button>
      </article>
    </div>
  );
}
