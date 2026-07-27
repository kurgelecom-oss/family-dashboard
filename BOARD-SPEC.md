# BOARD-SPEC

**Status: FROZEN.** Authored 2026-07-26. This file is the definition of done for the
`/board` work. It is the authority: where code, habit or convenience disagrees with
this document, this document wins. Do not amend it as a side effect of implementation —
changing scope means changing this file deliberately, on its own, with the reason stated.

Running state lives in `BOARD-LEDGER.md`. This file does not get ticked.

---

## ROUTE

- New route `/board` in family-dashboard. Replaces `/week` entirely.

## STRUCTURE

- One person on screen at a time: Taylan, Nihal or Ansar, chosen by a picker in the
  header row. Amended 2026-07-27 at the owner's instruction ("this board must only have
  the ability to show one person at a time not all three"), superseding the original
  "Three collapsible person sections". The unselected people are not rendered at all —
  not collapsed, not hidden — so no state shows two boards at once.
- Taylan contains layers: Work, Personal, Ecom.
- Nihal contains layers: Home, Personal, Ecom, Ayah.
- Ansar contains layers: Homeschool.
- A layer may only appear under its owner. No cross-person layers.
- Within the person on screen, each of their layers switches on and off independently —
  any combination, including all on (the default) and all off. Added 2026-07-27 at the
  owner's instruction ("they need to be toggles ... if they want to play around with how
  their time allocation board is viewed"). The switches are scoped per person, so Nihal
  hiding her Personal layer does not hide Taylan's. A person with a single layer gets no
  switch row, because its only two states would be their board and nothing — this is why
  Ansar's page is unchanged. All-off is a legal state and says so on screen; it is never
  left looking like missing data.
