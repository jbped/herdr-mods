// ctrl-s is "brunr.save", which reaches every shown brunr copy. While an Environment or .env editor
// window is open, the Request pane must not also save its Draft. The marker is in memory (store.js)
// and is set when an editor window opens and cleared when it closes, by every way it closes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as herdr from "./herdr-shim.mjs";
import { elements, type, click } from "./gpui-shim.mjs";
import { FIXTURES } from "./helpers.mjs";
import * as store from "../mods/brunr/store.js";
import { paneSaves } from "../mods/brunr/request.js";

let dir;
const errors = [];

function copyCollection(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith(".env")) continue;
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) copyCollection(a, b); else copyFileSync(a, b);
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "brunr-editorlock-"));
  copyCollection(join(FIXTURES, "yaml"), join(dir, "Shop"));
  herdr.state.platform = "linux";
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
});
after(() => { delete globalThis.localStorage; rmSync(dir, { recursive: true, force: true }); });

const cx = {
  spawn(fn) { Promise.resolve().then(() => fn(cx)).catch((e) => errors.push(e)); },
  notify() {}, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { every() {}, after() {} },
};

async function openEditor(propsValue) {
  herdr.state.props = { ...propsValue, overlay: "overlay-lock" };
  const { default: Brunr } = await import("../mods/brunr/main.js");
  const self = new Brunr();
  self.init(undefined, cx);
  return self;
}

async function ready(self) {
  for (let i = 0; i < 400 && !(self.ed && !self.ed.loading); i++) {
    if (errors.length) throw errors[0];
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(self.ed && !self.ed.loading, "the editor loaded");
}

const draw = (self) => { elements.clear(); self.render(cx); };
const root = () => join(dir, "Shop");
const ENV = () => ({ envEditor: { machine: null, root: root(), path: "environments/local.yml" } });

test("the pane saves a Draft only on save, with no editor open, while it holds the keyboard", () => {
  assert.equal(paneSaves("save", false, true), true);
  assert.equal(paneSaves("save", true, true), false);
  assert.equal(paneSaves("save", false, false), false);
  assert.equal(paneSaves("focus", false, true), false);
});

test("no editor is open at first", () => { assert.equal(store.editorOpen(), false); });

test("the marker is set while an Environment editor is open and cleared by the x button", async () => {
  const self = await openEditor(ENV());
  assert.equal(store.editorOpen(), true);
  assert.equal(paneSaves("save", store.editorOpen(), true), false);
  await ready(self);
  draw(self);
  click("brunr-editor-close", cx);
  assert.ok(herdr.closed.includes("overlay-lock"));
  await self.close();
  assert.equal(store.editorOpen(), false);
  assert.equal(paneSaves("save", store.editorOpen(), true), true);
});

test("Esc closes the editor and clears the marker", async () => {
  const self = await openEditor(ENV());
  await ready(self);
  draw(self);
  herdr.closed.length = 0;
  // The window's key handler is the frame's on_key_down.
  elements.get("brunr-editor").handlers.on_key_down({ key: "escape", keystroke: "escape" }, cx);
  assert.deepEqual(herdr.closed, ["overlay-lock"]);
  assert.equal(store.editorOpen(), true, "still marked until the window closes");
  await self.close();
  assert.equal(store.editorOpen(), false);
});

test("save then close, and Discard after unsaved edits, clear the marker", async () => {
  const self = await openEditor(ENV());
  await ready(self);
  const name = self.ed.table.rows.find((r) => r.name === "baseUrl").id;
  type(self.ed.inputs.get(name).value, "http://example.test", cx);
  draw(self);
  click("brunr-env-save", cx);
  for (let i = 0; i < 400 && !self.ed.status?.ok; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(self.ed.status?.ok, "saved");
  assert.equal(store.editorOpen(), true);
  draw(self);
  click("brunr-editor-close", cx);
  await self.close();
  assert.equal(store.editorOpen(), false, "closed after a save");

  const again = await openEditor(ENV());
  await ready(again);
  type(again.ed.inputs.get(again.ed.table.blank).name, "unsaved", cx);
  draw(again);
  click("brunr-editor-close", cx);
  assert.equal(again.ed.ask.title, "Discard unsaved changes?");
  assert.equal(store.editorOpen(), true, "the question keeps the window open");
  draw(again);
  click("brunr-ask-1", cx);
  await again.close();
  assert.equal(store.editorOpen(), false, "closed after Discard");
});

test("the .env editor sets and clears it too, and with two editors open it clears only when both are closed", async () => {
  const a = await openEditor({ dotenvEditor: { machine: null, root: root(), path: ".env" } });
  const b = await openEditor(ENV());
  assert.equal(store.editorOpen(), true);
  await ready(a); await ready(b);
  await a.close();
  assert.equal(store.editorOpen(), true, "the other editor is still open");
  await b.close();
  assert.equal(store.editorOpen(), false);
});

test("an editor for another Machine marks and clears too", async () => {
  const self = await openEditor({ envEditor: { machine: "build-box", root: "/srv/shop", path: null } });
  assert.equal(store.editorOpen(), true);
  await self.close();
  assert.equal(store.editorOpen(), false);
});
