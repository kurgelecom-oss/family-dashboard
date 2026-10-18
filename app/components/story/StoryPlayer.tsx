"use client";
// Story player (from the data-story skill): plays Scene[] as a 16:9 animated explainer.
// Caption + timing edits stay in this browser (localStorage); nothing is written back to the dashboard.
// Limit: no video export. Present full screen and screen-record (Cmd+Shift+5 on Mac, Win+Alt+R on Windows).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type BaseScene = { id: string; label: string; hold: number; caption: string };
export const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
/** Stagger item i of a list: each starts a little after the last. */
export const stagger = (p: number, i: number, step = 0.1, speed = 1.6) => ease(p * speed - i * step);

const BUILD_MS = 1400; // every scene builds in over 1.4 s, then holds still for the rest of `hold`
type Edits = { cap: Record<string, string>; hold: Record<string, number> };

export function StoryPlayer<S extends BaseScene>({ scenes: raw, render, storageKey, timingKey, brand, onEnd }: {
  scenes: S[];
  render: (s: S, p: number) => ReactNode; // p runs 0 → 1 during the build-in; 1 when reduced motion is on
  storageKey: string; // caption + single-scene edits
  timingKey?: string; // "All scenes" seconds; may outlive storageKey (e.g. kept across weeks)
  brand?: ReactNode;
  onEnd?: () => void; // fires once when the last scene is reached
}) {
  const [edits, setEdits] = useState<Edits>({ cap: {}, hold: {} });
  const [all, setAllState] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { setEdits({ cap: {}, hold: {}, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }); } catch { setEdits({ cap: {}, hold: {} }); }
    try { const a = Number(localStorage.getItem(timingKey ?? storageKey + ":all")); setAllState(a >= 2 && a <= 20 ? a : null); } catch {}
    setStill(matchMedia("(prefers-reduced-motion: reduce)").matches);
    setT(0); setPlaying(false); // a new storageKey (a new week) starts the story from the top
  }, [storageKey, timingKey]);
  const save = (e: Edits) => { setEdits(e); try { localStorage.setItem(storageKey, JSON.stringify(e)); } catch {} };

  // Every scene's seconds at once; clears single-scene timings. null = each scene's own default.
  const setAll = (v: number | null) => {
    const n = v === null ? null : Math.max(2, Math.min(20, v));
    setAllState(n); save({ ...edits, hold: {} });
    try { const k = timingKey ?? storageKey + ":all"; if (n === null) localStorage.removeItem(k); else localStorage.setItem(k, String(n)); } catch {}
  };
  const scenes = useMemo(() => raw.map((s) => ({ ...s, hold: edits.hold[s.id] ?? all ?? s.hold, caption: edits.cap[s.id] ?? s.caption, auto: s.caption })), [raw, edits, all]);
  const starts = scenes.reduce<number[]>((a, _, i) => (a.push(i ? a[i - 1] + scenes[i - 1].hold * 1000 : 0), a), []);
  const total = scenes.length ? starts[starts.length - 1] + scenes[scenes.length - 1].hold * 1000 : 0;
  let idx = 0; starts.forEach((s, i) => { if (s <= t) idx = i; });
  const sc = scenes[idx];
  const built = still || (!playing && t === 0); // the poster frame before Play is the finished first scene
  const p = built ? 1 : sc ? ease((t - starts[idx]) / BUILD_MS) : 0;

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => { setT((x) => { const n = x + (now - last); if (n >= total) { setPlaying(false); return total - 1; } return n; }); last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // Stepping lands on the built scene: at its first frame (p = 0) a paused stage would be blank.
  const go = (i: number) => { const j = Math.max(0, Math.min(scenes.length - 1, i)); setT(Math.min((starts[j] ?? 0) + BUILD_MS, (starts[j] ?? 0) + scenes[j].hold * 1000 - 1)); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setPlaying((x) => !x); }
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
    };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  });
  const ended = useRef(false);
  useEffect(() => { if (scenes.length && idx === scenes.length - 1 && (playing || t > 0) && !ended.current) { ended.current = true; onEnd?.(); } }, [idx, scenes.length, playing, t, onEnd]);
  const present = () => { const el = stage.current; if (!el) return; document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.(); };
  const setHold = (v: number) => save({ ...edits, hold: { ...edits.hold, [sc.id]: Math.max(2, Math.min(20, v)) } });

  if (!sc) return <div className="sty-empty"><b>No data yet.</b> The story builds itself once the dashboard has numbers.</div>;
  return (
    <section className="sty-wrap">
      <div className="sty-stage" ref={stage} onClick={() => setPlaying((x) => !x)}>
        <div className="sty-head"><span className="sty-brand">{brand}</span><span className="sty-k">{sc.label} · {idx + 1}/{scenes.length}</span></div>
        <div className="sty-body" key={sc.id}>{render(sc, p)}</div>
        <p className="sty-cap" contentEditable={!playing} suppressContentEditableWarning spellCheck={false}
          onClick={(e) => !playing && e.stopPropagation()}
          onBlur={(e) => { const v = e.currentTarget.textContent?.trim() || ""; if (v && v !== sc.caption) save({ ...edits, cap: { ...edits.cap, [sc.id]: v } }); }}
          style={{ opacity: built ? 1 : ease((t - starts[idx] - 500) / 700) }}>{sc.caption}</p>
        <div className="sty-prog"><i style={{ width: `${total ? (t / total) * 100 : 0}%` }} /></div>
      </div>

      <div className="sty-ctl">
        <button className="sty-btn" type="button" onClick={() => { if (t >= total - 1) setT(0); setPlaying((x) => !x); }}>{playing ? "Pause" : "Play"}</button>
        <button className="sty-btn ghost" type="button" aria-label="Previous scene" onClick={() => go(idx - 1)}>←</button>
        <button className="sty-btn ghost" type="button" aria-label="Next scene" onClick={() => go(idx + 1)}>→</button>
        <input className="sty-scrub" type="range" min={0} max={Math.max(1, total - 1)} value={t} aria-label="Timeline" onChange={(e) => { setPlaying(false); setT(+e.target.value); }} />
        <span className="sty-hint">{Math.floor(t / 1000)}s / {Math.round(total / 1000)}s</span>
        <button className="sty-btn ghost" type="button" onClick={present}>Present</button>
      </div>
      <div className="sty-ticks" role="group" aria-label="Scenes">{scenes.map((s, i) => (
        <button key={s.id} type="button" aria-pressed={i === idx} onClick={() => { setPlaying(false); go(i); }}>{s.label}<small>{s.hold}s</small></button>))}</div>
      <div className="sty-ctl">
        <span className="sty-hint"><b>Steer it.</b> Pause and click the caption to rewrite it. This scene</span>
        <button className="sty-btn ghost sm" type="button" aria-label="Shorter" onClick={() => setHold(sc.hold - 1)}>−</button><b>{sc.hold}s</b>
        <button className="sty-btn ghost sm" type="button" aria-label="Longer" onClick={() => setHold(sc.hold + 1)}>+</button>
        {(edits.cap[sc.id] || edits.hold[sc.id]) && <button className="sty-btn ghost sm" type="button" onClick={() => { const c = { ...edits.cap }, h = { ...edits.hold }; delete c[sc.id]; delete h[sc.id]; save({ cap: c, hold: h }); }}>Reset this scene</button>}
        {edits.cap[sc.id] && <span className="sty-hint">Live wording: “{sc.auto}”</span>}
        <span className="sty-hint sty-sep"><b>All scenes</b></span>
        <button className="sty-btn ghost sm" type="button" aria-label="All scenes shorter" onClick={() => setAll((all ?? Math.round(total / 1000 / scenes.length)) - 1)}>−</button><b>{all !== null ? `${all}s each` : "own timing"}</b>
        <button className="sty-btn ghost sm" type="button" aria-label="All scenes longer" onClick={() => setAll((all ?? Math.round(total / 1000 / scenes.length)) + 1)}>+</button>
        {all !== null && <button className="sty-btn ghost sm" type="button" onClick={() => setAll(null)}>Reset all timing</button>}
        <span className="sty-hint">{Math.round(total / 1000)}s in total</span>
      </div>
    </section>
  );
}

