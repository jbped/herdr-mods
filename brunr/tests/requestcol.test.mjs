// The dialog's Request column, opened through the herdr and gpui shims: the keyboard's places,
// typing that runs no tree key, the save key from each kind of field, the menus and save questions
// as the dialog's pickers, and a save that the dialog's close finishes and releases.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./helpers.mjs";
import { scratch, openRequest, press, press_key, typeIn, draw, elements, drafts, errors, herdr, setFocus, bound, cx, waitFor } from "./dialoghelp.mjs";
import { stepPlace, METHODS } from "../mods/brunr/request.js";
import { isSaving } from "../mods/brunr/saveflow.js";

const full = readFileSync(join(FIXTURES, "form/full.yml"), "utf8");
let dir;

before(() => {
  dir = scratch({ "Full.yml": full, "Other.yml": full.replace("name: ", "name: Other ") });
  herdr.state.shared = {};
});
after(() => { dir.cleanup(); });

const file = (name = "Full.yml") => readFileSync(join(dir.root, name), "utf8");
/** Edits the File text as typing in the editor would, with the editor holding the keyboard. */
function fileEdit(col, text) {
  setFocus(col.reqEditor, true, cx);
  col.reqEditor.set_value(text);
  col.editorChanged();
}

test("ctrl-h and ctrl-l step through the tree, the Request and the Response; the Request is skipped when none shows", () => {
  assert.equal(stepPlace("tree", 1, true), "request");
  assert.equal(stepPlace("request", 1, true), "response");
  assert.equal(stepPlace("response", 1, true), "response");
  assert.equal(stepPlace("response", -1, true), "request");
  assert.equal(stepPlace("request", -1, true), "tree");
  assert.equal(stepPlace("tree", -1, true), "tree");
  assert.equal(stepPlace("tree", 1, false), "response");
  assert.equal(stepPlace("response", -1, false), "tree");
});

test("the keyboard moves into the URL field and out again; typed keys there run no tree key", async () => {
  const { dialog, col } = await openRequest(dir.root, "Full.yml");
  dialog.rows = [{ key: "a", kind: "request" }, { key: "b", kind: "request" }];
  dialog.sel = "a";
  press_key(dialog, "ctrl-l");
  assert.equal(dialog.focus, "request");
  let focused = 0;
  col.urlInput.focus = () => { focused++; };
  press_key(dialog, "j");
  assert.equal(dialog.sel, "a", "j on the Request column does not move the tree");
  press_key(dialog, "enter");
  assert.equal(focused, 1, "enter on the Request column goes into the URL field");
  setFocus(col.urlInput, true, cx);
  assert.equal(col.typing, true);
  for (const k of ["j", "k", "r", "p", "e", "o", "y", "b", "f", "1", "/", "enter", "space", ","]) {
    const stopped = press_key(dialog, k);
    assert.equal(stopped, false, `${k} is left to the field`);
  }
  assert.equal(dialog.sel, "a", "j did not move the tree");
  assert.equal(dialog.vars, null, "p opened nothing");
  assert.equal(dialog.shortcuts.open, false, ", opened nothing");
  press_key(dialog, "ctrl-l");
  assert.equal(dialog.focus, "response", "ctrl-l still moves the keyboard from a field");
  setFocus(col.urlInput, false, cx);
  setFocus(col.urlInput, true, cx);
  dialog.focus = "request";
  press_key(dialog, "escape");
  assert.equal(dialog.focus, "tree", "esc in a field goes back to the tree");
  draw(dialog);
  assert.deepEqual(errors, []);
});

test("the save key saves from the URL field, a form field, a form editor, the File editor and the tree", async () => {
  const { dialog, col } = await openRequest(dir.root, "Full.yml");
  const save = async (what) => {
    assert.ok(drafts.has(col.req.key), `${what}: a Draft`);
    const stopped = press_key(dialog, "ctrl-s");
    assert.equal(stopped, true, `${what}: the key is taken`);
    await waitFor(() => !drafts.has(col.req.key) && !col.saving, `the save from ${what}`);
    assert.equal(file(), col.reqText, `${what}: the file holds the Draft`);
    for (const w of [...col.focused]) setFocus(w, false, cx);
  };
  setFocus(col.urlInput, true, cx);
  col.urlInput.set_value("{{baseUrl}}/orders/:shop?verbose=1&lang=en");
  col.urlChanged();
  await save("the URL field");
  press(dialog, "brunr-tab-headers");
  typeIn(dialog, "headers:0:value", "from-a-field");
  await save("a form field");
  press(dialog, "brunr-tab-script");
  typeIn(dialog, "script:pre", "req.setHeader(\"x-a\", \"1\");");
  await save("a form editor");
  press(dialog, "brunr-tab-file");
  fileEdit(col, col.reqText.replace("seq: ", "seq: 4"));
  await save("the File editor");
  col.methodChosen("PATCH");
  await save("the tree");
  // The same key is also bound in the Request column's key context, for an editor that keeps keys.
  assert.ok(bound.some((b) => b.keystroke === "ctrl-s" && b.context === "BrunrRequest"));
  draw(dialog);
  const action = bound.find((b) => b.keystroke === "ctrl-s").action;
  col.methodChosen("PUT");
  elements.get("brunr-request").handlers[`on_action:${action}`]({ action }, cx);
  await waitFor(() => !drafts.has(col.req.key) && !col.saving, "the save by the action");
  assert.match(file(), /method: PUT/);
  assert.deepEqual(errors, []);
});

