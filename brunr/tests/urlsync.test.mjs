import { test } from "node:test";
import assert from "node:assert/strict";
import { readTree } from "./helpers.mjs";
import { setUrl } from "../mods/brunr/edit.js";
import { paramsForUrl, parsePathParams, parseQueryParams, setUrlFromBar, splitOnFirst } from "../mods/brunr/urlsync.js";

const yamlList = readTree("yaml")["products/List Products.yml"];
const bruList = readTree("bru")["products/List Products.bru"];

/** The lines of `b` that are not in `a` at the same place, after the shared head and tail. */
function changed(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  return { removed: x.slice(head, x.length - tail), added: y.slice(head, y.length - tail) };
}

test("Bruno's URL parsing: first ? outside {{ }}, & pairs before #, not decoded; :name and OData path params", () => {
  assert.deepEqual(splitOnFirst("{{h?x}}/a?b=1", "?"), ["{{h?x}}/a", "b=1"]);
  assert.deepEqual(splitOnFirst("x", "?"), ["x"]);
  assert.deepEqual(parseQueryParams("flag&a=1=2&=x&c=%20#frag"), [{ name: "flag", value: undefined }, { name: "a", value: "1=2" }, { name: "c", value: "%20" }]);
  assert.deepEqual(parsePathParams("{{baseUrl}}/shops/:shop/items/:id/:shop"), ["shop", "id"]);
  assert.deepEqual(parsePathParams("https://x.test/Items(id=:id,k=':key')/:sub"), ["id", "key", "sub"]);
  assert.deepEqual(parsePathParams(""), []);
});

test("paramsForUrl: the URL's query, new path params, the disabled query as it was, the path params still used", () => {
  const old = [
    { name: "a", value: "1", type: "query", enabled: true, description: "dropped, as in Bruno" },
    { name: "off", value: "z", type: "query", enabled: false, description: "kept" },
    { name: "id", value: "7", type: "path", enabled: true, description: "kept" },
    { name: "gone", value: "", type: "path", enabled: true },
    { name: "hidden", value: "", type: "path", enabled: false },
  ];
  const next = paramsForUrl(old, "{{u}}/:org/:id?a=2&b");
  assert.deepEqual(next.map((p) => [p.name, p.value, p.type, p.enabled]), [
    ["a", "2", "query", true], ["b", undefined, "query", true], ["org", "", "path", true], ["off", "z", "query", false], ["id", "7", "path", true],
  ]);
  assert.equal(next[3], old[1], "a kept param is the same entry");
  assert.equal(next[4], old[2]);
});

test("YAML: adding a query param writes a params block after the headers, Bruno's shape, nothing else changes", () => {
  const out = setUrlFromBar(yamlList, "yaml", "{{baseUrl}}/products?shop={{shopId}}&limit=2");
  const lines = out.split("\n");
  const at = lines.indexOf("  params:");
  assert.ok(at > lines.indexOf("      value: fixture-list"), "after the headers");
  assert.deepEqual(lines.slice(at, at + 7), ["  params:", "    - name: shop", '      value: "{{shopId}}"', "      type: query", "    - name: limit", '      value: "2"', "      type: query"]);
  assert.equal(out.replace(lines.slice(at, at + 7).join("\n") + "\n", ""), setUrl(yamlList, "yaml", "{{baseUrl}}/products?shop={{shopId}}&limit=2"), "only the url line and the new block");
});

test("YAML: removing the last query param removes the block; no block and no query changes only the url line", () => {
  const withBlock = setUrlFromBar(yamlList, "yaml", "{{baseUrl}}/products?limit=2");
  assert.equal(setUrlFromBar(withBlock, "yaml", "{{baseUrl}}/products"), setUrl(yamlList, "yaml", "{{baseUrl}}/products"));
  assert.equal(setUrlFromBar(yamlList, "yaml", "{{baseUrl}}/items"), setUrl(yamlList, "yaml", "{{baseUrl}}/items"));
});

