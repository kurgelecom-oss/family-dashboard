"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, getWeekStart } from "../lib/supabase";

// ── Manual-entry system (existing) ──────────────────────────────────────────

const MANUAL_CATEGORIES = [
  { id: "housing",   label: "Housing",    sub: "Rent + Water",              target: 675.46 },
  { id: "food",      label: "Food",        sub: "Groceries + Eating",        target: 277.15 },
  { id: "transport", label: "Transport",   sub: "Fuel + Insurance + Rego",   target: 194.49 },
  { id: "utilities", label: "Utilities",   sub: "Electricity + Gas + Phone", target: 118.62 },
  { id: "software",  label: "Software",    sub: "Subscriptions",             target: 105.68 },
  { id: "ecommerce", label: "Ecommerce",   sub: "2 stores",                  target: 53.30  },
  { id: "annual",    label: "Annual Subs", sub: "Amortised",                 target: 42.76  },
];
const WEEKLY_TOTAL_TARGET = 1509.11;

type Entry = { id: string; category: string; amount: number; created_at: string };

interface UploadResult {
  imported: number;
  bank: string;
  weeksAffected: string[];
  expenseCount: number;
  incomeCount: number;
  categoryCounts: Record<string, number>;
}

const card: React.CSSProperties = {
  background: "#13161e", border: "1px solid #232736", borderRadius: 8, padding: "16px", marginBottom: 16,
};
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#f0f2f8", marginBottom: 12 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 5,
  background: "#1a1d2e", border: "1px solid #363a52", color: "#f0f2f8", fontSize: 13, outline: "none",
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: "#5a6080", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.07em",
};

