import { NextResponse } from "next/server";
import {
  HOUSEHOLD_TZ,
  zoneToday,
  addDays,
  isoDate,
  daysBetween,
  parseCivilDate,
  type CivilDate,
} from "../../lib/time";
import { fetchSource, type NotionPage, type NotionProp } from "../../lib/notion";
import { launchpad } from "../../lib/launchpad";

/* ════════════════════════════════════════════════════════════════════════════
   /api/table — read side of the /table drill-down. RESTRUCTURE-SPEC §4.

   Three sources:
     · Daily Discussion Points 4431302a… — every decision on the table.
     · Mission Goals 22f0eed5… — Band = Monthly, for the milestone line.
     · Launchpad — the running-test summary the Start-here headline needs.

   force-dynamic + no-store: a decision closed through /api/table/close must be
   gone from the table on the very next fetch, so nothing here may be cached.

   Live schema of the Daily Discussion Points source (read back 2026-08-25):
   Point:title · Owner:select · Pillar:select · Type:select · Raised:date ·
   Status:select · Outcome:rich_text. There is NO closed-date property and NO
   "Closed when" property — the close write embeds the date in Outcome, and this
   route parses it back out; closedWhen is read tolerantly and stays null until
   such a property exists in Notion.
   ══════════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const DAILY_POINTS_ID = "4431302a-75ed-479f-a5f4-3bfd5e0a4e68";
const MISSION_GOALS_ID = "22f0eed5-7556-4758-b171-328d273485f3";

const RUNNING_STATUSES = new Set(["Live", "Iterating"]);
const TRADING_STATUSES = new Set(["Live", "Iterating", "Killed", "Scaled"]);

/** Matches the date the close write appends: "… — closed 2026-08-25". */
const CLOSED_STAMP_RE = /closed\s+(\d{4}-\d{2}-\d{2})/i;

/* ── payload ─────────────────────────────────────────────────────────────── */

export interface TableDecision {
  id: string;
  title: string;
  owner: string;
  pillar: string;
  raisedIso: string | null;
  ageDays: number | null;
  /** "Closed when:" text — null until the Notion source grows the property. */
  closedWhen: string | null;
  outcome: string;
}

export interface ClosedDecision {
  id: string;
  title: string;
  closedIso: string | null;
}

export interface TableTest {
  /** True when a Live/Iterating test exists AND has been fed at all. */
  running: boolean;
  name: string | null;
  status: string | null;
  spend: number | null;
  windowLow: number | null;
  windowHigh: number | null;
  /** Days since the newest entry across every trading test, or null if none. */
  lastEntryDaysAgo: number | null;
  /** Days since the RUNNING test's newest entry, or null. */
  staleDays: number | null;
}

export interface TablePayload {
  generatedAt: string;
  today: string;
  open: TableDecision[];
  closedSinceYesterday: ClosedDecision[];
  milestone: string | null;
  test: TableTest | null;
  errors: string[];
}

/* ── Notion property readers (mirrors /api/mission's tolerant readers) ───── */

function propOf(page: NotionPage, ...names: string[]): NotionProp {
  const props = page.properties;
  if (!props) return undefined;
  for (const name of names) {
    if (props[name] !== undefined) return props[name];
  }
  return undefined;
}

function textOf(prop: NotionProp): string {
  if (prop === undefined || prop === null) return "";
  if (typeof prop === "string") return prop.trim();
  const p = prop as {
    title?: { plain_text?: string }[];
    rich_text?: { plain_text?: string }[];
    select?: { name?: string } | null;
    status?: { name?: string } | null;
    number?: number | null;
  };
  if (Array.isArray(p.title)) return p.title.map((t) => t.plain_text ?? "").join("").trim();
  if (Array.isArray(p.rich_text)) {
    return p.rich_text.map((t) => t.plain_text ?? "").join("").trim();
  }
  if (p.status && typeof p.status.name === "string") return p.status.name.trim();
  if (p.select && typeof p.select.name === "string") return p.select.name.trim();
  if (typeof p.number === "number") return String(p.number);
  return "";
}

function numberOf(prop: NotionProp): number | null {
  if (prop === undefined || prop === null) return null;
  const p = prop as { number?: number | null };
  return typeof p.number === "number" ? p.number : null;
}

function boolOf(prop: NotionProp): boolean {
  if (prop === undefined || prop === null) return false;
  const p = prop as { checkbox?: boolean };
  return p.checkbox === true;
}

function dateIsoOf(prop: NotionProp): string | null {
  if (prop === undefined || prop === null) return null;
  const p = prop as { date?: { start?: string | null } | null };
  const start = p.date?.start ?? null;
  return typeof start === "string" && start ? start.slice(0, 10) : null;
}

/** A UTC instant → the calendar date it falls on in Sydney. */
function instantToSydneyIso(instant: string | undefined): string | null {
  if (!instant) return null;
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return isoDate(zoneToday(d, HOUSEHOLD_TZ));
}

/* ── Launchpad summary ───────────────────────────────────────────────────── */

interface LpTest {
  id: string;
  name: string;
  status: string;
  entry_window_low: number | null;
  entry_window_high: number | null;
  created_at: string;
}
interface LpEntry {
  entry_date: string;
  meta_spend: number | null;
}

