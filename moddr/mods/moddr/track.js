// Moddr's logic, with no Herdr imports: what a Source is, what GitHub says about it, and how a
// mod's files compare with its upstream versions. main.js hands in `io`:
//   io.fetch(url, opts)   Herdr's fetch
//   io.files(name)        { "<relative path>": "<git blob sha>" } for the mod's local files
// so the tests can stand in for both.

const API = "https://api.github.com";
const SEG = /^[A-Za-z0-9_.-]+$/;
export const COMMITS = 30; // commits of a Source read per refresh
export const SEARCH = 10; // older commits tried when the installed version is not known yet

/** Files Herdr writes into every mod folder, never part of a Source. */
export function ignored(path) {
  const base = path.split("/").pop();
  return base === "jsconfig.json" || base.endsWith(".d.ts") || path.split("/").some((p) => p.startsWith("."));
}

/**
 * A Source from what the person typed: a GitHub folder URL (github.com/<owner>/<repo>/tree/<ref>/<path>),
 * a repo URL, or "<owner>/<repo>[/<path>]". ref null means the default branch. Throws a message fit to show.
 */
export function parseSource(text) {
  let s = String(text ?? "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.startsWith("github.com/")) s = s.slice("github.com/".length);
  else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s)) throw new Error("Only GitHub sources are supported, such as https://github.com/<owner>/<repo>/tree/main/<folder>");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("A source needs an owner and a repo, such as https://github.com/<owner>/<repo>/tree/main/<folder>");
  const [owner, repo, ...rest] = parts;
  let ref = null, path = rest;
  if (rest[0] === "tree" || rest[0] === "blob") {
    if (!rest[1]) throw new Error("The URL names no branch after /tree/");
    ref = rest[1];
    path = rest.slice(2);
  }
  for (const p of [owner, repo, ...(ref ? [ref] : []), ...path]) {
    if (!SEG.test(p)) throw new Error(`"${p}" is not a name GitHub uses`);
  }
  return { owner, repo, ref, path: path.join("/") };
}

/** The Source as a GitHub URL. */
export function sourceUrl(src) {
  const base = `https://github.com/${src.owner}/${src.repo}`;
  return src.path || src.ref ? `${base}/tree/${src.ref ?? "HEAD"}${src.path ? `/${src.path}` : ""}` : base;
}

/** GitHub folder links in a mod's own text (its README), the first ones first. */
export function sourcesIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/tree\/[A-Za-z0-9_./-]+)?/g)) {
    const url = m[0].replace(/[.)]+$/, "");
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

async function get(io, url, token) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "herdr-moddr" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try { res = await io.fetch(url, { method: "GET", headers }); } catch { throw new Error("GitHub could not be reached"); }
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = body?.message ?? "";
    if (res.status === 403 && /rate limit/i.test(msg)) throw new Error("GitHub's hourly limit for unsigned requests is used up. Try later, sign in with gh auth login, or add a token to moddr.json");
    if (res.status === 404) throw new Error(token ? "GitHub has no such repo or branch, or this account cannot see it" : "GitHub has no such repo or branch, or it is private. Sign in with gh auth login to read private repos");
    throw new Error(msg ? `GitHub answered ${res.status}: ${msg}` : `GitHub answered ${res.status}`);
  }
  return body;
}

/** The newest commits that touch the Source's folder, newest first: [{ sha, message, date }]. */
export async function commits(io, src, token) {
  const q = new URLSearchParams({ per_page: String(COMMITS) });
  if (src.ref) q.set("sha", src.ref);
  if (src.path) q.set("path", src.path);
  const list = await get(io, `${API}/repos/${src.owner}/${src.repo}/commits?${q}`, token);
  if (!Array.isArray(list)) throw new Error("GitHub answered with no commit list");
  return list.map((c) => ({
    sha: c.sha,
    message: String(c.commit?.message ?? "").split("\n")[0],
    date: c.commit?.committer?.date ?? c.commit?.author?.date ?? null,
  }));
}

