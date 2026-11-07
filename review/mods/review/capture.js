// Generic capture, for any agent: while an agent in the space is working, files that
// differ from the working-tree snapshot taken when it started become reviewable, with
// their snapshot content as the baseline. Uses only git and Herdr's file APIs.
import { exec, readTextFile, writeTextFile, appHome } from "herdr";

const isWindows = (p) => /^[A-Za-z]:/.test(p);

/**
 * A terminal's folder as this machine's git sees it. Herdr on Windows reports WSL
 * folders as /mnt/c/... or \\wsl.localhost\<distro>\mnt\c\...; both become C:/...
 */
export function hostPath(cwd) {
  if (!cwd) return null;
  let p = cwd.replace(/\\/g, "/");
  const unc = /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+(\/.*)$/i.exec(p);
  if (unc) p = unc[1];
  const mnt = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p);
  if (mnt && isWindows(appHome())) p = `${mnt[1].toUpperCase()}:${mnt[2] ?? "/"}`;
  return p;
}

export class Capture {
  constructor(store) { this.store = store; }

  /** Tree id of the working tree right now (index copy + add -A + write-tree). */
  async snapshot() {
    const { gitDir, root } = this.store, dir = `${appHome()}/mods/review`;
    const r = isWindows(root)
      ? await exec("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${dir}/snapshot.ps1`, gitDir, root])
      : await exec("sh", [`${dir}/snapshot.sh`, gitDir, root]);
    const tree = r.stdout.trim().split(/\s+/).pop();
    if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(tree ?? "")) throw new Error(`snapshot failed: ${(r.stderr || r.stdout).trim()}`);
    return tree;
  }

  /** Paths that differ between two trees, with git's status letter (A, M, D, T). */
  async changed(from, to) {
    if (from === to) return [];
    const r = await exec("git", ["diff-tree", "-r", "--no-renames", "--name-status", "-z", from, to], { cwd: this.store.root });
    if (r.code !== 0) throw new Error(r.stderr.trim());
    const parts = r.stdout.split("\0").filter(Boolean), out = [];
    for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i][0], path: parts[i + 1] });
    return out;
  }

  /** Saved capture state: the snapshot tree of the current working period, if any. */
  async state() {
    const t = await readTextFile(`${this.store.dir}/capture.json`);
    return t ? JSON.parse(t) : { tree: null };
  }

  async setState(next) {
    const path = `${this.store.dir}/capture.json`;
    await writeTextFile(path, JSON.stringify(next, null, 2) + "\n", await readTextFile(path));
  }

  /**
   * Adds files that changed since `base` to the review index, each with its content in
   * `base` as baseline (empty and `created` for new files). Files already under review
   * keep their baseline, so the review stays a net diff. Returns how many were added.
   * `by`: the terminal to credit (the one Claude working in the space), or null.
   */
  async adopt(base, now, by = null) {
    const changes = await this.changed(base, now);
    if (!changes.length) return 0;
    const indexPath = `${this.store.dir}/index.json`, before = await readTextFile(indexPath);
    const index = before ? JSON.parse(before) : { version: 1, files: {} };
    let added = 0;
    for (const { status, path } of changes) {
      if (index.files[path]) continue;
      const created = status === "A";
      let text = "";
      if (!created) {
        const r = await exec("git", ["cat-file", "blob", `${base}:${path}`], { cwd: this.store.root });
        if (r.code !== 0 || r.stdout.includes("\0")) continue; // unreadable or binary: not reviewed
        text = r.stdout;
        // With autocrlf the stored blob is LF even when the file on disk was CRLF. Git's own
        // checkout filters guess from config, not from the disk, so instead match the line
        // endings the file has now: an agent rarely changes a file's line-ending style.
        const current = await readTextFile(`${this.store.root}/${path}`);
        if (current?.includes("\r\n") && !text.includes("\r")) text = text.replace(/\n/g, "\r\n");
      }
      const name = `b${Date.now().toString(36)}-${added}.txt`;
      await writeTextFile(`${this.store.dir}/baselines/${name}`, text, null);
      index.files[path] = by ? { baseline: name, created, by } : { baseline: name, created };
      added++;
    }
    if (added) await writeTextFile(indexPath, JSON.stringify(index, null, 2) + "\n", before);
    return added;
  }
}
