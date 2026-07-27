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

/* ── Block types ──────────────────────────────────────────────────────────────
   What KIND of block this is, as a colour. Resolved on two axes, category first:

     category (Routine, Learning, Meal, Screen) → else layer (Work, Personal, …)

   Category wins because it is the finer statement. In today's data the two axes
   are cleanly split — Taylan and Nihal have no categories at all, so they colour
   by layer, and all 52 of Ansar's blocks have one, so he colours by category.
   That split is data, not a rule: the day a Taylan block gets a category, it
   starts colouring by it, which is the correct answer and needs no code change.

   Colouring Ansar by layer instead would paint his whole board one amber, since
   Homeschool is his only layer. Colouring everyone by category would leave the
   other two entirely uncoloured. Hence the fallback rather than a choice.

   Keys are lowercased so "Meal" and "meal" from Notion land on the same hue, and
   an unknown key resolves to null — an unrecognised category falls back to the
   layer's colour, and a block is never rendered referencing a `var()` that does
   not exist. Every value here has a matching --type-* pair in globals.css. */
const TYPE_TOKENS: Record<string, string> = {
  // layers
  "layer:work": "work",
  "layer:personal": "personal",
  "layer:ecom": "ecom",
  "layer:home": "home",
  "layer:ayah": "ayah",
  "layer:homeschool": "homeschool",
  // categories, Ansar's day
  "cat:routine": "routine",
  "cat:learning": "learning",
  "cat:meal": "meal",
  "cat:screen": "screen",
};

type BlockType = { label: string; fg: string; bg: string };

/**
 * The type a block should be coloured as, or null if neither axis is known.
 *
 * Takes the category rather than the whole Block so the layer's own colour can be
 * asked for with `typeOf(null, …)` — used for the grid heading, which has a layer
 * but no block. Passing a fake Block to get that answer would be a lie about what
 * this function reads.
 */
function typeOf(
  category: string | null | undefined,
  layerKey: string,
  layerLabel: string,
): BlockType | null {
  const cat = category?.trim();
  const name =
    (cat ? TYPE_TOKENS[`cat:${cat.toLowerCase()}`] : undefined) ??
    TYPE_TOKENS[`layer:${layerKey.toLowerCase()}`];
  if (!name) return null;
  return {
    // The label follows the same precedence as the colour, so the legend chip and
    // the block always say the same word. Notion's own casing is kept for a
    // category — it is the user's word, not ours.
    label: cat && TYPE_TOKENS[`cat:${cat.toLowerCase()}`] ? cat : layerLabel,
    fg: `var(--type-${name})`,
    bg: `var(--type-${name}-bg)`,
  };
}

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

function BlockCard({ block, type }: { block: Block; type: BlockType | null }) {
  const extra = [block.notes, block.detail].filter(Boolean).join(" · ");
  const time = [block.start, block.end].filter(Boolean).join("–");

  return (
    <div
      title={extra || undefined}
      style={{
        // Three signals of the same type, so it survives being read badly: the tint
        // (what you catch scanning the whole week), the 3px spine (what separates two
        // adjacent blocks of different types in one day column) and the label below.
        // The spine matters most — a tint alone is close to invisible at TV distance,
        // and to anyone whose colour vision makes two of these hues agree.
        background: type ? type.bg : "var(--bg-card)",
        border: "1px solid var(--border)",
        borderLeft: type ? `3px solid ${type.fg}` : "1px solid var(--border)",
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
      {/* The type, in the block's own colour — it is the thing the colour is naming, so
          the two should agree. Now shown on EVERY block, not just the ones with a Notion
          category. When each layer had its own grid the heading above it said "Personal"
          and repeating that on sixteen blocks was noise; in one merged week a Work block
          and a Personal block sit in the same Tuesday column, so each has to say which it
          is. Colour alone would leave anyone who cannot separate two of these hues with
          no way to tell them apart. */}
      {type || block.category ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: type ? type.fg : "var(--text-label)",
          }}
        >
          {type ? type.label : block.category}
        </div>
      ) : null}

      {extra && extra.length <= INLINE_MAX ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.3 }}>{extra}</div>
      ) : null}
    </div>
  );
}

