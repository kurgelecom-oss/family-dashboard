# BOARD-LEDGER

Running state for the `/board` build. Derived from `BOARD-SPEC.md` — that file is the
authority and does not change; this file is the only place progress is recorded.

Tick an item **only** when it is verified, not when it is written. Anything verified
against production must cite the fetched URL and what was found in the response body.

---

## ROUTE

- [x] Route `/board` exists in family-dashboard — `app/board/page.tsx`; `netlify dev`
      `GET http://localhost:8888/board` → **HTTP 200**, 22,699 bytes; listed in the build
      output as `○ /board`
- [x] `/board` replaces `/week` entirely (no remaining dependency on `/week` rendering)
      — **done 2026-07-26, superseding the earlier "not done, and not attempted" text on
      this line.** All three grounds that kept it unticked are now false: production
      `https://kurgel-dashboard.netlify.app/week` → **HTTP 308** → `/board` (fetched, not
      inferred); `app/components/PanelHomeschoolWeek.tsx:117` now reads
      `href="https://kurgel-dashboard.netlify.app/board"` with its card title relabelled
      "Time Allocation Board" (commit `de311d3`); and no surface nav links to `/week`.
      `app/week/page.tsx` remains on disk deliberately — redirects are checked before the
      filesystem, so it is unreachable rather than deleted. See CUTOVER and Findings
      2026-07-26, "CUTOVER complete — final production sweep"

## STRUCTURE

- [x] Three collapsible person sections render: Taylan, Nihal, Ansar — verified in a real
      browser (Playwright, 1920×1080): 3 `<section>` elements in that order
- [x] Sections are genuinely collapsible (expand/collapse works, not static headings)
      — clicked the Taylan header: `aria-expanded` `true`→`false`, its layer headings went
      4→0 (h3 count), caret `▾`→`▸`; clicking again restored it. State is `useState` only:
      `localStorage` empty and `sessionStorage` holds only Next's own dev debug key
- [x] Taylan shows exactly: Work, Personal, Ecom — with 17 / 16 / 17 blocks
- [x] Nihal shows exactly: Home, Personal, Ecom, Ayah — with 21 / 13 / 26 / 0 blocks
- [x] Ansar shows exactly: Homeschool — 30 blocks
- [x] No layer appears under a person who does not own it — 8 `<h3>` layer headings total
      across the three sections, matching the spec table exactly; blocks are filtered on
      person **and** layer, so a mislabelled block surfaces in the "could not be placed"
      list rather than leaking into another person's section

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
- [x] A row with a `Date` and no `Days` yields a block — **proven live 2026-07-26.** A
      temporary row (`Entry` "TEMP DATE TEST", `Date` 2026-07-29 (Wed), `Start` "10:00",
      `End` "10:30", **`Days` empty**) was created in `63550d99-…` via the Notion API. The
      payload went 140 → **141** blocks and returned exactly one dated block:
      `{person:"ansar", layer:"homeschool", day:"", date:"2026-07-29", start:"10:00",
      end:"10:30", startMin:600, endMin:630, title:"TEMP DATE TEST", notes:""}`. The row was
      then deleted and the payload returned to 140 with 0 dated. Superseded the synthetic
      25/25 logic test, which stands but is no longer the only evidence. See Findings
- [x] `startMin` / `endMin` present on every block, integer minutes or `null` — 140/140
      carry both keys; 0 out-of-range values
- [x] 24-hour `"14:00"` parses — → `840`; `"08:00"` → `480`, observed in the live payload
- [x] 12-hour `"9:05am"` parses — → `545`, observed in the live payload
- [x] Unparseable → `null`, never `0` — 1 null `startMin` (`"Flexible"`), 9 null `endMin`
      (all empty strings). Every null traced to a genuinely absent or non-time value; no
      valid string was wrongly rejected
- [x] `start` / `end` unchanged as display strings — passed through verbatim; the parsed
      values live only in the new fields
- [x] Renderers sort on `startMin`/`endMin`, never on the display strings — `app/board/page.tsx`
      `byStart` compares `startMin` only. Verified in the rendered DOM: the Ansar Monday
      column reads 9:00am, 9:05am, 9:35am, 9:50am, 10:25am, 10:40am, 11:20am in document
      order
- [x] Null `startMin` sorts last — `byStart` returns nulls after all timed blocks; the one
      untimed block ("Flexible") is additionally labelled `· untimed` on the block so its
      position is explained rather than merely happening
- [x] All eight sources failing returns HTTP 503, uncached — observed under an invalid
      token via `netlify dev`: `HTTP/1.1 503 Service Unavailable`, `cache-control:
      no-store`, `blocks: []`, all 8 layers named in `errors` (`Notion API 401
      Unauthorized`)
- [x] Success path returns HTTP 200 with a 300s cache — observed: `HTTP/1.1 200 OK`,
      `cache-control: public, s-maxage=300, stale-while-revalidate=300`
- [ ] Partial failure (some sources down) still returns HTTP 200 — **not observed.**
      Follows from the `errors.length === SOURCES.length` gate, but inference, not
      measurement. Same gap as the previous pass

## ORIGIN CACHE (AMENDMENT 2026-07-26)

- [x] Single module-level entry, 300s TTL — `CACHE_TTL_MS = 300_000`. Observed:
      `X-Board-Cache: miss` on the first request, `hit` on the next
- [x] Notion queried at most once per 300s per warm instance while a payload is cached
      — proved by a stale hit: after the TEMP row was **deleted** from Notion, the very
      next request still returned 141 blocks with `X-Board-Cache: hit`. Only a server
      restart produced 140. A cache that were not real could not have done that
- [x] Concurrent requests coalesce onto one refresh — `inFlight` assigned synchronously
      before the promise chain can settle. Code-verified by the board-reviewer; **not**
      load-tested
- [x] The 503 path never populates the cache — three sequential requests under an invalid
      token all returned `HTTP 503` / `Cache-Control: no-store` / `X-Board-Cache: bypass`.
      Had the failure been cached, the second would have been a hit
- [x] `s-maxage` carries the entry's remaining TTL, not a flat 300 — observed `s-maxage=300`
      on a cold miss and `s-maxage=292` on a hit 8s later. This is what stops the module
      and CDN windows composing in series. See Findings
- [ ] Cap holds during a total outage — **it does not, by design.** Nothing is cached, so
      sequential requests each re-query all eight sources. Recorded in BOARD-SPEC as an
      accepted consequence of never caching a failure

## MANUAL REFRESH (AMENDMENT 2026-07-26)

- [x] `?refresh=1` bypasses the in-memory entry — local: `X-Board-Cache: refresh` with
      `Cache-Control: no-store`, where the same URL without it returned `hit`
