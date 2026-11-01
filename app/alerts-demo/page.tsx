'use client';
import { useEffect, useRef, useState } from 'react';
import EventAlerts, { previewAlert } from '../components/EventAlerts';
import { SCENES, type AlertMode, type Scene } from '../lib/alerts-model';

/* /alerts-demo — see every calendar pop-up without waiting for a real event.
   Each tile previews one scene as a full Pop-up or a corner Pop-out with a sample
   event; "Play all" runs the reel. Previews never save anything. */

const SAMPLES: { scene: Scene; title: string; cal: string; mins: number }[] = [
  { scene: 'orbit', title: 'Family Alignment', cal: 'ansar', mins: 9 },
  { scene: 'burst', title: 'Ansar Indoor Football', cal: 'nihal', mins: 6 },
  { scene: 'waves', title: 'Swimming lesson', cal: 'taylan', mins: 3 },
  { scene: 'tiles', title: 'Call Adam', cal: 'family', mins: 0 },
  { scene: 'aurora', title: 'Seera | Yasir Qadhi', cal: 'kurgel', mins: 8 },
];

function show(i: number, mode: AlertMode) {
  const s = SAMPLES[i], start = Date.now() + s.mins * 60_000 + 30_000;
  previewAlert({ key: `demo-${s.scene}`, scene: s.scene, title: s.title, cal: s.cal, startISO: new Date(start).toISOString(), endISO: new Date(start + 45 * 60_000).toISOString() }, mode);
}

export default function AlertsDemo() {
  const [playing, setPlaying] = useState(false);
  const step = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const run = () => { const i = step.current++; if (i >= SAMPLES.length * 2) { setPlaying(false); step.current = 0; return; } show(i % SAMPLES.length, i < SAMPLES.length ? 'popup' : 'popout'); };
    run(); const t = setInterval(run, 7000);
    return () => clearInterval(t);
  }, [playing]);
  return (
    <main className="ea-demo">
      <h1>Calendar pop-ups</h1>
      <p>Tap a tile to preview it. Real alerts are switched on per event in the calendar (event → Alert → Pop-out / Pop-up) and fire 10 minutes before, on the dashboard and the calendar.</p>
      <button className="ea-demo-play" onClick={() => { step.current = 0; setPlaying(p => !p); }}>{playing ? '■ Stop the reel' : '▶ Play all (5 pop-ups, then 5 pop-outs)'}</button>
      <div className="ea-demo-grid">
        {SAMPLES.map((s, i) => <section key={s.scene}>
          <h2>{s.scene}</h2><small>{s.title}</small>
          <div><button onClick={() => show(i, 'popup')}>Pop-up</button><button onClick={() => show(i, 'popout')}>Pop-out</button></div>
        </section>)}
      </div>
      <p className="ea-demo-note">{SCENES.length} scenes. Each real event gets one of them, plus its own accent, particles and angle, from its name, so the same event looks the same every week.</p>
      <EventAlerts />
    </main>
  );
}
