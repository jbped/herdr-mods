import { test } from "node:test";
import assert from "node:assert/strict";
import { readTree } from "./helpers.mjs";
import { parseCollection } from "../mods/brunr/parser.js";
import { buildRows, confirmText, findBlock, keyAction, runMark, secretWarning, urlVariables } from "../mods/brunr/tree.js";

const shop = parseCollection({ root: "/c/shop", files: readTree("yaml") });
const entry = (machine, root, extra = {}) => ({ key: `${machine ?? ""}|${root}`, machine, root, name: "shop", workspace: null, ...extra });

test("one Machine: no Machine row; folded Collections show one row each", () => {
  const e = entry(null, "/c/shop");
  const rows = buildRows({ entries: [e], loaded: new Map([[e.key, { collection: shop }]]), isOpen: () => false });
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.depth]), [["collection", "Shop", 0]]);
  assert.equal(rows[0].count, 8);
});

test("Collections start unfolded and folders folded", () => {
  const e = entry(null, "/c/shop");
  const rows = buildRows({ entries: [e], loaded: new Map([[e.key, { collection: shop }]]), isOpen: (_k, d) => d });
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.kind, r.name, r.open ?? null]), [["collection", "Shop", true], ["request", "Get Health", null], ["folder", "Products", false]]);
});

test("open Collections and folders show their children in order with depth", () => {
  const e = entry(null, "/c/shop");
  const open = new Set([e.key, `${e.key}#products`]);
  const rows = buildRows({ entries: [e], loaded: new Map([[e.key, { collection: shop }]]), isOpen: (k) => open.has(k) });
  assert.deepEqual(rows.slice(0, 5).map((r) => [r.kind, r.name, r.depth]), [
    ["collection", "Shop", 0], ["request", "Get Health", 1], ["folder", "Products", 1], ["request", "List Products", 2], ["request", "Missing Product", 2],
  ]);
  assert.equal(rows[3].parent, `${e.key}#products`);
});

test("Machine rows show only when Collections live on more than one Machine", () => {
  const a = entry(null, "/c/shop"), b = entry("box", "/srv/shop");
  const rows = buildRows({ entries: [a, b], loaded: new Map() });
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.depth]), [["machine", "This computer", 0], ["collection", "shop", 1], ["machine", "box", 0], ["collection", "shop", 1]]);
});

test("the Global environment row heads a workspace's Collections only when it has Global environments", () => {
  const ws = { path: "/w/workspace.yml", globals: ["shared"] };
  const e = entry(null, "/c/shop", { workspace: ws.path });
  const rows = buildRows({ entries: [e], workspace: ws, globalOf: () => "shared" });
  assert.deepEqual(rows.map((r) => r.kind), ["global", "collection"]);
  assert.equal(rows[0].env, "shared");
  assert.deepEqual(buildRows({ entries: [e], workspace: { ...ws, globals: [] } }).map((r) => r.kind), ["collection"]);
});

test("keys: move, fold, unfold, parent, run, run many, pickers, file, leave", () => {
  const e = entry(null, "/c/shop");
  const open = new Set([e.key]);
  const rows = buildRows({ entries: [e], loaded: new Map([[e.key, { collection: shop }]]), isOpen: (k) => open.has(k) });
  const folder = rows.findIndex((r) => r.kind === "folder");
  assert.deepEqual(keyAction("down", rows, 0), { act: "move", to: 1 });
  assert.deepEqual(keyAction("up", rows, 0), { act: "move", to: 0 });
  assert.deepEqual(keyAction("left", rows, 0), { act: "fold", key: e.key, open: false });
  assert.deepEqual(keyAction("left", rows, 1), { act: "move", to: 0 });
  assert.deepEqual(keyAction("right", rows, folder), { act: "fold", key: rows[folder].key, open: true });
  assert.deepEqual(keyAction("enter", rows, folder), { act: "fold", key: rows[folder].key, open: true });
  assert.equal(keyAction("enter", rows, 1).act, "run");
  assert.equal(keyAction("r", rows, folder).act, "runMany");
  assert.equal(keyAction("r", rows, 0).act, "runMany");
  assert.equal(keyAction("e", rows, 1).act, "env");
  assert.equal(keyAction("o", rows, 1).act, "file");
  assert.equal(keyAction("o", rows, 0), null);
  assert.equal(keyAction("b", rows, 1).act, "bruno");
  assert.deepEqual(keyAction("escape", rows, 0), { act: "leave" });
});

test("Open Bruno is not offered for a Collection on another Machine", () => {
  const e = entry("box", "/srv/shop");
  const rows = buildRows({ entries: [e], loaded: new Map([[e.key, { collection: shop }]]), isOpen: () => false });
  assert.equal(keyAction("b", rows, 0), null);
});

test("findBlock finds the panel's block and whether it shows", () => {
  const root = { type: "row", children: [{ id: "main", type: "block", content: { tab: "active" } }, { id: "brunr", type: "block", hidden: true, content: { mod: "brunr" } }] };
  assert.deepEqual(findBlock(root, "brunr"), { id: "brunr", shown: false });
  assert.equal(findBlock({ type: "row", children: [] }, "brunr"), null);
});

test("confirmation and secret texts", () => {
  assert.equal(confirmText(12, "orders", "local"), 'Run 12 Requests in "orders" against local?');
  assert.equal(confirmText(1, "Shop", null), 'Run 1 Request in "Shop" against No Environment?');
  assert.equal(secretWarning(["apiKey"]), "Secret variables are empty in CLI Runs: apiKey. Move them to .env.");
  assert.equal(secretWarning([]), null);
});

test("runMark: the running folder shows a spinner and its count, the running Request a spinner", () => {
  const folder = { key: "c#products", kind: "folder", ck: "c", path: "products" };
  const list = { key: "c#products/List Products.yml", kind: "request", ck: "c", path: "products/List Products.yml" };
  const other = { ...list, ck: "d", key: "d#products/List Products.yml" };
  const run = { key: "c#products", ck: "c", progress: { done: 1, total: 4, running: { name: "List Products", path: "products/List Products.yml" } } };
  assert.deepEqual(runMark(folder, run), { spinner: true, count: "1/4" });
  assert.deepEqual(runMark(list, run), { spinner: true, count: null });
  assert.deepEqual(runMark(other, run), { spinner: false, count: null }, "the same path in another Collection");
  assert.deepEqual(runMark(list, { ...run, progress: { ...run.progress, running: null } }), { spinner: false, count: null });
  assert.deepEqual(runMark(folder, null), { spinner: false, count: null });
  assert.deepEqual(runMark(list, { key: list.key, ck: "c", progress: null }), { spinner: true, count: null }, "a single Request Run");
});

test("urlVariables lists each {{variable}} once, in order, without process.env ones", () => {
  assert.deepEqual(urlVariables("{{baseUrl}}/users/{{ id }}?k={{process.env.KEY}}&b={{baseUrl}}"), ["baseUrl", "id"]);
  assert.deepEqual(urlVariables("https://x.test/a"), []);
  assert.deepEqual(urlVariables(null), []);
});
