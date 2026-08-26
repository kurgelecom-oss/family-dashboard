"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LaneSummary, OriginsPayload } from "../api/origins/route";
import { deliverableOf } from "./OriginsStrip";
import { useCornerCard } from "./CornerStack";

/* ────────────────────────────────────────────────────────────────────────────
   OriginsNudges — Concept 2, "corner nudges" (owner-approved 2026-08-26).

   The persistent OriginsStrip is gone from the face; in its place, cards
   appear in the shared bottom-right CornerStack at three Sydney windows —
   07:30, 12:30, 19:30 — one card per person who is behind pace (any lane
   state other than ON_PACE: behind, build, silent). EVERY card — SILENT
   included — sits idle for the same AUTO_DISMISS_MS and then leaves with the
   mission card's hard-cut exit (owner directive 2026-08-26: no pinning). A
   Later on a windowed card is remembered in localStorage for that window so
   a reload inside the same window stays quiet. A SILENT lane keeps its
   recurrence instead of a pin: auto-dismiss and Later both bring the card
   back an hour later, until a tick lands.

   A fresh mount inside a window shows the card too: the wall display can be
   power-cycled mid-window and must not miss the nudge.

   ✓ Done is the SAME write the strip performed: PATCH /api/origins/complete
   with { pageId, completedBy: lane, proof? }. The Action-Item proof gate
   lives on the server; this surface only reports its verdict. Data comes
   from the same GET /api/origins the strip read — pace logic (lane.state)
   is the server's, never re-derived here.

   All clock reads go through Intl.DateTimeFormat with the Sydney zone — no
   UTC offsets, per the standing rule.
   ──────────────────────────────────────────────────────────────────────────── */

type Lane = "taylan" | "nihal";
const LANES: { key: Lane; label: string }[] = [
  { key: "taylan", label: "Taylan" },
  { key: "nihal", label: "Nihal" },
];

/** Nudge windows, Sydney wall-clock. A window stays "open" for an hour so a
    mount at 12:47 still counts as inside the 12:30 window. */
const WINDOWS = ["07:30", "12:30", "19:30"] as const;
const WINDOW_OPEN_MIN = 60;

/** The ONE idle timeout every nudge card gets — windowed AND silent (owner
    directive 2026-08-26: nothing pins; same timer family as the corner
    popups). The hint line derives from this constant so it cannot drift. */
const AUTO_DISMISS_MS = 60_000;
/** A snoozed or auto-dismissed SILENT card returns after this long. */
const SILENT_RETURN_MS = 60 * 60 * 1000;
/** How long the post-tick confirmation lingers before the card removes itself. */
const CONFIRM_MS = 2_500;

/** Same cadence the strip used for its reads. */
const REFRESH_MS = 300_000;
/** How often the window clock is re-evaluated. */
const CLOCK_TICK_MS = 30_000;

const DISMISS_KEY = "originsNudge.v1.dismissed";
const SNOOZE_KEY = "originsNudge.v1.silentSnooze";

/* ── Sydney clock ────────────────────────────────────────────────────────── */

const SYD_CLOCK = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

interface SydneyNow {
  /** e.g. "2026-08-26" — keys a window to its day. */
  dateKey: string;
  /** Minutes since Sydney midnight. */
  minutes: number;
}

function sydneyNow(): SydneyNow {
  const parts = SYD_CLOCK.formatToParts(new Date());
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  // Some engines render midnight as "24" under hour12:false; % 24 folds it.
  const hour = Number(get("hour")) % 24;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

const windowMinutes = (w: string): number => {
  const [h, m] = w.split(":").map(Number);
  return h * 60 + m;
};

/** The window we are currently inside, or null between windows. */
function openWindow(minutes: number): (typeof WINDOWS)[number] | null {
  return (
    WINDOWS.find((w) => {
      const start = windowMinutes(w);
      return minutes >= start && minutes < start + WINDOW_OPEN_MIN;
    }) ?? null
  );
}

/* ── localStorage (per-viewer conveniences — every access guarded) ───────── */

function readMap(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — dismissals just won't survive a reload */
  }
}

