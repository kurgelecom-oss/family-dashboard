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

- [ ] `taylan-work` wired to `7e90f275-70d4-480a-b504-b8be3444b7f5`
- [ ] `taylan-personal` wired to `2b062576-79ee-4b7a-8acd-805aaf044f8b`
- [ ] `taylan-ecom` wired to `cd0e72dd-fb69-4599-95be-202ee1446770`
- [ ] `nihal-home` wired to `52767310-b8e8-4827-bf66-ae08a9a68120`
- [ ] `nihal-personal` wired to `e959c33a-968e-4da3-a1f5-f10e65acc094`
- [ ] `nihal-ecom` wired to `dc07abb4-803e-4058-95f2-10dd473402fa`
- [ ] `nihal-ayah` wired to `a2d13dcd-ce40-4899-b211-bba55eed3b50`
- [ ] `ansar-homeschool` wired to `63550d99-ab80-4c2d-914d-d7df6d2f95a9`
- [ ] `588f40ab-4078-4767-982c-b50f9cd83f71` appears nowhere in the repo (grep proves zero hits)

## RULES

- [ ] All Notion reads are server-side only
- [ ] Token never reaches the client bundle (verified by grepping the built output)
- [ ] 300s cache set on every Notion read
- [ ] Renderer handles layer shape: `Block`/title, `Day` single-select, `Start`, `End`, `Notes`
- [ ] Renderer handles Weekly Schedule shape: `Entry`, `Days` multi-select, `Category`, `Detail`, `Emoji`
- [ ] Both shapes proven against real responses, not assumed

## PARITY WITH /week

- [ ] Schedule renders from Notion on `/board`
- [ ] ANSAR FC strip: points today
- [ ] ANSAR FC strip: week total out of 56
- [ ] ANSAR FC strip: day streak
- [ ] ANSAR FC strip: four tier thresholds
- [ ] Edit in Notion link present and correct

## SCORING

- [ ] Single shared `scoreDay` lives in `app/lib/`
- [ ] `app/components/WeekProgressStrip.tsx` copy removed, imports the shared one
- [ ] `app/components/PanelHabits.tsx` copy removed, imports the shared one
- [ ] ansar-habits-tracker `app/page.tsx` copy removed, imports the shared one
- [ ] Canonical logic adopted: `homeschool_session` alone awards 5
- [ ] `WEEKLY_MAX` still 56
- [ ] Tier thresholds unchanged (42 / 34 / 26 / 0)

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
