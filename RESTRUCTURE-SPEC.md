# RESTRUCTURE-SPEC.md

Read this file before any prompt that touches the face, the drill-down routes, or Column C.
This file says what to build. It does not say where anything currently is. Discover paths from the repo, never from this file.
`BOARD-SPEC.md` and `BOARD-LEDGER.md` still govern the board. This file governs everything else in the restructure.
After every prompt, append a dated entry to `RESTRUCTURE-LEDGER.md`: what changed, files touched, anything not proven.

---

## 1. Outcome

- The face `/` becomes three rotating frames on a timer. One fetch, three renders.
- Four drill-down routes inside this repo: `/money`, `/business`, `/table`, and `/board` extended. No new site, no new repo.
- Column C loses the goals panel and gains The table. The Clock stays on the face.
- Reward goals move to `/money`.

---

## 2. Rules that override everything else

- Discover before you claim. Every path, component name, helper, and token comes from a read of this repo in the current session.
- Move panel components into routes. Do not rewrite them. New code is limited to: the three frames, The table, the calendar band, the Ansar strip, the rewards section.
- One data load on the face. The frames render from one shared state object. The existing refresh interval is unchanged. No per-frame fetch.
- Hide any value that is `$0.00` on the face, in every frame.
- Zero-currency rule retires with the goals panel. Drill-downs show dollars.
- Never touch: `scoring.ts`, `streak.ts`, `gating.ts`, token definitions in `globals.css`, `BOARD-SPEC.md`, `BOARD-LEDGER.md`, `WEEKLY_MAX`, tier thresholds, gate order, dwell constant.
- Stage by file name. Never `git add -A`.
- Never write real rows to production to set up a test. Use a throwaway item, delete it after.
- Never deploy a knowingly broken config to simulate failure. Stub at the boundary or report NOT PROVEN.
- Dates via `Intl.DateTimeFormat`, `timeZone: "Australia/Sydney"`. No hardcoded offsets.
- Tokens: `--bg-base #1e2140`, `--bg-card #252a4a`, `--cyan #00d4ff`. `#00d9ff` is wrong. Verify token names in `globals.css` before use.
- Primary surface for the face and all four drill-downs is the 65-inch Samsung Flip Pro, a 4K multi-touch display. Build every route at the same CSS viewport width the face renders at today, taken from the discovery entry in RESTRUCTURE-LEDGER.md. Touch targets 48px minimum. Routes must also collapse cleanly to 390px, but that is secondary.
- Report format, verbatim, at the end of every prompt: files changed, anything you couldn't do, any decision needed. Under 10 lines. No narration.

---

## 3. The face — three frames, one loop

Sequence rule: nothing moves between frames without a reason. Header identical in all three. The four chips in frame 1 become the four heroes in frame 2 in the same order. Frame 3 groups those four into three lanes.

| Frame | Dwell | Contents |
|---|---|---|
| 1 · Sentence | 10 s | Headline sentence (76px; owner-directed full-bleed amendment, 2026-08-26). Next-action line with cyan left border. Traction bar with days left. Four chips in a single row, fixed order: Week · Test · Table · Ansar. |
| 2 · Four numbers | 15 s | Headline as one muted line. Four hero tiles in chip order, each: label, 80px value, one context line. Below: tomorrow strip (events by person) with traction days at right. |
| 3 · Three lanes | 25 s | Headline as one muted line. Three tiles: Money, Business, Family. Each: label, 80px hero, one context line, hairline, three label/value rows. |

Chip → hero → lane mapping:

| Chip / hero | Value | Frame 3 lane |
|---|---|---|
| Week | last-week spend, cyan | Money — rows: Month, Balance, Saved % |
| Test | test status word (Stale / Running / None), red when stale | Business — rows: Campaigns, Next gate, Tests 0 of 3 |
| Table | open decision count, "oldest N days" | Family — rows: Ansar streak + today %, Tomorrow, Traction days |
| Ansar | day streak, purple | folded into Family lane |

Header: brand at left. At right: date · time · frame counter `n/3`, current frame number in cyan. Under the header a 2px progress line filling toward the next frame.

Mechanics:

- Loop is 50 s. Hard cut between frames. No crossfade, no slide.
- Dwell times are one constant array. Nothing else hardcodes them.
- `?view=1`, `?view=2`, `?view=3` freeze that frame and stop the timer. No param = start PAUSED on frame 1; rotation begins only when the play pill is pressed (owner amendment 2026-08-26).
- On `visibilitychange` hidden: pause the timer. On visible: resume at frame 1.
- Night mode dims all three frames. Do not change how AUTO or LIVE behave; discover what they do first and leave them alone.
- Frame components live beside the existing face component. The face keeps its route. No new route for the face.
- Every hero and lane links to its route: Week → `/money`, Test → `/business`, Table → `/table`, Ansar → no link (owner amendment 2026-08-26: Ansar dashboard link removed everywhere), Family lane → `/board`.
- Touch on a hero or lane navigates to its route. Any other touch pauses rotation for 60 s, then resumes at frame 1.

Headline rules, priority order, first match wins:

1. Active test stale → `No test is running. Last entry was N days ago.`
2. Test running, spend under entry window → `[Test name] is at $X of the $350 window.`
3. Oldest open decision older than 7 days → `One decision has sat N days. Close it tonight.`
4. Otherwise → `Nothing on the table. Run the check-in short.`

Next-action line: the test's next gate when a test exists, else the oldest open decision's title.

Face data and sources:

