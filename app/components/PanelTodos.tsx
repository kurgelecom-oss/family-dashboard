"use client";

import { useEffect, useState } from "react";
import { SETTING_DEFAULTS, type SettingsMap, getSetting } from "../lib/settings";

/* ════════════════════════════════════════════════════════════════════════════
   Column C — TODAY / INPUTS / THE CLOCK.

   Reads GET /api/actions. Actionables and time only: this column renders ZERO
   currency by design. Money lives in column B. If a dollar sign ever appears
   here, something has been wired to the wrong payload.
   ══════════════════════════════════════════════════════════════════════════ */

interface ActionItem {
  id: string;
  title: string;
  priority: string | null;
  type: string | null;
  area: string | null;
  dueDate: string | null;
  daysPastDue: number | null;
  completed: boolean;
  completedDate: string | null;
  overdue: boolean;
}

interface InputItem {
  id: string;
  title: string;
  type: string | null;
  area: string | null;
  doneToday: boolean;
  streak: number;
}

interface ClockTests {
  completed: number;
  target: number;
  lastCompletedDate: string | null;
  gapFromDate: string;
  daysSinceLastCompleted: number;
  everCompleted: boolean;
}

interface ActionsPayload {
  generatedAt: string;
  timeZone: string;
  today: string;
  settings?: SettingsMap;
  actions: {
    decisionDue: { name: string; reason: string } | null;
    ranked: ActionItem[];
    pendingCount: number;
    doneToday: number;
  };
  inputs: InputItem[];
  clock: {
    daysLeftInWeek: number;
    daysLeftInMonth: number;
    daysToTractionEnd: number;
    tractionEndDate: string;
    yearElapsedPct: number;
    tests: ClockTests;
  };
}

const REFRESH_MS = 5 * 60 * 1000;
const NOTION_URL = "https://app.notion.com/p/38e5429afa9080c98967cfef39103c0c";

/** Priority stripe colour. Tokens only. */
function priorityTone(priority: string | null): string {
  switch ((priority ?? "").toLowerCase()) {
    case "high":
      return "var(--red)";
    case "medium":
    case "med":
      return "var(--amber)";
    case "low":
      return "var(--cyan)";
    default:
      return "var(--text-muted)";
  }
}

/* ── Shared chrome ────────────────────────────────────────────────────────── */

/** The existing Notion open-in-new-tab badge, kept as it was. */
function NotionBadge() {
  return (
    <a
      href={NOTION_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Notion"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: 4,
        background: "rgba(0, 212, 255, 0.15)",
        border: "1px solid rgba(0, 212, 255, 0.3)",
        color: "var(--cyan)",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      ↗
    </a>
  );
}

function ShellCard({
  title,
  badge,
  badgeClass,
  message,
}: {
  title: string;
  badge: string;
  badgeClass: string;
  message: string;
}) {
  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">{title}</div>
        <span className={`badge ${badgeClass}`}>{badge}</span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: "var(--text-muted)",
          textAlign: "center",
          padding: "0 8px",
        }}
      >
        {message}
      </div>
    </div>
  );
}

/** A count + label pair for THE CLOCK. Counts only — never currency. */
function ClockStat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="stat-cell" style={{ padding: "5px 7px", minWidth: 0 }}>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1.2,
          color: tone ?? "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      <div
        className="stat-sublabel"
        style={{
          marginTop: 2,
          fontSize: 9,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ── Panel 1 — TODAY ──────────────────────────────────────────────────────── */

function TodayPanel({ data, settings }: { data: ActionsPayload; settings?: SettingsMap }) {
  const shown = getSetting(settings, "ACTION_ITEMS_SHOWN", SETTING_DEFAULTS.ACTION_ITEMS_SHOWN);
  const { decisionDue, ranked, pendingCount, doneToday } = data.actions;
  const visible = ranked.slice(0, shown);
  const more = Math.max(pendingCount - visible.length, 0);

  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <div className="card-title">Today</div>
          <NotionBadge />
        </div>
        <span className="badge badge-cyan">● Synced</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* The call to act only. The numbers behind it stay in column B. */}
        {decisionDue && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--amber)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            title={decisionDue.reason}
          >
            Decision due · {decisionDue.name}
          </div>
        )}

        {visible.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            NOTHING QUEUED
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {visible.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--bg-inner)",
                  borderRadius: 6,
                  padding: "5px 8px",
                  borderLeft: `3px solid ${priorityTone(item.priority)}`,
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      lineHeight: 1.25,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      lineHeight: 1.3,
                    }}
                  >
                    {item.area ?? "—"}
                  </div>
                </div>
                {/* Server-computed: One-off past the grace window only. Daily and
                    Recurring items never carry this flag. */}
                {item.overdue && <span className="badge badge-red">Overdue</span>}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 4,
            fontSize: 10,
            color: "var(--text-muted)",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          {more} more pending · {doneToday} done today
        </div>
      </div>
    </div>
  );
}

