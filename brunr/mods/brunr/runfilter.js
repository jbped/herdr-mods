// @ts-nocheck
// Filtering and sorting a finished Run's list in the Response pane. Pure: no Herdr, no drawing.
// The result goes to runRows (runtree.js), which still groups the Requests by folder.
import { foldersOf } from "./runtree.js";

/** Each control's values in click order, the first being the default. */
export const RESULTS = Object.freeze(["all", "failed", "passed"]);
export const STATUSES = Object.freeze(["any", "2xx", "3xx", "4xx", "5xx", "error"]);
export const SORTS = Object.freeze(["run", "slowest", "fastest", "status", "name"]);
export const LABELS = Object.freeze({
  all: "All", failed: "Failed", passed: "Passed",
  any: "Any", "2xx": "2xx", "3xx": "3xx", "4xx": "4xx", "5xx": "5xx", error: "Error",
  run: "Run order", slowest: "Slowest", fastest: "Fastest", status: "Status", name: "Name",
  anyMethod: "Any",
});
export const NO_FILTER = Object.freeze({ text: "", result: "all", status: "any", method: null, sort: "run" });

const COMMON_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * The method control's values for a Run's Responses: null (any method), then the methods that occur,
 * the common ones in their usual order and any others alphabetically.
 */
export function methodValues(entries) {
  const seen = new Set((entries ?? []).map((e) => String(e.method ?? "").toUpperCase()).filter(Boolean));
  const common = COMMON_METHODS.filter((m) => seen.has(m));
  const others = [...seen].filter((m) => !COMMON_METHODS.includes(m)).sort();
  return [null, ...common, ...others];
}

/** The method filter for a new Run: kept when the method occurs in it, else back to any (null). */
export function keepMethod(method, entries) {
  return methodValues(entries).includes(method ?? null) ? method ?? null : null;
}

/**
 * The filter that applies to a Run of `total` Responses: the toolbar exists only for a Run with
 * more than one, so a single Response is never filtered away.
 */
export function activeFilter(filter, total) {
  return total > 1 ? { ...NO_FILTER, ...filter } : NO_FILTER;
}

/** The value after `value` in `values`, wrapping round. An unknown value gives the second. */
export function nextValue(values, value) {
  return values[(values.indexOf(value) + 1) % values.length];
}

const words = (text) => String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/** Whether the text, result, status or method filter narrows the list. Sorting is not a filter. */
export function isFiltering({ text = "", result = "all", status = "any", method = null } = {}) {
  return words(text).length > 0 || result !== "all" || status !== "any" || method != null;
}

function statusMatches(status, want) {
  if (want === "any") return true;
  if (want === "error") return status == null;
  const base = Number(want[0]) * 100;
  return typeof status === "number" && status >= base && status < base + 100;
}

function matches(e, find, result, status, method) {
  if (result === "failed" && e.ok) return false;
  if (result === "passed" && !e.ok) return false;
  if (!statusMatches(e.status ?? null, status)) return false;
  if (method != null && String(e.method ?? "").toUpperCase() !== method) return false;
  if (!find.length) return true;
  const hay = [e.name, e.path, e.url].map((x) => String(x ?? "").toLowerCase()).join("\n");
  return find.every((w) => hay.includes(w));
}

/** Compares two Requests for a sort. No-response Requests go last. 0 keeps Run order. */
function compare(sort, a, b) {
  if (sort === "name") {
    const x = String(a.name ?? "").toLowerCase(), y = String(b.name ?? "").toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const key = sort === "status" ? "status" : "time";
  const x = a.status == null ? null : a[key], y = b.status == null ? null : b[key];
  if (x == null || y == null) return (x == null) - (y == null);
  return sort === "slowest" ? y - x : x - y;
}

/**
 * Groups entries (in Run order) as runRows does: a folder node is consecutive Requests under the
 * same folder. Children are folder nodes and entry indexes, in Run order.
 */
function group(entries, ids, target) {
  const root = { children: [] };
  let open = [];
  for (const i of ids) {
    const chain = foldersOf({ target, path: entries[i].path });
    let keep = 0;
    while (keep < open.length && keep < chain.length && open[keep].path === chain[keep]) keep++;
    open = open.slice(0, keep);
    for (let at = keep; at < chain.length; at++) {
      const node = { path: chain[at], children: [] };
      (open.at(-1) ?? root).children.push(node);
      open.push(node);
    }
    (open.at(-1) ?? root).children.push(i);
  }
  return root;
}

/** Entry indexes in display order: in each folder the Requests are sorted, folders keep their place. */
function flatten(node, entries, sort, out) {
  const reqs = node.children.filter((c) => typeof c === "number");
  if (sort !== "run") reqs.sort((a, b) => compare(sort, entries[a], entries[b]) || a - b);
  let r = 0;
  for (const c of node.children) {
    if (typeof c === "number") out.push(reqs[r++]);
    else flatten(c, entries, sort, out);
  }
  return out;
}

/** passed, total and failed of every folder over the whole Run, by folder path. */
function countsOf(entries, target) {
  const counts = new Map();
  for (const e of entries) {
    for (const d of foldersOf({ target, path: e.path })) {
      const c = counts.get(d) ?? { passed: 0, total: 0, failed: false };
      counts.set(d, { passed: c.passed + (e.ok ? 1 : 0), total: c.total + 1, failed: c.failed || !e.ok });
    }
  }
  return counts;
}

/**
 * A finished Run's list after the filters and the sort.
 * `entries`: the Run's Responses in Run order. `text`: words that must all appear in the name,
 * path or URL, ignoring case. `result`: one of RESULTS. `status`: one of STATUSES. `method`: an upper
 * case method, or null for any. `sort`: one of SORTS. The four filters combine.
 * Returns `{ entries, indexes, visible, total, filtering, counts }`: the entries to hand to
 * runRows in display order, each one's index in the Run, how many are shown, how many the Run has,
 * whether a filter is on, and the folder counts of the whole Run to hand to runRows as `counts`.
 */
export function filterRun({ target = null, entries = [], text = "", result = "all", status = "any", method = null, sort = "run" } = {}) {
  const all = entries ?? [];
  const find = words(text);
  const ids = [];
  all.forEach((e, i) => { if (matches(e, find, result, status, method)) ids.push(i); });
  const indexes = flatten(group(all, ids, target), all, SORTS.includes(sort) ? sort : "run", []);
  return {
    entries: indexes.map((i) => all[i]),
    indexes,
    visible: indexes.length,
    total: all.length,
    filtering: isFiltering({ text, result, status, method }),
    counts: countsOf(all, target),
  };
}

/** The selected Request after filtering: `sel` when it is shown, else the first shown, else -1. */
export function keepSelection(sel, indexes) {
  if (indexes.includes(sel)) return sel;
  return indexes.length ? indexes[0] : -1;
}
