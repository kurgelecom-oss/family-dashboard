import { NextResponse } from 'next/server';
import { canEditFamily } from '../../lib/family-auth';
import { familyDb, familyWorkspace } from '../../lib/family-db';
import { isBoard } from '../../lib/prayer';
import { readBoard } from '../../lib/prayer-store';

/* /api/prayer — the Home Prayer Board (public/prayer.html).
   GET → the whole board. PUT → replace it (family PIN session, same gate as
   the daily ticks). A save older than the stored one is refused (409) so a
   stale tab can't overwrite a newer arrangement. */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const board = await readBoard();
    return board ? NextResponse.json(board, { headers: noStore }) : NextResponse.json({ error: 'No board saved' }, { status: 404, headers: noStore });
  } catch {
    return NextResponse.json({ error: 'Prayer board unavailable' }, { status: 503, headers: noStore });
  }
}

export async function PUT(request: Request) {
  if (!(await canEditFamily(request))) return NextResponse.json({ error: 'Unlock with the family PIN' }, { status: 401, headers: noStore });
  let board: unknown;
  try { board = await request.json(); } catch { return NextResponse.json({ error: 'Bad board' }, { status: 400, headers: noStore }); }
  if (!isBoard(board)) return NextResponse.json({ error: 'Bad board' }, { status: 400, headers: noStore });
  const db = familyDb(), ws = familyWorkspace();
  const saved = await db`insert into fds_prayer_board(workspace,doc,updated_at) values(${ws},${db.json(JSON.parse(JSON.stringify(board)))},now())
    on conflict(workspace) do update set doc=excluded.doc,updated_at=now()
    where (fds_prayer_board.doc->>'updated') <= ${board.updated}
    returning doc->>'updated' as updated`;
  if (!saved.length) return NextResponse.json({ error: 'A newer board was saved', board: await readBoard() }, { status: 409, headers: noStore });
  return NextResponse.json({ ok: true, updated: saved[0].updated }, { headers: noStore });
}
