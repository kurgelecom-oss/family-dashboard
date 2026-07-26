# BOARD-LEDGER

Running state for the `/board` build. Derived from `BOARD-SPEC.md` — that file is the
authority and does not change; this file is the only place progress is recorded.

Tick an item **only** when it is verified, not when it is written. Anything verified
against production must cite the fetched URL and what was found in the response body.

---

## ROUTE

- [ ] Route `/board` exists in family-dashboard
- [ ] `/board` replaces `/week` entirely (no remaining dependency on `/week` rendering)

## STRUCTURE

- [ ] Three collapsible person sections render: Taylan, Nihal, Ansar
- [ ] Sections are genuinely collapsible (expand/collapse works, not static headings)
- [ ] Taylan shows exactly: Work, Personal, Ecom
- [ ] Nihal shows exactly: Home, Personal, Ecom, Ayah
- [ ] Ansar shows exactly: Homeschool
- [ ] No layer appears under a person who does not own it

## DATA SOURCES

- [x] `taylan-work` wired to `7e90f275-70d4-480a-b504-b8be3444b7f5` — 17 blocks
- [x] `taylan-personal` wired to `2b062576-79ee-4b7a-8acd-805aaf044f8b` — 16 blocks
- [x] `taylan-ecom` wired to `cd0e72dd-fb69-4599-95be-202ee1446770` — 17 blocks
- [x] `nihal-home` wired to `52767310-b8e8-4827-bf66-ae08a9a68120` — 21 blocks
- [x] `nihal-personal` wired to `e959c33a-968e-4da3-a1f5-f10e65acc094` — 13 blocks
- [x] `nihal-ecom` wired to `dc07abb4-803e-4058-95f2-10dd473402fa` — 26 blocks
- [x] `nihal-ayah` wired to `a2d13dcd-ce40-4899-b211-bba55eed3b50` — queried OK, **0 rows**
      (source is empty, not failing: it is absent from `errors`)
- [x] `ansar-homeschool` wired to `63550d99-ab80-4c2d-914d-d7df6d2f95a9` — 9 rows → 30 blocks
- [ ] `588f40ab-4078-4767-982c-b50f9cd83f71` appears nowhere in the repo (grep proves zero hits)
      — cannot be ticked as written: it appears 3× as prose (`BOARD-SPEC.md:37`,
      `BOARD-LEDGER.md:35`, `.claude/agents/board-reviewer.md:39`), all of them declaring it
      retired. **Zero hits in code.** See Findings 2026-07-26 (/api/board).

## RULES

- [x] All Notion reads are server-side only — all 7 files touching `api.notion.com` are
      route handlers or `app/lib/settings.ts`; no `"use client"` file references
      `NOTION_TOKEN` or `api.notion.com`
- [x] Token never reaches the client bundle (verified by grepping the built output)
      — **tested 2026-07-26.** `npm run build` (exit 0), then `grep -rlF "$NOTION_TOKEN"`:
      **0 files in `.next/static`** (the client bundles), 0 in `.next/server`, 0 across the
      whole `.next` tree. Also 0 hits for the token's 24-char prefix, 0 for the literal
      string `NOTION_TOKEN` anywhere in `.next/static`, and 0 for any `NEXT_PUBLIC_*NOTION*`.
      Grep proven capable by positive control — the identical grep does find the value in
      `.env.local` — and scope confirmed non-empty: `.next/static` holds 15 JS files, 976K.
      The token value was never printed. See Findings.
- [ ] 300s cache set on every Notion read — **still false as written.**
      `/api/board` has it (`route.ts:13-18` — now `force-dynamic` plus a per-response
      `Cache-Control: public, s-maxage=300, stale-while-revalidate=300`, observed on the
      wire), as do `settings`, `schedule`, `habits`, `actions`. `app/api/todos/route.ts`
      reads `api.notion.com` with **no** `revalidate` and **no** `dynamic` export — a
      known defect, pre-existing and out of scope for this change set, deliberately left
      untouched. The box is a claim about *every* Notion read, so it stays unticked until
      that route is fixed. See Findings.
- [x] Renderer handles layer shape: `Block`/title, `Day` single-select, `Start`, `End`, `Notes`
      — handled in the API mapper (`app/api/board/route.ts` `mapRow`). No renderer exists yet.
