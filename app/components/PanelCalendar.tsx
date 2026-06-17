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

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

function getWeekDays(ref: Date): Date[] {
  const wd     = ref.getDay();
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - (wd === 0 ? 6 : wd - 1));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

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
  const [now,        setNow]        = useState(() => new Date());

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
    const tickId  = setInterval(() => setNow(new Date()), 60_000);
    return () => { clearInterval(fetchId); clearInterval(tickId); };
  }, [loadCalendar]);

  const weekDays   = getWeekDays(now);
  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="panel col-5" style={{ display: "flex", flexDirection: "column" }}>
      <div className="panel-title">Family Calendar · Upcoming</div>

      <div className="divider" />

      {/* ── Upcoming events (scrollable) ── */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>

        {missing.length > 0 && !calLoading && (
          <div style={{
            background: "rgba(243,156,18,0.07)", border: "1px solid rgba(243,156,18,0.2)",
            borderRadius: 5, padding: "6px 10px", fontSize: 10, color: "var(--amber)",
          }}>
            ⚠ Not connected: {missing.join(", ")} · Set MS_CAL_*_REFRESH in Netlify.
          </div>
        )}

        {calLoading && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            Loading calendar…
          </div>
        )}

        {!calLoading && ACCOUNTS.map(acct => {
          const personEvents = events.filter(e => e.account === acct.key);
          const notConnected = missing.some(m =>
            m === (acct.key === "TAYLAN" ? "taylan.k8@hotmail.com" :
                   acct.key === "NIHAL"  ? "nils_gvi@hotmail.com"  :
                                           "ansar.k11@hotmail.com")
          );
          const color = COLOR_MAP[acct.color] ?? "var(--text-muted)";

          return (
            <div key={acct.key}>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.08em", color, marginBottom: 4,
              }}>
                {acct.label}
              </div>

              {notConnected ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>Not connected</div>
              ) : personEvents.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>No upcoming events</div>
              ) : (
                personEvents.map(e => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div style={{ width: 3, height: 28, borderRadius: 2, flexShrink: 0, background: color }} />
                      <div className="list-name" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.subject || "(No title)"}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>
                      {e.isAllDay ? "all day" : countdown(e.startISO)}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}

        {!calLoading && events.length === 0 && missing.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            No upcoming events.
          </div>
        )}

      </div>

      {/* ── Week at a glance ── */}
      {!calLoading && (
        <>
          <div className="divider" style={{ marginTop: 8 }} />

          <div style={{ paddingTop: 6 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 8,
            }}>
              This week
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {weekDays.map((day, i) => {
                const isToday  = isSameDay(day, now);
                const dayStart = day.getTime();
                const dayEnd   = dayStart + 86_400_000;

                return (
                  <div key={i} style={{ textAlign: "center" }}>
                    {/* Day letter */}
                    <div style={{
                      fontSize: 9,
                      color: isToday ? "var(--cyan)" : "var(--text-muted)",
                      fontWeight: isToday ? 700 : 400,
                      marginBottom: 3,
                    }}>
                      {DAY_LABELS[i]}
                    </div>

                    {/* Date number — circled if today */}
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", margin: "0 auto",
                      background: isToday ? "var(--cyan)" : "transparent",
                      color: isToday ? "#0b0f14" : "var(--text-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: isToday ? 700 : 400,
                    }}>
                      {day.getDate()}
                    </div>

                    {/* Colored dots — one per person with an event that day */}
                    <div style={{ display: "flex", justifyContent: "center", gap: 2, marginTop: 4, minHeight: 6 }}>
                      {ACCOUNTS.map(acct => {
                        const hasEvent = events.some(e => {
                          const t = new Date(e.startISO).getTime();
                          return e.account === acct.key && (
                            e.isAllDay
                              ? isSameDay(new Date(e.startISO), day)
                              : t >= dayStart && t < dayEnd
                          );
                        });
                        return hasEvent ? (
                          <div
                            key={acct.key}
                            style={{
                              width: 5, height: 5, borderRadius: "50%",
                              background: COLOR_MAP[acct.color],
                              flexShrink: 0,
                            }}
                          />
                        ) : null;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
