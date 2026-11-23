// The Request form's view rules (formview.js): which tabs show, row table edits, mode switches,
// the fields each tab draws, when a field is reset from the text, settings numbers and Prettify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, deepFreeze } from "./helpers.mjs";
import { readTab, writeTab, TABS, ASSERT_OPERATORS } from "../mods/brunr/form.js";
import * as V from "../mods/brunr/formview.js";

const full = readFileSync(join(FIXTURES, "form/full.yml"), "utf8");
const minimal = readFileSync(join(FIXTURES, "form/minimal.yml"), "utf8");
const data = (text, tab) => deepFreeze(readTab(text, tab).data);
const kv = (name, value, enabled = true) => ({ name, value, enabled });

test("visibleTabs: Bruno's tabs and File for a YAML HTTP Request, none otherwise", () => {
  assert.deepEqual(V.visibleTabs(full, "yaml"), ["params", "body", "headers", "auth", "vars", "script", "assert", "tests", "docs", "settings", "file"]);
  assert.deepEqual(V.visibleTabs(full, "bru"), []);
  assert.deepEqual(V.visibleTabs(full.replace("type: http", "type: graphql"), "yaml"), []);
  assert.deepEqual(V.visibleTabs("- a\n- b\n", "yaml"), []);
  assert.deepEqual(V.visibleTabs(null, "yaml"), []);
  for (const tab of [...TABS, V.FILE]) assert.ok(V.TAB_LABELS[tab], tab);
});

test("pickTab: the remembered tab when it is one, else Params", () => {
  assert.equal(V.pickTab("auth"), "auth");
  assert.equal(V.pickTab("file"), "file");
  assert.equal(V.pickTab(null), "params");
  assert.equal(V.pickTab("app"), "params");
});

test("badgeOf: a count above 0, a dot, or nothing", () => {
  assert.deepEqual(V.badgeOf(3), { count: 3 });
  assert.equal(V.badgeOf(0), null);
  assert.deepEqual(V.badgeOf(true), { dot: true });
  assert.equal(V.badgeOf(null), null);
});

test("tableEdit: typing in the empty last row adds a row; an empty edit adds nothing", () => {
  const d = data(minimal, "headers");
  assert.deepEqual(d, []);
  const one = V.tableEdit("headers", d, { type: "set", index: 0, field: "name", value: "x-a" });
  assert.deepEqual(one, [kv("x-a", "")]);
  assert.equal(V.tableEdit("headers", d, { type: "set", index: 0, field: "name", value: "" }), null);
  const two = V.tableEdit("headers", deepFreeze(one), { type: "set", index: 1, field: "value", value: "v" });
  assert.deepEqual(two, [kv("x-a", ""), kv("", "v")]);
});

test("tableEdit: a row edited to empty is dropped; toggle and remove", () => {
  const d = deepFreeze([kv("a", "1"), kv("", "2"), kv("c", "3")]);
  assert.deepEqual(V.tableEdit("headers", d, { type: "set", index: 1, field: "value", value: "" }), [kv("a", "1"), kv("c", "3")]);
  assert.deepEqual(V.tableEdit("headers", d, { type: "set", index: 0, field: "value", value: "9" }), [kv("a", "9"), kv("", "2"), kv("c", "3")]);
  assert.equal(V.tableEdit("headers", d, { type: "set", index: 0, field: "value", value: "1" }), null, "unchanged");
  assert.deepEqual(V.tableEdit("headers", d, { type: "toggle", index: 2 }), [kv("a", "1"), kv("", "2"), kv("c", "3", false)]);
  assert.deepEqual(V.tableEdit("headers", d, { type: "remove", index: 0 }), [kv("", "2"), kv("c", "3")]);
  assert.equal(V.tableEdit("headers", d, { type: "remove", index: 3 }), null, "the empty last row is not removed");
  assert.equal(V.tableEdit("headers", d, { type: "toggle", index: 3 }), null);
});

test("tableEdit: path params take a value only, never a name, a new row, a toggle or a remove", () => {
  const d = data(full, "params");
  assert.deepEqual(d.path, [{ name: "shop", value: "7" }]);
  const e = V.tableEdit("path", d, { type: "set", index: 0, field: "value", value: "9" });
  assert.deepEqual(e.path, [{ name: "shop", value: "9" }]);
  assert.equal(e.query, d.query);
  assert.equal(V.tableEdit("path", d, { type: "set", index: 0, field: "name", value: "x" }), null);
  assert.equal(V.tableEdit("path", d, { type: "set", index: 1, field: "value", value: "x" }), null);
  assert.equal(V.tableEdit("path", d, { type: "remove", index: 0 }), null);
  assert.equal(V.tableEdit("path", d, { type: "toggle", index: 0 }), null);
  // The writer then fills the path param; the URL keeps :shop.
  const text = writeTab(full, "params", e);
  assert.match(text, /- name: shop\n {6}value: "9"\n {6}type: path/);
});

