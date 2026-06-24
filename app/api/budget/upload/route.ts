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

type Bank = "CBA" | "ING" | "AMEX" | "CBA_SINGLE" | "CBA_HEADERLESS";

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

function getLastWeekStartAEST(): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y  = Number(parts.find((p) => p.type === "year")!.value);
  const mo = Number(parts.find((p) => p.type === "month")!.value);
  const d  = Number(parts.find((p) => p.type === "day")!.value);

  const aestDate = new Date(y, mo - 1, d);
  const dow  = aestDate.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;

  // Use local date accessors — NOT toISOString() — to avoid the UTC midnight shift
  const lastMon = new Date(y, mo - 1, d + diff - 7);
  const ly = lastMon.getFullYear();
  const lm = String(lastMon.getMonth() + 1).padStart(2, "0");
  const ld = String(lastMon.getDate()).padStart(2, "0");
  return `${ly}-${lm}-${ld}`;
}

// CBA headerless: debit-side movements to skip (credits handled separately)
const CBA_DEBIT_SKIP = ["TRANSFER TO ING", "MONTHLY FEE"];

interface Transaction {
  upload_date: string;
  week_start: string;
  bank: string;
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

  // Step 1: try header-based detection (ING, Amex, CBA_SINGLE)
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

  let bank: Bank | null = null;
  let isCbaHeaderless = false;
  let dataStartIdx = 0;
  const colIdx: Record<string, number> = {};

