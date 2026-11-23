// The form's sections of a YAML Request: finding one (`http.headers`, `runtime.scripts`, `docs`),
// replacing it, creating it where Bruno's key order puts it, and removing it with its parent
// block when that is left empty. A section's lines are handed to the tabs "relative": the
// section's key at column 0. Every line outside the section keeps its bytes, including CRLF
// endings and a missing final newline. Pure.
import { splitLines, joinLines, eolOf, replaceLines, insertLines } from "./lines.js";
import { mapEntries, listItems, itemMap, itemLines, freshItem, placeFor, indent, blankOrComment } from "./yamlblock.js";
import { parseYaml } from "./yaml.js";

export const TOP_ORDER = ["info", "http", "runtime", "settings", "examples", "docs"];
export const CHILD_ORDER = {
  http: ["method", "url", "headers", "params", "body", "auth"],
  runtime: ["variables", "scripts", "assertions", "actions"],
};

/** The text's lines and its top-level entries; `top` is null when the top level is not a block map. */
export function layout(text) {
  const lines = splitLines(text);
  const b = lines.map((l) => l.body);
  if (b.length) b[0] = b[0].replace(/^﻿/, "");
  return { text: String(text ?? ""), lines, b, eol: eolOf(text), top: mapEntries(b, 0, b.length, 0) };
}

/**
 * A top-level block's child entries: `{ entry, col, kids }`; `{ entry: null }` when the block is
 * missing; null when it cannot be read. `{}` on the key's line reads as an empty block.
 */
export function block(L, key) {
  if (!L.top) return null;
  const entry = L.top.find((e) => e.key === key);
  if (!entry) return { entry: null, col: 2, kids: [] };
  if (entry.inline) return entry.inline === "{}" && entry.end === entry.line + 1 ? { entry, col: 2, kids: [], empty: true } : null;
  const first = L.b.slice(entry.line + 1, entry.end).find((s) => !blankOrComment(s));
  const col = first ? indent(first) : 2;
  const kids = mapEntries(L.b, entry.line + 1, entry.end, col);
  return kids && col > 0 ? { entry, col, kids } : null;
}

const rel = (L, e, col) => L.b.slice(e.line, e.end).map((s) => s.slice(Math.min(col, indent(s))));

/** A child section's relative lines, null when it is missing, or false when it cannot be read. */
export function childLines(L, parent, key) {
  const p = block(L, parent);
  if (!p) return false;
  const e = p.kids.find((k) => k.key === key);
  return e ? rel(L, e, p.col) : null;
}

/** A top-level entry's lines, null when it is missing, or false when the top level is unreadable. */
export function topLines(L, key) {
  if (!L.top) return false;
  const e = L.top.find((x) => x.key === key);
  return e ? rel(L, e, 0) : null;
}

/** The parsed value of relative section lines. Throws on text the reader cannot read. */
export const sectionValue = (r, key) => parseYaml(r.join("\n"))?.[key];

const done = (L, lines) => joinLines(lines);

/** Removes a top-level entry with the blank line before it (or after it, for the first). */
function removeTop(L, e) {
  let from = e.line, to = e.end;
  if (from > 0 && !L.b[from - 1].trim()) from--;
  else if (to < L.b.length && !L.b[to].trim()) to++;
  return done(L, replaceLines(L.lines, from, to - from, [], L.eol));
}

/** Inserts a new top-level entry in Bruno's order, with the blank line Bruno puts before it. */
function insertTop(L, key, lines) {
  const k = TOP_ORDER.indexOf(key);
  const rank = (e) => TOP_ORDER.indexOf(e.key);
  const before = L.top.filter((e) => rank(e) >= 0 && rank(e) < k).pop();
  const after = L.top.find((e) => rank(e) > k);
  if (!before && after) return done(L, insertLines(L.lines, after.line, [...lines, ""], L.eol));
  const at = before ? before.end : L.lines.length;
  const add = at < L.b.length && L.b[at].trim() ? ["", ...lines, ""] : ["", ...lines];
  return done(L, insertLines(L.lines, at, at === 0 ? lines : add, L.eol));
}

/** The text with the top-level entry `key` replaced by `lines` (relative), created, or removed (null). */
export function putTop(L, key, lines) {
  const e = L.top.find((x) => x.key === key);
  if (e) return lines ? done(L, replaceLines(L.lines, e.line, e.end - e.line, lines, L.eol)) : removeTop(L, e);
  return lines ? insertTop(L, key, lines) : L.text;
}

/**
 * The text with the child section `parent.key` replaced by `lines` (relative), created with its
 * parent block when needed, or removed (null) together with a parent block left empty.
 */
