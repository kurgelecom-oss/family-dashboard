"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate, getWeekStart, getTodayDayName } from "../lib/supabase";

// Points per habit — used for weekly sum
const HABIT_POINTS: Record<string, number> = {
  wake: 0, fajr: 0, bed: 0, movement: 0, breakfast: 0, quran: 0,
  goals: 2, school: 3, readtheory: 1, khan: 1, journal: 1,
  soccer: 2, btn: 1, namaz: 1, room: 0, shower: 0, teeth: 0, reading: 1,
};

// Days soccer training applies
const SOCCER_DAYS = ["Monday", "Wednesday"];

function buildHabits(dayName: string) {
  const hasSoccer = SOCCER_DAYS.includes(dayName);
  return [
    { id: "wake",      block: "pre",    label: "Feet on floor by 6:45am — no phone",  points: 0, icon: "🌅" },
    { id: "fajr",      block: "pre",    label: "Fajr Namaz done",                      points: 0, icon: "🕌" },
    { id: "bed",       block: "pre",    label: "Bed made + dressed",                   points: 0, icon: "🛏️" },
    { id: "movement",  block: "pre",    label: "Morning movement — 20 min outside",    points: 0, icon: "⚽" },
    { id: "breakfast", block: "pre",    label: "Breakfast done — no screens",          points: 0, icon: "🍳" },
    { id: "quran",     block: "pre",    label: "Qur'an recitation — 20 min",           points: 0, icon: "📖" },
    { id: "goals",     block: "pre",    label: "Daily goals written",                  points: 2, icon: "✍️" },
    { id: "school",    block: "school", label: "Homeschool session completed — 4 hrs", points: 3, icon: "📚" },
    { id: "readtheory",block: "school", label: "ReadTheory done",                      points: 1, icon: "📝" },
    { id: "khan",      block: "school", label: "Khan Academy done",                    points: 1, icon: "🎓" },
    { id: "journal",   block: "school", label: "Daily learning journal entry written", points: 1, icon: "📒" },
    ...(hasSoccer ? [{ id: "soccer", block: "arvo", label: "Soccer training — attend + full effort", points: 2, icon: "⚽" }] : []),
    { id: "btn",       block: "arvo",   label: "BTN episode + Cornell notes done",     points: 1, icon: "📰" },
    { id: "namaz",     block: "arvo",   label: "Duhr + Asr + Maghrib + Isha Namaz",   points: 1, icon: "🕌" },
    { id: "room",      block: "arvo",   label: "Room tidy",                            points: 0, icon: "🧹" },
    { id: "shower",    block: "arvo",   label: "Shower done",                          points: 0, icon: "🚿" },
    { id: "teeth",     block: "arvo",   label: "Teeth brushed",                        points: 0, icon: "🪥" },
    { id: "reading",   block: "arvo",   label: "Reading in bed — 15+ min",             points: 1, icon: "🌙" },
  ];
}

const BLOCKS = [
  { id: "pre",    label: "🌅 Pre-Homeschool",      subtitle: "Before 8:30am",    color: "#ffa500" },
  { id: "school", label: "📚 Homeschool",           subtitle: "4 hour block",     color: "#00d9ff" },
  { id: "arvo",   label: "🌆 Afternoon & Evening",  subtitle: "After school",     color: "#00ff88" },
];

const THRESHOLDS = [
  { min: 40, label: "Full Weekend 🏆", desc: "PS5 Sat+Sun · Full iPad · Movie Friday · Free time", color: "#00ff88" },
  { min: 32, label: "Good Week ✅",    desc: "PS5 Saturday only · iPad normal · Free time",        color: "#00d9ff" },
  { min: 25, label: "Average Week ⚠️", desc: "No PS5 · iPad halved · Catch-up Saturday morning",  color: "#ffa500" },
  { min: 0,  label: "Reset Week ❌",   desc: "No PS5 · No iPad · Full catch-up weekend",           color: "#ff4444" },
];

function getThreshold(pts: number) {
  return THRESHOLDS.find(t => pts >= t.min) || THRESHOLDS[THRESHOLDS.length - 1];
}

function getHabitState(habit: ReturnType<typeof buildHabits>[0], blockHabits: ReturnType<typeof buildHabits>, completed: Record<string, boolean>): "done" | "available" | "locked" {
  if (completed[habit.id]) return "done";
  const idx = blockHabits.findIndex(h => h.id === habit.id);
  const incompleteBefore = blockHabits.slice(0, idx).filter(h => !completed[h.id]).length;
  return incompleteBefore < 2 ? "available" : "locked";
}

