"use client";

import { useEffect, useState, type ReactNode } from "react";

/* ════════════════════════════════════════════════════════════════════════════
   Shared chrome for the four drill-down routes (/money, /business, /table and
   the bands added to /board): a back link to the face at top left and the date
   and time in Australia/Sydney at the right.

   Sydney via Intl only — never a UTC-offset constant, which is wrong for the
   AEDT half of the year (see CLAUDE.md and app/components/Header.tsx).
   ══════════════════════════════════════════════════════════════════════════ */

function sydneyNow(): { date: string; time: string } {
  const now = new Date();
  return {
    date: new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(now),
    time: new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now),
  };
}

/** Sydney date · time, ticking. Rendered blank until mounted so server and
 *  client markup cannot disagree about the clock. */
export function SydneyClock() {
  const [stamp, setStamp] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    const update = () => setStamp(sydneyNow());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{stamp?.date ?? ""}</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {stamp?.time ?? ""}
      </span>
    </div>
  );
}

/** Back link to the face. 48px minimum — this page is touched on a 65" panel. */
export function BackLink() {
  return (
    <a
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 48,
        padding: "0 16px",
        fontSize: 14,
        fontWeight: 700,
        color: "var(--text-secondary)",
        textDecoration: "none",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-card)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      ← Back
    </a>
  );
}

/**
 * The drill-down header row: back link, page name, Sydney date/time, and an
 * optional right-hand control slot (period toggle, owner filter, status pill).
 */
export default function DrillChrome({
  title,
  accent = "var(--cyan)",
  right,
}: {
  title: string;
  accent?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        flexShrink: 0,
      }}
    >
      <BackLink />
      <div className="header-name" style={{ fontSize: 20 }}>
        {title.split(" ")[0]}{" "}
        <span style={{ color: accent }}>{title.split(" ").slice(1).join(" ")}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }} />
      <SydneyClock />
      {right ?? null}
    </div>
  );
}
