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
        {/* Column 3 — Budget */}
        <div className="dashboard-col">
          <PanelBudget />
        </div>
        {/* Column 4 — Family: Calendar gets 1.2x, Todos gets 1x, Habits gets 0.8x */}
        <div className="dashboard-col">
          <div style={{ flex: 1.2, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelCalendar />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelTodos />
          </div>
          <div style={{ flex: 0.8, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <PanelHabits />
          </div>
        </div>
      </div>
    </div>
  );
}
