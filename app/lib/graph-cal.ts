/* Microsoft Graph calendar reads, shared by /api/calendar (home board) and /api/cal (/board). */

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

export const ACCOUNTS = [
  { key: "TAYLAN", email: "taylan.k8@hotmail.com", color: "cyan",  envKey: "MS_CAL_TAYLAN_REFRESH" },
  { key: "NIHAL",  email: "nils_gvi@hotmail.com",  color: "green", envKey: "MS_CAL_NIHAL_REFRESH"  },
  { key: "ANSAR",  email: "ansar.k11@hotmail.com", color: "amber", envKey: "MS_CAL_ANSAR_REFRESH"  },
];

export type CalEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end:   { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isOrganizer?: boolean;
  isCancelled?: boolean;
  /** Set on occurrences of a recurring event; the pop-up choice is keyed on it. */
  seriesMasterId?: string | null;
  responseStatus?: { response?: string };
  /** Outlook web URL for the event — what "tap → the event" opens. */
  webLink?: string;
};

// Graph returns calendarView times in UTC but with NO offset in the string
// (e.g. "2026-07-26T21:30:00.0000000") because of the Prefer header below. That
// is not valid ISO-8601, so every consumer had to carry its own defensive
// "append Z" parser — and an earlier attempt to "fix" it by appending +10:00
// instead shifted every timed event 10h and mis-fired the banners. Normalise
// once, here, so the field named startISO actually is an ISO string.
export function toISO(graphDateTime: string): string {
  const s = graphDateTime.trim();
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasOffset ? s : s + "Z");
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId     = process.env["MS_CAL_CLIENT_ID"];
  const clientSecret = process.env["MS_CAL_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("MS_CAL_CLIENT_ID / MS_CAL_CLIENT_SECRET not set");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
      scope:         "Calendars.Read offline_access",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function fetchEvents(accessToken: string, startISO: string, endISO: string, top = 20): Promise<CalEvent[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", startISO);
  url.searchParams.set("endDateTime", endISO);
  url.searchParams.set("$select", "id,seriesMasterId,subject,start,end,isAllDay,isOrganizer,isCancelled,responseStatus,webLink");
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set("$top", String(top));

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // Force UTC (Graph's default) so start/end dateTime strings are always
      // UTC with no offset — the client parses bare strings as UTC.
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { value: CalEvent[] };
  return data.value ?? [];
}
