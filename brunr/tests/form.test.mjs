// The Request form's section readers and writers (form.js) on fixtures Bruno's own stringify
// wrote (fixtures/form, made by generate.cjs) and on hand-written text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, readTree, deepFreeze } from "./helpers.mjs";
import { CASES } from "./formcases.mjs";
import * as F from "../mods/brunr/form.js";
import { layout, matchRows } from "../mods/brunr/formsec.js";
import * as T from "../mods/brunr/formtabs.js";
import * as R from "../mods/brunr/formruntime.js";

const { readTab, writeTab, tabBadge, canForm, TABS } = F;
const DIR = join(FIXTURES, "form");
const fixture = (name) => readFileSync(join(DIR, name), "utf8");
const BRUNO = readdirSync(DIR).filter((f) => f.endsWith(".yml")).sort();
const crlf = (s) => s.replace(/\n/g, "\r\n");
const IMPL = { params: T.params, headers: T.headers, body: T.body, auth: T.auth, docs: T.docs, settings: T.settings, vars: R.vars, script: R.script, tests: R.tests, assert: R.assert };
const UNREADABLE = { "auth-digest.yml": ["auth"], "body-file.yml": ["body"], "body-multipart-file.yml": ["body"], "body-sparql.yml": ["body"] };
const full = fixture("full.yml");
const minimal = fixture("minimal.yml");

/** The lines of `b` that are not in `a` at the same place, after the shared head and tail. */
function changed(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  return { removed: x.slice(head, x.length - tail), added: y.slice(head, y.length - tail) };
}

test("every tab reads every Bruno-written fixture, except the shapes the form does not model", () => {
  assert.ok(BRUNO.length >= 80, `fixtures were generated: ${BRUNO.length}`);
  for (const f of BRUNO) {
    for (const tab of TABS) {
      const r = readTab(fixture(f), tab);
      const bad = UNREADABLE[f]?.includes(tab) ?? false;
      assert.equal(r.ok, !bad, `${f} ${tab}: ${r.reason}`);
      if (bad) assert.match(r.reason, /digest|file|sparql/);
    }
  }
});

for (const [name, [tab, data]] of Object.entries(CASES)) {
  test(`${name}: the edit made in Bruno, made with writeTab, gives the text Bruno wrote, byte for byte`, () => {
    const before = fixture(`${name}.yml`);
    assert.equal(writeTab(before, tab, deepFreeze(structuredClone(data))), fixture(`${name}.after.yml`), name);
    assert.equal(writeTab(crlf(before), tab, data), crlf(fixture(`${name}.after.yml`)), `${name} with CRLF`);
    const noFinal = before.replace(/\n$/, "");
    assert.equal(writeTab(noFinal, tab, data).endsWith("\n"), false, `${name}: a missing final newline stays missing`);
  });
}

test("the writers themselves, without the unchanged-data shortcut, reproduce every Bruno-written file", () => {
  for (const f of BRUNO) {
    const text = fixture(f);
    for (const tab of TABS) {
      const r = readTab(text, tab);
      if (!r.ok) continue;
      assert.equal(IMPL[tab].write(layout(text), r.data), text, `${f} ${tab}`);
      assert.equal(IMPL[tab].write(layout(crlf(text)), r.data), crlf(text), `${f} ${tab} CRLF`);
    }
  }
});

test("read then write with the same data returns the identical text, for Bruno's files and hand-written ones", () => {
  const yaml = readTree("yaml");
  const texts = [...BRUNO.map(fixture), ...Object.entries(yaml).filter(([p]) => p.endsWith(".yml") && !p.includes("environments")).map(([, t]) => t)];
  for (const text of texts) {
    for (const tab of TABS) {
      const r = readTab(text, tab);
      if (r.ok) assert.equal(writeTab(text, tab, r.data), text, tab);
    }
  }
});