- [x] Renderer handles Weekly Schedule shape: `Entry`, `Days` multi-select, `Category`, `Detail`, `Emoji`
      — same mapper; `Days` fans one row out to one block per day. No renderer exists yet.
- [x] Both shapes proven against real responses, not assumed — live fetch of all 8 sources,
      140 blocks, plus a property-shape probe of every source before the mapper was written

## BLOCK SHAPE (AMENDMENTS 2026-07-26)

- [x] `date: string | null` present on every block, `"YYYY-MM-DD"` — 140/140 blocks carry
      the key; `dateStart` slices to 10 chars so a timestamped Notion value cannot shift
      the calendar day
- [x] `date` is non-null only for one-off Weekly Schedule rows — **0 of 140** non-null
      today, because all 9 Weekly Schedule rows still have `Date = null`. Correct, and the
      same figure as before the change
- [ ] A row with a `Date` and no `Days` yields a block — **logic proven, not live.** No
      such row exists in Notion today, so the branch has zero live coverage. Exercised
      only on synthetic rows against transcribed logic (25/25 assertions). Cannot be
      ticked on a real payload until such a row exists. See Findings
- [x] `startMin` / `endMin` present on every block, integer minutes or `null` — 140/140
      carry both keys; 0 out-of-range values
- [x] 24-hour `"14:00"` parses — → `840`; `"08:00"` → `480`, observed in the live payload
- [x] 12-hour `"9:05am"` parses — → `545`, observed in the live payload
- [x] Unparseable → `null`, never `0` — 1 null `startMin` (`"Flexible"`), 9 null `endMin`
      (all empty strings). Every null traced to a genuinely absent or non-time value; no
      valid string was wrongly rejected
- [x] `start` / `end` unchanged as display strings — passed through verbatim; the parsed
      values live only in the new fields
- [ ] Renderers sort on `startMin`/`endMin`, never on the display strings — **unenforceable
      today.** No renderer exists. Carried forward as a live constraint on the first one
- [x] All eight sources failing returns HTTP 503, uncached — observed under an invalid
      token via `netlify dev`: `HTTP/1.1 503 Service Unavailable`, `cache-control:
      no-store`, `blocks: []`, all 8 layers named in `errors` (`Notion API 401
      Unauthorized`)
- [x] Success path returns HTTP 200 with a 300s cache — observed: `HTTP/1.1 200 OK`,
      `cache-control: public, s-maxage=300, stale-while-revalidate=300`
- [ ] Partial failure (some sources down) still returns HTTP 200 — **not observed.**
      Follows from the `errors.length === SOURCES.length` gate, but inference, not
      measurement. Same gap as the previous pass

## PARITY WITH /week

- [ ] Schedule renders from Notion on `/board`
- [ ] ANSAR FC strip: points today
- [ ] ANSAR FC strip: week total out of 56
- [ ] ANSAR FC strip: day streak
- [ ] ANSAR FC strip: four tier thresholds
- [ ] Edit in Notion link present and correct

## SCORING

- [x] Single shared `scoreDay` lives in `app/lib/` — see Findings 2026-07-26: it is
      *mirrored* into two repos, not one physical file. Spec says "one". Unresolved.
- [x] `app/components/WeekProgressStrip.tsx` copy removed, imports the shared one
- [x] `app/components/PanelHabits.tsx` copy removed, imports the shared one
- [x] ansar-habits-tracker `app/page.tsx` copy removed, imports the shared one
- [x] Canonical logic adopted: `homeschool_session` alone awards 5
- [x] `WEEKLY_MAX` still 56
- [x] Tier thresholds unchanged (42 / 34 / 26 / 0)

## STYLE

- [ ] No hardcoded hex in any file touched by this work
- [ ] All colours resolve through `globals.css` tokens
- [ ] `--cyan` remains `#00d4ff`

## CUTOVER

- [ ] `/week` redirects to `/board`
- [ ] Nav updated: family-dashboard
- [ ] Nav updated: ansar-habits-tracker
- [ ] Nav updated: time-allocation-board
- [ ] Nav updated: ecom-launchpad
- [ ] Nav updated: link-board
- [ ] `/board` verified by fetching the deployed production URL
- [ ] Cutover verified by fetching production, never self-reported

