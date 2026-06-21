import { NextResponse } from "next/server";
import { supabase, getWeekStart } from "../../../lib/supabase";

const CATS = ["housing", "food", "transport", "utilities", "software", "ecommerce", "annual"] as const;
type CatKey = typeof CATS[number];

function sumByCategory(rows: { category: string; amount: number }[]): Record<CatKey, number> {
  const out = Object.fromEntries(CATS.map((c) => [c, 0])) as Record<CatKey, number>;
  for (const r of rows) {
    if (r.category in out) out[r.category as CatKey] += r.amount;
  }
  return out;
}

export async function GET() {
  const weekStart = getWeekStart();

  const prevDate = new Date(weekStart);
  prevDate.setDate(prevDate.getDate() - 7);
  const prevWeekStart = prevDate.toISOString().split("T")[0];

  const [
    { data: currentEntries },
    { data: prevEntries },
    { data: incomeTxns },
    { data: lastRow },
  ] = await Promise.all([
    supabase.from("budget_entries").select("category, amount").eq("week_start", weekStart),
    supabase.from("budget_entries").select("category, amount").eq("week_start", prevWeekStart),
    supabase.from("weekly_transactions").select("amount").eq("week_start", weekStart).gt("amount", 0),
    supabase
      .from("budget_entries")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const income = (incomeTxns ?? []).reduce((s, t: { amount: number }) => s + t.amount, 0);

  return NextResponse.json({
    week_start: weekStart,
    categories: sumByCategory(currentEntries ?? []),
    prevWeek: sumByCategory(prevEntries ?? []),
    income: Math.round(income * 100) / 100,
    last_updated: (lastRow ?? [])[0]?.created_at ?? null,
  });
}
