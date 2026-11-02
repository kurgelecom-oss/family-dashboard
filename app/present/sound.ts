/* Every sound on /present is synthesised with Web Audio: no files to load, and the
   first Spin press is the user gesture browsers need before audio may play. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function setMuted(m: boolean) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; }
export function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, out: master! };
}

function noise(c: AudioContext, secs: number) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * secs)), c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}
function env(c: AudioContext, g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** The peg hitting the flapper. `speed` 0..1 — slower ticks are deeper and louder. */
export function tick(speed: number) {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  const n = noise(c, 0.03), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = 1800 + speed * 2200; f.Q.value = 6;
  env(c, g, t, 0.5 + (1 - speed) * 0.5, 0.001, 0.035);
  n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 0.05);
  const o = c.createOscillator(), og = c.createGain(); o.frequency.value = 520 + speed * 500;
  env(c, og, t, 0.12, 0.001, 0.02); o.connect(og).connect(out); o.start(t); o.stop(t + 0.04);
}

export function whoosh() {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  const n = noise(c, 1.2), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.5); f.frequency.exponentialRampToValueAtTime(600, t + 1.1);
  env(c, g, t, 0.35, 0.15, 0.95); n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + 1.2);
}

/** Rising drum-roll under the last stretch of the spin. */
export function roll(secs: number) {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  const n = noise(c, secs), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
  f.type = 'lowpass'; f.frequency.value = 900; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + secs * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
  lfo.frequency.setValueAtTime(14, t); lfo.frequency.linearRampToValueAtTime(26, t + secs); lg.gain.value = 0.08; lfo.connect(lg).connect(g.gain);
  n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + secs); lfo.start(t); lfo.stop(t + secs);
}

function note(c: AudioContext, out: AudioNode, freq: number, t: number, len: number, type: OscillatorType, peak: number) {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
  env(c, g, t, peak, 0.01, len); o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
}

/** Bright brass-ish fanfare for a normal topic. */
export function fanfare() {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { note(c, out, f, t + i * 0.11, 0.35, 'sawtooth', 0.09); note(c, out, f, t + i * 0.11, 0.4, 'triangle', 0.14); });
  [1046.5, 1318.5, 1568].forEach(f => { note(c, out, f, t + 0.5, 1.4, 'triangle', 0.09); note(c, out, f / 2, t + 0.5, 1.4, 'sawtooth', 0.05); });
  for (let i = 0; i < 14; i++) note(c, out, 2000 + Math.random() * 3000, t + 0.55 + i * 0.06, 0.25, 'sine', 0.03);
}

/** Shock: sub boom, dissonant stab, electric crackle. */
export function shock() {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(32, t + 1.1);
  env(c, g, t, 0.9, 0.005, 1.3); o.connect(g).connect(out); o.start(t); o.stop(t + 1.4);
  [233.08, 246.94, 369.99, 493.88].forEach(f => note(c, out, f, t + 0.02, 0.9, 'sawtooth', 0.07));
  for (let i = 0; i < 9; i++) { const n = noise(c, 0.04), hg = c.createGain(), hf = c.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3000; env(c, hg, t + 0.15 + Math.random() * 0.8, 0.4, 0.001, 0.03); n.connect(hf).connect(hg).connect(out); n.start(t + 0.1 + i * 0.09); }
}

/** Wild card: lights-out gong. */
export function gong() {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  [[82, 0.5], [164.8, 0.25], [221, 0.18], [302, 0.12], [391, 0.08], [557, 0.05]].forEach(([f, p]) => note(c, out, f, t, 4.5, 'sine', p));
  const n = noise(c, 0.3), g = c.createGain(), fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1200; env(c, g, t, 0.3, 0.002, 0.3); n.connect(fl).connect(g).connect(out); n.start(t);
}

/** Soft chime when switching person. */
export function chime() {
  if (muted) return; const { ctx: c, out } = audio(), t = c.currentTime;
  note(c, out, 880, t, 0.5, 'sine', 0.06); note(c, out, 1318.5, t + 0.06, 0.6, 'sine', 0.04);
}
