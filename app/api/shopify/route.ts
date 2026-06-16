import { NextResponse } from "next/server";

const SHOP        = process.env.SHOPIFY_STORE ?? "0eu5zs-gj.myshopify.com";
const TOKEN_URL   = `https://${SHOP}/admin/oauth/access_token`;
const GRAPHQL_URL = `https://${SHOP}/admin/api/2025-01/graphql.json`;

async function getAccessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     process.env.SHOPIFY_CLIENT_ID!,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
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

async function fetchAllOrders(token: string, since: string): Promise<OrderNode[]> {
  const orders: OrderNode[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 40; page++) {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: ORDER_QUERY(since, cursor) }),
    });
    if (!res.ok) throw new Error(`GraphQL failed: ${res.status} ${await res.text()}`);

    const json = (await res.json()) as {
      data: {
        orders: {
          nodes: OrderNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
      errors?: unknown;
    };

    if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);

    const { nodes, pageInfo } = json.data.orders;
    orders.push(...nodes);
    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  return orders;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfWeekMonday(d: Date): number {
  const dow = d.getDay();
  const r = new Date(d);
  r.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime();
}

export async function GET() {
  try {
    const token = await getAccessToken();

    const now       = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;

    const orders = await fetchAllOrders(token, yearStart);

    const todayMs = startOfDay(now);
    const weekMs  = startOfWeekMonday(now);
    const monthMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let todayOrders  = 0;
    let todayRevenue = 0;
    let weekRevenue  = 0;
    let monthRevenue = 0;
    let yearRevenue  = 0;

    for (const o of orders) {
      const t     = new Date(o.createdAt).getTime();
      const price = parseFloat(o.totalPriceSet.shopMoney.amount || "0");
      yearRevenue += price;
      if (t >= monthMs) monthRevenue += price;
      if (t >= weekMs)  weekRevenue  += price;
      if (t >= todayMs) { todayRevenue += price; todayOrders++; }
    }

    const r2 = (n: number) => Math.round(n * 100) / 100;

    return NextResponse.json({
      todayOrders,
      todayRevenue:  r2(todayRevenue),
      weekRevenue:   r2(weekRevenue),
      monthRevenue:  r2(monthRevenue),
      yearRevenue:   r2(yearRevenue),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
