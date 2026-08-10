"use client";

import { useCallback, useEffect, useState } from "react";
import type { MissionPayload, DailyPoint, QueuedValidation } from "../api/mission/route";

/* ────────────────────────────────────────────────────────────────────────────
   /mission — read-only. Four bands, in descending order of urgency:
   DAILY → WEEKLY → MONTHLY → LONG TERM.

   The order is the feature. Type size falls band by band so the thing that has
   to happen today is the thing you read first from across the room, and the
   long-term line is present without competing for attention. Nothing on this
   page writes: no inputs, no buttons that mutate, no POST.

   `import type` above is erased at compile time — it carries the payload shape
   from the route so the two cannot drift, and pulls no server code (and no
   NOTION_TOKEN) into the client bundle. Same posture as app/board/page.tsx.

   Every colour is an existing globals.css token. No token is added here, and
   #00d9ff is not the dashboard cyan — `--cyan` is #00d4ff.
   ──────────────────────────────────────────────────────────────────────────── */

// Where an empty daily column sends you to set the day's points.
const NOTION_DAILY = "https://app.notion.com/p/3805429afa9080039d26c02e7e06bc38";
// Parent page for every counted weekly goal.
const NOTION_WEEKLY = "https://app.notion.com/p/f27260c1c1884727ae9bbdc0518e18cf";

const MONTHLY =
  "By 10 September 2026 — a product test and validation in motion, and profitability in motion.";
const LONG_TERM =
  "Ecom profit covers continuous reinvestment and all monthly household expenses.";

/* ── weekly goals ────────────────────────────────────────────────────────────
   Fixed, hardcoded, identical every week — they are the standing definition of
   the week, not data. Only `count` moves, and only on the rows that have a real
   number behind them.

   `kind` is what stops this page from lying. A "text" row shows its target as
   plain words with no number and no bar, because no count exists for it. The
   alternative — rendering "0 / 5" for mentorship calls watched — would invent a
   measurement the system cannot make, and a zero meaning "not tracked" is
   indistinguishable on a wall from a zero meaning "did nothing".
   ──────────────────────────────────────────────────────────────────────────── */

type WeeklyRow =
  | { kind: "counted"; label: string; target: string; targetMax: number }
  | { kind: "queue"; label: string }
  | { kind: "text"; label: string; target?: string };

const NIHAL_ROWS: WeeklyRow[] = [
  { kind: "counted", label: "Product tests logged", target: "2", targetMax: 2 },
  { kind: "counted", label: "Validations logged", target: "1-3", targetMax: 3 },
  { kind: "text", label: "Mentorship videos or calls", target: "2/day" },
  { kind: "text", label: "Live mentor call", target: "1" },
];

const TAYLAN_ROWS: WeeklyRow[] = [
  { kind: "text", label: "Mentorship calls watched", target: "5" },
  { kind: "queue", label: "Validate Nihal's rows" },
  { kind: "text", label: "Accountability / tech / systems / marketing" },
];

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** "Mon 10 Aug 2026" — the weekStart line has to be legible, not an ISO string. */
function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  // Anchored in UTC and formatted in UTC: the string is already a civil date, so
  // it must not be re-read through any zone on the way to being displayed.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Age chip text. A null age renders nothing rather than a misleading "0d". */
function ageLabel(days: number | null): string | null {
  if (days === null) return null;
  return `${days}d`;
}

/* ── bands ───────────────────────────────────────────────────────────────── */

