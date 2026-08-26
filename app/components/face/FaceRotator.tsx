"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Header from "../Header";
import { buildFaceModel, useFaceData } from "./useFaceData";
import FaceFrameSentence from "./FaceFrameSentence";
import FaceFrameNumbers from "./FaceFrameNumbers";
import FaceFrameLanes from "./FaceFrameLanes";

/* ════════════════════════════════════════════════════════════════════════════
   The face's rotator. RESTRUCTURE-SPEC §3 mechanics:

   · Loop is 50 s — 10 + 15 + 25. DWELL_MS is the ONE constant array; nothing
     else hardcodes a dwell.
   · Hard cut between frames — conditional render, no transition.
   · ?view=1|2|3 freezes that frame and stops the timer. No param = mounts
     PAUSED on frame 1 (owner directive 2026-08-26); rotation starts only
     when the header play pill is pressed.
   · visibilitychange hidden → pause; visible → resume at frame 1.
   · Touch on a hero/lane/chip (any anchor) navigates. Any other touch pauses
     rotation for 60 s, then resumes at frame 1.
   · The `n/3` counter (current frame cyan) rides in the Header's right
     cluster next to date · time, via Header's `frameCounter` render slot —
     only the 2px progress line filling toward the next frame sits under the
     Header. Header stays mounted across frames (theme/clock state persists);
     routes that don't rotate render Header with no counter, unchanged.
   · One data load: useFaceData feeds all three frames; frames never fetch.
   ══════════════════════════════════════════════════════════════════════════ */

const DWELL_MS = [10_000, 15_000, 25_000] as const;
const TOUCH_PAUSE_MS = 60_000;

export default function FaceRotator() {
  const data = useFaceData();
  const model = useMemo(() => buildFaceModel(data), [data]);

  const [frame, setFrame] = useState(0); // 0-based; rendered as n/3
  const [frozen, setFrozen] = useState<number | null>(null);
  const [suspended, setSuspended] = useState(false);
  /* Owner pause (2026-08-26): indefinite, toggled by the header pause pill.
     Distinct from the 60 s touch-pause (`suspended`) — the timer stays fully
     stopped until the pill is tapped again, and resume restarts at frame 1,
     the same landing the spec's other resumes use.
     Owner directive (Prompt 8, 2026-08-26): the face MOUNTS paused on frame 1
     — rotation only ever starts from a pill press. Nothing is persisted;
     every fresh load starts paused. (Deliberate deviation from RESTRUCTURE-
     SPEC §7 "`/` rotates" — recorded in RESTRUCTURE-LEDGER.) */
  const [paused, setPaused] = useState(true);
  const frozenRef = useRef<number | null>(null);
  const pausedRef = useRef(true);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ?view=1|2|3 — freeze that frame, stop the timer. Read once on mount from
     location.search (client-only, so no Suspense boundary is needed). */
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("view");
    const n = raw === null ? NaN : Number(raw);
    if (n === 1 || n === 2 || n === 3) {
      frozenRef.current = n - 1;
      setFrozen(n - 1);
      setFrame(n - 1);
    }
  }, []);

  /* Rotation — one timeout per dwell; cleared whenever frozen, suspended or
     paused. */
  useEffect(() => {
    if (frozen !== null || suspended || paused) return;
    const id = setTimeout(() => setFrame((f) => (f + 1) % DWELL_MS.length), DWELL_MS[frame]);
    return () => clearTimeout(id);
  }, [frame, frozen, suspended, paused]);

  /* Hidden → pause. Visible → resume at frame 1. Frozen stays frozen; an
     owner pause survives (no auto-resume, current frame stays up). */
  useEffect(() => {
    const onVis = () => {
      if (frozenRef.current !== null) return;
      if (pausedRef.current) return;
      if (document.hidden) {
        setSuspended(true);
      } else {
        if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
        setFrame(0);
        setSuspended(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(
    () => () => {
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    },
    [],
  );

  /* Touch: anchors navigate; anything else pauses 60 s then resumes at 1.
     While owner-paused, touches never schedule a resume — only the pill does. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (frozenRef.current !== null) return;
    if (pausedRef.current) return;
    const el = e.target as Element | null;
    if (el && el.closest("a")) return;
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    setSuspended(true);
    touchTimerRef.current = setTimeout(() => {
      setFrame(0);
      setSuspended(false);
    }, TOUCH_PAUSE_MS);
  };

  /* Pill toggle. Pause: stop everything where it stands (clear any pending
     60 s touch-resume so nothing auto-resumes). Resume: back to frame 1,
     exactly where the spec's other resumes land. */
  const togglePause = () => {
    if (frozenRef.current !== null) return;
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      setSuspended(false);
      setFrame(0);
    } else {
      pausedRef.current = true;
      setPaused(true);
      setSuspended(false);
    }
  };

  const rotating = frozen === null && !suspended && !paused;

  return (
    <>
      {/* Header sits OUTSIDE the pointerdown surface, exactly as it did when
          page.tsx rendered it — a tap on NIGHT/AUTO never pauses rotation. */}
      <Header
        frameCounter={
          <div className="face-counter-cluster">
            <div className={"face-counter" + (paused ? " face-counter--dim" : "")}>
              <span className="face-counter-cur">{frame + 1}</span>/{DWELL_MS.length}
            </div>
            {frozen === null && (
              <button
                type="button"
                className={"face-pause" + (paused ? " face-pause--on" : "")}
                aria-pressed={paused}
                aria-label={paused ? "Start rotation" : "Pause rotation"}
                onClick={togglePause}
              >
                {paused ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                    <path d="M3 1.5 12 7 3 12.5z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                    <rect x="2.5" y="1.5" width="3.4" height="11" rx="1" />
                    <rect x="8.1" y="1.5" width="3.4" height="11" rx="1" />
                  </svg>
                )}
              </button>
            )}
          </div>
        }
      />
      <div className="face-main" onPointerDown={onPointerDown}>
        <div className="face-subheader">
          <div className="face-progressline">
            <div
              /* keyed per frame so the fill restarts from 0 on every hard cut */
              key={`${frame}-${rotating ? "run" : "still"}`}
              className={"face-progressline-fill" + (rotating ? " animate" : "")}
              style={rotating ? { animationDuration: `${DWELL_MS[frame]}ms` } : undefined}
            />
          </div>
        </div>

        {frame === 0 && <FaceFrameSentence model={model} />}
        {frame === 1 && <FaceFrameNumbers model={model} />}
        {frame === 2 && <FaceFrameLanes model={model} />}
      </div>
    </>
  );
}
