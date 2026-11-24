// File operations on a Collection, by Bruno desktop's on-disk rules. Each takes the parsed
// Collection and the current texts of the files it touches and returns effects for a boundary to
// perform; it never touches the disk. `needs` names the texts an operation must be given. Pure.
//
// Effects: { op: "write", path, text, expected } (expected null creates, failing if the file
// exists), { op: "mkdir", path, existsOk? }, { op: "move", from, to }, { op: "trash", path }.
// Paths are absolute with forward slashes.
import { findNode } from "./parser.js";
import { sanitizeName, validateName, uniqueName, cloneName } from "./names.js";
import { newRequestText, newFolderText, ensureFolderFile, setName, setSeq } from "./edit.js";
import { EXT, relPath, parentOf, baseOf, join, stripExt, abs, folderFile, childrenOf, bruSeq, sequenceOrder, namesIn, renumber, seqWrite, Missing } from "./collpaths.js";
import * as envops from "./envops.js";

export { sequenceOrder };
export const { newEnvironment, cloneEnvironment, renameEnvironment, deleteEnvironment } = envops;

const fail = (error) => ({ error });
const tooMany = (base) => fail(`Too many items named "${base}". Please use a different name.`);

/** Runs a planner in build mode: `{ effects, result }` or `{ error }`. */
function run(planner, args) {
  try {
    const p = planner(args, args.texts ?? {});
    return p.error ? { error: p.error } : { effects: p.effects, result: p.result };
  } catch (e) {
    if (e instanceof Missing) return { error: e.message };
    throw e;
  }
}

function folderAt(collection, dir) {
  const d = relPath(dir);
  return childrenOf(collection, d) === null ? null : d;
}

function checkName(name) {
  return String(name ?? "").trim() ? null : "Name cannot be empty.";
}

// ---- create -------------------------------------------------------------------------------

function planNewRequest({ collection, parent = "", name, method = "GET", url = "", fileName }, texts) {
  const dir = folderAt(collection, parent);
  if (dir === null) return fail(`There is no folder ${parent} in this Collection.`);
  const bad = checkName(name);
  if (bad) return fail(bad);
  const base = String(fileName ?? sanitizeName(name)).trim();
  const invalid = validateName(base);
  if (invalid) return fail(invalid);
  const file = uniqueName(namesIn(collection, dir, texts), base, EXT[collection.format]);
  if (!file) return tooMany(base);
  const path = join(dir, file);
  const seq = childrenOf(collection, dir).length + 1;
  const text = newRequestText({ format: collection.format, name: name.trim(), method, url, seq });
  return { reads: [], effects: [{ op: "write", path: abs(collection, path), text, expected: null }], result: { path, name: name.trim() } };
}

function planCloneRequest({ collection, path, name, fileName }, texts) {
  const node = findNode(collection, path);
  if (node?.kind !== "request") return fail(`There is no Request ${path} in this Collection.`);
  if (node.broken) return fail(`"${node.name}" does not parse as a Request, so it cannot be cloned.`);
  const dir = parentOf(node.path);
  const siblings = childrenOf(collection, dir);
  const newName = String(name ?? cloneName(siblings.map((n) => n.name), node.name)).trim();
  const bad = checkName(newName);
  if (bad) return fail(bad);
  const base = String(fileName ?? sanitizeName(newName)).trim();
  const invalid = validateName(base);
  if (invalid) return fail(invalid);
  const file = uniqueName(namesIn(collection, dir, texts), base, EXT[collection.format]);
  if (!file) return tooMany(base);
  const to = join(dir, file);
  const seq = siblings.filter((n) => n.kind === "request").length + 1;
  const result = { path: to, name: newName };
  if (!texts) return { reads: [node.path], effects: [], result };
  const source = texts[node.path];
  if (typeof source !== "string") throw new Missing(`Brunr needs the current text of ${node.path} for this change.`);
  const text = setSeq(setName(source, collection.format, newName), collection.format, seq);
  return { reads: [node.path], effects: [{ op: "write", path: abs(collection, to), text, expected: null }], result };
}