function DailyColumn({
  name,
  accent,
  points,
}: {
  name: string;
  accent: string;
  points: DailyPoint[];
}) {
  return (
    <div className="mn-col" style={{ ["--col-accent" as string]: accent }}>
      <h3 className="mn-col-name">{name}</h3>
      {points.length === 0 ? (
        <div className="mn-empty">
          <span className="mn-empty-text">Nothing set</span>
          <a className="mn-empty-link" href={NOTION_DAILY} target="_blank" rel="noopener noreferrer">
            Set today&rsquo;s points →
          </a>
        </div>
      ) : (
        <ul className="mn-points">
          {points.map((p, i) => {
            const age = ageLabel(p.ageDays);
            return (
              <li className="mn-point" key={`${p.point}-${p.raisedIso ?? "na"}-${i}`}>
                <span className="mn-point-text">{p.point}</span>
                <span className="mn-point-meta">
                  {p.pillar ? <span className="mn-pillar">{p.pillar}</span> : null}
                  {age ? <span className="mn-age">{age}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function QueueRow({ queue }: { queue: QueuedValidation[] }) {
  return (
    <li className="mn-row">
      <div className="mn-row-head">
        <a
          className="mn-row-label mn-row-link"
          href={NOTION_WEEKLY}
          target="_blank"
          rel="noopener noreferrer"
        >
          Validate Nihal&rsquo;s rows
        </a>
        <span className={queue.length === 0 ? "mn-clear" : "mn-count"}>
          {queue.length === 0 ? "Queue clear." : `${queue.length} outstanding`}
        </span>
      </div>
      {queue.length > 0 ? (
        <ul className="mn-queue">
          {queue.map((q, i) => (
            <li className="mn-queue-item" key={`${q.name}-${q.createdIso}-${i}`}>
              <span className="mn-queue-name">{q.name}</span>
              <span className="mn-age">{q.ageDays}d</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function WeeklyList({
  rows,
  counts,
  queue,
}: {
  rows: WeeklyRow[];
  counts: Record<string, number>;
  queue: QueuedValidation[];
}) {
  return (
    <ul className="mn-rows">
      {rows.map((row) => {
        if (row.kind === "queue") return <QueueRow key={row.label} queue={queue} />;

        if (row.kind === "text") {
          return (
            <li className="mn-row" key={row.label}>
              <div className="mn-row-head">
                <span className="mn-row-label">{row.label}</span>
                {row.target ? <span className="mn-target">{row.target}</span> : null}
              </div>
            </li>
          );
        }

        const count = counts[row.label] ?? 0;
        const pct = Math.min(100, Math.round((count / row.targetMax) * 100));
        const met = count >= row.targetMax;
        return (
          <li className="mn-row" key={row.label}>
            <div className="mn-row-head">
              <a
                className="mn-row-label mn-row-link"
                href={NOTION_WEEKLY}
                target="_blank"
                rel="noopener noreferrer"
              >
                {row.label}
              </a>
              <span className="mn-count">
                <strong style={{ color: met ? "var(--green)" : "var(--text-primary)" }}>
                  {count}
                </strong>
                <span className="mn-slash"> / {row.target}</span>
              </span>
            </div>
            <div className="mn-track">
              <div
                className="mn-fill"
                style={{ width: `${pct}%`, background: met ? "var(--green)" : "var(--cyan)" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function MissionPage() {
  const [payload, setPayload] = useState<MissionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // The route is already no-store; this says the same thing on the browser
      // side so a bfcache restore cannot put yesterday's points back on the wall.
      const res = await fetch("/api/mission", { cache: "no-store" });
      // A 503 still carries a body naming both failed sources, so parse before
      // deciding — the banner is more useful than a bare status code.
      const data: MissionPayload = await res.json();
      setPayload(data);
      setLoadError(
        res.ok
          ? null
          : `/api/mission returned HTTP ${res.status}. The page below may be incomplete.`,
      );
    } catch (e) {
      setPayload(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Five minutes. The daily band is the only thing that moves during a day and
    // it moves at human speed; polling harder would only spend Notion quota.
    const id = setInterval(load, 300_000);
    return () => clearInterval(id);
  }, [load]);

  const daily = payload?.daily ?? { T: [], N: [] };
  const weekly = payload?.weekly ?? {
    validationsThisWeek: 0,
    testsLoggedThisWeek: 0,
    validationQueue: [],
  };
  const errors = payload?.errors ?? [];

  const counts: Record<string, number> = {
    "Product tests logged": weekly.testsLoggedThisWeek,
    "Validations logged": weekly.validationsThisWeek,
  };

  return (
    <div className="mn-page">
      <style>{CSS}</style>
      <div className="mn-inner">

      {loadError ? <div className="mn-banner">{loadError}</div> : null}
      {errors.map((e) => (
        <div className="mn-banner" key={e.source}>
          {e.source} unavailable — {e.error}
        </div>
      ))}

      {/* ── BAND 1 · DAILY ─────────────────────────────────────────────── */}
      <section className="mn-band mn-band-daily">
        <div className="mn-band-head">
          <h2 className="mn-band-title">Daily</h2>
        </div>
        <div className="mn-cols">
          <DailyColumn name="Taylan" accent="var(--cyan)" points={daily.T} />
          <DailyColumn name="Nihal" accent="var(--amber)" points={daily.N} />
        </div>
      </section>

      {/* ── BAND 2 · WEEKLY ────────────────────────────────────────────── */}
      <section className="mn-band mn-band-weekly">
        <div className="mn-band-head">
          <h2 className="mn-band-title">Weekly</h2>
          {/* The counts are only meaningful with their window stated, so the
              window is on screen next to them rather than implied. */}
          <span className="mn-weekstart">
            {payload ? `Week of ${longDate(payload.weekStart)} — counts to date` : " "}
          </span>
        </div>
        <div className="mn-cols">
          <div className="mn-col" style={{ ["--col-accent" as string]: "var(--amber)" }}>
            <h3 className="mn-col-name">Nihal</h3>
            <WeeklyList rows={NIHAL_ROWS} counts={counts} queue={weekly.validationQueue} />
          </div>
          <div className="mn-col" style={{ ["--col-accent" as string]: "var(--cyan)" }}>
            <h3 className="mn-col-name">Taylan</h3>
            <WeeklyList rows={TAYLAN_ROWS} counts={counts} queue={weekly.validationQueue} />
          </div>
        </div>
      </section>

      {/* ── BAND 3 · MONTHLY ───────────────────────────────────────────── */}
      <section className="mn-band mn-band-monthly">
        <h2 className="mn-band-title">Monthly</h2>
        <p className="mn-static">{MONTHLY}</p>
      </section>

      {/* ── BAND 4 · LONG TERM ─────────────────────────────────────────── */}
      <section className="mn-band mn-band-long">
        <h2 className="mn-band-title">Long term</h2>
        <p className="mn-static">{LONG_TERM}</p>
      </section>

      {loading ? <div className="mn-loading">Loading…</div> : null}
      </div>
    </div>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────────
   Plain CSS in a <style> element, every class prefixed `mn-`. globals.css is
   not touched and no new token is defined — every colour below resolves to a
   variable that already exists in both the night and day themes, so this page
   follows the theme switch for free.

   Sizes are clamp()ed against the viewport rather than fixed: the same markup
   has to be readable across a room on the TV and in the hand on a phone, and
   the band hierarchy (daily > weekly > monthly > long term) has to survive both.
   ──────────────────────────────────────────────────────────────────────────── */

const CSS = `
/* Offset copied from app/origins/page.tsx:150-157 — the scrolling-surface
   pattern (height + overflow-y + padding-top), as opposed to the fixed-viewport
   marginTop pattern /board and /week use.

   TopNav (--nav-h) and OriginsStrip (--strip-h) are both position: fixed, so
   they occupy no flow space. Subtracting their heights from min-height, as this
   rule used to, shortens the page without ever moving its content out from
   under them. Measured before the fix: the DAILY label sat at y=31.5 while the
   strip's bottom edge was y=112 — the band that matters most was the one buried
   deepest. padding-top is the only thing that actually pushes content clear. */
.mn-page {
  height: 100vh;
  overflow-y: auto;
  padding-top: calc(var(--nav-h) + var(--strip-h));
  background: var(--bg-base);
  color: var(--text-primary);
  box-sizing: border-box;
}

/* The page's own padding lives here, not on .mn-page, so it composes with the
   fixed-chrome offset above instead of overwriting it. Same two-element shape
   /origins uses: outer scroll container carries the offset, inner wrapper
   carries the layout. */
.mn-inner {
  padding: clamp(12px, 1.6vw, 28px);
  display: flex;
  flex-direction: column;
  gap: clamp(10px, 1.2vw, 20px);
}

.mn-banner {
  background: var(--bg-card);
  border: 1px solid var(--red);
  border-radius: 8px;
  color: var(--red);
  padding: 10px 14px;
  font-size: clamp(12px, 0.9vw, 15px);
}

.mn-band {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--card-shadow);
  padding: clamp(12px, 1.4vw, 24px);
}

/* The band read every morning, given the weight its position implies. This is
   the same treatment the weekly cards carry one level down — card surface plus
   a 3px left accent rule — lifted to the band container so DAILY announces
   itself before you have read a word of it. Both values are existing tokens;
   nothing new is defined here. */
.mn-band-daily {
  border-left: 3px solid var(--cyan);
  background: var(--bg-card);
  padding: clamp(16px, 1.8vw, 30px);
}

/* Only the daily band's own label is promoted. The other three keep the quiet
   uniform label so the hierarchy reads top-down at a glance. */
.mn-band-daily .mn-band-title {
  color: var(--cyan);
  font-size: clamp(13px, 1vw, 17px);
}

.mn-band-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: clamp(8px, 1vw, 16px);
}

.mn-band-title {
  margin: 0;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-label);
  font-size: clamp(11px, 0.85vw, 14px);
}

.mn-weekstart {
  color: var(--text-muted);
  font-size: clamp(11px, 0.85vw, 14px);
  font-variant-numeric: tabular-nums;
}

.mn-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(10px, 1.4vw, 26px);
}

.mn-col {
  background: var(--bg-inner);
  border: 1px solid var(--border);
  border-left: 3px solid var(--col-accent);
  border-radius: 8px;
  padding: clamp(10px, 1.1vw, 18px);
  min-width: 0;
}

.mn-col-name {
  margin: 0 0 clamp(6px, 0.8vw, 12px);
  color: var(--col-accent);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: clamp(12px, 1vw, 16px);
}

.mn-points, .mn-rows, .mn-queue {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* BAND 1 — the largest type on the page. */
.mn-point {
  padding: clamp(7px, 0.7vw, 12px) 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mn-point:last-child { border-bottom: none; }

.mn-point-text {
  font-size: clamp(22px, 2.4vw, 40px);
  line-height: 1.25;
  font-weight: 400;
  color: var(--text-primary);
}

.mn-point-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.mn-pillar {
  font-size: clamp(11px, 0.85vw, 14px);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.mn-age {
  font-size: clamp(11px, 0.85vw, 14px);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}

.mn-empty { display: flex; flex-direction: column; gap: 6px; padding: clamp(8px, 1vw, 16px) 0; }
/* Same size as a real point: an empty daily column is still the daily band, and
   shrinking its only text would let WEEKLY out-rank it on the exact days
   nothing has been set — which are the days the prompt to set something needs
   to be loudest. */
.mn-empty-text { font-size: clamp(22px, 2.4vw, 40px); color: var(--text-muted); }
.mn-empty-link {
  font-size: clamp(12px, 0.9vw, 15px);
  color: var(--cyan);
  text-decoration: none;
}
.mn-empty-link:hover { text-decoration: underline; }

/* BAND 2 — second largest. */
.mn-row { padding: clamp(6px, 0.6vw, 11px) 0; border-bottom: 1px solid var(--border); }
.mn-row:last-child { border-bottom: none; }

.mn-row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.mn-row-label {
  font-size: clamp(16px, 1.5vw, 26px);
  line-height: 1.3;
  color: var(--text-primary);
}

.mn-row-link { text-decoration: none; }
.mn-row-link:hover { text-decoration: underline; }

/* Text-only rows: the target as plain words. No number, no bar — nothing here
   is a count, and it must not be able to look like one. */
.mn-target {
  font-size: clamp(12px, 0.95vw, 16px);
  color: var(--text-secondary);
  white-space: nowrap;
}

.mn-count {
  font-size: clamp(14px, 1.25vw, 21px);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mn-count strong { font-weight: 500; }
.mn-slash { color: var(--text-muted); }

.mn-clear {
  font-size: clamp(12px, 1vw, 17px);
  color: var(--green);
  white-space: nowrap;
}

.mn-track {
  margin-top: 6px;
  height: 4px;
  border-radius: 999px;
  background: var(--progress-track);
  overflow: hidden;
}
.mn-fill { height: 100%; border-radius: 999px; }

.mn-queue { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.mn-queue-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: clamp(12px, 1vw, 17px);
  color: var(--text-secondary);
}
.mn-queue-name { min-width: 0; overflow-wrap: anywhere; }

/* BANDS 3 & 4 — static, and deliberately quieter each step down.

   The four band sizes are strictly descending in ALL THREE clamp components —
   min 22>16>13>11, preferred 2.4>1.5>1.15>0.85vw, max 40>26>20>15. That is what
   makes DAILY > WEEKLY > MONTHLY > LONG TERM hold at every viewport width
   rather than only at the two that happen to get measured: if any one component
   crossed over, the order would invert somewhere in between. */
.mn-static { margin: 6px 0 0; color: var(--text-secondary); line-height: 1.45; }
.mn-band-monthly .mn-static { font-size: clamp(13px, 1.15vw, 20px); }
.mn-band-long .mn-static { font-size: clamp(11px, 0.85vw, 15px); color: var(--text-muted); }

.mn-loading {
  color: var(--text-muted);
  font-size: clamp(11px, 0.85vw, 14px);
  text-align: center;
}

/* Only the column collapse. The two font-size overrides that used to live here
   are gone on purpose: fixed px at this breakpoint sat below the clamp minimums
   and silently reopened the inversion on phones, which is the one place the
   bands are read stacked and the size ordering is the only cue left. */
@media (max-width: 768px) {
  .mn-cols { grid-template-columns: 1fr; }
}
`;