export function putChild(L, parent, key, lines) {
  const p = block(L, parent);
  if (!p) throw new Error(`the ${parent} block cannot be read`);
  const pad = " ".repeat(p.col);
  const rows = lines && lines.map((s) => (s ? pad + s : s));
  if (!p.entry) return rows ? insertTop(L, parent, [`${parent}:`, ...rows]) : L.text;
  if (p.empty) return rows ? done(L, replaceLines(L.lines, p.entry.line, 1, [`${parent}:`, ...rows], L.eol)) : L.text;
  const cur = p.kids.find((k) => k.key === key);
  if (cur && rows) return done(L, replaceLines(L.lines, cur.line, cur.end - cur.line, rows, L.eol));
  if (cur) return p.kids.length === 1 ? removeTop(L, p.entry) : done(L, replaceLines(L.lines, cur.line, cur.end - cur.line, [], L.eol));
  if (!rows) return L.text;
  return done(L, insertLines(L.lines, placeFor(p.kids, key, CHILD_ORDER[parent] ?? [], p.entry.end), rows, L.eol));
}

// ---- lists of rows ------------------------------------------------------------------------------

/**
 * A list section's rows: `{ itemCol, items: [{ map, obj }] }` where `map` is the item as a block
 * map and `obj` its parsed value. An empty list for a missing section or `key: []`. Null when the
 * list or one of its items is not in block form.
 */
export function readList(r, key) {
  if (!r) return { itemCol: 2, items: [] };
  const head = mapEntries(r, 0, 1, 0)?.[0];
  if (!head) return null;
  if (head.inline) return head.inline === "[]" && r.length === 1 ? { itemCol: 2, items: [], inline: true } : null;
  const value = sectionValue(r, key);
  if (value === null || value === undefined) return r.slice(1).every(blankOrComment) ? { itemCol: 2, items: [] } : null;
  const list = listItems(r, 1, r.length);
  if (!Array.isArray(value) || !list || list.items.length !== value.length) return null;
  const items = [];
  for (let i = 0; i < value.length; i++) {
    const map = itemMap(r, list.items[i]);
    const obj = value[i];
    if (!map || !obj || typeof obj !== "object" || Array.isArray(obj) || map.entries.length !== Object.keys(obj).length) return null;
    items.push({ map, obj });
  }
  // Comment lines between the key and the first row stay above the rows.
  const lead = list.items.length ? r.slice(1, list.items[0].line) : [];
  return { itemCol: list.items.length ? list.col : 2, items, lead };
}

/** Longest common subsequence of two name lists: pairs `[oldIndex, newIndex]`. */
function lcs(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++;
  }
  return pairs;
}

/**
 * Which old row each new row continues (its index, or -1), so a row keeps its other keys, such as
 * a description, through an edit: rows with the same name in order, then the same name anywhere,
 * then a renamed row where one old row and one new row sit alone between two kept ones.
 */
export function matchRows(oldNames, newNames) {
  const match = new Array(newNames.length).fill(-1);
  const used = new Set();
  const pairs = lcs(oldNames, newNames);
  for (const [i, j] of pairs) { match[j] = i; used.add(i); }
  newNames.forEach((n, j) => {
    if (match[j] >= 0) return;
    const i = oldNames.findIndex((m, k) => m === n && !used.has(k));
    if (i >= 0) { match[j] = i; used.add(i); }
  });
  const anchors = [[-1, -1], ...pairs, [oldNames.length, newNames.length]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const olds = [], news = [];
    for (let i = anchors[k][0] + 1; i < anchors[k + 1][0]; i++) if (!used.has(i)) olds.push(i);
    for (let j = anchors[k][1] + 1; j < anchors[k + 1][1]; j++) if (match[j] < 0) news.push(j);
    if (olds.length === news.length) news.forEach((j, x) => { match[j] = olds[x]; used.add(olds[x]); });
  }
  return match;
}

/**
 * The list section's new relative lines, or null for no rows. `spec.name(row)` and
 * `spec.oldName(obj)` give the names rows are matched by; `spec.same(obj, row)` says an old row
 * needs no change; `spec.edit(map, obj, row)` edits a kept row in place; `spec.fresh(row, col)`
 * gives a new row's map lines with keys at `col`.
 */
export function writeList(r, key, list, rows, spec) {
  if (!rows.length) return null;
  const match = matchRows(list.items.map((it) => spec.oldName(it.obj)), rows.map(spec.name));
  const col = list.itemCol;
  const out = rows.flatMap((row, j) => {
    const old = match[j] >= 0 ? list.items[match[j]] : null;
    if (!old) return freshItem(spec.fresh(row, col + 2), col + 2);
    return itemLines(spec.same(old.obj, row) ? old.map : spec.edit(old.map, old.obj, row));
  });
  const head = r && !list.inline ? [r[0], ...(list.lead ?? [])] : [`${key}:`];
  return [...head, ...out];
}
