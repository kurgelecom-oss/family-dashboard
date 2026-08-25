"use client";

import { FACE_PURPLE, type FaceModel } from "./useFaceData";

/* ════════════════════════════════════════════════════════════════════════════
   Frame 2 · Four numbers — 15 s. RESTRUCTURE-SPEC §3.
   Headline as one muted line. Four hero tiles in chip order (Week · Test ·
   Table · Ansar), each: label, 30px value, one context line. Below: tomorrow
   strip (events by person) with traction days at right.
   Heroes are `.drill-tile` anchors — the tail-room and height tiers come from
   globals.css, never inline padding. Every hero links to its route (§3).
   ══════════════════════════════════════════════════════════════════════════ */

function Hero({
  href,
  external,
  label,
  value,
  context,
  valueColor,
}: {
  href: string;
  external?: boolean;
  label: string;
  value: string;
  context: string;
  valueColor?: string;
}) {
  return (
    <a
      className="drill-tile face-hero"
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <span className="face-label">{label}</span>
      <span className="face-hero-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      <span className="face-context">{context}</span>
    </a>
  );
}

export default function FaceFrameNumbers({ model }: { model: FaceModel }) {
  const m = model;
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
        />
        <Hero
          href="/business"
          label="Test"
          value={m.testWord}
          context={m.testContext}
          valueColor={m.testStale ? "var(--red)" : undefined}
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
        {m.tomorrow.length === 0 ? (
          <span className="face-context">nothing scheduled</span>
        ) : (
          m.tomorrow.map((e) => (
            <span key={e.id} className="face-event" style={{ borderLeftColor: e.colorVar }}>
              <span className="face-event-person">{e.person}</span>
              <span className="face-event-time">{e.time}</span>
              <span className="face-event-subject">{e.subject}</span>
            </span>
          ))
        )}
        <span className="face-tomorrow-traction">
          {m.tractionDays !== null ? `${m.tractionDays} days · traction` : ""}
        </span>
      </div>
    </div>
  );
}