export default function BudgetPage() {
  const weekStart = getWeekStart();
  const [weekLabel, setWeekLabel] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");

  const [ingBalance, setIngBalance] = useState("");
  const [ingSaved, setIngSaved] = useState<number | null>(null);
  const [ingSaving, setIngSaving] = useState(false);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCat, setSelectedCat] = useState(MANUAL_CATEGORIES[0].id);
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    const mon = new Date(weekStart);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const label =
      mon.getMonth() === sun.getMonth()
        ? `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}`
        : `${mon.getDate()} ${mon.toLocaleDateString("en-AU", { month: "short" })} – ${sun.getDate()} ${sun.toLocaleDateString("en-AU", { month: "short", year: "numeric" })}`;
    setWeekLabel(label);
  }, [weekStart]);

  useEffect(() => {
    supabase
      .from("weekly_balance")
      .select("balance")
      .eq("week_start", weekStart)
      .maybeSingle()
      .then(({ data }) => { if (data) setIngSaved(Number(data.balance)); });
  }, [weekStart]);

  async function saveIngBalance() {
    const parsed = parseFloat(ingBalance.replace(/[$,]/g, ""));
    if (!ingBalance || isNaN(parsed)) return;
    setIngSaving(true);
    await supabase.from("weekly_balance").upsert(
      { week_start: weekStart, balance: parsed },
      { onConflict: "week_start" }
    );
    setIngSaved(parsed);
    setIngBalance("");
    setIngSaving(false);
  }

  const loadEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from("budget_entries")
      .select("id, category, amount, created_at")
      .eq("week_start", weekStart)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setEntries(data as Entry[]);
      const sums: Record<string, number> = {};
      data.forEach((r: { category: string; amount: number }) => {
        sums[r.category] = (sums[r.category] ?? 0) + r.amount;
      });
      setActuals(sums);
    }
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/budget/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) setUploadError(json.error ?? "Upload failed");
      else setUploadResult(json as UploadResult);
    } catch {
      setUploadError("Network error — try again");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addEntry() {
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("budget_entries")
      .insert({ category: selectedCat, amount: parsed, week_start: weekStart });
    if (!error) {
      setAmount("");
      setToast("Saved!");
      setTimeout(() => setToast(""), 2000);
      loadEntries();
    }
    setSaving(false);
  }

  async function deleteEntry(id: string) {
    await supabase.from("budget_entries").delete().eq("id", id);
    loadEntries();
  }

  const totalSpent = MANUAL_CATEGORIES.reduce((a, c) => a + (actuals[c.id] ?? 0), 0);
  const remaining = WEEKLY_TOTAL_TARGET - totalSpent;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f14", color: "#f0f2f8", fontFamily: "'Inter', sans-serif" }}>

      <header style={{
        background: "#13161e", borderBottom: "1px solid #232736",
        padding: "12px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Home Budget <span style={{ color: "#f59e0b" }}>· Weekly Spend</span>
          </div>
          <div style={{ fontSize: 10, color: "#5a6080", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>
            Week of {weekLabel}
          </div>
        </div>
        <a href="/" style={{
          fontSize: 10, color: "#5a6080", textDecoration: "none", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase",
          background: "#1a1d2e", padding: "4px 10px", borderRadius: 4, border: "1px solid #232736",
        }}>← Dashboard</a>
      </header>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 20px 40px" }}>

        {/* ── CSV UPLOAD ─────────────────────────────────────────── */}
        <div style={card}>
          <div style={sectionTitle}>Import Bank CSV</div>
          <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 12 }}>
            Supports <strong style={{ color: "#8b92b4" }}>CBA</strong>,{" "}
            <strong style={{ color: "#8b92b4" }}>ING</strong>, and{" "}
            <strong style={{ color: "#8b92b4" }}>Amex</strong> CSV exports.
            Transactions are auto-categorised and populate the dashboard panel.
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>CSV File</div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                style={{ ...inputStyle, cursor: "pointer", fontSize: 12, paddingTop: 7 }}
              />
            </div>
            <button
              onClick={handleUpload}
              disabled={uploading}
              style={{
                padding: "8px 20px", borderRadius: 5, border: "none",
                background: uploading ? "#2d3244" : "#00c9ff",
                color: uploading ? "#5a6080" : "#000",
                fontWeight: 700, fontSize: 13,
                cursor: uploading ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {uploading ? "Importing…" : "Import"}
            </button>
          </div>

          {uploadError && (
            <div style={{
              marginTop: 10, padding: "8px 12px",
              background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.3)",
              borderRadius: 5, fontSize: 12, color: "#e74c3c",
            }}>
              {uploadError}
            </div>
          )}

          {uploadResult && (
            <div style={{
              marginTop: 12, padding: "10px 12px",
              background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.25)",
              borderRadius: 5,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2ecc71", marginBottom: 6 }}>
                Imported {uploadResult.imported} transactions from {uploadResult.bank}
              </div>
              <div style={{ fontSize: 11, color: "#5a6080", marginBottom: 8 }}>
                {uploadResult.expenseCount} expenses · {uploadResult.incomeCount} income rows ·{" "}
                {uploadResult.weeksAffected.length} week{uploadResult.weeksAffected.length !== 1 ? "s" : ""} updated
              </div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
                {Object.entries(uploadResult.categoryCounts).map(([cat, count]) => (
                  <span key={cat} style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 12,
                    background: "#1a1d2e", color: "#8b92b4", border: "1px solid #363a52",
                  }}>
                    {cat}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── ING BALANCE ────────────────────────────────────────── */}
        <div style={card}>
          <div style={sectionTitle}>ING Balance</div>
          {ingSaved != null && (
            <div style={{ fontSize: 24, fontWeight: 800, color: "#00c9ff", lineHeight: 1, marginBottom: 10 }}>
              ${ingSaved.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span style={{ fontSize: 10, color: "#5a6080", fontWeight: 400, marginLeft: 8 }}>saved this week</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Current balance ($)</div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 4250.00"
                value={ingBalance}
                onChange={e => setIngBalance(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveIngBalance(); }}
                style={inputStyle}
              />
            </div>
            <button
              onClick={saveIngBalance}
              disabled={ingSaving || !ingBalance}
              style={{
                padding: "8px 20px", borderRadius: 5, border: "none",
                background: ingSaving ? "#2d3244" : "#00c9ff",
                color: ingSaving ? "#5a6080" : "#000",
                fontWeight: 700, fontSize: 13,
                cursor: ingSaving ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {ingSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* ── MANUAL TOTALS ──────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div style={{ background: "#13161e", border: "1px solid #232736", borderRadius: 8, padding: "14px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#f0f2f8", lineHeight: 1 }}>
              ${totalSpent.toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: "#5a6080", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              Manual entries this week
            </div>
          </div>
          <div style={{
            background: "#13161e",
            border: `1px solid ${remaining < 0 ? "rgba(231,76,60,0.3)" : "rgba(46,204,113,0.3)"}`,
            borderRadius: 8, padding: "14px",
          }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: remaining < 0 ? "#e74c3c" : "#2ecc71", lineHeight: 1 }}>
              {remaining < 0 ? "-" : ""}${Math.abs(remaining).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: "#5a6080", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {remaining < 0 ? "Over budget" : "Remaining"} / ${WEEKLY_TOTAL_TARGET.toFixed(2)} target
            </div>
          </div>
        </div>

        {/* ── ADD MANUAL ENTRY ───────────────────────────────────── */}
        <div style={card}>
          <div style={sectionTitle}>Add Manual Entry</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div>
              <div style={labelStyle}>Category</div>
              <select value={selectedCat} onChange={e => setSelectedCat(e.target.value)} style={inputStyle}>
                {MANUAL_CATEGORIES.map(c => (
                  <option key={c.id} value={c.id}>{c.label} — {c.sub}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Amount ($)</div>
              <input
                type="number" step="0.01" min="0" placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addEntry(); }}
                style={inputStyle}
              />
            </div>
            <button
              onClick={addEntry}
              disabled={saving || !amount}
              style={{
                padding: "8px 18px", borderRadius: 5, border: "none",
                background: saving ? "#2d3244" : "#00c9ff",
                color: saving ? "#5a6080" : "#000",
                fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer",
              }}
            >
              {saving ? "…" : toast || "Add"}
            </button>
          </div>
        </div>

        {/* ── CATEGORY BREAKDOWN ─────────────────────────────────── */}
        <div style={card}>
          <div style={sectionTitle}>This Week vs Target (Manual)</div>
          {MANUAL_CATEGORIES.map(cat => {
            const spent = actuals[cat.id] ?? 0;
            const pct = Math.min((spent / cat.target) * 100, 100);
            const over = spent > cat.target;
            const color = over ? "#e74c3c" : spent / cat.target >= 0.8 ? "#f39c12" : "#2ecc71";
            return (
              <div key={cat.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#8b92b4" }}>
                    {cat.label}
                    <span style={{ fontSize: 10, color: "#5a6080", marginLeft: 4 }}>{cat.sub}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
                    ${spent.toFixed(2)}
                    <span style={{ color: "#5a6080", fontWeight: 400 }}> / ${cat.target.toFixed(2)}</span>
                  </span>
                </div>
                <div style={{ height: 6, background: "#1a1d2e", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── ENTRY LOG ──────────────────────────────────────────── */}
        <div style={card}>
          <div style={sectionTitle}>
            Manual Entries {loading ? "…" : `(${entries.length})`}
          </div>
          {entries.length === 0 && !loading ? (
            <div style={{ fontSize: 12, color: "#5a6080", textAlign: "center", padding: "20px 0" }}>
              No manual entries yet.
            </div>
          ) : (
            entries.map(e => {
              const cat = MANUAL_CATEGORIES.find(c => c.id === e.category);
              const time = new Date(e.created_at).toLocaleDateString("en-AU", {
                weekday: "short", day: "numeric", month: "short",
              });
              return (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 0", borderBottom: "1px solid #1a1d2e",
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#f0f2f8", fontWeight: 600 }}>
                      {cat?.label ?? e.category}
                    </div>
                    <div style={{ fontSize: 10, color: "#5a6080", marginTop: 2 }}>{time}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#f0f2f8", fontVariantNumeric: "tabular-nums" }}>
                      ${e.amount.toFixed(2)}
                    </span>
                    <button
                      onClick={() => deleteEntry(e.id)}
                      style={{
                        background: "none", border: "none", color: "#5a6080",
                        cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1,
                      }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
