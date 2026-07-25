import { NextResponse } from "next/server";
import { SETTING_DEFAULTS, getSetting, loadSettingsSafe } from "../../lib/settings";

// Cached for 5 minutes — action items change through the day. `revalidate` must
// be a static literal; CACHE_MINUTES drives the upstream fetches below.
export const dynamic = "force-static";
export const revalidate = 300;

/* ════════════════════════════════════════════════════════════════════════════
   Column C — actionables and time.

   Deliberately carries NO monetary field. Column C renders what must be done
   and how long is left; money lives in column B. TARGET_ANNUAL_REVENUE and
   TARGET_WEEKLY_REVENUE exist in settings and are tagged for this column, but
   are not read here and must not be: the column renders zero currency.
   ══════════════════════════════════════════════════════════════════════════ */

const ACTION_ITEMS_DS = "38e5429a-fa90-8035-8b09-000b2e78cdc3";
const NOTION_VERSION = "2025-09-03";
const LAUNCHPAD_API = "https://product-test-engine.netlify.app/api";

/** Only these statuses mean a product test actually finished. */
const COMPLETED_STATUSES = new Set(["Killed", "Scaled"]);
/** Statuses that mean a test is consuming budget right now. */
const RUNNING_STATUSES = new Set(["Live", "Iterating"]);

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, med: 1, low: 2 };

/* ────────────────────────────────────────────────────────────────────────────
   Notion shapes
   ──────────────────────────────────────────────────────────────────────── */

interface NotionRichText {
  plain_text: string;
}
interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  select?: { name: string } | null;
  date?: { start: string } | null;
  checkbox?: boolean;
}
interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

const plain = (p?: NotionProperty) =>
  (p?.title ?? p?.rich_text ?? []).map((x) => x.plain_text).join("").trim();
const sel = (p?: NotionProperty) => p?.select?.name?.trim() ?? null;
const dat = (p?: NotionProperty) => p?.date?.start?.slice(0, 10) ?? null;

/* ────────────────────────────────────────────────────────────────────────────
   Calendar helpers — every boundary resolved through Intl with TIMEZONE
   ──────────────────────────────────────────────────────────────────────── */

interface CivilDate {
  y: number;
  m: number;
  d: number;
}

function todayIn(timeZone: string, now: Date): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: n("year"), m: n("month"), d: n("day") };
}

const anchor = (c: CivilDate) => new Date(Date.UTC(c.y, c.m - 1, c.d));
const iso = (c: CivilDate) =>
  `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
const daysBetween = (fromISO: string, toISO: string) => {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

/* ────────────────────────────────────────────────────────────────────────────
   Upstream
   ──────────────────────────────────────────────────────────────────────── */

async function fetchActionItems(cacheSeconds: number): Promise<NotionPage[]> {
  const token = process.env["NOTION_TOKEN"];
  if (!token) throw new Error("Missing Notion credentials");

  const res = await fetch(`https://api.notion.com/v1/data_sources/${ACTION_ITEMS_DS}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100 }),
    next: { revalidate: cacheSeconds },
  });
  if (!res.ok) throw new Error(`Notion API error: ${res.status}`);
  return ((await res.json()) as { results: NotionPage[] }).results ?? [];
}

interface LaunchpadTest {
  id: string;
  name: string;
  status: string;
  entry_window_low: number | null;
  exit_negative_days: number | null;
  created_at: string;
}
interface LaunchpadEntry {
  entry_date: string;
  meta_spend: number | null;
  days_negative_streak: number | null;
}

