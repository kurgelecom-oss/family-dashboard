"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sydneyStamp } from "./PanelTodos";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";
import { HOUSEHOLD_TZ, zoneToday, daysBetween, type CivilDate } from "../lib/time";

/* ════════════════════════════════════════════════════════════════════════════
   GOALS INTERMISSION — a full-viewport card that interrupts the dashboard
   every few minutes, shows ONE thing big enough to read across the room, and
   gets out of the way.

   Content is a PRESSURE DECK — driver messages and directives only. The reward
   slide was removed 2026-08-21 by request. Each appearance shows the next
   slide in rotation:

     1. TODAY — T        open daily points for T, with age chips
     2. TODAY — N        open daily points for N, with age chips
     3. THE DEADLINE     countdown to the dated monthly goal + weekly counts
     4. PINNED           the pinned board note, verbatim (only when one exists)

   Every slide renders the SAME payload the mission board renders —
   /api/mission, fetched from this origin, never a second derivation. If
   /api/mission is unreachable the deck is empty and the overlay simply never
   appears — the dashboard underneath is the fallback.

   ZERO CURRENCY, same as column C: never a dollar figure on this surface.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Timing ───────────────────────────────────────────────────────────────────
   Unchanged machinery: the three cadence values are tunable from the ⚙️ App
   Settings Notion DB without a deploy, read through /api/dashboard-settings
   (force-static, 30-minute cache) and getSetting() + SETTING_DEFAULTS.
   ──────────────────────────────────────────────────────────────────────────── */

const DEFAULT_FIRST_FIRE_MS = SETTING_DEFAULTS.INTERMISSION_FIRST_FIRE_MS;
const DEFAULT_INTERVAL_MS = SETTING_DEFAULTS.INTERMISSION_INTERVAL_MS;
const DEFAULT_HOLD_MS = SETTING_DEFAULTS.INTERMISSION_HOLD_MS;

/** Fade duration, both directions. Ignored under prefers-reduced-motion. */
const FADE_MS = 600;

/* Dev trigger — ONLY reachable via ?intermission=1. Bypasses settings so
   verification never waits on a network round-trip. */
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

function usableMs(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Turn a settings map into a timing the cycle can trust. The hold is clamped
 * below the interval — an un-clamped bad row would cover the dashboard
 * permanently.
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
  const maxHold = Math.max(1000, intervalMs - FADE_MS * 2);
  return { firstFireMs, intervalMs, holdMs: Math.min(holdRaw, maxHold) };
}

/** Above TopNav (900), the origins strip (890) and the calendar popover (9999). */
const OVERLAY_Z = 10000;

/* ── Mission payload (subset) ─────────────────────────────────────────────────
   Local minimal types for what this surface reads out of /api/mission. The
   route is the authority; these only name the fields used here.
   ──────────────────────────────────────────────────────────────────────────── */

interface MissionDailyPoint {
  point: string;
  pillar: string;
  owner: string;
  ageDays: number | null;
}

interface MissionPayload {
  daily?: { T?: MissionDailyPoint[]; N?: MissionDailyPoint[] };
  weekly?: { testsLoggedThisWeek?: number; validationsThisWeek?: number };
  goals?: { monthly?: { goal: string }[] };
  notes?: { note: string; pinned: boolean }[];
}

/** How often the deck re-reads the mission board. The route is force-dynamic
    (four Notion reads per hit), so this deliberately does not follow the
    appearance cadence — one read per quarter hour is plenty for points that
    change a few times a day. */
const MISSION_REFRESH_MS = 15 * 60 * 1000;

/** How many daily points fit on one slide without risking the 923px viewport. */
const MAX_DAILY_ROWS = 4;

/* ── Age → colour escalation ──────────────────────────────────────────────────
   The whole point of the deck: an item that has sat for a week must not look
   the same as one raised this morning.
   ──────────────────────────────────────────────────────────────────────────── */

/* ── Tones, old-engine-safe ───────────────────────────────────────────────────
   The wall display is a Samsung Flip Pro whose browser predates color-mix();
   an unsupported function invalidates the WHOLE declaration it appears in,
   which is exactly how the backdrop images vanished on the TV. So: solid
   colours keep reading the theme vars (custom properties are ancient and
   safe), and every translucent layer uses a numeric rgba() baked from the
   night palette below. Never reintroduce color-mix() on this surface.
   ──────────────────────────────────────────────────────────────────────────── */

type ToneKey = "cyan" | "amber" | "red" | "muted";

