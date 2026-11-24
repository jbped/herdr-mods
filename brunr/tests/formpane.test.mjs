// The Request form in the dialog's Request column, opened through the herdr and gpui shims: the tab
// strip, each tab's edits reaching the Draft text, File edits reaching the tabs, fields that are
// not reset while typed in, the unreadable notice, bru and other types on File only, and the
// remembered tab. Menus are the dialog's pickers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./helpers.mjs";
import { scratch, openRequest, press, typeIn, choose, save, draw, elements, drafts, errors, herdr } from "./dialoghelp.mjs";
import { readTab } from "../mods/brunr/form.js";
import { FORM_NOTE, PRETTIFY_FAILED, UNREADABLE_NOTE } from "../mods/brunr/formview.js";

const full = readFileSync(join(FIXTURES, "form/full.yml"), "utf8");
let dir;

before(() => {
  dir = scratch({
    "Full.yml": full,
    "Flow.yml": full.replace(/ {2}headers:\n(?: {4}.*\n)+/, "  headers: [{name: a, value: b}]\n"),
    "Plain.bru": "meta {\n  name: Plain\n  type: http\n  seq: 1\n}\n\nget {\n  url: http://example.test\n}\n",
    "Graph.yml": full.replace("type: http", "type: graphql"),
  });
  herdr.state.shared = {};
});
after(() => { dir.cleanup(); });

/** Replaces the File editor's text, as typing in it would. */
function fileEdit(col, text) {
  col.reqEditor.set_value(text);
  col.editorChanged();
}

test("the strip shows Bruno's tabs and badges; File holds the editor", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  draw(self);
  for (const tab of ["params", "body", "headers", "auth", "vars", "script", "assert", "tests", "docs", "settings", "file"]) assert.ok(elements.has(`brunr-tab-${tab}`), tab);
  assert.equal(col.form.tab, "params");
  assert.deepEqual(col.form.cache.badges, { params: { count: 3 }, body: { dot: true }, headers: { count: 2 }, auth: { dot: true }, vars: { count: 2 }, script: { dot: true }, assert: { count: 2 }, tests: { dot: true }, docs: { dot: true }, settings: { dot: true } });
  assert.ok(elements.has("brunr-query-table") && elements.has("brunr-path-table"));
  press(self, "brunr-tab-file");
  assert.equal(col.form.wid.size, 0, "File has no form fields");
  assert.equal(herdr.state.shared["brunr.saved.formTab"], "file", "the tab name, in the dialog's saved choices");
});

test("Params: a query edit rewrites the URL and the URL bar; a path value; a File edit reaches the table", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  assert.equal(col.form.tab, "file", "opens on the tab last used");
  press(self, "brunr-tab-params");
  const field = col.form.wid.get("query:0:value");
  typeIn(self, "query:0:value", "2");
  assert.match(col.reqText, /url: "\{\{baseUrl\}\}\/orders\/:shop\?verbose=2&lang=\{\{lang\}\}"/);
  assert.equal(col.urlInput.value(), "{{baseUrl}}/orders/:shop?verbose=2&lang={{lang}}");
  assert.equal(col.form.wid.get("query:0:value"), field, "the field being typed in is kept");
  assert.equal(field.value(), "2");
  typeIn(self, "path:0:value", "9");
  assert.match(col.reqText, /- name: shop\n {6}value: "9"/);
  assert.ok(drafts.has(col.req.key));
  fileEdit(col, col.reqText.replace("value: \"2\"\n      type: query", "value: \"5\"\n      type: query").replace("verbose=2", "verbose=5"));
  assert.equal(col.form.wid.get("query:0:value").value(), "5", "a File edit shows in the form");
  draw(self);
  press(self, "brunr-query-remove-2");
  assert.ok(!/name: debug/.test(col.reqText));
  press(self, "brunr-query-on-0");
  assert.equal(readTab(col.reqText, "params").data.query[0].enabled, false);
  assert.deepEqual(errors, []);
});

test("Headers: the empty last row adds a row; emptied rows are not written", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  press(self, "brunr-tab-headers");
  typeIn(self, "headers:3:name", "x-new");
  assert.equal(readTab(col.reqText, "headers").data.length, 4);
  assert.ok(col.form.wid.has("headers:4:name"), "a new empty last row");
  typeIn(self, "headers:3:name", "");
  assert.equal(readTab(col.reqText, "headers").data.length, 3);
  assert.ok(!/x-new/.test(col.reqText));
});

test("Body: mode menu, JSON editor, Prettify, form rows", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  press(self, "brunr-tab-body");
  typeIn(self, "body:json", '{"a":[1,{"b":{{x}}}]}');
  press(self, "brunr-body-prettify");
  assert.equal(readTab(col.reqText, "body").data.text, '{\n  "a": [\n    1,\n    {\n      "b": {{x}}\n    }\n  ]\n}');
  assert.equal(col.form.wid.get("body:json").value(), readTab(col.reqText, "body").data.text, "the editor shows the new text");
  typeIn(self, "body:json", "{bad");
  const before = col.reqText;
  press(self, "brunr-body-prettify");
  assert.equal(col.reqText, before);
  assert.equal(col.form.note, PRETTIFY_FAILED);
  await choose(self, "brunr-body-mode", "form-urlencoded");
  assert.ok(col.form.wid.has("form:0:name"));
  typeIn(self, "form:0:name", "a");
  typeIn(self, "form:0:value", "1");
  assert.match(col.reqText, /type: form-urlencoded\n {4}data:\n {6}- name: a\n {8}value: "1"/);
  await choose(self, "brunr-body-mode", "none");
  assert.equal(readTab(col.reqText, "body").data.mode, "none");
});

