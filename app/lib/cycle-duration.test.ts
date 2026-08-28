import assert from "node:assert/strict";
import test from "node:test";

import { cycleDurationDays } from "./cycle-duration.ts";

test("keeps the running 21 August cycle at nine days", () => {
  assert.equal(cycleDurationDays("2026-08-21"), 9);
});

test("uses ten days for cycles started after the changeover", () => {
  assert.equal(cycleDurationDays("2026-08-28"), 10);
  assert.equal(cycleDurationDays("2026-08-29"), 10);
});
