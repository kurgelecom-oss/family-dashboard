'use client';
import './goals.css';

import { useEffect, useState } from 'react';
import { SNAPSHOT, goalLine, type GoalLine } from '../lib/goals';
export const GOAL_DESIGNS = ['Poster', 'Scoreboard', 'Climb'] as const;

/* The designs were drawn for three goals: they show the top three of the master list (rank order);
   the full list lives on the goal bar. A goal's value is a %, a count, a trend or "hit" — never dollars. */
const pctOf = (g: GoalLine) => (g.val === 'hit' ? 100 : g.val && /^\d+%$/.test(g.val) ? parseInt(g.val) : null);

function Poster({ goals }: { goals: GoalLine[] }) {
  return <div className="gs gs-poster">
    <section className="gs-l">
      <div><div className="gs-eye">Kurgel family — What holds us back</div><h1>The challenge<br />of <em>the home.</em></h1></div>
      <ul>{SNAPSHOT.challenges.map((c, i) => <li key={c}><span>0{i + 1}</span><b>{c}</b></li>)}</ul>
      <div className="gs-foot">Name it. Then beat it.</div>
    </section>
    <section className="gs-r">
      <div><div className="gs-eye">Where we&apos;re going — top 3 of our goals</div><h2>Our goals.</h2></div>
      <div className="gs-cards">{goals.map((g, i) => { const p = pctOf(g); return <div className="gs-card" key={i}>
        <div className="gs-num">{i + 1}</div><div className="gs-amt">{g.short} <small>{g.label}</small></div>
        {g.val && <><div className="gs-bar"><i style={{ width: (p ?? 0) + '%' }} /></div><div className="gs-meta"><span /><span>{g.val}</span></div></>}
      </div>; })}</div>
      <div className="gs-foot">One step at a time — 1, then 2, then 3.</div>
    </section>
  </div>;
}

function Scoreboard({ goals }: { goals: GoalLine[] }) {
  return <div className="gs gs-score">
    <div className="gs-top"><h1>KURGEL FAMILY · SCOREBOARD</h1><span>Snapshot · {SNAPSHOT.asOf}</span></div>
    <section className="gs-panel gs-l">
      <div className="gs-h">The opponent</div><h2>The challenge<br />of the home</h2>
      <div className="gs-enemy">{SNAPSHOT.challenges.map(c => <div key={c}>{c}</div>)}</div>
    </section>
    <section className="gs-panel gs-r">
      <div className="gs-h">The score we&apos;re chasing</div>
      <div className="gs-goals">{goals.map((g, i) => { const p = pctOf(g); return <div className="gs-g" key={i}>
        <div className="gs-ring" style={{ '--p': p ?? 0 } as React.CSSProperties}><span>{g.val ?? i + 1}</span></div>
        <div><div className="gs-lbl">Goal {i + 1}</div><div className="gs-amt">{g.short}<small>{g.label}</small></div></div>
      </div>; })}</div>
    </section>
  </div>;
}

function Climb({ goals }: { goals: GoalLine[] }) {
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
      <div className="gs-stairs">{goals.map((g, i) => <div className="gs-step" key={i}>
        <span className="gs-flag">{i === 2 ? '🏁' : '🚩'}</span><div className="gs-n">Goal {i + 1}</div><div className="gs-amt">{g.short}</div><div className="gs-sl">{g.label}</div>
        {g.val && <div className="gs-now">{g.val}</div>}
      </div>)}</div>
      <div className="gs-ground" />
      <div className="gs-foot"><span>Climb the stairs, left to right.</span></div>
    </section>
  </div>;
}

export default function GoalsSnapshot({ design }: { design: number }) {
  const [goals, setGoals] = useState<GoalLine[]>([]);
  useEffect(() => { fetch('/api/goals', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => b && setGoals(b.goals.slice(0, 3).map(goalLine))).catch(() => {}); }, []);
  return [<Poster key="a" goals={goals} />, <Scoreboard key="b" goals={goals} />, <Climb key="c" goals={goals} />][design % GOAL_DESIGNS.length];
}
