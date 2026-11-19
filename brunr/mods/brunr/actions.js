// The tree's edit actions in the panel copy: the row menu, the dialogs, Move to, Move up and down,
// drag and drop, and the run of one operation: read the texts it needs, plan it with fileops.js,
// perform its effects with effects.js, carry Drafts and shown Requests to the new paths, reload,
// and select what was made or moved. Rules live in treeops.js and fileops.js. `self` is the panel.
import { closeOverlay, notify, openOverlay } from "herdr";
import * as store from "./store.js";
import * as drafts from "./drafts.js";
import * as popup from "./popup.js";
import * as saveflow from "./saveflow.js";
import * as ops from "./fileops.js";
import { runEffects, readTexts, deletePermanently } from "./effects.js";
import { countRequests, findNode } from "./parser.js";
import { parentOf, baseOf, stripExt, EXT } from "./collpaths.js";
import { cloneName } from "./names.js";
import { carryDraft, derivedFile, dropAction, moveTargets, rowMenu, stepIndex } from "./treeops.js";
import { formHeight } from "./forms.js";
import * as envedit from "./envedit.js";

const EDITS = new Set(["newRequest", "newFolder", "rename", "clone", "delete", "moveUp", "moveDown", "moveTo"]);
let counter = 0;

// ---- the menu ----------------------------------------------------------------------------------

/** The row's menu: Open, Run and the edit actions first, then the Environment, Bruno, copy and Reload. */
export function menu(self, row) {
  self.sel = row.key;
  const c = self.collection(row.ck);
  const step = (by) => Boolean(c && row.path && stepIndex(c, row.path, by));
  const items = rowMenu(row, { canRun: self.canRun(row) && !row.broken, up: step(-1), down: step(1), busy: self.busy });
  const local = row.machine == null;
  const more = [];
  if (row.ck) more.push({ label: "Environment", action: "env", hint: "e" });
  if (row.kind === "global") more.push({ label: "Global environment", action: "global", hint: "e" });
  if (row.ck && local) more.push({ label: "Open Bruno", action: "bruno", hint: "b" });
  if (items.length && more.length) items.push({ sep: true });
  items.push(...more);
  if (row.kind === "request" && row.url) items.push({ sep: true }, { label: "Copy URL", copy: row.url });
  if (row.ck) items.push(...(row.kind === "request" && row.url ? [] : [{ sep: true }]), { label: "Copy path", copy: row.path ? `${self.entry(row.ck)?.root}/${row.path}` : self.entry(row.ck)?.root });
  items.push({ sep: true }, { label: "Reload", action: "reload" });
  openOverlay({ mod: "brunr", kind: "popup", width: 230, height: popup.menuHeight(items), props: { menu: { key: row.key, items } } });
}

// ---- acts --------------------------------------------------------------------------------------

/** An edit act from a key or the menu. True when it was one. */
export function act(self, cx, a) {
  if (a.act === "editEnvs" || a.act === "editDotenv") return openEditor(self, a.act, a.row?.ck, null), true;
  if (!EDITS.has(a.act)) return false;
  const row = a.row;
  if (!row?.ck || row.machine != null) return true;
  if (self.busy) { notify({ title: "Brunr", body: "Another change is still running.", level: "info" }); return true; }
  const c = self.collection(row.ck);
  if (!c) return true;
  if (a.act === "newRequest" || a.act === "newFolder") return openForm(self, a.act, row, c), true;
  if (row.kind !== "request" && row.kind !== "folder") return true;
  if (a.act === "rename") openForm(self, row.broken ? "renameFile" : "rename", row, c);
  else if (a.act === "clone" && row.kind === "request" && !row.broken) openForm(self, "clone", row, c);
  else if (a.act === "delete") confirmDelete(self, cx, row, c);
  else if (a.act === "moveTo") openMoveTo(self, row);
  else if (a.act === "moveUp" || a.act === "moveDown") {
    const s = stepIndex(c, row.path, a.act === "moveUp" ? -1 : 1);
    if (s) perform(self, cx, { op: "reorder", ck: row.ck, args: { path: row.path, index: s.index }, select: row.path });
  }
  return true;
}

