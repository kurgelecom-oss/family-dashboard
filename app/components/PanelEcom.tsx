"use client";
import { useState, useEffect, useCallback } from "react";

const MONTHLY_TARGET = 15000;
const PL_POLL_MS = 5 * 60 * 1000;

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

function fmt(n: number) {
  return n >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtVal(v: number | undefined) { return v !== undefined ? fmt(v) : "—"; }
function fmtRoas(v: number | undefined) { return v !== undefined ? `${v.toFixed(2)}×` : "—"; }
function fmtPct(v: number | undefined) { return v !== undefined ? `${v.toFixed(1)}%` : "—"; }

function MonthlySparkline({
  monthRevenue,
  target,
  loading,
}: {
  monthRevenue: number;
  target: number;
  loading: boolean;
}) {
  const now = new Date();
  const todayDay = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const W = 200;
  const H = 60;
  const PAD = 3;

  const xOf = (d: number) => PAD + (d / daysInMonth) * (W - PAD * 2);
  const yOf = (v: number) => H - PAD - (Math.min(v, target * 1.15) / (target * 1.15)) * (H - PAD * 2);

  const ax1 = xOf(0), ay1 = H - PAD;
  const ax2 = xOf(todayDay), ay2 = yOf(monthRevenue);
  const tx2 = xOf(daysInMonth), ty2 = PAD + 2;

  if (loading) {
    return <div style={{ flex: 1, minHeight: 0, background: "var(--progress-track)", borderRadius: 4 }} />;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "block" }}
        preserveAspectRatio="none"
      >
        <line
          x1={ax1} y1={ay1} x2={tx2} y2={ty2}
          stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.55"
        />
        <line
          x1={ax1} y1={ay1} x2={ax2} y2={ay2}
          stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"
        />
        <circle cx={ax2} cy={ay2} r="3.5" fill="var(--cyan)" />
        <line
          x1={ax2} y1={0} x2={ax2} y2={H}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1"
        />
      </svg>
    </div>
  );
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

  const monthPct = data ? Math.min(Math.round((data.monthRevenue / MONTHLY_TARGET) * 100), 100) : 0;
  const hasError = !!data?.error;

  const pl = (plStale ? plLastGood : plData) ?? null;
  const plRevenue     = pickPl(pl, "revenue",     "Revenue",      "total_revenue",  "sales",       "Sales");
  const plCogs        = pickPl(pl, "cogs",         "COGS",        "cost_of_goods",  "costOfGoods");
  const plGrossProfit = pickPl(pl, "grossProfit",  "gross_profit","GrossProfit",    "gp",          "GP");
  const plAdSpend     = pickPl(pl, "adSpend",      "ad_spend",    "AdSpend",        "advertising", "ads");
  const plRoas        = pickPl(pl, "roas",         "ROAS",        "return_on_ad_spend");
  const plGpPct       = pickPl(pl, "gpPercent",    "gp_percent",  "gross_margin",   "GrossMargin", "gp_margin");
  const activeProduct = pl ? (pl.activeProduct as string | undefined) : undefined;

  const monthLabel = mounted
    ? new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" })
    : "";

  return (
    <>
      {/* ── Card 1: Revenue Today — compact, auto height ── */}
      <div className="card" style={{ flex: "0 0 auto", padding: "12px" }}>
        <div className="card-header">
          <div className="card-title">Revenue Today</div>
          <span className={`badge ${loading ? "badge-cyan" : hasError ? "badge-red" : "badge-green"}`}>
            {loading ? "Loading…" : hasError ? "⚠ Error" : "● Live"}
          </span>
        </div>
        <div className="stat-pair">
          <div className="stat-box">
            <div className="stat-box-num cyan">
              {loading ? "—" : fmt(data?.todayRevenue ?? 0)}
            </div>
            <div className="stat-box-label">Revenue</div>
          </div>
          <div className="stat-box">
            <div className="stat-box-num">
              {loading ? "—" : (data?.todayOrders ?? 0)}
            </div>
            <div className="stat-box-label">Orders</div>
          </div>
        </div>
      </div>

      {/* ── Card 2: Revenue This Month ── */}
      <div className="card" style={{ flex: 1.8, minHeight: 0, overflow: "hidden" }}>
        <div className="card-header">
          <div className="card-title">This Month</div>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{monthLabel}</span>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 6 }}>
          <div>
            <div className="hero-num lg green">
              {loading ? "—" : fmt(data?.monthRevenue ?? 0)}
            </div>
            <div className="sub-label">toward ${(MONTHLY_TARGET / 1000).toFixed(0)}k target</div>
            <div className={`delta ${monthPct >= 50 ? "up" : "down"}`}>
              {monthPct >= 100 ? "▲ Target reached!" : monthPct >= 50 ? `▲ ${monthPct}% of target` : `▼ ${monthPct}% of target`}
            </div>
          </div>

          <div>
            <div className="progress-row">
              <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Monthly progress
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {loading ? "—" : `${monthPct}%`}
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${monthPct}%`, background: "var(--cyan)" }} />
            </div>
          </div>

          {/* Sparkline fills remaining space */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <MonthlySparkline
              monthRevenue={data?.monthRevenue ?? 0}
              target={MONTHLY_TARGET}
              loading={loading}
            />
            <div style={{ display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: "var(--cyan)", fontWeight: 600 }}>— Actual</span>
              <span style={{ fontSize: 10, color: "var(--amber)", fontWeight: 600 }}>-- Target pace</span>
            </div>
          </div>

          <div style={{ flexShrink: 0 }}>
            <a
              href="https://ecom-launchpad-mentor.netlify.app/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 10, color: "var(--amber)", textDecoration: "none",
                fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                background: "rgba(245,166,35,0.1)", padding: "2px 7px", borderRadius: 4,
                border: "1px solid rgba(245,166,35,0.2)", display: "inline-flex",
              }}
            >
              Ecom Launchpad →
            </a>
          </div>
        </div>
      </div>

      {/* ── Card 3: P&L This Month ── */}
      <div className="card" style={{ flex: 1.2, minHeight: 0, overflow: "hidden" }}>
        <div className="card-header">
          <div className="card-title">P&amp;L · This Month</div>
          {plStale && <span className="badge badge-amber">⚠ Stale</span>}
          {plLoading && !plStale && <span className="badge badge-cyan">Loading…</span>}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {[
            { label: "P&L Revenue",  val: fmtVal(plRevenue),     color: "var(--cyan)",           subLabel: activeProduct },
            { label: "COGS",         val: fmtVal(plCogs),         color: "var(--text-secondary)", subLabel: undefined },
            { label: "Gross Profit", val: fmtVal(plGrossProfit),  color: plGrossProfit !== undefined && plGrossProfit > 0 ? "var(--green)" : "var(--text-secondary)", subLabel: undefined },
            { label: "Ad Spend",     val: fmtVal(plAdSpend),      color: "var(--text-secondary)", subLabel: undefined },
            { label: "ROAS",         val: fmtRoas(plRoas),        color: plRoas !== undefined && plRoas >= 2 ? "var(--green)" : "var(--text-secondary)", subLabel: undefined },
            { label: "GP%",          val: fmtPct(plGpPct),        color: "var(--text-secondary)", subLabel: undefined },
          ].map((row) => (
            <div className="list-row" key={row.label} style={{ flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <span className="list-label">{row.label}</span>
                <span className="list-value" style={{ color: row.color }}>{row.val}</span>
              </div>
              {row.subLabel && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{row.subLabel}</span>
              )}
            </div>
          ))}

          <div className="divider" style={{ margin: "4px 0" }} />

          <div className="list-row">
            <span className="list-label">Shopify Revenue</span>
            <span className="list-value" style={{ color: "var(--green)" }}>
              {loading ? "—" : fmt(data?.monthRevenue ?? 0)}
            </span>
          </div>
          <div className="list-row">
            <span className="list-label">Target</span>
            <span className="list-value" style={{ color: "var(--text-secondary)" }}>{fmt(MONTHLY_TARGET)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
