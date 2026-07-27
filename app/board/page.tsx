"use client";

import { useCallback, useEffect, useState } from "react";
import WeekProgressStrip from "../components/WeekProgressStrip";
import type { Block, BoardPayload } from "../api/board/route";

/* ────────────────────────────────────────────────────────────────────────────
   /board — the whole family's week, one payload, eight Notion layers.

   Replaces /week. Shape and ownership come from BOARD-SPEC.md; this file renders
   that payload and decides nothing about which layer belongs to whom.

   `import type` above is erased at compile time — it carries the Block shape
   from the route so the two cannot drift, and pulls no server code (and no
   NOTION_TOKEN) into the client bundle. Verified by grepping the built output.
   ──────────────────────────────────────────────────────────────────────────── */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type DayKey = (typeof DAYS)[number];

// Parent page for every layer database. BOARD-SPEC / PARITY: "Edit in Notion link".
const NOTION_PARENT = "https://app.notion.com/p/39b5429afa9081b285dcdeb7fea6a781";

// Owner → layers, straight from BOARD-SPEC's DATA SOURCES table and STRUCTURE
// section. A layer may only appear under its owner: this table is the only place
// that mapping exists on the client, and it is rendered in spec order. Accents are
// globals.css tokens — Ansar is amber to match WeekProgressStrip and the rest of
// the dashboard.
const PEOPLE = [
  {
    key: "taylan",
    label: "Taylan",
    accent: "var(--cyan)",
    layers: [
      { key: "work", label: "Work" },
      { key: "personal", label: "Personal" },
      { key: "ecom", label: "Ecom" },
    ],
  },
  {
    key: "nihal",
    label: "Nihal",
    accent: "var(--green)",
    layers: [
      { key: "home", label: "Home" },
      { key: "personal", label: "Personal" },
      { key: "ecom", label: "Ecom" },
      { key: "ayah", label: "Ayah" },
    ],
  },
  {
    key: "ansar",
    label: "Ansar",
    accent: "var(--amber)",
    layers: [{ key: "homeschool", label: "Homeschool" }],
  },
] as const;

// Notes/detail up to this length sit on the block; anything longer would swamp a
// column at TV distance, so it moves to the hover title. `detail` runs to 352
// chars on the homeschool layer and `notes` peaks at 45, so in practice notes
// show and long detail hides, without either being special-cased.
const INLINE_MAX = 60;

/** Weekday column for a one-off dated block, anchored at UTC noon so no timezone
 *  can push a calendar date onto the wrong day. Mirrors app/week/page.tsx. */
function weekdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-AU", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/**
 * Which column a block belongs in.
 *
 * Recurring blocks carry `day`; one-off blocks carry `date` and an empty `day`,
 * and are placed on their date's weekday. Matched on the 3-letter prefix so a
 * source storing "Monday" lands in the same column as one storing "Mon".
 */
function columnOf(block: Block): DayKey | null {
  const raw = block.day || (block.date ? weekdayOf(block.date) : "");
  const head = raw.slice(0, 3).toLowerCase();
  return DAYS.find((d) => d.toLowerCase() === head) ?? null;
}

/**
 * Ascending by start time, nulls last.
 *
 * Sorts on `startMin`, never on the `start` display string — the two sources use
 * different formats ("14:00" and "9:05am") and string order puts 2pm three places
 * from 14:00. BOARD-SPEC amendment 2026-07-26 makes this binding on renderers.
 */
function byStart(a: Block, b: Block): number {
  if (a.startMin === null && b.startMin === null) return a.title.localeCompare(b.title);
  if (a.startMin === null) return 1;
  if (b.startMin === null) return -1;
  return a.startMin - b.startMin;
}

function BlockCard({ block }: { block: Block }) {
  const extra = [block.notes, block.detail].filter(Boolean).join(" · ");
  const time = [block.start, block.end].filter(Boolean).join("–");

  return (
    <div
      title={extra || undefined}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        {block.emoji ? (
          <span aria-hidden style={{ fontSize: 15, lineHeight: 1.2, flexShrink: 0 }}>
            {block.emoji}
          </span>
        ) : null}
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            lineHeight: 1.25,
          }}
        >
          {block.title}
        </span>
      </div>

      {time ? (
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {time}
          {block.startMin === null ? (
            // An untimed block sorts last rather than to midnight. Saying so beats
            // leaving it silently at the bottom of the column.
            <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · untimed</span>
          ) : null}
        </div>
      ) : null}

      {block.date ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--amber)" }}>
          one-off · {block.date}
        </div>
      ) : null}

      {/* Category is one of the five Weekly Schedule fields BOARD-SPEC names as the
          difference the renderer must cope with, so it is shown rather than dropped.
          /week colour-codes by it; here it is a text label, because seven columns of
          coloured chips at TV distance competes with the person accent that carries
          ownership — the more important signal on this page. */}
      {block.category ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-label)",
          }}
        >
          {block.category}
        </div>
      ) : null}

      {extra && extra.length <= INLINE_MAX ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.3 }}>{extra}</div>
      ) : null}
    </div>
  );
}

