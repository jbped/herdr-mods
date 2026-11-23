import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, calls, writes } from "./herdr-shim.mjs";
import { deletePermanently, insideRoot, readTexts, runEffects, trash } from "../mods/brunr/effects.js";

const scratch = () => mkdtempSync(join(tmpdir(), "brunr-fx-"));
const reset = (extra = {}) => { Object.assign(state, { platform: "linux", path: null, failWrite: null, maxTimeout: Infinity }, extra); calls.length = 0; writes.length = 0; };
const which = (tool) => { try { return execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim(); } catch { return ""; } };

/** A PATH folder with `node` and the named fake programs: `{ name: shellBody }`. */
function fakeBin(programs = {}, { node = true } = {}) {
  const bin = scratch();
  const put = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  if (node) put("node", `exec ${which("node")} "$@"`);
  for (const tool of ["mv", "dirname"]) put(tool, `exec ${which(tool)} "$@"`);
  for (const [name, body] of Object.entries(programs)) put(name, body);
  return bin;
}

/** A scratch Collection root with one Request file. */
function collection() {
  const root = join(scratch(), "Shop API");
  mkdirSync(join(root, "products"), { recursive: true });
  writeFileSync(join(root, "products/List.yml"), "info:\n  name: List\n");
  return root;
}

test("insideRoot accepts only absolute paths strictly inside the root", () => {
  reset();
  assert.equal(insideRoot("/c/Shop", "/c/Shop/a.yml"), true);
  assert.equal(insideRoot("/c/Shop/", "/c/Shop/x/a.yml"), true);
  assert.equal(insideRoot("/c/Shop", "/c/Shop"), false);
  assert.equal(insideRoot("/c/Shop", "/c/Shopping/a.yml"), false);
  assert.equal(insideRoot("/c/Shop", "/c/Shop/../etc/passwd"), false);
  assert.equal(insideRoot("/c/Shop", "Shop/a.yml"), false);
  assert.equal(insideRoot("", "/a.yml"), false);
  assert.equal(insideRoot("/c/Shop", "/C/shop/a.yml"), false);
  reset({ platform: "windows" });
  assert.equal(insideRoot("C:/dev/Shop", "c:/DEV/shop/a.yml"), true);
  assert.equal(insideRoot("C:\\dev\\Shop", "C:\\dev\\Shop\\a.yml"), true);
});

test("a write replaces the file when the expected text matches", async () => {
  reset();
  const root = collection(), path = `${root}/products/List.yml`;
  const r = await runEffects([{ op: "write", path, text: "new", expected: "info:\n  name: List\n" }], { root });
  assert.equal(r.ok, true);
  assert.equal(r.failed, null);
  assert.equal(r.ran.length, 1);
  assert.equal(readFileSync(path, "utf8"), "new");
});

test("a stale write is a conflict with the text on disk, distinct from other failures", async () => {
  reset();
  const root = collection(), path = `${root}/products/List.yml`;
  writeFileSync(path, "changed by someone");
  const r = await runEffects([{ op: "write", path, text: "mine", expected: "info:\n  name: List\n" }], { root });
  assert.equal(r.ok, false);
  assert.equal(r.failed.kind, "conflict");
  assert.equal(r.failed.current, "changed by someone");
  assert.equal(readFileSync(path, "utf8"), "changed by someone");
  // A write whose file is gone is "missing", and a refusal with matching text is an "error".
  const gone = await runEffects([{ op: "write", path: `${root}/products/Gone.yml`, text: "x", expected: "y" }], { root });
  assert.equal(gone.failed.kind, "missing");
  reset({ failWrite: "disk full" });
  const err = await runEffects([{ op: "write", path, text: "x", expected: "changed by someone" }], { root });
  assert.equal(err.failed.kind, "error");
  assert.match(err.failed.message, /disk full/);
});

test("a create (expected null) fails when the file exists", async () => {
  reset();
  const root = collection();
  const r = await runEffects([{ op: "write", path: `${root}/products/List.yml`, text: "x", expected: null }], { root });
  assert.equal(r.failed.kind, "exists");
  assert.equal(readFileSync(`${root}/products/List.yml`, "utf8"), "info:\n  name: List\n");
  const ok = await runEffects([{ op: "write", path: `${root}/products/New.yml`, text: "x", expected: null }], { root });
  assert.equal(ok.ok, true);
  assert.equal(readFileSync(`${root}/products/New.yml`, "utf8"), "x");
});

