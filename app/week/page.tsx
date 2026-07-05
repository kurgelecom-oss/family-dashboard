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

// ─── Week grid config ────────────────────────────────────────────────────────
const ANSAR = "var(--amber)"; // Ansar = orange across the dashboard

const TIME_BLOCKS = [
  { id: "morning",    label: "Morning",    time: "6:45–8:30am",    desc: "Phase 1 · Pre-homeschool", tall: true },
  { id: "homeschool", label: "Homeschool", time: "8:30am–3:30pm",  desc: "4-hr session · ReadTheory · Khan · journal", tall: true },
  { id: "checkpoint", label: "Checkpoint", time: "3:30pm",         desc: "Nihal habit check", tall: false },
  { id: "evening",    label: "Evening",    time: "3:30–9:30pm",    desc: "BTN · Namaz · room · reading", tall: true },
  { id: "lightsout",  label: "Lights out", time: "9:30pm",         desc: "", tall: false },
];

// dayIdx 0 = Monday (weekStart is Monday), matching the Notion Days options
const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Row from /api/schedule (Notion "ANSAR OS — Weekly Schedule" data source)
type ScheduleRow = { block: string; time: string; order: number; detail: string; emoji: string; days: string[] };

// "Lights out" → "lightsout" so rows keep the ids blockForTime() targets
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Fixed weekly commitments (soccer is also a Conditional habit worth +1/session)
const STATIC_EVENTS: { dayIdx: number; block: string; label: string; time: string }[] = [
  { dayIdx: 0, block: "evening", label: "⚽ Soccer", time: "7:00–8:30pm" }, // Monday
  { dayIdx: 2, block: "evening", label: "⚽ Soccer", time: "6:00–7:30pm" }, // Wednesday
];

function blockForTime(h: number, m: number): string {
  const t = h + m / 60;
  if (t < 8.5) return "morning";
  if (t < 15.5) return "homeschool";
  if (t < 21.5) return "evening";
  return "lightsout";
}

type ApiEvent = {
  id: string; subject: string; startISO: string; endISO: string;
  isAllDay: boolean; account: string; email: string; color: string;
};
type GridEvent = { dayIdx: number; block: string; label: string; time: string; real: boolean };

// /api/calendar returns bare UTC datetimes (Prefer: outlook.timezone="UTC")
function parseUTC(s: string): Date {
  return new Date(/Z|[+-]\d{2}:\d{2}$/.test(s) ? s : s + "Z");
}