const TONE_VAR: Record<ToneKey, string> = {
  cyan: "var(--cyan)",
  amber: "var(--amber)",
  red: "var(--red)",
  muted: "var(--text-muted)",
};

/** Night-palette channels for the alpha layers: #00d4ff, #f5a623, #e74c3c, #5a6080. */
const TONE_RGB: Record<ToneKey, string> = {
  cyan: "0,212,255",
  amber: "245,166,35",
  red: "231,76,60",
  muted: "90,96,128",
};

const toneRgba = (k: ToneKey, a: number) => `rgba(${TONE_RGB[k]},${a})`;

function ageTone(ageDays: number | null): ToneKey {
  if (ageDays === null) return "muted";
  if (ageDays >= 7) return "red";
  if (ageDays >= 3) return "amber";
  return "cyan";
}

function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return "—";
  if (ageDays === 0) return "TODAY";
  if (ageDays === 1) return "1 DAY";
  return `${ageDays} DAYS`;
}

/** The slide's accent is its worst item — pressure reads at a glance. */
function worstTone(points: MissionDailyPoint[]): ToneKey {
  const worst = points.reduce<number>(
    (max, p) => (p.ageDays !== null && p.ageDays > max ? p.ageDays : max),
    0,
  );
  return ageTone(worst);
}

/* ── Deadline parsing ─────────────────────────────────────────────────────────
   The monthly goal is free text of the form "By 10 September 2026: …". Parse
   the leading date if present; a goal without one still gets a slide, just
   without a countdown. Month names only — no `new Date(string)` round-trips.
   ──────────────────────────────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseGoalDate(text: string): CivilDate | null {
  const m = /by\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return { y: Number(m[3]), m: month, d: Number(m[1]) };
}

function deadlineTone(daysLeft: number | null): ToneKey {
  if (daysLeft === null) return "cyan";
  if (daysLeft <= 7) return "red";
  if (daysLeft <= 30) return "amber";
  return "cyan";
}

/* ── Stakes lines ─────────────────────────────────────────────────────────────
   Verbatim from the mission board, so the two surfaces speak one language.
   Rotated under the pressure slides.
   ──────────────────────────────────────────────────────────────────────────── */

const STAKES: string[] = [
  "Execute or repeat the cycle — those are the only two options.",
  "The clock runs regardless of whether the plan does.",
  "The lift isn't optional — it's the dependency that unlocks everything downstream.",
];

/* ── Slides ──────────────────────────────────────────────────────────────── */

type Slide =
  | { kind: "daily"; owner: "T" | "N"; points: MissionDailyPoint[] }
  | { kind: "deadline"; goal: string; daysLeft: number | null; tests: number | null }
  | { kind: "note"; note: string };

/**
 * Build the rotation from the latest mission read. Mission missing or empty →
 * an empty deck, and the overlay never appears.
 */
function buildDeck(mission: MissionPayload | null, today: CivilDate): Slide[] {
  const deck: Slide[] = [];
  if (mission) {
    const t = (mission.daily?.T ?? []).slice(0, MAX_DAILY_ROWS);
    const n = (mission.daily?.N ?? []).slice(0, MAX_DAILY_ROWS);
    if (t.length > 0) deck.push({ kind: "daily", owner: "T", points: t });
    if (n.length > 0) deck.push({ kind: "daily", owner: "N", points: n });

    const monthly = mission.goals?.monthly?.[0]?.goal;
    if (monthly) {
      const due = parseGoalDate(monthly);
      deck.push({
        kind: "deadline",
        goal: monthly,
        daysLeft: due ? daysBetween(today, due) : null,
        tests: mission.weekly?.testsLoggedThisWeek ?? null,
      });
    }

    const pinned = mission.notes?.find((x) => x.pinned && x.note.trim() !== "");
    if (pinned) deck.push({ kind: "note", note: pinned.note });
  }
  return deck;
}

/* ── Motion preference as an external store (unchanged) ──────────────────── */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const readMotion = (): boolean => window.matchMedia(REDUCED_MOTION_QUERY).matches;
const readMotionServer = (): boolean => false;

/* ── Shared slide chrome ─────────────────────────────────────────────────────
   One card, one backdrop system. Each slide kind may carry a full-bleed image
   at /intermission/<kind>.jpg; a missing file simply leaves the solid card,
   so images are droppable assets, not code.

   The backdrop is a zIndex:-1 layer INSIDE the card rather than a background
   shorthand: the card's transform creates a stacking context, so the layer
   sits above the card's solid background and below every slide element, and
   the image is dimmed by plain `opacity` — no color-mix, nothing the TV's
   engine can reject. The accent wash rides the same layer as a radial
   gradient built from numeric rgba stops.
   ──────────────────────────────────────────────────────────────────────────── */

