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

const TRACTION_END       = new Date("2027-01-01T00:00:00");
const TRACTION_START     = new Date("2026-01-01T00:00:00");
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
          <div className="card" key={g.label} style={{ padding: "10px 12px" }}>
            <div className="card-header" style={{ marginBottom: 5 }}>
              <div className="card-title">{g.label}</div>
              {i === 0 ? statusBadge : <span className={`badge ${badgeClass}`}>{badgeLabel}</span>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minHeight: 0, overflow: "hidden" }}>
              {/* Hero number */}
              <div style={{
                fontSize: 36, fontWeight: 700, color: g.color,
                lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
              }}>
                {fmtExact(g.revenue)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 400 }}>
                {fmtExact(actual.revenue)} earned
              </div>

              {/* Progress */}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Progress</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{pct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%`, background: g.color, opacity: actuals.loading ? 0.4 : 1 }} />
              </div>
              <div className={`delta ${pct >= 75 ? "up" : "down"}`} style={{ marginTop: 0 }}>
                {pct >= 100 ? "▲ Goal reached" : pct >= 75 ? `▲ ${pct}% of target` : `▼ ${100 - pct}% to go`}
              </div>

              {/* Details */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Orders remaining</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{ordersRemaining}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Ad spend</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{fmtExact(g.adSpend)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Net profit</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>{fmtExact(g.netProfit)}</span>
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
          <div className="card" style={{ flex: 1.2, padding: "10px 12px" }}>
            <div className="card-header" style={{ marginBottom: 5 }}>
              <div className="card-title">Traction Window</div>
              <span className="badge badge-cyan">Live</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div style={{
                fontSize: 40, fontWeight: 700, color: "var(--cyan)",
                lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
              }}>
                {daysLeft}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>days remaining</div>
              <div style={{
                fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                fontVariantNumeric: "tabular-nums",
                fontSize: 18,
                fontWeight: 600,
                color: "var(--cyan)",
                letterSpacing: "0.05em",
              }}>
                {hh} : {mm} : {ss}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Year used</span>
                <span style={{ fontSize: 11, color: barColor }}>{pctUsed}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pctUsed}%`, background: barColor }} />
              </div>
              <div className={`delta ${pctUsed < 75 ? "up" : "down"}`} style={{ marginTop: 0 }}>
                {pctUsed < 75 ? `▲ ${100 - pctUsed}% of year remains` : `▼ Only ${100 - pctUsed}% of year left`}
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Target date</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>31 Dec 2026</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Days elapsed</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{daysElapsed}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>% window used</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: barColor, fontVariantNumeric: "tabular-nums" }}>{pctUsed}%</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
