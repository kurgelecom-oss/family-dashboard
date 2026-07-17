"use client";
import { useEffect, useState } from "react";

// Canonical nav shared across all six surfaces. Absolute URLs throughout —
// including self-links — so this list stays byte-identical in every repo.
const LINKS = [
  { label: "Family Dashboard",      href: "https://kurgel-dashboard.netlify.app/" },
  { label: "ECOM Launchpad",        href: "https://ecom-launchpad-mentor.netlify.app/" },
  { label: "Homeschool Week",       href: "https://kurgel-dashboard.netlify.app/week" },
  { label: "Ansar · ANSAR FC",      href: "https://ansar-habits-tracker.netlify.app/" },
  { label: "Time Allocation Board", href: "https://time-allocation-board.netlify.app/" },
  { label: "Link Board",            href: "https://luxury-kringle-cf4171.netlify.app/" },
];

// "/week/" and "/week" are the same page; "" is "/".
function normPath(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export default function TopNav() {
  // Resolved after mount: window doesn't exist during SSR, and matching on it
  // during render would desync hydration. Nothing is active on the first paint.
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
    </nav>
  );
}