| Element | Source |
|---|---|
| Week spend, month spend, balance, saved % | PocketSmith via existing routes |
| Test status, next gate, spend vs window, tests 0 of 3 | Launchpad API, `product-test-engine.netlify.app/api`. A product = a test. IDs are 36-char UUIDs. Data/API calls only ever hit `product-test-engine.netlify.app/api`; user-facing "Open in Launchpad" links go to `ecom-launchpad-mentor.netlify.app` (owner amendment 2026-08-26). |
| Open decision count, oldest age, oldest title | Notion collection `4431302a-75ed-479f-a5f4-3bfd5e0a4e68` (Daily Discussion Points) via `fetchSource` in `app/lib/notion.ts` |
| Ansar streak, today % | Supabase via existing routes |
| Tomorrow's events by person | MS Graph via existing calendar route |
| Traction days, week days, year % | The Clock, existing |

---

## 4. Drill-downs

All four: back link to `/` at top left. Header shows date and time in Australia/Sydney. Reuse `fetchSource` for Notion. Copy the `/board` route pattern for layout and data loading.

### `/money` — Column A

- Period toggle at top right: Week · Month · 3 months. Default Week.
- Three tiles: Earned (green), Spent with transaction count (cyan) and change vs prior, Saved with %.
- Categories tile: label, bar, amount. Uncategorised in amber. Tap → PocketSmith transaction search for that category and period.
- Accounts tile: name, balance (negatives red), hairline, Total in cyan. Tap → PocketSmith account summary.
- Rewards tile at the bottom: five goals with % each, Edit targets control, saved pot editable. Dollars visible. Goals: Docklands move, Sydney or QLD trip, Crown weekend, Night out, Shopping spree ($250 × member count, count editable). Targets and saved pot are stored values, never hardcoded.
- Source: PocketSmith only. Rewards state: wherever the goals panel stores it today — discover.

### `/business` — Column B

- Campaign status pill at top right (amber when none live).
- Active test tile: name, day, last entry date, days silent, Stale/Running label. Two buttons: Open in Launchpad, Open in calculator (`/profit.html` in Auto mode with the test UUID prefilled). Spend-vs-window bar with the window marked. ROAS (red under breakeven), Breakeven, Next gate. Entry log below, newest first, scrolls.
- Test selector appears only when more than one test exists.
- P&L tile: Revenue, COGS with unverified flag when unverified, Ad spend settled, hairline, Contribution.
- Product tests tile: `0 of 3`, days since Launchpad go-live, queue of validated-not-run products from the Launchpad API.
- Sources: Launchpad API, PocketSmith for settled Meta charges, revenue as currently wired.

### `/table` — Column C

- Top right: owner filter All · T · N, and Raise item.
- Start here panel: cyan left border, one question generated from the headline rules in §3 restated as a question.
- On the table: every open decision, oldest first. Each row: title as a question, owner, day count (purple, and purple left border when 7+ days). Expanded row shows "Closed when:" text and an outcome input with a Close button.
- Close writes `Outcome` and the closed date to the Notion row. This is the only write in the restructure. Test with a throwaway row only.
- Closed since yesterday tile: count and titles, or the exact text `Nothing was closed yesterday.`
- The clock tile: days left in week, days to traction end, year %, tests 0 of 3.
- Sources: Daily Discussion Points `4431302a-75ed-479f-a5f4-3bfd5e0a4e68`; Mission Goals `22f0eed5-7556-4758-b171-328d273485f3` Band = Monthly for the milestone.

### `/board` — Column D, extended

- The existing board stays exactly as `BOARD-SPEC.md` defines it. Nothing below the new bands changes.
- Add above the board: calendar band. Grid with a row per person (Taylan, Nihal, Ansar) and columns Today · Tomorrow. Events as small blocks with a coloured left border and time. Empty cell shows `—`. Tap → the event.
- Add below the calendar band: Ansar strip. Day streak (purple), points today, week points / 55, progress bar. No dashboard link (owner amendment 2026-08-26).
- Sources: MS Graph via existing calendar route, Supabase via existing Ansar route.

---

## 5. Column C on the face

- Goals panel removed from `PanelTodos.tsx` or wherever discovery finds it. The Clock sub-panel keeps rendering.
- After the face rewrite, Column C's content on the TV is carried by the Table chip / hero / Family lane. The Clock feeds the traction bar and the Family lane's Traction row.

---

## 6. Verification — production only

Self-reported completion is not verification.

- `/?view=1`, `/?view=2`, `/?view=3` each render; no `$0.00` visible; headline matches §3 rule order for the current data.
- `/` rotates; progress line moves; counter cycles 1 → 2 → 3; no refetch between frames (check the network log).
- `/money`, `/business`, `/table`, `/board` render at the face's viewport width with no scroll, and collapse to 390px with no horizontal scroll.
- `/table`: close one throwaway row, re-fetch it, confirm `Outcome` set, delete the row.
- Night mode dims every frame.
- Assert layout with `getBoundingClientRect()` where a claim depends on position.

---

## 7. Known unknowns — resolve in discovery before building on them

- Whether the Notion integration token in this repo can read and write collection `4431302a-75ed-479f-a5f4-3bfd5e0a4e68`. Try one read. Report the result.
- What AUTO toggles today.
- Whether the face is a server or client component, and how refresh is scheduled.
- Where the goals panel stores its targets and saved pot.
- Which browser draws the face on the Flip Pro (Tizen built-in or a connected Mac). Log as UNPROVABLE if it affects a check.

---

## 8. Parked — do not touch unless the prompt names it

- Store / data-layer refactor
- Fixed $0.30 fee input on the calculator
- The Clock +1px slack