function planNewFolder({ collection, parent = "", name, dirName }, texts) {
  const dir = folderAt(collection, parent);
  if (dir === null) return fail(`There is no folder ${parent} in this Collection.`);
  const bad = checkName(name);
  if (bad) return fail(bad);
  const base = sanitizeName(dirName ?? name);
  const invalid = validateName(base);
  if (invalid) return fail(invalid);
  const made = uniqueName(namesIn(collection, dir, texts), base, "");
  if (!made) return tooMany(base);
  const path = join(dir, made);
  const seq = childrenOf(collection, dir).length + 1;
  const text = newFolderText({ format: collection.format, name: name.trim(), seq });
  return {
    reads: [],
    effects: [{ op: "mkdir", path: abs(collection, path) }, { op: "write", path: abs(collection, folderFile(collection.format, path)), text, expected: null }],
    result: { path, name: name.trim() },
  };
}

// ---- rename and delete ----------------------------------------------------------------------

function planRename({ collection, path, name, fileName }, texts) {
  const node = findNode(collection, path);
  if (!node) return fail(`There is no item ${path} in this Collection.`);
  if (node.broken) return planRenameFile(collection, node, fileName, texts);
  const newName = String(name ?? node.name).trim();
  const bad = checkName(newName);
  if (bad) return fail(bad);
  const dir = parentOf(node.path);
  const ext = node.kind === "folder" ? "" : EXT[collection.format];
  const current = node.kind === "folder" ? baseOf(node.path) : stripExt(baseOf(node.path));
  const wanted = fileName == null ? current : String(fileName).trim();
  if (wanted !== current) {
    const invalid = validateName(wanted);
    if (invalid) return fail(invalid);
  }
  const own = baseOf(node.path).toLowerCase();
  const taken = [...namesIn(collection, dir, texts)].filter((n) => n.toLowerCase() !== own);
  const file = wanted === current ? baseOf(node.path) : uniqueName(taken, wanted, ext);
  if (!file) return tooMany(wanted);
  const to = join(dir, file);
  const textPath = node.kind === "folder" ? folderFile(collection.format, node.path) : node.path;
  const result = { path: to, name: newName };
  if (!texts) return { reads: [textPath], effects: [], result };
  if (texts[textPath] === undefined) throw new Missing(`Brunr needs the current text of ${textPath} for this change.`);
  const before = typeof texts[textPath] === "string" ? texts[textPath] : null;
  const move = to !== node.path ? [{ op: "move", from: abs(collection, node.path), to: abs(collection, to) }] : [];
  if (node.kind === "folder") {
    const text = ensureFolderFile({ format: collection.format, dirName: baseOf(node.path), text: before, name: newName });
    const write = text !== before ? [{ op: "write", path: abs(collection, textPath), text, expected: before }] : [];
    return { reads: [textPath], effects: [...write, ...move], result };
  }
  if (before === null) throw new Missing(`Brunr needs the current text of ${node.path} for this change.`);
  const text = setName(before, collection.format, newName);
  const write = text !== before ? [{ op: "write", path: abs(collection, to), text, expected: before }] : [];
  return { reads: [textPath], effects: [...move, ...write], result };
}

/** A Request file that does not parse is renamed by its file name only. Its text is not touched. */
function planRenameFile(collection, node, fileName, texts) {
  const dir = parentOf(node.path);
  const current = stripExt(baseOf(node.path));
  const wanted = fileName == null ? current : String(fileName).trim();
  if (wanted !== current) {
    const invalid = validateName(wanted);
    if (invalid) return fail(invalid);
  }
  const own = baseOf(node.path).toLowerCase();
  const taken = [...namesIn(collection, dir, texts)].filter((n) => n.toLowerCase() !== own);
  const file = wanted === current ? baseOf(node.path) : uniqueName(taken, wanted, EXT[collection.format]);
  if (!file) return tooMany(wanted);
  const to = join(dir, file);
  const effects = to !== node.path ? [{ op: "move", from: abs(collection, node.path), to: abs(collection, to) }] : [];
  return { reads: [], effects, result: { path: to, name: file } };
}

