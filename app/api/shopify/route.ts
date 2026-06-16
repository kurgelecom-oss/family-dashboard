import { NextResponse } from "next/server";

const STORE = process.env.SHOPIFY_STORE!;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function mondayOfWeek(d: Date) {
  const r = new Date(d);
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  r.setHours(0, 0, 0, 0);
  return r;
}

async function fetchOrders(sinceIso: string) {
  const url =
    `https://${STORE}/admin/api/2024-07/orders.json` +
    `?status=any&created_at_min=${sinceIso}&limit=250` +
    `&fields=id,created_at,total_price`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": TOKEN },
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json.orders as Array<{ created_at: string; total_price: string }>;
}

export async function GET() {
  try {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const orders = await fetchOrders(yearStart.toISOString());

    const todayStart = startOfDay(now).getTime();
    const weekStart = mondayOfWeek(now).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    let todayOrders = 0;
    let todayRevenue = 0;
    let weekRevenue = 0;
    let monthRevenue = 0;
    let yearRevenue = 0;

    for (const o of orders) {
      const t = new Date(o.created_at).getTime();
      const price = parseFloat(o.total_price || "0");
      yearRevenue += price;
      if (t >= monthStart) monthRevenue += price;
      if (t >= weekStart) weekRevenue += price;
      if (t >= todayStart) { todayRevenue += price; todayOrders++; }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return NextResponse.json({
      todayOrders,
      todayRevenue:  round2(todayRevenue),
      weekRevenue:   round2(weekRevenue),
      monthRevenue:  round2(monthRevenue),
      yearRevenue:   round2(yearRevenue),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
