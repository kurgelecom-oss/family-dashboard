import { NextResponse } from 'next/server';
import { canEditFamily } from '../../lib/family-auth';
import { tickDailyOrder } from '../../lib/daily-order';

/* POST { key, checked } — tick Nihal's daily order from the home board's ticker.
   Family PIN, same gate as the hand-ticked tasks. Writes Launchpad's checklist,
   so the tick shows in Nihal OS too. */

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (!await canEditFamily(request)) return NextResponse.json({ error: 'Unlock family editing first' }, { status: 401, headers });
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Use this dashboard to tick tasks' }, { status: 403, headers });
  const body = await request.json().catch(() => null) as { key?: unknown; checked?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!/^[a-z_]{2,40}$/.test(key) || typeof body?.checked !== 'boolean') return NextResponse.json({ error: 'Invalid tick' }, { status: 400, headers });
  try {
    const r = await tickDailyOrder(key, body.checked);
    return r.ok ? NextResponse.json({ saved: true }, { headers }) : NextResponse.json({ error: r.error }, { status: r.status, headers });
  } catch { return NextResponse.json({ error: 'Launchpad could not be reached. Nothing was saved.' }, { status: 503, headers }); }
}
