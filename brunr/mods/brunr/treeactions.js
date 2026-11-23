// The tree's edit actions in the dialog: the row menu's edit entries, the keys, the forms
// (treeform.js), Move to, Move up and down, Delete, drag and drop, and the run of one operation:
// read the texts it needs, plan it with fileops.js, perform its effects with effects.js, carry
// Drafts to the new paths, reload, select the result and let the Request column follow. Rules live
// in treeops.js and fileops.js. `self` is the dialog (main.js).
import * as drafts from "./drafts.js";
import * as ops from "./fileops.js";
import { runEffects, readTexts, deletePermanently } from "./effects.js";
import { countRequests, findNode } from "./parser.js";
import { parentOf, baseOf, stripExt, EXT } from "./collpaths.js";
import { cloneName } from "./names.js";
import { carryDraft, derivedFile, dropAction, moveTargets, rowMenu, stepIndex } from "./treeops.js";
import { keyAction } from "./tree.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {Context | AsyncContext} AnyContext */
/** @typedef {any} Row */
/** @typedef {any} Dialog the dialog (main.js) */
/** One operation: `{ op, ck, targetCk?, args, form?, select?, deleted?, result? }`. @typedef {any} Job */

/**
 * The keys of the edit actions, in the dialog's shortcuts registry, so the settings can turn each
 * off or move it. Clone is a menu entry and a command without a key.
 * @type {import("./kit/shortcuts.js").Shortcut[]}
 */
export const SHORTCUTS = [
  { id: "new-request", key: "n", what: "new Request" }, { id: "new-folder", key: "shift-n", what: "new folder" },
  { id: "rename", key: "f2", what: "rename" }, { id: "move-to", key: "m", what: "move to" },
  { id: "move-up", key: "alt-up", what: "move up" }, { id: "move-down", key: "alt-down", what: "move down" },
  { id: "delete", key: "delete", what: "delete" },
];
/** Each edit command, and the key tree.keyAction knows it by. */
const TREE_KEYS = /** @type {Record<string, string>} */ ({ "new-request": "n", "new-folder": "shift-n", rename: "f2", delete: "delete", "move-up": "alt-up", "move-down": "alt-down", "move-to": "m" });
/** treeops.rowMenu's actions, and the command each one is. */
const COMMAND_OF = /** @type {Record<string, string>} */ ({
  newRequest: "new-request", newFolder: "new-folder", clone: "clone", rename: "rename", moveTo: "move-to",
  moveUp: "move-up", moveDown: "move-down", delete: "delete",
});
const ACT_OF = Object.fromEntries(Object.entries(COMMAND_OF).map(([a, c]) => [c, a]));

/** The edit entries of a row's menu, as picker choices whose values are commands. Collections on another Machine get none. @param {Dialog} self @param {Row} row */
export function menuEntries(self, row) {
  if (!row?.ck || row.machine != null || self.busy) return [];
  const c = self.collection(row.ck);
  const step = (/** @type {number} */ by) => Boolean(c && row.path && stepIndex(c, row.path, by));
  return rowMenu(row, { up: step(-1), down: step(1) })
    .filter((i) => COMMAND_OF[i.action] && !i.disabled)
    .map((i) => ({ label: i.label, value: COMMAND_OF[i.action], hint: hintFor(self, COMMAND_OF[i.action]) }));
}

/** @param {Dialog} self @param {string} id */
const hintFor = (self, id) => (SHORTCUTS.some((s) => s.id === id) && !self.shortcuts.isOff(id) ? self.shortcuts.keyFor(id) : "");

/**
 * An edit command from a key, the menu or `herdr-app do brunr.<command>`, on the selected row.
 * False when `c` is not one. @param {Dialog} self @param {AnyContext} cx @param {string} c @param {Row} [row]
 */
