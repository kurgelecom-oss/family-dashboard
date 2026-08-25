"use client";

import { FACE_PURPLE, type FaceModel } from "./useFaceData";

/* ════════════════════════════════════════════════════════════════════════════
   Frame 2 · Four numbers — 15 s. RESTRUCTURE-SPEC §3.
   Headline as one muted line. Four hero tiles in chip order (Week · Test ·
   Table · Ansar), each: label, 30px value, one context line. Below: tomorrow
   strip (events by person) with traction days at right.
   Heroes are `.drill-tile` anchors — the tail-room and height tiers come from
   globals.css, never inline padding. Every hero links to its route (§3).

   The tomorrow strip is CAPPED at MAX_EVENTS_PER_PERSON per person, with a
   "+n more" marker per person past the cap — so the strip's height is bounded
   at any data volume and the frame's 32px bottom reserve holds structurally
   (Fix 3). Whole events are dropped, never half-clipped.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_EVENTS_PER_PERSON = 2;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <span className="face-row">
      <span className="face-row-label">{label}</span>
      <span className="face-row-value">{value}</span>
    </span>
  );
}

/* Owner-approved accent-card language: each hero is an accent-topped card with
   the giant value + context; Week and Test additionally carry a hairline and
   three info rows (the data supports them), while Table and Ansar centre the
   hero block (`face-hero--fill`) — frame 2's own silhouette. */
function Hero({
  href,
  external,
  label,
  value,
  context,
  valueColor,
  rows,
}: {
  href: string;
  external?: boolean;
  label: string;
  value: string;
  context: string;
  valueColor?: string;
  rows?: React.ReactNode;
}) {
  return (
    <a
      className={`drill-tile face-hero${rows ? "" : " face-hero--fill"}`}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="face-label">{label}</span>
      <span className="face-hero-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      <span className="face-context">{context}</span>
      {rows && (
        <>
          <span className="face-hairline" />
          {rows}
        </>
      )}
    </a>
  );
}

export default function FaceFrameNumbers({ model }: { model: FaceModel }) {
  const m = model;

  /* Cap events per person; count what the cap drops, in event order. */
  const shown: typeof m.tomorrow = [];
  const dropped = new Map<string, number>();
  const perPerson = new Map<string, number>();
  for (const e of m.tomorrow) {
    const n = perPerson.get(e.person) ?? 0;
    if (n < MAX_EVENTS_PER_PERSON) {
      shown.push(e);
      perPerson.set(e.person, n + 1);
    } else {
      dropped.set(e.person, (dropped.get(e.person) ?? 0) + 1);
    }
  }

  return (
    <div className="face-frame">
      <div className="face-headline-muted">{m.headline}</div>

      <div className="face-herorow">
        <Hero
          href="/money"
          label="Week"
          value={m.weekSpend ?? "—"}
          context={m.weekEnded !== null ? `week ended ${m.weekEnded}` : "last week"}
          valueColor="var(--cyan)"
          rows={
            <>
              <Row label="Month" value={m.monthSpend ?? "—"} />
              <Row label="Balance" value={m.balance ?? "—"} />
              <Row label="Saved" value={m.savedPct ?? "—"} />
            </>
          }
        />
        <Hero
          href="/business"
          label="Test"
          value={m.testWord}
          context={m.testContext}
          valueColor={m.testStale ? "var(--red)" : undefined}
          rows={
            <>
              <Row label="Campaigns" value={m.campaigns} />
              <Row label="Next gate" value={m.nextGate ?? "—"} />
              <Row label="Tests" value={m.testsLine} />
            </>
          }
        />
        <Hero
          href="/table"
          label="Table"
          value={m.openCount !== null ? String(m.openCount) : "—"}
          context={m.oldestDays !== null ? `oldest ${m.oldestDays} days` : "table is clear"}
        />
        <Hero
          href="https://ansar-habits-tracker.netlify.app"
          external
          label="Ansar"
          value={m.streak !== null ? `${m.streak}d` : "—"}
          context={m.todayPct !== null ? `${m.todayPct}% today` : "day streak"}
          valueColor={FACE_PURPLE}
        />
      </div>

      <div className="face-spacer" />

      <div className="face-tomorrow">
        <span className="face-label">Tomorrow · {m.tomorrowLabel}</span>
        {shown.length === 0 ? (
          <span className="face-context">nothing scheduled</span>
        ) : (
          <>
            {shown.map((e) => (
              <span key={e.id} className="face-event" style={{ borderLeftColor: e.colorVar }}>
                <span className="face-event-person">{e.person}</span>
                <span className="face-event-time">{e.time}</span>
                <span className="face-event-subject">{e.subject}</span>
              </span>
            ))}
            {[...dropped.entries()].map(([person, n]) => (
              <span key={`more-${person}`} className="face-event-more">
                {person} +{n} more
              </span>
            ))}
          </>
        )}
        <span className="face-tomorrow-traction">
          {m.tractionDays !== null ? `${m.tractionDays} days · traction` : ""}
        </span>
      </div>
    </div>
  );
}
