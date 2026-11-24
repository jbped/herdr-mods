// The URL bar's edit: the url line, then the params block rewritten to match the URL, as Bruno's
// `requestUrlChanged` does. Every byte outside the url line and the params block is unchanged.
// Editing the url line in the text does not come here: only the URL bar does. Pure.
//
// Bruno's rule (bruno-app slices/collections requestUrlChanged, bruno-common parseQueryParams,
// bruno-app utils/url parsePathParams and splitOnFirst):
// - The URL splits at its first `?` outside `{{ }}`. Query params are its `&` pairs, before any `#`,
//   split at the first `=`, not decoded. Path params are `:name` segments of the part before `?`,
//   and `:name` inside an OData segment such as `Items(id=:id)`.
// - The new list: the URL's query params (enabled, without descriptions), then path params that
//   are new, then the disabled query params as they were, then the enabled path params the URL
//   still has, as they were. Disabled path params go.
import { splitLines, joinLines, eolOf, replaceLines, insertLines, indentOf } from "./lines.js";
import { parseYaml } from "./yaml.js";
import { yamlScalar } from "./yamlwrite.js";
import { setUrl, canSetUrl, yamlSection, yamlChild, childIndent, yamlType, bruBlocks, bruMeta, bruMethodBlock } from "./edit.js";

/** Bruno's splitOnFirst: `[before, after]` at the first `char` outside `{{ }}`, or `[str]`. */
export function splitOnFirst(str, char) {
  if (!str) return [str];
  const masked = str.replace(/\{\{.*?\}\}/g, (m) => "_".repeat(m.length));
  const at = masked.indexOf(char);
  return at < 0 ? [str] : [str.slice(0, at), str.slice(at + 1)];
}

/** Bruno's parseQueryParams: `[{ name, value }]`, value undefined for `?flag`. Not decoded. */
export function parseQueryParams(query) {
  if (!query) return [];
  return query.split("#")[0].split("&").map((pair) => {
    const [name, ...rest] = pair.split("=");
    return name ? { name, value: pair.includes("=") ? rest.join("=") : undefined } : null;
  }).filter(Boolean);
}

