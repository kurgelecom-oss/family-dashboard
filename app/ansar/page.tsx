"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate } from "../lib/supabase";

const HABITS = [
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
  { id: "btn",       block: "arvo",   label: "BTN episode + Cornell notes done",     points: 1, icon: "📰" },
  { id: "namaz",     block: "arvo",   label: "Duhr + Asr + Maghrib + Isha Namaz",   points: 1, icon: "🕌" },
  { id: "room",      block: "arvo",   label: "Room tidy",                            points: 0, icon: "🧹" },
  { id: "shower",    block: "arvo",   label: "Shower done",                          points: 0, icon: "🚿" },
  { id: "teeth",     block: "arvo",   label: "Teeth brushed",                        points: 0, icon: "🪥" },
  { id: "reading",   block: "arvo",   label: "Reading in bed — 15+ min",             points: 1, icon: "🌙" },
];

const BLOCKS = [
  { id: "pre",    label: "🌅 Pre-Homeschool",      subtitle: "Before 8:30am",    color: "#f59e0b" },
  { id: "school", label: "📚 Homeschool",           subtitle: "4 hour block",     color: "#00c9ff" },
  { id: "arvo",   label: "🌆 Afternoon & Evening",  subtitle: "After school",     color: "#a78bfa" },
];

const THRESHOLDS = [
  { min: 40, label: "Full Weekend 🏆", desc: "PS5 Sat+Sun · Full iPad · Movie Friday · Free time", color: "#2ecc71" },
  { min: 32, label: "Good Week ✅",    desc: "PS5 Saturday only · iPad normal · Free time",        color: "#00c9ff" },
  { min: 25, label: "Average Week ⚠️", desc: "No PS5 · iPad halved · Catch-up Saturday morning",  color: "#f59e0b" },
  { min: 0,  label: "Reset Week ❌",   desc: "No PS5 · No iPad · Full catch-up weekend",           color: "#e74c3c" },
];

const WEEKLY_MAX = 47;

function getThreshold(pts: number) {
  return THRESHOLDS.find(t => pts >= t.min) || THRESHOLDS[THRESHOLDS.length - 1];
}

function getHabitState(habit: typeof HABITS[0], blockHabits: typeof HABITS, completed: Record<string, boolean>): "done" | "available" | "locked" {
  if (completed[habit.id]) return "done";
  const idx = blockHabits.findIndex(h => h.id === habit.id);
  const incompleteBefore = blockHabits.slice(0, idx).filter(h => !completed[h.id]).length;
  return incompleteBefore < 2 ? "available" : "locked";
}

