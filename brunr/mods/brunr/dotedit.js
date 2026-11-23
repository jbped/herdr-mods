// The .env editor: a brunr copy opened as a window with props `{ dotenvEditor: { machine, root,
// path } }`, nothing else. It lists the .env files of the Collection root by name, and reads a file
// only when it is selected. Two views, as in Bruno: a table of names and masked values, and Raw,
// the text itself. A table save changes only the edited lines (dotenv.applyDotenv); a Raw save
// writes the text as typed. Both are change-checked against the text read. Values live only in this
// copy's state (`self.ed`). No Draft: closing with unsaved edits asks, then discards.
import { EditorState, InputState } from "gpui-base";
import { props, theme } from "herdr";
import * as machine from "./machine.js";
import * as tbl from "./envtable.js";
import * as parts from "./editparts.js";
import { runEffects, deletePermanently } from "./effects.js";
import { isDotenvFile, readDotenv, applyDotenv } from "./dotenv.js";

const slash = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

export function init(self, cx) {
  const p = props()?.dotenvEditor ?? {};
  self.overlayId = props()?.overlay;
  const ed = self.ed = {
    kind: "dotenv", machine: p.machine ?? null, root: slash(p.root), files: [], sel: null, disk: null, text: null,
    table: null, view: "table", raw: null, rawText: null, inputs: new Map(), error: null, conflict: null, ask: null,
    busy: false, status: null, kb: false, loading: true,
  };
  ed.dirty = () => Boolean(ed.sel && ed.disk != null && (ed.view === "raw" ? ed.rawText !== ed.disk : ed.text !== ed.disk || (ed.table && tbl.isDirty(ed.table))));
  ed.fileLabel = () => ed.sel ?? ".env";
  ed.save = (cx) => save(self, cx);
  self.handle.focus();
  parts.commandLoop(self, cx, (cx) => save(self, cx));
  if (ed.machine != null) { ed.error = "Editing works on this computer only."; ed.loading = false; return; }
  cx.spawn(async (cx) => {
    await loadList(self);
    const first = ed.files.includes(p.path) ? p.path : ed.files[0];
    if (first) await loadFile(self, first);
    ed.loading = false;
    cx.notify();
  });
}

export function close(self) {
  if (!self.ed) return;
  parts.closeAsk(self);
  parts.releaseInputs(self);
  releaseRaw(self);
  self.ed = null;
}

const abs = (self, name) => `${self.ed.root}/${name}`;