/**
 * ONE week. Every block the person has switched on, in a single seven-column grid.
 *
 * This used to be a grid per layer, stacked — which meant Nihal with four layers on
 * got four Mondays, four Tuesdays and so on down the page, and no way to see that her
 * 11:00 Home block and her 11:30 Ecom block collide. There is one Tuesday in a week,
 * so there is one Tuesday here: layers are merged into the day columns and sorted by
 * time together, so the column reads as the day actually runs. Which layer a block
 * belongs to is carried by its colour and its label, not by its position on the page.
 *
 * `typeFor` rather than a layer key: this grid holds blocks from several layers at
 * once, so each block has to answer for its own colour.
 */
function WeekGrid({
  blocks,
  typeFor,
}: {
  blocks: Block[];
  typeFor: (block: Block) => BlockType | null;
}) {
  // An empty week never collapses to a blank gap — it says so. An empty layer and a
  // failed one are indistinguishable by block count alone, so the wording points at
  // the banner rather than claiming the week is genuinely clear.
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
        No blocks in the areas switched on. Empty and failed look the same here — a failure
        would be named in the banner at the top of the page.
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
                  list.map((b, i) => (
                    <BlockCard
                      key={`${b.layer}-${b.title}-${b.start}-${i}`}
                      block={b}
                      type={typeFor(b)}
                    />
                  ))
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
  // Exactly one person is on screen at a time — this is a radio, not three checkboxes.
  // Holding a single key rather than a Record<string, boolean> makes "all three at once"
  // unrepresentable rather than merely discouraged. Lives here and nowhere else — no
  // localStorage, no sessionStorage. Taylan is the default because he is first in PEOPLE;
  // on a wall-mounted TV nobody is there to pick one.
  const [selected, setSelected] = useState<string>(PEOPLE[0].key);
  // Which layers each person has switched on. Keyed person → layer → on, NOT layer → on:
  // "personal" and "ecom" exist under both Taylan and Nihal, so a flat map would make her
  // hiding Personal also hide his. Nesting keeps each person's view their own, and keeps it
  // while they flick between people — the state lives on this component, above the section
  // that remounts on every swap.
  //
  // Everything starts on, so the default view is unchanged from before this existed.
  const [layersOn, setLayersOn] = useState<Record<string, Record<string, boolean>>>(() =>
    Object.fromEntries(
      PEOPLE.map((p) => [p.key, Object.fromEntries(p.layers.map((l) => [l.key, true]))]),
    ),
  );

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
  // The one person on screen. `?? PEOPLE[0]` is not defensive noise: it is what keeps the
  // board non-empty if `selected` ever holds a key PEOPLE no longer has — renaming or
  // removing a person here should degrade to showing Taylan, not to a blank page.
  const person = PEOPLE.find((p) => p.key === selected) ?? PEOPLE[0];

  // `?? true` throughout: a layer this map has never heard of reads as on. That is what
  // makes adding a layer to PEOPLE safe — it appears, rather than silently defaulting to
  // hidden and looking like a data failure.
  const isLayerOn = (layerKey: string) => layersOn[person.key]?.[layerKey] ?? true;
  const shownLayers = person.layers.filter((l) => isLayerOn(l.key));
  const allLayersOn = shownLayers.length === person.layers.length;

  const toggleLayer = (layerKey: string) =>
    setLayersOn((s) => ({
      ...s,
      [person.key]: { ...s[person.key], [layerKey]: !isLayerOn(layerKey) },
    }));

  const showAllLayers = () =>
    setLayersOn((s) => ({
      ...s,
      [person.key]: Object.fromEntries(person.layers.map((l) => [l.key, true])),
    }));

  // Every block this person has on, from all their switched-on layers at once. This is the
  // set that feeds the single week grid — the merge that ends four stacked Tuesdays.
  const shownBlocks = blocks.filter(
    (b) => b.person === person.key && shownLayers.some((l) => l.key === b.layer),
  );

  // A block's colour, resolved against the layer it actually came from rather than a layer
  // fixed by the grid. In one merged week the grid holds several layers, so the block's own
  // `layer` field is the only thing that can answer this.
  const typeForBlock = (b: Block): BlockType | null => {
    const layer = person.layers.find((l) => l.key === b.layer);
    return typeOf(b.category, b.layer, layer?.label ?? b.layer);
  };

  // Distinct types on screen, in first-seen order. Built from the blocks rather than a fixed
  // list so it can only name colours that are really in the grid.
  const legend: BlockType[] = [];
  for (const b of shownBlocks) {
    const t = typeForBlock(b);
    if (t && !legend.some((x) => x.label === t.label)) legend.push(t);
  }

  const personErrors = errors.filter((e) => e.person === person.key);

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
          {/* Was "Taylan · Nihal · Ansar — the whole week", which described a board showing
              all three at once. It now names the one person on screen, so the subtitle and
              the board below it cannot disagree. */}
          <div className="header-sub">{person.label} — the whole week</div>
        </div>
        <div className="header-right">
          {/* The person picker lives HERE, in the header row that already exists, rather
              than as three 52px section headers stacked down the page. It costs the board
              zero vertical space: the row is sized by the Refresh button beside them, which
              is no shorter. Picking a person REPLACES the one on screen — there is no state
              in which two boards are visible, so the whole viewport below belongs to one
              person. `radiogroup` + `aria-checked` is the honest role for that: a screen
              reader announces "1 of 3", not three independent switches. */}
          <div
            role="radiogroup"
            aria-label="Which person's board to show"
            style={{ display: "flex", gap: 6, marginRight: 4 }}
          >
            {PEOPLE.map((person) => {
              const isSelected = selected === person.key;
              return (
                <button
                  key={person.key}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  // Re-pressing the selected person is a no-op rather than a toggle-off:
                  // one person is always on screen, never zero.
                  onClick={() => setSelected(person.key)}
                  title={`Show ${person.label} — ${
                    blocks.filter((b) => b.person === person.key).length
                  } blocks`}
                  style={{
                    // 44px minimum so switching person is a real target by thumb on the
                    // iPad, not just by mouse.
                    minHeight: 44,
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: 800,
                    borderRadius: 6,
                    cursor: "pointer",
                    // Selected is the person's accent on the raised background; the other two
                    // drop to muted on transparent. Reads as picked/not-picked at TV distance
                    // without a second row of state text.
                    background: isSelected ? "var(--bg-highlight)" : "transparent",
                    color: isSelected ? person.accent : "var(--text-muted)",
                    border: `1px solid ${isSelected ? person.accent : "var(--border)"}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isSelected ? "●" : "○"} {person.label}
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

      {/* ONE section, not a map over three. The board renders the selected person and no
          one else — the unselected two are not hidden, collapsed or zero-height, they are
          not in the tree at all, so there is no arrangement of state that puts two people
          on screen. The picker that swaps them is in the header row, so nothing has to be
          left behind on the page to click, and a person costs the timetable zero pixels
          until they are the one chosen. `key` remounts the subtree on every swap, which is
          what keeps Ansar's WeekProgressStrip from carrying state across a person change. */}
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
        {/* Layer switches, scoped to the person on screen. Only rendered when there is
            more than one layer to combine — Ansar owns Homeschool alone, and a lone switch
            whose only two states are "your board" and "nothing" is a trap, not a control.
            So his page stays exactly as it is.

            Checkboxes, not radios: the whole point is combinations — Home + Personal, or
            Ecom + Ayah, or Personal by itself. Unlike the person picker above, this row is
            allowed to reach zero; see the empty state below for why that is not a dead end. */}
        {person.layers.length > 1 ? (
          <div
            role="group"
            aria-label={`Which of ${person.label}'s areas to show`}
            style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}
          >
            {person.layers.map((layer) => {
              const on = isLayerOn(layer.key);
              // Each switch wears the colour of the group it governs, so the row doubles as
              // the legend for the board below it: the green switch turns the green blocks
              // on and off. A switch in the person's accent would have made all four look
              // like the same control.
              const t = typeOf(null, layer.key, layer.label);
              const hue = t ? t.fg : person.accent;
              // The per-layer block count used to sit beside each layer's heading. The
              // headings are gone with the merge, so it moves here — still the only place
              // that says how much of the week each area accounts for.
              const count = blocks.filter(
                (b) => b.person === person.key && b.layer === layer.key,
              ).length;
              return (
                <button
                  key={layer.key}
                  type="button"
                  onClick={() => toggleLayer(layer.key)}
                  aria-pressed={on}
                  title={`${on ? "Hide" : "Show"} ${person.label} · ${layer.label} — ${count} block${
                    count === 1 ? "" : "s"
                  }`}
                  style={{
                    // Smaller than the 44px person picker — these are the secondary control
                    // on the page — but still a real thumb target on the iPad.
                    minHeight: 36,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 800,
                    borderRadius: 999,
                    cursor: "pointer",
                    // Same on/off language as the person picker: lit in its own hue when on,
                    // muted on transparent when off.
                    background: on ? (t ? t.bg : "var(--bg-highlight)") : "transparent",
                    color: on ? hue : "var(--text-muted)",
                    border: `1px solid ${on ? hue : "var(--border)"}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {on ? "●" : "○"} {layer.label}{" "}
                  <span style={{ fontWeight: 700, opacity: 0.7 }}>{count}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={showAllLayers}
              disabled={allLayersOn}
              title={`Show all of ${person.label}'s areas`}
              style={{
                minHeight: 36,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 800,
                borderRadius: 999,
                // Disabled when everything is already on, so the button never claims there
                // is something left to restore when there isn't.
                cursor: allLayersOn ? "default" : "pointer",
                background: "transparent",
                color: allLayersOn ? "var(--text-muted)" : "var(--text-primary)",
                border: "1px dashed var(--border)",
                whiteSpace: "nowrap",
              }}
            >
              All
            </button>
          </div>
        ) : null}

        {/* PARITY: the ANSAR FC strip, reused as-is. It already imports the
            canonical scoreDay from app/lib/scoring.ts — no fourth copy. */}
        {person.key === "ansar" ? <WeekProgressStrip /> : null}

        {/* Switching every layer off is permitted — refusing the last click would mean the
            row silently stops responding — but it is never left looking like a broken or
            empty board. It says which state it is in and points at the way back. */}
        {shownLayers.length === 0 ? (
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
            All {person.layers.length} of {person.label}&rsquo;s areas are switched off. This is a
            view setting, not missing data — press All above, or any area, to bring them back.
          </div>
        ) : null}

        {/* Failure used to be reported by a badge beside each layer's heading. There are no
            layer headings left, so it is stated once here, naming the layers — otherwise
            merging the grids would have quietly deleted the only per-layer failure signal
            on the board. The banner at the top of the page still carries the full detail. */}
        {shownLayers.length > 0 && personErrors.length > 0 ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--red)" }}>
            Failed to load: {personErrors.map((e) => e.layer).join(", ")} — those blocks are
            missing from the week below.
          </div>
        ) : null}

        {/* The key to the colours, only where the switch row above is not already it. For
            Taylan and Nihal the switches ARE the legend — same words, same hues, and they
            list every area rather than only the ones with blocks in them. Ansar has no
            switch row (one layer), and his colours come from categories the switches would
            not name anyway, so his legend is drawn here. Built from the blocks on screen,
            so it can never name a colour that is not in the grid. */}
        {shownLayers.length > 0 && person.layers.length === 1 && legend.length > 1 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {legend.map((t) => (
              <span
                key={t.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: t.fg,
                  background: t.bg,
                  border: `1px solid ${t.fg}`,
                  whiteSpace: "nowrap",
                }}
              >
                {/* The swatch repeats the hue as a solid shape. The chip's own text is the
                    same colour, but an 8px block of pure hue is what makes two similar
                    colours separable at a glance. */}
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: 2, background: t.fg, flexShrink: 0 }}
                />
                {t.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* One week. Not one per layer. */}
        {shownLayers.length > 0 ? (
          <WeekGrid blocks={shownBlocks} typeFor={typeForBlock} />
        ) : null}
      </section>
    </div>
  );
}