test("mkdir and move run through node with every path as its own argument", async () => {
  reset();
  const root = collection();
  const odd = `${root}/it's "odd" $(x) & %y% ;`;
  const r = await runEffects([
    { op: "mkdir", path: odd },
    { op: "move", from: `${root}/products/List.yml`, to: `${odd}/List.yml` },
    { op: "mkdir", path: `${root}/products`, existsOk: true },
  ], { root });
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.equal(r.ran.length, 3);
  assert.ok(existsSync(`${odd}/List.yml`));
  assert.ok(!existsSync(`${root}/products/List.yml`));
  const nodeCalls = calls.filter((c) => c.cmd === "node");
  assert.equal(nodeCalls.length, 3);
  for (const c of nodeCalls) assert.equal(c.args[0], "-e");
  assert.deepEqual(nodeCalls[1].args.slice(2), ["--", "move", `${root}/products/List.yml`, `${odd}/List.yml`]);
  assert.ok(!calls.some((c) => c.cmd === "sh" || /powershell|cmd/i.test(c.cmd)), "no shell");
});

test("mkdir fails on an existing path without existsOk, and move never replaces a target", async () => {
  reset();
  const root = collection();
  writeFileSync(`${root}/products/Other.yml`, "other");
  const a = await runEffects([{ op: "mkdir", path: `${root}/products` }], { root });
  assert.equal(a.failed.kind, "exists");
  const b = await runEffects([{ op: "move", from: `${root}/products/List.yml`, to: `${root}/products/Other.yml` }], { root });
  assert.equal(b.failed.kind, "exists");
  assert.equal(readFileSync(`${root}/products/Other.yml`, "utf8"), "other");
  const c = await runEffects([{ op: "move", from: `${root}/products/Nope.yml`, to: `${root}/products/X.yml` }], { root });
  assert.equal(c.failed.kind, "missing");
});

test("the runner stops at the first failure and reports what ran", async () => {
  reset();
  const root = collection();
  const r = await runEffects([
    { op: "write", path: `${root}/a.yml`, text: "a", expected: null },
    { op: "write", path: `${root}/products/List.yml`, text: "b", expected: "stale" },
    { op: "write", path: `${root}/c.yml`, text: "c", expected: null },
  ], { root });
  assert.equal(r.ok, false);
  assert.deepEqual(r.ran.map((e) => e.path), [`${root}/a.yml`]);
  assert.equal(r.failed.index, 1);
  assert.equal(r.failed.kind, "conflict");
  assert.ok(!existsSync(`${root}/c.yml`));
});

test("the runner refuses another Machine and paths outside the root before doing anything", async () => {
  reset();
  const root = collection();
  const remote = await runEffects([{ op: "write", path: `${root}/a.yml`, text: "a", expected: null }], { machine: "box", root });
  assert.equal(remote.failed.kind, "remote");
  assert.equal(remote.ran.length, 0);
  const outside = await runEffects([
    { op: "write", path: `${root}/a.yml`, text: "a", expected: null },
    { op: "move", from: `${root}/products/List.yml`, to: `${root}/../List.yml` },
  ], { root });
  assert.equal(outside.failed.kind, "outside");
  assert.equal(outside.failed.index, 1);
  assert.equal(outside.ran.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(`${root}/a.yml`));
  const unknown = await runEffects([{ op: "chmod", path: `${root}/a.yml` }], { root });
  assert.equal(unknown.failed.kind, "outside");
  const perm = await deletePermanently(`${root}/products`, { machine: "box", root });
  assert.equal(perm.ok, false);
  assert.equal(calls.length, 0);
});

