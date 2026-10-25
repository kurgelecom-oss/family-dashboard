import { familyDb, familyWorkspace } from './family-db';
import type { PrayerBoard } from './prayer';

export async function readBoard(): Promise<PrayerBoard | null> {
  const rows = await familyDb()`select doc from fds_prayer_board where workspace=${familyWorkspace()}`;
  return (rows[0]?.doc as PrayerBoard) ?? null;
}
