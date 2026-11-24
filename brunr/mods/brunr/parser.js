// @ts-nocheck
// The Collection parser: Bruno collection files (OpenCollection YAML or bru) to a tree of folders
// and Requests, the Environments with variable names only, and the default Environment.
// Pure: no Herdr, no Node APIs. Paths are relative to the Collection root, with forward slashes.
import { parseYaml } from "./yaml.js";

const FORMATS = {
  yaml: { config: "opencollection.yml", ext: ".yml", folder: "folder.yml" },
  bru: { config: "bruno.json", ext: ".bru", folder: "folder.bru" },
};
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace", "connect"];
// YAML item types that are files in a Collection but not Requests.
const NOT_REQUESTS = new Set(["folder", "script", "app"]);

const slash = (p) => String(p ?? "").replace(/\\/g, "/");
const relPath = (p) => slash(p).replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const dirName = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const stripExt = (name) => name.replace(/\.[^.]+$/, "");
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A root path with forward slashes and no trailing slash, except a bare `/` or `C:/`. */
function normRoot(root) {
  const s = slash(root);
  return /^([A-Za-z]:)?\/$/.test(s) ? s : s.replace(/\/+$/, "");
}

/** "yaml", "bru" or null from the file names directly in a folder. */
export function collectionFormat(names) {
  const set = new Set(names ?? []);
  if (set.has(FORMATS.yaml.config)) return "yaml";
  if (set.has(FORMATS.bru.config)) return "bru";
  return null;
}

/** True for the files the parser reads: config, folder, Request and Environment files of that format. */
export function isCollectionFile(relPathIn, format) {
  const f = FORMATS[format];
  if (!f) return false;
  const p = relPath(relPathIn);
  if (!p) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "node_modules" || s.startsWith("."))) return false;
  if (p === f.config) return true;
  return p.endsWith(f.ext);
}

/** The Collection tree from `{ [relPath]: text }`. See the module header for the shape. */
export function parseCollection({ root, files }) {
  const rootPath = normRoot(root);
  const texts = {};
  for (const [k, v] of Object.entries(files ?? {})) texts[relPath(k)] = str(v);
  const format = collectionFormat(Object.keys(texts).filter((p) => !p.includes("/")));
  const errors = [];
  const fallbackName = baseName(rootPath.replace(/\/$/, "")) || rootPath;
  if (!format) {
    errors.push({ path: "", message: "no opencollection.yml or bruno.json at the Collection root" });
    return { root: rootPath, format: null, name: fallbackName, defaultEnvironment: null, environments: [], children: [], errors };
  }
  const f = FORMATS[format];
  const config = readConfig(format, texts[f.config], errors);
  const paths = Object.keys(texts).filter((p) => isCollectionFile(p, format)).sort();
  const environments = [];
  const requests = [];
  const folders = {};
  for (const p of paths) {
    if (p === f.config || (format === "bru" && p === "collection.bru")) continue;
    if (/^environments\/[^/]+$/.test(p)) {
      const env = readEnvironment(format, p, texts[p], errors);
      if (env) environments.push(env);
    } else if (baseName(p) === f.folder) {
      folders[dirName(p)] = readFolder(format, p, texts[p], errors);
    } else {
      const req = readRequest(format, p, texts[p], errors);
      if (req) requests.push(req);
    }
  }
  environments.sort((a, b) => byName(a.name, b.name));
  return {
    root: rootPath, format, name: config.name || fallbackName,
    defaultEnvironment: config.defaultEnvironment,
    environments, children: buildTree(requests, folders), errors,
  };
}

function readConfig(format, text, errors) {
  const path = FORMATS[format].config;
  try {
    const doc = format === "yaml" ? parseYaml(text) : JSON.parse(text);
    if (!isMap(doc)) throw new Error("not a map");
    const name = format === "yaml" ? doc.info?.name : doc.name;
    // OpenCollection keeps it under extensions.bruno.presets; the top-level form is a fallback.
    const presets = format === "yaml" ? doc.extensions?.bruno?.presets ?? doc.presets : doc.presets;
    const def = isMap(presets) ? presets.defaultEnvironment : null;
    return { name: str(name).trim(), defaultEnvironment: typeof def === "string" && def ? def : null };
  } catch (e) {
    errors.push({ path, message: e.message });
    return { name: "", defaultEnvironment: null };
  }
}

