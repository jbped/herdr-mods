import { test } from "node:test";
import assert from "node:assert/strict";
import * as ops from "../mods/brunr/fileops.js";
import { parseCollection } from "../mods/brunr/parser.js";
import { readHead } from "../mods/brunr/edit.js";
import { readTree, deepFreeze } from "./helpers.mjs";

const ROOT = { yaml: "C:/Users/dev/My Shop", bru: "/home/dev/shop api" };
const EXT = { yaml: "yml", bru: "bru" };
const shop = (format, root = ROOT[format]) => {
  const files = deepFreeze(readTree(format));
  return { files, collection: deepFreeze(parseCollection({ root, files })) };
};

/** Runs an operation the way the boundary does: needs, then the operation with exactly those texts. */
function call(name, args, { files, collection }) {
  const texts = {};
  for (const p of ops.needs({ op: name, ...args }, collection)) texts[p] = files[p] ?? null;
  const out = ops[name](deepFreeze({ collection, texts, ...args }));
  return { ...out, texts };
}

/** Effects with the root removed: ["write", rel, "new" | "edit"], ["move", from, to], … */
const brief = (format, effects) => effects.map((e) => {
  const rel = (p) => p.slice(ROOT[format].length + 1);
  if (e.op === "write") return ["write", rel(e.path), e.expected === null ? "new" : "edit"];
  if (e.op === "move") return ["move", rel(e.from), rel(e.to)];
  return [e.op, rel(e.path)];
});

const writeOf = (out, rel) => out.effects.find((e) => e.op === "write" && e.path.endsWith(`/${rel}`));
const seqIn = (format, out, rel) => readHead(writeOf(out, rel).text, format).seq;

