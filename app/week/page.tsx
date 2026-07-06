"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";

// ─── Theme (mirrors Header.tsx so /week matches the dashboard) ──────────────
function getAestHour(): number {
  return (new Date().getUTCHours() + 10) % 24;
}
function getAutoTheme(): "day" | "night" {
  return getAestHour() >= 17 ? "night" : "day";
}

// ─── ANSAR FC scoring — exact copy of the ansar-habits-tracker re-align ─────
// Block-based, NOT per-habit sums. Daily max 10 (11 on Mon/Wed training days).
const SOCCER_DAYS = ["Monday", "Wednesday"];

const PRE_HABIT_IDS = ["feet_floor", "fajr", "bed_dressed", "movement", "breakfast", "quran", "goals"];
const BASE_IDS = [
  ...PRE_HABIT_IDS,
  "homeschool_session", "readtheory", "khan", "journal",
  "btn_cornell", "all_namaz", "room_tidy", "shower", "teeth", "reading",
];
function visibleIds(dayName: string): string[] {
  return SOCCER_DAYS.includes(dayName) ? [...BASE_IDS, "soccer_training"] : BASE_IDS;
}

function scoreDay(completedIds: Set<string>, dayName: string) {
  const hasSoccer = SOCCER_DAYS.includes(dayName);

  const pre = PRE_HABIT_IDS.every(id => completedIds.has(id)) ? 2 : 0;

  let school = 0;
  if (completedIds.has("homeschool_session")) school += 3;
  if (completedIds.has("readtheory") && completedIds.has("khan")) school += 1;
  if (completedIds.has("journal")) school += 1;

  let arvo = 0;
  if (completedIds.has("btn_cornell")) arvo += 1;
  if (completedIds.has("all_namaz")) arvo += 1;

  const conditional = hasSoccer && completedIds.has("soccer_training") ? 1 : 0;

  const ids = visibleIds(dayName);
  const perfect = ids.length > 0 && ids.every(id => completedIds.has(id));
  const bonus = perfect ? 1 : 0;

  return { total: pre + school + arvo + conditional + bonus, perfect };
}

// Weekly max = 56 (incl. +3 streak bonus for 5 Perfect Days Mon–Fri).
const WEEKLY_MAX = 56;

const THRESHOLDS = [
  { min: 42, label: "First Team 🏆",      color: "var(--green)" },
  { min: 34, label: "Bench ✅",           color: "var(--cyan)" },
  { min: 26, label: "Reserves ⚠️",        color: "var(--amber)" },
  { min: 0,  label: "Training Ground ❌", color: "var(--red)" },
];
function getThreshold(pts: number) {
  return THRESHOLDS.find(t => pts >= t.min) || THRESHOLDS[THRESHOLDS.length - 1];
}

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
  const [todayPts, setTodayPts] = useState<number | null>(null);
  const [todayPerfect, setTodayPerfect] = useState(false);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

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

  const loadHabits = useCallback(async () => {
    const ws = getWeekStart();
    const today = getTodayDate();

    const { data, error } = await supabase
      .from("habit_completions")
      .select("habit_id, completed_date")
      .gte("completed_date", ws)
      .lte("completed_date", today);

    if (!error && data) {
      const byDate: Record<string, Set<string>> = {};
      data.forEach((r: { habit_id: string; completed_date: string }) => {
        if (!byDate[r.completed_date]) byDate[r.completed_date] = new Set();
        byDate[r.completed_date].add(r.habit_id);
      });

      let total = 0;
      Object.keys(byDate).forEach(ds => {
        total += scoreDay(byDate[ds], dayNameOf(ds)).total;
      });

      // Weekly streak bonus: 5 Perfect Days Mon–Fri = +3 to weekly total.
      const weekdayDates = [0, 1, 2, 3, 4].map(i => addDays(ws, i));
      const allWeekdaysPerfect = weekdayDates.every(
        ds => byDate[ds] && scoreDay(byDate[ds], dayNameOf(ds)).perfect
      );
      if (allWeekdaysPerfect) total += 3;
      setWeeklyPts(total);

      const todayScore = scoreDay(byDate[today] ?? new Set(), dayNameOf(today));
      setTodayPts(todayScore.total);
      setTodayPerfect(todayScore.perfect);
    }

    // Day streak: consecutive days with ≥5 completions (same rule as the tracker)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const { data: streakData } = await supabase
      .from("habit_completions")
      .select("completed_date")
      .gte("completed_date", cutoff.toISOString().split("T")[0]);
    if (streakData) {
      const counts: Record<string, number> = {};
      streakData.forEach((r: { completed_date: string }) => {
        counts[r.completed_date] = (counts[r.completed_date] || 0) + 1;
      });
      let s = 0;
      const check = new Date();
      for (let i = 0; i <= 60; i++) {
        const d = new Date(check);
        d.setDate(check.getDate() - i);
        const ds = d.toISOString().split("T")[0];
        if ((counts[ds] || 0) >= 5) s++;
        else if (i === 0) continue;
        else break;
      }
      setStreak(s);
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

    setMounted(true);
    loadSchedule();
    loadCalendar();
    loadHabits();
    const id = setInterval(() => { loadCalendar(); loadHabits(); }, 60_000);
    const themeId = setInterval(applyTheme, 60_000);
    return () => { clearInterval(id); clearInterval(themeId); };
  }, [loadSchedule, loadCalendar, loadHabits]);

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

  const tier = getThreshold(weeklyPts ?? 0);

  return (
    // Mirrors .dashboard (globals.css): fixed-viewport flex column, no page scroll
    <div style={{ height: "100dvh", width: "100vw", overflow: "hidden", display: "flex", flexDirection: "column", gap: 12, padding: 12, background: "var(--bg-base)" }}>

        {/* HEADER */}
        <div className="header">
          <div className="header-brand">
            <div className="header-name">ANSAR <span style={{ color: ANSAR }}>· WEEK</span></div>
            <div className="header-sub">Nihal&apos;s weekly view · ANSAR FC</div>
          </div>
          <a href="/" style={{
            fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6,
            padding: "8px 14px",
          }}>← Dashboard</a>
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
        <div className="card" style={{ flex: "none" }}>
          <div className="card-header">
            <div className="card-title">Ansar · ANSAR FC progress</div>
            <span className="badge" style={{ background: "rgba(245,166,35,0.15)", color: tier.color }}>{tier.label}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <div className="stat-box">
              <div className="stat-box-num amber">
                {mounted && todayPts !== null ? todayPts : "—"}{mounted && todayPerfect ? " ⭐" : ""}
              </div>
              <div className="stat-box-label">Points today</div>
            </div>
            <div className="stat-box">
              <div className="stat-box-num green">{mounted && weeklyPts !== null ? weeklyPts : "—"}</div>
              <div className="stat-box-label">Week total · /{WEEKLY_MAX}</div>
            </div>
            <div className="stat-box">
              <div className="stat-box-num cyan">{mounted && streak !== null ? `${streak}${streak > 0 ? " 🔥" : ""}` : "—"}</div>
              <div className="stat-box-label">Day streak</div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="progress-track thick">
              <div className="progress-fill" style={{
                width: `${Math.min(100, Math.round(((weeklyPts ?? 0) / WEEKLY_MAX) * 100))}%`,
                background: ANSAR,
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              {THRESHOLDS.slice().reverse().map(t => (
                <span key={t.min} style={{ fontSize: 10, fontWeight: 600, color: (weeklyPts ?? 0) >= t.min ? t.color : "var(--text-muted)" }}>
                  {t.label} · {t.min}+
                </span>
              ))}
            </div>
          </div>
        </div>

    </div>
  );
}