// Calculate real streak: consecutive days (going back from yesterday) where
// at least 5 habits were completed (a "meaningful" day).
async function calculateStreak(): Promise<number> {
  // Fetch last 60 days of completions
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("habit_completions")
    .select("habit_id, completed_date")
    .gte("completed_date", cutoffStr)
    .order("completed_date", { ascending: false });

  if (error || !data) return 0;

  // Group by date
  const byDate: Record<string, number> = {};
  data.forEach((r: { habit_id: string; completed_date: string }) => {
    byDate[r.completed_date] = (byDate[r.completed_date] || 0) + 1;
  });

  // Walk back from yesterday, count consecutive days with >=5 completions
  let streak = 0;
  const check = new Date();
  // Start from today — if today has >=5, count it; else start from yesterday
  for (let i = 0; i <= 60; i++) {
    const d = new Date(check);
    d.setDate(check.getDate() - i);
    const ds = d.toISOString().split("T")[0];
    if ((byDate[ds] || 0) >= 5) {
      streak++;
    } else if (i === 0) {
      // Today not yet done — skip today, start counting from yesterday
      continue;
    } else {
      break; // Streak broken
    }
  }
  return streak;
}

export default function AnsarPage() {
  const [dayName, setDayName] = useState("");
  const [habits, setHabits] = useState<ReturnType<typeof buildHabits>>([]);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [weeklyPts, setWeeklyPts] = useState<number | null>(null);
  const [streak, setStreak] = useState<number | null>(null);

  const loadWeeklyData = useCallback(async () => {
    const weekStart = getWeekStart();
    const today = getTodayDate();

    const { data, error } = await supabase
      .from("habit_completions")
      .select("habit_id, completed_date")
      .gte("completed_date", weekStart)
      .lte("completed_date", today);

    if (!error && data) {
      // Sum points using HABIT_POINTS map
      let total = 0;
      data.forEach((r: { habit_id: string; completed_date: string }) => {
        total += HABIT_POINTS[r.habit_id] || 0;
      });
      setWeeklyPts(total);
    }
  }, []);

  const loadFromSupabase = useCallback(async () => {
    const { data, error } = await supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("completed_date", getTodayDate());
    if (!error && data) {
      const map: Record<string, boolean> = {};
      data.forEach((r: { habit_id: string }) => { map[r.habit_id] = true; });
      setCompleted(map);
      localStorage.setItem(`ansar-habits-${getTodayDate()}`, JSON.stringify(map));
      setOnline(true);
    } else {
      const saved = localStorage.getItem(`ansar-habits-${getTodayDate()}`);
      if (saved) setCompleted(JSON.parse(saved));
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    const dn = getTodayDayName();
    setDayName(dn);
    setHabits(buildHabits(dn));
    setMounted(true);
    loadFromSupabase();
    loadWeeklyData();
    calculateStreak().then(setStreak);

    const tick = setInterval(() => {
      setTime(new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    setTime(new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }));

    // Poll every 30s for weekly refresh
    const poll = setInterval(() => {
      loadFromSupabase();
      loadWeeklyData();
    }, 30000);

    return () => { clearInterval(tick); clearInterval(poll); };
  }, [loadFromSupabase, loadWeeklyData]);

  async function toggle(id: string, state: string) {
    if (state !== "available") return;
    setSaving(id);
    setCompleted(prev => {
      const next = { ...prev, [id]: true };
      localStorage.setItem(`ansar-habits-${getTodayDate()}`, JSON.stringify(next));
      return next;
    });
    const { error } = await supabase
      .from("habit_completions")
      .upsert({ habit_id: id, completed_date: getTodayDate() }, { onConflict: "habit_id,completed_date" });
    if (error) {
      setOnline(false);
    } else {
      setOnline(true);
      // Refresh weekly after completion
      loadWeeklyData();
    }
    setSaving(null);
  }

  const todayPts = habits.filter(h => completed[h.id]).reduce((a, h) => a + h.points, 0);
  const todayDone = habits.filter(h => completed[h.id]).length;
  const overallPct = habits.length > 0 ? Math.round((todayDone / habits.length) * 100) : 0;
  const weekThreshold = getThreshold(weeklyPts ?? 0);
  const WEEKLY_MAX = SOCCER_DAYS.includes(dayName) ? 51 : 47; // 2 soccer days × 2pts extra

  return (
    <div style={{ minHeight: "100vh", background: "#0f1419", color: "#ffffff", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* HEADER */}
      <header style={{
        background: "#16192d", borderBottom: "1px solid #2d3543",
        padding: "12px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff" }}>
            Ansar <span style={{ color: "#ffa500" }}>· Daily Habits</span>
          </div>
          <div style={{ fontSize: 10, color: "#757f8f", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            {mounted ? new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) : ""} · {time}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: online ? "#00ff88" : "#ff4444", display: "inline-block" }} />
              <span style={{ color: online ? "#00ff88" : "#ff4444" }}>{online ? "Live" : "Offline"}</span>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#ffa500", lineHeight: 1 }}>{mounted ? todayPts : 0}</div>
            <div style={{ fontSize: 9, color: "#757f8f", textTransform: "uppercase", letterSpacing: "0.1em" }}>pts today</div>
          </div>
          <a href="/" style={{
            fontSize: 10, color: "#b0b5c1", textDecoration: "none", fontWeight: 600,
            letterSpacing: "0.06em", textTransform: "uppercase",
            background: "#1f2438", padding: "4px 10px", borderRadius: 4, border: "1px solid #2d3543",
          }}>← Dashboard</a>
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px 20px 40px" }}>

        {/* TOP STATS ROW */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          {/* Today points */}
          <div style={{ background: "#16192d", border: "1px solid #2d3543", borderRadius: 10, padding: "16px", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#ffa500", lineHeight: 1 }}>{mounted ? todayPts : "—"}</div>
            <div style={{ fontSize: 10, color: "#757f8f", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 500 }}>Points Today</div>
          </div>
          {/* Weekly points */}
          <div style={{ background: "#16192d", border: "1px solid #2d3543", borderRadius: 10, padding: "16px", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#00ff88", lineHeight: 1 }}>{mounted && weeklyPts !== null ? weeklyPts : "—"}</div>
            <div style={{ fontSize: 10, color: "#757f8f", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 500 }}>Week Total</div>
          </div>
          {/* Streak */}
          <div style={{ background: "#16192d", border: "1px solid #2d3543", borderRadius: 10, padding: "16px", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#00d9ff", lineHeight: 1, display: "flex", alignItems: "center", gap: 4 }}>
              {mounted && streak !== null ? streak : "—"}
              {mounted && streak !== null && streak > 0 && <span style={{ fontSize: 18 }}>🔥</span>}
            </div>
            <div style={{ fontSize: 10, color: "#757f8f", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 500 }}>Day Streak</div>
          </div>
        </div>

        {/* OVERALL PROGRESS BAR */}
        <div style={{ background: "#16192d", border: "1px solid #2d3543", borderRadius: 10, padding: "16px", marginBottom: 10, boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#b0b5c1", fontWeight: 600 }}>Today&apos;s Progress</span>
            <span style={{ fontSize: 11, color: "#ffffff", fontWeight: 600 }}>{mounted ? todayDone : 0} of {habits.length} habits complete</span>
          </div>
          <div style={{ height: 8, background: "#1f2438", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4, transition: "width 200ms ease-in-out",
              width: mounted ? `${overallPct}%` : "0%",
              background: "linear-gradient(90deg, #ffa500, #00ff88)",
            }} />
          </div>
        </div>

        {/* SOCCER TRAINING BADGE — only show on Mon/Wed */}
        {mounted && SOCCER_DAYS.includes(dayName) && (
          <div style={{
            background: "rgba(255,165,0,0.1)", border: "1px solid rgba(255,165,0,0.3)",
            borderRadius: 8, padding: "8px 12px", marginBottom: 10,
            fontSize: 11, color: "#ffa500", fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
          }}>
            ⚽ Soccer training day — check afternoon block for bonus habit (+2 pts)
          </div>
        )}

        {/* WEEKLY STATUS */}
        <div style={{
          background: "#16192d", border: `1px solid ${weekThreshold.color}40`,
          borderRadius: 10, padding: "16px", marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
        }}>
          <div>
            <div style={{ fontSize: 10, color: "#757f8f", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>This week you&apos;re on track for</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: weekThreshold.color }}>{weekThreshold.label}</div>
            <div style={{ fontSize: 11, color: "#b0b5c1", marginTop: 3 }}>{weekThreshold.desc}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 16 }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: weekThreshold.color, lineHeight: 1 }}>{mounted && weeklyPts !== null ? weeklyPts : "—"}</div>
            <div style={{ fontSize: 10, color: "#757f8f" }}>/ {WEEKLY_MAX} pts max</div>
          </div>
        </div>

        {/* HABIT BLOCKS */}
        {BLOCKS.map(block => {
          const blockHabits = habits.filter(h => h.block === block.id);
          if (blockHabits.length === 0) return null;
          const blockDone = blockHabits.filter(h => completed[h.id]).length;
          const blockPts = blockHabits.filter(h => completed[h.id]).reduce((a, h) => a + h.points, 0);
          const blockPct = Math.round((blockDone / blockHabits.length) * 100);

          return (
            <div key={block.id} style={{ background: "#16192d", border: "1px solid #2d3543", borderRadius: 10, marginBottom: 10, overflow: "hidden", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
              <div style={{ height: 2, background: block.color }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: "1px solid #2d3543" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: block.color }}>{block.label}</div>
                  <div style={{ fontSize: 10, color: "#757f8f", marginTop: 2, fontWeight: 500 }}>{block.subtitle}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff" }}>{blockDone}/{blockHabits.length}</div>
                    <div style={{ fontSize: 10, color: "#757f8f", fontWeight: 500 }}>{blockPts} pts earned</div>
                  </div>
                  <div style={{ width: 48, background: "#1f2438", borderRadius: 3, height: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${blockPct}%`, background: block.color, borderRadius: 3, transition: "width 200ms ease-in-out" }} />
                  </div>
                </div>
              </div>

              <div style={{ padding: "12px" }}>
                {blockHabits.map((habit) => {
                  const state = mounted ? getHabitState(habit, blockHabits, completed) : "locked";
                  const isDone = state === "done";
                  const isAvailable = state === "available";
                  const isLocked = state === "locked";
                  const isSaving = saving === habit.id;

                  return (
                    <div
                      key={habit.id}
                      onClick={() => toggle(habit.id, state)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "12px", marginBottom: 6, borderRadius: 8,
                        border: `1px solid ${isDone ? block.color + "50" : isAvailable ? "#2d3543" : "#1f2438"}`,
                        background: isDone ? block.color + "0a" : isAvailable ? "#1f2438" : "#16192d",
                        opacity: isLocked ? 0.5 : 1,
                        cursor: isAvailable ? "pointer" : "default",
                        transition: "all 150ms ease-out",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                        border: `2px solid ${isDone ? block.color : isAvailable ? "#2d3543" : "#1f2438"}`,
                        background: isDone ? block.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 150ms ease-out",
                      }}>
                        {isSaving ? <span style={{ fontSize: 10 }}>⏳</span> :
                         isDone ? <span style={{ fontSize: 12, color: "#000", fontWeight: 700 }}>✓</span> :
                         isLocked ? <span style={{ fontSize: 9 }}>🔒</span> : null}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: isAvailable ? 600 : 500,
                          color: isDone ? "#757f8f" : isLocked ? "#565f70" : "#ffffff",
                          textDecoration: isDone ? "line-through" : "none",
                        }}>
                          {habit.icon} {habit.label}
                        </div>
                        {isLocked && <div style={{ fontSize: 10, color: "#565f70", marginTop: 2, fontWeight: 500 }}>Complete previous habits to unlock</div>}
                      </div>

                      {habit.points > 0 && (
                        <div style={{
                          fontSize: 11, fontWeight: 600, flexShrink: 0,
                          color: isDone ? block.color : isLocked ? "#565f70" : "#b0b5c1",
                          background: isDone ? block.color + "15" : "#1f2438",
                          padding: "4px 8px", borderRadius: 6,
                          border: `1px solid ${isDone ? block.color + "40" : "#2d3543"}`,
                        }}>
                          +{habit.points} pt{habit.points > 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* REWARD TIERS */}
        <div style={{ background: "#16192d", border: "1px solid #2d3543", borderRadius: 10, overflow: "hidden", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)" }}>
          <div style={{ height: 2, background: "linear-gradient(90deg, #ffa500, #00ff88, #00d9ff)" }} />
          <div style={{ padding: "16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 12 }}>🏆 Weekly Reward Tiers</div>
            {THRESHOLDS.map((t, i) => {
              const weekPts = weeklyPts ?? 0;
              const isActive = mounted && weekPts >= t.min && (i === 0 || weekPts < THRESHOLDS[i - 1].min);
              const isAchieved = mounted && weekPts >= t.min;
              return (
                <div key={t.min} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px", borderRadius: 8, marginBottom: 6,
                  background: isActive ? t.color + "10" : "#1f2438",
                  border: `1px solid ${isActive ? t.color + "50" : "#2d3543"}`,
                  opacity: isAchieved ? 1 : 0.5,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.color, flexShrink: 0, boxShadow: isActive ? `0 0 8px ${t.color}` : "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.color }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: "#757f8f", marginTop: 1 }}>{t.desc}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#757f8f", flexShrink: 0 }}>{t.min}+ pts</div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
