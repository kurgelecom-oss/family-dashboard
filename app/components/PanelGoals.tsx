"use client";

const goals = [
  {
    label: "Financial / Savings Target",
    target: "$50,000",
    current: "$31,200",
    deadline: "31 Dec 2026",
    daysLeft: 200,
    totalDays: 365,
    pct: 62,
    color: "var(--cyan)",
    badge: "badge-cyan",
    badgeText: "On track",
  },
  {
    label: "Ecom Revenue Goal",
    target: "$180,000",
    current: "$68,200",
    deadline: "31 Dec 2026",
    daysLeft: 200,
    totalDays: 365,
    pct: 38,
    color: "var(--green)",
    badge: "badge-amber",
    badgeText: "Needs pace",
  },
  {
    label: "Kids Education Fund",
    target: "$20,000",
    current: "$8,400",
    deadline: "30 Jun 2027",
    daysLeft: 381,
    totalDays: 730,
    pct: 42,
    color: "var(--amber)",
    badge: "badge-green",
    badgeText: "Ahead",
  },
];

export default function PanelGoals() {
  return (
    <div className="panel col-7">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="panel-title">Family Goals · Countdowns</div>
        <span className="badge badge-cyan">3 Active goals</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, flex: 1, minHeight: 0 }}>
        {goals.map((g) => (
          <div className="stat-cell" key={g.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="num-label">{g.label}</span>
              <span className={`badge ${g.badge}`}>{g.badgeText}</span>
            </div>

            <div>
              <div className="stat-num lg" style={{ color: g.color }}>{g.daysLeft}</div>
              <div className="stat-sublabel">Days remaining</div>
            </div>

            <div className="divider" />

            <div>
              <div className="progress-row">
                <span className="num-label">Progress</span>
                <span className="num-label">{g.pct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${g.pct}%`, background: g.color }} />
              </div>
            </div>

            <div style={{ marginTop: "auto" }}>
              <div className="list-item" style={{ padding: "4px 0" }}>
                <span className="list-name">Current</span>
                <span className="list-val" style={{ color: g.color }}>{g.current}</span>
              </div>
              <div className="list-item" style={{ padding: "4px 0" }}>
                <span className="list-name">Target</span>
                <span className="list-val">{g.target}</span>
              </div>
              <div className="list-item" style={{ padding: "4px 0" }}>
                <span className="list-name">Deadline</span>
                <span className="list-val">{g.deadline}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
