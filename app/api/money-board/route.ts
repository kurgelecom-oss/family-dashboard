import { NextResponse } from 'next/server';
import { canEditFamily } from '../../lib/family-auth';
import { measureGoals, openGoals } from '../../lib/goal-measures';

/* /api/money-board — the family goals (master list fds_goals, measured in
   lib/goal-measures.ts) plus CLEO's daily money snapshot (Mission Control row
   id "money", refreshed 07:15 every day).

   PIN-gated: this site is readable by anyone with the URL and the repo is
   public, so balances only reach a device unlocked with the family PIN.
   Locked devices get goal percentages and nothing else.

   Goal measures live in lib/goal-measures.ts (one definition for the bar,
   this card, /sunday and the story). Unlocked devices also get the dollar
   figure behind the bank goals (net = bank minus card debt) and the weekly
   income goal (custm + Moonstar). */

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

type Snap = {
  generated_at: string; week: { from: string; to: string };
  cash: { bank: number; card_debt: number };
  income: { streams: { key: string; label: string; amount: number }[] };
  spend: { business: number };
  focus?: { headline?: string; actions?: { text: string }[] };
  ahead?: { bills: { date: string; title: string; amount: number }[] }[];
  targets?: { set_aside?: { total: number } };
};

export async function GET(request: Request) {
  const url = process.env.MC_SUPABASE_URL, key = process.env.MC_SUPABASE_SERVICE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Money snapshot not connected' }, { status: 503, headers: noStore });
  let snap: Snap;
  try {
    const r = await fetch(`${url}/rest/v1/cos_mission_control?id=eq.money&select=doc`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error();
    snap = ((await r.json()) as { doc: Snap }[])[0]?.doc;
    if (!snap?.cash) throw new Error();
  } catch {
    return NextResponse.json({ error: 'Money snapshot unavailable' }, { status: 503, headers: noStore });
  }

  const net = snap.cash.bank - snap.cash.card_debt;
  const business = snap.income.streams.filter(s => s.key !== 'custm').reduce((a, s) => a + s.amount, 0);
  const wages = snap.income.streams.filter(s => s.key === 'custm').reduce((a, s) => a + s.amount, 0);
  const takeHome = business - (snap.spend.business ?? 0);
  const wageIncome = snap.income.streams.filter(s => s.key === 'custm' || s.key === 'moonstar').reduce((a, s) => a + s.amount, 0);
  let measured: Awaited<ReturnType<typeof measureGoals>> = [];
  try { measured = await measureGoals(await openGoals()); } catch { /* goals table unreachable: money still shows */ }
  const goals = measured.map(g => ({
    id: g.id, rank: g.rank, label: g.goal, short: g.short, range: g.range, priority: g.priority, due: g.due,
    pct: g.measure?.pct ?? null, txt: g.measure?.txt ?? null, hit: !!g.measure?.hit,
    dollars: g.metric === 'net' ? net : g.metric === 'income_wk' ? wageIncome : null,
  }));
  const stripped = goals.map(({ dollars, ...g }) => { void dollars; return g; });

  if (!(await canEditFamily(request))) return NextResponse.json({ unlocked: false, asOf: snap.generated_at, goals: stripped }, { headers: noStore });

  return NextResponse.json({
    unlocked: true, asOf: snap.generated_at, week: snap.week,
    goals: goals.map(({ dollars, ...g }) => (dollars === null ? g : { ...g, now: Math.round(dollars) })),
    cash: { bank: snap.cash.bank, cardDebt: snap.cash.card_debt, net },
    week_income: { business, wages, businessSpend: snap.spend.business, takeHome },
    headline: snap.focus?.headline ?? null,
    actions: (snap.focus?.actions ?? []).slice(0, 2).map(a => a.text),
    bills: (snap.ahead?.[0]?.bills ?? []).slice(0, 3),
    setAside: snap.targets?.set_aside?.total ?? null,
  }, { headers: noStore });
}