/** A row of big figures; null shows an em dash, never a zero. */
export function Stats({ stats, p }: { stats: { label: string; v: number | null; unit?: "AUD" | "%"; prev?: number | null }[]; p: number }) {
  const f = (v: number, u?: string) => u === "AUD" ? "$" + Math.round(v).toLocaleString("en-AU") : Math.round(v) + (u === "%" ? "%" : "");
  return <div className="sty-stats" style={{ gridTemplateColumns: `repeat(${stats.length},minmax(0,1fr))` }}>{stats.map((x, i) => { const e = stagger(p, i, 0.12); return (
    <div key={x.label} className="sty-stat" style={{ opacity: e }}><b>{x.v === null ? "—" : f(x.v * e, x.unit)}</b><small>{x.label}</small>{x.prev !== undefined && <small className="sty-prev">Last week {x.prev === null ? "—" : f(x.prev, x.unit)}</small>}</div>); })}</div>;
}

// ---- Visual primitives. Every one takes p (0 → 1) and draws its final state at p = 1. ----

export function Big({ v, l, red }: { v: number; l: string; red?: boolean }) {
  return <div className="sty-big"><b className={red ? "r" : ""}>{v}</b><span>{l}</span></div>;
}

/** One dot per unit (grouped above `limit`); the first `on` fill blue, the rest show as red outlines. on = 0 → dots just appear. */
export function Dots({ total, on, p, limit = 160 }: { total: number; on: number; p: number; limit?: number }) {
  const per = Math.max(1, Math.ceil(total / limit)), n = Math.ceil(total / per), b = Math.round(on / per);
  return (
    <div className="sty-dots" aria-label={`${total}${per > 1 ? `, one dot per ${per}` : ""}`}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={on ? (i < b * p ? "on" : "gap") : ""} style={{ opacity: on ? 1 : i < n * p ? 1 : 0 }} />)}
      {per > 1 && <small>one dot = {per}</small>}
    </div>);
}

