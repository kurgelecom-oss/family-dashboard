"use client";
import { useState, useEffect, useCallback } from "react";
import { getTodayDate, getWeekStart } from "../lib/supabase";
import WeekProgressStrip from "../components/WeekProgressStrip";

// ─── Theme (mirrors Header.tsx so /week matches the dashboard) ──────────────
function getAestHour(): number {
  return (new Date().getUTCHours() + 10) % 24;
}
function getAutoTheme(): "day" | "night" {
  return getAestHour() >= 17 ? "night" : "day";
}

// ANSAR FC scoring + habit state now live in WeekProgressStrip.tsx

function dayNameOf(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-AU", { weekday: "long" });
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ─── Weekly calendar config ─────────────────────────────────────────────────
const ANSAR = "var(--amber)"; // Ansar = orange across the dashboard

// dayIdx 0 = Monday (weekStart is Monday), matching the Notion Days options
const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Entry from /api/schedule (Notion "ANSAR OS — Weekly Schedule" data source).
// days[] = recurring weekdays; date = one-off occurrence (YYYY-MM-DD).
type ScheduleEntry = {
  entry: string; days: string[]; date: string | null;
  start: string; end: string; category: string; detail: string; emoji: string;
};

// Category → rgb triple, used at three alphas (bg / border / accent)
const CATEGORY_RGB: Record<string, string> = {
  Routine:  "245,166,35",   // orange (matches --amber)
  Learning: "59,130,246",   // blue
  Soccer:   "46,204,113",   // green (matches --green)
  Prayer:   "168,85,247",   // purple
  Screen:   "148,163,184",  // gray
  Meal:     "234,179,8",    // yellow
  Event:    "231,76,60",    // red (matches --red)
};
const DEFAULT_RGB = "245,166,35";
function categoryRgb(category: string): string {
  return CATEGORY_RGB[category] ?? DEFAULT_RGB;
}

// "6:45am" / "7:00pm" / "12:15am" → minutes since midnight; unparseable → end
const UNPARSEABLE = 24 * 60;
function parseStartMinutes(s: string): number {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return UNPARSEABLE;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + parseInt(m[2] ?? "0", 10);
}

type ApiEvent = {
  id: string; subject: string; startISO: string; endISO: string;
  isAllDay: boolean; account: string; email: string; color: string;
};
type GridEvent = { dayIdx: number; label: string; time: string; startMin: number };

// /api/calendar returns bare UTC datetimes (Prefer: outlook.timezone="UTC")
function parseUTC(s: string): Date {
  return new Date(/Z|[+-]\d{2}:\d{2}$/.test(s) ? s : s + "Z");
}

export default function WeekPage() {
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);

  const weekStart = getWeekStart();
  const weekDates = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));
  const todayIdx = weekDates.indexOf(getTodayDate());

  const loadSchedule = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule");
      if (!res.ok) return;
      const entries = (await res.json()) as ScheduleEntry[];
      if (Array.isArray(entries)) setSchedule(entries);
    } catch {
      // schedule is best-effort; the grid shows "No schedule yet" instead
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) return;
      const data = (await res.json()) as { events?: ApiEvent[] };
      const ws = getWeekStart();
      const dates = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(ws, i));
      const out: GridEvent[] = [];
      (data.events ?? []).forEach(e => {
        if (e.account !== "ANSAR") return;
        const start = parseUTC(e.startISO);
        const ds = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
        const dayIdx = dates.indexOf(ds);
        if (dayIdx === -1) return;
        const end = parseUTC(e.endISO);
        const fmt = (d: Date) => d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
        out.push({
          dayIdx,
          label: `📅 ${e.subject}`,
          time: e.isAllDay ? "All day" : `${fmt(start)}–${fmt(end)}`,
          // All-day events pin to the top of the column
          startMin: e.isAllDay ? -1 : start.getHours() * 60 + start.getMinutes(),
        });
      });
      setEvents(out);
    } catch {
      // calendar chips are best-effort; grid still renders without them
    }
  }, []);

  useEffect(() => {
    // Match the dashboard's theme behaviour (Header.tsx) since /week has no Header.
    // Re-checked every 60s so an always-on display auto-flips at 5pm and picks up
    // dashboard toggles (themeOverride) within a minute.
    const applyTheme = () => {
      const stored = localStorage.getItem("themeOverride") as "day" | "night" | null;
      document.documentElement.setAttribute("data-theme", stored ?? getAutoTheme());
    };
    applyTheme();

    loadSchedule();
    loadCalendar();
    const id = setInterval(() => { loadCalendar(); }, 60_000);
    const themeId = setInterval(applyTheme, 60_000);
    return () => { clearInterval(id); clearInterval(themeId); };
  }, [loadSchedule, loadCalendar]);

  // Entries for one day column: recurring (days[]) OR one-off (date), by start time.
  // "Monday"-style day names also match via the 3-letter prefix.
  function entriesForDay(dayIdx: number): ScheduleEntry[] {
    return schedule
      .filter(e =>
        e.days.some(d => d.slice(0, 3) === DAY_KEYS[dayIdx]) ||
        e.date === weekDates[dayIdx]
      )
      .sort((a, b) => parseStartMinutes(a.start) - parseStartMinutes(b.start));
  }

  // MS Graph chips for one day column. Soccer chips are skipped when the Notion
  // schedule already has a Soccer entry that day (same session, avoid doubles).
  function eventsForDay(dayIdx: number, dayEntries: ScheduleEntry[]): GridEvent[] {
    const soccerCovered = dayEntries.some(e => e.category === "Soccer");
    return events
      .filter(e => e.dayIdx === dayIdx && !(soccerCovered && /soccer/i.test(e.label)))
      .sort((a, b) => a.startMin - b.startMin);
  }

  return (
    // Mirrors .dashboard (globals.css): fixed-viewport flex column, no page scroll
    <div style={{ height: "100dvh", width: "100vw", overflow: "hidden", display: "flex", flexDirection: "column", gap: 12, padding: 12, background: "var(--bg-base)" }}>

        {/* HEADER */}
        <div className="header">
          <div className="header-brand">
            <div className="header-name">ANSAR <span style={{ color: ANSAR }}>· WEEK</span></div>
            <div className="header-sub">Nihal&apos;s weekly view · ANSAR FC</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="https://app.notion.com/p/e51f4aa820c644f4bc832a6717790f1b?v=0e3d3a73d6d44e22b38ad53e458e4212" target="_blank" rel="noopener noreferrer" style={{
              fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6,
              padding: "8px 14px",
            }}>Edit in Notion ↗</a>
            <a href="/" style={{
              fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6,
              padding: "8px 14px",
            }}>← Dashboard</a>
          </div>
        </div>

        {/* WEEKLY CALENDAR */}
        <div className="card" style={{ padding: 0, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {schedule.length === 0 && (
            <div style={{
              padding: "8px 12px", borderBottom: "1px solid var(--border)",
              fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textAlign: "center",
            }}>
              No schedule yet
            </div>
          )}
          <div style={{ overflowX: "auto", overflowY: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ minWidth: 980, flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "auto 1fr" }}>

              {/* Day header row */}
              {weekDates.map((ds, i) => {
                const isToday = i === todayIdx;
                return (
                  <div key={ds} style={{
                    textAlign: "center", padding: "10px 6px",
                    borderBottom: isToday ? `2px solid ${ANSAR}` : "1px solid var(--border)",
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                    background: isToday ? "rgba(245,166,35,0.10)" : "transparent",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: isToday ? ANSAR : "var(--text-muted)" }}>
                      {dayNameOf(ds).slice(0, 3)}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: isToday ? ANSAR : "var(--text-secondary)", marginTop: 2 }}>
                      {Number(ds.slice(8))}
                    </div>
                  </div>
                );
              })}

              {/* Day columns */}
              {weekDates.map((ds, i) => {
                const isToday = i === todayIdx;
                const dayEntries = entriesForDay(i);
                const dayEvents = eventsForDay(i, dayEntries);
                return (
                  <div key={`col-${ds}`} style={{
                    borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                    minHeight: 0, overflowY: "auto", padding: 6,
                    background: isToday ? "rgba(245,166,35,0.06)" : "transparent",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    {dayEntries.map((e, j) => {
                      const rgb = categoryRgb(e.category);
                      return (
                        <div key={`s-${j}`} style={{
                          background: `rgba(${rgb},0.10)`,
                          border: `1px solid rgba(${rgb},0.35)`,
                          borderLeft: `3px solid rgb(${rgb})`,
                          borderRadius: 5, padding: "5px 7px", flexShrink: 0,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {e.emoji ? `${e.emoji} ` : ""}{e.entry}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                            {e.start}{e.end ? `–${e.end}` : ""}
                          </div>
                          {e.detail && (
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{e.detail}</div>
                          )}
                        </div>
                      );
                    })}
                    {dayEvents.map((e, j) => (
                      <div key={`e-${j}`} style={{
                        background: "rgba(0,212,255,0.10)",
                        border: "1px solid rgba(0,212,255,0.35)",
                        borderRadius: 5, padding: "5px 7px", flexShrink: 0,
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{e.time}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* PROGRESS STRIP */}
        <WeekProgressStrip />

    </div>
  );
}
