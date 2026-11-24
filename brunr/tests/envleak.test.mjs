// The secret-handling acceptance test (ADR "Brunr edits .env in place and never copies a secret").
// The dialog (main.js) is opened through the herdr and gpui shims with a brunr.json that lists
// scratch copies of the fixture Collections, whose files hold recognisable marker values. Each
// editor is opened as a person opens it: from the Environment picker's "Edit…" and from the
// Collection row's menu. Values are edited, added, moved to .env and saved. Then no marker may be
// in shared state, localStorage, an exec argument, a toast, an overlay, a command, a log line, a
// picker or the dialog's note, and every marker written must be in its file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as herdr from "./herdr-shim.mjs";
import { type, click, elements } from "./gpui-shim.mjs";
import { FIXTURES } from "./helpers.mjs";
import { openDialog, draw, cx, waitFor, errors } from "./dialoghelp.mjs";

const MARK = {
  env: "leak-marker-env-4410",
  envNew: "leak-marker-env-edited-1182",
  added: "leak-marker-added-3307",
  moved: "leak-marker-moved-5521",
  dot: "leak-marker-dotenv-7731",
  dotNew: "leak-marker-dotenv-edited-6649",
  raw: "leak-marker-raw-8812",
  bru: "leak-marker-bru-2290",
  bruNew: "leak-marker-bru-edited-9174",
};

let dir, dialog;
const logs = [];
const storage = new Map();
/** Every picker the dialog showed, as drawn: titles, details and options. */
const pickers = [];
const realLog = console.log;

/** A copy of a fixture Collection without its .env, which the test writes itself. */
function copyCollection(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name.startsWith(".env")) continue;
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) copyCollection(a, b); else copyFileSync(a, b);
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "brunr-envleak-"));
  copyCollection(join(FIXTURES, "yaml"), join(dir, "Shop"));
  copyCollection(join(FIXTURES, "bru"), join(dir, "Shop bru"));
  const yml = join(dir, "Shop/environments/local.yml");
  writeFileSync(yml, readFileSync(yml, "utf8").replace("  - secret: true", `  - name: token\n    value: ${MARK.env}\n  - secret: true`));
  const bru = join(dir, "Shop bru/environments/local.bru");
  writeFileSync(bru, readFileSync(bru, "utf8").replace("  shopId: 1\n", `  shopId: 1\n  token: ${MARK.bru}\n`));
  writeFileSync(join(dir, "Shop/.env"), `# invented values for the test\nSHOP_TOKEN=${MARK.dot}\n\nOTHER="kept as is" # note\n`);
  herdr.state.platform = "linux";
  herdr.state.appHome = dir;
  writeFileSync(join(dir, "brunr.json"), JSON.stringify({ workspace: join(dir, "none/workspace.yml"), collections: [{ path: join(dir, "Shop") }, { path: join(dir, "Shop bru") }] }));
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  console.log = (...a) => { logs.push(a.map(String).join(" ")); };
});

after(() => {
  console.log = realLog;
  delete globalThis.localStorage;
  rmSync(dir, { recursive: true, force: true });
});

/** The dialog, opened once for every test, with each picker it shows recorded. */
async function theDialog() {
  if (dialog) return dialog;
  dialog = await openDialog();
  const show = dialog.pickers.show.bind(dialog.pickers);
  dialog.pickers.show = (p, c) => { pickers.push({ title: p.title, detail: p.detail, options: p.options.map((o) => ({ label: o.label, value: o.value, warn: o.warn, hint: o.hint, side: o.side?.label })) }); show(p, c); };
  await waitFor(() => dialog.buildRows().filter((r) => r.kind === "collection" && !r.loading && dialog.collection(r.ck)).length === 2, "the Collections");
  return dialog;
}

const collectionRow = (d, root) => d.buildRows().find((r) => r.kind === "collection" && r.ck === `|${root}`);

/** Opens the Environment editor from the Environment picker's "Edit…" beside `envName`, as a click does. */
async function editFromPicker(root, envName) {
  const d = await theDialog();
  d.openEnvPicker(collectionRow(d, root));
  draw(d);
  const i = d.pickers.open.options.findIndex((o) => o.label === envName);
  assert.ok(i >= 0, `${envName} is in the picker`);
  click(`brunr-pick-side-${i}`, cx);
  assert.equal(d.pickers.open, null, "the picker closed");
  return d.editors.self;
}