---

## FINDINGS

Append as work proceeds. Newest last. Record what was observed, not what was intended —
including anything that contradicts an assumption in `BOARD-SPEC.md`.

### 2026-07-26 — harness created

- No `typecheck` script exists in `package.json` (scripts are `dev`, `build`, `start`, `lint`).
  TypeScript is a devDependency at `^5`, so the typecheck command for this repo is
  `npx tsc --noEmit`. The PostToolUse hook in `.claude/settings.json` uses that.
- Nothing ticked above. Harness only — no `/board` code written yet.

### 2026-07-26 — scoring collapsed to one canonical implementation

**Family-dashboard totals will now be HIGHER than before for session-only days.**
This is the intended consequence of adopting the canonical logic, not a regression.
The old family-dashboard split awarded the homeschool block `3` for
`homeschool_session`, `+1` for `readtheory && khan`, `+1` for `journal` — three habits
needed to reach 5. Canonical awards a flat `5` for `homeschool_session` alone. So any
day where Ansar completed the session but not the sub-items now scores **up to 2 points
higher** on `/week` and the `/` habits panel than it did yesterday. Same 5-point ceiling,
same `WEEKLY_MAX` 56, same tiers — but weekly totals and tier placement can both move up
on historical days, because the score is recomputed from stored `habit_completions` rows
on every load rather than being persisted. Expect the TV to show a higher week total
after deploy with no change in Ansar's behaviour. ansar-habits-tracker is unaffected: it
was already canonical.

**Open spec conflict — `scoreDay` is mirrored, not shared.** BOARD-SPEC.md says "One
shared `scoreDay` function in `app/lib/`", singular. What exists is two byte-identical
files, one per repo, kept honest by `scripts/check-scoring-sync.sh`. Two repos with no
shared package cannot host one physical file without publishing a module or adding a
submodule. Flagged by the spec review and left unresolved — resolving it means either
amending BOARD-SPEC.md deliberately to sanction mirroring, or extracting a real shared
package. Not decided here; the spec is frozen and this is not a change to make as a side
effect.

**Tier tables were not collapsed.** `app/lib/scoring.ts` exports `WEEKLY_MAX`,
`THRESHOLDS`, `getThreshold`, `visibleIds` and `DayScore`, and no consumer imports any of
them — all three surfaces still declare their own `WEEKLY_MAX` and `THRESHOLDS`. That was
deliberate: the three tier tables differ in presentation (family-dashboard's
WeekProgressStrip carries emoji + `var(--*)` colour tokens, PanelHabits carries neither,
ansar carries emoji + descriptions + its own Real Madrid hex), so importing a single
labelled table would have changed what renders. The instruction for this pass was to
touch nothing beyond `scoreDay`. The exports are in place for `/board` to use.

**Pre-existing STYLE violations surfaced, not introduced.** `PanelHabits.tsx:49` and
`:210` carry literal `#a78bfa`, and there are non-token `rgba()` literals at
`PanelHabits.tsx:188-189` and `WeekProgressStrip.tsx:157`. Repo-wide there are ~73 hex
literals under `app/`. This change set adds none — every line it adds is a comment, an
import or a deletion — but BOARD-SPEC's STYLE rule is absolute and these two files are in
the change set. Cleanup not attempted here.

**`.gitignore` had to change for the sync script to be committable.** Line 38 was
`/scripts/` with the comment "local dev scripts (contain credentials — never commit)".
Git does not descend into an ignored directory, so a negation alone would have had no
effect; the pattern is now `/scripts/*` plus `!/scripts/check-scoring-sync.sh`. Verified
with `git check-ignore` that `get-ms-token.js` and the three `.sql` files remain ignored.

**Verification run for this pass:** `scripts/check-scoring-sync.sh` → IN SYNC, exit 0,
sha256 `fb737767…c06fd` matching in both repos. `npx tsc --noEmit` → exit 0 in
family-dashboard and exit 0 in ansar-habits-tracker. All local only — nothing here is
production-verified, and no CUTOVER item is ticked.

### 2026-07-26 — `/api/board`, one normalised payload from eight Notion sources