test("readTab returns Bruno's data for every tab of the full fixture", () => {
  const data = Object.fromEntries(TABS.map((t) => [t, readTab(full, t).data]));
  assert.deepEqual(data.params, {
    query: [{ name: "verbose", value: "1", enabled: true }, { name: "lang", value: "{{lang}}", enabled: true }, { name: "debug", value: "true", enabled: false }],
    path: [{ name: "shop", value: "7" }],
  });
  assert.deepEqual(data.headers, [{ name: "content-type", value: "application/json", enabled: true }, { name: "x-trace", value: "full-1", enabled: true }, { name: "x-off", value: "no", enabled: false }]);
  assert.deepEqual(data.body, { mode: "json", text: '{\n  "productId": 1,\n  "quantity": 2\n}' });
  assert.deepEqual(data.auth, { mode: "bearer", token: "{{token}}" });
  assert.deepEqual(data.vars, {
    pre: [{ name: "orderSource", value: "form", enabled: true }, { name: "unused", value: "x: y", enabled: false }],
    post: [{ name: "orderId", expression: "res.body.id", enabled: true }, { name: "localNote", expression: "res.body.note", enabled: false }],
  });
  assert.deepEqual(data.script, { pre: 'req.setHeader("x-pre", "1");', post: 'bru.setVar("seen", true);\n// done' });
  assert.equal(data.tests, 'test("created", () => {\n  expect(res.status).to.equal(201);\n});');
  assert.deepEqual(data.assert, [
    { expression: "res.status", operator: "eq", value: "201", enabled: true },
    { expression: "res.body.id", operator: "isNumber", value: "", enabled: true },
    { expression: "res.body.items", operator: "isEmpty", value: "", enabled: false },
  ]);
  assert.equal(data.docs, "# Create an order\n\nPosts a JSON order.");
  assert.deepEqual(data.settings, { encodeUrl: false, timeout: 3000, followRedirects: false, maxRedirects: 2, forwardAuthorizationHeader: false });
});

test("missing sections read as empty data, and settings as Bruno's Settings tab shows them", () => {
  const empty = { params: { query: [], path: [] }, body: { mode: "none" }, headers: [], auth: { mode: "none" }, vars: { pre: [], post: [] }, script: { pre: "", post: "" }, assert: [], tests: "", docs: "" };
  for (const [tab, data] of Object.entries(empty)) assert.deepEqual(readTab(minimal, tab), { ok: true, data }, tab);
  assert.deepEqual(readTab("info:\n  name: N\n  type: http\n", "settings").data, F.SETTINGS_DEFAULTS);
  assert.deepEqual(readTab("settings:\n  encodeUrl: false\n", "settings").data, { encodeUrl: false, timeout: 0, followRedirects: true, maxRedirects: 5, forwardAuthorizationHeader: true }, "a partial block takes the parser's defaults");
  assert.deepEqual(readTab(fixture("auth-to-inherit.after.yml"), "auth").data, { mode: "inherit" });
  assert.deepEqual(readTab(fixture("auth-to-apikey.after.yml"), "auth").data, { mode: "apikey", key: "x-api-key", value: "{{apiKey}}", placement: "query" });
  assert.deepEqual(readTab(fixture("body-form-empty.after.yml"), "body").data, { mode: "form-urlencoded", rows: [] });
});

test("only the owned section's lines change: writing assert touches runtime.assertions and nothing else", () => {
  const rows = [...readTab(full, "assert").data, { expression: "res.body.ok", operator: "isTruthy", value: "ignored", enabled: true }];
  const out = writeTab(full, "assert", rows);
  assert.deepEqual(changed(full, out), { removed: [], added: ["    - expression: res.body.ok", "      operator: isTruthy"] });
  for (const tab of TABS.filter((t) => t !== "assert")) assert.deepEqual(readTab(out, tab), readTab(full, tab), tab);
});

test("a missing section is created in Bruno's key order, with its parent block and blank line", () => {
  const h = writeTab(minimal, "headers", [{ name: "a", value: "b", enabled: true }]);
  assert.match(h, /url: "\{\{baseUrl\}\}\/health"\n {2}headers:\n {4}- name: a\n {6}value: b\n\nsettings:/);
  const bodyFirst = writeTab(writeTab(minimal, "auth", { mode: "inherit" }), "body", { mode: "text", text: "x" });
  assert.match(bodyFirst, /body:\n {4}type: text\n {4}data: x\n {2}auth: inherit\n/, "body goes before auth");
  const actions = writeTab(full, "vars", { ...readTab(full, "vars").data, pre: [] });
  assert.ok(actions.includes("runtime:\n  scripts:"), "variables were the first runtime key");
  const noSettings = "info:\n  name: N\n  type: http\n\nhttp:\n  method: GET\n  url: x\n\ndocs: hi\n";
  assert.equal(writeTab(noSettings, "assert", [{ expression: "a", operator: "isNull", value: "", enabled: true }]),
    "info:\n  name: N\n  type: http\n\nhttp:\n  method: GET\n  url: x\n\nruntime:\n  assertions:\n    - expression: a\n      operator: isNull\n\ndocs: hi\n");
  assert.equal(writeTab("info:\n  name: N\n", "headers", [{ name: "a", value: "", enabled: false }]),
    'info:\n  name: N\n\nhttp:\n  headers:\n    - name: a\n      value: ""\n      disabled: true\n');
  assert.equal(writeTab("info:\n  name: N\nhttp: {}\n", "auth", { mode: "bearer", token: "t" }), "info:\n  name: N\nhttp:\n  auth:\n    type: bearer\n    token: t\n");
});

