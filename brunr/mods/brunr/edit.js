// Format writers: edits to a Request or folder file that change only the lines they must, and the
// text Bruno writes for a new Request or folder. YAML and bru. Pure.
import { splitLines, joinLines, eolOf, replaceLines, insertLines, bare, indentOf, isBlankOrComment } from "./lines.js";
import { parseYaml } from "./yaml.js";
import { yamlScalar } from "./yamlwrite.js";

export { yamlScalar };

const VERBS = ["get", "post", "put", "patch", "delete", "head", "options", "trace", "connect"];
const METHOD_TYPES = new Set(["http", "graphql"]);

// ---- YAML structure -------------------------------------------------------------------------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A top-level `key:` block: `{ head, start, end }` line indexes, or null. */
export function yamlSection(lines, key) {
  const re = new RegExp(`^${esc(key)}:\\s*(#.*)?$`);
  const head = lines.findIndex((l) => re.test(bare(l)));
  if (head < 0) return null;
  let end = head + 1;
  while (end < lines.length && !(bare(lines[end]).trim() && !/^[\s#]/.test(bare(lines[end])))) end++;
  return { head, start: head + 1, end };
}

export function childIndent(lines, sec) {
  for (let i = sec.start; i < sec.end; i++) if (!isBlankOrComment(lines[i].body)) return indentOf(lines[i].body);
  return 2;
}

/** The last non-blank line of a section, plus one. */
function sectionTail(lines, sec) {
  let end = sec.end;
  while (end > sec.start && !lines[end - 1].body.trim()) end--;
  return end;
}

/** A child `key:` of a section: `{ line, end, indent }` where end closes its value's lines, or null. */
export function yamlChild(lines, sec, key) {
  if (!sec) return null;
  const ci = childIndent(lines, sec);
  if (ci === 0) return null;
  const re = new RegExp(`^${esc(key)}:(\\s|$)`);
  for (let i = sec.start; i < sec.end; i++) {
    const body = lines[i].body;
    if (indentOf(body) !== ci || !re.test(body.slice(ci))) continue;
    let end = i + 1;
    while (end < sec.end && (!lines[end].body.trim() || indentOf(lines[end].body) > ci)) end++;
    while (end > i + 1 && !lines[end - 1].body.trim()) end--;
    return { line: i, end, indent: ci };
  }
  return null;
}

/** The value of a child, read with the YAML reader, or null. */
function yamlValue(lines, child) {
  if (!child) return null;
  const body = lines.slice(child.line, child.end).map((l) => l.body.slice(child.indent)).join("\n");
  try {
    const doc = parseYaml(body);
    return doc && typeof doc === "object" ? Object.values(doc)[0] ?? null : null;
  } catch {
    return null;
  }
}

function yamlEntry(indent, key, value) {
  const pad = " ".repeat(indent);
  return `${pad}${key}: ${typeof value === "number" ? value : yamlScalar(value, pad + "  ")}`.split("\n");
}

export function yamlType(lines) {
  const t = yamlValue(lines, yamlChild(lines, yamlSection(lines, "info"), "type"));
  return typeof t === "string" && t.trim() ? t.trim() : "http";
}

/** Sets `key` in a YAML section, inserting it after the first of `after` that exists when missing. */
function yamlSet(text, sectionKey, key, value, after = []) {
  const lines = splitLines(text);
  const eol = eolOf(text);
  const sec = yamlSection(lines, sectionKey);
  if (!sec) {
    if (sectionKey !== "info") return String(text ?? "");
    const add = ["info:", ...yamlEntry(2, key, value)];
    if (lines.length && bare(lines[0]).trim()) add.push("");
    return joinLines(insertLines(lines, 0, add, eol));
  }
  const child = yamlChild(lines, sec, key);
  const ci = childIndent(lines, sec);
  if (child) return joinLines(replaceLines(lines, child.line, child.end - child.line, yamlEntry(ci, key, value), eol));
  const anchor = after.map((k) => yamlChild(lines, sec, k)).find(Boolean);
  const at = anchor ? anchor.end : key === "name" ? firstChild(lines, sec) : sectionTail(lines, sec);
  return joinLines(insertLines(lines, at, yamlEntry(ci, key, value), eol));
}

function firstChild(lines, sec) {
  for (let i = sec.start; i < sec.end; i++) if (!isBlankOrComment(lines[i].body)) return i;
  return sec.start;
}

// ---- bru structure --------------------------------------------------------------------------

/** Top-level bru blocks: `[{ name, open, close }]`; a one-line `name [ … ]` has open === close. */
export function bruBlocks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const body = bare(lines[i]);
    if (/^(\S+)\s*\[.*\]\s*$/.test(body)) {
      out.push({ name: /^(\S+)/.exec(body)[1].replace(/\[.*$/, ""), open: i, close: i });
      continue;
    }
    const m = /^(\S+)\s*([{[])\s*$/.exec(body);
    if (!m) continue;
    const close = m[2] === "{" ? "}" : "]";
    let j = i + 1;
    while (j < lines.length && lines[j].body.trimEnd() !== close) j++;
    if (j >= lines.length) break;
    out.push({ name: m[1], open: i, close: j });
    i = j;
  }
  return out;
}

const findBlock = (blocks, name) => blocks.find((b) => b.name === name) ?? null;

/** A `key: value` line inside a block: `{ line, end, value }`, `end` covering a ''' value. */
function bruEntry(lines, block, key) {
  if (!block || block.open === block.close) return null;
  const re = new RegExp(`^\\s+${esc(key)}:(?:\\s(.*))?$`);
  for (let i = block.open + 1; i < block.close; i++) {
    const m = re.exec(lines[i].body);
    if (!m) continue;
    const raw = (m[1] ?? "").trim();
    if (raw !== "'''") return { line: i, end: i + 1, value: raw };
    let j = i + 1;
    while (j < block.close && lines[j].body.trim() !== "'''") j++;
    const value = lines.slice(i + 1, j).map((l) => l.body.replace(/^ {4}/, "")).join("\n");
    return { line: i, end: Math.min(j + 1, block.close), value };
  }
  return null;
}

export function bruMeta(lines) {
  const meta = findBlock(bruBlocks(lines), "meta");
  const get = (k) => bruEntry(lines, meta, k);
  return { meta, get, type: get("type")?.value || "http" };
}

/** The block that holds the method and URL: a verb block, `http`, or the type's own block. */
export function bruMethodBlock(lines, type) {
  const blocks = bruBlocks(lines);
  const verb = blocks.find((b) => VERBS.includes(b.name) && b.open !== b.close);
  if (verb) return { block: verb, verb: verb.name };
  const http = findBlock(blocks, "http");
  if (http) return { block: http, verb: null };
  const own = findBlock(blocks, type) ?? findBlock(blocks, type === "websocket" ? "ws" : type);
  return own ? { block: own, verb: null, own: true } : null;
}

const oneLine = (s) => String(s ?? "").replace(/\r?\n/g, " ");
const bruUrl = (url) => (/[\r\n]/.test(url) ? `'''\n${url.split(/\r\n|\r|\n/).map((l) => "    " + l).join("\n")}\n'''` : url);

function bruSet(text, key, value, after = []) {
  const lines = splitLines(text);
  const eol = eolOf(text);
  const { meta, get } = bruMeta(lines);
  const entry = `  ${key}: ${oneLine(value)}`;
  if (!meta) {
    const add = ["meta {", entry, "}"];
    if (lines.length) add.push("");
    return joinLines(insertLines(lines, 0, add, eol));
  }
  const cur = get(key);
  if (cur) return joinLines(replaceLines(lines, cur.line, cur.end - cur.line, [entry], eol));
  const anchor = after.map(get).find(Boolean);
  const at = anchor ? anchor.end : key === "name" ? meta.open + 1 : meta.close;
  return joinLines(insertLines(lines, at, [entry], eol));
}

// ---- the head: name, type, seq, method, url ---------------------------------------------------

/** `{ name, type, seq, method, url, lines }`: values or null, and 1-based line numbers of each. */
export function readHead(text, format) {
  const lines = splitLines(text);
  const at = (x) => (x ? x.line + 1 : null);
  if (format === "yaml") {
    const info = yamlSection(lines, "info");
    const type = yamlType(lines);
    const section = yamlSection(lines, type);
    const c = { name: yamlChild(lines, info, "name"), seq: yamlChild(lines, info, "seq"), method: yamlChild(lines, section, "method"), url: yamlChild(lines, section, "url") };
    const v = (k) => yamlValue(lines, c[k]);
    const method = v("method");
    return {
      name: v("name") == null ? null : String(v("name")), type, seq: toSeq(v("seq")),
      method: method == null ? null : String(method).toUpperCase(), url: v("url") == null ? null : String(v("url")),
      lines: { name: at(c.name), seq: at(c.seq), method: at(c.method), url: at(c.url) },
    };
  }
  const { get, type } = bruMeta(lines);
  const mb = bruMethodBlock(lines, type);
  const methodEntry = mb && !mb.verb ? bruEntry(lines, mb.block, "method") : null;
  const urlEntry = mb ? bruEntry(lines, mb.block, "url") : null;
  const method = mb?.verb ? mb.verb.toUpperCase() : methodEntry?.value ? methodEntry.value.toUpperCase() : null;
  return {
    name: get("name")?.value ?? null, type, seq: toSeq(get("seq")?.value),
    method, url: urlEntry ? urlEntry.value : null,
    lines: { name: at(get("name")), seq: at(get("seq")), method: mb?.verb ? mb.block.open + 1 : at(methodEntry), url: at(urlEntry) },
  };
}

function toSeq(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** True when the method menu can change this file: an HTTP or GraphQL Request with a method line. */
export function canSetMethod(text, format) {
  const head = readHead(text, format);
  return METHOD_TYPES.has(head.type) && head.lines.method !== null;
}

/** True when the file has a URL line to change. */
export const canSetUrl = (text, format) => readHead(text, format).lines.url !== null;

export function setName(text, format, name) {
  return format === "yaml" ? yamlSet(text, "info", "name", String(name ?? "")) : bruSet(text, "name", name);
}

export function setSeq(text, format, seq) {
  return format === "yaml" ? yamlSet(text, "info", "seq", Number(seq), ["type", "name"]) : bruSet(text, "seq", Number(seq), ["type", "name"]);
}

/** Sets the method. bru renames a verb block, or uses `http { method: … }` for a custom method. */
export function setMethod(text, format, method) {
  const m = String(method ?? "").trim();
  if (!m || !canSetMethod(text, format)) return String(text ?? "");
  const lines = splitLines(text);
  const eol = eolOf(text);
  if (format === "yaml") {
    const child = yamlChild(lines, yamlSection(lines, yamlType(lines)), "method");
    return joinLines(replaceLines(lines, child.line, child.end - child.line, yamlEntry(child.indent, "method", m.toUpperCase()), eol));
  }
  const lower = m.toLowerCase();
  const { block, verb } = bruMethodBlock(lines, bruMeta(lines).type);
  const rename = (name) => replaceLines(lines, block.open, 1, [`${name} {`], eol);
  if (verb && VERBS.includes(lower)) return joinLines(rename(lower));
  if (verb) return joinLines(insertLines(rename("http"), block.open + 1, [`  method: ${lower}`], eol));
  const entry = bruEntry(lines, block, "method");
  if (VERBS.includes(lower)) {
    const without = replaceLines(lines, entry.line, entry.end - entry.line, [], eol);
    return joinLines(replaceLines(without, block.open, 1, [`${lower} {`], eol));
  }
  return joinLines(replaceLines(lines, entry.line, entry.end - entry.line, [`  method: ${lower}`], eol));
}

export function setUrl(text, format, url) {
  if (!canSetUrl(text, format)) return String(text ?? "");
  const u = String(url ?? "");
  const lines = splitLines(text);
  const eol = eolOf(text);
  if (format === "yaml") {
    const child = yamlChild(lines, yamlSection(lines, yamlType(lines)), "url");
    return joinLines(replaceLines(lines, child.line, child.end - child.line, yamlEntry(child.indent, "url", u), eol));
  }
  const { block } = bruMethodBlock(lines, bruMeta(lines).type);
  const entry = bruEntry(lines, block, "url");
  return joinLines(replaceLines(lines, entry.line, entry.end - entry.line, `  url: ${bruUrl(u)}`.split("\n"), eol));
}

// ---- new files --------------------------------------------------------------------------------

/** Query and `:name` path params from a URL, as Bruno's new Request dialog adds them. */
export function urlParams(url) {
  const s = String(url ?? "");
  const masked = s.replace(/\{\{.*?\}\}/g, (x) => "_".repeat(x.length));
  const q = masked.indexOf("?");
  const query = q < 0 ? "" : s.slice(q + 1).split("#")[0];
  const params = [];
  for (const pair of query ? query.split("&") : []) {
    const [name, ...rest] = pair.split("=");
    if (name) params.push({ name, value: rest.join("="), type: "query" });
  }
  const seen = new Set();
  for (const seg of (q < 0 ? s : s.slice(0, q)).split("/")) {
    const name = seg.startsWith(":") ? seg.slice(1) : "";
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push({ name, value: "", type: "path" });
    }
  }
  return params;
}

const bruKey = (k) => ([":", '"', "{", "}", " "].some((c) => k.includes(c)) ? `"${k.replaceAll('"', '\\"')}"` : k);

/** The text Bruno writes for a new HTTP Request: auth inherit, URL params, default settings. */
export function newRequestText({ format, name, method, url, seq }) {
  const m = String(method || "GET").trim() || "GET";
  const u = String(url ?? "");
  const params = urlParams(u);
  if (format === "yaml") {
    const out = ["info:", ...yamlEntry(2, "name", String(name ?? "").trim() ? String(name) : "Untitled Request"), "  type: http"];
    if (seq) out.push(`  seq: ${Number(seq)}`);
    out.push("", "http:", ...yamlEntry(2, "method", m.toUpperCase()), ...yamlEntry(2, "url", u));
    if (params.length) {
      out.push("  params:");
      for (const p of params) out.push(`    - name: ${yamlScalar(p.name, "        ")}`, ...yamlEntry(6, "value", p.value), `      type: ${p.type}`);
    }
    out.push("  auth: inherit", "", "settings:", "  encodeUrl: true", "  timeout: 0", "  followRedirects: true", "  maxRedirects: 5", "  forwardAuthorizationHeader: false");
    return out.join("\n") + "\n";
  }
  const lower = m.toLowerCase();
  const out = ["meta {", `  name: ${oneLine(name)}`, "  type: http", `  seq: ${seq ? Number(seq) : 1}`, "}", ""];
  out.push(VERBS.includes(lower) ? `${lower} {` : `http {\n  method: ${lower}`, `  url: ${bruUrl(u)}`, "  body: none", "  auth: inherit", "}", "");
  for (const type of ["query", "path"]) {
    const list = params.filter((p) => p.type === type);
    if (list.length) out.push(`params:${type} {`, ...list.map((p) => `  ${bruKey(p.name)}: ${p.value}`), "}", "");
  }
  out.push("settings {", "  encodeUrl: true", "  forwardAuthorizationHeader: false", "}");
  return out.join("\n") + "\n";
}

/** The folder file Bruno's New Folder writes: name, sequence number and auth mode inherit. */
export function newFolderText({ format, name, seq }) {
  if (format === "yaml") {
    return ["info:", ...yamlEntry(2, "name", String(name ?? "")), "  type: folder", ...(seq ? [`  seq: ${Number(seq)}`] : []), "", "request:", "  auth: inherit"].join("\n") + "\n";
  }
  return ["meta {", `  name: ${oneLine(name)}`, ...(seq ? [`  seq: ${Number(seq)}`] : []), "}", "", "auth {", "  mode: inherit", "}"].join("\n") + "\n";
}

/**
 * The folder file text after a rename or renumbering. With no `text` it is the file Bruno writes
 * for a folder that had none: `name` (else the directory name) and `seq`, and no auth.
 */
export function ensureFolderFile({ format, dirName, text = null, name = null, seq = null }) {
  if (text == null) {
    const n = name ?? dirName ?? "";
    if (format === "yaml") return ["info:", ...yamlEntry(2, "name", String(n)), "  type: folder", ...(seq ? [`  seq: ${Number(seq)}`] : []), "", "request: {}"].join("\n") + "\n";
    return ["meta {", `  name: ${oneLine(n)}`, ...(seq ? [`  seq: ${Number(seq)}`] : []), "}"].join("\n") + "\n";
  }
  let out = String(text);
  if (name != null) out = setName(out, format, name);
  if (seq != null) out = setSeq(out, format, seq);
  return out;
}