**All eight sources answered. 140 blocks.** Per person: taylan 50, nihal 60, ansar 30.
Per layer: `taylan-work` 17, `taylan-personal` 16, `taylan-ecom` 17, `nihal-home` 21,
`nihal-personal` 13, `nihal-ecom` 26, `nihal-ayah` **0**, `ansar-homeschool` 30.
`errors` was `[]`. Fetched from `netlify dev` at `http://localhost:8888/api/board`,
HTTP 200. Local only — no production URL has been fetched and no CUTOVER box is ticked.

**`nihal-ayah` is empty, not broken.** It returns 0 rows and contributes 0 blocks, and it
is correctly absent from `errors`. An empty layer and a failed layer look identical in a
block count and are distinguished only by the `errors` array — worth remembering when the
renderer decides what to show for a layer with nothing in it.

**The seven layer sources are 1 row → 1 block; ansar fans out.** Layer block counts equal
their row counts exactly. The Weekly Schedule's 9 rows expand to 30 blocks via the `Days`
multi-select (Mon 7, Tue 7, Wed 7, Thu 7, Fri 2). Both shapes go through one `mapRow`.

**Start/End formats differ between the shapes and are NOT normalised.** Layer sources
store 24h (`"14:00"`); the Weekly Schedule stores 12h (`"9:05am"`). The route passes both
through verbatim. Any board renderer that sorts or positions blocks by time must parse
both, or the two will not sort against each other. This is a deliberate choice — picking
one display format is the renderer's call, not the reader's — but it is a live trap.

**Failure path exercised for real, not assumed.** A second run with a deliberately invalid
`NOTION_TOKEN` returned HTTP 200 with `blocks: []` and all eight layers named in `errors`
(`Notion API 401 Unauthorized`). So "never fail the whole payload" holds at both extremes:
all-succeed and all-fail. *Partial* failure — one source down, seven up — was not directly
observed; it follows from `Promise.allSettled` plus the per-source error entries, but it is
inference, not measurement.

**`force-static` means a token-less build serves an empty board as a success.** Because the
route is `dynamic = "force-static"` with `revalidate = 300`, the payload is prerendered. If
`NOTION_TOKEN` is missing from the *build* environment, what gets baked and served for 300s
is exactly the invalid-token response above: HTTP 200, `blocks: []`, eight errors. A fully
empty board returned as a success. The `errors` array is the only thing distinguishing that
from a genuinely empty week — the renderer must not ignore it.

**Notion `rich_text` truncation, found by the board-reviewer and fixed.** The first draft of
`plainText` read `rich_text[0].plain_text` only. Notion splits a rich_text value into a new
chunk at every formatting boundary, so bolding one word inside a note would have silently
truncated it at the first fragment. Now joins all chunks, matching `titleText`. A scan of
all 366 `rich_text` fields across the eight sources found **0** multi-chunk values today, so
the bug was latent and the fix is a no-op on current data — the payload after the fix is
byte-identical to the payload before it. The same defect still exists at
`app/api/schedule/route.ts:52-56`; not touched, out of scope for this pass.

**One-off dated Weekly Schedule entries are dropped — latent parity gap.** The Weekly
Schedule carries a `Date` property for one-off occurrences. `/api/schedule` reads it
(`route.ts:51`) and `/week` renders those rows (`app/week/page.tsx:176`). `/api/board` does
not: the normalised block shape specified for this work is
`person, layer, day, start, end, title, notes` plus optional `category, detail, emoji` —
there is no `date` field, and a row with no `Days` value yields no block and no error.
**All 9 ansar rows currently have `Date = null`, so 0 rows are dropped today.** But `/board`
cannot reach PARITY with `/week` on this payload without either adding `date` to the block
shape or handling those rows another way. Flagged rather than fixed: widening the frozen
block shape is a scope decision, not an implementation detail. Raised by the board-reviewer
as a VIOLATION of the PARITY line.

**`300s cache set on every Notion read` is false repo-wide.** `app/api/todos/route.ts`
fetches `api.notion.com` and exports neither `revalidate` nor `dynamic`. Pre-existing and
outside this change set, so it was left alone — but the ledger box stays unticked, because
as written it is a claim about every Notion read, not just this one.

