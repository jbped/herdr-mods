// track.js against a stand-in GitHub: node --test moddr/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, differ, ignored, parseSource, resolve, sourcesIn, sourceUrl, state } from "../mods/moddr/track.js";

// A repo history, newest first: [{ sha, message, files: { "<repo path>": "<blob>" } }].
function github(history, calls = []) {
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const tree = u.pathname.match(/\/git\/trees\/([^/]+)$/);
    if (tree) {
      const c = history.find((h) => h.sha === tree[1]);
      if (!c) return reply(404, { message: "Not Found" });
      return reply(200, { truncated: false, tree: Object.entries(c.files).map(([path, sha]) => ({ path, sha, type: "blob" })) });
    }
    if (u.pathname.endsWith("/commits")) {
      const path = u.searchParams.get("path");
      const touches = (c, i) => {
        if (!path) return true;
        const pick = (h) => Object.fromEntries(Object.entries(h?.files ?? {}).filter(([p]) => p.startsWith(`${path}/`)));
        return JSON.stringify(pick(c)) !== JSON.stringify(pick(history[i + 1]));
      };
      const list = history.filter(touches).slice(0, Number(u.searchParams.get("per_page")));
      return reply(200, list.map((c) => ({ sha: c.sha, commit: { message: `${c.message}\n\nbody`, committer: { date: "2026-11-01T00:00:00Z" } } })));
    }
    return reply(404, { message: "Not Found" });
  };
}

const src = { owner: "o", repo: "r", ref: null, path: "share/mods/m" };
const history = [
  { sha: "c3", message: "three", files: { "share/mods/m/main.js": "b3", "share/mods/m/mod.json": "j1", "README.md": "r2" } },
  { sha: "c2", message: "readme only", files: { "share/mods/m/main.js": "b2", "share/mods/m/mod.json": "j1", "README.md": "r2" } },
  { sha: "c1", message: "two", files: { "share/mods/m/main.js": "b2", "share/mods/m/mod.json": "j1", "README.md": "r1" } },
  { sha: "c0", message: "one", files: { "share/mods/m/main.js": "b1", "share/mods/m/mod.json": "j1", "README.md": "r1" } },
];
// The record main.js saves: installed on the entry, the rest under check.
const saved = (r) => ({ source: src, installed: r.installed, check: { ...r, installed: undefined } });
const io = (local, calls) => ({ fetch: github(history, calls), files: async () => local });

test("parseSource reads folder URLs, repo URLs and owner/repo paths", () => {
  assert.deepEqual(parseSource("https://github.com/jbped/herdr-mods/tree/main/notifyr"), { owner: "jbped", repo: "herdr-mods", ref: "main", path: "notifyr" });
  assert.deepEqual(parseSource("github.com/a/b.git/"), { owner: "a", repo: "b", ref: null, path: "" });
  assert.deepEqual(parseSource("a/b/x/y"), { owner: "a", repo: "b", ref: null, path: "x/y" });
  assert.throws(() => parseSource("https://gitlab.com/a/b"), /Only GitHub/);
  assert.throws(() => parseSource("a"), /owner and a repo/);
  assert.throws(() => parseSource("a/b/tree/main/x y"), /not a name/);
});

test("sourceUrl gives a URL parseSource reads back", () => {
  const s = { owner: "a", repo: "b", ref: "dev", path: "x/mods/y" };
  assert.deepEqual(parseSource(sourceUrl(s)), s);
});

test("sourcesIn finds GitHub links in a README", () => {
  const text = "Install: https://github.com/a/b/tree/main/x. Also (https://github.com/a/b) and https://github.com/a/b/tree/main/x again";
  assert.deepEqual(sourcesIn(text), ["https://github.com/a/b/tree/main/x", "https://github.com/a/b"]);
});

test("ignored skips Herdr's own files and dot files", () => {
  assert.ok(ignored("jsconfig.json") && ignored("gpui-kit.d.ts") && ignored(".git/x") && ignored("a/.hidden"));
  assert.ok(!ignored("main.js") && !ignored("icons/a.svg"));
});

