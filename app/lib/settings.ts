/* ════════════════════════════════════════════════════════════════════════════
   Dashboard settings — the single source of truth for every configurable value.

   Backed by the Notion "Dashboard Settings" data source. Rows with Active
   unchecked are excluded, and any key that is missing or inactive falls back to
   the built-in default below with a console.warn naming the key, so a silently
   wrong figure is never rendered.

   getSetting() lives here rather than in the route file: Next 16 type-checks
   route modules and rejects exports other than the HTTP verbs and the
   segment-config keys, so a helper exported from route.ts fails the build.
   ══════════════════════════════════════════════════════════════════════════ */

export const SETTINGS_DATA_SOURCE_ID = "f62fb9fd-cb43-440d-9994-ad349afd64de";

/** Notion API version verified against this data source. */
export const NOTION_VERSION = "2025-09-03";

export type SettingType = "currency" | "number" | "percent" | "date" | "boolean" | "text";

export type SettingValue = number | string | boolean;

export type SettingsMap = Record<string, SettingValue>;

/**
 * Built-in defaults. Every one matches the literal it replaced, so a total
 * settings outage renders exactly what the dashboard rendered before this layer
 * existed rather than zeros or blanks.
 */
export const SETTING_DEFAULTS = {
  // Global
  TIMEZONE: "Australia/Sydney",
  CACHE_MINUTES: 30,

  // Column A · Finance
  POCKETSMITH_DASHBOARD_URL: "https://my.pocketsmith.com/dashboard/765041-kurgel-pty-ltd",
  INCLUDE_UNCATEGORISED: true,

  // Column B · Ecom
  TARGET_MONTHLY_REVENUE: 15000,
  TEST_ENTRY_WINDOW_LOW: 350,
  TEST_ENTRY_WINDOW_HIGH: 450,
  TEST_STALE_AMBER_DAYS: 2,
  TEST_STALE_RED_DAYS: 14,
  BREAKEVEN_AMBER_BAND_PCT: 10,
  AD_SPEND_SOURCE: "pocketsmith_meta_payees",
  NO_CAMPAIGNS_LOOKBACK_DAYS: 7,
  LABEL_AWAITING_DATA: "AWAITING TODAY'S DATA",
  LABEL_NO_CAMPAIGNS: "NO CAMPAIGNS LIVE",

  // Column C · Actions
  ACTION_ITEMS_SHOWN: 3,
  INPUT_HABITS_SHOWN: 3,
  OVERDUE_GRACE_DAYS: 1,
  TESTS_TARGET_COUNT: 3,
  TEST_GAP_AMBER_DAYS: 7,
  TEST_GAP_RED_DAYS: 14,
  TRACTION_END_DATE: "2026-12-31",
  LAUNCHPAD_GO_LIVE_DATE: "2026-07-09",

  // Present in Notion but deliberately unused: column C renders no currency.
  TARGET_ANNUAL_REVENUE: 180000,
  TARGET_WEEKLY_REVENUE: 3500,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

/**
 * Typed read with fallback. The return type is inferred from the fallback, so
 * consumers never handle a raw string from Notion.
 */
export function getSetting<T extends SettingValue>(
  settings: SettingsMap | null | undefined,
  key: SettingKey,
  fallback: T,
): T {
  const raw = settings?.[key];

  if (raw === undefined || raw === null) {
    console.warn(
      `[settings] "${key}" missing or inactive — falling back to ${JSON.stringify(fallback)}`,
    );
    return fallback;
  }

  if (typeof raw !== typeof fallback) {
    console.warn(
      `[settings] "${key}" is ${typeof raw}, expected ${typeof fallback} — falling back to ${JSON.stringify(fallback)}`,
    );
    return fallback;
  }

  return raw as T;
}

/* ────────────────────────────────────────────────────────────────────────────
   Notion parsing
   ──────────────────────────────────────────────────────────────────────── */

interface NotionRichText {
  plain_text: string;
}

interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  select?: { name: string } | null;
  checkbox?: boolean;
}

interface NotionPage {
  properties: Record<string, NotionProperty>;
}

const plain = (p: NotionProperty | undefined): string => {
  if (!p) return "";
  const parts = p.title ?? p.rich_text ?? [];
  return parts.map((x) => x.plain_text).join("").trim();
};