**The retired-source box cannot be ticked as written.** `588f40ab-4078-4767-982c-b50f9cd83f71`
appears 3× in the repo — `BOARD-SPEC.md:37`, `BOARD-LEDGER.md:35`,
`.claude/agents/board-reviewer.md:39` — every one of them prose declaring it retired, two of
them the very instruments that enforce the ban. Zero occurrences in code, which is the thing
that actually matters. The box demands "grep proves zero hits", which will never be true
while the spec names the id it is banning. Left unticked rather than quietly redefined.

**Data source ids are pinned in code, not read from env.** `SOURCES` in
`app/api/board/route.ts` hardcodes all eight ids. BOARD-SPEC.md fixes the owner→layer→id
mapping, and a mistyped env var would silently attach a layer to the wrong person — a
failure that produces a plausible-looking board rather than an error. Verified by the
board-reviewer in both directions against the spec table.

**Pagination added although nothing needs it yet.** Every source returns `has_more: false`
at `page_size: 100`; the largest is 26 rows. The route still pages through (`MAX_PAGES` 10)
because a silent 100-row truncation would look exactly like a genuinely short week.

**Verification run for this pass:** `npx tsc --noEmit` → exit 0, before and after the
rich_text fix. `netlify dev` → `/api/board` HTTP 200, 140 blocks, `errors: []`; invalid-token
run HTTP 200, `blocks: []`, 8 errors. board-reviewer run on the diff: 1 VIOLATION (PARITY /
dropped dated entries — flagged, not fixed), 1 NOT MET (rich_text truncation — fixed), DATA
SOURCES / SCORING / STYLE reported CLEAN. Everything here is local. Nothing is
production-verified.

### 2026-07-26 — normalised block shape widened; total failure now 503

Implements the three BOARD-SPEC amendments of the same date. The two open items the
previous pass flagged and declined to fix — dropped dated entries, and un-normalised
Start/End — are the first two of them.

**Payload is unchanged in size: still 140 blocks, `errors: []`.** Per the live `netlify dev`
fetch at `http://localhost:8888/api/board`, HTTP 200. **0 of 140** blocks have a non-null
`date`, **1** has a null `startMin`, **9** have a null `endMin`. The block count matching
the previous pass exactly is the expected result, not a coincidence: no Weekly Schedule row
carries a `Date`, so the new fan-out branch adds nothing today.

**Every null is a real null — the parser rejects nothing valid.** The single null `startMin`
is the literal string `"Flexible"` on `ansar/homeschool` "Flex/Catch-up — Friday". All nine
null `endMin` are empty strings. Both were checked individually rather than counted, because
a parser that silently returned `null` for valid input would produce exactly the same
summary figures. `"14:00"` → 840 and `"9:05am"` → 545 were confirmed in the live payload,
and no block has a `startMin` outside 0–1439.

**`null` is deliberately not `0`.** An untimed block coerced to `0` would sort to the top of
its day as though it began at midnight. Keeping `null` forces the renderer to decide where
untimed blocks go, rather than being silently wrong.

**The `date` branch has zero live coverage and is not ticked as if it did.** All 9 Weekly
Schedule rows still have `Date = null`, so the code path that turns a dated row into a block
never executed against real data. It was exercised only on synthetic rows against logic
transcribed from the route — 25/25 assertions, covering 24h and 12h parsing, `12:00am` → 0,
`12:00pm` → 720, rejection of `"25:00"` / `"9:75pm"` / `"0:30am"`, `dateStart` slicing a
`+10:00` timestamp to the right calendar day, and the four day/date combinations. That is a
test of the logic, **not** of the wiring: it cannot prove `mapRow` calls it correctly. The
ledger box stays unticked until a real dated row exists.

**A row with both `Days` and a `Date` yields both.** Recurring blocks (`date: null`) plus one
dated block (`day: ""`). This mirrors `/week`, which places an entry when its `days[]`
matches *or* its `date` equals the column (`app/week/page.tsx:172-179`) — a row with both
appears in both places there too. Untested against real data for the same reason as above.