function planDelete({ collection, path }, texts) {
  const node = findNode(collection, path);
  if (!node) return fail(`There is no item ${path} in this Collection.`);
  const dir = parentOf(node.path);
  const rest = sequenceOrder(collection, dir).filter((n) => n.path !== node.path);
  const r = renumber(collection, rest, texts);
  return { reads: r.reads, effects: [{ op: "trash", path: abs(collection, node.path) }, ...r.effects], result: { path: null, parent: dir } };
}

// ---- order and moves ------------------------------------------------------------------------

const clampIndex = (index, length) => Math.max(0, Math.min(length, Math.trunc(Number(index) || 0)));

function planReorder({ collection, path, index }, texts) {
  const node = findNode(collection, path);
  if (!node) return fail(`There is no item ${path} in this Collection.`);
  if (node.broken) return fail(`"${node.name}" does not parse as a Request, so it has no place in the order.`);
  const list = sequenceOrder(collection, parentOf(node.path)).filter((n) => n.path !== node.path);
  list.splice(clampIndex(index, list.length), 0, node);
  const r = renumber(collection, list, texts);
  return { reads: r.reads, effects: r.effects, result: { path: node.path } };
}

function isInside(folder, dir) {
  return dir === folder || dir.startsWith(`${folder}/`);
}

/**
 * A move of `path` from `source` into folder `to` of `target` (the same Collection for `move`).
 * Source siblings are renumbered; with an index the target's are too, the item placed there.
 */
function planMoveInto({ source, target, path, to, index: wanted }, texts, targetTexts) {
  const node = findNode(source, path);
  if (!node) return fail(`There is no item ${path} in this Collection.`);
  // A file that does not parse has no number, so it moves to the end of the target's items.
  const index = node.broken ? null : wanted;
  const dir = folderAt(target, to ?? "");
  if (dir === null) return fail(`There is no folder ${to} to move into.`);
  const same = source === target || source.root === target.root;
  if (same && node.kind === "folder" && isInside(node.path, dir)) return fail(`"${node.name}" cannot move into itself or one of its folders.`);
  const from = parentOf(node.path);
  if (same && from === dir) return index == null ? { reads: [], effects: [], result: { path: node.path } } : planReorder({ collection: source, path, index }, texts);
  const ext = node.kind === "folder" ? "" : EXT[source.format];
  const base = node.kind === "folder" ? baseOf(node.path) : stripExt(baseOf(node.path));
  const file = uniqueName(namesIn(target, dir, targetTexts), base, ext);
  if (!file) return tooMany(base);
  const newPath = join(dir, file);
  const src = renumber(source, sequenceOrder(source, from).filter((n) => n.path !== node.path), texts);
  const effects = [{ op: "move", from: abs(source, node.path), to: abs(target, newPath) }, ...src.effects];
  const reads = { source: src.reads, target: [] };
  if (index != null) {
    const list = sequenceOrder(target, dir).filter((n) => !same || n.path !== node.path);
    const at = clampIndex(index, list.length);
    list.splice(at, 0, { ...node, path: newPath });
    const tgt = renumber(target, list, targetTexts, newPath);
    reads.target = tgt.reads;
    if (bruSeq(node) !== at + 1) {
      const fromFile = node.kind === "folder" ? folderFile(source.format, node.path) : node.path;
      reads.source.push(fromFile);
      const toFile = node.kind === "folder" ? folderFile(target.format, newPath) : newPath;
      if (texts) effects.push(seqWrite(target, { ...node, path: newPath }, texts[fromFile], abs(target, toFile), at + 1));
    }
    effects.push(...tgt.effects);
  }
  return { reads, effects, result: { path: newPath } };
}

