"use client";
import { useEffect, useRef, useState } from "react";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Family Dashboard",      href: "https://kurgel-dashboard.netlify.app/" },
  // Second, not last: .topnav scrolls horizontally on a phone and only the
  // first couple of entries are reachable without swiping, so the daily
  // check-in has to sit where it is one tap from every screen. It points
  // off-site now — the board lives on the manifesto page, and this origin's
  // /mission is a 308 to exactly that, so linking direct saves the hop.
  // Absolute like every other entry: the matcher below runs new URL(link.href)
  // with no base, and a bare path would throw there and take active-state
  // detection down for the whole nav, not just this link.
  { label: "ECOM Launchpad",        href: "https://ecom-launchpad-mentor.netlify.app/" },
  { label: "Calculator",            href: "https://kurgel-dashboard.netlify.app/profit.html" },
  { label: "Time Allocation Board", href: "https://kurgel-dashboard.netlify.app/board" },
  { label: "ORIGINS",               href: "https://kurgel-dashboard.netlify.app/origins" },
  { label: "Link Board",            href: "https://luxury-kringle-cf4171.netlify.app/" },
  // Off-network surface, unlike every entry above it: opens in its own tab so
  // the dashboard stays put on the TV. `external` is the only per-link flag —
  // className and wrapper stay identical to the siblings.
  { label: "kdgm",                  href: "https://dashboard.kdgm.com.au/", external: true },
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

/* Deliberately unlabeled — a small pulsing red button beside the incident
   counter. One press starts a countdown pill ("day X of Y") that flashes
   red beside it, then everything but the button disappears again. While a
   tracker is running the button is inert (the API also 409s), so a stray tap
   cannot restart the count. State lives in Supabase via /api/cycle; if that
   read fails the button still renders — only the pill needs data. */
interface CycleHistoryEntry {
  startedOn: string;
  gapDays: number | null;
  sane: boolean;
}

interface CycleHistory {
  entries: CycleHistoryEntry[];
  count: number;
  avgGap: number | null;
  minGap: number | null;
  maxGap: number | null;
  expectedNext: string | null;
  expectedInDays: number | null;
}

function CycleTracker() {
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [totalDays, setTotalDays] = useState<number | null>(null);
  const [headsUp, setHeadsUp] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Long-press (600ms) on the button opens the unlabeled history panel; a
     plain tap keeps its recording meaning. The panel is the only surface that
     shows the log, and only on deliberate gesture — nothing leaks to the TV. */
  const [panelOpen, setPanelOpen] = useState(false);
  const [history, setHistory] = useState<CycleHistory | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/cycle");
        if (!res.ok) return;
        const data = await res.json();
        setActiveDay(typeof data.activeDay === "number" ? data.activeDay : null);
        setTotalDays(typeof data.totalDays === "number" ? data.totalDays : null);
        // Server only sets expectedInDays inside the ±3-day window and never
        // while a tracker is active, so presence alone is the signal.
        setHeadsUp(typeof data.expectedInDays === "number");
      } catch {
        // Unreachable state must not take the nav down; the button stays.
      }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const openPanel = async () => {
    setPanelOpen(true);
    try {
      const res = await fetch("/api/cycle?history=1");
      if (!res.ok) return;
      setHistory((await res.json()) as CycleHistory);
    } catch {
      // Panel opens empty rather than not at all; closing and re-holding retries.
    }
  };

  const startHold = () => {
    longPressed.current = false;
    holdTimer.current = setTimeout(() => {
      longPressed.current = true;
      void openPanel();
    }, 600);
  };

  const cancelHold = () => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const press = async () => {
    // A long press already consumed this gesture — it must not also record.
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (activeDay !== null || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/cycle", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setActiveDay(typeof data.activeDay === "number" ? data.activeDay : null);
        setTotalDays(typeof data.totalDays === "number" ? data.totalDays : null);
      }
    } catch {
      // Failed press stays silent on screen; the next tap retries.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cycle-wrap">
      {headsUp && activeDay === null && <span className="cycle-heads-up" />}
      {activeDay !== null && totalDays !== null && (
        <span className="cycle-pill">day {activeDay} of {totalDays}</span>
      )}
      <button
        type="button"
        className={activeDay === null ? "cycle-btn" : "cycle-btn cycle-btn-quiet"}
        onClick={press}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="tracker"
      />
      {panelOpen && (
        <>
          <div className="cycle-panel-backdrop" onClick={() => setPanelOpen(false)} />
          <div className="cycle-panel">
            {history === null ? (
              <div className="cycle-panel-empty">…</div>
            ) : history.count === 0 ? (
              <div className="cycle-panel-empty">no entries yet</div>
            ) : (
              <>
                <div className="cycle-panel-stats">
                  <span>{history.count} recorded</span>
                  {history.avgGap !== null && <span>avg {history.avgGap}d</span>}
                  {history.minGap !== null && history.maxGap !== null && (
                    <span>{history.minGap}–{history.maxGap}d</span>
                  )}
                  {history.expectedNext !== null && (
                    <span className="cycle-panel-next">next ~{history.expectedNext}</span>
                  )}
                </div>
                <ul className="cycle-panel-list">
                  {history.entries.map((entry) => (
                    <li key={entry.startedOn}>
                      <span>{entry.startedOn}</span>
                      <span className={entry.gapDays !== null && !entry.sane ? "cycle-gap-odd" : undefined}>
                        {entry.gapDays === null ? "current" : `${entry.gapDays}d`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
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
          {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {link.label}
        </a>
      ))}
      <IncidentCounter />
      <CycleTracker />
    </nav>
  );
}
