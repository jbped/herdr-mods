// What Brunr keeps. Two parts:
// - Saved: fold state and the chosen Environments, in the panel copy's localStorage, keyed by
//   Machine plus Collection root. Nothing from a Response is ever saved.
// - Runs: the Run of each tab, in memory only. Module code is shared by every copy of the mod, so
//   the panel copy hands a Run to the Response pane copy through this module. Shared state carries
//   only a counter (`brunr.tick`) that makes the other copies draw again.
import { setShared, shared } from "herdr";

export const TICK = "brunr.tick";

const parse = (text, fallback) => { try { return JSON.parse(text ?? "null") ?? fallback; } catch { return fallback; } };

export class Saved {
  /** `storage`: an object with getItem and setItem (localStorage in the app). */
  constructor(storage) {
    this.storage = storage;
    this.open = parse(storage?.getItem("open"), {});
    this.envs = parse(storage?.getItem("envs"), {});
    this.globals = parse(storage?.getItem("globals"), {});
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

// Runs, in memory

const runs = new Map();       // tab id -> what its Response pane shows
let busy = null;              // the Run in progress across the mod: { tab, key, ck, label, progress }
let waiters = [];

function changed() {
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
  try { setShared(TICK, ((Number(shared(TICK)) || 0) + 1) % 1000000); } catch {}
}

/** Resolves the next time any tab's Run changes. Copies wait on it to draw again. */
export function nextChange() { return new Promise((resolve) => waiters.push(resolve)); }

/** What a tab's Response pane shows, or null. */
export function getView(tab) { return runs.get(tab) ?? null; }

/** The Run in progress, or null. One Run at a time across the mod. */
export function running() { return busy; }

/**
 * Starts a Run in a tab. False when another Run is in progress.
 * `info`: `{ key, ck, label, method, url, environment, machine, tree, target, planned }`, `key` being
 * the tree row that runs, `ck` its Collection, `tree` the parsed Collection and `planned` the
 * Requests the Run is expected to send. `progress`: progressOf's result before any Request
 * finished, or null. The view's `id` stays the same for the whole Run.
 */
export function beginRun(tab, info, progress = null) {
  if (busy) return false;
  busy = { tab, key: info.key, ck: info.ck ?? null, label: info.label, progress };
  const n = Date.now();
  runs.set(tab, { kind: "run", id: n, state: "running", info, result: null, progress, n });
  changed();
  return true;
}

/**
 * Where the Run in progress stands: progressOf's result. Nothing is redrawn when it equals the
 * last one.
 */
export function setProgress(tab, progress) {
  const view = runs.get(tab);
  if (!busy || busy.tab !== tab || JSON.stringify(progress) === JSON.stringify(busy.progress)) return;
  busy = { ...busy, progress };
  if (view?.kind === "run" && view.state === "running") runs.set(tab, { ...view, progress, n: Date.now() });
  changed();
}

/** Ends the Run in progress with readRun's result. */
export function finishRun(tab, result) {
  const view = runs.get(tab);
  if (view?.kind === "run" && view.state === "running") runs.set(tab, { ...view, state: "done", result, progress: null, n: Date.now() });
  busy = null;
  changed();
}

// The Request each tab's pane shows: `{ key, ck, machine, root, path, format, name }`, in memory.
// Its text lives in drafts.js.
const shownRequests = new Map();

/** Shows a Request on the Request side of a tab's pane. */
export function showRequest(tab, req) {
  shownRequests.set(tab, { ...req, n: Date.now() });
  changed();
}

/** The Request a tab's pane shows, or null. */
export const shownRequest = (tab) => shownRequests.get(tab) ?? null;

/**
 * A file or folder of the tree moved or was renamed (`to`: its new key, `info`: the fields of the
 * shown Request that change) or was deleted (`to` null). Every pane showing it, or a Request under
 * a folder, follows the file or empties.
 */
export function followShown(from, to, info = {}) {
  let any = false;
  for (const [tab, req] of [...shownRequests]) {
    if (req.key !== from && !req.key.startsWith(`${from}/`)) continue;
    any = true;
    if (to == null) { shownRequests.delete(tab); continue; }
    const key = to + req.key.slice(from.length);
    const own = req.key === from;
    const path = key.slice(key.indexOf("#") + 1);
    shownRequests.set(tab, { ...req, ...(own ? info : {}), key, ck: own && info.ck ? info.ck : req.ck, path, n: Date.now() });
  }
  if (any) changed();
}

// Dialog forms (New Request, New folder, Rename, Clone): what the person typed, and the panel's
// answer. In memory only, by the form's id: an ask in shared state carries only that id, so a URL
// or a name typed into a form is never written to disk.
const forms = new Map();

/** The form's values as the dialog sends them, and later the panel's `error` or `busy`. */
export function setForm(id, patch) {
  forms.set(id, { ...(forms.get(id) ?? {}), ...patch });
  changed();
}

export const form = (id) => forms.get(id) ?? null;

export function dropForm(id) { if (forms.delete(id)) changed(); }

// The Environment and .env editor windows that are open, in memory only. While one is open, ctrl-s
// ("brunr.save", which reaches every shown brunr copy) saves that editor and not the pane's Draft.
const editorWindows = new Set();

export function editorOpened(window) { editorWindows.add(window); }
export function editorClosed(window) { editorWindows.delete(window); }
export const editorOpen = () => editorWindows.size > 0;

// The panel copy's Run of one Request, for the pane's Run button. A hidden panel does not draw, so
// it would take an ask only when shown again. The pane calls it with its own cx instead.
let requestRunner = null;

/** The panel sets `run(cx, key)`, or null when it closes. */
export function setRequestRunner(run) { requestRunner = run; }

/** Runs a Request through the panel copy. False when no panel copy is alive. */
export function runRequest(cx, key) {
  if (!requestRunner) return false;
  requestRunner(cx, key);
  return true;
}

// Asks from the mod's popups (picker, menu, dialogs, the key's pass-through copy) to the panel copy
// or a pane copy. As in Dockr, they go through shared state and the copy takes them when it draws:
// a popup closes at once, and work started from its turn would belong to it. An ask holds names,
// row keys and choice ids only, never Request text. `to`: "panel" (the default) or "pane:<tab>".

export const REQUEST = "brunr.request";

/** Hands an ask to the panel: `{ kind, ... }`. */
export function ask(req) {
  setShared(REQUEST, { ...req, n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

/** The latest ask's id, or null. */
export const lastAsk = () => shared(REQUEST)?.n ?? null;

/** The latest ask when it is newer than `seen`, else null. `to`: the copy asking ("panel" or "pane:<tab>"). */
export function takeAsk(seen, to = "panel") {
  const req = shared(REQUEST);
  return req?.n && req.n !== seen && (req.to ?? "panel") === to ? req : null;
}

/** Forgets a tab's Run and shown Request, when its pane closes. Drafts stay. */
export function clearView(tab) {
  const a = runs.delete(tab), b = shownRequests.delete(tab);
  if (a || b) changed();
}
