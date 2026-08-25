"use client";

import { FACE_PURPLE, type FaceModel } from "./useFaceData";

/* ════════════════════════════════════════════════════════════════════════════
   Frame 3 · Three lanes — 25 s. RESTRUCTURE-SPEC §3.
   Headline as one muted line, then three tiles: Money, Business, Family.
   Each: label, 30px hero, one context line, hairline, three label/value rows.
   The four frame-2 heroes fold in: Week → Money's hero, Test → Business's,
   Table → Family's, Ansar → a Family row. Lanes are `.drill-tile` anchors:
   Money → /money, Business → /business, Family → /board (§3).
   ══════════════════════════════════════════════════════════════════════════ */

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <span className="face-row">
      <span className="face-row-label">{label}</span>
      <span className="face-row-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </span>
  );
}

function Lane({
  href,
  label,
  value,
  context,
  valueColor,
  rows,
}: {
  href: string;
  label: string;
  value: string;
  context: string;
  valueColor?: string;
  rows: React.ReactNode;
}) {
  return (
    <a className="drill-tile face-lane" href={href}>
      <span className="face-label">{label}</span>
      <span className="face-hero-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      <span className="face-context">{context}</span>
      <span className="face-hairline" />
      {rows}
    </a>
  );
}

export default function FaceFrameLanes({ model }: { model: FaceModel }) {
  const m = model;
  const ansarValue =
    m.streak !== null && m.todayPct !== null
      ? `${m.streak}d · ${m.todayPct}% today`
      : m.streak !== null
        ? `${m.streak}d`
        : "—";
  return (
    <div className="face-frame">
      <div className="face-headline-muted">{m.headline}</div>

      <div className="face-lanerow">
        <Lane
          href="/money"
          label="Money"
          value={m.weekSpend ?? "—"}
          context="last week"
          valueColor="var(--cyan)"
          rows={
            <>
              <Row label="Month" value={m.monthSpend ?? "—"} />
              <Row label="Balance" value={m.balance ?? "—"} />
              <Row label="Saved" value={m.savedPct ?? "—"} />
            </>
          }
        />
        <Lane
          href="/business"
          label="Business"
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
        <Lane
          href="/board"
          label="Family"
          value={m.openCount !== null ? String(m.openCount) : "—"}
          context={
            m.oldestDays !== null ? `on the table · oldest ${m.oldestDays} days` : "on the table"
          }
          rows={
            <>
              <Row label="Ansar" value={ansarValue} valueColor={FACE_PURPLE} />
              <Row
                label="Tomorrow"
                value={
                  m.tomorrow.length === 0
                    ? "nothing"
                    : m.tomorrow.length === 1
                      ? m.tomorrow[0].subject
                      : `${m.tomorrow.length} events`
                }
              />
              <Row
                label="Traction"
                value={m.tractionDays !== null ? `${m.tractionDays} days` : "—"}
              />
            </>
          }
        />
      </div>
    </div>
  );
}
