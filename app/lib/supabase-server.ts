import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* ────────────────────────────────────────────────────────────────────────────
   Server-only Supabase client, service role.

   Deliberately a SECOND file rather than an export added to app/lib/supabase.ts.
   That module is imported by client components (PanelHabits, WeekProgressStrip),
   so anything exported from it is reachable from the browser bundle. A service
   role key placed there would be one careless import away from shipping to the
   client, where it bypasses RLS on every table in the project. Keeping it in a
   file no component imports makes that mistake structural rather than a matter
   of remembering.

   The key is read from SUPABASE_SERVICE_ROLE_KEY — no NEXT_PUBLIC_ prefix, which
   is what keeps Next from inlining it into client JavaScript.

   Why service role is required here rather than merely convenient: public
   .weekly_reviews has RLS enabled with no policies at all. Under the anon key
   that table is not "restricted", it is invisible — every select returns zero
   rows and every insert is rejected. Service role is the only key that can read
   or write it without adding policies.
   ──────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * A service-role client, or a thrown Error naming the missing variable.
 *
 * Built per call instead of at module load on purpose. A module-level
 * `createClient(url!, key!)` with a missing key throws while the module is being
 * evaluated, which in a route handler surfaces as an opaque 500 with no usable
 * message. Throwing inside the request lets the caller turn it into a 503 that
 * actually says which environment variable is absent.
 */
export function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    // No session to persist and no token to refresh: this client lives for the
    // length of one request and authenticates with a static key.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