for (const format of ["yaml", "bru"]) {
  const x = EXT[format];
  const s = shop(format);

  test(`${format}: newRequest writes a new file numbered after the folder's items, with the clash rule`, () => {
    const out = call("newRequest", { parent: "products", name: "List Products", method: "POST", url: "{{baseUrl}}/products" }, s);
    assert.deepEqual(brief(format, out.effects), [["write", `products/List Products 1.${x}`, "new"]]);
    assert.deepEqual(out.result, { path: `products/List Products 1.${x}`, name: "List Products" });
    const head = readHead(out.effects[0].text, format);
    assert.deepEqual([head.name, head.seq, head.method, head.url], ["List Products", 5, "POST", "{{baseUrl}}/products"]);
    assert.deepEqual(out.texts, {}, "a new Request reads nothing");
    const root = call("newRequest", { name: "Ping", url: "{{baseUrl}}/health" }, s);
    assert.equal(root.result.path, `Ping.${x}`);
    assert.equal(seqIn(format, root, `Ping.${x}`), 4, "three items at the root, plus one");
  });

  test(`${format}: newRequest rejects bad names and avoids the files Bruno reserves`, () => {
    assert.deepEqual(call("newRequest", { name: "  " }, s), { error: "Name cannot be empty.", texts: {} });
    assert.equal(call("newRequest", { name: "CON" }, s).error, "Name cannot be a reserved device name.");
    assert.match(call("newRequest", { name: "x", fileName: "a/b" }, s).error, /Invalid character '\/'/);
    assert.match(call("newRequest", { parent: "nope", name: "x" }, s).error, /no folder nope/);
    assert.equal(call("newRequest", { name: "a:b?" }, s).result.path, `a-b-.${x}`, "the file name is sanitized");
    assert.equal(call("newRequest", { parent: "orders", name: "folder" }, s).result.path, `orders/folder 1.${x}`);
    assert.equal(call("newRequest", { name: "broken" }, s).result.path, `broken 1.${x}`, "a file with errors still takes its name");
    assert.equal(call("newFolder", { name: "Environments" }, s).result.path, "Environments 1", "the environments directory is taken, ignoring case");
  });

  test(`${format}: cloneRequest copies the file as <name> copy, numbered after the folder's Requests`, () => {
    const out = call("cloneRequest", { path: `orders/Create Order.${x}` }, s);
    assert.deepEqual(Object.keys(out.texts), [`orders/Create Order.${x}`]);
    assert.deepEqual(brief(format, out.effects), [["write", `orders/Create Order copy.${x}`, "new"]]);
    const text = out.effects[0].text;
    const source = s.files[`orders/Create Order.${x}`];
    assert.deepEqual([readHead(text, format).name, readHead(text, format).seq], ["Create Order copy", 4]);
    assert.equal(text.split("\n").length, source.split("\n").length, "only the name and seq lines change");
    const named = call("cloneRequest", { path: `orders/Create Order.${x}`, name: "Order Again" }, s);
    assert.equal(named.result.path, `orders/Order Again.${x}`);
    assert.match(call("cloneRequest", { path: "orders" }, s).error, /no Request/);
  });

  test(`${format}: newFolder makes the directory and a folder file with auth inherit`, () => {
    const out = call("newFolder", { parent: "", name: "Orders" }, s);
    assert.deepEqual(brief(format, out.effects), [["mkdir", "Orders 1"], ["write", `Orders 1/folder.${x}`, "new"]]);
    assert.match(out.effects[1].text, format === "yaml" ? /name: Orders\n {2}type: folder\n {2}seq: 4\n\nrequest:\n {2}auth: inherit/ : /name: Orders\n {2}seq: 4\n}\n\nauth {\n {2}mode: inherit/);
    assert.deepEqual(out.result, { path: "Orders 1", name: "Orders" });
    assert.equal(call("newFolder", { parent: "products", name: "a/b" }, s).result.path, "products/a-b");
    assert.equal(call("newFolder", { name: "LPT1" }, s).error, "Name cannot be a reserved device name.");
  });

  test(`${format}: renameItem changes the name inside the file, and the file name only when asked`, () => {
    const p = `products/List Products.${x}`;
    const name = call("renameItem", { path: p, name: "All Products" }, s);
    assert.deepEqual(brief(format, name.effects), [["write", p, "edit"]]);
    assert.equal(readHead(name.effects[0].text, format).name, "All Products");
    const file = call("renameItem", { path: p, name: "All Products", fileName: "Missing Product" }, s);
    assert.deepEqual(brief(format, file.effects), [["move", p, `products/Missing Product 1.${x}`], ["write", `products/Missing Product 1.${x}`, "edit"]]);
    assert.equal(file.effects[1].expected, s.files[p]);
    const caseOnly = call("renameItem", { path: p, name: "List Products", fileName: "list products" }, s);
    assert.deepEqual(brief(format, caseOnly.effects), [["move", p, `products/list products.${x}`]], "a case-only rename keeps the name");
    assert.equal(call("renameItem", { path: p, name: "x", fileName: "bad." }, s).error, "Special characters aren't allowed in the name. Invalid character '.'.");
  });

  test(`${format}: renaming a folder writes its folder file, creating one when it has none`, () => {
    const orders = call("renameItem", { path: "orders", name: "Sales", fileName: "sales" }, s);
    assert.deepEqual(brief(format, orders.effects), [["write", `orders/folder.${x}`, "edit"], ["move", "orders", "sales"]]);
    const top = call("renameItem", { path: "products/top sellers", name: "Best" }, s);
    assert.deepEqual(Object.keys(top.texts), [`products/top sellers/folder.${x}`]);
    assert.deepEqual(brief(format, top.effects), [["write", `products/top sellers/folder.${x}`, "new"]]);
    assert.equal(readHead(top.effects[0].text, format).name, "Best");
  });

  test(`${format}: deleteItem trashes the item and renumbers only the siblings whose number changes`, () => {
    const out = call("deleteItem", { path: "products" }, s);
    assert.deepEqual(Object.keys(out.texts), [`orders/folder.${x}`]);
    assert.deepEqual(brief(format, out.effects), [["trash", "products"], ["write", `orders/folder.${x}`, "edit"]]);
    assert.equal(readHead(out.effects[1].text, format).seq, 2);
    assert.deepEqual(brief(format, call("deleteItem", { path: `orders/Create Order.${x}` }, s).effects), [["trash", `orders/Create Order.${x}`]],
      "slow-order (no seq, so 1) and Closed Port (2) keep their numbers");
    const req = call("deleteItem", { path: `products/List Products.${x}` }, s);
    assert.deepEqual(brief(format, req.effects), [["trash", `products/List Products.${x}`], ["write", `products/top sellers/folder.${x}`, "new"]],
      "Product Page keeps 1, Missing Product keeps 2, top sellers gets 3 in a new folder file");
    assert.equal(readHead(req.effects[1].text, format).seq, 3);
  });

  test(`${format}: reorder numbers the folder's items 1 to n and writes only changed ones`, () => {
    assert.deepEqual(ops.sequenceOrder(s.collection, "orders").map((n) => n.name), ["Create Order", "slow-order", "Closed Port"]);
    const out = call("reorder", { path: `orders/Closed Port.${x}`, index: 0 }, s);
    assert.deepEqual(brief(format, out.effects).map((e) => e[1]), [`orders/Closed Port.${x}`, `orders/Create Order.${x}`, `orders/slow-order.${x}`]);
    assert.deepEqual([1, 2, 3], [seqIn(format, out, `Closed Port.${x}`), seqIn(format, out, `Create Order.${x}`), seqIn(format, out, `slow-order.${x}`)]);
    assert.deepEqual(brief(format, call("reorder", { path: `orders/Create Order.${x}`, index: 0 }, s).effects).map((e) => e[1]), [`orders/slow-order.${x}`, `orders/Closed Port.${x}`],
      "the order stays but the numbers become 1, 2, 3");
    assert.deepEqual(call("reorder", { path: `Get Health.${x}`, index: 0 }, s).effects, [], "no number changes, no effect");
    const top = call("reorder", { path: `Get Health.${x}`, index: 2 }, s);
    assert.deepEqual(brief(format, top.effects).map((e) => e[1]), [`products/folder.${x}`, `orders/folder.${x}`, `Get Health.${x}`]);
  });

  test(`${format}: move into a folder keeps the item's number and renumbers the source`, () => {
    const out = call("move", { path: `products/Missing Product.${x}`, to: "orders" }, s);
    assert.deepEqual(brief(format, out.effects), [
      ["move", `products/Missing Product.${x}`, `orders/Missing Product.${x}`],
      ["write", `products/Product Page.${x}`, "edit"], ["write", `products/top sellers/folder.${x}`, "new"],
    ], "the moved item's file is not rewritten; the source folder is numbered 1 to n");
    assert.equal(seqIn(format, out, `Product Page.${x}`), 2);
    const first = call("move", { path: `products/List Products.${x}`, to: "" }, s);
    assert.deepEqual(brief(format, first.effects)[0], ["move", `products/List Products.${x}`, `List Products.${x}`]);
    assert.ok(first.effects.slice(1).every((e) => e.path.includes("/products/")), "only source siblings are written");
    const clash = call("move", { path: `orders/Create Order.${x}`, to: "products" }, s);
    assert.equal(clash.result.path, `products/Create Order.${x}`);
    const folder = call("move", { path: "products/top sellers", to: "orders" }, s);
    assert.deepEqual(brief(format, folder.effects)[0], ["move", "products/top sellers", "orders/top sellers"]);
    assert.deepEqual(call("move", { path: `orders/Create Order.${x}`, to: "orders" }, s).effects, []);
  });

  test(`${format}: move between rows renumbers the target and places the item`, () => {
    const out = call("move", { path: `Get Health.${x}`, to: "orders", index: 1 }, s);
    assert.deepEqual(brief(format, out.effects)[0], ["move", `Get Health.${x}`, `orders/Get Health.${x}`]);
    assert.equal(seqIn(format, out, `orders/Get Health.${x}`), 2);
    assert.equal(writeOf(out, `orders/Get Health.${x}`).expected, s.files[`Get Health.${x}`]);
    assert.deepEqual([seqIn(format, out, `slow-order.${x}`), seqIn(format, out, `Closed Port.${x}`)], [3, 4]);
    assert.equal(writeOf(out, `orders/Create Order.${x}`), undefined, "Create Order keeps 1");
  });

  test(`${format}: a folder cannot move into itself or its own folders`, () => {
    assert.match(call("move", { path: "products", to: "products" }, s).error, /cannot move into itself/);
    assert.match(call("move", { path: "products", to: "products/top sellers" }, s).error, /cannot move into itself/);
    assert.match(call("move", { path: "products", to: "nope" }, s).error, /no folder nope/);
  });

  test(`${format}: moveBetween moves into another Collection of the same format`, () => {
    const t = shop(format, ROOT[format] + " 2");
    const args = { target: t.collection, path: `products/Product Page.${x}`, to: "orders", index: 0 };
    const sourceNeeds = ops.needs({ op: "moveBetween", ...args }, s.collection);
    const targetNeeds = ops.needs({ op: "moveBetween", side: "target", ...args }, s.collection);
    assert.deepEqual(targetNeeds, [`orders/Create Order.${x}`, `orders/slow-order.${x}`, `orders/Closed Port.${x}`]);
    const pick = (files, list) => Object.fromEntries(list.map((p) => [p, files[p] ?? null]));
    const out = ops.moveBetween(deepFreeze({ collection: s.collection, texts: pick(s.files, sourceNeeds), targetTexts: pick(t.files, targetNeeds), ...args }));
    assert.deepEqual(out.effects[0], { op: "move", from: `${ROOT[format]}/products/Product Page.${x}`, to: `${ROOT[format]} 2/orders/Product Page.${x}` });
    assert.ok(out.effects.slice(1).filter((e) => e.path.startsWith(`${ROOT[format]} 2/`)).length === 3, "three target Requests renumber");
    assert.equal(out.result.path, `orders/Product Page.${x}`);
  });
}