test("YAML: disabled params and their descriptions stay byte for byte; path params keep their values; CRLF stays", () => {
  const text = [
    "info:", "  name: P", "  type: http", "", "http:", "  method: GET", "  url: https://x.test/u/:id?a=1", "  params:",
    "    - name: a", "      value: \"1\"", "      type: query", "      description: old note",
    "    - name: off", "      value: z", "      type: query", "      description:", "        content: kept note", "      disabled: true",
    "    - name: id", "      value: \"42\"", "      type: path", "  auth: inherit", "",
  ].join("\r\n");
  const out = setUrlFromBar(text, "yaml", "https://x.test/u/:id/:sub?a=2");
  assert.equal(out, [
    "info:", "  name: P", "  type: http", "", "http:", "  method: GET", "  url: https://x.test/u/:id/:sub?a=2", "  params:",
    "    - name: a", "      value: \"2\"", "      type: query",
    "    - name: sub", "      value: \"\"", "      type: path",
    "    - name: off", "      value: z", "      type: query", "      description:", "        content: kept note", "      disabled: true",
    "    - name: id", "      value: \"42\"", "      type: path", "  auth: inherit", "",
  ].join("\r\n"));
  const plain = "info:\n  name: P\n  type: http\n\nhttp:\n  method: GET\n  url: https://x.test/?a=1\n  params:\n    - name: a\n      value: '1'\n      type: query\n";
  assert.equal(setUrlFromBar(plain, "yaml", "https://x.test/?a=1"), plain, "the same params: the block is not touched");
  assert.equal(setUrlFromBar(plain, "yaml", "https://x.test/v?a=1"), plain.replace("x.test/?a=1", "x.test/v?a=1"));
});

test("bru: the URL bar rewrites params:query, keeps ~disabled entries with their annotations, adds params:path after it", () => {
  const out = setUrlFromBar(bruList, "bru", "{{baseUrl}}/products?limit=2");
  assert.deepEqual(changed(bruList, out), {
    removed: ["  url: {{baseUrl}}/products?shop={{shopId}}", "  body: none", "  auth: none", "}", "", "params:query {", "  shop: {{shopId}}"],
    added: ["  url: {{baseUrl}}/products?limit=2", "  body: none", "  auth: none", "}", "", "params:query {", "  limit: 2"],
  });
  const text = "meta {\n  name: P\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://x.test/u?a=1\n}\n\nparams:query {\n  @description('gone')\n  a: 1\n  @description('stays')\n  ~off: z\n}\n\nheaders {\n  x: y\n}\n";
  assert.equal(setUrlFromBar(text, "bru", "https://x.test/u/:id?a=1&b"),
    "meta {\n  name: P\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://x.test/u/:id?a=1&b\n}\n\nparams:query {\n  a: 1\n  b: \n  @description('stays')\n  ~off: z\n}\n\nparams:path {\n  id: \n}\n\nheaders {\n  x: y\n}\n");
});

test("bru: removing every param removes the blocks and their blank line; no params and no query changes only the url line", () => {
  const out = setUrlFromBar(bruList, "bru", "{{baseUrl}}/products");
  assert.equal(out, setUrl(bruList, "bru", "{{baseUrl}}/products").replace("params:query {\n  shop: {{shopId}}\n}\n\n", ""));
  const bare = "meta {\n  name: P\n  type: http\n}\n\npost {\n  url: https://x.test/a\n  body: json\n}\n\nbody:json {\n  {}\n}";
  assert.equal(setUrlFromBar(bare, "bru", "https://x.test/b"), setUrl(bare, "bru", "https://x.test/b"));
  assert.equal(setUrlFromBar(bare, "bru", "https://x.test/b?q=1"), "meta {\n  name: P\n  type: http\n}\n\npost {\n  url: https://x.test/b?q=1\n  body: json\n}\n\nparams:query {\n  q: 1\n}\n\nbody:json {\n  {}\n}");
});

test("a Request type without params, or a file with no url line, only gets setUrl", () => {
  const ws = "info:\n  name: W\n  type: websocket\n\nwebsocket:\n  url: wss://x.test/a\n";
  assert.equal(setUrlFromBar(ws, "yaml", "wss://x.test/a?x=1"), setUrl(ws, "yaml", "wss://x.test/a?x=1"));
  const none = "info:\n  name: N\n  type: http\n";
  assert.equal(setUrlFromBar(none, "yaml", "https://x.test/?a=1"), none);
});
