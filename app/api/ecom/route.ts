import { NextResponse } from "next/server";
import {
  DEFAULT_CACHE_SECONDS,
  SETTING_DEFAULTS,
  getSetting,
  loadSettingsSafe,
} from "../../lib/settings";

// Cached for 5 minutes (legacy caching model — cacheComponents is not enabled).
// Same pattern as the other cached routes (app/api/schedule, app/api/habits).
export const dynamic = "force-static";
export const revalidate = 300;

// Fallback only — the live window is CACHE_MINUTES from settings, resolved per
// request. `revalidate` above must stay a static literal.
const CACHE_SECONDS = DEFAULT_CACHE_SECONDS;

/* ────────────────────────────────────────────────────────────────────────────
   Sources of truth — see the reconciliation note in the commit message.
   ────────────────────────────────────────────────────────────────────────────
   Revenue  → Shopify. System of record for money actually collected.

   Ad spend → PocketSmith, filtered to Meta payees (FACEBK…). These are
              bank-settled charges: daily-dated, self-updating, and requiring no
              manual entry. Deliberately NOT PocketSmith's "Ecom" category — that
              tree holds Shopify fees, Officeworks and a $992 inter-entity
              transfer and contains zero Meta transactions, so reading it as ad
              spend overstates by roughly 7x. The Meta charges are filed under
              "Online Services", so this filters by payee, not by category.

   COGS     → Shopify line-item quantities priced against the Launchpad test's
              `bundles_config`, so COGS covers exactly the same orders as the
              revenue beside it.

   The Google Apps Script sheet behind /api/pl-data is not used: manually
   maintained, last row 8 Jul, and it never recorded order #21030.
   ──────────────────────────────────────────────────────────────────────── */

const SHOP = process.env["SHOPIFY_STORE"] ?? "0eu5zs-gj.myshopify.com";
const TOKEN_URL = `https://${SHOP}/admin/oauth/access_token`;
const GRAPHQL_URL = `https://${SHOP}/admin/api/2025-01/graphql.json`;

// Server-side only. Never NEXT_PUBLIC_*.
const POCKETSMITH_KEY = process.env["POCKETSMITH_KEY"];
const POCKETSMITH_BASE = "https://api.pocketsmith.com/v2";

/** Public read-only API of the ECOM Launchpad's backend. No auth required. */
const LAUNCHPAD_API = "https://product-test-engine.netlify.app/api";

/** Meta charges appear under these payees regardless of category. */
const META_PAYEE = /facebk|facebook|meta platforms|meta ads/i;

/** Line items that are services, not goods — they carry no COGS. */
const NON_GOODS = /order protection|priority processing|shipping protection|tip/i;

const SPARK_DAYS = 30;

// Every day boundary is resolved through Intl with the TIMEZONE setting —
// never a fixed UTC+10, which is wrong for the ~5 months the zone is on AEDT.

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ────────────────────────────────────────────────────────────────────────────
   Sydney calendar helpers
   ──────────────────────────────────────────────────────────────────────── */

interface CivilDate {
  y: number;
  m: number;
  d: number;
}

function sydneyToday(now: Date, timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (t: string) => {
    const found = parts.find((p) => p.type === t);
    if (!found) throw new Error(`Intl did not return a ${t} part`);
    return Number(found.value);
  };
  return { y: part("year"), m: part("month"), d: part("day") };
}

/** The instant of midnight starting the given civil day, in `timeZone`. */
function zoneMidnight(c: CivilDate, timeZone: string): number {
  const noonUTC = Date.UTC(c.y, c.m - 1, c.d, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUTC));
  const n = (t: string) => parseInt(parts.find((p) => p.type === t)!.value.replace(/^24$/, "0"));
  const localSecs = n("hour") * 3600 + n("minute") * 60 + n("second");
  const dayDiff = Math.round(
    (Date.UTC(n("year"), n("month") - 1, n("day")) - Date.UTC(c.y, c.m - 1, c.d)) / 86_400_000,
  );
  return noonUTC - localSecs * 1000 - dayDiff * 86_400_000;
}

