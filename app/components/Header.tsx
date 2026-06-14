"use client";
import { useState, useEffect } from "react";

export default function Header() {
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");

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

  return (
    <header className="header">
      <div className="header-brand">
        <div className="header-name">Kurgel <span>Pty Ltd</span></div>
        <div className="header-sub">Family Dashboard</div>
      </div>
      <div className="header-right">
        <div className="header-date">{date}</div>
        <div className="header-time">{time}</div>
        <div className="live-badge"><span className="live-dot" />Live</div>
      </div>
    </header>
  );
}
