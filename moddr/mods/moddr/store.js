// Moddr's file, <appHome>/moddr.json, and the local side of a check: which mods are here and
// the git blob sha of each of their files.
//
// moddr.json: { "token"?: "<GitHub token>", "mods": { "<name>": { source, installed, tracked, check } } }
// The person may add "token" by hand; it wins over gh's. Moddr keeps every field it does not know.
import { appHome, exec, readTextFile, window as win, writeTextFile } from "herdr";
import * as fs from "fs/promises";
import { ignored } from "./track.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const filePath = () => `${appHome()}/moddr.json`;
export const modsDir = () => `${appHome()}/mods`;

// The file's text as last read or written: the expected text of the next write.
let known;

/** The saved data, { token, mods }, and an error line when the file is not valid. */
export async function load() {
  const text = await readTextFile(filePath()).catch(() => null);
  known = text;
  if (text === null) return { data: { mods: {} }, error: null };
  try {
    const data = JSON.parse(text);
    if (!isObj(data)) return { data: { mods: {} }, error: "moddr.json must hold an object" };
    if (!isObj(data.mods)) data.mods = {};
    return { data, error: null };
  } catch (e) {
    return { data: { mods: {} }, error: `moddr.json is not valid JSON: ${e?.message ?? e}` };
  }
}

/** Writes the data. Another writer's change since the last read is read in first: its mods stay
 *  unless this copy changed the same one. */
export async function save(data, changed) {
  const text = () => JSON.stringify(data, null, 2) + "\n";
  try {
    await writeTextFile(filePath(), text(), known ?? null);
  } catch {
    const fresh = await load();
    for (const [name, entry] of Object.entries(fresh.data.mods)) if (!changed.has(name)) data.mods[name] = entry;
    for (const name of Object.keys(data.mods)) if (!(name in fresh.data.mods) && !changed.has(name)) delete data.mods[name];
    await writeTextFile(filePath(), text(), known ?? null);
  }
  known = text();
}

/** The GitHub token gh is signed in with, or null when gh is missing or signed out. Kept in
 *  memory only, never written. */
export async function ghToken() {
  try {
    const r = await exec("gh", ["auth", "token", "--hostname", "github.com"], { timeout: 10000 });
    const t = r.stdout.trim();
    return r.code === 0 && /^[A-Za-z0-9_]+$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Opens a GitHub URL in the system browser. rundll32 gets it as one argument, so nothing in it
 *  reaches a shell. */
export function openUrl(url) {
  if (!/^https:\/\/github\.com\/[^\s"'<>]+$/.test(url)) return;
  const p = win()?.platform;
  const [cmd, args] = p === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : p === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => null);
}

/** The mods folder's own mods: every folder in it that Herdr did not ship. */
export async function localMods() {
  const shipped = new Set();
  try {
    for (const k of Object.keys(JSON.parse(await readTextFile(`${appHome()}/installed.json`)) ?? {})) shipped.add(k);
  } catch { /* no record: every folder counts */ }
  const list = await fs.readdir(modsDir(), { withFileTypes: true });
  return list.filter((d) => d.isDirectory() && !d.name.startsWith(".") && !shipped.has(d.name)).map((d) => d.name).sort();
}

/** The mod's README.md, for the GitHub links it names. "" when it has none. */
export async function readme(name) {
  return (await readTextFile(`${modsDir()}/${name}/README.md`).catch(() => null)) ?? "";
}

async function walk(root, rel, out) {
  const list = await fs.readdir(rel ? `${root}/${rel}` : root, { withFileTypes: true });
  for (const d of list) {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (ignored(p) || d.name === "node_modules") continue;
    if (d.isDirectory()) await walk(root, p, out);
    else out.push(p);
  }
}

/** Every file under a folder, relative, skipping the ones Herdr writes and dot files. */
export async function list(root) {
  const paths = [];
  await walk(root, "", paths);
  return paths;
}

/** { "<relative path>": "<git blob sha>" } for the files under a folder, hashed by git as it
 *  hashes them for a commit (no line-ending changes). */
export async function filesIn(root) {
  const paths = await list(root);
  if (!paths.length) return {};
  let r;
  try { r = await exec("git", ["hash-object", "--no-filters", "--", ...paths], { cwd: root, timeout: 20000 }); } catch { throw new Error("git could not be run. Moddr needs git to compare files"); }
  if (r.code !== 0) throw new Error(`git hash-object failed: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
  const shas = r.stdout.trim().split(/\r?\n/);
  if (shas.length !== paths.length) throw new Error("git hash-object answered with the wrong number of lines");
  return Object.fromEntries(paths.map((p, i) => [p, shas[i]]));
}

/** The mod's own files, hashed. */
export const files = (name) => filesIn(`${modsDir()}/${name}`);
