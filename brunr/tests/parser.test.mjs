import { test } from "node:test";
import assert from "node:assert/strict";
import * as p from "../mods/brunr/parser.js";
import { parseYaml } from "../mods/brunr/yaml.js";
import { readTree, deepFreeze } from "./helpers.mjs";

const load = (format, root = "/home/dev/Shop") => p.parseCollection(deepFreeze({ root, files: readTree(format) }));
const yaml = load("yaml");
const bru = load("bru");

/** A tree with file extensions removed, so the two formats compare equal. */
const shape = (nodes) => nodes.map((n) => ({
  ...n,
  ...(n.broken ? { name: n.name.replace(/\.(yml|bru)$/, ""), error: "(differs by format)" } : {}),
  path: n.kind === "request" ? n.path.replace(/\.(yml|bru)$/, "") : n.path,
  ...(n.kind === "folder" ? { children: shape(n.children) } : {}),
}));
const names = (nodes) => nodes.map((n) => n.name);

const request = (name, seq, extra = "") =>
  `info:\n  name: ${name}\n  type: http\n${seq == null ? "" : `  seq: ${seq}\n`}\nhttp:\n  method: GET\n  url: https://shop.example.test/${name}\n${extra}`;
const yamlFiles = (files) => deepFreeze({ "opencollection.yml": "opencollection: 1.0.0\ninfo:\n  name: T\n", ...files });

test("collectionFormat picks YAML first, then bru, else null", () => {
  assert.equal(p.collectionFormat(deepFreeze(["opencollection.yml", "bruno.json"])), "yaml");
  assert.equal(p.collectionFormat(["bruno.json", "collection.bru"]), "bru");
  assert.equal(p.collectionFormat(["package.json", "README.md"]), null);
  assert.equal(p.collectionFormat([]), null);
  assert.equal(p.collectionFormat(null), null);
});

test("isCollectionFile accepts config, folder, Request and Environment files of the format", () => {
  for (const f of ["opencollection.yml", "Get Health.yml", "products/folder.yml", "environments/local.yml", "a/b/c d.yml"]) {
    assert.equal(p.isCollectionFile(f, "yaml"), true, f);
  }
  for (const f of ["bruno.json", "collection.bru", "orders/folder.bru", "environments/local.bru", "x\\y.bru"]) {
    assert.equal(p.isCollectionFile(f, "bru"), true, f);
  }
});

test("isCollectionFile rejects .env, node_modules, .git, other formats and other files", () => {
  for (const f of [".env", "node_modules/x/a.yml", ".git/config", ".git/a.yml", "notes/readme.md", "Get Health.bru", "bruno.json", "data.yaml", ""]) {
    assert.equal(p.isCollectionFile(f, "yaml"), false, f);
  }
  assert.equal(p.isCollectionFile("opencollection.yml", "bru"), false);
  assert.equal(p.isCollectionFile("a.bru", "nope"), false);
});

test("both fixture formats give the same tree", () => {
  assert.equal(yaml.format, "yaml");
  assert.equal(bru.format, "bru");
  assert.deepEqual(shape(bru.children), shape(yaml.children));
});

test("the YAML fixture tree has Bruno's sidebar order, names and methods", () => {
  assert.deepEqual(names(yaml.children), ["Products", "Orders", "Broken.yml", "Get Health"]);
  const products = yaml.children[0];
  assert.deepEqual(names(products.children), ["top sellers", "List Products", "Product Page", "Missing Product"]);
  assert.deepEqual(names(yaml.children[1].children), ["Create Order", "slow-order", "Closed Port"]);
  assert.deepEqual(yaml.children[1].children[0], {
    kind: "request", name: "Create Order", path: "orders/Create Order.yml", seq: 1, type: "http", method: "POST", url: "{{baseUrl}}/orders",
  });
  assert.equal(products.children[2].method, "GET", "a lower-case method is upper-cased");
});

test("Collection name, root and default Environment come from the config", () => {
  for (const c of [yaml, bru]) {
    assert.equal(c.name, "Shop");
    assert.equal(c.root, "/home/dev/Shop");
    assert.equal(c.defaultEnvironment, "local");
  }
});

