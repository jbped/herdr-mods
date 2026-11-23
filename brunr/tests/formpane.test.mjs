// The Request form in the pane copy, opened through the herdr and gpui shims: the tab strip, each
// tab's edits reaching the Draft text, File edits reaching the tabs, fields that are not reset
// while typed in, the unreadable notice, bru and other types on File only, and the remembered tab.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./helpers.mjs";
import { scratch, openPane, press, typeIn, choose, save, draw, elements, drafts, errors, store, waitFor, cx } from "./panehelp.mjs";
import { editorChanged } from "../mods/brunr/request.js";
import { readTab } from "../mods/brunr/form.js";
import { FORM_NOTE, PRETTIFY_FAILED, UNREADABLE_NOTE } from "../mods/brunr/formview.js";

const full = readFileSync(join(FIXTURES, "form/full.yml"), "utf8");
const storage = new Map();
let dir;

before(() => {
  dir = scratch({
    "Full.yml": full,
    "Flow.yml": full.replace(/ {2}headers:\n(?: {4}.*\n)+/, "  headers: [{name: a, value: b}]\n"),
    "Plain.bru": "meta {\n  name: Plain\n  type: http\n  seq: 1\n}\n\nget {\n  url: http://example.test\n}\n",
    "Graph.yml": full.replace("type: http", "type: graphql"),
  });
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
});
after(() => { delete globalThis.localStorage; dir.cleanup(); });

/** Replaces the File editor's text, as typing in it would. */
function fileEdit(self, text) {
  self.reqEditor.set_value(text);
  editorChanged(self);
}

test("the strip shows Bruno's tabs and badges; File holds the editor", async () => {
  storage.clear();
  const self = await openPane(dir.root, "Full.yml");
  draw(self);
  for (const tab of ["params", "body", "headers", "auth", "vars", "script", "assert", "tests", "docs", "settings", "file"]) assert.ok(elements.has(`brunr-tab-${tab}`), tab);
  assert.equal(self.form.tab, "params");
  assert.deepEqual(self.form.cache.badges, { params: { count: 3 }, body: { dot: true }, headers: { count: 2 }, auth: { dot: true }, vars: { count: 2 }, script: { dot: true }, assert: { count: 2 }, tests: { dot: true }, docs: { dot: true }, settings: { dot: true } });
  assert.ok(elements.has("brunr-query-table") && elements.has("brunr-path-table"));
  press(self, "brunr-tab-file");
  assert.equal(self.form.wid.size, 0, "File has no form fields");
  assert.equal(storage.get("requestTab"), "file");
});

test("Params: a query edit rewrites the URL and the URL bar; a path value; a File edit reaches the table", async () => {
  const self = await openPane(dir.root, "Full.yml");
  assert.equal(self.form.tab, "file", "opens on the tab last used");
  press(self, "brunr-tab-params");
  const field = self.form.wid.get("query:0:value");
  typeIn(self, "query:0:value", "2");
  assert.match(self.reqText, /url: "\{\{baseUrl\}\}\/orders\/:shop\?verbose=2&lang=\{\{lang\}\}"/);
  assert.equal(self.urlInput.value(), "{{baseUrl}}/orders/:shop?verbose=2&lang={{lang}}");
  assert.equal(self.form.wid.get("query:0:value"), field, "the field being typed in is kept");
  assert.equal(field.value(), "2");
  typeIn(self, "path:0:value", "9");
  assert.match(self.reqText, /- name: shop\n {6}value: "9"/);
  assert.ok(drafts.has(self.req.key));
  fileEdit(self, self.reqText.replace("value: \"2\"\n      type: query", "value: \"5\"\n      type: query").replace("verbose=2", "verbose=5"));
  assert.equal(self.form.wid.get("query:0:value").value(), "5", "a File edit shows in the form");
  draw(self);
  press(self, "brunr-query-remove-2");
  assert.ok(!/name: debug/.test(self.reqText));
  press(self, "brunr-query-on-0");
  assert.equal(readTab(self.reqText, "params").data.query[0].enabled, false);
  assert.deepEqual(errors, []);
});

test("Headers: the empty last row adds a row; emptied rows are not written", async () => {
  const self = await openPane(dir.root, "Full.yml");
  press(self, "brunr-tab-headers");
  typeIn(self, "headers:3:name", "x-new");
  assert.equal(readTab(self.reqText, "headers").data.length, 4);
  assert.ok(self.form.wid.has("headers:4:name"), "a new empty last row");
  typeIn(self, "headers:3:name", "");
  assert.equal(readTab(self.reqText, "headers").data.length, 3);
  assert.ok(!/x-new/.test(self.reqText));
});

