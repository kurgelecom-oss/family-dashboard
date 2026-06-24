import { NextResponse } from "next/server";
import { supabase, getLastWeekStart } from "../../lib/supabase";

export async function GET() {
  const week_start = getLastWeekStart();

  const [{ data: incomeRows }, { data: txRows }] = await Promise.all([
    supabase.from("weekly_income").select("source, label, amount").eq("week_start", week_start),
    supabase.from("weekly_transactions").select("amount").eq("week_start", week_start),
  ]);

  const income_breakdown = (incomeRows ?? []).map((r) => ({
    source: r.source as string,
    label:  r.label  as string,
    amount: Number(r.amount),
  }));

  const total_income = income_breakdown.reduce((s, r) => s + r.amount, 0);
  const total_spend  = (txRows ?? [])
    .filter((r) => Number(r.amount) < 0)
    .reduce((s, r) => s + Math.abs(Number(r.amount)), 0);

  const net = Math.round((total_income - total_spend) * 100) / 100;

  return NextResponse.json({
    total_income: Math.round(total_income * 100) / 100,
    total_spend:  Math.round(total_spend  * 100) / 100,
    net,
    surplus: net > 0,
    income_breakdown,
  });
}
