import { NextResponse } from "next/server";

const SHOP        = process.env["SHOPIFY_STORE"] ?? "0eu5zs-gj.myshopify.com";
const TOKEN_URL   = `https://${SHOP}/admin/oauth/access_token`;
const GRAPHQL_URL = `https://${SHOP}/admin/api/2025-01/graphql.json`;

async function getAccessToken(): Promise<string> {
  const clientId     = process.env["SHOPIFY_CLIENT_ID"];
  const clientSecret = process.env["SHOPIFY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing env vars — SHOPIFY_CLIENT_ID: ${clientId ? "set" : "MISSING"}, ` +
      `SHOPIFY_CLIENT_SECRET: ${clientSecret ? "set" : "MISSING"}`
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function shopifyGql<T>(token: string, query: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function tzMidnight(year: number, month: number, day: number, tz: string): number {
  const noonUTC = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUTC));
  const n = (t: string) =>
    parseInt(parts.find((p) => p.type === t)!.value.replace(/^24$/, "0"));
  const localSecs = n("hour") * 3600 + n("minute") * 60 + n("second");
  const dayDiff   = Math.round(
    (Date.UTC(n("year"), n("month") - 1, n("day")) - Date.UTC(year, month - 1, day))
    / 86_400_000
  );
  return noonUTC - localSecs * 1000 - dayDiff * 86_400_000;
}

function localNow(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  }).formatToParts(now);
  const n  = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
    .indexOf(parts.find((p) => p.type === "weekday")!.value);
  return { year: n("year"), month: n("month"), day: n("day"), weekday: wd };
}

interface OrderNode {
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string } };
}

const ORDER_QUERY = (since: string, after: string | null) => `{
  orders(
    first: 250
    query: "created_at:>=${since}"
    sortKey: CREATED_AT
    ${after ? `after: "${after}"` : ""}
  ) {
    nodes {
      createdAt
      totalPriceSet { shopMoney { amount } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type OrdersPage = {
  orders: { nodes: OrderNode[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
};

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

    const { shop: { ianaTimezone: tz } } = await shopifyGql<{
      shop: { ianaTimezone: string };
    }>(token, `{ shop { ianaTimezone } }`);

    const now                           = new Date();
    const { year, month, day, weekday } = localNow(now, tz);

    const yearStartISO = new Date(tzMidnight(year, 1, 1, tz)).toISOString();
    const orders       = await fetchAllOrders(token, yearStartISO);

    const todayMs        = tzMidnight(year, month, day, tz);
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    const weekMs         = todayMs - daysFromMonday * 86_400_000;
    const monthMs        = tzMidnight(year, month, 1, tz);

    let dailyRevenue = 0,   dailyOrders = 0;
    let weeklyRevenue = 0,  weeklyOrders = 0;
    let monthlyRevenue = 0, monthlyOrders = 0;

    for (const o of orders) {
      const t     = new Date(o.createdAt).getTime();
      const price = parseFloat(o.totalPriceSet.shopMoney.amount || "0");
      if (t >= monthMs) { monthlyRevenue += price; monthlyOrders++; }
      if (t >= weekMs)  { weeklyRevenue  += price; weeklyOrders++;  }
      if (t >= todayMs) { dailyRevenue   += price; dailyOrders++;   }
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;

    return NextResponse.json({
      daily:   { revenue: r2(dailyRevenue),   orders: dailyOrders   },
      weekly:  { revenue: r2(weeklyRevenue),  orders: weeklyOrders  },
      monthly: { revenue: r2(monthlyRevenue), orders: monthlyOrders },
    });
  } catch (err) {
    console.error("[shopify-actuals]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
