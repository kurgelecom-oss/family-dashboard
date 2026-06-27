"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

const COLOR_MAP: Record<string, string> = {
  cyan:  "var(--cyan)",
  green: "var(--green)",
  amber: "var(--amber)",
  red:   "var(--red)",
};

const ACCOUNTS = [
  { key: "TAYLAN", label: "Taylan", color: "cyan"  },
  { key: "NIHAL",  label: "Nihal",  color: "green" },
  { key: "ANSAR",  label: "Ansar",  color: "amber" },
];

const TOAST_COLORS: Record<string, string> = {
  TAYLAN: "#0099e6",
  NIHAL:  "#f5a623",
  ANSAR:  "#f39c12",
};

type CalEvent = {
  id: string;
  subject: string;
  startISO: string;
  endISO: string;
  isAllDay: boolean;
  account: string;
  email: string;
  color: string;
};

type CalResponse = {
  events: CalEvent[];
  configured: string[];
  missing: string[];
  errors?: string[];
};

type ToastItem = {
  id: string;
  subject: string;
  minsUntil: number;
  personColor: string;
};

function countdown(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "now";

  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);

  if (mins < 60) return `in ${mins}m`;
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }

  const eventDate = new Date(iso);
  const tomorrow  = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    eventDate.getDate()     === tomorrow.getDate()     &&
    eventDate.getMonth()    === tomorrow.getMonth()    &&
    eventDate.getFullYear() === tomorrow.getFullYear()
  ) {
    const t = eventDate.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
    return `tomorrow ${t}`;
  }

  if (days < 7) return `in ${days} days`;
  return eventDate.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (typeof document === "undefined" || toasts.length === 0) return null;

  return createPortal(
    <div style={{
      position:      "fixed",
      top:           72,
      right:         16,
      zIndex:        9999,
      display:       "flex",
      flexDirection: "column",
      gap:           8,
      pointerEvents: "none",
    }}>
      {toasts.map(toast => (
        <div key={toast.id} style={{
          pointerEvents: "auto",
          background:    "var(--bg-card)",
          border:        "1px solid var(--border)",
          borderLeft:    `4px solid ${toast.personColor}`,
          borderRadius:  8,
          padding:       "12px 16px",
          boxShadow:     "0 4px 12px rgba(0,0,0,0.12)",
          minWidth:      280,
          maxWidth:      360,
          position:      "relative",
        }}>
          <div style={{
            fontSize:     14,
            fontWeight:   600,
            color:        "var(--text-primary)",
            paddingRight: 20,
            marginBottom: 4,
            overflow:     "hidden",
            textOverflow: "ellipsis",
            whiteSpace:   "nowrap",
          }}>
            {toast.subject || "(No title)"}
          </div>
          <div style={{ fontSize: 12, color: "#6b7a99" }}>
            starts in {toast.minsUntil} min
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              position:   "absolute",
              top:        10,
              right:      10,
              background: "none",
              border:     "none",
              cursor:     "pointer",
              fontSize:   12,
              color:      "#6b7a99",
              padding:    "2px 4px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export default function PanelCalendar() {
  const [events,     setEvents]     = useState<CalEvent[]>([]);
  const [missing,    setMissing]    = useState<string[]>([]);
  const [calLoading, setCalLoading] = useState(true);
  const [toasts,     setToasts]     = useState<ToastItem[]>([]);

  const toastedIds = useRef<Set<string>>(new Set());

  const loadCalendar = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error(`${res.status}`);
      const data: CalResponse = await res.json();
      setEvents(data.events ?? []);
      setMissing(data.missing ?? []);
    } catch {
      // silent — show empty state
    } finally {
      setCalLoading(false);
    }
  }, []);

  const checkUpcomingEvents = useCallback(() => {
    const now       = Date.now();
    const threshold = 30 * 60 * 1000;
    const newToasts: ToastItem[] = [];

    for (const event of events) {
      if (event.isAllDay) continue;
      if (toastedIds.current.has(event.id)) continue;

      const diffMs = new Date(event.startISO).getTime() - now;
      if (diffMs > 0 && diffMs <= threshold) {
        const minsUntil   = Math.floor(diffMs / 60_000);
        const personColor = TOAST_COLORS[event.account] ?? "#6b7a99";

        toastedIds.current.add(event.id);
        newToasts.push({ id: event.id, subject: event.subject, minsUntil, personColor });

        const eventId = event.id;
        setTimeout(() => {
          setToasts(prev => prev.filter(t => t.id !== eventId));
        }, 600_000);
      }
    }

    if (newToasts.length > 0) {
      setToasts(prev => [...prev, ...newToasts]);
    }
  }, [events]);

  useEffect(() => {
    loadCalendar();
    const fetchId = setInterval(loadCalendar, 60 * 60 * 1000);
    return () => { clearInterval(fetchId); };
  }, [loadCalendar]);

  useEffect(() => {
    checkUpcomingEvents();
    const checkId = setInterval(checkUpcomingEvents, 60_000);
    return () => { clearInterval(checkId); };
  }, [checkUpcomingEvents]);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div className="card">
        <div className="card-header">
          <div className="card-title">Family Calendar</div>
          {!calLoading && missing.length === 0 && (
            <span className="badge badge-green">● Live</span>
          )}
          {!calLoading && missing.length > 0 && (
            <span className="badge badge-amber">⚠ Partial</span>
          )}
        </div>

        {missing.length > 0 && !calLoading && (
          <div style={{
            background: "rgba(245,166,35,0.07)", border: "1px solid rgba(245,166,35,0.2)",
            borderRadius: 5, padding: "5px 8px", fontSize: 10, color: "var(--amber)",
            marginBottom: 8, flexShrink: 0,
          }}>
            ⚠ Not connected: {missing.join(", ")}
          </div>
        )}

        {calLoading && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "12px 0" }}>
            Loading calendar…
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 10 }}>
          {!calLoading && ACCOUNTS.map(acct => {
            const personEvents = events.filter(e => e.account === acct.key).slice(0, 2);
            const notConnected = missing.some(m =>
              m === (acct.key === "TAYLAN" ? "taylan.k8@hotmail.com" :
                     acct.key === "NIHAL"  ? "nils_gvi@hotmail.com"  :
                                             "ansar.k11@hotmail.com")
            );
            const color = COLOR_MAP[acct.color] ?? "var(--text-muted)";

            return (
              <div key={acct.key}>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.06em", color, marginBottom: 4,
                }}>
                  {acct.label}
                </div>

                {notConnected ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>Not connected</div>
                ) : personEvents.length === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 4 }}>No upcoming events</div>
                ) : (
                  personEvents.map(e => (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <div style={{ width: 3, height: 20, borderRadius: 2, flexShrink: 0, background: color }} />
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {e.subject || "(No title)"}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0, marginLeft: 6 }}>
                        {e.isAllDay ? "all day" : countdown(e.startISO)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}

          {!calLoading && events.length === 0 && missing.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
              No upcoming events.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
