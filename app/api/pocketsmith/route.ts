import { NextResponse } from "next/server";

// Cached for 30 minutes (legacy caching model — cacheComponents is not enabled
// in next.config.ts, so `dynamic`/`revalidate` are still honoured in Next 16;
// per the v16 release notes they are only removed once Cache Components is on).
// Same pattern as the Notion-backed routes (app/api/schedule, app/api/habits).
export const dynamic = "force-static";
export const revalidate = 1800;

const CACHE_SECONDS = 1800;

const BASE_URL = "https://api.pocketsmith.com/v2";
const USER_ID = 631070;

// Server-side only. Never expose as NEXT_PUBLIC_* — this key grants full
// read/write access to every account in the PocketSmith profile.
const POCKETSMITH_KEY = process.env.POCKETSMITH_KEY;

const TIME_ZONE = "Australia/Sydney";

// Guard against a malformed Link header pagination loop.
const MAX_PAGES = 100;

/**
 * Budgeted spending categories, in dashboard display order.
 *
 * `fallbackTarget` is the agreed weekly figure. Targets are normally read live
 * from the PocketSmith budget events for the week so that editing the budget
 * moves the dashboard without a redeploy; the constant is only used if the
 * events endpoint returns nothing for that week.
 */
const SPEND_CATEGORIES = [
  { id: 34177090, key: "housing", label: "Housing", fallbackTarget: 675.46 },
  { id: 34177010, key: "transport", label: "Transport", fallbackTarget: 194.49 },
  { id: 34176955, key: "groceries", label: "Groceries", fallbackTarget: 277.15 },
  { id: 34177020, key: "eatingOut", label: "Eating Out", fallbackTarget: 100.0 },
  { id: 34179840, key: "subscriptions", label: "Subscriptions", fallbackTarget: 105.68 },
  { id: 34179845, key: "ecom", label: "Ecom", fallbackTarget: 150.0 },
] as const;

/** Income categories, reported separately from spend. */
const INCOME_CATEGORIES = [
  { id: 34179860, key: "salary", label: "Salary" },
  { id: 34179865, key: "ecomRevenue", label: "Ecom Revenue" },
] as const;

/* ────────────────────────────────────────────────────────────────────────────
   PocketSmith response shapes (only the fields this route reads)
   ──────────────────────────────────────────────────────────────────────── */

interface PsCategory {
  id: number;
  title: string | null;
  // Set on the dedicated "Transfers" category tree. Corroborates the
  // transaction-level flag below.
  is_transfer: boolean | null;
  children?: PsCategory[] | null;
}

interface PsTransaction {
  id: number;
  date: string;
  payee: string | null;
  // Always read money in the profile's base currency (AUD). The raw `amount` is
  // in the account's own currency — the Amex is NZD, so `amount` would silently
  // under/over-count.
  amount_in_base_currency: number;
  // PocketSmith's own transfer marker. `true` on both legs of a matched
  // transfer, `null` (not `false`) on everything else — so test for truthiness,
  // never `=== false`.
  is_transfer: boolean | null;
  category: PsCategory | null;
}

interface PsAccount {
  id: number;
  title: string | null;
  // "bank" for the two cash accounts, "credits" for the four cards.
  type: string | null;
  currency_code: string | null;
  current_balance_in_base_currency: number | null;
}

interface PsInstitution {
  title: string | null;
}

/**
 * `/transaction_accounts` rather than `/accounts` — only this shape carries the
 * institution, which the ACCOUNTS panel prints under each account name.
 */
interface PsTransactionAccount {
  id: number;
  name: string | null;
  type: string | null;
  current_balance_in_base_currency: number | null;
  institution: PsInstitution | null;
}

interface PsEvent {
  // Budget events carry a composite id ("<seriesId>-<epoch>"), not a number.
  id: string;
  date: string;
  // Negative for expense budgets.
  amount: number;
  category: PsCategory | null;
}

/* ────────────────────────────────────────────────────────────────────────────
   Date windows — computed in Australia/Sydney
   ──────────────────────────────────────────────────────────────────────── */

interface CivilDate {
  y: number;
  m: number; // 1-12
  d: number;
}

/**
 * Today's calendar date as seen in Australia/Sydney.
 *
 * Intl does the zone conversion, so this stays correct across the AEST/AEDT
 * boundary. Do NOT reintroduce a hardcoded UTC+10 offset here — that silently
 * reports the wrong day for the ~5 months Sydney is on AEDT (UTC+11), which
 * would shift the Mon–Sun window by a whole day.
 */
