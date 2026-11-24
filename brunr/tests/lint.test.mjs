import { test } from "node:test";
import assert from "node:assert/strict";
import { lintRequest, breaksRequest } from "../mods/brunr/lint.js";
import { readTree } from "./helpers.mjs";

const lines = (warnings) => warnings.map((w) => w.line);
const yaml = (body) => `info:\n  name: A\n  type: http\n\nhttp:\n  method: GET\n${body}`;

test("every committed valid fixture Request produces no warning, in both formats", () => {
  for (const [format, ext] of [["yaml", ".yml"], ["bru", ".bru"]]) {
    for (const [path, text] of Object.entries(readTree(format))) {
      if (!path.endsWith(ext) || path.startsWith("environments/") || /(^|\/)folder\.|^Broken|^opencollection/.test(path)) continue;
      assert.deepEqual(lintRequest(text, format), [], path);
      assert.deepEqual(lintRequest(text.replace(/\n/g, "\r\n"), format), [], `${path} (CRLF)`);
    }
  }
});

test("text that does not read as a Request names the line", () => {
  const y = lintRequest(readTree("yaml")["Broken.yml"], "yaml");
  assert.equal(y.length, 1);
  assert.equal(y[0].line, 4);
  assert.match(y[0].message, /does not read as a Request/);
  const b = lintRequest(readTree("bru")["Broken.bru"], "bru");
  assert.match(b[0].message, /not closed/);
  assert.match(lintRequest("info:\n  name: A\n", "yaml")[0].message, /no info.type/);
  assert.match(lintRequest("info:\n  name: A\n  type: http\nhttp:\n  url: x\n", "yaml")[0].message, /no http.method/);
  assert.match(lintRequest("meta {\n  name: A\n}\n", "bru")[0].message, /no method block/);
  assert.match(lintRequest("info:\n  name: F\n  type: folder\n", "yaml")[0].message, /not a Request/);
});

test("an unquoted value starting with {{ is a warning", () => {
  const w = lintRequest(yaml("  url: {{baseUrl}}/a\n"), "yaml");
  assert.deepEqual(lines(w), [7]);
  assert.match(w[0].message, /must be quoted/);
  assert.deepEqual(lintRequest(yaml('  url: "{{baseUrl}}/a"\n'), "yaml"), []);
  assert.deepEqual(lines(lintRequest(yaml("  headers:\n    - name: x\n      value: {{token}}\n"), "yaml")), [9]);
});

test("a plain value containing ': ' is a warning; a colon without a space is not", () => {
  assert.deepEqual(lines(lintRequest(yaml("  url: https://a.test/x\ndocs: see: this\n"), "yaml")), [8]);
  assert.deepEqual(lintRequest(yaml("  url: https://a.test:8080/x # note: fine\n"), "yaml"), []);
  assert.deepEqual(lintRequest(yaml('  url: "a: b"\n'), "yaml"), []);
});

test("tab indentation, duplicate keys and values starting with @ or * are warnings", () => {
  assert.deepEqual(lines(lintRequest(yaml("\turl: x\n"), "yaml")), [7]);
  const dup = lintRequest(yaml("  url: a\n  url: b\n"), "yaml");
  assert.deepEqual(lines(dup), [8]);
  assert.match(dup[0].message, /Duplicate key "url"/);
  assert.deepEqual(lintRequest(yaml("  url: a\n  headers:\n    - name: a\n      value: 1\n    - name: a\n      value: 2\n"), "yaml"), [], "the same key in two list items is fine");
  assert.deepEqual(lines(lintRequest(yaml("  url: '@x'\n  body: @raw\n"), "yaml")), [8]);
  assert.deepEqual(lines(lintRequest(yaml("  url: *ref\n"), "yaml")), [7]);
});

test("block scalars and quoted values are not checked for pitfalls", () => {
  const t = yaml("  url: x\nruntime:\n  scripts:\n    - type: tests\n      code: |-\n        const a = { b: 1 };\n        @decorator: here\n\n        {{not yaml}}\ndocs: >\n  text: with colon\n");
  assert.deepEqual(lintRequest(t, "yaml"), []);
});

test("breaksRequest: only text that does not read as a Request at all", () => {
  assert.equal(breaksRequest(lintRequest("info:\n  name: A\n", "yaml")), true);
  assert.equal(breaksRequest(lintRequest("meta {\n  name: A\n}\n", "bru")), true);
  assert.equal(breaksRequest(lintRequest("info:\n  name: F\n  type: folder\n", "yaml")), false);
  assert.equal(breaksRequest(lintRequest(yaml("  url: x\n  x: a: b\n"), "yaml")), false);
  assert.equal(breaksRequest([]), false);
});

test("a comment after a quoted value reads, as YAML and Bruno read it: no warning", () => {
  assert.deepEqual(lintRequest(yaml('  url: "{{baseUrl}}/a" # the URL\n  headers:\n    - name: a\n      value: \'x # y\'   # note\n'), "yaml"), []);
  assert.deepEqual(lines(lintRequest(yaml('  url: "{{baseUrl}}/a"# no space\n'), "yaml")), [7]);
});
