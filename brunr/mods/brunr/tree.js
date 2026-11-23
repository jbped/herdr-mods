// @ts-nocheck
// The panel's rows and what a key does on one. Pure: no Herdr, no drawing.
import { countRequests } from "./parser.js";

/**
 * The visible rows, top to bottom.
 * `entries`: discover()'s Collections. `loaded`: Map of Collection key to `{ collection?, error?, loading? }`.
 * `workspace`: discover()'s workspace or null. `isOpen(key, fallback)`: fold state. Collections
 * start unfolded, folders folded.
 * `envOf(entry, collection)`: `{ name, secrets }` for the Environment a Run uses.
 * `globalOf(workspacePath)`: the chosen Global environment or null.
 * A row: `{ key, kind, depth, parent, ck, name, ... }`. `ck` is its Collection's key.
 */
export function buildRows({ entries = [], loaded = new Map(), workspace = null, isOpen = () => false, envOf = () => ({ name: null, secrets: [] }), globalOf = () => null }) {
  const rows = [];
  const machines = [...new Set(entries.map((e) => e.machine ?? null))];
  const many = machines.length > 1;
  for (const m of machines) {
    let depth = 0, parent = null;
    if (many) {
      parent = `m:${m ?? ""}`;
      rows.push({ key: parent, kind: "machine", depth: 0, parent: null, ck: null, name: m ?? "This computer", machine: m });
      depth = 1;
    }
    let globalShown = false;
    for (const e of entries.filter((x) => (x.machine ?? null) === m)) {
      if (!globalShown && workspace && e.workspace === workspace.path && workspace.globals?.length) {
        globalShown = true;
        rows.push({ key: `g:${workspace.path}`, kind: "global", depth, parent, ck: null, name: "Global environment", wsPath: workspace.path, env: globalOf(workspace.path), options: workspace.globals });
      }
      const state = loaded.get(e.key) ?? {};
      const c = state.collection ?? null;
      const env = c ? envOf(e, c) : { name: null, secrets: [] };
      const open = isOpen(e.key, true);
      rows.push({
        key: e.key, kind: "collection", depth, parent, ck: e.key, path: "", machine: e.machine ?? null,
        name: c?.name || e.name, open, loading: !!state.loading && !c, error: state.error ?? null,
        errors: c?.errors ?? [], count: c ? countRequests(c) : 0, env: env.name, secrets: env.secrets,
      });
      if (open && c) addNodes(rows, c.children, e, depth + 1, e.key, isOpen);
    }
  }
  return rows;
}

function addNodes(rows, nodes, entry, depth, parent, isOpen) {
  for (const n of nodes ?? []) {
    const key = `${entry.key}#${n.path}`;
    if (n.kind === "folder") {
      const open = isOpen(key, false);
      rows.push({ key, kind: "folder", depth, parent, ck: entry.key, machine: entry.machine ?? null, path: n.path, name: n.name, open, count: countRequests(n) });
      if (open) addNodes(rows, n.children, entry, depth + 1, key, isOpen);
    } else {
      rows.push({ key, kind: "request", depth, parent, ck: entry.key, machine: entry.machine ?? null, path: n.path, name: n.name, method: n.method, url: n.url, type: n.type });
    }
  }
}

export const foldable = (row) => row?.kind === "collection" || row?.kind === "folder";
export const runsMany = foldable;

/**
 * What a key does on the selected row: `{ act, ... }` or null.
 * Acts: move (`to`, an index), fold (`key`, `open`), run (`row`), runMany (`row`), env (`row`),
 * global (`row`), file (`row`), bruno (`row`), leave.
 */
export function keyAction(keystroke, rows, at) {
  const row = rows[at] ?? null;
  const last = rows.length - 1;
  switch (keystroke) {
    case "up": case "k": return rows.length ? { act: "move", to: Math.max(0, at - 1) } : null;
    case "down": case "j": return rows.length ? { act: "move", to: Math.min(last, at + 1) } : null;
    case "home": return rows.length ? { act: "move", to: 0 } : null;
    case "end": return rows.length ? { act: "move", to: last } : null;
    case "escape": case "q": return { act: "leave" };
  }
  if (!row) return null;
  switch (keystroke) {
    case "left": case "h":
      if (foldable(row) && row.open) return { act: "fold", key: row.key, open: false };
      if (row.parent) { const p = rows.findIndex((r) => r.key === row.parent); return p >= 0 ? { act: "move", to: p } : null; }
      return null;
    case "right": case "l":
      if (foldable(row) && !row.open) return { act: "fold", key: row.key, open: true };
      if (foldable(row) && rows[at + 1]?.parent === row.key) return { act: "move", to: at + 1 };
      return null;
    case "enter":
      if (row.kind === "request") return { act: "run", row };
      if (foldable(row)) return { act: "fold", key: row.key, open: !row.open };
      if (row.kind === "global") return { act: "global", row };
      return null;
    case "r":
      if (runsMany(row)) return { act: "runMany", row };
      if (row.kind === "request") return { act: "run", row };
      return null;
    case "e":
      if (row.kind === "global") return { act: "global", row };
      return row.ck ? { act: "env", row } : null;
    case "o": return row.kind === "request" ? { act: "file", row } : null;
    case "b": return row.ck && row.machine == null ? { act: "bruno", row } : null;
  }
  return null;
}

/** The layout block that shows the panel: `{ id, shown }`, or null when no layout block has it. */
export function findBlock(root, mod) {
  let found = null;
  const walk = (n, shown) => {
    if (!n || typeof n !== "object" || found) return;
    const here = shown && !n.hidden;
    if (n.content?.mod === mod && !n.content?.props?.view) { found = { id: n.id ?? null, shown: here }; return; }
    for (const c of n.children ?? []) walk(c, here && (n.type !== "stack" || n.active === c.id));
  };
  walk(root, true);
  return found;
}

/**
 * What a row shows for the Run in progress (store.running()): `{ spinner, count }`. The row that
 * runs has a spinner, and `count` ("2/5") when it runs many. The Request running now has a spinner.
 */
export function runMark(row, run) {
  if (!run || !row) return { spinner: false, count: null };
  const p = run.progress ?? null;
  if (run.key === row.key) return { spinner: true, count: p && row.kind !== "request" ? `${p.done}/${p.total}` : null };
  const now = p?.running;
  return { spinner: Boolean(now) && row.kind === "request" && row.ck === run.ck && row.path === now.path, count: null };
}

/** The text of a folder or Collection Run's confirmation. */
export function confirmText(count, name, environment) {
  return `Run ${count} ${count === 1 ? "Request" : "Requests"} in "${name}" against ${environment ?? "No Environment"}?`;
}

/** The warning for an Environment with secret variables, or null. */
export function secretWarning(names) {
  return names?.length ? `Secret variables are empty in CLI Runs: ${names.join(", ")}. Move them to .env.` : null;
}

/**
 * The {{variable}} names in a URL, once each, in order. `{{process.env.X}}` comes from `.env`,
 * which a Run cannot replace, so it is left out.
 * @param {string | null | undefined} url
 */
export function urlVariables(url) {
  const out = [];
  for (const m of String(url ?? "").matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)) {
    if (!m[1].startsWith("process.env.") && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
