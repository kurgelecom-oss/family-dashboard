"use client";
import { useState, useEffect, useCallback } from "react";

const CATEGORIES = [
  { id: "housing",   label: "Housing",    sub: "Rent + Water",              target: 675.46 },
  { id: "food",      label: "Food",        sub: "Groceries + Eating",        target: 277.15 },
  { id: "transport", label: "Transport",   sub: "Fuel + Insurance + Rego",   target: 194.49 },
  { id: "utilities", label: "Utilities",   sub: "Electricity + Gas + Phone", target: 118.62 },
  { id: "software",  label: "Software",    sub: "Subscriptions",             target: 105.68 },
  { id: "ecommerce", label: "Ecommerce",   sub: "2 stores",                  target: 53.30  },
  { id: "annual",    label: "Annual Subs", sub: "Amortised",                 target: 42.76  },
];

const WEEKLY_TOTAL_TARGET = 1509.11;

interface SummaryData {
  week_start: string;
  categories: Record<string, number>;
  prevWeek: Record<string, number>;
  income: number;
  weekly_balance: number | null;
  last_updated: string | null;
}

function formatWeekLabel(isoDate: string): string {
  const mon = new Date(isoDate + "T00:00:00");
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  if (mon.getMonth() === sun.getMonth()) {
    return `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`;
  }
  return (
    `${mon.getDate()} ${mon.toLocaleDateString("en-AU", { month: "short" })} – ` +
    `${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`
  );
}

function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function PanelBudget() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/budget/summary");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const cats = data?.categories ?? {};
  const prev = data?.prevWeek ?? {};

  const totalSpent = CATEGORIES.reduce((a, c) => a + (cats[c.id] ?? 0), 0);
  const remaining = WEEKLY_TOTAL_TARGET - totalSpent;
  const overBudget = CATEGORIES.some((c) => (cats[c.id] ?? 0) > c.target);

  return (
    <div className="panel col-4">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="panel-title">Home Budget · Weekly</div>
          <div className="panel-subtitle">
            {mounted && data ? `Week of ${formatWeekLabel(data.week_start)}` : "—"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {overBudget && <span className="badge badge-amber">⚠ Over budget</span>}
          <a
            href="/budget"
            style={{
              fontSize: 10, color: "#f59e0b", textDecoration: "none",
              fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              background: "rgba(245,158,11,0.1)", padding: "3px 8px", borderRadius: 4,
              border: "1px solid rgba(245,158,11,0.2)",
            }}
          >
            Enter spend →
          </a>
        </div>
      </div>

      {/* Spent / Remaining */}
      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto" }}>
        <div className="stat-cell">
          <div className="stat-num lg">${totalSpent.toFixed(0)}</div>
          <div className="stat-sublabel">Spent this week</div>
        </div>
        <div className={`stat-cell ${remaining < 0 ? "alert-red" : "alert-green"}`}>
          <div className={`stat-num lg ${remaining < 0 ? "red" : "green"}`}>
            {`${remaining < 0 ? "-" : ""}$${Math.abs(remaining).toFixed(0)}`}
          </div>
          <div className="stat-sublabel">{remaining < 0 ? "Over budget" : "Remaining"}</div>
        </div>
      </div>

      {/* Income + ING balance — only shown when data has been uploaded */}
      {!loading && ((data?.income ?? 0) > 0 || data?.weekly_balance != null) && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          {(data?.income ?? 0) > 0 && (
            <span>
              <span style={{ color: "var(--green)", fontWeight: 700 }}>${data!.income.toFixed(0)}</span>
              {" "}income · Shopify separate
            </span>
          )}
          {data?.weekly_balance != null && (
            <span>
              ING{" "}
              <span style={{ color: "var(--cyan)", fontWeight: 700 }}>${data!.weekly_balance.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </span>
          )}
        </div>
      )}

      <div className="divider" />

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Overall progress bar */}
        <div style={{ marginBottom: 10 }}>
          <div className="progress-row">
            <span className="num-label">Total vs ${WEEKLY_TOTAL_TARGET.toFixed(2)}</span>
            <span className="num-label">
              {Math.min(Math.round((totalSpent / WEEKLY_TOTAL_TARGET) * 100), 100)}%
            </span>
          </div>
          <div className="progress-track" style={{ height: 10 }}>
            <div
              className="progress-fill"
              style={{
                width: `${Math.min((totalSpent / WEEKLY_TOTAL_TARGET) * 100, 100)}%`,
                background: totalSpent > WEEKLY_TOTAL_TARGET ? "var(--red)" : "var(--cyan)",
              }}
            />
          </div>
        </div>

        {/* Per-category rows */}
        {CATEGORIES.map((cat) => {
          const spent = cats[cat.id] ?? 0;
          const lastWeek = prev[cat.id] ?? 0;
          const pct = Math.min((spent / cat.target) * 100, 100);
          const over = spent > cat.target;
          const color = over
            ? "var(--red)"
            : spent / cat.target >= 0.8
            ? "var(--amber)"
            : "var(--green)";

          const diff = spent - lastWeek;
          const hasArrow = lastWeek > 0 && Math.abs(diff) > 0.5;

          return (
            <div key={cat.id} style={{ marginBottom: 8 }}>
              <div className="progress-row">
                <span className="list-name">
                  {cat.label}
                  <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                    {cat.sub}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  {hasArrow && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: diff > 0 ? "#e74c3c" : "#2ecc71" }}>
                      {diff > 0 ? "↑" : "↓"}
                    </span>
                  )}
                  <span className="list-val" style={{ color, fontSize: 12 }}>
                    ${spent.toFixed(0)}
                    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                      {" "}/ ${cat.target.toFixed(0)}
                    </span>
                  </span>
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Last updated footer */}
      {mounted && data?.last_updated && (
        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 6, textAlign: "right" }}>
          Last updated: {formatLastUpdated(data.last_updated)}
        </div>
      )}
    </div>
  );
}
