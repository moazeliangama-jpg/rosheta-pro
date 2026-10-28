import test from "node:test";
import assert from "node:assert/strict";
import { isExpired } from "./imageStore.ts";

const day = 24 * 60 * 60 * 1000;

test("صورة أحدث من ٣٠ يوم بتفضل", () => {
  const now = 1_800_000_000_000;
  assert.equal(isExpired(now - 5 * day, 30, now), false);
  assert.equal(isExpired(now - 29 * day, 30, now), false);
});

test("صورة أقدم من ٣٠ يوم بتتمسح", () => {
  const now = 1_800_000_000_000;
  assert.equal(isExpired(now - 31 * day, 30, now), true);
  assert.equal(isExpired(now - 365 * day, 30, now), true);
});

test("بدون وقت التقاط (صورة قديمة من نسخة أقدم) مش بنمسحها", () => {
  assert.equal(isExpired(0, 30, Date.now()), false);
});
