import { NextResponse } from "next/server";

// Cached for 5 minutes (legacy caching model — cacheComponents is not enabled)
export const dynamic = "force-static";
export const revalidate = 300;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// This is a DATA SOURCE id ("ANSAR OS — Weekly Schedule (App Source)"), not a
// database id — GET /v1/databases/{id} 404s for it, only the query below works.
const NOTION_SCHEDULE_DB_ID = process.env.NOTION_SCHEDULE_DB_ID;

interface ScheduleEntry {
  entry: string;
  days: string[];
  date: string | null;
  start: string;
  end: string;
  category: string;
  detail: string;
  emoji: string;
}

async function fetchScheduleEntries(): Promise<ScheduleEntry[]> {
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

  return data.results.map((page: any) => {
    const props = page.properties;

    return {
      entry: props.Entry?.title?.[0]?.plain_text || "Untitled",
      days: (props.Days?.multi_select ?? []).map((s: { name: string }) => s.name),
      // Date is a one-off occurrence; keep just the YYYY-MM-DD part
      date: props.Date?.date?.start?.slice(0, 10) ?? null,
      start: props.Start?.rich_text?.[0]?.plain_text || "",
      end: props.End?.rich_text?.[0]?.plain_text || "",
      category: props.Category?.select?.name || "",
      detail: props.Detail?.rich_text?.[0]?.plain_text || "",
      emoji: props.Emoji?.rich_text?.[0]?.plain_text || "",
    };
  });
}

export async function GET() {
  try {
    const entries = await fetchScheduleEntries();
    return NextResponse.json(entries);
  } catch (error) {
    console.error("Error fetching schedule:", error);
    // Empty array with 200 so /week shows its "No schedule yet" state
    return NextResponse.json([]);
  }
}
