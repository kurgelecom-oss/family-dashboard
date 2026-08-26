"use client";
import GoalsIntermission from "./components/GoalsIntermission";
import OriginsNudges from "./components/OriginsNudges";
import CornerStack from "./components/CornerStack";
import FaceRotator from "./components/face/FaceRotator";

/* The face — three rotating frames on a timer (RESTRUCTURE-SPEC §3). The
   route is unchanged; the old 4-column panel grid moved to the drill-downs
   (/money, /business, /table, /board). The panel components themselves are
   untouched — they still render on their own routes. GoalsIntermission (the
   "/" pop-up deck) behaves exactly as before. Header renders inside
   FaceRotator so its right cluster can carry the `n/3` frame counter
   (spec §3: date · time · counter); theme + clock behave as before. */

export default function Dashboard() {
  /* dashboard-nostrip: the face has no OriginsStrip (it renders null on
     "/" — see NUDGES_INSTEAD_ON in OriginsStrip.tsx), so this class sets
     --strip-h: 0px LOCALLY on the one element that consumes it, handing
     the strip's height to the frames. Element-local beats every inherited
     :root value by inheritance rules alone — plain class selector, Flip
     Pro safe. */
  return (
    <div className="dashboard dashboard-nostrip">
      {/* Both corner surfaces render through the ONE CornerStack (2026-08-26):
          GoalsIntermission and OriginsNudges register cards; the stack is the
          only fixed bottom-right element, so cards can never overlap. */}
      <GoalsIntermission />
      <OriginsNudges />
      <CornerStack />
      <FaceRotator />
    </div>
  );
}
