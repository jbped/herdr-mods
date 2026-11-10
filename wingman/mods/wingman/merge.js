// Three-way merge of an agent's write into unsaved edits, and the diff of merged texts.
// Both run git on temporary copies under data/wingman/tmp, removed afterwards.
import * as fs from "fs/promises";
import { writeTextFile } from "herdr";
import { git } from "./git.js";
import { parseHunks, splitLines, wholeHunk, segmentHunks } from "./model.js";
import { reviewDir } from "./journal.js";

let seq = 0;
async function withTemps(texts, run) {
  const dir = `${reviewDir()}/tmp`;
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const id = `${Date.now()}-${seq++}`, paths = texts.map((_, i) => `${dir}/${id}-${i}`);
  try {
    for (let i = 0; i < texts.length; i++) await writeTextFile(paths[i], texts[i], null);
    return await run(paths);
  } finally { for (const p of paths) await fs.unlink(p).catch(() => {}); }
}

/**
 * Merges `theirs` (now on disk) and `mine` (unsaved edits), both made from `base`.
 * `favor` is "ours" or "theirs" for overlapping lines, or null to report them.
 * Returns { text, conflicts }; with favor null and conflicts > 0, text holds git's markers.
 */
export async function merge3(base, mine, theirs, favor = null) {
  if (mine === base || mine === theirs) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: mine, conflicts: 0 };
  return withTemps([mine, base, theirs], async ([m, b, t]) => {
    const r = await git(["merge-file", "-p", ...(favor ? [`--${favor}`] : []), m, b, t]);
    if (r.code < 0 || r.code > 127) throw new Error(`git merge-file: ${(r.stderr || r.stdout).trim()}`);
    return { text: r.stdout, conflicts: r.code };
  });
}

/** Hunks turning Btext into Ctext, as Store.load computes them. */
export async function diffHunks(Btext, Ctext) {
  const B = splitLines(Btext), C = splitLines(Ctext);
  if (!B.length || !C.length) return wholeHunk(B, C);
  if (Btext === Ctext) return [];
  return withTemps([Btext, Ctext], async ([b, c]) => {
    const d = await git(["diff", "--no-index", "--no-color", "--no-ext-diff", "--no-textconv", "-U0", "--diff-algorithm=minimal", "--", b, c]);
    if (d.code > 1) throw new Error(d.stderr.trim());
    return parseHunks(d.stdout);
  });
}

const LCS_CAP = 4e6;

/**
 * The line ranges of `after` that differ from `before`, as hunks ({ o, oc, n, nc }).
 * Common lines at both ends are trimmed first; a middle too large to diff is one range.
 */
export function changedRanges(before, after) {
  const X = splitLines(before), Y = splitLines(after);
  let p = 0, s = 0;
  while (p < X.length && p < Y.length && X[p] === Y[p]) p++;
  while (s < X.length - p && s < Y.length - p && X[X.length - 1 - s] === Y[Y.length - 1 - s]) s++;
  const x = X.slice(p, X.length - s), y = Y.slice(p, Y.length - s);
  if (!x.length && !y.length) return [];
  return x.length * y.length <= LCS_CAP ? segmentHunks(x, y, p, p) : [{ o: p, oc: x.length, n: p, nc: y.length }];
}

/** Where a cursor line moves when `before` becomes `after`: kept above the change, shifted below it. */
export function mapLine(line, before, after) {
  const r = changedRanges(before, after);
  let d = 0;
  for (const h of r) {
    if (line < h.o) break;
    if (line < h.o + h.oc) return h.n + Math.min(line - h.o, Math.max(h.nc - 1, 0));
    d = h.n + h.nc - (h.o + h.oc);
  }
  return line + d;
}
