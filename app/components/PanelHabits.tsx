"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate } from "../lib/supabase";

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
  { id: "btn",       block: "arvo",   points: 1 },
  { id: "namaz",     block: "arvo",   points: 1 },
  { id: "room",      block: "arvo",   points: 0 },
  { id: "shower",    block: "arvo",   points: 0 },
  { id: "teeth",     block: "arvo",   points: 0 },
  { id: "reading",   block: "arvo",   points: 1 },
];

const BLOCKS = [
  { id: "pre",    label: "Pre-School", color: "#f59e0b" },
  { id: "school", label: "Homeschool", color: "#00c9ff" },
  { id: "arvo",   label: "Evening",    color: "#a78bfa" },
];

export default function PanelHabits() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

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
  }, []);

  useEffect(() => {
    setMounted(true);
    load();
    // Poll every 10 seconds for live updates from Ansar's device
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const todayPts = HABITS.filter(h => completed[h.id]).reduce((a, h) => a + h.points, 0);
  const todayDone = HABITS.filter(h => completed[h.id]).length;
  const pct = Math.round((todayDone / HABITS.length) * 100);

  return (
    <div className="panel col-4">
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
        }}>Ansar's Page →</a>
      </div>

      <div className="stat-grid stat-grid-2" style={{ flex: "0 0 auto" }}>
        <div className="stat-cell">
          <div className="stat-num lg cyan">{mounted ? todayPts : "—"}</div>
          <div className="stat-sublabel">Points today</div>
        </div>
        <div className="stat-cell">
          <div className="stat-num lg">{mounted ? `${todayDone}/${HABITS.length}` : "—"}</div>
          <div className="stat-sublabel">Habits done</div>
        </div>
      </div>

      <div className="divider" />

      <div style={{ flex: 1 }}>
        {BLOCKS.map(block => {
          const bHabits = HABITS.filter(h => h.block === block.id);
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
