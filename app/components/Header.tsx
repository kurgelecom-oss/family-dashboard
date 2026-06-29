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
        <a href="https://ansar-habits-tracker.netlify.app/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--text-secondary)", textDecoration: "none", opacity: 0.5, transition: "opacity 0.2s", marginRight: 12 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>ansar</a>
        <a href="https://luxury-kringle-cf4171.netlify.app/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--text-secondary)", textDecoration: "none", opacity: 0.5, transition: "opacity 0.2s", marginRight: 12 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>links</a>
        <div className="header-date">{date}</div>
        <div className="header-time">{time}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={toggleTheme}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 12px", borderRadius: 20,
              background: theme === "day" ? "#ffffff" : "#252a4a",
              border: theme === "day" ? "1px solid #e0e4ed" : "1px solid rgba(255,255,255,0.15)",
              color: theme === "day" ? "#0a2540" : "#ffffff",
              cursor: "pointer", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              transition: "all 0.2s ease",
            }}
          >
            {theme === "day" ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2"/>
                <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2"/>
                <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2"/>
                <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
            {theme === "day" ? "DAY" : "NIGHT"}
          </button>
          {manualOverride && (
            <button
              onClick={resetAuto}
              style={{
                fontSize: 10, color: "var(--text-secondary)", background: "transparent",
                border: "1px solid var(--border)", borderRadius: 12, cursor: "pointer",
                fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
                padding: "3px 8px",
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