test("the YAML default Environment is read from extensions.bruno.presets, else top-level presets", () => {
  const ext = p.parseCollection({ root: "/c", files: { "opencollection.yml": "info:\n  name: A\nextensions:\n  bruno:\n    presets:\n      defaultEnvironment: dev\n" } });
  assert.equal(ext.defaultEnvironment, "dev");
  const top = p.parseCollection({ root: "/c", files: { "opencollection.yml": "info:\n  name: A\npresets:\n  defaultEnvironment: qa\n" } });
  assert.equal(top.defaultEnvironment, "qa");
  const none = p.parseCollection({ root: "/c", files: { "opencollection.yml": "info:\n  name: A\n" } });
  assert.equal(none.defaultEnvironment, null);
  const bruNone = p.parseCollection({ root: "/c", files: { "bruno.json": '{"name":"B"}' } });
  assert.equal(bruNone.defaultEnvironment, null);
  assert.equal(bruNone.name, "B");
});

test("Environments are sorted by name, list variables with secret flags, and never hold values", () => {
  for (const c of [yaml, bru]) {
    assert.deepEqual(c.environments.map((e) => e.name), ["local", "staging"]);
    assert.deepEqual(c.environments[0].variables, [
      { name: "baseUrl", secret: false }, { name: "shopId", secret: false }, { name: "apiKey", secret: true },
    ]);
    for (const e of c.environments) for (const v of e.variables) assert.deepEqual(Object.keys(v), ["name", "secret"]);
  }
  assert.ok(!JSON.stringify(yaml.environments).includes("47911"));
  assert.ok(!JSON.stringify(bru.environments).includes("47911"));
});

test("bru Environments skip disabled vars and read a one-line secret list", () => {
  const c = p.parseCollection({ root: "/c", files: {
    "bruno.json": '{"name":"B"}',
    "environments/b.bru": "vars {\n  host: x\n  ~old: y\n}\nvars:secret [token, key]\n",
    "environments/A.bru": "vars {\n}\n",
  } });
  assert.deepEqual(c.environments.map((e) => e.name), ["A", "b"]);
  assert.deepEqual(c.environments[1].variables, [{ name: "host", secret: false }, { name: "token", secret: true }, { name: "key", secret: true }]);
});

test("bru Environments with extends, color and annotations parse, names only", () => {
  const c = p.parseCollection({ root: "/c", files: {
    "bruno.json": '{"name":"B"}',
    "environments/qa.bru": "extends: base\nvars {\n  @description('has: a colon')\n  host: x\n}\nvars:secret [\n  @description('d')\n  token\n]\ncolor: #ff0000\n",
  } });
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.environments[0].variables, [{ name: "host", secret: false }, { name: "token", secret: true }]);
});

test("a malformed Request file goes in errors and stays in the tree as Bruno shows it, out of every count", () => {
  for (const c of [yaml, bru]) {
    assert.equal(c.errors.length, 1);
    assert.match(c.errors[0].path, /^Broken\.(yml|bru)$/);
    assert.match(c.errors[0].message, /line \d+|not closed/);
    const n = p.findNode(c, c.errors[0].path);
    assert.deepEqual(n, { kind: "request", broken: true, error: c.errors[0].message, name: c.errors[0].path, path: c.errors[0].path, seq: null, type: "http", method: "", url: "" });
    assert.equal(p.countRequests(c), 8);
    assert.equal(p.countRequests(n), 0);
  }
});

test("order: folders first by name then placed by seq, then Requests by seq (none counts as 1), ties by name ignoring case", () => {
  const c = p.parseCollection({ root: "/c", files: yamlFiles({
    "zeta.yml": request("zeta", null),
    "Alpha.yml": request("Alpha", null),
    "beta.yml": request("beta", 2),
    "Gamma.yml": request("Gamma", 2),
    "delta.yml": request("delta", 1),
    "dir/folder.yml": "info:\n  name: Dir\n  type: folder\n  seq: 3\n",
    "dir/x.yml": request("x", 1),
    "nodir/x.yml": request("x", 1),
    "10.yml": request("ten", 10),
  }) });
  assert.deepEqual(names(c.children), ["nodir", "Dir", "Alpha", "delta", "zeta", "beta", "Gamma", "ten"]);
});

