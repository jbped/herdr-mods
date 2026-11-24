// The vault as data: which file a link names, and the rows the list shows. Pure, so node can test it.

export const slash = (p) => p.replace(/\\/g, "/");
export const base = (p) => p.slice(p.lastIndexOf("/") + 1);
export const stem = (p) => base(p).replace(/\.md$/i, "");
export const isNote = (p) => /\.md$/i.test(p);
export const order = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

// The folders above a path, outermost first: "a/b/c.md" -> ["a", "a/b"].
export function ancestors(path) {
  const dirs = path.split("/").slice(0, -1);
  return dirs.map((_d, i) => dirs.slice(0, i + 1).join("/"));
}

// files: every file as a path below the vault, with "/" between folders.
export function makeIndex(files) {
  const sorted = [...files].sort(order);
  const lower = new Map();  // lowercased path -> path
  const byName = new Map(); // lowercased base name (notes without .md) -> paths
  for (const f of sorted) {
    lower.set(f.toLowerCase(), f);
    const key = stem(f).toLowerCase();
    if (byName.has(key)) byName.get(key).push(f); else byName.set(key, [f]);
  }
  return { files: sorted, notes: sorted.filter(isNote), lower, byName };
}

// A link's note part -> a file path below the vault, or null. A path from the vault root or from
// the linking note's folder wins; otherwise Obsidian's rule: that base name anywhere in the vault.
export function resolve(index, name, from) {
  const want = slash(name.trim()).replace(/^\.\//, "").replace(/^\//, "").toLowerCase();
  if (!want) return from ?? null;
  const dir = from && from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1).toLowerCase() : "";
  for (const candidate of [want, `${want}.md`, dir + want, `${dir}${want}.md`]) {
    const hit = index.lower.get(candidate);
    if (hit) return hit;
  }
  const hits = index.byName.get(stem(want)) ?? [];
  return hits.find((f) => { const l = f.toLowerCase(); return l.endsWith(`/${want}`) || l.endsWith(`/${want}.md`) || l === want || l === `${want}.md`; })
    ?? (want.includes("/") ? null : hits.find(isNote) ?? hits[0] ?? null);
}

// The list's rows. With a query: matching notes, name matches first. Without: the folder tree,
// showing what is inside the folders in `open`.
// -> [{ kind: "dir" | "note", key, path, depth, label, open? }]
export function rows(index, open, query, max = 200) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const hits = index.notes.filter((f) => { const l = f.toLowerCase(); return words.every((w) => l.includes(w)); });
    const inName = (f) => { const l = stem(f).toLowerCase(); return words.every((w) => l.includes(w)); };
    return [...hits.filter(inName), ...hits.filter((f) => !inName(f))].slice(0, max)
      .map((f) => ({ kind: "note", key: `n:${f}`, path: f, depth: 0, label: f.replace(/\.md$/i, "") }));
  }
  // Folders first, then notes, at every level.
  const tree = { dirs: new Map(), notes: [] };
  for (const f of index.notes) {
    let node = tree;
    for (const d of f.split("/").slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), notes: [] });
      node = node.dirs.get(d);
    }
    node.notes.push(f);
  }
  const out = [];
  const walk = (node, prefix, depth) => {
    for (const name of [...node.dirs.keys()].sort(order)) {
      const path = prefix ? `${prefix}/${name}` : name;
      const isOpen = open.has(path);
      out.push({ kind: "dir", key: `d:${path}`, path, depth, label: name, open: isOpen });
      if (isOpen) walk(node.dirs.get(name), path, depth + 1);
    }
    for (const f of node.notes) out.push({ kind: "note", key: `n:${f}`, path: f, depth, label: stem(f) });
  };
  walk(tree, "", 0);
  return out;
}

// A short stable name for a vault's image cache folder.
export function vaultKey(path) {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h * 33) ^ path.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// The saved vaults in their saved order, with the current one added when the list lacks it (a
// vault chosen before there was a list).
export function vaultList(saved, current) {
  const out = [];
  for (const p of [...(Array.isArray(saved) ? saved : []), current]) {
    if (typeof p !== "string") continue;
    const v = slash(p.trim()).replace(/\/+$/, "");
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// The vault `by` places after the current one, going round. Null when there is none.
export function nextVault(list, current, by = 1) {
  if (!list.length) return null;
  const at = list.indexOf(current);
  return at < 0 ? list[0] : list[(((at + by) % list.length) + list.length) % list.length];
}