/** Later on a windowed card: remembered for that lane+window only. Entries
    from other days are pruned so the map cannot grow without bound. */
function persistDismiss(lane: Lane, windowKey: string, dateKey: string) {
  const map = readMap(DISMISS_KEY);
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k.includes(`|${dateKey}·`)) kept[k] = v;
  }
  kept[`${lane}|${windowKey}`] = true;
  writeMap(DISMISS_KEY, kept);
}

const isDismissed = (lane: Lane, windowKey: string): boolean =>
  readMap(DISMISS_KEY)[`${lane}|${windowKey}`] === true;

function persistSnooze(lane: Lane, until: number) {
  const map = readMap(SNOOZE_KEY);
  map[lane] = until;
  writeMap(SNOOZE_KEY, map);
}

function snoozedUntil(lane: Lane): number {
  const v = readMap(SNOOZE_KEY)[lane];
  return typeof v === "number" ? v : 0;
}

/* ── Presentation ────────────────────────────────────────────────────────── */

/** Accent per state — the strip's own ramp: BUILD orange, SILENT red,
    BEHIND amber. ON_PACE never gets a card. */
const ACCENT: Record<string, string> = {
  build: "var(--origins-build)",
  silent: "var(--red)",
  behind: "var(--amber)",
};

function stateWord(lane: LaneSummary): string {
  if (lane.state === "silent")
    return lane.daysSinceLast !== null ? `SILENT ${lane.daysSinceLast}d` : "SILENT";
  if (lane.state === "build") return "BUILD";
  return "BEHIND";
}

interface NudgeCardProps {
  label: string;
  lane: LaneSummary;
  hint: string;
  proof: string;
  busy: boolean;
  error: string | null;
  confirm: string | null;
  onProof: (v: string) => void;
  onDone: () => void;
  onLater: () => void;
}

