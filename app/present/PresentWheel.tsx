'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './present.css';
import { PEOPLE, STARTER, type Person, type Slice, type Kind } from './topics';
import { tick, whoosh, roll, fanfare, shock, gong, chime, setMuted, audio } from './sound';
import { familyWrite } from '../components/FamilyEditGate';

/* The Present wheel. The server picks the slice (fair, one spin a week, no
   repeats); this component only animates the wheel to land on it. */

type Spin = { topic: string; kind: Kind; spunAt?: string };
type State = { week: string; current: Record<string, Spin>; history: Record<string, { week: string; topic: string; kind: Kind }[]> };

const N = 28, STEP = 360 / N, R = 470, HUB = 118;
const COLORS = ['#1f4a45', '#b8612f', '#d9a441', '#6b4a7a', '#2b5d57', '#c2412d', '#4f6f8f', '#7d8b4e', '#8a5a3b'];
const INKY = new Set(['#d9a441']);

function lines(t: string, max = 23): string[] {
  const out: string[] = []; let cur = '';
  for (const w of t.split(' ')) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out.length > 2 ? [out[0], out.slice(1).join(' ')] : out;
}

const polar = (deg: number, r: number) => [Math.round(Math.sin(deg * Math.PI / 180) * r * 100) / 100, Math.round(-Math.cos(deg * Math.PI / 180) * r * 100) / 100];
function slicePath(i: number) {
  const a0 = i * STEP - STEP / 2, a1 = a0 + STEP, [x0, y0] = polar(a0, R), [x1, y1] = polar(a1, R);
  return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
}
const fill = (s: Slice, i: number) => s.k === 'wild' ? 'url(#pw-wild)' : s.k === 'shock' ? 'url(#pw-shock)' : COLORS[i % COLORS.length];
const ink = (s: Slice, i: number) => s.k === 'wild' ? '#e8c873' : s.k === 'shock' ? '#1d2322' : INKY.has(COLORS[i % COLORS.length]) ? '#1d2322' : '#fbf8f2';

/** Presentation night: the Monday after the spin week (spin Monday night, present the next Monday night). */
function presentNight(week: string) { const d = new Date(week + 'T00:00:00'); d.setDate(d.getDate() + 7); return d; }
const daysTo = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86_400_000);

