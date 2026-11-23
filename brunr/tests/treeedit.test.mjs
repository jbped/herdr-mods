// The tree's edit actions in the dialog (main.js, treeactions.js, treeform.js), opened through the herdr and gpui shims with a brunr.json that lists scratch copies
// of the fixture Collections. Keys go through the dialog's key handler, menus and questions through
// its pickers, forms through their inputs. Files are checked on disk after each action.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type } from "./gpui-shim.mjs";
import { FIXTURES } from "./helpers.mjs";
import { openDialog, draw, cx, waitFor, errors, press_key, herdr, drafts, setFocus } from "./dialoghelp.mjs";
import { SHORTCUTS } from "../mods/brunr/treeactions.js";
import * as actions from "../mods/brunr/treeactions.js";

let dir, dialog;
const ROOT = () => join(dir, "Shop");
const BRU = () => join(dir, "Shop bru");
const TWO = () => join(dir, "Shop Two");
const key = (root, path = "") => (path ? `|${root}#${path}` : `|${root}`);
const file = (root, path) => readFileSync(join(root, path), "utf8");

/** A copy of a fixture Collection without its .env. */
function copyCollection(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith(".env")) continue;
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) copyCollection(a, b); else copyFileSync(a, b);
  }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "brunr-treeedit-"));
  copyCollection(join(FIXTURES, "yaml"), ROOT());
  copyCollection(join(FIXTURES, "bru"), BRU());
  copyCollection(join(FIXTURES, "yaml"), TWO());
  writeFileSync(join(TWO(), "opencollection.yml"), file(TWO(), "opencollection.yml").replace(/name: .*/, "name: Shop Two"));
  // Programs run with a PATH that has node and nothing else, so there is no trash command and a
  // delete asks for a permanent delete the same way on every computer.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  herdr.state.path = bin;
  herdr.state.appHome = dir;
  writeFileSync(join(dir, "brunr.json"), JSON.stringify({ workspace: join(dir, "none/workspace.yml"), collections: [{ path: ROOT() }, { path: BRU() }, { path: TWO() }] }));
  dialog = await openDialog();
  await loaded();
});
after(() => { rmSync(dir, { recursive: true, force: true }); });

const loaded = () => waitFor(() => dialog.buildRows().filter((r) => r.kind === "collection" && !r.loading && dialog.collection(r.ck)).length === 3, "the Collections");
const row = (k) => dialog.buildRows().find((r) => r.key === k);
/** Selects a row, as a click does, unfolding its folders first. */
function select(k) {
  const at = k.indexOf("#");
  const path = at < 0 ? "" : k.slice(at + 1);
  const ck = at < 0 ? k : k.slice(0, at);
  dialog.saved.setOpen(ck, true);
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) dialog.saved.setOpen(`${ck}#${parts.slice(0, i).join("/")}`, true);
  const r = row(k);
  assert.ok(r, `row ${k}`);
  dialog.clickRow(cx, r, { click_count: 1 });
  return r;
}
const settle = async (what) => { await waitFor(() => !dialog.busy, what); await new Promise((r) => setTimeout(r, 30)); dialog.buildRows(); };
/** Chooses the picker option whose value or label is `v`. */
function pick(v) {
  const p = dialog.pickers.open;
  assert.ok(p, "a picker is open");
  const i = p.options.findIndex((o) => o.value === v || o.label === v);
  assert.ok(i >= 0, `${v} in ${p.options.map((o) => o.label).join(", ")}`);
  dialog.pickers.pick(i, cx);
}

test("the edit keys are in the dialog's shortcuts registry, on free keys, and can be switched off", () => {
  assert.deepEqual(SHORTCUTS.map((s) => `${s.id}=${s.key}`), ["new-request=n", "new-folder=shift-n", "rename=f2", "move-to=m", "move-up=alt-up", "move-down=alt-down", "delete=delete"]);
  const all = dialog.shortcuts.keys.map((k) => k.key);
  assert.equal(new Set(all).size, all.length, "no two shortcuts share a key");
  for (const s of SHORTCUTS) assert.ok(dialog.shortcuts.keys.some((k) => k.id === s.id), `${s.id} can be switched off or moved in the settings`);
  select(key(ROOT(), "products"));
  dialog.shortcuts.off.add("new-request");
  assert.equal(press_key(dialog, "n"), false, "a key switched off does nothing");
  assert.equal(dialog.treeForm.open, false);
  dialog.shortcuts.off.delete("new-request");
});

