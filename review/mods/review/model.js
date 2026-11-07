// Pure diff model: no Herdr imports, so it can be tested outside the app.
// A file is reviewed as baseline (B) -> current (C). Lines keep their own
// endings ("\n" or "\r\n"), so splicing lines never changes a file's line endings.

/** Splits text into lines that keep their terminators. "" -> []. */
export function splitLines(text) {
  if (!text) return [];
  return text.match(/[^\n]*\n|[^\n]+$/g);
}

/**
 * Hunks from `git diff -U0` output, as 0-based splice ranges:
 * { o, oc, n, nc } = baseline lines [o, o+oc) became current lines [n, n+nc).
 */
export function parseHunks(diff) {
  const hunks = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const a = +m[1], b = m[2] === undefined ? 1 : +m[2], c = +m[3], d = m[4] === undefined ? 1 : +m[4];
    hunks.push({ o: b === 0 ? a : a - 1, oc: b, n: d === 0 ? c : c - 1, nc: d });
  }
  return hunks;
}

/** The one hunk for a file that is new (B empty) or deleted (C empty). */
export function wholeHunk(B, C) {
  return B.length || C.length ? [{ o: 0, oc: B.length, n: 0, nc: C.length }] : [];
}

/** Accepting a hunk moves the baseline forward: B takes C's lines for that range. */
export function acceptHunk(B, C, h) {
  return [...B.slice(0, h.o), ...C.slice(h.n, h.n + h.nc), ...B.slice(h.o + h.oc)];
}

/** Rejecting a hunk puts the baseline's lines back into the current file. */
export function rejectHunk(B, C, h) {
  return [...C.slice(0, h.n), ...B.slice(h.o, h.o + h.oc), ...C.slice(h.n + h.nc)];
}

// In-memory actions on a file state { B, C, Btext, Ctext, hunks, oldTok?, newTok?, created }.
// Each returns { state, write } where write = { target: "baseline" | "current", before, after }
// (after null = delete the file). Remaining hunks are shifted, not re-diffed, so an action
// costs no git call; the shifted hunks still turn the new baseline into the current file.
const text = (lines) => lines.join("");
const splice = (a, at, del, ins) => a && [...a.slice(0, at), ...ins, ...a.slice(at + del)];

export function acceptAt(s, i) {
  const h = s.hunks[i], d = h.nc - h.oc;
  const B = acceptHunk(s.B, s.C, h);
  const hunks = s.hunks.filter((_, j) => j !== i).map((x, j) => (j >= i ? { ...x, o: x.o + d } : x));
  const oldTok = s.oldTok && splice(s.oldTok, h.o, h.oc, s.newTok.slice(h.n, h.n + h.nc));
  return { state: { ...s, B, Btext: text(B), hunks, oldTok }, write: { target: "baseline", before: s.Btext, after: text(B) } };
}

export function rejectAt(s, i) {
  const h = s.hunks[i], d = h.oc - h.nc;
  const C = rejectHunk(s.B, s.C, h);
  const hunks = s.hunks.filter((_, j) => j !== i).map((x, j) => (j >= i ? { ...x, n: x.n + d } : x));
  const newTok = s.newTok && splice(s.newTok, h.n, h.nc, s.oldTok.slice(h.o, h.o + h.oc));
  return { state: { ...s, C, Ctext: text(C), hunks, newTok }, write: { target: "current", before: s.Ctext, after: text(C) } };
}

export function acceptAll(s) {
  const after = s.Ctext ?? "";
  return { state: { ...s, B: s.C, Btext: after, hunks: [], oldTok: s.newTok }, write: { target: "baseline", before: s.Btext, after } };
}

/** A created file is deleted; anything else gets its baseline back. */
export function rejectAll(s) {
  const after = s.created ? null : s.Btext;
  return { state: { ...s, C: s.created ? [] : s.B, Ctext: after, hunks: [], newTok: s.oldTok }, write: { target: "current", before: s.Ctext, after } };
}

// ---- partial actions: only some lines of some hunks -----------------------------

/** Hunks between two short line arrays (LCS), as offsets from `o0` / `n0`. */
export function segmentHunks(X, Y, o0, n0) {
  const m = X.length, n = Y.length, L = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
    L[i][j] = X[i] === Y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  while (i < m || j < n) {
    if (i < m && j < n && X[i] === Y[j]) { flush(); i++; j++; continue; }
    cur ??= { o: o0 + i, oc: 0, n: n0 + j, nc: 0 };
    if (j < n && (i === m || L[i][j + 1] >= L[i + 1][j])) { cur.nc++; j++; } else { cur.oc++; i++; }
  }
  flush();
  return out;
}

