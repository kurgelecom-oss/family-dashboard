"use client";
import { useState, useEffect } from "react";
import { useShopifyActuals } from "../hooks/useShopifyActuals";

const DAILY   = { revenue: 1980,  orders: 33,   adSpend: 891,  netProfit: 495   };
const WEEKLY  = { revenue: 13860, orders: 231,  adSpend: 6237, netProfit: 3465  };
const MONTHLY = { revenue: 60000, orders: 1000, adSpend: 27000, netProfit: 15000 };

const GOAL_CARDS = [
  { label: "Daily Goal",   color: "var(--cyan)",  actualsKey: "daily"   as const, ...DAILY   },
  { label: "Weekly Goal",  color: "var(--green)", actualsKey: "weekly"  as const, ...WEEKLY  },
  { label: "Monthly Goal", color: "var(--amber)", actualsKey: "monthly" as const, ...MONTHLY },
];

const TRACTION_END      = new Date("2027-01-01T00:00:00");
const TRACTION_START    = new Date("2026-01-01T00:00:00");
const TRACTION_WINDOW_MS = TRACTION_END.getTime() - TRACTION_START.getTime();

function fmtExact(n: number) {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function PanelGoals() {
  const actuals = useShopifyActuals();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const statusBadge = actuals.loading
    ? <span className="badge badge-cyan">Loading…</span>
    : actuals.error
    ? <span className="badge badge-red">⚠ Error</span>
    : <span className="badge badge-green">● Live</span>;

  return (
    <>
      {/* ── Goal cards: Daily / Weekly / Monthly ── */}
      {GOAL_CARDS.map((g, i) => {
        const actual = actuals[g.actualsKey];
        const pct = Math.min(Math.round((actual.revenue / g.revenue) * 100), 100);

        const badgeLabel =
          actual.revenue >= g.revenue        ? "On Track"   :
          actual.revenue >= g.revenue * 0.75 ? "Needs Pace" : "Behind";
        const badgeClass =
          actual.revenue >= g.revenue        ? "badge-green" :
          actual.revenue >= g.revenue * 0.75 ? "badge-amber" : "badge-red";

        const ordersRemaining = Math.max(g.orders - actual.orders, 0);

        return (
          <div className="card" key={g.label}>
            <div className="card-header">
              <div className="card-title">{g.label}</div>
              {i === 0 ? statusBadge : <span className={`badge ${badgeClass}`}>{badgeLabel}</span>}
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 0 }}>
              <div>
                <div className="hero-num sm" style={{ color: g.color }}>
                  {fmtExact(g.revenue)}
                </div>
                <div className="sub-label">{fmtExact(actual.revenue)} earned</div>
              </div>

              <div>
                <div className="progress-row">
                  <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Progress</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{pct}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${pct}%`, background: g.color, opacity: actuals.loading ? 0.4 : 1 }}
                  />
                </div>
                <div className={`delta ${pct >= 75 ? "up" : "down"}`}>
                  {pct >= 100 ? "▲ Goal reached" : pct >= 75 ? `▲ ${pct}% of target` : `▼ ${100 - pct}% to go`}
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
                <div className="list-row">
                  <span className="list-label">Orders remaining</span>
                  <span className="list-value">{ordersRemaining}</span>
                </div>
                <div className="list-row">
                  <span className="list-label">Ad spend</span>
                  <span className="list-value">{fmtExact(g.adSpend)}</span>
                </div>
                <div className="list-row">
                  <span className="list-label">Net profit</span>
                  <span className="list-value" style={{ color: "var(--green)" }}>{fmtExact(g.netProfit)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Traction Window ── */}
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
          <div className="card">
            <div className="card-header">
              <div className="card-title">Traction Window</div>
              <span className="badge badge-cyan">Live</span>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 0 }}>
              <div>
                <div className="hero-num sm" style={{ color: "var(--cyan)" }}>{daysLeft}</div>
                <div className="sub-label">days remaining</div>
                <div style={{
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: "1rem",
                  fontWeight: 600,
                  color: "var(--cyan)",
                  letterSpacing: "0.05em",
                  marginTop: 6,
                }}>
                  {hh} : {mm} : {ss}
                </div>
              </div>

              <div>
                <div className="progress-row">
                  <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Year used</span>
                  <span style={{ fontSize: 11, color: barColor }}>{pctUsed}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pctUsed}%`, background: barColor }} />
                </div>
                <div className={`delta ${pctUsed < 75 ? "up" : "down"}`}>
                  {pctUsed < 75 ? `▲ ${100 - pctUsed}% of year remains` : `▼ Only ${100 - pctUsed}% of year left`}
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
                <div className="list-row">
                  <span className="list-label">Target date</span>
                  <span className="list-value">31 Dec 2026</span>
                </div>
                <div className="list-row">
                  <span className="list-label">Days elapsed</span>
                  <span className="list-value" style={{ color: "var(--text-secondary)" }}>{daysElapsed}</span>
                </div>
                <div className="list-row">
                  <span className="list-label">% window used</span>
                  <span className="list-value" style={{ color: barColor }}>{pctUsed}%</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
