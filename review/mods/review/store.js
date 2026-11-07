// Review store on disk: <git-dir>/claude-review/{index.json, baselines/*}.
// Every write is compare-and-swap (writeTextFile's `expected`), so a file that
// changed since it was read is never overwritten; the action fails instead.
import { exec, readTextFile, writeTextFile } from "herdr";
import { splitLines, parseHunks, wholeHunk } from "./model.js";

const isWindows = (p) => /^[A-Za-z]:/.test(p);
export const norm = (p) => { const s = p.replace(/\\/g, "/").replace(/^\/\/\?\//, ""); return isWindows(s) ? s.toLowerCase() : s; };

async function remove(path) {
  const r = isWindows(path)
    ? await exec("cmd", ["/c", "del", "/f", "/q", path.replace(/\//g, "\\")])
    : await exec("rm", ["-f", "--", path]);
  if (r.code !== 0) throw new Error(`delete ${path}: ${(r.stderr || r.stdout).trim()}`);
}

/** Creates a folder and its parents. Mods may only write under ~/.config/herdr-app through
 *  fs/promises, so folders inside a repo are made by the OS's own mkdir. */
export async function ensureDir(path) {
  const win = isWindows(path);
  const r = win ? await exec("cmd", ["/c", "mkdir", path.replace(/\//g, "\\")]) : await exec("mkdir", ["-p", "--", path]);
  // cmd's mkdir creates parents but fails when the folder exists, which is fine here.
  if (r.code !== 0 && !(win && /already exists/i.test(r.stderr + r.stdout))) throw new Error(`mkdir ${path}: ${(r.stderr || r.stdout).trim()}`);
}

/** Writes `after` over a file whose content must still be `before` (null = absent). */
export async function swap(path, before, after) {
  const now = await readTextFile(path);
  if (now !== before) throw new Error(`${path} changed since it was read; reload and try again`);
  if (after === null) await remove(path);
  else await writeTextFile(path, after, before);
  return { path, before, after };
}

export class Store {
  static async open(root) {
    // Any folder inside the repo works: the store opens at the top level, where git's paths start.
    const r = await exec("git", ["rev-parse", "--show-toplevel", "--absolute-git-dir"], { cwd: root });
    if (r.code !== 0) throw new Error(`not a git repository: ${root}`);
    const [top, gitDir] = r.stdout.trim().split(/\r?\n/).map((s) => s.trim().replace(/\\/g, "/"));
    return new Store(top, gitDir);
  }

  constructor(root, gitDir) {
    this.root = root; this.gitDir = gitDir; this.dir = `${gitDir}/claude-review`;
  }

  /**
   * What a batch of watched paths means: "all" (the index changed or the batch
   * overflowed to the root), else the set of reviewed files (relative paths) touched.
   */
  touched(paths) {
    const root = norm(this.root), git = norm(this.gitDir) + "/", index = norm(`${this.dir}/index.json`);
    const rels = new Set();
    for (const p of paths) {
      const n = norm(p);
      if (n === index || n === root) return "all";
      if (!n.startsWith(git) && n.startsWith(root + "/")) rels.add(n.slice(root.length + 1));
    }
    return rels;
  }

  async index() {
    const text = await readTextFile(`${this.dir}/index.json`);
    return text ? JSON.parse(text).files ?? {} : {};
  }

  /** Loads one file: baseline B, current C (null if deleted), and its hunks. */
  async load(rel, entry) {
    const basePath = `${this.dir}/baselines/${entry.baseline}`, path = `${this.root}/${rel}`;
    const [b, c] = await Promise.all([readTextFile(basePath), readTextFile(path)]);
    const Btext = b ?? "", B = splitLines(Btext), C = splitLines(c ?? "");
    let hunks;
    if (!B.length || !C.length) hunks = wholeHunk(B, C);
    else if (Btext === c) hunks = [];
    else {
      const d = await exec("git", ["diff", "--no-index", "--no-color", "--no-ext-diff", "--no-textconv", "-U0",
        "--diff-algorithm=minimal", "--", basePath, path], { cwd: this.root });
      if (d.code > 1) throw new Error(d.stderr.trim());
      hunks = parseHunks(d.stdout);
    }
    return { rel, path, basePath, created: !!entry.created, by: entry.by ?? null, as: entry.as ?? null, store: this, key: `${this.root}|${rel}`, Btext, Ctext: c, B, C, hunks };
  }

  async files() {
    const index = await this.index(), out = [];
    for (const [rel, entry] of Object.entries(index)) {
      try { out.push(await this.load(rel, entry)); }
      catch (e) { out.push({ rel, store: this, key: `${this.root}|${rel}`, error: String(e.message ?? e), hunks: [] }); }
    }
    return out;
  }

  /** Applies one model write ({ target, before, after }) to disk; returns it with its path. */
  async apply(f, w) {
    const path = w.target === "baseline" ? f.basePath : f.path;
    await swap(path, w.before, w.after);
    return { path, before: w.before, after: w.after };
  }

  /** Reverts writes made by `apply`, newest first. */
  async undo(writes) {
    for (const w of [...writes].reverse()) await swap(w.path, w.after, w.before);
  }
}
