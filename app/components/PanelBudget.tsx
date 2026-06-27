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
  const otherSpent = cats["other"] ?? 0;
  const totalSpent = CATEGORIES.reduce((a, c) => a + (cats[c.id] ?? 0), 0) + otherSpent;
  const remaining = WEEKLY_TOTAL_TARGET - totalSpent;
  const overBudget = remaining < 0;
  const totalPct = Math.min((totalSpent / WEEKLY_TOTAL_TARGET) * 100, 100);

  return (
    <>
      {/* ── Card 1: Weekly Spend — compact auto height ── */}
      <div className="card" style={{ flex: "0 0 auto", padding: "10px 12px" }}>
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

      {/* ── Card 2: Income vs Spend ── */}
      <div className="card" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="card-header">
          <div className="card-title">Income vs Spend</div>
          {mounted && netPos && (
            <span className={`badge ${netPos.surplus ? "badge-green" : "badge-red"}`}>
              {netPos.surplus ? "Surplus" : "Deficit"}
            </span>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {mounted && netPos ? (
            <>
              {netPos.income_breakdown.map((item) => (
                <div className="list-row" key={item.source}>
                  <span className="list-label">{item.label}</span>
                  <span className="list-value" style={{ color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
                    +${item.amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}

              <div className="divider" style={{ margin: "4px 0" }} />

              <div className="list-row">
                <span className="list-label" style={{ fontWeight: 700 }}>Total In</span>
                <span className="list-value" style={{ color: "var(--green)" }}>
                  +${netPos.total_income.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="list-row">
                <span className="list-label" style={{ fontWeight: 700 }}>Total Spent</span>
                <span className="list-value" style={{ color: "var(--red)" }}>
                  -${netPos.total_spend.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="divider" style={{ margin: "4px 0" }} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Net</span>
                <span style={{
                  fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                  color: netPos.surplus ? "var(--green)" : "var(--red)",
                }}>
                  {netPos.surplus ? "+" : "-"}${Math.abs(netPos.net).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {data?.balance != null && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="list-label">ING Balance</span>
                    <span className="list-value" style={{ color: "var(--cyan)" }}>
                      ${data.balance.value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>
              {loading ? "Loading…" : "No data"}
            </div>
          )}
        </div>
      </div>

      {/* ── Card 3: Spend by Category ── */}
      <div className="card" style={{ flex: 1.5, minHeight: 0, overflow: "hidden" }}>
        <div className="card-header">
          <div className="card-title">Spend by Category</div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            {CATEGORIES.map((cat) => {
              const spent = cats[cat.id] ?? 0;
              const pct = Math.min((spent / cat.target) * 100, 100);
              const over = spent > cat.target;
              const fillColor = over ? "var(--red)" : spent / cat.target >= 0.8 ? "var(--amber)" : "var(--cyan)";

              return (
                <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: "var(--text-primary)", flexShrink: 0, width: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cat.label}
                  </span>
                  <div style={{ flex: 1, height: 5, background: "var(--progress-track)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: fillColor, transition: "width 0.5s ease" }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: over ? "var(--red)" : "var(--text-primary)", textAlign: "right", flexShrink: 0, width: 48, fontVariantNumeric: "tabular-nums" }}>
                    ${spent.toFixed(0)}
                  </span>
                </div>
              );
            })}

            {otherSpent > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: "var(--text-primary)", flexShrink: 0, width: 90 }}>Other</span>
                <div style={{ flex: 1, height: 5, background: "var(--progress-track)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: "40%", height: "100%", borderRadius: 2, background: "var(--text-muted)", opacity: 0.5 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textAlign: "right", flexShrink: 0, width: 48 }}>
                  ${otherSpent.toFixed(0)}
                </span>
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", flexShrink: 0, width: 90 }}>Total</span>
              <div style={{ flex: 1, height: 5, background: "var(--progress-track)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min((totalSpent / WEEKLY_TOTAL_TARGET) * 100, 100)}%`,
                  height: "100%", borderRadius: 2,
                  background: overBudget ? "var(--red)" : "var(--cyan)",
                  transition: "width 0.5s ease",
                }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: overBudget ? "var(--red)" : "var(--text-primary)", textAlign: "right", flexShrink: 0, width: 48, fontVariantNumeric: "tabular-nums" }}>
                ${totalSpent.toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
