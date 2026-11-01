'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import './event-alerts.css';
import { chime, soundReady, unlockSound } from './home/sound';
import { addDays, clock, today as todayDay, wall } from '../lib/cal-time';

/* Calendar pop-ups. An event someone switched on (per series, in the calendar's
   event sheet) takes over the screen 10 minutes before it starts:
     · Pop-up  — 75% of the screen, full motion scene, live countdown
     · Pop-out — a smaller animated card in the corner
   Each event gets its own scene, colours, particle field and icon, chosen from a
   hash of the event, so the room learns "the football one" by sight and the same
   event looks the same every week. It stays until someone presses the button, and
   clears itself when the event ends so a screen nobody is watching never sits on a
   stale alert. Cleared alerts are remembered per screen.
   Mounted on "/" and "/board", so it fires whichever view the TV is on. */

import { ACCENTS, CAL_HUE, CAL_LABEL, LEAD_MS, dueAlerts, hash, iconFor, look, rng, type AlertEvent, type AlertMode } from '../lib/alerts-model';
export type { AlertEvent, AlertMode } from '../lib/alerts-model';
type Live = AlertEvent & { mode: AlertMode; preview?: boolean };

const clearedKey = (e: AlertEvent) => `ea-cleared:${e.key}@${e.startISO}`;

/** Ask every mounted EventAlerts to show this one now (the sheet's Preview button). */
export function previewAlert(e: AlertEvent, mode: AlertMode) { window.dispatchEvent(new CustomEvent('event-alert-preview', { detail: { ...e, mode, preview: true } })); }

function Scene({ ev }: { ev: Live }) {
  const seed = hash(ev.key), r = useMemo(() => rng(seed), [seed]);
  const { scene, accent } = look(ev.key, ev.scene);
  const parts = useMemo(() => Array.from({ length: 18 }, () => ({ x: r() * 100, y: r() * 100, s: 4 + r() * 10, d: 6 + r() * 10, delay: -r() * 10 })), [r]);
  const spin = 14 + (seed % 12);
  return (
    <div className={`ea-scene ${scene}`} style={{ '--hue': CAL_HUE[ev.cal] ?? CAL_HUE.routine, '--acc': accent, '--spin': `${spin}s`, '--tilt': `${(seed % 60) - 30}deg` } as React.CSSProperties} aria-hidden="true">
      {scene === 'orbit' && <svg viewBox="-100 -100 200 200" className="ea-orbit">{[38, 62, 86].map((rad, i) => <g key={rad} style={{ animationDuration: `${spin * (i + 1) / 2}s`, animationDirection: i % 2 ? 'reverse' : 'normal' }}><circle r={rad} /><circle className="moon" cx={rad} r={3 + i * 1.5} /></g>)}</svg>}
      {scene === 'burst' && <><i className="ea-rays" />{[0, 1, 2].map(i => <i key={i} className="ea-ring" style={{ animationDelay: `${i * 1.1}s` }} />)}</>}
      {scene === 'waves' && <svg viewBox="0 0 1200 300" preserveAspectRatio="none" className="ea-waves">{[0, 1, 2].map(i => <path key={i} style={{ animationDuration: `${7 + i * 3}s`, opacity: 0.25 + i * 0.2 }} d={`M0 ${150 + i * 30} Q150 ${80 + i * 30} 300 ${150 + i * 30} T600 ${150 + i * 30} T900 ${150 + i * 30} T1200 ${150 + i * 30} T1500 ${150 + i * 30} T1800 ${150 + i * 30} T2100 ${150 + i * 30} T2400 ${150 + i * 30} V300 H0Z`} />)}</svg>}
      {scene === 'tiles' && <div className="ea-tiles">{Array.from({ length: 48 }, (_, i) => <i key={i} style={{ animationDelay: `${((i % 8) + Math.floor(i / 8)) * 0.12}s` }} />)}</div>}
      {scene === 'aurora' && [0, 1, 2, 3].map(i => <i key={i} className="ea-blob" style={{ left: `${parts[i].x}%`, top: `${parts[i].y}%`, animationDuration: `${parts[i].d + 8}s`, background: i % 2 ? 'var(--acc)' : 'var(--hue)' }} />)}
      {parts.map((p, i) => <b key={i} className="ea-dot" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }} />)}
    </div>
  );
}