- [x] It repopulates the cache rather than merely bypassing — the request immediately
      after a refresh returned `X-Board-Cache: hit`, so the entry was rewritten, not emptied
- [x] A forced refresh does not adopt an in-flight load — `refresh(force)` skips the
      `inFlight` early return; loads carry a monotonic `seq` and only a later one may write
      the cache. Code-verified by the board-reviewer across both completion orderings.
      **Not** load-tested under a real overlap
- [x] Two concurrent forced refreshes both reach the origin — both returned
      `X-Board-Cache: refresh`; payload stayed 140 blocks, `errors: []`
- [x] Visible Refresh control on `/board` — calls `/api/board?refresh=1` exactly once per
      press (observed via a `window.fetch` wrapper), shows `Refreshing…` with
      `disabled=true` and `aria-busy=true` while in flight (captured with a MutationObserver),
      and the `loaded HH:MM:SS` stamp advanced 16:24:56 → 16:25:06
- [x] **`?refresh=1` reaches the origin in production** — `cache-status: "Netlify Durable";
      fwd=bypass` and `"Netlify Edge"; fwd=miss`, `X-Board-Cache: refresh`, on two
      consecutive production requests. This required `Netlify-Vary: query=refresh`; it was
      **broken in production before that fix and passing locally**. See Findings
- [ ] A manual refresh also clears the CDN copy — **it does not.** The refresh response is
      what the user sees, but the plain `/api/board` edge entry keeps serving its cached
      copy until it expires, so the page's next background poll can briefly show older
      data. Bounded by the same 300s. See Findings

## PREBUILD ICLOUD CLEANUP

- [x] `scripts/clean-icloud-dupes.sh` removes `* <digit>.*` files from the build output
- [x] Wired so `npm run build` always runs it first — npm `prebuild`; observed firing ahead
      of `next build` on every build in this pass
- [x] Proven on planted duplicates — `.next/probe 2.txt` and `.next/types/probe 2.ts` were
      both named and deleted, then the build succeeded
- [x] Proven on real duplicates — a later build removed 3 that iCloud had created on its
      own (`.next/build/56416d4ae4ce586f 2.js`, `… .js 2.map`, `package 2.json`)
- [x] `distDir` unchanged — the directory is a script argument defaulting to `.next`;
      `next.config.ts` still sets no `distDir`
- [x] Script is tracked — `.gitignore` negation added, since `/scripts/*` would otherwise
      have left it untracked and failed the Netlify build at `prebuild` with exit 127
- [x] Safe on a clean checkout — exits 0 with a message when the output dir is absent, which
      is the CI case

## PARITY WITH /week

- [x] Schedule renders from Notion on `/board` — 140 blocks across 7 populated layers,
      each in a 7-column Mon–Sun grid
- [x] ANSAR FC strip: points today — rendered inside the Ansar section, read `0`
- [x] ANSAR FC strip: week total out of 56 — label `Week total · /56`, read `53`
- [x] ANSAR FC strip: day streak — read `6 🔥`
- [x] ANSAR FC strip: four tier thresholds — `Training Ground ❌ · 0+`, `Reserves ⚠️ · 26+`,
      `Bench ✅ · 34+`, `First Team 🏆 · 42+`
- [x] Edit in Notion link present and correct — `Edit in Notion ↗` →
      `https://app.notion.com/p/39b5429afa9081b285dcdeb7fea6a781`
- [x] No fourth `scoreDay` created — exactly one definition repo-wide (`app/lib/scoring.ts:74`);
      `/board` reuses `WeekProgressStrip`, which imports it. `/board` defines no scoring

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

- [ ] No hardcoded hex in any file touched by this work — **true of everything written for
      `/board`, false repo-wide.** `app/board/page.tsx` and `app/api/board/route.ts` contain
      **0** hex, `rgb()`, `rgba()` and `hsl()` literals. The pre-existing violations in
      `PanelHabits.tsx` (`#a78bfa` at `:49` and `:210`, non-token `rgba()` at `:188-189`)
      and `WeekProgressStrip.tsx` (`rgba()` at `:157`) are untouched and still stand, and
      `WeekProgressStrip` is now rendered by `/board` — so the box stays unticked
- [x] All colours resolve through `globals.css` tokens — in `/board`'s own markup: 13
      distinct `var(--…)` tokens used, every one defined in `globals.css` in both themes
- [x] `--cyan` remains `#00d4ff` — `globals.css:19`, unchanged by this work

## CUTOVER

**COMPLETE — 2026-07-26.** Every box below is ticked. The two behavioural claims — the
redirect and the cutover verification — are backed by direct fetches of deployed URLs.
The five "Nav updated" boxes cite files on disk, because that is what they assert; the
*deployed* nav is verified separately by the last box and by the Findings sweep. One of
them cannot be fetch-verified even in principle: time-allocation-board now serves a
57-byte 301 body, so it has no nav to fetch. Final verification sweep recorded in
Findings, "CUTOVER complete — final production sweep".

- [x] `/week` redirects to `/board` — production `https://kurgel-dashboard.netlify.app/week`
      → **HTTP 308**, `Location: https://kurgel-dashboard.netlify.app/board`. Framework
      redirect, not client-side: `next.config.ts` `redirects()` with `permanent: true`
      (Next emits 308, not 301, to preserve the request method). `app/week/page.tsx` is
      deliberately **not deleted** — redirects are checked before the filesystem, so the
      route still exists on disk and is unreachable
- [x] Nav updated: family-dashboard — `app/components/TopNav.tsx`, 6 entries → 5
- [x] Nav updated: ansar-habits-tracker — `app/components/TopNav.tsx`
- [x] Nav updated: time-allocation-board — `index.html`
- [x] Nav updated: ecom-launchpad — `index.html`
- [x] Nav updated: link-board — `index.html`
- [x] `/board` verified by fetching the deployed production URL — **first production
      verification in this work.** `https://kurgel-dashboard.netlify.app/board` → **HTTP
      200**, 17,228 bytes. All nine required strings present in the server-sent HTML:
      Taylan (2), Nihal (2), Ansar (4), Work (1), Personal (2), Ecom (2), Home (3), Ayah (1),
      Homeschool (2) — confirmed independently by the prod-verifier subagent. Production
      `/api/board` → **HTTP 200**, 140 blocks, taylan 50 / nihal 60 / ansar 30, `errors: []`
      — **counts superseded 2026-07-26 by the cutover.** Removing the "Homeschool Week" nav
      entry dropped two of them: production now serves Home (2) and Homeschool (1). The
      box's conclusion still holds — all nine strings are still present and still
      server-rendered — but read the numbers above as the pre-cutover reading, not current