function Wheel({ person, rot, drawn, flap, lit, spinning }: { person: Person; rot: number; drawn: Set<string>; flap: number; lit: number; spinning: boolean }) {
  return (
    <svg className="pw-svg" viewBox="-540 -560 1080 1100" aria-hidden>
      <defs>
        <radialGradient id="pw-wild" cx="0" cy="0" r={R} gradientUnits="userSpaceOnUse">
          <stop offset="0.2" stopColor="#2a2a2a" /><stop offset="1" stopColor="#050505" />
        </radialGradient>
        <pattern id="pw-shock" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="34" height="34" fill="#ffd23f" /><rect width="12" height="34" fill="#ffbf00" />
        </pattern>
        <radialGradient id="pw-hub" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#f6e2b0" /><stop offset="0.45" stopColor="#d9a441" /><stop offset="1" stopColor="#8a5a1f" />
        </radialGradient>
        <radialGradient id="pw-gloss" cx="0" cy="-200" r="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id="pw-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" floodColor="#1d2322" floodOpacity=".35" /></filter>
      </defs>
      {/* Rim */}
      <circle r={R + 52} fill="#1d2322" filter="url(#pw-shadow)" />
      <circle r={R + 40} fill="#2b5d57" />
      <circle r={R + 6} fill="#1d2322" />
      {Array.from({ length: N * 2 }, (_, i) => {
        const [x, y] = polar(i * STEP / 2, R + 23), on = spinning ? (i + lit) % 3 === 0 : (i + lit) % 6 < 3;
        return <circle key={i} cx={x} cy={y} r="9" className={'pw-bulb' + (on ? ' on' : '')} />;
      })}
      {/* Spinning face */}
      <g style={{ transform: `rotate(${rot}deg)` }}>
        {person.slices.map((s, i) => (
          <g key={person.id + i} className={drawn.has(s.t) && s.k !== 'wild' ? 'pw-done' : ''}>
            <path d={slicePath(i)} fill={fill(s, i)} stroke="#fbf8f2" strokeWidth="3" />
            <g transform={`rotate(${i * STEP})`}>
              <text x="0" y={-R + 52} textAnchor="middle" fontSize="38" className="pw-emoji">{s.e}</text>
              <text transform={`translate(0 ${-R + 84}) rotate(90)`} fill={ink(s, i)} className={'pw-label k-' + s.k} style={s.k === 'wild' ? undefined : { fontSize: Math.min(19, Math.floor(560 / Math.max(...lines(s.t).map(l => l.length)))) }}>
                {(s.k === 'wild' ? ['WILD', 'CARD'] : lines(s.t)).map((l, j, a) => (
                  <tspan key={j} x="0" dy={j === 0 ? `${-(a.length - 1) * 0.55}em` : '1.1em'}>{l}</tspan>
                ))}
              </text>
              {drawn.has(s.t) && s.k !== 'wild' && <text x="0" y={-R + 250} textAnchor="middle" className="pw-stamp" transform={`rotate(90 0 ${-R + 250})`}>DONE</text>}
            </g>
          </g>
        ))}
        <circle r={R} fill="url(#pw-gloss)" pointerEvents="none" />
        {person.slices.map((_, i) => { const [x, y] = polar(i * STEP - STEP / 2, R - 8); return <circle key={'p' + i} cx={x} cy={y} r="7" className="pw-peg" />; })}
      </g>
      <circle r={HUB + 14} fill="#1d2322" />
      <circle r={HUB} fill="url(#pw-hub)" />
      {/* Flapper */}
      <g style={{ transform: `translateY(${-R - 50}px) rotate(${flap}deg)` }} className="pw-flap">
        <path d="M-30 -14 L30 -14 L0 72 Z" fill="#b8612f" stroke="#1d2322" strokeWidth="6" strokeLinejoin="round" />
        <circle r="13" cy="-4" fill="#f6e2b0" stroke="#1d2322" strokeWidth="5" />
      </g>
    </svg>
  );
}

type Burst = { kind: Kind; key: number };

function Particles({ burst }: { burst: Burst | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!burst || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = ref.current!, g = c.getContext('2d')!, dpr = Math.min(2, devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; g.scale(dpr, dpr);
    const palette = burst.kind === 'wild' ? ['#e8c873', '#f6e2b0', '#fff', '#b08a3a'] : burst.kind === 'shock' ? ['#ffd23f', '#fff', '#ffbf00', '#1d2322'] : ['#1f4a45', '#b8612f', '#d9a441', '#6b4a7a', '#c2412d', '#fbf8f2', '#2f8a57'];
    const cx = innerWidth / 2, cy = innerHeight * 0.45, n = burst.kind === 'topic' ? 260 : 180;
    const ps = Array.from({ length: n }, () => {
      const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * (burst.kind === 'shock' ? 16 : 12);
      return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, r: 4 + Math.random() * 7, c: palette[Math.floor(Math.random() * palette.length)], s: Math.random() * 6, w: Math.random() * 0.3 - 0.15, life: 1 };
    });
    let raf = 0;
    const frame = () => {
      g.clearRect(0, 0, innerWidth, innerHeight); let alive = 0;
      for (const p of ps) {
        if (p.life <= 0) continue; alive++;
        p.vy += burst.kind === 'wild' ? 0.08 : 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.s += p.w; p.life -= 0.0055;
        g.save(); g.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4)); g.translate(p.x, p.y); g.rotate(p.s); g.fillStyle = p.c;
        if (burst.kind === 'wild') { g.beginPath(); for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.lineTo(p.r, 0); g.lineTo(p.r * 0.25, p.r * 0.25); } g.fill(); }
        else if (burst.kind === 'shock') { g.beginPath(); g.moveTo(-p.r * .4, -p.r); g.lineTo(p.r * .5, -p.r * .1); g.lineTo(0, 0); g.lineTo(p.r * .4, p.r); g.lineTo(-p.r * .5, p.r * .1); g.lineTo(0, 0); g.closePath(); g.fill(); }
        else g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2 + Math.abs(Math.sin(p.s)) * p.r * 0.6);
        g.restore();
      }
      if (alive) raf = requestAnimationFrame(frame); else g.clearRect(0, 0, innerWidth, innerHeight);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [burst]);
  return <canvas ref={ref} className="pw-particles" aria-hidden />;
}