function LayerGrid({ blocks }: { blocks: Block[] }) {
  // An empty layer never collapses to a blank gap — it says so. Ayah is empty
  // today, and an empty layer is indistinguishable from a failed one by block
  // count alone, so the wording points at the banner rather than claiming the
  // layer is genuinely clear.
  if (blocks.length === 0) {
    return (
      <div
        style={{
          padding: "14px 12px",
          border: "1px dashed var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        No blocks in this layer. An empty layer and a failed one look the same here — a
        failure would be named in the banner at the top of the page.
      </div>
    );
  }

  const byDay = new Map<DayKey, Block[]>(DAYS.map((d) => [d, []]));
  // Unplaceable blocks are surfaced rather than dropped — the reader emits no block
  // without a day or a date, so this should stay empty, but silently discarding one
  // is exactly the failure mode /board exists to end.
  const unplaced: Block[] = [];
  for (const b of blocks) {
    const col = columnOf(b);
    if (col) byDay.get(col)?.push(b);
    else unplaced.push(b);
  }
  for (const list of byDay.values()) list.sort(byStart);

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(120px, 1fr))",
            gap: 6,
            minWidth: 840,
          }}
        >
          {DAYS.map((d) => (
            <div
              key={`h-${d}`}
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-label)",
                paddingBottom: 2,
              }}
            >
              {d}
            </div>
          ))}
          {DAYS.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={`c-${d}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {list.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      padding: "6px 8px",
                      border: "1px dashed var(--border)",
                      borderRadius: 6,
                    }}
                  >
                    —
                  </div>
                ) : (
                  list.map((b, i) => <BlockCard key={`${b.title}-${b.start}-${i}`} block={b} />)
                )}
              </div>
            );
          })}
        </div>
      </div>

      {unplaced.length > 0 ? (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--red)" }}>
          {unplaced.length} block{unplaced.length === 1 ? "" : "s"} could not be placed on a day
          and {unplaced.length === 1 ? "is" : "are"} not shown above:{" "}
          {unplaced.map((b) => b.title).join(", ")}
        </div>
      ) : null}
    </>
  );
}

export default function BoardPage() {
  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Set only after a completed fetch, never during render, so the server and client
  // markup cannot disagree about the time.
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);
  // Open/closed lives here and nowhere else — no localStorage, no sessionStorage.
  // All three start open: on a wall-mounted TV nobody is there to expand them.
  const [open, setOpen] = useState<Record<string, boolean>>({
    taylan: true,
    nihal: true,
    ansar: true,
  });

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      // `?refresh=1` bypasses the route's 300s in-memory entry. `cache: "no-store"` is
      // belt and braces for the browser side of the same problem — without it a manual
      // refresh could be answered from the bfcache/HTTP cache and show the same stale
      // board it was pressed to escape.
      const res = await fetch(force ? "/api/board?refresh=1" : "/api/board", {
        cache: force ? "no-store" : "default",
      });
      // A 503 still carries a body naming every failed layer, so parse before
      // deciding: the banner is more useful than a bare status code.
      const data: BoardPayload = await res.json();
      setPayload(data);
      setLoadError(
        res.ok
          ? null
          : `/api/board returned HTTP ${res.status}. The board below may be incomplete.`,
      );
      setLastLoaded(new Date().toLocaleTimeString("en-AU", { hour12: false }));
    } catch (e) {
      setPayload(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 300_000); // matches the route's 300s cache
    return () => clearInterval(id);
  }, [load]);

  const errors = payload?.errors ?? [];
  const blocks = payload?.blocks ?? [];

  return (
    // `html, body` are `height: 100%; overflow: hidden` in globals.css — that rule is
    // what pins the TV dashboard at `/` to exactly one viewport, so it stays. The cost
    // was that anything taller than the viewport on THIS page got clipped and became
    // unreachable: with all three sections open the board runs well past 1080px. So the
    // board root is its own scroll container — fixed to exactly the space below the nav,
    // scrolling internally. `tabIndex` is deliberate, not a lint slip: a scrollable
    // region has to be reachable by keyboard, which on the Samsung TV is the remote's
    // arrow keys. The focus ring is left alone for the same reason.
    <div
      tabIndex={0}
      aria-label="Family board — scrollable"
      style={{
        marginTop: "var(--nav-h)",
        height: "calc(100dvh - var(--nav-h))",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        // Thin, themed scrollbar: enough to signal "there is more below" at TV distance
        // without introducing a colour outside the existing token set.
        scrollbarWidth: "thin",
        scrollbarColor: "var(--border) transparent",
        background: "var(--bg-base)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div className="header">
        <div className="header-brand">
          <div className="header-name">
            Family <span>Board</span>
          </div>
          <div className="header-sub">Taylan · Nihal · Ansar — the whole week</div>
        </div>
        <div className="header-right">
          {/* The person toggles live HERE, in the header row that already exists, rather
              than as three 52px section headers stacked down the page. Open or closed they
              cost the board zero vertical space: the row is sized by the Refresh button
              beside them, which is no shorter. A closed section renders nothing at all, so
              the only thing between the nav and the timetable is this one row. */}
          <div
            role="group"
            aria-label="Show or hide each person's board"
            style={{ display: "flex", gap: 6, marginRight: 4 }}
          >
            {PEOPLE.map((person) => {
              const isOpen = open[person.key] ?? true;
              return (
                <button
                  key={person.key}
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [person.key]: !isOpen }))}
                  aria-pressed={isOpen}
                  title={`${isOpen ? "Hide" : "Show"} ${person.label} — ${
                    blocks.filter((b) => b.person === person.key).length
                  } blocks`}
                  style={{
                    // 44px minimum so a closed section is recoverable by thumb on the iPad,
                    // not just by mouse.
                    minHeight: 44,
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: 800,
                    borderRadius: 6,
                    cursor: "pointer",
                    // Open is the person's accent on the raised background; closed drops to
                    // muted on transparent. Reads as on/off at TV distance without a second
                    // row of state text.
                    background: isOpen ? "var(--bg-highlight)" : "transparent",
                    color: isOpen ? person.accent : "var(--text-muted)",
                    border: `1px solid ${isOpen ? person.accent : "var(--border)"}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isOpen ? "●" : "○"} {person.label}
                </button>
              );
            })}
          </div>
          {lastLoaded ? (
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
              loaded {lastLoaded}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            aria-busy={refreshing}
            title="Re-read all eight Notion sources now, bypassing the 300s server cache"
            style={{
              // 44px minimum so it is a real target on the iPad, not just on a mouse.
              minHeight: 44,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 6,
              cursor: refreshing ? "default" : "pointer",
              background: "var(--bg-highlight)",
              color: refreshing ? "var(--text-muted)" : "var(--text-primary)",
              border: "1px solid var(--border)",
            }}
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
          <a
            href={NOTION_PARENT}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-cyan"
            style={{ textDecoration: "none", padding: "8px 14px", fontSize: 13 }}
          >
            Edit in Notion ↗
          </a>
        </div>
      </div>

      {/* Never fail silently: any failed layer is named, in view, above the board. */}
      {errors.length > 0 ? (
        <div
          role="alert"
          style={{
            // flexShrink 0 on every direct child of the scroll container: the column has
            // a fixed height now, so a shrinkable child compresses to fit instead of
            // pushing the scroll height out. The person sections already pin themselves
            // with `flex: "none"`; these banners did not, and a squashed failure banner
            // is the one thing on this page that must never be hard to read.
            flexShrink: 0,
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "10px 14px",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--red)" }}>
            {errors.length} of 8 layers failed to load
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)" }}>
            {errors.map((e) => `${e.person} · ${e.layer} — ${e.error}`).join("  |  ")}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
            Those layers are shown empty below. Empty here does not mean empty in Notion.
          </div>
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--red)",
          }}
        >
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <div
          className="card"
          // `.card` is `flex: 1; min-height: 0` in globals.css — inside a fixed-height
          // column that lets it collapse to nothing. Pin it like the sections do.
          style={{ flex: "none", color: "var(--text-secondary)", fontSize: 15 }}
        >
          Loading the board…
        </div>
      ) : null}

      {PEOPLE.map((person) => {
        const isOpen = open[person.key] ?? true;
        // Closed means gone, not collapsed-to-a-bar: the toggle that brings it back is in
        // the header row, so nothing has to be left behind on the page to click. This is
        // the whole point of the change — a hidden person costs the timetable zero pixels.
        if (!isOpen) return null;
        return (
          <section
            key={person.key}
            className="card"
            style={{
              // The person's identity now rides on this accent stripe and on the layer
              // headings below, so removing the header bar cost no ownership signal.
              padding: "10px 12px",
              borderLeft: `4px solid ${person.accent}`,
              overflow: "hidden",
              flex: "none",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* PARITY: the ANSAR FC strip, reused as-is. It already imports the
                canonical scoreDay from app/lib/scoring.ts — no fourth copy. */}
            {person.key === "ansar" ? <WeekProgressStrip /> : null}

            {person.layers.map((layer) => {
              const layerBlocks = blocks.filter(
                (b) => b.person === person.key && b.layer === layer.key,
              );
              const failed = errors.find((e) => e.person === person.key && e.layer === layer.key);
              return (
                <div key={layer.key}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    {/* Person name folded into the layer heading rather than given a row of
                        its own. Same information, one line instead of two. */}
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 17,
                        fontWeight: 800,
                        color: person.accent,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {person.label} · {layer.label}
                    </h3>
                    <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                      {layerBlocks.length} block{layerBlocks.length === 1 ? "" : "s"}
                    </span>
                    {failed ? (
                      <span className="badge badge-red" style={{ fontSize: 11 }}>
                        failed to load
                      </span>
                    ) : null}
                  </div>
                  <LayerGrid blocks={layerBlocks} />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
