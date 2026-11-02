import { NextResponse } from 'next/server';
import { familyDb, familyWorkspace } from '../../../lib/family-db';
import { gmail } from '../../../lib/story/server';
import { presentEmail, PRESENT_TO } from '../../../lib/present-email';
import { personById } from '../../../present/topics';
import type { Kind } from '../../../present/topics';

/* POST { person } after the wheel lands: emails that person their week plan.
   Open like the spin itself (the TV has no PIN), but it can only ever send the
   stored spin to the fixed family address, once: the row is claimed first
   (emailed_at) and released only if the send fails. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  let id = '';
  try { id = String((await request.json()).person ?? ''); } catch { /* falls through to 400 */ }
  if (!personById(id) || !PRESENT_TO[id]) return NextResponse.json({ error: 'Unknown person' }, { status: 400, headers: noStore });
  const db = familyDb(), ws = familyWorkspace();
  const [row] = await db`update fds_present_spins set emailed_at=now()
    where workspace=${ws} and person=${id} and emailed_at is null
      and week_start=(select max(week_start) from fds_present_spins where workspace=${ws} and person=${id})
    returning week_start::text as week, topic, kind`;
  if (!row) return NextResponse.json({ ok: true, sent: false }, { headers: noStore });
  try {
    const mail = presentEmail(id, row.topic, row.kind as Kind, row.week);
    await gmail(PRESENT_TO[id], mail.subject, mail.html);
    return NextResponse.json({ ok: true, sent: true }, { headers: noStore });
  } catch (e) {
    await db`update fds_present_spins set emailed_at=null where workspace=${ws} and person=${id} and week_start=${row.week}::date`;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Send failed' }, { status: 502, headers: noStore });
  }
}