  if (headerLineIdx !== -1) {
    // Header-based format
    bank = detectBank(headerRow);
    if (!bank)
      return NextResponse.json({ error: "Unknown bank format. Expected CBA, ING, CBA (single-amount), or Amex CSV headers" }, { status: 400 });
    dataStartIdx = headerLineIdx + 1;
    headerRow.forEach((h, i) => {
      const key = h.toLowerCase().trim();
      if (key === "date") colIdx.date = i;
      else if (key === "description") colIdx.description = i;
      else if (key === "appears on your statement as") colIdx.description = i;
      else if (key === "debit") colIdx.debit = i;
      else if (key === "credit") colIdx.credit = i;
      else if (key === "amount") colIdx.amount = i;
    });
  } else {
    // Headerless sniff: col 0 of first non-empty row must be a DD/MM/YYYY date → CBA export
    let firstDataLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { firstDataLine = i; break; }
    }
    if (firstDataLine === -1)
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    const sampleCols = parseCSVLine(lines[firstDataLine]);
    if (!parseDateToISO(sampleCols[0] ?? ""))
      return NextResponse.json({ error: "Could not detect CSV format — no recognised headers and first column is not a date" }, { status: 400 });
    bank = "CBA_HEADERLESS";
    isCbaHeaderless = true;
    dataStartIdx = firstDataLine;
  }

  const currentWeekStart = getLastWeekStartAEST();
  const [ws_y, ws_m, ws_d] = currentWeekStart.split("-").map(Number);
  const weekEndDate = new Date(ws_y, ws_m - 1, ws_d + 6);
  const currentWeekEnd = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, "0")}-${String(weekEndDate.getDate()).padStart(2, "0")}`;
  console.log(`[upload] week window: ${currentWeekStart} (Mon) → ${currentWeekEnd} (Sun)`);
  const today = new Date().toISOString().split("T")[0];
  const thisWeekTransactions: Transaction[] = [];
  let total_parsed = 0;
  let skipped_outside_week = 0;
  // Accumulate CUSTM salary credits to upsert into weekly_income after the loop
  let salaryTotal = 0;

  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);

    let dateStr: string;
    let description: string;
    let amount: number | null = null;

    if (isCbaHeaderless) {
      // Format A (4 cols): date, amount, description, balance — col 3 is running balance, ignored
      // Format B (3 cols): date, amount, description
      dateStr = cols[0] ?? "";
      description = (cols[2] ?? "").trim();
      const rawAmount = parseAmount(cols[1] ?? "");
      if (!dateStr || !description || rawAmount === null || rawAmount === 0) continue;

      const upper = description.toUpperCase();

      if (rawAmount > 0) {
        // Credit: capture CUSTM salary; ignore all other credits
        if (upper.includes("DIRECT CREDIT") && upper.includes("CUSTM")) {
          const isoDate = parseDateToISO(dateStr);
          if (isoDate && getMondayOfDate(isoDate) === currentWeekStart) {
            salaryTotal += rawAmount;
          }
        }
        continue; // credits never go into weekly_transactions
      }

      // Debit: skip internal movements
      if (CBA_DEBIT_SKIP.some((s) => upper.includes(s))) continue;
      amount = rawAmount;
    } else {
      dateStr = cols[colIdx.date] ?? "";
      description = (cols[colIdx.description] ?? "").replace(/^"(.*)"$/, "$1").trim();
      if (!dateStr || !description) continue;

      if (bank === "AMEX") {
        const parsed = parseAmount(cols[colIdx.amount] ?? "");
        if (parsed === null) continue;
        amount = -parsed;
      } else if (bank === "CBA_SINGLE") {
        const parsed = parseAmount(cols[colIdx.amount] ?? "");
        if (parsed === null || parsed === 0) continue;
        amount = parsed;
      } else {
        const debit = parseAmount(cols[colIdx.debit] ?? "");
        const credit = parseAmount(cols[colIdx.credit] ?? "");
        if (debit !== null && Math.abs(debit) > 0) amount = -Math.abs(debit);
        else if (credit !== null && Math.abs(credit) > 0) amount = Math.abs(credit);
        else continue;
      }
    }

    const isoDate = parseDateToISO(dateStr);
    if (!isoDate || amount === null) continue;

    total_parsed++;

    const weekStart = getMondayOfDate(isoDate);
    if (weekStart !== currentWeekStart) {
      skipped_outside_week++;
      continue;
    }

    const storedBank = isCbaHeaderless ? "cba" : (bank as string);
    const transaction_hash = createHash("sha256")
      .update(`${isoDate}|${description}|${amount}|${storedBank}`)
      .digest("hex");

    thisWeekTransactions.push({
      upload_date: today,
      week_start: weekStart,
      bank: storedBank,
      description,
      amount,
      category: amount < 0 ? categorize(description) : "other",
      transaction_hash,
    });
  }

  if (total_parsed === 0)
    return NextResponse.json({ error: "No valid transactions found in CSV" }, { status: 400 });

  // Dedup: check which this-week hashes already exist in DB
  const allHashes = thisWeekTransactions.map((t) => t.transaction_hash);
  const existingHashes = new Set<string>();
  if (allHashes.length > 0) {
    const { data: existingRows } = await supabase
      .from("weekly_transactions")
      .select("transaction_hash")
      .in("transaction_hash", allHashes);
    (existingRows ?? []).forEach((r) => existingHashes.add(r.transaction_hash as string));
  }

  const newTransactions = thisWeekTransactions.filter((t) => !existingHashes.has(t.transaction_hash));
  const skipped_duplicates = thisWeekTransactions.length - newTransactions.length;

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

  // Upsert CUSTM salary into weekly_income if found
  if (salaryTotal > 0) {
    await supabase.from("weekly_income").upsert(
      { week_start: currentWeekStart, source: "salary", label: "CUSTM Salary", amount: Math.round(salaryTotal * 100) / 100 },
      { onConflict: "week_start,source" }
    );
  }

  const displayBank = isCbaHeaderless ? "cba" : (bank as string);

  return NextResponse.json({
    inserted: newTransactions.length,
    skipped_duplicates,
    skipped_outside_week,
    total_parsed,
    bank: displayBank,
    weeksAffected: [...new Set(newTransactions.map((t) => t.week_start))],
    expenseCount,
    incomeCount,
    categoryCounts,
  });
}