test("resolve finds the mod under a share folder", async () => {
  const got = await resolve(io({}), { ...src, path: "share" }, "m");
  assert.equal(got.path, "share/mods/m");
  await assert.rejects(resolve(io({}), { ...src, path: "nope" }, "m"), /no main\.js/);
});

test("current: the newest upstream version is installed", async () => {
  const r = await check(io({ "main.js": "b3", "mod.json": "j1" }), "m", { source: src });
  assert.equal(r.installed, "c3");
  assert.deepEqual(r.behind, []);
  assert.equal(state(saved(r)), "current");
});

test("an older install is found by its files and the newer commits are listed", async () => {
  const r = await check(io({ "main.js": "b2", "mod.json": "j1" }), "m", { source: src });
  assert.equal(r.installed, "c1"); // c2 only touched README.md, outside the mod
  assert.deepEqual(r.behind.map((c) => c.sha), ["c3"]);
  assert.equal(r.behind[0].message, "three");
  assert.deepEqual(r.edited, []);
  assert.equal(state(saved(r)), "updates");
});

test("a known install with local edits shows the edits and the updates", async () => {
  const r = await check(io({ "main.js": "mine", "mod.json": "j1", "extra.js": "e" }), "m", { source: src, installed: "c0" });
  assert.equal(r.installed, "c0");
  assert.deepEqual(r.behind.map((c) => c.sha), ["c3", "c1"]);
  assert.deepEqual(r.edited, ["extra.js", "main.js"]);
});

test("edited: no updates, local changes", async () => {
  const r = await check(io({ "main.js": "mine", "mod.json": "j1" }), "m", { source: src, installed: "c3" });
  assert.deepEqual(r.behind, []);
  assert.deepEqual(r.edited, ["main.js"]);
  assert.equal(state(saved(r)), "edited");
});

test("unknown: local files match no recent version", async () => {
  const r = await check(io({ "main.js": "mine", "mod.json": "j1" }), "m", { source: src });
  assert.equal(r.installed, null);
  assert.equal(r.latest.sha, "c3");
  assert.deepEqual(r.edited, ["main.js"]);
  assert.equal(state(saved(r)), "unknown");
});

test("a current mod costs two requests", async () => {
  const calls = [];
  await check(io({ "main.js": "b3", "mod.json": "j1" }, calls), "m", { source: src });
  assert.equal(calls.length, 2);
});

test("GitHub's rate limit is said plainly", async () => {
  const fetch = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ message: "API rate limit exceeded for 1.2.3.4" }) });
  await assert.rejects(check({ fetch, files: async () => ({}) }, "m", { source: src }), /hourly limit/);
});

test("differ and state", () => {
  assert.deepEqual(differ({ a: "1", b: "2" }, { a: "1", c: "3" }), ["b", "c"]);
  assert.equal(state(null), "untracked");
  assert.equal(state({ source: src }, true), "checking");
  assert.equal(state({ source: src }), "unchecked");
  assert.equal(state({ source: src, check: { error: "x" } }), "error");
});

test("a token signs every request", async () => {
  const seen = [];
  const fetch = async (url, opts) => { seen.push(opts.headers.Authorization); return github(history)(url); };
  await check({ fetch, files: async () => ({ "main.js": "b3", "mod.json": "j1" }) }, "m", { source: src }, "gho_abc");
  assert.ok(seen.length && seen.every((h) => h === "Bearer gho_abc"));
  const bare = [];
  await check({ fetch: async (url, opts) => { bare.push(opts.headers.Authorization); return github(history)(url); }, files: async () => ({ "main.js": "b3", "mod.json": "j1" }) }, "m", { source: src });
  assert.ok(bare.every((h) => h === undefined));
});

test("a missing repo points at gh when unsigned", async () => {
  const fetch = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ message: "Not Found" }) });
  await assert.rejects(check({ fetch, files: async () => ({}) }, "m", { source: src }), /gh auth login/);
  await assert.rejects(check({ fetch, files: async () => ({}) }, "m", { source: src }, "t"), /cannot see it/);
});