test("folder order follows Bruno's sortByNameThenSequence: seq places a folder, equal seqs stay together", () => {
  const folder = (dir, name, seq) => ({ [`${dir}/folder.yml`]: `info:\n  name: ${name}\n  type: folder\n${seq ? `  seq: ${seq}\n` : ""}` });
  const c = p.parseCollection({ root: "/c", files: yamlFiles({
    ...folder("a", "alpha", null), ...folder("b", "bravo", 1), ...folder("c", "charlie", null),
    ...folder("d", "delta", 1), ...folder("e", "echo", 5), "r.yml": request("r", 1),
  }) });
  assert.deepEqual(names(c.children), ["bravo", "delta", "alpha", "charlie", "echo", "r"]);
});

test("name fallbacks: a folder without a folder file uses the directory, a Request without a name uses the file", () => {
  const top = yaml.children[0].children[0];
  assert.equal(top.kind, "folder");
  assert.equal(top.name, "top sellers");
  assert.equal(top.seq, null);
  const slow = p.findNode(yaml, "orders/slow-order.yml");
  assert.equal(slow.name, "slow-order");
  assert.equal(p.findNode(bru, "orders/slow-order.bru").name, "slow-order");
  const blank = p.parseCollection({ root: "/c", files: yamlFiles({ "a/folder.yml": "info:\n  type: folder\n  seq: 1\n", "a/r.yml": request("r", 1) }) });
  assert.equal(blank.children[0].name, "a");
});

test("a folder with only a folder file is a node; directories with only non-request files are not", () => {
  assert.equal(p.findNode(yaml, "notes"), null);
  const c = p.parseCollection({ root: "/c", files: yamlFiles({
    "only-folder/folder.yml": "info:\n  name: Empty\n  type: folder\n",
    "docs/readme.md": "hi",
    "scripts/setup.yml": "info:\n  name: setup\n  type: script\n",
    "a.yml": request("a", 1),
  }) });
  assert.deepEqual(names(c.children), ["Empty", "a"]);
  assert.deepEqual(p.findNode(c, "only-folder").children, []);
  assert.deepEqual(c.errors, []);
});

test("non-http types keep their type, and the method is the type when there is none", () => {
  const c = p.parseCollection({ root: "/c", files: yamlFiles({
    "g.yml": "info:\n  name: Search\n  type: graphql\n  seq: 1\ngraphql:\n  method: POST\n  url: https://shop.example.test/graphql\n",
    "r.yml": "info:\n  name: Stock\n  type: grpc\n  seq: 2\ngrpc:\n  url: grpc://shop.example.test\n  method: /shop.Stock/Get\n",
    "w.yml": "info:\n  name: Feed\n  type: websocket\n  seq: 3\nwebsocket:\n  url: wss://shop.example.test/feed\n",
  }) });
  assert.deepEqual(c.children.map((n) => [n.type, n.method, n.url]), [
    ["graphql", "POST", "https://shop.example.test/graphql"],
    ["grpc", "GRPC", "grpc://shop.example.test"],
    ["websocket", "WEBSOCKET", "wss://shop.example.test/feed"],
  ]);
});

test("bru reads the http block form and non-http blocks", () => {
  const c = p.parseCollection({ root: "/c", files: {
    "bruno.json": '{"name":"B"}',
    "a.bru": "meta {\n  name: A\n  seq: 1\n}\n\nhttp {\n  method: patch\n  url: https://shop.example.test/a\n}\n",
    "b.bru": "meta {\n  name: B\n  type: graphql\n  seq: 2\n}\n\npost {\n  url: https://shop.example.test/gql\n  body: graphql\n}\n\nbody:graphql {\n  {\n    products { id }\n  }\n}\n",
    "c.bru": "meta {\n  name: C\n  type: ws\n  seq: 3\n}\n\nws {\n  url: wss://shop.example.test/feed\n}\n",
  } });
  assert.deepEqual(c.children.map((n) => [n.name, n.type, n.method, n.url]), [
    ["A", "http", "PATCH", "https://shop.example.test/a"],
    ["B", "graphql", "POST", "https://shop.example.test/gql"],
    ["C", "ws", "WS", "wss://shop.example.test/feed"],
  ]);
});

