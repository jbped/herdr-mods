import test from "node:test";
import assert from "node:assert/strict";
import { keyAction, paneIn } from "../mods/brunr/openpane.js";

const term = (pane, tab, focused = false) => ({ pane, tab, focused, terminal: "t" });
const mod = (pane, tab, focused = false) => ({ pane, tab, focused, mod: "brunr", terminal: null });

test("openpane: with no Brunr pane in the focused tab the key splits", () => {
  assert.deepEqual(keyAction([term("p1", "a", true), mod("p9", "b")], "brunr", { tab: "a", pane: "p1" }, null), { do: "split" });
});

test("openpane: a Brunr pane without the keyboard gets it", () => {
  assert.deepEqual(keyAction([term("p1", "a", true), mod("p2", "a")], "brunr", { tab: "a", pane: "p1" }, null), { do: "focus", pane: "p2" });
});

test("openpane: from the Brunr pane the key goes back to the pane it came from", () => {
  assert.deepEqual(keyAction([term("p1", "a"), mod("p2", "a", true)], "brunr", { tab: "a", pane: "p2" }, "p1"), { do: "back", to: "p1" });
});

test("openpane: a pane to go back to that is closed, or is Brunr's own, is not used", () => {
  const all = [term("p1", "a"), mod("p2", "a", true)];
  assert.deepEqual(keyAction(all, "brunr", { tab: "a", pane: "p2" }, "gone"), { do: "back", to: null });
  assert.deepEqual(keyAction(all, "brunr", { tab: "a", pane: "p2" }, "p2"), { do: "back", to: null });
  assert.deepEqual(keyAction(all, "brunr", { tab: "a", pane: "p2" }, { not: "an id" }), { do: "back", to: null });
});

test("openpane: only a pane of this mod in this tab counts", () => {
  const all = [{ ...mod("p3", "a"), mod: "vaultr" }, mod("p4", "b")];
  assert.equal(paneIn(all, "brunr", "a"), null);
  assert.equal(paneIn(all, "brunr", null), null);
  assert.equal(paneIn(all, "brunr", "b")?.pane, "p4");
});