/** The files under `path` at a commit: { "<path relative to it>": "<blob sha>" }. */
export async function filesAt(io, src, sha, path = src.path, token) {
  const body = await get(io, `${API}/repos/${src.owner}/${src.repo}/git/trees/${sha}?recursive=1`, token);
  if (body?.truncated) throw new Error("The repo is too big for GitHub to list in one answer");
  const prefix = path ? `${path}/` : "";
  const out = {};
  for (const e of body?.tree ?? []) {
    if (e.type !== "blob" || !e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    if (!ignored(rel)) out[rel] = e.sha;
  }
  return out;
}

/**
 * Where in the repo the mod's own folder is. A share folder holds mods/<name>/, so a URL to the
 * share resolves to that. Returns the Source with that path, or throws when the folder holds no mod.
 */
export async function resolve(io, src, name, token) {
  const list = await commits(io, { ...src, path: "" }, token);
  if (!list.length) throw new Error("The branch has no commits");
  const files = await filesAt(io, src, list[0].sha, "", token);
  const has = (p) => Object.keys(files).some((f) => f === `${p}/main.js` || (!p && f === "main.js"));
  const join = (...p) => p.filter(Boolean).join("/");
  for (const p of [src.path, join(src.path, "mods", name)]) {
    if (has(p)) return { ...src, path: p };
  }
  throw new Error(`There is no main.js at ${src.path || "the repo root"}, nor in ${join(src.path, "mods", name)}`);
}

/** The paths whose files differ between two file maps, sorted: added, removed or changed. */
export function differ(local, upstream) {
  const out = [];
  for (const p of new Set([...Object.keys(local), ...Object.keys(upstream)])) {
    if (local[p] !== upstream[p]) out.push(p);
  }
  return out.sort();
}

/**
 * One refresh of a tracked mod. `entry` is its saved record: { source, installed }.
 * Returns the new record's check fields:
 *   installed   the commit the local files were installed from (null: not found)
 *   latest      the newest commit of the Source
 *   behind      the commits after `installed`, newest first ([] when current)
 *   more        true when more commits are behind than were read
 *   edited      local paths that differ from `installed`
 */
export async function check(io, name, entry, token) {
  const src = entry.source;
  const [local, list] = await Promise.all([io.files(name), commits(io, src, token)]);
  if (!list.length) throw new Error("The folder has no commits on that branch");
  const latest = list[0];
  const latestFiles = await filesAt(io, src, latest.sha, src.path, token);
  if (!differ(local, latestFiles).length) return { installed: latest.sha, latest, behind: [], more: false, edited: [] };

  let installed = entry.installed ?? null, installedFiles = null;
  if (!installed) {
    // Not known yet: the newest of the recent commits whose files match the local ones.
    for (const c of list.slice(1, 1 + SEARCH)) {
      const f = await filesAt(io, src, c.sha, src.path, token);
      if (!differ(local, f).length) { installed = c.sha; installedFiles = f; break; }
    }
  }
  if (!installed) return { installed: null, latest, behind: [], more: false, edited: differ(local, latestFiles) };

  const at = list.findIndex((c) => c.sha === installed);
  const behind = at < 0 ? list : list.slice(0, at);
  installedFiles ??= installed === latest.sha ? latestFiles : await filesAt(io, src, installed, src.path, token);
  return { installed, latest, behind, more: at < 0, edited: differ(local, installedFiles) };
}

/**
 * What a record says, for the list: "untracked", "checking", "error", "unknown" (local files match
 * no recent version), "updates", "edited" (no updates, local edits) or "current".
 */
export function state(entry, busy) {
  if (!entry?.source) return "untracked";
  if (busy) return "checking";
  const c = entry.check;
  if (!c) return "unchecked";
  if (c.error) return "error";
  if (!entry.installed) return "unknown";
  if (c.behind?.length) return "updates";
  if (c.edited?.length) return "edited";
  return "current";
}
