/* A soft three-note chime for prayer pop-ups, synthesised with Web Audio:
   no sound file to host. Browsers only allow audio after someone has tapped the
   page, so the board's "Sound" switch (and any tap after a reload) unlocks it. */
let ctx: AudioContext | null = null;

export function unlockSound() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx.state !== 'closed';
}

export function soundReady() { return !!ctx && ctx.state === 'running'; }

export function chime() {
  if (!ctx || ctx.state !== 'running') return false;
  const t0 = ctx.currentTime;
  // E5, G5, C6 — a gentle rising bell, each note fading over ~2 s.
  [659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const t = t0 + i * 0.42;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g).connect(ctx!.destination);
    o.start(t); o.stop(t + 2.3);
  });
  return true;
}