export function command(self, cx, c, row = self.selected()) {
  const act = ACT_OF[c];
  if (!act) return false;
  if (!row) return true;
  if (TREE_KEYS[c]) {
    const a = keyAction(TREE_KEYS[c], self.rows.includes(row) ? self.rows : [row], Math.max(0, self.rows.indexOf(row)));
    if (a) run(self, cx, a);
  } else if (row.ck && row.machine == null) run(self, cx, { act, row });
  return true;
}

/** @param {Dialog} self @param {AnyContext} cx @param {{ act: string, row: Row }} a */
function run(self, cx, a) {
  const row = a.row;
  if (!row?.ck) return;
  if (row.machine != null) return self.say("Editing works on this computer only.");
  if (self.busy) return self.say("Another change is still running.");
  const c = self.collection(row.ck);
  if (!c) return;
  if (a.act === "newRequest" || a.act === "newFolder") return openForm(self, a.act, row, c);
  if (row.kind !== "request" && row.kind !== "folder") return;
  if (a.act === "rename") openForm(self, row.broken ? "renameFile" : "rename", row, c);
  else if (a.act === "clone" && row.kind === "request" && !row.broken) openForm(self, "clone", row, c);
  else if (a.act === "delete") confirmDelete(self, row, c);
  else if (a.act === "moveTo") openMoveTo(self, row);
  else if (a.act === "moveUp" || a.act === "moveDown") {
    const s = stepIndex(c, row.path, a.act === "moveUp" ? -1 : 1);
    if (s) perform(self, cx, { op: "reorder", ck: row.ck, args: { path: row.path, index: s.index }, select: row.path });
  }
}

// ---- the forms ------------------------------------------------------------------------------------

/** The folder a new item goes in: the folder row, a Request's folder, or the Collection root. @param {Row} row */
const parentFor = (row) => (row.kind === "folder" ? row.path : row.kind === "request" ? parentOf(row.path) : "");

/** @param {Dialog} self @param {string} kind @param {Row} row @param {any} c */
function openForm(self, kind, row, c) {
  const ext = EXT[/** @type {"yaml" | "bru"} */ (c.format)];
  const isFolder = kind === "newFolder" || (kind === "rename" && row.kind === "folder");
  let f;
  if (kind === "newRequest") f = { title: "New Request", confirm: "Create", name: "", file: "", ext };
  else if (kind === "newFolder") f = { title: "New folder", confirm: "Create", name: "", file: "", ext: "" };
  else if (kind === "clone") {
    const name = cloneName(siblingNames(c, row.path), row.name);
    f = { title: `Clone "${row.name}"`, confirm: "Clone", name, file: derivedFile(name), ext };
  } else {
    const file = row.kind === "folder" ? baseOf(row.path) : stripExt(baseOf(row.path));
    f = { title: `Rename "${row.name}"`, confirm: "Rename", name: row.name, file, ext: row.kind === "folder" ? "" : ext };
  }
  const parent = parentFor(row), initialFile = f.file;
  self.pickers.close();
  self.treeForm.show({ kind, isFolder, ...f }, (/** @type {any} */ v, /** @type {AnyContext} */ cx) => {
    const fileName = v.file.trim();
    let op, args;
    if (kind === "newRequest") { op = "newRequest"; args = { parent, name: v.name, method: v.method, url: v.url, fileName }; }
    else if (kind === "newFolder") { op = "newFolder"; args = { parent, name: v.name, dirName: fileName }; }
    else if (kind === "clone") { op = "cloneRequest"; args = { path: row.path, name: v.name, fileName }; }
    else {
      // The file or directory name changes only when the person edited it, as in Bruno.
      op = "renameItem";
      args = { path: row.path, name: kind === "renameFile" ? null : v.name, fileName: fileName === initialFile ? null : fileName };
    }
    perform(self, cx, { op, ck: row.ck, args, form: true });
  });
}

/** @param {any} c @param {string} path */
function siblingNames(c, path) {
  const dir = parentOf(path);
  const n = dir ? findNode(c, dir) : null;
  return (dir ? n?.children ?? [] : c.children).map((/** @type {any} */ x) => x.name);
}

// ---- Move to and Delete ---------------------------------------------------------------------------