test("the row menu lists the edit actions with their keys; a Collection on another Machine gets none", () => {
  dialog.openMenu(row(key(ROOT(), "products")));
  const labels = dialog.pickers.open.options.map((o) => `${o.label}${o.hint ? ` [${o.hint}]` : ""}`);
  for (const l of ["New Request [n]", "New folder [shift-n]", "Rename [f2]", "Move to… [m]", "Delete [delete]"]) assert.ok(labels.includes(l), `${l} in ${labels.join(", ")}`);
  dialog.pickers.close();
  const remote = { ...row(key(ROOT())), machine: "box" };
  assert.deepEqual(actions.menuEntries(dialog, remote), []);
});

test("n opens New Request in the folder; typed letters run no tree key; enter creates, selects and shows it", async () => {
  select(key(ROOT(), "products"));
  press_key(dialog, "n");
  const f = dialog.treeForm;
  assert.equal(f.open, true);
  assert.equal(f.form.title, "New Request");
  const calls = herdr.calls.length;
  for (const k of ["b", "y", "r", "e", "j", "n", "f2"]) press_key(dialog, k);
  assert.equal(herdr.calls.length, calls, "no key started a program while the form was open");
  assert.equal(dialog.vars, null);
  type(f.inputs.name, "Top: Sellers?", cx);
  assert.equal(f.inputs.file.value(), "Top- Sellers-", "the file name follows the name");
  type(f.inputs.url, "{{baseUrl}}/products/top?limit=2", cx);
  f.method = "POST";
  draw(dialog);
  f.confirm(cx);
  await settle("the new Request");
  assert.equal(f.open, false, "the form closed");
  const text = file(ROOT(), "products/Top- Sellers-.yml");
  assert.match(text, /name: "Top: Sellers\?"|name: 'Top: Sellers\?'/);
  assert.match(text, /method: POST/);
  assert.match(text, /- name: limit\n\s+value: "2"/);
  assert.equal(dialog.sel, key(ROOT(), "products/Top- Sellers-.yml"));
  await waitFor(() => dialog.request.req?.path === "products/Top- Sellers-.yml", "the Request column");
  assert.deepEqual(errors, []);
});

test("a name check shows under the field, and esc closes the form without a change", async () => {
  select(key(ROOT(), "products"));
  press_key(dialog, "shift-n");
  const f = dialog.treeForm;
  assert.equal(f.form.title, "New folder");
  type(f.inputs.name, "CON", cx);
  f.confirm(cx);
  assert.ok(f.errors.file, "a reserved name is refused");
  assert.equal(f.busy, false);
  dialog.steppedBack = 0;
  press_key(dialog, "escape");
  assert.equal(f.open, false);
  assert.equal(existsSync(join(ROOT(), "products/CON")), false);
});

test("f2 renames the shown Request with a Draft: the Draft and the Request column follow the file", async () => {
  const k = key(ROOT(), "products/List Products.yml");
  select(k);
  await waitFor(() => dialog.request.req?.key === k && dialog.request.reqText != null, "the Request");
  dialog.request.replaceText(dialog.request.reqText.replace("/products", "/products?draft=1"));
  assert.ok(drafts.has(k));
  press_key(dialog, "f2");
  const f = dialog.treeForm;
  type(f.inputs.name, "Catalog", cx);
  type(f.inputs.file, "Catalog", cx);
  f.confirm(cx);
  await settle("the rename");
  const to = key(ROOT(), "products/Catalog.yml");
  assert.ok(existsSync(join(ROOT(), "products/Catalog.yml")));
  assert.equal(existsSync(join(ROOT(), "products/List Products.yml")), false);
  assert.ok(drafts.has(to), "the Draft followed");
  assert.equal(drafts.has(k), false);
  assert.match(drafts.get(to).text, /name: Catalog/, "the new name is in the Draft");
  assert.match(drafts.get(to).text, /draft=1/, "the edit is kept");
  await waitFor(() => dialog.request.req?.key === to, "the Request column follows");
  assert.equal(dialog.request.reqText, drafts.get(to).text);
  drafts.discard(to, file(ROOT(), "products/Catalog.yml"));
});

test("selecting a folder keeps the last Request in the Request column", () => {
  const shown = dialog.request.req?.key;
  assert.ok(shown);
  select(key(ROOT(), "orders"));
  assert.equal(dialog.request.req?.key, shown);
});

