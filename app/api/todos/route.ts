import { NextRequest, NextResponse } from "next/server";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// Notion-Version 2026-03-11 queries DATA SOURCES, not databases.
// This must be the data_source_id, not the database_id.
const NOTION_DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;

interface NotionTodo {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  context: "personal" | "work" | "family";
  dueDate?: string;
  completed: boolean;
  notes?: string;
}

async function fetchNotionTodos(): Promise<NotionTodo[]> {
  if (!NOTION_TOKEN || !NOTION_DATA_SOURCE_ID) {
    throw new Error("Missing Notion credentials");
  }

  const response = await fetch(`https://api.notion.com/v1/data_sources/${NOTION_DATA_SOURCE_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2026-03-11",
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
      id: page.id,
      title: props.Title?.title?.[0]?.plain_text || "Untitled",
      priority: (props.Priority?.select?.name || "medium").toLowerCase() as "high" | "medium" | "low",
      context: (props.Context?.select?.name || "personal").toLowerCase() as "personal" | "work" | "family",
      dueDate: props["Due Date"]?.date?.start || undefined,
      completed: props.Completed?.checkbox || false,
      notes: props.Notes?.rich_text?.[0]?.plain_text || undefined,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const todos = await fetchNotionTodos();
    return NextResponse.json(todos);
  } catch (error) {
    console.error("Error fetching todos:", error);
    return NextResponse.json({ error: "Failed to fetch todos" }, { status: 500 });
  }
}
