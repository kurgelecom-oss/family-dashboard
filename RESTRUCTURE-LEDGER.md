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
