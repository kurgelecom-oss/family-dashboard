import { NextResponse } from "next/server";

/* ════════════════════════════════════════════════════════════════════════════
   /api/shopify-daily — the daily Shopify table behind /table.

   One row per store-day for the last DAYS days (today first). Three sources,
   all from the tryliare.shop Admin API via the client-credentials grant:

     · orders             — count + revenue per day (read_orders, live)
     · abandonedCheckouts — checkouts started but not paid (read_orders, live)
     · shopifyqlQuery     — sessions / add-to-cart / reached checkout from the
                            `sessions` analytics schema. Needs the
                            `read_reports` scope + protected-customer-data
                            Level 2 on the Partner app. Until that is granted
                            the store answers ACCESS_DENIED and the payload says
                            analytics.available=false — the page shows dashes
                            and the unlock steps, nothing crashes.

   force-dynamic + no-store: this is a live read, never a build-time snapshot.
   Bracket env access (process.env["X"]) — dot access gets inlined to undefined
   at build time when the var was absent during that build (memory rule).
   ══════════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

const DAYS = 14;

const SHOP = process.env["SHOPIFY_STORE"] ?? "0eu5zs-gj.myshopify.com";
const TOKEN_URL = `https://${SHOP}/admin/oauth/access_token`;
const API_VERSION = "2026-01";
const GRAPHQL_URL = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

/* ── payload ─────────────────────────────────────────────────────────────── */

export interface DailyRow {
  /** Store-timezone calendar date, YYYY-MM-DD. */
  date: string;
  /** "Mon 7 Sep" */
  label: string;
  isToday: boolean;
  orders: number;
  revenue: number;
  /** Checkouts started that day = paid orders + abandoned checkouts. */
  checkouts: number;
  /** ShopifyQL — null until read_reports is granted. */
  sessions: number | null;
  addToCart: number | null;
  reachedCheckout: number | null;
  /** orders ÷ sessions, percent; null when sessions unknown or zero. */
  conversion: number | null;
}

export interface DailyPayload {
  generatedAt: string;
  timezone: string;
  days: DailyRow[];
  analytics: {
    available: boolean;
    /** "scope" when the store said ACCESS_DENIED, otherwise the error text. */
    reason: string | null;
  };
  errors: string[];
}

/* ── Shopify plumbing (mirrors /api/shopify) ─────────────────────────────── */

