import { test } from "node:test";
import assert from "node:assert/strict";
import { readTree, deepFreeze } from "./helpers.mjs";
import { parseCollection } from "../mods/brunr/parser.js";
import * as ops from "../mods/brunr/fileops.js";
import { readHead, setName, setSeq, setUrl } from "../mods/brunr/edit.js";
import { buildRows } from "../mods/brunr/tree.js";
import { carryDraft, currentIndex, derivedFile, dropAction, dropIndex, dropZone, formErrors, moveTargets, rowMenu, stepIndex } from "../mods/brunr/treeops.js";

const load = (format, root) => deepFreeze(parseCollection({ root, files: readTree(format) }));
const shop = load("yaml", "/r");
const other = load("yaml", "/s");
const bruShop = load("bru", "/b");
const CK = { "|/r": shop, "|/s": other, "|/b": bruShop };
const collectionOf = (ck) => CK[ck] ?? null;
const row = (ck, path, extra = {}) => {
  const c = CK[ck];
  const n = path ? c.children.flatMap(function all(x) { return [x, ...(x.children ?? []).flatMap(all)]; }).find((x) => x.path === path) : null;
  return { key: path ? `${ck}#${path}` : ck, kind: path ? n.kind : "collection", ck, path, machine: null, name: n?.name ?? c.name, ...(n?.broken ? { broken: true } : {}), ...extra };
};
const R = (path, extra) => row("|/r", path, extra);
const drop = (dragged, over, y) => dropAction({ dragged, over, y, collectionOf });
const order = (c, dir) => ops.sequenceOrder(c, dir).map((n) => n.name);

/** Applies a reorder's or move's index to the numbering list, as fileops does, and gives the new order. */
function after(c, op, args) {
  const files = readTree("yaml");
  const texts = {};
  for (const p of ops.needs({ op, ...args }, c)) texts[p] = files[p] ?? null;
  const out = ops[op]({ collection: c, texts, ...args });
  assert.equal(out.error, undefined, out.error);
  return out;
}

test("the fixture's numbering lists, as the tests below use them", () => {
  assert.deepEqual(order(shop, ""), ["Get Health", "Products", "Orders"]);
  assert.deepEqual(order(shop, "products"), ["List Products", "Product Page", "Missing Product", "top sellers"]);
  assert.deepEqual(shop.children[0].children.map((n) => n.name), ["top sellers", "List Products", "Product Page", "Missing Product"], "the panel shows folders first");
});

test("dropIndex: above a target takes its place, below one after it, counting the item's own removal", () => {
  assert.equal(dropIndex(shop, "products", "products/Missing Product.yml", "products/List Products.yml", "above"), 0);
  assert.equal(dropIndex(shop, "products", "products/Missing Product.yml", "products/List Products.yml", "below"), 1);
  assert.equal(dropIndex(shop, "products", "products/List Products.yml", "products/Missing Product.yml", "below"), 2, "own place before the target is removed first");
  assert.equal(dropIndex(shop, "orders", null, "orders/Closed Port.yml", "below"), 3, "an item from elsewhere is not in the list");
  assert.equal(dropIndex(shop, "", "Get Health.yml", "Broken.yml", "above"), null, "a file that does not parse has no place");
});

