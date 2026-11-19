// Stands in for the "herdr" module under Node. Programs really run, on this computer: `on` is
// recorded and otherwise ignored, so another Machine's scripts run here through `sh`.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

export const state = { appHome: "/nonexistent", home: "/nonexistent", platform: "linux", shared: {}, path: null, maxTimeout: Infinity };
export const calls = [];
export const reads = [];
export const writes = [];

/** Like Herdr's exec: resolves with the exit code, rejects when the program cannot start or times out. */
export const exec = (cmd, args = [], opts = {}) => {
  calls.push({ cmd, args, opts });
  const env = state.path == null ? process.env : { ...process.env, PATH: state.path };
  return new Promise((res, rej) =>
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: "utf8", maxBuffer: 8 << 20, timeout: Math.min(opts.timeout ?? 30000, state.maxTimeout) }, (e, stdout, stderr) => {
      if (e?.code === "ENOENT") return rej(new Error(`cannot start ${cmd}: program not found`));
      if (e?.killed) return rej(new Error(`${cmd} timed out after ${opts.timeout} ms`));
      res({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr });
    }));
};

export const readTextFile = (path, opts = {}) => { reads.push({ path, on: opts.on ?? null }); return readFile(path, "utf8").catch(() => null); };
/** Like Herdr's writeTextFile: rejects when the file's text is not `expected` (null: when it exists). */
export const writeTextFile = async (path, text, expected) => {
  writes.push({ path, text, expected });
  if (state.failWrite) throw new Error(state.failWrite);
  const current = await readFile(path, "utf8").catch(() => null);
  if (expected === null ? current !== null : current !== expected) throw new Error("stale snapshot");
  await writeFile(path, text);
  return null;
};
export const appHome = () => state.appHome;
export const home = () => state.home;
export const window = () => ({ platform: state.platform });
export const watchFolder = () => { const p = new Promise(() => {}); p.cancel = () => {}; return p; };
export const shared = (k) => state.shared[k];
export const setShared = (k, v) => { state.shared[k] = v; return null; };
export const hc = async () => ({ code: 0, stdout: "", stderr: "" });

// What views use. Each call that could carry text out of a copy is recorded, so a test can check
// that no value from an editor reached it.
export const overlays = [];
export const closed = [];
export const notices = [];
export const ran = [];
export const props = () => state.props ?? null;
export const openOverlay = (spec) => { overlays.push(spec); return `overlay-${overlays.length}`; };
export const closeOverlay = (id) => { closed.push(id); return null; };
export const notify = (n) => { notices.push(n); return `notice-${notices.length}`; };
export const run = (name, args) => { ran.push({ name, args }); return null; };
export const nextCommand = () => new Promise(() => {});
export const theme = () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? "#808080" : undefined) });
export const settings = () => ({});
export const panes = () => [];
export const focused = () => null;
export const layout = () => null;
export const checking = () => false;
