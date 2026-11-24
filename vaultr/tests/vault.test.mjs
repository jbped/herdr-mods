import { test } from "node:test";
import assert from "node:assert/strict";
import { makeIndex, resolve, rows, ancestors, vaultKey, vaultList, nextVault } from "../mods/vaultr/vault.js";

const index = makeIndex([
  "Home.md", "docs/readme.md", "Projects/Atlas/Atlas Overview.md", "Projects/Atlas/Decisions.md",
  "Projects/Birch/Decisions.md", "Attachments/diagram.png", "Zeta.md", "Projects/Atlas/local.png",
]);

test("files sort without regard to case", () => {
  assert.deepEqual(index.notes.slice(0, 2), ["docs/readme.md", "Home.md"]);
});

test("a link resolves by path, by the linking note's folder, then by name", () => {
  assert.equal(resolve(index, "Home", "Zeta.md"), "Home.md");
  assert.equal(resolve(index, "home.MD", "Zeta.md"), "Home.md");
  assert.equal(resolve(index, "Projects/Birch/Decisions", "Home.md"), "Projects/Birch/Decisions.md");
  assert.equal(resolve(index, "Decisions", "Projects/Birch/Decisions.md"), "Projects/Birch/Decisions.md");
  assert.equal(resolve(index, "Decisions", "Home.md"), "Projects/Atlas/Decisions.md");
  assert.equal(resolve(index, "Atlas/Decisions", "Home.md"), "Projects/Atlas/Decisions.md");
  assert.equal(resolve(index, "diagram.png", "Home.md"), "Attachments/diagram.png");
  assert.equal(resolve(index, "local.png", "Projects/Atlas/Decisions.md"), "Projects/Atlas/local.png");
  assert.equal(resolve(index, "Missing", "Home.md"), null);
  assert.equal(resolve(index, "Nope/Decisions", "Home.md"), null);
  assert.equal(resolve(index, "", "Home.md"), "Home.md");
});

test("the tree lists folders first and only what is inside open folders", () => {
  const label = (r) => `${"  ".repeat(r.depth)}${r.kind === "dir" ? (r.open ? "v " : "> ") : ""}${r.label}`;
  assert.deepEqual(rows(index, new Set(), "").map(label), ["> docs", "> Projects", "Home", "Zeta"]);
  assert.deepEqual(rows(index, new Set(["Projects", "Projects/Atlas"]), "").map(label),
    ["> docs", "v Projects", "  v Atlas", "    Atlas Overview", "    Decisions", "  > Birch", "Home", "Zeta"]);
});

test("search matches every word, name matches first", () => {
  assert.deepEqual(rows(index, new Set(), "atlas").map((r) => r.path), ["Projects/Atlas/Atlas Overview.md", "Projects/Atlas/Decisions.md"]);
  assert.deepEqual(rows(index, new Set(), "dec birch").map((r) => r.path), ["Projects/Birch/Decisions.md"]);
  assert.deepEqual(rows(index, new Set(), "nothing"), []);
  assert.equal(rows(index, new Set(), "e", 2).length, 2);
});

test("ancestors and the cache key", () => {
  assert.deepEqual(ancestors("a/b/c.md"), ["a", "a/b"]);
  assert.deepEqual(ancestors("c.md"), []);
  assert.equal(vaultKey("C:/vault"), vaultKey("C:/vault"));
  assert.notEqual(vaultKey("C:/vault"), vaultKey("C:/vault2"));
});

test("the vault list keeps its order, drops repeats and adds the current vault", () => {
  assert.deepEqual(vaultList(["C:/a/one", "C:\\a\\two/", "C:/a/one"], "C:/a/three"), ["C:/a/one", "C:/a/two", "C:/a/three"]);
  assert.deepEqual(vaultList(undefined, "C:/a/one"), ["C:/a/one"]);
  assert.deepEqual(vaultList(["C:/a/one", 4, ""], null), ["C:/a/one"]);
  assert.deepEqual(vaultList("C:/a/one", null), []);
});

test("the next vault goes round in both directions", () => {
  const list = ["a", "b", "c"];
  assert.equal(nextVault(list, "a"), "b");
  assert.equal(nextVault(list, "c"), "a");
  assert.equal(nextVault(list, "a", -1), "c");
  assert.equal(nextVault(list, "gone"), "a");
  assert.equal(nextVault([], "a"), null);
});
