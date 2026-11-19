// Line-level tools for one YAML block, on arrays of line texts (no line endings). A block map is
// read as its entries' line ranges, so an edit replaces, inserts or removes one entry's lines and
// leaves every other line as it was. List items are edited as block maps with the dash put back.
// Only the block shapes Bruno writes are accepted: a line that does not fit makes the reader
// return null, and the form then leaves that section to the File tab. Pure.
import { yamlScalar } from "./yamlwrite.js";

export const indent = (s) => /^ */.exec(s)[0].length;
export const blankOrComment = (s) => /^\s*(#.*)?$/.test(s);
const KEY = /^([A-Za-z_][\w-]*):(?=\s|$)/;
const DASH = /^-( |$)/;

/**
 * The entries of a block map whose keys sit at column `col`, in `b[from, to)`:
 * `[{ key, line, end, inline }]`. `end` closes the entry's value lines, trailing blank lines left
 * out. `inline` is the value text on the key's own line ("" for none). Null when a line is not a
 * plain `key:` at `col`, a key repeats, or a line sits outside every entry.
 */
export function mapEntries(b, from, to, col) {
  const out = [];
  const seen = new Set();
  let i = from;
  while (i < to) {
    const s = b[i];
    if (blankOrComment(s) && (indent(s) <= col || !s.trim())) { i++; continue; }
    if (indent(s) !== col) return null;
    const m = KEY.exec(s.slice(col));
    if (!m || seen.has(m[1])) return null;
    seen.add(m[1]);
    let end = i + 1;
    while (end < to && (!b[end].trim() || indent(b[end]) > col || (indent(b[end]) === col && DASH.test(b[end].slice(col))))) end++;
    while (end > i + 1 && !b[end - 1].trim()) end--;
    const rest = s.slice(col + m[0].length).trim();
    out.push({ key: m[1], line: i, end, inline: rest.startsWith("#") ? "" : rest });
    i = end;
  }
  return out;
}

/** The items of a block list in `b[from, to)`: `{ col, items: [{ line, end }] }`, or null. */
export function listItems(b, from, to) {
  let col = -1;
  const items = [];
  let i = from;
  while (i < to) {
    const s = b[i];
    if (blankOrComment(s) && (col < 0 || indent(s) <= col || !s.trim())) { i++; continue; }
    if (col < 0) col = indent(s);
    if (indent(s) !== col || !DASH.test(s.slice(col))) return null;
    // Comment lines after an item stay with it, so an edit elsewhere keeps them.
    let end = i + 1;
    while (end < to && (blankOrComment(b[end]) || indent(b[end]) > col)) end++;
    while (end > i + 1 && !b[end - 1].trim()) end--;
    items.push({ line: i, end });
    i = end;
  }
  return { col, items };
}

/**
 * A list item as a block map: `{ bodies, col, entries, head }`. The dash line's `- ` is replaced
 * by spaces so its first key sits at `col` with the others; `head` is the dash line when the first
 * key is on the next line. Null when the item is not a block map.
 */
export function itemMap(b, item) {
  const first = b[item.line];
  const m = /^( *-)( +)(.*)$/.exec(first);
  let bodies, col, head = null;
  if (m && m[3] && !m[3].startsWith("#")) {
    col = m[1].length + m[2].length;
    bodies = [" ".repeat(col) + m[3], ...b.slice(item.line + 1, item.end)];
  } else {
    head = first;
    bodies = b.slice(item.line + 1, item.end);
    const k = bodies.find((s) => !blankOrComment(s));
    if (!k) return null;
    col = indent(k);
  }
  const entries = mapEntries(bodies, 0, bodies.length, col);
  return entries && entries.length ? { bodies, col, entries, head, prefix: m ? first.slice(0, col) : null } : null;
}

/** The item's lines from its map form, with the dash put back. */
export function itemLines(map) {
  if (map.head !== null) return [map.head, ...map.bodies];
  const [first, ...rest] = map.bodies;
  return [map.prefix + first.slice(map.col), ...rest];
}

/** A fresh item's lines from map lines whose keys sit at `col`, the dash at `col - 2`. */
export function freshItem(bodies, col) {
  const [first, ...rest] = bodies;
  return [" ".repeat(col - 2) + "- " + first.slice(col), ...rest];
}

/** The lines of `key: value` with the key at `col`, the value as Bruno's YAML writer puts it. */
export function entryLines(col, key, value) {
  const pad = " ".repeat(col);
  if (typeof value === "number" || typeof value === "boolean") return [`${pad}${key}: ${value}`];
  return `${pad}${key}: ${yamlScalar(value, pad + "  ")}`.split("\n");
}

/** Where a missing `key` goes among `entries` in Bruno's `order`: after the last key before it. */
export function placeFor(entries, key, order, fallback) {
  const k = order.indexOf(key);
  const rank = (e) => order.indexOf(e.key);
  const before = entries.filter((e) => rank(e) >= 0 && rank(e) < k).pop();
  if (before) return before.end;
  const after = entries.find((e) => rank(e) > k);
  if (after) return after.line;
  return entries.length ? entries[entries.length - 1].end : fallback;
}

const splice = (b, at, count, add) => [...b.slice(0, at), ...add, ...b.slice(at + count)];

/**
 * `map` with the entry `key` replaced by `lines`, removed (null), or inserted in `order`.
 * Returns a new map; the input is not changed.
 */
export function setEntry(map, key, lines, order) {
  const cur = map.entries.find((e) => e.key === key);
  let bodies;
  if (cur) bodies = splice(map.bodies, cur.line, cur.end - cur.line, lines ?? []);
  else if (!lines) return map;
  else bodies = splice(map.bodies, placeFor(map.entries, key, order, map.bodies.length), 0, lines);
  const entries = mapEntries(bodies, 0, bodies.length, map.col);
  return { ...map, bodies, entries };
}

/** Sets a scalar entry when its value differs from `cur` (undefined removes it). */
export function setValue(map, key, next, cur, order) {
  const same = next === undefined ? cur === undefined : cur !== undefined && cur !== null && typeof cur !== "object" && String(cur) === String(next);
  if (same) return map;
  return setEntry(map, key, next === undefined ? null : entryLines(map.col, key, next), order);
}

/** Sets `disabled: true` for a row that is off, and removes it from a row that is on. */
export function setDisabled(map, enabled, cur, order) {
  if (enabled && cur === true) return setEntry(map, "disabled", null, order);
  if (!enabled && cur !== true) return setEntry(map, "disabled", entryLines(map.col, "disabled", true), order);
  return map;
}

/** The nested block map under `key` (`key:` then deeper lines), or null when it is not one. */
export function nestedMap(map, key) {
  const e = map.entries.find((x) => x.key === key);
  if (!e || e.inline) return null;
  const bodies = map.bodies.slice(e.line + 1, e.end);
  const k = bodies.find((s) => !blankOrComment(s));
  if (!k) return null;
  const col = indent(k);
  const entries = mapEntries(bodies, 0, bodies.length, col);
  return entries && col > map.col ? { bodies, col, entries, head: null, prefix: null } : null;
}

/** `map` with the nested block under `key` replaced by `inner`. */
export function putNested(map, key, inner) {
  const e = map.entries.find((x) => x.key === key);
  const bodies = splice(map.bodies, e.line + 1, e.end - e.line - 1, inner.bodies);
  return { ...map, bodies, entries: mapEntries(bodies, 0, bodies.length, map.col) };
}

/** True when two plain values (strings, numbers, booleans, arrays, objects) are the same. */
export function sameData(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameData(a[k], b[k]));
}
