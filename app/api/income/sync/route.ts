import { NextResponse } from "next/server";
import { supabase, getLastWeekStart } from "../../../lib/supabase";

const SHOP        = process.env["SHOPIFY_STORE"] ?? "0eu5zs-gj.myshopify.com";
const TOKEN_URL   = `https://${SHOP}/admin/oauth/access_token`;
const GRAPHQL_URL = `https://${SHOP}/admin/api/2025-01/graphql.json`;

async function getAccessToken(): Promise<string> {
  const clientId     = process.env["SHOPIFY_CLIENT_ID"];
  const clientSecret = process.env["SHOPIFY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("Missing Shopify env vars");
  const res = await fetch(TOKEN_URL, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function shopifyGql<T>(token: string, query: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL failed: ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function tzMidnight(year: number, month: number, day: number, tz: string): number {
  const noonUTC = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(noonUTC));
  const n = (t: string) => parseInt(parts.find((p) => p.type === t)!.value.replace(/^24$/, "0"));
  const localSecs = n("hour") * 3600 + n("minute") * 60 + n("second");
  const dayDiff = Math.round(
    (Date.UTC(n("year"), n("month") - 1, n("day")) - Date.UTC(year, month - 1, day)) / 86_400_000
  );
  return noonUTC - localSecs * 1000 - dayDiff * 86_400_000;
}

function localNow(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  }).formatToParts(now);
  const n  = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
  return { year: n("year"), month: n("month"), day: n("day"), weekday: wd };
}

interface OrderNode { createdAt: string; totalPriceSet: { shopMoney: { amount: string } } }
type OrdersPage = { orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };

const ORDER_QUERY = (since: string, after: string | null) => `{
  orders(first: 250 query: "created_at:>=${since}" sortKey: CREATED_AT ${after ? `after: "${after}"` : ""}) {
    nodes { createdAt totalPriceSet { shopMoney { amount } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function fetchAllOrders(token: string, since: string): Promise<OrderNode[]> {
  const orders: OrderNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: OrdersPage = await shopifyGql<OrdersPage>(token, ORDER_QUERY(since, cursor));
    orders.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return orders;
}

export async function GET() {
  try {
    const token = await getAccessToken();
    const { shop: { ianaTimezone: tz } } = await shopifyGql<{ shop: { ianaTimezone: string } }>(
      token, `{ shop { ianaTimezone } }`
    );

    const now = new Date();
    const { year, month, day, weekday } = localNow(now, tz);
    const todayMs      = tzMidnight(year, month, day, tz);
    const daysFromMon  = weekday === 0 ? 6 : weekday - 1;
    const thisMondayMs = todayMs - daysFromMon * 86_400_000;
    const lastMondayMs = thisMondayMs - 7 * 86_400_000;

    const orders = await fetchAllOrders(token, new Date(lastMondayMs).toISOString());

    let weekRevenue = 0;
    for (const o of orders) {
      const t = new Date(o.createdAt).getTime();
      if (t >= lastMondayMs && t < thisMondayMs)
        weekRevenue += parseFloat(o.totalPriceSet.shopMoney.amount || "0");
    }

    const week_start    = getLastWeekStart();
    const shopify_amount = Math.round(weekRevenue * 100) / 100;

    await supabase.from("weekly_income").upsert(
      { week_start, source: "shopify", label: "Shopify Revenue", amount: shopify_amount },
      { onConflict: "week_start,source" }
    );

    return NextResponse.json({ shopify_amount, week_start });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
