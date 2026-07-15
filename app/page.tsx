"use client";
import Header from "./components/Header";
import PanelGoals from "./components/PanelGoals";
import PanelEcom from "./components/PanelEcom";
import PanelBudget from "./components/PanelBudget";
import PanelCalendar from "./components/PanelCalendar";
import PanelHabits from "./components/PanelHabits";
import PanelTodos from "./components/PanelTodos";
import PanelHomeschoolWeek from "./components/PanelHomeschoolWeek";

export default function Dashboard() {
  return (
    <div className="dashboard">
      <Header />
      <div className="dashboard-grid">
        {/* Column 1 — Ecom Goals */}
        <div className="dashboard-col">
          <PanelGoals />
        </div>
        {/* Column 2 — Ecom Business */}
        <div className="dashboard-col">
          <PanelEcom />
        </div>
        {/* Column 3 — Weekly Spend (top) + Action Items (bottom). Mirrors Column 4 so
            Action Items and Ansar Habits render as an even side-by-side pair. */}
        <div className="dashboard-col">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelBudget />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelTodos />
          </div>
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