test("stepIndex: Move up and down act among the item's own group as displayed, and give the order the person saw", () => {
  assert.deepEqual(stepIndex(shop, "products/Missing Product.yml", -1), { index: 1 });
  assert.deepEqual(stepIndex(shop, "products/List Products.yml", 1), { index: 1 });
  assert.equal(stepIndex(shop, "products/List Products.yml", -1), null, "first Request: no Move up");
  assert.equal(stepIndex(shop, "products/Missing Product.yml", 1), null, "last Request: no Move down");
  assert.equal(stepIndex(shop, "products/top sellers", -1), null, "a folder moves among folders only");
  assert.equal(stepIndex(shop, "products/top sellers", 1), null);
  assert.deepEqual(stepIndex(shop, "orders", -1), { index: 1 });
  assert.equal(stepIndex(shop, "products", -1), null);
  assert.equal(stepIndex(shop, "Broken.yml", 1), null);
  // The displayed order after the reorder runs, re-parsed.
  const out = after(shop, "reorder", { path: "products/Missing Product.yml", ...stepIndex(shop, "products/Missing Product.yml", -1) });
  const files = { ...readTree("yaml") };
  for (const e of out.effects) files[e.path.slice(shop.root.length + 1)] = e.text;
  const again = parseCollection({ root: "/r", files });
  assert.deepEqual(again.children[0].children.map((n) => n.name), ["top sellers", "List Products", "Missing Product", "Product Page"]);
  const root = after(shop, "reorder", { path: "orders", ...stepIndex(shop, "orders", -1) });
  const f2 = { ...readTree("yaml") };
  for (const e of root.effects) f2[e.path.slice(shop.root.length + 1)] = e.text;
  assert.deepEqual(parseCollection({ root: "/r", files: f2 }).children.filter((n) => n.kind === "folder").map((n) => n.name), ["Orders", "Products"]);
  assert.equal(currentIndex(shop, "orders"), 2);
});

test("dropZone: thirds on a folder, halves on a Request, inside on a Collection", () => {
  assert.deepEqual([0.1, 0.5, 0.9].map((y) => dropZone({ kind: "folder" }, y)), ["above", "inside", "below"]);
  assert.deepEqual([0.1, 0.49, 0.5, 0.9].map((y) => dropZone({ kind: "request" }, y)), ["above", "above", "below", "below"]);
  assert.equal(dropZone({ kind: "collection" }, 0.1), "inside");
  assert.equal(dropZone({ kind: "machine" }, 0.5), null);
});

test("dropAction: onto a folder or Collection moves inside, between rows places it", () => {
  assert.deepEqual(drop(R("Get Health.yml"), R("orders"), 0.5), { zone: "inside", run: { op: "move", ck: "|/r", path: "Get Health.yml", to: "orders", index: null } });
  assert.deepEqual(drop(R("products/List Products.yml"), R(""), 0.5), { zone: "inside", run: { op: "move", ck: "|/r", path: "products/List Products.yml", to: "", index: null } });
  assert.deepEqual(drop(R("products/Missing Product.yml"), R("products/List Products.yml"), 0.2), { zone: "above", run: { op: "reorder", ck: "|/r", path: "products/Missing Product.yml", index: 0 } });
  assert.deepEqual(drop(R("Get Health.yml"), R("orders/Closed Port.yml"), 0.8), { zone: "below", run: { op: "move", ck: "|/r", path: "Get Health.yml", to: "orders", index: 3 } });
  assert.deepEqual(drop(R("Get Health.yml"), R("orders"), 0.1), { zone: "above", run: { op: "reorder", ck: "|/r", path: "Get Health.yml", index: 1 } }, "the top third of a folder row is between rows");
  // A drop between the last folder and the first Request goes after the folder in Bruno's numbering.
  assert.deepEqual(drop(R("products/Missing Product.yml"), R("products/top sellers"), 0.9).run, { op: "reorder", ck: "|/r", path: "products/Missing Product.yml", index: 3 });
});

