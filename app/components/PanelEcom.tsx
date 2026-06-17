"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";

const MONTHLY_TARGET = 15000;
const PL_POLL_MS = 5 * 60 * 1000; // 5 minutes

const WORK_COMPONENTS = [
  { id: "research",  label: "Product/Market Research",         icon: "🔍" },
  { id: "origins",   label: "Origins Mentorship",              icon: "🌱" },
  { id: "nick",      label: "Nick Calls/Discords",             icon: "📞" },
  { id: "marketing", label: "Breakthrough Marketing/Slight Edge", icon: "📈" },
];

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

  const [workDone, setWorkDone] = useState<Record<string, boolean>>({});
  const [workWeekly, setWorkWeekly] = useState<Record<string, number>>({});
  const [workSaving, setWorkSaving] = useState<string | null>(null);

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

  const loadWork = useCallback(async () => {
    const today = getTodayDate();
    const weekStart = getWeekStart();

    const { data: todayRows } = await supabase
      .from("nihal_work_log")
      .select("component")
      .eq("log_date", today)
      .eq("completed", true);

    if (todayRows) {
      const map: Record<string, boolean> = {};
      todayRows.forEach((r: { component: string }) => { map[r.component] = true; });
      setWorkDone(map);
    }

    const { data: weekRows } = await supabase
      .from("nihal_work_log")
      .select("component, log_date")
      .gte("log_date", weekStart)
      .lte("log_date", today)
      .eq("completed", true);

    if (weekRows) {
      const tally: Record<string, Set<string>> = {};
      weekRows.forEach((r: { component: string; log_date: string }) => {
        if (!tally[r.component]) tally[r.component] = new Set();
        tally[r.component].add(r.log_date);
      });
      const counts: Record<string, number> = {};
      WORK_COMPONENTS.forEach(c => { counts[c.id] = tally[c.id]?.size ?? 0; });
      setWorkWeekly(counts);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadShopify();
    loadPl();
    loadWork();
    const i1 = setInterval(loadShopify, 60_000);
    const i2 = setInterval(loadPl, PL_POLL_MS);
    const i3 = setInterval(loadWork, 30_000);
    return () => { clearInterval(i1); clearInterval(i2); clearInterval(i3); };
  }, [loadShopify, loadPl, loadWork]);

  async function toggleWork(id: string) {
    const today = getTodayDate();
    const newVal = !workDone[id];
    setWorkDone(prev => ({ ...prev, [id]: newVal }));
    setWorkSaving(id);

    const { data: existing } = await supabase
      .from("nihal_work_log")
      .select("id")
      .eq("component", id)
      .eq("log_date", today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("nihal_work_log")
        .update({ completed: newVal })
        .eq("component", id)
        .eq("log_date", today);
    } else {
      await supabase
        .from("nihal_work_log")
        .insert({ component: id, completed: newVal, log_date: today });
    }

    setWorkSaving(null);
    loadWork();
  }

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
    <div className="panel col-4" style={{ overflow: "hidden" }}>
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
        <div>
          <div className="panel-title">Nihal · Ecom Business</div>
          <div className="panel-subtitle">
            {mounted ? new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" }) : ""}
            {hasError && <span style={{ color: "var(--red)", marginLeft: 6 }}>· auth error</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
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
              background: "rgba(245,158,11,0.1)", padding: "3px 8px", borderRadius: 4,
              border: "1px solid rgba(245,158,11,0.2)",
            }}
          >
            P&amp;L Tracker →
          </a>
        </div>
      </div>

      {/* SCROLLABLE BODY: money top half, work tracker bottom half */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>

        {/* TODAY STATS */}
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

        {/* P&L METRICS */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)" }}>
              P&amp;L · This Month
            </span>
            {plStale && (
              <span style={{ fontSize: 9, color: "var(--amber)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                ⚠ stale
              </span>
            )}
            {plLoading && !plStale && (
              <span style={{ fontSize: 9, color: "var(--text-muted)" }}>loading…</span>
            )}
          </div>

          {[
            { label: "Revenue",      val: fmtVal(plRevenue),     color: "var(--cyan)" },
            { label: "COGS",         val: fmtVal(plCogs),         color: "var(--text-secondary)" },
            { label: "Gross Profit", val: fmtVal(plGrossProfit),  color: plGrossProfit !== undefined && plGrossProfit > 0 ? "var(--green)" : "var(--text-secondary)" },
            { label: "Ad Spend",     val: fmtVal(plAdSpend),      color: "var(--text-secondary)" },
            { label: "ROAS",         val: fmtRoas(plRoas),        color: plRoas !== undefined && plRoas >= 2 ? "var(--green)" : "var(--text-secondary)" },
            { label: "GP%",          val: fmtPct(plGpPct),        color: "var(--text-secondary)" },
          ].map((row) => (
            <div className="list-item" key={row.label}>
              <span className="list-name">{row.label}</span>
              <span className="list-val" style={{ color: row.color }}>{row.val}</span>
            </div>
          ))}

          <div className="list-item">
            <span className="list-name">Month revenue</span>
            <span className="list-val" style={{ color: "var(--green)" }}>
              {loading ? "—" : fmt(data?.monthRevenue ?? 0)}
            </span>
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

        <div className="divider" />

        {/* DAILY WORK TRACKER */}
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 6,
          }}>
            Daily Work · {mounted ? new Date().toLocaleDateString("en-AU", { weekday: "long" }) : "Today"}
          </div>

          {WORK_COMPONENTS.map(c => {
            const done = workDone[c.id] ?? false;
            const saving = workSaving === c.id;
            const weekly = workWeekly[c.id] ?? 0;
            return (
              <div
                key={c.id}
                onClick={() => { if (!saving) toggleWork(c.id); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "7px 10px", marginBottom: 4, borderRadius: 5, cursor: "pointer",
                  background: done ? "rgba(46,204,113,0.08)" : "var(--bg-panel-inner)",
                  border: `1px solid ${done ? "rgba(46,204,113,0.3)" : "var(--border)"}`,
                  transition: "all 0.15s ease",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${done ? "var(--green)" : "var(--border)"}`,
                    background: done ? "var(--green)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: "#000", fontWeight: 800, transition: "all 0.15s ease",
                  }}>
                    {saving ? "⏳" : done ? "✓" : null}
                  </div>
                  <span style={{
                    fontSize: 12,
                    color: done ? "var(--text-muted)" : "var(--text-secondary)",
                    textDecoration: done ? "line-through" : "none",
                  }}>
                    {c.icon} {c.label}
                  </span>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: weekly >= 5 ? "var(--green)" : weekly >= 3 ? "var(--amber)" : "var(--text-muted)",
                }}>
                  {weekly}/7 wk
                </span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