/** An ask for the tree: a form's values, or Move to's choice. True when it was one. */
export function takeAsk(self, cx, a) {
  if (a.kind === "form") { submitForm(self, cx, a.flow); return true; }
  if (a.kind === "editEnv") { openEditor(self, "editEnvs", a.key, a.path ?? null); return true; }
  if (a.kind === "envGone") { envGone(self, cx, a); return true; }
  if (a.kind === "moveTo") {
    const row = self.rowFor(a.key);
    const at = String(a.value ?? "").indexOf("#");
    if (!row || at < 0) return true;
    const targetCk = a.value.slice(0, at), to = a.value.slice(at + 1);
    if (targetCk === row.ck) perform(self, cx, { op: "move", ck: row.ck, args: { path: row.path, to, index: null } });
    else perform(self, cx, { op: "moveBetween", ck: row.ck, targetCk, args: { path: row.path, to, index: null } });
    return true;
  }
  return false;
}

/** The folder a new item goes in: the folder row, a Request's folder, or the Collection root. */
const parentFor = (row) => (row.kind === "folder" ? row.path : row.kind === "request" ? parentOf(row.path) : "");

function openForm(self, kind, row, c) {
  const id = `form-${Date.now().toString(36)}-${++counter}`;
  const ext = EXT[c.format];
  const isFolder = kind === "newFolder" || (kind === "rename" && row.kind === "folder");
  let f;
  if (kind === "newRequest") f = { title: "New Request", confirm: "Create", name: "", file: "", ext, method: "GET" };
  else if (kind === "newFolder") f = { title: "New folder", confirm: "Create", name: "", file: "", ext: "" };
  else if (kind === "clone") {
    const name = cloneName(siblingNames(c, row.path), row.name);
    f = { title: `Clone "${row.name}"`, confirm: "Clone", name, file: derivedFile(name), ext };
  } else {
    const file = row.kind === "folder" ? baseOf(row.path) : stripExt(baseOf(row.path));
    f = { title: `Rename "${row.name}"`, confirm: "Rename", name: row.name, file, ext: row.kind === "folder" ? "" : ext };
  }
  const form = { id, kind, isFolder, ...f };
  self.forms.set(id, { kind, row, parent: parentFor(row), initialFile: f.file });
  store.setForm(id, { busy: false, error: null });
  openOverlay({ mod: "brunr", kind: "dialog", width: 460, height: formHeight(form), props: { form } });
}

function siblingNames(c, path) {
  const dir = parentOf(path);
  const n = dir ? findNode(c, dir) : null;
  return (dir ? n?.children ?? [] : c.children).map((x) => x.name);
}

/** The panel's answer to a form: run its operation; an error shows in the dialog, success closes it. */
function submitForm(self, cx, id) {
  const ctx = self.forms.get(id), v = store.form(id)?.values;
  if (!v) return;
  // The panel was reloaded (a mod update) since the dialog opened, and no longer knows it.
  if (!ctx) return store.setForm(id, { busy: false, error: "Brunr was reloaded. Close this dialog and open it again." });
  const { kind, row } = ctx;
  const fileName = v.file.trim();
  let op, args;
  if (kind === "newRequest") { op = "newRequest"; args = { parent: ctx.parent, name: v.name, method: v.method, url: v.url, fileName }; }
  else if (kind === "newFolder") { op = "newFolder"; args = { parent: ctx.parent, name: v.name, dirName: fileName }; }
  else if (kind === "clone") { op = "cloneRequest"; args = { path: row.path, name: v.name, fileName }; }
  else {
    // The file or directory name changes only when the person edited it, as in Bruno.
    op = "renameItem";
    args = { path: row.path, name: kind === "renameFile" ? null : v.name, fileName: fileName === ctx.initialFile ? null : fileName };
  }
  perform(self, cx, { op, ck: row.ck, args, form: id, open: kind === "newRequest" });
}

