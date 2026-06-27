"use client";
import { useEffect } from "react";
import Header from "./components/Header";
import PanelGoals from "./components/PanelGoals";
import PanelEcom from "./components/PanelEcom";
import PanelBudget from "./components/PanelBudget";
import PanelCalendar from "./components/PanelCalendar";
import PanelHabits from "./components/PanelHabits";

function getAestHour(): number {
  return (new Date().getUTCHours() + 10) % 24;
}

export default function Dashboard() {
  useEffect(() => {
    const apply = () => {
      const theme = getAestHour() >= 17 ? "night" : "day";
      document.documentElement.setAttribute("data-theme", theme);
    };
    apply();
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, []);

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
        {/* Column 4 — Family */}
        <div className="dashboard-col">
          <PanelCalendar />
          <PanelHabits />
        </div>
      </div>
    </div>
  );
}
