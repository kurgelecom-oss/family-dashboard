# RESTRUCTURE-LEDGER.md

## 2026-08-25 — Prompt 1 — discovery

Read-only inventory. No code changes. Every path read from the repo this session.

### 1. app/ route tree

Page routes:
- `/` — `app/page.tsx`
- `/board` — `app/board/page.tsx`
- `/budget` — `app/budget/page.tsx`
- `/origins` — `app/origins/page.tsx`
- `/week` — `app/week/page.tsx`
- (static, not a Next route: `public/profit.html`)

API routes (all `route.ts`):
- `/api/actions` — `app/api/actions/route.ts`
- `/api/board` — `app/api/board/route.ts`
- `/api/budget/summary` — `app/api/budget/summary/route.ts`
- `/api/budget/upload` — `app/api/budget/upload/route.ts`
- `/api/calendar` — `app/api/calendar/route.ts`
- `/api/cycle` — `app/api/cycle/route.ts`
- `/api/dashboard-settings` — `app/api/dashboard-settings/route.ts`
- `/api/ecom-products` — `app/api/ecom-products/route.ts`
- `/api/ecom/product` — `app/api/ecom/product/route.ts`
- `/api/ecom` — `app/api/ecom/route.ts`
- `/api/habits` — `app/api/habits/route.ts`
- `/api/homeschool` — `app/api/homeschool/route.ts`
- `/api/incident` — `app/api/incident/route.ts`
- `/api/income/sync` — `app/api/income/sync/route.ts`
- `/api/mission` — `app/api/mission/route.ts`
- `/api/net-position` — `app/api/net-position/route.ts`
- `/api/origins-review` — `app/api/origins-review/route.ts`
- `/api/origins/complete` — `app/api/origins/complete/route.ts`
- `/api/origins` — `app/api/origins/route.ts`
- `/api/origins/rows` — `app/api/origins/rows/route.ts`
- `/api/pl-data` — `app/api/pl-data/route.ts`
- `/api/pocketsmith` — `app/api/pocketsmith/route.ts`
- `/api/schedule` — `app/api/schedule/route.ts`
- `/api/settings` — `app/api/settings/route.ts`
- `/api/shopify-actuals` — `app/api/shopify-actuals/route.ts`
- `/api/shopify` — `app/api/shopify/route.ts`
- `/api/todos` — `app/api/todos/route.ts`
- `/api/weekly-review` — `app/api/weekly-review/route.ts`

### 2. The dashboard face

`app/page.tsx` renders the 4-column grid. It is a **client component** (`"use client"` line 1) — but it holds no data; every panel fetches for itself. Column order:

1. Column A — `PanelFinance` (`app/components/PanelFinance.tsx`)
2. Column B — `PanelEcom` (`app/components/PanelEcom.tsx`)
3. Column C — `PanelTodos` (`app/components/PanelTodos.tsx`) — renders Family Goals + The Clock
4. Column D — `PanelCalendar` + `PanelHomeschoolWeek` + `PanelHabits` (`app/components/PanelCalendar.tsx`, `PanelHomeschoolWeek.tsx`, `PanelHabits.tsx`)

Also on the face: `GoalsIntermission` (`app/components/GoalsIntermission.tsx`, the "/" pop-up deck) and `Header` (`app/components/Header.tsx`). `TopNav` renders globally from `app/layout.tsx`.

### 3. Panels → routes → external sources

| Panel | Reads | External source |
|---|---|---|
| PanelFinance | `/api/pocketsmith` | PocketSmith (`api.pocketsmith.com/v2`, `POCKETSMITH_KEY`); route also reads Notion source `dee4b811…` |
| PanelEcom | `/api/ecom` | PocketSmith + Launchpad (`product-test-engine.netlify.app/api`) |
| PanelTodos (Clock) | `/api/actions` | Notion Action Items DS `38e5429a-fa90-8035-8b09-000b2e78cdc3` + Launchpad + Notion settings |
| PanelTodos (Family Goals) | Launchpad **direct from the browser** (`LAUNCHPAD_API/tests`, `/entries`) | Launchpad (CORS `*`); targets in localStorage |
| PanelCalendar | `/api/calendar`, `/api/weekly-review?weeks=26` | MS Graph (`graph.microsoft.com/v1.0/me/calendarView`, 3 Hotmail refresh tokens); weekly-review hits Notion `005a35a4…` |
| PanelHabits | `/api/habits`, `/api/settings`, **Supabase directly** (`habit_completions` via `app/lib/supabase.ts`, anon key) | Notion habit blocks `470a7eba…`; Notion settings; Supabase |
| PanelHomeschoolWeek | `/api/schedule` | Notion (`NOTION_SCHEDULE_DB_ID` env) |
| GoalsIntermission | `/api/dashboard-settings`, `/api/mission`, `/api/cycle` | Notion (mission: 4 sources incl. `4431302a…`, `22f0eed5…`); Supabase (cycle) |
| Header | none (clock + theme only) | — |
| TopNav | `/api/incident`, `/api/cycle` | Tally (`TALLY_API_TOKEN`), Supabase |

### 4. Data refresh today

**No shared loader — every panel fetches independently on its own `setInterval`:**
- PanelFinance: 10 min (`REFRESH_MS`, PanelFinance.tsx:59)
- PanelEcom: 5 min (PanelEcom.tsx:92)
- PanelTodos: 5 min for both `/api/actions` and the Launchpad profit read (PanelTodos.tsx:81)
- PanelCalendar: 60 min fetch + 60 s upcoming-event check (PanelCalendar.tsx:280–294)
- PanelHabits: **10 s** (PanelHabits.tsx:197); WeekProgressStrip 60 s
- PanelHomeschoolWeek: 60 s
- GoalsIntermission mission read: 15 min
- Header: theme check 60 s, clock 1 s
- /board: 5 min, matching the route's 300 s cache

### 5. Header NIGHT / AUTO / LIVE

All in `app/components/Header.tsx`, state client-side only:
- **NIGHT/DAY button** — toggles theme, writes `themeOverride` to localStorage, sets `data-theme` on `<html>`.
- **AUTO button** — only visible while a manual override exists; removes `themeOverride` and reverts to the automatic rule: Sydney hour ≥ 17 → night, else day (via `Intl.DateTimeFormat`, `Australia/Sydney`). A 60 s interval re-applies auto theme when no override is stored.
- **LIVE** — a static badge (`.live-badge`), toggles nothing, no state.

### 6. The goals panel