// ---- the Environment and .env editors --------------------------------------------------------------

/** Opens an editor window for a Collection on this computer. Its props: the Machine, the root and a relative path. */
function openEditor(self, which, ck, path) {
  const entry = ck ? self.entry(ck) : null;
  if (!entry) return;
  if (entry.machine != null) { notify({ title: "Brunr", body: "Editing works on this computer only.", level: "info" }); return; }
  if (which === "editEnvs") envedit.open(entry.root, path);
  else openOverlay({ mod: "brunr", kind: "window", width: envedit.WIDTH, height: envedit.HEIGHT, props: { dotenvEditor: { machine: null, root: entry.root, path: ".env" } } });
}

/**
 * An Environment was renamed (`newName`) or deleted (`newName` null): the Collection's remembered
 * choice follows. (An ask's `to` is its address, so the new name is not called that.)
 */
function envGone(self, cx, a) {
  if (self.saved.env(a.key) === a.name) {
    if (a.newName) self.saved.setEnv(a.key, a.newName);
    else self.saved.clearEnv(a.key);
  }
  const e = self.entry(a.key);
  if (e) cx.spawn(async (cx) => { await self.loadOne(cx, e); });
}

// ---- Move to -------------------------------------------------------------------------------------

function openMoveTo(self, row) {
  const collections = (self.found?.entries ?? []).map((e) => ({ ck: e.key, machine: e.machine ?? null, collection: self.collection(e.key) }));
  const options = moveTargets(row, collections);
  if (!options.length) { notify({ title: "Nowhere to move", body: `"${row.name}" has no other folder to go to.`, level: "info" }); return; }
  openOverlay({ mod: "brunr", kind: "dialog", width: 340, height: popup.pickerHeight(options), props: { picker: { kind: "moveTo", key: row.key, title: `Move "${row.name}" to`, options, current: "\u0000" } } });
}

// ---- delete --------------------------------------------------------------------------------------

function confirmDelete(self, cx, row, c) {
  const node = findNode(c, row.path);
  if (!node) return;
  const n = node.kind === "folder" ? countRequests(node) : 0;
  const unsaved = drafts.draftsUnder(row.key).length > 0;
  const detail = [
    node.kind === "folder" ? `The folder and the ${n} ${n === 1 ? "Request" : "Requests"} in it go to the trash.` : "It goes to the trash.",
    unsaved ? "It has unsaved changes." : "",
  ].filter(Boolean).join(" ");
  saveflow.ask(self, {
    title: `Delete ${node.kind === "folder" ? "folder" : ""} "${row.name}"?`.replace("  ", " "),
    detail,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "delete", label: "Move to trash", primary: true }],
  }, (cx, choice) => { if (choice === "delete") perform(self, cx, { op: "deleteItem", ck: row.ck, args: { path: row.path }, deleted: row }); });
}

/** The trash failed or there is none: a second dialog offers a permanent delete. */
function offerPermanent(self, cx, job, effects, failed) {
  const row = job.deleted;
  saveflow.ask(self, {
    title: `"${row.name}" cannot go to the trash`,
    detail: `${failed.message} Delete it permanently instead? This cannot be undone.`,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "permanent", label: "Delete permanently", primary: true }],
  }, (cx, choice) => {
    if (choice !== "permanent") return;
    const entry = self.entry(job.ck);
    self.busy = true;
    cx.spawn(async (cx) => {
      const r = await deletePermanently(failed.effect.path, { machine: entry.machine ?? null, root: entry.root });
      if (!r.ok) { notify({ title: "Not deleted", body: `"${row.name}": ${r.message}`, level: "warning" }); return finish(self, cx, job, null); }
      const rest = effects.slice(failed.index + 1);
      const out = await runEffects(rest, { machine: entry.machine ?? null, root: entry.root });
      followEffects(self, job, [failed.effect, ...out.ran]);
      if (!out.ok) report(out, rest.length + 1, 1);
      finish(self, cx, job, out.ok ? job.result : null);
    });
  });
}