test("moveBetween refuses Collections of different formats", () => {
  const y = shop("yaml"), b = shop("bru");
  const out = ops.moveBetween({ collection: y.collection, texts: {}, target: b.collection, targetTexts: {}, path: "Get Health.yml", to: "" });
  assert.match(out.error, /same format.*YAML.*bru/);
});

test("Environment operations in both formats", () => {
  for (const format of ["yaml", "bru"]) {
    const x = EXT[format];
    const s = shop(format);
    const made = call("newEnvironment", { name: "qa/1" }, s);
    assert.deepEqual(brief(format, made.effects), [["write", `environments/qa-1.${x}`, "new"]]);
    assert.equal(made.effects[0].text, format === "yaml" ? "name: qa-1\n" : "vars {\n}\n");
    assert.equal(call("newEnvironment", { name: "Local" }, s).result.name, "Local copy", "Bruno's copy suffix, ignoring case");
    const clone = call("cloneEnvironment", { from: "local", name: "local" }, s);
    assert.deepEqual(clone.result, { name: "local copy", path: `environments/local copy.${x}` });
    assert.equal(clone.effects[0].text, format === "yaml" ? s.files["environments/local.yml"].replace("name: local", "name: local copy") : s.files["environments/local.bru"]);
    const renamed = call("renameEnvironment", { name: "local", newName: "dev" }, s);
    assert.deepEqual(Object.keys(renamed.texts), [`environments/local.${x}`, `environments/staging.${x}`]);
    assert.deepEqual(brief(format, renamed.effects), format === "yaml"
      ? [["move", "environments/local.yml", "environments/dev.yml"], ["write", "environments/dev.yml", "edit"]]
      : [["move", "environments/local.bru", "environments/dev.bru"]]);
    assert.match(call("renameEnvironment", { name: "local", newName: "Staging" }, s).error, /already exists/);
    assert.deepEqual(brief(format, call("deleteEnvironment", { name: "staging" }, s).effects), [["trash", `environments/staging.${x}`]]);
    assert.match(call("deleteEnvironment", { name: "nope" }, s).error, /no Environment/);
  }
});

