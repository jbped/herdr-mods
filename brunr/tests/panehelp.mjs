// Opens the Request and Response pane copy through the herdr and gpui shims, as Herdr would, on a
// Request file in a scratch folder, and drives its form as a person would: clicks on drawn ids,
// typing into a field's state followed by its change handlers, and a menu choice sent as the popup
// sends it. Used by the form view tests.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as herdr from "./herdr-shim.mjs";
import { elements, type, click } from "./gpui-shim.mjs";
import * as store from "../mods/brunr/store.js";
import * as drafts from "../mods/brunr/drafts.js";
import { draftKey } from "../mods/brunr/drafts.js";

export const errors = [];
export const cx = {
  spawn(fn) { Promise.resolve().then(() => fn(cx)).catch((e) => errors.push(e)); },
  notify() {}, stop_propagation() {}, write_to_clipboard() {},
  sleep: (ms) => (cx.hold ? cx.hold : new Promise((r) => setTimeout(r, ms))),
  focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { every() {}, after() {} },
};

export async function waitFor(pred, what) {
  for (let i = 0; i < 400; i++) {
    if (errors.length) throw errors[0];
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A scratch Collection folder; `files` maps a relative path to its text. */
export function scratch(files) {
  const root = join(mkdtempSync(join(tmpdir(), "brunr-form-")), "Shop");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, cleanup: () => rmSync(join(root, ".."), { recursive: true, force: true }) };
}

let tabs = 0;

/** Opens a pane copy showing `path` of `root`. Resolves once the text is read. */
export async function openPane(root, path, format = "yaml") {
  const tab = `t${++tabs}`;
  const key = draftKey(null, root, path);
  store.showRequest(tab, { key, ck: `|${root}`, machine: null, root, path, format, name: path.replace(/\.(yml|bru)$/, "") });
  herdr.state.props = { view: "response", tab };
  const { default: Brunr } = await import("../mods/brunr/main.js");
  const self = new Brunr();
  self.init(undefined, cx);
  await waitFor(() => self.reqText != null, "the Request text");
  return self;
}

export const draw = (self) => { elements.clear(); self.render(cx); };

/** Clicks a drawn element after drawing the pane. */
export function press(self, id) { draw(self); click(id, cx); draw(self); }

/** Types `text` into the shown tab's field `id` (its whole new content). */
export function typeIn(self, id, text) {
  const w = self.form.wid.get(id);
  if (!w) throw new Error(`no field ${id} on ${self.form.tab}: ${[...self.form.wid.keys()].join(", ")}`);
  type(w, text, cx);
}

/** Opens the menu drawn as `buttonId` and chooses `value`, as the popup does. */
export async function choose(self, buttonId, value) {
  const before = herdr.overlays.length;
  press(self, buttonId);
  const spec = herdr.overlays[before];
  if (!spec) throw new Error(`no menu opened by ${buttonId}`);
  const item = spec.props.menu.items.find((i) => i.ask?.value === value);
  if (!item) throw new Error(`no ${value} in the menu`);
  // The pane takes the ask when it draws, and applies it after cx.sleep(0).
  const text = self.reqText;
  store.ask(item.ask);
  draw(self);
  await waitFor(() => self.reqText !== text || errors.length, `the ${value} choice`);
  draw(self);
}

/** Saves the shown Draft by the pane's save path (what ctrl-s and Save call). */
export async function save(self) {
  const { save: saveShown } = await import("../mods/brunr/request.js");
  saveShown(self, cx);
  await waitFor(() => !drafts.has(self.req.key) && !self.saving, "the save");
}

export { herdr, drafts, store, elements };
