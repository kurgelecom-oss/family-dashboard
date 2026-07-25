"use client";
import Header from "./components/Header";
import PanelFinance from "./components/PanelFinance";
import PanelEcom from "./components/PanelEcom";
import PanelCalendar from "./components/PanelCalendar";
import PanelHabits from "./components/PanelHabits";
import PanelTodos from "./components/PanelTodos";
import PanelHomeschoolWeek from "./components/PanelHomeschoolWeek";

export default function Dashboard() {
  return (
    <div className="dashboard">
      <Header />
      <div className="dashboard-grid">
        {/* Column 1 — Spending & Accounts (PocketSmith) */}
        <div className="dashboard-col">
          <PanelFinance />
        </div>
        {/* Column 2 — Ecom Business */}
        <div className="dashboard-col">
          <PanelEcom />
        </div>
        {/* Column 3 — Action Items. The Weekly Spend panel (cancelled Module 4)
            was removed from this route; its API routes and Supabase tables are
            untouched and /budget still renders it. */}
        <div className="dashboard-col">
          <PanelTodos />
        </div>
        {/* Column 4 — Homeschool Week peek (compact) + Calendar + Ansar Habits. */}
        <div className="dashboard-col">
          <PanelHomeschoolWeek />
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelCalendar />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelHabits />
          </div>
        </div>
      </div>
    </div>
  );
}
