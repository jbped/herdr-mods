// The rules of the tree's edit actions: where a displayed position lands in Bruno's numbering, what
// a drop does, which folders Move to offers, what a dialog's fields say, and how a Draft follows
// its file. Pure: no Herdr, no drawing.
//
// The panel shows folders first, then Requests (Bruno's sidebar). `reorder` and `move` number one
// list of folders and Requests (`sequenceOrder`). A displayed neighbour or drop target is turned
// into an index in that list the way Bruno's sidebar does it (getReorderedItemsInTargetDirectory):
// the item goes at the target's place for a drop above it, and one after for a drop below it.
import { sequenceOrder } from "./fileops.js";
import { childrenOf, parentOf } from "./collpaths.js";
import { findNode } from "./parser.js";
import { sanitizeName, validateName } from "./names.js";
import { readHead, setName, setSeq } from "./edit.js";

const isInside = (path, folder) => path === folder || path.startsWith(`${folder}/`);

/**
 * The `index` for `reorder` or `move` that puts `path` above or below `targetPath`, both in folder
 * `dir` of `collection` once moved. `path` null or in another folder: it is not in the list yet.
 * null when the target has no place in the numbering (a file that does not parse).
 */
export function dropIndex(collection, dir, path, targetPath, where) {
  const list = sequenceOrder(collection, dir);
  const at = list.findIndex((n) => n.path === targetPath);
  if (at < 0) return null;
  let index = where === "below" ? at + 1 : at;
  const own = path == null ? -1 : list.findIndex((n) => n.path === path);
  if (own >= 0 && own < index) index--;
  return index;
}

/** The item's place in its folder's numbering, or -1. */
export const currentIndex = (collection, path) => sequenceOrder(collection, parentOf(path)).findIndex((n) => n.path === path);

/**
 * Move up (`by` -1) or down (+1) among the item's own group as displayed: a folder among folders,
 * a Request among Requests. `{ index }` for `reorder`, or null when there is no neighbour there or
 * the order would not change.
 */
export function stepIndex(collection, path, by) {
  const node = findNode(collection, path);
  if (!node || node.broken) return null;
  const dir = parentOf(path);
  const group = (childrenOf(collection, dir) ?? []).filter((n) => (n.kind === "folder") === (node.kind === "folder"));
  const at = group.findIndex((n) => n.path === path);
  const other = group[at + by];
  if (at < 0 || !other) return null;
  const index = dropIndex(collection, dir, path, other.path, by < 0 ? "above" : "below");
  return index == null || index === currentIndex(collection, path) ? null : { index };
}

/**
 * Where on a row a drop lands. `y` is the pointer's height within the row, 0 at the top and 1 at the
 * bottom. A folder: top third above, bottom third below, else inside. A Request: above or below its
 * middle (Bruno's halves). A Collection: inside.
 */
export function dropZone(row, y) {
  if (row?.kind === "collection") return "inside";
  if (row?.kind === "folder") return y < 1 / 3 ? "above" : y > 2 / 3 ? "below" : "inside";
  if (row?.kind === "request") return y < 0.5 ? "above" : "below";
  return null;
}

const FORMAT = { yaml: "YAML", bru: "bru" };

/**
 * What dropping row `dragged` on row `over` at height `y` does. `collectionOf(ck)` gives a loaded
 * Collection. Returns `{ zone, run }` where `run` is the operation (`{ op, ck, path, to, index,
 * targetCk? }`, `op` being "move", "reorder" or "moveBetween"), or `{ refuse, toast? }`: `refuse`
 * says why, and `toast` is set when the person must be told (a Collection of another format).
 */
export function dropAction({ dragged, over, y, collectionOf }) {
  const no = (refuse, toast = null) => ({ refuse, ...(toast ? { toast } : {}) });
  if (!dragged || (dragged.kind !== "request" && dragged.kind !== "folder")) return no("only Requests and folders move");
  if (!over || !["collection", "folder", "request"].includes(over.kind)) return no("not a place to drop");
  if (dragged.machine != null || over.machine != null) return no("editing works on this computer only");
  if (dragged.key === over.key) return no("onto itself");
  const zone = dropZone(over, y);
  const source = collectionOf(dragged.ck), target = collectionOf(over.ck);
  if (!source || !target) return no("the Collection is not loaded");
  const sameColl = dragged.ck === over.ck;
  const overPath = over.kind === "collection" ? "" : over.path;
  if (sameColl && dragged.kind === "folder" && overPath && isInside(overPath, dragged.path)) return no("a folder cannot go into itself");
  const to = zone === "inside" ? overPath : parentOf(overPath);
  if (!sameColl) {
    if (source.format !== target.format) {
      return no("another format", `Brunr moves items only between Collections of the same format. "${source.name}" is ${FORMAT[source.format]} and "${target.name}" is ${FORMAT[target.format]}.`);
    }
    const index = zone === "inside" ? null : dropIndex(target, to, null, overPath, zone);
    return { zone, run: { op: "moveBetween", ck: dragged.ck, targetCk: over.ck, path: dragged.path, to, index } };
  }
  const from = parentOf(dragged.path);
  if (zone === "inside") {
    if (to === from) return no("already there");
    return { zone, run: { op: "move", ck: dragged.ck, path: dragged.path, to, index: null } };
  }
  const index = dropIndex(source, to, dragged.path, overPath, zone);
  if (to === from) {
    if (dragged.broken) return no("a file that does not parse has no place in the order");
    if (index == null || index === currentIndex(source, dragged.path)) return no("no change");
    return { zone, run: { op: "reorder", ck: dragged.ck, path: dragged.path, index } };
  }
  return { zone, run: { op: "move", ck: dragged.ck, path: dragged.path, to, index } };
}

