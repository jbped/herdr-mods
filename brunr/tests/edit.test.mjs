import { test } from "node:test";
import assert from "node:assert/strict";
import * as e from "../mods/brunr/edit.js";
import { parseCollection } from "../mods/brunr/parser.js";
import { readTree, deepFreeze } from "./helpers.mjs";

const EXT = { yaml: "yml", bru: "bru" };
const REQUESTS = ["Get Health", "orders/Create Order", "orders/Closed Port", "orders/slow-order", "products/List Products", "products/Missing Product", "products/Product Page", "products/top sellers/Best Sellers"];
const crlf = (t) => t.replace(/\r?\n/g, "\r\n");
const noFinal = (t) => t.replace(/\r?\n$/, "");

/** Every fixture Request text in a format, as LF, CRLF and without a final newline. */
function variants(format) {
  const files = readTree(format);
  return REQUESTS.flatMap((r) => {
    const t = files[`${r}.${EXT[format]}`];
    return [["lf", t], ["crlf", crlf(t)], ["no final newline", noFinal(t)], ["crlf, no final newline", noFinal(crlf(t))]].map(([kind, text]) => ({ name: `${r} (${kind})`, text: deepFreeze(text) }));
  });
}

/** The raw lines (with endings) that differ: `{ at, removed, added }` after a common prefix and suffix. */
function diff(a, b) {
  const split = (t) => t.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const x = split(a), y = split(b);
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  return { at: p, removed: x.slice(p, x.length - s), added: y.slice(p, y.length - s) };
}

for (const format of ["yaml", "bru"]) {
  const eol = (t) => (t.includes("\r\n") ? "\r\n" : "\n");
  const end = (t, line) => (line === t.split(/\r?\n/).length - 1 && !/\n$/.test(t) ? "" : eol(t));

  test(`${format}: setName changes only the name line, in every fixture Request and line-ending variant`, () => {
    for (const { name, text } of variants(format)) {
      const head = e.readHead(text, format);
      const out = e.setName(text, format, "Renamed Thing");
      const d = diff(text, out);
      if (head.lines.name === null) {
        assert.equal(d.removed.length, 0, name);
        assert.equal(d.added.length, 1, name);
      } else {
        assert.equal(d.at, head.lines.name - 1, name);
        assert.equal(d.removed.length, 1, name);
        assert.equal(d.added.length, 1, name);
      }
      assert.equal(d.added[0], `  name: Renamed Thing${end(out, d.at)}`, name);
      assert.equal(e.readHead(out, format).name, "Renamed Thing", name);
    }
  });

  test(`${format}: setSeq changes or adds only the seq line`, () => {
    for (const { name, text } of variants(format)) {
      const head = e.readHead(text, format);
      const out = e.setSeq(text, format, 7);
      const d = diff(text, out);
      assert.equal(d.removed.length, head.lines.seq === null ? 0 : 1, name);
      assert.equal(d.added.length, 1, name);
      assert.equal(d.added[0].trimEnd(), "  seq: 7", name);
      assert.equal(e.readHead(out, format).seq, 7, name);
      if (head.seq !== null) assert.equal(e.setSeq(text, format, head.seq), text, name);
    }
  });

  test(`${format}: setMethod and setUrl change only their line`, () => {
    for (const { name, text } of variants(format)) {
      const head = e.readHead(text, format);
      const m = e.setMethod(text, format, "PUT");
      const dm = diff(text, m);
      assert.equal(dm.at, head.lines.method - 1, name);
      assert.equal(dm.removed.length, 1, name);
      assert.equal(dm.added.length, 1, name);
      assert.equal(e.readHead(m, format).method, "PUT", name);
      const u = e.setUrl(text, format, "{{baseUrl}}/changed?x=1");
      const du = diff(text, u);
      assert.equal(du.at, head.lines.url - 1, name);
      assert.deepEqual([du.removed.length, du.added.length], [1, 1], name);
      assert.equal(e.readHead(u, format).url, "{{baseUrl}}/changed?x=1", name);
    }
  });
}