/* ── Panel 2 — INPUTS ─────────────────────────────────────────────────────── */

function InputsPanel({ data, settings }: { data: ActionsPayload; settings?: SettingsMap }) {
  const shown = getSetting(settings, "INPUT_HABITS_SHOWN", SETTING_DEFAULTS.INPUT_HABITS_SHOWN);
  const visible = data.inputs.slice(0, shown);

  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">Inputs</div>
        <span className="badge badge-cyan">{data.inputs.length} tracked</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {visible.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              NO INPUTS TRACKED
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              tag items Daily or Recurring in Notion
            </div>
          </div>
        ) : (
          visible.map((input) => (
            <div
              key={input.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                background: "var(--bg-inner)",
                borderRadius: 6,
                padding: "5px 8px",
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    lineHeight: 1.25,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {input.title}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    lineHeight: 1.3,
                  }}
                >
                  {input.area ?? "—"} · {input.type ?? "—"}
                </div>
              </div>

              {input.doneToday ? (
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--green)",
                    flexShrink: 0,
                    lineHeight: 1.2,
                  }}
                >
                  ✓
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    // A broken streak has to be visible, so zero is amber rather
                    // than a quiet grey.
                    color: input.streak > 0 ? "var(--green)" : "var(--amber)",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {input.streak}d
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Panel 3 — THE CLOCK ──────────────────────────────────────────────────── */

function ClockPanel({ data, settings }: { data: ActionsPayload; settings?: SettingsMap }) {
  const c = data.clock;
  const gapAmber = getSetting(settings, "TEST_GAP_AMBER_DAYS", SETTING_DEFAULTS.TEST_GAP_AMBER_DAYS);
  const gapRed = getSetting(settings, "TEST_GAP_RED_DAYS", SETTING_DEFAULTS.TEST_GAP_RED_DAYS);

  const gap = c.tests.daysSinceLastCompleted;
  const gapTone =
    gap > gapRed ? "var(--red)" : gap > gapAmber ? "var(--amber)" : "var(--text-secondary)";

  return (
    <div className="card" style={{ padding: "10px 12px" }}>
      <div className="card-header" style={{ marginBottom: 5 }}>
        <div className="card-title">The Clock</div>
        <span className="badge badge-cyan">{c.yearElapsedPct.toFixed(1)}% of year</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <ClockStat value={String(c.daysLeftInWeek)} label="Days left · week" />
          <ClockStat value={String(c.daysLeftInMonth)} label="Days left · month" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <ClockStat
            value={String(c.daysToTractionEnd)}
            label="Days to traction end"
            tone="var(--cyan)"
          />
          <ClockStat
            value={`${c.yearElapsedPct.toFixed(0)}%`}
            label="Year elapsed"
            tone="var(--amber)"
          />
        </div>

        {/* Product tests — counts, live from the Launchpad API. */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 5, marginTop: "auto" }}>
          <div
            style={{
              fontSize: 9,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 2,
            }}
          >
            Product tests
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                lineHeight: 1.2,
                color: c.tests.completed >= c.tests.target ? "var(--green)" : "var(--text-primary)",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {c.tests.completed} of {c.tests.target}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>complete</span>
          </div>
          <div style={{ fontSize: 10, color: gapTone, fontWeight: 600, lineHeight: 1.3 }}>
            {gap} days since {c.tests.everCompleted ? "last completed test" : "Launchpad go-live"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Column ───────────────────────────────────────────────────────────────── */

function isRenderable(p: unknown): p is ActionsPayload {
  const d = p as ActionsPayload | null;
  return Boolean(d && d.actions && Array.isArray(d.inputs) && d.clock);
}

export default function PanelTodos() {
  const [data, setData] = useState<ActionsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/actions");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.error) throw new Error(String(payload.error));
        if (!isRenderable(payload)) throw new Error("Unexpected payload shape");
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (e) {
        // No invented fallback numbers — the panels say what failed.
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      }
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <>
        {["Today", "Inputs", "The Clock"].map((title) => (
          <ShellCard
            key={title}
            title={title}
            badge="⚠ Error"
            badgeClass="badge-red"
            message={`Action data unavailable — ${error}`}
          />
        ))}
      </>
    );
  }

  if (!data) {
    return (
      <>
        {["Today", "Inputs", "The Clock"].map((title) => (
          <ShellCard
            key={title}
            title={title}
            badge="Loading…"
            badgeClass="badge-cyan"
            message="…"
          />
        ))}
      </>
    );
  }

  const settings = data.settings;

  return (
    <>
      <TodayPanel data={data} settings={settings} />
      <InputsPanel data={data} settings={settings} />
      <ClockPanel data={data} settings={settings} />
    </>
  );
}