/** Opens an editor from the Collection row's menu: "environments" or "edit-dotenv". */
async function editFromMenu(root, value) {
  const d = await theDialog();
  d.openMenu(collectionRow(d, root));
  const i = d.pickers.open.options.findIndex((o) => o.value === value);
  assert.ok(i >= 0, `${value} is in the menu`);
  d.pickers.pick(i, cx);
  return d.editors.self;
}

const rowId = (self, name) => self.ed.table.rows.find((r) => r.name === name)?.id;

test("Environment editor (YAML): masked, edited, added, saved, moved to .env; no value outside the editor", async () => {
  const root = join(dir, "Shop");
  const self = await editFromPicker(root, "local");
  await waitFor(() => self.ed?.table && !self.ed.loading, "the table");
  assert.equal(self.ed.sel, "environments/local.yml", "the editor opened on the Environment it was opened for");
  draw(dialog);
  assert.deepEqual(self.ed.list.map((e) => e.name), ["local", "staging"]);
  for (const id of self.ed.inputs.keys()) assert.equal(self.ed.inputs.get(id).value.masked, true, `row ${id} masked`);
  assert.ok(elements.has(`brunr-env-row-reveal-${rowId(self, "token")}`));

  // Reveal one row, then change its value, and add a row through the blank last row.
  click(`brunr-env-row-reveal-${rowId(self, "token")}`, cx);
  assert.equal(self.ed.inputs.get(rowId(self, "token")).value.masked, false);
  type(self.ed.inputs.get(rowId(self, "token")).value, MARK.envNew, cx);
  const blank = self.ed.table.blank;
  type(self.ed.inputs.get(blank).name, "added", cx);
  type(self.ed.inputs.get(blank).value, MARK.added, cx);
  assert.equal(self.ed.inputs.get(self.ed.table.blank).value.masked, true, "the new blank row is masked");
  // Disable shopId and remove nothing else.
  draw(dialog);
  click(`brunr-env-row-on-${rowId(self, "shopId")}`, cx);
  draw(dialog);
  click("brunr-env-save", cx);
  await waitFor(() => self.ed.status?.ok, "the save");
  let text = readFileSync(join(root, "environments/local.yml"), "utf8");
  assert.match(text, new RegExp(`value: ${MARK.envNew}`));
  assert.match(text, new RegExp(`- name: added\\n    value: ${MARK.added}`));
  assert.match(text, /- name: shopId\n {4}value: "1"\n {4}disabled: true/);
  assert.match(text, /- secret: true\n {4}name: apiKey/);

  // Move the secret apiKey to .env.
  draw(dialog);
  click(`brunr-env-move-${rowId(self, "apiKey")}`, cx);
  const ask = self.ed.ask;
  assert.equal(ask.fields[0].input.value(), "API_KEY");
  assert.equal(ask.fields[1].input.masked, true);
  type(ask.fields[1].input, MARK.moved, cx);
  draw(dialog);
  click("brunr-ask-1", cx);
  await waitFor(() => !self.ed.ask && self.ed.status?.ok, "the move");
  assert.equal(ask.fields[1].input.released, true);
  text = readFileSync(join(root, "environments/local.yml"), "utf8");
  assert.match(text, /- name: apiKey\n {4}value: "\{\{process\.env\.API_KEY\}\}"/);
  const dot = readFileSync(join(root, ".env"), "utf8");
  assert.equal(dot, `# invented values for the test\nSHOP_TOKEN=${MARK.dot}\n\nOTHER="kept as is" # note\nAPI_KEY=${MARK.moved}\n`);

  // Clone and rename. The remembered choice follows the rename, by name only.
  draw(dialog);
  click("brunr-env-clone", cx);
  draw(dialog);
  click("brunr-ask-1", cx);
  await waitFor(() => !self.ed.ask && self.ed.sel === "environments/local copy.yml", "the clone");
  assert.match(readFileSync(join(root, "environments/local copy.yml"), "utf8"), new RegExp(MARK.envNew));
  dialog.saved.setEnv(`|${root}`, "local copy");
  draw(dialog);
  click("brunr-env-rename", cx);
  type(self.ed.ask.fields[0].input, "copied", cx);
  draw(dialog);
  click("brunr-ask-1", cx);
  await waitFor(() => !self.ed.ask && self.ed.sel === "environments/copied.yml", "the rename");
  assert.equal(dialog.saved.env(`|${root}`), "copied", "the remembered Environment followed the rename");

  // Unsaved edits: closing asks first, then discards.
  type(self.ed.inputs.get(self.ed.table.blank).name, "unsaved", cx);
  type(self.ed.inputs.get(rowId(self, "unsaved")).value, "leak-marker-unsaved-0001", cx);
  draw(dialog);
  click("brunr-editor-close", cx);
  assert.equal(self.ed.ask.title, "Discard unsaved changes?");
  assert.equal(dialog.editors.open, true);
  draw(dialog);
  click("brunr-ask-1", cx);
  assert.equal(dialog.editors.open, false, "Discard closed the editor");
  assert.equal(self.ed, null, "every value went with it");
});

