import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, writes } from "./herdr-shim.mjs";
import * as drafts from "../mods/brunr/drafts.js";
import { reduce, isDraft, draftKey } from "../mods/brunr/drafts.js";
import { saveDraft } from "../mods/brunr/save.js";
import { Saved } from "../mods/brunr/store.js";
import { deepFreeze } from "./helpers.mjs";

const DISK = "info:\n  name: List\n  type: http\n\nhttp:\n  method: GET\n  url: https://shop.test/products\n";
const TOKEN = "tok_9f3c1e77secret";

test("draftKey is the tree row key of the Request", () => {
  assert.equal(draftKey(null, "C:\\dev\\Shop\\", "products/List.yml"), "|C:/dev/Shop#products/List.yml");
  assert.equal(draftKey("box", "/srv/Shop", "a.bru"), "box|/srv/Shop#a.bru");
});

test("open with no record starts clean from the disk text", () => {
  const r = reduce(null, { type: "open", disk: DISK });
  assert.deepEqual(r, { base: DISK, text: DISK, changed: null, kept: null });
  assert.equal(isDraft(r), false);
  assert.equal(reduce(null, { type: "open", disk: null }), null);
});

test("an edit makes a Draft, and editing back to the starting text removes it", () => {
  const open = deepFreeze(reduce(null, { type: "open", disk: DISK }));
  const d = reduce(open, { type: "edit", text: DISK + "x" });
  assert.equal(isDraft(d), true);
  assert.equal(d.base, DISK);
  const back = reduce(d, { type: "edit", text: DISK });
  assert.equal(isDraft(back), false);
  assert.equal(reduce(open, { type: "edit", text: DISK }), open, "the same text changes nothing");
});

test("a disk change with no Draft updates the starting text", () => {
  const open = reduce(null, { type: "open", disk: DISK });
  const r = reduce(open, { type: "disk", disk: "new on disk" });
  assert.deepEqual(r, { base: "new on disk", text: "new on disk", changed: null, kept: null });
});

test("a disk change under a Draft marks a conflict and keeps the Draft", () => {
  const d = deepFreeze(reduce(reduce(null, { type: "open", disk: DISK }), { type: "edit", text: "mine" }));
  const c = reduce(d, { type: "disk", disk: "theirs" });
  assert.equal(c.changed, "theirs");
  assert.equal(c.text, "mine");
  assert.equal(c.base, DISK, "the save still expects the starting text, so it is refused");
  // The disk going back to the starting text clears the mark; the disk taking the Draft's text ends it.
  assert.equal(reduce(c, { type: "disk", disk: DISK }).changed, null);
  assert.equal(isDraft(reduce(c, { type: "disk", disk: "mine" })), false);
  // Opening again finds the same change.
  assert.equal(reduce(d, { type: "open", disk: "theirs" }).changed, "theirs");
});

test("keep mine hides the change until the disk changes again", () => {
  const c = reduce(reduce(reduce(null, { type: "open", disk: DISK }), { type: "edit", text: "mine" }), { type: "disk", disk: "theirs" });
  const k = reduce(c, { type: "keep" });
  assert.equal(k.changed, null);
  assert.equal(k.base, DISK);
  assert.equal(reduce(k, { type: "disk", disk: "theirs" }).changed, null);
  assert.equal(reduce(k, { type: "disk", disk: "theirs again" }).changed, "theirs again");
});

test("saved ends the Draft, or rebases it when the text moved on during the save", () => {
  const d = reduce(reduce(null, { type: "open", disk: DISK }), { type: "edit", text: "mine" });
  assert.equal(isDraft(reduce(d, { type: "saved", text: "mine" })), false);
  const moved = reduce({ ...d, text: "mine 2" }, { type: "saved", text: "mine" });
  assert.equal(moved.base, "mine");
  assert.equal(isDraft(moved), true);
  assert.equal(reduce(null, { type: "saved", text: "x" }), null);
});

test("discarded goes back to the disk text", () => {
  const c = reduce(reduce(reduce(null, { type: "open", disk: DISK }), { type: "edit", text: "mine" }), { type: "disk", disk: "theirs" });
  assert.deepEqual(reduce(c, { type: "discarded", disk: null }), { base: "theirs", text: "theirs", changed: null, kept: null });
  assert.deepEqual(reduce(c, { type: "discarded", disk: "read again" }).text, "read again");
});

test("the store shares records, lists Drafts and survives a pane closing", () => {
  drafts.clear();
  const a = draftKey(null, "/c/Shop", "a.yml"), b = draftKey(null, "/c/Shop", "b.yml");
  drafts.open(a, "A");
  drafts.open(b, "B");
  drafts.edit(a, "A2");
  assert.deepEqual(drafts.keys(), [a]);
  assert.equal(drafts.has(a), true);
  assert.equal(drafts.has(b), false);
  drafts.collectionRead("|/c/Shop", { "a.yml": "A on disk", "b.yml": "B on disk" });
  assert.equal(drafts.get(a).changed, "A on disk");
  assert.equal(drafts.get(b).text, "B on disk");
  drafts.discard(a);
  assert.deepEqual(drafts.keys(), []);
  assert.equal(drafts.get(a).text, "A on disk");
});