function sydneyToday(now: Date): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const part = (type: string) => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return a ${type} part`);
    return Number(found.value);
  };

  return { y: part("year"), m: part("month"), d: part("day") };
}

// Calendar arithmetic below is done on a UTC anchor. A civil date's day-of-week
// and day-count arithmetic are zone-independent, so anchoring to UTC keeps the
// maths DST-proof — the only zone-aware step is sydneyToday() above.
const toAnchor = (c: CivilDate) => new Date(Date.UTC(c.y, c.m - 1, c.d));

const fromAnchor = (d: Date): CivilDate => ({
  y: d.getUTCFullYear(),
  m: d.getUTCMonth() + 1,
  d: d.getUTCDate(),
});

function addDays(c: CivilDate, days: number): CivilDate {
  const anchor = toAnchor(c);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return fromAnchor(anchor);
}

const iso = (c: CivilDate) =>
  `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;

/** Monday of the ISO week containing `c`. */
function mondayOfWeek(c: CivilDate): CivilDate {
  const dow = toAnchor(c).getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0 … Sun=6
  return addDays(c, -daysSinceMonday);
}

/** `monthsBack` complete calendar months before the month containing `c`. */
function calendarMonth(c: CivilDate, monthsBack: number): DateWindow {
  const anchor = new Date(Date.UTC(c.y, c.m - 1 - monthsBack, 1));
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + 1;
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: { y, m, d: 1 }, end: { y, m, d: lastDay } };
}

interface DateWindow {
  start: CivilDate;
  end: CivilDate;
}

/* ────────────────────────────────────────────────────────────────────────────
   API access
   ──────────────────────────────────────────────────────────────────────── */

