import { NextResponse } from "next/server";

// Cached for 5 minutes (legacy caching model — cacheComponents is not enabled).
// Same pattern as app/api/schedule/route.ts.
export const dynamic = "force-static";
export const revalidate = 300;

const NOTION_TOKEN = process.env.NOTION_TOKEN;

interface SourceDef {
  person: string;
  layer: string;
  id: string;
  shape: "layer" | "weekly";
}

// These are DATA SOURCE ids, not database ids — GET /v1/databases/{id} 404s for
// them, only POST /v1/data_sources/{id}/query works. Ids are pinned here rather
// than read from env because BOARD-SPEC.md fixes the owner→layer→id mapping and a
// mistyped env var would silently attach a layer to the wrong person.
//
// `shape` selects how a row is read:
//   "layer"  — Block/title, Day single-select, Start, End, Notes
//   "weekly" — Entry/title, Days multi-select, Start, End, Notes, Category, Detail, Emoji
const SOURCES: readonly SourceDef[] = [
  { person: "taylan", layer: "work", id: "7e90f275-70d4-480a-b504-b8be3444b7f5", shape: "layer" },
  { person: "taylan", layer: "personal", id: "2b062576-79ee-4b7a-8acd-805aaf044f8b", shape: "layer" },
  { person: "taylan", layer: "ecom", id: "cd0e72dd-fb69-4599-95be-202ee1446770", shape: "layer" },
  { person: "nihal", layer: "home", id: "52767310-b8e8-4827-bf66-ae08a9a68120", shape: "layer" },
  { person: "nihal", layer: "personal", id: "e959c33a-968e-4da3-a1f5-f10e65acc094", shape: "layer" },
  { person: "nihal", layer: "ecom", id: "dc07abb4-803e-4058-95f2-10dd473402fa", shape: "layer" },
  { person: "nihal", layer: "ayah", id: "a2d13dcd-ce40-4899-b211-bba55eed3b50", shape: "layer" },
  { person: "ansar", layer: "homeschool", id: "63550d99-ab80-4c2d-914d-d7df6d2f95a9", shape: "weekly" },
];

/**
 * One block on the board. `category`, `detail` and `emoji` only ever come from the
 * Weekly Schedule shape, so they are optional and absent on the seven layer sources.
 */
export interface Block {
  person: string;
  layer: string;
  day: string;
  start: string;
  end: string;
  title: string;
  notes: string;
  category?: string;
  detail?: string;
  emoji?: string;
}

interface SourceError {
  person: string;
  layer: string;
  error: string;
}

export interface BoardPayload {
  blocks: Block[];
  errors: SourceError[];
}

// Notion caps a query page at 100 rows. Every source is well under that today, but a
// silent truncation would look identical to a genuinely short week, so page through.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 10_000;

type NotionProp = unknown;
type NotionPage = { properties?: Record<string, NotionProp> };

// Joins every chunk, not just the first. Notion splits a rich_text value at each
// formatting boundary, so bolding one word inside a note turns it into two chunks —
// reading only `[0]` would silently truncate it at the first bit of formatting.
function plainText(prop: NotionProp): string {
  const rich = (prop as { rich_text?: { plain_text?: string }[] } | undefined)?.rich_text;
  if (!rich) return "";
  return rich.map((t) => t.plain_text ?? "").join("");
}

function titleText(prop: NotionProp): string | null {
  const title = (prop as { title?: { plain_text?: string }[] } | undefined)?.title;
  if (!title) return null;
  return title.map((t) => t.plain_text ?? "").join("") || null;
}

function selectName(prop: NotionProp): string {
  return (prop as { select?: { name?: string } } | undefined)?.select?.name ?? "";
}

function multiSelectNames(prop: NotionProp): string[] {
  const items = (prop as { multi_select?: { name?: string }[] } | undefined)?.multi_select ?? [];
  return items.map((s) => s.name ?? "").filter(Boolean);
}

/**
 * Maps one Notion row to one block per day it occurs on, for either shape.
 *
 * The layer shape carries a single-select `Day`, so it yields exactly one block. The
 * Weekly Schedule carries a multi-select `Days`, so a row spanning Mon–Thu fans out
 * into four blocks. A row with no day at all yields nothing — it cannot be placed.
 */
function mapRow(page: NotionPage, source: SourceDef): Block[] {
  const props = page.properties ?? {};

  const days =
    source.shape === "weekly"
      ? multiSelectNames(props.Days)
      : [selectName(props.Day)].filter(Boolean);

  if (days.length === 0) return [];

  // `Block` on layer sources, `Entry` on the Weekly Schedule. Falling back to whichever
  // property is actually the title keeps a renamed column from emptying the board.
  const title =
    titleText(props.Block) ??
    titleText(props.Entry) ??
    Object.values(props).map(titleText).find((t) => t !== null) ??
    "Untitled";

  // Start/End are free text in Notion and are NOT normalised here: layer sources store
  // "14:00", the Weekly Schedule stores "9:05am". Passing them through verbatim keeps
  // this route a reader — deciding a single display format is the renderer's call.
  const base: Block = {
    person: source.person,
    layer: source.layer,
    day: "",
    start: plainText(props.Start),
    end: plainText(props.End),
    title,
    notes: plainText(props.Notes),
  };

  if (source.shape === "weekly") {
    const category = selectName(props.Category);
    const detail = plainText(props.Detail);
    const emoji = plainText(props.Emoji);
    if (category) base.category = category;
    if (detail) base.detail = detail;
    if (emoji) base.emoji = emoji;
  }

  return days.map((day) => ({ ...base, day }));
}

async function fetchSource(source: SourceDef): Promise<Block[]> {
  if (!NOTION_TOKEN) {
    throw new Error("Missing NOTION_TOKEN");
  }

  const blocks: Block[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${source.id}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        cursor ? { page_size: PAGE_SIZE, start_cursor: cursor } : { page_size: PAGE_SIZE },
      ),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Notion API ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    for (const row of (data.results ?? []) as NotionPage[]) {
      blocks.push(...mapRow(row, source));
    }

    if (!data.has_more || !data.next_cursor) return blocks;
    cursor = data.next_cursor;
  }

  throw new Error(`Exceeded ${MAX_PAGES} pages`);
}

export async function GET() {
  // All eight in flight at once. Settled, not raced: one dead source must not take the
  // other seven down with it — the board degrades a layer at a time, never wholesale.
  const results = await Promise.allSettled(SOURCES.map(fetchSource));

  const blocks: Block[] = [];
  const errors: SourceError[] = [];

  results.forEach((result, i) => {
    const source = SOURCES[i];
    if (result.status === "fulfilled") {
      blocks.push(...result.value);
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Error fetching ${source.person}/${source.layer}:`, message);
      errors.push({ person: source.person, layer: source.layer, error: message });
    }
  });

  const payload: BoardPayload = { blocks, errors };
  return NextResponse.json(payload);
}
