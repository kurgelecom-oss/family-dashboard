"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  allocate,
  readGoals,
  readGoalsServer,
  subscribeGoals,
  sydneyStamp,
  useBusinessProfit,
  type GoalRow,
} from "./PanelTodos";

/* ════════════════════════════════════════════════════════════════════════════
   GOALS INTERMISSION — a full-viewport reward card that interrupts the
   dashboard every few minutes, shows ONE goal big enough to read across the
   room, and gets out of the way.

   It renders the SAME rows the Family Goals panel renders. Not a similar
   calculation — literally allocate() and useBusinessProfit() imported from
   PanelTodos, over the same localStorage store. That is the whole point: a
   second derivation would eventually disagree with the panel face, and a
   reward screen that contradicts the tracker beside it is worse than no reward
   screen. Night out's copy comes straight off the row's `note`, so it can only
   ever say what the panel says.

   ZERO CURRENCY, same as column C: percentages and bars, never a dollar. The
   overlay has no Edit escape hatch, so there is no sanctioned exception here at
   all — if a "$" appears on this surface, something is wired wrong.
   ══════════════════════════════════════════════════════════════════════════ */

/** How often the intermission fires. */
const INTERMISSION_INTERVAL_MS = 5 * 60 * 1000;

/** How long it stays on screen once it does. */
const INTERMISSION_HOLD_MS = 8000;

/** Fade duration, both directions. Ignored under prefers-reduced-motion. */
const FADE_MS = 600;

/* Dev trigger — ONLY reachable via ?intermission=1. Without the query param
   neither constant is read, so production keeps the real interval above. */
const DEV_INTERVAL_MS = 4000;
const DEV_HOLD_MS = 2500;

/** Above TopNav (900), the origins strip (890) and the calendar popover (9999). */
const OVERLAY_Z = 10000;

const RING_SIZE = 240;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * What earns this goal, in one line.
 *
 * Behaviour-linked rows carry their own sentence on the row (`note`) — reused
 * verbatim rather than restated, so the overlay cannot drift from the panel.
 * Money rows are funded from profit; a row with no target says so instead of
 * implying it is merely at 0%.
 */
function subtitleOf(row: GoalRow): string {
  if (row.note) return row.note;
  if (row.target === null) return "Funded by profit · no target set yet";
  return "Funded by profit";
}

/** Earned matches the panel's badge-green. Unset stays quiet; the rest is cyan. */
function accentOf(row: GoalRow): string {
  if (row.state === "earned" || row.state === "funded") return "var(--green)";
  if (row.state === "locked" || row.state === "unset") return "var(--text-muted)";
  return "var(--cyan)";
}

/** A money goal with no target has no honest percentage to show. */
const hasPct = (row: GoalRow): boolean => row.note !== undefined || row.target !== null;

/* ── Motion preference as an external store ───────────────────────────────────
   Same shape as the goals store in PanelTodos, and for the same reason: read
   through useSyncExternalStore rather than an effect, so there is no
   setState-during-effect cascade, the server snapshot is stable (no hydration
   mismatch), and an OS-level toggle mid-session is picked up for free.
   ──────────────────────────────────────────────────────────────────────────── */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const readMotion = (): boolean => window.matchMedia(REDUCED_MOTION_QUERY).matches;

/** The server cannot know the preference; animation is the safe default there. */
const readMotionServer = (): boolean => false;

export default function GoalsIntermission() {
  const goals = useSyncExternalStore(subscribeGoals, readGoals, readGoalsServer);
  const profit = useBusinessProfit();

  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, readMotionServer);

  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [stamp, setStamp] = useState<string | null>(null);

  /* The cycle. Read the dev flag inside the effect, never during render: the
     server has no query string, so touching it in render would hydrate
     differently than it rendered. */
  useEffect(() => {
    const fast = new URLSearchParams(window.location.search).get("intermission") === "1";
    const intervalMs = fast ? DEV_INTERVAL_MS : INTERMISSION_INTERVAL_MS;
    const holdMs = fast ? DEV_HOLD_MS : INTERMISSION_HOLD_MS;

    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const appear = () => {
      // Stamped on appearance, not during render — a value derived from the
      // clock at render time is a hydration mismatch waiting for a minute
      // boundary.
      setStamp(sydneyStamp(new Date()));
      setVisible(true);
      hideTimer = setTimeout(() => {
        setVisible(false);
        // Advance on the way out, so the next appearance is the next goal.
        setIndex((i) => i + 1);
      }, holdMs);
    };

    // Only the dev flag shows something immediately; production waits a full
    // interval before the first interruption.
    if (fast) appear();

    const cycle = setInterval(appear, intervalMs);
    return () => {
      clearInterval(cycle);
      if (hideTimer !== undefined) clearTimeout(hideTimer);
    };
  }, []);

  const pot =
    profit.cumulative === null
      ? null
      : (Math.max(0, profit.cumulative) * goals.rewardSplitPct) / 100;

  const { rows } = allocate(goals, pot, profit.genuineTest);
  const row = rows[index % rows.length];

  const accent = accentOf(row);
  const pct = hasPct(row) ? Math.max(0, Math.min(100, row.pct)) : 0;
  const transition = reducedMotion
    ? "none"
    : `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`;

  return (
    <div
      aria-hidden={!visible}
      data-intermission={visible ? "visible" : "hidden"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: OVERLAY_Z,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Click-through in every state. This is a wall display, not a modal —
        // it must never swallow a click meant for a panel underneath.
        pointerEvents: "none",
        background: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
        opacity: visible ? 1 : 0,
        visibility: visible ? "visible" : "hidden",
        transition: reducedMotion ? "none" : `opacity ${FADE_MS}ms ease`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
          padding: "48px 64px",
          borderRadius: 20,
          background: "var(--bg-card)",
          border: `1px solid ${accent}`,
          boxShadow: `0 0 60px color-mix(in srgb, ${accent} 22%, transparent)`,
          maxWidth: "min(760px, 86vw)",
          transform: visible || reducedMotion ? "scale(1)" : "scale(0.96)",
          transition,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Family reward
        </div>

        {/* Progress ring. Rotated so 0% starts at twelve o'clock. */}
        <div style={{ position: "relative", width: RING_SIZE, height: RING_SIZE }}>
          <svg width={RING_SIZE} height={RING_SIZE} style={{ transform: "rotate(-90deg)" }}>
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="var(--progress-track)"
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={accent}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct / 100)}
              style={{
                transition: reducedMotion ? "none" : `stroke-dashoffset ${FADE_MS}ms ease`,
              }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 58,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              fontVariantNumeric: "tabular-nums",
              color: accent,
            }}
          >
            {hasPct(row) ? `${Math.round(row.pct)}%` : "—"}
          </div>
        </div>

        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontSize: 46,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            {row.label}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: accent }}>{subtitleOf(row)}</div>
        </div>

        {/* The same bar the panel row draws, at wall-display scale. */}
        <div style={{ width: "min(560px, 72vw)" }}>
          <div className="progress-track thick">
            <div
              className="progress-fill"
              style={{
                width: `${pct}%`,
                background: accent,
                transition: reducedMotion ? "none" : `width ${FADE_MS}ms ease`,
              }}
            />
          </div>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
          {profit.error
            ? "Profit read failed — percentage unknown"
            : `Goal ${(index % rows.length) + 1} of ${rows.length}${
                stamp ? ` · ${stamp} Sydney` : ""
              }`}
        </div>
      </div>
    </div>
  );
}
