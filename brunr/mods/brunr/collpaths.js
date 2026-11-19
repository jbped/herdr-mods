// Paths, sibling lists and sequence numbers of a parsed Collection, shared by the file operations.
// Pure.
import { findNode, sortByNameThenSequence, requestSeq } from "./parser.js";
import { setSeq, ensureFolderFile } from "./edit.js";

export const EXT = { yaml: ".yml", bru: ".bru" };
const CONFIG = { yaml: "opencollection.yml", bru: "bruno.json" };

export const slash = (p) => String(p ?? "").replace(/\\/g, "/");
export const relPath = (p) => slash(p).replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
export const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
export const join = (dir, name) => (dir ? `${dir}/${name}` : name);
export const stripExt = (name) => name.replace(/\.[^.]+$/, "");

/** The absolute path of `rel` in a Collection, with forward slashes. */
export function abs(collection, rel) {
  const root = slash(collection.root);
  return root.endsWith("/") ? root + rel : `${root}/${rel}`;
}

export const folderFile = (format, dir) => join(dir, `folder${EXT[format]}`);

/**
 * The child nodes of a folder path, or of the Collection for "". null when there is no such folder.
 * A Request file that does not parse is left out: Bruno neither counts nor numbers it.
 */
export function childrenOf(collection, dir) {
  const list = !dir ? collection.children ?? [] : findNode(collection, dir)?.kind === "folder" ? findNode(collection, dir).children : null;
  return list && list.filter((n) => !n.broken);
}

/** A node's seq as Bruno holds it: a Request without one is 1, a folder without one has none. */
export const bruSeq = (n) => (n.kind === "folder" ? n.seq : requestSeq(n));

/** A folder's items in Bruno's numbering order: one list for folders and Requests (resetSequencesInFolder). */
export function sequenceOrder(collection, dir) {
  return sortByNameThenSequence(childrenOf(collection, relPath(dir)) ?? [], bruSeq);
}

/**
 * The file and directory names known in `dir`, for the clash rule: the tree, files with errors,
 * Environments, texts given, and the names Bruno reserves (config, folder file, environments).
 */
export function namesIn(collection, dir, texts = {}) {
  const names = new Set();
  const prefix = dir ? `${dir}/` : "";
  const add = (p) => {
    if (!p || (prefix && !p.startsWith(prefix))) return;
    names.add(p.slice(prefix.length).split("/")[0]);
  };
  const walk = (nodes) => (nodes ?? []).forEach((n) => { add(n.path); if (n.kind === "folder") walk(n.children); });
  walk(collection.children);
  for (const e of collection.errors ?? []) add(relPath(e.path));
  for (const e of collection.environments ?? []) add(e.path);
  for (const p of Object.keys(texts ?? {})) add(relPath(p));
  names.add(`folder${EXT[collection.format]}`);
  if (!dir) {
    names.add(CONFIG[collection.format]);
    names.add("environments");
    if (collection.format === "bru") names.add("collection.bru");
  }
  return names;
}

/** The text path that holds a node's name and seq: the Request file, or the folder file. */
export const seqPath = (format, node) => (node.kind === "folder" ? folderFile(format, node.path) : node.path);

export class Missing extends Error {}

/**
 * Effects that number `ordered` 1 to n, writing only items whose number changes, and the paths
 * whose text they need. With `texts` null only the paths are worked out. `except` is a path the
 * caller numbers itself (a moved item).
 */
export function renumber(collection, ordered, texts, except = null) {
  const reads = [];
  const effects = [];
  ordered.forEach((node, i) => {
    if (node.path === except || bruSeq(node) === i + 1) return;
    const path = seqPath(collection.format, node);
    reads.push(path);
    if (texts) effects.push(seqWrite(collection, node, texts[path], abs(collection, path), i + 1));
  });
  return { reads, effects };
}

/** A write that sets `seq` in a node's file, creating a missing folder file as Bruno does. */
export function seqWrite(collection, node, text, path, seq) {
  if (node.kind === "folder") {
    // null: the folder has no folder file. undefined: the boundary did not give the text.
    if (text === undefined) throw new Missing(`Brunr needs the current text of ${folderFile(collection.format, node.path)} for this change.`);
    const before = typeof text === "string" ? text : null;
    return { op: "write", path, text: ensureFolderFile({ format: collection.format, dirName: baseOf(node.path), text: before, seq }), expected: before };
  }
  if (typeof text !== "string") throw new Missing(`Brunr needs the current text of ${node.path} for this change.`);
  return { op: "write", path, text: setSeq(text, collection.format, seq), expected: text };
}