- [x] Cutover verified by fetching production, never self-reported — every surface fetched
      live on 2026-07-26 after all five deploys landed. `/week` → **HTTP 308**, `location:
      /board` (relative, as served); `https://time-allocation-board.netlify.app/` → **HTTP
      301** → `https://kurgel-dashboard.netlify.app/board` (absolute). The **five
      nav-bearing surfaces** all return **HTTP 200** with a nav containing
      `kurgel-dashboard.netlify.app/board` exactly once and **zero** links to `/week` or
      `time-allocation-board.netlify.app` (grep scoped to the `<nav class="topnav">`
      block). The sixth surface, `time-allocation-board.netlify.app`, is a 301 with no
      body — there is no nav on it to grep, by design. Counts below in Findings

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

### 2026-07-26 — origin cache, live date proof, and the `/board` renderer

**The dated branch is no longer a latent claim — it was proven against real Notion data.**
A temporary row was written to `63550d99-…` through the Notion API: `Entry` "TEMP DATE TEST",
`Date` 2026-07-29 (a Wednesday), `Start` "10:00", `End` "10:30", and **`Days` deliberately
left empty** — precisely the row shape that produced no block and no error before the
amendment. The payload went 140 → 141 and carried exactly one dated block:
`day:""`, `date:"2026-07-29"`, `startMin:600`, `endMin:630`. The row was then archived
(`in_trash: true`) and the payload returned to 140 with 0 dated and no "TEMP" title
remaining. **Nothing about this was faked and nothing was left behind in Notion.** Worth
noting the row also proves the parser is shape-agnostic: "10:00" is 24-hour text sitting in
the *Weekly Schedule*, which normally stores 12-hour, and it parsed to 600 regardless.

**The delete is what proved the cache, by accident and then on purpose.** Immediately after
archiving the row, `/api/board` still returned 141 blocks with `X-Board-Cache: hit`. The
data was gone from Notion and still on the board. Only restarting the server produced 140.
That is the origin cache doing exactly its job, and it is stronger evidence than any header
— a cache that were not really holding could not have served a row that no longer existed.
The corollary is the operational one: **after editing Notion, the board can be up to 300s
stale per warm instance, and a hard refresh will not clear it.** Nothing short of the TTL
expiring or the instance recycling will.

**`force-static` → `force-dynamic` cost an origin request cap; the module cache buys it
back, but not everywhere.** While a payload is cached the origin queries Notion at most once
per 300s per warm instance no matter how many requests arrive, and concurrent requests on a
cold entry coalesce onto one refresh instead of each firing eight queries. Two honest holes
remain, both recorded in BOARD-SPEC rather than glossed: the cap is **per instance**, so N
warm instances mean up to N refreshes per window; and **during a total outage there is no cap
at all**, because the 503 path is forbidden from writing the cache and `inFlight` only
coalesces concurrent requests. The origin therefore hammers Notion hardest exactly when
Notion is least able to answer. That is the accepted price of never caching a failure — a
negative cache would bound it and would also pin the outage, which is the thing the 503
exists to prevent.

**Two 300s caches in series would have been 900s of staleness, not 300.** The first draft
served a cache hit with a flat `s-maxage=300`. A CDN filling from an entry already 299s old
would then hold it a further 300s fresh plus 300s stale-while-revalidate — worst-case client
age ~900s, where the pre-cache behaviour was ~600s. The in-memory cache would have been
buying an origin request cap with a full extra TTL of staleness, and the amendment claimed
it "introduces no new staleness". Fixed in the code rather than by softening the sentence:
`cacheControlFor` sets `s-maxage` to the entry's **remaining** TTL, so the CDN's fresh window
ends when the origin entry does, whenever it filled. Observed: `s-maxage=300` cold,
`s-maxage=292` on a hit 8s later. Worst case is back to ~600s.

**`import type` from a route handler into a client component is safe, and was checked rather
than assumed.** `app/board/page.tsx` imports `Block` and `BoardPayload` from
`app/api/board/route.ts` so the renderer's shape cannot drift from the reader's. The import
is type-only and erased at compile time, but the spec's "token never client-side" rule is
absolute and a bundler edge case here would be severe, so the built output was grepped: **0**
hits in `.next/static` for the token value, its 24-char prefix, the literal `NOTION_TOKEN`,
`api.notion.com`, `data_sources` and `fetchSource`. The board's own client chunk was located
by a string unique to the page, confirming the grep target was the right file and not empty.

**`Category` was being silently dropped, and the board-reviewer caught it.** BOARD-SPEC's
RULES line names `Category` as one of the five Weekly Schedule fields "the renderer must
handle", and `/week` colour-codes every entry by it. The first draft of `BlockCard` rendered
emoji, title, times, date and notes/detail — and discarded `category` without a word. Now
rendered as an uppercase label. All 30 Ansar blocks carry one; the seven layer sources carry
none.

**The failure UI was verified under real failure, not by reading the code.** With an invalid
token the page renders two alert regions — one naming all eight failed layers with their
`Notion API 401 Unauthorized` messages, one naming the HTTP 503 — plus a "failed to load"
badge on each of the eight layer headings, while all three person sections still render. The
empty-layer text deliberately says an empty layer and a failed one look identical here and
points at the banner, because they genuinely are indistinguishable by block count: that is
the `nihal-ayah` lesson from the previous pass turned into copy on the page.

**The "Not changed" list in an amendment has now been wrong twice, on the same clause.** The
previous amendment's first draft claimed the success-path cache was unchanged while moving
the caching mechanism. This amendment's first draft listed "the 300s success-path
`Cache-Control`" as unchanged while replacing that exact header with a computed one. Both
were caught by the board-reviewer, neither by re-reading. The list is the part of an
amendment most likely to be copied forward and least likely to be re-derived. BOARD-SPEC now
says so explicitly and instructs the next author to re-derive it from the code.

**`.next` keeps growing duplicate files that break `tsc`.** Files such as
`.next/types/routes.d 2.ts` and `.next/types/cache-life.d 2.ts` appeared twice during this
session and each time made `npx tsc --noEmit` fail with `TS2300`/`TS6200` duplicate-identifier
errors that have nothing to do with the source. The " 2"/" 3" suffix pattern is macOS
file-duplication, and the repo lives under `~/Documents`, so an iCloud/Finder sync is the
likely cause. Deleting them restores exit 0. **This is environmental, not a code defect.**

**Superseded 2026-07-26 by the prebuild hook** — `scripts/clean-icloud-dupes.sh` now removes
them before every build. That treats the symptom, not the cause; see the next Findings entry.