export type Bar = { label: string; sub?: string; v: number; hot?: boolean };
export function Bars({ bars, p }: { bars: Bar[]; p: number }) {
  const max = Math.max(1, ...bars.map((b) => b.v));
  return (
    <div className="sty-bars">{bars.map((b, i) => { const e = stagger(p, i, 0.08); return (
      <div key={b.label} className={`sty-bar${b.hot ? " hot" : ""}`}><span className="lb">{b.label}{b.sub && <small>{b.sub}</small>}</span>
        <span className="tr"><i style={{ width: `${(b.v / max) * 100 * e}%` }} /></span><b>{Math.round(b.v * e)}</b></div>); })}</div>);
}

/** Funnel/pipeline columns, plus an optional red-outlined target column at the end. */
export function Columns({ steps, goal, p }: { steps: { label: string; v: number }[]; goal?: { label: string; v: number }; p: number }) {
  const max = Math.max(1, goal?.v ?? 0, ...steps.map((x) => x.v));
  return (
    <div className="sty-cols">{steps.map((x, i) => { const e = stagger(p, i, 0.12); return (
      <div key={x.label} className="sty-step"><b>{Math.round(x.v * e)}</b><span className="sty-col"><i style={{ height: `${(x.v / max) * 100 * e}%` }} /></span><small>{x.label}</small></div>); })}
      {goal && <div className="sty-step sty-goal"><b>{goal.v}</b><span className="sty-col"><i style={{ height: `${(goal.v / max) * 100 * p}%` }} /></span><small>{goal.label}</small></div>}
    </div>);
}

export function Ring({ part, of, p }: { part: number; of: number; p: number }) {
  const f = of ? part / of : 0;
  return <div className="sty-ring" style={{ background: `conic-gradient(var(--sty-bad) ${f * p * 360}deg, var(--sty-rule) 0)` }}><span>{Math.round(part * p)}<small>of {of}</small></span></div>;
}

/** Closing scene: one card per person/role with their count and top job. */
export function Cards({ cards, p }: { cards: { id: string; label: string; v: number; note?: string | null; good?: boolean }[]; p: number }) {
  return (
    <div className="sty-cards" style={{ gridTemplateColumns: `repeat(${Math.min(5, cards.length) || 1},minmax(0,1fr))` }}>{cards.map((c, i) => { const e = stagger(p, i, 0.15, 1.8); return (
      <div key={c.id} className="sty-card" style={{ opacity: e, transform: `translateY(${(1 - e) * 12}px)` }}>
        <small>{c.label}</small><b className={c.good ? "g" : "r"}>{c.v}</b>{c.note && <em>{c.note}</em>}</div>); })}</div>);
}
