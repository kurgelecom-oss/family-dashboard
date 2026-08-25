"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase, getTodayDate } from "../../lib/supabase";
import { calculateStreak, STREAK_LOOKBACK_DAYS } from "../../lib/streak";
import {
  zoneToday,
  isoDate,
  addDays,
  daysBetween,
  parseCivilDate,
} from "../../lib/time";
import { habitsOnDay } from "../../lib/habit-days";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../../lib/settings";
import type { TablePayload } from "../../api/table/route";

/* ════════════════════════════════════════════════════════════════════════════
   The face's ONE data load. RESTRUCTURE-SPEC §3: three frames render from one
   shared state object — no per-frame fetch. Each upstream keeps the cadence its
   panel already ran at (PanelFinance 10 min, PanelEcom 5 min, PanelTodos
   5 min, PanelCalendar 60 min, the Ansar strip 60 s); the frames themselves
   never fetch.

   Everything here reuses the existing API routes — no new upstream wiring.
   Habits scoring imports the canonical libs (scoring.ts / streak.ts), exactly
   as AnsarStrip does; nothing is copied or rewritten.
   ══════════════════════════════════════════════════════════════════════════ */

const POCKETSMITH_MS = 10 * 60 * 1000; // PanelFinance's cadence
const ECOM_MS = 5 * 60 * 1000; // PanelEcom's cadence
const ACTIONS_MS = 5 * 60 * 1000; // PanelTodos's cadence
const TABLE_MS = 5 * 60 * 1000; // /table's cadence
const CALENDAR_MS = 60 * 60 * 1000; // PanelCalendar's cadence
const HABITS_MS = 60 * 1000; // AnsarStrip / WeekProgressStrip's cadence

/* ── minimal payload shapes — only the fields the face reads ─────────────── */

interface FacePeriod {
  startDate: string;
  endDate: string;
  totalSpending: number;
  savingsRate: number;
}

export interface FacePocketsmith {
  lastWeek: FacePeriod | null;
  lastMonth: FacePeriod | null;
  totalBalance: number | null;
}

export interface FaceEcom {
  activityState: "LIVE" | "AWAITING" | "NONE" | null;
}

export interface FaceActions {
  settings?: SettingsMap;
  clock: {
    daysLeftInWeek: number;
    daysToTractionEnd: number;
    tractionEndDate: string;
    yearElapsedPct: number;
    tests: { completed: number; target: number };
  } | null;
}

export interface FaceCalEvent {
  id: string;
  subject: string;
  startISO: string;
  isAllDay: boolean;
  account: string;
  color: string;
  webLink?: string;
}

export interface FaceHabits {
  streak: number | null;
  todayPct: number | null;
}

export interface FaceData {
  ps: FacePocketsmith | null;
  ecom: FaceEcom | null;
  actions: FaceActions | null;
  table: TablePayload | null;
  calendar: FaceCalEvent[] | null;
  habits: FaceHabits | null;
}

interface HabitRow {
  id: string;
  name: string;
  block: string;
  days: string[];
}

/* ── the hook ────────────────────────────────────────────────────────────── */

function usePolled<T>(load: () => Promise<T | null>, everyMs: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const v = await load();
        if (!cancelled && v !== null) setValue(v);
      } catch {
        /* keep the last good value — a wall display never blanks on a blip */
      }
    };
    run();
    const id = setInterval(run, everyMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load, everyMs]);
  return value;
}

