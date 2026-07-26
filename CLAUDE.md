@AGENTS.md

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