**`app/api/todos/route.ts` still has no cache.** Unchanged from the previous pass: it fetches
`api.notion.com` and exports neither `revalidate` nor `dynamic`. Pre-existing, out of scope,
and still the sole reason the repo-wide "300s cache set on every Notion read" box is unticked.

**Verification run for that pass:** `npx tsc --noEmit` → exit 0. `npm run build` → exit 0,
`/board` present as `○`, `/api/board` still `ƒ`. `netlify dev` → `/board` **HTTP 200**;
`/api/board` HTTP 200, 140 blocks, `errors: []`, 30 with `category`; TEMP-row run 141 blocks
with 1 dated, then 140 after deletion; invalid-token run HTTP 503 ×3, all
`X-Board-Cache: bypass`. Browser verification (Playwright, 1920×1080 and 1024×768): 3
sections, 8 layers, collapse/expand works, sort order correct, Ayah empty state, ANSAR FC
strip complete, Edit in Notion link present, no horizontal page scroll at iPad width, 52px
collapse targets, `localStorage` empty. board-reviewer on the diff: 2 VIOLATIONS + 1 NOT MET,
all fixed; a third VIOLATION introduced by the first fix, also fixed; final re-run clean —
"No spec violations found in this diff." **Everything here is local. Nothing is
production-verified, no CUTOVER box is ticked, and the deployed CDN rewrites cache headers,
so the header values observed above are not evidence about production.**

### 2026-07-26 — manual refresh, prebuild cleanup, and the first production verification

**The refresh button shipped broken to production and passed every local test.** This is the
most important thing in this entry. `?refresh=1` worked perfectly under `netlify dev` —
`X-Board-Cache: refresh`, `no-store`, cache repopulated, two concurrent refreshes both
reaching the origin. In production it did nothing at all. Netlify's Next adapter keys cached
routes on `__nextDataReq` and `_rsc` only, so **every other query parameter is excluded from
the edge cache key**; the CDN answered `?refresh=1` from the stored plain `/api/board` entry
and the origin was never reached. The deployed response said so plainly once looked at:
`cache-status: "Netlify Edge"; hit`, an `age` advancing 37 → 49 → 50 → 81 → 280 across
requests, and a frozen `X-Board-Cache: miss` — identical for unique cache-busting query
strings and unchanged by a `Cache-Control: no-cache` request header. Fixed with
`Netlify-Vary: query=refresh` on every response from the route; Netlify **merged** it into
its own list rather than replacing it, giving
`query=__nextDataReq|_rsc|refresh`. Re-verified against production:
`cache-status: "Netlify Durable"; fwd=bypass` + `"Netlify Edge"; fwd=miss`,
`X-Board-Cache: refresh`, on two consecutive requests. **`netlify dev` does no edge caching,
so it cannot see this class of bug** — it is not a weaker version of production, it is a
different system. BOARD-SPEC's "verified by fetching the deployed production URL, never
self-reported" earned its keep here.

**A manual refresh does not clear the CDN copy, and is not meant to.** The user sees the
refresh response immediately, but the plain `/api/board` edge entry keeps serving its cached
copy until it expires, so the page's next background poll can briefly show data older than
what the button just displayed. Bounded by the same 300s already accepted everywhere else.
Recorded rather than fixed: purging it would mean disabling CDN caching for the route, a
larger change than the control warrants.

**A forced refresh must not coalesce, and the first draft did.** `refresh()` returned any
in-flight load, so pressing Refresh while the page's own 300s poll was mid-flight would have
adopted a read that *started before the press* — returning pre-edit data, re-priming the
shared entry with it for a full TTL, and stamping the response `X-Board-Cache: refresh`. The
button would have appeared to work while leaving the user exactly where they started, which
is worse than no button. Caught by the board-reviewer, not by testing: the window is real but
narrow, and every manual test happened to fall outside it. Forced loads now always start
their own read, which means two loads can overlap, so each carries a monotonic `seq` and only
a later one may write the cache — otherwise a slow older read could silently undo the refresh.

**Concurrent forced refreshes cost 8 Notion queries each, by design.** Two at once means 16.
That is the accepted price of not coalescing, and it is bounded by how often a human presses
a button. The endpoint is unauthenticated, like every route in this repo, so the origin cap
holds only for traffic that does not ask to bypass it — stated in BOARD-SPEC rather than
discovered later.

**The prebuild hook works, and caught real duplicates on its first live run.** Planted probes
(`.next/probe 2.txt`, `.next/types/probe 2.ts`) were both named and deleted before
`next build` started. A later build then removed **3 duplicates iCloud had created on its
own** — `.next/build/56416d4ae4ce586f 2.js`, `… .js 2.map`, `package 2.json` — without being
prompted. `distDir` is untouched: the directory is a script argument defaulting to `.next`.

**The repo living under `~/Documents` is the root cause, and relocating it is a separate
future job.** macOS syncs `~/Documents` to iCloud Drive, which duplicates files it catches
mid-write using Finder's " 2" naming. `.next` is rewritten on every build and dev run, so it
is where this lands, and a duplicated `.d.ts` is not inert — `tsc` compiles
`.next/types/routes.d 2.ts` alongside the original and fails with TS2300/TS2428/TS6200
naming identifiers nobody wrote, in files nobody edited. **The prebuild hook treats the
symptom only.** The real fix is moving the repo out of `~/Documents` or excluding it from
iCloud sync, which touches every checkout, worktree and tool path on this machine and is
therefore explicitly **out of scope here and deferred as its own job**. Until then the hook
keeps builds green, and anyone hitting phantom duplicate-identifier errors from a *dev*
server (which does not run `prebuild`) should run `sh scripts/clean-icloud-dupes.sh` by hand.

**`.gitignore` needed a second negation or the deploy would have died.** `/scripts/*` would
have left `clean-icloud-dupes.sh` untracked while `package.json`'s `prebuild` shipped, and
Netlify's build would have failed at `prebuild` with exit 127 — a deploy broken by a file
that exists locally and nowhere else. Flagged by the board-reviewer before the commit and
staged explicitly.

**Production numbers match local exactly.** `https://kurgel-dashboard.netlify.app/api/board`
→ **HTTP 200**, **140 blocks**, **taylan 50 / nihal 60 / ansar 30**, **`errors: []`**, 0 dated,
1 null `startMin`, 30 with `category`. `/board` → **HTTP 200**, 17,228 bytes, all nine
required strings in the server-sent HTML (Taylan 2, Nihal 2, Ansar 4, Work 1, Personal 2,
Ecom 2, Home 3, Ayah 1, Homeschool 2), independently confirmed by the prod-verifier subagent.
Two of those counts want reading carefully: "Home" is 3 literal matches of which only one is
the standalone Nihal layer label — the other two are inside "Homeschool" — and "Ansar" is 4
because the topnav and the FC card title also carry it. Both are genuine passes; neither is
4 layers named Home.

