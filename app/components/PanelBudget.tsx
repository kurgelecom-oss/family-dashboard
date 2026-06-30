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

export default function PanelBudget() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    await fetch("/api/income/sync");
    const summaryRes = await fetch("/api/budget/summary");
    if (summaryRes.ok) setData(await summaryRes.json());
  }, []);

  useEffect(() => {
    setMounted(true);
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const cats = data?.categories ?? {};
  const otherSpent = cats["other"] ?? 0;
  const totalSpent = CATEGORIES.reduce((a, c) => a + (cats[c.id] ?? 0), 0) + otherSpent;
  const remaining = WEEKLY_TOTAL_TARGET - totalSpent;
  const overBudget = remaining < 0;
  const totalPct = Math.min((totalSpent / WEEKLY_TOTAL_TARGET) * 100, 100);

  return (
    <>
      {/* ── Card 1: Weekly Spend — compact auto height ── */}
      <div className="card" style={{ flex: 1, minHeight: 0, padding: "10px 12px" }}>
        <div className="card-header">
          <div className="card-title">Weekly Spend</div>
          {mounted && data && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {formatWeekLabel(data.week_start)}
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className={`hero-num lg ${overBudget ? "red" : ""}`}>
            ${totalSpent.toFixed(0)}
          </div>
          <div className="sub-label" style={{ marginTop: 0 }}>spent this week</div>
          <div className={`delta ${overBudget ? "down" : "up"}`} style={{ marginTop: 0 }}>
            {overBudget
              ? `▼ $${Math.abs(remaining).toFixed(0)} over budget`
              : `▲ $${remaining.toFixed(0)} remaining`}
          </div>
          <div className="progress-row" style={{ marginBottom: 0 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              vs ${WEEKLY_TOTAL_TARGET.toFixed(0)}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{Math.round(totalPct)}%</span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${totalPct}%`, background: overBudget ? "var(--red)" : "var(--cyan)" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {overBudget && <span className="badge badge-red">⚠ Over budget</span>}
            <a
              href="/budget"
              style={{
                fontSize: 10, color: "var(--amber)", textDecoration: "none",
                fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                background: "rgba(245,166,35,0.1)", padding: "2px 7px", borderRadius: 4,
                border: "1px solid rgba(245,166,35,0.2)", display: "inline-flex",
              }}
            >
              Enter spend →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
