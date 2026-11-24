// The Environment editor, drawn inside the dialog (editors.js) for one Collection: `{ machine, root,
// path }`. It lists the Collection's Environments, edits the selected one in a table and creates,
// clones, renames and deletes them. Values are read from the file when it is selected and kept only
// in the editor's state (`self.ed`); a save writes the same file, change-checked against the text
// read. No Draft: closing with unsaved edits asks, then discards. A rename or delete tells the
// dialog the Environment's names through `self.envGone(name, newName, cx)`, never a value. The drawing
// is in envview.js; rules in envtable.js, envfile.js and fileops.js.
import { InputState } from "gpui-base";
import * as machine from "./machine.js";
import * as ops from "./fileops.js";
import * as tbl from "./envtable.js";
import * as parts from "./editparts.js";
import { runEffects, readTexts, deletePermanently } from "./effects.js";
import { readEnvironment, writeEnvironment, moveSecretToDotenv } from "./envfile.js";
import { readDotenv, applyDotenv } from "./dotenv.js";
import { collectionFormat } from "./parser.js";
import { EXT } from "./collpaths.js";

const slash = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const fileOf = (path) => String(path ?? "").split("/").pop();
const lineOf = (message) => Number(/line (\d+)/.exec(String(message))?.[1] ?? 0) || null;

/** Opens the editor on Environment file `p.path` (relative), or the first. @param {{ machine: string | null, root: string, path: string | null }} p */
export function init(self, cx, p) {
  const ed = self.ed = {
    kind: "env", machine: p.machine ?? null, root: slash(p.root), format: null, list: [], sel: null,
    disk: null, envName: null, table: null, inputs: new Map(), error: null, conflict: null, ask: null,
    busy: false, status: null, loading: true,
  };
  ed.dirty = () => Boolean(ed.table && tbl.isDirty(ed.table));
  ed.fileLabel = () => fileOf(ed.sel) || "this Environment";
  ed.save = (cx) => save(self, cx);
  self.handle.focus();
  if (ed.machine != null) { ed.error = "Editing works on this computer only."; ed.loading = false; return; }
  cx.spawn(async (cx) => {
    await loadList(self);
    const first = ed.list.find((e) => e.path === p.path) ?? ed.list[0];
    if (first) await loadFile(self, first.path);
    ed.loading = false;
    cx.notify();
  });
}

/** The editor goes (Close, Esc after the question, the dialog closing): every value is dropped. */
export function close(self) {
  if (!self.ed) return;
  parts.closeAsk(self);
  parts.releaseInputs(self);
  self.ed = null;
}

const abs = (self, rel) => `${self.ed.root}/${rel}`;
/** What fileops needs of the Collection for the Environment operations. */
const collection = (self) => ({ root: self.ed.root, format: self.ed.format, environments: self.ed.list });

/** The Environment files, by name only. Nothing is read. */
async function loadList(self) {
  const ed = self.ed;
  const format = collectionFormat(await machine.fileNames(ed.root));
  if (!format) { ed.error = "This folder is not a Bruno Collection."; ed.list = []; return; }
  ed.format = format;
  const ext = EXT[format];
  const names = (await machine.fileNames(`${ed.root}/environments`)).filter((n) => n.endsWith(ext) && n.length > ext.length);
  if (!self.ed) return;
  ed.list = names.map((n) => ({ name: n.slice(0, -ext.length), path: `environments/${n}` }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.name < b.name ? -1 : 1));
}

/** Reads one Environment file: its rows become the table, every value masked. */
async function loadFile(self, path) {
  const ed = self.ed;
  ed.sel = path;
  ed.conflict = null;
  ed.status = null;
  ed.error = null;
  const text = await machine.readText(null, abs(self, path));
  if (!self.ed || ed.sel !== path) return;
  ed.disk = text;
  if (text == null) { ed.error = `Cannot read ${path}.`; parts.resetTable(self, null); return; }
  try {
    const env = readEnvironment(text, ed.format);
    ed.envName = env.name ?? fileOf(path).replace(/\.[^.]+$/, "");
    parts.resetTable(self, tbl.makeTable(env.rows));
  } catch (e) {
    const line = lineOf(e?.message);
    ed.error = `${path} does not read as an Environment${line ? ` (line ${line})` : ""}.`;
    parts.resetTable(self, null);
  }
}

/** A click on an Environment in the list. */
export function select(self, cx, path) {
  const ed = self.ed;
  if (ed.busy || path === ed.sel) return;
  parts.guard(self, (cx) => cx.spawn(async (cx) => { await loadFile(self, path); cx.notify(); }), cx);
}

