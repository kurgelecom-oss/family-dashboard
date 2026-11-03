/* The family goals master list (fds_goals) and how each goal is measured.
   Feeds /api/goals → the goal bar, the home "Our goals" card, /sunday and the weekly story.

   TV-safe by design: every measure is a percentage, a count, a trend or days — never a balance.
   Sources: CLEO's daily money snapshot (Mission Control row "money") and the Launchpad test log.

   Metrics (tk, 3 Nov 2026):
     income_wk  custm wages + Moonstar for CLEO's last full week, against the target.
     omega_wk   OmegaXL sustain/scale: the week is in profit (sustain) and the daily profit pace
                beats last week's (scale). Hit = in profit. Shown as the pace change, ▲/▼ n%.
     tests_wk   products with ad spend this week, the main Omega test excluded. Hit at the target.
     net        bank minus card debt, against the target.
     proof      "what we did with Omega, with another product": the best non-Omega product's first
                30 days of profit, as a % of Omega's first 30 days. 100% = proven.
     date       days to the due date only.
   Launchpad entry dates are the ad account's day (New York), so "this week" can lag a day. */
import { familyDb, familyWorkspace } from './family-db';
import { launchpad } from './launchpad';
import { entryProfit, weekBounds, type LpEntry, type LpTest } from './goal-math.ts';

export type GoalRow = { id: string; rank: number; goal: string; short: string; range: string; priority: number | null; how: string; metric: string; target: number | null; due: string | null };
export type Measure = { pct?: number; txt?: string; hit?: boolean };
export type Goal = GoalRow & { measure: Measure | null };

export async function openGoals(): Promise<GoalRow[]> {
  const rows = await familyDb()`select id, rank, goal, short, range, priority, how, metric, target::float8 as target, due::text as due from fds_goals where workspace=${familyWorkspace()} and status='open' order by rank`;
  return rows as unknown as GoalRow[];
}

type Snap = { generated_at: string; cash: { bank: number; card_debt: number }; income: { streams: { key: string; amount: number }[] } };
async function cleo(): Promise<Snap | null> {
  const url = process.env.MC_SUPABASE_URL, key = process.env.MC_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/cos_mission_control?id=eq.money&select=doc`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return ((await r.json()) as { doc: Snap }[])[0]?.doc ?? null;
  } catch { return null; }
}

const isOmega = (t: LpTest) => /omega/i.test(t.name);
const isNoise = (t: LpTest) => /dry run|backtest|^test(\.v\d)?$/i.test(t.name);

async function launchpadData() {
  const tests = (await launchpad<LpTest[]>('/tests', 300)).filter(t => !isNoise(t));
  const withEntries = await Promise.all(tests.map(async t => ({ t, e: (await launchpad<LpEntry[]>(`/entries?test_id=${encodeURIComponent(t.id)}`, 300)).sort((a, b) => a.entry_date.localeCompare(b.entry_date)) })));
  return withEntries.filter(x => x.e.length);
}

const first30 = (e: LpEntry[], t: LpTest) => { if (!e.length) return 0; const end = new Date(e[0].entry_date + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 30); const stop = end.toISOString().slice(0, 10); return e.filter(x => x.entry_date < stop).reduce((a, x) => a + entryProfit(x, t), 0); };

export async function measureGoals(rows: GoalRow[], now = new Date()): Promise<Goal[]> {
  const need = new Set(rows.map(r => r.metric));
  const [snap, lp] = await Promise.all([
    need.has('income_wk') || need.has('net') ? cleo() : Promise.resolve(null),
    need.has('omega_wk') || need.has('tests_wk') || need.has('proof') ? launchpadData().catch(() => null) : Promise.resolve(null),
  ]);
  const { mon, lastMon } = weekBounds(now);
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  const omega = lp?.filter(x => isOmega(x.t)) ?? [];
  const omegaMain = omega.slice().sort((a, b) => a.e[0].entry_date.localeCompare(b.e[0].entry_date))[0];

  const measure = (g: GoalRow): Measure | null => {
    switch (g.metric) {
      case 'income_wk': {
        if (!snap || !g.target) return null;
        const v = snap.income.streams.filter(s => s.key === 'custm' || s.key === 'moonstar').reduce((a, s) => a + s.amount, 0);
        return { pct: clamp(v / g.target * 100), hit: v >= g.target };
      }
      case 'net': {
        if (!snap || !g.target) return null;
        const v = snap.cash.bank - snap.cash.card_debt;
        return { pct: clamp(v / g.target * 100), hit: v >= g.target };
      }
      case 'omega_wk': {
        if (!omega.length) return null;
        const sum = (from: string, to: string) => omega.reduce((a, { t, e }) => a + e.filter(x => x.entry_date >= from && x.entry_date < to).reduce((b, x) => b + entryProfit(x, t), 0), 0);
        const days = (from: string, to: string) => new Set(omega.flatMap(({ e }) => e.filter(x => x.entry_date >= from && x.entry_date < to).map(x => x.entry_date))).size;
        const thisP = sum(mon, '9999'), thisD = days(mon, '9999'), lastP = sum(lastMon, mon), lastD = days(lastMon, mon);
        if (!thisD) return { txt: 'new wk' };
        const pace = thisP / thisD, lastPace = lastD ? lastP / lastD : 0;
        const trend = lastPace > 0 ? Math.round((pace - lastPace) / lastPace * 100) : null;
        return { txt: thisP <= 0 ? 'not in profit' : trend === null ? 'in profit' : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend)}%`, hit: thisP > 0 };
      }
      case 'tests_wk': {
        if (!lp) return null;
        const n = lp.filter(x => x !== omegaMain && x.e.some(e => e.entry_date >= mon && (e.meta_spend ?? 0) > 0)).length;
        return { txt: `${n}/${g.target ?? 3}`, hit: n >= (g.target ?? 3) };
      }
      case 'proof': {
        if (!lp || !omegaMain) return null;
        const bar = first30(omegaMain.e, omegaMain.t);
        if (bar <= 0) return null;
        const best = Math.max(0, ...lp.filter(x => !isOmega(x.t)).map(x => first30(x.e, x.t)));
        return { pct: clamp(best / bar * 100), hit: best >= bar };
      }
      default: return null;
    }
  };
  return rows.map(g => ({ ...g, measure: measure(g) }));
}
