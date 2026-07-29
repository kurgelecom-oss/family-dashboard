@AGENTS.md

# Standing rules

These apply to every session in this repo. Each one was learned by shipping
something broken.

## Verification

- **Never self-report success.** Every claim about layout, routes, colours or
  production state must come from a real browser measurement or a live
  production fetch. A green typecheck, a clean build and a successful push are
  not verification — they only prove the code compiles and left the machine.
- **`scrollHeight === clientHeight` does NOT prove a row is visible.** A card
  body with its own `overflow: hidden` absorbs the overflow before it reaches
  the card, so the card reports no scroll while a row is clipped off the
  bottom. Assert geometrically instead:

  ```js
  row.getBoundingClientRect().bottom
    <= card.getBoundingClientRect().bottom - parseFloat(getComputedStyle(card).paddingBottom)
  ```

  Check the **last** row of every card — that is the one that gets cut.
- **Verify at all three heights: 1905x923, 1920x936, 1920x1080.** The Samsung
  Pro Flip reports **1920x936**; 1905x923 is the Mac mini monitor. Passing at
  1080 proves nothing about either.
- **Never ship a layout with less than +25px surplus.** +3px is measurement
  noise, not a margin — it shipped a visibly clipped row once already.
- Column-level surplus is not sufficient on its own. `.card` is `flex: 1 1 0%`,
  so a column hands every card an equal share regardless of need: a healthy
  column total can hide a starved individual card. Measure **per card**,
  natural height against allotted height.

## Execution

- **Do not stop mid-task to ask which option to take.** Choose the
  cheapest-cost option that satisfies the constraints and keep going until the
  stated exit condition is met. Report at the end, not at every fork.
- **Deploy, then verify against production, not local.** Local passing is a
  precondition for pushing, never the evidence that something works.

## Invariants

- **`#00d4ff` is canonical.** `#00d9ff` is a known decoy — never use it.
- **Never hardcode UTC offsets.** Sydney runs UTC+10 and UTC+11 depending on
  DST, so an offset constant is wrong for half the year. Use
  `Intl.DateTimeFormat` with `timeZone: "Australia/Sydney"` (see
  `app/lib/time.ts` and `app/components/Header.tsx`).
- **`app/lib/scoring.ts` is a mirrored file.** It is byte-for-byte identical to
  `ansar-habits-tracker/app/lib/scoring.ts`. Never edit one independently —
  both deploys read the same Supabase `habit_completions` rows, so divergence
  makes the same day score differently on different screens. Change one, copy
  to the other, run `scripts/check-scoring-sync.sh` before committing.
- **Add routes, not repos.** New surfaces belong in this app.
- **`BOARD-SPEC.md` and `BOARD-LEDGER.md` supersede Notion** for board state.
- **Inline `style={{ padding: ... }}` on `.card` defeats the `@media` tiers.**
  Inline styles beat any stylesheet rule regardless of specificity or source
  order, so a card carrying inline padding silently opts out of every height
  tier. Don't reintroduce it — set card padding in `globals.css` only.

## Layout architecture

- Height tiers live in `app/globals.css` as `@media (max-height: ...)` blocks
  and **must sit after** the base `.dashboard` / `.dashboard-grid` /
  `.dashboard-col` / `.card` rules. A media query adds no specificity, so at
  equal specificity source order decides — placed above the base rules they
  match and do nothing.
- `--nav-h` (40px) and `--strip-h` (40px) are subtracted by every
  fixed-viewport surface: `.dashboard` in `globals.css`, plus the inline styles
  in `app/board/page.tsx` and `app/week/page.tsx`. Change one, change all three.

# /board work

- **`BOARD-SPEC.md` is the authority.** Frozen definition of done. Where code or
  convenience disagrees with it, it wins. Changing scope means changing that file
  deliberately and on its own — never as a side effect of implementation.
- **`BOARD-LEDGER.md` is the running state.** The only place progress is recorded.
  Tick an item when it is verified, not when it is written. A ticked box is a claim;
  the code and the deployed URL are the proof.
- **`board-reviewer` subagent — MUST BE USED before every commit** on this work. Reads the
  current diff against `BOARD-SPEC.md` and reports spec lines not met. It reports only; it
  does not edit.
- **`prod-verifier` subagent** — fetches a production URL and checks the response body for
  required strings. Nothing is "done" on local state: a green typecheck, a clean build and a
  successful push are not verification.