File: `app/components/PanelTodos.tsx` (Column C). Two sub-panels in one file:
- **Family Goals** (`FamilyGoalsPanel`) — 5 goals (Docklands, Trip, Crown, Night out, Spree). Targets + `people` + `rewardSplitPct` stored in **localStorage key `familyGoals.v1`** via `useSyncExternalStore` (readGoals/writeGoals/subscribeGoals). There is **no saved-pot value stored anywhere**: the pot is computed live as cumulative Launchpad contribution profit × `rewardSplitPct` (`useBusinessProfit`, browser → Launchpad direct). Spree target = $250 × people, computed. Night out is behaviour-linked (earned by a genuine Launchpad test), no dollar target.
- **The Clock** (`ClockPanel`) — props `{ data, settings }` where `data` is the full `/api/actions` payload; it reads `data.clock`: `daysLeftInWeek`, `daysLeftInMonth`, `daysToTractionEnd`, `yearElapsedPct`, `tests {completed, target, daysSinceLastCompleted, everCompleted}`. `/api/actions` sources: Notion Action Items `38e5429a…`, Launchpad API, Notion settings (thresholds `TEST_GAP_AMBER_DAYS`/`TEST_GAP_RED_DAYS`).

Note: `app/components/PanelGoals.tsx` is a **separate, orphaned** goal-cards panel (hardcoded revenue goals, Shopify actuals) — imported nowhere.

### 7. The /board route

`app/board/page.tsx`, client component. Pattern:
- One fetch to `/api/board` (`?refresh=1` to force) in a `useCallback` load fn; `setInterval` 300 s matching the route's 300 s cache; typed via `import type { BoardPayload } from "../api/board/route"` so client and route can't drift.
- Layout: full-viewport `--bg-base` page, person selector (Taylan/Nihal/Ansar with per-person layers), week grid Mon–Sun, `WeekProgressStrip` at top. Sized with `--nav-h`/`--strip-h` inline (see CLAUDE.md).
- Nav back to face: **no in-page back link** — navigation is via the global `TopNav` (layout.tsx), whose links are absolute URLs to `kurgel-dashboard.netlify.app`. The only external link in the page body is "Edit in Notion".

### 8. app/lib/notion.ts + token test

`fetchSource(id: string, label: string): Promise<NotionPage[]>` — POST `https://api.notion.com/v1/data_sources/{id}/query`, bearer `process.env.NOTION_TOKEN`, `Notion-Version: 2025-09-03` (from `NOTION_VERSION` in `app/lib/settings.ts`), page size 100, max 10 pages, 10 s abort per request, throws on bound.

All Notion collection IDs in `app/`:
- `38e5429a-fa90-8035-8b09-000b2e78cdc3` — actions (Action Items)
- `4431302a-75ed-479f-a5f4-3bfd5e0a4e68` — mission (Daily Discussion Points)
- `22f0eed5-7556-4758-b171-328d273485f3` — mission (Mission Goals)
- `1d35429a-fa90-81a0-bf47-000b7fe8803d` — mission + ecom-products
- `89bc2000-11da-4bcf-bc4b-ef37c7359abe` — mission
- `2b062576…`, `52767310…`, `63550d99…`, `7e90f275…`, `a2d13dcd…`, `cd0e72dd…`, `dc07abb4…`, `e959c33a…` — board (8 layers)
- `470a7eba-f14b-42c5-92fb-79a006720240` — habits
- `3f93b40d-6cdc-44dc-9197-779758f9150c` — homeschool
- `3a3a6e65-2cb3-40ba-810a-b19406e8b085` — origins + origins-review
- `dee4b811-58b5-4900-81e5-ff94a28be925` — pocketsmith route
- `0415a499-d4ee-49e8-baf6-a3f38ec27235` — api/settings
- `f62fb9fd-cb43-440d-9994-ad349afd64de` — lib/settings (`SETTINGS_DATA_SOURCE_ID`)
- `005a35a4-c292-45ee-a563-94646cdd7b75` — weekly-review
- env-driven: `NOTION_SCHEDULE_DB_ID` (schedule), `NOTION_DATA_SOURCE_ID` (todos)

**Token test:** POST query on `4431302a-75ed-479f-a5f4-3bfd5e0a4e68` with `NOTION_TOKEN` from `.env.local` → **HTTP 200, 1 result returned. Read works.** (Write not attempted.)

### 9. globals.css tokens

Dark (default) theme, `app/globals.css`:
- `--bg-base #1e2140` · `--bg-card #252a4a` · `--bg-inner #1e2140` · `--border rgba(255,255,255,0.06)`
- `--text-primary #ffffff` · `--text-secondary #8b92b8` · `--text-muted #5a6080` · `--text-label #8b92b8`
- `--cyan #00d4ff` · `--amber #f5a623` · `--green #2ecc71` · `--red #e74c3c`
- `--origins-build #ff7a1a` · `--origins-onpace-text #4a5070` · `--progress-track rgba(255,255,255,0.1)` · `--card-shadow none`
- `--bg-panel #252a4a` · `--bg-panel-inner #1e2140` · `--bg-highlight #2e3249`
- `--accent-habits/-ecom/-budget/-goals/-calendar` all `#00d4ff`
- Board type tokens: `--type-work #5b9dff`, `--type-personal #b57bff`, `--type-ecom #00d4ff`, `--type-home #2ecc71`, `--type-ayah #ff6ec7`, `--type-homeschool #f5a623`, `--type-routine #f5a623`, `--type-learning #5b9dff`, `--type-meal #2ecc71`, `--type-screen #ff7a5c` (each with a `-bg` rgba variant)
- Day theme (`[data-theme="day"]`, from line 107) overrides the same names (`--cyan` becomes `#0099e6`, etc.)

Currency formatting: **no shared helper.** `fmtExact()` exists only in orphaned `PanelGoals.tsx`; live panels inline `toLocaleString("en-AU")`. The zero-currency rule is a convention enforced by comments in PanelTodos ("this column renders ZERO currency in its panel bodies") — no code helper.

### 10. netlify.toml and _redirects

`netlify.toml`:
```toml
[build]
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```
`_redirects`: **does not exist** — not in repo root, not in `public/`.

### 11. Files containing "goals"/"reward" outside PanelTodos.tsx

- `app/components/PanelGoals.tsx` — orphaned revenue-goal cards panel (unreferenced)
- `app/components/GoalsIntermission.tsx` — "/" pressure-deck overlay; reward line comes from `/api/mission`
- `app/page.tsx` — imports/renders `GoalsIntermission`
- `app/api/mission/route.ts` — `Goal`/`GoalsPayload` types, Mission Goals source `22f0eed5…`
- `app/lib/settings.ts` — comment referencing the goals intermission overlay timing

### Not proven / notes for later prompts