/** Bruno's parsePathParams: the names of `:name` path segments, and of `:name` in OData segments. */
export function parsePathParams(url) {
  let uri = String(url ?? "");
  if (!uri) return [];
  if (!uri.startsWith("http://") && !uri.startsWith("https://")) uri = `http://${uri}`;
  let paths;
  try {
    if (typeof URL !== "function") throw new Error("no URL");
    paths = new URL(uri).pathname.split("/");
  } catch {
    paths = uri.split("/");
  }
  const found = [];
  const add = (name) => { if (name && !found.includes(name)) found.push(name); };
  for (const seg of paths) {
    if (seg.startsWith(":")) { add(seg.slice(1)); continue; }
    if (!/^[A-Za-z0-9_.-]+\([^)]*\)$/.test(seg)) continue;
    for (const m of seg.matchAll(/[:]([a-zA-Z_]\w*)/g)) add(m[1].replace(/[')"`]+$/, "").replace(/^[('"`]+/, ""));
  }
  return found;
}

/**
 * The params after the URL bar changed the URL. `old`: `[{ name, value, type, enabled, ... }]` as
 * the file holds them. A kept param is the same object as in `old`; a new one is
 * `{ name, value, type, enabled: true }`.
 */
export function paramsForUrl(old, url) {
  const [base, query] = splitOnFirst(String(url ?? ""), "?");
  const urlQuery = parseQueryParams(query).map((p) => ({ name: p.name, value: p.value, type: "query", enabled: true }));
  const urlPath = parsePathParams(base ?? "");
  const disabledQuery = old.filter((p) => !p.enabled && p.type === "query");
  const oldPath = old.filter((p) => p.enabled && p.type === "path");
  const newPath = urlPath.filter((n) => !oldPath.some((p) => p.name === n)).map((name) => ({ name, value: "", type: "path", enabled: true }));
  return [...urlQuery, ...newPath, ...disabledQuery, ...oldPath.filter((p) => urlPath.includes(p.name))];
}

const same = (a, b) => a.length === b.length && a.every((p, i) => p === b[i] || (p.name === b[i].name && (p.value ?? "") === (b[i].value ?? "")
  && p.type === b[i].type && p.enabled === b[i].enabled && !p.description && !b[i].description));

/**
 * The URL bar's change: `setUrl`, then the params block rewritten to Bruno's list for the new URL.
 * A file whose params block cannot be read keeps it as it is.
 */
export function setUrlFromBar(text, format, url) {
  if (!canSetUrl(text, format)) return String(text ?? "");
  const next = setUrl(text, format, url);
  try {
    return format === "yaml" ? yamlSync(next, url) : bruSync(next, url);
  } catch {
    return next;
  }
}

// ---- YAML ---------------------------------------------------------------------------------

/** The `params:` child of the method section: its lines, list items with their lines, and the values. */
function yamlParams(lines, sec) {
  const ci = childIndent(lines, sec);
  const re = /^params:(\s|$)/;
  for (let i = sec.start; i < sec.end; i++) {
    const body = lines[i].body;
    if (indentOf(body) !== ci || !re.test(body.slice(ci))) continue;
    let end = i + 1;
    // A compact list (`- ` at the key's own column) belongs to the key too.
    while (end < sec.end && (!lines[end].body.trim() || indentOf(lines[end].body) > ci || lines[end].body.slice(ci).startsWith("- "))) end++;
    while (end > i + 1 && !lines[end - 1].body.trim()) end--;
    const doc = parseYaml(lines.slice(i, end).map((l) => l.body.slice(ci)).join("\n"));
    const list = Array.isArray(doc?.params) ? doc.params : [];
    const starts = [];
    for (let j = i + 1; j < end; j++) if (/^\s*- /.test(lines[j].body) || /^\s*-$/.test(lines[j].body)) starts.push(j);
    const itemIndent = starts.length ? indentOf(lines[starts[0]].body) : ci + 2;
    const items = list.map((p, k) => ({
      name: String(p?.name ?? ""), value: p?.value == null ? "" : String(p.value), type: p?.type === "path" ? "path" : "query",
      enabled: p?.disabled !== true, description: p?.description ?? null,
      raw: starts.length === list.length ? lines.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : end).map((l) => l.body) : null,
    }));
    return { line: i, end, ci, itemIndent, items };
  }
  return null;
}

function yamlItem(p, pad) {
  if (p.raw) return p.raw;
  const v = " ".repeat(pad + 4);
  const key = " ".repeat(pad + 2);
  const out = [`${" ".repeat(pad)}- name: ${yamlScalar(p.name, v)}`, `${key}value: ${yamlScalar(p.value ?? "", v)}`, `${key}type: ${p.type}`];
  if (typeof p.description === "string" && p.description.trim()) out.push(`${key}description: ${yamlScalar(p.description, v)}`);
  if (!p.enabled) out.push(`${key}disabled: true`);
  return out.flatMap((l) => l.split("\n"));
}

function yamlSync(text, url) {
  const lines = splitLines(text);
  const eol = eolOf(text);
  const type = yamlType(lines);
  if (type !== "http" && type !== "graphql") return text;
  const sec = yamlSection(lines, type);
  if (!sec) return text;
  const block = yamlParams(lines, sec);
  const old = block?.items ?? [];
  const next = paramsForUrl(old, url);
  if (same(next, old)) return text;
  if (!next.length) return block ? joinLines(replaceLines(lines, block.line, block.end - block.line, [], eol)) : text;
  const ci = block?.ci ?? childIndent(lines, sec);
  const body = [`${" ".repeat(ci)}params:`, ...next.flatMap((p) => yamlItem(p, block?.itemIndent ?? ci + 2))];
  if (block) return joinLines(replaceLines(lines, block.line, block.end - block.line, body, eol));
  // Bruno writes params after the headers, which follow the url.
  const anchor = yamlChild(lines, sec, "headers") ?? yamlChild(lines, sec, "url");
  return joinLines(insertLines(lines, anchor ? anchor.end : sec.end, body, eol));
}

// ---- bru ----------------------------------------------------------------------------------

const keyString = (k) => ([":", '"', "{", "}", " "].some((c) => k.includes(c)) ? `"${k.replaceAll('"', '\\"')}"` : k);

/**
 * The entries of a params block: `{ name, value, enabled, description, raw }`, `raw` being its
 * lines with the annotations above it. A `'''` value runs to its closing line.
 */
function bruEntries(lines, block, type) {
  const out = [];
  let notes = [];
  for (let i = block.open + 1; i < block.close; i++) {
    const body = lines[i].body;
    const t = body.trim();
    if (!t) continue;
    if (t.startsWith("@")) { notes.push(body); continue; }
    const m = /^(~?)("(?:[^"\\]|\\.)*"|[^:]+?)\s*:\s?(.*)$/.exec(t);
    if (!m) throw new Error(`cannot read line ${i + 1}`);
    const raw = [...notes, body];
    let value = m[3].trim();
    if (value === "'''") {
      const start = i + 1;
      while (i + 1 < block.close && lines[i + 1].body.trim() !== "'''") raw.push(lines[++i].body);
      if (i + 1 < block.close) raw.push(lines[++i].body);
      value = lines.slice(start, i).map((l) => l.body.replace(/^ {4}/, "")).join("\n");
    }
    const name = m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2].trim();
    out.push({ name, value, type, enabled: m[1] !== "~", description: notes.length ? notes.join("\n") : null, raw });
    notes = [];
  }
  return out;
}

