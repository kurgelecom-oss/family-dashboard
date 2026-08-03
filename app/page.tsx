"use client";
import Header from "./components/Header";
import PanelFinance from "./components/PanelFinance";
import PanelEcom from "./components/PanelEcom";
import PanelCalendar from "./components/PanelCalendar";
import PanelHabits from "./components/PanelHabits";
import PanelTodos from "./components/PanelTodos";
import PanelHomeschoolWeek from "./components/PanelHomeschoolWeek";
import GoalsIntermission from "./components/GoalsIntermission";

export default function Dashboard() {
  return (
    <div className="dashboard">
      <GoalsIntermission />
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
        {/* Column 4 — Calendar + Homeschool Week peek (compact) + Ansar Habits.
            Order matters on mobile too, where the columns stack vertically. */}
        <div className="dashboard-col">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelCalendar />
          </div>
          <PanelHomeschoolWeek />
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelHabits />
          </div>
        </div>
      </div>
    </div>
  );
}