/** @param {Dialog} self @param {Row} row */
function openMoveTo(self, row) {
  const collections = (self.found?.entries ?? []).map((/** @type {any} */ e) => ({ ck: e.key, machine: e.machine ?? null, collection: self.collection(e.key) }));
  const options = moveTargets(row, collections);
  if (!options.length) return self.say(`"${row.name}" has no other folder to go to.`);
  self.pickers.show({
    title: `Move "${row.name}" to`, options,
    choose: (/** @type {string} */ value, /** @type {AnyContext} */ cx) => {
      const at = String(value ?? "").indexOf("#");
      if (at < 0) return;
      const targetCk = value.slice(0, at), to = value.slice(at + 1);
      if (targetCk === row.ck) perform(self, cx, { op: "move", ck: row.ck, args: { path: row.path, to, index: null } });
      else perform(self, cx, { op: "moveBetween", ck: row.ck, targetCk, args: { path: row.path, to, index: null } });
    },
  });
}

/**
 * A question in the dialog's picker: Cancel, then the action, which is highlighted.
 * @param {Dialog} self @param {string} title @param {string} detail @param {string} label @param {(cx: AnyContext) => void} yes
 */
function confirm(self, title, detail, label, yes) {
  self.pickers.show({
    title, detail, at: 1, options: [{ label: "Cancel", value: false }, { label, value: true }],
    choose: (/** @type {boolean} */ ok, /** @type {AnyContext} */ cx) => { if (ok) yes(cx); },
  });
}

/** @param {Dialog} self @param {Row} row @param {any} c */
function confirmDelete(self, row, c) {
  const node = findNode(c, row.path);
  if (!node) return;
  const n = node.kind === "folder" ? countRequests(node) : 0;
  const unsaved = drafts.draftsUnder(row.key).length > 0;
  const detail = [
    node.kind === "folder" ? `The folder and the ${n} ${n === 1 ? "Request" : "Requests"} in it go to the trash.` : "It goes to the trash.",
    unsaved ? "It has unsaved changes." : "",
  ].filter(Boolean).join(" ");
  confirm(self, `Delete ${node.kind === "folder" ? "folder " : ""}"${row.name}"?`, detail, "Move to trash",
    (cx) => perform(self, cx, { op: "deleteItem", ck: row.ck, args: { path: row.path }, deleted: row }));
}

/** The trash failed or there is none: a second question offers a permanent delete. @param {Dialog} self @param {Job} job @param {any[]} effects @param {any} failed */
function offerPermanent(self, job, effects, failed) {
  const row = job.deleted;
  confirm(self, `"${row.name}" cannot go to the trash`, `${failed.message} Delete it permanently instead? This cannot be undone.`, "Delete permanently", (cx) => {
    const entry = self.entry(job.ck);
    self.busy = true;
    cx.spawn(async (cx) => {
      const r = await deletePermanently(failed.effect.path, { machine: entry.machine ?? null, root: entry.root });
      if (!r.ok) { self.say(`"${row.name}" was not deleted: ${r.message}`); return finish(self, cx, job, null); }
      const rest = effects.slice(failed.index + 1);
      const out = await runEffects(rest, { machine: entry.machine ?? null, root: entry.root });
      followEffects(self, job, [failed.effect, ...out.ran]);
      if (!out.ok) report(self, out, rest.length + 1, 1);
      finish(self, cx, job, out.ok ? job.result : null);
    });
  });
}

// ---- drag and drop --------------------------------------------------------------------------------
// The row is the handle. A press may become a drag. Only a move over another row shows a drop, and
// the release there makes it. A press and release on one row is a click, which the row handles.

/** The button went down on a row. Requests and folders of this computer only. @param {Dialog} self @param {Row} row */
export function press(self, row) {
  self.drag = { pressed: !self.busy && row.machine == null && (row.kind === "request" || row.kind === "folder") ? row : null, over: null };
}

