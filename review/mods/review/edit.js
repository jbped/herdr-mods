// Pure text editing on a reviewed file: no Herdr imports, so it can be tested outside the app.
// The cursor lives in the current file C: { line, col }, col counted in characters of the
// line without its terminator. Removed lines (baseline only) are never edited.
//
// What an edit does to the review (Q41):
// - inside one change's added lines: C only, and the change stays pending with the new text;
// - on unchanged lines only: B and C alike, so the user's own edit is never reviewed;
// - across a change and unchanged lines: C only, and that region is re-diffed, so its
//   unchanged part shows as pending too.
import { segmentHunks } from "./model.js";

export const body = (l) => (l ?? "").replace(/\r?\n$/, "");
const term = (l) => l.slice(body(l).length);
const LCS_CAP = 4e6; // cells; a bigger region becomes one change instead of being re-diffed

/** The file's line ending: CRLF when its first terminated line uses it. */
export function eolOf(lines) {
  const l = lines.find((x) => x.endsWith("\n"));
  return l?.endsWith("\r\n") ? "\r\n" : "\n";
}

export const cmp = (a, b) => a.line - b.line || a.col - b.col;

/** The current file's lines as edited: an empty file is one empty line. */
export const linesOf = (s) => (s.C.length ? s.C : [""]);

/**
 * Replaces the text between positions `a` and `b` of C with `text`.
 * `tokLines(lines)` highlights the new lines (an array of span arrays per line).
 * Returns { state, cursor } with cursor at the end of the inserted text.
 */
export function edit(s, a, b, text, tokLines = null) {
  if (cmp(a, b) > 0) [a, b] = [b, a];
  const C = linesOf(s), eol = eolOf(s.C.length ? s.C : s.B);
  const l1 = a.line, l2 = b.line;
  const head = body(C[l1]).slice(0, a.col), tail = body(C[l2]).slice(b.col), endTerm = term(C[l2]);
  const parts = (head + text.replace(/\r\n?/g, "\n") + tail).split("\n");
  const K = parts.map((p, i) => (i < parts.length - 1 ? p + eol : p + endTerm));
  let cursor = { line: l1 + parts.length - 1, col: parts[parts.length - 1].length - tail.length };
  // An empty last line without a terminator isn't a line: the file just ends after the one before.
  if (K[K.length - 1] === "") {
    K.pop();
    if (cursor.line >= l1 + K.length) cursor = K.length ? { line: l1 + K.length - 1, col: body(K[K.length - 1]).length }
      : l1 > 0 ? { line: l1 - 1, col: body(C[l1 - 1]).length } : { line: 0, col: 0 };
  }
  const delta = K.length - (l2 - l1 + 1);
  const ktok = tokLines ? tokLines(K.map(body)) : null;

  const newC = [...C.slice(0, l1), ...K, ...C.slice(l2 + 1)];
  const newTok = s.newTok && ktok ? [...s.newTok.slice(0, l1), ...ktok, ...s.newTok.slice(l2 + 1)] : s.newTok;
  const hs = s.hunks;
  const inAdded = (l) => hs.findIndex((h) => l >= h.n && l < h.n + h.nc);
  const touches = (h) => (h.nc > 0 ? h.n <= l2 && h.n + h.nc > l1 : h.n > l1 && h.n <= l2);
  const k1 = inAdded(l1), k2 = inAdded(l2);
  const done = (extra) => ({ state: { ...s, C: newC, Ctext: newC.join(""), newTok, ...extra }, cursor });

  // Inside one change's added lines.
  if (k1 >= 0 && k1 === k2) {
    return done({ hunks: hs.map((h, j) => (j === k1 ? { ...h, nc: h.nc + delta } : j > k1 ? { ...h, n: h.n + delta } : h)) });
  }

  // Unchanged lines only: the baseline takes the same edit.
  if (k1 < 0 && k2 < 0 && !hs.some(touches)) {
    const D = hs.filter((h) => h.n <= l1).reduce((d, h) => d + h.nc - h.oc, 0), b1 = l1 - D;
    const B = [...s.B.slice(0, b1), ...K, ...s.B.slice(b1 + l2 - l1 + 1)];
    const oldTok = s.oldTok && ktok ? [...s.oldTok.slice(0, b1), ...ktok, ...s.oldTok.slice(b1 + l2 - l1 + 1)] : s.oldTok;
    const hunks = hs.map((h) => (h.n > l2 ? { ...h, o: h.o + delta, n: h.n + delta } : h));
    return done({ B, Btext: B.join(""), oldTok, hunks });
  }

  // Across a change and unchanged lines: re-diff the region the edit and its changes cover.
  const touched = hs.filter(touches), rest = hs.filter((h) => !touches(h));
  const cs = Math.min(l1, ...touched.map((h) => h.n)), ce = Math.max(l2 + 1, ...touched.map((h) => h.n + h.nc));
  const before = rest.filter((h) => h.n <= cs && (h.nc === 0 || h.n + h.nc <= cs)), after = rest.filter((h) => !before.includes(h));
  const D = before.reduce((d, h) => d + h.nc - h.oc, 0), Dt = D + touched.reduce((d, h) => d + h.nc - h.oc, 0);
  const bs = cs - D, be = ce - Dt;
  const X = s.B.slice(bs, be), Y = newC.slice(cs, ce + delta);
  const region = X.length * Y.length <= LCS_CAP ? segmentHunks(X, Y, bs, cs)
    : [{ o: bs, oc: X.length, n: cs, nc: Y.length }];
  return done({ hunks: [...before, ...region, ...after.map((h) => ({ ...h, n: h.n + delta }))] });
}

