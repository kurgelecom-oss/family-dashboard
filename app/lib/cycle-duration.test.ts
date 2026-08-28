import assert from "node:assert/strict";
import test from "node:test";

import { cycleDurationDays } from "./cycle-duration.ts";

test("uses ten days for the running cycle and every future cycle", () => {
  assert.equal(cycleDurationDays("2026-08-21"), 10);
  assert.equal(cycleDurationDays("2026-08-28"), 10);
  assert.equal(cycleDurationDays("2026-08-29"), 10);
});
