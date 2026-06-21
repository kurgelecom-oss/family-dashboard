import { NextResponse } from "next/server";
import { supabase, getWeekStart } from "../../../lib/supabase";

export async function GET() {
  const weekStart = getWeekStart();

  const prevDate = new Date(weekStart);
  prevDate.setDate(prevDate.getDate() - 7);
  const prevWeekStart = prevDate.toISOString().split("T")[0];

  const [{ data: current }, { data: previous }, { data: incomeTxns }, { data: lastUpdated }] =
    await Promise.all([
      supabase.from("weekly_summary").select("category, total_amount, transaction_count").eq("week_start", weekStart),
      supabase.from("weekly_summary").select("category, total_amount, transaction_count").eq("week_start", prevWeekStart),
      supabase.from("weekly_transactions").select("amount").eq("week_start", weekStart).gt("amount", 0),
      supabase
        .from("weekly_transactions")
        .select("created_at")
        .eq("week_start", weekStart)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

  const totalIncome = (incomeTxns ?? []).reduce((sum, t: { amount: number }) => sum + t.amount, 0);

  return NextResponse.json({
    weekStart,
    prevWeekStart,
    currentWeek: current ?? [],
    previousWeek: previous ?? [],
    totalIncome: Math.round(totalIncome * 100) / 100,
    lastUpdated: (lastUpdated ?? [])[0]?.created_at ?? null,
  });
}
