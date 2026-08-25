"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import DrillChrome from "../components/DrillChrome";
import { isActionsPayload } from "../lib/payload-guards";
import type { TablePayload, TableDecision } from "../api/table/route";

/* ════════════════════════════════════════════════════════════════════════════
   /table — Column C's drill-down. RESTRUCTURE-SPEC §4.

   Reads /api/table (decisions, milestone, test summary — typed via the route's
   own exported shape, the /board pattern) and /api/actions (The Clock, exactly
   the fields the face's ClockPanel reads). The Close button is the restructure's
   only write: POST /api/table/close, then an immediate re-read so the row
   leaves the table in front of the person who closed it.

   The purple used for a decision's day count is #a78bfa — the repo's existing
   purple (PanelHabits streak, Evening block), not a new colour.
   ══════════════════════════════════════════════════════════════════════════ */

interface ClockPayload {
  clock: {
    daysLeftInWeek: number;
    daysToTractionEnd: number;
    yearElapsedPct: number;
    tests: { completed: number; target: number };
  };
}

const REFRESH_MS = 5 * 60 * 1000;

const PURPLE = "#a78bfa";
const OLD_DAYS = 7;

/** The database behind source 4431302a… — where a new item is raised.
 *  Raising stays a Notion edit: Close is the restructure's only API write. */
const RAISE_URL = "https://www.notion.so/3f0835f50cb14daa90aac4de8642e34c";

type OwnerFilter = "all" | "T" | "N";

/** Same prefix matching /api/mission uses — T, N, Both, full names. */
function ownedBy(owner: string, filter: OwnerFilter): boolean {
  if (filter === "all") return true;
  const o = owner.trim().toLowerCase();
  if (o.startsWith("both")) return true;
  if (filter === "T") return o === "t" || o.startsWith("taylan");
  return o === "n" || o.startsWith("nihal");
}

/** A decision title, phrased as a question for the table. */
function asQuestion(title: string): string {
  const t = title.trim();
  if (t.endsWith("?")) return t;
  return `${t.replace(/[.!]+$/, "")}?`;
}

/**
 * The Start-here question — §3's headline rules, priority order, first match
 * wins, each restated as a question.
 */
function startHereQuestion(data: TablePayload): string {
  const test = data.test;
  const oldest = data.open[0];

  // Rule 1 — active test stale (or no test at all).
  const stale = !test || !test.running;
  if (stale) {
    const n = test?.lastEntryDaysAgo;
    return n === null || n === undefined
      ? "No test is running and no entry has ever been logged. What starts tonight?"
      : `No test is running. Last entry was ${n} ${n === 1 ? "day" : "days"} ago — what restarts it tonight?`;
  }

  // Rule 2 — test running, spend under the entry window.
  if (test.spend !== null && test.windowLow !== null && test.spend < test.windowLow) {
    return `${test.name} is at $${Math.round(test.spend)} of the $${test.windowLow} window — what does tonight's entry say?`;
  }

  // Rule 3 — oldest open decision older than 7 days.
  if (oldest && oldest.ageDays !== null && oldest.ageDays > OLD_DAYS) {
    return `One decision has sat ${oldest.ageDays} days. Will you close it tonight?`;
  }

  // Rule 4.
  return "Nothing on the table. Run the check-in short?";
}

const tileStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
};

