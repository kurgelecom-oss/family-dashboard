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
  /* The OriginsStrip banner is retired on EVERY route (owner, 2026-08-26) —
     unmounted in app/layout.tsx, --strip-h zeroed globally at the end of
     globals.css. The face needs no local override any more; origins pressure
     arrives only through OriginsNudges in the CornerStack below. */
  return (
    <div className="dashboard">
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