function Card({ ev, now, onClear }: { ev: Live; now: number; onClear: () => void }) {
  const start = Date.parse(ev.startISO), end = Date.parse(ev.endISO), left = start - now, live = left <= 0;
  const pct = live ? 1 : Math.max(0, Math.min(1, 1 - left / LEAD_MS));
  const s = Math.max(0, Math.round(left / 1000));
  const words = ev.title.trim().split(/\s+/);
  const ws = wall(ev.startISO), we = wall(ev.endISO);
  return (
    <div className={`ea-card ${ev.mode}`} style={{ '--hue': CAL_HUE[ev.cal] ?? CAL_HUE.routine, '--acc': look(ev.key, ev.scene).accent } as React.CSSProperties} role="alertdialog" aria-label={`${ev.title} ${live ? 'is starting' : 'starts soon'}`}>
      <Scene ev={ev} />
      <div className="ea-content">
        <div className="ea-top"><span className="ea-chip">{CAL_LABEL[ev.cal] ?? ev.cal}</span>{ev.preview && <span className="ea-chip ghost">Preview</span>}</div>
        <div className="ea-icon"><svg viewBox="0 0 120 120"><circle className="bg" cx="60" cy="60" r="54" /><circle className="fg" cx="60" cy="60" r="54" style={{ strokeDashoffset: 339.3 * (1 - pct) }} /></svg><span>{iconFor(ev.title)}</span></div>
        <h2 className="ea-title">{words.map((w, i) => <span key={i} style={{ animationDelay: `${0.25 + i * 0.09}s` }}>{w}&nbsp;</span>)}</h2>
        <p className="ea-when">{live ? (now < end ? 'Happening now' : 'Just finished') : <>Starts in <b>{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</b></>}<i>·</i>{ev.allDay ? 'All day' : `${clock(ws.min)} – ${clock(we.min)}`}{ws.day !== todayDay() ? <><i>·</i>tomorrow</> : null}</p>
        <button className="ea-clear" onClick={onClear} autoFocus>Press me to clear</button>
      </div>
    </div>
  );
}

export default function EventAlerts() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [alerts, setAlerts] = useState<Record<string, AlertMode>>({});
  const [now, setNow] = useState(() => Date.now());
  const [cleared, setCleared] = useState(0);
  const [preview, setPreview] = useState<Live | null>(null);

  const load = useCallback(async () => {
    if (document.hidden) return;
    // Forget clears older than 3 days so a long-running screen's storage stays small.
    for (const k of Object.keys(localStorage)) if (k.startsWith('ea-cleared:') && Date.now() - Number(localStorage.getItem(k)) > 3 * 864e5) localStorage.removeItem(k);
    const from = todayDay(), to = addDays(from, 2);
    const [ext, own, al] = await Promise.allSettled([
      fetch(`/api/cal?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/cal/events?from=${from}&to=${to}`, { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/cal/alerts', { cache: 'no-store' }).then(r => r.json()),
    ]);
    const list: AlertEvent[] = [];
    if (ext.status === 'fulfilled') list.push(...(ext.value.events ?? []));
    if (own.status === 'fulfilled') list.push(...(own.value.events ?? []).map((e: AlertEvent & { id: string }) => ({ ...e, key: `board-${e.id}` })));
    setEvents(list);
    if (al.status === 'fulfilled' && al.value.alerts) setAlerts(al.value.alerts);
  }, []);

  useEffect(() => {
    load();
    const a = setInterval(load, 3 * 60_000), b = setInterval(() => setNow(Date.now()), 1000);
    const onPrev = (e: Event) => setPreview((e as CustomEvent<Live>).detail);
    const onChange = () => load();
    const unlock = () => unlockSound();
    window.addEventListener('event-alert-preview', onPrev); window.addEventListener('event-alerts-changed', onChange); window.addEventListener('pointerdown', unlock, { once: true });
    return () => { clearInterval(a); clearInterval(b); window.removeEventListener('event-alert-preview', onPrev); window.removeEventListener('event-alerts-changed', onChange); window.removeEventListener('pointerdown', unlock); };
  }, [load]);

  // Due = switched on, inside [start − 10 min, end), not cleared on this screen. Pop-ups before pop-outs, soonest first.
  const due = useMemo(() => {
    void cleared;
    return dueAlerts(events, alerts, now, e => !!localStorage.getItem(clearedKey(e)));
  }, [events, alerts, now, cleared]);
  const current: Live | null = preview ?? due[0] ?? null;

  const shownKey = current ? `${current.key}@${current.startISO}${current.preview ? ':p' : ''}` : '';
  useEffect(() => { if (shownKey && soundReady()) chime(); }, [shownKey]);

  function clear() {
    if (!current) return;
    if (current.preview) { setPreview(null); return; }
    localStorage.setItem(clearedKey(current), String(Date.now()));
    setCleared(n => n + 1);
  }

  if (!current) return null;
  return (
    <div className={`ea-layer ${current.mode}`}>
      {current.mode === 'popup' && <div className="ea-scrim" />}
      <Card key={shownKey} ev={current} now={now} onClear={clear} />
      {due.length > 1 && !current.preview && <span className={`ea-more ${current.mode}`}>+{due.length - 1} more after this</span>}
    </div>
  );
}