export function useFaceData(): FaceData {
  const loadPs = useCallback(async (): Promise<FacePocketsmith | null> => {
    const res = await fetch("/api/pocketsmith");
    if (!res.ok) return null;
    const j = (await res.json()) as {
      lastWeek?: FacePeriod;
      lastMonth?: FacePeriod;
      totalBalance?: number;
    };
    return {
      lastWeek: j.lastWeek ?? null,
      lastMonth: j.lastMonth ?? null,
      totalBalance: typeof j.totalBalance === "number" ? j.totalBalance : null,
    };
  }, []);

  const loadEcom = useCallback(async (): Promise<FaceEcom | null> => {
    const res = await fetch("/api/ecom");
    if (!res.ok) return null;
    const j = (await res.json()) as {
      todayStats?: { activityState?: "LIVE" | "AWAITING" | "NONE" };
    };
    return { activityState: j.todayStats?.activityState ?? null };
  }, []);

  const loadActions = useCallback(async (): Promise<FaceActions | null> => {
    const res = await fetch("/api/actions");
    if (!res.ok) return null;
    const j = (await res.json()) as FaceActions;
    return { settings: j.settings, clock: j.clock ?? null };
  }, []);

  const loadTable = useCallback(async (): Promise<TablePayload | null> => {
    const res = await fetch("/api/table");
    if (!res.ok) return null;
    return (await res.json()) as TablePayload;
  }, []);

  const loadCalendar = useCallback(async (): Promise<FaceCalEvent[] | null> => {
    const res = await fetch("/api/calendar");
    if (!res.ok) return null;
    const j = (await res.json()) as { events?: FaceCalEvent[] };
    return Array.isArray(j.events) ? j.events : [];
  }, []);

  const ps = usePolled(loadPs, POCKETSMITH_MS);
  const ecom = usePolled(loadEcom, ECOM_MS);
  const actions = usePolled(loadActions, ACTIONS_MS);
  const table = usePolled(loadTable, TABLE_MS);
  const calendar = usePolled(loadCalendar, CALENDAR_MS);

  /* Habits — roster once from /api/habits, then Supabase ticks on the strip's
     cadence. Mirrors AnsarStrip / PanelHabits derivations exactly. */
  const [habitRoster, setHabitRoster] = useState<HabitRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/habits");
        const j = await res.json();
        if (!cancelled) setHabitRoster(Array.isArray(j) ? j : []);
      } catch {
        if (!cancelled) setHabitRoster([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [habits, setHabits] = useState<FaceHabits | null>(null);
  const loadHabits = useCallback(async () => {
    if (habitRoster.length === 0) return;
    const todaySydney = zoneToday(new Date());
    const todayIso = isoDate(todaySydney);
    const todayName = new Date(todayIso + "T12:00:00").toLocaleDateString("en-AU", {
      weekday: "long",
    });

    let todayPct: number | null = null;
    const { data: todayData } = await supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("completed_date", getTodayDate());
    if (todayData) {
      const done = new Set(todayData.map((r: { habit_id: string }) => r.habit_id));
      // Today's roster, not the whole list — PanelHabits's rule: unscheduled
      // habits must not count against the day.
      const base = habitsOnDay(habitRoster, todayName).filter(
        (h) => h.block !== "conditional",
      );
      // today % = ticked base habits / today's base roster — PanelHabits's
      // exact `pct` derivation (PanelHabits.tsx:220), not a new metric.
      const doneCount = base.filter((h) => done.has(h.id)).length;
      todayPct = base.length > 0 ? Math.round((doneCount / base.length) * 100) : null;
    }

    let streak: number | null = null;
    const { data: streakData } = await supabase
      .from("habit_completions")
      .select("completed_date")
      .gte("completed_date", isoDate(addDays(todaySydney, -STREAK_LOOKBACK_DAYS)));
    if (streakData) {
      const counts: Record<string, number> = {};
      streakData.forEach((r: { completed_date: string }) => {
        counts[r.completed_date] = (counts[r.completed_date] || 0) + 1;
      });
      streak = calculateStreak(counts, todayIso);
    }

    setHabits({ streak, todayPct });
  }, [habitRoster]);

  useEffect(() => {
    loadHabits();
    const id = setInterval(loadHabits, HABITS_MS);
    return () => clearInterval(id);
  }, [loadHabits]);

  return { ps, ecom, actions, table, calendar, habits };
}

/* ════════════════════════════════════════════════════════════════════════════
   Derivations — pure functions of FaceData. §3's headline rules, the chip →
   hero → lane values, and the next-gate wording (mirrors /business).
   ══════════════════════════════════════════════════════════════════════════ */

/** PanelHabits's streak purple — the same constant AnsarStrip uses. */
export const FACE_PURPLE = "#a78bfa";

/**
 * Money on the face. `$0.00` is hidden in every frame (spec §2), so a zero —
 * or an unknown — renders as null and the caller shows a dash or omits it.
 */
export function fmtMoney(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  if (Math.abs(n) < 0.005) return null;
  return "$" + Math.round(n).toLocaleString("en-AU");
}

function fmtDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

const SYD_TIME = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  hour: "numeric",
  minute: "2-digit",
});
const SYD_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface FaceTomorrowEvent {
  id: string;
  person: string;
  colorVar: string;
  time: string;
  subject: string;
}