test("Script and Tests: the editor keeps what was typed while its trimmed text is the section's", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  press(self, "brunr-tab-script");
  const pre = col.form.wid.get("script:pre");
  typeIn(self, "script:pre", 'req.setHeader("x-pre", "2");\n\n');
  assert.equal(pre.value(), 'req.setHeader("x-pre", "2");\n\n', "trailing newlines stay while typing");
  assert.equal(readTab(col.reqText, "script").data.pre, 'req.setHeader("x-pre", "2");');
  fileEdit(col, col.reqText.replace('"x-pre", "2"', '"x-pre", "3"'));
  assert.equal(pre.value(), 'req.setHeader("x-pre", "3");', "an edit in File replaces it");
  press(self, "brunr-tab-tests");
  typeIn(self, "tests", "test('t', () => {});\n");
  assert.match(col.reqText, /- type: tests\n {6}code: test\('t', \(\) => \{\}\);\n/);
});

test("Auth: masked fields with reveal, inherit note, API key placement", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  press(self, "brunr-tab-auth");
  assert.equal(col.form.wid.get("auth:token").masked, true);
  press(self, "brunr-reveal-auth-token");
  assert.equal(col.form.wid.get("auth:token").masked, false);
  await choose(self, "brunr-auth-mode", "apikey");
  typeIn(self, "auth:key", "x-api-key");
  typeIn(self, "auth:value", "demo-key-1");
  assert.equal(col.form.wid.get("auth:value").masked, true);
  await choose(self, "brunr-auth-placement", "query");
  assert.match(col.reqText, /type: apikey\n {4}key: x-api-key\n {4}value: demo-key-1\n {4}placement: query/);
  await choose(self, "brunr-auth-mode", "inherit");
  assert.match(col.reqText, /auth: inherit/);
});

test("Vars, Assert, Settings and Docs", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  press(self, "brunr-tab-vars");
  typeIn(self, "post:2:name", "total");
  typeIn(self, "post:2:expression", "res.body.total");
  assert.equal(readTab(col.reqText, "vars").data.post.at(-1).expression, "res.body.total");
  press(self, "brunr-tab-assert");
  await choose(self, "brunr-assert-op-0", "isNumber");
  assert.deepEqual(readTab(col.reqText, "assert").data[0], { expression: "res.status", operator: "isNumber", value: "", enabled: true });
  assert.ok(!col.reqText.includes('operator: isNumber\n      value: "201"'), "a unary operator has no value");
  press(self, "brunr-tab-settings");
  press(self, "brunr-setting-encodeUrl-toggle");
  assert.equal(readTab(col.reqText, "settings").data.encodeUrl, true);
  typeIn(self, "settings:timeout", "inherit");
  assert.equal(readTab(col.reqText, "settings").data.timeout, "inherit");
  typeIn(self, "settings:maxRedirects", "abc");
  assert.equal(readTab(col.reqText, "settings").data.maxRedirects, 2, "an invalid number is not written");
  assert.equal(col.form.wid.get("settings:maxRedirects").value(), "abc", "and the field keeps what was typed");
  press(self, "brunr-tab-docs");
  typeIn(self, "docs", "# New docs\n");
  assert.equal(readTab(col.reqText, "docs").data, "# New docs\n");
  await save(self);
  assert.equal(readFileSync(join(dir.root, "Full.yml"), "utf8"), col.reqText);
});

test("an unreadable section shows the notice and a way to File, and is never written", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Flow.yml");
  press(self, "brunr-tab-headers");
  assert.ok(elements.has("brunr-form-unreadable"));
  assert.equal(col.form.wid.size, 0);
  assert.ok(UNREADABLE_NOTE);
  press(self, "brunr-form-open-file");
  assert.equal(col.form.tab, "file");
  assert.equal(drafts.has(col.req.key), false);
});

test("a bru Request and a GraphQL Request show File only, with the note", async () => {
  for (const [path, format] of [["Plain.bru", "bru"], ["Graph.yml", "yaml"]]) {
    const { dialog: self, col } = await openRequest(dir.root, path, format);
    draw(self);
    assert.ok(!elements.has("brunr-form-tabs"), path);
    assert.equal(col.form.wid.size, 0);
  }
  assert.ok(FORM_NOTE.includes("YAML"));
});

test("a File edit that makes the Request another type hides the strip", async () => {
  const { dialog: self, col } = await openRequest(dir.root, "Full.yml");
  press(self, "brunr-tab-headers");
  fileEdit(col, col.reqText.replace("type: http", "type: grpc"));
  draw(self);
  assert.ok(!elements.has("brunr-form-tabs"));
  assert.equal(col.form.wid.size, 0);
  fileEdit(col, col.reqText.replace("type: grpc", "type: http"));
  draw(self);
  assert.ok(elements.has("brunr-form-tabs"));
  assert.ok(col.form.wid.has("headers:0:name"));
});
