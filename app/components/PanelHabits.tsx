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
// The per-date roster rule, shared with WeekProgressStrip. Weekday and weekend
// no longer schedule the same habits, so "which habits count today" is a real
// question rather than "all of them".
import { habitsOnDay } from "../lib/habit-days";

// ─── ANSAR FC scoring now lives in app/lib/scoring.ts ───────────────────────
// One canonical implementation, mirrored into ansar-habits-tracker. It was
// previously copied inline here, in WeekProgressStrip.tsx and in the tracker,
// and the copies had drifted: this one scored a homeschool session as 3 + 1 + 1
// across three habits where the tracker scored it a flat 5.

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
 * Mirrors SQUAD_DAYS in WeekProgressStrip.tsx and in
 * ansar-habits-tracker/app/page.tsx — three surfaces, the same
 * habit_completions rows, one /55 between them.
 *
 * This panel had NO day filter of any kind. It summed every date returned
 * between Monday and today and scored each against the full weekday roster,
 * which was harmless only while every habit was Mon–Fri and a weekend therefore
 * had no completions to find. Morning Habits and Afternoon/Evening are now
 * scheduled seven days a week, so without this a fully-ticked Saturday would add
 * up to 5 points to a ceiling with no room for them.
 */
const SQUAD_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// Weekly max = 55 (incl. +3 streak bonus for 5 Perfect Days Mon–Fri):
// Mon 11 + Tue 10 + Wed 11 + Thu 10 + Fri 10 = 52, plus 3. It was 56, which no
// combination of ticks could reach. Kept in step with lib/scoring.ts's
// WEEKLY_MAX by hand — this file declares its own copy.
const WEEKLY_MAX = 55;

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
  // `id` is the data key (Notion Block select -> BLOCK_MAP in /api/habits, plus
  // the scoring math here and in WeekProgressStrip). Only `label` is displayed,
  // so renaming a label never touches stored data.
  { id: "pre",    label: "Morning Habits", color: "var(--amber)" },
  { id: "school", label: "Homeschool",     color: "var(--cyan)" },
  { id: "arvo",   label: "Evening",        color: "#a78bfa" },
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
        // Weekend rows are skipped because of the DATE. Weekend habits exist and
        // are ticked; they earn the Stretch Wallet, not the squad total.
        if (!SQUAD_DAYS.includes(dayNameOf(ds))) return;
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

    // Day streak. The rule now lives in app/lib/streak.ts, mirrored
    // byte-for-byte with ansar-habits-tracker. It used to sit inline here and in
    // WeekProgressStrip.tsx, held in step with the tracker by a comment — which
    // is exactly how all three drifted: when the tracker moved to a weekday-only
    // streak these two kept counting calendar days and reported 8 where the
    // tracker reported 14 off the same rows.
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
      const byDate: Record<string, number> = {};
      streakData.forEach((r: { completed_date: string }) => {
        byDate[r.completed_date] = (byDate[r.completed_date] || 0) + 1;
      });
      setStreak(calculateStreak(byDate, isoDate(todaySydney)));
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadHabitList();
    loadSettings();
  }, [loadHabitList, loadSettings]);

  useEffect(() => {
    if (habits.length === 0) return;
    // The WEEKLY roster, and deliberately not today's. Every date load() scores
    // is Mon–Fri (see SQUAD_DAYS), and every non-conditional habit is scheduled
    // Mon–Fri, so resolving per-date would return this same set — deriving it
    // once here keeps the /55 provably identical to what it was. Today's roster
    // is a different question, answered below with habitsOnDay().
    const weekPreIds = habits.filter(h => h.block === "pre").map(h => h.id);
    const weekBaseIds = habits.filter(h => h.block !== "conditional").map(h => h.id);
    load(weekPreIds, weekBaseIds);
    const interval = setInterval(() => load(weekPreIds, weekBaseIds), 10000);
    return () => clearInterval(interval);
  }, [habits, load]);

  // TODAY'S ROSTER, not the whole habit list. Homeschool is Mon–Fri and soccer
  // is Mon/Wed, so on a Saturday `habits` contains rows that are not scheduled
  // and must not be counted. Scoring the full list on a weekend was reporting a
  // perfect Saturday as 4 (homeschool_session missing kept `perfect` false) where
  // the tracker read 5/5 off the same rows — the two surfaces disagreeing about
  // the same day, which is the bug class this whole area keeps producing.
  //
  // The weekday name is the SYDNEY civil day, not the device's. `new Date()`
  // .toLocaleDateString() was reading the viewer's zone, so a dashboard open on
  // a laptop set to UTC would resolve Saturday's roster on a Sunday morning.
  const todayName = dayNameOf(isoDate(zoneToday(new Date())));
  const todayHabits = habitsOnDay(habits, todayName);

  const baseHabits = todayHabits.filter(h => h.block !== "conditional");
  const preIds = baseHabits.filter(h => h.block === "pre").map(h => h.id);
  const baseIds = baseHabits.map(h => h.id);
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
        {/* Only blocks that actually schedule something today. "Homeschool 0/1"
            on a Saturday reads as a job left undone; there is no homeschool on a
            Saturday, so the row is omitted rather than shown at zero. Filtering
            on length also removes the 0/0 division that would otherwise drive the
            progress bar's width. */}
        {BLOCKS.filter(block => baseHabits.some(h => h.block === block.id)).map(block => {
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