function planMove({ collection, path, to = "", index = null }, texts) {
  const p = planMoveInto({ source: collection, target: collection, path, to, index }, texts, texts);
  if (p.error || Array.isArray(p.reads)) return p;
  return { ...p, reads: [...p.reads.source, ...p.reads.target] };
}

function planMoveBetween({ collection, target, path, to = "", index = null }, texts, targetTexts) {
  if (!target) return fail("There is no Collection to move into.");
  if (target.root === collection.root) return planMove({ collection, path, to, index }, texts);
  if (target.format !== collection.format) {
    return fail(`Brunr moves items only between Collections of the same format. "${collection.name}" is ${collection.format === "yaml" ? "YAML" : "bru"} and "${target.name}" is ${target.format === "yaml" ? "YAML" : "bru"}.`);
  }
  return planMoveInto({ source: collection, target, path, to, index }, texts, targetTexts);
}

// ---- the public operations ----------------------------------------------------------------

/** A new HTTP Request in folder `parent` ("" for the root). `{ effects, result: { path, name } }` or `{ error }`. */
export const newRequest = (args) => run(planNewRequest, args);
/** A copy of Request `path` beside it, named `<name> copy` unless `name` is given. */
export const cloneRequest = (args) => run(planCloneRequest, args);
/** A new folder with its folder file in `parent`. */
export const newFolder = (args) => run(planNewFolder, args);
/** Renames Request or folder `path`: the name inside its file, and the file or directory name when `fileName` is given. */
export const renameItem = (args) => run(planRename, args);
/** Moves `path` to the trash and renumbers the remaining siblings. */
export const deleteItem = (args) => run(planDelete, args);
/** Moves `path` to `index` (0-based) in its folder's sequenceOrder and renumbers the siblings. */
export const reorder = (args) => run(planReorder, args);
/** Moves `path` into folder `to` ("" for the root); with `index`, to that place among the target's items. */
export const move = (args) => run(planMove, args);

/** Moves `path` into folder `to` of Collection `target` of the same format. `targetTexts` holds the target's texts. */
export function moveBetween(args) {
  try {
    const p = planMoveBetween(args, args.texts ?? {}, args.targetTexts ?? {});
    return p.error ? { error: p.error } : { effects: p.effects, result: p.result };
  } catch (e) {
    if (e instanceof Missing) return { error: e.message };
    throw e;
  }
}

const PLANNERS = {
  newRequest: planNewRequest, cloneRequest: planCloneRequest, newFolder: planNewFolder, renameItem: planRename,
  deleteItem: planDelete, reorder: planReorder, move: planMove,
  newEnvironment: envops.planNewEnvironment, cloneEnvironment: envops.planCloneEnvironment,
  renameEnvironment: envops.planRenameEnvironment, deleteEnvironment: envops.planDeleteEnvironment,
};

/**
 * The relative paths in `collection` whose current text `operation` must be given:
 * `operation` is `{ op: "<operation name>", ...the operation's arguments without collection and texts }`.
 * For moveBetween, `operation.target` is the target Collection and `collection` the source; add
 * `side: "target"` to get the target's paths (for `targetTexts`) instead of the source's.
 */
export function needs(operation, collection) {
  const { op, side, ...args } = operation ?? {};
  if (op === "moveBetween") {
    const p = planMoveBetween({ ...args, collection }, null, null);
    if (p.error) return [];
    const reads = Array.isArray(p.reads) ? { source: p.reads, target: [] } : p.reads;
    return unique(side === "target" ? reads.target : reads.source);
  }
  const planner = PLANNERS[op];
  if (!planner) return [];
  const p = planner({ ...args, collection }, null);
  return p.error ? [] : unique(p.reads);
}

const unique = (list) => [...new Set(list)];