test("Body: mode menu, JSON editor, Prettify, form rows", async () => {
  const self = await openPane(dir.root, "Full.yml");
  press(self, "brunr-tab-body");
  typeIn(self, "body:json", '{"a":[1,{"b":{{x}}}]}');
  press(self, "brunr-body-prettify");
  assert.equal(readTab(self.reqText, "body").data.text, '{\n  "a": [\n    1,\n    {\n      "b": {{x}}\n    }\n  ]\n}');
  assert.equal(self.form.wid.get("body:json").value(), readTab(self.reqText, "body").data.text, "the editor shows the new text");
  typeIn(self, "body:json", "{bad");
  const before = self.reqText;
  press(self, "brunr-body-prettify");
  assert.equal(self.reqText, before);
  assert.equal(self.form.note, PRETTIFY_FAILED);
  await choose(self, "brunr-body-mode", "form-urlencoded");
  assert.ok(self.form.wid.has("form:0:name"));
  typeIn(self, "form:0:name", "a");
  typeIn(self, "form:0:value", "1");
  assert.match(self.reqText, /type: form-urlencoded\n {4}data:\n {6}- name: a\n {8}value: "1"/);
  await choose(self, "brunr-body-mode", "none");
  assert.equal(readTab(self.reqText, "body").data.mode, "none");
});

test("Script and Tests: the editor keeps what was typed while its trimmed text is the section's", async () => {
  const self = await openPane(dir.root, "Full.yml");
  press(self, "brunr-tab-script");
  const pre = self.form.wid.get("script:pre");
  typeIn(self, "script:pre", 'req.setHeader("x-pre", "2");\n\n');
  assert.equal(pre.value(), 'req.setHeader("x-pre", "2");\n\n', "trailing newlines stay while typing");
  assert.equal(readTab(self.reqText, "script").data.pre, 'req.setHeader("x-pre", "2");');
  fileEdit(self, self.reqText.replace('"x-pre", "2"', '"x-pre", "3"'));
  assert.equal(pre.value(), 'req.setHeader("x-pre", "3");', "an edit in File replaces it");
  press(self, "brunr-tab-tests");
  typeIn(self, "tests", "test('t', () => {});\n");
  assert.match(self.reqText, /- type: tests\n {6}code: test\('t', \(\) => \{\}\);\n/);
});

test("Auth: masked fields with reveal, inherit note, API key placement", async () => {
  const self = await openPane(dir.root, "Full.yml");
  press(self, "brunr-tab-auth");
  assert.equal(self.form.wid.get("auth:token").masked, true);
  press(self, "brunr-reveal-auth-token");
  assert.equal(self.form.wid.get("auth:token").masked, false);
  await choose(self, "brunr-auth-mode", "apikey");
  typeIn(self, "auth:key", "x-api-key");
  typeIn(self, "auth:value", "demo-key-1");
  assert.equal(self.form.wid.get("auth:value").masked, true);
  await choose(self, "brunr-auth-placement", "query");
  assert.match(self.reqText, /type: apikey\n {4}key: x-api-key\n {4}value: demo-key-1\n {4}placement: query/);
  await choose(self, "brunr-auth-mode", "inherit");
  assert.match(self.reqText, /auth: inherit/);
});

test("Vars, Assert, Settings and Docs", async () => {
  const self = await openPane(dir.root, "Full.yml");
  press(self, "brunr-tab-vars");
  typeIn(self, "post:2:name", "total");
  typeIn(self, "post:2:expression", "res.body.total");
  assert.equal(readTab(self.reqText, "vars").data.post.at(-1).expression, "res.body.total");
  press(self, "brunr-tab-assert");
  await choose(self, "brunr-assert-op-0", "isNumber");
  assert.deepEqual(readTab(self.reqText, "assert").data[0], { expression: "res.status", operator: "isNumber", value: "", enabled: true });
  assert.ok(!self.reqText.includes('operator: isNumber\n      value: "201"'), "a unary operator has no value");
  press(self, "brunr-tab-settings");
  press(self, "brunr-setting-encodeUrl-toggle");
  assert.equal(readTab(self.reqText, "settings").data.encodeUrl, true);
  typeIn(self, "settings:timeout", "inherit");
  assert.equal(readTab(self.reqText, "settings").data.timeout, "inherit");
  typeIn(self, "settings:maxRedirects", "abc");
  assert.equal(readTab(self.reqText, "settings").data.maxRedirects, 2, "an invalid number is not written");
  assert.equal(self.form.wid.get("settings:maxRedirects").value(), "abc", "and the field keeps what was typed");
  press(self, "brunr-tab-docs");
  typeIn(self, "docs", "# New docs\n");
  assert.equal(readTab(self.reqText, "docs").data, "# New docs\n");
  await save(self);
  assert.equal(readFileSync(join(dir.root, "Full.yml"), "utf8"), self.reqText);
});

