// Environment files with their values, for the Environment editor only: read rows and write the
// file in Bruno's shape (filestore stringifyEnvironment for YAML, bruno-lang jsonToEnv for bru).
// parser.js keeps returning Environments without values. Pure.
import { splitLines, joinLines, eolOf, replaceLines, bare } from "./lines.js";
import { parseYaml } from "./yaml.js";
import { yamlScalar } from "./yamlwrite.js";

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (v == null ? "" : isMap(v) && "data" in v ? String(v.data ?? "") : String(v));

/** `{ name, rows: [{ name, value, enabled, secret, description }] }`. A bru file has no name: null. */
export function readEnvironment(text, format) {
  return format === "yaml" ? readYaml(text) : readBru(text);
}

function readYaml(text) {
  const doc = parseYaml(text);
  if (doc !== null && !isMap(doc)) throw new Error("an Environment file must be a map");
  const list = Array.isArray(doc?.variables) ? doc.variables : [];
  const rows = list.filter(isMap).map((v) => ({
    name: str(v.name),
    value: v.secret === true ? "" : str(v.value),
    enabled: v.disabled !== true,
    secret: v.secret === true,
    description: typeof v.description === "string" ? v.description : str(v.description?.content),
  }));
  return { name: doc?.name == null ? null : String(doc.name), rows };
}

