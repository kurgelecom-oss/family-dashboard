"use client";
import { useState, useEffect, useCallback } from "react";

const CATEGORIES = [
  { id: "housing",       label: "Housing",       sub: "Rent + Water",            target: 675.46 },
  { id: "transport",     label: "Transport",      sub: "Fuel + Insurance + Rego", target: 194.49 },
  { id: "groceries",     label: "Groceries",      sub: "Coles + Woolies",         target: 277.15 },
  { id: "eating_out",    label: "Eating Out",     sub: "Cafes + Delivery",        target: 100.00 },
  { id: "subscriptions", label: "Subscriptions",  sub: "Monthly subs",            target: 105.68 },
  { id: "ecom",          label: "Ecom",           sub: "Business expenses",       target: 150.00 },
];

const WEEKLY_TOTAL_TARGET = 1502.78;

interface SummaryData {
  week_start: string;
  categories: Record<string, number>;
  prevWeek: Record<string, number>;
  income: number;
  balance: { value: number; week_start: string } | null;
  last_updated: string | null;
}

interface NetPosition {
  total_income: number;
  total_spend: number;
  net: number;
  surplus: boolean;
  income_breakdown: { source: string; label: string; amount: number }[];
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
  const [netPos, setNetPos] = useState<NetPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    try {
      await fetch("/api/income/sync");
      const [summaryRes, netRes] = await Promise.all([
        fetch("/api/budget/summary"),
        fetch("/api/net-position"),
      ]);
      if (summaryRes.ok) setData(await summaryRes.json());
      if (netRes.ok) setNetPos(await netRes.json());
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

  const otherSpent = cats["other"] ?? 0;
  const totalSpent = CATEGORIES.reduce((a, c) => a + (cats[c.id] ?? 0), 0) + otherSpent;
  const remaining = WEEKLY_TOTAL_TARGET - totalSpent;
  const overBudget = CATEGORIES.some((c) => (cats[c.id] ?? 0) > c.target);

  return (
    <div className="panel">

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
      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto", gap: 4 }}>
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

      <div className="divider" />

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Income + Net Position */}
        {mounted && netPos && (
          <div style={{ marginBottom: 5, paddingBottom: 5, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {netPos.income_breakdown.map((item) => (
              <div key={item.source} style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{item.label}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
                  +${item.amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Total In</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
                +${netPos.total_income.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Total Spent</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--red)", fontVariantNumeric: "tabular-nums" }}>
                -${netPos.total_spend.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, paddingTop: 3, borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>Net</span>
              <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: netPos.surplus ? "var(--green)" : "var(--red)" }}>
                {netPos.surplus ? "+" : "-"}${Math.abs(netPos.net).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {/* Overall progress bar */}
        <div style={{ marginBottom: 5, flexShrink: 0 }}>
          <div className="progress-row">
            <span className="num-label">Total vs ${WEEKLY_TOTAL_TARGET.toFixed(0)}</span>
            <span className="num-label">
              {Math.min(Math.round((totalSpent / WEEKLY_TOTAL_TARGET) * 100), 100)}%
            </span>
          </div>
          <div className="progress-track" style={{ height: 6 }}>
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
            <div key={cat.id} style={{ marginBottom: 4 }}>
              <div className="progress-row">
                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                  {cat.label}
                </span>
                <span style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                  {hasArrow && (
                    <span style={{ fontSize: 8, fontWeight: 700, color: diff > 0 ? "#e74c3c" : "#2ecc71" }}>
                      {diff > 0 ? "↑" : "↓"}
                    </span>
                  )}
                  <span style={{ color, fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    ${spent.toFixed(0)}
                    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                      /{cat.target.toFixed(0)}
                    </span>
                  </span>
                </span>
              </div>
              <div className="progress-track" style={{ height: 4 }}>
                <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          );
        })}

        {/* Other — catch-all, shown without a target bar */}
        {otherSpent > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div className="progress-row">
              <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Other</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                ${otherSpent.toFixed(0)}
              </span>
            </div>
          </div>
        )}

        {/* ING Balance row */}
        {mounted && data?.balance != null && (
          <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
            <div className="progress-row">
              <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>ING Balance</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cyan)", fontVariantNumeric: "tabular-nums" }}>
                ${data.balance.value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