test("an emptied section is removed, and its parent block with it when nothing is left", () => {
  const onlyVars = fixture("vars-clear-runtime.yml");
  assert.ok(!writeTab(onlyVars, "vars", { pre: [], post: [] }).includes("runtime"));
  assert.equal(writeTab(fixture("docs-clear.yml"), "docs", "  \n"), fixture("docs-clear.after.yml"), "blank docs are left out");
  const crlfOnly = crlf("info:\n  name: N\n\nruntime:\n  scripts:\n    - type: tests\n      code: x\n\nsettings:\n  encodeUrl: true");
  assert.equal(writeTab(crlfOnly, "tests", ""), crlf("info:\n  name: N\n\nsettings:\n  encodeUrl: true"));
  const last = "info:\n  name: N\n\nruntime:\n  scripts:\n    - type: tests\n      code: x";
  assert.equal(writeTab(last, "tests", ""), "info:\n  name: N", "removing the last block keeps the missing final newline");
});

test("writing Script keeps the Tests entry and other script types, and Tests keeps the scripts", () => {
  const grpcish = "info:\n  name: N\n  type: http\n\nruntime:\n  scripts:\n    - type: grpc:before-call-start\n      code: a\n    - type: tests\n      code: t\n";
  const out = writeTab(grpcish, "script", { pre: "p", post: "q" });
  assert.equal(out, "info:\n  name: N\n  type: http\n\nruntime:\n  scripts:\n    - type: before-request\n      code: p\n    - type: after-response\n      code: q\n    - type: grpc:before-call-start\n      code: a\n    - type: tests\n      code: t\n");
  assert.equal(writeTab(out, "tests", "t2"), out.replace("code: t\n", "code: t2\n"));
  assert.equal(writeTab(out, "script", { pre: "  p\n", post: "q" }), out, "a script that differs only by surrounding whitespace is saved trimmed, as it is");
});

test("post-response variables keep other actions in place, and keep a row's scope and description", () => {
  const text = [
    "info:", "  name: N", "  type: http", "", "runtime:", "  actions:",
    "    - type: set-variable", "      phase: after-response", "      selector:", "        expression: res.body.a", "        method: jsonq",
    "      variable:", "        name: a", "        scope: request", "      description: the a",
    "    - type: future-thing", "      phase: before-request", "      anything: [1, 2]",
    "    - type: set-variable", "      phase: before-request", "      selector:", "        expression: x", "        method: jsonq", "      variable:", "        name: pre", "        scope: runtime",
    "",
  ].join("\n");
  const r = readTab(text, "vars");
  assert.deepEqual(r.data.post, [{ name: "a", expression: "res.body.a", enabled: true }]);
  const out = writeTab(text, "vars", { pre: [], post: [{ name: "a", expression: "res.body.b", enabled: false }, { name: "z", expression: "res.body.z", enabled: true }] });
  assert.ok(out.startsWith(text.slice(0, text.indexOf("        expression: res.body.a"))), "the lines before the edit are unchanged");
  assert.ok(out.includes("        expression: res.body.b\n        method: jsonq\n      variable:\n        name: a\n        scope: request\n      description: the a\n      disabled: true\n    - type: set-variable\n      phase: after-response\n      selector:\n        expression: res.body.z\n"));
  assert.ok(out.includes("    - type: future-thing\n      phase: before-request\n      anything: [1, 2]\n"), "the other action is untouched");
  const gone = writeTab(text, "vars", { pre: [], post: [] });
  assert.ok(!gone.includes("res.body.a") && gone.includes("future-thing") && gone.includes("name: pre"));
});

