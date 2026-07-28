"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { LaneSummary, OriginsPayload } from "../api/origins/route";

/* ────────────────────────────────────────────────────────────────────────────
   OriginsStrip — one row under the nav, on every route, all day.

   `import type` above is erased at compile time: it carries the payload shape
   from the route so the two cannot drift, and pulls no server code (and no
   NOTION_TOKEN) into the client bundle. Same technique /board uses.

   Deliberately NOT a card. It never enters .dashboard-grid and never consumes a
   card slot; --strip-h is subtracted by the three fixed-viewport surfaces so it
   cannot push anything below the fold.
   ──────────────────────────────────────────────────────────────────────────── */

const NOTION_URL = "https://app.notion.com/p/8922c4a416e0445f808916a10e52b5f8";

/** Ansar's surface is his own. A Taylan/Nihal course tracker has no business there. */
const HIDDEN_ON = ["/ansar"];

const REFRESH_MS = 300_000;

type Lane = "taylan" | "nihal";
const LANES: { key: Lane; label: string }[] = [
  { key: "taylan", label: "Taylan" },
  { key: "nihal", label: "Nihal" },
];

/**
 * An Action Item title reads like "🎯 Action Item: Build the thing". On the
 * strip the emoji is noise and the words "Action Item" are already carried by
 * the BUILD: prefix and the lane colour, so both are stripped and only the
 * deliverable is left.
 */
export function deliverableOf(title: string): string {
  return title
    .replace(/^[\s\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍]+/u, "")
    .replace(/^action\s*item\s*[:–—-]\s*/i, "")
    .trim();
}

function laneText(lane: LaneSummary): { text: string; isBuild: boolean } {
  if (!lane.next) return { text: "All lessons complete", isBuild: false };
  if (lane.next.isBuild) return { text: deliverableOf(lane.next.lesson), isBuild: true };
  return { text: lane.next.lesson, isBuild: false };
}

export default function OriginsStrip() {
  const pathname = usePathname();
  const [data, setData] = useState<OriginsPayload | null>(null);

  // Which lane is mid-tick, whether it is being asked for proof, and any error.
  const [busy, setBusy] = useState<Lane | null>(null);
  const [proofFor, setProofFor] = useState<Lane | null>(null);
  const [proof, setProof] = useState("");
  const [error, setError] = useState<{ lane: Lane; message: string } | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/origins${force ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) return; // 503 keeps the last good payload on screen
      setData(await res.json());
    } catch {
      /* offline — keep whatever is already rendered */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const tick = useCallback(
    async (lane: Lane, summary: LaneSummary, withProof?: string) => {
      if (!summary.next) return;
      setBusy(lane);
      setError(null);
      try {
        const res = await fetch("/api/origins/complete", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageId: summary.next.pageId,
            // The lane IS the person who ticked. Matters on modules 7 and 8,
            // which appear in both lanes — the row is shared, the tick is not.
            completedBy: lane,
            ...(withProof ? { proof: withProof } : {}),
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Fail loudly, with the server's own message. The gate lives on the
          // server; this only reports its verdict.
          setError({ lane, message: result?.message ?? `Failed (${res.status})` });
          return;
        }
        setProofFor(null);
        setProof("");
        await load(true);
      } catch {
        setError({ lane, message: "Network error — not saved." });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  // Reserve the row before the first payload lands, so nothing below it shifts
  // when the data arrives.
  if (!data) return <div className="origins-strip" aria-hidden />;

  // Emphasis goes to the larger gap against the weekly target. Ties favour
  // Taylan, per spec.
  const gap = (l: LaneSummary) => l.weeklyTarget - l.thisWeek;
  const emphasised: Lane = gap(data.nihal) > gap(data.taylan) ? "nihal" : "taylan";

  return (
    <div className="origins-strip">
      {LANES.map(({ key, label }) => {
        const lane = data[key];
        const { text, isBuild } = laneText(lane);
        const isSilent = lane.state === "silent";
        const laneError = error?.lane === key ? error.message : null;
        const asking = proofFor === key;

        return (
          <div
            key={key}
            className={`origins-lane state-${lane.state}${key === emphasised ? " emphasis" : ""}`}
          >
            <span className="origins-name">{label}</span>
            <span className="origins-module">{lane.next?.module ?? "—"}</span>

            {asking ? (
              <span className="origins-proof">
                <input
                  autoFocus
                  type="url"
                  value={proof}
                  placeholder="Proof URL — no URL, no tick"
                  onChange={(e) => setProof(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") tick(key, lane, proof);
                    if (e.key === "Escape") {
                      setProofFor(null);
                      setProof("");
                      setError(null);
                    }
                  }}
                />
                {laneError && <span className="origins-error">{laneError}</span>}
              </span>
            ) : (
              <>
                <span className="origins-lesson">
                  {isBuild && <span className="build-tag">BUILD: </span>}
                  {text}
                </span>
                {laneError && <span className="origins-error">{laneError}</span>}
                {isSilent && lane.daysSinceLast !== null && (
                  <span className="origins-silent">{lane.daysSinceLast} days</span>
                )}
                <span className="origins-count">
                  {lane.thisWeek} / {lane.weeklyTarget} this week
                </span>
              </>
            )}

            <button
              type="button"
              className="origins-tick"
              disabled={busy === key || !lane.next}
              title={isBuild ? "BUILD item — a proof URL is required" : `Tick: ${text}`}
              onClick={() => {
                if (!lane.next) return;
                // BUILD: first click opens the input, it does not submit. The
                // server still refuses a proofless tick either way.
                if (isBuild && !asking) {
                  setProofFor(key);
                  setError(null);
                  return;
                }
                tick(key, lane, asking ? proof : undefined);
              }}
            >
              {busy === key ? "…" : "✓"}
            </button>
          </div>
        );
      })}

      <a className="origins-notion" href={NOTION_URL} target="_blank" rel="noopener noreferrer">
        Notion ↗
      </a>
    </div>
  );
}