test("readHead reads the fixture heads in both formats", () => {
  const y = readTree("yaml"), b = readTree("bru");
  assert.deepEqual(e.readHead(y["orders/Create Order.yml"], "yaml"), {
    name: "Create Order", type: "http", seq: 1, method: "POST", url: "{{baseUrl}}/orders",
    lines: { name: 2, seq: 4, method: 7, url: 8 },
  });
  assert.deepEqual(e.readHead(b["orders/Create Order.bru"], "bru"), {
    name: "Create Order", type: "http", seq: 1, method: "POST", url: "{{baseUrl}}/orders",
    lines: { name: 2, seq: 4, method: 7, url: 8 },
  });
  const slow = e.readHead(y["orders/slow-order.yml"], "yaml");
  assert.deepEqual([slow.name, slow.seq, slow.lines.name, slow.lines.seq], [null, null, null, null]);
  assert.equal(e.readHead(y["products/Product Page.yml"], "yaml").method, "GET");
});

test("setSeq adds the line after type, else after name, else at the end of the section", () => {
  assert.equal(e.setSeq("info:\n  name: A\n  type: http\n\nhttp:\n  method: GET\n", "yaml", 3), "info:\n  name: A\n  type: http\n  seq: 3\n\nhttp:\n  method: GET\n");
  assert.equal(e.setSeq("info:\n  name: A\nhttp:\n  method: GET\n", "yaml", 3), "info:\n  name: A\n  seq: 3\nhttp:\n  method: GET\n");
  assert.equal(e.setSeq("meta {\n  name: A\n}\n", "bru", 2), "meta {\n  name: A\n  seq: 2\n}\n");
  assert.equal(e.setSeq("meta {\n}\n", "bru", 2), "meta {\n  seq: 2\n}\n");
});

test("yaml values are written as Bruno's yaml writer writes them", () => {
  const set = (v) => e.setUrl("info:\n  name: A\n  type: http\nhttp:\n  method: GET\n  url: x\n", "yaml", v).split("http:\n")[1];
  assert.equal(set("{{baseUrl}}/a"), '  method: GET\n  url: "{{baseUrl}}/a"\n');
  assert.equal(set("https://x.test/a"), "  method: GET\n  url: https://x.test/a\n");
  assert.equal(set("a\nb"), "  method: GET\n  url: |-\n    a\n    b\n");
  assert.equal(e.setName("info:\n  name: A\n", "yaml", "true"), 'info:\n  name: "true"\n');
  assert.equal(e.setName("info:\n  name: A\n", "yaml", 'say "hi"'), 'info:\n  name: say "hi"\n');
  assert.equal(e.setName("info:\n  name: A\n", "yaml", '"hi" there'), "info:\n  name: '\"hi\" there'\n");
});

test("a multi-line YAML value is replaced as a whole", () => {
  const t = "info:\n  name: A\n  type: http\nhttp:\n  method: GET\n  url: |-\n    a\n    b\n  body:\n    type: none\n";
  assert.equal(e.setUrl(t, "yaml", "z"), "info:\n  name: A\n  type: http\nhttp:\n  method: GET\n  url: z\n  body:\n    type: none\n");
});

test("bru setMethod renames the verb block, or uses an http block for a custom method", () => {
  const t = deepFreeze("meta {\n  name: A\n  type: http\n  seq: 1\n}\n\nget {\n  url: x\n  body: none\n  auth: none\n}\n");
  assert.equal(e.setMethod(t, "bru", "POST"), t.replace("get {", "post {"));
  const custom = e.setMethod(t, "bru", "purge");
  assert.equal(custom, t.replace("get {", "http {\n  method: purge"));
  assert.equal(e.readHead(custom, "bru").method, "PURGE");
  assert.equal(e.setMethod(custom, "bru", "PROPFIND"), t.replace("get {", "http {\n  method: propfind"));
  assert.equal(e.setMethod(custom, "bru", "delete"), t.replace("get {", "delete {"));
});

test("bru setUrl writes a multi-line URL in Bruno's ''' form and replaces it as a whole", () => {
  const t = "meta {\n  name: A\n}\n\nget {\n  url: x\n}\n";
  const multi = e.setUrl(t, "bru", "a\nb");
  assert.equal(multi, "meta {\n  name: A\n}\n\nget {\n  url: '''\n    a\n    b\n'''\n}\n");
  assert.equal(e.readHead(multi, "bru").url, "a\nb");
});