export default function WeekPage() {
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
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
      const rows = (await res.json()) as ScheduleRow[];
      if (Array.isArray(rows) && rows.length > 0) setSchedule(rows);
    } catch {
      // schedule is best-effort; hardcoded TIME_BLOCKS remain as fallback
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
        // Static soccer chips already cover Mon/Wed training — skip API duplicates
        if (/soccer/i.test(e.subject) && (dayIdx === 0 || dayIdx === 2)) return;
        const end = parseUTC(e.endISO);
        const fmt = (d: Date) => d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
        out.push({
          dayIdx,
          block: e.isAllDay ? "morning" : blockForTime(start.getHours(), start.getMinutes()),
          label: `📅 ${e.subject}`,
          time: e.isAllDay ? "All day" : `${fmt(start)}–${fmt(end)}`,
          real: true,
        });
      });
      setEvents(out);
    } catch {
      // calendar strip is best-effort; grid still renders without it
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
    // Match the dashboard's theme behaviour (Header.tsx) since /week has no Header
    const stored = localStorage.getItem("themeOverride") as "day" | "night" | null;
    document.documentElement.setAttribute("data-theme", stored ?? getAutoTheme());

    setMounted(true);
    loadSchedule();
    loadCalendar();
    loadHabits();
    const id = setInterval(() => { loadCalendar(); loadHabits(); }, 60_000);
    return () => clearInterval(id);
  }, [loadSchedule, loadCalendar, loadHabits]);

  const allEvents: GridEvent[] = [
    ...STATIC_EVENTS.map(e => ({ ...e, real: false })),
    ...events,
  ];

  // Rows from /api/schedule; hardcoded TIME_BLOCKS as fallback while loading
  // or if the route returns empty. Fallback rows fill all 7 days (old look).
  const timeBlocks = schedule.length > 0
    ? schedule.map(r => ({
        id: slugify(r.block),
        label: r.block,
        time: r.time,
        desc: r.detail,
        emoji: r.emoji,
        tall: /[–-]/.test(r.time),
        days: r.days,
      }))
    : TIME_BLOCKS.map(b => ({ ...b, emoji: "", days: [...DAY_KEYS] }));

  const tier = getThreshold(weeklyPts ?? 0);

  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "var(--bg-base)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 20px 40px" }}>

        {/* HEADER */}
        <div className="header" style={{ marginBottom: 16 }}>
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

        {/* WEEK GRID */}
        <div className="card" style={{ padding: 0, overflow: "visible", flex: "none", marginBottom: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 860, display: "grid", gridTemplateColumns: "150px repeat(7, 1fr)" }}>

              {/* Day header row */}
              <div style={{ borderBottom: "1px solid var(--border)" }} />
              {weekDates.map((ds, i) => {
                const isToday = i === todayIdx;
                return (
                  <div key={ds} style={{
                    textAlign: "center", padding: "10px 6px",
                    borderBottom: isToday ? `2px solid ${ANSAR}` : "1px solid var(--border)",
                    borderLeft: "1px solid var(--border)",
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

              {/* Time-block rows */}
              {timeBlocks.map(block => {
                const isCheckpoint = block.id === "checkpoint";
                const isLightsOut = block.id === "lightsout";
                return (
                  <div key={block.id} style={{ display: "contents" }}>
                    {/* Row label */}
                    <div style={{
                      padding: "10px 12px", borderBottom: "1px solid var(--border)",
                      minHeight: block.tall ? 84 : 44,
                      background: isCheckpoint ? "rgba(245,166,35,0.06)" : "transparent",
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isCheckpoint ? ANSAR : "var(--text-primary)" }}>
                        {block.emoji ? `${block.emoji} ` : isCheckpoint ? "🔎 " : isLightsOut ? "🌙 " : ""}{block.label}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{block.time}</div>
                      {block.desc && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{block.desc}</div>}
                    </div>

                    {/* Day cells */}
                    {weekDates.map((ds, i) => {
                      const isToday = i === todayIdx;
                      // days[] decides which columns this row fills; calendar
                      // events still overlay in any cell regardless of fill.
                      const filled = block.days.includes(DAY_KEYS[i]);
                      const cellEvents = allEvents.filter(e => e.dayIdx === i && e.block === block.id);
                      return (
                        <div key={`${block.id}-${ds}`} style={{
                          borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)",
                          minHeight: block.tall ? 84 : 44, padding: 6,
                          background: isToday
                            ? (isCheckpoint && filled ? "rgba(245,166,35,0.14)" : "rgba(245,166,35,0.10)")
                            : (isCheckpoint && filled ? "rgba(245,166,35,0.04)" : "transparent"),
                          display: "flex", flexDirection: "column", gap: 4,
                          opacity: filled || cellEvents.length > 0 ? 1 : 0.35,
                        }}>
                          {isCheckpoint && filled && (
                            <div style={{ fontSize: 10, fontWeight: 600, color: ANSAR, textAlign: "center", opacity: isToday ? 1 : 0.55, marginTop: 4 }}>
                              ✓ {block.time} check
                            </div>
                          )}
                          {isLightsOut && filled && (
                            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textAlign: "center", marginTop: 4 }}>
                              {block.time}
                            </div>
                          )}
                          {cellEvents.map((e, j) => (
                            <div key={j} style={{
                              background: e.real ? "rgba(0,212,255,0.10)" : "rgba(245,166,35,0.14)",
                              border: `1px solid ${e.real ? "rgba(0,212,255,0.35)" : "rgba(245,166,35,0.4)"}`,
                              borderRadius: 5, padding: "5px 7px",
                            }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>
                              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{e.time}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
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
    </div>
  );
}
