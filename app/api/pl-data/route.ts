import { NextResponse } from "next/server";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyclULYE4cne1p9lGVUrGRw-9Rbefo0o32aDkbgDHFs6GE1M5OUu0F1veojfP0x3N-O/exec?action=getAll";

const SUPABASE_URL = "https://nwxokxjytgplygwbzsla.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53eG9reGp5dGdwbHlnd2J6c2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMzk5MzMsImV4cCI6MjA1ODYxNTkzM30.bgfkoMQAucIBGrDiXORi9F40iy9rQiHKTI8HxCfkUO8";

type Row = {
  date: string;
  sales: number;
  cogs: number;
  adspend: number;
  hidden: boolean | string;
  product: string;
  created_at: string;
};

export async function GET() {
  try {
    const [supaRes, scriptRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/active_product?id=eq.1&select=product_name`, {
        cache: "no-store",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      }),
      fetch(APPS_SCRIPT_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    ]);

    if (!scriptRes.ok) throw new Error(`Apps Script returned ${scriptRes.status}`);
    const scriptData: { rows?: Row[]; error?: string } = await scriptRes.json();
    if (scriptData.error) throw new Error(scriptData.error);

    let activeProduct = "";
    if (supaRes.ok) {
      const supaData = await supaRes.json();
      activeProduct = (supaData?.[0]?.product_name ?? "").trim();
    }

    const allRows: Row[] = scriptData.rows ?? [];
    const visibleRows = allRows.filter(
      (r) => r.hidden !== true && r.hidden !== "true" && r.product
    );

    if (!activeProduct) {
      let bestDate = "";
      for (const r of visibleRows) {
        if ((r.created_at ?? "") > bestDate) { bestDate = r.created_at; activeProduct = r.product; }
      }
    }

    const now = new Date();
    const rows = visibleRows.filter((r) => {
      if (r.product.trim().toLowerCase() !== activeProduct.toLowerCase()) return false;
      const d = new Date(r.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });

    const revenue = rows.reduce((s, r) => s + (r.sales ?? 0), 0);
    const cogs = rows.reduce((s, r) => s + (r.cogs ?? 0), 0);
    const adSpend = rows.reduce((s, r) => s + (r.adspend ?? 0), 0);
    const grossProfit = revenue - cogs;
    const roas = adSpend > 0 ? revenue / adSpend : 0;
    const gpPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    return NextResponse.json({
      revenue,
      cogs,
      adSpend,
      grossProfit,
      roas,
      gpPercent,
      activeProduct,
      fetchedAt: Date.now(),
      rowCount: rows.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