test("Request files that are not requests go in errors without dropping others", () => {
  const c = p.parseCollection({ root: "/c", files: yamlFiles({
    "no-info.yml": "http:\n  method: GET\n  url: x\n",
    "no-type.yml": "info:\n  name: x\n",
    "no-method.yml": "info:\n  name: x\n  type: http\nhttp:\n  url: x\n",
    "list.yml": "- a\n- b\n",
    "ok.yml": request("ok", 1),
  }) });
  assert.deepEqual(c.errors.map((e) => e.path).sort(), ["list.yml", "no-info.yml", "no-method.yml", "no-type.yml"]);
  assert.deepEqual(c.children.filter((n) => !n.broken).map((n) => n.name), ["ok"]);
  assert.deepEqual(c.children.filter((n) => n.broken).map((n) => n.name).sort(), ["list.yml", "no-info.yml", "no-method.yml", "no-type.yml"]);
});

test("long nested sections, block scalars and comments in a request are skipped", () => {
  const extra = [
    "  # a comment",
    "runtime:",
    "  scripts:",
    "    - type: before-request",
    "      code: |-",
    "        const x = { a: 1 };",
    "",
    "        bru.setVar('k: v', x);",
    "    - type: tests",
    "      code: >",
    "        folded: text",
    "docs: |",
    "  # not a comment",
    "  - not a list",
    "settings:",
    "  encodeUrl: true # trailing comment",
  ].join("\n");
  const c = p.parseCollection({ root: "/c", files: yamlFiles({ "a.yml": request("a", 1) + extra }) });
  assert.deepEqual(c.errors, []);
  assert.equal(c.children[0].url, "https://shop.example.test/a");
});

test("CRLF line endings parse the same as LF", () => {
  const crlf = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.replace(/\n/g, "\r\n")]));
  for (const f of ["yaml", "bru"]) {
    const c = p.parseCollection(deepFreeze({ root: "/home/dev/Shop", files: crlf(readTree(f)) }));
    const lf = f === "yaml" ? yaml : bru;
    assert.deepEqual(c.children, lf.children);
    assert.deepEqual(c.environments, lf.environments);
    assert.equal(c.defaultEnvironment, "local");
  }
});

