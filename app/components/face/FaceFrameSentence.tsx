"use client";

import { FACE_PURPLE, type FaceModel } from "./useFaceData";

/* ════════════════════════════════════════════════════════════════════════════
   Frame 1 · Sentence — 10 s. RESTRUCTURE-SPEC §3.
   Headline sentence (28px), next-action line with cyan left border, traction
   bar with days left, then four chips in a single row, fixed order:
   Week · Test · Table · Ansar. The same four objects become the heroes of
   frame 2 and the lanes of frame 3 — nothing moves without a reason.
   Chips are anchors (≥48px) to the same routes their heroes carry.
   ══════════════════════════════════════════════════════════════════════════ */

function Chip({
  href,
  external,
  label,
  value,
  context,
  valueColor,
}: {
  /* No href → the chip is a plain tile, not a link (Ansar: the external
     dashboard link was removed 2026-08-26 by owner directive; the chip and
     its streak data stay). */
  href?: string;
  external?: boolean;
  label: string;
  value: string;
  context: string | null;
  valueColor?: string;
}) {
  const body = (
    <>
      <span className="face-label">{label}</span>
      <span className="face-chip-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      {context !== null && <span className="face-context">{context}</span>}
    </>
  );
  if (href === undefined) return <span className="face-chip">{body}</span>;
  return (
    <a
      className="face-chip"
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {body}
    </a>
  );
}

export default function FaceFrameSentence({ model }: { model: FaceModel }) {
  const m = model;
  return (
    <div className="face-frame">
      {/* Owner-approved accent-card language: the sentence, next action and
          traction bar ride in ONE wide cyan-topped card — frame 1's own
          silhouette (≥1280px; below that the wrapper is unstyled and the
          base rules render as before). */}
      <div className="face-sentence-card">
        <div className="face-headline">{m.headline}</div>

        {m.nextAction !== null && <div className="face-nextaction">{m.nextAction}</div>}

        <div className="face-traction">
          <span className="progress-track thick face-traction-track">
            <span
              className="progress-fill"
              style={{ width: `${m.tractionPct}%`, background: "var(--cyan)" }}
            />
          </span>
          <span className="face-traction-label">
            {m.tractionDays !== null ? `${m.tractionDays} days left` : "—"}
          </span>
        </div>
      </div>

      <div className="face-spacer" />

      <div className="face-chiprow">
        <Chip
          href="/money"
          label="Week"
          value={m.weekSpend ?? "—"}
          context={m.weekEnded !== null ? `ended ${m.weekEnded}` : null}
          valueColor="var(--cyan)"
        />
        <Chip
          href="/business"
          label="Test"
          value={m.testWord}
          context={m.testContext}
          valueColor={m.testStale ? "var(--red)" : undefined}
        />
        <Chip
          href="/table"
          label="Table"
          value={m.openCount !== null ? String(m.openCount) : "—"}
          context={m.oldestDays !== null ? `oldest ${m.oldestDays} days` : "clear"}
        />
        <Chip
          label="Ansar"
          value={m.streak !== null ? `${m.streak}d` : "—"}
          context="day streak"
          valueColor={FACE_PURPLE}
        />
      </div>
    </div>
  );
}
