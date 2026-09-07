"use client";

import { useCallback, useEffect, useState } from "react";
import type { DailyPayload, DailyRow } from "../api/shopify-daily/route";

/* ════════════════════════════════════════════════════════════════════════════
   ShopifyDaily — the daily store table at the top of /table.

   Reads /api/shopify-daily every 5 minutes. Four tiles for today (orders,
   sessions, add-to-carts, revenue) and one row per store-day for the last
   14 days, today first. Sessions / add-to-cart / reached-checkout come from
   ShopifyQL and stay as dashes until the Partner app has `read_reports`;
   the amber note below the tiles says exactly what unlocks them.
   ══════════════════════════════════════════════════════════════════════════ */

const REFRESH_MS = 5 * 60 * 1000;


const fmtInt = (n: number | null) =>
  n === null ? "—" : new Intl.NumberFormat("en-AU").format(n);
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 })
    .format(n);
const fmtPct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

function sum(rows: DailyRow[], pick: (r: DailyRow) => number | null): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    total += v;
    any = true;
  }
  return any ? total : null;
}

const th: React.CSSProperties = {
  textAlign: "right",
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  textAlign: "right",
  padding: "7px 10px",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border)",
};

export default function ShopifyDaily() {
  const [data, setData] = useState<DailyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shopify-daily", { cache: "no-store" });
      const payload = (await res.json()) as DailyPayload;
      if (!res.ok && !Array.isArray(payload?.days)) throw new Error(`HTTP ${res.status}`);
      setData(payload);
      setError(payload.days.length === 0 && payload.errors.length > 0 ? payload.errors.join(" | ") : null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const days = data?.days ?? [];
  const today = days[0] ?? null;
  const week = days.slice(0, 7);
  const locked = data ? !data.analytics.available : false;

  return (
    <>
      {error ? (
        <div
          role="alert"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--red)",
            flexShrink: 0,
          }}
        >
          Shopify data unavailable — {error}
        </div>
      ) : null}

      {/* Today — four tiles. */}
      <div className="drill-tile" style={{ borderLeft: "4px solid var(--cyan)", flexShrink: 0 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
        >
          <div className="card-title">Today · {data?.shop?.domain ?? "tryliare.shop"}</div>
          <span className="badge badge-cyan">
            {today ? today.label : data ? "—" : "Loading…"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          <div className="stat-cell" style={{ padding: "8px 10px" }}>
            <div className="stat-num lg cyan">{today ? fmtInt(today.orders) : "—"}</div>
            <div className="stat-sublabel">Orders · 7d {fmtInt(sum(week, (r) => r.orders))}</div>
          </div>
          <div className="stat-cell" style={{ padding: "8px 10px" }}>
            <div className="stat-num lg">{today ? fmtInt(today.sessions) : "—"}</div>
            <div className="stat-sublabel">Sessions · 7d {fmtInt(sum(week, (r) => r.sessions))}</div>
          </div>
          <div className="stat-cell" style={{ padding: "8px 10px" }}>
            <div className="stat-num lg amber">{today ? fmtInt(today.addToCart) : "—"}</div>
            <div className="stat-sublabel">Add to cart · 7d {fmtInt(sum(week, (r) => r.addToCart))}</div>
          </div>
          <div className="stat-cell" style={{ padding: "8px 10px" }}>
            <div className="stat-num lg green">{today ? fmtMoney(today.revenue) : "—"}</div>
            <div className="stat-sublabel">
              Revenue · 7d {fmtMoney(sum(week, (r) => r.revenue) ?? 0)}
            </div>
          </div>
        </div>
      </div>

      {locked ? (
        <div
          role="status"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--amber)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--amber)",
            lineHeight: 1.45,
            flexShrink: 0,
          }}
        >
          {data?.analytics.reason === "scope" ? (
            <>
              Sessions and add-to-carts are locked until the Shopify app carries the{" "}
              <code>read_reports</code> scope. Orders, checkouts and revenue are live. Fix: release a
              new app version with <code>read_reports</code> added, then re-consent through Composio.
              This table fills itself on the next refresh.
            </>
          ) : (
            <>Sessions unavailable — {data?.analytics.reason}</>
          )}
        </div>
      ) : null}

      {/* The daily table. */}
      <div className="drill-tile" style={{ flexShrink: 0 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
        >
          <div className="card-title">Last 14 days</div>
          {data ? (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              store time {data.timezone}
            </span>
          ) : null}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Day</th>
                <th style={th}>Sessions</th>
                <th style={th}>Add to cart</th>
                <th style={th}>Reached checkout</th>
                <th style={th}>Orders</th>
                <th style={th}>Conv.</th>
                <th style={th}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: "left", color: "var(--text-muted)" }}>
                    {data ? "No rows." : "Loading…"}
                  </td>
                </tr>
              ) : null}
              {days.map((r) => (
                <tr
                  key={r.date}
                  style={r.isToday ? { background: "var(--bg-highlight)" } : undefined}
                >
                  <td
                    style={{
                      ...td,
                      textAlign: "left",
                      fontWeight: r.isToday ? 800 : 600,
                      color: r.isToday ? "var(--cyan)" : "var(--text-primary)",
                    }}
                  >
                    {r.label}
                  </td>
                  <td style={td}>{fmtInt(r.sessions)}</td>
                  <td style={{ ...td, color: r.addToCart ? "var(--amber)" : "var(--text-muted)" }}>
                    {fmtInt(r.addToCart)}
                  </td>
                  <td style={td}>
                    {r.reachedCheckout !== null ? fmtInt(r.reachedCheckout) : fmtInt(r.checkouts)}
                  </td>
                  <td style={{ ...td, color: r.orders ? "var(--cyan)" : "var(--text-muted)" }}>
                    {fmtInt(r.orders)}
                  </td>
                  <td style={td}>{fmtPct(r.conversion)}</td>
                  <td style={{ ...td, color: r.revenue ? "var(--green)" : "var(--text-muted)" }}>
                    {fmtMoney(r.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.analytics.available === false ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Reached checkout = paid orders + abandoned checkouts until Shopify sessions unlock.
          </div>
        ) : null}
      </div>
    </>
  );
}
