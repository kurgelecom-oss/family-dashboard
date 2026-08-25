import { NextResponse } from "next/server";
import { HOUSEHOLD_TZ, zoneToday, isoDate } from "../../../lib/time";
import { NOTION_VERSION } from "../../../lib/settings";

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/table/close — the ONLY write in the restructure.

   Closes one Daily Discussion Points row: writes the outcome text and the
   closed date, and flips Status to Closed so the row leaves the open table on
   the next read.

   The live schema (read back 2026-08-25) carries Outcome:rich_text and
   Status:select but NO closed-date property, so the closed date is stamped into
   the Outcome text ("… — closed 2026-08-25", Sydney civil date via Intl) where
   /api/table's CLOSED_STAMP_RE parses it back out for the closed-since-
   yesterday tile. If a date property is ever added to the source, write it
   there and keep the stamp for continuity.

   Built and typechecked only in this prompt — per RESTRUCTURE-SPEC §4 the
   production write-test uses a throwaway row in a separate verification step.
   ══════════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const NOTION_PAGE_ID_RE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** Notion rich_text caps a single text chunk at 2000 chars; an outcome is a
 *  sentence, so anything near the cap is a mistake, not a decision. */
const OUTCOME_MAX = 1000;

export async function POST(request: Request) {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing NOTION_TOKEN" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  const { pageId, outcome } = (body ?? {}) as { pageId?: unknown; outcome?: unknown };

  if (typeof pageId !== "string" || !NOTION_PAGE_ID_RE.test(pageId)) {
    return NextResponse.json(
      { ok: false, error: "pageId must be a Notion page id" },
      { status: 400 },
    );
  }
  const outcomeText = typeof outcome === "string" ? outcome.trim() : "";
  if (!outcomeText) {
    return NextResponse.json(
      { ok: false, error: "outcome must be a non-empty string" },
      { status: 400 },
    );
  }
  if (outcomeText.length > OUTCOME_MAX) {
    return NextResponse.json(
      { ok: false, error: `outcome must be at most ${OUTCOME_MAX} characters` },
      { status: 400 },
    );
  }

  const closedIso = isoDate(zoneToday(new Date(), HOUSEHOLD_TZ));
  const stamped = `${outcomeText} — closed ${closedIso}`;

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        Outcome: { rich_text: [{ type: "text", text: { content: stamped } }] },
        Status: { select: { name: "Closed" } },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: `Notion API ${res.status}`, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, pageId, closedIso, outcome: stamped },
    { headers: { "Cache-Control": "no-store" } },
  );
}