**`/week` is untouched and still live.** **HTTP 200**, 10,590 bytes, **0 redirects**, still
serving its own page with its own heading. Zero commits in this entire body of work touch
`app/week/`. `/board` exists alongside it; nothing has been cut over and nothing has been
broken.

**Verification run for this pass:** `npx tsc --noEmit` → exit 0. `npm run build` → exit 0
with `prebuild` firing first. `netlify dev` → cold `miss`, then `hit`, `?refresh=1` →
`refresh` + `no-store`, then `hit` (repopulated); `?refresh=0` correctly *not* treated as a
bypass; two concurrent forced refreshes both `refresh`, 140 blocks, `errors: []`. Browser:
Refresh button issues exactly one `/api/board?refresh=1`, shows `Refreshing…` /
`disabled=true` / `aria-busy=true` in flight, `loaded` stamp advances. board-reviewer: 1
VIOLATION (forced refresh coalescing — fixed), then clean, "No spec violations found in this
diff." **Production:** `/board` 200 with 9/9 strings, `/api/board` 200 with 140 blocks and
`errors: []`, `?refresh=1` forwarding to origin, `/week` 200 unchanged. Commits `d37fab3` and
`4b9f9e7` are pushed and deployed. **`/board` is production-verified for the first time;
CUTOVER remains entirely undone.**

### 2026-07-26 — CUTOVER executed across five repos

**All five CUTOVER boxes now tick, and every one is backed by a production fetch.**

**What shipped.** One commit per repo, all `chore: cut over to unified /board`:
family-dashboard `f2c5633`, ansar-habits-tracker `2924bf1`, time-allocation-board
`25e042d`, ecom-launchpad `7ebac82`, link-board `cfa8772`. Two changes only —
`TopNav.tsx` / `index.html` nav lists (6 entries → 5: "Homeschool Week" removed, "Time
Allocation Board" repointed from `time-allocation-board.netlify.app` to
`kurgel-dashboard.netlify.app/board`, holding its old position), and the two redirects.

**Production verification, fetched after all five deploys landed:**

| URL | HTTP | Nav correct |
|---|---|---|
| `https://kurgel-dashboard.netlify.app/` | 200 | yes |
| `https://kurgel-dashboard.netlify.app/board` | 200 | yes |
| `https://kurgel-dashboard.netlify.app/week` | **308 → /board** | n/a (redirect) |
| `https://ansar-habits-tracker.netlify.app/` | 200 | yes |
| `https://ecom-launchpad-mentor.netlify.app/` | 200 | yes |
| `https://luxury-kringle-cf4171.netlify.app/` | 200 | yes |
| `https://time-allocation-board.netlify.app/` | **301 → /board** | n/a (retired) |

"Nav correct" = the `<nav class="topnav">` block contains
`kurgel-dashboard.netlify.app/board` exactly once and `kurgel-dashboard.netlify.app/week`
and `time-allocation-board.netlify.app` zero times each. Greps were **scoped to the nav
block**, not the whole page — see the link-board note below for why that distinction is
load-bearing.

**The edge agreed with local this time — but that was not assumable.** The
`Netlify-Vary` amendment records the edge silently disagreeing with local, and concludes
"local is the one that lies". So the local `next start` 308 was treated as a smoke test
only; the 308 above is the edge's own, through `@netlify/plugin-nextjs`. Both redirects
landed on the first poll, ~90s after push.

**`/board`'s served HTML shows `0 blocks` — this is the pre-hydration shell, not a
regression.** `app/board/page.tsx` is a client component: curl receives layer headings
with `0 blocks` / `No blocks` and the real counts arrive after hydration. Production
`/api/board` at the same moment: **HTTP 200, 140 blocks, taylan 50 / nihal 60 / ansar 30,
`errors: []`** — byte-identical to the pre-cutover reading. This is exactly the
client-rendered ambiguity `prod-verifier` is told to name rather than resolve by
assumption; on this pass it read the shell literally and described Ayah and Homeschool as
"empty layers". They are not. **Anyone verifying block counts must use a browser** (as the
STRUCTURE boxes did, via Playwright) — curl can only prove the labels are server-rendered.

**Three things deliberately left undone, all outside the cutover's stated scope:**

1. `app/components/PanelHomeschoolWeek.tsx:117` still has `href="/week"` with
   `target="_blank"`. It resolves — via the new 308 — but a card titled "Homeschool Week"
   now opens the full three-person board in a new tab. Flagged by board-reviewer as a
   regression this cutover *caused* rather than one it inherited. Not fixed: changing it
   was not in scope and the right fix (relabel? remove the card? point it at `/board`
   in-tab?) is a product decision.
2. `link-board/index.html` `DEFAULT_LINKS` still contains a link **card** for
   `https://time-allocation-board.netlify.app/`. Not the nav, so the nav check passes; it
   is the one whole-page residual hit across all six surfaces. It still works — that host
   now 301s to `/board` — but it is user-facing and stale.
3. `TopNav.tsx:14` still comments `// "/week/" and "/week" are the same page` about an
   entry this commit removed. `normPath()` is still used and correct; only the example is
   stale. Left alone to keep the nav byte-identical across the five copies.

**The retired data source is STILL being read in production. The cutover did not stop it.**
This entry originally claimed the opposite; the claim was wrong and board-reviewer caught
it. **Netlify does not apply redirect rules to `/.netlify/functions/*`** — those paths are
internal and bypass the rule table, `force = true` included. Fetched after the redirect
was live: `https://time-allocation-board.netlify.app/.netlify/functions/get-schedule` →
**HTTP 200**, 116 blocks, **6 of them `ansar-homeschool`**, sourced from
`588f40ab-4078-4767-982c-b50f9cd83f71` at
`time-allocation-board/netlify/functions/get-schedule.js:10`. For contrast, an ordinary
path on the same host — `/api/schedule` — correctly returns **301** to `/board`. That
function is the only code reader of the retired id across all five repos, and it is live.
**Open. Not fixed by this work and not attempted:** the fix is either a
`/.netlify/functions/*` rule in `time-allocation-board/netlify.toml` or deleting
`get-schedule.js`, and the cutover instruction for that repo was "change nothing else".
Pre-existing — this commit neither caused it nor cured it.

**Verification run for this pass:** `npx tsc --noEmit` → exit 0. `npm run build` → exit 0.
board-reviewer on the code diff → **0 VIOLATIONS**, 2 NOT MET (the `PanelHomeschoolWeek`
link above, and "cutover not yet production-verified" — since satisfied). prod-verifier on
`/board` → **PASS**, 5/5 required strings server-rendered (Taylan 2, Nihal 2, Ansar 4,
Ayah 1, Homeschool 1), both must-be-absent strings confirmed gone from the served markup.

