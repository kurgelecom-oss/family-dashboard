'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Money, NowFeed } from '../components/home/HomeBoard';
import { goalRag, listRag, paceRag, type Rag } from '../components/home/rag';
import { TZ, wall } from '../lib/cal-time';

/* The home board's key numbers, one row across the top of the calendar, read
   from the same /api/now and /api/money-board feeds so both screens always
   agree. Tap anywhere on the row to go back to the dashboard. */

const fmtTime = (iso: string | Date) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase();
const until = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function Cell({ rag, eye, children, sub }: { rag?: Rag; eye: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return <div className={'st-cell' + (rag ? ` ${rag}` : '')}><span className="st-eye">{rag && <i className="st-dot" />}{eye}</span><b>{children}</b>{sub && <small>{sub}</small>}</div>;
}

export default function Strip() {
  const [feed, setFeed] = useState<NowFeed | null>(null);
  const [money, setMoney] = useState<Money | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const load = () => { if (!document.hidden) fetch('/api/now', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(f => f && setFeed(f)).catch(() => {}); };
    const loadMoney = () => { if (!document.hidden) fetch('/api/money-board', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(m => m && setMoney(m)).catch(() => {}); };
    load(); loadMoney();
    const a = setInterval(load, 60_000), b = setInterval(loadMoney, 10 * 60_000), c = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, []);

  const hour = wall(now).min / 60;
  const prayer = feed?.prayer?.next;
  const prayerMs = prayer ? new Date(prayer.at).getTime() - now.getTime() : Infinity;
  const day = feed?.ansar.day ?? [];
  const current = day.find(s => new Date(s.start) <= now && now < new Date(s.end));
  const next = day.find(s => new Date(s.start) > now && !/break/i.test(s.title));
  const st = feed?.store;
  const goal = money?.goals.find(g => !g.hit) ?? money?.goals[money.goals.length - 1];
  const list = (t: NowFeed['nihal'] | undefined) => t ? `${t.done}/${t.total}` : '—';

  return (
    <Link className="cal-strip" href="/" aria-label="Open the family dashboard">
      <div className="st-clock"><b>{fmtTime(now)}</b><small>{new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</small></div>
      {prayer
        ? <Cell rag={prayerMs <= 20 * 60000 ? 'bad' : null} eye={`🕌 ${prayer.name}`} sub={`${prayer.leaderName} leads · in ${until(prayerMs)}`}>{fmtTime(prayer.at)}</Cell>
        : <Cell eye="🕌 Prayer">—</Cell>}
      <Cell eye="Ansar" sub={current && next ? `then ${next.title}` : feed?.ansar.habits ? `Habits ${feed.ansar.habits.done}/${feed.ansar.habits.total}` : undefined}>
        {current ? `${current.emoji} ${current.title}` : next ? `Next: ${next.emoji} ${next.title}` : feed ? 'No school now' : '…'}
      </Cell>
      <Cell rag={feed?.nihal && feed?.taylan ? listRag(feed.nihal.done + feed.taylan.done, feed.nihal.total + feed.taylan.total, hour) : null} eye="Today's list" sub="Nihal · TK">
        {list(feed?.nihal)} · {list(feed?.taylan)}
      </Cell>
      <Cell rag={st?.today ? paceRag(st.today.orders, st.avgOrders * st.dayFraction) : null} eye="Store today" sub={st?.today ? `pace ${Math.round(st.avgOrders * st.dayFraction)} orders${st.today.conversion != null ? ` · ${st.today.conversion.toFixed(1)}% conv` : ''}` : undefined}>
        {st?.today ? `${st.today.orders} orders · US$${Math.round(st.today.revenue).toLocaleString('en-AU')}` : feed ? '—' : '…'}
      </Cell>
      <Cell rag={feed?.ads ? (feed.ads.live ? 'good' : 'bad') : feed ? 'warn' : null} eye="Ads">
        {feed?.ads ? (feed.ads.live ? `Live · ${feed.ads.activeAds}` : 'Stopped') : feed ? 'Unknown' : '…'}
      </Cell>
      <Cell rag={goal ? goalRag(goal.hit ? 100 : goal.pct ?? 0) : null} eye="Next goal" sub={goal ? goal.label : undefined}>{goal ? `${goal.short} · ${goal.txt ?? (goal.pct !== null ? `${goal.pct}%` : '—')}` : '…'}</Cell>
      <span className="st-go">Dashboard ›</span>
    </Link>
  );
}