/**
 * The pointer moved over a row with the button down: the drop it would make, or none (no highlight).
 * @param {Dialog} self @param {Row} row @param {{ local_position?: { y: number }, bounds?: { height: number } }} e @param {Context} cx
 */
export function hover(self, row, e, cx) {
  const d0 = self.drag;
  if (!d0?.pressed) return;
  const h = e?.bounds?.height || 1;
  const y = Math.max(0, Math.min(1, (e?.local_position?.y ?? h / 2) / h));
  const d = row.key === d0.pressed.key ? null : dropAction({ dragged: d0.pressed, over: row, y, collectionOf: (/** @type {string} */ ck) => self.collection(ck) });
  // A refusal with nothing to tell shows no highlight. One to tell (another format) is kept for the release.
  const next = d && (d.run || d.toast) ? { key: row.key, zone: d.zone ?? null, drop: d } : null;
  if (next?.key !== d0.over?.key || next?.zone !== d0.over?.zone) { d0.over = next; cx.notify(); }
}

/** Released on a row: the drop runs, or a refusal with a reason to tell is said. @param {Dialog} self @param {Row} row @param {AnyContext} cx */
export function release(self, row, cx) {
  const from = self.drag?.pressed, over = self.drag?.over;
  self.drag = null;
  if (!from || !over || over.key !== row.key) return;
  const d = over.drop;
  if (d.toast) return self.say(`Not moved: another format. ${d.toast}`);
  if (!d.run) return;
  const { op, ck, targetCk, path, to, index } = d.run;
  const args = op === "reorder" ? { path, index } : { path, to, index };
  perform(self, cx, { op, ck, targetCk, args, select: op === "reorder" ? path : null });
}

/** Escape, or a release away from the rows: no drop. True when a drag was going on. @param {Dialog} self */
export function cancelDrag(self) {
  const was = Boolean(self.drag?.over);
  self.drag = null;
  return was;
}

/** How a row is drawn during a drag: "inside", "above", "below", "dragged" or null. @param {Dialog} self @param {Row} row */
export function dragMark(self, row) {
  const d = self.drag;
  if (!d?.pressed || !d.over) return null;
  if (d.over.key === row.key && d.over.drop?.run) return d.over.zone;
  return d.pressed.key === row.key ? "dragged" : null;
}

// ---- performing -----------------------------------------------------------------------------------

/**
 * Runs one operation. An `{ error }` from the operation shows in the form, or under the panes, and
 * nothing is done. @param {Dialog} self @param {AnyContext} cx @param {Job} job
 */
export function perform(self, cx, job) {
  const entry = self.entry(job.ck), c = self.collection(job.ck);
  const tEntry = job.targetCk ? self.entry(job.targetCk) : null, target = job.targetCk ? self.collection(job.targetCk) : null;
  if (!entry || !c || entry.machine != null || (job.targetCk && (!tEntry || !target || tEntry.machine != null))) return;
  if (self.busy) return;
  self.busy = true;
  cx.spawn(async (cx) => {
    const operation = { op: job.op, ...job.args, ...(target ? { target } : {}) };
    const texts = await readTexts(entry.root, ops.needs(operation, c));
    const targetTexts = target ? await readTexts(tEntry.root, ops.needs({ ...operation, side: "target" }, c)) : undefined;
    const out = /** @type {any} */ (ops)[job.op]({ collection: c, texts, ...job.args, ...(target ? { target, targetTexts } : {}) });
    if (out.error) {
      if (job.form) self.treeForm.fail(out.error);
      else self.say(`Not changed: ${out.error}`);
      return finish(self, cx, job, null);
    }
    job.result = out.result;
    const roots = tEntry ? [entry.root, tEntry.root] : entry.root;
    const run = await runEffects(out.effects, { machine: null, root: roots });
    followEffects(self, job, run.ran);
    if (job.form) {
      if (run.ok || run.ran.length) self.treeForm.close();
      else self.treeForm.fail(run.failed?.message ?? "It did not work.");
    }
    if (!run.ok && run.failed?.kind === "trash" && job.deleted) {
      self.busy = false;
      offerPermanent(self, job, out.effects, run.failed);
      cx.notify();
      return;
    }
    if (!run.ok && (!job.form || run.ran.length)) report(self, run, out.effects.length, 0);
    finish(self, cx, job, run.ok ? out.result : null);
  });
}

