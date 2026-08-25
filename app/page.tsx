"use client";
import GoalsIntermission from "./components/GoalsIntermission";
import FaceRotator from "./components/face/FaceRotator";

/* The face — three rotating frames on a timer (RESTRUCTURE-SPEC §3). The
   route is unchanged; the old 4-column panel grid moved to the drill-downs
   (/money, /business, /table, /board). The panel components themselves are
   untouched — they still render on their own routes. GoalsIntermission (the
   "/" pop-up deck) behaves exactly as before. Header renders inside
   FaceRotator so its right cluster can carry the `n/3` frame counter
   (spec §3: date · time · counter); theme + clock behave as before. */

export default function Dashboard() {
  return (
    <div className="dashboard">
      <GoalsIntermission />
      <FaceRotator />
    </div>
  );
}
