"use client";
import Header from "./components/Header";
import PanelHabits from "./components/PanelHabits";
import PanelEcom from "./components/PanelEcom";
import PanelBudget from "./components/PanelBudget";
import PanelGoals from "./components/PanelGoals";
import PanelCalendar from "./components/PanelCalendar";

export default function Dashboard() {
  return (
    <div className="dashboard">
      <Header />
      <div className="dashboard-content">
        {/* Top row: 55% — Goals + Ecom */}
        <div className="dashboard-row-top">
          <PanelGoals />
          <PanelEcom />
        </div>
        {/* Bottom row: 45% — Budget + Calendar + Habits */}
        <div className="dashboard-row-bottom">
          <PanelBudget />
          <PanelCalendar />
          <PanelHabits />
        </div>
      </div>
    </div>
  );
}
