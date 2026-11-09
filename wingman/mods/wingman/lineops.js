// E3: line operations for the built-in editor. Pure: each returns the edit to make,
// { from, to, text } (positions in the file's lines, text with "\n"), and where the
// selection goes afterwards, { anchor, cur } (null anchor: no selection).
import { body } from "./edit.js";

const end = (lines, l) => ({ line: l, col: body(lines[l]).length });
const block = (lines, l1, l2) => lines.slice(l1, l2 + 1).map(body).join("\n");
const shift = (p, d) => p && { line: p.line + d, col: p.col };

/** The lines a selection covers; one ending at column 0 of a later line leaves that line out. */
export function lineSpan(anchor, cur) {
  if (!anchor) return [cur.line, cur.line];
  const [a, b] = anchor.line < cur.line || (anchor.line === cur.line && anchor.col <= cur.col) ? [anchor, cur] : [cur, anchor];
  return [a.line, b.line > a.line && b.col === 0 ? b.line - 1 : b.line];
}

/** Moves lines l1..l2 one line up (dir -1) or down (+1); null at the file's edge. */
export function moveLines(lines, l1, l2, dir, anchor, cur) {
  if (dir < 0 ? l1 === 0 : l2 + 1 >= lines.length) return null;
  const sel = { anchor: shift(anchor, dir), cur: shift(cur, dir) };
  return dir < 0
    ? { from: { line: l1 - 1, col: 0 }, to: end(lines, l2), text: block(lines, l1, l2) + "\n" + body(lines[l1 - 1]), ...sel }
    : { from: { line: l1, col: 0 }, to: end(lines, l2 + 1), text: body(lines[l2 + 1]) + "\n" + block(lines, l1, l2), ...sel };
}

/** Copies lines l1..l2 below themselves (dir +1, the cursor goes with the copy) or above (-1, it stays). */
export function copyLines(lines, l1, l2, dir, anchor, cur) {
  const n = l2 - l1 + 1, at = end(lines, l2);
  return { from: at, to: at, text: "\n" + block(lines, l1, l2), anchor: dir > 0 ? shift(anchor, n) : anchor, cur: dir > 0 ? shift(cur, n) : cur };
}

/** Deletes lines l1..l2; the cursor keeps its column on the line that takes their place. */
export function deleteLines(lines, l1, l2, cur) {
  if (l2 + 1 < lines.length) return { from: { line: l1, col: 0 }, to: { line: l2 + 1, col: 0 }, text: "", anchor: null, cur: { line: l1, col: cur.col } };
  if (l1 > 0) return { from: end(lines, l1 - 1), to: end(lines, l2), text: "", anchor: null, cur: { line: l1 - 1, col: cur.col } };
  return { from: { line: 0, col: 0 }, to: end(lines, l2), text: "", anchor: null, cur: { line: 0, col: 0 } };
}

/** Joins lines l1..l2 (one line: with the next) with single spaces, dropping the joined lines' indent. */
export function joinLines(lines, l1, l2) {
  if (l1 === l2) l2 = l1 + 1;
  if (l2 >= lines.length) return null;
  let text = body(lines[l1]).replace(/\s+$/, "");
  let col = text.length;
  for (let l = l1 + 1; l <= l2; l++) {
    const next = body(lines[l]).trim();
    col = text.length;
    if (next) text += (text && !/[\s([{]$/.test(text) && !/^[)\]}]/.test(next) ? " " : "") + next;
  }
  return { from: { line: l1, col: 0 }, to: end(lines, l2), text, anchor: null, cur: { line: l1, col: Math.min(col, text.length) } };
}

// Line comment tokens by file extension; [open, close] for languages with only block comments.
const SLASH = "js jsx mjs cjs ts tsx mts cts c h cc cpp hpp cxx cs csx java kt kts go rs swift scala dart php jsonc json5 scss less groovy gradle proto fs";
const HASH = "py sh bash zsh fish ps1 psm1 rb pl r yml yaml toml ini cfg conf env properties tf hcl mk makefile dockerfile containerfile cmake nix gitignore dockerignore editorconfig";
const DASH = "sql lua hs elm ada";
const TOKENS = {};
for (const e of SLASH.split(" ")) TOKENS[e] = "//";
for (const e of HASH.split(" ")) TOKENS[e] = "#";
for (const e of DASH.split(" ")) TOKENS[e] = "--";
for (const e of "html htm xhtml xml svg vue md markdown mdx".split(" ")) TOKENS[e] = ["<!--", "-->"];
for (const e of "css".split(" ")) TOKENS[e] = ["/*", "*/"];
TOKENS.bat = TOKENS.cmd = "REM";
TOKENS.vim = '"';
TOKENS.ini = ";";

/** The comment syntax for a path: a line token, [open, close], or null when unknown. */
export function commentFor(path) {
  const name = path.split("/").pop().toLowerCase();
  if (/^(dockerfile|containerfile|makefile)$/.test(name) || /^\.env(\..+)?$/.test(name)) return "#";
  return TOKENS[name.split(".").pop()] ?? null;
}

/**
 * Comments lines l1..l2 out, or back in when every non-blank one already is. Line tokens go
 * after the shallowest indent so the block stays aligned; block tokens wrap each line.
 */
export function toggleComment(lines, l1, l2, token, anchor, cur) {
  if (!token) return null;
  const [open, close] = Array.isArray(token) ? token : [token, ""];
  const texts = lines.slice(l1, l2 + 1).map(body), filled = texts.filter((t) => t.trim());
  if (!filled.length) return null;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(\\s*)${esc(open)} ?(.*?)${close ? ` ?${esc(close)}` : ""}$`);
  const on = filled.every((t) => re.test(t));
  const indent = Math.min(...filled.map((t) => /^\s*/.exec(t)[0].length));
  const out = texts.map((t) => {
    if (!t.trim()) return t;
    if (on) return t.replace(re, "$1$2");
    return t.slice(0, indent) + open + " " + t.slice(indent) + (close ? " " + close : "");
  });
  // The cursor keeps its place in the text: it shifts by the token added or removed before it.
  const moved = (p) => {
    if (!p || p.line < l1 || p.line > l2) return p;
    const before = texts[p.line - l1], after = out[p.line - l1];
    if (before === after) return p;
    let at, d;
    if (on) {
      const lead = /^\s*/.exec(before)[0].length;
      at = lead; d = -(open.length + (before[lead + open.length] === " " ? 1 : 0));
    } else { at = indent; d = open.length + 1; }
    const col = p.col < at ? p.col : Math.max(at, p.col + d);
    return { line: p.line, col: Math.min(col, after.length) };
  };
  return { from: { line: l1, col: 0 }, to: end(lines, l2), text: out.join("\n"), anchor: moved(anchor), cur: moved(cur) };
}