test("rows keep their other keys through edits: matched by name, by position for a rename", () => {
  assert.deepEqual(matchRows(["a", "b", "c"], ["a", "c", "d"]), [0, 2, -1]);
  assert.deepEqual(matchRows(["a", "b"], ["b", "a"]), [1, 0], "a reorder keeps each row");
  assert.deepEqual(matchRows(["a", "b", "c"], ["a", "x", "c"]), [0, 1, 2], "a rename at one place");
  assert.deepEqual(matchRows([], ["a"]), [-1]);
  const rows = readTab(full, "headers").data;
  const renamed = writeTab(full, "headers", [rows[0], { ...rows[1], name: "x-renamed" }, rows[2]]);
  assert.ok(renamed.includes("    - name: x-renamed\n      value: full-1\n      description: trace id\n"));
  const reordered = writeTab(full, "headers", [rows[1], rows[0], rows[2]]);
  assert.ok(reordered.includes("  headers:\n    - name: x-trace\n      value: full-1\n      description: trace id\n    - name: content-type\n"));
  const unknown = "http:\n  headers:\n    - name: a\n      value: b\n      future: {deep: [1]}\n";
  assert.equal(writeTab(unknown, "headers", [{ name: "a", value: "c", enabled: false }]), "http:\n  headers:\n    - name: a\n      value: c\n      disabled: true\n      future: {deep: [1]}\n");
});

test("params: a query edit rewrites the URL as Bruno's setQueryParams does; path rows are written as given", () => {
  const out = writeTab(full, "params", { query: [{ name: "lang", value: "en", enabled: true }, { name: "", value: "skip", enabled: true }], path: [{ name: "shop", value: "8" }, { name: "gone", value: "1" }] });
  assert.ok(out.includes('  url: "{{baseUrl}}/orders/:shop?lang=en"\n'));
  assert.ok(out.includes("    - name: lang\n      value: en\n      type: query\n      description: language\n"), "the kept row keeps its description");
  assert.ok(out.includes("    - name: gone\n      value: \"1\"\n      type: path\n"), "a query edit does not drop a path row, as in Bruno");
  const frag = "info:\n  name: N\n  type: http\nhttp:\n  url: x/:id?a=1#top\n  params:\n    - name: a\n      value: \"1\"\n      type: query\n";
  assert.equal(readTab(frag, "params").data.path.length, 0);
  assert.equal(writeTab(frag, "params", { query: [], path: [{ name: "id", value: "3" }] }),
    "info:\n  name: N\n  type: http\nhttp:\n  url: x/:id\n  params:\n    - name: id\n      value: \"3\"\n      type: path\n");
  const hasDisabledPath = "http:\n  url: x/:id\n  params:\n    - name: id\n      value: \"1\"\n      type: path\n      disabled: true\n";
  assert.equal(writeTab(hasDisabledPath, "params", { query: [], path: [{ name: "id", value: "2" }] }), hasDisabledPath.replace('"1"', '"2"'), "a path row's own disabled flag stays");
});

test("body: switching mode keeps nothing of the old mode; a form row edit keeps contentType and description; headers are not touched", () => {
  const toText = writeTab(full, "body", { mode: "text", text: "a" });
  assert.deepEqual(readTab(toText, "headers"), readTab(full, "headers"));
  assert.ok(!toText.includes("productId"));
  const back = writeTab(toText, "body", { mode: "json", text: "" });
  assert.ok(back.includes('  body:\n    type: json\n    data: ""\n'));
  const multi = fixture("body-multipart-edit.yml");
  const out = writeTab(multi, "body", { mode: "multipart-form", rows: [{ name: "note", value: "x", enabled: true }] });
  assert.ok(out.includes("    data:\n      - name: note\n        type: text\n        value: x\n        contentType: text/plain\n        description: a note\n"));
});

test("auth: same mode edits in place; a new mode is written as Bruno saves it", () => {
  assert.equal(writeTab(minimal, "auth", { mode: "basic", username: "", password: "" }).includes("  auth:\n    type: basic\n\n"), true, "an untouched basic mode is just its type");
  assert.ok(writeTab(minimal, "auth", { mode: "apikey", key: "k", value: "", placement: "header" }).includes("  auth:\n    type: apikey\n    key: k\n    placement: header\n"));
  const typeOnly = "http:\n  auth:\n    type: basic\n";
  assert.equal(writeTab(typeOnly, "auth", { mode: "basic", username: "", password: "pw" }), "http:\n  auth:\n    type: basic\n    password: pw\n");
  assert.deepEqual(readTab("http:\n  auth: inherit\n", "auth").data, { mode: "inherit" });
  assert.equal(readTab("http:\n  auth:\n    type: apikey\n    placement: cookie\n", "auth").ok, false);
  assert.equal(readTab("http:\n  auth:\n    type: oauth2\n", "auth").ok, false);
});

