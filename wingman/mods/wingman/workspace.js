// W1 workspaces: the repos one Herdr space reviews. Every workspace read and write goes through
// here, so a future Herdr space with several folders means changing this file only.
//
// A workspace is a VS Code `.code-workspace` file: {"folders": [{"path": "a"}, {"path": "../b",
// "name": "b"}], "settings": {}}. Paths are relative to the file or absolute. Wayfinder's Launch
// writes one into the Ticket folder (the space's folder), one worktree per repo. Wingman reads:
// 1. a `*.code-workspace` in the space folder (the one named after the folder, else the first),
// 2. else the one Wingman made for the space: data/wingman/workspaces/<space>.code-workspace.
// A space's repos are that file's folders, plus the repos its agents started in or edited
// (spaces.json, from the Claude hook), minus the ones removed by hand (hidden.json).
// Wingman's edits change only the "folders" array, keeping every other key, comment and order.
import * as fs from "fs/promises";
import { exec, readTextFile, writeTextFile, appHome } from "herdr";
import { git, toWsl, hostOf } from "./git.js";
import { hostPath } from "./capture.js";
import { spaceRepos } from "./journal.js";

const isWindows = (p) => /^[A-Za-z]:/.test(p);
const slash = (p) => p.replace(/\\/g, "/");
const same = (a, b) => { const x = slash(a).replace(/\/+$/, ""), y = slash(b).replace(/\/+$/, ""); return isWindows(x) || /^\/\//.test(x) ? x.toLowerCase() === y.toLowerCase() : x === y; };
const dataDir = () => `${appHome()}/data/wingman`;
export const EXT = ".code-workspace";

// ---- the file (pure) ----------------------------------------------------------------

/** JSON with comments and trailing commas (VS Code's format) as a value. Throws on bad JSON. */
export function parseJsonc(text) {
  let out = "", i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') { const end = stringEnd(text, i); out += text.slice(i, end); i = end; }
    else if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; }
    else if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 2; }
    else { out += ch; i++; }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function stringEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) { if (text[j] === "\\") j++; else if (text[j] === '"') return j + 1; }
  return text.length;
}

/** [start, end) of the top-level "folders" array in the file's text, or null. */
function foldersSpan(text) {
  let depth = 0, key = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { const end = stringEnd(text, i); if (depth === 1) key = text.slice(i + 1, end - 1); i = end - 1; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if (ch === "{" || ch === "[") {
      if (depth === 1 && ch === "[" && key === "folders") {
        // The matching "]".
        let d = 0;
        for (let j = i; j < text.length; j++) {
          const c = text[j];
          if (c === '"') { j = stringEnd(text, j) - 1; continue; }
          if (c === "/" && text[j + 1] === "/") { while (j < text.length && text[j] !== "\n") j++; continue; }
          if (c === "/" && text[j + 1] === "*") { const end = text.indexOf("*/", j + 2); j = end < 0 ? text.length : end + 1; continue; }
          if (c === "[" || c === "{") d++;
          else if ((c === "]" || c === "}") && --d === 0) return [i, j + 1];
        }
        return null;
      }
      depth++;
    } else if (ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 1) key = null;
  }
  return null;
}

/** The file's indent unit: a tab (VS Code's default) unless its lines are indented with spaces. */
const indentOf = (text) => /\n( +)\S/.exec(text ?? "")?.[1] ?? "\t";