/** The top-level parts of a bru Environment: blocks `{ name, inner: [lines] }` and `key: value` lines. */
function bruParts(text) {
  const lines = splitLines(text).map((l) => l.body.replace(/^\uFEFF/, ""));
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const inline = /^(\S+?)\s*\[(.*)\]\s*$/.exec(line);
    const open = /^(\S+?)\s*([{[])\s*$/.exec(line);
    if (inline) parts.push({ name: inline[1], inner: [inline[2]], raw: [line] });
    else if (open) {
      const close = open[2] === "{" ? "}" : "]";
      let j = i + 1;
      while (j < lines.length && lines[j].trimEnd() !== close) j++;
      parts.push({ name: open[1], inner: lines.slice(i + 1, j), raw: lines.slice(i, j + 1) });
      i = j;
    } else {
      const kv = /^([^\s:]+):\s?(.*)$/.exec(line);
      parts.push({ name: kv ? kv[1] : line, value: kv ? kv[2].trim() : "", raw: [line] });
    }
  }
  return parts;
}

function unquoteArg(arg) {
  const a = arg.trim();
  if (a.startsWith('"') && a.endsWith('"')) return a.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (a.startsWith("'") && a.endsWith("'")) return a.slice(1, -1);
  return a;
}

const dedent = (lines, n) => lines.map((l) => l.replace(new RegExp(`^ {0,${n}}`), ""));

/** Entries of a vars or vars:secret block, each with its annotations. */
function bruEntries(inner, list) {
  const out = [];
  let notes = {};
  for (let i = 0; i < inner.length; i++) {
    const t = list ? inner[i].trim().replace(/,$/, "") : inner[i].trim();
    if (!t) continue;
    const block = /^@(\w+)\('''$/.exec(t);
    const note = block ? [t, block[1], "'''"] : /^@(\w+)(?:\((.*)\))?$/.exec(t);
    if (note && note[2] === "'''") {
      let j = i + 1;
      while (j < inner.length && inner[j].trim() !== "''')") j++;
      notes[note[1]] = dedent(inner.slice(i + 1, j), 4).join("\n").split("\\'\\'\\'").join("'''");
      i = j;
      continue;
    }
    if (note) {
      notes[note[1]] = note[2] === undefined ? true : unquoteArg(note[2]);
      continue;
    }
    if (list) {
      for (const part of t.split(",").map((p) => p.trim()).filter(Boolean)) out.push({ key: part, value: "", notes });
      notes = {};
      continue;
    }
    const kv = /^([^:]+?):\s?(.*)$/.exec(t);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "'''") {
      let j = i + 1;
      while (j < inner.length && inner[j].trim() !== "'''") j++;
      value = dedent(inner.slice(i + 1, j), 4).join("\n");
      i = j;
    }
    out.push({ key: kv[1].trim(), value, notes });
    notes = {};
  }
  return out;
}

function readBru(text) {
  const parts = bruParts(text);
  const rows = [];
  const add = (e, secret) => rows.push({
    name: e.key.replace(/^~/, ""), value: secret ? "" : e.value, enabled: !e.key.startsWith("~"), secret,
    description: typeof e.notes.description === "string" ? e.notes.description : "",
  });
  for (const p of parts) {
    if (p.name === "vars" && p.inner) bruEntries(p.inner, false).forEach((e) => add(e, false));
    if (p.name === "vars:secret" && p.inner) bruEntries(p.inner, true).forEach((e) => add(e, true));
  }
  return { name: null, rows };
}

/**
 * The Environment file in Bruno's shape. Keys Brunr does not model (extends, color, external
 * secrets, anything else) are kept from `previousText`, in Bruno's order.
 */
export function writeEnvironment({ format, name, rows, previousText = null }) {
  const eol = previousText ? eolOf(previousText) : "\n";
  const text = format === "yaml" ? writeYaml(name, rows ?? [], previousText) : writeBru(rows ?? [], previousText);
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

/** Top-level YAML chunks of a file: `{ key, lines }`, a leading comment chunk having key null. */
function yamlChunks(text) {
  const chunks = [];
  for (const { body } of splitLines(text)) {
    const line = body.replace(/^\uFEFF/, "");
    const key = /^(?!- )([^\s#][^:]*):(\s|$)/.exec(line);
    if (key) chunks.push({ key: key[1].trim(), lines: [line] });
    else if (chunks.length) chunks[chunks.length - 1].lines.push(line);
    else chunks.push({ key: null, lines: [line] });
  }
  for (const c of chunks) while (c.lines.length > 1 && !c.lines[c.lines.length - 1].trim()) c.lines.pop();
  return chunks;
}

function yamlVariables(rows) {
  const out = ["variables:"];
  const entry = (key, value, first) => `${first ? "  - " : "    "}${key}: ${yamlScalar(value, "      ")}`;
  for (const r of rows) {
    if (r.secret) out.push("  - secret: true", entry("name", r.name, false));
    else out.push(entry("name", r.name, true), entry("value", r.value ?? "", false));
    if (r.enabled === false) out.push("    disabled: true");
    if (r.description) out.push(entry("description", r.description, false));
  }
  return out.join("\n").split("\n");
}

function writeYaml(name, rows, previousText) {
  const kept = previousText ? yamlChunks(previousText).filter((c) => c.key !== "name" && c.key !== "variables") : [];
  const vars = rows.length ? [{ key: "variables", lines: yamlVariables(rows) }] : [];
  const at = kept.findIndex((c) => c.key === "externalSecrets");
  const chunks = at < 0 ? [...kept, ...vars] : [...kept.slice(0, at), ...vars, ...kept.slice(at)];
  const lead = chunks.filter((c) => c.key === null);
  const rest = chunks.filter((c) => c.key !== null);
  const out = [...lead.flatMap((c) => c.lines), `name: ${yamlScalar(String(name ?? ""), "  ")}`, ...rest.flatMap((c) => c.lines)];
  return out.join("\n") + "\n";
}

const indent = (s) => s.split(/\r\n|\r|\n/).map((l) => "  " + l).join("\n");
const valueString = (v) => (/[\r\n]/.test(v) ? `'''\n${indent(v)}\n'''` : v);

function annotation(description) {
  if (!description) return "";
  if (description.includes("\n")) {
    const escaped = description.split("\\'").join("\\\\'").split("'''").join("\\'\\'\\'");
    return `@description('''\n${indent(escaped)}\n''')\n`;
  }
  const arg = description.includes("'") ? `"${description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : `'${description}'`;
  return `@description(${arg})\n`;
}

function writeBru(rows, previousText) {
  const parts = previousText ? bruParts(previousText) : [];
  const raw = (p) => p.raw.join("\n");
  const ext = parts.filter((p) => p.name === "extends");
  const secrets = parts.filter((p) => p.name.startsWith("vars:externalsecrets"));
  const color = parts.filter((p) => p.name === "color" && !p.inner);
  const other = parts.filter((p) => !["extends", "vars", "vars:secret", "color"].includes(p.name) && !p.name.startsWith("vars:externalsecrets"));
  const plain = rows.filter((r) => !r.secret).map((r) => indent(`${annotation(r.description)}${r.enabled === false ? "~" : ""}${r.name}: ${valueString(String(r.value ?? ""))}`));
  const secret = rows.filter((r) => r.secret).map((r) => indent(`${annotation(r.description)}${r.enabled === false ? "~" : ""}${r.name}`));
  let out = ext.map((p) => raw(p) + "\n").join("");
  if (!rows.length) out += "vars {\n}\n";
  if (plain.length) out += `vars {\n${plain.join("\n")}\n}\n`;
  if (secret.length) out += `vars:secret [\n${secret.join(",\n")}\n]\n`;
  out += secrets.map((p) => raw(p) + "\n").join("");
  out += color.map((p) => raw(p) + "\n").join("");
  out += other.map((p) => raw(p) + "\n").join("");
  return out;
}

/**
 * The rows with the secret `name` rewritten as a normal variable whose value is
 * `{{process.env.<envName>}}`. `envName`: the name in `.env`, `name` by default.
 */
export function moveSecretToDotenv(rows, name, envName = name) {
  return (rows ?? []).map((r) => (r.name === name ? { ...r, secret: false, value: `{{process.env.${envName}}}` } : r));
}

/** The `extends` reference of an Environment file when it is a single name, else null. */
export function readExtends(text, format) {
  if (format === "yaml") {
    try {
      const doc = parseYaml(text);
      return isMap(doc) && typeof doc.extends === "string" ? doc.extends : null;
    } catch {
      return null;
    }
  }
  const part = bruParts(text).find((p) => p.name === "extends" && !p.inner);
  return part ? part.value : null;
}

/** The text with a top-level `key: value` line set in place, or unchanged when there is none. */
function setTopLine(text, key, value) {
  const lines = splitLines(text);
  const at = lines.findIndex((l) => new RegExp(`^${key}:(\\s|$)`).test(bare(l)));
  if (at < 0) return String(text ?? "");
  const bom = lines[at].body.startsWith("\uFEFF") ? "\uFEFF" : "";
  return joinLines(replaceLines(lines, at, 1, [`${bom}${key}: ${value}`], eolOf(text)));
}

/** A YAML Environment's `name:` line set in place. bru files carry no name. */
export const setEnvironmentName = (text, format, name) => (format === "yaml" ? setTopLine(text, "name", yamlScalar(String(name), "  ")) : String(text ?? ""));

/** The single-name `extends` line set in place. */
export const setExtends = (text, format, name) => setTopLine(text, "extends", format === "yaml" ? yamlScalar(String(name), "  ") : String(name));

/** The text without its top-level `color` line, as Bruno's copy of an Environment drops the color. */
export function dropColor(text) {
  const lines = splitLines(text);
  const at = lines.findIndex((l) => /^color:(\s|$)/.test(bare(l)));
  return at < 0 ? String(text ?? "") : joinLines(replaceLines(lines, at, 1, [], eolOf(text)));
}
