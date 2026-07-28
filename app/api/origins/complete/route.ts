import { NextResponse } from "next/server";
import { isoDate, zoneToday } from "../../../lib/time";
import { invalidateOriginsCache } from "../route";

/* ────────────────────────────────────────────────────────────────────────────
   /api/origins/complete — PATCH. Marks one lesson done.

   This is the first Notion WRITE path in this repo; every other Notion route
   POSTs to /query, which is a read. Two consequences worth stating:

     - The token never leaves the server. The client sends a pageId and a proof
       URL, nothing else, and gets back a plain result.
     - The Action Item gate is enforced HERE, not in the UI. The strip and the
       /origins page both call this endpoint, and a gate that lives in one of
       them is a gate the other can walk around.
   ──────────────────────────────────────────────────────────────────────────── */
export const dynamic = "force-dynamic";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";

/** Notion page ids are UUIDs, dashed or bare. Anything else never reaches the API. */
const PAGE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const BUILD_TYPE = "Action Item";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * `Completed By` is a Notion select with exactly two options. Owner is derived
 * from the module and is NOT stored in Notion; this is a different fact — who
 * actually did it. It matters most on modules 7 and 8, which sit in both lanes:
 * without it a shared row records that it was done but not by whom.
 *
 * Normalised against this map rather than passed through, so a typo cannot
 * create a third select option in the live database.
 */
const COMPLETED_BY: Record<string, string> = {
  taylan: "Taylan",
  nihal: "Nihal",
};

function normaliseCompletedBy(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return COMPLETED_BY[value.trim().toLowerCase()] ?? null;
}

/** http/https only — a `javascript:` or `data:` "url" is not proof of anything. */
function isValidProofUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function notion(path: string, init: RequestInit) {
  return fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
}

export async function PATCH(request: Request) {
  if (!NOTION_TOKEN) {
    return NextResponse.json(
      { error: "server_misconfigured", message: "Missing NOTION_TOKEN" },
      { status: 500, headers: NO_STORE },
    );
  }

  let body: { pageId?: unknown; proof?: unknown; completedBy?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Body must be JSON." },
      { status: 400, headers: NO_STORE },
    );
  }

  const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
  if (!PAGE_ID.test(pageId)) {
    return NextResponse.json(
      { error: "bad_page_id", message: "pageId must be a Notion UUID." },
      { status: 400, headers: NO_STORE },
    );
  }

  // Read the row first: the gate depends on its Type, and Type is authoritative
  // in Notion, not in whatever the caller claims.
  const readRes = await notion(`/pages/${pageId}`, { method: "GET" });
  if (!readRes.ok) {
    const detail = await readRes.text().catch(() => readRes.statusText);
    return NextResponse.json(
      { error: "lesson_not_found", message: `Notion ${readRes.status}: ${detail.slice(0, 300)}` },
      { status: readRes.status === 404 ? 404 : 502, headers: NO_STORE },
    );
  }

  const page = await readRes.json();
  const type: string = page?.properties?.["Type"]?.select?.name ?? "";
  const lesson: string = page?.properties?.["Lesson"]?.title?.[0]?.plain_text ?? "";

  const proofSupplied = isValidProofUrl(body.proof);

  // THE GATE. An Action Item is a deliverable; without a link to the thing that
  // was delivered, ticking it records an intention, not a result. Nothing is
  // written on this path.
  if (type === BUILD_TYPE && !proofSupplied) {
    return NextResponse.json(
      {
        error: "proof_required",
        message:
          "This is a BUILD item. Paste the URL of what you produced — no URL, no tick.",
        lesson,
        type,
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const today = isoDate(zoneToday(new Date()));

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const properties: Record<string, any> = {
    Done: { checkbox: true },
    Status: { select: { name: "Complete" } },
    "Completed On": { date: { start: today } },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Proof is stored whenever it is valid, Training rows included — a link that
  // was offered should not be thrown away just because it wasn't demanded.
  if (proofSupplied) {
    properties.Proof = { url: (body.proof as string).trim() };
  }

  // Only written when the caller says who ticked it. An unrecognised value is
  // dropped rather than rejected: the tick is the point, and refusing the whole
  // write over an attribution would lose the completion itself.
  const completedBy = normaliseCompletedBy(body.completedBy);
  if (completedBy) {
    properties["Completed By"] = { select: { name: completedBy } };
  }

  const writeRes = await notion(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });

  if (!writeRes.ok) {
    const detail = await writeRes.text().catch(() => writeRes.statusText);
    return NextResponse.json(
      { error: "write_failed", message: `Notion ${writeRes.status}: ${detail.slice(0, 300)}` },
      { status: 502, headers: NO_STORE },
    );
  }

  invalidateOriginsCache();

  return NextResponse.json(
    {
      ok: true,
      pageId,
      lesson,
      type,
      completedOn: today,
      completedBy,
      proof: proofSupplied ? (body.proof as string).trim() : null,
    },
    { headers: NO_STORE },
  );
}