async function getAccessToken(): Promise<string> {
  const clientId = process.env["SHOPIFY_CLIENT_ID"];
  const clientSecret = process.env["SHOPIFY_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing env vars — SHOPIFY_CLIENT_ID: ${clientId ? "set" : "MISSING"}, ` +
        `SHOPIFY_CLIENT_SECRET: ${clientSecret ? "set" : "MISSING"}`,
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

interface GqlError {
  message: string;
  extensions?: { code?: string };
}

class ShopifyGqlError extends Error {
  constructor(
    message: string,
    public readonly gqlErrors: GqlError[],
  ) {
    super(message);
  }
  get accessDenied(): boolean {
    return this.gqlErrors.some((e) => e.extensions?.code === "ACCESS_DENIED");
  }
}

async function shopifyGql<T>(token: string, query: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GraphQL failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: T; errors?: GqlError[] };
  if (json.errors && json.errors.length > 0) {
    throw new ShopifyGqlError(
      `GraphQL errors: ${json.errors.map((e) => e.message).join(" | ")}`,
      json.errors,
    );
  }
  return json.data;
}

/* ── dates in the store timezone (no hardcoded offsets — CLAUDE.md) ──────── */

/** The calendar date a UTC instant falls on in [tz], as YYYY-MM-DD. */
function dateInZone(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** UTC instant of local midnight for a YYYY-MM-DD in [tz]. */
function zoneMidnight(iso: string, tz: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const noonUTC = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUTC));
  const n = (t: string) => parseInt(parts.find((p) => p.type === t)!.value.replace(/^24$/, "0"));
  const localSecs = n("hour") * 3600 + n("minute") * 60 + n("second");
  const dayDiff = Math.round(
    (Date.UTC(n("year"), n("month") - 1, n("day")) - Date.UTC(y, m - 1, d)) / 86_400_000,
  );
  return new Date(noonUTC - localSecs * 1000 - dayDiff * 86_400_000);
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function labelFor(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/* ── orders + abandoned checkouts ────────────────────────────────────────── */

interface OrderNode {
  createdAt: string;
  test: boolean;
  cancelledAt: string | null;
  totalPriceSet: { shopMoney: { amount: string } };
}
interface CheckoutNode {
  createdAt: string;
}
interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

async function fetchAll<N>(
  token: string,
  field: string,
  since: string,
  selection: string,
): Promise<N[]> {
  const out: N[] = [];
  let cursor: string | null = null;
  type Conn = { nodes: N[]; pageInfo: PageInfo };
  for (let page = 0; page < 20; page++) {
    const q: string = `{
      ${field}(first: 250, query: "created_at:>='${since}'", sortKey: CREATED_AT${
        cursor ? `, after: "${cursor}"` : ""
      }) {
        nodes { ${selection} }
        pageInfo { hasNextPage endCursor }
      }
    }`;
    const data: Record<string, Conn> = await shopifyGql<Record<string, Conn>>(token, q);
    const conn: Conn = data[field];
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}

/* ── ShopifyQL sessions ──────────────────────────────────────────────────── */

interface QlColumn {
  name: string;
}
interface QlResponse {
  shopifyqlQuery: {
    /** Plain strings on 2026-01 (scalar list, no sub-selection). */
    parseErrors: string[];
    tableData: { columns: QlColumn[]; rows: unknown } | null;
  } | null;
}

interface SessionDay {
  sessions: number;
  addToCart: number;
  reachedCheckout: number;
}

const SESSIONS_QL = (days: number) =>
  `FROM sessions ` +
  `SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout ` +
  `WHERE human_or_bot_session = 'human' ` +
  `TIMESERIES day SINCE -${days - 1}d UNTIL today ORDER BY day ASC`;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function fetchSessions(token: string): Promise<Map<string, SessionDay>> {
  const ql = SESSIONS_QL(DAYS).replace(/"/g, '\\"');
  const data = await shopifyGql<QlResponse>(
    token,
    `{ shopifyqlQuery(query: "${ql}") {
      parseErrors
      tableData { columns { name } rows }
    } }`,
  );
  const r = data.shopifyqlQuery;
  if (!r) throw new Error("shopifyqlQuery returned null");
  if (r.parseErrors.length > 0) {
    throw new Error(`ShopifyQL parse: ${r.parseErrors.join(" | ")}`);
  }
  const map = new Map<string, SessionDay>();
  if (!r.tableData) return map;
  const cols = r.tableData.columns.map((c) => c.name);
  const rows = Array.isArray(r.tableData.rows) ? (r.tableData.rows as unknown[]) : [];
  for (const row of rows) {
    // Rows come back as JSON: tolerate both positional arrays and keyed objects.
    const cell = (name: string): unknown => {
      if (Array.isArray(row)) return row[cols.indexOf(name)];
      if (row && typeof row === "object") return (row as Record<string, unknown>)[name];
      return undefined;
    };
    const day = String(cell("day") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    map.set(day, {
      sessions: num(cell("sessions")),
      addToCart: num(cell("sessions_with_cart_additions")),
      reachedCheckout: num(cell("sessions_that_reached_checkout")),
    });
  }
  return map;
}

/* ── handler ─────────────────────────────────────────────────────────────── */

export async function GET() {
  const errors: string[] = [];
  let analytics: DailyPayload["analytics"] = { available: false, reason: null };

  try {
    const token = await getAccessToken();
    const { shop } = await shopifyGql<{ shop: { ianaTimezone: string } }>(
      token,
      `{ shop { ianaTimezone } }`,
    );
    const tz = shop.ianaTimezone;

    const todayIso = dateInZone(new Date(), tz);
    const firstIso = shiftIso(todayIso, -(DAYS - 1));
    const sinceInstant = zoneMidnight(firstIso, tz).toISOString();

    const [ordersRes, checkoutsRes, sessionsRes] = await Promise.allSettled([
      fetchAll<OrderNode>(
        token,
        "orders",
        sinceInstant,
        "createdAt test cancelledAt totalPriceSet { shopMoney { amount } }",
      ),
      fetchAll<CheckoutNode>(token, "abandonedCheckouts", sinceInstant, "createdAt"),
      fetchSessions(token),
    ]);

    const orders = ordersRes.status === "fulfilled" ? ordersRes.value : [];
    if (ordersRes.status === "rejected") errors.push(`Orders — ${String(ordersRes.reason)}`);

    const checkouts = checkoutsRes.status === "fulfilled" ? checkoutsRes.value : [];
    if (checkoutsRes.status === "rejected") {
      errors.push(`Checkouts — ${String(checkoutsRes.reason)}`);
    }

    let sessions = new Map<string, SessionDay>();
    if (sessionsRes.status === "fulfilled") {
      sessions = sessionsRes.value;
      analytics = { available: true, reason: null };
    } else {
      const reason = sessionsRes.reason;
      analytics = {
        available: false,
        reason:
          reason instanceof ShopifyGqlError && reason.accessDenied ? "scope" : String(reason),
      };
    }

    const byDay = new Map<string, DailyRow>();
    for (let i = 0; i < DAYS; i++) {
      const iso = shiftIso(todayIso, -i);
      byDay.set(iso, {
        date: iso,
        label: labelFor(iso),
        isToday: i === 0,
        orders: 0,
        revenue: 0,
        checkouts: 0,
        sessions: null,
        addToCart: null,
        reachedCheckout: null,
        conversion: null,
      });
    }

    for (const o of orders) {
      if (o.test || o.cancelledAt) continue;
      const row = byDay.get(dateInZone(new Date(o.createdAt), tz));
      if (!row) continue;
      row.orders += 1;
      row.revenue += parseFloat(o.totalPriceSet.shopMoney.amount || "0");
      row.checkouts += 1;
    }
    for (const c of checkouts) {
      const row = byDay.get(dateInZone(new Date(c.createdAt), tz));
      if (row) row.checkouts += 1;
    }
    for (const [iso, s] of sessions) {
      const row = byDay.get(iso);
      if (!row) continue;
      row.sessions = s.sessions;
      row.addToCart = s.addToCart;
      row.reachedCheckout = s.reachedCheckout;
    }
    for (const row of byDay.values()) {
      row.revenue = Math.round(row.revenue * 100) / 100;
      if (row.sessions !== null && row.sessions > 0) {
        row.conversion = Math.round((row.orders / row.sessions) * 10_000) / 100;
      }
    }

    const payload: DailyPayload = {
      generatedAt: new Date().toISOString(),
      timezone: tz,
      days: [...byDay.values()],
      analytics,
      errors,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        timezone: "",
        days: [],
        analytics,
        errors: [...errors, String(err)],
      } satisfies DailyPayload,
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