function CardBackdrop({ kind, tone }: { kind: Slide["kind"]; tone: ToneKey }) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -1,
          backgroundImage: `url(/intermission/${kind}.jpg)`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.32,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: -1,
          background: `radial-gradient(120% 120% at 50% 0%, ${toneRgba(tone, 0.16)} 0%, rgba(0,0,0,0) 55%)`,
        }}
      />
    </>
  );
}

function Kicker({ text, tone }: { text: string; tone?: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.24em",
        textTransform: "uppercase",
        color: tone ?? "var(--text-muted)",
      }}
    >
      {text}
    </div>
  );
}

function AgeChip({ ageDays }: { ageDays: number | null }) {
  const tone = ageTone(ageDays);
  return (
    <span
      style={{
        flex: "none",
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: "0.08em",
        fontVariantNumeric: "tabular-nums",
        color: TONE_VAR[tone],
        background: toneRgba(tone, 0.14),
        border: `1px solid ${toneRgba(tone, 0.45)}`,
        borderRadius: 999,
        padding: "4px 12px",
      }}
    >
      {ageLabel(ageDays)}
    </span>
  );
}

/* ── Slide bodies ────────────────────────────────────────────────────────── */

function DailySlide({
  owner,
  points,
  soften,
}: {
  owner: string;
  points: MissionDailyPoint[];
  /* During an active cycle week, N's slide keeps its facts (age chips stay
     truthful) but drops the shouting: the big letter and card accent hold
     calm cyan instead of escalating to red. */
  soften?: boolean;
}) {
  const tone = TONE_VAR[soften ? "cyan" : worstTone(points)];
  return (
    <>
      <Kicker text="Today · keep the pressure on" />
      <div
        style={{
          fontSize: 52,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          color: tone,
        }}
      >
        {owner}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
        {points.map((p) => (
          <div
            key={p.point}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "14px 18px",
              borderRadius: 12,
              background: "var(--bg-inner)",
              border: "1px solid var(--border)",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 24,
                fontWeight: 700,
                lineHeight: 1.2,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.point}
            </span>
            <span
              style={{
                flex: "none",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-secondary)",
              }}
            >
              {p.pillar}
            </span>
            <AgeChip ageDays={p.ageDays} />
          </div>
        ))}
      </div>
    </>
  );
}

function DeadlineSlide({
  goal,
  daysLeft,
  tests,
}: {
  goal: string;
  daysLeft: number | null;
  tests: number | null;
}) {
  const tone = TONE_VAR[deadlineTone(daysLeft)];
  return (
    <>
      <Kicker text="The deadline" />
      {daysLeft !== null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span
            style={{
              fontSize: 120,
              fontWeight: 800,
              lineHeight: 0.95,
              letterSpacing: "-0.04em",
              fontVariantNumeric: "tabular-nums",
              color: tone,
            }}
          >
            {Math.max(0, daysLeft)}
          </span>
          <span
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
            }}
          >
            days left
          </span>
        </div>
      )}
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          lineHeight: 1.25,
          textAlign: "center",
          color: "var(--text-primary)",
          maxWidth: "88%",
        }}
      >
        {goal}
      </div>
      {tests !== null && (
        <div style={{ fontSize: 17, fontWeight: 600, color: tone }}>
          Tests logged this week: {tests}
        </div>
      )}
    </>
  );
}

function NoteSlide({ note }: { note: string }) {
  return (
    <>
      <Kicker text="Pinned" tone="var(--red)" />
      <div
        style={{
          fontSize: 44,
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          textAlign: "center",
          color: "var(--text-primary)",
          maxWidth: "90%",
        }}
      >
        {note}
      </div>
    </>
  );
}

