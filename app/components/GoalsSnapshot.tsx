'use client';
import './goals.css';

/* FAMILY GOALS SNAPSHOT — a hand-built picture of where the family is, not a
   data feed. Claude edits SNAPSHOT below each time tk asks for a refresh; no
   Notion, no API. `now` values are dollars; null hides the progress line.
   Three designs, cycled by the "Family goals" button in SundayShell. */
const SNAPSHOT = {
  asOf: '1 Oct 2026',
  challenges: ['Accepting average and being comfortable', 'Not feeling urgency', 'Lack of speed in execution'],
  flips: ["We don't settle.", 'Today matters.', 'Decide, then do it now.'],
  goals: [
    { label: 'in the bank', short: '$5k', full: '$5,000', target: 5000, now: null as number | null, nowLabel: 'Now' },
    { label: 'in the bank', short: '$10k', full: '$10,000', target: 10000, now: null as number | null, nowLabel: 'Now' },
    { label: 'weekly income', short: '$3k', full: '$3,000', target: 3000, now: null as number | null, nowLabel: 'Last week' },
  ],
};
export const GOAL_DESIGNS = ['Poster', 'Scoreboard', 'Climb'] as const;

const money = (n: number) => '$' + n.toLocaleString('en-AU');
const pct = (g: (typeof SNAPSHOT.goals)[number]) => (g.now == null ? null : Math.min(100, Math.round((g.now / g.target) * 100)));

function Poster() {
  return <div className="gs gs-poster">
    <section className="gs-l">
      <div><div className="gs-eye">Kurgel family — What holds us back</div><h1>The challenge<br />of <em>the home.</em></h1></div>
      <ul>{SNAPSHOT.challenges.map((c, i) => <li key={c}><span>0{i + 1}</span><b>{c}</b></li>)}</ul>
      <div className="gs-foot">Name it. Then beat it.</div>
    </section>
    <section className="gs-r">
      <div><div className="gs-eye">Where we&apos;re going — snapshot {SNAPSHOT.asOf}</div><h2>Our goals.</h2></div>
      <div className="gs-cards">{SNAPSHOT.goals.map((g, i) => { const p = pct(g); return <div className="gs-card" key={i}>
        <div className="gs-num">{i + 1}</div><div className="gs-amt">{g.short} <small>{g.label}</small></div>
        {p != null && <><div className="gs-bar"><i style={{ width: p + '%' }} /></div><div className="gs-meta"><span>{g.nowLabel} <b>{money(g.now!)}</b></span><span>{p}%</span></div></>}
      </div>; })}</div>
      <div className="gs-foot">One step at a time — 1, then 2, then 3.</div>
    </section>
  </div>;
}

function Scoreboard() {
  return <div className="gs gs-score">
    <div className="gs-top"><h1>KURGEL FAMILY · SCOREBOARD</h1><span>Snapshot · {SNAPSHOT.asOf}</span></div>
    <section className="gs-panel gs-l">
      <div className="gs-h">The opponent</div><h2>The challenge<br />of the home</h2>
      <div className="gs-enemy">{SNAPSHOT.challenges.map(c => <div key={c}>{c}</div>)}</div>
    </section>
    <section className="gs-panel gs-r">
      <div className="gs-h">The score we&apos;re chasing</div>
      <div className="gs-goals">{SNAPSHOT.goals.map((g, i) => { const p = pct(g); return <div className="gs-g" key={i}>
        <div className="gs-ring" style={{ '--p': p ?? 0 } as React.CSSProperties}><span>{p != null ? p + '%' : i + 1}</span></div>
        <div><div className="gs-lbl">Goal {i + 1}</div><div className="gs-amt">{g.full}<small>{g.label === 'weekly income' ? 'every week' : g.label}</small></div>
          {p != null && <div className="gs-now">{g.nowLabel} <b>{money(g.now!)}</b> · {g.now! >= g.target ? 'done' : money(g.target - g.now!) + ' to go'}</div>}</div>
      </div>; })}</div>
    </section>
  </div>;
}

function Climb() {
  const icons = ['⚓', '⏳', '🐢'];
  return <div className="gs gs-climb">
    <section className="gs-l">
      <div className="gs-eye">What we&apos;re leaving behind</div><h1>The challenge of the home</h1>
      <div className="gs-weights">{SNAPSHOT.challenges.map((c, i) => <div className="gs-w" key={c}><div className="gs-ico">{icons[i]}</div><div><b>{c}</b><span>→ {SNAPSHOT.flips[i]}</span></div></div>)}</div>
      <div className="gs-foot"><span>Kurgel family</span><span>Snapshot · {SNAPSHOT.asOf}</span></div>
    </section>
    <div className="gs-div" />
    <section className="gs-r">
      <div className="gs-eye">Where we&apos;re climbing</div><h1>Our goals</h1><p>Three steps. One at a time.</p>
      <div className="gs-stairs">{SNAPSHOT.goals.map((g, i) => { const p = pct(g); return <div className="gs-step" key={i}>
        <span className="gs-flag">{i === 2 ? '🏁' : '🚩'}</span><div className="gs-n">Goal {i + 1}</div><div className="gs-amt">{g.short}</div><div className="gs-sl">{g.label}</div>
        {p != null && <div className="gs-now">{g.nowLabel} {money(g.now!)} · {p}%</div>}
      </div>; })}</div>
      <div className="gs-ground" />
      <div className="gs-foot"><span>Climb the stairs, left to right.</span></div>
    </section>
  </div>;
}

export default function GoalsSnapshot({ design }: { design: number }) {
  return [<Poster key="a" />, <Scoreboard key="b" />, <Climb key="c" />][design % GOAL_DESIGNS.length];
}
