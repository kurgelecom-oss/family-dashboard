"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Owner, Row } from "../api/origins/route";

/* ────────────────────────────────────────────────────────────────────────────
   /origins — the full ORIGINS tracker.

   A route in this repo, not a new site: it shares the layout, the nav, the
   strip and the token set. Structure follows /board — client page, one server
   payload, all display decisions here and no data decisions.

   This page scrolls. It is the one ORIGINS surface that is not a TV panel, and
   105 rows do not belong on a fixed viewport.
   ──────────────────────────────────────────────────────────────────────────── */

const NOTION_URL = "https://app.notion.com/p/8922c4a416e0445f808916a10e52b5f8";

type Filter = "all" | "taylan" | "nihal" | "build" | "todo";

/** Who ticked it. Distinct from `owner`, which is derived from the module. */
type Doer = "taylan" | "nihal";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "taylan", label: "Taylan" },
  { key: "nihal", label: "Nihal" },
  { key: "build", label: "Action Items only" },
  { key: "todo", label: "Not done" },
];

const OWNER_LABEL: Record<Owner, string> = {
  taylan: "Taylan",
  nihal: "Nihal",
  both: "Both",
};

function ownerColour(owner: Owner): string {
  if (owner === "taylan") return "var(--cyan)";
  if (owner === "nihal") return "var(--amber)";
  return "var(--text-secondary)";
}

function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** Rows in a lane: the owner's own, plus everything shared. Mirrors the API. */
function inLane(rows: Row[], lane: "taylan" | "nihal"): Row[] {
  return rows.filter((r) => r.owner === lane || r.owner === "both");
}

