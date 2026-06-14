"use client";

const categories = [
  { label: "Rent / Mortgage", spent: 2800, budget: 2800, color: "var(--text-secondary)" },
  { label: "Groceries", spent: 420, budget: 500, color: "var(--green)" },
  { label: "Kids", spent: 380, budget: 300, color: "var(--red)" },
  { label: "Subscriptions", spent: 95, budget: 120, color: "var(--green)" },
  { label: "Dining Out", spent: 210, budget: 200, color: "var(--amber)" },
  { label: "Ecom Costs", spent: 340, budget: 400, color: "var(--green)" },
  { label: "Home & Utilities", spent: 480, budget: 500, color: "var(--green)" },
];

export default function PanelBudget() {
  const totalSpent = categories.reduce((a, c) => a + c.spent, 0);
  const totalBudget = categories.reduce((a, c) => a + c.budget, 0);
  const remaining = totalBudget - totalSpent;

  return (
    <div className="panel col-4">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="panel-title">Home Budget · Weekly</div>
          <div className="panel-subtitle">Week of 9–14 June 2026</div>
        </div>
        <span className="badge badge-amber">⚠ Kids over budget</span>
      </div>

      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto" }}>
        <div className="stat-cell">
          <div className="stat-num lg">${totalSpent.toLocaleString()}</div>
          <div className="stat-sublabel">Spent this week</div>
        </div>
        <div className="stat-cell alert-green">
          <div className="stat-num lg green">${remaining.toLocaleString()}</div>
          <div className="stat-sublabel">Remaining</div>
        </div>
      </div>

      <div className="divider" />

      <div style={{ flex: 1, overflowY: "auto" }}>
        {categories.map((cat) => {
          const pct = Math.min((cat.spent / cat.budget) * 100, 100);
          return (
            <div key={cat.label} style={{ marginBottom: 8 }}>
              <div className="progress-row">
                <span className="list-name">{cat.label}</span>
                <span className="list-val" style={{ color: cat.color, fontSize: 12 }}>
                  ${cat.spent} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/ ${cat.budget}</span>
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%`, background: cat.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
