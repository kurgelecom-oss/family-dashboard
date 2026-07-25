/* ════════════════════════════════════════════════════════════════════════════
   Payload guards.

   Every check in this file protects against ONE failure mode: a field whose
   absence makes a panel render a confident, wrong answer instead of an error.
   That is strictly worse than a blank panel, because a wrong number that looks
   measured gets acted on.

   The trigger was real. A deploy window served old cached /api/ecom payloads to
   new JS; `activityState` was absent, the panel fell through to its amber
   branch, and column B announced "NO CAMPAIGNS LIVE" while a test was live and
   money had moved five days earlier.

   These live in one module so they can be unit-tested against real payloads
   with individual fields deleted, rather than only reasoned about.
   ══════════════════════════════════════════════════════════════════════════ */

export const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const allNum = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => isNum(o[k]));

/* ────────────────────────────────────────────────────────────────────────────
   /api/ecom — column B
   ────────────────────────────────────────────────────────────────────────────
   activityState  absent → falls through to the amber "NO CAMPAIGNS LIVE"
                  branch: claims nothing is running while campaigns are live.
   test.present   absent → falsy → renders "NO TEST RUNNING" while a live test
                  exists. Worse than the above: it hides a real test.
   test.staleDays key must exist even though null is legal. Absent → no stale
                  badge, so a 17-day-dead test renders as a healthy green Live.
   money fields   absent → "$NaN", and month.contribution absent turns the hero
                  red regardless of the true sign.
   ──────────────────────────────────────────────────────────────────────── */

const ACTIVITY_STATES = ["LIVE", "AWAITING", "NONE"];

export function isEcomPayload(p: unknown): boolean {
  if (!isRec(p)) return false;
  if (typeof p["today"] !== "string") return false;

  const t = p["todayStats"];
  if (!isRec(t)) return false;
  if (typeof t["activityState"] !== "string") return false;
  if (!ACTIVITY_STATES.includes(t["activityState"])) return false;
  if (typeof t["adSpendWindow"] !== "string") return false;
  if (
    !allNum(t, [
      "revenue",
      "orders",
      "cogs",
      "adSpend",
      "adSpendMtd",
      "contribution",
      "lookbackDays",
    ])
  ) {
    return false;
  }

  const test = p["test"];
  if (!isRec(test)) return false;
  if (typeof test["present"] !== "boolean") return false;
  if (test["present"]) {
    if (typeof test["name"] !== "string" || typeof test["status"] !== "string") return false;
    if (!("staleDays" in test)) return false;
    if (!allNum(test, ["cumulativeSpend", "dayNumber"])) return false;
  } else {
    if (typeof test["sinceDate"] !== "string") return false;
    if (!allNum(test, ["testsComplete", "testsTarget", "daysSince"])) return false;
  }

  const m = p["month"];
  if (!isRec(m)) return false;
  if (
    !allNum(m, [
      "revenue",
      "cogs",
      "grossProfit",
      "adSpend",
      "contribution",
      "target",
      "targetPercent",
    ])
  ) {
    return false;
  }
  return Array.isArray(m["dailyContribution"]);
}

/* ────────────────────────────────────────────────────────────────────────────
   /api/pocketsmith — column A
   ────────────────────────────────────────────────────────────────────────────
   Checking the period object merely exists was the old guard. With a
   present-but-partial period the panel printed "$NaN" and, worse, SpendDelta
   compared NaN and rendered "▲ NaN% more than prior" in RED — a confident claim
   that spending rose, made from no data. A missing figure must be an error, not
   a direction.

   accounts[].balance absent is falsy against `< 0`, so a debt renders "$NaN" in
   the ordinary text colour rather than the red that marks it as owed.
   ──────────────────────────────────────────────────────────────────────── */

export function isPeriod(v: unknown): boolean {
  if (!isRec(v)) return false;
  if (typeof v["startDate"] !== "string" || typeof v["endDate"] !== "string") return false;
  if (
    !allNum(v, [
      "totalSpending",
      "totalIncome",
      "difference",
      "savingsRate",
      "uncategorisedTotal",
      "transactionCount",
    ])
  ) {
    return false;
  }
  return Array.isArray(v["categories"]);
}

export function isPocketSmithPayload(p: unknown): boolean {
  if (!isRec(p)) return false;
  if (typeof p["today"] !== "string") return false;
  if (!isNum(p["totalBalance"])) return false;

  for (const k of ["lastWeek", "previousWeek", "lastMonth", "previousMonth"]) {
    if (!isPeriod(p[k])) return false;
  }

  const accounts = p["accounts"];
  if (!Array.isArray(accounts)) return false;
  for (const a of accounts) {
    if (!isRec(a)) return false;
    if (typeof a["name"] !== "string" || !isNum(a["balance"])) return false;
  }
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
   /api/actions — column C
   ────────────────────────────────────────────────────────────────────────────
   decisionDue         key must exist even though null is legal. Absent simply
                       hides the DECISION DUE line, so a test sitting on a kill
                       gate looks like a test with nothing to decide.
   tests.everCompleted absent → falsy → "days since Launchpad go-live" even
                       after tests have completed: wrong origin, understated gap.
   ranked[].overdue    absent → falsy → silently un-flags a genuinely overdue
                       One-off.
   inputs[] fields     absent doneToday hides the tick and shows a streak
                       instead; absent streak renders "undefinedd" in amber, a
                       broken streak that may not be broken.
   ──────────────────────────────────────────────────────────────────────── */

export function isActionsPayload(p: unknown): boolean {
  if (!isRec(p)) return false;
  if (typeof p["today"] !== "string") return false;

  const a = p["actions"];
  if (!isRec(a)) return false;
  if (!("decisionDue" in a)) return false;
  if (a["decisionDue"] !== null) {
    const dd = a["decisionDue"];
    if (!isRec(dd) || typeof dd["name"] !== "string") return false;
  }
  if (!Array.isArray(a["ranked"])) return false;
  if (!allNum(a, ["pendingCount", "doneToday"])) return false;
  for (const item of a["ranked"]) {
    if (!isRec(item)) return false;
    if (typeof item["title"] !== "string") return false;
    if (typeof item["overdue"] !== "boolean") return false;
  }

  const inputs = p["inputs"];
  if (!Array.isArray(inputs)) return false;
  for (const i of inputs) {
    if (!isRec(i)) return false;
    if (typeof i["title"] !== "string") return false;
    if (typeof i["doneToday"] !== "boolean" || !isNum(i["streak"])) return false;
  }

  const c = p["clock"];
  if (!isRec(c)) return false;
  if (!allNum(c, ["daysLeftInWeek", "daysLeftInMonth", "daysToTractionEnd", "yearElapsedPct"])) {
    return false;
  }

  const tests = c["tests"];
  if (!isRec(tests)) return false;
  if (typeof tests["everCompleted"] !== "boolean") return false;
  return allNum(tests, ["completed", "target", "daysSinceLastCompleted"]);
}
