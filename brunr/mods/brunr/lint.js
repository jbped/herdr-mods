// Warnings before a Request is saved: text that does not read as a Request, and YAML that the
// `yaml` library Bruno and its CLI use would reject or read differently. Pure.
import { readRequestText } from "./parser.js";
import { parseYaml } from "./yaml.js";
import { splitLines } from "./lines.js";

const lineOf = (message) => Number(/line (\d+)/.exec(message)?.[1] ?? 0) || null;

/**
 * `[{ line, message, broken? }]` sorted by line, empty for a clean file. `line` is 1-based, or null
 * for the whole file. `broken` marks the warning that the text does not read as a Request at all.
 */
export function lintRequest(text, format) {
  const out = format === "yaml" ? yamlPitfalls(text) : [];
  const parseIssue = readIssue(text, format);
  if (parseIssue && !out.some((w) => w.line === parseIssue.line)) out.push(parseIssue);
  return out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/** True when saving these warnings anyway leaves a file the tree lists as broken and Runs leave out. */
export const breaksRequest = (warnings) => (warnings ?? []).some((w) => w.broken);

function readIssue(text, format) {
  try {
    if (format === "yaml") parseYaml(text);
    if (readRequestText(text, format) === null) return { line: null, message: "This file is not a Request: its info.type is folder, script or app." };
    return null;
  } catch (e) {
    const message = String(e.message).replace(/^line \d+: /, "");
    return { line: lineOf(e.message), message: `This does not read as a Request: ${message}.`, broken: true };
  }
}

/** The plain scalar after `key: ` or `- `, with any comment removed, or null when it is not plain. */
function plainValue(rest) {
  const v = rest.replace(/(^|\s)#.*$/, "").trim();
  if (!v || /^["'|>]/.test(v)) return null;
  return v;
}

function yamlPitfalls(text) {
  const lines = splitLines(text).map((l) => l.body.replace(/^﻿/, ""));
  const out = [];
  const warn = (i, message) => out.push({ line: i + 1, message });
  const maps = [];
  let blockIndent = -1;
  lines.forEach((line, i) => {
    const lead = /^[ \t]*/.exec(line)[0];
    const indent = lead.length;
    if (blockIndent >= 0) {
      if (!line.trim() || indent > blockIndent) return;
      blockIndent = -1;
    }
    if (/^\s*(#.*)?$/.test(line)) return;
    if (lead.includes("\t")) return warn(i, "Tab in the indentation. YAML allows only spaces.");
    let body = line.slice(indent);
    let col = indent;
    while (/^- /.test(body)) {
      const rest = body.slice(2).replace(/^ +/, "");
      col += body.length - rest.length;
      body = rest;
      while (maps.length && maps[maps.length - 1].indent >= col) maps.pop();
      maps.push({ indent: col, keys: new Set() });
    }
    const kv = /^([^\s"'#][^:]*?|"[^"]*"|'[^']*'):(?:\s+(.*))?$/.exec(body);
    const value = kv ? kv[2] ?? "" : body;
    if (kv) {
      const key = kv[1].replace(/^["']|["']$/g, "");
      while (maps.length && maps[maps.length - 1].indent > col) maps.pop();
      if (!maps.length || maps[maps.length - 1].indent < col) maps.push({ indent: col, keys: new Set() });
      const keys = maps[maps.length - 1].keys;
      if (keys.has(key)) warn(i, `Duplicate key "${key}". YAML does not allow a key twice in one map.`);
      keys.add(key);
    }
    if (/^[|>]/.test(value.trim())) {
      blockIndent = col;
      return;
    }
    const plain = plainValue(value);
    if (plain === null) return;
    if (plain.startsWith("{{")) return warn(i, `A value starting with "{{" must be quoted: "${plain}". Unquoted, YAML reads it as a map.`);
    if (/^[@`]/.test(plain)) return warn(i, `A value starting with "${plain[0]}" must be quoted. YAML reserves that character.`);
    if (/^[*&!]/.test(plain)) return warn(i, `A value starting with "${plain[0]}" must be quoted. Unquoted, YAML reads it as ${plain[0] === "!" ? "a tag" : plain[0] === "*" ? "an alias" : "an anchor"}.`);
    if (/^[[{]/.test(plain)) return;
    if (/:\s/.test(plain)) return warn(i, `A value containing ": " must be quoted. Unquoted, YAML reads it as a nested map.`);
  });
  return out;
}