async function buildTest(today: CivilDate): Promise<TableTest> {
  const tests = await launchpad<LpTest[]>("/tests", 0);
  const trading = tests.filter((t) => TRADING_STATUSES.has(t.status));

  const loaded = await Promise.all(
    trading.map(async (t) => ({
      test: t,
      entries: await launchpad<LpEntry[]>(`/entries?test_id=${encodeURIComponent(t.id)}`, 0),
    })),
  );

  // Newest entry anywhere, for "Last entry was N days ago" when nothing runs.
  let newestIso: string | null = null;
  for (const { entries } of loaded) {
    for (const e of entries) {
      if (typeof e.entry_date !== "string" || !e.entry_date) continue;
      if (newestIso === null || e.entry_date > newestIso) newestIso = e.entry_date;
    }
  }
  const newestCivil = parseCivilDate(newestIso);
  const lastEntryDaysAgo = newestCivil ? daysBetween(newestCivil, today) : null;

  const running = loaded
    .filter((x) => RUNNING_STATUSES.has(x.test.status))
    .sort((a, b) => b.test.created_at.localeCompare(a.test.created_at))[0];

  if (!running) {
    return {
      running: false,
      name: null,
      status: null,
      spend: null,
      windowLow: null,
      windowHigh: null,
      lastEntryDaysAgo,
      staleDays: null,
    };
  }

  const spend = running.entries.reduce((s, e) => s + (e.meta_spend ?? 0), 0);
  let last: string | null = null;
  for (const e of running.entries) {
    if (
      typeof e.entry_date === "string" &&
      e.entry_date &&
      (last === null || e.entry_date > last)
    ) {
      last = e.entry_date;
    }
  }
  const lastCivil = parseCivilDate(last);
  const staleDays = lastCivil ? daysBetween(lastCivil, today) : null;

  return {
    running: true,
    name: running.test.name,
    status: running.test.status,
    spend: Math.round(spend * 100) / 100,
    windowLow: running.test.entry_window_low,
    windowHigh: running.test.entry_window_high,
    lastEntryDaysAgo,
    staleDays,
  };
}

/* ── handler ─────────────────────────────────────────────────────────────── */

export async function GET() {
  const today = zoneToday(new Date(), HOUSEHOLD_TZ);
  const todayIso = isoDate(today);
  const yesterdayIso = isoDate(addDays(today, -1));

  const errors: string[] = [];

  const [pointsRes, goalsRes, testRes] = await Promise.allSettled([
    fetchSource(DAILY_POINTS_ID, "Daily Discussion Points"),
    fetchSource(MISSION_GOALS_ID, "Mission Goals"),
    buildTest(today),
  ]);

  /* ---- decisions --------------------------------------------------------- */
  const open: TableDecision[] = [];
  const closedSinceYesterday: ClosedDecision[] = [];

  if (pointsRes.status === "fulfilled") {
    for (const row of pointsRes.value) {
      const status = textOf(propOf(row, "Status")).toLowerCase();
      const title = textOf(propOf(row, "Point", "Name", "Title")) || "(untitled)";
      const outcome = textOf(propOf(row, "Outcome"));

      if (status === "open") {
        const raisedIso = dateIsoOf(propOf(row, "Raised"));
        const raised = parseCivilDate(raisedIso);
        open.push({
          id: row.id ?? "",
          title,
          owner: textOf(propOf(row, "Owner")),
          pillar: textOf(propOf(row, "Pillar")),
          raisedIso,
          ageDays: raised ? daysBetween(raised, today) : null,
          closedWhen:
            textOf(propOf(row, "Closed when", "Closed When", "Closed when:")) || null,
          outcome,
        });
      } else if (status === "closed") {
        // The close write stamps the date into Outcome; older rows fall back to
        // the page's last edit, resolved to a Sydney calendar date.
        const stamped = outcome.match(CLOSED_STAMP_RE)?.[1] ?? null;
        const edited = (row as { last_edited_time?: string }).last_edited_time;
        const closedIso = stamped ?? instantToSydneyIso(edited);
        if (closedIso !== null && closedIso >= yesterdayIso) {
          closedSinceYesterday.push({ id: row.id ?? "", title, closedIso });
        }
      }
    }

    // Oldest first; undated rows sink to the bottom.
    open.sort((a, b) => {
      if (a.raisedIso === b.raisedIso) return 0;
      if (a.raisedIso === null) return 1;
      if (b.raisedIso === null) return -1;
      return a.raisedIso < b.raisedIso ? -1 : 1;
    });
  } else {
    errors.push(`Daily Discussion Points — ${String(pointsRes.reason)}`);
  }

  /* ---- milestone --------------------------------------------------------- */
  let milestone: string | null = null;
  if (goalsRes.status === "fulfilled") {
    const monthly = goalsRes.value
      .filter((row) => boolOf(propOf(row, "Active")))
      .filter((row) => textOf(propOf(row, "Band")).trim().toLowerCase() === "monthly")
      .map((row) => ({
        goal: textOf(propOf(row, "Goal", "Name", "Title")) || "(untitled)",
        sort: numberOf(propOf(row, "Sort")) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.sort - b.sort);
    milestone = monthly[0]?.goal ?? null;
  } else {
    errors.push(`Mission Goals — ${String(goalsRes.reason)}`);
  }

  /* ---- test -------------------------------------------------------------- */
  let test: TableTest | null = null;
  if (testRes.status === "fulfilled") {
    test = testRes.value;
  } else {
    errors.push(`Launchpad — ${String(testRes.reason)}`);
  }

  const payload: TablePayload = {
    generatedAt: new Date().toISOString(),
    today: todayIso,
    open,
    closedSinceYesterday,
    milestone,
    test,
    errors,
  };

  return NextResponse.json(payload, {
    status: errors.length === 3 ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
