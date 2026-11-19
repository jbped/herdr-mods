// The secret-handling acceptance test (ADR "Brunr edits .env in place and never copies a secret").
// Each editor is opened through the herdr and gpui shims on a scratch copy of a fixture Collection
// whose files hold recognisable marker values. Values are edited, added, moved to .env and saved.
// Then no marker may be in shared state, localStorage, an exec argument, a toast, an overlay's
// props, a command or a log line, and every marker written must be in its file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as herdr from "./herdr-shim.mjs";
import { elements, type, click } from "./gpui-shim.mjs";
import { FIXTURES } from "./helpers.mjs";

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

let dir;
const logs = [];
const errors = [];
const storage = new Map();
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
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  console.log = (...a) => { logs.push(a.map(String).join(" ")); };
});

after(() => {
  console.log = realLog;
  delete globalThis.localStorage;
  rmSync(dir, { recursive: true, force: true });
});

const cx = {
  spawn(fn) { Promise.resolve().then(() => fn(cx)).catch((e) => errors.push(e)); },
  notify() {}, stop_propagation() {},
  focus_handle: () => ({ focus() {}, is_focused: () => false, release: () => true }),
  timer: { every() {}, after() {} },
};

async function waitFor(pred, what) {
  for (let i = 0; i < 400; i++) {
    if (errors.length) throw errors[0];
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function openEditor(propsValue) {
  herdr.state.props = { ...propsValue, overlay: "overlay-test" };
  const { default: Brunr } = await import("../mods/brunr/main.js");
  const self = new Brunr();
  self.init(undefined, cx);
  return self;
}

const draw = (self) => { elements.clear(); self.render(cx); };
const rowId = (self, name) => self.ed.table.rows.find((r) => r.name === name)?.id;

test("Environment editor (YAML): masked, edited, added, saved, moved to .env; no value outside the editor", async () => {
  const root = join(dir, "Shop");
  const self = await openEditor({ envEditor: { machine: null, root, path: "environments/local.yml" } });
  await waitFor(() => self.ed?.table && !self.ed.loading, "the table");
  draw(self);
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
  draw(self);
  click(`brunr-env-row-on-${rowId(self, "shopId")}`, cx);
  draw(self);
  click("brunr-env-save", cx);
  await waitFor(() => self.ed.status?.ok, "the save");
  let text = readFileSync(join(root, "environments/local.yml"), "utf8");
  assert.match(text, new RegExp(`value: ${MARK.envNew}`));
  assert.match(text, new RegExp(`- name: added\\n    value: ${MARK.added}`));
  assert.match(text, /- name: shopId\n {4}value: "1"\n {4}disabled: true/);
  assert.match(text, /- secret: true\n {4}name: apiKey/);

  // Move the secret apiKey to .env.
  draw(self);
  click(`brunr-env-move-${rowId(self, "apiKey")}`, cx);
  const ask = self.ed.ask;
  assert.equal(ask.fields[0].input.value(), "API_KEY");
  assert.equal(ask.fields[1].input.masked, true);
  type(ask.fields[1].input, MARK.moved, cx);
  draw(self);
  click("brunr-ask-1", cx);
  await waitFor(() => !self.ed.ask && self.ed.status?.ok, "the move");
  assert.equal(ask.fields[1].input.released, true);
  text = readFileSync(join(root, "environments/local.yml"), "utf8");
  assert.match(text, /- name: apiKey\n {4}value: "\{\{process\.env\.API_KEY\}\}"/);
  const dot = readFileSync(join(root, ".env"), "utf8");
  assert.equal(dot, `# invented values for the test\nSHOP_TOKEN=${MARK.dot}\n\nOTHER="kept as is" # note\nAPI_KEY=${MARK.moved}\n`);

  // Clone and rename: what reaches the panel names an Environment, nothing more.
  draw(self);
  click("brunr-env-clone", cx);
  draw(self);
  click("brunr-ask-1", cx);
  await waitFor(() => !self.ed.ask && self.ed.sel === "environments/local copy.yml", "the clone");
  assert.match(readFileSync(join(root, "environments/local copy.yml"), "utf8"), new RegExp(MARK.envNew));
  draw(self);
  click("brunr-env-rename", cx);
  type(self.ed.ask.fields[0].input, "copied", cx);
  draw(self);
  click("brunr-ask-1", cx);
  await waitFor(() => !self.ed.ask && self.ed.sel === "environments/copied.yml", "the rename");
  assert.deepEqual(Object.fromEntries(Object.entries(herdr.state.shared["brunr.request"]).filter(([k]) => k !== "n")), { kind: "envGone", key: `|${root}`, name: "local copy", newName: "copied" });

  // Unsaved edits: closing asks first, then discards.
  type(self.ed.inputs.get(self.ed.table.blank).name, "unsaved", cx);
  type(self.ed.inputs.get(rowId(self, "unsaved")).value, "leak-marker-unsaved-0001", cx);
  draw(self);
  click("brunr-editor-close", cx);
  assert.equal(self.ed.ask.title, "Discard unsaved changes?");
  assert.equal(herdr.closed.includes("overlay-test"), false);
  draw(self);
  click("brunr-ask-1", cx);
  assert.equal(herdr.closed.includes("overlay-test"), true);
  await self.close();
  assert.equal(self.ed, null);
});

test("Environment editor (bru): a value edited and saved in place", async () => {
  const root = join(dir, "Shop bru");
  const self = await openEditor({ envEditor: { machine: null, root, path: "environments/local.bru" } });
  await waitFor(() => self.ed?.table && !self.ed.loading, "the table");
  type(self.ed.inputs.get(rowId(self, "token")).value, MARK.bruNew, cx);
  draw(self);
  click("brunr-env-save", cx);
  await waitFor(() => self.ed.status?.ok, "the save");
  assert.equal(readFileSync(join(root, "environments/local.bru"), "utf8"),
    `vars {\n  baseUrl: http://127.0.0.1:47911\n  shopId: 1\n  token: ${MARK.bruNew}\n}\nvars:secret [\n  apiKey\n]\n`);
  await self.close();
});

test(".env editor: table edit keeps comments, Raw saves the text as typed; no value outside the editor", async () => {
  const root = join(dir, "Shop");
  const self = await openEditor({ dotenvEditor: { machine: null, root, path: ".env" } });
  await waitFor(() => self.ed?.table && !self.ed.loading, "the table");
  assert.deepEqual(self.ed.files, [".env"]);
  for (const inp of self.ed.inputs.values()) assert.equal(inp.value.masked, true);
  type(self.ed.inputs.get(rowId(self, "SHOP_TOKEN")).value, MARK.dotNew, cx);
  draw(self);
  click("brunr-dot-save", cx);
  await waitFor(() => self.ed.status?.ok, "the table save");
  assert.equal(readFileSync(join(root, ".env"), "utf8"), `# invented values for the test\nSHOP_TOKEN=${MARK.dotNew}\n\nOTHER="kept as is" # note\nAPI_KEY=${MARK.moved}\n`);

  draw(self);
  click("brunr-dot-raw", cx);
  assert.equal(self.ed.view, "raw");
  assert.equal(self.ed.inputs.size, 0, "the table's inputs are gone in Raw");
  type(self.ed.raw, `${self.ed.raw.value()}RAW_ONE=${MARK.raw}\n`, cx);
  draw(self);
  click("brunr-dot-save", cx);
  await waitFor(() => self.ed.status?.ok && self.ed.disk.includes(MARK.raw), "the raw save");
  assert.match(readFileSync(join(root, ".env"), "utf8"), new RegExp(`\\nRAW_ONE=${MARK.raw}\\n$`));
  draw(self);
  click("brunr-dot-table", cx);
  assert.equal(self.ed.view, "table");
  assert.ok(rowId(self, "RAW_ONE"));
  await self.close();
});

test("after the editors: no marker in shared state, localStorage, exec arguments, toasts, overlay props, commands or logs", () => {
  const places = {
    shared: JSON.stringify(herdr.state.shared),
    localStorage: JSON.stringify([...storage]),
    exec: JSON.stringify(herdr.calls),
    toasts: JSON.stringify(herdr.notices),
    overlays: JSON.stringify(herdr.overlays),
    commands: JSON.stringify(herdr.ran),
    logs: JSON.stringify(logs),
  };
  for (const m of [...Object.values(MARK), "leak-marker-unsaved-0001"]) {
    for (const [where, text] of Object.entries(places)) assert.equal(text.includes(m), false, `${m} found in ${where}`);
  }
  const files = [".env", "environments/local.yml", "environments/copied.yml"].map((f) => readFileSync(join(dir, "Shop", f), "utf8")).join("\n")
    + readFileSync(join(dir, "Shop bru/environments/local.bru"), "utf8");
  for (const m of [MARK.envNew, MARK.added, MARK.moved, MARK.dotNew, MARK.raw, MARK.bruNew]) assert.ok(files.includes(m), `${m} written`);
  assert.equal(files.includes("leak-marker-unsaved-0001"), false, "discarded edits are not written");
});