test("the method menu is a picker of method names; esc closes it with no change", async () => {
  const { dialog, col } = await openRequest(dir.root, "Other.yml");
  press(dialog, "brunr-method");
  assert.deepEqual(dialog.pickers.open.options.map((o) => o.value), METHODS);
  const before = col.reqText;
  press_key(dialog, "escape");
  assert.equal(dialog.pickers.open, null);
  assert.equal(col.reqText, before);
  press(dialog, "brunr-method");
  press_key(dialog, "j");
  const at = dialog.pickers.open.at;
  press_key(dialog, "enter");
  assert.match(col.reqText, new RegExp(`method: ${METHODS[at]}`));
  assert.equal(herdr.overlays.length, 0, "no overlay");
  drafts.discard(col.req.key, file("Other.yml"));
});

test("save questions are pickers: lint Cancel keeps the Draft, Save anyway writes; a conflict reloads or overwrites", async () => {
  const { dialog, col } = await openRequest(dir.root, "Other.yml");
  const disk = file("Other.yml");
  fileEdit(col, col.reqText.replace(/url: ".*"/, "url: {{baseUrl}}/lint"));
  const ask = async () => { press_key(dialog, "ctrl-s"); await waitFor(() => dialog.pickers.open, "the question"); return dialog.pickers.open; };
  let p = await ask();
  assert.match(p.title, /with a warning/);
  assert.ok(p.lines.length >= 1);
  dialog.pickers.pick(p.options.findIndex((o) => o.value === "cancel"), cx);
  assert.equal(col.saving, null);
  assert.equal(file("Other.yml"), disk);
  assert.ok(drafts.has(col.req.key));
  p = await ask();
  press_key(dialog, "escape");
  assert.equal(col.saving, null, "esc is a cancel too");
  p = await ask();
  dialog.pickers.pick(p.options.findIndex((o) => o.value === "anyway"), cx);
  await waitFor(() => !col.saving, "the save");
  assert.match(file("Other.yml"), /url: \{\{baseUrl\}\}\/lint/);
  assert.equal(drafts.has(col.req.key), false);

  // A conflict: the file changes on disk under a Draft.
  writeFileSync(join(dir.root, "Other.yml"), disk);
  drafts.diskChanged(col.req.key, disk);
  await waitFor(() => col.reqText === disk, "the disk text, as a reload reads it");
  col.methodChosen("DELETE");
  writeFileSync(join(dir.root, "Other.yml"), disk.replace("seq: ", "seq: 7"));
  p = await ask();
  assert.match(p.title, /changed on disk/);
  dialog.pickers.pick(p.options.findIndex((o) => o.value === "reload"), cx);
  assert.equal(drafts.has(col.req.key), false, "reload drops the Draft");
  await waitFor(() => col.reqText === file("Other.yml"), "the disk text");
  col.methodChosen("HEAD");
  writeFileSync(join(dir.root, "Other.yml"), disk);
  p = await ask();
  dialog.pickers.pick(p.options.findIndex((o) => o.value === "overwrite"), cx);
  await waitFor(() => !col.saving, "the overwrite");
  assert.match(file("Other.yml"), /method: HEAD/);
  writeFileSync(join(dir.root, "Other.yml"), disk);
  assert.deepEqual(errors, []);
});

test("closing the dialog during a save finishes the write and releases the save", async () => {
  const { dialog, col } = await openRequest(dir.root, "Full.yml");
  col.methodChosen("OPTIONS");
  const key = col.req.key;
  let ran = false;
  col.saveThen(cx, [col.req], () => { ran = true; });
  assert.ok(isSaving(key));
  await dialog.close();
  assert.equal(isSaving(key), false, "released");
  assert.equal(col.saving, null);
  assert.match(file(), /method: OPTIONS/, "the write was finished");
  assert.equal(drafts.has(key), false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran, false, "nothing runs after the close");
  assert.deepEqual(errors, []);
});

test("closing the dialog while a save question is open keeps the Draft and releases the save", async () => {
  const { dialog, col } = await openRequest(dir.root, "Other.yml");
  const disk = file("Other.yml");
  fileEdit(col, col.reqText.replace(/url: ".*"/, "url: {{baseUrl}}/lint"));
  press_key(dialog, "ctrl-s");
  await waitFor(() => dialog.pickers.open, "the question");
  const key = col.req.key;
  assert.ok(isSaving(key));
  await dialog.close();
  assert.equal(isSaving(key), false, "released");
  assert.equal(file("Other.yml"), disk, "nothing written");
  assert.ok(drafts.has(key), "the Draft stays in memory");
  // A new dialog shows the Draft.
  const again = await openRequest(dir.root, "Other.yml");
  assert.match(again.col.reqText, /url: \{\{baseUrl\}\}\/lint/);
  drafts.discard(key, disk);
  assert.deepEqual(errors, []);
});
