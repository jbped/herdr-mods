// Moddr's file, <appHome>/moddr.json, and the local side of a check: which mods are here and
// the git blob sha of each of their files.
//
// moddr.json: { "token"?: "<GitHub token>", "mods": { "<name>": { source, installed, tracked, check } } }
// The person may add "token" by hand. Moddr keeps every field it does not know.
import { appHome, exec, readTextFile, writeTextFile } from "herdr";
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

/** { "<relative path>": "<git blob sha>" } for the mod's files, hashed by git as it hashes them
 *  for a commit (no line-ending changes). */
export async function files(name) {
  const root = `${modsDir()}/${name}`;
  const paths = [];
  await walk(root, "", paths);
  if (!paths.length) return {};
  let r;
  try { r = await exec("git", ["hash-object", "--no-filters", "--", ...paths], { cwd: root, timeout: 20000 }); } catch { throw new Error("git could not be run. Moddr needs git to compare files"); }
  if (r.code !== 0) throw new Error(`git hash-object failed: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
  const shas = r.stdout.trim().split(/\r?\n/);
  if (shas.length !== paths.length) throw new Error("git hash-object answered with the wrong number of lines");
  return Object.fromEntries(paths.map((p, i) => [p, shas[i]]));
}
