import { NextResponse } from "next/server";
import { supabase, getWeekStart } from "../../../lib/supabase";

const PANEL_KEYS = ["housing", "food", "transport", "utilities", "software", "ecommerce", "annual"] as const;
type PanelKey = typeof PANEL_KEYS[number];

// Maps the category text stored in weekly_transactions to a panel key.
// Returns null for categories that don't belong in any panel slot (e.g. "Other").
function mapToPanel(raw: string): PanelKey | null {
  switch (raw.toLowerCase().trim()) {
    case "housing":
    case "rent":
    case "mortgage":
      return "housing";

    case "food":
    case "groceries":
    case "grocery":
    case "eating out":
    case "dining":
    case "restaurant":
      return "food";

    case "transport":
    case "transportation":
    case "travel":
      return "transport";

    case "utilities":
    case "utility":
      return "utilities";

    case "software":
    case "subscriptions":
    case "subscription":
      return "software";

    case "ecommerce":
    case "shopping":
      return "ecommerce";

    case "annual":
    case "annual subs":
    case "health":
      return "annual";

    default:
      return null;
  }
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
  // Round every bucket to 2dp
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
    supabase.from("weekly_balance").select("balance").eq("week_start", weekStart).maybeSingle(),
  ]);

  const { categories, income } = aggregate(currentRows ?? []);
  const { categories: prevWeek } = aggregate(prevRows ?? []);

  return NextResponse.json({
    week_start: weekStart,
    categories,
    prevWeek,
    income,
    weekly_balance: balanceRow?.balance ?? null,
    last_updated: (lastRow ?? [])[0]?.created_at ?? null,
  });
}
