'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { familyWrite } from '../components/FamilyEditGate';

/* Pen ink over a calendar page — the Flip's whiteboard, kept per page
   (a week, a day, a month, a year) and shared by every screen.
   Coordinates are stored as fractions of the page, so ink drawn at 9 am on
   Tuesday stays at 9 am on Tuesday on any screen size.
   Palm rejection: once a pen has touched the page, fingers stop drawing
   (the Flip's pen reports pointerType "pen"; if it ever reports "touch",
   fingers and pen both draw and nothing is lost). */

type Stroke = { c: string; w: number; p: number[] };
const COLOURS = ['#1d2322', '#1f4a45', '#b8612f', '#c2412d', '#2f8a57', '#2a5bd7'];
const WIDTHS = [3, 7, 16];

export default function Ink({ scope, active, onError }: { scope: string; active: boolean; onError: (m: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const cur = useRef<Stroke | null>(null);
  const penSeen = useRef(false);
  const pending = useRef<{ scope: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [colour, setColour] = useState(COLOURS[0]);
  const [width, setWidth] = useState(WIDTHS[0]);
  const [erase, setErase] = useState(false);
  const [sureClear, setSureClear] = useState(false);
  const [count, setCount] = useState(0);

  const draw = useCallback(() => {
    const c = cv.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      g.strokeStyle = s.c; g.lineWidth = s.w; g.beginPath();
      const p = s.p; g.moveTo(p[0] * W, p[1] * H);
      if (p.length === 2) g.lineTo(p[0] * W + 0.1, p[1] * H);
      for (let i = 2; i < p.length - 2; i += 2) { const mx = (p[i] + p[i + 2]) / 2 * W, my = (p[i + 1] + p[i + 3]) / 2 * H; g.quadraticCurveTo(p[i] * W, p[i + 1] * H, mx, my); }
      if (p.length > 2) g.lineTo(p[p.length - 2] * W, p[p.length - 1] * H);
      g.stroke();
    }
  }, []);

  const save = useCallback((forScope: string, list: Stroke[]) => familyWrite('/api/cal/ink', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: forScope, strokes: list }) })
    .then(r => { if (!r.ok) onError('Ink not saved — unlock editing with the family PIN'); }).catch(() => onError('Ink not saved — no connection')), [onError]);

  const queueSave = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    const s = scope, list = strokes.current;
    pending.current = { scope: s, timer: setTimeout(() => { pending.current = null; save(s, list); }, 1200) };
  }, [scope, save]);

  // Load the page's ink; a save still waiting for the previous page is sent first.
  useEffect(() => {
    let live = true;
    strokes.current = []; draw(); setCount(0);
    fetch(`/api/cal/ink?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : { strokes: [] }).then(b => { if (live) { strokes.current = b.strokes ?? []; draw(); setCount(strokes.current.length); } }).catch(() => {});
    return () => { live = false; if (pending.current) { clearTimeout(pending.current.timer); const p = pending.current; pending.current = null; save(p.scope, strokes.current); } };
  }, [scope, draw, save]);

  // Another screen's ink arrives within a minute when this one isn't drawing.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || cur.current || pending.current) return;
      fetch(`/api/cal/ink?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { if (b && !cur.current && !pending.current) { strokes.current = b.strokes ?? []; draw(); } }).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [scope, draw]);

  useEffect(() => { const c = cv.current; if (!c) return; const ro = new ResizeObserver(draw); ro.observe(c); return () => ro.disconnect(); }, [draw]);

  const at = (e: PointerEvent | React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)]; };
  const ignore = (e: React.PointerEvent) => { if (e.pointerType === 'pen') penSeen.current = true; return penSeen.current && e.pointerType === 'touch'; };

  function eraseAt(e: React.PointerEvent) {
    const r = cv.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, R = 18;
    const before = strokes.current.length;
    strokes.current = strokes.current.filter(s => { for (let i = 0; i < s.p.length; i += 2) if (Math.hypot(s.p[i] * r.width - x, s.p[i + 1] * r.height - y) < R + s.w / 2) return false; return true; });
    if (strokes.current.length !== before) { draw(); queueSave(); setCount(strokes.current.length); }
  }
  function down(e: React.PointerEvent) {
    if (!active || ignore(e)) return;
    e.preventDefault(); e.stopPropagation(); try { cv.current!.setPointerCapture(e.pointerId); } catch { /* synthetic or already-lifted pointer */ }
    if (erase || e.button === 5) { cur.current = null; eraseAt(e); return; }
    cur.current = { c: colour, w: width, p: at(e) };
  }
  function move(e: React.PointerEvent) {
    if (!active || ignore(e) || !(e.buttons || e.pointerType === 'touch')) return;
    e.stopPropagation();
    if (erase || e.buttons === 32) { eraseAt(e); return; }
    if (!cur.current) return;
    const co = e.nativeEvent.getCoalescedEvents?.() ?? [], pts = co.length ? co : [e.nativeEvent];
    for (const p of pts) cur.current.p.push(...at(p));
    draw();
  }
  function up(e: React.PointerEvent) {
    if (!active) return;
    e.stopPropagation();
    if (cur.current) { strokes.current = [...strokes.current, cur.current]; cur.current = null; draw(); queueSave(); setCount(strokes.current.length); }
  }
  function undo() { strokes.current = strokes.current.slice(0, -1); draw(); queueSave(); setCount(strokes.current.length); }
  function clear() { if (!sureClear) { setSureClear(true); setTimeout(() => setSureClear(false), 3000); return; } strokes.current = []; draw(); queueSave(); setSureClear(false); setCount(strokes.current.length); }

  return <>
    <canvas ref={cv} className={'cal-ink' + (active ? ' on' : '')} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden={!active} />
    {active && <div className="cal-inkbar" role="toolbar" aria-label="Pen">
      {COLOURS.map(c => <button key={c} aria-label={`Colour ${c}`} className={'sw' + (!erase && colour === c ? ' on' : '')} style={{ background: c }} onClick={() => { setColour(c); setErase(false); }} />)}
      <i />
      {WIDTHS.map(w => <button key={w} aria-label={`Width ${w}`} className={'wd' + (!erase && width === w ? ' on' : '')} onClick={() => { setWidth(w); setErase(false); }}><span style={{ width: w + 4, height: w + 4 }} /></button>)}
      <i />
      <button className={'txt' + (erase ? ' on' : '')} onClick={() => setErase(v => !v)}>Eraser</button>
      <button className="txt" disabled={!count} onClick={undo}>Undo</button>
      <button className={'txt' + (sureClear ? ' warn' : '')} disabled={!count} onClick={clear}>{sureClear ? 'Tap to clear page' : 'Clear'}</button>
    </div>}
  </>;
}
