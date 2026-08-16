/**
 * The one Notion data-source reader.
 *
 * This file exists because there were a dozen hand-rolled copies of the same
 * POST /v1/data_sources/{id}/query — settings, schedule, habits, board,
 * mission, actions, origins, todos, weekly-review — each with its own idea of
 * page size, its own pagination guard, and its own answer to whether a slow
 * source may hold the whole route open.
 *
 * `fetchSource` is lifted verbatim from app/api/mission/route.ts, which had the
 * most careful version of the three behaviours that matter: cursor pagination
 * bounded by MAX_PAGES, a per-request abort, and a throw rather than a silent
 * truncation when the bound is hit. Nothing about it was "improved" on the way
 * across — mission's response has to be byte-identical before and after, and
 * the cheapest way to guarantee that is to change none of the code.
 *
 * NOTION_VERSION is imported rather than redeclared. It was written out as a
 * literal in several files; a pinned API version living in several places is a
 * version that gets bumped in all but one.
 */

import { NOTION_VERSION } from "./settings";

const NOTION_TOKEN = process.env.NOTION_TOKEN;

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 10_000;

export type NotionProp = unknown;
export type NotionPage = {
  id?: string;
  created_time?: string;
  properties?: Record<string, NotionProp>;
};

/**
 * Every row of one data source. Verbatim the request shape /api/board uses:
 * POST /v1/data_sources/{id}/query, bearer token, Notion-Version 2025-09-03,
 * cursor pagination bounded by MAX_PAGES, and a per-request abort so one
 * unresponsive source cannot hold the whole route open.
 */
export async function fetchSource(id: string, label: string): Promise<NotionPage[]> {
  if (!NOTION_TOKEN) {
    throw new Error("Missing NOTION_TOKEN");
  }

  const rows: NotionPage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(`https://api.notion.com/v1/data_sources/${id}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
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
    rows.push(...((data.results ?? []) as NotionPage[]));

    if (!data.has_more || !data.next_cursor) return rows;
    cursor = data.next_cursor;
  }

  throw new Error(`Exceeded ${MAX_PAGES} pages for ${label}`);
}