async function launchpad<T>(path: string, cacheSeconds: number): Promise<T> {
  const res = await fetch(`${LAUNCHPAD_API}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: cacheSeconds },
  });
  if (!res.ok) throw new Error(`Launchpad ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/* ────────────────────────────────────────────────────────────────────────────
   Handler
   ──────────────────────────────────────────────────────────────────────── */

export async function GET() {
  try {
    const { settings, cacheSeconds } = await loadSettingsSafe();
    const timeZone = getSetting(settings, "TIMEZONE", SETTING_DEFAULTS.TIMEZONE);
    const overdueGraceDays = getSetting(
      settings,
      "OVERDUE_GRACE_DAYS",
      SETTING_DEFAULTS.OVERDUE_GRACE_DAYS,
    );
    const tractionEnd = getSetting(
      settings,
      "TRACTION_END_DATE",
      SETTING_DEFAULTS.TRACTION_END_DATE,
    );
    const goLive = getSetting(
      settings,
      "LAUNCHPAD_GO_LIVE_DATE",
      SETTING_DEFAULTS.LAUNCHPAD_GO_LIVE_DATE,
    );
    const testsTarget = getSetting(
      settings,
      "TESTS_TARGET_COUNT",
      SETTING_DEFAULTS.TESTS_TARGET_COUNT,
    );
    const staleRedDays = getSetting(
      settings,
      "TEST_STALE_RED_DAYS",
      SETTING_DEFAULTS.TEST_STALE_RED_DAYS,
    );

    const now = new Date();
    const today = todayIn(timeZone, now);
    const todayISO = iso(today);

    const [pages, tests] = await Promise.all([
      fetchActionItems(cacheSeconds),
      launchpad<LaunchpadTest[]>("/tests", cacheSeconds),
    ]);

    /* ---- action items ---------------------------------------------------- */
    const items = pages.map((p) => {
      const props = p.properties ?? {};
      const type = sel(props["Type"]);
      const dueDate = dat(props["Due Date"]);
      const daysPastDue = dueDate ? daysBetween(dueDate, todayISO) : null;

      // OVERDUE is a One-off concept only. A Daily or Recurring item that was
      // not done yesterday is not "overdue" — it simply recurs, so flagging it
      // red every morning is noise that trains you to ignore the flag.
      const isOneOff = type === "One-off";
      const overdue =
        isOneOff &&
        props["Completed"]?.checkbox !== true &&
        daysPastDue !== null &&
        daysPastDue > overdueGraceDays;

      return {
        id: p.id,
        title: plain(props["Title"]) || "Untitled",
        priority: sel(props["Priority"]),
        type,
        area: sel(props["Area"]),
        dueDate,
        daysPastDue,
        completed: props["Completed"]?.checkbox === true,
        completedDate: dat(props["Completed Date"]),
        overdue,
      };
    });

    const pending = items.filter((i) => !i.completed);

    // Priority first, then due date; undated sorts last.
    const ranked = [...pending].sort((a, b) => {
      const pa = PRIORITY_RANK[(a.priority ?? "").toLowerCase()] ?? 9;
      const pb = PRIORITY_RANK[(b.priority ?? "").toLowerCase()] ?? 9;
      if (pa !== pb) return pa - pb;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.title.localeCompare(b.title);
    });

    const doneToday = items.filter((i) => i.completedDate === todayISO).length;

    /* ---- inputs (Daily / Recurring) -------------------------------------- */
    const inputCandidates = items.filter((i) => i.type === "Daily" || i.type === "Recurring");

    // Streak = consecutive days ending today (or yesterday) with a completion
    // recorded for that item. A gap breaks it and the panel shows 0.
    const completionsByTitle = new Map<string, Set<string>>();
    for (const i of items) {
      if (!i.completedDate) continue;
      const set = completionsByTitle.get(i.title) ?? new Set<string>();
      set.add(i.completedDate);
      completionsByTitle.set(i.title, set);
    }

    const inputs = inputCandidates
      .map((i) => {
        const days = completionsByTitle.get(i.title) ?? new Set<string>();
        const doneTodayFlag = days.has(todayISO);

        let streak = 0;
        // Walk back from today; allow the streak to start yesterday so it is not
        // reset simply because today has not happened yet.
        let cursor = doneTodayFlag ? 0 : 1;
        for (;;) {
          const probe = new Date(anchor(today).getTime() - cursor * 86_400_000);
          const key = probe.toISOString().slice(0, 10);
          if (!days.has(key)) break;
          streak += 1;
          cursor += 1;
        }

        return {
          id: i.id,
          title: i.title,
          type: i.type,
          area: i.area,
          doneToday: doneTodayFlag,
          streak,
        };
      })
      .sort((a, b) => (a.area ?? "").localeCompare(b.area ?? "") || a.title.localeCompare(b.title));

    /* ---- decision gate --------------------------------------------------- */
    const running = tests.filter((t) => RUNNING_STATUSES.has(t.status));
    const activeTest = running.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

    let decisionDue: { name: string; reason: string } | null = null;
    if (activeTest) {
      const entries = await launchpad<LaunchpadEntry[]>(
        `/entries?test_id=${encodeURIComponent(activeTest.id)}`,
        cacheSeconds,
      );
      const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
      const spend = sorted.reduce((s, e) => s + (e.meta_spend ?? 0), 0);
      const last = sorted.at(-1);
      const staleDays = last ? daysBetween(last.entry_date, todayISO) : null;
      const negStreak = last?.days_negative_streak ?? 0;

      // Gates that demand a call: the entry window is spent (verdict gate), the
      // negative-day exit threshold is hit, or the test has gone unfed past the
      // red staleness line — an abandoned Live test is itself an exit decision.
      if (activeTest.entry_window_low !== null && spend >= activeTest.entry_window_low) {
        decisionDue = { name: activeTest.name, reason: "entry window spent" };
      } else if (
        activeTest.exit_negative_days !== null &&
        negStreak >= activeTest.exit_negative_days
      ) {
        decisionDue = { name: activeTest.name, reason: "negative-day exit gate" };
      } else if (staleDays !== null && staleDays > staleRedDays) {
        decisionDue = { name: activeTest.name, reason: `unfed ${staleDays} days` };
      }
    }

    /* ---- product test counts -------------------------------------------- */
    const completedTests = tests.filter((t) => COMPLETED_STATUSES.has(t.status));
    // created_at is the only date every test record carries, so it stands in for
    // "when it finished" until the API exposes a completion timestamp.
    const lastCompletedISO =
      completedTests
        .map((t) => t.created_at.slice(0, 10))
        .sort()
        .at(-1) ?? null;
    const gapFrom = lastCompletedISO ?? goLive;

    /* ---- the clock ------------------------------------------------------- */
    const dow = anchor(today).getUTCDay(); // 0=Sun … 6=Sat
    const daysSinceMonday = (dow + 6) % 7; // Mon=0 … Sun=6
    const daysLeftInWeek = 6 - daysSinceMonday;

    const daysInMonth = new Date(Date.UTC(today.y, today.m, 0)).getUTCDate();
    const daysLeftInMonth = daysInMonth - today.d;

    const yearStart = `${today.y}-01-01`;
    const daysInYear = daysBetween(yearStart, `${today.y + 1}-01-01`);
    const yearElapsedPct = Math.round((daysBetween(yearStart, todayISO) / daysInYear) * 1000) / 10;

    return NextResponse.json({
      generatedAt: now.toISOString(),
      timeZone,
      today: todayISO,
      cacheSeconds,
      settings,

      /* PANEL 1 */
      actions: {
        decisionDue,
        ranked,
        pendingCount: pending.length,
        doneToday,
      },

      /* PANEL 2 */
      inputs,

      /* PANEL 3 */
      clock: {
        daysLeftInWeek,
        daysLeftInMonth,
        daysToTractionEnd: daysBetween(todayISO, tractionEnd),
        tractionEndDate: tractionEnd,
        yearElapsedPct,
        tests: {
          completed: completedTests.length,
          target: testsTarget,
          lastCompletedDate: lastCompletedISO,
          gapFromDate: gapFrom,
          daysSinceLastCompleted: daysBetween(gapFrom, todayISO),
          everCompleted: completedTests.length > 0,
        },
      },
    });
  } catch (error) {
    console.error("Error building actions payload:", error);
    return NextResponse.json({ error: "Failed to fetch action data" }, { status: 500 });
  }
}