test("canSetMethod and canSetUrl follow the lines the file has", () => {
  const y = readTree("yaml"), b = readTree("bru");
  assert.equal(e.canSetMethod(y["Get Health.yml"], "yaml"), true);
  assert.equal(e.canSetMethod(b["Get Health.bru"], "bru"), true);
  assert.equal(e.canSetUrl(y["Get Health.yml"], "yaml"), true);
  assert.equal(e.canSetMethod("info:\n  name: A\n  type: http\nhttp:\n  url: x\n", "yaml"), false);
  assert.equal(e.canSetUrl("info:\n  name: A\n  type: http\nhttp:\n  method: GET\n", "yaml"), false);
  const grpc = "info:\n  name: S\n  type: grpc\ngrpc:\n  url: grpc://x\n  method: /a.B/C\n";
  assert.equal(e.canSetMethod(grpc, "yaml"), false);
  assert.equal(e.canSetUrl(grpc, "yaml"), true);
  assert.equal(e.canSetMethod("meta {\n  name: W\n  type: ws\n}\nws {\n  url: wss://x\n}\n", "bru"), false);
  assert.equal(e.canSetUrl("meta {\n  name: W\n  type: ws\n}\nws {\n  url: wss://x\n}\n", "bru"), true);
  assert.equal(e.canSetMethod("not a request", "bru"), false);
  const noMethod = "info:\n  name: A\n  type: http\nhttp:\n  url: x\n";
  assert.equal(e.setMethod(noMethod, "yaml", "POST"), noMethod, "a disabled control changes nothing");
});

// The expected texts are what @usebruno/filestore's stringifyRequest and stringifyFolder produce.
test("newRequestText is what Bruno writes for a new HTTP Request", () => {
  assert.equal(e.newRequestText({ format: "yaml", name: "New Req", method: "GET", url: "https://shop.example.test/a", seq: 3 }),
    "info:\n  name: New Req\n  type: http\n  seq: 3\n\nhttp:\n  method: GET\n  url: https://shop.example.test/a\n  auth: inherit\n\nsettings:\n  encodeUrl: true\n  timeout: 0\n  followRedirects: true\n  maxRedirects: 5\n  forwardAuthorizationHeader: false\n");
  assert.equal(e.newRequestText({ format: "bru", name: "New Req", method: "GET", url: "https://shop.example.test/a", seq: 3 }),
    "meta {\n  name: New Req\n  type: http\n  seq: 3\n}\n\nget {\n  url: https://shop.example.test/a\n  body: none\n  auth: inherit\n}\n\nsettings {\n  encodeUrl: true\n  forwardAuthorizationHeader: false\n}\n");
});

test("newRequestText adds the URL's query and path params and handles a custom method", () => {
  const url = "https://x.test/u/:id?q=1&a b:c";
  assert.equal(e.newRequestText({ format: "yaml", name: "N: a", method: "PURGE", url, seq: 1 }),
    'info:\n  name: "N: a"\n  type: http\n  seq: 1\n\nhttp:\n  method: PURGE\n  url: https://x.test/u/:id?q=1&a b:c\n  params:\n    - name: q\n      value: "1"\n      type: query\n    - name: a b:c\n      value: ""\n      type: query\n    - name: id\n      value: ""\n      type: path\n  auth: inherit\n\nsettings:\n  encodeUrl: true\n  timeout: 0\n  followRedirects: true\n  maxRedirects: 5\n  forwardAuthorizationHeader: false\n');
  assert.equal(e.newRequestText({ format: "bru", name: "N: a", method: "PURGE", url, seq: 1 }),
    'meta {\n  name: N: a\n  type: http\n  seq: 1\n}\n\nhttp {\n  method: purge\n  url: https://x.test/u/:id?q=1&a b:c\n  body: none\n  auth: inherit\n}\n\nparams:query {\n  q: 1\n  "a b:c": \n}\n\nparams:path {\n  id: \n}\n\nsettings {\n  encodeUrl: true\n  forwardAuthorizationHeader: false\n}\n');
  assert.deepEqual(e.urlParams("{{base}}/a?x={{v}}&y"), [{ name: "x", value: "{{v}}", type: "query" }, { name: "y", value: "", type: "query" }]);
  assert.equal(e.newRequestText({ format: "yaml", name: " ", url: "", seq: 1 }).split("\n")[1], "  name: Untitled Request");
});