**The sort keys exist because string sort is wrong, and that was demonstrated, not asserted.**
Sorting `["2pm", "9:05am", "14:00", "08:00"]` by `startMin` gives
`08:00, 9:05am, 2pm, 14:00`; sorting the same list as strings gives
`08:00, 14:00, 2pm, 9:05am` — 2pm and 14:00 are the same instant and land three positions
apart. Any renderer sorting on the display strings will look plausible and be wrong.

**`force-static` had to go, and that is a real tradeoff, not a free fix.** The 503 is
unimplementable under a prerendered route: `force-static` bakes one response at build time
and a baked response cannot be conditionally uncacheable. The route is now `force-dynamic`
with the 300s cache declared per response. `npm run build` confirms the change took effect —
`/api/board` is listed as `ƒ (Dynamic)` where it was `○ (Static)`. **What was lost:** under
`force-static` the origin itself would not re-query Notion within 300s no matter what sat in
front of it, capping Notion traffic at 8 requests per 300s. Now every CDN miss, eviction or
cold edge region runs all eight queries at the origin. The lifetime clients see is still
300s; the origin-side cap is gone. Recorded in BOARD-SPEC as accepted.

**Both response paths were observed on the wire, not reasoned about.** Success:
`HTTP/1.1 200 OK`, `cache-control: public, s-maxage=300, stale-while-revalidate=300`.
Total failure, forced with a deliberately invalid `NOTION_TOKEN` through `netlify dev`:
`HTTP/1.1 503 Service Unavailable`, `cache-control: no-store`, `blocks: []`, all eight
layers named in `errors` with `Notion API 401 Unauthorized`. This is the same scenario that
previously returned HTTP 200 and would have been cached for 300s. **Still local** — the
Netlify CDN rewrites cache headers in production (`netlify-cdn-cache-control`), and no
production URL has been fetched, so the deployed header values remain unverified.

**Partial failure is still inference.** One source down and seven up was not induced. It
follows from `errors.length === SOURCES.length` gating the 503, but it has never been
measured. Unchanged from the previous pass.

**Token-in-bundle: tested, and it is clean.** `npm run build` (exit 0), then
`grep -rlF "$NOTION_TOKEN" .next` → **0 files**, in `.next/static`, `.next/server`, and the
tree as a whole. Also 0 for the token's 24-char prefix, 0 for the literal `NOTION_TOKEN` in
`.next/static`, and 0 for any `NEXT_PUBLIC_*NOTION*`. A zero-hit grep proves nothing on its
own, so it was controlled both ways: the identical grep does find the value in `.env.local`
(so the grep works), and `.next/static` contains 15 JS files totalling 976K (so the target
is not empty). The token value was never printed to the terminal. This is the first time
this box has been tested rather than assumed — it is now ticked.

**`app/api/todos/route.ts` has no cache — known defect, out of scope, still open.** It
fetches `api.notion.com` and exports neither `revalidate` nor `dynamic`, so it is uncached
on every request. Pre-existing, untouched by this change set, and deliberately not fixed
here: it is not `/board` work and folding it in would widen the diff past what the
amendments authorise. The "300s cache set on every Notion read" box therefore stays
**unticked**, because as written it is a claim about every Notion read repo-wide, not just
this route. Carried forward from the previous pass, unresolved.

**The first draft of the 503 amendment contradicted its own diff, and the board-reviewer
caught it.** As written, it claimed the success-path cache was "unchanged" and that the
all-failed case was the only change — while the same diff moved the caching mechanism from
build-time prerender to a response header. The spec denied a change it was making. Fixed by
amending the spec text to state the mechanism move and its accepted consequence explicitly,
not by reverting the code. Worth recording because it is the exact failure mode
BOARD-SPEC.md:5-6 exists to prevent, and it survived a first read.

**Verification run for this pass:** `npm run build` → exit 0, `/api/board` now `ƒ (Dynamic)`.
`npx tsc --noEmit` → exit 0. `netlify dev` → `/api/board` HTTP 200, 140 blocks, 0 dated,
1 null `startMin`, `errors: []`; invalid-token run HTTP 503 with `no-store`, `blocks: []`,
8 errors. Synthetic logic test 25/25. board-reviewer on the diff: 1 VIOLATION (the
self-contradicting amendment above — fixed), then re-run clean: "No spec violations found in
this diff." Everything here is local. **Nothing is production-verified and no CUTOVER box is
ticked.**