const toAnchor = (c: CivilDate) => new Date(Date.UTC(c.y, c.m - 1, c.d));
const fromAnchor = (d: Date): CivilDate => ({
  y: d.getUTCFullYear(),
  m: d.getUTCMonth() + 1,
  d: d.getUTCDate(),
});
function addDays(c: CivilDate, n: number): CivilDate {
  const a = toAnchor(c);
  a.setUTCDate(a.getUTCDate() + n);
  return fromAnchor(a);
}
const iso = (c: CivilDate) =>
  `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
const daysBetween = (fromISO: string, toISO: string) => {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

/** The Sydney civil date an instant falls on. */
function isoOfInstant(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Shopify
   ──────────────────────────────────────────────────────────────────────── */

async function getAccessToken(): Promise<string> {
  const clientId = process.env["SHOPIFY_CLIENT_ID"];
  const clientSecret = process.env["SHOPIFY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("Missing Shopify credentials");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Shopify token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function shopifyGql<T>(token: string, query: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Shopify GraphQL failed: ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

interface ShopifyLineItem {
  title: string;
  quantity: number;
}
interface ShopifyOrder {
  name: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string } };
  lineItems: { nodes: ShopifyLineItem[] };
}

const ORDERS_QUERY = (since: string, after: string | null) => `{
  orders(
    first: 250
    query: "created_at:>=${since}"
    sortKey: CREATED_AT
    ${after ? `after: "${after}"` : ""}
  ) {
    nodes {
      name
      createdAt
      totalPriceSet { shopMoney { amount } }
      lineItems(first: 20) { nodes { title quantity } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type OrdersPage = {
  orders: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
};

async function fetchOrdersSince(token: string, sinceISO: string): Promise<ShopifyOrder[]> {
  const out: ShopifyOrder[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: OrdersPage = await shopifyGql<OrdersPage>(token, ORDERS_QUERY(sinceISO, cursor));
    out.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   PocketSmith — Meta ad spend
   ──────────────────────────────────────────────────────────────────────── */

interface PsTransaction {
  date: string;
  payee: string | null;
  amount_in_base_currency: number;
  is_transfer: boolean | null;
  category: { title: string | null; is_transfer: boolean | null } | null;
}

function nextPageUrl(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

async function fetchMetaSpend(
  startISO: string,
  endISO: string,
  cacheSeconds: number,
): Promise<PsTransaction[]> {
  if (!POCKETSMITH_KEY) throw new Error("Missing POCKETSMITH_KEY");

  // The user id is resolved from /me rather than hardcoded.
  const meRes = await fetch(`${POCKETSMITH_BASE}/me`, {
    headers: { "X-Developer-Key": POCKETSMITH_KEY, Accept: "application/json" },
    next: { revalidate: cacheSeconds },
  });
  if (!meRes.ok) throw new Error(`PocketSmith /me failed: ${meRes.status}`);
  const userId = ((await meRes.json()) as { id: number }).id;

  const out: PsTransaction[] = [];
  let url: string | null =
    `${POCKETSMITH_BASE}/users/${userId}/transactions` +
    `?start_date=${startISO}&end_date=${endISO}&per_page=100`;
  const seen = new Set<string>();

  while (url && out.length < 5000) {
    if (seen.has(url)) break;
    seen.add(url);
    const res: Response = await fetch(url, {
      headers: { "X-Developer-Key": POCKETSMITH_KEY, Accept: "application/json" },
      next: { revalidate: cacheSeconds },
    });
    if (!res.ok) throw new Error(`PocketSmith transactions failed: ${res.status}`);
    out.push(...((await res.json()) as PsTransaction[]));
    url = nextPageUrl(res.headers.get("link"));
  }

  // Transfers are internal movement, never ad spend.
  return out.filter(
    (t) =>
      !t.is_transfer &&
      !t.category?.is_transfer &&
      t.amount_in_base_currency < 0 &&
      META_PAYEE.test(t.payee ?? ""),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Launchpad
   ──────────────────────────────────────────────────────────────────────── */

interface Bundle {
  id: number;
  qty: number;
  cogs: number;
  name: string;
}

interface LaunchpadTest {
  id: string;
  name: string;
  status: string;
  cogs_per_unit: number | null;
  target_cpa: number | null;
  entry_window_low: number | null;
  entry_window_high: number | null;
  validation_min_purchases: number | null;
  bundles_config: Bundle[] | null;
  first_spend_at: string | null;
  created_at: string;
}

interface LaunchpadEntry {
  entry_date: string;
  meta_spend: number | null;
  revenue: number | null;
  orders: number | null;
}

async function launchpad<T>(path: string, cacheSeconds = CACHE_SECONDS): Promise<T> {
  const res = await fetch(`${LAUNCHPAD_API}${path}`, {
    next: { revalidate: cacheSeconds },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Launchpad ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Statuses that mean a test is actively consuming budget right now. */
const RUNNING = new Set(["Live", "Iterating"]);

/**
 * Price a line item using the test's bundle table. A "x2" line is a 2-pack with
 * its own COGS, not two singles, so quantity maps to a bundle before falling
 * back to per-unit pricing.
 */
function lineItemCogs(item: ShopifyLineItem, test: LaunchpadTest | null): number {
  if (NON_GOODS.test(item.title)) return 0;
  const bundle = test?.bundles_config?.find((b) => b.qty === item.quantity);
  if (bundle) return bundle.cogs;
  return (test?.cogs_per_unit ?? 0) * item.quantity;
}

const orderCogs = (o: ShopifyOrder, t: LaunchpadTest | null) =>
  o.lineItems.nodes.reduce((s, li) => s + lineItemCogs(li, t), 0);

/* ────────────────────────────────────────────────────────────────────────────
   Handler
   ──────────────────────────────────────────────────────────────────────── */

export async function GET() {
  if (!POCKETSMITH_KEY) {
    console.error("Missing POCKETSMITH_KEY");
    return NextResponse.json({ error: "Missing PocketSmith credentials" }, { status: 500 });
  }

  try {
    // Settings are the single source of truth. loadSettingsSafe never throws: a
    // Notion outage degrades to built-in defaults with a per-key warning.
    const { settings, cacheSeconds } = await loadSettingsSafe();
    const timeZone = getSetting(settings, "TIMEZONE", SETTING_DEFAULTS.TIMEZONE);
    const monthTarget = getSetting(
      settings,
      "TARGET_MONTHLY_REVENUE",
      SETTING_DEFAULTS.TARGET_MONTHLY_REVENUE,
    );
    const entryWindowLow = getSetting(
      settings,
      "TEST_ENTRY_WINDOW_LOW",
      SETTING_DEFAULTS.TEST_ENTRY_WINDOW_LOW,
    );
    const entryWindowHigh = getSetting(
      settings,
      "TEST_ENTRY_WINDOW_HIGH",
      SETTING_DEFAULTS.TEST_ENTRY_WINDOW_HIGH,
    );
    const staleAmberDays = getSetting(
      settings,
      "TEST_STALE_AMBER_DAYS",
      SETTING_DEFAULTS.TEST_STALE_AMBER_DAYS,
    );
    const staleRedDays = getSetting(
      settings,
      "TEST_STALE_RED_DAYS",
      SETTING_DEFAULTS.TEST_STALE_RED_DAYS,
    );
    const lookbackDays = getSetting(
      settings,
      "NO_CAMPAIGNS_LOOKBACK_DAYS",
      SETTING_DEFAULTS.NO_CAMPAIGNS_LOOKBACK_DAYS,
    );
    const adSpendSource = getSetting(
      settings,
      "AD_SPEND_SOURCE",
      SETTING_DEFAULTS.AD_SPEND_SOURCE,
    );
    const launchpadGoLive = getSetting(
      settings,
      "LAUNCHPAD_GO_LIVE_DATE",
      SETTING_DEFAULTS.LAUNCHPAD_GO_LIVE_DATE,
    );

    const now = new Date();
    const today = sydneyToday(now, timeZone);
    const todayISO = iso(today);
    const monthStart = { y: today.y, m: today.m, d: 1 };
    const sparkStart = addDays(today, -(SPARK_DAYS - 1));

    // Shopify is fetched from whichever is earlier — the month start or the
    // sparkline window — so one request feeds both.
    const shopifySince =
      zoneMidnight(sparkStart, timeZone) < zoneMidnight(monthStart, timeZone)
        ? sparkStart
        : monthStart;

    const token = await getAccessToken();

    const [orders, tests, metaTx] = await Promise.all([
      fetchOrdersSince(token, new Date(zoneMidnight(shopifySince, timeZone)).toISOString()),
      launchpad<LaunchpadTest[]>("/tests", cacheSeconds),
      fetchMetaSpend(iso(sparkStart), todayISO, cacheSeconds),
    ]);

    const running = tests.filter((t) => RUNNING.has(t.status));
    const activeTest = running.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

    const entries = activeTest
      ? await launchpad<LaunchpadEntry[]>(
          `/entries?test_id=${encodeURIComponent(activeTest.id)}`,
          cacheSeconds,
        )
      : [];
    const sortedEntries = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));

    /* ---- per-day rollups ------------------------------------------------- */
    const revenueByDay = new Map<string, number>();
    const cogsByDay = new Map<string, number>();
    const ordersByDay = new Map<string, number>();

    for (const o of orders) {
      const day = isoOfInstant(new Date(o.createdAt).getTime(), timeZone);
      const amount = parseFloat(o.totalPriceSet.shopMoney.amount || "0");
      revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + amount);
      cogsByDay.set(day, (cogsByDay.get(day) ?? 0) + orderCogs(o, activeTest));
      ordersByDay.set(day, (ordersByDay.get(day) ?? 0) + 1);
    }

    const adSpendByDay = new Map<string, number>();
    for (const t of metaTx) {
      const day = t.date.slice(0, 10);
      adSpendByDay.set(day, (adSpendByDay.get(day) ?? 0) - t.amount_in_base_currency);
    }

    /* ---- TODAY ----------------------------------------------------------- */
    const todayRevenue = revenueByDay.get(todayISO) ?? 0;
    const todayCogs = cogsByDay.get(todayISO) ?? 0;
    const todayOrders = ordersByDay.get(todayISO) ?? 0;
    // PocketSmith settles daily, so a genuine same-day figure exists. It is
    // settlement-dated, not delivery-dated, so it lags Meta's own reporting.
    const todayAdSpend = adSpendByDay.get(todayISO) ?? 0;

    /* ---- MONTH ----------------------------------------------------------- */
    const inMonth = (day: string) => day >= iso(monthStart) && day <= todayISO;
    const sum = (m: Map<string, number>) =>
      [...m.entries()].filter(([d]) => inMonth(d)).reduce((s, [, v]) => s + v, 0);

    const monthRevenue = sum(revenueByDay);
    const monthCogs = sum(cogsByDay);
    const monthOrders = sum(ordersByDay);
    const monthAdSpend = sum(adSpendByDay);
    const monthGross = monthRevenue - monthCogs;

    /* ---- 30-day daily contribution series -------------------------------- */
    const series: { date: string; contribution: number }[] = [];
    for (let i = 0; i < SPARK_DAYS; i++) {
      const day = iso(addDays(sparkStart, i));
      const contribution =
        (revenueByDay.get(day) ?? 0) - (cogsByDay.get(day) ?? 0) - (adSpendByDay.get(day) ?? 0);
      series.push({ date: day, contribution: round2(contribution) });
    }

    const testSpend = sortedEntries.reduce((s, e) => s + (e.meta_spend ?? 0), 0);

    /* ---- PANEL 1 activity state -----------------------------------------
     * Three states, not two. Ad spend is bank-settled cash and lags Meta by
     * days, so a zero today does NOT mean nothing is running — announcing
     * "no campaigns" on that basis is wrong.
     *
     *   LIVE     — money moved today, OR a Live/Iterating test whose last entry
     *              is within TEST_STALE_AMBER_DAYS.
     *   AWAITING — today is zero, but there was activity inside
     *              NO_CAMPAIGNS_LOOKBACK_DAYS. Today's numbers just haven't
     *              settled yet.
     *   NONE     — nothing in the lookback AND no test that is both active and
     *              fed within TEST_STALE_RED_DAYS. A stale-dead test must not
     *              block this branch; that was the original bug.
     */
    const testStaleDays = sortedEntries.at(-1)
      ? daysBetween(sortedEntries.at(-1)!.entry_date, todayISO)
      : null;

    const testIsFresh =
      activeTest !== null && testStaleDays !== null && testStaleDays <= staleAmberDays;
    const testIsAlive =
      activeTest !== null && testStaleDays !== null && testStaleDays <= staleRedDays;

    const activityToday = todayOrders > 0 || todayAdSpend > 0;

    const lookbackStart = iso(addDays(today, -lookbackDays));
    const activityInLookback = series.some(
      (d) =>
        d.date >= lookbackStart &&
        d.date <= todayISO &&
        ((revenueByDay.get(d.date) ?? 0) > 0 || (adSpendByDay.get(d.date) ?? 0) > 0),
    );

    const activityState: "LIVE" | "AWAITING" | "NONE" = activityToday || testIsFresh
      ? "LIVE"
      : activityInLookback
        ? "AWAITING"
        : testIsAlive
          ? "AWAITING"
          : "NONE";

    return NextResponse.json({
      generatedAt: now.toISOString(),
      timeZone,
      today: todayISO,
      settings,
      cacheSeconds,

      /* PANEL 1 */
      todayStats: {
        revenue: round2(todayRevenue),
        orders: todayOrders,
        aov: todayOrders > 0 ? round2(todayRevenue / todayOrders) : null,
        cogs: round2(todayCogs),
        adSpend: round2(todayAdSpend),
        // A true same-day figure, so the panel labels it TODAY, not MTD.
        adSpendWindow: "TODAY" as const,
        adSpendMtd: round2(monthAdSpend),
        contribution: round2(todayRevenue - todayCogs - todayAdSpend),
        // Three-state diagnosis — see the note above. `noCampaignsLive` is
        // gone deliberately: it conflated "nothing running" with "not settled
        // yet" and announced the wrong one.
        activityState,
        lookbackDays,
        lookbackHadActivity: activityInLookback,
        testIsFresh,
        testIsAlive,
      },

      /* PANEL 2 */
      test: activeTest
        ? {
            present: true as const,
            id: activeTest.id,
            name: activeTest.name,
            status: activeTest.status,
            dayNumber: sortedEntries.length,
            lastEntryDate: sortedEntries.at(-1)?.entry_date ?? null,
            staleDays: sortedEntries.at(-1)
              ? daysBetween(sortedEntries.at(-1)!.entry_date, todayISO)
              : null,
            cumulativeSpend: round2(testSpend),
            // Settings win over the test record; both currently agree.
            entryWindowLow,
            entryWindowHigh,
            testRevenue: round2(sortedEntries.reduce((s, e) => s + (e.revenue ?? 0), 0)),
            testOrders: sortedEntries.reduce((s, e) => s + (e.orders ?? 0), 0),
            targetCpa: activeTest.target_cpa,
            validationMinPurchases: activeTest.validation_min_purchases,
          }
        : {
            present: false as const,
            testsComplete: 0,
            testsTarget: 3,
            sinceDate: launchpadGoLive,
            daysSince: daysBetween(launchpadGoLive, todayISO),
          },

      /* PANEL 3 */
      month: {
        revenue: round2(monthRevenue),
        orders: monthOrders,
        cogs: round2(monthCogs),
        grossProfit: round2(monthGross),
        adSpend: round2(monthAdSpend),
        contribution: round2(monthGross - monthAdSpend),
        target: monthTarget,
        targetPercent: round2(Math.min((monthRevenue / monthTarget) * 100, 100)),
        revenueSource: "Shopify",
        adSpendSource: "PocketSmith · Meta",
        adSpendSourceKey: adSpendSource,
        dailyContribution: series,
      },
    });
  } catch (error) {
    console.error("Error building ecom payload:", error);
    return NextResponse.json({ error: "Failed to fetch ecom data" }, { status: 500 });
  }
}
