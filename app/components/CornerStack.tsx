"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

/* ────────────────────────────────────────────────────────────────────────────
   CornerStack — the ONE bottom-right notification surface (2026-08-26).

   Two producers exist today: GoalsIntermission (the mission corner card) and
   OriginsNudges (per-lane course nudges). Before this file each producer owned
   its own `position: fixed; right: 24px; bottom: 24px` box, which meant two
   cards live at once sat ON TOP of each other. Now nobody positions itself:
   producers register a card node keyed by a stable id, and this component —
   the only fixed element — lays them out in a single flex column.

   Non-overlap and non-overwrite are structural, not cooperative:
     - one flex column with a 12px gap → boxes cannot intersect;
     - cards are keyed by id and appended → a new card can never replace an
       existing one, it can only join the stack (or wait in the queue).

   At most MAX_VISIBLE cards render; later arrivals queue in registration
   order and surface as slots free. Within the visible set the NEWEST renders
   on top. Each card keeps its own timing — this file never dismisses anything.

   The container is pointer-events: none and so is each item wrapper; a card
   that wants interaction (the nudges do, the mission card deliberately does
   not) opts in with pointer-events: auto on its own root. No backdrop, no
   scrim, no blur — ever. The dashboard behind stays fully interactive.
   ──────────────────────────────────────────────────────────────────────────── */

interface CornerCard {
  id: string;
  node: ReactNode;
}

const MAX_VISIBLE = 3;

let cards: readonly CornerCard[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function upsertCornerCard(id: string, node: ReactNode) {
  const at = cards.findIndex((c) => c.id === id);
  // Update in place keeps the card's slot (and its spot in the queue order);
  // only a genuinely new id joins at the end.
  cards =
    at >= 0
      ? cards.map((c, i) => (i === at ? { id, node } : c))
      : [...cards, { id, node }];
  emit();
}

function removeCornerCard(id: string) {
  const next = cards.filter((c) => c.id !== id);
  if (next.length !== cards.length) {
    cards = next;
    emit();
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: readonly CornerCard[] = [];
const getSnapshot = () => cards;
const getServerSnapshot = () => EMPTY;

/**
 * Producer hook. Pass the card node to show it, null to take it down. The
 * effect has no dependency array on purpose: the node is fresh JSX every
 * render, so every producer render refreshes the registered card in place.
 */
export function useCornerCard(id: string, node: ReactNode | null) {
  useEffect(() => {
    if (node === null) removeCornerCard(id);
    else upsertCornerCard(id, node);
  });
  // Unmount takes the card down even if the last render registered one.
  useEffect(() => () => removeCornerCard(id), [id]);
}

export default function CornerStack() {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (all.length === 0) return null;

  // First MAX_VISIBLE hold their slots; the rest queue until one frees.
  const shown = all.slice(0, MAX_VISIBLE);

  return (
    <div className="corner-stack" data-corner-count={shown.length}>
      {/* Reversed so the newest of the visible set sits on TOP of the column. */}
      {[...shown].reverse().map((c) => (
        <div key={c.id} className="corner-stack-item" data-corner-id={c.id}>
          {c.node}
        </div>
      ))}
    </div>
  );
}