test("newFolderText and ensureFolderFile are what Bruno writes for a folder", () => {
  assert.equal(e.newFolderText({ format: "yaml", name: "My Folder", seq: 4 }), "info:\n  name: My Folder\n  type: folder\n  seq: 4\n\nrequest:\n  auth: inherit\n");
  assert.equal(e.newFolderText({ format: "bru", name: "My Folder", seq: 4 }), "meta {\n  name: My Folder\n  seq: 4\n}\n\nauth {\n  mode: inherit\n}\n");
  assert.equal(e.ensureFolderFile({ format: "yaml", dirName: "dir", seq: 2 }), "info:\n  name: dir\n  type: folder\n  seq: 2\n\nrequest: {}\n");
  assert.equal(e.ensureFolderFile({ format: "bru", dirName: "dir", name: "Dir" }), "meta {\n  name: Dir\n}\n");
  const y = readTree("yaml")["products/folder.yml"];
  assert.equal(e.ensureFolderFile({ format: "yaml", dirName: "products", text: y, seq: 5 }), y.replace("seq: 2", "seq: 5"));
  assert.equal(e.ensureFolderFile({ format: "yaml", dirName: "products", text: crlf(y), name: "Catalogue" }), crlf(y).replace("name: Products", "name: Catalogue"));
  const b = readTree("bru")["orders/folder.bru"];
  assert.equal(e.ensureFolderFile({ format: "bru", dirName: "orders", text: b, name: "Sales", seq: 1 }), b.replace("Orders", "Sales").replace("seq: 3", "seq: 1"));
  assert.equal(e.setName("request: {}\n", "yaml", "X"), "info:\n  name: X\n\nrequest: {}\n");
});

test("the files the writers produce parse as Requests and folders in the parser", () => {
  for (const format of ["yaml", "bru"]) {
    const ext = EXT[format];
    const files = {
      [format === "yaml" ? "opencollection.yml" : "bruno.json"]: format === "yaml" ? "opencollection: 1.0.0\ninfo:\n  name: T\n" : '{"name":"T"}',
      [`a.${ext}`]: e.newRequestText({ format, name: "A", method: "POST", url: "{{baseUrl}}/a?x=1", seq: 2 }),
      [`d/folder.${ext}`]: e.newFolderText({ format, name: "D", seq: 1 }),
      [`d/b.${ext}`]: e.setMethod(e.setUrl(e.newRequestText({ format, name: "B", method: "GET", url: "x", seq: 1 }), format, "{{baseUrl}}/b"), format, "DELETE"),
    };
    const c = parseCollection({ root: "/t", files });
    assert.deepEqual(c.errors, [], format);
    assert.deepEqual(c.children.map((n) => [n.kind, n.name, n.seq]), [["folder", "D", 1], ["request", "A", 2]], format);
    assert.deepEqual([c.children[0].children[0].method, c.children[0].children[0].url], ["DELETE", "{{baseUrl}}/b"], format);
  }
});

// Expected outputs taken from `yaml` 2.x stringify({ v }, { defaultStringType: "PLAIN", lineWidth: 0, … }).
test("yamlScalar quotes exactly where Bruno's yaml library does", () => {
  const cases = {
    plain: "plain", true: '"true"', True: '"True"', yes: "yes", null: '"null"', "~": '"~"', 123: '"123"', "1.5": '"1.5"',
    "0x1F": '"0x1F"', "1e3": '"1e3"', ".5": '".5"', "": '""', "  lead": '"  lead"', "trail ": '"trail "', "a: b": '"a: b"',
    "a:b": "a:b", "http://x:80/y": "http://x:80/y", "a #b": '"a #b"', "a#b": "a#b", "#x": '"#x"', "{{baseUrl}}/x": '"{{baseUrl}}/x"',
    "[x": '"[x"', "@x": '"@x"', "*x": '"*x"', "&x": '"&x"', "!x": '"!x"', "|x": '"|x"', ">x": '">x"', "'x": "\"'x\"", '"x': "'\"x'",
    "%x": '"%x"', ",x": '",x"', "- x": '"- x"', "-x": "-x", "? x": '"? x"', ":x": ":x", "`x": '"`x"', "a\tb": "a\tb", "tab\t": '"tab\\t"',
    "2026-01-01": "2026-01-01", ".inf": '".inf"', '{"a":1}': "'{\"a\":1}'", "it's": "it's", "x\u0007": '"x\\a"', "---x": "---x",
  };
  for (const [value, want] of Object.entries(cases)) assert.equal(e.yamlScalar(value, "  "), want, JSON.stringify(value));
  assert.equal(e.yamlScalar("line1\nline2", "  "), "|-\n  line1\n  line2");
  assert.equal(e.yamlScalar("line1\nline2\n", "    "), "|\n    line1\n    line2");
  assert.equal(e.yamlScalar(" line\nx", "  "), "|2-\n   line\n  x");
  assert.equal(e.yamlScalar("tail\n\n", "  "), "|+\n  tail\n");
  assert.equal(e.yamlScalar(" \n ", "  "), '"\\ \\n "');
});
