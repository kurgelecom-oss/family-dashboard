import postgres from 'postgres';
let connection: ReturnType<typeof postgres> | undefined;
export function familyDatabaseUrl(value:string){
  const url=new URL(value);
  // Session pooling pins one backend per warm function and exhausts the shared OS pool.
  if(url.hostname.endsWith('.pooler.supabase.com')&&url.port==='5432'){url.port='6543';return url.href;}
  return value;
}
export function familyDb() {
  const url = process.env.FAMILY_DATABASE_URL;
  if (!url) throw new Error('Family storage is not configured');
  return connection ??= postgres(familyDatabaseUrl(url), { ssl: 'require', prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
}
export function familyWorkspace() { return process.env.FAMILY_WORKSPACE || 'production'; }
