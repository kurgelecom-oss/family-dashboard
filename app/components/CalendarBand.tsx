"use client";

import { useCallback, useEffect, useState } from "react";

/* ════════════════════════════════════════════════════════════════════════════
   Calendar band — added ABOVE the board on /board. RESTRUCTURE-SPEC §4.

   A grid with a row per person (Taylan, Nihal, Ansar) and two columns,
   Today · Tomorrow. Events render as small blocks with the person's coloured
   left border and the start time; an empty cell shows "—"; tapping a block
   opens the event in Outlook (webLink from the existing calendar route).

   Data: /api/calendar, hourly — PanelCalendar's own cadence. Today and
   tomorrow are SYDNEY calendar days resolved through Intl, never the device's
   local date and never an offset constant.
   ══════════════════════════════════════════════════════════════════════════ */

type CalEvent = {
  id: string;
  subject: string;
  startISO: string;
  isAllDay: boolean;
  account: string;
  webLink?: string;
};

type CalResponse = {
  events: CalEvent[];
  missing: string[];
};

const PEOPLE = [
  { key: "TAYLAN", label: "Taylan", color: "var(--cyan)" },
  { key: "NIHAL", label: "Nihal", color: "var(--green)" },
  { key: "ANSAR", label: "Ansar", color: "var(--amber)" },
] as const;

/** An instant's calendar date in Sydney, "YYYY-MM-DD". */
function sydneyDateOf(instantMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantMs));
}

/** Graph strings can arrive with no offset — bare means UTC (see /api/calendar). */
function parseEventTime(iso: string): number {
  const hasTimezone =
    iso.endsWith("Z") || iso.includes("+") || (iso.length > 19 && iso.slice(10).includes("-"));
  return new Date(hasTimezone ? iso : iso + "Z").getTime();
}

function timeLabel(e: CalEvent): string {
  if (e.isAllDay) return "all day";
  return new Date(parseEventTime(e.startISO)).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Australia/Sydney",
  });
}

function EventBlock({ event, color }: { event: CalEvent; color: string }) {
  const inner = (
    <>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {event.subject || "(No title)"}
      </span>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          flexShrink: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {timeLabel(event)}
      </span>
    </>
  );

  const style = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 48,
    padding: "6px 10px",
    background: "var(--bg-inner)",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${color}`,
    borderRadius: 6,
    textDecoration: "none",
    minWidth: 0,
  } as const;

  // Tap → the event. A block with no webLink renders inert rather than as a
  // link to nowhere.
  return event.webLink ? (
    <a href={event.webLink} target="_blank" rel="noopener noreferrer" style={style}>
      {inner}
    </a>
  ) : (
    <div style={style}>{inner}</div>
  );
}

export default function CalendarBand() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error(`${res.status}`);
      const data: CalResponse = await res.json();
      setEvents(data.events ?? []);
    } catch {
      // silent — the band shows em-dashes, same as an empty day
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60 * 60 * 1000); // PanelCalendar's cadence
    return () => clearInterval(id);
  }, [load]);

  const now = Date.now();
  const todayIso = sydneyDateOf(now);
  const tomorrowIso = sydneyDateOf(now + 24 * 60 * 60 * 1000);

  const cellFor = (personKey: string, dayIso: string): CalEvent[] =>
    events
      .filter(
        (e) => e.account === personKey && sydneyDateOf(parseEventTime(e.startISO)) === dayIso,
      )
      .sort((a, b) => parseEventTime(a.startISO) - parseEventTime(b.startISO));

  return (
    <section
      className="card"
      style={{
        flex: "none",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 8 }}>
        <div />
        {["Today", "Tomorrow"].map((h) => (
          <div
            key={h}
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-label)",
            }}
          >
            {h}
          </div>
        ))}
        {PEOPLE.map((p) => {
          const today = cellFor(p.key, todayIso);
          const tomorrow = cellFor(p.key, tomorrowIso);
          return (
            <div key={p.key} style={{ display: "contents" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: p.color,
                  paddingTop: 6,
                }}
              >
                {p.label}
              </div>
              {[today, tomorrow].map((list, i) => (
                <div
                  key={i}
                  style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}
                >
                  {list.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "6px 2px" }}>
                      {loading ? "…" : "—"}
                    </div>
                  ) : (
                    list.map((e) => <EventBlock key={e.id} event={e} color={p.color} />)
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