/** Says which step of a failed run failed, and whether earlier steps already ran. `before`: steps run before it. @param {Dialog} self @param {any} run @param {number} total @param {number} before */
function report(self, run, total, before) {
  const done = run.ran.length + before;
  const what = /** @type {Record<string, string>} */ ({ write: "writing", mkdir: "creating", move: "moving", trash: "trashing" })[run.failed.effect?.op] ?? "changing";
  const file = String(run.failed.effect?.path ?? run.failed.effect?.from ?? "").split("/").pop();
  self.say(`Step ${run.failed.index + 1 + before} of ${total} (${what} ${file}) failed: ${run.failed.message}${done ? ` ${done} earlier ${done === 1 ? "step" : "steps"} already ran. The tree was reloaded.` : ""}`);
}

/** The key of an absolute path in a loaded Collection of this computer, or null. @param {Dialog} self @param {string} path */
function keyOf(self, path) {
  for (const e of self.found?.entries ?? []) {
    if (e.machine == null && path.startsWith(`${e.root}/`)) return `${e.key}#${path.slice(e.root.length + 1)}`;
  }
  return null;
}

/** Is `key` the item at `top` or inside it? @param {string} key @param {string} top */
const under = (key, top) => key === top || key.startsWith(`${top}/`);

/**
 * Drafts and the Request column follow what ran: moves rekey them, writes rebase them, a delete
 * drops them. The column's new key is kept in `job.shown` for after the reload, "" when it empties.
 * @param {Dialog} self @param {Job} job @param {any[]} ran
 */
function followEffects(self, job, ran) {
  for (const e of ran) {
    if (e.op === "move") {
      const from = keyOf(self, e.from), to = keyOf(self, e.to);
      if (!from || !to) continue;
      drafts.rekey(from, to);
      const shown = job.shown ?? self.request.req?.key;
      if (shown && under(shown, from)) job.shown = to + shown.slice(from.length);
    } else if (e.op === "trash") {
      const key = keyOf(self, e.path);
      if (!key) continue;
      drafts.drop(key);
      const shown = job.shown ?? self.request.req?.key;
      if (shown && under(shown, key)) job.shown = "";
    } else if (e.op === "write" && e.expected != null) {
      const key = keyOf(self, e.path);
      const rec = key && drafts.get(key);
      if (!rec || rec.base !== e.expected) continue;
      const format = self.collection(key.slice(0, key.indexOf("#")))?.format ?? "yaml";
      drafts.rebase(key, e.text, carryDraft(rec, e.text, format).text);
    }
  }
}

/**
 * After a run: reload the Collections it touched, select and reveal the item and show it. The
 * Request column follows a rename or move of its Request and empties when it was deleted.
 * @param {Dialog} self @param {AnyContext} cx @param {Job} job @param {any} result
 */
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
      self.reveal = true;
    } else if (job.op === "deleteItem" && result) {
      const parent = parentOf(job.args.path);
      self.sel = parent ? `${ck}#${parent}` : ck;
    }
    if (job.shown === "") self.request.clear();
    self.buildRows();
    const row = self.selected();
    if (row?.kind === "request" && (path || job.shown)) self.showSelected(cx);
    else if (job.shown) {
      // The shown Request moved with its folder: the column shows it at its new path, folded or not.
      const at = job.shown.indexOf("#");
      const sck = job.shown.slice(0, at), spath = job.shown.slice(at + 1);
      const sc = self.collection(sck);
      const node = sc ? findNode(sc, spath) : null;
      if (node) self.request.show(self.requestInfo({ key: job.shown, ck: sck, path: spath, name: node.name }), cx);
    }
    cx.notify();
  });
}
