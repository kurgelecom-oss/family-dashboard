"use client";

const days = [
  { name: "Mon", num: 9 },
  { name: "Tue", num: 10 },
  { name: "Wed", num: 11 },
  { name: "Thu", num: 12 },
  { name: "Fri", num: 13 },
  { name: "Sat", num: 14 },
  { name: "Sun", num: 15 },
];

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

export default function PanelCalendar() {
  return (
    <div className="panel col-5">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="panel-title">Family Calendar · This Week</div>
        <span className="badge badge-cyan">9–15 June</span>
      </div>

      {/* Day strip */}
      <div className="day-strip">
        {days.map((d) => (
          <div key={d.name} className={`day-cell${d.num === 14 ? " today" : ""}`}>
            <div className="day-name">{d.name}</div>
            <div className="day-num">{d.num}</div>
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