/** Throws unless `hunks` turn B into C: the lines between them must match. */
export function check(s) {
  let o = 0, n = 0;
  for (const h of s.hunks) {
    if (h.o < o || h.n < n || h.o - o !== h.n - n) throw new Error(`hunk out of place ${JSON.stringify(h)} after o=${o} n=${n}`);
    for (let k = 0; k < h.o - o; k++) if (s.B[o + k] !== s.C[n + k]) throw new Error(`context differs at B${o + k}/C${n + k}`);
    o = h.o + h.oc; n = h.n + h.nc;
  }
  if (s.B.length - o !== s.C.length - n) throw new Error("tail length differs");
  for (let k = 0; o + k < s.B.length; k++) if (s.B[o + k] !== s.C[n + k]) throw new Error(`tail differs at B${o + k}`);
  if (s.Ctext !== s.C.join("") || s.Btext !== s.B.join("")) throw new Error("text out of sync");
}

// ---- cursor movement ---------------------------------------------------------

const word = (ch) => /[\w$]/.test(ch);

/** The position one word left or right of `p`, as ctrl+arrow moves. */
export function wordMove(lines, p, dir) {
  let { line, col } = p;
  const t = body(lines[line]);
  if (dir < 0) {
    if (col === 0) return line > 0 ? { line: line - 1, col: body(lines[line - 1]).length } : p;
    while (col > 0 && /\s/.test(t[col - 1])) col--;
    const w = col > 0 && word(t[col - 1]);
    while (col > 0 && !/\s/.test(t[col - 1]) && word(t[col - 1]) === w) col--;
    return { line, col };
  }
  if (col >= t.length) return line < lines.length - 1 ? { line: line + 1, col: 0 } : p;
  while (col < t.length && /\s/.test(t[col])) col++;
  const w = col < t.length && word(t[col]);
  while (col < t.length && !/\s/.test(t[col]) && word(t[col]) === w) col++;
  return { line, col };
}

/** The word around `p`, for a double-click. */
export function wordAt(lines, p) {
  const t = body(lines[p.line]);
  let a = p.col, b = p.col;
  if (!word(t[a] ?? "") && word(t[a - 1] ?? "")) a = b = a - 1;
  if (!word(t[a] ?? "")) return [p, { line: p.line, col: Math.min(t.length, p.col + 1) }];
  while (a > 0 && word(t[a - 1])) a--;
  while (b < t.length && word(t[b])) b++;
  return [{ line: p.line, col: a }, { line: p.line, col: b }];
}

/** The text between two positions. */
export function textBetween(lines, a, b) {
  if (cmp(a, b) > 0) [a, b] = [b, a];
  if (a.line === b.line) return body(lines[a.line]).slice(a.col, b.col);
  const out = [body(lines[a.line]).slice(a.col) + term(lines[a.line])];
  for (let l = a.line + 1; l < b.line; l++) out.push(lines[l]);
  out.push(body(lines[b.line]).slice(0, b.col));
  return out.join("").replace(/\r\n/g, "\n");
}

/** The indent unit a file uses: a tab, else its smallest space indent (2 or 4). */
export function indentUnit(lines) {
  let min = 0;
  for (const l of lines) {
    const m = /^( +|\t)\S/.exec(l);
    if (!m) continue;
    if (m[1] === "\t") return "\t";
    if (!min || m[1].length < min) min = m[1].length;
  }
  return min >= 4 ? "    " : "  ";
}

// ---- tabs as columns -------------------------------------------------------

export const TAB = 4;

/** The display column of character `col` in `text`, with tabs to the next stop. */
export function visualCol(text, col) {
  let v = 0;
  for (let i = 0; i < col && i < text.length; i++) v = text[i] === "\t" ? v + TAB - (v % TAB) : v + 1;
  return v + Math.max(0, col - text.length);
}

/** The character index nearest display column `v`. */
export function charAt(text, v) {
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const w = text[i] === "\t" ? TAB - (x % TAB) : 1;
    if (v < x + w / 2) return i;
    x += w;
  }
  return text.length;
}

/** Spans with tabs turned into spaces up to the next tab stop. */
export function expandTabs(spans) {
  let x = 0;
  return spans.map((s) => {
    if (!s.text.includes("\t")) { x += s.text.length; return s; }
    let out = "";
    for (const ch of s.text) {
      if (ch === "\t") { const w = TAB - (x % TAB); out += " ".repeat(w); x += w; } else { out += ch; x++; }
    }
    return { ...s, text: out };
  });
}
