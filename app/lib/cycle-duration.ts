/**
 * The cycle already running when the duration changed must finish on its
 * original nine-day schedule. Starts recorded from this date onward use the
 * new ten-day schedule.
 */
const TEN_DAY_CHANGEOVER = "2026-08-28";

export function cycleDurationDays(startedOn: string): 9 | 10 {
  return startedOn >= TEN_DAY_CHANGEOVER ? 10 : 9;
}
