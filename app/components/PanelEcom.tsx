"use client";
import { useState, useEffect, useCallback } from "react";

const MONTHLY_TARGET = 15000;

type ShopifyData = {
  todayOrders: number;
  todayRevenue: number;
  weekRevenue: number;
  monthRevenue: number;
  yearRevenue: number;
  error?: string;
};

export default function PanelEcom() {
  const [data, setData] = useState<ShopifyData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shopify");
      const json = await res.json();
      setData(json);
    } catch {
      setData({ todayOrders: 0, todayRevenue: 0, weekRevenue: 0, monthRevenue: 0, yearRevenue: 0, error: "fetch failed" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const monthPct = data ? Math.min(Math.round((data.monthRevenue / MONTHLY_TARGET) * 100), 100) : 0;
  const hasError = !!data?.error;

  return (
    <div className="panel col-4">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="panel-title">Nihal · Ecom Business</div>
          <div className="panel-subtitle">
            {new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
            {hasError && <span style={{ color: "var(--red)", marginLeft: 6 }}>· auth error</span>}
          </div>
        </div>
        <span className={`badge ${loading ? "badge-cyan" : hasError ? "badge-red" : "badge-green"}`}>
          {loading ? "Loading…" : hasError ? "⚠ Shopify error" : "● Live"}
        </span>
      </div>

      {/* TODAY: live from Shopify */}
      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto" }}>
        <div className="stat-cell">
          <div className="stat-num lg cyan">{loading ? "—" : fmt(data?.todayRevenue ?? 0)}</div>
          <div className="stat-sublabel">Revenue today</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num lg">{loading ? "—" : (data?.todayOrders ?? 0)}</div>
          <div className="stat-sublabel">Orders today</div>
        </div>
      </div>

      <div className="divider" />

      {/* P&L METRICS — Google Sheets wired in next session */}
      <div style={{ flex: 1 }}>
        {[
          { label: "COGS",         val: "—", sub: "via P&L tracker",  color: "var(--text-secondary)" },
          { label: "Ad Spend",     val: "—", sub: "via P&L tracker",  color: "var(--text-secondary)" },
          { label: "Gross Profit", val: "—", sub: "Sales − COGS",     color: "var(--text-muted)" },
          { label: "Net Profit",   val: "—", sub: "GP − Ad Spend",    color: "var(--text-muted)" },
          { label: "GP%",          val: "—", sub: "",                 color: "var(--text-muted)" },
          { label: "ROAS",         val: "—", sub: "",                 color: "var(--text-muted)" },
        ].map((row) => (
          <div className="list-item" key={row.label}>
            <span className="list-name">
              {row.label}
              {row.sub && <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 5 }}>{row.sub}</span>}
            </span>
            <span className="list-val" style={{ color: row.color }}>{row.val}</span>
          </div>
        ))}
        <div className="list-item">
          <span className="list-name">Month revenue</span>
          <span className="list-val" style={{ color: "var(--green)" }}>{loading ? "—" : fmt(data?.monthRevenue ?? 0)}</span>
        </div>
        <div className="list-item">
          <span className="list-name">Monthly target</span>
          <span className="list-val" style={{ color: "var(--text-secondary)" }}>{fmt(MONTHLY_TARGET)}</span>
        </div>
      </div>

      {/* MONTHLY PROGRESS */}
      <div>
        <div className="progress-row">
          <span className="num-label">Monthly progress</span>
          <span className="num-label">{loading ? "—" : `${monthPct}%`}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${monthPct}%`, background: "var(--cyan)" }} />
        </div>
      </div>
    </div>
  );
}
