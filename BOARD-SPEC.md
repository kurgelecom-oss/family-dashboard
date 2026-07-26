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

- Three collapsible person sections: Taylan, Nihal, Ansar.
- Taylan contains layers: Work, Personal, Ecom.
- Nihal contains layers: Home, Personal, Ecom, Ayah.
- Ansar contains layers: Homeschool.
- A layer may only appear under its owner. No cross-person layers.

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
