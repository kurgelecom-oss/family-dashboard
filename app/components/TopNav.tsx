"use client";
import { useEffect, useState } from "react";

const LINKS = [
  { label: "Family Dashboard",      href: "https://kurgel-dashboard.netlify.app/" },
  // Second, not last: .topnav scrolls horizontally on a phone and only the
  // first couple of entries are reachable without swiping, so the daily
  // check-in has to sit where it is one tap from every screen. Absolute like
  // every other same-site entry — the matcher below runs new URL(link.href)
  // with no base, and a bare "/mission" would throw there and take active-state
  // detection down for the whole nav, not just this link.
  { label: "Mission",               href: "https://kurgel-dashboard.netlify.app/mission" },
  { label: "ECOM Launchpad",        href: "https://ecom-launchpad-mentor.netlify.app/" },
  { label: "Calculator",            href: "https://kurgel-dashboard.netlify.app/profit.html" },
  { label: "Ansar · ANSAR FC",      href: "https://ansar-habits-tracker.netlify.app/" },
  { label: "Time Allocation Board", href: "https://kurgel-dashboard.netlify.app/board" },
  { label: "ORIGINS",               href: "https://kurgel-dashboard.netlify.app/origins" },
  { label: "Link Board",            href: "https://luxury-kringle-cf4171.netlify.app/" },
];

function normPath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function IncidentCounter() {
  const [daysSince, setDaysSince] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIncident = async () => {
      try {
        const res = await fetch("/api/incident");
        const data = await res.json();
        setDaysSince(data.daysSince);
      } catch (err) {
        console.error("Failed to fetch incident data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchIncident();
    const interval = setInterval(fetchIncident, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading || daysSince === null) return null;

  return (
    <div className="incident-counter">
      <span className="incident-dot"></span>
      <span className="incident-text">{daysSince} days since <a href="https://tally.so/forms/68Ygxo/submissions" target="_blank" rel="noopener noreferrer" className="incident-link">last</a></span>
    </div>
  );
}

export default function TopNav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const host = window.location.hostname;
    const path = normPath(window.location.pathname);
    const match = LINKS.find((link) => {
      const url = new URL(link.href);
      return url.hostname === host && normPath(url.pathname) === path;
    });
    setActive(match ? match.href : null);
  }, []);

  return (
    <nav className="topnav">
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={link.href === active ? "topnav-link active" : "topnav-link"}
        >
          {link.label}
        </a>
      ))}
      <IncidentCounter />
    </nav>
  );
}
