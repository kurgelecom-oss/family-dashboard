import { NextResponse } from "next/server";

const COMPOSIO_API_KEY  = process.env.COMPOSIO_API_KEY!;
const SHOPIFY_ACCOUNT   = process.env.SHOPIFY_ACCOUNT_ID ?? "shopify_heedy-busine";
const COMPOSIO_ENDPOINT = "https://backend.composio.dev/api/v2/actions/SHOPIFY_LIST_ORDER/execute";

function startOfDay(d: Date) {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function mondayOfWeek(d: Date) {
  const r = new Date(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}

function extractOrders(res: unknown): Array<{ created_at: string; total_price: string }> {
  const d = (res as Record<string, unknown>)?.data ?? {};
  const inner = (d as Record<string, unknown>);
  if (Array.isArray(inner?.orders)) return inner.orders as never;
  const d2 = (inner?.data ?? {}) as Record<string, unknown>;
  if (Array.isArray(d2?.orders)) return d2.orders as never;
  return [];
}

export async function GET() {
  try {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

    const res = await fetch(COMPOSIO_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": COMPOSIO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          created_at_min: yearStart,
          status: "any",
          limit: 250,
          fields: "id,created_at,total_price",
        },
        connectedAccountId: SHOPIFY_ACCOUNT,
      }),
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Composio ${res.status}: ${text}` }, { status: res.status });
    }

    const json = await res.json();
    const orders = extractOrders(json);

    const todayMs  = startOfDay(now).getTime();
    const weekMs   = mondayOfWeek(now).getTime();
    const monthMs  = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let todayOrders = 0, todayRevenue = 0, weekRevenue = 0, monthRevenue = 0, yearRevenue = 0;

    for (const o of orders) {
      const t = new Date(o.created_at).getTime();
      const price = parseFloat(o.total_price || "0");
      yearRevenue  += price;
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