/**
 * Move to's choices for row `row`: its Collection's root and folders, then the folders of other
 * Collections of the same format on this computer, each `{ label, depth, value, header?, disabled? }`,
 * `value` being `<Collection key>#<folder path>` ("" for the root). Its own folder is not offered
 * (`disabled`), and a folder's own subtree is left out. `collections`: `[{ ck, collection, machine }]` in the panel's order.
 */
export function moveTargets(row, collections) {
  const own = collections.find((c) => c.ck === row.ck);
  if (!own?.collection || row.machine != null) return [];
  const from = parentOf(row.path);
  const out = [];
  const add = (c, sameColl) => {
    // Its own folder stays in the list, greyed out, so the folders under it keep their place.
    const own = (path) => (sameColl && path === from ? { disabled: true } : {});
    out.push({ label: c.collection.name, depth: 0, value: `${c.ck}#`, header: true, ...own("") });
    const walk = (nodes, depth) => {
      for (const n of nodes ?? []) {
        if (n.kind !== "folder" || (sameColl && row.kind === "folder" && isInside(n.path, row.path))) continue;
        out.push({ label: n.name, depth, value: `${c.ck}#${n.path}`, ...own(n.path) });
        walk(n.children, depth + 1);
      }
    };
    walk(c.collection.children, 1);
  };
  add(own, true);
  for (const c of collections) {
    if (c.ck !== own.ck && c.machine == null && c.collection?.format === own.collection.format) add(c, false);
  }
  return out;
}

/** The derived file or directory name for a name, as Bruno's dialogs fill it in. */
export const derivedFile = (name) => sanitizeName(String(name ?? ""));

/**
 * The messages under a dialog's fields: `{ name?, file? }`. `kind`: "newRequest", "newFolder",
 * "clone", "rename" or "renameFile" (a file that does not parse: the file name only).
 */
export function formErrors(kind, { name = "", file = "" } = {}) {
  const out = {};
  if (kind !== "renameFile" && !String(name).trim()) out.name = "Name cannot be empty.";
  const f = String(file).trim();
  const bad = validateName(f);
  if (bad) out.file = bad;
  return out;
}

/**
 * A Draft after the file under it was written by an operation: the operation's change to the name
 * or the sequence number is made in the Draft too, so the person's edits stay and nothing else
 * changes. `rec`: `{ base, text }`; `written`: the text now on disk.
 */
export function carryDraft(rec, written, format) {
  const was = readHead(rec.base ?? "", format), now = readHead(written ?? "", format);
  let text = rec.text;
  if (now.name != null && now.name !== was.name) text = setName(text, format, now.name);
  if (now.seq != null && now.seq !== was.seq) text = setSeq(text, format, now.seq);
  return { base: written, text };
}

/**
 * The first entries of a row's menu: Open and Run, and the edit actions on this computer, as
 * `{ label, action, hint, disabled }`. `up` and `down`: whether Move up and Move down can move it.
 * `busy`: an action is running, so the edit actions are off.
 */
export function rowMenu(row, { canRun = true, up = false, down = false, busy = false } = {}) {
  if (!row) return [];
  const local = row.machine == null;
  const item = (label, action, hint = "", disabled = false) => ({ label, action, hint, disabled });
  const edit = (label, action, hint = "", disabled = false) => (local ? [item(label, action, hint, busy || disabled)] : []);
  const order = [...edit("Move to…", "moveTo", "m"), ...edit("Move up", "moveUp", "Alt+Up", !up), ...edit("Move down", "moveDown", "Alt+Down", !down)];
  if (row.kind === "request" && row.broken) {
    return [item("Open", "open", "o"), ...edit("Rename", "rename", "F2"), ...edit("Move to…", "moveTo", "m"), ...edit("Delete", "delete", "Del")];
  }
  if (row.kind === "request") {
    return [item("Open", "open", "o"), item("Run", "run", "Enter", !canRun), ...edit("Clone", "clone"), ...edit("Rename", "rename", "F2"), ...order, ...edit("Delete", "delete", "Del")];
  }
  if (row.kind === "folder") {
    return [item("Run folder", "runMany", "r", !canRun), ...edit("New Request", "newRequest", "n"), ...edit("New folder", "newFolder", "Shift+N"),
      ...edit("Rename", "rename", "F2"), ...order, ...edit("Delete", "delete", "Del")];
  }
  if (row.kind === "collection") return [item("Run Collection", "runMany", "r", !canRun), ...edit("New Request", "newRequest", "n"), ...edit("New folder", "newFolder", "Shift+N")];
  return [];
}
