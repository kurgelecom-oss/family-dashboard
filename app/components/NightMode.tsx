'use client';
import { useEffect } from 'react';
import './night.css';
import { prayerTimes } from '../lib/prayer';

/* Dark mode from Maghrib to sunrise, every day, on every route. Uses the same
   calculated prayer times as the prayer board (tk's Guidance settings), so the
   house goes dark exactly as Maghrib comes in. Sets <html data-theme="night">;
   night.css re-colours the home board and the calendar from that.
   Test with ?theme=night or ?theme=day (sticks for this tab until reload without it). */

const TZ = 'Australia/Melbourne';
const melDay = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(x => [x.type, Number(x.value)])) as Record<string, number>;

export function isNight(now = new Date()) {
  const d = melDay(now), t = prayerTimes(d.year, d.month, d.day);
  return now >= t.maghrib || now < t.sunrise;
}

export default function NightMode() {
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get('theme');
    const root = document.documentElement;
    const apply = () => {
      const night = forced === 'night' || (forced !== 'day' && isNight());
      if ((root.dataset.theme === 'night') !== night) {
        // Fade only on a real switch (Maghrib / sunrise), not on the first paint after a load.
        const switching = !!root.dataset.theme;
        if (switching) root.classList.add('theme-fade');
        root.dataset.theme = night ? 'night' : 'day';
        if (switching) setTimeout(() => root.classList.remove('theme-fade'), 2600);
      }
    };
    apply();
    const t = setInterval(apply, 20_000);
    return () => clearInterval(t);
  }, []);
  return null;
}