test("dropAction refuses with no highlight: itself, its own folders, its current parent, no change, another Machine", () => {
  assert.equal(drop(R("products"), R("products"), 0.5).refuse, "onto itself");
  assert.match(drop(R("products"), R("products/top sellers"), 0.5).refuse, /itself/);
  assert.match(drop(R("products"), R("products/List Products.yml"), 0.2).refuse, /itself/, "a row inside the folder, between rows");
  assert.equal(drop(R("products/List Products.yml"), R("products"), 0.5).refuse, "already there");
  assert.equal(drop(R("Get Health.yml"), R(""), 0.5).refuse, "already there");
  assert.equal(drop(R("products/Product Page.yml"), R("products/List Products.yml"), 0.8).refuse, "no change");
  assert.match(drop(R("Get Health.yml"), R("orders", { machine: "box" }), 0.5).refuse, /this computer/);
  assert.match(drop(R("Get Health.yml", { machine: "box" }), R("orders"), 0.5).refuse, /this computer/);
  assert.ok(drop(R(""), R("orders"), 0.5).refuse, "a Collection cannot be dragged");
  for (const r of [drop(R("products"), R("products/top sellers"), 0.5), drop(R("products/List Products.yml"), R("products"), 0.5)]) assert.equal(r.zone, undefined);
});

test("dropAction between Collections: the same format moves, another format is refused with a toast", () => {
  assert.deepEqual(drop(R("Get Health.yml"), row("|/s", "orders"), 0.5), { zone: "inside", run: { op: "moveBetween", ck: "|/r", targetCk: "|/s", path: "Get Health.yml", to: "orders", index: null } });
  assert.deepEqual(drop(R("Get Health.yml"), row("|/s", "orders/Create Order.yml"), 0.1).run, { op: "moveBetween", ck: "|/r", targetCk: "|/s", path: "Get Health.yml", to: "orders", index: 0 });
  assert.deepEqual(drop(R("Get Health.yml"), row("|/s", ""), 0.5).run.to, "", "onto the other Collection's row: its root");
  const no = drop(R("Get Health.yml"), row("|/b", "orders"), 0.5);
  assert.equal(no.run, undefined);
  assert.match(no.toast, /same format\. "Shop" is YAML and "Shop" is bru\./);
});

test("dropAction with a file that does not parse: it moves, but not between rows of its own folder", () => {
  assert.equal(drop(R("Broken.yml"), R("Get Health.yml"), 0.8).refuse, "a file that does not parse has no place in the order");
  assert.deepEqual(drop(R("Broken.yml"), R("orders"), 0.5).run, { op: "move", ck: "|/r", path: "Broken.yml", to: "orders", index: null });
});

test("moveTargets: the Collection root and its folders, indented, then same-format Collections; its own folder greyed out, a folder's subtree left out", () => {
  const all = [{ ck: "|/r", collection: shop, machine: null }, { ck: "|/b", collection: bruShop, machine: null }, { ck: "|/s", collection: other, machine: null }, { ck: "box|/x", collection: other, machine: "box" }];
  const req = moveTargets(R("products/List Products.yml"), all);
  assert.deepEqual(req.map((o) => [o.label, o.depth, o.value, o.disabled ?? false]), [
    ["Shop", 0, "|/r#", false], ["Products", 1, "|/r#products", true], ["top sellers", 2, "|/r#products/top sellers", false], ["Orders", 1, "|/r#orders", false],
    ["Shop", 0, "|/s#", false], ["Products", 1, "|/s#products", false], ["top sellers", 2, "|/s#products/top sellers", false], ["Orders", 1, "|/s#orders", false],
  ]);
  assert.equal(req[0].header, true);
  const folder = moveTargets(R("products"), all);
  assert.deepEqual(folder.filter((o) => o.value.startsWith("|/r")).map((o) => [o.label, o.disabled ?? false]), [["Shop", true], ["Orders", false]], "not the root (its parent), not itself or its subfolders");
  assert.ok(folder.some((o) => o.value === "|/s#products"), "the other Collection's folder of the same name is offered");
  assert.deepEqual(moveTargets(R("Get Health.yml", { machine: "box" }), all), []);
});