test("assert: Bruno's operator list, and unary operators store no value", () => {
  assert.equal(F.ASSERT_OPERATORS.length, 28);
  assert.deepEqual([F.ASSERT_OPERATORS[0], F.ASSERT_OPERATORS[15], F.ASSERT_OPERATORS[27]], ["eq", "between", "isArray"]);
  assert.equal(F.UNARY_OPERATORS[0], "isEmpty");
  const out = writeTab(minimal, "assert", [{ expression: "res.body", operator: "isEmpty", value: "x", enabled: true }]);
  assert.ok(out.includes("    - expression: res.body\n      operator: isEmpty\n\n"));
  const unary = "runtime:\n  assertions:\n    - expression: a\n      operator: eq\n      value: \"1\"\n";
  assert.equal(writeTab(unary, "assert", [{ expression: "a", operator: "isNull", value: "", enabled: true }]), "runtime:\n  assertions:\n    - expression: a\n      operator: isNull\n");
  assert.equal(readTab("runtime:\n  assertions:\n    - expression: a\n      operator: approx\n", "assert").ok, false);
});

test("settings: every key is written; other keys such as omitHeaders stay; numbers as Bruno's stringify keeps them", () => {
  const out = writeTab(full, "settings", { ...readTab(full, "settings").data, timeout: -4, maxRedirects: 2.7 });
  assert.ok(out.includes("  timeout: 0\n  followRedirects: false\n  maxRedirects: 2\n  forwardAuthorizationHeader: false\n  omitHeaders:\n    - user-agent\n"));
  const partial = "info:\n  name: N\n\nsettings:\n  encodeUrl: true\n";
  assert.equal(writeTab(partial, "settings", { ...readTab(partial, "settings").data, followRedirects: false }),
    "info:\n  name: N\n\nsettings:\n  encodeUrl: true\n  timeout: 0\n  followRedirects: false\n  maxRedirects: 5\n  forwardAuthorizationHeader: true\n");
  assert.deepEqual(F.SETTINGS_FIELDS.map((f) => [f.key, f.kind]), [["encodeUrl", "toggle"], ["timeout", "number"], ["followRedirects", "toggle"], ["maxRedirects", "number"], ["forwardAuthorizationHeader", "toggle"]]);
  assert.equal(readTab("settings:\n  encodeUrl: maybe\n", "settings").ok, false);
  assert.equal(readTab("settings:\n  timeout: soon\n", "settings").ok, false);
});

test("hand-written shapes: a different indent, comments and compact lists are edited in place; flow rows are unreadable", () => {
  const four = "info:\n    name: A\n    type: http\nhttp:\n    url: x\n    headers:\n        # the rows\n        -   name: a   # first\n            value: b\n        # between\n        -   name: c\n            value: d\n";
  assert.equal(writeTab(four, "headers", [{ name: "a", value: "b", enabled: true }, { name: "c", value: "D", enabled: true }]), four.replace("value: d", "value: D"));
  const compact = "http:\n  url: x\n  headers:\n  - name: a\n    value: b\n  auth: inherit\n";
  assert.equal(writeTab(compact, "headers", [{ name: "a", value: "b2", enabled: true }]), compact.replace("value: b\n", "value: b2\n"));
  const quoted = "http:\n  headers:\n    - name: a\n      value: 'single'\n";
  assert.equal(writeTab(quoted, "headers", [{ name: "a2", value: "single", enabled: true }]), quoted.replace("name: a\n", "name: a2\n"), "an unchanged value keeps its quoting");
  for (const t of [
    "http:\n  headers: [{name: a, value: b}]\n", "http:\n  headers:\n    - {name: a, value: b}\n", "http:\n  headers:\n    - \"name\": a\n",
    "http:\n  headers: nope\n", "http:\n  headers:\n    - name: a\n  - name: b\n", "http: [1]\n",
  ]) {
    const r = readTab(t, "headers");
    assert.equal(r.ok, false, t);
    assert.throws(() => writeTab(t, "headers", []), /can only be edited in File/, "an unreadable section is never rewritten");
  }
  assert.deepEqual(readTab("http:\n  headers: []\n", "headers").data, []);
  assert.equal(readTab("runtime:\n  variables:\n    - name: n\n      value:\n        type: number\n        data: \"1\"\n", "vars").ok, false, "typed variable values");
  assert.equal(readTab("runtime:\n  scripts:\n    - type: tests\n      code: a\n    - type: tests\n      code: b\n", "tests").ok, false, "two tests scripts");
  assert.equal(readTab("runtime:\n  actions:\n    - type: set-variable\n      phase: after-response\n      selector: {expression: a, method: jsonq}\n      variable: {name: n}\n", "vars").ok, false);
  assert.equal(readTab("--- \ninfo: x\n", "docs").ok, false);
  assert.equal(readTab("docs:\n  a: 1\n", "docs").ok, false);
});

