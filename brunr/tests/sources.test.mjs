import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, calls, reads } from "./herdr-shim.mjs";
import { FIXTURES } from "./helpers.mjs";
import { collectionKey, configPath, defaultWorkspacePath, discover, loadCollection, parseConfig, readConfig } from "../mods/brunr/sources.js";

const fx = FIXTURES.replace(/\/+$/, "");
const scratch = () => mkdtempSync(join(tmpdir(), "brunr-src-"));
const reset = (extra = {}) => { Object.assign(state, { appHome: "/nonexistent", home: "/nonexistent", platform: "linux", path: null, maxTimeout: Infinity }, extra); calls.length = 0; reads.length = 0; };

test("default workspace path per platform", () => {
  assert.equal(defaultWorkspacePath("windows", "C:\\Users\\sam"), "C:/Users/sam/AppData/Roaming/bruno/default-workspace/workspace.yml");
  assert.equal(defaultWorkspacePath("macos", "/Users/sam/"), "/Users/sam/Library/Application Support/bruno/default-workspace/workspace.yml");
  assert.equal(defaultWorkspacePath("linux", "/home/sam"), "/home/sam/.config/bruno/default-workspace/workspace.yml");
});

test("config path is in the app home, not the mod folder", () => {
  reset({ appHome: "C:\\Users\\sam\\.config\\herdr-app" });
  assert.equal(configPath(), "C:/Users/sam/.config/herdr-app/brunr.json");
});

test("no config file means defaults and no problem", () => {
  assert.deepEqual(parseConfig(null), { workspace: null, collections: [], problems: [] });
  assert.deepEqual(parseConfig("  \n"), { workspace: null, collections: [], problems: [] });
});

test("config with a workspace and entries", () => {
  const c = parseConfig(JSON.stringify({ workspace: " /w/workspace.yml ", collections: [{ machine: "box", path: "/srv/api" }, { path: "C:/api" }, { machine: null, path: "/x" }] }));
  assert.deepEqual(c, { workspace: "/w/workspace.yml", problems: [], collections: [{ machine: "box", path: "/srv/api" }, { machine: null, path: "C:/api" }, { machine: null, path: "/x" }] });
});

test("invalid config JSON gives defaults and names the parse error", () => {
  const c = parseConfig("{ workspace: nope");
  assert.equal(c.workspace, null);
  assert.deepEqual(c.collections, []);
  assert.equal(c.problems.length, 1);
  assert.match(c.problems[0], /^brunr\.json is not valid JSON: /);
});

test("bad config shapes are dropped and named", () => {
  assert.match(parseConfig("[]").problems[0], /must be an object/);
  const c = parseConfig(JSON.stringify({ workspace: 3, collections: [{ path: "" }, { machine: 4, path: "/a" }, "x", { path: "/ok" }] }));
  assert.equal(c.workspace, null);
  assert.deepEqual(c.collections, [{ machine: null, path: "/ok" }]);
  assert.equal(c.problems.length, 4);
  assert.match(parseConfig(JSON.stringify({ collections: {} })).problems[0], /"collections" must be a list/);
});

test("readConfig reads brunr.json from the app home", async () => {
  const dir = scratch();
  reset({ appHome: dir });
  assert.deepEqual(await readConfig(), { workspace: null, collections: [], problems: [] });
  writeFileSync(join(dir, "brunr.json"), '{"collections":[{"path":"/c"}]}');
  assert.deepEqual((await readConfig()).collections, [{ machine: null, path: "/c" }]);
});

function workspaceFixture() {
  const dir = scratch();
  writeFileSync(join(dir, "workspace.yml"), [
    "opencollection: 1.0.0", "info:", '  name: "Test Space"', "  type: workspace", "", "collections:",
    `  - name: "Shop (yaml)"`, `    path: "${fx}/yaml"`, `  - name: "Shop (bru)"`, `    path: "${fx}/bru"`, "", "specs:", "", "docs: ''", "",
  ].join("\n"));
  mkdirSync(join(dir, "environments"));
  writeFileSync(join(dir, "environments", "shared.yml"), "name: shared\nvariables: []\n");
  writeFileSync(join(dir, "environments", "beta.yml"), "name: beta\nvariables: []\n");
  writeFileSync(join(dir, "environments", "notes.txt"), "not an environment");
  return dir;
}