test("Move to by the picker moves into a folder, and to another Collection of the same format; the other format is not offered", async () => {
  const k = key(ROOT(), "products/Catalog.yml");
  select(k);
  press_key(dialog, "m");
  const p = dialog.pickers.open;
  assert.match(p.title, /Move "Catalog" to/);
  assert.ok(p.options.find((o) => o.value === `${key(ROOT())}#products`).disabled, "its own folder is greyed out");
  assert.ok(p.options.some((o) => o.label === "Shop Two" && o.header));
  assert.equal(p.options.some((o) => o.value.startsWith(key(BRU()))), false, "no Collection of the other format");
  pick(`${key(ROOT())}#orders`);
  await settle("the move");
  assert.ok(existsSync(join(ROOT(), "orders/Catalog.yml")));
  await waitFor(() => dialog.request.req?.key === key(ROOT(), "orders/Catalog.yml"), "the Request column follows the move");
  press_key(dialog, "m");
  pick(`${key(TWO())}#`);
  await settle("the move to Shop Two");
  assert.ok(existsSync(join(TWO(), "Catalog.yml")));
  assert.equal(existsSync(join(ROOT(), "orders/Catalog.yml")), false);
  assert.equal(dialog.sel, key(TWO(), "Catalog.yml"));
});

test("alt-up and alt-down reorder a Request among its folder's Requests", async () => {
  const k = key(ROOT(), "products/Missing Product.yml");
  select(k);
  const place = () => dialog.buildRows().filter((r) => r.kind === "request" && r.parent === key(ROOT(), "products")).findIndex((r) => r.key === k);
  const before = place();
  press_key(dialog, "alt-down");
  await settle("the reorder");
  assert.equal(place(), before + 1);
  assert.equal(dialog.sel, k, "it stays selected");
  press_key(dialog, "alt-up");
  await settle("the reorder back");
  assert.equal(place(), before);
});

test("drag and drop: into a folder, the self-drop and the other format refused, esc cancels", async () => {
  const k = key(ROOT(), "products/Product Page.yml");
  const dragged = select(k);
  const folder = row(key(ROOT(), "orders"));
  // A move over itself shows nothing.
  actions.press(dialog, dragged);
  actions.hover(dialog, dragged, { local_position: { y: 5 }, bounds: { height: 10 } }, cx);
  assert.equal(actions.dragMark(dialog, dragged), null, "no highlight on itself");
  actions.release(dialog, dragged, cx);
  assert.ok(existsSync(join(ROOT(), "products/Product Page.yml")), "nothing moved");
  // Onto another format: no highlight, a refusal said on release.
  actions.press(dialog, dragged);
  const bru = row(key(BRU()));
  actions.hover(dialog, bru, { local_position: { y: 5 }, bounds: { height: 10 } }, cx);
  assert.equal(actions.dragMark(dialog, bru), null);
  actions.release(dialog, bru, cx);
  assert.match(dialog.note?.text ?? "", /Not moved: another format/);
  // Esc during a drag cancels it.
  actions.press(dialog, dragged);
  actions.hover(dialog, folder, { local_position: { y: 5 }, bounds: { height: 10 } }, cx);
  assert.equal(actions.dragMark(dialog, folder), "inside");
  assert.equal(actions.dragMark(dialog, dragged), "dragged");
  dialog.command("cancel", cx);
  assert.equal(dialog.drag, null);
  actions.release(dialog, folder, cx);
  assert.ok(existsSync(join(ROOT(), "products/Product Page.yml")), "the release after esc did nothing");
  // A drop on a folder's middle third moves it in.
  actions.press(dialog, dragged);
  actions.hover(dialog, folder, { local_position: { y: 5 }, bounds: { height: 10 } }, cx);
  actions.release(dialog, folder, cx);
  await settle("the drop");
  assert.ok(existsSync(join(ROOT(), "orders/Product Page.yml")));
});

test("delete asks, then offers a permanent delete when there is no trash; the shown Request empties", async () => {
  const k = key(ROOT(), "orders/Product Page.yml");
  select(k);
  await waitFor(() => dialog.request.req?.key === k, "the Request");
  press_key(dialog, "delete");
  assert.equal(dialog.pickers.open.title, 'Delete "Product Page"?');
  assert.equal(dialog.pickers.open.detail, "It goes to the trash.");
  pick("Move to trash");
  await waitFor(() => dialog.pickers.open?.title === '"Product Page" cannot go to the trash', "the second question");
  assert.ok(existsSync(join(ROOT(), "orders/Product Page.yml")), "nothing is gone before the second answer");
  pick("Delete permanently");
  await settle("the delete");
  await waitFor(() => !existsSync(join(ROOT(), "orders/Product Page.yml")), "the file to go");
  await waitFor(() => dialog.request.req == null, "the Request column empties");
  assert.equal(dialog.sel, key(ROOT(), "orders"));
});

test("a file that does not parse is marked, shows on the File tab and does not run", async () => {
  const k = key(ROOT(), "Broken.yml");
  const r = select(k);
  assert.equal(r.broken, true);
  await waitFor(() => dialog.request.req?.key === k, "the broken file");
  assert.equal(dialog.request.form.tab, "file");
  dialog.runKey(cx, k, false);
  assert.match(dialog.note?.text ?? "", /does not read as a Request/);
});
