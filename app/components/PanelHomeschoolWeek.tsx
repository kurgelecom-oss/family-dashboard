"use client";
import { useState, useEffect, useCallback } from "react";
import { getTodayDate, getWeekStart } from "../lib/supabase";

// ─── Compact Homeschool Week widget (peek at Nihal's /week schedule) ─────────
// Shows today's current time block + the next upcoming event. Reuses the exact
// /api/schedule data shape and date logic from app/week/page.tsx so "today",
// day matching, and time parsing stay identical to the full weekly view.

const ANSAR = "var(--amber)"; // Ansar = orange across the dashboard
const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // idx 0 = Monday

type ScheduleEntry = {
  entry: string; days: string[]; date: string | null;
  start: string; end: string; category: string; detail: string; emoji: string;
};

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// "6:45am" / "7:00pm" / "12:15am" → minutes since midnight; unparseable → end of day
const END_OF_DAY = 24 * 60;
function parseMinutes(s: string): number {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return END_OF_DAY;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + parseInt(m[2] ?? "0", 10);
}

// Minutes since midnight in AEST (matches Header.tsx / week theme handling: UTC + 10)
function aestNowMinutes(): number {
  const now = new Date();
  return ((now.getUTCHours() + 10) % 24) * 60 + now.getUTCMinutes();
}

function entryLabel(e: ScheduleEntry): string {
  const name = e.detail || e.entry;
  return e.emoji ? `${e.emoji} ${name}` : name;
}

export default function PanelHomeschoolWeek() {
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [nowMin, setNowMin] = useState<number>(aestNowMinutes());

  const loadSchedule = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule");
      if (!res.ok) return;
      const entries = (await res.json()) as ScheduleEntry[];
      if (Array.isArray(entries)) setSchedule(entries);
    } catch {
      // best-effort; widget shows its empty state instead
    }
  }, []);

  useEffect(() => {
    loadSchedule();
    // Refresh schedule + "now" cursor every 60s so the always-on TV stays current
    const id = setInterval(() => { loadSchedule(); setNowMin(aestNowMinutes()); }, 60_000);
    return () => clearInterval(id);
  }, [loadSchedule]);

  // Today's entries (recurring day-name prefix match OR one-off date), time-sorted
  const weekStart = getWeekStart();
  const weekDates = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));
  const todayIdx = weekDates.indexOf(getTodayDate());
  const todayKey = todayIdx >= 0 ? DAY_KEYS[todayIdx] : "";
  const todayDate = todayIdx >= 0 ? weekDates[todayIdx] : null;

  const todayEntries = todayIdx < 0 ? [] : schedule
    .filter(e =>
      e.days.some(d => d.slice(0, 3) === todayKey) || e.date === todayDate
    )
    .sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));

  const nowBlock = todayEntries.find(e =>
    nowMin >= parseMinutes(e.start) && nowMin < parseMinutes(e.end)
  );
  const nextBlock = todayEntries.find(e => parseMinutes(e.start) > nowMin);

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "baseline", gap: 8, minWidth: 0,
  };
  const tagStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: "var(--text-muted)", width: 34, flexShrink: 0,
  };
  const nameStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };
  const timeStyle: React.CSSProperties = {
    fontSize: 11, color: "var(--text-secondary)", marginLeft: "auto",
    flexShrink: 0, fontVariantNumeric: "tabular-nums",
  };

  return (
    <div className="card" style={{ flex: "0 0 auto" }}>
      <div className="card-header">
        <div className="card-title">Homeschool Week</div>
        <a
          href="/week"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 10, color: "var(--amber)", textDecoration: "none",
            fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            background: "rgba(245,166,35,0.1)", padding: "2px 7px", borderRadius: 4,
            border: "1px solid rgba(245,166,35,0.2)", display: "inline-flex",
          }}
        >
          Open →
        </a>
      </div>

      {todayEntries.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "2px 0" }}>
          No schedule today
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={rowStyle}>
            <span style={{ ...tagStyle, color: nowBlock ? ANSAR : "var(--text-muted)" }}>Now</span>
            {nowBlock ? (
              <>
                <span style={nameStyle}>{entryLabel(nowBlock)}</span>
                <span style={timeStyle}>{nowBlock.start}{nowBlock.end ? `–${nowBlock.end}` : ""}</span>
              </>
            ) : (
              <span style={{ ...nameStyle, color: "var(--text-muted)", fontWeight: 500 }}>—</span>
            )}
          </div>
          <div style={rowStyle}>
            <span style={tagStyle}>Next</span>
            {nextBlock ? (
              <>
                <span style={nameStyle}>{entryLabel(nextBlock)}</span>
                <span style={timeStyle}>{nextBlock.start}</span>
              </>
            ) : (
              <span style={{ ...nameStyle, color: "var(--text-muted)", fontWeight: 500 }}>
                Nothing later today
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
