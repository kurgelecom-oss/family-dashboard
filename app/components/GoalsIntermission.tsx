"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  allocate,
  readGoals,
  readGoalsServer,
  subscribeGoals,
  sydneyStamp,
  useBusinessProfit,
  type GoalRow,
} from "./PanelTodos";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";

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

/* ── Timing ───────────────────────────────────────────────────────────────────
   The three cadence values are tunable from the ⚙️ App Settings Notion DB
   without a deploy. They are read through the mechanism that already exists —
   /api/dashboard-settings (force-static, 30-minute cache) feeding the same
   getSetting() + SETTING_DEFAULTS pair every other panel uses. No second
   settings reader and no new route.

   The defaults live in SETTING_DEFAULTS beside every other default rather than
   being duplicated here, so there is exactly one place a fallback can be wrong.
   With zero rows in the DB — which is the state today — the overlay runs
   entirely on them.
   ──────────────────────────────────────────────────────────────────────────── */

/** Delay from MOUNT to the first appearance. */
const DEFAULT_FIRST_FIRE_MS = SETTING_DEFAULTS.INTERMISSION_FIRST_FIRE_MS;

/** Gap between subsequent appearances. */
const DEFAULT_INTERVAL_MS = SETTING_DEFAULTS.INTERMISSION_INTERVAL_MS;

/** How long each appearance stays on screen. */
const DEFAULT_HOLD_MS = SETTING_DEFAULTS.INTERMISSION_HOLD_MS;

/** Fade duration, both directions. Ignored under prefers-reduced-motion. */
const FADE_MS = 600;

/* Dev trigger — ONLY reachable via ?intermission=1. Without the query param
   none of these are read, and the flag deliberately bypasses the settings
   entirely so verification never waits on a network round-trip. */
const DEV_FIRST_FIRE_MS = 0;
const DEV_INTERVAL_MS = 4000;
const DEV_HOLD_MS = 2500;

interface Timing {
  firstFireMs: number;
  intervalMs: number;
  holdMs: number;
}

const DEV_TIMING: Timing = {
  firstFireMs: DEV_FIRST_FIRE_MS,
  intervalMs: DEV_INTERVAL_MS,
  holdMs: DEV_HOLD_MS,
};

const FALLBACK_TIMING: Timing = {
  firstFireMs: DEFAULT_FIRST_FIRE_MS,
  intervalMs: DEFAULT_INTERVAL_MS,
  holdMs: DEFAULT_HOLD_MS,
};

/**
 * A duration is only usable if it is a finite positive number. getSetting()
 * already rejects a missing key and a wrong type; this additionally rejects
 * zero, negatives and Infinity, any of which would either spam the overlay
 * every tick or park it off screen forever.
 */
function usableMs(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Turn a settings map into a timing the cycle can trust.
 *
 * The hold is additionally clamped below the interval. A hold longer than the
 * gap between appearances means the next appearance lands while the overlay is
 * still up and the screen never clears — the "freeze" case. Clamping is not a
 * preference here; an un-clamped bad row would cover the dashboard permanently.
 */
function resolveTiming(settings: SettingsMap | null): Timing {
  const firstFireMs = usableMs(
    getSetting(settings, "INTERMISSION_FIRST_FIRE_MS", DEFAULT_FIRST_FIRE_MS),
    DEFAULT_FIRST_FIRE_MS,
  );
  const intervalMs = usableMs(
    getSetting(settings, "INTERMISSION_INTERVAL_MS", DEFAULT_INTERVAL_MS),
    DEFAULT_INTERVAL_MS,
  );
  const holdRaw = usableMs(
    getSetting(settings, "INTERMISSION_HOLD_MS", DEFAULT_HOLD_MS),
    DEFAULT_HOLD_MS,
  );

  // Leave at least the fade at each end, so a hold can never swallow the gap.
  const maxHold = Math.max(1000, intervalMs - FADE_MS * 2);
  return { firstFireMs, intervalMs, holdMs: Math.min(holdRaw, maxHold) };
}

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

  /* Resolved ONCE, then never again. This is load-bearing: `timing` is the
     cycle effect's only dependency, so anything that re-set it would tear down
     and rebuild the timers and restart the countdown from zero. That is exactly
     how a periodic overlay silently never fires. Settings are fetched a single
     time on mount — no refresh interval — so the effect below runs at most
     twice: once with the fallback, once with whatever the DB says. */
  const [timing, setTiming] = useState<Timing | null>(null);

  /* Anchor for "first fire N ms after MOUNT". Without it the first appearance
     would be N ms after the settings fetch resolves, which drifts by however
     long the network took. */
  const mountedAt = useRef<number>(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  /* Read the dev flag inside an effect, never during render: the server has no
     query string, so touching it in render would hydrate differently than it
     rendered. The flag bypasses the fetch entirely — verification must not wait
     on the network, and must not change behaviour if someone edits the DB. */
  useEffect(() => {
    let cancelled = false;
    const fast = new URLSearchParams(window.location.search).get("intermission") === "1";

    const resolve = async (): Promise<Timing> => {
      // The flag short-circuits before the fetch: verification must not wait on
      // the network, and must not change if someone edits the DB.
      if (fast) return DEV_TIMING;
      try {
        // The route that already serves this DB to clients: force-static with a
        // 30-minute revalidate, so this is a cache hit in all but the first
        // request after a deploy.
        const res = await fetch("/api/dashboard-settings");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as { settings?: SettingsMap; error?: string };
        if (payload.error) throw new Error(String(payload.error));
        return resolveTiming(payload.settings ?? null);
      } catch {
        // Unreachable settings must not disable the overlay — that is what the
        // built-in defaults are for.
        return FALLBACK_TIMING;
      }
    };

    // Settled through a promise rather than assigned in the effect body, so the
    // state update is never a synchronous cascade out of the effect.
    resolve().then((t) => {
      if (!cancelled) setTiming(t);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /* The cycle: first appearance at firstFireMs after mount, then every
     intervalMs, each holding holdMs. */
  useEffect(() => {
    if (timing === null) return; // still resolving — nothing scheduled yet

    const { firstFireMs, intervalMs, holdMs } = timing;

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let cycle: ReturnType<typeof setInterval> | undefined;

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

    // Measured from mount, so the settings round-trip does not push it out.
    const waited = mountedAt.current === 0 ? 0 : Date.now() - mountedAt.current;
    const firstDelay = Math.max(0, firstFireMs - waited);

    const first = setTimeout(() => {
      appear();
      cycle = setInterval(appear, intervalMs);
    }, firstDelay);

    return () => {
      clearTimeout(first);
      if (cycle !== undefined) clearInterval(cycle);
      if (hideTimer !== undefined) clearTimeout(hideTimer);
    };
  }, [timing]);

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
