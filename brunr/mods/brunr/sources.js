// @ts-nocheck
// Sources: which Collections Brunr shows. Reads brunr.json from the app home and Bruno desktop's
// workspace file, finds the Collection roots of each config entry, and loads one Collection.
// The files themselves are read through machine.js.
import { appHome, home } from "herdr";
import * as machine from "./machine.js";
import { parseCollection, parseWorkspace } from "./parser.js";

export const CONFIG_NAME = "brunr.json";

const slash = (p) => String(p ?? "").replace(/\\/g, "/");
const dirName = (p) => { const s = slash(p).replace(/\/+$/, ""); return s.includes("/") ? s.slice(0, s.lastIndexOf("/")) : ""; };
const baseName = (p) => slash(p).replace(/\/+$/, "").split("/").pop() ?? "";

/** brunr.json's path: in the app home, so it never travels with the mod folder. */
export const configPath = () => `${slash(appHome()).replace(/\/+$/, "")}/${CONFIG_NAME}`;

/** Bruno desktop's default workspace file on a platform, under a home folder. */
export function defaultWorkspacePath(platform, homeDir) {
  const h = slash(homeDir).replace(/\/+$/, "");
  if (platform === "windows") return `${h}/AppData/Roaming/bruno/default-workspace/workspace.yml`;
  if (platform === "macos") return `${h}/Library/Application Support/bruno/default-workspace/workspace.yml`;
  return `${h}/.config/bruno/default-workspace/workspace.yml`;
}

/** The key a Collection is stored and found by: its Machine and root. */
export const collectionKey = (machineName, root) => `${machineName ?? ""}|${slash(root).replace(/\/+$/, "")}`;

/**
 * `{ workspace, collections, problems }` from brunr.json's text. Null text (no file) is the
 * defaults with no problem. Invalid JSON is the defaults with the parse error. Bad entries are
 * dropped and named.
 */
export function parseConfig(text) {
  const out = { workspace: null, collections: [], problems: [] };
  if (text == null || !String(text).trim()) return out;
  let json;
  try { json = JSON.parse(text); } catch (e) {
    out.problems.push(`${CONFIG_NAME} is not valid JSON: ${e?.message ?? e}`);
    return out;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    out.problems.push(`${CONFIG_NAME} must be an object: { "workspace": "...", "collections": [...] }`);
    return out;
  }
  if (json.workspace != null) {
    if (typeof json.workspace === "string" && json.workspace.trim()) out.workspace = json.workspace.trim();
    else out.problems.push(`${CONFIG_NAME}: "workspace" must be the path of a workspace.yml`);
  }
  if (json.collections != null && !Array.isArray(json.collections)) {
    out.problems.push(`${CONFIG_NAME}: "collections" must be a list of { "machine", "path" }`);
  } else {
    (json.collections ?? []).forEach((c, i) => {
      const okMachine = c?.machine == null || (typeof c.machine === "string");
      if (!c || typeof c !== "object" || typeof c.path !== "string" || !c.path.trim() || !okMachine) {
        out.problems.push(`${CONFIG_NAME}: collections[${i}] needs a "path" and an optional "machine" name`);
        return;
      }
      out.collections.push({ machine: c.machine ? c.machine : null, path: c.path.trim() });
    });
  }
  return out;
}

/** Reads and parses brunr.json. */
export async function readConfig() {
  return parseConfig(await machine.readText(null, configPath()));
}

/**
 * Everything to show, without the Collections' files: `{ config, workspace, entries, problems }`.
 * `workspace`: `{ path, dir, name, missing, globals }` for this computer's workspace file.
 * `entries`: `{ key, machine, root, name, workspace }` per Collection, workspace ones first, then
 * the config's, without duplicates. `name` is the workspace's name for it, else the folder's.
 */
export async function discover(config) {
  const problems = [...config.problems];
  const wsPath = config.workspace ?? defaultWorkspacePath(machine.platform(), home());
  const wsText = await machine.readText(null, wsPath);
  const ws = parseWorkspace(wsText ?? "");
  const workspace = { path: slash(wsPath), dir: dirName(wsPath), name: ws.name, missing: wsText == null, globals: [] };
  if (wsText != null) {
    const names = await machine.fileNames(`${workspace.dir}/environments`);
    workspace.globals = names.filter((n) => /\.ya?ml$/i.test(n)).map((n) => n.replace(/\.ya?ml$/i, "")).sort((a, b) => a.localeCompare(b));
  }
  const entries = [];
  const seen = new Set();
  const add = (m, root, name, wsKey) => {
    const key = collectionKey(m, root);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ key, machine: m, root: slash(root).replace(/\/+$/, ""), name: name || baseName(root), workspace: wsKey });
  };
  for (const c of ws.collections) add(null, absolute(c.path, workspace.dir), c.name, workspace.path);
  for (const c of config.collections) {
    try {
      const roots = await machine.findRoots(c.machine, c.path);
      if (!roots.length) problems.push(`No Bruno Collection in ${c.path}${c.machine ? ` on ${c.machine}` : ""}`);
      for (const r of roots) add(c.machine, r, "", null);
    } catch (e) {
      problems.push(`Cannot read ${c.path}${c.machine ? ` on ${c.machine}` : ""}: ${e?.message ?? e}`);
    }
  }
  return { config, workspace, entries, problems };
}

/** A workspace's Collection paths may be relative to the workspace folder. */
function absolute(path, dir) {
  const p = slash(path);
  if (/^([A-Za-z]:)?\//.test(p) || !dir) return p;
  return `${dir}/${p.replace(/^\.\//, "")}`;
}

/** One Collection's tree: `parseCollection`'s result, or `{ error }` when its folder cannot be read. */
export async function loadCollection(entry) {
  try {
    const files = await machine.readCollection(entry.machine, entry.root);
    const collection = parseCollection({ root: entry.root, files });
    if (!collection.format) return { error: "Not a Bruno Collection: no opencollection.yml or bruno.json" };
    return { collection };
  } catch (e) {
    return { error: `Cannot read the Collection: ${e?.message ?? e}` };
  }
}
