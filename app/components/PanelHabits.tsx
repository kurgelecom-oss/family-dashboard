"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";

const HABITS = [
  { id: "wake",       block: "pre",    points: 0 },
  { id: "fajr",       block: "pre",    points: 0 },
  { id: "bed",        block: "pre",    points: 0 },
  { id: "movement",   block: "pre",    points: 0 },
  { id: "breakfast",  block: "pre",    points: 0 },
  { id: "quran",      block: "pre",    points: 0 },
  { id: "goals",      block: "pre",    points: 2 },
  { id: "school",     block: "school", points: 3 },
  { id: "readtheory", block: "school", points: 1 },
  { id: "khan",       block: "school", points: 1 },
  { id: "journal",    block: "school", points: 1 },
  { id: "soccer",     block: "arvo",   points: 2 },
  { id: "btn",        block: "arvo",   points: 1 },
  { id: "namaz",      block: "arvo",   points: 1 },
  { id: "room",       block: "arvo",   points: 0 },
  { id: "shower",     block: "arvo",   points: 0 },
  { id: "teeth",      block: "arvo",   points: 0 },
  { id: "reading",    block: "arvo",   points: 1 },
];

const HABIT_POINTS: Record<string, number> = Object.fromEntries(HABITS.map(h => [h.id, h.points]));

const BASE_HABITS = HABITS.filter(h => h.id !== "soccer");
const BLOCKS = [
  { id: "pre",    label: "Pre-School", color: "var(--amber)" },
  { id: "school", label: "Homeschool", color: "var(--cyan)" },
  { id: "arvo",   label: "Evening",    color: "#a78bfa" },
];

export default function PanelHabits() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("completed_date", getTodayDate());
    if (!error && data) {
      const map: Record<string, boolean> = {};
      data.forEach((r: { habit_id: string }) => { map[r.habit_id] = true; });
      setCompleted(map);
    }

    const weekStart = getWeekStart();
    const today = getTodayDate();
    const { data: weekData, error: weekErr } = await supabase
      .from("habit_completions")
      .select("habit_id, completed_date")
      .gte("completed_date", weekStart)
      .lte("completed_date", today);
    if (!weekErr && weekData) {
      let total = 0;
      weekData.forEach((r: { habit_id: string }) => { total += HABIT_POINTS[r.habit_id] || 0; });
      setWeeklyPts(total);
    }

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
    <div className="card">
      <div className="card-header">
        <div className="card-title">Ansar · Habits</div>
        <a
          href="/ansar"
          style={{
            fontSize: 10, color: "var(--amber)", textDecoration: "none",
            fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            background: "rgba(245,166,35,0.1)", padding: "2px 7px", borderRadius: 4,
            border: "1px solid rgba(245,166,35,0.2)", display: "inline-flex",
          }}
        >
          Full page →
        </a>
      </div>

      {/* Hero stats */}
      <div className="stat-pair" style={{ flex: "0 0 auto" }}>
        <div className="stat-box">
          <div className="stat-box-num cyan">{mounted ? todayPts : "—"}</div>
          <div className="stat-box-label">Today pts</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-num green">{mounted && weeklyPts !== null ? weeklyPts : "—"}</div>
          <div className="stat-box-label">This week</div>
        </div>
      </div>

      {/* Streak */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "#a78bfa", fontVariantNumeric: "tabular-nums" }}>
          {mounted && streak !== null ? streak : "—"}
        </span>
        {mounted && streak !== null && streak > 0 && <span style={{ fontSize: 14 }}>🔥</span>}
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          day streak
        </span>
      </div>

      <div className="divider" style={{ margin: "8px 0" }} />

      {/* Block progress */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {BLOCKS.map(block => {
          const bHabits = BASE_HABITS.filter(h => h.block === block.id);
          const bDone = bHabits.filter(h => completed[h.id]).length;
          return (
            <div key={block.id} style={{ marginBottom: 8 }}>
              <div className="progress-row">
                <span className="list-label">{block.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: block.color }}>{bDone}/{bHabits.length}</span>
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

      <div className="divider" style={{ margin: "4px 0 6px" }} />

      {/* Daily overall */}
      <div style={{ flexShrink: 0 }}>
        <div className="progress-row">
          <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Daily progress</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{mounted ? pct : 0}%</span>
        </div>
        <div className="progress-track thick">
          <div className="progress-fill" style={{
            width: mounted ? `${pct}%` : "0%",
            background: "linear-gradient(90deg, var(--amber), var(--green))",
          }} />
        </div>
      </div>
    </div>
  );
}