/** The .env files in the Collection root, by name: `.env` first. Nothing is read. */
async function loadList(self) {
  const names = (await machine.fileNames(self.ed.root)).filter(isDotenvFile);
  if (!self.ed) return;
  self.ed.files = names.sort((a, b) => (a === ".env" ? -1 : b === ".env" ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

function releaseRaw(self) {
  self.ed?.raw?.release();
  if (self.ed) { self.ed.raw = null; self.ed.rawText = null; }
}

/** Reads one file: the table view of its rows, every value masked. */
async function loadFile(self, name) {
  const ed = self.ed;
  ed.sel = name;
  ed.conflict = null;
  ed.status = null;
  ed.error = null;
  releaseRaw(self);
  ed.view = "table";
  const text = await machine.readText(null, abs(self, name));
  if (!self.ed || ed.sel !== name) return;
  ed.disk = ed.text = text;
  if (text == null) { ed.error = `Cannot read ${name}.`; parts.resetTable(self, null); return; }
  parts.resetTable(self, tbl.makeTable(readDotenv(text)));
}

export function select(self, cx, name) {
  if (self.ed.busy || name === self.ed.sel) return;
  parts.guard(self, () => cx.spawn(async (cx) => { await loadFile(self, name); cx.notify(); }));
}

/** The text the table would write, or null when a name is not valid. */
function tableText(ed) {
  if (!tbl.canSave(ed.table)) return null;
  try { return applyDotenv(ed.text, tbl.dotenvEdits(ed.table)); } catch { return null; }
}

/** "Raw (shows values)": the text with the table's edits, in an editor. */
export function showRaw(self) {
  const ed = self.ed;
  if (ed.view === "raw" || !ed.table) return;
  const text = tableText(ed);
  if (text == null) { ed.status = { error: "Fix the names marked in red first." }; return; }
  const t = theme();
  parts.releaseInputs(self);
  ed.table = null;
  ed.raw = EditorState.new({ language: "text", value: text, font_family: parts.mono(), font_size: 12, soft_wrap: true, syntax: { comment: t.dim, string: t.ansi2 } });
  ed.rawText = text;
  ed.raw.on("change", (_e, cx) => { if (self.ed?.raw) { self.ed.rawText = self.ed.raw.value(); self.ed.status = null; } cx.notify(); });
  ed.raw.on("focus", () => { if (self.ed) self.ed.kb = true; });
  ed.raw.on("blur", () => { if (self.ed) self.ed.kb = false; });
  ed.view = "raw";
  ed.status = null;
}

/** Back to the table: the rows of the text as typed in Raw, masked again. */
export function showTable(self) {
  const ed = self.ed;
  if (ed.view === "table") return;
  ed.text = ed.rawText;
  releaseRaw(self);
  ed.view = "table";
  parts.resetTable(self, tbl.makeTable(readDotenv(ed.text)));
}

/** Save and ctrl-s. */
export function save(self, cx, expected = null) {
  const ed = self.ed;
  if (!ed?.sel || ed.busy || ed.ask || (!ed.dirty() && expected == null)) return;
  const text = ed.view === "raw" ? ed.rawText : tableText(ed);
  if (text == null) { ed.status = { error: "Fix the names marked in red first." }; return; }
  const name = ed.sel, view = ed.view;
  ed.busy = true;
  cx.spawn(async (cx) => {
    const r = await runEffects([{ op: "write", path: abs(self, name), text, expected: expected ?? ed.disk }], { machine: null, root: ed.root });
    if (!self.ed) return;
    ed.busy = false;
    if (r.ok) {
      ed.disk = ed.text = text;
      ed.conflict = null;
      if (view === "table" && ed.view === "table") parts.resetTable(self, tbl.makeTable(readDotenv(text)));
      ed.status = { ok: `Saved ${name}.` };
    } else if (r.failed.kind === "conflict") ed.conflict = { current: r.failed.current };
    else ed.status = { error: `${name} was not saved. ${r.failed.message}` };
    cx.notify();
  });
}

export function reload(self, cx) {
  const name = self.ed.sel;
  cx.spawn(async (cx) => { await loadFile(self, name); cx.notify(); });
}
export const overwrite = (self, cx) => save(self, cx, self.ed.conflict?.current ?? null);
export function discard(self, cx) { if (self.ed.dirty()) reload(self, cx); }

// ---- New and Delete --------------------------------------------------------------------------------

export function startNew(self) {
  const ed = self.ed;
  if (ed.busy) return;
  parts.guard(self, () => {
    const input = InputState.new({ placeholder: ".env", value: tbl.newDotenvName(ed.files) });
    const ask = {
      title: "New .env file",
      detail: "A file in the Collection folder. Only .env feeds a Run.",
      fields: [{ label: "File name", input, mono: true, check: () => tbl.dotenvFileError(input.value(), ed.files) }],
      choices: [{ label: "Cancel" }, { label: "Create", primary: true, run: (cx) => create(self, cx, ask, input.value()) }],
    };
    parts.openAsk(self, ask);
  });
}

function create(self, cx, ask, name) {
  const ed = self.ed;
  ed.busy = true;
  cx.spawn(async (cx) => {
    const r = await runEffects([{ op: "write", path: abs(self, name), text: "", expected: null }], { machine: null, root: ed.root });
    if (!self.ed) return;
    ed.busy = false;
    if (!r.ok) { ask.error = r.failed.message; cx.notify(); return; }
    parts.closeAsk(self);
    await loadList(self);
    await loadFile(self, name);
    cx.notify();
  });
}

export function startDelete(self) {
  const ed = self.ed, name = ed.sel;
  if (ed.busy || !name) return;
  parts.guard(self, () => {
    const ask = {
      title: `Delete ${name}?`,
      detail: `${name} goes to the trash.`,
      choices: [{ label: "Cancel" }, { label: "Move to trash", primary: true, run: (cx) => remove(self, cx, ask, name) }],
    };
    parts.openAsk(self, ask);
  });
}

function remove(self, cx, ask, name) {
  const ed = self.ed;
  ed.busy = true;
  cx.spawn(async (cx) => {
    const r = await runEffects([{ op: "trash", path: abs(self, name) }], { machine: null, root: ed.root });
    if (!self.ed) return;
    ed.busy = false;
    if (!r.ok && r.failed.kind === "trash") { offerPermanent(self, name, r.failed.message); cx.notify(); return; }
    if (!r.ok) { ask.error = r.failed.message; cx.notify(); return; }
    parts.closeAsk(self);
    await afterDelete(self);
    cx.notify();
  });
}

function offerPermanent(self, name, message) {
  const ask = {
    title: `${name} cannot go to the trash`,
    detail: `${message} Delete it permanently instead? This cannot be undone.`,
    choices: [{ label: "Cancel" }, {
      label: "Delete permanently", primary: true, run: (cx) => {
        self.ed.busy = true;
        cx.spawn(async (cx) => {
          const r = await deletePermanently(abs(self, name), { machine: null, root: self.ed.root });
          if (!self.ed) return;
          self.ed.busy = false;
          if (!r.ok) { ask.error = r.message; cx.notify(); return; }
          parts.closeAsk(self);
          await afterDelete(self);
          cx.notify();
        });
      },
    }],
  };
  parts.openAsk(self, ask);
}

async function afterDelete(self) {
  const ed = self.ed;
  ed.sel = ed.disk = ed.text = null;
  parts.resetTable(self, null);
  releaseRaw(self);
  ed.view = "table";
  await loadList(self);
  if (self.ed?.files[0]) await loadFile(self, self.ed.files[0]);
}
