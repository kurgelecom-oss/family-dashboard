import { NextResponse } from "next/server";

// Cached for 5 minutes (legacy caching model — cacheComponents is not enabled)
export const dynamic = "force-static";
export const revalidate = 300;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// This is a DATA SOURCE id ("ANSAR OS — Weekly Schedule (App Source)"), not a
// database id — GET /v1/databases/{id} 404s for it, only the query below works.
const NOTION_SCHEDULE_DB_ID = process.env.NOTION_SCHEDULE_DB_ID;

interface ScheduleRow {
  block: string;
  time: string;
  order: number;
  detail: string;
  emoji: string;
  days: string[];
}

async function fetchScheduleRows(): Promise<ScheduleRow[]> {
  if (!NOTION_TOKEN || !NOTION_SCHEDULE_DB_ID) {
    throw new Error("Missing Notion credentials");
  }

  const response = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_SCHEDULE_DB_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.statusText}`);
  }

  const data = await response.json();

  return data.results
    .map((page: any) => {
      const props = page.properties;

      return {
        block: props.Block?.title?.[0]?.plain_text || "Untitled",
        time: props.Time?.rich_text?.[0]?.plain_text || "",
        order: props.Order?.number ?? 0,
        detail: props.Detail?.rich_text?.[0]?.plain_text || "",
        emoji: props.Emoji?.rich_text?.[0]?.plain_text || "",
        days: (props.Days?.multi_select ?? []).map((s: { name: string }) => s.name),
      };
    })
    .sort((a: ScheduleRow, b: ScheduleRow) => a.order - b.order);
}

export async function GET() {
  try {
    const rows = await fetchScheduleRows();
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    // Empty array with 200 so /week falls back to its hardcoded rows
    return NextResponse.json([]);
  }
}