/** Save and ctrl-s: the file is written from the table, change-checked against the text read. */
export function save(self, cx, expected = null) {
  const ed = self.ed;
  if (!ed?.table || ed.busy || ed.ask || (!tbl.isDirty(ed.table) && expected == null)) return;
  if (!tbl.canSave(ed.table)) { ed.status = { error: "Fix the names marked in red first." }; return; }
  const text = writeEnvironment({ format: ed.format, name: ed.envName, rows: tbl.envRows(ed.table), previousText: ed.disk });
  const path = ed.sel, table = ed.table;
  ed.busy = true;
  cx.spawn(async (cx) => {
    const r = await runEffects([{ op: "write", path: abs(self, path), text, expected: expected ?? ed.disk }], { machine: null, root: ed.root });
    if (!self.ed) return;
    ed.busy = false;
    if (r.ok) {
      ed.disk = text;
      ed.conflict = null;
      ed.table = ed.table === table ? tbl.markSaved(table) : { ...ed.table, base: table.rows };
      ed.status = { ok: `Saved ${fileOf(path)}.` };
    } else if (r.failed.kind === "conflict") ed.conflict = { current: r.failed.current };
    else ed.status = { error: `${fileOf(path)} was not saved. ${r.failed.message}` };
    cx.notify();
  });
}

/** After a conflict: read the file again (the edits go), or write over it. */
export function reload(self, cx) {
  const path = self.ed.sel;
  cx.spawn(async (cx) => { await loadFile(self, path); cx.notify(); });
}
export const overwrite = (self, cx) => save(self, cx, self.ed.conflict?.current ?? null);

/** Discard: back to the file on disk. */
export function discard(self, cx) {
  if (self.ed.dirty()) reload(self, cx);
}

// ---- New, Clone, Rename, Delete ---------------------------------------------------------------------

function nameAsk(self, { title, confirm, value, run }) {
  const input = InputState.new({ placeholder: "Environment name", value });
  const ask = {
    title,
    fields: [{ label: "Name", input, check: () => (input.value().trim() ? null : "Name cannot be empty.") }],
    choices: [{ label: "Cancel" }, { label: confirm, primary: true, run: (cx) => run(cx, input.value().trim(), ask) }],
  };
  parts.openAsk(self, ask);
}

export function startNew(self) {
  if (self.ed.busy || !self.ed.format) return;
  parts.guard(self, () => nameAsk(self, { title: "New Environment", confirm: "Create", value: "", run: (cx, name, ask) => perform(self, cx, ask, "newEnvironment", { name }) }));
}

export function startClone(self, env) {
  if (self.ed.busy) return;
  parts.guard(self, () => nameAsk(self, { title: `Clone "${env.name}"`, confirm: "Clone", value: `${env.name} copy`, run: (cx, name, ask) => perform(self, cx, ask, "cloneEnvironment", { from: env.name, name }) }));
}

export function startRename(self, env) {
  if (self.ed.busy) return;
  parts.guard(self, () => nameAsk(self, {
    title: `Rename "${env.name}"`, confirm: "Rename", value: env.name,
    run: (cx, name, ask) => perform(self, cx, ask, "renameEnvironment", { name: env.name, newName: name }, (res, cx) => self.envGone(env.name, res.name, cx)),
  }));
}

export function startDelete(self, env) {
  if (self.ed.busy) return;
  const gone = (/** @type {any} */ _res, /** @type {any} */ cx) => self.envGone(env.name, null, cx);
  parts.guard(self, () => {
    const ask = {
      title: `Delete Environment "${env.name}"?`,
      detail: `${fileOf(env.path)} goes to the trash.`,
      choices: [{ label: "Cancel" }, { label: "Move to trash", primary: true, run: (cx) => perform(self, cx, ask, "deleteEnvironment", { name: env.name }, gone) }],
    };
    parts.openAsk(self, ask);
  });
}

/**
 * Plans one Environment operation with fileops.js, performs its effects, lists the Environments
 * again and selects the result. An error stays in the question. A failed trash asks again for a
 * permanent delete.
 */
function perform(self, cx, ask, op, args, after = null) {
  const ed = self.ed;
  if (ed.busy) return;
  ed.busy = true;
  cx.spawn(async (cx) => {
    const c = collection(self);
    const texts = await readTexts(ed.root, ops.needs({ op, ...args }, c));
    const out = ops[op]({ collection: c, texts, ...args });
    if (!self.ed) return;
    if (out.error) { ed.busy = false; ask.error = out.error; cx.notify(); return; }
    const r = await runEffects(out.effects, { machine: null, root: ed.root });
    if (!self.ed) return;
    ed.busy = false;
    if (!r.ok && r.failed.kind === "trash") { offerPermanent(self, cx, r.failed, after); cx.notify(); return; }
    if (!r.ok) { ask.error = r.failed.message; cx.notify(); return; }
    after?.(out.result, cx);
    parts.closeAsk(self);
    await afterChange(self, out.result?.path ?? null);
    cx.notify();
  });
}