test("a store change wakes waiters and bumps only a counter in shared state", async () => {
  drafts.clear();
  state.shared = {};
  const k = draftKey(null, "/c/Shop", "a.yml");
  drafts.open(k, "A");
  const woke = drafts.nextChange();
  drafts.edit(k, `A ${TOKEN}`);
  await woke;
  assert.deepEqual(Object.keys(state.shared), [drafts.TICK]);
  assert.equal(typeof state.shared[drafts.TICK], "number");
});

function scratchRequest(text = DISK) {
  const root = join(mkdtempSync(join(tmpdir(), "brunr-save-")), "Shop");
  mkdirSync(join(root, "products"), { recursive: true });
  writeFileSync(join(root, "products/List.yml"), text);
  return { key: draftKey(null, root, "products/List.yml"), machine: null, root, path: "products/List.yml", format: "yaml" };
}

test("after a Draft is created and saved, nothing from its text is in shared state or localStorage", async () => {
  drafts.clear();
  state.shared = {};
  const stored = new Map();
  const storage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)) };
  const prevLocal = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  try {
    const saved = new Saved(storage);
    saved.setOpen("|/c/Shop", true);
    const t = scratchRequest();
    drafts.open(t.key, DISK);
    const text = DISK.replace("https://shop.test/products", `https://shop.test/products?token=${TOKEN}`);
    drafts.edit(t.key, text);
    const r = await saveDraft(t);
    assert.equal(r.status, "saved");
    assert.equal(readFileSync(join(t.root, t.path), "utf8"), text);
    assert.equal(drafts.has(t.key), false);
    const everything = JSON.stringify(state.shared) + JSON.stringify([...stored]);
    assert.ok(!everything.includes(TOKEN), "the token is in shared state or localStorage");
    assert.ok(!everything.includes("shop.test"), "Request text is in shared state or localStorage");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prevLocal, configurable: true, writable: true });
  }
});

test("saveDraft: no Draft, lint warnings, force, conflict, overwrite and another Machine", async () => {
  drafts.clear();
  const t = scratchRequest();
  assert.equal((await saveDraft(t)).status, "none");
  drafts.open(t.key, DISK);
  const bad = DISK.replace("url: https://shop.test/products", "url: {{baseUrl}}/products");
  drafts.edit(t.key, bad);
  writes.length = 0;
  const lint = await saveDraft(t);
  assert.equal(lint.status, "lint");
  assert.equal(lint.warnings[0].line, 7);
  assert.equal(writes.length, 0, "nothing is written before the warning is answered");
  writeFileSync(join(t.root, t.path), "theirs\n");
  const conflict = await saveDraft(t, { force: true });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.current, "theirs\n");
  assert.equal(drafts.has(t.key), true);
  const over = await saveDraft(t, { force: true, expected: conflict.current });
  assert.equal(over.status, "saved");
  assert.equal(readFileSync(join(t.root, t.path), "utf8"), bad);
  const remote = { ...t, key: draftKey("box", t.root, t.path), machine: "box" };
  drafts.open(remote.key, DISK);
  drafts.edit(remote.key, "x");
  const r = await saveDraft(remote);
  assert.equal(r.status, "failed");
  assert.match(r.message, /this computer only/);
});

test("asks stay in memory, in order, and never touch shared state", async () => {
  const store = await import("../mods/brunr/store.js");
  state.shared = {};
  const from = store.askSeq();
  store.ask({ kind: "envGone", key: "|/c/Shop", name: "local", newName: "copied" });
  store.ask({ kind: "envGone", key: "|/c/Shop", name: "copied", newName: null });
  assert.deepEqual(store.asksSince(from).map((e) => e.ask.newName), ["copied", null]);
  assert.deepEqual(store.asksSince(store.askSeq()), []);
  assert.deepEqual(state.shared, {});
});

test("rekey, rebase and drop: a Draft follows its file through a rename, a move and a delete", async () => {
  drafts.clear();
  const k = (p) => `|/c/Shop#${p}`;
  drafts.open(k("products/List.yml"), DISK);
  drafts.edit(k("products/List.yml"), DISK + "# mine\n");
  drafts.open(k("products/Other.yml"), DISK);
  drafts.open(k("productsX/Same prefix.yml"), DISK);
  drafts.edit(k("productsX/Same prefix.yml"), DISK + "x");
  assert.deepEqual(drafts.draftsUnder(k("products")), [k("products/List.yml")], "a sibling directory with the same prefix is not under it");
  drafts.rekey(k("products"), k("catalog"));
  assert.equal(drafts.has(k("catalog/List.yml")), true);
  assert.equal(drafts.get(k("catalog/Other.yml")).text, DISK);
  assert.equal(drafts.get(k("products/List.yml")), null);
  assert.equal(drafts.has(k("productsX/Same prefix.yml")), true);
  const written = DISK.replace("name: List", "name: Renamed");
  drafts.rebase(k("catalog/List.yml"), written, written + "# mine\n");
  assert.deepEqual(drafts.get(k("catalog/List.yml")), { base: written, text: written + "# mine\n", changed: null, kept: null });
  drafts.rebase(k("catalog/Other.yml"), written, written);
  assert.equal(drafts.has(k("catalog/Other.yml")), false, "no Draft stays no Draft");
  drafts.drop(k("catalog"));
  assert.deepEqual(drafts.keys(), [k("productsX/Same prefix.yml")]);

  drafts.clear();
});