test("inputs are not mutated, and unchanged data returns the input text", () => {
  const data = deepFreeze(readTab(full, "vars").data);
  assert.equal(writeTab(full, "vars", data), full);
  for (const [name, [tab, d]] of Object.entries(CASES)) writeTab(fixture(`${name}.yml`), tab, deepFreeze(structuredClone(d)));
  assert.throws(() => readTab(full, "nope"), /unknown form tab/);
});

test("the view's data is made into the readers' shapes before it is compared or written", () => {
  assert.equal(writeTab(full, "headers", readTab(full, "headers").data.map((r) => ({ ...r, extra: 1 }))), full);
  const loose = writeTab(minimal, "headers", [{ name: "a", value: 5 }, { name: "b", value: null, enabled: false }]);
  assert.deepEqual(readTab(loose, "headers").data, [{ name: "a", value: "5", enabled: true }, { name: "b", value: "", enabled: false }]);
  assert.equal(writeTab(full, "body", { mode: "json", text: readTab(full, "body").data.text, rows: [{ name: "ignored" }] }), full);
});

test("tabBadge shows what Bruno's tabs show: enabled counts, dots, the settings dot for tags", () => {
  const badges = Object.fromEntries(TABS.map((t) => [t, tabBadge(full, t)]));
  assert.deepEqual(badges, { params: 3, body: true, headers: 2, auth: true, vars: 2, script: true, assert: 2, tests: true, docs: true, settings: true });
  assert.deepEqual(TABS.map((t) => tabBadge(minimal, t)), new Array(10).fill(null));
  assert.equal(tabBadge(fixture("auth-to-inherit.after.yml"), "auth"), null, "inherit needs the parent's auth, which the text does not hold");
  assert.equal(tabBadge(fixture("auth-digest.yml"), "auth"), true, "an unreadable section has content");
  assert.equal(tabBadge("info:\n  name: a\n    bad: x\n", "settings"), null, "an info block that does not read gives no dot, and no error");
});

test("canForm: YAML HTTP Requests only", () => {
  assert.equal(canForm(full, "yaml"), true);
  assert.equal(canForm(minimal, "yaml"), true);
  assert.equal(canForm(readTree("bru")["Get Health.bru"], "bru"), false);
  assert.equal(canForm("info:\n  name: G\n  type: graphql\n", "yaml"), false);
  assert.equal(canForm("info:\n  name: F\n  type: folder\n", "yaml"), false);
  assert.equal(canForm(readTree("yaml")["Broken.yml"], "yaml"), false);
  assert.deepEqual(F.TABS, ["params", "body", "headers", "auth", "vars", "script", "assert", "tests", "docs", "settings"]);
});

test("params: a URL query with no rows shows in the Query table, and an edit keeps it", () => {
  const hand = "info:\n  name: H\n  type: http\nhttp:\n  method: GET\n  url: \"{{baseUrl}}/echo?a=1\"\n";
  assert.deepEqual(readTab(hand, "params").data, { query: [{ name: "a", value: "1", enabled: true }], path: [] });
  assert.equal(tabBadge(hand, "params"), 1);
  assert.equal(writeTab(hand, "params", readTab(hand, "params").data), hand, "an unchanged read writes nothing");
  const added = writeTab(hand, "params", { query: [{ name: "a", value: "1", enabled: true }, { name: "b", value: "2", enabled: true }], path: [] });
  assert.equal(added, "info:\n  name: H\n  type: http\nhttp:\n  method: GET\n  url: \"{{baseUrl}}/echo?a=1&b=2\"\n"
    + "  params:\n    - name: a\n      value: \"1\"\n      type: query\n    - name: b\n      value: \"2\"\n      type: query\n");
});

