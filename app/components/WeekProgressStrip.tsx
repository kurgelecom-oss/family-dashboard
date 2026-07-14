"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";

// ─── ANSAR FC scoring — exact copy of the ansar-habits-tracker re-align ─────
// Block-based, NOT per-habit sums. Daily max 10 (11 on Mon/Wed training days).
// Moved verbatim from app/week/page.tsx.
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

const ANSAR = "var(--amber)"; // Ansar = orange across the dashboard

export default function WeekProgressStrip() {
  const [todayPts, setTodayPts] = useState<number | null>(null);
  const [todayPerfect, setTodayPerfect] = useState(false);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [pointsActive, setPointsActive] = useState(true);

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

  const loadHabits = useCallback(async (preIds: string[], baseIds: string[]) => {
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
        total += scoreDay(byDate[ds], dayNameOf(ds), preIds, baseIds).total;
      });

      // Weekly streak bonus: 5 Perfect Days Mon–Fri = +3 to weekly total.
      const weekdayDates = [0, 1, 2, 3, 4].map(i => addDays(ws, i));
      const allWeekdaysPerfect = weekdayDates.every(
        ds => byDate[ds] && scoreDay(byDate[ds], dayNameOf(ds), preIds, baseIds).perfect
      );
      if (allWeekdaysPerfect) total += 3;
      setWeeklyPts(total);

      const todayScore = scoreDay(byDate[today] ?? new Set(), dayNameOf(today), preIds, baseIds);
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
    setMounted(true);
    loadHabitList();
    loadSettings();
  }, [loadHabitList, loadSettings]);

  useEffect(() => {
    if (habits.length === 0) return;
    const preIds = habits.filter(h => h.block === "pre").map(h => h.id);
    const baseIds = habits.filter(h => h.block !== "conditional").map(h => h.id);
    loadHabits(preIds, baseIds);
    const id = setInterval(() => loadHabits(preIds, baseIds), 60_000);
    return () => clearInterval(id);
  }, [habits, loadHabits]);

  const tier = getThreshold(weeklyPts ?? 0);
  const showPoints = mounted && pointsActive;

  return (
    <div className="card" style={{ flex: "none" }}>
      <div className="card-header">
        <div className="card-title">Ansar · ANSAR FC progress</div>
        <span className="badge" style={{ background: "rgba(245,166,35,0.15)", color: tier.color }}>{showPoints ? tier.label : "—"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <div className="stat-box">
          <div className="stat-box-num amber">
            {showPoints && todayPts !== null ? todayPts : "—"}{showPoints && todayPerfect ? " ⭐" : ""}
          </div>
          <div className="stat-box-label">Points today</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-num green">{showPoints && weeklyPts !== null ? weeklyPts : "—"}</div>
          <div className="stat-box-label">Week total · /{WEEKLY_MAX}</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-num cyan">{showPoints && streak !== null ? `${streak}${streak > 0 ? " 🔥" : ""}` : "—"}</div>
          <div className="stat-box-label">Day streak</div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="progress-track thick">
          <div className="progress-fill" style={{
            width: `${showPoints ? Math.min(100, Math.round(((weeklyPts ?? 0) / WEEKLY_MAX) * 100)) : 0}%`,
            background: ANSAR,
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          {THRESHOLDS.slice().reverse().map(t => (
            <span key={t.min} style={{ fontSize: 10, fontWeight: 600, color: showPoints && (weeklyPts ?? 0) >= t.min ? t.color : "var(--text-muted)" }}>
              {t.label} · {t.min}+
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