test("discover lists the workspace's Collections and its Global environments", async () => {
  const dir = workspaceFixture();
  reset({ home: "/nonexistent" });
  const d = await discover(parseConfig(JSON.stringify({ workspace: `${dir}/workspace.yml` })));
  assert.deepEqual(d.problems, []);
  assert.equal(d.workspace.name, "Test Space");
  assert.equal(d.workspace.missing, false);
  assert.deepEqual(d.workspace.globals, ["beta", "shared"]);
  assert.deepEqual(d.entries.map((e) => [e.machine, e.root, e.name, e.workspace]), [
    [null, `${fx}/yaml`, "Shop (yaml)", `${dir}/workspace.yml`],
    [null, `${fx}/bru`, "Shop (bru)", `${dir}/workspace.yml`],
  ]);
  assert.equal(d.entries[0].key, collectionKey(null, `${fx}/yaml`));
});

test("a missing workspace file is not a problem", async () => {
  const dir = scratch();
  reset({ home: dir, platform: "linux" });
  const d = await discover(parseConfig(null));
  assert.equal(d.workspace.path, `${dir}/.config/bruno/default-workspace/workspace.yml`);
  assert.equal(d.workspace.missing, true);
  assert.deepEqual(d.entries, []);
  assert.deepEqual(d.problems, []);
});

test("a config path that is a Collection root is one Collection", async () => {
  reset();
  const d = await discover(parseConfig(JSON.stringify({ workspace: "/nonexistent/ws.yml", collections: [{ path: `${fx}/yaml/` }] })));
  assert.deepEqual(d.entries.map((e) => e.root), [`${fx}/yaml`]);
  assert.equal(d.entries[0].workspace, null);
  assert.equal(d.entries[0].name, "yaml");
});

test("a config path that holds Collections gives each child root, on this computer and on another Machine", async () => {
  reset();
  const local = await discover(parseConfig(JSON.stringify({ workspace: "/nonexistent/ws.yml", collections: [{ path: fx }] })));
  assert.deepEqual(local.entries.map((e) => e.root).sort(), [`${fx}/bru`, `${fx}/yaml`]);
  const remote = await discover(parseConfig(JSON.stringify({ workspace: "/nonexistent/ws.yml", collections: [{ machine: "box", path: fx }] })));
  assert.deepEqual(remote.entries.map((e) => [e.machine, e.root]).sort(), [["box", `${fx}/bru`], ["box", `${fx}/yaml`]]);
  assert.ok(calls.some((c) => c.opts.on === "box"), "the remote listing runs on that Machine");
});

test("the same Collection listed twice shows once", async () => {
  const dir = workspaceFixture();
  reset();
  const d = await discover(parseConfig(JSON.stringify({ workspace: `${dir}/workspace.yml`, collections: [{ path: `${fx}/yaml` }] })));
  assert.equal(d.entries.filter((e) => e.root === `${fx}/yaml`).length, 1);
});

test("an unreadable or empty config path is named as a problem", async () => {
  const empty = scratch();
  reset();
  const d = await discover(parseConfig(JSON.stringify({ workspace: "/nonexistent/ws.yml", collections: [{ path: "/nonexistent/apis" }, { path: empty }, { machine: "box", path: "/nonexistent/apis" }] })));
  assert.deepEqual(d.entries, []);
  assert.equal(d.problems.length, 3);
  assert.match(d.problems[0], /^Cannot read \/nonexistent\/apis/);
  assert.match(d.problems[1], /^No Bruno Collection in /);
  assert.match(d.problems[2], /on box/);
});

test("loadCollection gives the same tree from this computer and from another Machine", async () => {
  reset();
  const here = await loadCollection({ machine: null, root: `${fx}/yaml` });
  const there = await loadCollection({ machine: "box", root: `${fx}/yaml` });
  assert.equal(here.collection.name, "Shop");
  assert.deepEqual(there.collection, here.collection);
  const bru = await loadCollection({ machine: null, root: `${fx}/bru` });
  assert.equal(bru.collection.format, "bru");
  const noExt = (n) => n.name.replace(/\.(yml|bru)$/, "");
  assert.deepEqual(bru.collection.children.map(noExt), here.collection.children.map(noExt));
});

test("loadCollection names a folder that is not a Collection or cannot be read", async () => {
  reset();
  assert.match((await loadCollection({ machine: null, root: `${fx}/reports` })).error, /Not a Bruno Collection/);
  assert.match((await loadCollection({ machine: null, root: "/nonexistent/c" })).error, /^Cannot read the Collection/);
  assert.match((await loadCollection({ machine: "box", root: "/nonexistent/c" })).error, /^Cannot read the Collection/);
});
