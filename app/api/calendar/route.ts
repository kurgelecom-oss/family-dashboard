import { NextResponse } from "next/server";

// To enable calendar sync, set these Netlify env vars:
//   MS_CAL_CLIENT_ID      — Azure app registration client ID (Personal accounts)
//   MS_CAL_CLIENT_SECRET  — Azure app client secret
//   MS_CAL_TAYLAN_REFRESH — refresh token for taylan.k8@hotmail.com
//   MS_CAL_NIHAL_REFRESH  — refresh token for nils_gvi@hotmail.com  (optional)
//   MS_CAL_ANSAR_REFRESH  — refresh token for ansar.k11@hotmail.com  (optional)

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

const ACCOUNTS = [
  { key: "TAYLAN", email: "taylan.k8@hotmail.com", color: "cyan",  envKey: "MS_CAL_TAYLAN_REFRESH" },
  { key: "NIHAL",  email: "nils_gvi@hotmail.com",  color: "green", envKey: "MS_CAL_NIHAL_REFRESH"  },
  { key: "ANSAR",  email: "ansar.k11@hotmail.com", color: "amber", envKey: "MS_CAL_ANSAR_REFRESH"  },
];

type CalEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end:   { dateTime: string; timeZone: string };
  isAllDay?: boolean;
};

async function getAccessToken(refreshToken: string): Promise<string> {
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

async function fetchEvents(accessToken: string, startISO: string, endISO: string): Promise<CalEvent[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", startISO);
  url.searchParams.set("endDateTime", endISO);
  url.searchParams.set("$select", "id,subject,start,end,isAllDay");
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set("$top", "50");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { value: CalEvent[] };
  return data.value ?? [];
}

export async function GET() {
  const now = new Date();
  const startISO = now.toISOString();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 7);
  const endISO = endDate.toISOString();

  const events: Array<{
    id: string;
    subject: string;
    startISO: string;
    endISO: string;
    isAllDay: boolean;
    account: string;
    email: string;
    color: string;
  }> = [];

  const errors: string[] = [];
  const configured: string[] = [];
  const missing: string[] = [];

  for (const account of ACCOUNTS) {
    const refreshToken = process.env[account.envKey];
    if (!refreshToken) {
      missing.push(account.email);
      continue;
    }
    configured.push(account.email);
    try {
      const accessToken = await getAccessToken(refreshToken);
      const raw = await fetchEvents(accessToken, startISO, endISO);
      raw.forEach(e => {
        events.push({
          id:       `${account.key}-${e.id}`,
          subject:  e.subject ?? "(No title)",
          startISO: e.start.dateTime,
          endISO:   e.end.dateTime,
          isAllDay: e.isAllDay ?? false,
          account:  account.key,
          email:    account.email,
          color:    account.color,
        });
      });
    } catch (err) {
      errors.push(`${account.email}: ${String(err)}`);
    }
  }

  events.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());

  return NextResponse.json({
    events,
    configured,
    missing,
    errors: errors.length ? errors : undefined,
  });
}
