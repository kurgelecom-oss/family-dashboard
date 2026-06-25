"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";

const HABITS = [
  { id: "wake",      block: "pre",    points: 0 },
  { id: "fajr",      block: "pre",    points: 0 },
  { id: "bed",       block: "pre",    points: 0 },
  { id: "movement",  block: "pre",    points: 0 },
  { id: "breakfast", block: "pre",    points: 0 },
  { id: "quran",     block: "pre",    points: 0 },
  { id: "goals",     block: "pre",    points: 2 },
  { id: "school",    block: "school", points: 3 },
  { id: "readtheory",block: "school", points: 1 },
  { id: "khan",      block: "school", points: 1 },
  { id: "journal",   block: "school", points: 1 },
  { id: "soccer",    block: "arvo",   points: 2 }, // conditional Mon/Wed — counted if present
  { id: "btn",       block: "arvo",   points: 1 },
  { id: "namaz",     block: "arvo",   points: 1 },
  { id: "room",      block: "arvo",   points: 0 },
  { id: "shower",    block: "arvo",   points: 0 },
  { id: "teeth",     block: "arvo",   points: 0 },
  { id: "reading",   block: "arvo",   points: 1 },
];

const HABIT_POINTS: Record<string, number> = Object.fromEntries(HABITS.map(h => [h.id, h.points]));

const BASE_HABITS = HABITS.filter(h => h.id !== "soccer"); // non-conditional count for display
const BLOCKS = [
  { id: "pre",    label: "Pre-School", color: "#f59e0b" },
  { id: "school", label: "Homeschool", color: "#00c9ff" },
  { id: "arvo",   label: "Evening",    color: "#a78bfa" },
];

export default function PanelHabits() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);

  const load = useCallback(async () => {
    // Today's completions
    const { data, error } = await supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("completed_date", getTodayDate());
    if (!error && data) {
      const map: Record<string, boolean> = {};
      data.forEach((r: { habit_id: string }) => { map[r.habit_id] = true; });
      setCompleted(map);
    }

    // Weekly points
    const weekStart = getWeekStart();
    const today = getTodayDate();
    const { data: weekData, error: weekErr } = await supabase
      .from("habit_completions")
      .select("habit_id, completed_date")
      .gte("completed_date", weekStart)
      .lte("completed_date", today);
    if (!weekErr && weekData) {
      let total = 0;
      weekData.forEach((r: { habit_id: string }) => {
        total += HABIT_POINTS[r.habit_id] || 0;
      });
      setWeeklyPts(total);
    }

    // Streak: consecutive days with >=5 completions
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const { data: streakData } = await supabase
      .from("habit_completions")
      .select("completed_date")
      .gte("completed_date", cutoffStr);
    if (streakData) {
      const byDate: Record<string, number> = {};
      streakData.forEach((r: { completed_date: string }) => {
        byDate[r.completed_date] = (byDate[r.completed_date] || 0) + 1;
      });
      let s = 0;
      const check = new Date();
      for (let i = 0; i <= 60; i++) {
        const d = new Date(check);
        d.setDate(check.getDate() - i);
        const ds = d.toISOString().split("T")[0];
        if ((byDate[ds] || 0) >= 5) {
          s++;
        } else if (i === 0) {
          continue;
        } else {
          break;
        }
      }
      setStreak(s);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const todayPts = HABITS.filter(h => completed[h.id]).reduce((a, h) => a + h.points, 0);
  const todayDone = BASE_HABITS.filter(h => completed[h.id]).length;
  const pct = Math.round((todayDone / BASE_HABITS.length) * 100);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="panel-title">Ansar · Daily Habits</div>
          <div className="panel-subtitle">
            Live · {mounted ? new Date().toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : ""}
          </div>
        </div>
        <a href="/ansar" style={{
          fontSize: 10, color: "#f59e0b", textDecoration: "none",
          fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          background: "rgba(245,158,11,0.1)", padding: "3px 8px", borderRadius: 4,
          border: "1px solid rgba(245,158,11,0.2)",
        }}>Ansar&apos;s Page →</a>
      </div>

      {/* STATS: today pts / weekly pts / streak */}
      <div className="stat-grid stat-grid-3" style={{ flex: "0 0 auto", gap: 4 }}>
        <div className="stat-cell">
          <div className="stat-num lg cyan">{mounted ? todayPts : "—"}</div>
          <div className="stat-sublabel">Today</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num lg" style={{ color: "#2ecc71" }}>{mounted && weeklyPts !== null ? weeklyPts : "—"}</div>
          <div className="stat-sublabel">This week</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num lg" style={{ color: "#a78bfa", display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
            {mounted && streak !== null ? streak : "—"}
            {mounted && streak !== null && streak > 0 && <span style={{ fontSize: 14 }}>🔥</span>}
          </div>
          <div className="stat-sublabel">Streak</div>
        </div>
      </div>

      <div className="divider" />

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {BLOCKS.map(block => {
          const bHabits = BASE_HABITS.filter(h => h.block === block.id);
          const bDone = bHabits.filter(h => completed[h.id]).length;
          return (
            <div key={block.id} style={{ marginBottom: 8 }}>
              <div className="progress-row">
                <span className="list-name">{block.label}</span>
                <span className="list-val" style={{ fontSize: 12, color: block.color }}>{bDone}/{bHabits.length}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{
                  width: mounted ? `${(bDone / bHabits.length) * 100}%` : "0%",
                  background: block.color,
                }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="divider" />

      <div>
        <div className="progress-row">
          <span className="num-label">Daily progress</span>
          <span className="num-label">{mounted ? pct : 0}%</span>
        </div>
        <div className="progress-track" style={{ height: 10 }}>
          <div className="progress-fill" style={{
            width: mounted ? `${pct}%` : "0%",
            background: "linear-gradient(90deg, #f59e0b, #2ecc71)",
          }} />
        </div>
      </div>
    </div>
  );
}