// ---- drag and drop -------------------------------------------------------------------------------

/** The button went down on a row: it may become a drag. Requests and folders of this computer only. */
export function press(self, row) {
  self.pressed = !self.busy && row.machine == null && (row.kind === "request" || row.kind === "folder") ? row : null;
  self.over = null;
}

/** The pointer moved over a row while pressed: the drop it would make, or none (no highlight). */
export function hover(self, row, e, cx) {
  if (!self.pressed) return;
  const h = e?.bounds?.height || 1;
  const y = Math.max(0, Math.min(1, (e?.local_position?.y ?? h / 2) / h));
  const d = row.key === self.pressed.key ? null : dropAction({ dragged: self.pressed, over: row, y, collectionOf: (ck) => self.collection(ck) });
  const next = d ? { key: row.key, zone: d.zone ?? null, drop: d } : null;
  if (next?.key !== self.over?.key || next?.zone !== self.over?.zone) { self.over = next; cx.notify(); }
}

/** Released on a row: the drop runs, or a refusal with a reason to tell is shown. */
export function release(self, row, cx) {
  const from = self.pressed, over = self.over;
  self.pressed = self.over = null;
  if (!from || !over || over.key !== row.key) return;
  const d = over.drop;
  if (d.toast) { notify({ title: "Not moved: another format", body: d.toast, level: "warning" }); return; }
  if (!d.run) return;
  const { op, ck, targetCk, path, to, index } = d.run;
  const args = op === "reorder" ? { path, index } : { path, to, index };
  perform(self, cx, { op, ck, targetCk, args, select: op === "reorder" ? path : null });
}

/** Escape, or a release outside a row: no drop. */
export function cancelDrag(self) {
  const was = Boolean(self.pressed);
  self.pressed = self.over = null;
  return was;
}

/** How a row is drawn during a drag: "inside", "above", "below", "dragged" or null. */
export function dragMark(self, row) {
  if (!self.pressed) return null;
  if (self.over?.key === row.key && self.over.drop?.run) return self.over.zone;
  return self.pressed.key === row.key && self.over ? "dragged" : null;
}

// ---- performing ----------------------------------------------------------------------------------

/**
 * Runs one operation: `{ op, ck, targetCk?, args, form?, select?, open?, deleted? }`. An `{ error }`
 * from the operation shows in the form, or as a toast, and nothing is done.
 */
export function perform(self, cx, job) {
  const entry = self.entry(job.ck), c = self.collection(job.ck);
  const tEntry = job.targetCk ? self.entry(job.targetCk) : null, target = job.targetCk ? self.collection(job.targetCk) : null;
  if (!entry || !c || entry.machine != null || (job.targetCk && (!tEntry || !target || tEntry.machine != null))) return;
  if (self.busy) return;
  // Often called while the panel draws (an ask taken in render), so no cx.notify() here.
  self.busy = true;
  cx.spawn(async (cx) => {
    const operation = { op: job.op, ...job.args, ...(target ? { target } : {}) };
    const texts = await readTexts(entry.root, ops.needs(operation, c));
    const targetTexts = target ? await readTexts(tEntry.root, ops.needs({ ...operation, side: "target" }, c)) : undefined;
    const out = ops[job.op]({ collection: c, texts, ...job.args, ...(target ? { target, targetTexts } : {}) });
    if (out.error) {
      if (job.form) store.setForm(job.form, { busy: false, error: out.error });
      else notify({ title: "Not changed", body: out.error, level: "warning" });
      return finish(self, cx, job, null);
    }
    job.result = out.result;
    const roots = tEntry ? [entry.root, tEntry.root] : entry.root;
    const run = await runEffects(out.effects, { machine: null, root: roots });
    followEffects(self, job, run.ran);
    if (job.form) store.setForm(job.form, run.ok || run.ran.length ? { done: true } : { busy: false, error: run.failed?.message ?? "It did not work." });
    if (!run.ok && run.failed?.kind === "trash" && job.deleted) {
      self.busy = false;
      offerPermanent(self, cx, job, out.effects, run.failed);
      return;
    }
    if (!run.ok && (!job.form || run.ran.length)) report(run, out.effects.length, 0);
    finish(self, cx, job, run.ok ? out.result : null);
  });
}

