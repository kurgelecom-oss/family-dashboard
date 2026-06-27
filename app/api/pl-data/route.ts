import { NextResponse } from "next/server";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyclULYE4cne1p9lGVUrGRw-9Rbefo0o32aDkbgDHFs6GE1M5OUu0F1veojfP0x3N-O/exec?action=getAll";

type Row = {
  date: string;
  sales: number;
  cogs: number;
  adspend: number;
  hidden: boolean | string;
};

export async function GET() {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
    const data: { rows?: Row[]; error?: string } = await res.json();
    if (data.error) throw new Error(data.error);

    const now = new Date();
    const rows: Row[] = (data.rows ?? []).filter((r) => {
      if (r.hidden === true || r.hidden === "true") return false;
      const d = new Date(r.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });

    const revenue = rows.reduce((s, r) => s + (r.sales ?? 0), 0);
    const cogs = rows.reduce((s, r) => s + (r.cogs ?? 0), 0);
    const adSpend = rows.reduce((s, r) => s + (r.adspend ?? 0), 0);
    const grossProfit = revenue - cogs;
    const roas = adSpend > 0 ? revenue / adSpend : undefined;
    const gpPercent = revenue > 0 ? (grossProfit / revenue) * 100 : undefined;

    return NextResponse.json({
      revenue,
      cogs,
      grossProfit,
      adSpend,
      roas,
      gpPercent,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
