import test from "node:test";
import assert from "node:assert/strict";
import * as guard from "../mods/brunr/closeguard.js";

test("closeguard: with no dialog registered a close is not held", () => {
  guard.set(null);
  assert.equal(guard.request(), false);
});

test("closeguard: a dialog with no unsaved edits lets the close through and is not woken", async () => {
  let woken = false;
  guard.set(() => false);
  guard.nextRequest().then(() => { woken = true; });
  assert.equal(guard.request(), false);
  await Promise.resolve();
  assert.equal(woken, false);
  guard.set(() => true);
  guard.request();
});

test("closeguard: unsaved edits hold the close and wake the dialog", async () => {
  guard.set(() => true);
  const woke = guard.nextRequest();
  assert.equal(guard.request(), true);
  await woke;
  guard.set(null);
});

test("closeguard: a check that throws does not hold the close", () => {
  guard.set(() => { throw new Error("gone"); });
  assert.equal(guard.request(), false);
  guard.set(null);
});