/** Says which step of a failed run failed, and whether earlier steps already ran. `before`: steps run before it. */
function report(run, total, before) {
  const done = run.ran.length + before;
  const what = { write: "writing", mkdir: "creating", move: "moving", trash: "trashing" }[run.failed.effect?.op] ?? "changing";
  const file = String(run.failed.effect?.path ?? run.failed.effect?.from ?? "").split("/").pop();
  notify({ title: "Not done", body: `Step ${run.failed.index + 1 + before} of ${total} (${what} ${file}) failed: ${run.failed.message}${done ? ` ${done} earlier ${done === 1 ? "step" : "steps"} already ran. The tree was reloaded.` : ""}`, level: "warning" });
}

/** The key of an absolute path in a loaded Collection of this computer, or null. */
function keyOf(self, path) {
  for (const e of self.found?.entries ?? []) {
    if (e.machine == null && path.startsWith(`${e.root}/`)) return `${e.key}#${path.slice(e.root.length + 1)}`;
  }
  return null;
}

/** Drafts and shown Requests follow what ran: moves rekey them, writes rebase them, a delete drops them. */
function followEffects(self, job, ran) {
  for (const e of ran) {
    if (e.op === "move") {
      const from = keyOf(self, e.from), to = keyOf(self, e.to);
      if (!from || !to) continue;
      drafts.rekey(from, to);
      const toCk = to.slice(0, to.indexOf("#"));
      const toEntry = self.entry(toCk);
      store.followShown(from, to, { ck: toCk, root: toEntry?.root, ...(job.op === "renameItem" ? { name: job.result.name } : {}) });
    } else if (e.op === "trash") {
      const key = keyOf(self, e.path);
      if (key) { drafts.drop(key); store.followShown(key, null); }
    } else if (e.op === "write" && e.expected != null) {
      const key = keyOf(self, e.path);
      const rec = key && drafts.get(key);
      if (!rec || rec.base !== e.expected) continue;
      const format = self.collection(key.slice(0, key.indexOf("#")))?.format ?? "yaml";
      drafts.rebase(key, e.text, carryDraft(rec, e.text, format).text);
    }
  }
  // A rename that kept the file name changes only the name the pane shows.
  if (job.op === "renameItem" && job.result) store.followShown(`${job.ck}#${job.result.path}`, `${job.ck}#${job.result.path}`, { name: job.result.name });
}

/** After a run: reload the Collections it touched, select and reveal the item, open a new Request. */
function finish(self, cx, job, result) {
  cx.spawn(async (cx) => {
    const keys = [job.ck, job.targetCk].filter(Boolean);
    for (const k of keys) { const e = self.entry(k); if (e) await self.loadOne(cx, e); }
    self.busy = false;
    const ck = job.targetCk ?? job.ck;
    const path = result?.path ?? (job.op === "deleteItem" ? null : job.select ?? null);
    if (path) {
      self.saved.setOpen(ck, true);
      for (let d = parentOf(path); d; d = parentOf(d)) self.saved.setOpen(`${ck}#${d}`, true);
      self.sel = `${ck}#${path}`;
      self.reveal = self.sel;
    } else if (job.op === "deleteItem" && result) {
      const parent = parentOf(job.args.path);
      self.sel = parent ? `${ck}#${parent}` : ck;
    }
    if (job.open && result?.path) {
      const row = self.rowFor(`${ck}#${result.path}`);
      if (row) self.openRequest(row);
    }
    cx.notify();
  });
}
