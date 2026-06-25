"use client";
import { useState, useEffect, useCallback } from "react";

const MONTHLY_TARGET = 15000;
const PL_POLL_MS = 5 * 60 * 1000; // 5 minutes

type ShopifyData = {
  todayOrders: number;
  todayRevenue: number;
  weekRevenue: number;
  monthRevenue: number;
  yearRevenue: number;
  error?: string;
};

type PlData = Record<string, number | string | undefined> & {
  error?: string;
  fetchedAt?: number;
};

function pickPl(d: PlData | null, ...keys: string[]): number | undefined {
  if (!d) return undefined;
  for (const k of keys) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== "") {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (!isNaN(n)) return n;
    }
  }
  return undefined;
}

export default function PanelEcom() {
  const [data, setData] = useState<ShopifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const [plData, setPlData] = useState<PlData | null>(null);
  const [plLastGood, setPlLastGood] = useState<PlData | null>(null);
  const [plStale, setPlStale] = useState(false);
  const [plLoading, setPlLoading] = useState(true);

  const loadShopify = useCallback(async () => {
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

  const loadPl = useCallback(async () => {
    try {
      const res = await fetch("/api/pl-data");
      if (!res.ok) throw new Error(`${res.status}`);
      const json: PlData = await res.json();
      if (json.error) throw new Error(String(json.error));
      setPlData(json);
      setPlLastGood(json);
      setPlStale(false);
    } catch {
      setPlStale(true);
    } finally {
      setPlLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadShopify();
    loadPl();
    const i1 = setInterval(loadShopify, 60_000);
    const i2 = setInterval(loadPl, PL_POLL_MS);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, [loadShopify, loadPl]);

  const fmt = (n: number) =>
    n >= 1000
      ? `$${(n / 1000).toFixed(1)}k`
      : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const fmtVal = (v: number | undefined) => (v !== undefined ? fmt(v) : "—");
  const fmtRoas = (v: number | undefined) => (v !== undefined ? `${v.toFixed(2)}x` : "—");
  const fmtPct = (v: number | undefined) => (v !== undefined ? `${v.toFixed(1)}%` : "—");

  const monthPct = data ? Math.min(Math.round((data.monthRevenue / MONTHLY_TARGET) * 100), 100) : 0;
  const hasError = !!data?.error;

  const pl = (plStale ? plLastGood : plData) ?? null;
  const plRevenue     = pickPl(pl, "revenue", "Revenue", "total_revenue", "sales", "Sales");
  const plCogs        = pickPl(pl, "cogs", "COGS", "cost_of_goods", "costOfGoods");
  const plGrossProfit = pickPl(pl, "grossProfit", "gross_profit", "GrossProfit", "gp", "GP");
  const plAdSpend     = pickPl(pl, "adSpend", "ad_spend", "AdSpend", "advertising", "ads");
  const plRoas        = pickPl(pl, "roas", "ROAS", "return_on_ad_spend");
  const plGpPct       = pickPl(pl, "gpPercent", "gp_percent", "gross_margin", "GrossMargin", "gp_margin");

  return (
    <div className="panel">

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
        <div>
          <div className="panel-title">Nihal · Ecom Business</div>
          <div className="panel-subtitle">
            {mounted ? new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" }) : ""}
            {hasError && <span style={{ color: "var(--red)", marginLeft: 6 }}>· auth error</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span className={`badge ${loading ? "badge-cyan" : hasError ? "badge-red" : "badge-green"}`}>
            {loading ? "Loading…" : hasError ? "⚠ Shopify error" : "● Live"}
          </span>
          <a
            href="https://product-pl-tracker.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 10, color: "#f59e0b", textDecoration: "none",
              fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              background: "rgba(245,158,11,0.1)", padding: "2px 7px", borderRadius: 4,
              border: "1px solid rgba(245,158,11,0.2)",
            }}
          >
            P&amp;L →
          </a>
        </div>
      </div>

      {/* TODAY STATS — compact */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, flexShrink: 0 }}>
        <div className="stat-cell">
          <div className="stat-num sm cyan">{loading ? "—" : fmt(data?.todayRevenue ?? 0)}</div>
          <div className="stat-sublabel">Revenue today</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num sm">{loading ? "—" : (data?.todayOrders ?? 0)}</div>
          <div className="stat-sublabel">Orders today</div>
        </div>
      </div>

      <div className="divider" />

      {/* P&L + PROGRESS — fills remaining space, clipped not scrolled */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)" }}>
            P&amp;L · This Month
          </span>
          {plStale && <span style={{ fontSize: 9, color: "var(--amber)", fontWeight: 700, textTransform: "uppercase" }}>⚠ stale</span>}
          {plLoading && !plStale && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>loading…</span>}
        </div>

        {[
          { label: "Revenue",      val: fmtVal(plRevenue),     color: "var(--cyan)" },
          { label: "COGS",         val: fmtVal(plCogs),         color: "var(--text-secondary)" },
          { label: "Gross Profit", val: fmtVal(plGrossProfit),  color: plGrossProfit !== undefined && plGrossProfit > 0 ? "var(--green)" : "var(--text-secondary)" },
          { label: "Ad Spend",     val: fmtVal(plAdSpend),      color: "var(--text-secondary)" },
          { label: "ROAS",         val: fmtRoas(plRoas),        color: plRoas !== undefined && plRoas >= 2 ? "var(--green)" : "var(--text-secondary)" },
          { label: "GP%",          val: fmtPct(plGpPct),        color: "var(--text-secondary)" },
          { label: "Month revenue", val: loading ? "—" : fmt(data?.monthRevenue ?? 0), color: "var(--green)" },
          { label: "Target",        val: fmt(MONTHLY_TARGET),    color: "var(--text-secondary)" },
        ].map((row) => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
            <span className="list-name">{row.label}</span>
            <span className="list-val" style={{ color: row.color }}>{row.val}</span>
          </div>
        ))}

        <div style={{ marginTop: 6 }}>
          <div className="progress-row">
            <span className="num-label">Monthly progress</span>
            <span className="num-label">{loading ? "—" : `${monthPct}%`}</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${monthPct}%`, background: "var(--cyan)" }} />
          </div>
        </div>
      </div>

    </div>
  );
}
