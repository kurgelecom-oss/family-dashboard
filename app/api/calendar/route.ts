import { NextResponse } from "next/server";

// To enable calendar sync, set these Netlify env vars:
//   MS_CAL_CLIENT_ID      — Azure app registration client ID (Personal accounts)
//   MS_CAL_CLIENT_SECRET  — Azure app client secret
//   MS_CAL_TAYLAN_REFRESH — refresh token for taylan.k8@hotmail.com
//   MS_CAL_NIHAL_REFRESH  — refresh token for nils_gvi@hotmail.com  (optional)
//   MS_CAL_ANSAR_REFRESH  — refresh token for ansar.k11@hotmail.com  (optional)

import { ACCOUNTS, fetchEvents, getAccessToken, toISO } from "../../lib/graph-cal";

export async function GET() {
  const now = new Date();
  const startISO = now.toISOString();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 90);
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
    webLink?: string;
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
      // Own events and invitations (tk, 25 Oct 2026); declined or cancelled ones stay off the board.
      raw.filter(e => !e.isCancelled && e.responseStatus?.response !== "declined").slice(0, 6).forEach(e => {
        events.push({
          id:       `${account.key}-${e.id}`,
          subject:  e.subject ?? "(No title)",
          startISO: toISO(e.start.dateTime),
          endISO:   toISO(e.end.dateTime),
          isAllDay: e.isAllDay ?? false,
          account:  account.key,
          email:    account.email,
          color:    account.color,
          webLink:  e.webLink,
        });
      });
    } catch (err) {
      errors.push(`${account.email}: ${String(err)}`);
    }
  }

  events.sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());

  // An invitation shared by two of us shows once: same title and start = same event.
  const seen = new Set<string>();
  const unique = events.filter(e => { const k = `${e.subject.trim().toLowerCase()}|${e.startISO}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return NextResponse.json({
    events: unique,
    configured,
    missing,
    errors: errors.length ? errors : undefined,
  });
}