function readEnvironment(format, path, text, errors) {
  const name = stripExt(baseName(path));
  try {
    const variables = format === "yaml" ? yamlVariables(text) : bruVariables(text);
    return { name, path, variables };
  } catch (e) {
    errors.push({ path, message: e.message });
    return null;
  }
}

function yamlVariables(text) {
  const doc = parseYaml(text);
  if (doc !== null && !isMap(doc)) throw new Error("an Environment file must be a map");
  const list = doc?.variables ?? [];
  if (!Array.isArray(list)) throw new Error("variables must be a list");
  return list.filter((v) => isMap(v) && str(v.name)).map((v) => ({ name: str(v.name), secret: v.secret === true }));
}

function bruVariables(text) {
  const blocks = readBruBlocks(text);
  const out = [];
  const seen = new Set();
  const add = (name, secret) => {
    if (!name || name.startsWith("~") || seen.has(name)) return;
    seen.add(name);
    out.push({ name, secret });
  };
  for (const key of Object.keys(dictLines(blocks.vars))) add(key, false);
  for (const line of blocks["vars:secret"] ?? []) {
    for (const part of line.split(",")) add(part.trim(), true);
  }
  return out;
}

function readFolder(format, path, text, errors) {
  try {
    if (format === "yaml") {
      const doc = parseYaml(text);
      const info = isMap(doc?.info) ? doc.info : {};
      return { name: str(info.name).trim(), seq: toSeq(info.seq) };
    }
    const meta = dictLines(readBruBlocks(text).meta);
    return { name: str(meta.name).trim(), seq: toSeq(meta.seq) };
  } catch (e) {
    errors.push({ path, message: e.message });
    return { name: "", seq: null };
  }
}

function readRequest(format, path, text, errors) {
  try {
    const r = format === "yaml" ? yamlRequest(text) : bruRequest(text);
    if (!r) return null;
    const type = r.type || "http";
    const method = /^[A-Za-z]+$/.test(r.method) ? r.method.toUpperCase() : type.toUpperCase();
    return {
      kind: "request", name: r.name || stripExt(baseName(path)), path,
      seq: toSeq(r.seq), type, method, url: str(r.url),
    };
  } catch (e) {
    errors.push({ path, message: e.message });
    return null;
  }
}

function yamlRequest(text) {
  const doc = parseYaml(text);
  if (!isMap(doc) || !isMap(doc.info)) throw new Error("no info section");
  const type = str(doc.info.type).trim();
  if (!type) throw new Error("no info.type");
  if (NOT_REQUESTS.has(type)) return null;
  const section = isMap(doc[type]) ? doc[type] : {};
  if (type === "http" && !str(section.method)) throw new Error("no http.method");
  return { name: str(doc.info.name).trim(), seq: doc.info.seq, type, method: str(section.method), url: section.url };
}

function bruRequest(text) {
  const blocks = readBruBlocks(text);
  const meta = dictLines(blocks.meta);
  const verb = HTTP_METHODS.find((m) => blocks[m]);
  let type = str(meta.type).trim();
  let method = "";
  let url = "";
  if (verb) {
    method = verb;
    url = dictLines(blocks[verb]).url;
  } else if (blocks.http) {
    const http = dictLines(blocks.http);
    method = str(http.method);
    url = http.url;
  } else if (type && type !== "http" && (blocks[type] || blocks.ws)) {
    const own = dictLines(blocks[type] ?? blocks.ws);
    method = str(own.method);
    url = own.url;
  } else {
    throw new Error("no method block");
  }
  if (!type) type = "http";
  return { name: str(meta.name).trim(), seq: meta.seq, type, method, url };
}