async function psFetch<T>(url: string): Promise<{ data: T; link: string | null }> {
  const response = await fetch(url, {
    headers: {
      "X-Developer-Key": POCKETSMITH_KEY as string,
      Accept: "application/json",
    },
    next: { revalidate: CACHE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`PocketSmith ${response.status} ${response.statusText} for ${url}`);
  }

  return { data: (await response.json()) as T, link: response.headers.get("link") };
}

/** Pull the rel="next" URL out of an RFC 5988 Link header. */
function nextPageUrl(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch every page of a paginated collection. PocketSmith caps per_page at 100
 * and advertises the next page only via the Link header, so stopping at page 1
 * silently truncates any window with more than 100 transactions.
 */
async function fetchAllPages<T>(firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let url: string | null = firstUrl;
  let pages = 0;

  while (url && pages < MAX_PAGES) {
    if (seen.has(url)) break; // defensive: never re-request the same page
    seen.add(url);

    const { data, link } = await psFetch<T[]>(url);
    out.push(...data);
    pages += 1;
    url = nextPageUrl(link);
  }

  if (url && pages >= MAX_PAGES) {
    throw new Error(`PocketSmith pagination exceeded ${MAX_PAGES} pages`);
  }

  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   Aggregation
   ──────────────────────────────────────────────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A transaction is a transfer if PocketSmith flagged the transaction itself, or
 * if it sits under the transfer category tree. Both are checked for truthiness:
 * the transaction-level flag is `true | null`, never `false`.
 *
 * Internal money movement (card payments, account-to-account) is flagged this
 * way. Counting it would double-count both spending and income.
 */
function isTransfer(t: PsTransaction): boolean {
  return Boolean(t.is_transfer) || Boolean(t.category?.is_transfer);
}

/**
 * Map every category id to its top-level ancestor.
 *
 * Spending is recorded against leaf categories ("Power", "Fuel"), but the budget
 * targets sit on the top-level parents ("Housing", "Transport"). Without this
 * rollup a Power transaction would never count against the Housing target.
 */
function buildRollup(tree: PsCategory[]): Map<number, number> {
  const rollup = new Map<number, number>();

  const walk = (nodes: PsCategory[], rootId: number | null) => {
    for (const node of nodes) {
      const root = rootId ?? node.id;
      rollup.set(node.id, root);
      if (node.children?.length) walk(node.children, root);
    }
  };

  walk(tree, null);
  return rollup;
}

/* ────────────────────────────────────────────────────────────────────────────
   Period summaries — LAST WEEK / LAST MONTH panels
   ──────────────────────────────────────────────────────────────────────── */

const UNCATEGORISED = "Uncategorised";

interface CategoryBreakdown {
  title: string;
  amount: number;
  percent: number;
}

interface PeriodSummary {
  startDate: string;
  endDate: string;
  totalSpending: number;
  totalIncome: number;
  difference: number;
  savingsRate: number;
  categorisedTotal: number;
  uncategorisedTotal: number;
  /** Spending transactions only (transfers excluded). */
  transactionCount: number;
  incomeTransactionCount: number;
  allTransactionCount: number;
  /** Descending by amount. Uncategorised is reported separately, not here. */
  categories: CategoryBreakdown[];
}

/**
 * Roll a window of transactions into the shape the spending panels render.
 *
 * A missing category is real money, not a rounding error — it goes into its own
 * bucket rather than being dropped, which is what PocketSmith's own widget does
 * and how spend gets hidden.
 */
function summarisePeriod(window: DateWindow, transactions: PsTransaction[]): PeriodSummary {
  const kept = transactions.filter((t) => !isTransfer(t));

  const spending = kept.filter((t) => t.amount_in_base_currency < 0);
  const income = kept.filter((t) => t.amount_in_base_currency > 0);

  const totalSpending = spending.reduce((s, t) => s - t.amount_in_base_currency, 0);
  const totalIncome = income.reduce((s, t) => s + t.amount_in_base_currency, 0);

  const byCategory = new Map<string, number>();
  let uncategorisedTotal = 0;

  for (const t of spending) {
    const title = t.category?.title?.trim() || UNCATEGORISED;
    const amount = -t.amount_in_base_currency;
    if (title === UNCATEGORISED) {
      uncategorisedTotal += amount;
      continue;
    }
    byCategory.set(title, (byCategory.get(title) ?? 0) + amount);
  }

  const categories = [...byCategory.entries()]
    .map(([title, amount]) => ({
      title,
      amount: round2(amount),
      percent: totalSpending > 0 ? round2((amount / totalSpending) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const difference = totalIncome - totalSpending;

  return {
    startDate: iso(window.start),
    endDate: iso(window.end),
    totalSpending: round2(totalSpending),
    totalIncome: round2(totalIncome),
    difference: round2(difference),
    savingsRate: totalIncome > 0 ? round2((difference / totalIncome) * 100) : 0,
    categorisedTotal: round2(totalSpending - uncategorisedTotal),
    uncategorisedTotal: round2(uncategorisedTotal),
    transactionCount: spending.length,
    incomeTransactionCount: income.length,
    allTransactionCount: kept.length,
    categories,
  };
}

async function fetchPeriod(window: DateWindow): Promise<PeriodSummary> {
  const transactions = await fetchAllPages<PsTransaction>(
    `${BASE_URL}/users/${USER_ID}/transactions` +
      `?start_date=${iso(window.start)}&end_date=${iso(window.end)}&per_page=100`,
  );
  return summarisePeriod(window, transactions);
}

/* ────────────────────────────────────────────────────────────────────────────
   Handler
   ──────────────────────────────────────────────────────────────────────── */

export async function GET() {
  if (!POCKETSMITH_KEY) {
    console.error("Missing POCKETSMITH_KEY");
    return NextResponse.json({ error: "Missing PocketSmith credentials" }, { status: 500 });
  }

  try {
    const today = sydneyToday(new Date());
    const weekStart = mondayOfWeek(today);
    const weekEnd = addDays(weekStart, 6);
    const startDate = iso(weekStart);
    const endDate = iso(weekEnd);

    // LAST WEEK is the previous *complete* Mon–Sun, i.e. the week that ended on
    // the Sunday before this week's Monday. LAST MONTH is the previous complete
    // calendar month. Each carries the period before it, for the deltas.
    const lastWeekStart = addDays(weekStart, -7);
    const previousWeekStart = addDays(weekStart, -14);
    const lastWeekWindow: DateWindow = { start: lastWeekStart, end: addDays(lastWeekStart, 6) };
    const previousWeekWindow: DateWindow = {
      start: previousWeekStart,
      end: addDays(previousWeekStart, 6),
    };
    const lastMonthWindow = calendarMonth(today, 1);
    const previousMonthWindow = calendarMonth(today, 2);

    const [
      accountsRaw,
      categoryTree,
      transactions,
      events,
      transactionAccounts,
      lastWeek,
      previousWeek,
      lastMonth,
      previousMonth,
    ] = await Promise.all([
      fetchAllPages<PsAccount>(`${BASE_URL}/users/${USER_ID}/accounts`),
      fetchAllPages<PsCategory>(`${BASE_URL}/users/${USER_ID}/categories`),
      fetchAllPages<PsTransaction>(
        `${BASE_URL}/users/${USER_ID}/transactions` +
          `?start_date=${startDate}&end_date=${endDate}&per_page=100`,
      ),
      fetchAllPages<PsEvent>(
        `${BASE_URL}/users/${USER_ID}/events?start_date=${startDate}&end_date=${endDate}`,
      ),
      fetchAllPages<PsTransactionAccount>(`${BASE_URL}/users/${USER_ID}/transaction_accounts`),
      fetchPeriod(lastWeekWindow),
      fetchPeriod(previousWeekWindow),
      fetchPeriod(lastMonthWindow),
      fetchPeriod(previousMonthWindow),
    ]);

    /* ---- balances -------------------------------------------------------- */
    // Split by account type rather than by name: "bank" is the two cash
    // accounts (ING, Kurgel), "credits" the four cards (Amex, Mastercard,
    // Latitude, David Jones). Survives an account being renamed.
    const mapAccount = (a: PsAccount) => ({
      id: a.id,
      name: a.title ?? "Unnamed account",
      currency: a.currency_code?.toUpperCase() ?? "AUD",
      // Always base currency — the Amex is denominated in NZD.
      balance: round2(a.current_balance_in_base_currency ?? 0),
    });

    const cashAccounts = accountsRaw.filter((a) => a.type === "bank").map(mapAccount);
    const debtAccounts = accountsRaw.filter((a) => a.type === "credits").map(mapAccount);

    const cashTotal = round2(cashAccounts.reduce((s, a) => s + a.balance, 0));
    // Card balances arrive negative; report debt as a positive magnitude.
    const debtTotal = round2(debtAccounts.reduce((s, a) => s - a.balance, 0));

    /* ---- weekly targets from budget events ------------------------------- */
    const rollup = buildRollup(categoryTree);
    const targetByCategory = new Map<number, number>();

    for (const event of events) {
      const categoryId = event.category?.id;
      if (categoryId === undefined) continue;
      const root = rollup.get(categoryId) ?? categoryId;
      targetByCategory.set(root, (targetByCategory.get(root) ?? 0) + Math.abs(event.amount));
    }

    /* ---- weekly actuals -------------------------------------------------- */
    const spendable = transactions.filter((t) => !isTransfer(t));

    const spendByCategory = new Map<number, number>();
    const incomeByCategory = new Map<number, number>();

    for (const t of spendable) {
      const categoryId = t.category?.id;
      if (categoryId === undefined) continue;
      const root = rollup.get(categoryId) ?? categoryId;
      const value = t.amount_in_base_currency;

      if (value < 0) {
        spendByCategory.set(root, (spendByCategory.get(root) ?? 0) - value);
      } else {
        // Income is attributed to its own leaf category (Salary / Ecom Revenue),
        // not the rolled-up "Income" parent.
        incomeByCategory.set(categoryId, (incomeByCategory.get(categoryId) ?? 0) + value);
      }
    }

    const weekCategories = SPEND_CATEGORIES.map((c) => {
      const actual = round2(spendByCategory.get(c.id) ?? 0);
      const live = targetByCategory.get(c.id);
      const target = round2(live ?? c.fallbackTarget);
      const variance = round2(actual - target);
      return {
        key: c.key,
        label: c.label,
        categoryId: c.id,
        actual,
        target,
        targetSource: live === undefined ? ("fallback" as const) : ("budget" as const),
        variance,
        status: variance > 0 ? ("over" as const) : ("under" as const),
        percentUsed: target > 0 ? round2((actual / target) * 100) : 0,
      };
    });

    const weekSpendTotal = round2(weekCategories.reduce((s, c) => s + c.actual, 0));
    const weekTargetTotal = round2(weekCategories.reduce((s, c) => s + c.target, 0));

    /* ---- income ---------------------------------------------------------- */
    const incomeStreams = INCOME_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      categoryId: c.id,
      amount: round2(incomeByCategory.get(c.id) ?? 0),
    }));

    const incomeTotal = round2(incomeStreams.reduce((s, c) => s + c.amount, 0));

    /* ---- accounts panel -------------------------------------------------- */
    const panelAccounts = transactionAccounts.map((a) => ({
      name: a.name ?? "Unnamed account",
      institution: a.institution?.title ?? "—",
      type: a.type ?? "—",
      // Base currency: the Amex is denominated in NZD.
      balance: round2(a.current_balance_in_base_currency ?? 0),
    }));

    const totalBalance = round2(panelAccounts.reduce((s, a) => s + a.balance, 0));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      timeZone: TIME_ZONE,
      today: iso(today),
      cacheSeconds: CACHE_SECONDS,

      cash: { accounts: cashAccounts, total: cashTotal },
      debt: { accounts: debtAccounts, total: debtTotal },
      netWorth: round2(cashTotal - debtTotal),

      week: {
        startDate,
        endDate,
        categories: weekCategories,
        spendTotal: weekSpendTotal,
        targetTotal: weekTargetTotal,
        variance: round2(weekSpendTotal - weekTargetTotal),
      },

      income: { streams: incomeStreams, total: incomeTotal },

      net: round2(incomeTotal - weekSpendTotal),

      // Spending panels: completed periods, each with the period before it so
      // the panel can render a delta without a second request.
      lastWeek,
      previousWeek,
      lastMonth,
      previousMonth,

      accounts: panelAccounts,
      totalBalance,
    });
  } catch (error) {
    console.error("Error fetching PocketSmith data:", error);
    return NextResponse.json({ error: "Failed to fetch PocketSmith data" }, { status: 500 });
  }
}
