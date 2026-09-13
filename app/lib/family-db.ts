import postgres from 'postgres';
let connection: ReturnType<typeof postgres> | undefined;
export function familyDb() {
  const url = process.env.FAMILY_DATABASE_URL;
  if (!url) throw new Error('Family storage is not configured');
  return connection ??= postgres(url, { ssl: 'require', prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10 });
}
export function familyWorkspace() { return process.env.FAMILY_WORKSPACE || 'production'; }