export default function AnsarPage() {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const loadFromSupabase = useCallback(async () => {
    const { data, error } = await supabase
      .from("habit_completions")
      .select("habit_id")
      .eq("completed_date", getTodayDate());
    if (!error && data) {
      const map: Record<string, boolean> = {};
      data.forEach(r => { map[r.habit_id] = true; });
      setCompleted(map);
      // Also cache locally
      localStorage.setItem(`ansar-habits-${getTodayDate()}`, JSON.stringify(map));
      setOnline(true);
    } else {
      // Fallback to localStorage
      const saved = localStorage.getItem(`ansar-habits-${getTodayDate()}`);
      if (saved) setCompleted(JSON.parse(saved));
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadFromSupabase();
    const tick = setInterval(() => {
      setTime(new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }));
    }, 1000);
    setTime(new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }));
    return () => clearInterval(tick);
  }, [loadFromSupabase]);

  async function toggle(id: string, state: string) {
    if (state !== "available") return;
    setSaving(id);
    // Optimistic update
    setCompleted(prev => {
      const next = { ...prev, [id]: true };
      localStorage.setItem(`ansar-habits-${getTodayDate()}`, JSON.stringify(next));
      return next;
    });
    // Write to Supabase
    const { error } = await supabase
      .from("habit_completions")
      .upsert({ habit_id: id, completed_date: getTodayDate() }, { onConflict: "habit_id,completed_date" });
    if (error) {
      console.error("Supabase error:", error);
      setOnline(false);
    } else {
      setOnline(true);
    }
    setSaving(null);
  }

  const todayPts = HABITS.filter(h => completed[h.id]).reduce((a, h) => a + h.points, 0);
  const todayDone = HABITS.filter(h => completed[h.id]).length;
  const overallPct = Math.round((todayDone / HABITS.length) * 100);
  const threshold = getThreshold(todayPts);

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", color: "#f0f2f8", fontFamily: "'Inter', sans-serif" }}>

      {/* HEADER */}
      <header style={{
        background: "#13161e", borderBottom: "1px solid #232736",
        padding: "12px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Ansar <span style={{ color: "#f59e0b" }}>· Daily Habits</span>
          </div>
          <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            {mounted ? new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) : ""} · {time}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: online ? "#2ecc71" : "#e74c3c", display: "inline-block" }} />
              <span style={{ color: online ? "#2ecc71" : "#e74c3c" }}>{online ? "Live" : "Offline"}</span>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#f59e0b", lineHeight: 1 }}>{mounted ? todayPts : 0}</div>
            <div style={{ fontSize: 9, color: "#5a6080", textTransform: "uppercase", letterSpacing: "0.1em" }}>pts today</div>
          </div>
          <a href="/" style={{
            fontSize: 10, color: "#5a6080", textDecoration: "none", fontWeight: 600,
            letterSpacing: "0.06em", textTransform: "uppercase",
            background: "#1a1d2e", padding: "4px 10px", borderRadius: 4, border: "1px solid #232736",
          }}>← Dashboard</a>
        </div>
      </header>

      <div style={{ padding: "12px 12px 40px", maxWidth: 680, margin: "0 auto" }}>

        {/* TOP STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          {[
            { label: "Points Today", value: mounted ? `${todayPts} pts` : "—", color: "#f59e0b" },
            { label: "Habits Done", value: mounted ? `${todayDone}/${HABITS.length}` : "—", color: "#fff" },
            { label: "Daily Progress", value: mounted ? `${overallPct}%` : "—", color: threshold.color },
          ].map(s => (
            <div key={s.label} style={{ background: "#13161e", border: "1px solid #232736", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* PROGRESS BAR */}
        <div style={{ background: "#13161e", border: "1px solid #232736", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#8b92b4" }}>Today's Progress</span>
            <span style={{ fontSize: 11, color: "#5a6080" }}>{mounted ? todayDone : 0} of {HABITS.length} habits complete</span>
          </div>
          <div style={{ background: "#1a1d2e", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4, transition: "width 0.4s ease",
              width: mounted ? `${overallPct}%` : "0%",
              background: "linear-gradient(90deg, #f59e0b, #2ecc71)",
            }} />
          </div>
        </div>

        {/* WEEKLY STATUS */}
        <div style={{
          background: "#13161e", border: `1px solid ${threshold.color}40`,
          borderRadius: 8, padding: "12px 14px", marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>This week you're on track for</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: threshold.color }}>{threshold.label}</div>
            <div style={{ fontSize: 11, color: "#8b92b4", marginTop: 3 }}>{threshold.desc}</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 16 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: threshold.color, lineHeight: 1 }}>{mounted ? todayPts : 0}</div>
            <div style={{ fontSize: 10, color: "#5a6080" }}>/ {WEEKLY_MAX} pts max</div>
          </div>
        </div>

        {/* HABIT BLOCKS */}
        {BLOCKS.map(block => {
          const blockHabits = HABITS.filter(h => h.block === block.id);
          const blockDone = blockHabits.filter(h => completed[h.id]).length;
          const blockPts = blockHabits.filter(h => completed[h.id]).reduce((a, h) => a + h.points, 0);
          const blockPct = Math.round((blockDone / blockHabits.length) * 100);

          return (
            <div key={block.id} style={{ background: "#13161e", border: "1px solid #232736", borderRadius: 8, marginBottom: 10, overflow: "hidden" }}>
              <div style={{ height: 2, background: block.color }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px 10px", borderBottom: "1px solid #232736" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: block.color }}>{block.label}</div>
                  <div style={{ fontSize: 10, color: "#5a6080", marginTop: 2 }}>{block.subtitle}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{blockDone}/{blockHabits.length}</div>
                    <div style={{ fontSize: 10, color: "#5a6080" }}>{blockPts} pts earned</div>
                  </div>
                  <div style={{ width: 48, background: "#1a1d2e", borderRadius: 3, height: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${blockPct}%`, background: block.color, borderRadius: 3, transition: "width 0.4s" }} />
                  </div>
                </div>
              </div>

              <div style={{ padding: "8px 10px" }}>
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
                        padding: "11px 12px", marginBottom: 5, borderRadius: 6,
                        border: `1px solid ${isDone ? block.color + "50" : isAvailable ? "#2d3244" : "#1e2230"}`,
                        background: isDone ? block.color + "10" : isAvailable ? "#1a1d2e" : "#111318",
                        opacity: isLocked ? 0.35 : 1,
                        cursor: isAvailable ? "pointer" : "default",
                        transition: "all 0.15s ease",
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                        border: `2px solid ${isDone ? block.color : isAvailable ? "#363a52" : "#232736"}`,
                        background: isDone ? block.color : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s ease",
                      }}>
                        {isSaving ? <span style={{ fontSize: 10 }}>⏳</span> :
                         isDone ? <span style={{ fontSize: 12, color: "#000", fontWeight: 800 }}>✓</span> :
                         isLocked ? <span style={{ fontSize: 9 }}>🔒</span> : null}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: isAvailable ? 600 : 500,
                          color: isDone ? "#5a6080" : isLocked ? "#363a52" : "#f0f2f8",
                          textDecoration: isDone ? "line-through" : "none",
                        }}>
                          {habit.icon} {habit.label}
                        </div>
                        {isLocked && <div style={{ fontSize: 10, color: "#363a52", marginTop: 2 }}>Complete previous habits to unlock</div>}
                      </div>

                      {habit.points > 0 && (
                        <div style={{
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                          color: isDone ? block.color : isLocked ? "#2d3244" : "#8b92b4",
                          background: isDone ? block.color + "20" : "#0d0f14",
                          padding: "3px 8px", borderRadius: 4,
                          border: `1px solid ${isDone ? block.color + "40" : "#232736"}`,
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
        <div style={{ background: "#13161e", border: "1px solid #232736", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ height: 2, background: "linear-gradient(90deg, #f59e0b, #2ecc71, #00c9ff)" }} />
          <div style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f0f2f8", marginBottom: 10 }}>🏆 Weekly Reward Tiers</div>
            {THRESHOLDS.map((t, i) => {
              const isActive = mounted && todayPts >= t.min && (i === 0 || todayPts < THRESHOLDS[i - 1].min);
              const isAchieved = mounted && todayPts >= t.min;
              return (
                <div key={t.min} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px", borderRadius: 6, marginBottom: 5,
                  background: isActive ? t.color + "15" : "#1a1d2e",
                  border: `1px solid ${isActive ? t.color + "50" : "#232736"}`,
                  opacity: isAchieved ? 1 : 0.45,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.color, flexShrink: 0, boxShadow: isActive ? `0 0 8px ${t.color}` : "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: "#5a6080", marginTop: 1 }}>{t.desc}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#5a6080", flexShrink: 0 }}>{t.min}+ pts</div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