**board-reviewer on this ledger entry → 1 VIOLATION, 3 NOT MET — all four were real, and
this entry was corrected before it was committed.** It caught a false claim in this very
Findings section (the retired-source paragraph above, which originally asserted the
opposite of what production returns), the `/week` `Location` recorded as absolute when the
wire says relative, "all six surfaces 200" when the sixth is a 301 with no body, and the
`/board` box's now-stale string counts. Recording this because the gate earning its keep
on a *documentation* commit is the point: the numbers in a ledger are as capable of being
wrong as the code, and nothing here is self-reported.

**Two open observations, neither ticked and neither fixed:** production `/api/board`
returns bare `cache-control: public` with `cache-status: "Netlify Edge"; hit` — the origin
does emit the computed `s-maxage` (`route.ts`), so the edge is consuming and stripping it
rather than the code being wrong, but no box in this ledger has ever checked that header
against production. And `https://kurgel-dashboard.netlify.app/week/` (trailing slash)
double-hops: 308 → `/week` → 308 → `/board`. It resolves; it is two round trips.

### 2026-07-26 — CUTOVER complete — final production sweep

**Production verified by direct fetch. No local checks, no inference.** Seven URLs fetched
live:

| URL | HTTP | Redirect target | Nav |
|---|---|---|---|
| `https://kurgel-dashboard.netlify.app/board` | 200 | — | correct |
| `https://kurgel-dashboard.netlify.app/week` | **308** | `…/board` | n/a (6-byte body) |
| `https://kurgel-dashboard.netlify.app/` | 200 | — | correct |
| `https://ansar-habits-tracker.netlify.app/` | 200 | — | correct |
| `https://time-allocation-board.netlify.app/` | **301** | `…/board` | n/a (57-byte body) |
| `https://luxury-kringle-cf4171.netlify.app/` | 200 | — | correct |
| `https://ecom-launchpad-mentor.netlify.app/` | 200 | — | correct |

**Scoped to the `<nav class="topnav">` block**, all five nav-bearing surfaces carry
`kurgel-dashboard.netlify.app/board` exactly once and **zero** references to `/week` or
`time-allocation-board.netlify.app`. Whole-body the `/board` count is higher on two
surfaces and legitimately so: `/` = 2 (nav + the `PanelHomeschoolWeek` card link added by
`de311d3`) and link-board = 3 (nav :456, `DEFAULT_LINKS` :561, `RETIRED_URLS` :585); the
other three = 1. For `/week` and the retired host, whole-body across all seven pages there
are exactly **three** hits, none of them a link — see the stale-prose item below.

**ACCEPTANCE CRITERION MET — `/board` connects to Ansar Dashboard.** Both legs verified in
production, neither assumed:
- `scripts/check-scoring-sync.sh` → **exit 0**; both copies hash
  `fb737767648d8e3be1ac18076eba29b8b17fa56907ead32fd959fa4c13bc06fd`, `RESULT: IN SYNC`.
- Leg 1: `/board` (200, 17,137 B) contains `ansar-habits-tracker.netlify.app` ×1.
- Leg 2: `https://ansar-habits-tracker.netlify.app/` (200, 23,104 B) contains
  `kurgel-dashboard.netlify.app/board` ×1, line 66.

**FRAGILE LINK — the ecom-launchpad production URL is not recorded anywhere in its own
repo.** `https://ecom-launchpad-mentor.netlify.app/` is correct — confirmed by fetching it
and matching identity markers (`<title>ECOM Launchpad — THE ENGINE v2</title>`, plus
`THE ENGINE` ×5, `Setup Guide` ×13, `Graveyard` ×29, `ecom_currentTest` ×8). But
`~/ecom-launchpad` has **no `netlify.toml` and no `.netlify/state.json`** — the repo holds
only `.git`, `CLAUDE.md` and `index.html`. The hostname appears nowhere that binds the repo
to the site: the only occurrences are nav entries — its own at `index.html:1200` and the
matching ones on the other five surfaces — which are just links, not deploy configuration.
If those nav entries are ever edited wrongly, nothing in the repo contradicts them. Treat
the URL as unpinned until the repo records it.

**link-board sync was silently broken, and the cutover work exposed it.** `mergeDefaults`
threw `TypeError: Cannot read properties of undefined (reading 'replace')` on **every**
load: the dedupe predicate called `normalizeUrl(l.url)` unguarded, and the live list holds
an image-only card (`Failure Mode: Incorrect Product Launch`) with no `url` — `url` is
genuinely optional, the server validator requires "a url **or** an image". `loadLinks()`
was catching it and falling back to the cached copy, so cloud sync had been dead. Guard
added in **`3593f55`** — *not* `cfa8772`, which is the nav-only cutover commit and contains
no guard (verified: `git show 3593f55 | grep -c "l.url &&"` → 2, same on `cfa8772` → 0).
Reproduced against the real `/api/links` payload before and after.

The card fix is **client-side migration, not a data fix.** The cloud blob still stores
`https://time-allocation-board.netlify.app/`; a `RETIRED_URLS` rewrite in `mergeDefaults`
repoints it on load, so each device self-heals and the entry keeps its position rather than
a second card being appended. The stored copy stays stale until something performs a write
with the token in `localStorage`. Verified idempotent against the live payload: 7 cloud
entries → 10 merged, exactly one "Time Allocation Board" card at `/board`, zero references
to the old host, image-only card preserved.

**OPEN — `/api/board` returns no `ayah` layer key at all, not an empty one.** BOARD-SPEC
lists Ayah under Nihal. The response contains layers `work, personal, ecom, home,
homeschool` and **no `ayah` key whatsoever** — Ayah is absent from the payload, not
present-with-zero-rows. The `/board` shell still renders "Nihal · 4 layers" while the API
carries 3 for her (ecom 26, home 21, personal 13). Needs a decision: should an empty layer
render as an onboarding placeholder, or be omitted? **Not fixed this job.** Related but
distinct from the DATA SOURCES box, which records `nihal-ayah` as *queried OK, 0 rows* —
that is about the source; this is about the shape of the response.

**OPEN — stale `/week` prose in the nav active-state comments.** `link-board/index.html:539`
(`// … "/week/" and "/week"`) and `ecom-launchpad/index.html:1207` (`// … so "/week" ==
"/week/".`). Both are comments, neither is a link, and `normPath()` itself is still correct
and still used. Left in place deliberately to keep the five nav copies byte-identical;
fixing them means touching all five.