/**
 * The top-level blocks of a bru file: `name {` … `}` and `name [` … `]`, each opening and closing
 * at column 0. Returns `{ name: [inner lines] }`. Block bodies are not interpreted here.
 */
function readBruBlocks(text) {
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const blocks = {};
  let open = null;
  lines.forEach((line, i) => {
    if (open) {
      if (line.trimEnd() === open.close) {
        blocks[open.name] = open.lines;
        open = null;
      } else if (/^\S+\s*[{[]\s*$/.test(line)) {
        throw new Error(`line ${i + 1}: block '${open.name}' is not closed`);
      } else open.lines.push(line);
      return;
    }
    if (line.trim() === "") return;
    const inline = /^(\S+)\s*\[(.*)\]\s*$/.exec(line);
    if (inline) {
      blocks[inline[1]] = [inline[2]];
      return;
    }
    const m =/^(\S+)\s*([{[])\s*$/.exec(line);
    if (!m) throw new Error(`line ${i + 1}: expected a block`);
    open = { name: m[1], close: m[2] === "{" ? "}" : "]", lines: [] };
  });
  if (open) throw new Error(`block '${open.name}' is not closed`);
  return blocks;
}

/** `key: value` lines of a bru dictionary block as a map. The value keeps any later colons. */
function dictLines(lines) {
  const out = {};
  for (const line of lines ?? []) {
    const t = line.trim();
    const at = t.indexOf(":");
    if (!t || at <= 0) continue;
    out[t.slice(0, at).trim()] = t.slice(at + 1).trim();
  }
  return out;
}

function toSeq(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function byName(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/** Order within one level: by seq, items without seq last, then by name ignoring case. */
function bySeqThenName(a, b) {
  if (a.seq !== null && b.seq !== null && a.seq !== b.seq) return a.seq - b.seq;
  if ((a.seq === null) !== (b.seq === null)) return a.seq === null ? 1 : -1;
  return byName(a.name, b.name) || byName(a.path, b.path);
}

/** Folders from the Requests' directories. A directory with no Request under it is not a node. */
function buildTree(requests, folders) {
  const top = { children: [] };
  const dirs = { "": top };
  const ensure = (dir) => {
    if (dirs[dir]) return dirs[dir];
    const parent = ensure(dirName(dir));
    const meta = folders[dir] ?? { name: "", seq: null };
    const node = { kind: "folder", name: meta.name || baseName(dir), path: dir, seq: meta.seq, children: [] };
    parent.children.push(node);
    dirs[dir] = node;
    return node;
  };
  for (const r of requests) ensure(dirName(r.path)).children.push(r);
  const sort = (node) => {
    node.children.sort(bySeqThenName);
    node.children.forEach((c) => c.kind === "folder" && sort(c));
  };
  sort(top);
  return top.children;
}

/** The number of Request nodes under a node or a Collection. */
export function countRequests(node) {
  if (!node) return 0;
  if (node.kind === "request") return 1;
  return (node.children ?? []).reduce((n, c) => n + countRequests(c), 0);
}

/** The node at `path` in a Collection, or null. */
export function findNode(collection, path) {
  const want = relPath(path);
  if (!want) return null;
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.path === want) return n;
      if (n.kind === "folder" && want.startsWith(n.path + "/")) return walk(n.children);
    }
    return null;
  };
  return walk(collection?.children);
}

/** `{ name, collections: [{ name, path }] }` from Bruno desktop's workspace.yml. */
export function parseWorkspace(text) {
  let doc;
  try {
    doc = parseYaml(text);
  } catch {
    return { name: "", collections: [] };
  }
  if (!isMap(doc)) return { name: "", collections: [] };
  const list = Array.isArray(doc.collections) ? doc.collections : [];
  const collections = list
    .filter((c) => isMap(c) && str(c.path).trim())
    .map((c) => ({ name: str(c.name), path: slash(str(c.path).trim()) }));
  return { name: str(doc.info?.name), collections };
}