function NudgeCard({
  label,
  lane,
  hint,
  proof,
  busy,
  error,
  confirm,
  onProof,
  onDone,
  onLater,
}: NudgeCardProps) {
  const accent = ACCENT[lane.state] ?? "var(--amber)";
  const next = lane.next;

  if (confirm) {
    return (
      <div className="onudge" style={{ borderLeftColor: "var(--green)" }}>
        <div className="onudge-head">
          <span className="onudge-name">{label}</span>
          <span className="onudge-state" style={{ color: "var(--green)" }}>
            ✓ DONE
          </span>
        </div>
        <div className="onudge-lesson">{confirm}</div>
      </div>
    );
  }

  return (
    <div className="onudge" style={{ borderLeftColor: accent }}>
      <div className="onudge-head">
        <span className="onudge-name">{label}</span>
        <span className="onudge-state" style={{ color: accent }}>
          {stateWord(lane)}
        </span>
        <span className="onudge-ttl">{hint}</span>
      </div>
      {next && (
        <>
          <div className="onudge-lesson">
            {next.isBuild && <span style={{ color: "var(--origins-build)" }}>BUILD: </span>}
            {next.isBuild ? deliverableOf(next.lesson) : next.lesson}
          </div>
          <div className="onudge-sub">
            {next.module} · {lane.thisWeek}/{lane.weeklyTarget} this week
          </div>
          {error && <div className="onudge-error">{error}</div>}
          <div className="onudge-actions">
            <button type="button" className="onudge-tick" disabled={busy} onClick={onDone}>
              {busy ? "…" : "✓ Done"}
            </button>
            <input
              className="onudge-proof"
              type="url"
              value={proof}
              placeholder={next.isBuild ? "Proof URL — no URL, no tick" : "Proof URL (optional)"}
              onChange={(e) => onProof(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onDone();
              }}
            />
            <button type="button" className="onudge-later" onClick={onLater}>
              Later
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── The component ───────────────────────────────────────────────────────── */

interface LaneUi {
  proof: string;
  busy: boolean;
  error: string | null;
  confirm: string | null;
}

const LANE_UI_ZERO: LaneUi = { proof: "", busy: false, error: null, confirm: null };

export default function OriginsNudges() {
  const [data, setData] = useState<OriginsPayload | null>(null);
  // null until mounted — the server and first client render show nothing,
  // so there is no hydration mismatch and no server-side clock read.
  const [now, setNow] = useState<SydneyNow | null>(null);
  const [ui, setUi] = useState<Record<Lane, LaneUi>>({
    taylan: LANE_UI_ZERO,
    nihal: LANE_UI_ZERO,
  });
  // Bumped whenever visibility inputs held OUTSIDE React change
  // (localStorage writes, in-memory auto-dismiss marks).
  const [, setEpoch] = useState(0);
  const bump = () => setEpoch((n) => n + 1);

  /* Windowed cards already auto-dismissed (or completed) THIS mount, keyed
     `lane|windowKey`. In memory on purpose: only Later persists. */
  const spent = useRef(new Set<string>());
  /* A SILENT card's auto-dismiss, per lane: hidden until this epoch-ms, then
     it returns (the hourly recurrence). In memory like `spent` — a reload
     re-shows the card with a fresh timeout, exactly as windowed cards do. */
  const silentHiddenUntil = useRef<Record<Lane, number>>({ taylan: 0, nihal: 0 });
  const confirmTimers = useRef<Partial<Record<Lane, ReturnType<typeof setTimeout>>>>({});

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/origins${force ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) return; // keep the last good payload
      setData(await res.json());
    } catch {
      /* offline — keep whatever we have */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  /* The clock: evaluated on mount (first-load-inside-a-window shows the
     card) and every CLOCK_TICK_MS thereafter (crossing 07:30 mid-session
     shows it too). */
  useEffect(() => {
    setNow(sydneyNow());
    const id = setInterval(() => setNow(sydneyNow()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const win = now ? openWindow(now.minutes) : null;
  const windowKey = win && now ? `${now.dateKey}·${win}` : null;

  const setLaneUi = (lane: Lane, patch: Partial<LaneUi>) =>
    setUi((u) => ({ ...u, [lane]: { ...u[lane], ...patch } }));

  /** Visible right now? The server's lane.state IS the pace logic. */
  const visibleFor = (lane: Lane): boolean => {
    if (!data || now === null) return false;
    // The confirmation lingers even though the post-tick refetch may have
    // already flipped the lane to onpace — checked FIRST for that reason.
    if (ui[lane].confirm) return true;
    const summary = data[lane];
    if (!summary || summary.state === "onpace" || !summary.next) return false;
    if (summary.state === "silent")
      return (
        Date.now() >= snoozedUntil(lane) &&
        Date.now() >= silentHiddenUntil.current[lane]
      );
    if (!windowKey) return false;
    if (spent.current.has(`${lane}|${windowKey}`)) return false;
    return !isDismissed(lane, windowKey);
  };

  /* Auto-dismiss: EVERY visible card leaves after the shared AUTO_DISMISS_MS
     idle timeout — the exit is the same hard cut the mission card uses.
     Windowed cards are keyed on lane|windowKey so a card re-shown in a later
     window gets a fresh timeout; a silent card's dismissal instead schedules
     its hourly return (no pin — owner directive 2026-08-26). */
  const tVis = visibleFor("taylan");
  const nVis = visibleFor("nihal");
  useEffect(() => {
    if (!data) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const { key } of LANES) {
      const summary = data[key];
      if (!summary) continue;
      const vis = key === "taylan" ? tVis : nVis;
      if (!vis) continue;
      if (summary.state === "silent") {
        timers.push(
          setTimeout(() => {
            // Same recurrence as Later: back in an hour, until a tick lands.
            silentHiddenUntil.current[key] = Date.now() + SILENT_RETURN_MS;
            bump();
          }, AUTO_DISMISS_MS),
        );
        continue;
      }
      if (!windowKey) continue;
      const mark = `${key}|${windowKey}`;
      if (spent.current.has(mark)) continue;
      timers.push(
        setTimeout(() => {
          spent.current.add(mark);
          bump();
        }, AUTO_DISMISS_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [data, windowKey, tVis, nVis]);

  useEffect(() => {
    const timers = confirmTimers.current;
    return () => {
      Object.values(timers).forEach((t) => t !== undefined && clearTimeout(t));
    };
  }, []);

  /* ✓ Done — the strip's own write, verbatim: PATCH /api/origins/complete
     with { pageId, completedBy: lane, proof? }. The BUILD gate is enforced
     server-side; a refusal surfaces as the server's own message. */
  const tick = useCallback(
    async (lane: Lane) => {
      const summary = data?.[lane];
      if (!summary?.next) return;
      const proof = ui[lane].proof.trim();
      setLaneUi(lane, { busy: true, error: null });
      try {
        const res = await fetch("/api/origins/complete", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageId: summary.next.pageId,
            // The lane IS the person who ticked — matters on shared modules.
            completedBy: lane,
            ...(proof ? { proof } : {}),
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          setLaneUi(lane, { busy: false, error: result?.message ?? `Failed (${res.status})` });
          return;
        }
        setLaneUi(lane, {
          busy: false,
          proof: "",
          error: null,
          confirm: `Saved — ${summary.next.lesson}`,
        });
        if (windowKey) spent.current.add(`${lane}|${windowKey}`);
        const prev = confirmTimers.current[lane];
        if (prev !== undefined) clearTimeout(prev);
        confirmTimers.current[lane] = setTimeout(() => {
          setLaneUi(lane, { confirm: null });
          bump();
        }, CONFIRM_MS);
        await load(true); // counts update; a no-longer-behind lane's card goes with them
      } catch {
        setLaneUi(lane, { busy: false, error: "Network error — not saved." });
      }
    },
    [data, ui, windowKey, load],
  );

  const later = useCallback(
    (lane: Lane) => {
      const summary = data?.[lane];
      if (!summary) return;
      if (summary.state === "silent") {
        // Not forever: the card returns in an hour until a tick lands.
        persistSnooze(lane, Date.now() + SILENT_RETURN_MS);
      } else if (windowKey && now) {
        persistDismiss(lane, windowKey, now.dateKey);
      }
      bump();
    },
    [data, windowKey, now],
  );

  /* One hint style for every card, derived from the shared constant. */
  const hintFor = (lane: LaneSummary): string =>
    lane.state === "silent"
      ? `hides in ${AUTO_DISMISS_MS / 1000}s · back hourly`
      : `${win} window · hides in ${AUTO_DISMISS_MS / 1000}s`;

  const cardFor = (key: Lane, label: string) => {
    const vis = key === "taylan" ? tVis : nVis;
    if (!vis || !data) return null;
    const summary = data[key];
    return (
      <NudgeCard
        label={label}
        lane={summary}
        hint={hintFor(summary)}
        proof={ui[key].proof}
        busy={ui[key].busy}
        error={ui[key].error}
        confirm={ui[key].confirm}
        onProof={(v) => setLaneUi(key, { proof: v })}
        onDone={() => tick(key)}
        onLater={() => later(key)}
      />
    );
  };

  /* Two fixed hook calls — one per lane — so hook order never changes.
     The cards render inside the shared CornerStack, never self-positioned. */
  useCornerCard("origins-taylan", cardFor("taylan", "Taylan"));
  useCornerCard("origins-nihal", cardFor("nihal", "Nihal"));

  return null;
}
