"use client";
import { useState, useEffect, useCallback } from "react";

const COLOR_MAP: Record<string, string> = {
  cyan:  "var(--cyan)",
  green: "var(--green)",
  amber: "var(--amber)",
  red:   "var(--red)",
};

const ACCOUNTS = [
  { key: "TAYLAN", label: "Taylan", color: "cyan"  },
  { key: "NIHAL",  label: "Nihal",  color: "green" },
  { key: "ANSAR",  label: "Ansar",  color: "amber" },
];

type CalEvent = {
  id: string;
  subject: string;
  startISO: string;
  endISO: string;
  isAllDay: boolean;
  account: string;
  email: string;
  color: string;
};

type CalResponse = {
  events: CalEvent[];
  configured: string[];
  missing: string[];
  errors?: string[];
};

function countdown(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "now";

  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);

  if (mins < 60) return `in ${mins}m`;
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }

  const eventDate = new Date(iso);
  const tomorrow  = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    eventDate.getDate()     === tomorrow.getDate()     &&
    eventDate.getMonth()    === tomorrow.getMonth()    &&
    eventDate.getFullYear() === tomorrow.getFullYear()
  ) {
    const t = eventDate.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
    return `tomorrow ${t}`;
  }

  if (days < 7) return `in ${days} days`;
  return eventDate.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function PanelCalendar() {
  const [events,     setEvents]     = useState<CalEvent[]>([]);
  const [missing,    setMissing]    = useState<string[]>([]);
  const [calLoading, setCalLoading] = useState(true);

  const loadCalendar = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error(`${res.status}`);
      const data: CalResponse = await res.json();
      setEvents(data.events ?? []);
      setMissing(data.missing ?? []);
    } catch {
      // silent — show empty state
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCalendar();
    const fetchId = setInterval(loadCalendar, 60 * 60 * 1000);
    return () => { clearInterval(fetchId); };
  }, [loadCalendar]);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Family Calendar</div>
        {!calLoading && missing.length === 0 && (
          <span className="badge badge-green">● Live</span>
        )}
        {!calLoading && missing.length > 0 && (
          <span className="badge badge-amber">⚠ Partial</span>
        )}
      </div>

      {missing.length > 0 && !calLoading && (
        <div style={{
          background: "rgba(245,166,35,0.07)", border: "1px solid rgba(245,166,35,0.2)",
          borderRadius: 5, padding: "5px 8px", fontSize: 10, color: "var(--amber)",
          marginBottom: 8, flexShrink: 0,
        }}>
          ⚠ Not connected: {missing.join(", ")}
        </div>
      )}

      {calLoading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>
          Loading calendar…
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 10 }}>
        {!calLoading && ACCOUNTS.map(acct => {
          const personEvents = events.filter(e => e.account === acct.key).slice(0, 2);
          const notConnected = missing.some(m =>
            m === (acct.key === "TAYLAN" ? "taylan.k8@hotmail.com" :
                   acct.key === "NIHAL"  ? "nils_gvi@hotmail.com"  :
                                           "ansar.k11@hotmail.com")
          );
          const color = COLOR_MAP[acct.color] ?? "var(--text-muted)";

          return (
            <div key={acct.key}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.06em", color, marginBottom: 4,
              }}>
                {acct.label}
              </div>

              {notConnected ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>Not connected</div>
              ) : personEvents.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>No upcoming events</div>
              ) : (
                personEvents.map(e => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <div style={{ width: 3, height: 20, borderRadius: 2, flexShrink: 0, background: color }} />
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.subject || "(No title)"}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginLeft: 6 }}>
                      {e.isAllDay ? "all day" : countdown(e.startISO)}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}

        {!calLoading && events.length === 0 && missing.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
            No upcoming events.
          </div>
        )}
      </div>
    </div>
  );
}
