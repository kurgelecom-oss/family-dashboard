import { NextResponse } from "next/server";

// Cached for 5 minutes (legacy caching model — cacheComponents is not enabled)
export const dynamic = "force-static";
export const revalidate = 300;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// Data source ("ANSAR OS — App Settings"), same id-vs-database caveat as
// get-schedule.js — query only, GET /v1/databases/{id} 404s.
const NOTION_SETTINGS_DB_ID = "0415a499-d4ee-49e8-baf6-a3f38ec27235";

interface Settings {
  pointsActive: boolean;
  pointsActiveSince: string | null;
  note: string;
}

async function fetchSettings(): Promise<Settings> {
  if (!NOTION_TOKEN) {
    throw new Error("Missing Notion credentials");
  }

  const response = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_SETTINGS_DB_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: { property: "Setting", title: { equals: "ANSAR FC Points Gate" } },
    }),
  });

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.statusText}`);
  }

  const data = await response.json();
  const props = data.results[0]?.properties;
  if (!props) {
    throw new Error("ANSAR FC Points Gate row not found");
  }

  return {
    pointsActive: props["Points Active"]?.checkbox ?? false,
    pointsActiveSince: props["Points Active Since"]?.date?.start ?? null,
    note: props.Note?.rich_text?.[0]?.plain_text || "",
  };
}

export async function GET() {
  try {
    const settings = await fetchSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    // Fail closed: hide scoring rather than risk showing it on stale/wrong data
    return NextResponse.json({ pointsActive: false, pointsActiveSince: null, note: "" });
  }
}
