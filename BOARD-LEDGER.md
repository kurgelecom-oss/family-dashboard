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
