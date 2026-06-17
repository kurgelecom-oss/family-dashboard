"use client";
import { useState, useEffect, useCallback } from "react";

const YEARLY_TARGET  = 180000;
const MONTHLY_TARGET = 15000;
const WEEKLY_TARGET  = 3500;   // ~$180k ÷ 52 weeks

type ShopifyData = {
  weekRevenue: number;
  monthRevenue: number;
  yearRevenue: number;
  error?: string;
};

function daysLeftInYear() {
  const now = new Date();
  const end = new Date(now.getFullYear(), 11, 31);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

function daysLeftInMonth() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return end.getDate() - now.getDate();
}

function daysLeftInWeek() {
  const dow = new Date().getDay();
  return dow === 0 ? 0 : 7 - dow;
}

function pct(current: number, target: number) {
  return Math.min(Math.round((current / target) * 100), 100);
}

function fmt(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const TRACTION_END   = new Date("2027-01-01T00:00:00");
const TRACTION_START = new Date("2026-01-01T00:00:00");
const TRACTION_WINDOW_MS = TRACTION_END.getTime() - TRACTION_START.getTime();

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

  const trackers = [
    {
      label:    "Annual Income Target",
      target:   YEARLY_TARGET,
      current:  data?.yearRevenue ?? 0,
      daysLeft: daysLeftInYear(),
      period:   "days left in year",
      color:    "var(--cyan)",
    },
    {
      label:    "Monthly Revenue Goal",
      target:   MONTHLY_TARGET,
      current:  data?.monthRevenue ?? 0,
      daysLeft: daysLeftInMonth(),
      period:   "days left this month",
      color:    "var(--green)",
    },
  ];

  return (
    <div className="panel col-7">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="panel-title">Nihal · Ecom Goals</div>
        <span className={`badge ${loading ? "badge-cyan" : data?.error ? "badge-red" : "badge-green"}`}>
          {loading ? "Loading…" : data?.error ? "⚠ error" : "● Live · Shopify"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, flex: 1, minHeight: 0 }}>
        {trackers.map((t) => {
          const p = loading ? 0 : pct(t.current, t.target);
          const remaining = Math.max(t.target - t.current, 0);
          const onTrack = t.current >= t.target * 0.5;
          return (
            <div className="stat-cell" key={t.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="num-label">{t.label}</span>
                <span className={`badge ${onTrack ? "badge-green" : "badge-amber"}`}>
                  {onTrack ? "On track" : "Needs pace"}
                </span>
              </div>

              <div>
                <div className="stat-num lg" style={{ color: t.color }}>
                  {loading ? "—" : fmt(t.current)}
                </div>
                <div className="stat-sublabel">of {fmt(t.target)} target</div>
              </div>

              <div className="divider" />

              <div>
                <div className="progress-row">
                  <span className="num-label">Progress</span>
                  <span className="num-label">{loading ? "—" : `${p}%`}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${p}%`, background: t.color }} />
                </div>
              </div>

              <div style={{ marginTop: "auto" }}>
                <div className="list-item" style={{ padding: "4px 0" }}>
                  <span className="list-name">Remaining</span>
                  <span className="list-val" style={{ color: remaining === 0 ? "var(--green)" : t.color }}>
                    {loading ? "—" : remaining === 0 ? "✓ Hit!" : fmt(remaining)}
                  </span>
                </div>
                <div className="list-item" style={{ padding: "4px 0" }}>
                  <span className="list-name">Target</span>
                  <span className="list-val">{fmt(t.target)}</span>
                </div>
                <div className="list-item" style={{ padding: "4px 0" }}>
                  <span className="list-name">Time left</span>
                  <span className="list-val" style={{ color: "var(--text-secondary)" }}>
                    {t.daysLeft}d · {t.period}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Traction Window — third card */}
        {(() => {
          const msLeft     = Math.max(TRACTION_END.getTime() - now.getTime(), 0);
          const daysLeft   = Math.floor(msLeft / 86_400_000);
          const hoursLeft  = Math.floor((msLeft % 86_400_000) / 3_600_000);
          const msElapsed  = now.getTime() - TRACTION_START.getTime();
          const daysElapsed = Math.max(Math.floor(msElapsed / 86_400_000), 0);
          const pctUsed    = Math.min(Math.round((msElapsed / TRACTION_WINDOW_MS) * 100), 100);
          const barColor   = pctUsed < 33 ? "var(--green)" : pctUsed < 75 ? "var(--amber)" : "var(--red)";
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
                <div className="stat-sublabel">{hoursLeft} hrs remaining today</div>
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
