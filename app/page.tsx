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
      <div className="grid">
        {/* Row 1 */}
        <PanelHabits />
        <PanelEcom />
        <PanelBudget />
        {/* Row 2 */}
        <PanelGoals />
        <PanelCalendar />
      </div>
    </div>
  );
}
