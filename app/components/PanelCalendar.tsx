"use client";
import { useState, useEffect } from "react";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Hardcoded events — replaced by MS Graph API in a future session
const events = [
  { member: "Taylan", color: "var(--cyan)", items: [
    { day: "Mon", text: "Client call — 9:00 AM" },
    { day: "Wed", text: "Gym — 6:00 AM" },
    { day: "Sat", text: "Family alignment — 10:00 AM" },
  ]},
  { member: "Nihal", color: "var(--green)", items: [
    { day: "Tue", text: "Product shoot — 2:00 PM" },
    { day: "Thu", text: "Supplier call — 11:00 AM" },
    { day: "Sat", text: "Family alignment — 10:00 AM" },
  ]},
  { member: "Ansar", color: "var(--amber)", items: [
    { day: "Mon", text: "School — 8:30 AM" },
    { day: "Wed", text: "Football training — 4:00 PM" },
    { day: "Fri", text: "School — 8:30 AM" },
  ]},
  { member: "Family", color: "var(--red)", items: [
    { day: "Sat", text: "Family alignment — 10:00 AM" },
    { day: "Sun", text: "Sunday meal — 1:00 PM" },
  ]},
];

function getWeekDays() {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return DAY_NAMES.map((name, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { name, date: d };
  });
}

export default function PanelCalendar() {
  const [days, setDays] = useState<{ name: string; date: Date }[]>([]);
  const [todayDay, setTodayDay] = useState(-1);
  const [todayMonth, setTodayMonth] = useState(-1);
  const [weekLabel, setWeekLabel] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const weekDays = getWeekDays();
    const now = new Date();
    setDays(weekDays);
    setTodayDay(now.getDate());
    setTodayMonth(now.getMonth());

    const mon = weekDays[0].date;
    const sun = weekDays[6].date;
    const label = mon.getMonth() === sun.getMonth()
      ? `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`
      : `${mon.getDate()} ${mon.toLocaleDateString("en-AU", { month: "short" })} – ${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short" })}`;
    setWeekLabel(label);
    setMounted(true);
  }, []);

  return (
    <div className="panel col-5">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="panel-title">Family Calendar · This Week</div>
        <span className="badge badge-cyan">{mounted ? weekLabel : "—"}</span>
      </div>

      {/* Day strip */}
      <div className="day-strip">
        {mounted ? days.map((d) => {
          const isToday = d.date.getDate() === todayDay && d.date.getMonth() === todayMonth;
          return (
            <div key={d.name} className={`day-cell${isToday ? " today" : ""}`}>
              <div className="day-name">{d.name}</div>
              <div className="day-num">{d.date.getDate()}</div>
            </div>
          );
        }) : DAY_NAMES.map((name) => (
          <div key={name} className="day-cell">
            <div className="day-name">{name}</div>
            <div className="day-num">—</div>
          </div>
        ))}
      </div>

      <div className="divider" />

      {/* Events by member */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {events.map((member) => (
          <div key={member.member}>
            <div style={{ fontSize: 10, fontWeight: 700, color: member.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              {member.member}
            </div>
            {member.items.map((ev, i) => (
              <div key={i} className="list-item" style={{ padding: "4px 0" }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>{ev.day}</span>
                <span className="list-name" style={{ flex: 1 }}>{ev.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
