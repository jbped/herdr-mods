// A small YAML reader for the files Bruno writes: nested maps by indentation, lists of maps,
// quoted and plain scalars, block scalars, one-line flow collections, comments and empty values.
// It is not a general YAML parser. Anchors, tags, multi-line quoted or plain scalars and multiple
// documents are not supported. It imports nothing, because a mod cannot load node_modules.

/** The value in `text`, or null for an empty document. Throws an Error naming the line on bad input. */
export function parseYaml(text) {
  const st = { lines: String(text ?? "").replace(/^﻿/, "").split(/\r?\n/), i: 0 };
  skipBlank(st);
  if (st.i >= st.lines.length) return null;
  const indent = indentOf(st, st.i);
  const value = parseBlock(st, indent);
  skipBlank(st);
  if (st.i < st.lines.length) fail(st, "unexpected indentation");
  return value;
}

function fail(st, message, line = st.i) {
  throw new Error(`line ${line + 1}: ${message}`);
}

const isBlank = (line) => /^\s*(#.*)?$/.test(line);

function skipBlank(st) {
  while (st.i < st.lines.length && isBlank(st.lines[st.i])) st.i++;
}

function indentOf(st, i) {
  const lead = /^[ \t]*/.exec(st.lines[i])[0];
  if (lead.includes("\t")) fail(st, "tabs are not allowed in indentation", i);
  return lead.length;
}

const isListItem = (body) => body === "-" || body.startsWith("- ");

function parseBlock(st, indent) {
  return isListItem(st.lines[st.i].slice(indent)) ? parseList(st, indent) : parseMap(st, indent);
}

/** Index of the `:` that ends a plain key: the first one followed by a space or the line end. */
function keyEnd(body) {
  const m = /:(\s|$)/.exec(body);
  return m ? m.index : -1;
}

function splitKey(st, body) {
  if (body[0] === '"' || body[0] === "'") {
    const { value, end } = readQuoted(st, body, 0);
    const rest = body.slice(end);
    if (!/^\s*:(\s|$)/.test(rest)) fail(st, "expected ':' after a quoted key");
    return { key: value, rest: rest.replace(/^\s*:/, "").trim() };
  }
  const at = keyEnd(body);
  if (at < 0) fail(st, "expected 'key: value'");
  return { key: body.slice(0, at).trim(), rest: body.slice(at + 1).trim() };
}

function parseMap(st, indent) {
  const map = {};
  for (;;) {
    skipBlank(st);
    if (st.i >= st.lines.length) break;
    const ind = indentOf(st, st.i);
    if (ind < indent) break;
    if (ind > indent) fail(st, "unexpected indentation");
    const body = st.lines[st.i].slice(indent);
    if (isListItem(body)) break;
    const { key, rest } = splitKey(st, body);
    st.i++;
    map[key] = parseValue(st, rest, indent, true);
  }
  return map;
}

function parseList(st, indent) {
  const list = [];
  for (;;) {
    skipBlank(st);
    if (st.i >= st.lines.length) break;
    const ind = indentOf(st, st.i);
    if (ind < indent) break;
    if (ind > indent) fail(st, "unexpected indentation");
    const body = st.lines[st.i].slice(indent);
    if (!isListItem(body)) break;
    const rest = body.slice(1).replace(/^ +/, "");
    const column = indent + (body.length - rest.length);
    if (rest && !rest.startsWith("#") && (keyEnd(rest) >= 0 && !/^["'[{|>]/.test(rest) || /^["'][^"']*["']\s*:(\s|$)/.test(rest) || isListItem(rest))) {
      // "- key: value" starts a map (or "- - x" a list) whose items sit at the column of `key`.
      st.lines[st.i] = " ".repeat(column) + rest;
      list.push(parseBlock(st, column));
    } else {
      st.i++;
      list.push(parseValue(st, rest, indent, false));
    }
  }
  return list;
}

/** The value after `key:` or `- `. An empty rest means a nested block or null. */
function parseValue(st, rest, indent, inMap) {
  const text = stripComment(rest);
  if (text === "") return parseNested(st, indent, inMap);
  if (/^[|>]/.test(text)) return parseBlockScalar(st, text, indent);
  if (text[0] === '"' || text[0] === "'") {
    const { value, end } = readQuoted(st, text, 0, st.i - 1);
    // A comment may follow, after white space: `"x" # note`.
    if (!/^(\s+#.*)?\s*$/.test(text.slice(end))) fail(st, "unexpected text after a quoted value", st.i - 1);
    return value;
  }
  if (text[0] === "[" || text[0] === "{") return parseFlow(st, text);
  return plainScalar(text);
}

function parseNested(st, indent, inMap) {
  skipBlank(st);
  if (st.i >= st.lines.length) return null;
  const ind = indentOf(st, st.i);
  if (ind > indent) return parseBlock(st, ind);
  // A map's list value may sit at the map's own indentation.
  if (inMap && ind === indent && isListItem(st.lines[st.i].slice(ind))) return parseList(st, ind);
  return null;
}

function stripComment(text) {
  if (text.startsWith("#")) return "";
  if (text[0] === '"' || text[0] === "'") return text.trim();
  return text.replace(/\s+#.*$/, "").trim();
}

function plainScalar(text) {
  if (text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?\d+$/.test(text) || /^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  return text;
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", 0: "\0", '"': '"', "\\": "\\", "/": "/", " ": " " };

/** A quoted scalar starting at `from`. Returns its value and the index after the closing quote. */
function readQuoted(st, text, from, line = st.i) {
  const q = text[from];
  let out = "";
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (q === "'" && c === "'") {
      if (text[i + 1] === "'") { out += "'"; i++; continue; }
      return { value: out, end: i + 1 };
    }
    if (q === '"' && c === '"') return { value: out, end: i + 1 };
    if (q === '"' && c === "\\") {
      const e = text[++i];
      if (e === "u" || e === "x") {
        const len = e === "u" ? 4 : 2;
        out += String.fromCharCode(parseInt(text.slice(i + 1, i + 1 + len), 16));
        i += len;
      } else out += ESCAPES[e] ?? e;
      continue;
    }
    out += c;
  }
  fail(st, "unclosed quoted value", line);
}

function parseBlockScalar(st, header, indent) {
  const m = /^([|>])([-+]?)(\d?)([-+]?)$/.exec(header);
  if (!m) fail(st, `bad block scalar header '${header}'`, st.i - 1);
  const [, style, chompA, digit, chompB] = m;
  const chomp = chompA || chompB;
  const raw = [];
  let blockIndent = digit ? indent + Number(digit) : -1;
  while (st.i < st.lines.length) {
    const line = st.lines[st.i];
    if (line.trim() === "") { raw.push(""); st.i++; continue; }
    const ind = /^ */.exec(line)[0].length;
    if (blockIndent < 0) blockIndent = ind;
    if (ind < blockIndent || ind <= indent) break;
    raw.push(line.slice(blockIndent));
    st.i++;
  }
  let trailing = 0;
  while (raw.length && raw[raw.length - 1] === "") { raw.pop(); trailing++; }
  let body = style === "|" ? raw.join("\n") : fold(raw);
  if (body === "") return "";
  if (chomp === "+") body += "\n".repeat(trailing + 1);
  else if (chomp !== "-") body += "\n";
  return body;
}

function fold(lines) {
  let out = "";
  lines.forEach((line, k) => {
    if (k === 0) out = line;
    else if (line === "" || lines[k - 1] === "" || /^\s/.test(line)) out += "\n" + line;
    else out += " " + line;
  });
  return out;
}

/** A one-line flow collection such as `[a, "b"]` or `{ name: x }`. */
function parseFlow(st, text) {
  const line = st.i - 1;
  const p = { text, i: 0 };
  const value = flowValue(st, p, line);
  if (p.text.slice(p.i).trim() !== "") fail(st, "unexpected text after a flow collection", line);
  return value;
}

function flowSpace(p) {
  while (p.text[p.i] === " ") p.i++;
}

function flowValue(st, p, line) {
  flowSpace(p);
  const c = p.text[p.i];
  if (c === "[" || c === "{") {
    const close = c === "[" ? "]" : "}";
    const out = c === "[" ? [] : {};
    p.i++;
    for (;;) {
      flowSpace(p);
      if (p.i >= p.text.length) fail(st, "unclosed flow collection", line);
      if (p.text[p.i] === close) { p.i++; return out; }
      if (c === "[") out.push(flowValue(st, p, line));
      else {
        const key = flowValue(st, p, line);
        flowSpace(p);
        if (p.text[p.i] !== ":") fail(st, "expected ':' in a flow map", line);
        p.i++;
        out[String(key)] = flowValue(st, p, line);
      }
      flowSpace(p);
      if (p.text[p.i] === ",") p.i++;
      else if (p.text[p.i] !== close) fail(st, "expected ',' in a flow collection", line);
    }
  }
  if (c === '"' || c === "'") {
    const { value, end } = readQuoted(st, p.text, p.i, line);
    p.i = end;
    return value;
  }
  const m = /^[^,\]}]*?(?=\s*(,|]|}|:\s|$))/.exec(p.text.slice(p.i));
  p.i += m[0].length;
  return plainScalar(m[0].trim());
}