/**
 * Accepts or rejects only the picked lines: `pick.old` holds baseline line indexes (removed
 * lines), `pick.new` current line indexes (added lines). Accepting moves those into the
 * baseline; rejecting puts them back to the baseline in the current file. The rest of each
 * touched hunk stays pending, re-diffed within the hunk only (no git call). Same return shape
 * as acceptAt / rejectAt.
 */
export function partialAt(s, how, pick) {
  const accept = how === "accept";
  const B = [], C = [], oldTok = s.oldTok && [], newTok = s.newTok && [], hunks = [];
  let bi = 0, ci = 0;
  const copyB = (to) => { for (; bi < to; bi++) { B.push(s.B[bi]); oldTok?.push(s.oldTok[bi]); } };
  const copyC = (to) => { for (; ci < to; ci++) { C.push(s.C[ci]); newTok?.push(s.newTok[ci]); } };
  for (const h of s.hunks) {
    copyB(h.o); copyC(h.n);
    const R = [], A = [];
    for (let k = h.o; k < h.o + h.oc; k++) R.push(k);
    for (let k = h.n; k < h.n + h.nc; k++) A.push(k);
    const touched = R.some((k) => pick.old.has(k)) || A.some((k) => pick.new.has(k));
    if (!touched) {
      hunks.push({ o: B.length, oc: h.oc, n: C.length, nc: h.nc });
      copyB(h.o + h.oc); copyC(h.n + h.nc);
      continue;
    }
    // New segment for the side that changes; the other side keeps its lines.
    const seg = accept
      ? [...R.filter((k) => !pick.old.has(k)).map((k) => ["B", k]), ...A.filter((k) => pick.new.has(k)).map((k) => ["C", k])]
      : [...R.filter((k) => pick.old.has(k)).map((k) => ["B", k]), ...A.filter((k) => !pick.new.has(k)).map((k) => ["C", k])];
    const line = ([side, k]) => (side === "B" ? s.B[k] : s.C[k]);
    const tok = ([side, k]) => (side === "B" ? s.oldTok?.[k] : s.newTok?.[k]);
    const o0 = B.length, n0 = C.length;
    if (accept) {
      for (const e of seg) { B.push(line(e)); oldTok?.push(tok(e)); }
      bi = h.o + h.oc; copyC(h.n + h.nc);
      hunks.push(...segmentHunks(seg.map(line), A.map((k) => s.C[k]), o0, n0));
    } else {
      for (const e of seg) { C.push(line(e)); newTok?.push(tok(e)); }
      ci = h.n + h.nc; copyB(h.o + h.oc);
      hunks.push(...segmentHunks(R.map((k) => s.B[k]), seg.map(line), o0, n0));
    }
  }
  copyB(s.B.length); copyC(s.C.length);
  if (oldTok) for (let k = s.B.length; k < s.oldTok.length; k++) oldTok.push(s.oldTok[k]);
  if (newTok) for (let k = s.C.length; k < s.newTok.length; k++) newTok.push(s.newTok[k]);
  const next = { ...s, hunks };
  if (accept) Object.assign(next, { B, Btext: text(B), oldTok });
  else Object.assign(next, { C, Ctext: text(C), newTok });
  const write = accept ? { target: "baseline", before: s.Btext, after: next.Btext } : { target: "current", before: s.Ctext, after: next.Ctext };
  return { state: next, write };
}

/**
 * Display rows for the whole file: context and added lines from C, removed
 * lines from B, and a button row ("@") after each hunk.
 */
export function rows(B, C, hunks) {
  const out = [];
  let ci = 0;
  const ctx = (to) => { for (; ci < to; ci++) out.push({ kind: " ", num: ci + 1, side: "new", line: ci }); };
  hunks.forEach((h, i) => {
    ctx(h.n);
    for (let k = 0; k < h.oc; k++) out.push({ kind: "-", num: h.o + k + 1, side: "old", line: h.o + k, hunk: i });
    for (let k = 0; k < h.nc; k++) out.push({ kind: "+", num: h.n + k + 1, side: "new", line: h.n + k, hunk: i });
    out.push({ kind: "@", hunk: i });
    ci = h.n + h.nc;
  });
  ctx(C.length);
  return out;
}