export default function GoalsIntermission() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, readMotionServer);

  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [stamp, setStamp] = useState<string | null>(null);
  const [mission, setMission] = useState<MissionPayload | null>(null);
  const [cycleActive, setCycleActive] = useState(false);

  /* Resolved ONCE, then never again — `timing` is the cycle effect's only
     dependency, so anything that re-set it would restart the countdown. */
  const [timing, setTiming] = useState<Timing | null>(null);

  /* Anchor for "first fire N ms after MOUNT". */
  const mountedAt = useRef<number>(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  /* Timing resolution — unchanged. Dev flag bypasses the fetch entirely. */
  useEffect(() => {
    let cancelled = false;
    const fast = new URLSearchParams(window.location.search).get("intermission") === "1";

    const resolve = async (): Promise<Timing> => {
      if (fast) return DEV_TIMING;
      try {
        const res = await fetch("/api/dashboard-settings");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as { settings?: SettingsMap; error?: string };
        if (payload.error) throw new Error(String(payload.error));
        return resolveTiming(payload.settings ?? null);
      } catch {
        return FALLBACK_TIMING;
      }
    };

    resolve().then((t) => {
      if (!cancelled) setTiming(t);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /* Mission read: once on mount, then every MISSION_REFRESH_MS. Failure keeps
     the last good payload; never-loaded leaves the deck reward-only. Decoupled
     from the appearance cycle so a slow Notion read can never delay a fade. */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/mission");
        if (!res.ok) return;
        const payload = (await res.json()) as MissionPayload;
        if (!cancelled) setMission(payload);
      } catch {
        // Unreachable mission board must not break the overlay.
      }
      try {
        // Same refresh beat as the mission read: while a cycle tracker is
        // active, N's daily slide is softened (see DailySlide.soften).
        const res = await fetch("/api/cycle");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCycleActive(typeof data.activeDay === "number");
      } catch {
        // No cycle read → no softening; the deck still runs.
      }
    };

    load();
    const refresh = setInterval(load, MISSION_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, []);

  /* The cycle — unchanged shape: first appearance at firstFireMs after mount,
     then every intervalMs, each holding holdMs. */
  useEffect(() => {
    if (timing === null) return;

    const { firstFireMs, intervalMs, holdMs } = timing;

    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let cycle: ReturnType<typeof setInterval> | undefined;

    const appear = () => {
      setStamp(sydneyStamp(new Date()));
      setVisible(true);
      hideTimer = setTimeout(() => {
        setVisible(false);
        // Advance on the way out, so the next appearance is the next slide.
        setIndex((i) => i + 1);
      }, holdMs);
    };

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

  /* Deck for THIS render. Mission state is only ever set from effects, so the
     server (and first client render) always sees mission === null → an empty
     deck → nothing rendered, no hydration mismatch, no clock read on the
     server. */
  const deck = buildDeck(
    mission,
    mission === null ? { y: 2026, m: 1, d: 1 } : zoneToday(new Date(), HOUSEHOLD_TZ),
  );

  // Nothing to say → never on screen. All hooks are above this line.
  if (deck.length === 0) return null;

  const slide = deck[index % deck.length];

  const softenDaily = (s: Slide) =>
    s.kind === "daily" && s.owner === "N" && cycleActive;

  const accentKey: ToneKey =
    slide.kind === "daily"
      ? softenDaily(slide)
        ? "cyan"
        : worstTone(slide.points)
      : slide.kind === "deadline"
        ? deadlineTone(slide.daysLeft)
        : "red";
  const accent = TONE_VAR[accentKey];

  const transition = reducedMotion
    ? "none"
    : `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`;

  const footer = `${STAKES[index % STAKES.length]}${stamp ? ` · ${stamp} Sydney` : ""}`;

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
        opacity: visible ? 1 : 0,
        visibility: visible ? "visible" : "hidden",
        transition: reducedMotion ? "none" : `opacity ${FADE_MS}ms ease`,
      }}
    >
      {/* Dimming scrim as its own layer: solid theme colour + opacity, because
          the alpha-mixed background it replaces needed color-mix, which the
          TV's engine rejects (taking the whole declaration with it). */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "var(--bg-base)",
          opacity: 0.92,
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
          padding: "48px 64px",
          borderRadius: 20,
          background: "var(--bg-card)",
          border: `1px solid ${accent}`,
          boxShadow: `0 0 60px ${toneRgba(accentKey, 0.25)}`,
          width: slide.kind === "daily" ? "min(900px, 90vw)" : undefined,
          maxWidth: "min(900px, 90vw)",
          maxHeight: "86vh",
          overflow: "hidden",
          transform: visible || reducedMotion ? "scale(1)" : "scale(0.96)",
          transition,
        }}
      >
        <CardBackdrop kind={slide.kind} tone={accentKey} />
        {slide.kind === "daily" && (
          <DailySlide owner={slide.owner} points={slide.points} soften={softenDaily(slide)} />
        )}
        {slide.kind === "deadline" && (
          <DeadlineSlide goal={slide.goal} daysLeft={slide.daysLeft} tests={slide.tests} />
        )}
        {slide.kind === "note" && <NoteSlide note={slide.note} />}

        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
            textAlign: "center",
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
