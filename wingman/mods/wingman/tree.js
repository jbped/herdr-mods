// File tree for the Edit view: pure, no Herdr imports.

/** A nested folder tree from relative paths: { dirs: Map<name, node>, files: string[] }. */
export function buildTree(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/"), name = parts.pop();
    let node = root;
    for (const d of parts) {
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(name);
  }
  return root;
}

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * The visible rows of a tree: folders first, then files, each sorted by name. A folder's
 * children are listed only when `open(prefix)` is true for its "dir/" prefix.
 * Rows: { dir, rel, name, depth } (a folder's rel ends with "/").
 */
export function flatten(node, open, prefix = "", depth = 0, out = []) {
  for (const name of [...node.dirs.keys()].sort(byName)) {
    const rel = `${prefix}${name}/`;
    out.push({ dir: true, rel, name, depth });
    if (open(rel)) flatten(node.dirs.get(name), open, rel, depth + 1, out);
  }
  for (const name of [...node.files].sort(byName)) out.push({ dir: false, rel: prefix + name, name, depth });
  return out;
}

/** Every folder prefix of a relative path: "a/b/c.js" -> ["a/", "a/b/"]. */
export function parents(rel) {
  const parts = rel.split("/"), out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/") + "/");
  return out;
}