test("renameEnvironment updates other Environments' extends, as Bruno does", () => {
  for (const format of ["yaml", "bru"]) {
    const x = EXT[format];
    const files = { ...readTree(format) };
    files[`environments/qa.${x}`] = format === "yaml" ? "name: qa\nextends: local\nvariables:\n  - name: shopId\n    value: \"3\"\n" : "extends: local\nvars {\n  shopId: 3\n}\n";
    const s = { files, collection: parseCollection({ root: ROOT[format], files }) };
    const out = call("renameEnvironment", { name: "local", newName: "dev" }, s);
    const qa = writeOf(out, `environments/qa.${x}`);
    assert.equal(qa.text, files[`environments/qa.${x}`].replace("extends: local", "extends: dev"), format);
  }
});

test("newEnvironment creates the environments directory when the Collection has none", () => {
  const c = parseCollection({ root: "/t", files: { "opencollection.yml": "info:\n  name: T\n" } });
  const out = ops.newEnvironment({ collection: c, texts: {}, name: "dev" });
  assert.deepEqual(out.effects.map((e) => [e.op, e.path]), [["mkdir", "/t/environments"], ["write", "/t/environments/dev.yml"]]);
  assert.equal(out.effects[0].existsOk, true);
});

test("a folder with no seq gets a folder file when its number changes", () => {
  const files = deepFreeze({
    "opencollection.yml": "info:\n  name: T\n",
    "a.yml": "info:\n  name: a\n  type: http\n  seq: 1\nhttp:\n  method: GET\n  url: x\n",
    "z/r.yml": "info:\n  name: r\n  type: http\n  seq: 1\nhttp:\n  method: GET\n  url: x\n",
  });
  const c = deepFreeze(parseCollection({ root: "/t", files }));
  const out = call("reorder", { path: "z", index: 0 }, { files, collection: c });
  assert.deepEqual(out.effects.map((e) => [e.path, e.expected]), [["/t/z/folder.yml", null], ["/t/a.yml", files["a.yml"]]]);
  assert.equal(out.effects[0].text, "info:\n  name: z\n  type: folder\n  seq: 1\n\nrequest: {}\n");
});

