"use client";
import { useState, useEffect } from "react";

function getAestHour(): number {
  return (new Date().getUTCHours() + 10) % 24;
}

function getAutoTheme(): "day" | "night" {
  return getAestHour() >= 17 ? "night" : "day";
}

export default function Header() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [theme, setTheme] = useState<"day" | "night">("night");
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("themeOverride") as "day" | "night" | null;
    const initial = stored ?? getAutoTheme();
    setTheme(initial);
    setManualOverride(!!stored);
    document.documentElement.setAttribute("data-theme", initial);

    const id = setInterval(() => {
      if (!localStorage.getItem("themeOverride")) {
        const auto = getAutoTheme();
        setTheme(auto);
        document.documentElement.setAttribute("data-theme", auto);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      setDate(now.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const toggleTheme = () => {
    const next: "day" | "night" = theme === "day" ? "night" : "day";
    localStorage.setItem("themeOverride", next);
    setTheme(next);
    setManualOverride(true);
    document.documentElement.setAttribute("data-theme", next);
  };

  const resetAuto = () => {
    localStorage.removeItem("themeOverride");
    const auto = getAutoTheme();
    setTheme(auto);
    setManualOverride(false);
    document.documentElement.setAttribute("data-theme", auto);
  };

  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-name">Kurgel <span>Pty Ltd</span></div>
        <div className="header-sub">Family Dashboard</div>
      </div>
      <div className="header-right">
        <div className="header-date">{date}</div>
        <div className="header-time">{time}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={toggleTheme}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 12px", borderRadius: 20,
              background: theme === "day" ? "#ffffff" : "#252a4a",
              border: theme === "day" ? "1px solid #e0e4ed" : "1px solid rgba(255,255,255,0.1)",
              color: theme === "day" ? "#0a2540" : "#ffffff",
              cursor: "pointer", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}
          >
            {theme === "day" ? "☀️ DAY" : "🌙 NIGHT"}
          </button>
          {manualOverride && (
            <button
              onClick={resetAuto}
              style={{
                fontSize: 10, color: "var(--text-muted)", background: "none",
                border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer",
                fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
                padding: "2px 7px",
              }}
            >
              AUTO
            </button>
          )}
        </div>
        <div className="live-badge"><span className="live-dot" />Live</div>
      </div>
    </header>
  );
}
