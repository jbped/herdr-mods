// .env files read the way the `dotenv` package reads them, and edited line by line so comments,
// blank lines, order and the quoting of untouched lines survive. Pure.

// dotenv 16's LINE expression, with indices so an edit knows where a key and its value sit.
const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/dgm;
const NAME = /^[\w.-]+$/;

/** True for `.env` and `.env.<letters, digits, dot, underscore, hyphen>`. */
export const isDotenvFile = (name) => /^\.env(\.[A-Za-z0-9._-]+)?$/.test(String(name ?? ""));

/** Assignment rows `{ line, name, value }`, line 1-based, in file order. Duplicates are all listed. */
export function readDotenv(text) {
  return scan(text).map(({ line, name, value }) => ({ line, name, value }));
}

/** Rows with their offsets in the original text. CRLF is read as LF, as dotenv does. */
function scan(text) {
  const src = String(text ?? "");
  const map = [];
  let norm = "";
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\r") {
      map.push(i);
      norm += "\n";
      if (src[i + 1] === "\n") i++;
    } else {
      map.push(i);
      norm += src[i];
    }
  }
  map.push(src.length);
  const at = (n) => map[n];
  const rows = [];
  for (const m of norm.matchAll(LINE)) {
    const [keyStart, keyEnd] = m.indices[1];
    const group = m[2] ?? "";
    const sep = /^(\s*=\s*?|:\s+?)/.exec(norm.slice(keyEnd))[0].length;
    const groupStart = m.indices[2] ? m.indices[2][0] : keyEnd + sep;
    const raw = group.trim();
    const valStart = groupStart + (group.length - group.trimStart().length);
    let value = raw;
    const quote = /^(['"`])([\s\S]*)\1$/.exec(raw)?.[1] ?? null;
    if (quote) value = raw.slice(1, -1);
    if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    rows.push({
      line: norm.slice(0, keyStart).split("\n").length, name: m[1], value, quote,
      keyStart: at(keyStart), keyEnd: at(keyEnd), valStart: at(valStart), valEnd: at(valStart + raw.length),
    });
  }
  return rows;
}

const needsQuotes = (v) => /[\n\r#"'`]/.test(v) || /^\s|\s$/.test(v);

/** A value as written: unquoted when it can be, else in the first quote that can hold it. */
function render(value, oldQuote) {
  const v = String(value ?? "");
  const can = { '"': !v.includes('"') && !/\\[nr]/.test(v), "'": !v.includes("'"), "`": !v.includes("`") };
  const enc = (q) => (q === '"' ? `"${v.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"` : `${q}${v}${q}`);
  if (oldQuote && can[oldQuote]) return enc(oldQuote);
  if (!needsQuotes(v)) return v;
  return enc(['"', "'", "`"].find((q) => can[q]) ?? '"');
}

function pick(rows, edit) {
  const hits = rows.filter((r) => (edit.line ? r.line === edit.line : r.name === edit.name));
  return hits[hits.length - 1] ?? null;
}

function checkName(name) {
  if (!NAME.test(String(name ?? ""))) throw new Error(`"${name}" is not a valid .env name: use letters, digits, '_', '.' and '-'`);
}

/**
 * The text after `edits`, applied in order. Each edit is one of
 * `{ op: "set", name, value, line? }`, `{ op: "rename", name, to, line? }`,
 * `{ op: "add", name, value }`, `{ op: "remove", name, line? }`. `line` picks one of several rows
 * with the same name; without it the last one, the one dotenv uses, is edited. Only the edited
 * lines change. Throws on an invalid name or a row that does not exist.
 */
export function applyDotenv(text, edits) {
  let out = String(text ?? "");
  for (const edit of edits ?? []) out = applyOne(out, edit);
  return out;
}

function applyOne(text, edit) {
  if (edit.op === "add") {
    checkName(edit.name);
    const line = `${edit.name}=${render(edit.value, null)}`;
    const eol = /\r?\n/.exec(text)?.[0] ?? "\n";
    if (!text) return line + "\n";
    return /\n$/.test(text) ? text + line + eol : text + eol + line;
  }
  const row = pick(scan(text), edit);
  if (!row) throw new Error(`no variable ${edit.name ?? `on line ${edit.line}`} in this file`);
  if (edit.op === "set") return text.slice(0, row.valStart) + render(edit.value, row.quote) + text.slice(row.valEnd);
  if (edit.op === "rename") {
    checkName(edit.to);
    return text.slice(0, row.keyStart) + edit.to + text.slice(row.keyEnd);
  }
  if (edit.op === "remove") return removeRow(text, row);
  throw new Error(`unknown .env edit ${edit.op}`);
}

function removeRow(text, row) {
  const start = text.lastIndexOf("\n", row.keyStart - 1) + 1;
  const nl = text.indexOf("\n", Math.max(row.valEnd, row.keyEnd));
  if (nl >= 0) return text.slice(0, start) + text.slice(nl + 1);
  // The last line has no newline: drop the line ending before it so the file still has none.
  const cut = start > 0 ? start - (text[start - 2] === "\r" ? 2 : 1) : 0;
  return text.slice(0, cut);
}