export interface FaceModel {
  headline: string;
  nextAction: string | null;
  /* chip / hero / lane values */
  weekSpend: string | null; // formatted; $0.00 hidden
  weekEnded: string | null;
  monthSpend: string | null;
  balance: string | null;
  savedPct: string | null;
  testWord: "Running" | "Stale" | "None";
  testStale: boolean;
  testContext: string;
  nextGate: string | null;
  campaigns: string;
  testsLine: string;
  openCount: number | null;
  oldestDays: number | null;
  oldestTitle: string | null;
  streak: number | null;
  todayPct: number | null;
  /* traction + tomorrow */
  tractionDays: number | null;
  tractionPct: number;
  tomorrowLabel: string;
  tomorrow: FaceTomorrowEvent[];
}

const PERSON_LABEL: Record<string, string> = {
  TAYLAN: "Taylan",
  NIHAL: "Nihal",
  ANSAR: "Ansar",
};

export function buildFaceModel(d: FaceData): FaceModel {
  const t = d.table?.test ?? null;
  const settings = d.actions?.settings;
  const staleRed = getSetting(
    settings,
    "TEST_STALE_RED_DAYS",
    SETTING_DEFAULTS.TEST_STALE_RED_DAYS,
  );

  /* ---- test status word: Stale / Running / None, red when stale ---------- */
  let testWord: FaceModel["testWord"] = "None";
  let staleN: number | null = null;
  if (t) {
    if (t.running && (t.staleDays ?? 0) <= staleRed) {
      testWord = "Running";
    } else if (t.running) {
      testWord = "Stale";
      staleN = t.staleDays;
    } else if (t.lastEntryDaysAgo !== null) {
      testWord = "Stale";
      staleN = t.lastEntryDaysAgo;
    }
  }
  const testStale = testWord === "Stale";

  /* ---- headline — §3 priority order, first match wins -------------------- */
  const oldest = d.table?.open[0] ?? null;
  const oldestDays = oldest?.ageDays ?? null;
  let headline: string;
  if (testStale && staleN !== null) {
    headline = `No test is running. Last entry was ${staleN} ${staleN === 1 ? "day" : "days"} ago.`;
  } else if (
    t?.running &&
    testWord === "Running" &&
    t.spend !== null &&
    t.windowLow !== null &&
    t.spend < t.windowLow
  ) {
    // §2: no $0.00 on the face — a not-yet-fed test gets words, not a zero.
    headline =
      Math.abs(t.spend) < 0.005
        ? `${t.name} is yet to spend into the $${t.windowLow} window.`
        : `${t.name} is at $${Math.round(t.spend)} of the $${t.windowLow} window.`;
  } else if (oldestDays !== null && oldestDays > 7) {
    headline = `One decision has sat ${oldestDays} days. Close it tonight.`;
  } else {
    headline = "Nothing on the table. Run the check-in short.";
  }

  /* ---- next-action line: the test's next gate, else the oldest title ----- */
  let nextGate: string | null = null;
  if (t?.running && t.windowLow !== null) {
    const spend = t.spend ?? 0;
    const inWindow = t.windowHigh !== null && spend >= t.windowLow && spend <= t.windowHigh;
    nextGate = inWindow
      ? "Entry-window verdict"
      : spend < t.windowLow
        ? `Reach $${t.windowLow} entry window`
        : "Exit / scale decision";
  }
  const nextAction = t?.running && nextGate ? nextGate : (oldest?.title ?? null);

  /* ---- test context line -------------------------------------------------- */
  const testContext = t?.running
    ? (t.name ?? "")
    : staleN !== null
      ? `last entry ${staleN}d ago`
      : "no entries yet";

  /* ---- campaigns word ----------------------------------------------------- */
  const activity = d.ecom?.activityState ?? null;
  const campaigns =
    activity === "LIVE"
      ? "Live"
      : activity === "AWAITING"
        ? "Awaiting data"
        : activity === "NONE"
          ? "None live"
          : "—";

  /* ---- clock: traction bar fill from go-live → traction end -------------- */
  const clock = d.actions?.clock ?? null;
  const tractionDays = clock?.daysToTractionEnd ?? null;
  let tractionPct = 0;
  if (clock) {
    const goLive = parseCivilDate(
      String(
        getSetting(
          settings,
          "LAUNCHPAD_GO_LIVE_DATE",
          SETTING_DEFAULTS.LAUNCHPAD_GO_LIVE_DATE,
        ),
      ),
    );
    const end = parseCivilDate(clock.tractionEndDate);
    if (goLive && end) {
      const total = daysBetween(goLive, end);
      const gone = daysBetween(goLive, zoneToday(new Date()));
      if (total > 0) tractionPct = Math.max(0, Math.min(100, (gone / total) * 100));
    }
  }

  /* ---- tomorrow strip ----------------------------------------------------- */
  const tomorrowIso = isoDate(addDays(zoneToday(new Date()), 1));
  const tomorrow: FaceTomorrowEvent[] = (d.calendar ?? [])
    /* An unparseable startISO must drop the event, not throw inside format()
       and blank the whole face (Fix 3 stress run surfaced the crash path). */
    .filter((e) => !Number.isNaN(new Date(e.startISO).getTime()))
    .filter((e) => SYD_DAY.format(new Date(e.startISO)) === tomorrowIso)
    .map((e) => ({
      id: e.id,
      person: PERSON_LABEL[e.account] ?? e.account,
      colorVar: `var(--${e.color === "cyan" ? "cyan" : e.color === "green" ? "green" : "amber"})`,
      time: e.isAllDay ? "all day" : SYD_TIME.format(new Date(e.startISO)),
      subject: e.subject,
    }));

  return {
    headline,
    nextAction,
    weekSpend: fmtMoney(d.ps?.lastWeek?.totalSpending),
    weekEnded: fmtDayLabel(d.ps?.lastWeek?.endDate),
    monthSpend: fmtMoney(d.ps?.lastMonth?.totalSpending),
    balance: fmtMoney(d.ps?.totalBalance),
    savedPct:
      typeof d.ps?.lastWeek?.savingsRate === "number"
        ? `${d.ps.lastWeek.savingsRate.toFixed(0)}%`
        : null,
    testWord,
    testStale,
    testContext,
    nextGate,
    campaigns,
    testsLine: clock ? `${clock.tests.completed} of ${clock.tests.target}` : "—",
    openCount: d.table ? d.table.open.length : null,
    oldestDays,
    oldestTitle: oldest?.title ?? null,
    streak: d.habits?.streak ?? null,
    todayPct: d.habits?.todayPct ?? null,
    tractionDays,
    tractionPct,
    tomorrowLabel: fmtDayLabel(tomorrowIso) ?? "Tomorrow",
    tomorrow,
  };
}