test("an unreadable section shows the notice and a way to File, and is never written", async () => {
  const self = await openPane(dir.root, "Flow.yml");
  press(self, "brunr-tab-headers");
  assert.ok(elements.has("brunr-form-unreadable"));
  assert.equal(self.form.wid.size, 0);
  assert.ok(UNREADABLE_NOTE);
  press(self, "brunr-form-open-file");
  assert.equal(self.form.tab, "file");
  assert.equal(drafts.has(self.req.key), false);
});

test("a bru Request and a GraphQL Request show File only, with the note", async () => {
  for (const [path, format] of [["Plain.bru", "bru"], ["Graph.yml", "yaml"]]) {
    const self = await openPane(dir.root, path, format);
    draw(self);
    assert.ok(!elements.has("brunr-form-tabs"), path);
    assert.equal(self.form.wid.size, 0);
  }
  assert.ok(FORM_NOTE.includes("YAML"));
});

test("a File edit that makes the Request another type hides the strip", async () => {
  const self = await openPane(dir.root, "Full.yml");
  press(self, "brunr-tab-headers");
  fileEdit(self, self.reqText.replace("type: http", "type: grpc"));
  draw(self);
  assert.ok(!elements.has("brunr-form-tabs"));
  assert.equal(self.form.wid.size, 0);
  fileEdit(self, self.reqText.replace("type: grpc", "type: http"));
  draw(self);
  assert.ok(elements.has("brunr-form-tabs"));
  assert.ok(self.form.wid.has("headers:0:name"));
});

test("two asks made at once are both taken, each by the pane copy it is addressed to", async () => {
  const a = await openPane(dir.root, "Full.yml");
  const b = await openPane(dir.root, "Flow.yml");
  assert.notEqual(a.addr, b.addr);
  // Made in one turn, before either loop runs: the second must not hide the first.
  store.ask({ to: a.addr, kind: "method", key: a.req.key, value: "PUT" });
  store.ask({ to: b.addr, kind: "method", key: b.req.key, value: "DELETE" });
  store.ask({ to: a.addr, kind: "formMenu", key: a.req.key, tab: a.form.tab, field: "authMode", row: null, value: "none" });
  draw(b);
  draw(a);
  await waitFor(() => /method: PUT/.test(a.reqText) && /method: DELETE/.test(b.reqText), "both methods");
  assert.ok(!/method: DELETE/.test(a.reqText) && !/method: PUT/.test(b.reqText), "no ask reached the other pane");
  // An ask addressed to the panel reaches no pane.
  const before = [a.reqText, b.reqText];
  store.ask({ kind: "method", key: a.req.key, value: "PATCH" });
  draw(a);
  draw(b);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([a.reqText, b.reqText], before);
});

test("an ask is taken when the pane draws, never in the asking turn; a text change waits for cx.sleep", async () => {
  const self = await openPane(dir.root, "Full.yml");
  let release;
  cx.hold = new Promise((r) => { release = r; });
  const before = self.reqText;
  store.ask({ to: self.addr, kind: "method", key: self.req.key, value: "HEAD" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(self.reqText, before, "not taken in the asking turn");
  draw(self);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(self.reqText, before, "not applied while drawing");
  cx.hold = null;
  release();
  await waitFor(() => /method: HEAD/.test(self.reqText), "taken after the sleep");
});

test("save dialogs: Cancel keeps the Draft, Save anyway writes and ends the save, taken when the pane draws", async () => {
  const self = await openPane(dir.root, "Full.yml");
  const { herdr } = await import("./panehelp.mjs");
  const { save: saveShown, editorChanged: edited } = await import("../mods/brunr/request.js");
  const file = join(dir.root, "Full.yml");
  const disk = readFileSync(file, "utf8");
  self.reqEditor.set_value(self.reqText.replace(/url: ".*"/, "url: {{baseUrl}}/lint"));
  edited(self);
  const answer = async (choice) => {
    saveShown(self, cx);
    await waitFor(() => self.question, "the dialog");
    const d = herdr.overlays.at(-1).props.dialog;
    store.ask({ to: d.to, kind: "dialog", flow: d.flow, choice });
    draw(self);
    await waitFor(() => !self.saving, "the save to end");
  };
  await answer("cancel");
  assert.equal(readFileSync(file, "utf8"), disk);
  assert.ok(drafts.has(self.req.key));
  await answer("anyway");
  assert.match(readFileSync(file, "utf8"), /url: \{\{baseUrl\}\}\/lint/);
  assert.equal(drafts.has(self.req.key), false);
  writeFileSync(file, disk);
});