- Notion **write** to `4431302a…` not attempted (spec's only write lands in a later prompt; test with a throwaway row then).
- `/api/net-position`, `/api/shopify`, `/api/budget/*`, `/api/todos`, `/api/homeschool` sources listed but internals not read line-by-line this session.
- The face is a client shell with per-panel fetching — "one data load on the face" (spec §2) does not exist yet; it must be built.

## 2026-08-25 — Prompt 2 — drill-down routes

Built `/money`, `/business`, `/table` (new) and extended `/board`. All four copy the /board route pattern (client page, own load fn + interval, full-viewport scroll container under nav + strip), carry a back link to `/` and a Sydney date/time via Intl, and use 48px-minimum touch targets. `npx tsc --noEmit` and `npm run build` pass; all four routes present in the build manifest.

### Files touched

- `app/components/DrillChrome.tsx` — NEW: shared back link + Sydney clock + drill-down header row.
- `app/money/page.tsx` — NEW: period toggle Week · Month · 3 months (default Week); Earned/Spent(+tx count, change vs prior)/Saved tiles; Categories tile (bars, Uncategorised amber, tap → PocketSmith transaction search URL for category+period); Accounts tile (negatives red, hairline, cyan total, tap → PocketSmith account summary); Rewards tile (five goals with $ and %, Edit targets, editable saved pot). Rewards reuses PanelTodos's exported store/allocate/useBusinessProfit — the goals logic was not rewritten.
- `app/api/pocketsmith/route.ts` — ADDITIVE: `lastQuarter`/`previousQuarter` PeriodSummary (last 3 complete calendar months + prior 3). Nothing above the new fields changed; HEAD comparison build confirms the route's ƒ rendering mode is unchanged.
- `app/components/PanelTodos.tsx` — one-word change: `export` on `writeGoals` so /money edits targets through the same `familyGoals.v1` store. No other line touched.
- `app/business/page.tsx` — NEW: campaign pill (amber when none live); active test tile (name/day/last entry/days silent/Stale·Running, Open in Launchpad, Open in calculator `/profit.html?test=<uuid>`, spend-vs-window bar with floor marker, ROAS red under breakeven, Breakeven, Next gate, entry log newest-first scrolling); selector only when >1 running test; P&L tile (Revenue, COGS + unverified flag, Ad spend settled, hairline, Contribution); product tests tile (`N of 3`, days since go-live, queue = Launchpad Setup-status tests that never spent — excludes the backtest fixture, which has `first_spend_at`).
- `public/profit.html` — ADDITIVE: `?test=<uuid>` deep link prefills the UUID, switches Auto pills on, triggers the existing load. No existing function changed.
- `app/api/table/route.ts` — NEW GET: open decisions (oldest first), closed-since-yesterday, Monthly milestone from Mission Goals, Launchpad test summary. force-dynamic/no-store.
- `app/api/table/close/route.ts` — NEW POST: the restructure's only write. PATCHes the Notion row: `Outcome` rich_text = `"<text> — closed YYYY-MM-DD"` (Sydney) and `Status` → `Closed`. Built and typechecked only; NOT exercised against any row.
- `app/table/page.tsx` — NEW: owner filter All·T·N, Raise item (link to the Notion database — raising stays a Notion edit; Close is the only API write), Start-here panel (headline rules 1–4 as questions, first match wins), decision rows (question form, owner, purple day count, purple left border at 7+ days, expanded Closed-when + outcome input + Close), closed-since-yesterday tile (exact fallback text `Nothing was closed yesterday.`), clock tile (week days, traction days, year %, tests N of 3) fed by `/api/actions`.
- `app/api/calendar/route.ts` — ADDITIVE: `webLink` in `$select` and payload, so calendar-band blocks can open the event.
- `app/components/CalendarBand.tsx` — NEW: person × (Today · Tomorrow) grid, Sydney days via Intl, coloured left borders, `—` empty cells, tap → event webLink.
- `app/components/AnsarStrip.tsx` — NEW: purple day streak, points today, week / 55 (WEEKLY_MAX imported from scoring.ts), progress bar, `Open his dashboard` link. Scoring/streak imported from the canonical libs, never copied or edited.
- `app/board/page.tsx` — bands region inserted ABOVE the existing header: back link + Sydney clock row, CalendarBand, AnsarStrip. Everything from the existing header down is untouched; BOARD-SPEC content unchanged.

### Decisions taken (report if wrong)

- **Closed date lives inside Outcome.** The live Daily Discussion Points schema (read back this session) has NO closed-date property and NO "Closed when" property — only Point/Owner/Pillar/Type/Raised/Status/Outcome. Close therefore stamps `— closed YYYY-MM-DD` into Outcome and flips Status to Closed; /api/table parses the stamp back (falls back to last_edited_time in Sydney). "Closed when:" renders `— not set in Notion` until the property exists.
- **Saved-pot override is a sibling localStorage key** `familyGoals.savedPot.v1`, not a field inside `familyGoals.v1`: the face's normalise-on-write emits only targets/people/rewardSplitPct and would silently drop an extra field. Computed pot (profit × split) stays the default; override is explicit and clearable.
- **"Validated-not-run" queue** = Launchpad tests with status `Setup` and `first_spend_at` null (the permanent backtest fixture has `first_spend_at`, so it self-excludes). `validated` is null on every live record, so status is the only signal.
- **Open in Launchpad** links to the site root — no per-test deep-link format is known for the Launchpad frontend.
- **3 months** = last three complete calendar months (ends where Last Month ends), prior three as comparison.

### Not proven

- The Close write has NOT been exercised against any Notion row (per spec: throwaway-row test happens in the separate verification step). Property names `Outcome`/`Status` are confirmed against the live schema; the write path itself is typechecked only.
- `?test=` prefill in profit.html not exercised in a browser this session.
- Layout at 1905x923 / 1920x936 / 1920x1080 and 390px not browser-measured — production verification step. No `getBoundingClientRect` claims made.
- PocketSmith deep-link URL shapes (`/transactions/search?search[...]`, `/transactions/uncategorised`, `/account_summary`) taken from PocketSmith's own deep-link generator this session; not clicked through to a logged-in session.
- `/api/table` GET not exercised against production Notion this session (reads only; token read against 4431302a… verified in Prompt 1).

### Fix 1 — 2026-08-25 — tiles onto the height-tier system

The verifier's layout check failed: tile surpluses on /money, /business, /table were ~1px and identical at 936/923/1080 — the inline `tileStyle` object opted every tile out of height responsiveness (the CLAUDE.md inline-padding failure, on new class). Fix: NEW `.drill-tile` class + `::after` tail-room + two new `@media (max-height)` tiers appended to the END of `globals.css` (after every existing rule; no existing `.card` rule, token, or tier touched). All three pages now use `className="drill-tile"`; the inline `tileStyle` objects are deleted, and no tile carries inline padding/gap.

Files: `app/globals.css` (append only), `app/money/page.tsx`, `app/business/page.tsx`, `app/table/page.tsx`.

Measured locally (`npm run build` + `next start`, headless Chromium, per tile: lastRow.bottom vs tile content-box bottom): minimum surplus **33px at 1920x936 and 1905x923, 37px at 1920x1080** on every tile of all three routes; pageScroll=0 at all heights; 0px horizontal excess at 390px (document and inner scroller). /money's populated tiles proven with a synthetic in-browser `/api/pocketsmith` intercept (local upstream reads fail in this environment; production reads untouched); its live-data render re-proves on the production verify. Surpluses now differ across heights (33 vs 37) — the tiles demonstrably sit on the tier system. `npx tsc --noEmit` and `npm run build` pass.

Not proven: production state (re-verify after deploy); /business entry-log internal scroll untouched by design.

## 2026-08-25 — Prompt 3 — the face

`/` now renders the three rotating frames (spec §3). Old 4-column grid removed from `app/page.tsx`; the panel components themselves are untouched and still render on their routes. GoalsIntermission, TopNav untouched. Header gained one optional render-slot prop (caller decision, below); its NIGHT/AUTO/LIVE and theme logic are byte-identical.

### Files touched

- `app/components/face/useFaceData.ts` — NEW: the ONE data load. Per-source intervals keep the existing cadences (pocketsmith 10 m, ecom 5 m, actions 5 m, table 5 m, calendar 60 m, habits/Supabase 60 s = AnsarStrip's); frames never fetch. Also `buildFaceModel` (headline rules 1–4 first-match-wins, next gate mirroring /business, test word Stale/Running/None, tomorrow-by-person, traction fill go-live→traction-end) and `fmtMoney` ($0.00 → null, value hidden). Habits streak/today% import the canonical libs (streak.ts; today% = PanelHabits.tsx:220 roster rule) — scoring/streak/gating not touched.
- `app/components/face/FaceRotator.tsx` — NEW: `DWELL_MS = [10_000, 15_000, 25_000]` (the only dwell constant), hard-cut conditional render, `?view=1|2|3` freeze via location.search (no useSearchParams → no Suspense), visibilitychange pause/resume-at-1, touch-on-anchor navigates / any-other-touch 60 s pause then frame 1. Renders `<Header frameCounter={n/3}>` itself (Header sits outside the pointerdown surface, exactly as when page.tsx rendered it) with only the 2 px progress line beneath.
- `app/components/face/FaceFrameSentence.tsx`, `FaceFrameNumbers.tsx`, `FaceFrameLanes.tsx` — NEW: frames 1–3 per §3; heroes/lanes are `.drill-tile` anchors (no inline padding; height tiers apply); links Week→/money, Test→/business, Table→/table, Ansar→ansar-habits-tracker.netlify.app, Family lane→/board; chips ≥48px.
- `app/components/Header.tsx` — optional `frameCounter?: ReactNode` render-slot in the right cluster, after date · time (spec §3: header right = date · time · counter). Purely additive: theme/NIGHT/AUTO/LIVE and clock logic untouched; DrillChrome and every non-rotating route pass nothing and render exactly as before.
- `app/page.tsx` — face rewritten to GoalsIntermission + FaceRotator (Header renders inside FaceRotator so its right cluster carries the counter); same route.
- `app/globals.css` — `.face-*` rules APPENDED after the `.drill-tile` tiers (no existing rule or token touched); all colours are theme tokens so NIGHT dims frames by construction; 768/480 px collapse; height-tier trims at 1000/950.

### Decisions taken (report if wrong)

- Counter placement (caller-corrected): the `n/3` counter rides IN the Header's right cluster next to date · time via the `frameCounter` render slot; only the 2 px progress line sits under the header. The earlier strip-under-header counter is removed. Header stays mounted across all three frames (theme/clock state persists); counter appears only on the face.
- Stale = no running test with entries, OR a Live/Iterating test unfed past TEST_STALE_RED_DAYS; headline rule 1 then uses the matching N. Never-any-entry falls through to rules 3/4 (rule 1's sentence needs an N).
- Rule-2 headline with a $0-spend running test says "is yet to spend into the $X window" — no $0 on the face.
- Traction bar fill = elapsed LAUNCHPAD_GO_LIVE_DATE → tractionEndDate (clock exposes no period start).
- Ansar purple = `#a78bfa` (AnsarStrip's constant), not a new token.

### Measured (local prod build, headless Chromium, synthetic API intercepts + one real-data run)

- 1920x936 / 1905x923 / 1920x1080 × view=1|2|3: page scroll 0/0; min `.drill-tile` surplus 33 px @936/923, 37 px @1080; no `$0` anywhere; counter freezes 1/3·2/3·3/3; headline rule 2 correct on synthetic data, rule 1 correct on real data ("No test is running. Last entry was 48 days ago.").
- Rotation: counter 1→2→3 at the 10 s/15 s dwells, progress line advances, API counts stayed at ONE fetch per route across the whole loop (no refetch between frames).
- Touch pause: pointerdown on non-anchor stops the animation and holds the frame past its dwell.
- 390 px: 0 horizontal excess at all three views (frames scroll internally below 480 px).
- Counter-in-header re-measure (1920x936, view=1|2|3): `.face-counter` is inside `.header-right`, DOM order date → time → counter, within the header's bounds; frame digit computed `rgb(0, 212, 255)` (= `#00d4ff`); subheader holds ONLY the 2 px progress line; page scroll 0/0; min `.drill-tile` surplus 33 px (frame 1 has no `.drill-tile`); no `$0`; counter advances 1/3 → 2/3 past the 10 s dwell; `/money` `/business` `/table` `/week` `/board` HTML contains no `.face-counter`.

### Not proven

- Production state — deploy + prod verify pending (this prompt did not deploy).
- 60 s touch-pause RESUME and visibilitychange pause/resume: code-reviewed only (not browser-timed).
- Night-mode dim: by token construction only; not visually asserted this session.
- PocketSmith values on the face: local upstream fails in this environment (rows rendered "—"); populated render proven with synthetic intercept only.

### Fix 1 — 2026-08-25 — frame 2 clearance floor

Prod verify found frame 2's last leaf (inside `.face-tomorrow`, bottom-pinned by `.face-spacer`) clearing the viewport by only 20.3px at 923/936 — under the 25px floor. Fix: one appended rule at the very end of `globals.css` — `.face-tomorrow { margin-bottom: 12px; }` — the flex spacer absorbs the lift, so no overflow and frames 1/3 are byte-untouched (`.face-tomorrow` renders only in frame 2); no touch target or content changed. Measured locally (prod build, headless Chromium, the verifier's leaf set `.face-context`/`.face-tomorrow-traction`/`.face-row-value`, at 1920x936 · 1905x923 · 1920x1080): view=2 clearance 18.3px before → **30.3px after** at all three heights; view=3 326.6px and page scroll 0/0 at every size/view, both unchanged. `npx tsc --noEmit` and `npm run build` pass. Not proven: production re-verify pending; view=1's local clearance reads 23.8px both before AND after (pre-existing, unchanged by this fix — local data renders chips unpopulated; the prod check passed frame 1 with live data).

### Fix 2 — 2026-08-25 — frame 1 clearance floor

Prod verify (attempt 2) found frame 1's lowest leaf (`.face-chip-value`, chip row bottom-pinned by `.face-spacer`) clearing the viewport by only 19.0px at 936/923 and exactly 25.0px at 1080. Same shape as Fix 1: one rule appended at the very end of `globals.css` — `.face-chiprow { margin-bottom: 16px; }` — the spacer absorbs the lift; `.face-chiprow` renders only in frame 1 (grep-verified), so frames 2/3 are byte-untouched; no content removed, no touch target changed. Measured locally (prod build, headless Chromium, lowest text-bearing leaf vs viewport bottom): view=1 clearance **35.0px @1920x936, 35.0px @1905x923, 41.0px @1920x1080**; chips one row (4 equal tops), min chip height 59.0px (≥48); page scroll 0/0 everywhere; no `$0.00`. Spot checks unchanged: view=2 32.3/32.3/38.3px, view=3 539.6/526.6/641.6px. Local pocketsmith reads fail, so view=1 was re-measured with a synthetic `/api/pocketsmith` intercept (Week chip rendered `$1,235`): clearances identical to the unpopulated run. `npx tsc --noEmit` and `npm run build` pass. Not proven: production re-verify pending (this fix did not deploy); prod-expected clearance ≈ 19+16 = 35px at 936/923, matching the local read.

### Fix 3 — 2026-08-25 — structural clearance floor (supersedes Fix 1 + Fix 2)

Prod run B proved margin lifts don't survive live data: content growth (headline wrap, tomorrow-strip volume) collapses `.face-spacer` and slides the bottom-pinned row toward the viewport edge — a margin on the last element does not bound its bottom. Structural fix instead: (1) `.face-frame` — already a fixed-height box via `.dashboard`'s `calc(100vh − nav − strip)` chain (border-box, `min-height:0`/`overflow:hidden` at every link) — gets `padding-bottom: 32px` appended at the END of `globals.css`, so the spacer pins the last element to the content-box bottom ≥ 32px + dashboard padding above the viewport, at any data volume; Fix 1/Fix 2 margins zeroed by later rules. (2) Every variable region bounded so content can never exceed the box: `.face-headline` clamps at 3 whole lines, `.face-headline-muted` and `.face-nextaction` at 2 (`-webkit-line-clamp`, ellipsis, never a half-clipped line; nextaction's 6px vertical padding moved to margin so the clamp can't expose a clipped sliver); tomorrow strip capped in `FaceFrameNumbers.tsx` at 2 events/person + "+n more" per person (whole events dropped, never clipped — with the 320px subject cap that bounds the strip ≤3 wrapped rows at ≥1905px). Bonus hardening the stress run surfaced: an unparseable `startISO` crashed the whole face inside `SYD_DAY.format` — `useFaceData.ts` now drops such events. Dwell/rotation/header/counter logic untouched.

Files: `app/globals.css` (append-only), `app/components/face/FaceFrameNumbers.tsx`, `app/components/face/useFaceData.ts`.

Measured (local prod build, headless Chromium, lowest rendered leaf in `.face-main` vs viewport, 3 sizes × 3 views × {real data, stress A: running test with 150-char name → long rule-2 headline + 15 tomorrow events (5/person, 130-char subjects) + 6 long-title decisions, stress B: stale test → long next-action title}): worst stressed clearance **view=1 49.0px, view=2 47.0px, view=3 304.2px at ALL of 1920x936 / 1905x923 / 1920x1080** — identical between real and both stress payloads, i.e. the floor is data-invariant. Page scroll 0/0 everywhere; chips one row, min 59px; tomorrow strip `scrollHeight == clientHeight` (no clipped row), "+3 more" markers render; no `$0.00`; 390px 0 horizontal excess. `npx tsc --noEmit` (exit 0) and `npm run build` pass.

Not proven: production re-verify pending (not deployed, not committed this task); night-mode dim unchanged by construction only; the 49/47px floor assumes the deployed CSS chain (`--nav-h`/`--strip-h`) is unchanged in prod.

## 2026-08-25 — Prompt 4 — Column C

Goals panel removed (spec §5). `app/components/PanelTodos.tsx` is the only file touched (678-line diff, 35 in / 643 out): `FamilyGoalsPanel` and its UI-only helpers (STATE_META, quest-log decoration block, EditRow/numberInput) deleted; the goals STORE survives in place, byte-compatible — `readGoals`/`readGoalsServer`/`writeGoals`/`subscribeGoals`, `allocate`, `useBusinessProfit`, `sydneyStamp`, key `familyGoals.v1` unchanged — so `/money` (store) and `GoalsIntermission` (`sydneyStamp`) keep their imports with zero churn. `ClockPanel` is byte-identical (one stale comment line about the removed panel trimmed); the default `PanelTodos` export now renders ONLY the Clock (same ShellCard error/loading degradation).

Where the Clock renders now: the ClockPanel COMPONENT is mounted nowhere — no route imports the default export since the face rewrite (grep-verified; acceptable per the prompt). The Clock's DATA (`/api/actions` → `data.clock`) feeds the face's traction bar and Family-lane Traction row via `useFaceData`, and `/table`'s clock tile — `/api/actions` untouched. `PanelGoals.tsx` untouched per instruction.

Verified (local prod build, headless Chromium 1920x936): `npx tsc --noEmit` + `npm run build` pass; `/?view=1|2|3`, `/table`, `/money` all render, no `$0.00`, no console error from this change (only the known local PocketSmith 401 → `/api/pocketsmith`//`/api/incident` 500s, pre-existing — diff is one client component). `/money` Rewards tile store proven live: Edit targets → Docklands input write produced `{"targets":{"docklands":4321,…},"people":4,"rewardSplitPct":100}` in `familyGoals.v1`; savedPot sibling key also written; both throwaway values removed after.

Not proven: production state (not deployed this prompt); `/money` populated PocketSmith render (local upstream 401, per prior entries).

## 2026-08-26 — Prompt 5 — face full-bleed redesign

Owner verdict on the shipped frames: far too much blank space (thin headline + dead middles). Two sample directions built by restyling the real local prod build with REAL production API payloads (six `/api/*` bodies fetched from kurgel-dashboard.netlify.app and route-intercepted) and screenshotted at a true 1920x936 viewport — `~/Downloads/face-redesign-{A,B}-frame{1,2,3}.png` (kept). Direction A was implemented first; **the owner then picked Direction B's frame-3 style mid-task** ("i like this … apply to all the 3 but make them unique to their own and not identical layout or structure") — accent bar across the card top, giant hero, muted context, hairline, ~3 label/value rows — so the A block was replaced with the final B-language block before anything was committed. Implemented silhouettes:

- **Frame 1 · sentence-led**: ONE wide cyan-topped card filling the frame — 76px headline (whole-line clamp 2 at ≥1280px), 30px next-action inset on `--bg-base`, traction bar (14px track) pinned to the card bottom — over a full-width band of four accent-topped mini-cards (label · 60px value · context; cyan/amber/text-primary/#a78bfa).
- **Frame 2 · four accent-topped hero columns** (same order/accents): 80px hero + context; Week and Test also carry hairline + three info rows (Month/Balance/Saved · Campaigns/Next gate/Tests), Table and Ansar centre their hero block (`face-hero--fill`); tomorrow band full-width below, events as `--bg-base` pills, traction days at right.
- **Frame 3 · the approved sample**: three accent-topped lanes (Money cyan · Business amber · Family #a78bfa), 120px hero, context, hairline, three 56px rows.

### Files touched

- `app/globals.css` — APPEND-ONLY: the working-tree Direction A block replaced by one final `@media (min-width: 1280px)` block after every committed rule (equal-specificity ties resolve to it; base rules keep the 390px collapse; every colour a theme token except the established Ansar purple `#a78bfa`, so NIGHT dims by construction). Key structural rules: `.face-sentence-card` and `.face-herorow` take `flex: 999 1 0` so the base `.face-spacer { flex: 1 }` collapses to ~0 — without this the spacer split the free space 50/50 and clipped 17–61px of hero rows; frame-1 headline clamp tightens 3 → 2 lines at ≥1280px only (whole-line ellipsis; base clamp 3 holds below).
- `app/components/face/FaceFrameSentence.tsx` — headline/next-action/traction wrapped in `.face-sentence-card` (unstyled below 1280px). DOM otherwise unchanged.
- `app/components/face/FaceFrameNumbers.tsx` — `Hero` gains optional `rows` (hairline + `face-row`s, Week/Test only) and `face-hero--fill` when rows are absent; local `Row` helper added. Model, links, per-person event caps unchanged.
- `FaceFrameLanes.tsx`, `FaceRotator.tsx`, `useFaceData.ts`, `Header.tsx` — untouched; mechanics (dwell array, `?view` freeze, visibilitychange, touch-pause, counter, one shared load, Fix-3 32px floor) untouched.

### Discovery worth keeping

- Playwright `browser.newPage({ viewportSize })` is silently ignored — the option is `viewport`. Prior scratchpad scripts (`measure-fix3.mjs` etc.) used `viewportSize`, so their "3 sizes" all actually measured 1280x720. This session's numbers use `viewport` (verified `window.innerWidth === 1920`).
- `.face-spacer { flex: 1 }` competes with any other `flex: 1` sibling for the frame's free space — a full-height band beside it must out-grow it (`flex: 999 1 0`) or the band gets half the slack and its content clips.

### Measured (local prod build, headless Chromium, {real prod payloads, stressA long-headline + 15 events, stressB long next-action} × 1920x936 · 1905x923 · 1920x1080 × view 1|2|3)

- Lowest text-leaf clearance (936/923 · 1080): frame 1 **59 · 65px** (identical real and both stresses); frame 2 real **71 · 77px**, stressed **67.5 · 73.5px**; frame 3 **74.5 · 80.5px**. All ≥25.
- Fill: lowest content edge (card boxes) clears the viewport by **38px** at 936/923 and 44px at 1080 in every cell — inside the bottom 15% band, no dead lower half.
- Interior clipping probe (`scrollHeight/Width` on sentence-card, chips, heroes, lanes, frame): clean in all 9 mode×view cells at 1905x923.
- Page scroll 0/0 everywhere; no `$0.00`; chips one row, min chip height 193px (≥48); tomorrow strip unclipped; 390x844 horizontal excess 0. `npx tsc --noEmit` and `npm run build` pass.
- Both themes rendered and eyeballed (screenshots): NIGHT via `themeOverride` — `~/Downloads/face-final-frame{1,2,3}.png` (1920x936, real prod payloads replayed against the local build); DAY copies in the session scratchpad. Accents, hero colours and `--bg-base` insets read correctly in both.

### Not proven

- Production state — not committed/staged/deployed this prompt (per instruction); the final PNGs are the local build fed with today's real production API payloads, not a live-URL capture.
- Rotation/no-refetch/touch-pause timing not re-timed this session — FaceRotator/useFaceData byte-untouched since Prompt 3's measured pass.
- Stress "tomorrow" events now compute Sydney tomorrow at run time (scratchpad `stress-payloads.mjs` fix) — the hardcoded date had gone stale overnight and would have emptied the strip in stress runs.

### Fix 1 — 2026-08-26 — F2 heroes fill · F1 chip clearance · interior insets

Divergence cause (one line): the shipped fill relied on two layout mechanisms with no guaranteed resolution — a grid auto-row stretching inside a flex-basis-0 item and `.face-herorow`'s flex 999 out-growing the sibling `.face-spacer` — which my Chromium resolves as full stretch (local build AND live kurgel-dashboard.netlify.app both measure hero→strip gap 40.5px and chip box clearance 38px with the verifier's own selectors, deployed CSS byte-identical to the local build) while the verifier's renderer resolved them without the stretch; the predecessor additionally reported lowest text-leaf/lowest-edge numbers, not per-`.face-chip`/`.face-hero` box numbers.

Fix (one appended `@media (min-width:1280px)` block at the very end of `globals.css`; both TSX files untouched — DOM unchanged): spacer `display:none` ≥1280px (kept in DOM for the <1280 base layout); `.face-sentence-card` and `.face-herorow` take `flex: 1 1 0` outright; herorow row track `grid-template-rows: minmax(0,1fr)` + `align-items: stretch` so the four hero cards ARE the container height — equal by construction, flush above the tomorrow band at the frame's 20px gap; hero value `margin-top:auto` (with the hairline's existing auto) centres value+context between label and bottom rows so taller viewports add room inside cards; frame padding-bottom 32→48px ≥1280 (chip/lane/strip clearance floor, paid by the sentence card's flexible share); last-row 8px insets (`.face-sentence-card > .face-traction`, `.face-chip > :last-child`, `.face-hero/.face-lane > .face-row:last-child` margin-bottom) replacing the ~1px razor edge; chips padding-bottom 20→26.

Measured (local prod build, headless Chromium, {real live payloads refetched 2026-08-26, stressA, stressB} × 1920x936 · 1905x923 · 1920x1080 × view 1|2|3 × day + night — 54 cells, ALL PASS): F2 hero→strip gap **20px flat, all four heroes equal height** (527/514/649px real; heroes shrink, gap holds 20, under stress) at every size; F1 chip box clearance **54px @936/923, 60px @1080** (was 38 local / 21 prod-claimed), chip band 207px tall, one row, ≥48px targets; lowest-leaf clearance all frames within 25–120: worst 83.5px (F2 stress), best 104.5px (F3 @1080); last-row insets card 8 / chip 8 / hero 9.3 / lane 13.5px; page scroll 0/0 and zero interior clipping everywhere; no `$0.00`; 390x844 horizontal excess 0 both themes. `npx tsc --noEmit` and `npm run build` pass. `~/Downloads/face-final-frame{1,2,3}.png` refreshed (1920x936, night, real payloads); day copies in scratchpad.

Not proven: the verifier's exact 21px/322px numbers never reproduced here (local or live-URL, same selectors/viewports) — the fix removes the fragile mechanisms rather than reproducing the failure; production re-verify pending (not committed/staged/deployed this task).

## 2026-08-26 — Prompt 6 — links, pause, corner notifications

Owner-directed change set, four items.

1. **Ansar habits link removed everywhere.** `FaceFrameSentence.tsx` / `FaceFrameNumbers.tsx`: `Chip`/`Hero` href now optional — the Ansar tile renders as a `<span>` with the same classes (chip/hero and streak data unchanged, other tiles keep their links). `AnsarStrip.tsx`: the "Open his dashboard" anchor deleted (streak/points/progress content untouched). Grep-verified: zero `ansar-habits-tracker.netlify.app` occurrences left in `app/` + `public/` (remaining repo mentions are code comments naming the mirrored-source repo, not links).
2. **Launchpad retarget.** `app/business/page.tsx` "Open in Launchpad" href → `https://ecom-launchpad-mentor.netlify.app/` (the only user-facing `product-test-engine` link found). Deliberately left on `product-test-engine.netlify.app/api` (API/data only): `app/lib/launchpad.ts:15`, `app/api/actions/route.ts:20`, `app/api/ecom/route.ts:48`. `TopNav.tsx` and `public/profit.html` already pointed at ecom-launchpad-mentor.
3. **Pause pill on the face.** `FaceRotator.tsx`: new `paused` state + `.face-pause` toggle in the Header `frameCounter` slot (outside the pointerdown surface). Pause stops the dwell timer indefinitely (visibilitychange and touch handlers no-op while paused — no auto-resume); resume restarts at frame 1. Paused state visible: pill lights full cyan (`var(--cyan)`), icon swaps ⏸→▶, counter dims. `?view` freeze unchanged (pill hidden when frozen); 60 s touch-pause unchanged. CSS appended at the very end of `globals.css`: 48×48 button box with negative vertical margins so header layout height is unchanged. Bug caught by the timed test: `paused` had to join the rotation effect's dependency array or the pre-pause timeout survived and fired.
4. **Intermission → mac-style corner notification.** `GoalsIntermission.tsx`: full-viewport presentation (scrim + centered 900px card + backdrop images) replaced by a fixed bottom-right card — 480px × min100/max160, `--bg-card`, subtle accent border + 3px accent left edge, NO scrim, NO dim/blur, click-through as before. Slides condensed (title row + 1–2 lines, `+n more`, 2-line clamps); `CardBackdrop`/`/intermission/*.jpg` system retired with the large card. Trigger cadence, settings resolution, hold/fade, deck building, mission/cycle reads, `?intermission=1` dev trigger all byte-untouched. Note: the "Notion collection `9ebcb2de…`" named in the prompt greps to zero hits in this repo — the only popup surface is GoalsIntermission (fed by `/api/mission`'s four Notion collections); TopNav's incident counter is Tally-fed and not a popup.

Files: `app/components/face/FaceFrameSentence.tsx`, `app/components/face/FaceFrameNumbers.tsx`, `app/components/face/FaceRotator.tsx`, `app/components/AnsarStrip.tsx`, `app/business/page.tsx`, `app/components/GoalsIntermission.tsx`, `app/globals.css` (append-only), this ledger.

Verified (local prod build, headless Chromium, synthetic API intercepts only — production untouched): `npx tsc --noEmit` + `npm run build` pass. Floors hold: lowest text leaf 25–120px from viewport bottom at 1920x936 · 1905x923 · 1920x1080 × view 1|2|3 × day+night, page scroll 0, no `$0.00`, 390px no hscroll, zero `a[href*=ansar-habits-tracker]` on `/` `/board` `/money` `/business` `/table`. Pause pill: 48×48, computed `rgb(0,212,255)`, paused 13 s (> frame 1's 10 s dwell) with no advance, resume → frame 1 → frame 2 after the dwell. Business page: 0 product-test-engine anchors, ≥1 ecom-launchpad-mentor anchor. Intermission (dev trigger + synthetic `/api/mission`): card 480×154 at exactly 24px/24px from bottom-right, no element covering >80% of the viewport, `body` filter `none`, viewport centre NOT inside the overlay (dashboard interactive), auto-dismissed after its hold.

Not proven: production state (not committed/staged/deployed per instruction); Flip Pro rendering of the new corner card and pause pill; intermission with real mission data (synthetic payload only this session); night-mode dim of the corner card by token construction only.

## 2026-08-26 — Prompt 7 — origins corner nudges + unified stack

Owner-approved Concept 2 shipped, real and ungated. The persistent OriginsStrip is GONE from the face: on `/` the strip component renders null, and the face's own root div (`app/page.tsx`) carries `dashboard-nostrip`, whose element-local `--strip-h: 0px` (appended in globals.css) hands the strip's 72px back to `.dashboard`, which the face frames absorb — an element-local custom property beats every inherited `:root` value by inheritance alone, no modern selectors, Flip Pro safe (mechanism note corrected 2026-08-26 recovery: an earlier draft described a `:root:has()` marker rule that was never shipped — `:has()` is banned, the Flip Pro's engine lacks it). Every other route keeps the strip byte-identically (`/board` and `/week` re-measured: strip present at 72px, `--strip-h` 72px, page scroll 0 — nothing broke; `/budget` and `/origins` untouched consumers of the same var).

**Where the strip's logic went**: the nudge surface is new `OriginsNudges.tsx` — it reads the SAME `GET /api/origins` payload (lane.state IS the pace logic, never re-derived) and its ✓ Done performs the strip's write verbatim: `PATCH /api/origins/complete` with `{ pageId, completedBy: lane, proof? }`; the server-side Action-Item proof gate is unchanged and un-bypassed. Schedule: 07:30 / 12:30 / 19:30 Sydney via `Intl.DateTimeFormat` (`Australia/Sydney`, no offsets); each window stays open 60 min so a mid-window mount still shows; windowed cards auto-dismiss after 60 s or on Later (Later persisted per lane+window in `originsNudge.v1.dismissed`, day-pruned); a SILENT lane pins — no auto-dismiss, Later only snoozes an hour (`originsNudge.v1.silentSnooze`) — until a tick lands. Card language matches the converted intermission card: `--bg-card`, 3px accent left edge (BUILD `--origins-build`, SILENT `--red`, BEHIND `--amber`), NAME · STATE (+`SILENT 8d`) header with right-aligned muted hint, bold lesson line (BUILD: prefix, `deliverableOf` reused from the strip), muted `module · n/5 this week`, controls all ≥48px (cyan ✓ Done, Proof URL input, muted Later).

**Stack rules** (new `CornerStack.tsx`): one fixed bottom-right flex column (right/bottom 24px, gap 12px, z 10000) is the ONLY positioned element; producers (GoalsIntermission + OriginsNudges) register keyed card nodes via `useCornerCard`. Non-overlap and non-overwrite are structural: one column → boxes cannot intersect; id-keyed append → a new card joins, never replaces. Max 3 visible, later arrivals queue in registration order; newest of the visible set renders on top. Container and item wrappers are pointer-events none; nudges opt in (`auto`), the mission card stays click-through. GoalsIntermission's schedule/dwell/deck machinery is byte-untouched — only its presentation moved: the card registers while `visible` (entry animation on `.corner-stack-item`, reduced-motion guarded); the old per-component fixed positioning and the JS fade-out transition were removed with it. One found-and-fixed bug: the post-tick confirmation was skipped when the refetch flipped a lane to onpace (guard order) — confirm now checks first.

**Files**: `app/components/CornerStack.tsx` (new), `app/components/OriginsNudges.tsx` (new), `app/components/GoalsIntermission.tsx`, `app/components/OriginsStrip.tsx`, `app/page.tsx`, `app/globals.css` (append-only, tokens untouched), this ledger.

**Measured** (local prod build, headless Chromium, synthetic payloads + stubbed complete route — no real origins/Notion write occurred; `page.clock` faked 12:35 Sydney): floors with strip removed 25–120 band holds at 1920x936 · 1905x923 · 1920x1080 × view 1|2|3 × night+day — v1 89.0, v2 87.0, v3 98.5px (936/923); 95.0/93.0/104.5 @1080; page scroll 0, no `$0.00`, 390px hscroll 0. Two nudges + mission card SIMULTANEOUS: 3 stack items, pairwise non-intersecting boxes, anchored 24px from corner, cards ≤480×149, no fixed element >80% viewport, body filter none, viewport centre hits the dashboard; touch targets 48/48/48. Auto-dismiss at +61 s (build card gone, silent pinned); silent Later hides and returns at +1 h; Later survives reload within the window; outside windows only silent shows. ✓ Done → exactly one `PATCH /api/origins/complete`, body `{pageId, completedBy:"taylan", proof}` asserted against the stub; confirmation shown; `?refresh=1` refetch fired; card removed itself. `/board` `/week` strip intact; `?view=2` freeze + 48px pause pill unchanged. `npx tsc --noEmit` + `npm run build` pass. Screenshots: `~/Downloads/prompt7-stack-{night,day}.png`.

**NOT PROVEN**: the live Notion write through the nudge (code-reuse of the strip's endpoint only — every test write was stubbed); production state (nothing committed/staged/deployed); Flip Pro rendering of the stack; real 07:30/12:30/19:30 wall-clock firing (faked clock only); intermission fade-out is now a hard cut (fade-in kept) — accepted trade of routing through the stack.

## 2026-08-26 — Prompt 7 recovery — `:has()` removed, strip state Flip Pro safe

A prior agent crashed mid-edit replacing the `:has()` mechanism, leaving `app/page.tsx` syntactically broken (a JSX comment placed directly inside `return (`, invalid outside JSX children — TS1005/TS1109). Repaired by hand (comment moved above `return`); all Prompt 7 content preserved, nothing checked out.

**New strip-state mechanism, no `:has()`, no color-mix**: OriginsStrip.tsx never renders `.strip-compact` any more; instead an effect sets `data-strip-compact` on `<html>` (mirroring Header.tsx's `data-theme`) only while the strip is rendered AND both lanes are ON_PACE. Two rules appended at the END of globals.css: `:root[data-strip-compact] { --strip-h: 40px }` and, inside `@media (max-width: 768px)`, the same selector back to 72px (stacked lanes must not shrink — replicates the retired tier exception by source order). The two committed `:root:has(.origins-strip.strip-compact)` rules (globals.css lines ~31 and ~461) were NOT edited per the append-only discipline — they are permanently unmatched (no element ever carries the class) and their comments now say so. The face keeps `dashboard-nostrip`'s element-local `--strip-h: 0px` (unchanged, already `:has()`-free).

**Files**: `app/page.tsx` (repair + comment), `app/components/OriginsStrip.tsx` (attribute effect, class removed, comments), `app/globals.css` (two appended rules + comment corrections only — no committed rule or token touched), this ledger (Prompt 7 mechanism note corrected — the drafted `:root:has(.origins-strip-off)` wording never shipped).

**Measured** (local prod build port 4123, headless Chromium, real prod payloads fetched 2026-08-26 intercepted + mutated origins states, `page.clock` 12:35 Sydney for the nudge — 30 checks ALL PASS): `npx tsc --noEmit` + `npm run build` pass. Face 1920x936 `?view=1|2|3`: lowest-leaf floors 89.0 / 87.0 / 98.5px (identical to Prompt 7's numbers), scroll 0/0, no `$0.00`; corner stack mounts (1 nudge card, anchored 24px bottom-right, 480×148.75). `/board` and `/week`: strip present 2 lanes; mixed states → 72px, attr absent; both ON_PACE → `data-strip-compact="on"`, `--strip-h` 40px, strip box 40px, zero `.strip-compact` in the DOM; page scroll 0 in all cells. Face with both-onpace payload: `.dashboard` computed `--strip-h` 0px, attr absent (strip hidden ⇒ effect clears it). 390x844 `/board` compact: attr on but `--strip-h` stays 72px, hscroll 0. Grep: the only `:has(` occurrences left in `app/` are the two committed dead rules; every comment referencing the old mechanism updated.

**Not proven**: production state (nothing committed/staged/deployed); actual Flip Pro rendering (mechanism is attribute+descendant selectors by construction); real Notion/origins writes (all API traffic intercepted); real wall-clock nudge firing (faked clock).