test("formErrors and derivedFile: Bruno's name messages under the fields", () => {
  assert.deepEqual(formErrors("newRequest", { name: " ", file: "" }), { name: "Name cannot be empty.", file: "Name cannot be empty." });
  assert.deepEqual(formErrors("newFolder", { name: "Ok", file: "CON" }), { file: "Name cannot be a reserved device name." });
  assert.match(formErrors("clone", { name: "a", file: "a/b" }).file, /Invalid character '\/'/);
  assert.deepEqual(formErrors("rename", { name: "Fine", file: "Fine" }), {});
  assert.deepEqual(formErrors("renameFile", { name: "", file: "fixed" }), {}, "a file that does not parse is renamed by file name only");
  assert.equal(derivedFile("List: all?"), "List- all-");
});

test("carryDraft: a rename or renumbering under a Draft is made in the Draft too", () => {
  const base = "info:\n  name: A\n  type: http\n  seq: 1\n\nhttp:\n  method: GET\n  url: https://x.test/a\n";
  const text = setUrl(base, "yaml", "https://x.test/edited");
  const written = setSeq(setName(base, "yaml", "B"), "yaml", 3);
  const out = carryDraft({ base, text }, written, "yaml");
  assert.equal(out.base, written);
  assert.deepEqual([readHead(out.text, "yaml").name, readHead(out.text, "yaml").seq, readHead(out.text, "yaml").url], ["B", 3, "https://x.test/edited"]);
  assert.equal(carryDraft({ base, text }, base, "yaml").text, text, "no change on disk, no change in the Draft");
  const bru = "meta {\n  name: A\n  type: http\n  seq: 1\n}\n\nget {\n  url: x\n}\n";
  assert.equal(readHead(carryDraft({ base: bru, text: bru.replace("url: x", "url: y") }, setName(bru, "bru", "C"), "bru").text, "bru").name, "C");
});

test("rowMenu: the entries and keys for each row, nothing to edit on another Machine, off while busy", () => {
  const labels = (items) => items.map((i) => `${i.label}${i.hint ? ` [${i.hint}]` : ""}${i.disabled ? " (off)" : ""}`);
  assert.deepEqual(labels(rowMenu(R("products/Product Page.yml"), { up: true, down: true })), [
    "Open [o]", "Run [Enter]", "Clone", "Rename [F2]", "Move to… [m]", "Move up [Alt+Up]", "Move down [Alt+Down]", "Delete [Del]",
  ]);
  assert.deepEqual(labels(rowMenu(R("products"), { up: true })), [
    "Run folder [r]", "New Request [n]", "New folder [Shift+N]", "Rename [F2]", "Move to… [m]", "Move up [Alt+Up]", "Move down [Alt+Down] (off)", "Delete [Del]",
  ]);
  assert.deepEqual(labels(rowMenu(R(""))), ["Run Collection [r]", "New Request [n]", "New folder [Shift+N]", "Environments…", "Edit .env…"]);
  assert.deepEqual(labels(rowMenu(R("", { machine: "box" }), { canRun: false })), ["Run Collection [r] (off)"]);
  assert.deepEqual(labels(rowMenu(R("Broken.yml"))), ["Open [o]", "Rename [F2]", "Move to… [m]", "Delete [Del]"]);
  assert.deepEqual(labels(rowMenu(R("products/Product Page.yml", { machine: "box" }), { canRun: false })), ["Open [o]", "Run [Enter] (off)"]);
  assert.ok(rowMenu(R("products"), { busy: true, up: true, down: true }).filter((i) => i.action !== "runMany").every((i) => i.disabled));
});

test("the panel's rows carry a file that does not parse, marked, with its parse message", () => {
  const e = { key: "|/r", machine: null, root: "/r", name: "Shop", workspace: null };
  const rows = buildRows({ entries: [e], loaded: new Map([[e.key, { collection: shop }]]), isOpen: (k) => k === e.key });
  const b = rows.find((r) => r.path === "Broken.yml");
  assert.equal(b.broken, true);
  assert.equal(b.name, "Broken.yml");
  assert.match(b.error, /line \d+/);
  assert.equal(rows[0].count, 8, "not counted");
});