**Caution for anyone re-verifying `/board` with curl.** The served HTML is a pre-hydration
shell — `app/board/page.tsx` is a client component, block counts render as `0 blocks` /
`No blocks`, and the counts arrive after hydration from `/api/board` (200, 140 blocks,
taylan 50 / nihal 60 / ansar 30, `errors: []`). Labels are server-rendered and greppable;
**counts are not**. React also splits the text (`>0<!-- --> block`), so a literal
`grep -F "0 blocks"` returns nothing. prod-verifier on `/board` → **PASS**, 5/5 required
strings server-rendered: Taylan 2, Nihal 2, Ansar 4, Ayah 1, Homeschool 1.

**board-reviewer on this ledger entry → 2 VIOLATIONS, 2 NOT MET. All four were real and all
four were corrected before commit.** It caught: (a) a blanket "every box is backed by a
direct fetch" header when five of the eight cite files on disk and one — time-allocation-
board — can never be fetch-verified, since it now serves a 57-byte 301 body with no nav;
(b) the **ROUTE** box 800 lines above still reading "not done, and not attempted" while
this entry declared CUTOVER complete, so a reader working top-down was told the cutover
had never started — now ticked with its three grounds individually refuted; (c) an
unqualified "five surfaces carry the /board link exactly once" that is true nav-scoped but
false whole-body, where the very next sentence introduces whole-body as the contrasting
scope; (d) "the only in-repo evidence of that hostname is the nav entries of the *other
five* surfaces" when ecom-launchpad's own `index.html:1200` carries it too. Second
consecutive documentation commit where the gate found a false statement in prose that had
already been checked once — the numbers in a ledger are as capable of being wrong as code.

### 2026-07-26 — Notion synced, retired source archived, cutover closed out

**Reported by tk, not observed from here.** Everything in this paragraph is Notion-UI state
that cannot be checked from a shell, and none of it was independently verified this
session. **Notion after-cutover work COMPLETE**: WHATS NEXT updated with both a status
panel and a full change-log entry; both Build Pipelines now carry a superseding notice at
the top — naming locked, "Homeschool Week" retired permanently, Layer 2 is the Time
Allocation Board. Data source `588f40ab-4078-4767-982c-b50f9cd83f71` ("Ansar · Homeschool",
parent page `8479d6fd68f942d68d9751bff2716c8e`) **moved to Trash**. It held 6 placeholder
rows only — "Homeschool prep", 09:00–09:30, **Mon–Sat**, no detail, no notes. Checked
against the live Weekly Schedule `63550d99-ab80-4c2d-914d-d7df6d2f95a9` first, and judged:
**no unique content lost.**

**One gap in that judgement, worth recording rather than smoothing over.** The live Weekly
Schedule covers 09:00–11:20 **Mon–Thu** in full, plus Friday flex and debrief — confirmed
against the live payload: Mon 7, Tue 7, Wed 7, Thu 7, Fri 2, **Sat 0, Sun 0**. The retired
source's rows ran **Mon–Sat**. Mon–Sat is not covered by Mon–Thu + Fri, so on the entry's
own two statements the **Saturday** row has no counterpart. The rows were placeholders with
no detail and no notes, so this is very likely immaterial — but "no unique content lost"
does not follow from the comparison as stated, and the Trash is reversible if it matters.

**The archive is corroborated by observed behaviour, not only by the action being
reported.** Earlier today the last code reader of that source —
`time-allocation-board/netlify/functions/get-schedule.js` — was still live, returning
**HTTP 200 with 116 blocks, 6 of them `ansar-homeschool`**, because Netlify does not apply
redirect rules to `/.netlify/functions/*`. Re-fetched after the Trash: **HTTP 200, 110
blocks**, **zero** `ansar-homeschool`, with the layer now surfacing in `errors`:

    Notion API 404 … Could not find data_source with ID:
    588f40ab-4078-4767-982c-b50f9cd83f71

**That corroborates 6 blocks, not 6 rows.** A single row with a multi-select `Day` spanning
Mon–Sat produces the identical 116 → 110 delta — and one repeated title across six days is
exactly that shape. The block count is evidence; the row count remains tk's report.
**`/api/board` is unaffected**, as it must be — it reads `63550d99`: **HTTP 200, 140
blocks, `errors: []`**, taylan 50 / nihal 60 / ansar 30, homeschool 30.

**The open item is narrowed, not closed.** "CUTOVER executed across five repos" recorded
that the retired source "is STILL being read in production" and named two fixes: a
`/.netlify/functions/*` rule in `time-allocation-board/netlify.toml`, or deleting
`get-schedule.js`. **Neither was done.** The read is still issued on every request — it now
404s. What ended is the *consequence*: retired data is no longer served, and the failure is
named in `errors` rather than passing silently. BOARD-SPEC says the source "must not be
read", and by the letter of that line the reader should still go. Carried, reduced.

> **CLOSED later the same day — see "Retired source no longer read anywhere" below.** The
> `ansar-homeschool` entry was deleted from `CATEGORIES` in
> `time-allocation-board/netlify/functions/get-schedule.js` (commit `a559daa`), so the
> query is no longer issued at all. This paragraph is left as originally written rather
> than rewritten, so the sequence stays legible.