test("params: rows that differ from the URL read as Bruno's URL reconciliation: the URL's params, then the disabled rows", () => {
  const head = "info:\n  name: M\n  type: http\nhttp:\n  url: x?a=1&b=2\n  params:\n";
  const row = (name, value, extra = "") => `    - name: ${name}\n      value: "${value}"\n      type: query\n${extra}`;
  const partial = head + row("a", "1", "      description: kept\n") + row("c", "3", "      disabled: true\n");
  assert.deepEqual(readTab(partial, "params").data.query, [
    { name: "a", value: "1", enabled: true }, { name: "b", value: "2", enabled: true }, { name: "c", value: "3", enabled: false },
  ], "b is in the URL but not in the rows");
  const edited = writeTab(partial, "params", { query: [{ name: "a", value: "1", enabled: true }, { name: "b", value: "5", enabled: true }, { name: "c", value: "3", enabled: false }], path: [] });
  assert.ok(edited.includes("  url: x?a=1&b=5\n"), edited);
  assert.ok(edited.includes(row("a", "1", "      description: kept\n")), "a matched row keeps its other keys");
  assert.ok(edited.includes(row("c", "3", "      disabled: true\n")));
  const extraRow = head + row("a", "1") + row("z", "9") + "    - name: b\n      value: \"2\"\n      type: query\n";
  assert.deepEqual(readTab(extraRow, "params").data.query.map((r) => r.name), ["a", "b"], "an enabled row the URL does not send is not shown as sent");
  const consistent = head.replace("x?a=1&b=2", "x?a=1") + row("off", "0", "      disabled: true\n") + row("a", "1");
  assert.deepEqual(readTab(consistent, "params").data.query.map((r) => r.name), ["off", "a"], "rows that agree with the URL are read as they are");
});

test("params: a path row whose :name left the URL stays at a Params edit, as Bruno's setQueryParams keeps it", () => {
  const stale = "http:\n  url: x/:id?a=1\n  params:\n    - name: a\n      value: \"1\"\n      type: query\n    - name: old\n      value: \"7\"\n      type: path\n";
  const out = writeTab(stale, "params", { query: [{ name: "a", value: "2", enabled: true }], path: [{ name: "old", value: "7" }] });
  assert.equal(out, stale.replace("x/:id?a=1", "x/:id?a=2").replace('value: "1"', "value: \"2\""));
});

test("a comment after a quoted value is a comment: the section reads, an unchanged write keeps it, a changed value drops it", () => {
  const text = "info:\n  name: C\n  type: http\nhttp:\n  url: x\n  headers:\n    - name: \"a\"   # the name\n      value: 'b # not a comment' # note\n      # under\n    - name: c\n      value: \"d\"\t# tab\n";
  assert.deepEqual(readTab(text, "headers"), { ok: true, data: [{ name: "a", value: "b # not a comment", enabled: true }, { name: "c", value: "d", enabled: true }] });
  assert.equal(writeTab(text, "headers", [{ name: "a", value: "b # not a comment", enabled: true }, { name: "c", value: "d", enabled: true }]), text);
  assert.equal(writeTab(text, "headers", [{ name: "a", value: "B", enabled: true }, { name: "c", value: "d", enabled: true }]), text.replace("value: 'b # not a comment' # note", "value: B"));
  assert.equal(readTab("http:\n  headers:\n    - name: a\n      value: \"x\"# no space\n", "headers").ok, false, "a # right after the quote is not a comment");
});

test("a comment after an inline value is a comment for the section tools too: {} and [] and inherit", () => {
  assert.deepEqual(readTab("info:\n  type: http\nhttp: {} # none yet\n", "headers"), { ok: true, data: [] });
  assert.deepEqual(readTab("http:\n  headers: [] # none\n", "headers"), { ok: true, data: [] });
  assert.deepEqual(readTab("http:\n  auth: inherit # from the folder\n", "auth"), { ok: true, data: { mode: "inherit" } });
  assert.equal(readTab("settings: {} # defaults\n", "settings").ok, true);
  assert.deepEqual(readTab("http:\n  body:\n    type: json # raw\n    data: \"{}\" # empty\n", "body").data, { mode: "json", text: "{}" });
});