function offerPermanent(self, cx, failed, after) {
  const path = failed.effect.path;
  const ask = {
    title: `${fileOf(path)} cannot go to the trash`,
    detail: `${failed.message} Delete it permanently instead? This cannot be undone.`,
    choices: [{ label: "Cancel" }, {
      label: "Delete permanently", primary: true, run: (cx) => {
        self.ed.busy = true;
        cx.spawn(async (cx) => {
          const r = await deletePermanently(path, { machine: null, root: self.ed.root });
          if (!self.ed) return;
          self.ed.busy = false;
          if (!r.ok) { ask.error = r.message; cx.notify(); return; }
          after?.({ name: null, path: null }, cx);
          parts.closeAsk(self);
          await afterChange(self, null);
          cx.notify();
        });
      },
    }],
  };
  parts.openAsk(self, ask);
}

async function afterChange(self, path) {
  await loadList(self);
  if (!self.ed) return;
  const next = self.ed.list.find((e) => e.path === path) ?? self.ed.list.find((e) => e.path === self.ed.sel) ?? self.ed.list[0];
  if (next) await loadFile(self, next.path);
  else { self.ed.sel = null; self.ed.disk = null; parts.resetTable(self, null); }
}

// ---- Move to .env ---------------------------------------------------------------------------------

/**
 * "Move to .env" on a secret variable: asks for the .env name and the value (masked), then writes
 * `.env` (created when absent) and the Environment file, where the variable becomes
 * `{{process.env.NAME}}`. The Environment file is written from the table, so unsaved edits in the
 * table are saved with the move. The question says so.
 */
export function startMove(self, row) {
  const ed = self.ed;
  if (ed.busy || !row?.secret) return;
  const dirty = ed.dirty();
  if (dirty && !tbl.canSave(ed.table)) { ed.status = { error: "Fix the names marked in red first." }; return; }
  const nameInput = InputState.new({ placeholder: ".env name", value: tbl.dotenvNameFor(row.name) });
  const valueInput = InputState.new({ placeholder: "Value", value: "" });
  const ask = {
    title: `Move "${row.name}" to .env`,
    detail: `${fileOf(ed.sel)} will read it as {{process.env.NAME}}, and .env in the Collection folder will hold the value. A Run reads .env.${dirty ? ` Your unsaved changes to ${fileOf(ed.sel)} are saved with it.` : ""}`,
    fields: [
      { label: "Name in .env", input: nameInput, mono: true, check: () => tbl.dotenvNameError(nameInput.value()) },
      { label: "Value", input: valueInput, mono: true, mask: true },
    ],
    replace: null,
    choices: [{ label: "Cancel" }, { label: "Move", primary: true, run: (cx) => move(self, cx, ask, row.name, nameInput.value(), valueInput.value()) }],
  };
  nameInput.on("change", () => { ask.replace = null; ask.note = null; ask.choices[1].label = "Move"; });
  parts.openAsk(self, ask);
}

function move(self, cx, ask, varName, envName, value) {
  const ed = self.ed;
  if (ed.busy) return;
  ed.busy = true;
  cx.spawn(async (cx) => {
    const dotPath = abs(self, ".env");
    const dot = await machine.readText(null, dotPath);
    if (!self.ed) return;
    const exists = dot != null && readDotenv(dot).some((r) => r.name === envName);
    if (exists && ask.replace !== envName) {
      ed.busy = false;
      ask.replace = envName;
      ask.note = `${envName} is already in .env. Move replaces its value.`;
      ask.choices[1].label = "Replace";
      cx.notify();
      return;
    }
    let dotText, envText;
    try {
      dotText = applyDotenv(dot ?? "", [exists ? { op: "set", name: envName, value } : { op: "add", name: envName, value }]);
      const rows = moveSecretToDotenv(tbl.envRows(ed.table), varName, envName);
      envText = writeEnvironment({ format: ed.format, name: ed.envName, rows, previousText: ed.disk });
    } catch {
      ed.busy = false;
      ask.error = `${envName} is not a valid .env name.`;
      cx.notify();
      return;
    }
    const r = await runEffects([
      { op: "write", path: dotPath, text: dotText, expected: dot },
      { op: "write", path: abs(self, ed.sel), text: envText, expected: ed.disk },
    ], { machine: null, root: ed.root });
    if (!self.ed) return;
    ed.busy = false;
    if (!r.ok) {
      ask.error = r.failed.index === 0 ? `.env was not written. ${r.failed.message}` : `.env was written, ${fileOf(ed.sel)} was not. ${r.failed.message}`;
      cx.notify();
      return;
    }
    parts.closeAsk(self);
    await loadFile(self, ed.sel);
    if (self.ed) ed.status = { ok: `${varName} now reads ${envName} from .env.` };
    cx.notify();
  });
}

/** The link to the .env editor of the same Collection. Unsaved edits ask first. */
export function openDotenv(self, cx) {
  parts.guard(self, (cx) => self.openDotenv(cx), cx);
}

