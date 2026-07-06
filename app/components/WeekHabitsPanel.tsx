"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase, getTodayDate } from "../lib/supabase";

// ─── Today's habit checklist — side panel for /week ─────────────────────────
// Read-only mirror of the ansar-habits-tracker app: ticks appear here as Ansar
// marks habits off through the day. Ids/blocks match habit_completions rows;
// labels are short forms of the tracker's full labels (narrow panel).
const SOCCER_DAYS = ["Monday", "Wednesday"];

type Habit = { id: string; label: string; icon: string };

const BLOCKS: { id: string; label: string; color: string; habits: Habit[] }[] = [
  {
    id: "pre", label: "Pre-Homeschool", color: "var(--amber)",
    habits: [
      { id: "feet_floor",  label: "Feet on floor 6:45am", icon: "🌅" },
      { id: "fajr",        label: "Fajr Namaz",           icon: "🕌" },
      { id: "bed_dressed", label: "Bed made + dressed",   icon: "🛏️" },
      { id: "movement",    label: "Morning movement",     icon: "⚽" },
      { id: "breakfast",   label: "Breakfast · no screens", icon: "🍳" },
      { id: "quran",       label: "Qur'an 20 min",        icon: "📖" },
      { id: "goals",       label: "Daily goals written",  icon: "✍️" },
    ],
  },
  {
    id: "school", label: "Homeschool", color: "var(--cyan)",
    habits: [
      { id: "homeschool_session", label: "Homeschool session", icon: "📚" },
      { id: "readtheory",         label: "ReadTheory",         icon: "📝" },
      { id: "khan",               label: "Khan Academy",       icon: "🎓" },
      { id: "journal",            label: "Learning journal",   icon: "📒" },
    ],
  },
  {
    id: "arvo", label: "Afternoon / Evening", color: "#a78bfa",
    habits: [
      { id: "btn_cornell", label: "BTN + Cornell notes", icon: "📰" },
      { id: "all_namaz",   label: "All Namaz",           icon: "🕌" },
      { id: "room_tidy",   label: "Room tidy",           icon: "🧹" },
      { id: "shower",      label: "Shower",              icon: "🚿" },
      { id: "teeth",       label: "Teeth brushed",       icon: "🪥" },
      { id: "reading",     label: "Reading in bed",      icon: "🌙" },
    ],
  },
  {
    id: "conditional", label: "Soccer · Mon & Wed", color: "var(--green)",
    habits: [
      { id: "soccer_training", label: "Soccer training", icon: "⚽" },
    ],
  },
];

export default function WeekHabitsPanel() {
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
    // 10s poll matches PanelHabits — ticks land on the wall display fast.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const todayName = new Date().toLocaleDateString("en-AU", { weekday: "long" });
  const hasSoccer = SOCCER_DAYS.includes(todayName);
  const blocks = BLOCKS.filter(b => b.id !== "conditional" || hasSoccer);

  const allHabits = blocks.flatMap(b => b.habits);
  const doneCount = allHabits.filter(h => completed[h.id]).length;

  return (
    <div className="card" style={{
      width: 250, flexShrink: 0, minHeight: 0,
      display: "flex", flexDirection: "column", padding: 12,
    }}>
      <div className="card-header" style={{ flexShrink: 0 }}>
        <div className="card-title">Today · Habits</div>
        <span className="badge" style={{ background: "rgba(245,166,35,0.15)", color: "var(--amber)" }}>
          {mounted ? `${doneCount}/${allHabits.length}` : "—"}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {blocks.map(block => (
          <div key={block.id}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
              color: block.color, marginBottom: 4,
            }}>
              {block.label} · {block.habits.filter(h => completed[h.id]).length}/{block.habits.length}
            </div>
            {block.habits.map(h => {
              const done = mounted && !!completed[h.id];
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                  <span style={{
                    fontSize: 12, fontWeight: 800, width: 16, textAlign: "center", flexShrink: 0,
                    color: done ? "var(--green)" : "var(--text-muted)",
                  }}>
                    {done ? "✓" : "○"}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, lineHeight: 1.3,
                    color: done ? "var(--text-muted)" : "var(--text-primary)",
                    textDecoration: done ? "line-through" : "none",
                  }}>
                    {h.icon} {h.label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
