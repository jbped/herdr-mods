// Opens the Brunr dialog (main.js) through the herdr and gpui shims, as Herdr would, and shows a
// Request file of a scratch folder in its Request column. Drives it as a person would: clicks on
// drawn ids, typing into a field's state followed by its change handlers, key presses through the
// dialog's key handler, and a menu or question answered by choosing in the dialog's picker. Used
// by the Request column and form tests. Not a test file.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as herdr from "./herdr-shim.mjs";
import { elements, type, click, setFocus } from "./gpui-shim.mjs";
import * as store from "../mods/brunr/store.js";
import * as drafts from "../mods/brunr/drafts.js";
import { draftKey } from "../mods/brunr/drafts.js";

export const errors = [];
export const bound = [];
export const cx = {
  spawn(fn) { Promise.resolve().then(() => fn(cx)).catch((e) => errors.push(e)); },
  notify() {}, stop_propagation() {}, write_to_clipboard() {},
  bind_keys(list) { bound.push(...list); return list.length; },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
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
  const root = join(mkdtempSync(join(tmpdir(), "brunr-col-")), "Shop");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, cleanup: () => rmSync(join(root, ".."), { recursive: true, force: true }) };
}

/** Opens a dialog copy. Its config is missing, so it lists no Collection: tests show Requests themselves. */
export async function openDialog() {
  herdr.state.props = { dialog: true, overlay: "overlay-dialog" };
  const { default: Brunr } = await import("../mods/brunr/main.js");
  const self = new Brunr();
  self.init(undefined, cx);
  await waitFor(() => !self.loadingAll, "the dialog to read its config");
  return self;
}

/** What the Request column needs to show `path` of `root`. */
export const info = (root, path, format = "yaml") => ({ key: draftKey(null, root, path), ck: `|${root}`, machine: null, root, path, format, name: path.replace(/\.(yml|bru)$/, "") });

/** Shows `path` of `root` in the dialog's Request column. Resolves once the text is read. Returns the column. */
export async function showIn(self, root, path, format = "yaml") {
  self.request.show(info(root, path, format), cx);
  await waitFor(() => self.request.reqText != null && self.request.req?.path === path, "the Request text");
  return self.request;
}

/** A new dialog showing `path` of `root`: `{ dialog, col }`. */
export async function openRequest(root, path, format = "yaml") {
  const dialog = await openDialog();
  const col = await showIn(dialog, root, path, format);
  return { dialog, col };
}

export const draw = (self) => { elements.clear(); self.render(cx); };

/** Clicks a drawn element after drawing the dialog. */
export function press(self, id) { draw(self); click(id, cx); draw(self); }

/** Types `text` into the shown tab's field `id` (its whole new content). The field has the keyboard while typed in. */
export function typeIn(dialog, id, text) {
  const col = dialog.request;
  const w = col.form.wid.get(id);
  if (!w) throw new Error(`no field ${id} on ${col.form.tab}: ${[...col.form.wid.keys()].join(", ")}`);
  setFocus(w, true, cx);
  type(w, text, cx);
}

/** Presses a key in the dialog: `keystroke` as the app spells it ("ctrl-s", "j", "escape"). */
export function press_key(self, keystroke) {
  const parts = keystroke.split("-");
  const key = parts.at(-1) || "-";
  const mods = new Set(parts.slice(0, -1));
  let stopped = false;
  const kcx = { ...cx, stop_propagation() { stopped = true; } };
  self.key({ key, keystroke, modifiers: { control: mods.has("ctrl"), shift: mods.has("shift"), alt: mods.has("alt"), platform: false } }, kcx);
  return stopped;
}

/** Opens the menu drawn as `buttonId` and chooses `value` in the dialog's picker. */
export async function choose(self, buttonId, value) {
  press(self, buttonId);
  const p = self.pickers.open;
  if (!p) throw new Error(`no picker opened by ${buttonId}`);
  const i = p.options.findIndex((o) => o.value === value);
  if (i < 0) throw new Error(`no ${value} in the picker: ${p.options.map((o) => o.value).join(", ")}`);
  self.pickers.pick(i, cx);
  draw(self);
}

/** Saves the shown Draft with ctrl-s, as the dialog's key handler takes it. */
export async function save(self) {
  const key = self.request.req.key;
  press_key(self, "ctrl-s");
  await waitFor(() => !drafts.has(key) && !self.request.saving, "the save");
}

export { herdr, drafts, store, elements, setFocus };
