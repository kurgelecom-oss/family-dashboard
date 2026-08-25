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
   · ?view=1|2|3 freezes that frame and stops the timer. No param = rotate.
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
  const frozenRef = useRef<number | null>(null);
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

  /* Rotation — one timeout per dwell; cleared whenever frozen or suspended. */
  useEffect(() => {
    if (frozen !== null || suspended) return;
    const id = setTimeout(() => setFrame((f) => (f + 1) % DWELL_MS.length), DWELL_MS[frame]);
    return () => clearTimeout(id);
  }, [frame, frozen, suspended]);

  /* Hidden → pause. Visible → resume at frame 1. Frozen stays frozen. */
  useEffect(() => {
    const onVis = () => {
      if (frozenRef.current !== null) return;
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

  /* Touch: anchors navigate; anything else pauses 60 s then resumes at 1. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (frozenRef.current !== null) return;
    const el = e.target as Element | null;
    if (el && el.closest("a")) return;
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    setSuspended(true);
    touchTimerRef.current = setTimeout(() => {
      setFrame(0);
      setSuspended(false);
    }, TOUCH_PAUSE_MS);
  };

  const rotating = frozen === null && !suspended;

  return (
    <>
      {/* Header sits OUTSIDE the pointerdown surface, exactly as it did when
          page.tsx rendered it — a tap on NIGHT/AUTO never pauses rotation. */}
      <Header
        frameCounter={
          <div className="face-counter">
            <span className="face-counter-cur">{frame + 1}</span>/{DWELL_MS.length}
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