export default function OriginsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  // Carries WHO as well as which row: a shared row's proof prompt has to
  // remember which of the two ticks opened it.
  const [proofFor, setProofFor] = useState<{ pageId: string; by: Doer } | null>(null);
  const [proof, setProof] = useState("");
  const [error, setError] = useState<{ pageId: string; message: string } | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/origins/rows${force ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.rows);
    } catch {
      /* keep whatever is on screen */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tick = useCallback(
    async (row: Row, by: Doer, withProof?: string) => {
      setBusy(row.pageId);
      setError(null);
      try {
        const res = await fetch("/api/origins/complete", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageId: row.pageId,
            completedBy: by,
            ...(withProof ? { proof: withProof } : {}),
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError({ pageId: row.pageId, message: result?.message ?? `Failed (${res.status})` });
          return;
        }
        setProofFor(null);
        setProof("");
        await load(true);
      } catch {
        setError({ pageId: row.pageId, message: "Network error — not saved." });
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const stats = useMemo(() => {
    if (!rows) return null;
    const t = inLane(rows, "taylan");
    const n = inLane(rows, "nihal");
    return {
      overall: pct(rows.filter((r) => r.done).length, rows.length),
      taylan: pct(t.filter((r) => r.done).length, t.length),
      nihal: pct(n.filter((r) => r.done).length, n.length),
      total: rows.length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    switch (filter) {
      case "taylan":
        return inLane(rows, "taylan");
      case "nihal":
        return inLane(rows, "nihal");
      case "build":
        return rows.filter((r) => r.type === "Action Item");
      case "todo":
        return rows.filter((r) => !r.done);
      default:
        return rows;
    }
  }, [rows, filter]);

  // Grouped by module, preserving the order the API already sorted into.
  const groups = useMemo(() => {
    const map = new Map<number, { module: string; rows: Row[] }>();
    for (const r of visible) {
      if (!map.has(r.moduleNo)) map.set(r.moduleNo, { module: r.module, rows: [] });
      map.get(r.moduleNo)!.rows.push(r);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [visible]);

  return (
    <div
      style={{
        height: "100vh",
        overflowY: "auto",
        paddingTop: "calc(var(--nav-h) + var(--strip-h))",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
        {/* ── HEADER ─────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              ORIGINS <span style={{ color: "var(--cyan)" }}>Tracker</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {stats ? `${stats.total} lessons · owner derived from module` : "Loading…"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            {stats && (
              <>
                <Stat label="Overall" value={stats.overall} colour="var(--text-primary)" />
                <Stat label="Taylan" value={stats.taylan} colour="var(--cyan)" />
                <Stat label="Nihal" value={stats.nihal} colour="var(--amber)" />
              </>
            )}
            <a
              href={NOTION_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-secondary)",
                textDecoration: "none",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 14px",
              }}
            >
              Open in Notion ↗
            </a>
          </div>
        </div>

        {/* ── FILTERS ────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 6,
                cursor: "pointer",
                background: filter === f.key ? "var(--cyan)" : "var(--bg-card)",
                color: filter === f.key ? "var(--bg-base)" : "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {f.label}
            </button>
          ))}
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              alignSelf: "center",
              marginLeft: 4,
            }}
          >
            {visible.length} shown
          </span>
        </div>

        {/* ── ROWS ───────────────────────────────────────────────── */}
        {rows === null && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading lessons…</div>
        )}

        {groups.map(([moduleNo, group]) => (
          <div key={moduleNo} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-secondary)",
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                marginBottom: 4,
              }}
            >
              {group.module || `Module ${moduleNo}`}
              <span style={{ color: "var(--text-muted)", fontWeight: 600, marginLeft: 8 }}>
                {group.rows.filter((r) => r.done).length}/{group.rows.length}
              </span>
            </div>

            {group.rows.map((row) => {
              const isBuild = row.type === "Action Item";
              const asking = proofFor?.pageId === row.pageId;
              const rowError = error?.pageId === row.pageId ? error.message : null;

              // A shared row (module 7 or 8) gets one tick per person, because
              // "done" on it does not say who did it. Owned rows tick as their
              // owner and need no choice.
              const doers: Doer[] = row.owner === "both" ? ["taylan", "nihal"] : [row.owner];

              return (
                <div
                  key={row.pageId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 8px",
                    borderBottom: "1px solid var(--border)",
                    background: isBuild
                      ? "color-mix(in srgb, var(--origins-build) 8%, transparent)"
                      : "transparent",
                    opacity: row.done ? 0.55 : 1,
                  }}
                >
                  <span style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    {doers.map((by) => (
                      <button
                        key={by}
                        type="button"
                        className="origins-tick"
                        style={
                          {
                            "--lane-colour": isBuild
                              ? "var(--origins-build)"
                              : by === "nihal"
                                ? "var(--amber)"
                                : "var(--cyan)",
                          } as React.CSSProperties
                        }
                        disabled={busy === row.pageId || row.done}
                        title={
                          row.done
                            ? "Already complete"
                            : isBuild
                              ? `BUILD — proof URL required (${OWNER_LABEL[by]})`
                              : `Tick as ${OWNER_LABEL[by]}`
                        }
                        onClick={() => {
                          if (row.done) return;
                          if (isBuild && !asking) {
                            setProofFor({ pageId: row.pageId, by });
                            setError(null);
                            return;
                          }
                          tick(row, by, asking ? proof : undefined);
                        }}
                      >
                        {busy === row.pageId
                          ? "…"
                          : row.done
                            ? "✓"
                            : doers.length > 1
                              ? OWNER_LABEL[by][0]
                              : ""}
                      </button>
                    ))}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      width: 26,
                      flexShrink: 0,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.lessonNo}
                  </span>

                  {asking ? (
                    <span className="origins-proof" style={{ flex: 1 }}>
                      <input
                        autoFocus
                        type="url"
                        value={proof}
                        placeholder="Proof URL — no URL, no tick"
                        onChange={(e) => setProof(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && proofFor) tick(row, proofFor.by, proof);
                          if (e.key === "Escape") {
                            setProofFor(null);
                            setProof("");
                            setError(null);
                          }
                        }}
                      />
                      {rowError && <span className="origins-error">{rowError}</span>}
                    </span>
                  ) : (
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: row.done ? 400 : 600,
                        textDecoration: row.done ? "line-through" : "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.lesson}
                      {rowError && (
                        <span className="origins-error" style={{ marginLeft: 8 }}>
                          {rowError}
                        </span>
                      )}
                    </span>
                  )}

                  <Tag
                    text={row.type}
                    colour={isBuild ? "var(--origins-build)" : "var(--text-muted)"}
                  />
                  <Tag text={OWNER_LABEL[row.owner]} colour={ownerColour(row.owner)} />

                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      width: 86,
                      flexShrink: 0,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.completedOn ? row.completedOn.slice(0, 10) : "—"}
                  </span>

                  <span style={{ width: 42, flexShrink: 0, fontSize: 11 }}>
                    {row.proof ? (
                      <a
                        href={row.proof}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--cyan)", textDecoration: "none" }}
                      >
                        proof ↗
                      </a>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: colour,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}%
      </div>
      <div
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "var(--text-muted)",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Tag({ text, colour }: { text: string; colour: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: colour,
        border: `1px solid ${colour}`,
        borderRadius: 4,
        padding: "2px 6px",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {text || "—"}
    </span>
  );
}
