import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabase } from "../../../lib/supabase";

type Category = "housing" | "transport" | "groceries" | "eating_out" | "subscriptions" | "ecom" | "other";

function categorize(description: string): Category {
  const d = description.toUpperCase();

  if (d.includes("AGL") || d.includes("YARRA VALLEY") || d.includes("JK ESTATE") ||
      d.includes("BPAYN") || d.includes("WATER"))
    return "housing";

  if (d.includes("7-ELEVEN") || d.includes("EG FUELCO") || d.includes("LINKT") ||
      d.includes("AAMI") || d.includes("VICROADS") || d.includes("SUPERCHEAP AUTO"))
    return "transport";

  if (d.includes("COLES ONLINE") || d.includes("WOOLWORTHS") || d.includes("MILKRUN") ||
      d.includes("COLES - COBURG"))
    return "groceries";

  if (d.includes("MCDONALD") || d.includes("DOORDASH") || d.includes("PIZZA") ||
      d.includes("SUEY PTY") || d.includes("STALACTIT") || d.includes("BRUNETTI") ||
      d.includes("HIGHER GROUND") || d.includes("LE PETIT CHATEAU") || d.includes("CANONI") ||
      d.includes("DAWSON ST") || d.includes("DCO") || d.includes("ZLR") || d.includes("MANINI") ||
      d.includes("HAIGH") || d.includes("JOE S PANTRY") || d.includes("DALLAS HOT BREAD") ||
      d.includes("ADOZEN") || d.includes("WINDCAVE"))
    return "eating_out";

  if (d.includes("APPLE.COM") || d.includes("PLAYSTATION") || d.includes("STAN.COM") ||
      d.includes("MAKE.COM") || d.includes("RAYCAST") || d.includes("INCOGNITON") ||
      d.includes("NOTION") || d.includes("YOUTUBE") || d.includes("MICROSOFT") ||
      d.includes("ANTHROPIC") || d.includes("NETLIFY") || d.includes("CANVA") ||
      d.includes("GOOGLE") || d.includes("PRIME VIDE") || d.includes("HUSHED") ||
      d.includes("MPP") || d.includes("PADDLE"))
    return "subscriptions";

  if (d.includes("SHOPIFY") || d.includes("HIGGSFIELD") || d.includes("ECOM ELIXIR") ||
      d.includes("LAUNCHGOOD") || d.includes("HASENE") || d.includes("IBC ISLAMIC") ||
      d.includes("SP HASENE"))
    return "ecom";

  return "other";
}

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

type Bank = "CBA" | "ING" | "AMEX" | "CBA_SINGLE";

function detectBank(headers: string[]): Bank | null {
  const h = headers.map((x) => x.toLowerCase().replace(/[^a-z]/g, ""));
  const raw = headers.map((x) => x.toLowerCase().trim());
  // CBA_SINGLE: "Date, Amount, Appears On Your Statement As" — single signed amount column
  if (raw.some((x) => x.includes("appears on your statement as"))) return "CBA_SINGLE";
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
  transaction_hash: string;
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

  let headerRow: string[] = [];
  let headerLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes("date") && (lower.includes("description") || lower.includes("appears on your statement as"))) {
      headerRow = parseCSVLine(lines[i]);
      headerLineIdx = i;
      break;
    }
  }

  if (headerLineIdx === -1)
    return NextResponse.json({ error: "Could not detect CSV format — no header row found" }, { status: 400 });

  const bank = detectBank(headerRow);
  if (!bank)
    return NextResponse.json({ error: "Unknown bank format. Expected CBA, ING, CBA (single-amount), or Amex CSV headers" }, { status: 400 });

  const colIdx: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    if (key === "date") colIdx.date = i;
    else if (key === "description") colIdx.description = i;
    else if (key === "appears on your statement as") colIdx.description = i;
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
      amount = -parsed;
    } else if (bank === "CBA_SINGLE") {
      const parsed = parseAmount(cols[colIdx.amount] ?? "");
      if (parsed === null || parsed === 0) continue;
      amount = parsed; // already signed: negative = expense, positive = income
    } else {
      const debit = parseAmount(cols[colIdx.debit] ?? "");
      const credit = parseAmount(cols[colIdx.credit] ?? "");
      if (debit !== null && Math.abs(debit) > 0) amount = -Math.abs(debit);
      else if (credit !== null && Math.abs(credit) > 0) amount = Math.abs(credit);
      else continue;
    }

    const transaction_hash = createHash("sha256")
      .update(`${isoDate}|${description}|${amount}|${bank}`)
      .digest("hex");

    transactions.push({
      upload_date: today,
      week_start: getMondayOfDate(isoDate),
      bank,
      description,
      amount,
      category: amount < 0 ? categorize(description) : "other",
      transaction_hash,
    });
  }

  if (transactions.length === 0)
    return NextResponse.json({ error: "No valid transactions found in CSV" }, { status: 400 });

  // Dedup: fetch which hashes already exist in the DB
  const allHashes = transactions.map((t) => t.transaction_hash);
  const { data: existingRows } = await supabase
    .from("weekly_transactions")
    .select("transaction_hash")
    .in("transaction_hash", allHashes);

  const existingHashes = new Set((existingRows ?? []).map((r) => r.transaction_hash as string));
  const newTransactions = transactions.filter((t) => !existingHashes.has(t.transaction_hash));
  const skipped = transactions.length - newTransactions.length;

  for (let i = 0; i < newTransactions.length; i += 100) {
    const { error } = await supabase.from("weekly_transactions").insert(newTransactions.slice(i, i + 100));
    if (error)
      return NextResponse.json({ error: `Insert failed: ${error.message}` }, { status: 500 });
  }

  const categoryCounts: Record<string, number> = {};
  let incomeCount = 0;
  let expenseCount = 0;
  for (const t of newTransactions) {
    if (t.amount >= 0) { incomeCount++; continue; }
    expenseCount++;
    categoryCounts[t.category] = (categoryCounts[t.category] ?? 0) + 1;
  }

  return NextResponse.json({
    inserted: newTransactions.length,
    skipped,
    total_parsed: transactions.length,
    bank,
    weeksAffected: [...new Set(newTransactions.map((t) => t.week_start))],
    expenseCount,
    incomeCount,
    categoryCounts,
  });
}
