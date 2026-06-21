import { NextResponse } from "next/server";
import { supabase, getWeekStart } from "../../../lib/supabase";

const PANEL_KEYS = ["housing", "transport", "groceries", "eating_out", "subscriptions", "ecom"] as const;
type PanelKey = typeof PANEL_KEYS[number];

function mapToPanel(raw: string): PanelKey | null {
  const key = raw.toLowerCase().trim();
  return (PANEL_KEYS as readonly string[]).includes(key) ? (key as PanelKey) : null;
}

function emptyPanel(): Record<PanelKey, number> {
  return Object.fromEntries(PANEL_KEYS.map((k) => [k, 0])) as Record<PanelKey, number>;
}

function aggregate(rows: { category: string; amount: number }[]): {
  categories: Record<PanelKey, number>;
  income: number;
} {
  const categories = emptyPanel();
  let income = 0;
  for (const { category, amount } of rows) {
    if (amount > 0) {
      income += amount;
    } else {
      const key = mapToPanel(category);
      if (key) categories[key] += Math.abs(amount);
    }
  }
  for (const k of PANEL_KEYS) {
    categories[k] = Math.round(categories[k] * 100) / 100;
  }
  return { categories, income: Math.round(income * 100) / 100 };
}

export async function GET() {
  const weekStart = getWeekStart();

  const prevDate = new Date(weekStart);
  prevDate.setDate(prevDate.getDate() - 7);
  const prevWeekStart = prevDate.toISOString().split("T")[0];

  const [{ data: currentRows }, { data: prevRows }, { data: lastRow }, { data: balanceRow }] = await Promise.all([
    supabase.from("weekly_transactions").select("category, amount").eq("week_start", weekStart),
    supabase.from("weekly_transactions").select("category, amount").eq("week_start", prevWeekStart),
    supabase
      .from("weekly_transactions")
      .select("created_at")
      .eq("week_start", weekStart)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("weekly_balance")
      .select("balance, week_start")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { categories, income } = aggregate(currentRows ?? []);
  const { categories: prevWeek } = aggregate(prevRows ?? []);

  return NextResponse.json({
    week_start: weekStart,
    categories,
    prevWeek,
    income,
    balance: balanceRow
      ? { value: Number(balanceRow.balance), week_start: balanceRow.week_start as string }
      : null,
    last_updated: (lastRow ?? [])[0]?.created_at ?? null,
  });
}
