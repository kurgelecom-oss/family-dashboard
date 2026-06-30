"use client";
import Header from "./components/Header";
import PanelGoals from "./components/PanelGoals";
import PanelEcom from "./components/PanelEcom";
import PanelBudget from "./components/PanelBudget";
import PanelCalendar from "./components/PanelCalendar";
import PanelHabits from "./components/PanelHabits";
import PanelTodos from "./components/PanelTodos";

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
          <div style={{ flex: 2, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelTodos />
          </div>
        </div>
        {/* Column 4 — Calendar (top) + Ansar Habits (bottom). Same flex ratio as Column 3. */}
        <div className="dashboard-col">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelCalendar />
          </div>
          <div style={{ flex: 2, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelHabits />
          </div>
        </div>
      </div>
    </div>
  );
}