test("tableEdit: a query row edit changes the URL through the writer", () => {
  const d = data(full, "params");
  const e = V.tableEdit("query", d, { type: "set", index: 0, field: "value", value: "2" });
  const text = writeTab(full, "params", e);
  assert.match(text, /url: "\{\{baseUrl\}\}\/orders\/:shop\?verbose=2&lang=\{\{lang\}\}"/);
  const added = V.tableEdit("query", d, { type: "set", index: d.query.length, field: "name", value: "page" });
  assert.match(writeTab(full, "params", added), /lang=\{\{lang\}\}&page="/);
});

test("tableEdit: assertions; a unary operator clears and disables the value; the empty row has no operator menu", () => {
  const d = data(full, "assert");
  const unary = V.tableEdit("assert", d, { type: "set", index: 0, field: "operator", value: "isNumber" });
  assert.deepEqual(unary[0], { expression: "res.status", operator: "isNumber", value: "", enabled: true });
  assert.equal(V.tableEdit("assert", deepFreeze(unary), { type: "set", index: 0, field: "value", value: "1" }), null);
  assert.equal(V.tableEdit("assert", d, { type: "set", index: d.length, field: "operator", value: "neq" }), null);
  const added = V.tableEdit("assert", d, { type: "set", index: d.length, field: "expression", value: "res.body.ok" });
  assert.deepEqual(added.at(-1), { expression: "res.body.ok", operator: "eq", value: "", enabled: true });
  assert.ok(V.isUnary("isEmpty") && !V.isUnary("eq"));
});

test("tableEdit: post-response variables use name and expression", () => {
  const d = data(full, "vars");
  const e = V.tableEdit("post", d, { type: "set", index: d.post.length, field: "expression", value: "res.body.total" });
  assert.deepEqual(e.post.at(-1), { name: "", expression: "res.body.total", enabled: true });
  assert.equal(e.pre, d.pre);
});

test("tablesOf: the tables each tab draws", () => {
  assert.deepEqual(V.tablesOf("params", data(full, "params")), ["query", "path"]);
  assert.deepEqual(V.tablesOf("params", data(minimal, "params")), ["query"]);
  assert.deepEqual(V.tablesOf("body", { mode: "multipart-form", rows: [] }), ["form"]);
  assert.deepEqual(V.tablesOf("body", { mode: "json", text: "" }), []);
  assert.deepEqual(V.tablesOf("vars", data(full, "vars")), ["pre", "post"]);
});

test("switchBodyMode: raw modes keep their text, form modes their rows, else empty", () => {
  const json = deepFreeze({ mode: "json", text: '{"a":1}' });
  assert.deepEqual(V.switchBodyMode(json, "text"), { mode: "text", text: '{"a":1}' });
  assert.deepEqual(V.switchBodyMode(json, "form-urlencoded"), { mode: "form-urlencoded", rows: [] });
  assert.deepEqual(V.switchBodyMode(json, "none"), { mode: "none" });
  assert.equal(V.switchBodyMode(json, "json"), null);
  const form = deepFreeze({ mode: "form-urlencoded", rows: [kv("a", "1")] });
  assert.deepEqual(V.switchBodyMode(form, "multipart-form"), { mode: "multipart-form", rows: [kv("a", "1")] });
  assert.deepEqual(V.switchBodyMode(form, "xml"), { mode: "xml", text: "" });
  assert.deepEqual(V.switchBodyMode({ mode: "none" }, "json"), { mode: "json", text: "" });
  assert.equal(V.switchBodyMode(json, "sparql"), null);
  for (const m of V.BODY_MENU) if (m) assert.ok(V.BODY_LABELS[m], m);
});

test("menuEdit: auth mode, API key placement and assertion operator; others ignored", () => {
  assert.deepEqual(V.menuEdit("auth", { mode: "none" }, { field: "authMode", value: "bearer" }), { mode: "bearer" });
  assert.equal(V.menuEdit("auth", { mode: "none" }, { field: "authMode", value: "digest" }), null);
  const key = { mode: "apikey", key: "k", value: "v", placement: "header" };
  assert.deepEqual(V.menuEdit("auth", key, { field: "placement", value: "query" }), { ...key, placement: "query" });
  assert.equal(V.menuEdit("auth", key, { field: "placement", value: "cookie" }), null);
  assert.equal(V.menuEdit("auth", { mode: "bearer", token: "" }, { field: "placement", value: "query" }), null);
  const a = deepFreeze([{ expression: "res.status", operator: "eq", value: "200", enabled: true }]);
  assert.equal(V.menuEdit("assert", a, { field: "operator", row: 0, value: "gt" })[0].operator, "gt");
  assert.equal(V.menuEdit("body", { mode: "none" }, { field: "authMode", value: "basic" }), null);
  assert.equal(ASSERT_OPERATORS.length, 28);
});

test("needsReset: text fields compare exactly, code trimmed, numbers by value", () => {
  assert.equal(V.needsReset("abc", "abc"), false);
  assert.equal(V.needsReset("abc ", "abc"), true);
  assert.equal(V.needsReset("x();\n\n", "x();", "code"), false, "a script being typed keeps its trailing newline");
  assert.equal(V.needsReset("x();", "y();", "code"), true, "an edit in File replaces the editor");
  assert.equal(V.needsReset("007", 7, "number:maxRedirects"), false);
  assert.equal(V.needsReset("8", 7, "number:maxRedirects"), true);
  assert.equal(V.needsReset("Inherit", "inherit", "number:timeout"), false);
  assert.equal(V.needsReset("", 0, "number:timeout"), true, "an unparsable field is reset when the section changes");
});

test("parseSetting and settingError", () => {
  assert.equal(V.parseSetting("timeout", "inherit"), "inherit");
  assert.equal(V.parseSetting("timeout", " 3000 "), 3000);
  assert.equal(V.parseSetting("maxRedirects", "inherit"), null);
  assert.equal(V.parseSetting("maxRedirects", "-1"), null);
  assert.equal(V.parseSetting("maxRedirects", "2.5"), null);
  assert.equal(V.settingError("timeout", "abc"), V.TIMEOUT_ERROR);
  assert.equal(V.settingError("maxRedirects", ""), V.NUMBER_ERROR);
  assert.equal(V.settingError("maxRedirects", "3"), null);
});

test("fieldsOf: each tab's fields, and their edits make data the writer accepts", () => {
  const ids = (tab, text = full) => V.fieldsOf(tab, data(text, tab)).map((f) => f.id);
  assert.deepEqual(ids("headers", minimal), ["headers:0:name", "headers:0:value"]);
  assert.ok(ids("params").includes("path:0:value") && !ids("params").includes("path:0:name"));
  assert.deepEqual(ids("body"), ["body:json"]);
  assert.deepEqual(ids("auth"), ["auth:token"]);
  assert.deepEqual(ids("script"), ["script:pre", "script:post"]);
  assert.deepEqual(ids("tests"), ["tests"]);
  assert.deepEqual(ids("docs"), ["docs"]);
  assert.deepEqual(ids("settings"), ["settings:timeout", "settings:maxRedirects"]);
  assert.ok(ids("assert").includes("assert:3:expression"), "the empty last row");
  const token = V.fieldsOf("auth", data(full, "auth"))[0];
  assert.equal(token.masked, true);
  assert.equal(V.fieldsOf("headers", data(full, "headers"))[0].masked, undefined, "headers are not masked, as in Bruno");

  const edit = (tab, id, value, text = full) => {
    const f = V.fieldsOf(tab, data(text, tab)).find((x) => x.id === id);
    const next = f.edit(data(text, tab), value);
    return next == null ? null : writeTab(text, tab, next);
  };
  assert.match(edit("auth", "auth:token", "demo-token-123"), /token: demo-token-123/);
  assert.match(edit("headers", "headers:3:name", "x-new"), /- name: x-new\n {6}value: ""/);
  assert.match(edit("settings", "settings:timeout", "inherit"), /timeout: inherit/);
  assert.equal(edit("settings", "settings:timeout", "soon"), null, "an invalid number is not written");
  assert.equal(edit("script", "script:pre", 'req.setHeader("x-pre", "1");\n'), null, "only whitespace changed");
  assert.match(edit("tests", "tests", "test('a', () => {});"), /code: test\('a', \(\) => \{\}\);/);
  assert.match(edit("docs", "docs", "# Hi"), /docs: "# Hi"/);
  assert.match(edit("body", "body:json", '{"a":1}'), /data: '\{"a":1\}'/);
  const auth = V.fieldsOf("auth", { mode: "basic", username: "", password: "" }).map((f) => [f.id, f.masked === true]);
  assert.deepEqual(auth, [["auth:username", false], ["auth:password", true]]);
  const apikey = V.fieldsOf("auth", { mode: "apikey", key: "", value: "", placement: "header" }).map((f) => [f.id, f.masked === true]);
  assert.deepEqual(apikey, [["auth:key", false], ["auth:value", true]]);
  assert.deepEqual(V.fieldsOf("auth", { mode: "inherit" }), []);
});

test("prettifyJson: two-space indents, Bruno variables kept, strings untouched", () => {
  assert.deepEqual(V.prettifyJson('{"a":1,"b":[1,2],"c":{}}'), { ok: true, text: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ],\n  "c": {}\n}' });
  assert.deepEqual(V.prettifyJson('{"id":{{orderId}},"note":"a, b: {c}"}'), { ok: true, text: '{\n  "id": {{orderId}},\n  "note": "a, b: {c}"\n}' });
  assert.deepEqual(V.prettifyJson('[ ]'), { ok: true, text: "[]" });
  assert.deepEqual(V.prettifyJson('{"s":"q\\"x"}'), { ok: true, text: '{\n  "s": "q\\"x"\n}' });
  assert.equal(V.prettifyJson('{"n": 1.50}').text, '{\n  "n": 1.50\n}', "numbers as written");
  for (const bad of ['{"a":', "{a:1}", '{"a":1,}', "", '"open']) assert.deepEqual(V.prettifyJson(bad), { ok: false, message: V.PRETTIFY_FAILED }, bad);
});
