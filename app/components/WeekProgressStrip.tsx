"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";
import { scoreDay } from "../lib/scoring";
// Mirrored byte-for-byte with ansar-habits-tracker/app/lib/streak.ts — see the
// header there, and scripts/check-scoring-sync.sh which guards the pair.
import { calculateStreak, STREAK_LOOKBACK_DAYS } from "../lib/streak";
// addDays is aliased: this file already has a local string-based addDays used by
// the weekly scoring below, and lib/time's operates on CivilDate. Two different
// functions, so the civil one is renamed rather than shadowing anything.
import { zoneToday, isoDate, addDays as addCivilDays } from "../lib/time";
// The per-date roster rule, shared with PanelHabits. Weekday and weekend no
// longer schedule the same habits, so "which habits count today" is a real
// question rather than "all of them".
import { habitsOnDay } from "../lib/habit-days";

// ─── ANSAR FC scoring now lives in app/lib/scoring.ts ───────────────────────
// One canonical implementation, mirrored into ansar-habits-tracker. It was
// previously copied inline here, in PanelHabits.tsx and in the tracker, and the
// copies had drifted: this one scored a homeschool session as 3 + 1 + 1 across
// three habits where the tracker scored it a flat 5.

interface Habit {
  id: string;
  name: string;
  block: string;
  order: number;
  points: number;
  pointType: string;
  /** Notion "Days", three-letter form, e.g. ["Mon","Sat"]. Empty = every day. */
  days: string[];
}

/**
 * The days the squad total is made of. Mon–Fri, and nothing else, ever.
 *
 * Mirrors SQUAD_DAYS in ansar-habits-tracker/app/page.tsx — the two surfaces read
 * the same habit_completions rows and must report the same /55, which is the
 * whole reason lib/scoring.ts is hash-synced in the first place.
 *
 * This panel had NO day filter of any kind. It summed every date returned
 * between Monday and today and scored each against the full weekday roster,
 * which was harmless only while every habit was Mon–Fri and a weekend therefore
 * had no completions to find. Morning Habits and Afternoon/Evening are now
 * scheduled seven days a week, so without this a fully-ticked Saturday would add
 * up to 5 points to a ceiling with no room for them, and the dashboard would
 * disagree with the tracker about the same week.
 */
const SQUAD_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// Weekly max = 55 (incl. +3 streak bonus for 5 Perfect Days Mon–Fri):
// Mon 11 + Tue 10 + Wed 11 + Thu 10 + Fri 10 = 52, plus 3. It was 56, which no
// combination of ticks could reach, so the bar could never fill. Kept in step
// with lib/scoring.ts's WEEKLY_MAX by hand — this file declares its own copy.
const WEEKLY_MAX = 55;

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

  // Takes the habit LIST rather than pre-resolved id arrays, because the weekly
  // total and the daily number no longer want the same roster: the /55 is a
  // Mon–Fri number scored against the weekday list, while "Points today" has to
  // be scored against whatever is actually scheduled today.
  const loadHabits = useCallback(async (habits: Habit[]) => {
    const ws = getWeekStart();
    const today = getTodayDate();

    // The weekly roster, unchanged. Every date this loop scores is Mon–Fri (see
    // SQUAD_DAYS), and every non-conditional habit is scheduled Mon–Fri, so a
    // per-date resolve would return this same set — deriving it once keeps the
    // /55 provably identical to what it was.
    const preIds = habits.filter(h => h.block === "pre").map(h => h.id);
    const baseIds = habits.filter(h => h.block !== "conditional").map(h => h.id);

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
        // Weekend rows are skipped because of the DATE. Weekend habits exist and
        // are ticked; they earn the Stretch Wallet, not the squad total.
        if (!SQUAD_DAYS.includes(dayNameOf(ds))) return;
        total += scoreDay(byDate[ds], dayNameOf(ds), preIds, baseIds).total;
      });

      // Weekly streak bonus: 5 Perfect Days Mon–Fri = +3 to weekly total.
      const weekdayDates = [0, 1, 2, 3, 4].map(i => addDays(ws, i));
      const allWeekdaysPerfect = weekdayDates.every(
        ds => byDate[ds] && scoreDay(byDate[ds], dayNameOf(ds), preIds, baseIds).perfect
      );
      if (allWeekdaysPerfect) total += 3;
      setWeeklyPts(total);

      // TODAY'S roster, not the week's. Homeschool is Mon–Fri and soccer is
      // Mon/Wed, so scoring a Saturday against the weekday list reported a
      // perfect Saturday as 4 — homeschool_session missing from `completedIds`
      // kept `perfect` false — where the tracker read 5/5 off the same rows.
      const todayHabits = habitsOnDay(habits, dayNameOf(today));
      const todayScore = scoreDay(
        byDate[today] ?? new Set(),
        dayNameOf(today),
        todayHabits.filter(h => h.block === "pre").map(h => h.id),
        todayHabits.filter(h => h.block !== "conditional").map(h => h.id),
      );
      setTodayPts(todayScore.total);
      setTodayPerfect(todayScore.perfect);
    }

    // Day streak. The rule now lives in app/lib/streak.ts, mirrored
    // byte-for-byte with ansar-habits-tracker. It used to sit inline here and in
    // PanelHabits.tsx, held in step with the tracker by a comment reading "same
    // rule as the tracker" — which is exactly how all three drifted: when the
    // tracker moved to a weekday-only streak these two kept counting calendar
    // days and reported 8 where the tracker reported 14 off the same rows.
    //
    // The dates are Sydney civil dates via Intl (zoneToday → HOUSEHOLD_TZ),
    // replacing a `new Date()` + `toISOString().split("T")[0]` round-trip that
    // read the day in UTC. CLAUDE.md forbids that pattern and it was
    // load-bearing here: for the first ten hours of every Sydney day it named
    // yesterday, so the streak could read a day stale every morning.
    const todaySydney = zoneToday(new Date());
    const { data: streakData } = await supabase
      .from("habit_completions")
      .select("completed_date")
      .gte("completed_date", isoDate(addCivilDays(todaySydney, -STREAK_LOOKBACK_DAYS)));
    if (streakData) {
      const counts: Record<string, number> = {};
      streakData.forEach((r: { completed_date: string }) => {
        counts[r.completed_date] = (counts[r.completed_date] || 0) + 1;
      });
      setStreak(calculateStreak(counts, isoDate(todaySydney)));
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadHabitList();
    loadSettings();
  }, [loadHabitList, loadSettings]);

  useEffect(() => {
    if (habits.length === 0) return;
    loadHabits(habits);
    const id = setInterval(() => loadHabits(habits), 60_000);
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
