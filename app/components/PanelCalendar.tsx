"use client";
import { useState, useEffect, useCallback } from "react";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const COLOR_MAP: Record<string, string> = {
  cyan:  "var(--cyan)",
  green: "var(--green)",
  amber: "var(--amber)",
  red:   "var(--red)",
};

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

function getWeekDays() {
  const now = new Date();
  const dow = now.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return DAY_NAMES.map((name, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { name, date: d };
  });
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

function isSameDay(eventISO: string, dayDate: Date) {
  const ed = new Date(eventISO);
  return (
    ed.getFullYear() === dayDate.getFullYear() &&
    ed.getMonth() === dayDate.getMonth() &&
    ed.getDate() === dayDate.getDate()
  );
}

export default function PanelCalendar() {
  const [days, setDays] = useState<{ name: string; date: Date }[]>([]);
  const [todayDay, setTodayDay] = useState(-1);
  const [todayMonth, setTodayMonth] = useState(-1);
  const [weekLabel, setWeekLabel] = useState("");
  const [mounted, setMounted] = useState(false);

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
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
    const weekDays = getWeekDays();
    const now = new Date();
    setDays(weekDays);
    setTodayDay(now.getDate());
    setTodayMonth(now.getMonth());

    const mon = weekDays[0].date;
    const sun = weekDays[6].date;
    const label =
      mon.getMonth() === sun.getMonth()
        ? `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`
        : `${mon.getDate()} ${mon.toLocaleDateString("en-AU", { month: "short" })} – ${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`;
    setWeekLabel(label);
    setMounted(true);
    loadCalendar();
    const id = setInterval(loadCalendar, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadCalendar]);

  return (
    <div className="panel col-5">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="panel-title">Family Calendar · This Week</div>
        <span className="badge badge-cyan">{mounted ? weekLabel : "—"}</span>
      </div>

      {/* Day strip */}
      <div className="day-strip">
        {mounted ? days.map((d) => {
          const isToday = d.date.getDate() === todayDay && d.date.getMonth() === todayMonth;
          return (
            <div key={d.name} className={`day-cell${isToday ? " today" : ""}`}>
              <div className="day-name">{d.name}</div>
              <div className="day-num">{d.date.getDate()}</div>
            </div>
          );
        }) : DAY_NAMES.map((name) => (
          <div key={name} className="day-cell">
            <div className="day-name">{name}</div>
            <div className="day-num">—</div>
          </div>
        ))}
      </div>

      <div className="divider" />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>

        {/* Not-configured notice */}
        {missing.length > 0 && !calLoading && (
          <div style={{
            background: "rgba(243,156,18,0.07)", border: "1px solid rgba(243,156,18,0.2)",
            borderRadius: 5, padding: "6px 10px", fontSize: 10, color: "var(--amber)",
          }}>
            ⚠ Not connected: {missing.join(", ")} · Set MS_CAL_*_REFRESH in Netlify.
          </div>
        )}

        {/* Events grouped by day */}
        {mounted && !calLoading && events.length > 0 && (
          <div>
            {days.map(d => {
              const dayEvents = events.filter(e => isSameDay(e.startISO, d.date));
              if (dayEvents.length === 0) return null;
              const isToday = d.date.getDate() === todayDay && d.date.getMonth() === todayMonth;
              return (
                <div key={d.name} style={{ marginBottom: 8 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: isToday ? "var(--cyan)" : "var(--text-muted)",
                    marginBottom: 3,
                  }}>
                    {d.name} {d.date.getDate()}
                  </div>
                  {dayEvents.map(e => (
                    <div key={e.id} className="list-item" style={{ padding: "5px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                        <div style={{
                          width: 3, minHeight: 28, borderRadius: 2, flexShrink: 0, alignSelf: "stretch",
                          background: COLOR_MAP[e.color] ?? "var(--text-muted)",
                        }} />
                        <div>
                          <div className="list-name" style={{ fontSize: 12 }}>{e.subject}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                            {e.isAllDay ? "All day" : fmtTime(e.startISO)}
                            {" · "}
                            <span style={{ color: COLOR_MAP[e.color] ?? "var(--text-muted)" }}>
                              {e.email.split("@")[0]}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {calLoading && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            Loading calendar…
          </div>
        )}

        {/* All accounts unconfigured */}
        {!calLoading && events.length === 0 && missing.length === 3 && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "20px 0", lineHeight: 1.8 }}>
            Microsoft calendar not connected.<br />
            Add MS_CAL_CLIENT_ID, MS_CAL_CLIENT_SECRET<br />
            and MS_CAL_TAYLAN_REFRESH to Netlify env vars.
          </div>
        )}

        {/* Configured but no events */}
        {!calLoading && events.length === 0 && missing.length < 3 && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "20px 0" }}>
            No events in the next 7 days.
          </div>
        )}

        {/* Account legend */}
        {events.length > 0 && (() => {
          const seen = new Map<string, { email: string; color: string }>();
          events.forEach(e => { if (!seen.has(e.account)) seen.set(e.account, { email: e.email, color: e.color }); });
          return (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: "auto", paddingTop: 4 }}>
              {Array.from(seen.entries()).map(([key, v]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLOR_MAP[v.color] ?? "var(--text-muted)" }} />
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{v.email.split("@")[0]}</span>
                </div>
              ))}
            </div>
          );
        })()}

      </div>
    </div>
  );
}
