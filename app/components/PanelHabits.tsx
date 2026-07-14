"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";

// ─── ANSAR FC block-based scoring — exact copy of app/week/page.tsx ─────────
// Block-based, NOT per-habit sums. Daily max 10 (11 on Mon/Wed training days).
// Habit list (id/block/order) is now sourced from Notion via /api/habits —
// only the specific-habit-id checks below are still literal, since they
// encode which habits carry which bonus, not just which block they're in.
const SOCCER_DAYS = ["Monday", "Wednesday"];

interface Habit {
  id: string;
  name: string;
  block: string;
  order: number;
  points: number;
  pointType: string;
}

function visibleIds(dayName: string, baseIds: string[]): string[] {
  return SOCCER_DAYS.includes(dayName) ? [...baseIds, "soccer_training"] : baseIds;
}

function scoreDay(completedIds: Set<string>, dayName: string, preIds: string[], baseIds: string[]) {
  const hasSoccer = SOCCER_DAYS.includes(dayName);

  const pre = preIds.length > 0 && preIds.every(id => completedIds.has(id)) ? 2 : 0;

  let school = 0;
  if (completedIds.has("homeschool_session")) school += 3;
  if (completedIds.has("readtheory") && completedIds.has("khan")) school += 1;
  if (completedIds.has("journal")) school += 1;

  let arvo = 0;
  if (completedIds.has("btn_cornell")) arvo += 1;
  if (completedIds.has("all_namaz")) arvo += 1;

  const conditional = hasSoccer && completedIds.has("soccer_training") ? 1 : 0;

  const ids = visibleIds(dayName, baseIds);
  const perfect = ids.length > 0 && ids.every(id => completedIds.has(id));
  const bonus = perfect ? 1 : 0;

  return { total: pre + school + arvo + conditional + bonus, perfect };
}

// Weekly max = 56 (incl. +3 streak bonus for 5 Perfect Days Mon–Fri).
const WEEKLY_MAX = 56;

const THRESHOLDS = [
  { min: 42, label: "First Team" },
  { min: 34, label: "Bench" },
  { min: 26, label: "Reserves" },
  { min: 0,  label: "Training Ground" },
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

const BLOCKS = [
  { id: "pre",    label: "Pre-School", color: "var(--amber)" },
  { id: "school", label: "Homeschool", color: "var(--cyan)" },
  { id: "arvo",   label: "Evening",    color: "#a78bfa" },
];

export default function PanelHabits() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [habits, setHabits] = useState<Habit[]>([]);
  const [pointsActive, setPointsActive] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);

  const loadHabitList = useCallback(async () => {
    try {
      const res = await fetch("/api/habits");
      const data = await res.json();
      setHabits(Array.isArray(data) ? data : []);
    } catch {
      setHabits([]);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setPointsActive(data?.pointsActive ?? true);
    } catch {
      // keep previous value on failure
    }
  }, []);

  const load = useCallback(async (preIds: string[], baseIds: string[]) => {
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
      const byDate: Record<string, Set<string>> = {};
      weekData.forEach((r: { habit_id: string; completed_date: string }) => {
        if (!byDate[r.completed_date]) byDate[r.completed_date] = new Set();
        byDate[r.completed_date].add(r.habit_id);
      });

      let total = 0;
      Object.keys(byDate).forEach(ds => {
        total += scoreDay(byDate[ds], dayNameOf(ds), preIds, baseIds).total;
      });

      // Weekly streak bonus: 5 Perfect Days Mon–Fri = +3 to weekly total.
      const weekdayDates = [0, 1, 2, 3, 4].map(i => addDays(weekStart, i));
      const allWeekdaysPerfect = weekdayDates.every(
        ds => byDate[ds] && scoreDay(byDate[ds], dayNameOf(ds), preIds, baseIds).perfect
      );
      if (allWeekdaysPerfect) total += 3;

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
    loadHabitList();
    loadSettings();
  }, [loadHabitList, loadSettings]);

  useEffect(() => {
    if (habits.length === 0) return;
    const preIds = habits.filter(h => h.block === "pre").map(h => h.id);
    const baseIds = habits.filter(h => h.block !== "conditional").map(h => h.id);
    load(preIds, baseIds);
    const interval = setInterval(() => load(preIds, baseIds), 10000);
    return () => clearInterval(interval);
  }, [habits, load]);

  const baseHabits = habits.filter(h => h.block !== "conditional");
  const preIds = baseHabits.filter(h => h.block === "pre").map(h => h.id);
  const baseIds = baseHabits.map(h => h.id);

  const todayName = new Date().toLocaleDateString("en-AU", { weekday: "long" });
  const todayScore = scoreDay(new Set(Object.keys(completed).filter(k => completed[k])), todayName, preIds, baseIds);
  const todayPts = todayScore.total;
  const todayDone = baseHabits.filter(h => completed[h.id]).length;
  const pct = baseHabits.length > 0 ? Math.round((todayDone / baseHabits.length) * 100) : 0;
  const tier = getThreshold(weeklyPts ?? 0);
  const showPoints = mounted && pointsActive;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Ansar · Habits</div>
        <a
          href="https://ansar-habits-tracker.netlify.app/"
          target="_blank"
          rel="noopener noreferrer"
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
          <div className="stat-box-num cyan">{showPoints ? todayPts : "—"}{showPoints && todayScore.perfect ? " ⭐" : ""}</div>
          <div className="stat-box-label">Today pts</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-num green">{showPoints && weeklyPts !== null ? weeklyPts : "—"}</div>
          <div className="stat-box-label">Week /{WEEKLY_MAX} · {showPoints ? tier.label : "—"}</div>
        </div>
      </div>

      {/* Streak */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: "#a78bfa", fontVariantNumeric: "tabular-nums" }}>
          {showPoints && streak !== null ? streak : "—"}
        </span>
        {showPoints && streak !== null && streak > 0 && <span style={{ fontSize: 14 }}>🔥</span>}
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          day streak
        </span>
      </div>

      <div className="divider" style={{ margin: "8px 0" }} />

      {/* Block progress */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {BLOCKS.map(block => {
          const bHabits = baseHabits.filter(h => h.block === block.id);
          const bDone = bHabits.filter(h => completed[h.id]).length;
          return (
            <div key={block.id} style={{ marginBottom: 4 }}>
              <div className="progress-row">
                <span className="list-label">{block.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: block.color }}>{bDone}/{bHabits.length}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{
                  width: mounted && bHabits.length > 0 ? `${(bDone / bHabits.length) * 100}%` : "0%",
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