const entry = (o) => `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;

/**
 * The file's text with "folders" set to `entries` ([{ path, name? , ...}]), every other byte kept.
 * `text` null (a new file): {"folders": [...], "settings": {}}.
 */
export function withFolders(text, entries) {
  const ind = indentOf(text);
  const arr = (lead) => entries.length ? `[\n${entries.map((e) => lead + ind + entry(e)).join(",\n")}\n${lead}]` : "[]";
  if (text == null) return `{\n${ind}"folders": ${arr(ind)},\n${ind}"settings": {}\n}\n`;
  const span = foldersSpan(text);
  if (span) {
    const lineStart = text.lastIndexOf("\n", span[0]) + 1, lead = /^\s*/.exec(text.slice(lineStart))[0];
    return text.slice(0, span[0]) + arr(lead) + text.slice(span[1]);
  }
  // No "folders" key: add it first in the object.
  const open = text.indexOf("{");
  if (open < 0) throw new Error("not a workspace file");
  const rest = text.slice(open + 1), empty = /^\s*}/.test(rest);
  return `${text.slice(0, open + 1)}\n${ind}"folders": ${arr(ind)}${empty ? "\n" : ","}${empty ? rest.replace(/^\s*/, "") : rest.replace(/^[ \t]*\n?/, "\n")}`;
}

/** The file to read in a folder's file names: the one named after the folder, else the first by name. */
export function pickFile(names, folderName) {
  const list = names.filter((n) => n.toLowerCase().endsWith(EXT)).sort();
  return list.find((n) => n.slice(0, -EXT.length).toLowerCase() === folderName.toLowerCase()) ?? list[0] ?? null;
}

const isAbs = (p) => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p);

/** `rel` joined to `dir`, with "." and ".." resolved. */
export function joinPath(dir, rel) {
  const s = slash(rel);
  if (isAbs(s)) return s;
  const head = /^(\/\/[^/]+\/[^/]+|[A-Za-z]:|)/.exec(slash(dir))[0];
  const parts = slash(dir).slice(head.length).split("/").filter(Boolean);
  for (const p of s.split("/")) { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); }
  return `${head}/${parts.join("/")}`;
}

/** How the file at `fileDir` names `path`: relative when it's inside that folder, else absolute. */
export function relTo(fileDir, path) {
  const d = slash(fileDir).replace(/\/+$/, ""), p = slash(path);
  if (same(p, d)) return ".";
  return same(p.slice(0, d.length), d) && p[d.length] === "/" ? p.slice(d.length + 1) : p;
}

/** The workspace's folders: [{ path (as this machine opens it), name, i (index in the file) }]. */
export function foldersOf(text, fileDir, toHost = (p) => p) {
  const data = parseJsonc(text);
  if (!Array.isArray(data?.folders)) return [];
  return data.folders.map((f, i) => ({ f, i })).filter(({ f }) => typeof f?.path === "string" && f.path.trim())
    .map(({ f, i }) => ({ path: toHost(joinPath(fileDir, f.path.trim())), name: typeof f.name === "string" && f.name.trim() ? f.name.trim() : null, i }));
}

/** The branch every worktree in `branches` is on, or null (none, or they differ). */
export function sharedBranch(branches) {
  const b = branches.filter((x) => x && x !== "HEAD");
  return b.length && b.every((x) => x === b[0]) ? b[0] : null;
}

/** Where a new worktree for `repo` goes: beside the others when they share a parent folder, else null. */
export function worktreeDest(worktrees, repo) {
  const parents = worktrees.map((p) => slash(p).replace(/\/[^/]+\/?$/, ""));
  return parents.length && parents.every((p) => same(p, parents[0])) ? `${parents[0]}/${repo}` : null;
}

// ---- the file on disk ----------------------------------------------------------------

/** A folder's entry names. fs/promises first; the OS's own listing where a mod can't read. */
export async function listDir(dir) {
  try { return await fs.readdir(dir); } catch {}
  const p = slash(dir);
  const r = /^\/\/(?:wsl\.localhost|wsl\$)\//i.test(p) ? await exec("wsl.exe", ["-e", "ls", "-1A", "--", toWsl(p)])
    : isWindows(p) ? (/[&|<>^%!"\r\n]/.test(p) ? { code: 1 } : await exec("cmd", ["/d", "/c", "dir", "/b", "/a", p.replace(/\//g, "\\")]))
    : await exec("ls", ["-1A", "--", p]);
  return r.code === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [];
}

/** The space's folder as this machine opens it, or null (none, or the home folder). */
export function spaceFolder(sp) {
  const f = sp?.folder ? hostPath(sp.folder)?.replace(/\/+$/, "") : null;
  // The home folder is where a space with no folder of its own starts: it's no workspace's folder.
  const home = slash(appHome()).replace(/\/\.config\/herdr-app\/?$/, "");
  return f && f !== "~" && !same(f, home) ? f : null;
}

const ownFile = (spaceId) => `${dataDir()}/workspaces/${spaceId.replace(/[^\w-]/g, "_")}${EXT}`;

const listCache = new Map(); // folder -> { at, names }
async function namesIn(dir) {
  const c = listCache.get(dir);
  if (c && Date.now() - c.at < 5000) return c.names;
  const names = await listDir(dir);
  listCache.set(dir, { at: Date.now(), names });
  return names;
}

/** The space's workspace file: { file, dir, text } or null when it has none. */
export async function findWorkspace(sp) {
  const folder = spaceFolder(sp);
  if (folder) {
    const name = pickFile(await namesIn(folder), folder.split("/").pop() ?? "");
    if (name) { const file = `${folder}/${name}`, text = await readTextFile(file); if (text != null) return { file, dir: folder, text }; }
  }
  const file = ownFile(sp.id), text = await readTextFile(file);
  return text != null ? { file, dir: file.replace(/\/[^/]+$/, ""), text } : null;
}

/** The workspace file's folders, or [] (no file, or it doesn't parse). */
export async function workspaceFolders(sp) {
  const ws = await findWorkspace(sp);
  if (!ws) return [];
  try { return foldersOf(ws.text, ws.dir, (p) => hostPath(p)); } catch { return []; }
}

/** Where a workspace Wingman makes for the space goes: its folder, unless that's inside a repo or home. */
async function newFile(sp) {
  const folder = spaceFolder(sp);
  if (folder && (await git(["rev-parse", "--show-toplevel"], { cwd: folder })).code !== 0) return `${folder}/${folder.split("/").pop()}${EXT}`;
  return ownFile(sp.id);
}

/**
 * Sets the workspace's folders through `change(entries, dir)` (returns the new entries). With no
 * workspace yet, makes one holding `start` first (the repos the space shows now), and only when
 * that leaves two or more repos: one repo is a plain space.
 */
async function editFolders(sp, start, change) {
  const ws = await findWorkspace(sp);
  if (ws) {
    const data = parseJsonc(ws.text);
    const next = change(Array.isArray(data.folders) ? data.folders.filter((f) => typeof f?.path === "string") : [], ws.dir);
    await writeTextFile(ws.file, withFolders(ws.text, next), ws.text);
    listCache.delete(ws.dir);
    return;
  }
  const file = await newFile(sp), dir = file.replace(/\/[^/]+$/, "");
  const next = change(start.map((p) => ({ path: relTo(dir, p) })), dir);
  if (next.length < 2) return;
  if (file.startsWith(dataDir())) await fs.mkdir(dir, { recursive: true });
  await writeTextFile(file, withFolders(null, next), null);
  listCache.delete(dir);
}

/** Adds a repo to the space's workspace (making one when this makes two repos). */
export async function addFolder(sp, root, shown) {
  await setHidden(sp.id, root, false);
  await editFolders(sp, shown.filter((p) => !same(p, root)), (list, dir) =>
    list.some((f) => same(hostPath(joinPath(dir, f.path)), root)) ? list : [...list, { path: relTo(dir, root) }]);
}

/** Takes a repo out of the space: out of its workspace file, and hidden from what agents found. */
export async function removeFolder(sp, root) {
  const ws = await findWorkspace(sp);
  if (ws) await editFolders(sp, [], (list, dir) => list.filter((f) => !same(hostPath(joinPath(dir, f.path)), root)));
  await setHidden(sp.id, root, true);
}

// ---- repos removed by hand ------------------------------------------------------------

const HIDDEN = () => `${dataDir()}/hidden.json`;

async function hidden() {
  const t = await readTextFile(HIDDEN());
  try { return { text: t, map: t ? JSON.parse(t) : {} }; } catch { return { text: t, map: {} }; }
}

async function setHidden(spaceId, root, on) {
  for (let i = 0; i < 3; i++) {
    const { text, map } = await hidden(), list = map[spaceId] ?? [];
    const has = list.some((p) => same(p, root));
    if (has === on) return;
    map[spaceId] = on ? [...list, root] : list.filter((p) => !same(p, root));
    if (!map[spaceId].length) delete map[spaceId];
    try { await writeTextFile(HIDDEN(), JSON.stringify(map, null, 2) + "\n", text); return; } catch {}
  }
}

/**
 * Folders whose repos the space reviews, in order: `start` (where its agents started), the
 * workspace file's folders, then the repos agents edited. Removed ones are left out, except
 * folders the workspace file still lists.
 */
export async function spaceRoots(sp, start = []) {
  const ws = await workspaceFolders(sp), found = (await spaceRepos())[sp.id] ?? [], gone = (await hidden()).map[sp.id] ?? [];
  const out = [], names = new Map();
  const add = (p, keep = false) => { if (p && !out.some((x) => same(x, p)) && (keep || !gone.some((g) => same(g, p)))) out.push(p); };
  for (const p of start) add(p);
  for (const f of ws) { add(f.path, true); if (f.name) names.set(slash(f.path), f.name); }
  for (const p of found) add(p);
  return { roots: out, names };
}

// ---- worktrees ----------------------------------------------------------------------

/** What a repo folder is: { branch, linked (a worktree git added), common (its main clone's .git) }. */
export async function repoInfo(root) {
  const r = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
  const d = await git(["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd: root });
  if (r.code !== 0 || d.code !== 0) return null;
  const [gitDir, common] = await Promise.all(d.stdout.trim().split(/\r?\n/).map((p) => hostOf(p, root)));
  return { branch: r.stdout.trim(), linked: !same(gitDir, common), common };
}

/**
 * Makes a worktree of the main clone `clone` at `dest` on `branch`: the branch when it exists,
 * else a new one from the remote's default branch (fetched first; HEAD when there's no remote).
 */
export async function addWorktree(clone, dest, branch) {
  const has = (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: clone })).code === 0;
  let args;
  if (has) args = ["worktree", "add", dest, branch];
  else {
    await git(["fetch", "--quiet", "origin"], { cwd: clone, timeout: 30000 }).catch(() => null);
    const def = await git(["rev-parse", "--abbrev-ref", "origin/HEAD"], { cwd: clone });
    args = ["worktree", "add", "-b", branch, dest, def.code === 0 ? def.stdout.trim() : "HEAD"];
  }
  const r = await git(args, { cwd: clone, timeout: 60000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "git worktree add failed");
}

/** Deletes a linked worktree (git refuses when it has uncommitted or untracked files). */
export async function removeWorktree(root) {
  const info = await repoInfo(root);
  if (!info?.linked) throw new Error(`${root} is not a linked worktree`);
  const clone = info.common.replace(/\/\.git$/, "");
  const r = await git(["worktree", "remove", root], { cwd: clone, timeout: 60000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "git worktree remove failed");
}

/** The git repos directly inside `parent` (folders holding a .git file or folder), sorted. */
export async function scanRepos(parent) {
  const dir = slash(parent).replace(/\/+$/, ""), out = [];
  for (const name of (await listDir(dir)).sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".") && name !== ".git") continue;
    const p = `${dir}/${name}`;
    if ((await readTextFile(`${p}/.git`)) != null || (await readTextFile(`${p}/.git/HEAD`)) != null) out.push(p);
  }
  return out;
}