function DecisionRow({
  decision,
  expanded,
  onToggle,
  onClose,
  closing,
  closeError,
}: {
  decision: TableDecision;
  expanded: boolean;
  onToggle: () => void;
  onClose: (outcome: string) => void;
  closing: boolean;
  closeError: string | null;
}) {
  const [outcome, setOutcome] = useState("");
  const old = decision.ageDays !== null && decision.ageDays >= OLD_DAYS;

  return (
    <div
      style={{
        background: "var(--bg-inner)",
        borderRadius: 8,
        borderLeft: `3px solid ${old ? PURPLE : "var(--border)"}`,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minHeight: 48,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          minWidth: 0,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
            lineHeight: 1.3,
          }}
        >
          {asQuestion(decision.title)}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-secondary)",
            flexShrink: 0,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {decision.owner || "—"}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: PURPLE,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {decision.ageDays === null ? "—" : `${decision.ageDays}d`}
        </span>
      </button>

      {expanded ? (
        <div
          style={{
            padding: "0 12px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderTop: "1px solid var(--border)",
            paddingTop: 10,
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>Closed when: </span>
            {decision.closedWhen ?? "— not set in Notion"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              value={outcome}
              placeholder="Outcome…"
              onChange={(e) => setOutcome(e.target.value)}
              style={{
                flex: 1,
                minWidth: 220,
                minHeight: 48,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                padding: "0 12px",
              }}
            />
            <button
              type="button"
              disabled={closing || outcome.trim() === ""}
              onClick={() => onClose(outcome.trim())}
              style={{
                minHeight: 48,
                padding: "0 22px",
                fontSize: 13,
                fontWeight: 800,
                borderRadius: 8,
                cursor: closing || outcome.trim() === "" ? "default" : "pointer",
                background: outcome.trim() === "" ? "transparent" : "rgba(0,212,255,0.12)",
                color: outcome.trim() === "" ? "var(--text-muted)" : "var(--cyan)",
                border: `1px solid ${outcome.trim() === "" ? "var(--border)" : "var(--cyan)"}`,
                fontFamily: "inherit",
              }}
            >
              {closing ? "Closing…" : "Close"}
            </button>
          </div>
          {closeError ? (
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>{closeError}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function TablePage() {
  const [data, setData] = useState<TablePayload | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [clock, setClock] = useState<ClockPayload | null>(null);
  const [filter, setFilter] = useState<OwnerFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/table", { cache: "no-store" });
      const payload = (await res.json()) as TablePayload;
      if (!res.ok && !Array.isArray(payload?.open)) {
        throw new Error(`HTTP ${res.status}`);
      }
      setData(payload);
      setDataError(null);
    } catch (e) {
      setData(null);
      setDataError(e instanceof Error ? e.message : "Unknown error");
    }

    try {
      const res = await fetch("/api/actions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      if (!isActionsPayload(payload)) throw new Error("Unexpected payload shape");
      setClock(payload as ClockPayload);
    } catch {
      setClock(null); // the clock tile degrades to dashes; the table still works
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const close = useCallback(
    async (decision: TableDecision, outcome: string) => {
      setClosingId(decision.id);
      setCloseError(null);
      try {
        const res = await fetch("/api/table/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId: decision.id, outcome }),
        });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setExpandedId(null);
        await load(); // the row must be gone on the very next paint
      } catch (e) {
        setCloseError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setClosingId(null);
      }
    },
    [load],
  );

  const open = (data?.open ?? []).filter((d) => ownedBy(d.owner, filter));
  const closed = data?.closedSinceYesterday ?? [];
  const c = clock?.clock;

  return (
    <div
      tabIndex={0}
      aria-label="The table — scrollable"
      style={{
        marginTop: "calc(var(--nav-h) + var(--strip-h))",
        height: "calc(100dvh - var(--nav-h) - var(--strip-h))",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--border) transparent",
        background: "var(--bg-base)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <DrillChrome
        title="The Table"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <div role="radiogroup" aria-label="Owner filter" style={{ display: "flex", gap: 6 }}>
              {(
                [
                  ["all", "All"],
                  ["T", "T"],
                  ["N", "N"],
                ] as const
              ).map(([key, label]) => {
                const on = filter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setFilter(key)}
                    style={{
                      minHeight: 48,
                      minWidth: 48,
                      padding: "0 16px",
                      fontSize: 13,
                      fontWeight: 800,
                      borderRadius: 8,
                      cursor: "pointer",
                      background: on ? "var(--bg-highlight)" : "transparent",
                      color: on ? "var(--cyan)" : "var(--text-muted)",
                      border: `1px solid ${on ? "var(--cyan)" : "var(--border)"}`,
                      fontFamily: "inherit",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <a
              href={RAISE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 48,
                padding: "0 18px",
                fontSize: 13,
                fontWeight: 800,
                borderRadius: 8,
                background: "rgba(0,212,255,0.12)",
                color: "var(--cyan)",
                border: "1px solid var(--cyan)",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              + Raise item
            </a>
          </div>
        }
      />

      {dataError ? (
        <div
          role="alert"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--red)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--red)",
            flexShrink: 0,
          }}
        >
          Table data unavailable — {dataError}
        </div>
      ) : null}
      {data && data.errors.length > 0 ? (
        <div
          role="alert"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--amber)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--amber)",
            flexShrink: 0,
          }}
        >
          {data.errors.join("  |  ")}
        </div>
      ) : null}

      {/* Start here — one question, cyan left border. */}
      {data ? (
        <div style={{ ...tileStyle, borderLeft: "4px solid var(--cyan)", flexShrink: 0 }}>
          <div className="card-title">Start here</div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-primary)",
              lineHeight: 1.35,
            }}
          >
            {startHereQuestion(data)}
          </div>
        </div>
      ) : !dataError ? (
        <div style={{ ...tileStyle, color: "var(--text-secondary)", fontSize: 15 }}>
          Loading the table…
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 12,
          flexShrink: 0,
          alignItems: "start",
        }}
      >
        {/* On the table — every open decision, oldest first. */}
        <div style={{ ...tileStyle, gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div className="card-title">On the table</div>
            <span className="badge badge-cyan">{open.length} open</span>
          </div>
          {data && open.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {filter === "all" ? "Nothing on the table." : "Nothing on the table for this owner."}
            </div>
          ) : null}
          {open.map((d) => (
            <DecisionRow
              key={d.id}
              decision={d}
              expanded={expandedId === d.id}
              onToggle={() => {
                setCloseError(null);
                setExpandedId((cur) => (cur === d.id ? null : d.id));
              }}
              onClose={(outcome) => close(d, outcome)}
              closing={closingId === d.id}
              closeError={expandedId === d.id ? closeError : null}
            />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Closed since yesterday. */}
          <div style={tileStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div className="card-title">Closed since yesterday</div>
              {closed.length > 0 ? (
                <span className="badge badge-green">{closed.length}</span>
              ) : null}
            </div>
            {closed.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Nothing was closed yesterday.
              </div>
            ) : (
              closed.map((d) => (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    minHeight: 40,
                    borderBottom: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {d.title}
                  </span>
                  <span
                    style={{
                      color: "var(--text-muted)",
                      flexShrink: 0,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {d.closedIso ?? ""}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* The clock. */}
          <div style={tileStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div className="card-title">The clock</div>
              {data?.milestone ? (
                <span
                  className="badge badge-cyan"
                  style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}
                  title={data.milestone}
                >
                  {data.milestone}
                </span>
              ) : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="stat-cell" style={{ padding: "8px 10px" }}>
                <div className="stat-num sm">{c ? c.daysLeftInWeek : "—"}</div>
                <div className="stat-sublabel">Days left · week</div>
              </div>
              <div className="stat-cell" style={{ padding: "8px 10px" }}>
                <div className="stat-num sm cyan">{c ? c.daysToTractionEnd : "—"}</div>
                <div className="stat-sublabel">Days to traction end</div>
              </div>
              <div className="stat-cell" style={{ padding: "8px 10px" }}>
                <div className="stat-num sm amber">
                  {c ? `${c.yearElapsedPct.toFixed(0)}%` : "—"}
                </div>
                <div className="stat-sublabel">Year elapsed</div>
              </div>
              <div className="stat-cell" style={{ padding: "8px 10px" }}>
                <div className="stat-num sm">
                  {c ? `${c.tests.completed} of ${c.tests.target}` : "—"}
                </div>
                <div className="stat-sublabel">Tests</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
