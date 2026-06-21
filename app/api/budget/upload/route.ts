import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

const CATEGORIES = ["Groceries", "Eating Out", "Transport", "Utilities", "Shopping", "Health", "Other"] as const;
type Category = typeof CATEGORIES[number];

const KEYWORD_MAP: Record<Category, string[]> = {
  Groceries: [
    "woolworths", "coles", "aldi", "iga", "costco", "harris farm", "foodland",
    "supermarket", "grocery", "spar", "fresh market",
  ],
  "Eating Out": [
    "mcdonald", "kfc", "hungry jacks", "subway", "domino", "pizza",
    "starbucks", "gloria jean", "cafe", "coffee", "restaurant", "kebab",
    "sushi", "oporto", "guzman", "nando", "uber eats", "deliveroo",
    "doordash", "menulog", "hey you", "diner", "bistro", "takeaway",
  ],
  Transport: [
    "bp ", "shell", "ampol", "caltex", "7-eleven", "petrol", "fuel",
    "opal card", "myki", "translink", "ptc", "tfnsw",
    "uber", "ola ", "didi", "lyft", "taxi", "13cabs",
    "parking", "wilsons parking", "secure parking", "toll",
    "jetstar", "qantas", "virgin australia", "tigerair", "rex airline",
  ],
  Utilities: [
    "origin energy", "agl ", "energy australia", "electricity", "jemena",
    "telstra", "optus", "vodafone", "tpg", "iinet", "aussie broadband",
    "internode", "internet", "nbn",
    "sydney water", "water corp", "yarra valley water", "sa water",
    "council", "rates",
  ],
  Shopping: [
    "amazon", "ebay", "kmart", "target", "big w", "myer", "david jones",
    "cotton on", "h&m", "zara", "uniqlo", "ikea", "harvey norman",
    "jb hi-fi", "officeworks", "apple store", "samsung", "the iconic",
    "asos", "shein", "booktopia",
  ],
  Health: [
    "chemist", "pharmacy", "priceline", "amcal", "terry white",
    "doctor", "gp ", "medical centre", "medical center", "dental", "dentist",
    "hospital", "medicare", "healthscope",
    "medibank", "bupa", "ahm ", "nib ", "hcf ",
    "gym", "anytime fitness", "planet fitness", "f45", "crossfit",
    "physio", "optometrist", "pathology", "radiology",
  ],
  Other: [],
};

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

type Bank = "CBA" | "ING" | "AMEX";

function detectBank(headers: string[]): Bank | null {
  const h = headers.map((x) => x.toLowerCase().replace(/[^a-z]/g, ""));
  if (h.includes("amount") && !h.includes("debit") && !h.includes("credit")) return "AMEX";
  if (h.includes("debit") && h.includes("credit")) {
    const debitIdx = headers.findIndex((x) => x.toLowerCase().includes("debit"));
    const creditIdx = headers.findIndex((x) => x.toLowerCase().includes("credit"));
    return debitIdx < creditIdx ? "CBA" : "ING";
  }
  return null;
}

function parseDateToISO(dateStr: string): string | null {
  const s = dateStr.trim();
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function getMondayOfDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return date.toISOString().split("T")[0];
}

function categorize(description: string): Category {
  const lower = description.toLowerCase();
  for (const [cat, keywords] of Object.entries(KEYWORD_MAP) as [Category, string[]][]) {
    if (cat === "Other") continue;
    if (keywords.some((k) => lower.includes(k))) return cat;
  }
  return "Other";
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

interface Transaction {
  upload_date: string;
  week_start: string;
  bank: Bank;
  description: string;
  amount: number;
  category: Category;
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const text = await file.text();
  const lines = text.split(/\r?\n/);

  // Find header row (first row containing both "date" and "description")
  let headerRow: string[] = [];
  let headerLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("date") && lower.includes("description")) {
      headerRow = parseCSVLine(lines[i]);
      headerLineIdx = i;
      break;
    }
  }

  if (headerLineIdx === -1) {
    return NextResponse.json({ error: "Could not detect CSV format — no header row found" }, { status: 400 });
  }

  const bank = detectBank(headerRow);
  if (!bank) {
    return NextResponse.json({ error: "Unknown bank format. Expected CBA, ING, or Amex CSV headers" }, { status: 400 });
  }

  // Build column index map
  const colIdx: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    if (key === "date") colIdx.date = i;
    else if (key === "description") colIdx.description = i;
    else if (key === "debit") colIdx.debit = i;
    else if (key === "credit") colIdx.credit = i;
    else if (key === "amount") colIdx.amount = i;
  });

  const today = new Date().toISOString().split("T")[0];
  const transactions: Transaction[] = [];

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);

    const dateStr = cols[colIdx.date] ?? "";
    const description = (cols[colIdx.description] ?? "").replace(/^"(.*)"$/, "$1").trim();
    if (!dateStr || !description) continue;

    const isoDate = parseDateToISO(dateStr);
    if (!isoDate) continue;

    let amount: number | null = null;

    if (bank === "AMEX") {
      const parsed = parseAmount(cols[colIdx.amount] ?? "");
      if (parsed === null) continue;
      amount = -parsed; // Amex positive = charge (expense), negative = credit (income)
    } else {
      const debit = parseAmount(cols[colIdx.debit] ?? "");
      const credit = parseAmount(cols[colIdx.credit] ?? "");
      if (debit !== null && Math.abs(debit) > 0) {
        amount = -Math.abs(debit);
      } else if (credit !== null && Math.abs(credit) > 0) {
        amount = Math.abs(credit);
      } else {
        continue;
      }
    }

    transactions.push({
      upload_date: today,
      week_start: getMondayOfDate(isoDate),
      bank,
      description,
      amount,
      category: amount < 0 ? categorize(description) : "Other",
    });
  }

  if (transactions.length === 0) {
    return NextResponse.json({ error: "No valid transactions found in CSV" }, { status: 400 });
  }

  // Insert in batches of 100
  for (let i = 0; i < transactions.length; i += 100) {
    const { error } = await supabase.from("weekly_transactions").insert(transactions.slice(i, i + 100));
    if (error) {
      return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 });
    }
  }

  // Recompute weekly_summary for all affected weeks
  const affectedWeeks = [...new Set(transactions.map((t) => t.week_start))];
  for (const weekStart of affectedWeeks) {
    const { data: rows } = await supabase
      .from("weekly_transactions")
      .select("category, amount")
      .eq("week_start", weekStart);

    if (!rows) continue;

    const totals: Record<string, { total: number; count: number }> = {};
    for (const row of rows) {
      if (row.amount >= 0) continue;
      if (!totals[row.category]) totals[row.category] = { total: 0, count: 0 };
      totals[row.category].total += Math.abs(row.amount);
      totals[row.category].count += 1;
    }

    const summaryRows = Object.entries(totals).map(([category, { total, count }]) => ({
      week_start: weekStart,
      category,
      total_amount: Math.round(total * 100) / 100,
      transaction_count: count,
    }));

    if (summaryRows.length > 0) {
      await supabase.from("weekly_summary").upsert(summaryRows, { onConflict: "week_start,category" });
    }
  }

  const categoryCounts: Record<string, number> = {};
  let incomeCount = 0;
  let expenseCount = 0;
  for (const t of transactions) {
    if (t.amount >= 0) { incomeCount++; continue; }
    expenseCount++;
    categoryCounts[t.category] = (categoryCounts[t.category] ?? 0) + 1;
  }

  return NextResponse.json({ imported: transactions.length, bank, weeksAffected: affectedWeeks, expenseCount, incomeCount, categoryCounts });
}
