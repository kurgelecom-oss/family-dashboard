"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, getTodayDate, getWeekStart } from "../lib/supabase";
import { scoreDay, WEEKLY_MAX } from "../lib/scoring";
import { calculateStreak, STREAK_LOOKBACK_DAYS } from "../lib/streak";
import { zoneToday, isoDate, addDays as addCivilDays } from "../lib/time";
import { habitsOnDay } from "../lib/habit-days";

/* ════════════════════════════════════════════════════════════════════════════
   Ansar strip — added below the calendar band on /board. RESTRUCTURE-SPEC §4.

   Day streak (purple), points today, week points / 55, a progress bar, and a
   link to his own dashboard. Data and scoring mirror PanelHabits exactly:
   /api/habits for the roster, Supabase habit_completions for the ticks,
   scoreDay/WEEKLY_MAX from app/lib/scoring.ts (the canonical, mirrored module
   — imported, never copied) and calculateStreak from app/lib/streak.ts.
   ══════════════════════════════════════════════════════════════════════════ */

interface Habit {
  id: string;
  name: string;
  block: string;
  days: string[];
}

const PURPLE = "#a78bfa"; // PanelHabits's streak purple — not a new colour

/** Mon–Fri only, mirroring SQUAD_DAYS in PanelHabits / WeekProgressStrip. */
const SQUAD_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function dayNameOf(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-AU", { weekday: "long" });
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export default function AnsarStrip() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayPts, setTodayPts] = useState<number | null>(null);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);

  const loadHabits = useCallback(async () => {
    try {
      const res = await fetch("/api/habits");
      const data = await res.json();
      setHabits(Array.isArray(data) ? data : []);
    } catch {
      setHabits([]);
    }
  }, []);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  const load = useCallback(async () => {
    if (habits.length === 0) return;

    // Weekly roster — same derivation as PanelHabits, so the /55 agrees.
    const weekPreIds = habits.filter((h) => h.block === "pre").map((h) => h.id);
    const weekBaseIds = habits.filter((h) => h.block !== "conditional").map((h) => h.id);

    const todaySydney = zoneToday(new Date());
    const todayIso = isoDate(todaySydney);
    const todayName = dayNameOf(todayIso);

    // Today's points — today's roster, not the whole list.
    const { data: todayData } = await supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("completed_date", getTodayDate());
    if (todayData) {
      const done = new Set(todayData.map((r: { habit_id: string }) => r.habit_id));
      const todayHabits = habitsOnDay(habits, todayName);
      const base = todayHabits.filter((h) => h.block !== "conditional");
      const preIds = base.filter((h) => h.block === "pre").map((h) => h.id);
      const baseIds = base.map((h) => h.id);
      setTodayPts(scoreDay(done, todayName, preIds, baseIds).total);
    }

    // Week points — Mon–Fri squad days plus the perfect-week bonus.
    const weekStart = getWeekStart();
    const { data: weekData } = await supabase
      .from("habit_completions")
      .select("habit_id, completed_date")
      .gte("completed_date", weekStart)
      .lte("completed_date", getTodayDate());
    if (weekData) {
      const byDate: Record<string, Set<string>> = {};
      weekData.forEach((r: { habit_id: string; completed_date: string }) => {
        (byDate[r.completed_date] ??= new Set()).add(r.habit_id);
      });
      let total = 0;
      Object.keys(byDate).forEach((ds) => {
        if (!SQUAD_DAYS.includes(dayNameOf(ds))) return;
        total += scoreDay(byDate[ds], dayNameOf(ds), weekPreIds, weekBaseIds).total;
      });
      const weekdayDates = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
      const allPerfect = weekdayDates.every(
        (ds) =>
          byDate[ds] && scoreDay(byDate[ds], dayNameOf(ds), weekPreIds, weekBaseIds).perfect,
      );
      if (allPerfect) total += 3;
      setWeeklyPts(total);
    }

    // Day streak — the mirrored rule in app/lib/streak.ts.
    const { data: streakData } = await supabase
      .from("habit_completions")
      .select("completed_date")
      .gte("completed_date", isoDate(addCivilDays(todaySydney, -STREAK_LOOKBACK_DAYS)));
    if (streakData) {
      const counts: Record<string, number> = {};
      streakData.forEach((r: { completed_date: string }) => {
        counts[r.completed_date] = (counts[r.completed_date] || 0) + 1;
      });
      setStreak(calculateStreak(counts, todayIso));
    }
  }, [habits]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // WeekProgressStrip's cadence
    return () => clearInterval(id);
  }, [load]);

  const weekPct = weeklyPts === null ? 0 : Math.min(100, (weeklyPts / WEEKLY_MAX) * 100);

  return (
    <section
      className="card"
      style={{
        flex: "none",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--amber)",
          flexShrink: 0,
        }}
      >
        Ansar
      </span>

      <span style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
        <span
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: PURPLE,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {streak ?? "—"}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          day streak
        </span>
      </span>

      <span style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--cyan)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {todayPts ?? "—"}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          pts today
        </span>
      </span>

      <span style={{ display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--green)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {weeklyPts ?? "—"}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          week / {WEEKLY_MAX}
        </span>
      </span>

      <span style={{ flex: 1, minWidth: 120 }}>
        <span className="progress-track thick" style={{ display: "block" }}>
          <span
            className="progress-fill"
            style={{ display: "block", width: `${weekPct}%`, background: PURPLE }}
          />
        </span>
      </span>

      {/* "Open his dashboard" link removed 2026-08-26 by owner directive —
          no navigation path to ansar-habits-tracker may remain on any
          surface. Streak / points / progress content above is unchanged. */}
    </section>
  );
}