**NOTE for future work — a data source ID is not a page ID.** `588f40ab…` does not resolve
as `app.notion.com/p/<id>`; its database page is `8479d6fd68f942d68d9751bff2716c8e`. To get
the real page URL, fetch `collection://<id>`. (tk's note; not re-derived here.) This cost
time once; it should not cost it twice.

**Housekeeping — the "appears 3×" parentheticals are stale.** The DATA SOURCES box and the
Findings line that repeat it both say the retired id "appears 3× in the repo —
`BOARD-SPEC.md:37`, `BOARD-LEDGER.md:35`, `.claude/agents/board-reviewer.md:39`". That was
already wrong (`BOARD-LEDGER.md:35` does not contain it) and this entry adds more prose
occurrences. Current counts: **BOARD-LEDGER 3, BOARD-SPEC 1, board-reviewer.md 1** before
this entry. **Zero in code** — re-grepped across `*.ts/tsx/js/mjs/json`, 0 hits — so the ban
itself holds and the box stays correctly unticked; only the parenthetical is wrong. The
Notion archive changes nothing about a repo-grep box.

**STILL OPEN, carried forward:**

- **`/api/board` returns no `ayah` layer key at all.** Re-confirmed live: blocks with
  `layer == "ayah"` = **0**, layer set exactly `work, personal, ecom, home, homeschool`.
  Read the grep carefully — the literal string `ayah` **does** appear 9× in the payload,
  every one of them block *title* text (`Ayah Bedtime` ×7, `Ayah Playgroup` ×2), and all 9
  sit under **`nihal/home`**, none under any other layer; no non-title field contains it.
  So a future reader grepping for `ayah` will get hits and should not read them as a layer.
  The substance is unchanged: BOARD-SPEC lists Ayah under Nihal, the `/board` shell renders
  "Nihal · 4 layers", the API carries 3 (ecom 26, home 21, personal 13). Still needs
  deciding whether an empty layer should render as an onboarding placeholder.
- **Nihal has not been told the TV numbers went up** because `WeekProgressStrip` picked up
  canonical scoring. The change is live and unannounced.

**board-reviewer on this entry → 4 VIOLATIONS, 3 NOT MET; the entry was rewritten from
scratch before commit.** It caught: Notion-UI state stated flatly as though observed;
"no unique content lost" contradicted by the entry's own Mon–Sat vs Mon–Thu+Fri comparison;
6 blocks presented as corroborating 6 rows; an open item called CLOSED when only its
consequence had ended; the stale "3×" parenthetical; and two errors in the `ayah` line —
it attributed the 9 title hits to `nihal/home` **and** `nihal/personal` when all 9 are
`nihal/home`, and it "corrected" an earlier Findings line by quoting words that appear
nowhere in this file (the false "the string does not occur anywhere in the payload" was a
subagent's, never written here; the actual line at the OPEN entry above claims only that
the *layer key* is absent, which is true). **Third consecutive documentation commit where
the gate found false statements in already-checked prose.** The pattern is now the finding:
prose about verified things drifts from the verification faster than code does.

### 2026-07-26 — Retired source no longer read anywhere

**BOARD-SPEC.md:37 — "`588f40ab-4078-4767-982c-b50f9cd83f71` is RETIRED. Must not be read."
Now satisfied in the strong sense: the query is not issued at all.** Previously the source
was archived in Notion, which stopped retired *data* being served but left the read firing
and 404-ing on every request. That gap is closed.

**Changed — read on disk.** `time-allocation-board/netlify/functions/get-schedule.js`,
commit `a559daa`: the `{ key: "ansar-homeschool", dataSourceId: "588f40ab-…" }` element was
removed from the module-level `CATEGORIES` array, **8 entries → 7, with a 3-line comment
left in place of the removed element** — a substitution, not a bare deletion, and the diff
is `-1 / +3`. One of those comment lines asserts that canonical homeschool data now comes
from the Weekly Schedule via `/api/board`; that is true per this ledger's DATA SOURCES
section, but it is a comment, not something `a559daa` verified. No function was modified:
`queryDataSource()`, `mapPageToBlock()`, `plainText()` and `exports.handler` are all
generic, iterating `CATEGORIES`, so removing the element removes the read entirely.
`node --check` passes. The id was referenced in exactly **one** place in that repo's code.

**Scope of the zero-hit grep — this is one repo, not all of them.** `grep -rn "588f40ab"`
over the **`time-allocation-board`** working tree (excluding `.git`) now returns **zero**
hits. *Git history still contains it and always will — history is immutable; the claim is
about the working tree.* It does **not** discharge the still-unticked DATA SOURCES box at
the top of this file, which is about *this* repo: family-dashboard's working tree holds
**12** occurrences across 3 files — `BOARD-LEDGER.md` 10 (six added by the previous entry,
more by this one), `BOARD-SPEC.md` 1, `.claude/agents/board-reviewer.md` 1. All prose,
every one of them declaring the source retired. **Zero in code** — re-grepped across
`*.ts/tsx/js/mjs/json`, 0 hits. That box stays unticked and its stale "appears 3×"
parenthetical gets staler with each entry; see the housekeeping note in the preceding
Findings entry.

**Verified — fetched, not inferred.** `https://time-allocation-board.netlify.app/.netlify/
functions/get-schedule` after the deploy landed: **HTTP 200, 110 blocks, `errors: []`**.
The response's `categories` array now lists seven keys — `taylan-work, taylan-personal,
taylan-ecom, nihal-home, nihal-personal, nihal-ecom, ayah-homeschool` — with
`ansar-homeschool` absent. Neither the string `ansar-homeschool` nor `588f40ab` appears
anywhere in the response body. Note the difference from the previous reading: block count
is unchanged at 110 (it was already 110 once the source was trashed), but `errors` went
from one entry naming the Notion 404 to **empty**, because there is no longer a query to
fail. *That empty `errors` array is the actual evidence the read is gone — a 404 means it
was still being attempted.*

**Left in place deliberately, flagged not fixed.** `time-allocation-board/index.html:223`
still declares the display category `{ key:"ansar-homeschool", label:"Ansar · Homeschool",
short:"AH", color:"#eab308" }`. It is a legend entry, not a data-source read — it contains
no id and issues no query — so it does not bear on the BOARD-SPEC line. It is now an orphan
that would render a label with no blocks behind it, on a page that cannot be reached:
`https://time-allocation-board.netlify.app/` and `/index.html` both return **301** to
`https://kurgel-dashboard.netlify.app/board` (fetched this pass). Out of scope for a change
scoped to removing the read.

**Do not read that as "the site 301s every path" — it does not, and this entry originally
said it did.** `/.netlify/functions/get-schedule` returns **HTTP 200** — fetched this pass,
and it is the very URL used above to prove the fix landed. Netlify does not apply redirect
rules to `/.netlify/functions/*`, as recorded two entries above. The `netlify.toml` rule is
`from = "/*"`, `status = 301`, `force = true`, and its target is a **different host**, not a
same-site path. Page paths are unreachable; function paths are not.

**Not re-verified this pass:** the `/*` → `/board` 301 and `/api/board` were not re-fetched
after this deploy. The change touches only one array element in one function and cannot
affect either, but that is reasoning, not a measurement — recorded as such rather than
asserted.

**board-reviewer on this entry → 2 VIOLATIONS, 1 NOT MET; all three fixed before commit.**
(a) "on a page nobody can reach: that site 301s every path to `/board`" — false, and
falsified by the entry's own evidence: the function URL fetched nine lines earlier returns
200, and this ledger already explains twice that Netlify exempts `/.netlify/functions/*`
from redirect rules. The narrow claim (index.html unreachable) is true; the universal was
not. (b) The zero-hit grep was run in `time-allocation-board` but written unqualified as
"the working tree … every file", which reads as discharging the DATA SOURCES box in *this*
repo — where the id in fact appears 12 times in prose. Now scoped and reconciled.
(c) "Nothing else was touched" described `a559daa` as a pure deletion; it is `-1 / +3`, a
substitution leaving a 3-line comment. **Fourth consecutive commit where every number and
every fetched fact was sound and the failures were all in the connective prose.** The
lesson has stopped being incidental: on this work, the sentence joining two verified facts
is less reliable than either fact, and it is where review time should go.
