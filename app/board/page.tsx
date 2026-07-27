"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import WeekProgressStrip from "../components/WeekProgressStrip";
import type { Block, BoardPayload } from "../api/board/route";

/* ────────────────────────────────────────────────────────────────────────────
   /board — the whole family's week, one payload, eight Notion layers.

   Replaces /week. Shape and ownership come from BOARD-SPEC.md; this file renders
   that payload and decides nothing about which layer belongs to whom.

   `import type` above is erased at compile time — it carries the Block shape
   from the route so the two cannot drift, and pulls no server code (and no
   NOTION_TOKEN) into the client bundle. Verified by grepping the built output.

   LAYOUT CONTRACT: the page never scrolls. It is exactly one viewport tall and
   every visible block is on screen at once. That is enforced in three places and
   all three are load-bearing:

     1. The root is `height: calc(100dvh - nav)` with `overflow: hidden`.
     2. The timetable is ONE grid — seven day columns, one row per layer — instead
        of eight separate seven-column grids stacked down the page. Rows are `fr`
        weighted by that layer's busiest day, so Ansar's twelve-block Monday gets
        roughly three times the height of Taylan's four-block one.
     3. `fitToBox` binary-searches the grid's font size until no cell's content
        exceeds its track. Everything inside a cell is sized in `em`, so one
        number scales the whole timetable.

   Anything added to this page must be `flexShrink: 0` and must be worth the rows
   it takes from the timetable, or it belongs in a cell.
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

// The eight layer rows of the timetable, flattened once at module scope in spec
// order. Every row still names its owner, so STRUCTURE's "a layer may only appear
// under its owner" holds exactly as it did when each person had their own section.
const ROWS = PEOPLE.flatMap((person) => person.layers.map((layer) => ({ person, layer })));

// Font-size search bounds for the fit pass, in px. The floor is the point past
// which a block title stops being readable across a room; below it the page shows
// a "+N" count rather than shrinking further, because silently unreadable is the
// same as silently missing.
const FIT_MIN = 6;
const FIT_MAX = 15;

// `useLayoutEffect` warns when React renders on the server. Picking the hook once
// at module scope keeps the call order identical on both sides while still
// measuring before paint in the browser, so the timetable never flashes unscaled.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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

const cellKey = (person: string, layer: string, day: DayKey) => `${person}|${layer}|${day}`;

/**
 * Does every day cell's content sit inside its grid track?
 *
 * Day cells only. The left rail is deliberately excluded: its labels are fixed px
 * so they stay readable at whatever size the timetable settles on, which also means
 * shrinking the font can never make a too-tall rail fit. Including it made the
 * search unsatisfiable and pinned the whole board at FIT_MIN — measured at 6px with
 * every cell fitting comfortably, dragged there by Ayah's 22px rail in a 15px row.
 */
function everythingFits(root: HTMLElement): boolean {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>("[data-key]"));
  return boxes.every((b) => b.scrollHeight <= b.clientHeight + 1);
}

/**
 * Largest font size in [FIT_MIN, FIT_MAX] at which nothing overflows.
 *
 * Nine bisection steps land within ~0.02px of the true boundary, which is far
 * finer than the eye or the layout can tell apart. Each step forces a synchronous
 * reflow — that is the cost of measuring rather than guessing, and it is paid on
 * data change and window resize only, not per frame.
 */