test("an operation given too few texts returns an error instead of guessing", () => {
  const { collection } = shop("yaml");
  assert.match(ops.cloneRequest({ collection, texts: {}, path: "Get Health.yml" }).error, /needs the current text of Get Health.yml/);
  assert.match(ops.deleteItem({ collection, texts: {}, path: "products" }).error, /needs the current text/);
});

for (const format of ["yaml", "bru"]) {
  const x = EXT[format];
  test(`${format}: a Request file that does not parse is renamed by file name, moved and deleted, never cloned, reordered or numbered`, () => {
    const s = shop(format);
    const broken = `Broken.${x}`;
    assert.match(call("cloneRequest", { path: broken }, s).error, /does not parse/);
    assert.match(call("reorder", { path: broken, index: 0 }, s).error, /does not parse/);
    const renamed = call("renameItem", { path: broken, name: "ignored", fileName: "Fixed later" }, s);
    assert.deepEqual(brief(format, renamed.effects), [["move", broken, `Fixed later.${x}`]], "its text is not read or written");
    assert.deepEqual(renamed.texts, {});
    assert.deepEqual(renamed.result, { path: `Fixed later.${x}`, name: `Fixed later.${x}` });
    const moved = call("move", { path: broken, to: "orders", index: 0 }, s);
    assert.deepEqual(brief(format, moved.effects), [["move", broken, `orders/Broken.${x}`]], "moved to the end, nothing renumbered");
    const del = call("deleteItem", { path: broken }, s);
    assert.deepEqual(brief(format, del.effects), [["trash", broken]], "its siblings keep their numbers");
    assert.equal(ops.sequenceOrder(s.collection, "").some((n) => n.broken), false);
    assert.equal(call("newRequest", { name: "Ping" }, s).effects[0].text.includes(format === "yaml" ? "seq: 4" : "seq: 4"), true, "not counted for a new number");
  });
}