const selectName = (p: NotionProperty | undefined): string => p?.select?.name?.trim() ?? "";

/**
 * Coerce a Notion text Value into a JS value according to its Type column.
 * Returns undefined when the value cannot be parsed, so the caller drops the
 * row and the consumer falls back rather than rendering NaN.
 */
export function parseSettingValue(raw: string, type: string): SettingValue | undefined {
  const value = raw.trim();
  if (value === "") return undefined;

  switch (type as SettingType) {
    case "currency":
    case "number":
    case "percent": {
      // Tolerate values typed as "$15,000" or "10%" in Notion.
      const cleaned = value.replace(/[$,\s%]/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean": {
      const v = value.toLowerCase();
      if (["true", "yes", "1", "on"].includes(v)) return true;
      if (["false", "no", "0", "off"].includes(v)) return false;
      return undefined;
    }
    case "date": {
      // Already ISO in Notion; normalise and validate.
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return undefined;
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : d.toISOString();
    }
    case "text":
      return value;
    default:
      // Unknown Type — treat as text rather than dropping real config.
      return value;
  }
}

export interface SettingsResult {
  settings: SettingsMap;
  types: Record<string, string>;
  /** Keys present but excluded because Active was unchecked. */
  inactive: string[];
  /** Keys whose Value could not be parsed as its Type. */
  unparsed: string[];
  cacheSeconds: number;
}

/** Turn a Notion query response into the flat map consumers read. */
export function buildSettings(pages: NotionPage[]): SettingsResult {
  const settings: SettingsMap = {};
  const types: Record<string, string> = {};
  const inactive: string[] = [];
  const unparsed: string[] = [];

  for (const page of pages) {
    const props = page.properties ?? {};
    const key = plain(props["Setting"]);
    if (!key) continue;

    // Active unchecked → excluded entirely, so the consumer's fallback applies.
    if (props["Active"]?.checkbox !== true) {
      inactive.push(key);
      continue;
    }

    const type = selectName(props["Type"]) || "text";
    const parsed = parseSettingValue(plain(props["Value"]), type);

    if (parsed === undefined) {
      unparsed.push(key);
      continue;
    }

    settings[key] = parsed;
    types[key] = type;
  }

  // The cache window is itself a setting. Next requires the route's own
  // `revalidate` to be a static literal, so that stays at the 30-minute
  // default; this value is what the downstream data routes actually use.
  const minutes =
    typeof settings["CACHE_MINUTES"] === "number"
      ? (settings["CACHE_MINUTES"] as number)
      : SETTING_DEFAULTS.CACHE_MINUTES;

  return {
    settings,
    types,
    inactive,
    unparsed,
    cacheSeconds: Math.max(Math.round(minutes * 60), 60),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   Server-side loader — used directly by the other API routes
   ──────────────────────────────────────────────────────────────────────── */

/** Default cache window in seconds, used for the settings fetch itself. */
export const DEFAULT_CACHE_SECONDS = SETTING_DEFAULTS.CACHE_MINUTES * 60;

export async function loadSettings(): Promise<SettingsResult> {
  const token = process.env["NOTION_TOKEN"];
  if (!token) throw new Error("Missing Notion credentials");

  const response = await fetch(
    `https://api.notion.com/v1/data_sources/${SETTINGS_DATA_SOURCE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
      next: { revalidate: DEFAULT_CACHE_SECONDS },
    },
  );

  if (!response.ok) throw new Error(`Notion API error: ${response.status} ${response.statusText}`);

  const data = (await response.json()) as { results: NotionPage[] };
  return buildSettings(data.results ?? []);
}

/**
 * Settings for a server route, or an empty map if Notion is unreachable.
 * Never throws: a settings outage must degrade to built-in defaults rather than
 * take a whole data route down with it.
 */
export async function loadSettingsSafe(): Promise<SettingsResult> {
  try {
    return await loadSettings();
  } catch (error) {
    console.warn("[settings] load failed, using built-in defaults:", error);
    return {
      settings: {},
      types: {},
      inactive: [],
      unparsed: [],
      cacheSeconds: DEFAULT_CACHE_SECONDS,
    };
  }
}