function fitToBox(root: HTMLElement): void {
  let lo = FIT_MIN;
  let hi = FIT_MAX;
  let best = FIT_MIN;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    root.style.fontSize = `${mid}px`;
    if (everythingFits(root)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  root.style.fontSize = `${best}px`;
}

/**
 * One block, as a single line: emoji, time, title.
 *
 * Everything that used to sit on its own line inside a card — category, notes,
 * detail, the one-off date — moves to the hover title. On a wall-mounted board the
 * question is "what is on, and when"; the rest is available on the iPad by touch
 * and in Notion behind the link, and none of it is worth a row of the timetable.
 */
function BlockChip({ block, accent }: { block: Block; accent: string }) {
  const time = [block.start, block.end].filter(Boolean).join("–");
  const tip = [
    block.title,
    time || "no time given",
    block.category,
    block.date ? `one-off · ${block.date}` : null,
    block.notes,
    block.detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-chip
      title={tip}
      style={{
        // `flexShrink: 0` is what makes the fit pass mean anything: a chip that
        // could compress would silently squash instead of reporting that it does
        // not fit, and the search would settle on an unreadable size.
        flexShrink: 0,
        display: "flex",
        alignItems: "baseline",
        gap: "0.3em",
        background: "var(--bg-highlight)",
        borderLeft: `0.25em solid ${accent}`,
        borderRadius: "0.25em",
        padding: "0.15em 0.4em",
        lineHeight: 1.25,
        overflow: "hidden",
      }}
    >
      {block.emoji ? (
        <span aria-hidden style={{ fontSize: "0.95em", flexShrink: 0 }}>
          {block.emoji}
        </span>
      ) : null}
      <span
        style={{
          fontSize: "0.88em",
          fontWeight: 700,
          color: block.startMin === null ? "var(--text-muted)" : "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {/* An untimed block sorts last rather than to midnight, and says so here
            rather than just sitting at the bottom of the column unexplained. */}
        {time || "untimed"}
      </span>
      <span
        style={{
          fontSize: "1em",
          fontWeight: 700,
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {block.title}
      </span>
    </div>
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
  // How many chips the fit pass could not get on screen, per cell. Populated only
  // when the search bottoms out at FIT_MIN — normally empty.
  const [clipped, setClipped] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement>(null);

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

  const errors = useMemo(() => payload?.errors ?? [], [payload]);
  const blocks = useMemo(() => payload?.blocks ?? [], [payload]);

  // Every block filed under exactly one (person, layer, day) cell, sorted once.
  // Anything that cannot be placed on a day is kept aside and named on screen —
  // the reader emits no such block today, and dropping one silently is exactly the
  // failure mode /board exists to end.
  const { cells, unplaced } = useMemo(() => {
    const map = new Map<string, Block[]>();
    const orphans: Block[] = [];
    for (const b of blocks) {
      const day = columnOf(b);
      if (!day) {
        orphans.push(b);
        continue;
      }
      const k = cellKey(b.person, b.layer, day);
      const list = map.get(k);
      if (list) list.push(b);
      else map.set(k, [b]);
    }
    for (const list of map.values()) list.sort(byStart);
    return { cells: map, unplaced: orphans };
  }, [blocks]);

  const visibleRows = ROWS.filter((r) => open[r.person.key] ?? true);

  // A row is as tall as its busiest day, relative to the other rows. An empty layer
  // still gets a weight of 1: Ayah is empty today and must stay visible under Nihal,
  // because a layer that disappears when it empties is indistinguishable from one
  // that was never wired up.
  const rowWeights = visibleRows.map(({ person, layer }) =>
    Math.max(
      1,
      ...DAYS.map((d) => (cells.get(cellKey(person.key, layer.key, d)) ?? []).length),
    ),
  );

  // Re-fit whenever the content, the open set, or the viewport changes. Nothing
  // here runs per frame: the observer fires on resize, and the deps cover the rest.
  useIsoLayoutEffect(() => {
    const root = gridRef.current;
    if (!root) return;

    const measure = () => {
      // Measuring an unsettled layout is worse than not measuring: with tracks still
      // at zero height nothing can fit, the search bottoms out at FIT_MIN, and the
      // board latches there. Observed exactly that — 6px with every cell fitting
      // comfortably, while re-running the same search against the settled layout
      // returned 7.99px. Bail and wait for the callbacks below instead.
      if (root.clientHeight < 40) return;
      fitToBox(root);
      // What is still clipped once the search has bottomed out. Counted by comparing
      // each chip's offset against its cell, and reported as a "+N" badge that is
      // absolutely positioned — it must not itself add height, or measuring it would
      // change the thing being measured.
      const next: Record<string, number> = {};
      for (const cell of Array.from(root.querySelectorAll<HTMLElement>("[data-key]"))) {
        const key = cell.dataset.key as string;
        const limit = cell.clientHeight + 1;
        const hidden = Array.from(cell.querySelectorAll<HTMLElement>("[data-chip]")).filter(
          (chip) => chip.offsetTop + chip.offsetHeight > limit,
        ).length;
        if (hidden > 0) next[key] = hidden;
      }
      setClipped((prev) => {
        const sameSize = Object.keys(prev).length === Object.keys(next).length;
        if (sameSize && Object.keys(next).every((k) => prev[k] === next[k])) return prev;
        return next;
      });
    };

    measure();
    // Again after paint. The ANSAR FC strip below the grid loads its own data and
    // settles late; when it does, the grid loses ~150px and the size chosen before
    // it arrived is wrong. The observer covers that too, but the frame callback
    // makes the first correct fit happen immediately rather than on the next resize.
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [cells, visibleRows.length, loading, errors.length, loadError]);

  return (
    // `html, body` are `height: 100%; overflow: hidden` in globals.css — that rule is
    // what pins the TV dashboard at `/` to exactly one viewport, and this page now
    // holds itself to the same standard rather than working around it. The root is
    // exactly the space under the nav and clips: nothing on this page scrolls, so
    // anything that does not fit is a layout bug to be fixed here, not something the
    // reader is expected to go looking for.
    <div
      style={{
        marginTop: "var(--nav-h)",
        height: "calc(100dvh - var(--nav-h))",
        overflow: "hidden",
        background: "var(--bg-base)",
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="header" style={{ flexShrink: 0 }}>
        <div className="header-brand">
          <div className="header-name">
            Family <span>Board</span>
          </div>
          <div className="header-sub">Taylan · Nihal · Ansar — the whole week</div>
        </div>
        <div className="header-right">
          {/* The person toggles live HERE, in the header row that already exists, rather
              than as three 52px section headers stacked down the page. Open or closed they
              cost the timetable zero vertical space: the row is sized by the Refresh button
              beside them, which is no shorter. A closed person's rows leave the grid
              entirely, and the rows that remain grow into the space. */}
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
                    // 44px minimum so a hidden person is recoverable by thumb on the iPad,
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
          {/* An empty board and a still-loading one are pixel-identical now that the
              rows render before their blocks arrive — eight rails reading "0 blocks"
              over empty cells. The old full-width "Loading the board…" card said which
              it was but cost a row; this says the same thing in the slot the timestamp
              already occupies, so it costs the timetable nothing. */}
          {loading ? (
            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 700 }}>
              Loading…
            </span>
          ) : lastLoaded ? (
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

      {/* Never fail silently: any failed layer is named, in view, above the board. These
          banners are `flexShrink: 0` and appear only when something is wrong — on a
          healthy board they cost the timetable nothing. */}
      {errors.length > 0 ? (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "6px 12px",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--red)" }}>
            {errors.length} of 8 layers failed to load — those rows are shown empty below.
            Empty here does not mean empty in Notion.
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {errors.map((e) => `${e.person} · ${e.layer} — ${e.error}`).join("  |  ")}
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
            padding: "6px 12px",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--red)",
          }}
        >
          {loadError}
        </div>
      ) : null}

      {unplaced.length > 0 ? (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            fontSize: 13,
            fontWeight: 700,
            color: "var(--red)",
            padding: "0 2px",
          }}
        >
          {unplaced.length} block{unplaced.length === 1 ? "" : "s"} could not be placed on a
          day and {unplaced.length === 1 ? "is" : "are"} not on the board:{" "}
          {unplaced.map((b) => b.title).join(", ")}
        </div>
      ) : null}

      {/* The timetable. One grid, seven day columns, one row per visible layer. It takes
          every pixel the header and any banners do not. */}
      <div
        ref={gridRef}
        style={{
          flex: "1 1 0",
          minHeight: 0,
          display: "grid",
          // The rail is fixed px, not em: it carries the layer and owner labels, which
          // must stay readable at whatever size the fit pass settles on.
          gridTemplateColumns: "94px repeat(7, minmax(0, 1fr))",
          // `minmax(0, Nfr)` and not `Nfr` — a bare fr track has an automatic minimum
          // and would grow past the container to fit its content, which is precisely
          // the overflow this page is here to prevent.
          gridTemplateRows: `auto ${rowWeights.map((w) => `minmax(0, ${w}fr)`).join(" ")}`,
          columnGap: 4,
          rowGap: 4,
          fontSize: FIT_MAX,
        }}
      >
        <div />
        {DAYS.map((d) => (
          <div
            key={`h-${d}`}
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-label)",
              textAlign: "center",
            }}
          >
            {d}
          </div>
        ))}

        {visibleRows.map(({ person, layer }) => {
          const failed = errors.find((e) => e.person === person.key && e.layer === layer.key);
          const total = DAYS.reduce(
            (n, d) => n + (cells.get(cellKey(person.key, layer.key, d)) ?? []).length,
            0,
          );
          return (
            <div key={`${person.key}-${layer.key}`} style={{ display: "contents" }}>
              {/* The rail replaces what used to be a full-width person header bar and a
                  full-width layer heading — two rows of the page, now zero.

                  Its lines are in fixed px and in priority order, because a short row
                  clips the bottom of this box: layer, owner, failure, then the block
                  count. The count is the only line that can be lost, and it is the only
                  one that is a nicety. */}
              <div
                style={{
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  // `flex-start`, not `center`. Centering clips a short row at BOTH ends,
                  // which took the layer name off the top of Nihal's single-height Ayah
                  // row and left it reading "Nihal / 0 blocks" with no layer at all.
                  // Anchoring to the top makes the clip bottom-only, which is what the
                  // priority order of these lines assumes.
                  justifyContent: "flex-start",
                  paddingRight: 6,
                  borderRight: `2px solid ${person.accent}`,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: person.accent,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {layer.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-secondary)",
                    lineHeight: 1.3,
                  }}
                >
                  {person.label}
                </div>
                {failed ? (
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--red)" }}>
                    failed to load
                  </div>
                ) : null}
                <div
                  title="An empty layer and a failed one look the same here — a failure is named in the banner at the top of the page."
                  style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}
                >
                  {total} block{total === 1 ? "" : "s"}
                </div>
              </div>

              {DAYS.map((d) => {
                const key = cellKey(person.key, layer.key, d);
                const list = cells.get(key) ?? [];
                const hidden = clipped[key] ?? 0;
                return (
                  <div
                    key={key}
                    data-fit
                    data-key={key}
                    style={{
                      position: "relative",
                      overflow: "hidden",
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.2em",
                      background: "var(--bg-card)",
                      borderRadius: 4,
                      padding: list.length === 0 ? 0 : "0.2em",
                    }}
                  >
                    {list.map((b, i) => (
                      <BlockChip key={`${b.title}-${b.start}-${i}`} block={b} accent={person.accent} />
                    ))}
                    {hidden > 0 ? (
                      // Absolutely positioned so it adds no height. If this ever shows,
                      // the board is denser than one viewport can hold at a readable
                      // size — which is worth saying out loud rather than hiding.
                      <span
                        title={`${hidden} more block${hidden === 1 ? "" : "s"} in this cell than fit on screen`}
                        style={{
                          position: "absolute",
                          right: 2,
                          bottom: 1,
                          fontSize: 10,
                          fontWeight: 800,
                          color: "var(--red)",
                          background: "var(--bg-base)",
                          borderRadius: 3,
                          padding: "0 3px",
                        }}
                      >
                        +{hidden}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}

        {visibleRows.length === 0 ? (
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            Everyone is hidden. Use the toggles above to bring a person back.
          </div>
        ) : null}
      </div>

      {/* PARITY: the ANSAR FC strip, reused as-is. It already imports the canonical
          scoreDay from app/lib/scoring.ts — no fourth copy. It is pinned below the
          timetable rather than inside it, and leaves with Ansar when he is hidden. */}
      {open.ansar ? (
        <div style={{ flexShrink: 0 }}>
          <WeekProgressStrip compact />
        </div>
      ) : null}
    </div>
  );
}
