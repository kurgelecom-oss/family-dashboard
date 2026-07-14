import { NextResponse } from "next/server";

// Cached for 5 minutes (legacy caching model — cacheComponents is not enabled)
export const dynamic = "force-static";
export const revalidate = 300;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// Data source ("ANSAR OS — Habit Blocks (App Source)"), same id-vs-database
// caveat as get-schedule.js — query only, GET /v1/databases/{id} 404s.
const NOTION_HABITS_DB_ID = "470a7eba-f14b-42c5-92fb-79a006720240";

// Notion "Block" select options -> local block ids used by the scoring math
// in PanelHabits.tsx / WeekProgressStrip.tsx.
const BLOCK_MAP: Record<string, string> = {
  "Pre-Homeschool": "pre",
  "Homeschool": "school",
  "Afternoon/Evening": "arvo",
  "Conditional": "conditional",
};

interface Habit {
  id: string;
  name: string;
  block: string;
  order: number;
  points: number;
  pointType: string;
}

async function fetchHabits(): Promise<Habit[]> {
  if (!NOTION_TOKEN) {
    throw new Error("Missing Notion credentials");
  }

  const response = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_HABITS_DB_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: { property: "Active", checkbox: { equals: true } },
      sorts: [{ property: "Order", direction: "ascending" }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.statusText}`);
  }

  const data = await response.json();

  return data.results.map((page: any) => {
    const props = page.properties;

    return {
      id: props["Habit ID"]?.rich_text?.[0]?.plain_text || "",
      name: props.Name?.title?.[0]?.plain_text || "Untitled",
      block: BLOCK_MAP[props.Block?.select?.name] || "pre",
      order: props.Order?.number ?? 0,
      points: props.Points?.number ?? 0,
      pointType: props["Point Type"]?.select?.name || "",
    };
  });
}

export async function GET() {
  try {
    const habits = await fetchHabits();
    return NextResponse.json(habits);
  } catch (error) {
    console.error("Error fetching habits:", error);
    // Empty array with 200 so the panels degrade gracefully instead of erroring
    return NextResponse.json([]);
  }
}