test("Environment editor (bru): a value edited and saved in place", async () => {
  const root = join(dir, "Shop bru");
  const self = await editFromMenu(root, "environments");
  await waitFor(() => self.ed?.table && !self.ed.loading, "the table");
  type(self.ed.inputs.get(rowId(self, "token")).value, MARK.bruNew, cx);
  draw(dialog);
  click("brunr-env-save", cx);
  await waitFor(() => self.ed.status?.ok, "the save");
  assert.equal(readFileSync(join(root, "environments/local.bru"), "utf8"),
    `vars {\n  baseUrl: http://127.0.0.1:47911\n  shopId: 1\n  token: ${MARK.bruNew}\n}\nvars:secret [\n  apiKey\n]\n`);
  dialog.editors.close();
});

test(".env editor: table edit keeps comments, Raw saves the text as typed; no value outside the editor", async () => {
  const root = join(dir, "Shop");
  const self = await editFromMenu(root, "edit-dotenv");
  await waitFor(() => self.ed?.table && !self.ed.loading, "the table");
  assert.deepEqual(self.ed.files, [".env"]);
  for (const inp of self.ed.inputs.values()) assert.equal(inp.value.masked, true);
  type(self.ed.inputs.get(rowId(self, "SHOP_TOKEN")).value, MARK.dotNew, cx);
  draw(dialog);
  click("brunr-dot-save", cx);
  await waitFor(() => self.ed.status?.ok, "the table save");
  assert.equal(readFileSync(join(root, ".env"), "utf8"), `# invented values for the test\nSHOP_TOKEN=${MARK.dotNew}\n\nOTHER="kept as is" # note\nAPI_KEY=${MARK.moved}\n`);

  draw(dialog);
  click("brunr-dot-raw", cx);
  assert.equal(self.ed.view, "raw");
  assert.equal(self.ed.inputs.size, 0, "the table's inputs are gone in Raw");
  type(self.ed.raw, `${self.ed.raw.value()}RAW_ONE=${MARK.raw}\n`, cx);
  draw(dialog);
  click("brunr-dot-save", cx);
  await waitFor(() => self.ed.status?.ok && self.ed.disk.includes(MARK.raw), "the raw save");
  assert.match(readFileSync(join(root, ".env"), "utf8"), new RegExp(`\\nRAW_ONE=${MARK.raw}\\n$`));
  draw(dialog);
  click("brunr-dot-table", cx);
  assert.equal(self.ed.view, "table");
  assert.ok(rowId(self, "RAW_ONE"));
  dialog.editors.close();
});

test("after the editors: no marker in shared state, localStorage, exec arguments, toasts, overlays, commands, logs, pickers or the note", () => {
  const places = {
    shared: JSON.stringify(herdr.state.shared),
    localStorage: JSON.stringify([...storage]),
    exec: JSON.stringify(herdr.calls),
    toasts: JSON.stringify(herdr.notices),
    overlays: JSON.stringify(herdr.overlays),
    commands: JSON.stringify(herdr.ran),
    logs: JSON.stringify(logs),
    pickers: JSON.stringify(pickers),
    note: JSON.stringify(dialog.note),
    saved: JSON.stringify(dialog.saved),
  };
  assert.equal(pickers.length, 3, "the editors were opened through the dialog's pickers: the Environment picker and two row menus");
  assert.equal(herdr.overlays.length, 0, "no editor or question opened an overlay");
  assert.deepEqual(errors, []);
  for (const m of [...Object.values(MARK), "leak-marker-unsaved-0001"]) {
    for (const [where, text] of Object.entries(places)) assert.equal(text.includes(m), false, `${m} found in ${where}`);
  }
  const files = [".env", "environments/local.yml", "environments/copied.yml"].map((f) => readFileSync(join(dir, "Shop", f), "utf8")).join("\n")
    + readFileSync(join(dir, "Shop bru/environments/local.bru"), "utf8");
  for (const m of [MARK.envNew, MARK.added, MARK.moved, MARK.dotNew, MARK.raw, MARK.bruNew]) assert.ok(files.includes(m), `${m} written`);
  assert.equal(files.includes("leak-marker-unsaved-0001"), false, "discarded edits are not written");
});
