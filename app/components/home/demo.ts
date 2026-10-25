import type { Money, NowFeed, Tasks } from './HomeBoard';

/* ?demo=1 fixture: a weekday school morning built around the current time, so the
   board can be judged on a weekend. Every 15 s refresh moves the story on so
   each pop-up kind plays: ticks, a block, an order, a finished list, an event
   inside the hour, then Maghrib inside 20 minutes. Never used without ?demo. */
let step = -1;

const at = (min: number) => new Date(Date.now() + min * 60000).toISOString();
const list = (titles: string[], done: number): Tasks => ({ done, total: titles.length, items: titles.map((title, i) => ({ id: title, title, done: i < done, count: null })) });

export function demoNow(prev: NowFeed | null): NowFeed {
  step = prev ? step + 1 : 0;
  const s = (o: number, len: number, title: string, emoji: string, category: string, ticked: boolean | null) => ({ title, emoji, category, start: at(o), end: at(o + len), ticked });
  return {
    generatedAt: new Date().toISOString(), weekday: 'Mon',
    ansar: {
      day: [
        s(-85, 5, 'Start / Intention', '🎯', 'Routine', null),
        s(-80, 45, 'Block 1 — Maths', '🔢', 'Learning', true),
        s(-35, 15, 'Break', '☕', 'Routine', null),
        s(-20, 45, 'Block 2 — English', '📖', 'Learning', step > 1),
        s(25, 15, 'Break', '☕', 'Routine', null),
        s(40, 45, 'Block 3 — HASS (Soccer-led)', '⚽', 'Learning', false),
        s(100, 45, 'Block 4 — Technologies', '💻', 'Learning', false),
        s(145, 15, 'Wrap', '✅', 'Routine', null),
        s(160, 30, 'Lunch — Homeschool Ends', '🍽️', 'Meal', null),
      ],
      habits: list(['Bed made + dressed', "Qur'an recitation", 'Fajr Namaz', 'Feet on floor by 6:45', 'Morning movement', 'Breakfast, no screens', 'Homeschool session', 'Reading 20 min'], Math.min(8, 5 + step)),
      nextDay: null,
      schoolTicks: { done: step > 1 ? 2 : 1, total: 4 },
    },
    nihal: list(['Up at first waking', 'Quran session', 'Open Nihal OS', 'Find one product', 'Watch one Origins session'], Math.min(5, 2 + step)),
    taylan: list(['Up at first alarm', 'Quran session', 'Check custm ad leads + spend', 'Review TARA picks, validate one', 'Build block: the running test'], Math.min(5, 1 + step)),
    prayer: {
      next: { name: 'Maghrib', at: at(step > 5 ? 14 : 220), leaderName: 'Ansar', suras: ['Al-Falaq', 'An-Nas'] },
      today: [{ prayer: 'fajr', name: 'Fajr', at: at(-300), leaderName: 'TK' }, { prayer: 'maghrib', name: 'Maghrib', at: at(220), leaderName: 'Ansar' }, { prayer: 'isha', name: 'Isha', at: at(310), leaderName: 'TK' }],
    },
    calendar: [
      { id: '1', subject: 'Barzakh Series | Yasir Qadhi', startISO: at(step > 4 ? 45 : 30 * 60), isAllDay: false, who: 'TAYLAN' },
      { id: '2', subject: 'Seera | Yasir Qadhi', startISO: at(78 * 60), isAllDay: false, who: 'TAYLAN' },
      { id: '3', subject: 'Ansar Indoor Football', startISO: at(102 * 60), isAllDay: false, who: 'NIHAL' },
      { id: '4', subject: 'Family Alignment', startISO: at(118 * 60), isAllDay: false, who: 'TAYLAN' },
    ],
    store: {
      currency: 'USD',
      today: { label: 'Mon, 26 Oct', orders: 4 + Math.max(0, step), revenue: 241.9 + Math.max(0, step) * 59.95, sessions: 140, conversion: 2.9 },
      week: [552, 550, 413, 370, 918, 175, 358].map((revenue, i) => ({ date: `2026-10-${20 + i}`, revenue, orders: Math.round(revenue / 60) })),
      weekRevenue: 3336, weekOrders: 52, avgOrders: 7.7, avgRevenue: 496, dayFraction: 0.55,
    },
    ads: step % 4 === 3 ? { live: false, activeAds: 0, reason: 'no ads delivering' } : { live: true, activeAds: 71, reason: null },
  };
}

export const demoMoney: Money = {
  unlocked: true, asOf: new Date().toISOString(),
  goals: [{ label: 'in the bank', short: '$5k', target: 5000, pct: 0, now: -1497 }, { label: 'in the bank', short: '$10k', target: 10000, pct: 0, now: -1497 }, { label: 'weekly income', short: '$3k', target: 3000, pct: 100, now: 3015 }],
  cash: { bank: 1399, cardDebt: 2896, net: -1497 },
  week_income: { business: 3954, wages: 1600, businessSpend: 939, takeHome: 3015 },
  headline: 'Cash runs $1,639 short by Sat 7 Nov.',
};
