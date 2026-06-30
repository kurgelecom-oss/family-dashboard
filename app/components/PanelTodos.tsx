"use client";
import { useState, useEffect, useCallback } from "react";

interface TodoItem {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  context: "personal" | "work" | "family";
  dueDate?: string;
  completed: boolean;
  notes?: string;
}

const CONTEXT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  personal: { bg: "rgba(147, 112, 219, 0.1)", border: "#9370db", icon: "👤" },
  work: { bg: "rgba(0, 212, 255, 0.1)", border: "#00d4ff", icon: "💼" },
  family: { bg: "rgba(46, 204, 113, 0.1)", border: "#2ecc71", icon: "👨‍👩‍👧‍👦" },
  asap: { bg: "rgba(255, 99, 71, 0.1)", border: "#ff6347", icon: "🔥" },
};

// Fallback for any Notion context value not mapped above — prevents a crash
// when a new Context option is added in Notion.
const DEFAULT_CONTEXT_COLOR = { bg: "rgba(160, 160, 160, 0.1)", border: "#a0a0a0", icon: "📌" };

function getUrgencyColor(dueDate?: string): string {
  if (!dueDate) return "var(--text-secondary)";
  const due = new Date(dueDate).getTime();
  const now = new Date().getTime();
  const daysUntil = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

  if (daysUntil <= 0) return "var(--red)";
  if (daysUntil <= 1) return "var(--amber)";
  if (daysUntil <= 3) return "var(--cyan)";
  return "var(--text-secondary)";
}

function formatDueDate(dueDate?: string): string {
  if (!dueDate) return "";
  const due = new Date(dueDate);
  const now = new Date();
  const daysUntil = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil <= 0) return "OVERDUE";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil <= 7) return `${daysUntil}d`;
  return due.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
}

export default function PanelTodos() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const fetchTodos = useCallback(async () => {
    try {
      const response = await fetch("/api/todos");
      if (response.ok) {
        const data = await response.json();
        setTodos(data);
        setLastSync(new Date());
      }
    } catch (error) {
      console.error("Error fetching todos:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
    const interval = setInterval(fetchTodos, 8000);
    return () => clearInterval(interval);
  }, [fetchTodos]);

  const urgentTodos = todos
    .filter(t => !t.completed)
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

  const displayTodos = focusMode ? urgentTodos.slice(0, 3) : urgentTodos;
  const completedCount = todos.filter(t => t.completed).length;
  const completionRate = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;

  return (
    <div
      className="card"
      style={{
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ── Header ── */}
      <div className="card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <div className="card-title">Next Steps</div>
          <a
            href="https://app.notion.com/p/38e5429afa9080c98967cfef39103c0c"
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
            onMouseOver={e => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.25)";
              e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.6)";
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)";
              e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.3)";
            }}
          >
            ↗
          </a>
        </div>
        <span className="badge badge-cyan">● {loading ? "Loading…" : "Synced"}</span>
      </div>

      {/* ── Stats Row ── */}
      <div
        style={{
          display: "flex",
          gap: 10,
          fontSize: 11,
          color: "var(--text-muted)",
          paddingBottom: 6,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span>
          <span style={{ color: "var(--cyan)", fontWeight: 600 }}>{displayTodos.length}</span> pending
        </span>
        <span>
          <span style={{ color: "var(--green)", fontWeight: 600 }}>{completedCount}</span> done
        </span>
        <span style={{ marginLeft: "auto" }}>
          <span style={{ color: "var(--cyan)", fontWeight: 600 }}>{completionRate}%</span> complete
        </span>
      </div>

      {/* ── Todo Items ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "20px 10px", color: "var(--text-secondary)" }}>
            Loading from Notion…
          </div>
        ) : displayTodos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 10px", color: "var(--text-secondary)" }}>
            ✨ All caught up!
          </div>
        ) : (
          displayTodos.map((todo) => {
            const isExpanded = expandedId === todo.id;
            const color = CONTEXT_COLORS[todo.context] || DEFAULT_CONTEXT_COLOR;
            const urgencyColor = getUrgencyColor(todo.dueDate);
            const isUrgent = todo.priority === "high" || (todo.dueDate && new Date(todo.dueDate) < new Date(Date.now() + 86400000));

            return (
              <div
                key={todo.id}
                onClick={() => setExpandedId(isExpanded ? null : todo.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: `1px solid ${color.border}`,
                  background: color.bg,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseOver={e => {
                  if (!isUrgent) return;
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.boxShadow = `0 0 12px ${color.border}80`;
                  el.style.borderColor = color.border;
                }}
                onMouseOut={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.boxShadow = "none";
                  el.style.borderColor = color.border;
                }}
              >
                {/* Animated glow for urgent items */}
                {isUrgent && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: `linear-gradient(90deg, transparent, ${color.border}20, transparent)`,
                      animation: "shimmer 2s infinite",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {/* Main content */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, position: "relative", zIndex: 1 }}>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 12, color: color.border }}>{color.icon}</span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          textDecoration: todo.completed ? "line-through" : "none",
                          opacity: todo.completed ? 0.6 : 1,
                        }}
                      >
                        {todo.title}
                      </span>
                    </div>

                    {/* Due date + priority */}
                    {(todo.dueDate || todo.priority === "high") && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 10 }}>
                        {todo.dueDate && (
                          <span style={{ color: urgencyColor, fontWeight: 600 }}>
                            {formatDueDate(todo.dueDate)}
                          </span>
                        )}
                        {todo.priority === "high" && (
                          <span
                            style={{
                              display: "inline-block",
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "var(--red)",
                              opacity: 0.8,
                            }}
                          />
                        )}
                      </div>
                    )}

                    {/* Expanded content */}
                    {isExpanded && todo.notes && (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: `1px solid ${color.border}`,
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          animation: "slideDown 0.2s ease",
                        }}
                      >
                        <div style={{ color: "var(--text-muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
                          Notes
                        </div>
                        {todo.notes}
                      </div>
                    )}
                  </div>

                  {/* Drag handle indicator */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      opacity: 0.5,
                      cursor: "grab",
                    }}
                  >
                    <div style={{ width: 3, height: 3, borderRadius: "50%", background: color.border }} />
                    <div style={{ width: 3, height: 3, borderRadius: "50%", background: color.border }} />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Focus Mode Toggle ── */}
      {urgentTodos.length > 3 && (
        <button
          onClick={() => setFocusMode(!focusMode)}
          style={{
            width: "100%",
            padding: "6px 8px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: focusMode ? "rgba(0, 212, 255, 0.1)" : "transparent",
            color: focusMode ? "var(--cyan)" : "var(--text-secondary)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
          onMouseOver={e => {
            e.currentTarget.style.background = "rgba(0, 212, 255, 0.15)";
            e.currentTarget.style.borderColor = "var(--cyan)";
          }}
          onMouseOut={e => {
            e.currentTarget.style.background = focusMode ? "rgba(0, 212, 255, 0.1)" : "transparent";
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          {focusMode ? "Show All" : "Top 3 Mode"}
        </button>
      )}

      {/* ── Animation Styles ── */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
