// @ts-nocheck
// What Brunr keeps. Three parts:
// - Saved: fold state, the chosen Environments and the Request form's tab, in the storage the
//   dialog passes (open-as.js's sharedStorage), keyed by Machine plus Collection root. Nothing from
//   a Response or a Request's text is ever saved.
// - The Run: the last Run, in memory only. Module code outlives the dialog, so closing and opening
//   the dialog shows the last Response again.
// - Asks: an in-memory log of names and keys a copy hands to another. Never Request text.
// Pure: no Herdr, no Node APIs.

const parse = (text, fallback) => { try { return JSON.parse(text ?? "null") ?? fallback; } catch { return fallback; } };

export class Saved {
  /** `storage`: an object with getItem and setItem (localStorage in the app). */
  constructor(storage) {
    this.storage = storage;
    this.open = parse(storage?.getItem("open"), {});
    this.envs = parse(storage?.getItem("envs"), {});
    this.globals = parse(storage?.getItem("globals"), {});
    const tab = storage?.getItem("formTab");
    this.tab = typeof tab === "string" ? tab : null;
  }

  write(name, value) { try { this.storage?.setItem(name, JSON.stringify(value)); } catch {} }

  /** Whether a Collection or folder row is unfolded. `fallback` until the person folds or unfolds it. */
  isOpen(key, fallback = false) { return typeof this.open[key] === "boolean" ? this.open[key] : fallback; }
  setOpen(key, value) { this.open[key] = !!value; this.write("open", this.open); }

  /** The chosen Environment of a Collection: a name, null for "No Environment", undefined when never chosen. */
  env(collectionKey) { return collectionKey in this.envs ? this.envs[collectionKey] : undefined; }
  setEnv(collectionKey, name) { this.envs[collectionKey] = name ?? null; this.write("envs", this.envs); }
  /** Forgets the choice: the Collection's default Environment applies again. */
  clearEnv(collectionKey) { delete this.envs[collectionKey]; this.write("envs", this.envs); }

  /** The chosen Global environment of a workspace file, or null. */
  globalEnv(workspacePath) { return this.globals[workspacePath] ?? null; }
  setGlobalEnv(workspacePath, name) {
    if (name) this.globals[workspacePath] = name; else delete this.globals[workspacePath];
    this.write("globals", this.globals);
  }

  /** The Request form's tab last shown, a tab name only, or null. */
  formTab() { return this.tab; }
  setFormTab(name) { this.tab = String(name); try { this.storage?.setItem("formTab", this.tab); } catch {} }
}

/** The Environment a Run uses: the chosen one when it still exists, else the Collection's default. */
export function chosenEnv(saved, collectionKey, collection) {
  const names = new Set((collection?.environments ?? []).map((e) => e.name));
  const picked = saved.env(collectionKey);
  if (picked === null) return null;
  if (picked !== undefined && names.has(picked)) return picked;
  const def = collection?.defaultEnvironment ?? null;
  return def && names.has(def) ? def : null;
}

// The Run, in memory

let view = null;              // what the Response side shows: a Run or a file
let busy = null;              // the Run in progress: { key, ck, label, progress }
let waiters = [];

function changed() {
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
}

/** Resolves the next time the Run changes. The dialog waits on it to draw again. */
export function nextChange() { return new Promise((resolve) => waiters.push(resolve)); }

/** What the Response side shows, or null. */
export function getView() { return view; }

/** The Run in progress, or null. One Run at a time. */
export function running() { return busy; }

/**
 * Starts a Run. False when another Run is in progress.
 * `info`: `{ key, ck, label, method, url, environment, machine, tree, target, planned }`, `key` being
 * the tree row that runs, `ck` its Collection, `tree` the parsed Collection and `planned` the
 * Requests the Run is expected to send. `progress`: progressOf's result before any Request
 * finished, or null. The view's `id` stays the same for the whole Run.
 */
export function beginRun(info, progress = null) {
  if (busy) return false;
  busy = { key: info.key, ck: info.ck ?? null, label: info.label, progress };
  const n = Date.now();
  view = { kind: "run", id: n, state: "running", info, result: null, progress, n };
  changed();
  return true;
}

/** Where the Run in progress stands: progressOf's result. Nothing changes when it equals the last one. */
export function setProgress(progress) {
  if (!busy || JSON.stringify(progress) === JSON.stringify(busy.progress)) return;
  busy = { ...busy, progress };
  if (view?.kind === "run" && view.state === "running") view = { ...view, progress, n: Date.now() };
  changed();
}

/** Ends the Run in progress with readRun's result. */
export function finishRun(result) {
  if (view?.kind === "run" && view.state === "running") view = { ...view, state: "done", result, progress: null, n: Date.now() };
  busy = null;
  changed();
}

/** Shows a Collection file on the Response side: `{ path, text, language }`. */
export function showFile(file) {
  view = { kind: "file", file, n: Date.now() };
  changed();
}

// Asks, in memory. The Environment editor (envedit.js) tells the tree an Environment was renamed or
// deleted (`{ kind: "envGone", key, name, newName }`). An ask holds names and keys only, never
// Request text, and nothing is put in shared state. Each copy reads the log from its own cursor.

const ASK_LOG = 50;
let askLog = [];
let askCount = 0;

/** Adds an ask to the log: `{ kind, ... }`. */
export function ask(req) {
  askLog.push({ seq: ++askCount, ask: { ...req } });
  if (askLog.length > ASK_LOG) askLog.shift();
  changed();
}

/** The number of the latest ask. */
export const askSeq = () => askCount;

/** The asks made after number `after`, `[{ seq, ask }]` in order. */
export const asksSince = (after) => askLog.filter((e) => e.seq > after);