- Every block is colour-coded by what KIND of block it is. Added 2026-07-27 at the owner's
  instruction ("colour code each different block ... to distinguish the type of block it
  is"). Resolved category-first, layer-second: a block with a category is coloured by it,
  otherwise by its layer. Today that splits cleanly — Taylan and Nihal carry no categories
  and colour by layer, all of Ansar's carry one and colour by category — but the rule is
  data-driven, so a category added to a Taylan block starts colouring it with no code
  change. Colouring Ansar by layer instead would make all 52 of his blocks one colour.
  Hues live in `globals.css` as `--type-*` / `--type-*-bg`, per theme; `/board` itself
  holds no hex. Each block states its type three ways — tint, coloured left spine, and
  the category label — so the signal survives TV distance and colour-blindness. A grid
  that mixes types carries a legend beside its heading; a single-type grid does not,
  because the heading already names it.

## DATA SOURCES (Notion data source IDs)

| Layer | Owner | Data source ID |
|---|---|---|
| `taylan-work` | Taylan | `7e90f275-70d4-480a-b504-b8be3444b7f5` |
| `taylan-personal` | Taylan | `2b062576-79ee-4b7a-8acd-805aaf044f8b` |
| `taylan-ecom` | Taylan | `cd0e72dd-fb69-4599-95be-202ee1446770` |
| `nihal-home` | Nihal | `52767310-b8e8-4827-bf66-ae08a9a68120` |
| `nihal-personal` | Nihal | `e959c33a-968e-4da3-a1f5-f10e65acc094` |
| `nihal-ecom` | Nihal | `dc07abb4-803e-4058-95f2-10dd473402fa` |
| `nihal-ayah` | Nihal | `a2d13dcd-ce40-4899-b211-bba55eed3b50` |
| `ansar-homeschool` | Ansar | `63550d99-ab80-4c2d-914d-d7df6d2f95a9` (Weekly Schedule App Source) |

- `588f40ab-4078-4767-982c-b50f9cd83f71` is **RETIRED**. Must not be read.

## RULES

- All Notion reads server-side only, token never client-side, 300s cache.
- Layer DB fields: `Block`/title, `Day` single-select, `Start` text, `End` text, `Notes` text.
- Weekly Schedule fields differ: `Entry`, `Days` multi-select, `Category`, `Detail`, `Emoji`.
  Renderer must handle both shapes.

## PARITY WITH /week (all must exist on /board)

- Schedule render from Notion.
- ANSAR FC strip: points today, week total out of 56, day streak, four tier thresholds.
- Edit in Notion link.

## SCORING

- `scoreDay` lives in `app/lib/scoring.ts` and is mirrored byte-identically at
  ansar-habits-tracker `app/lib/scoring.ts`. Drift is prevented by
  `scripts/check-scoring-sync.sh`, which must exit 0. A single physical shared file is
  explicitly out of scope. Three copies existed before and have collapsed to it:
  - `app/components/WeekProgressStrip.tsx`
  - `app/components/PanelHabits.tsx`
  - ansar-habits-tracker `app/page.tsx`
- Canonical logic is ansar-habits-tracker's: `homeschool_session` alone awards 5.
- `WEEKLY_MAX` 56 and existing tier thresholds unchanged.

## STYLE

- Colours from `globals.css` tokens only. `--cyan` is `#00d4ff`. Never hardcode hex in this repo.

## CUTOVER

- `/week` redirects to `/board`.
- Nav updated in all five repos.
- Verified by fetching the deployed production URL, never self-reported.

---

## AMENDMENTS

Deliberate changes to this frozen spec. Each entry states what changed and why. An
amendment is made on its own, never as a side effect of implementation.

### 2026-07-26 — SCORING: mirroring sanctioned, single physical file ruled out of scope

**Changed.** The SCORING section previously required "One shared `scoreDay` function in
`app/lib/`", singular. It now specifies `app/lib/scoring.ts` mirrored byte-identically
into ansar-habits-tracker, with `scripts/check-scoring-sync.sh` as the anti-drift
mechanism, and states that a single physical shared file is explicitly out of scope.

**Why.** The scoring collapse landed on 2026-07-26 and could not satisfy the original
wording. family-dashboard and ansar-habits-tracker are two separate repositories with no
shared package between them. One physical file across both would require publishing a
module to a registry or adding a git submodule — infrastructure neither repo has, and a
larger change than the scoring work it would be serving. What shipped instead is two
byte-identical files whose sha256 hashes are compared by `scripts/check-scoring-sync.sh`.
That script is tracked in both repos and must exit 0.

The conflict was flagged at the time rather than papered over — see BOARD-LEDGER.md,
Findings 2026-07-26, "Open spec conflict — `scoreDay` is mirrored, not shared", which
left it deliberately unresolved and named the two ways out: amend the spec, or extract a
real shared package. This amendment takes the first. The second remains available if a
shared package ever exists for other reasons; nothing here forecloses it.

**Not changed.** Canonical logic is still ansar-habits-tracker's — `homeschool_session`
alone awards 5. `WEEKLY_MAX` is still 56 and the tier thresholds are still 42 / 34 / 26 / 0.
This amendment relaxes *where the function lives*, not *what it computes*.

### 2026-07-26 — BLOCK SHAPE: `date` added for one-off Weekly Schedule entries

**Changed.** The normalised block shape gains `date: string | null`, formatted
`"YYYY-MM-DD"`. It carries the Weekly Schedule's `Date` property for one-off dated
occurrences, and is `null` on every recurring block and on all seven layer sources, which
have no such property. A Weekly Schedule row carrying a `Date` but no `Days` must now
yield a block; previously it yielded nothing.

**Why.** Required for PARITY with `/week`. `/week` places an entry in a day column when
*either* its recurring `days[]` matches *or* its one-off `date` equals that column's
calendar date (`app/week/page.tsx:172-179`), reading the field from `/api/schedule`
(`app/api/schedule/route.ts:51`). `/api/board` had no `date` field at all, so a dated
one-off row produced no block and no error — it vanished silently. `/board` replaces
`/week` entirely, so a payload that cannot represent those rows cannot satisfy the PARITY
section. This was flagged as an open VIOLATION rather than fixed at the time — see
BOARD-LEDGER.md, Findings 2026-07-26 (`/api/board`), "One-off dated Weekly Schedule
entries are dropped — latent parity gap" — on the grounds that widening a frozen block
shape is a scope decision, not an implementation detail. This amendment is that decision.

**Note.** All 9 Weekly Schedule rows carry `Date = null` today, so this changes no current
output. It closes a latent gap; the field is not optional for that reason.

### 2026-07-26 — BLOCK SHAPE: `startMin` / `endMin` added as the sort keys

**Changed.** The normalised block shape gains `startMin: number | null` and
`endMin: number | null` — integer minutes from midnight, or `null` when the source string
is absent or unparseable. Both the 24-hour form (`"14:00"`) and the 12-hour form
(`"9:05am"`) must parse. **Renderers sort and position on `startMin`/`endMin`, never on
the display strings.**

**Why.** The two shapes store times in different formats — layer sources 24-hour, the
Weekly Schedule 12-hour — and the route passes both through verbatim. String-sorting
`"14:00"` against `"9:05am"` is wrong in a way that looks plausible on screen, and every
renderer would otherwise have to reimplement the same two-format parser. Recorded as a
live trap in BOARD-LEDGER.md, Findings 2026-07-26 (`/api/board`), "Start/End formats
differ between the shapes and are NOT normalised". Parsing once, in the reader, is the
fix. `null` is preserved rather than coerced to `0` so that "no time given" stays
distinguishable from "midnight".

**Not changed.** `start` and `end` remain the original display strings, untouched. The
route still does not pick a display format — that stays the renderer's call. This
amendment adds sort keys alongside the strings; it does not replace them.

### 2026-07-26 — RULES: total source failure must be HTTP 503 and must not be cached

**Changed.** If **all eight** sources fail, `/api/board` must respond **HTTP 503** and must
not be cached (`Cache-Control: no-store`). A fully empty payload is never a success.
Partial failure is unaffected: if any source succeeds, the response is still HTTP 200 with
the survivors in `blocks` and the failures named in `errors`.

**Why.** The route *was* `dynamic = "force-static"` with `revalidate = 300`. A build with no
`NOTION_TOKEN` bakes the all-fail response — HTTP 200, `blocks: []`, eight errors — and
then serves an empty board as a success for 300s. That exact response was produced and
observed under an invalid token; see BOARD-LEDGER.md, Findings 2026-07-26 (`/api/board`),
"`force-static` means a token-less build serves an empty board as a success". A 200 with
an empty array is indistinguishable from a genuinely empty week to anything that does not
read `errors`, and caching it makes a transient credential outage outlive its cause by
five minutes. 503 is unambiguous to caches, monitoring and the renderer alike.

**Also changed, and deliberately: how the 300s cache is expressed.** The RULES line "300s
cache" stands and the duration is unchanged, but the mechanism moves. `force-static`
prerenders the handler and caches its result, so the response is fixed at build time; a
baked response cannot be conditionally uncacheable, and the 503 above is therefore
unimplementable while the route is statically prerendered. The route becomes
`dynamic = "force-dynamic"` and declares the cache per response instead:
`Cache-Control: public, s-maxage=300, stale-while-revalidate=300` on success, `no-store`
on the 503. This is recorded here rather than left in the diff because it is a mechanism
change, not an implementation detail, and the first draft of this amendment wrongly
asserted the success path was untouched — the board-reviewer caught the contradiction.

**Consequence, accepted.** The 300s bound is now downstream rather than at the origin.
Under `force-static` the origin itself would not re-query Notion within 300s regardless of
what sat in front of it, capping Notion traffic at 8 requests per 300s. Under
`force-dynamic` every cache miss, eviction or cold edge region runs all eight queries at
the origin; the cap is whatever the CDN delivers. Accepted because a correct failure
signal is worth more than an origin-side request cap on a board read, and because the
cached lifetime seen by clients is unchanged at 300s.

**Not changed.** The degrade-a-layer-at-a-time behaviour stands: `Promise.allSettled` and
the per-source `errors` entries are untouched, partial failure is still HTTP 200, and the
cache lifetime on the success path is still 300s.

### 2026-07-26 — RULES: origin-side request cap restored by a module-level cache

**Changed.** `/api/board` holds a single in-memory payload with a 300 second TTL at module
scope. **While a payload is cached**, Notion is queried at most once per 300s per warm
server instance, however many requests reach the origin. Concurrent requests arriving on a
cold or expired entry coalesce onto one refresh rather than each firing their own. **The
total-failure path must never populate the cache**; partial failure may, being a real board
with a named gap rather than an outage.

On the success path `s-maxage` carries what remains of the in-memory entry's TTL, not a
flat 300. The two caches sit in series, and a flat value would let the CDN hold an
already-old payload for a further full window.

**Why.** This restores the cap the previous amendment gave up. That amendment moved the
route to `force-dynamic` so the 503 could be uncacheable, and recorded the consequence:
"every CDN miss, eviction or cold edge region runs all eight queries at the origin; the cap
is whatever the CDN delivers." A downstream `Cache-Control` bounds what clients and the CDN
re-request; it cannot bound what the origin does on a miss. An in-process entry can, and it
is orthogonal to the 503 — the failure path simply declines to write it. Both properties now
hold at once, which is why the earlier tradeoff no longer needs accepting.

**Consequence, stated honestly.** Three limits, none of them hidden:

1. *The cap is per instance, not global.* Serverless instances are created and discarded, so
   N warm instances mean up to N refreshes per 300s, and a cold start always pays a full
   fetch. This is a real bound on one instance's behaviour, not a global rate limit on
   Notion traffic, and must not be described as one.
2. *During a total outage there is no cap at all.* The 503 path is forbidden from writing the
   cache, so nothing is ever cached to serve from, and `inFlight` coalesces only
   *concurrent* requests. Sequential requests during an outage each run all eight queries —
   the origin fires hardest exactly when Notion is least able to answer. This is the direct
   and accepted cost of never caching a failure: a negative cache would bound the traffic
   but would also pin the outage, which is the thing the 503 exists to prevent.
3. *Staleness is unchanged, but only because `s-maxage` is computed.* Serving a hit with a
   flat `s-maxage=300` would put the two 300s windows in series and push worst-case client
   age to ~900s. Passing the entry's remaining TTL instead holds the total at the ~600s the
   CDN already permitted before this cache existed.

**Diagnostics.** Responses carry `X-Board-Cache: hit | miss | bypass` so the cap can be
observed rather than asserted. `bypass` is the 503 path, which is never served from cache
and never writes to it.

**Not changed.** `force-dynamic`, the 503 total-failure guard, `Cache-Control: no-store` on
that 503, the 300s success-path cache *lifetime*, `Promise.allSettled`, and the per-source
`errors` entries are all as the previous amendment left them.

The success-path `Cache-Control` **header** is not on that list: the previous amendment
pinned its literal value at `public, s-maxage=300, stale-while-revalidate=300`, and this
one computes `s-maxage` instead, so that literal no longer holds. The lifetime it expresses
is unchanged; the string is not. Called out because the first draft of this amendment listed
the header itself as unchanged — the same clause, and the same mistake, as the first draft of
the amendment before it. Twice now the "Not changed" list has been carried forward without
being re-read against the diff. Anyone amending this file again should re-derive that list
from the code rather than copy it.

### 2026-07-26 — RULES: `?refresh=1` bypasses the origin cache; `/board` exposes it

**Changed.** `GET /api/board?refresh=1` skips the in-memory entry, re-reads all eight Notion
sources, and **repopulates** the cache with the result. `/board` carries a visible **Refresh**
control that calls it and re-renders. The refresh response itself is `Cache-Control: no-store`
and reports `X-Board-Cache: refresh`.

**Why.** The 300s origin cache has no manual exit. Once an entry is warm the only ways out
are waiting for the TTL or recycling the instance, and **a browser reload does neither** —
the staleness is at the origin, so reloading re-fetches the same cached payload. This was
not theoretical: during the previous pass a row was deleted from Notion and `/api/board` kept
serving it, 141 blocks with `X-Board-Cache: hit`, until the server was restarted. Somebody
editing Notion and looking at the board needs a way to say "now", and restarting a serverless
instance is not one.

**Repopulates, does not merely bypass.** The refresh writes the entry it fetched, so one
person pressing Refresh re-primes the board for every other viewer on that instance rather
than buying a private fresh copy and leaving the shared entry stale.

**A forced refresh does not coalesce, and that is the point.** Ordinary requests adopt a
load already in flight — the data is as fresh as anything they would fetch themselves. A
forced one must not: `/board` re-fetches on every mount and polls every 300s, so a load that
began before the button was pressed very likely predates the Notion edit the user is trying
to see. Adopting it would return pre-edit data, re-prime the shared entry with it for a full
TTL, and stamp the response `X-Board-Cache: refresh` — the control appearing to work while
leaving the user exactly where they started. A forced refresh therefore always starts its
own read, which means a forced and an ordinary load can run concurrently and finish out of
order. Each load carries a sequence number and only a **later** one may write the cache, so
a slow older read cannot clobber a fresher result and silently undo the refresh.

**Not cacheable, deliberately.** `?refresh=1` is a distinct URL and could not poison plain
`/api/board`, but a CDN-cached refresh response would mean the second press never reaches
the origin — the one thing the control exists to do. Hence `no-store` on that response only.
The success path for plain `/api/board` is unchanged.

**`Netlify-Vary: query=refresh` is required, and is not optional polish.** Netlify's Next
adapter keys cached routes on `__nextDataReq` and `_rsc` only; every other query parameter
is excluded from the edge cache key. Without this header the CDN answers `?refresh=1` from
the stored plain `/api/board` entry, the origin is never reached, and the control is a
**silent no-op in production** — while working perfectly under `netlify dev`, which does no
edge caching. This was not predicted; it was found by fetching the deployed URL, which
returned `cache-status: "Netlify Edge"; hit` with an advancing `age` and a frozen
`X-Board-Cache: miss` for every query string tried, including unique cache-busting ones.
The header is set on **every** response from the route, not just the refresh one, because
the CDN derives the key from the response it stores. Anything that later changes this
route's response headers must preserve it, and must re-verify against production rather
than local — the two disagree here, and local is the one that lies.

**Consequence, accepted.** This is an unauthenticated endpoint that forces eight Notion
queries on demand, so the origin request cap holds only for traffic that does not ask to
bypass it. Accepted: `/board` is a family dashboard behind no login, the same as every other
route in this repo, and the button is the point. If the endpoint is ever abused or the app
gains auth, rate-limiting the bypass is the follow-up — not a reason to withhold the control.

**Not changed.** Re-derived from the code rather than carried forward: `force-dynamic`
(`route.ts`), the 503 total-failure guard and its `no-store`, the 300s TTL and the computed
`s-maxage` on the plain success path, the rule that a total failure never populates the
cache, `Promise.allSettled`, and the per-source `errors` entries. A `?refresh=1` request
that ends in total failure is still a 503 and still writes nothing.