export default function PresentWheel() {
  const [who, setWho] = useState<Person>(PEOPLE[0]);
  const [data, setData] = useState<State | null>(null);
  const [rot, setRot] = useState(0);
  const [flap, setFlap] = useState(0);
  const [lit, setLit] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<(Spin & { person: Person; fresh: boolean }) | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
  const [fx, setFx] = useState<Kind | null>(null);
  const [error, setError] = useState('');
  const [muted, setMute] = useState(false);
  const rotRef = useRef(0);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/present', { cache: 'no-store' }); if (r.ok) setData(await r.json()); else setError('Could not load this week'); }
    catch { setError('Could not load this week'); }
  }, []);
  // Mount-time reads: the week's spins from the server, the mute choice from this device.
  useEffect(() => { void load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { const m = localStorage.getItem('pw-muted') === '1'; setMute(m); setMuted(m); }, []); // eslint-disable-line react-hooks/set-state-in-effect
  // Marquee bulbs chase; faster while spinning.
  useEffect(() => { const id = setInterval(() => setLit(l => l + 1), spinning ? 70 : 420); return () => clearInterval(id); }, [spinning]);

  const drawn = useMemo(() => new Set((data?.history[who.id] ?? []).map(h => h.topic)), [data, who]);
  const mine = data?.current[who.id];
  const reduce = typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const restAngle = useCallback((p: Person, spin?: Spin) => {
    const i = spin ? p.slices.findIndex(s => s.t === spin.topic) : -1;
    return i >= 0 ? -i * STEP : 0;
  }, []);

  /** Ease the wheel to an angle without the full spin (switching person). */
  const glide = useCallback((target: number, ms = 900) => {
    const from = rotRef.current, to = target + Math.round((from - target) / 360) * 360, t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3), r = from + (to - from) * e;
      rotRef.current = r; setRot(r); if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  // When the data arrives or the person changes, settle on their spin (if any).
  useEffect(() => { if (data && !spinning) glide(restAngle(who, data.current[who.id])); }, [data, who]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(p: Person) {
    if (spinning || p.id === who.id) return;
    chime(); setResult(null); setWho(p);
  }

  async function spin() {
    if (spinning || !data) return;
    if (mine) { setResult({ ...mine, person: who, fresh: false }); return; }
    audio(); setError('');
    let res: { index: number; topic: string; kind: Kind };
    try {
      const r = await fetch('/api/present', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person: who.id }) });
      const b = await r.json();
      if (!r.ok) { setError(b.error ?? 'Spin failed'); void load(); return; }
      res = b;
    } catch { setError('No connection — spin not used'); return; }

    setSpinning(true); whoosh();
    const person = who, start = rotRef.current;
    const jitter = (Math.random() - 0.5) * STEP * 0.7;
    const base = -res.index * STEP + jitter;
    const turns = reduce ? 1 : 7 + Math.floor(Math.random() * 3);
    const target = base + 360 * Math.ceil((start - base) / 360) + 360 * turns;
    const windup = reduce ? 0 : 650, dur = reduce ? 1600 : 8200, t0 = performance.now();
    let lastPeg = Math.floor((start + STEP / 2) / STEP), lastTick = 0, rolled = false;

    const frame = (now: number) => {
      const el = now - t0; let r: number;
      if (el < windup) { const k = el / windup; r = start - 14 * Math.sin(k * Math.PI / 2); }
      else {
        const k = Math.min(1, (el - windup) / dur);
        const e = 1 - Math.pow(1 - k, 4.2);
        r = start - 14 * (1 - Math.min(1, (el - windup) / 250)) + (target - start) * e;
        if (!rolled && k > 0.55) { rolled = true; roll(dur * 0.45 / 1000); }
      }
      rotRef.current = r; setRot(r);
      const peg = Math.floor((r + STEP / 2) / STEP);
      if (peg !== lastPeg) {
        lastPeg = peg;
        if (now - lastTick > 28) { lastTick = now; const k = Math.min(1, (el - windup) / dur); tick(Math.max(0, 1 - k)); setFlap(-22 - (1 - k) * 10); setTimeout(() => setFlap(0), 60); }
      }
      if (el < windup + dur) requestAnimationFrame(frame);
      else land();
    };
    const land = () => {
      setSpinning(false); setFlap(0);
      setFx(res.kind); setBurst({ kind: res.kind, key: Date.now() });
      if (res.kind === 'wild') gong(); else if (res.kind === 'shock') shock(); else fanfare();
      setTimeout(() => setFx(null), res.kind === 'topic' ? 900 : 2200);
      setTimeout(() => setResult({ topic: res.topic, kind: res.kind, person, fresh: true }), res.kind === 'topic' ? 700 : 1500);
      // Email the week plan once the wheel has landed (server sends at most once per spin).
      void fetch('/api/present/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person: person.id }) }).catch(() => {});
      void load();
    };
    requestAnimationFrame(frame);
  }

  async function respin() {
    if (!result) return;
    const r = await familyWrite('/api/present', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person: result.person.id }) });
    if (r.ok) { setResult(null); await load(); } else setError('Respin needs the family PIN');
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setResult(null);
      if ((e.key === ' ' || e.key === 'Enter') && !result && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); void spin(); }
      const n = Number(e.key); if (n >= 1 && n <= PEOPLE.length && !result) pick(PEOPLE[n - 1]);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const toggleMute = () => { const m = !muted; setMute(m); setMuted(m); localStorage.setItem('pw-muted', m ? '1' : '0'); };
  const slice = result ? result.person.slices.find(s => s.t === result.topic) : undefined;
  const due = data ? presentNight(data.week) : null;

  return (
    <main className={'pw' + (fx ? ' fx-' + fx : '') + (spinning ? ' is-spinning' : '')} style={{ ['--who' as string]: who.hue }}>
      <aside className="pw-side">
        <div className="pw-title"><span>🎤</span><div><h1>Present</h1><p>One spin. One week. One presentation.</p></div></div>
        <div className="pw-tabs" role="tablist" aria-label="Who is spinning">
          {PEOPLE.map((p, i) => {
            const c = data?.current[p.id];
            return (
              <button key={p.id} role="tab" aria-selected={p.id === who.id} className={'pw-tab' + (p.id === who.id ? ' on' : '')} style={{ ['--hue' as string]: p.hue }} onClick={() => pick(p)} disabled={spinning}>
                <span className="pw-av">{p.name[0]}</span>
                <span className="pw-tab-txt"><b>{p.name}</b><small>{c ? (c.kind === 'wild' ? '🃏 Wild card' : c.topic) : 'Ready to spin'}</small></span>
                <kbd>{i + 1}</kbd>
              </button>
            );
          })}
        </div>
        {(data?.history[who.id]?.length ?? 0) > 0 && (
          <div className="pw-hist"><h2>{who.name}&rsquo;s past topics</h2>
            <ul>{data!.history[who.id].map(h => <li key={h.week}><span>{h.week.slice(5).split('-').reverse().join('/')}</span>{h.kind === 'wild' ? '🃏 Wild card' : h.topic}</li>)}</ul>
          </div>
        )}
      </aside>

      <section className="pw-stage">
        <div className="pw-spot" aria-hidden />
        <div className="pw-wheel" key={who.id}>
          <Wheel person={who} rot={rot} drawn={drawn} flap={flap} lit={lit} spinning={spinning} />
          <button className={'pw-hub' + (mine ? ' spun' : '')} onClick={spin} disabled={spinning || !data} aria-label={mine ? `See ${who.name}'s topic` : `Spin for ${who.name}`}>
            <span>{!data ? '…' : spinning ? '' : mine ? 'SEE' : 'SPIN'}</span>
            <small>{!data ? '' : spinning ? '' : mine ? 'this week' : who.name}</small>
          </button>
        </div>
        <p className="pw-live" aria-live="polite">{error || (spinning ? `Spinning for ${who.name}…` : '')}</p>
      </section>

      <aside className="pw-rules">
        <h2>How it works</h2>
        <ul>
          <li><i style={{ background: 'var(--who)' }} /><span>One spin each, every week. The wheel decides.</span></li>
          <li><i className="sw-shock" /><span><b>⚡ Shock:</b> a subject none of us knows. Start from zero.</span></li>
          <li><i className="sw-wild" /><span><b>🃏 Wild card:</b> the other two choose your topic.</span></li>
          <li><i className="sw-done" /><span>A topic you&rsquo;ve had is stamped DONE and never comes back.</span></li>
          <li><i className="sw-day" /><span>Present <b>next Monday night</b>{due && daysTo(due) >= 0 ? <> · {daysTo(due) === 0 ? 'tonight' : `${daysTo(due)} day${daysTo(due) === 1 ? '' : 's'} to go`}</> : null}.</span></li>
        </ul>
        <button className="pw-mute" onClick={toggleMute}>{muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
        <p className="pw-keys">Space to spin · 1 2 3 to switch</p>
      </aside>

      <Particles burst={burst} />
      {fx && fx !== 'topic' && <div className={'pw-banner b-' + fx} aria-hidden>{fx === 'wild' ? <>🃏<span>WILD CARD</span></> : <>⚡<span>SHOCK CHALLENGE</span></>}</div>}

      {result && slice && (
        <div className="pw-modal" role="dialog" aria-modal aria-labelledby="pw-topic" onClick={() => setResult(null)}>
          <article className={'pw-card k-' + result.kind} onClick={e => e.stopPropagation()} style={{ ['--hue' as string]: result.person.hue }}>
            <header>
              <span className="pw-card-who">{result.person.name}&rsquo;s presentation · week of {data && new Date(data.week + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
              {result.kind !== 'topic' && <span className="pw-card-tag">{result.kind === 'wild' ? '🃏 Wild card' : '⚡ Shock challenge'}</span>}
            </header>
            <div className="pw-card-emoji">{slice.e}</div>
            <h2 id="pw-topic">{result.kind === 'wild' ? 'The family chooses your topic' : result.topic}</h2>
            <p className="pw-card-sub">{result.kind === 'wild' ? `${PEOPLE.filter(p => p.id !== result.person.id).map(p => p.name).join(' and ')} pick it tonight. No vetoes.` : result.kind === 'shock' ? 'You know nothing about this yet. That is the point.' : `Present it next Monday night. The plan and Claude prompts are in your email.`}</p>
            <ol className="pw-starter">{STARTER.map(([h, d], i) => <li key={h} style={{ animationDelay: `${0.35 + i * 0.08}s` }}><b>{h}</b><span>{d}</span></li>)}</ol>
            <footer>
              <button className="pw-btn" onClick={() => setResult(null)} autoFocus>Let&rsquo;s go</button>
              <button className="pw-link" onClick={respin}>Respin (needs PIN)</button>
            </footer>
          </article>
        </div>
      )}
    </main>
  );
}
