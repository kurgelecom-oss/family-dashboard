"use client";

const monthData = [4200, 5800, 3900, 6100, 7200, 5500, 8400, 6900, 7800, 9200, 8100, 11400];
const months = ["J","F","M","A","M","J","J","A","S","O","N","D"];

export default function PanelEcom() {
  const monthTarget = 15000;
  const monthActual = 11400;
  const pct = Math.round((monthActual / monthTarget) * 100);

  return (
    <div className="panel col-4">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="panel-title">Nihal · Ecom Business</div>
          <div className="panel-subtitle">Revenue tracker · June 2026</div>
        </div>
        <span className="badge badge-cyan">↑ 24% vs last month</span>
      </div>

      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto" }}>
        <div className="stat-cell">
          <div className="stat-num lg cyan">$847</div>
          <div className="stat-sublabel">Revenue today</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num lg">12</div>
          <div className="stat-sublabel">Orders today</div>
        </div>
      </div>

      <div className="divider" />

      <div style={{ flex: 1 }}>
        {[
          { label: "This month", val: "$11,400", color: "#fff" },
          { label: "Monthly target", val: "$15,000", color: "var(--text-secondary)" },
          { label: "Yearly target", val: "$180,000", color: "var(--text-secondary)" },
          { label: "Yearly to date", val: "$68,200", color: "var(--green)" },
        ].map((row) => (
          <div className="list-item" key={row.label}>
            <span className="list-name">{row.label}</span>
            <span className="list-val" style={{ color: row.color }}>{row.val}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="progress-row">
          <span className="num-label">Monthly progress</span>
          <span className="num-label">{pct}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%`, background: "var(--cyan)" }} />
        </div>
      </div>
    </div>
  );
}
