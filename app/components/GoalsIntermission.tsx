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
import { HOUSEHOLD_TZ, zoneToday, daysBetween, type CivilDate } from "../lib/time";

/* ════════════════════════════════════════════════════════════════════════════
   GOALS INTERMISSION — a full-viewport card that interrupts the dashboard
   every few minutes, shows ONE thing big enough to read across the room, and
   gets out of the way.

   Content is now a PRESSURE DECK, not just rewards. Each appearance shows the
   next slide in rotation:

     1. TODAY — T        open daily points for T, with age chips
     2. TODAY — N        open daily points for N, with age chips
     3. THE DEADLINE     countdown to the dated monthly goal + weekly counts
     4. PINNED           the pinned board note, verbatim (only when one exists)
     5. FAMILY REWARD    the original reward card (the carrot stays in the mix)

   Slides 1–4 render the SAME payload the mission board renders — /api/mission,
   fetched from this origin, never a second derivation. The reward slide still
   uses allocate() + useBusinessProfit() from PanelTodos over the same store,
   for the same reason: a surface that contradicts the tracker beside it is
   worse than no surface at all. If /api/mission is unreachable the deck
   degrades to reward-only, which is exactly the old behaviour.

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

const RING_SIZE = 240;
const RING_STROKE = 14;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

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

function ageTone(ageDays: number | null): string {
  if (ageDays === null) return "var(--text-muted)";
  if (ageDays >= 7) return "var(--red)";
  if (ageDays >= 3) return "var(--amber)";
  return "var(--cyan)";
}

function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return "—";
  if (ageDays === 0) return "TODAY";
  if (ageDays === 1) return "1 DAY";
  return `${ageDays} DAYS`;
}

/** The slide's accent is its worst item — pressure reads at a glance. */
function worstTone(points: MissionDailyPoint[]): string {
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

function deadlineTone(daysLeft: number | null): string {
  if (daysLeft === null) return "var(--cyan)";
  if (daysLeft <= 7) return "var(--red)";
  if (daysLeft <= 30) return "var(--amber)";
  return "var(--cyan)";
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
  | { kind: "note"; note: string }
  | { kind: "reward" };

/**
 * Build the rotation from the latest mission read. Mission missing or empty →
 * reward-only, the old behaviour. The reward slide is always last, so pressure
 * outnumbers carrot roughly 4:1 when the board is populated.
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
  deck.push({ kind: "reward" });
  return deck;
}

/* ── Reward helpers (unchanged) ──────────────────────────────────────────── */

function subtitleOf(row: GoalRow): string {
  if (row.note) return row.note;
  if (row.target === null) return "Funded by profit · no target set yet";
  return "Funded by profit";
}

function accentOf(row: GoalRow): string {
  if (row.state === "earned" || row.state === "funded") return "var(--green)";
  if (row.state === "locked" || row.state === "unset") return "var(--text-muted)";
  return "var(--cyan)";
}

const hasPct = (row: GoalRow): boolean => row.note !== undefined || row.target !== null;

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
   at /intermission/<kind>.jpg behind a heavy navy gradient; a missing file
   simply leaves the gradient, so images are droppable assets, not code.
   ──────────────────────────────────────────────────────────────────────────── */

function cardBackground(kind: Slide["kind"], accent: string): string {
  const wash = `radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, ${accent} 14%, transparent) 0%, transparent 55%)`;
  const shade = `linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 62%, transparent) 0%, color-mix(in srgb, var(--bg-card) 82%, transparent) 70%, color-mix(in srgb, var(--bg-card) 94%, transparent) 100%)`;
  const image = `url(/intermission/${kind}.jpg) center / cover no-repeat`;
  return `${wash}, ${shade}, ${image}, var(--bg-card)`;
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
        color: tone,
        background: `color-mix(in srgb, ${tone} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`,
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
  const tone = soften ? "var(--cyan)" : worstTone(points);
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
              background: "color-mix(in srgb, var(--bg-inner) 70%, transparent)",
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
  const tone = deadlineTone(daysLeft);
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

function RewardSlide({
  row,
  reducedMotion,
}: {
  row: GoalRow;
  reducedMotion: boolean;
}) {
  const accent = accentOf(row);
  const pct = hasPct(row) ? Math.max(0, Math.min(100, row.pct)) : 0;
  return (
    <>
      <Kicker text="Family reward" />
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
    </>
  );
}

export default function GoalsIntermission() {
  const goals = useSyncExternalStore(subscribeGoals, readGoals, readGoalsServer);
  const profit = useBusinessProfit();
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, readMotionServer);

  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [rewardIndex, setRewardIndex] = useState(0);
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

  /* Reward rows — same derivation as the panel, always. */
  const pot =
    profit.cumulative === null
      ? null
      : (Math.max(0, profit.cumulative) * goals.rewardSplitPct) / 100;
  const { rows } = allocate(goals, pot, profit.genuineTest);

  /* Deck for THIS render. Mission state is only ever set from effects, so the
     server (and first client render) always sees mission === null → a deck of
     exactly [reward] → no hydration mismatch and no clock read on the server. */
  const deck = buildDeck(
    mission,
    mission === null ? { y: 2026, m: 1, d: 1 } : zoneToday(new Date(), HOUSEHOLD_TZ),
  );
  const slide = deck[index % deck.length];

  /* When the reward slide leaves, advance which reward shows next time. */
  const isReward = slide.kind === "reward";
  const wasRewardRef = useRef(false);
  useEffect(() => {
    if (wasRewardRef.current && !visible) {
      setRewardIndex((i) => i + 1);
    }
    wasRewardRef.current = isReward && visible;
  }, [visible, isReward]);

  const row = rows[rewardIndex % rows.length];

  const softenDaily = (s: Slide) =>
    s.kind === "daily" && s.owner === "N" && cycleActive;

  const accent =
    slide.kind === "reward"
      ? accentOf(row)
      : slide.kind === "daily"
        ? softenDaily(slide)
          ? "var(--cyan)"
          : worstTone(slide.points)
        : slide.kind === "deadline"
          ? deadlineTone(slide.daysLeft)
          : "var(--red)";

  const transition = reducedMotion
    ? "none"
    : `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`;

  const footer =
    slide.kind === "reward"
      ? profit.error
        ? "Profit read failed — percentage unknown"
        : `Goal ${(rewardIndex % rows.length) + 1} of ${rows.length}${
            stamp ? ` · ${stamp} Sydney` : ""
          }`
      : `${STAKES[index % STAKES.length]}${stamp ? ` · ${stamp} Sydney` : ""}`;

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
          background: cardBackground(slide.kind, accent),
          border: `1px solid ${accent}`,
          boxShadow: `0 0 60px color-mix(in srgb, ${accent} 22%, transparent)`,
          width: slide.kind === "daily" ? "min(900px, 90vw)" : undefined,
          maxWidth: "min(900px, 90vw)",
          maxHeight: "86vh",
          overflow: "hidden",
          transform: visible || reducedMotion ? "scale(1)" : "scale(0.96)",
          transition,
        }}
      >
        {slide.kind === "daily" && (
          <DailySlide owner={slide.owner} points={slide.points} soften={softenDaily(slide)} />
        )}
        {slide.kind === "deadline" && (
          <DeadlineSlide goal={slide.goal} daysLeft={slide.daysLeft} tests={slide.tests} />
        )}
        {slide.kind === "note" && <NoteSlide note={slide.note} />}
        {slide.kind === "reward" && <RewardSlide row={row} reducedMotion={reducedMotion} />}

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
