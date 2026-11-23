// @ts-nocheck
// Run progress: the Bruno CLI's output, read while a Run is in progress, to the Requests that have
// finished and the one that runs now. Pure: no Herdr, no Node APIs, no imports.
//
// The CLI prints one line as each Request finishes, then its assertion and test lines:
//   products/List Products (200 OK) - 23 ms
//   orders/Closed Port (connect ECONNREFUSED 127.0.0.1:47912)
//   orders/Ask Name Skipped: (Prompt variables detected in request. …
// The path is relative to the Collection root and has no extension.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const DONE = /^(.+) \((\d{3}) ([^()]*)\) - (\d+) ms$/;
const SKIPPED = /^(.+) Skipped: \(/;
const FAILED = /^(.+) \(([^()]+)\)$/;

const slash = (p) => String(p ?? "").replace(/\\/g, "/");
/** A path with forward slashes and no extension, for matching paths across formats. */
export const noExt = (p) => slash(p).replace(/\.[^./]+$/, "");
const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);

/** One output line as a finished Request, or null when the line is not a result line. */
function resultLine(line) {
  if (!line || /^\s/.test(line)) return null;
  let m = DONE.exec(line);
  if (m) return { path: slash(m[1]), status: Number(m[2]), statusText: m[3], time: Number(m[4]) };
  m = SKIPPED.exec(line);
  if (m) return { path: slash(m[1]), status: null, statusText: "Skipped", time: null };
  m = FAILED.exec(line);
  if (m && !/^(Error|Warning)\b/.test(line)) return { path: slash(m[1]), status: null, statusText: m[2], time: null };
  return null;
}

/**
 * The finished Requests in the order printed: `{ finished: [{ path, status, statusText, time }], lines }`.
 * `lines` counts the complete lines read. A partly written last line is left for the next read.
 */
export function parseProgress(text) {
  const all = String(text ?? "").replace(ANSI, "").split("\n");
  all.pop();
  const finished = [];
  for (const raw of all) {
    const hit = resultLine(raw.replace(/\r$/, ""));
    if (hit) finished.push(hit);
  }
  return { finished, lines: all.length };
}

/**
 * Where a Run stands. `planned`: the Request nodes the Run is expected to send, in the CLI's order.
 * `finished`: parseProgress's list. `running` is the next planned Request, and only while every
 * finished path matches the planned order so far. Paths match without their extension.
 */
export function progressOf({ planned = [], finished = [] }) {
  const plan = planned ?? [];
  const byPath = new Map(plan.map((n) => [noExt(n.path), n]));
  const list = (finished ?? []).map((f) => {
    const node = byPath.get(noExt(f.path)) ?? null;
    return {
      name: node?.name ?? baseName(noExt(f.path)), path: f.path, method: node?.method ?? null,
      status: f.status, statusText: f.statusText, time: f.time,
      ok: typeof f.status === "number" && f.status >= 200 && f.status < 400,
    };
  });
  const inOrder = list.every((f, i) => i < plan.length && noExt(plan[i].path) === noExt(f.path));
  const next = inOrder ? plan[list.length] : null;
  return {
    done: Math.min(list.length, plan.length),
    total: plan.length,
    finished: list,
    running: next ? { name: next.name, path: next.path } : null,
  };
}
