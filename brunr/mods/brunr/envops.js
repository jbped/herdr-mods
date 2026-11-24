// Environment file operations by Bruno desktop's rules (ipc/collection.js create, rename and
// delete-environment, utils/environments.js). Planners for fileops.js: with `texts` null they only
// name the paths they read. Pure.
import { sanitizeName, validateName } from "./names.js";
import { writeEnvironment, setEnvironmentName, setExtends, readExtends, dropColor } from "./envfile.js";
import { EXT, abs, Missing } from "./collpaths.js";

const fail = (error) => ({ error });
const envPath = (format, name) => `environments/${name}${EXT[format]}`;
const findEnv = (collection, name) => (collection.environments ?? []).find((e) => e.name === name) ?? null;

/** Current text of a file; a missing one is a boundary bug, not a user error. */
function textOf(texts, path) {
  const t = texts?.[path];
  if (typeof t !== "string") throw new Missing(`Brunr needs the current text of ${path} for this change.`);
  return t;
}

/** A name made safe and valid, then made free among the Environments with ` copy`, ` copy 2` …, as Bruno does. */
function freeName(collection, name) {
  const base = sanitizeName(name);
  const invalid = validateName(base);
  if (invalid) return { error: invalid };
  // Bruno's generateUniqueName compares exactly; Windows file names ignore case, so this does too.
  const taken = new Set((collection.environments ?? []).map((e) => e.name.toLowerCase()));
  const has = (n) => taken.has(n.toLowerCase());
  let free = base;
  if (has(free)) free = `${base} copy`;
  for (let n = 2; has(free); n++) free = `${base} copy ${n}`;
  return { name: free };
}

function mkdirIfNone(collection) {
  return (collection.environments ?? []).length ? [] : [{ op: "mkdir", path: abs(collection, "environments"), existsOk: true }];
}

export function planNewEnvironment({ collection, name }) {
  const free = freeName(collection, name);
  if (free.error) return fail(free.error);
  const path = envPath(collection.format, free.name);
  const text = writeEnvironment({ format: collection.format, name: free.name, rows: [] });
  return { reads: [], effects: [...mkdirIfNone(collection), { op: "write", path: abs(collection, path), text, expected: null }], result: { name: free.name, path } };
}

export function planCloneEnvironment({ collection, from, name }, texts) {
  const env = findEnv(collection, from);
  if (!env) return fail(`There is no Environment "${from}" in this Collection.`);
  const free = freeName(collection, name ?? from);
  if (free.error) return fail(free.error);
  const path = envPath(collection.format, free.name);
  const result = { name: free.name, path };
  if (!texts) return { reads: [env.path], effects: [], result };
  const text = setEnvironmentName(dropColor(textOf(texts, env.path)), collection.format, free.name);
  return { reads: [env.path], effects: [{ op: "write", path: abs(collection, path), text, expected: null }], result };
}

export function planRenameEnvironment({ collection, name, newName }, texts) {
  const env = findEnv(collection, name);
  if (!env) return fail(`There is no Environment "${name}" in this Collection.`);
  const clean = sanitizeName(newName);
  const invalid = validateName(clean);
  if (invalid) return fail(invalid);
  const path = envPath(collection.format, clean);
  const clash = (collection.environments ?? []).find((e) => e !== env && e.path.toLowerCase() === path.toLowerCase());
  if (clash) return fail(`An Environment named "${clash.name}" already exists.`);
  const reads = (collection.environments ?? []).map((e) => e.path);
  const result = { name: clean, path };
  if (!texts) return { reads, effects: [], result };
  const effects = path !== env.path ? [{ op: "move", from: abs(collection, env.path), to: abs(collection, path) }] : [];
  for (const e of collection.environments) {
    const before = textOf(texts, e.path);
    let text = before;
    if (e === env) text = setEnvironmentName(text, collection.format, clean);
    if (readExtends(text, collection.format) === env.name) text = setExtends(text, collection.format, clean);
    if (text !== before) effects.push({ op: "write", path: abs(collection, e === env ? path : e.path), text, expected: before });
  }
  return { reads, effects, result };
}

export function planDeleteEnvironment({ collection, name }) {
  const env = findEnv(collection, name);
  if (!env) return fail(`There is no Environment "${name}" in this Collection.`);
  return { reads: [], effects: [{ op: "trash", path: abs(collection, env.path) }], result: { name: null, path: null } };
}

function run(planner, args) {
  try {
    const p = planner(args, args.texts ?? {});
    return p.error ? { error: p.error } : { effects: p.effects, result: p.result };
  } catch (e) {
    if (e instanceof Missing) return { error: e.message };
    throw e;
  }
}

/** A new empty Environment `environments/<name>.<ext>`; a taken name gets ` copy`, as in Bruno. */
export const newEnvironment = (args) => run(planNewEnvironment, args);
/** A copy of Environment `from` named `name`, keeping its variables and `extends`, dropping its color. */
export const cloneEnvironment = (args) => run(planCloneEnvironment, args);
/** Renames Environment `name` to `newName` (file and YAML name), updating other Environments' `extends`. */
export const renameEnvironment = (args) => run(planRenameEnvironment, args);
/** Moves Environment `name` to the trash. */
export const deleteEnvironment = (args) => run(planDeleteEnvironment, args);