function bruSync(text, url) {
  let lines = splitLines(text);
  const eol = eolOf(text);
  const { type } = bruMeta(lines);
  const mb = bruMethodBlock(lines, type);
  if (!mb || (type !== "http" && type !== "graphql")) return text;
  const find = (name) => bruBlocks(lines).find((b) => b.name === name && b.open !== b.close) ?? null;
  const q = find("params:query"), pb = find("params:path");
  const old = [...(q ? bruEntries(lines, q, "query") : []), ...(pb ? bruEntries(lines, pb, "path") : [])];
  const next = paramsForUrl(old, url);
  if (same(next, old)) return text;
  const query = next.filter((p) => p.type === "query");
  const queryBody = [...query.filter((p) => p.enabled), ...query.filter((p) => !p.enabled)]
    .flatMap((p) => p.raw ?? [`  ${keyString(p.name)}: ${p.value ?? ""}`]);
  const pathBody = next.filter((p) => p.type === "path").flatMap((p) => p.raw ?? [`  ${p.name}: ${p.value ?? ""}`]);
  // The path block first, so the query block's line numbers still hold.
  lines = writeBlock(lines, eol, "params:path", pathBody, ["params:query", mb.block.name]);
  lines = writeBlock(lines, eol, "params:query", queryBody, [mb.block.name]);
  return joinLines(lines);
}

/** Replaces, removes (no body) or adds a block after the first of `after` that exists, with its blank line. */
function writeBlock(lines, eol, name, body, after) {
  const blocks = bruBlocks(lines);
  const cur = blocks.find((b) => b.name === name && b.open !== b.close);
  const full = body.length ? [`${name} {`, ...body, "}"] : [];
  if (cur) {
    if (full.length) return replaceLines(lines, cur.open, cur.close - cur.open + 1, full, eol);
    const blank = cur.close + 1 < lines.length && !lines[cur.close + 1].body.trim() ? 1 : 0;
    return replaceLines(lines, cur.open, cur.close - cur.open + 1 + blank, [], eol);
  }
  if (!full.length) return lines;
  const anchor = after.map((n) => blocks.find((b) => b.name === n)).find(Boolean);
  const at = anchor ? anchor.close + 1 : lines.length;
  if (at < lines.length && !lines[at].body.trim()) return insertLines(lines, at + 1, [...full, ""], eol);
  return insertLines(lines, at, ["", ...full], eol);
}
