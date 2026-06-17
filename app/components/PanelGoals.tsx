"use client";
import { useState, useEffect, useCallback } from "react";

// ── Goal constants (hardcoded — wire Shopify data later) ──────────────────────
const DAILY   = { revenue: 500,   orders: 33,   adSpend: 225,  netProfit: 125  };
const WEEKLY  = { revenue: 3468,  orders: 231,  adSpend: 1561, netProfit: 867  };
const MONTHLY = { revenue: 15000, orders: 1000, adSpend: 6750, netProfit: 3750 };

const GOAL_CARDS = [
  { label: "Daily Goal",   color: "var(--cyan)",  ...DAILY   },
  { label: "Weekly Goal",  color: "var(--green)", ...WEEKLY  },
  { label: "Monthly Goal", color: "var(--amber)", ...MONTHLY },
];

// ── Traction Window ───────────────────────────────────────────────────────────
const TRACTION_END      = new Date("2027-01-01T00:00:00");
const TRACTION_START    = new Date("2026-01-01T00:00:00");
const TRACTION_WINDOW_MS = TRACTION_END.getTime() - TRACTION_START.getTime();

type ShopifyData = {
  weekRevenue: number;
  monthRevenue: number;
  yearRevenue: number;
  error?: string;
};

function fmtExact(n: number) {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function PanelGoals() {
  const [data, setData] = useState<ShopifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shopify");
      const json = await res.json();
      setData(json);
    } catch {
      setData({ weekRevenue: 0, monthRevenue: 0, yearRevenue: 0, error: "fetch failed" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel col-7">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="panel-title">Nihal · Ecom Goals</div>
        <span className={`badge ${loading ? "badge-cyan" : data?.error ? "badge-red" : "badge-green"}`}>
          {loading ? "Loading…" : data?.error ? "⚠ error" : "● Live · Shopify"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, flex: 1, minHeight: 0 }}>

        {/* ── Goal cards: Daily / Weekly / Monthly ── */}
        {GOAL_CARDS.map((g) => (
          <div className="stat-cell" key={g.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="num-label">{g.label}</span>
              <span className="badge badge-amber">Needs pace</span>
            </div>

            <div>
              <div className="stat-num lg" style={{ color: g.color }}>
                {fmtExact(g.revenue)}
              </div>
              <div className="stat-sublabel">Revenue needed</div>
            </div>

            <div className="divider" />

            <div>
              <div className="progress-row">
                <span className="num-label">Progress</span>
                <span className="num-label">0%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: "0%", background: g.color }} />
              </div>
            </div>

            <div style={{ marginTop: "auto" }}>
              <div className="list-item" style={{ padding: "4px 0" }}>
                <span className="list-name">Orders needed</span>
                <span className="list-val">{g.orders}</span>
              </div>
              <div className="list-item" style={{ padding: "4px 0" }}>
                <span className="list-name">Ad spend</span>
                <span className="list-val">{fmtExact(g.adSpend)}</span>
              </div>
              <div className="list-item" style={{ padding: "4px 0" }}>
                <span className="list-name">Net profit</span>
                <span className="list-val" style={{ color: "var(--green)" }}>{fmtExact(g.netProfit)}</span>
              </div>
            </div>
          </div>
        ))}

        {/* ── Traction Window — 4th card (unchanged) ── */}
        {(() => {
          const msLeft      = Math.max(TRACTION_END.getTime() - now.getTime(), 0);
          const daysLeft    = Math.floor(msLeft / 86_400_000);
          const midnight    = new Date(now); midnight.setHours(24, 0, 0, 0);
          const secsToday   = Math.max(Math.floor((midnight.getTime() - now.getTime()) / 1000), 0);
          const hh = String(Math.floor(secsToday / 3600)).padStart(2, "0");
          const mm = String(Math.floor((secsToday % 3600) / 60)).padStart(2, "0");
          const ss = String(secsToday % 60).padStart(2, "0");
          const msElapsed   = now.getTime() - TRACTION_START.getTime();
          const daysElapsed = Math.max(Math.floor(msElapsed / 86_400_000), 0);
          const pctUsed     = Math.min(Math.round((msElapsed / TRACTION_WINDOW_MS) * 100), 100);
          const barColor    = pctUsed < 33 ? "var(--green)" : pctUsed < 75 ? "var(--amber)" : "var(--red)";
          return (
            <div className="stat-cell" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="num-label">Traction Window</span>
                <span className="badge badge-cyan">Live Countdown</span>
              </div>

              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: -4 }}>
                Time to build income from scratch
              </div>

              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pctUsed}%`, background: barColor }} />
              </div>

              <div>
                <div className="stat-num lg" style={{ color: "var(--cyan)" }}>{daysLeft} days</div>
                <div style={{
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: "1.35rem",
                  fontWeight: 600,
                  color: "var(--cyan)",
                  letterSpacing: "0.05em",
                  lineHeight: 1.2,
                  marginTop: 2,
                }}>
                  {hh} : {mm} : {ss}
                </div>
                <div className="stat-sublabel" style={{ marginTop: 2 }}>remaining today</div>
              </div>

              <div className="divider" />

              <div style={{ marginTop: "auto" }}>
                <div className="list-item" style={{ padding: "4px 0" }}>
                  <span className="list-name">Target date</span>
                  <span className="list-val">31 Dec 2026</span>
                </div>
                <div className="list-item" style={{ padding: "4px 0" }}>
                  <span className="list-name">Days elapsed</span>
                  <span className="list-val" style={{ color: "var(--text-secondary)" }}>{daysElapsed}</span>
                </div>
                <div className="list-item" style={{ padding: "4px 0" }}>
                  <span className="list-name">% of window used</span>
                  <span className="list-val" style={{ color: barColor }}>{pctUsed}%</span>
                </div>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
