// Changing a mod's files: an update from its source, a restore from a backup, and the folder an
// agent uses to talk the person through a mod's drift.
//
// Herdr reloads a mod on every write to its folder, and a burst of writes has crashed it. So
// files go in one at a time with a pause between, in writePlan's order (main.js last), and only
// the ones that differ.
//
// Herdr's fs.writeFile writes 0 bytes for binary data, so text files are written as text and
// every other file is copied by the system (cmd's copy on Windows, cp elsewhere).
import { appHome, exec, knownAgents, machines, run, focused, spaces } from "herdr";
import * as fs from "fs/promises";
import * as store from "./store.js";
import { sourceUrl, writePlan } from "./track.js";

const TEXT = /\.(m?js|cjs|json|md|svg|txt|css|ts|html|toml|ya?ml|csv)$/i;
const KEEP_BACKUPS = 3;
export const PAUSE = 1500; // ms between two writes into a live mod folder

export const dataDir = () => `${appHome()}/data/moddr`;
export const backupsDir = (name) => `${dataDir()}/backups/${name}`;
const windows = () => /^[A-Za-z]:[\\/]/.test(appHome());
const native = (p) => (windows() ? p.replace(/\//g, "\\") : p);
const parent = (p) => p.replace(/[\\/][^\\/]*$/, "");

async function exists(p) {
  try { return await fs.exists(p); } catch { return false; }
}

/** Copies one file, making its folder. */
export async function copyFile(src, dst) {
  await fs.mkdir(parent(dst), { recursive: true });
  if (TEXT.test(src)) { await fs.writeFile(dst, await fs.readFile(src, "utf8")); return; }
  const r = windows()
    ? await exec("cmd", ["/c", "copy", "/y", native(src), native(dst)], { timeout: 20000 })
    : await exec("cp", [src, dst], { timeout: 20000 });
  if (r.code !== 0) throw new Error(`Copying ${src} failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
}

/** Deletes a folder and everything in it, dot files included. */
export async function rmTree(dir) {
  if (!(await exists(dir))) return;
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) await rmTree(p);
    else await fs.unlink(p);
  }
  await fs.rmdir(dir);
}

/** Copies every file of a folder (skipping Herdr's own and dot files) into another. */
async function copyTree(src, dst) {
  for (const p of await store.list(src)) await copyFile(`${src}/${p}`, `${dst}/${p}`);
}

/** Downloads the source folder at the branch's newest commit into `dir` with a sparse git
 *  clone. Returns { root: the folder's files, sha }. */
export async function stage(src, dir) {
  await rmTree(dir);
  await fs.mkdir(parent(dir), { recursive: true });
  const git = async (args, what) => {
    const r = await exec("git", args, { timeout: 180000 }).catch(() => ({ code: -1, stderr: "git could not be run" }));
    if (r.code !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
    return r.stdout.trim();
  };
  const url = `https://github.com/${src.owner}/${src.repo}.git`;
  // Byte for byte: a Windows git would otherwise write CRLF line endings, and every file would
  // then differ from its source.
  const raw = ["-c", "core.autocrlf=false", "-c", "core.eol=lf"];
  await git([...raw, "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--quiet", "--config", "core.autocrlf=false", ...(src.ref ? ["--branch", src.ref] : []), url, dir], "Downloading the source");
  if (src.path) await git(["-C", dir, "sparse-checkout", "set", "--no-cone", `/${src.path}/`], "Choosing the mod's folder");
  await git([...raw, "-C", dir, "checkout", "--quiet"], "Checking out the source");
  const sha = await git(["-C", dir, "rev-parse", "HEAD"], "Reading the commit");
  const root = src.path ? `${dir}/${src.path}` : dir;
  if (!(await exists(`${root}/main.js`))) throw new Error(`The source has no main.js at ${src.path || "its root"} any more`);
  return { root, sha };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

/** The mod's backups, newest first: [{ id, dir }]. */
export async function backups(name) {
  try {
    const ids = (await fs.readdir(backupsDir(name), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    return ids.sort().reverse().map((id) => ({ id, dir: `${backupsDir(name)}/${id}` }));
  } catch { return []; }
}

/** Copies the mod's folder to a new backup and keeps the newest few. Returns its folder. */
export async function backup(name, label = "") {
  const dir = `${backupsDir(name)}/${stamp()}${label ? `-${label}` : ""}`;
  await fs.mkdir(dir, { recursive: true });
  await copyTree(`${store.modsDir()}/${name}`, dir);
  for (const old of (await backups(name)).slice(KEEP_BACKUPS)) await rmTree(old.dir);
  return dir;
}

/** Makes the live mod folder hold the files of `from`, one file at a time. */
async function apply(name, from, { wait, onStep }) {
  const live = `${store.modsDir()}/${name}`;
  const { write, remove } = writePlan(await store.files(name), await store.filesIn(from));
  let i = 0;
  for (const p of write) {
    onStep(`Writing ${p} (${++i} of ${write.length})`);
    await copyFile(`${from}/${p}`, `${live}/${p}`);
    await wait(PAUSE);
  }
  for (const p of remove) {
    onStep(`Removing ${p}`);
    await fs.unlink(`${live}/${p}`).catch(() => {});
    await wait(PAUSE);
  }
  return { written: write.length, removed: remove.length };
}

/** Puts the newest upstream version in place. The current files are backed up first. */
export async function update(name, entry, { wait, onStep = () => {} }) {
  if (name === "moddr") throw new Error("Moddr cannot rewrite itself while it runs. Copy its folder from the source by hand");
  onStep("Downloading the source");
  const dir = `${dataDir()}/staging/${name}`;
  const { root, sha } = await stage(entry.source, dir);
  onStep("Backing up your files");
  const saved = await backup(name, (entry.installed ?? "unknown").slice(0, 7));
  const done = await apply(name, root, { wait, onStep });
  await rmTree(dir).catch(() => {});
  return { ...done, sha, backup: saved };
}

/** Puts a backup back. The files there now are backed up first, so a restore can be undone. */
export async function restore(name, from, { wait, onStep = () => {} }) {
  onStep("Backing up your files");
  await backup(name, "before-restore");
  return apply(name, from, { wait, onStep });
}

// ---- The drift space ----

/** C:\Users\me\x as WSL sees it: /mnt/c/Users/me/x. */
const wslPath = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_m, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, "/");

/** Where an agent can run for the person: the focused space's machine first, then this
 *  computer, then the others. A machine counts when an agent is installed there and it can see
 *  this computer's files (this computer, or WSL on it). Returns { machine, agent, path } or null. */
async function agentPlace() {
  const dir = appHome();
  const focusedMachine = spaces().find((s) => s.id === focused()?.space)?.machine ?? null;
  const order = [focusedMachine, null, ...machines().map((m) => m.name).filter(Boolean)];
  const tried = new Set();
  for (const machine of order) {
    if (tried.has(machine)) continue;
    tried.add(machine);
    let path = dir;
    if (machine !== null) {
      if (!windows()) continue;
      path = wslPath(dir);
      const r = await exec("test", ["-d", path], { on: machine, timeout: 15000 }).catch(() => null);
      if (r?.code !== 0) continue;
    }
    const agents = await knownAgents({ on: machine }).catch(() => []);
    const agent = agents.find((a) => a.installed);
    if (agent) return { machine, agent, path };
  }
  return null;
}

function brief({ name, entry, live, paths, backupDir, diffStat }) {
  const c = entry.check ?? {};
  const lines = [
    `# ${name}: drift from its source`,
    "",
    `The Herdr mod \`${name}\` differs from where it was installed. Help the person understand how, and decide what to do.`,
    "",
    "## Facts",
    "",
    `- Live mod folder (Herdr reloads it on every write): \`${paths.live}\``,
    `- Source: ${sourceUrl(entry.source)}`,
    `- Installed version: ${entry.installed ?? "unknown: the local files match none of the recent upstream versions"}`,
    `- Newest upstream: ${c.latest?.sha ?? "?"} (${c.latest?.date ?? "?"}) ${c.latest?.message ?? ""}`,
    `- Upstream commits since the installed version: ${c.behind?.length ? "" : "none"}`,
    ...(c.behind ?? []).map((b) => `  - ${b.sha.slice(0, 7)} ${b.message}`),
    ...(c.more ? ["  - and older ones not listed"] : []),
    `- Files changed here since the installed version: ${c.edited?.length ? c.edited.join(", ") : "none"}`,
    `- Backup of the live files, made just now: \`${paths.backup}\``,
    "",
    "## In this folder",
    "",
    "- `local/`: a copy of the live mod folder, now.",
    "- `upstream/`: the source folder at its newest commit.",
    "- `drift.diff`: `git diff --no-index local upstream`.",
    entry.installed
      ? `- The installed version is not here. Fetch it when you need the common base: \`git clone --filter=blob:none https://github.com/${entry.source.owner}/${entry.source.repo}.git base\`, then \`git -C base show ${entry.installed}:${entry.source.path}/<file>\`.`
      : "- There is no known common base: compare `local/` with the upstream history if you need one.",
    "",
    diffStat ? "Diff summary:\n\n```\n" + diffStat + "\n```\n" : "",
    "## What to do",
    "",
    "1. Read `drift.diff` and the commits. Explain, file by file, what changed upstream, what was changed here, and where the two overlap.",
    "2. Recommend one of: take upstream, keep the local files, or merge. Say what each loses. Ask the person before changing anything.",
    "3. To apply a choice, change the live folder one file at a time: other files first, then `.js` modules, then `mod.json`, then `main.js` last, a few seconds apart. Never copy the whole folder at once: a burst of reloads can crash Herdr.",
    `4. Then run \`herdr-app check ${paths.live}\` and \`herdr-app status\`. Tell the person to press Refresh in Moddr. Moddr's Restore button puts the backup back.`,
    "",
    `Before writing mod code, read Herdr's mod guide: \`${paths.agents}\`.`,
  ];
  return lines.filter((l) => l !== null).join("\n") + "\n";
}

/**
 * Prepares <data>/drift/<name>/ (local copy, upstream copy, diff, BRIEF.md) and opens a new space
 * there with the person's agent. Returns { space, agent, machine } or throws a message fit to show.
 */
export async function openDrift(name, entry, { onStep = () => {} } = {}) {
  const dir = `${dataDir()}/drift/${name}`;
  const live = `${store.modsDir()}/${name}`;
  onStep("Finding an agent");
  const place = await agentPlace();
  if (!place) throw new Error("No agent is installed where Moddr can start one. Install one from Herdr's + menu first");
  onStep("Downloading the source");
  await rmTree(dir);
  const { root } = await stage(entry.source, `${dir}/.source`);
  onStep("Copying the files");
  await copyTree(root, `${dir}/upstream`);
  await copyTree(live, `${dir}/local`);
  await rmTree(`${dir}/.source`).catch(() => {});
  onStep("Backing up your files");
  const backupDir = await backup(name, "drift");
  const diff = await exec("git", ["diff", "--no-index", "--no-color", "local", "upstream"], { cwd: dir, timeout: 30000 }).catch(() => null);
  const stat = await exec("git", ["diff", "--no-index", "--stat", "local", "upstream"], { cwd: dir, timeout: 30000 }).catch(() => null);
  await fs.writeFile(`${dir}/drift.diff`, diff?.stdout ?? "");
  const conv = (p) => (place.machine !== null ? wslPath(p) : native(p));
  const agentsMd = `${appHome()}/AGENTS.md`;
  await fs.writeFile(`${dir}/BRIEF.md`, brief({
    name, entry,
    paths: { live: conv(live), backup: conv(backupDir), agents: conv(agentsMd) },
    diffStat: stat?.stdout?.trim().split("\n").slice(-12).join("\n") ?? "",
  }));
  onStep("Opening the space");
  const folder = conv(dir);
  run("space.new", {
    name: `${name} drift`,
    folder,
    machine: place.machine ?? "",
    argv: place.agent.run,
    task: `Read BRIEF.md in this folder. It is about the drift of my Herdr mod "${name}" from its source. Walk me through it and recommend what to do. Do not change the live mod folder until I say so.`,
  });
  return { agent: place.agent.name, machine: place.machine };
}
