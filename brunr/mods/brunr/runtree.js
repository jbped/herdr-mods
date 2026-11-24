// @ts-nocheck
// The Response pane's list of a Run's Requests, grouped under the folders they belong to, as the
// panel shows them. Pure: no Herdr, no drawing. The live list and the final result use the same
// rows, so the list does not jump when the Run ends.
import { noExt } from "./progress.js";

const dirName = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const tidy = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");

/** The folder under which a Run's Requests start at depth 0. The target itself gets no row. */
function baseOf(target) {
  const kind = target?.kind === "folder" || target?.kind === "request" ? target.kind : "collection";
  if (kind === "collection") return "";
  const path = tidy(target.path);
  return kind === "folder" ? path : dirName(path);
}

/** Folder names by directory path, and each Request's path without extension, from the Collection tree. */
function index(collection) {
  const folders = new Map();
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.kind === "folder") { folders.set(n.path, n.name || baseName(n.path)); walk(n.children); }
    }
  };
  walk(collection?.children);
  return folders;
}

/**
 * The folder paths a Request sits under, outermost first, below `base`. A Request missing from the
 * tree is placed by the directories in its path. Paths match without their extension.
 */
function chainOf(path, base) {
  const dirs = [];
  for (let d = dirName(noExt(tidy(path))); d; d = dirName(d)) dirs.unshift(d);
  return dirs.filter((d) => d !== base && !base.startsWith(`${d}/`));
}

/**
 * The folder paths that hold a Request in a Run, outermost first: the folders a fold must not hide
 * when that Request is shown.
 */
export function foldersOf({ target = null, path }) {
  return chainOf(String(path ?? ""), baseOf(target));
}

/** `folded` without the folders that hold any of `paths`, so those Requests show. A new Set. */
export function unfoldFor({ target = null, folded = new Set(), paths = [] }) {
  const out = new Set(folded);
  for (const p of paths) for (const d of foldersOf({ target, path: p })) out.delete(d);
  return out;
}

/**
 * The rows of a Run's list, top to bottom.
 * `collection`: the parsed Collection. `target`: `{ kind: "collection" }` or `{ kind, path }`.
 * `entries`: the Requests to show, in Run order: `{ path, name, method, status, ok, running? }`.
 * `planned`: the Request nodes the Run is expected to send, or null once it ended. `folded`: a Set
 * of folded folder paths. `counts`: optional folder counts by path, `{ passed, total, failed }`,
 * that replace the counts of the listed entries (filterRun gives the whole Run's, so a filter never
 * changes a count).
 * A folder row: `{ kind: "folder", key, path, name, depth, passed, total, failed, running, folded }`.
 * A Request row: `{ kind: "request", key, index, depth, entry }`, `index` being the entry's place.
 * A folder row stands before its first Request. When one folder's Requests are not consecutive,
 * the folder gets a new row each time it starts again, so no Request shows under the wrong folder.
 */
export function runRows({ collection = null, target = null, entries = [], planned = null, folded = new Set(), counts = null }) {
  const names = index(collection);
  const base = baseOf(target);
  const plannedUnder = new Map();
  for (const n of planned ?? []) for (const d of chainOf(n.path, base)) plannedUnder.set(d, (plannedUnder.get(d) ?? 0) + 1);

  const all = [];
  let open = [];             // the folder rows that hold the Request just placed, outermost first
  const seen = new Map();    // folder path -> rows started for it, for unique keys
  (entries ?? []).forEach((entry, i) => {
    const chain = chainOf(entry.path, base);
    let keep = 0;
    while (keep < open.length && keep < chain.length && open[keep].path === chain[keep]) keep++;
    open = open.slice(0, keep);
    for (let at = keep; at < chain.length; at++) {
      const path = chain[at];
      const n = (seen.get(path) ?? 0) + 1;
      seen.set(path, n);
      const row = { kind: "folder", key: `f:${path}:${n}`, path, name: names.get(path) ?? baseName(path), depth: at, passed: 0, listed: 0, failed: false, running: false };
      all.push(row);
      open.push(row);
    }
    for (const f of open) {
      f.listed++;
      if (entry.running) f.running = true;
      else if (entry.ok) f.passed++;
      else f.failed = true;
    }
    all.push({ kind: "request", key: `r:${i}`, index: i, depth: chain.length, entry });
  });

  const rows = [];
  let hideBelow = Infinity;  // rows deeper than this sit in a folded folder
  for (const r of all) {
    if (r.depth > hideBelow) continue;
    hideBelow = Infinity;
    if (r.kind === "request") { rows.push(r); continue; }
    const isFolded = folded?.has?.(r.path) ?? false;
    if (isFolded) hideBelow = r.depth;
    const { listed, ...rest } = r;
    const given = counts?.get?.(r.path);
    if (given) rows.push({ ...rest, passed: given.passed, total: given.total, failed: given.failed, folded: isFolded });
    else rows.push({ ...rest, total: Math.max(listed, planned ? plannedUnder.get(r.path) ?? 0 : 0), folded: isFolded });
  }
  return rows;
}