test("Windows-style roots and backslash file keys become forward slashes", () => {
  const files = Object.fromEntries(Object.entries(readTree("yaml")).map(([k, v]) => [k.replace(/\//g, "\\"), v]));
  const c = p.parseCollection(deepFreeze({ root: "C:\\Users\\dev\\My Shop\\", files }));
  assert.equal(c.root, "C:/Users/dev/My Shop");
  assert.deepEqual(c.children, yaml.children);
  assert.equal(p.parseCollection({ root: "C:/", files: {} }).root, "C:/");
});

test("a folder without a config file is reported, not thrown", () => {
  const c = p.parseCollection({ root: "/home/dev/Loose", files: { "a.yml": request("a", 1) } });
  assert.equal(c.format, null);
  assert.equal(c.name, "Loose");
  assert.deepEqual(c.children, []);
  assert.equal(c.errors.length, 1);
});

test("a broken config keeps the tree and falls back to the directory name", () => {
  const c = p.parseCollection({ root: "/home/dev/Shop", files: { "bruno.json": "{ nope", "a.bru": "meta {\n  name: A\n}\nget {\n  url: x\n}\n" } });
  assert.equal(c.name, "Shop");
  assert.deepEqual(c.errors.map((e) => e.path), ["bruno.json"]);
  assert.deepEqual(names(c.children), ["A"]);
});

test("parseCollection does not mutate its frozen input", () => {
  const input = deepFreeze({ root: "/c", files: readTree("yaml") });
  const before = JSON.stringify(input);
  p.parseCollection(input);
  assert.equal(JSON.stringify(input), before);
});

test("countRequests counts requests under a Collection, a folder and a request", () => {
  assert.equal(p.countRequests(yaml), 8);
  assert.equal(p.countRequests(p.findNode(yaml, "products")), 4);
  assert.equal(p.countRequests(p.findNode(yaml, "products/top sellers")), 1);
  assert.equal(p.countRequests(p.findNode(yaml, "Get Health.yml")), 1);
  assert.equal(p.countRequests(null), 0);
});

test("findNode finds folders and requests by path, including spaces, and returns null otherwise", () => {
  assert.equal(p.findNode(yaml, "products/top sellers").kind, "folder");
  assert.equal(p.findNode(yaml, "products/top sellers/Best Sellers.yml").name, "Best Sellers");
  assert.equal(p.findNode(yaml, "products\\List Products.yml").name, "List Products");
  assert.equal(p.findNode(yaml, "products/Nope.yml"), null);
  assert.equal(p.findNode(yaml, ""), null);
  assert.equal(p.findNode(null, "x"), null);
});

test("parseWorkspace reads the workspace name and Collection paths with forward slashes", () => {
  const text = [
    "opencollection: 1.0.0",
    "info:",
    '  name: "My Workspace"',
    "  type: workspace",
    "",
    "collections:",
    '  - name: "Sample API Collection"',
    '    path: "C:/Users/someone/Documents/bruno/Sample API Collection"',
    '  - name: "Shop"',
    "    path: 'C:\\Users\\someone\\Documents\\bruno\\Shop'",
    "  - name: no path",
    "",
    "specs:",
    "",
    "docs: ''",
  ].join("\r\n");
  assert.deepEqual(p.parseWorkspace(deepFreeze(text)), {
    name: "My Workspace",
    collections: [
      { name: "Sample API Collection", path: "C:/Users/someone/Documents/bruno/Sample API Collection" },
      { name: "Shop", path: "C:/Users/someone/Documents/bruno/Shop" },
    ],
  });
});

test("parseWorkspace gives an empty result for bad or empty text", () => {
  const empty = { name: "", collections: [] };
  for (const t of ["", null, undefined, "just text", "- a\n- b", "info:\n  name: x\n bad: indent\n", "collections: [unclosed"]) {
    assert.deepEqual(p.parseWorkspace(t), empty, String(t));
  }
  assert.deepEqual(p.parseWorkspace("info:\n  name: W\ncollections:\n"), { name: "W", collections: [] });
});

test("parseYaml reads maps, lists of maps, scalars, flow collections and block scalars", () => {
  const doc = parseYaml([
    "a: 1",
    "b: '2'",
    'c: "x\\ty \\"q\\""',
    "d: ~",
    "e:",
    "f: true",
    "g: [node_modules, .git, 'x y']",
    "h: { k: v, n: 3 }",
    "list:",
    "- name: one",
    "  value: http://a.example.test:80/x",
    "- plain",
    "lit: |",
    "  line 1",
    "    indented",
    "",
    "  line 3",
    "fold: >-",
    "  one",
    "  two",
    "keep: |+",
    "  k",
    "",
    "desc: a: b",
  ].join("\n"));
  assert.deepEqual(doc, {
    a: 1, b: "2", c: 'x\ty "q"', d: null, e: null, f: true,
    g: ["node_modules", ".git", "x y"], h: { k: "v", n: 3 },
    list: [{ name: "one", value: "http://a.example.test:80/x" }, "plain"],
    lit: "line 1\n  indented\n\nline 3\n", fold: "one two", keep: "k\n\n", desc: "a: b",
  });
  assert.equal(parseYaml(""), null);
  assert.equal(parseYaml("# only a comment\n"), null);
});

test("parseYaml throws with a line number on input it cannot read", () => {
  assert.throws(() => parseYaml("a: 1\nb\n"), /line 2/);
  assert.throws(() => parseYaml("a: 1\n   b: 2\n"), /line 2/);
  assert.throws(() => parseYaml("a: 'open\n"), /line 1/);
  assert.throws(() => parseYaml("a:\n\tb: 1\n"), /tabs/);
  assert.throws(() => parseYaml("a: [1, 2\n"), /line 1/);
});
