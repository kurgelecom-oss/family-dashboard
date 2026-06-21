"use client";
import { useState, useEffect, useCallback } from "react";

const CATEGORIES = ["Groceries", "Eating Out", "Transport", "Utilities", "Shopping", "Health", "Other"] as const;
type Category = typeof CATEGORIES[number];

interface SummaryRow { category: string; total_amount: number; transaction_count: number }
interface SummaryResponse {
  weekStart: string;
  prevWeekStart: string;
  currentWeek: SummaryRow[];
  previousWeek: SummaryRow[];
  totalIncome: number;
  lastUpdated: string | null;
}

function formatWeekLabel(isoDate: string): string {
  const mon = new Date(isoDate + "T00:00:00");
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  if (mon.getMonth() === sun.getMonth()) {
    return `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`;
  }
  return `${mon.getDate()} ${mon.toLocaleDateString("en-AU", { month: "short" })} – ${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`;
}

function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function PanelBudget() {
  const [data, setData] = useState<SummaryResponse | null>(null);
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
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const toMap = (rows: SummaryRow[]): Record<string, number> => {
    const m: Record<string, number> = {};
    rows.forEach(r => { m[r.category] = r.total_amount; });
    return m;
  };

  const current = data ? toMap(data.currentWeek) : {};
  const previous = data ? toMap(data.previousWeek) : {};
  const totalSpend = Object.values(current).reduce((a, b) => a + b, 0);

  return (
    <div className="panel col-4">

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div className="panel-title">Bank Spending · Weekly</div>
          <div className="panel-subtitle">
            {mounted && data ? `Week of ${formatWeekLabel(data.weekStart)}` : "—"}
          </div>
        </div>
        <a
          href="/budget"
          style={{
            fontSize: 10, color: "#f59e0b", textDecoration: "none",
            fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            background: "rgba(245,158,11,0.1)", padding: "3px 8px", borderRadius: 4,
            border: "1px solid rgba(245,158,11,0.2)", whiteSpace: "nowrap",
          }}
        >
          Upload CSV →
        </a>
      </div>

      {/* Income + Total */}
      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto" }}>
        <div className="stat-cell">
          <div className="stat-num lg" style={{ color: "var(--green)" }}>
            {loading ? "—" : `$${(data?.totalIncome ?? 0).toFixed(0)}`}
          </div>
          <div className="stat-sublabel">Income (bank)</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1 }}>Shopify tracked separately</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num lg">
            {loading ? "—" : `$${totalSpend.toFixed(0)}`}
          </div>
          <div className="stat-sublabel">Total spend</div>
        </div>
      </div>

      <div className="divider" />

      {/* Category rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
            Loading…
          </div>
        )}

        {!loading && (!data || data.currentWeek.length === 0) && (
          <div style={{ color: "var(--text-muted)", fontSize: 11, textAlign: "center", padding: "20px 0", lineHeight: 1.6 }}>
            No data yet.{" "}
            <a href="/budget" style={{ color: "var(--cyan)", textDecoration: "none" }}>
              Upload a bank CSV →
            </a>
          </div>
        )}

        {!loading && data && data.currentWeek.length > 0 &&
          (CATEGORIES as readonly Category[]).map((cat) => {
            const thisWeek = current[cat] ?? 0;
            const lastWeek = previous[cat] ?? 0;
            const diff = thisWeek - lastWeek;
            const hasPrev = lastWeek > 0;

            let arrow: string | null = null;
            let arrowColor = "";
            if (hasPrev && diff > 0.5) { arrow = "↑"; arrowColor = "#e74c3c"; }       // more spend = bad
            else if (hasPrev && diff < -0.5) { arrow = "↓"; arrowColor = "#2ecc71"; } // less spend = good

            return (
              <div
                key={cat}
                style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between",
                  padding: "5px 0", borderBottom: "1px solid #1a1d2e",
                }}
              >
                <span className="list-name" style={{ fontSize: 11 }}>{cat}</span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                    color: thisWeek > 0 ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                    {thisWeek > 0 ? `$${thisWeek.toFixed(0)}` : "—"}
                  </span>
                  {arrow && (
                    <span style={{ fontSize: 10, color: arrowColor, fontWeight: 700 }}>
                      {arrow} ${Math.abs(diff).toFixed(0)}
                    </span>
                  )}
                  {!arrow && hasPrev && (
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>→</span>
                  )}
                </span>
              </div>
            );
          })
        }
      </div>

      {/* Last updated */}
      {mounted && data?.lastUpdated && (
        <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 8, textAlign: "right" }}>
          Last updated: {formatLastUpdated(data.lastUpdated)}
        </div>
      )}
    </div>
  );
}