test("trash on Linux uses gio trash with the path as an argument", async () => {
  const bin = fakeBin({ gio: 'printf "%s\\n" "$@" > "$(dirname "$0")/gio-args"; [ "$1" = trash ] && [ "$2" = -- ] && mv "$3" "$(dirname "$0")/"' });
  reset({ path: bin });
  const root = collection();
  const r = await runEffects([{ op: "trash", path: `${root}/products/List.yml` }], { root });
  assert.equal(r.ok, true, JSON.stringify(r.failed));
  assert.ok(!existsSync(`${root}/products/List.yml`));
  assert.ok(existsSync(join(bin, "List.yml")));
  assert.deepEqual(readFileSync(join(bin, "gio-args"), "utf8").trim().split("\n"), ["trash", "--", `${root}/products/List.yml`]);
});

test("a missing or failing trash command is reported, and deletePermanently then deletes", async () => {
  reset({ path: fakeBin() });
  const root = collection();
  const missing = await runEffects([{ op: "trash", path: `${root}/products` }], { root });
  assert.equal(missing.failed.kind, "trash");
  assert.equal(missing.failed.missing, true);
  assert.ok(existsSync(`${root}/products/List.yml`));
  reset({ path: fakeBin({ gio: 'echo "gio: Unable to find or create trash directory" >&2; exit 1' }) });
  const failed = await runEffects([{ op: "trash", path: `${root}/products` }], { root });
  assert.equal(failed.failed.kind, "trash");
  assert.equal(failed.failed.missing, false);
  assert.match(failed.failed.message, /Unable to find/);
  const del = await deletePermanently(`${root}/products`, { root });
  assert.equal(del.ok, true, del.message);
  assert.ok(!existsSync(`${root}/products`));
  assert.equal((await deletePermanently(`${root}/products`, { root })).ok, false);
  assert.equal((await deletePermanently(root, { root })).ok, false, "never the root itself");
});

test("trash on macOS uses its trash command", async () => {
  const bin = fakeBin({ trash: 'mv "$1" "$(dirname "$0")/"' });
  reset({ platform: "macos", path: bin });
  const root = collection();
  assert.deepEqual(await trash(`${root}/products/List.yml`), { ok: true, missing: false, message: "" });
  assert.ok(existsSync(join(bin, "List.yml")));
});

test("trash on Windows hands the path to PowerShell in an environment variable, never in its command", async () => {
  const bin = fakeBin({ "powershell.exe": 'printf "%s" "$*" > "$(dirname "$0")/ps-args"; case "$*" in *BRUNR_TRASH*) ;; *) exit 9;; esac; mv "$BRUNR_TRASH" "$(dirname "$0")/"' });
  reset({ platform: "windows", path: bin });
  const root = collection();
  const odd = `${root}/products/it's $(x) & %y%.yml`;
  writeFileSync(odd, "odd");
  const r = await trash(odd);
  assert.equal(r.ok, true, r.message);
  assert.ok(!existsSync(odd));
  const psArgs = readFileSync(join(bin, "ps-args"), "utf8");
  assert.ok(!psArgs.includes("it's"), "the path is not in PowerShell's arguments");
  assert.ok(!/ExecutionPolicy/i.test(psArgs));
  assert.match(psArgs, /^-NoProfile -NonInteractive -Command /);
  const c = calls.find((x) => x.cmd === "node");
  assert.equal(c.args.at(-1), odd);
  // No PowerShell: the trash is missing.
  reset({ platform: "windows", path: fakeBin() });
  const none = await trash(`${root}/products/List.yml`);
  assert.equal(none.ok, false);
  assert.equal(none.missing, true);
  assert.ok(existsSync(`${root}/products/List.yml`));
});

test("no node: mkdir fails with a message, nothing else runs", async () => {
  reset({ path: fakeBin({}, { node: false }) });
  const root = collection();
  const r = await runEffects([{ op: "mkdir", path: `${root}/x` }, { op: "write", path: `${root}/x/a.yml`, text: "a", expected: null }], { root });
  assert.equal(r.failed.kind, "error");
  assert.match(r.failed.message, /Node\.js was not found/);
  assert.equal(writes.length, 0);
});

test("readTexts reads each path once, null for a missing file", async () => {
  reset();
  const root = collection();
  const t = await readTexts(root, ["products/List.yml", "products/folder.yml", "products/List.yml"]);
  assert.deepEqual(t, { "products/List.yml": "info:\n  name: List\n", "products/folder.yml": null });
  assert.deepEqual(readdirSync(join(root, "products")), ["List.yml"]);
});
