import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, calls, reads } from "./herdr-shim.mjs";
import { FIXTURES } from "./helpers.mjs";
import * as machine from "../mods/brunr/machine.js";
import { parseCollection } from "../mods/brunr/parser.js";
import { parseProgress } from "../mods/brunr/progress.js";

const fx = FIXTURES.replace(/\/+$/, "");
const scratch = () => mkdtempSync(join(tmpdir(), "brunr-mach-"));
const reset = (extra = {}) => { Object.assign(state, { appHome: scratch(), home: "/nonexistent", platform: "linux", path: null, maxTimeout: Infinity }, extra); calls.length = 0; reads.length = 0; };
const collection = (dir = "yaml") => parseCollection({ root: `${fx}/${dir}`, files: {} });

/** A folder of fake programs. `bru` writes FAKE_REPORT to its --reporter-json path, as FAKE_MODE says. */
function fakeBin({ bru = true, node = true } = {}) {
  const bin = scratch();
  const put = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  if (node) put("node", 'echo v22.0.0');
  if (bru) put("bru", [
    '[ "$1" = --version ] && { echo 4.3.0; exit 0; }',
    '[ "$FAKE_MODE" = args ] && for a in "$@"; do printf "%s\\n" "$a"; done > "$FAKE_ARGS"',
    'out=""; while [ $# -gt 0 ]; do [ "$1" = --reporter-json ] && out=$2; shift; done',
    'case "$FAKE_MODE" in',
    '  ok) cat "$FAKE_REPORT" > "$out"; echo ran; exit 0;;',
    '  fail) cat "$FAKE_REPORT" > "$out"; echo "the CLI failed" >&2; exit 1;;',
    '  noreport) echo "error: no such environment" >&2; exit 1;;',
    '  slow) cat "$FAKE_REPORT" > "$out"; exec sleep 5;;',
    '  steps) echo "products/List Products (200 OK) - 2 ms"; sleep 1; echo "products/Missing Product (404 Not Found) - 2 ms"; sleep 1; cat "$FAKE_REPORT" > "$out"; exit 0;;',
    '  args) cat "$FAKE_REPORT" > "$out"; exit 0;;',
    'esac',
  ].join("\n"));
  for (const tool of ["sh", "cat", "sleep", "rm", "find", "env"]) {
    try { const p = execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim(); if (p && !existsSync(join(bin, tool))) put(tool, `exec ${p} "$@"`); } catch {}
  }
  return bin;
}

/** For tests that run a fake program. Those are shell scripts, and Windows cannot start one, so they are skipped there. */
const fakes = { skip: process.platform === "win32" && "the fake programs are shell scripts, which Windows cannot start" };

const reportsLeft = (home) => { try { return readdirSync(join(home, "data/brunr")); } catch { return []; } };

/** The exec that started bru through sh: `{ opts, out, args }`, args being bru's own. */
function bruCall() {
  const c = calls.find((x) => x.cmd === "sh" && x.args[0] === "-c" && x.args[4] === "bru");
  return c && { opts: c.opts, out: c.args[3], args: c.args.slice(5) };
}

/** A cx.timer stand-in for tests (the mod itself never uses setInterval). */
function testTimer() {
  const t = { ticks: 0, cancelled: 0, every(ms, fn) {
    const id = setInterval(() => { t.ticks++; fn({}); }, ms);
    return { cancel() { t.cancelled++; clearInterval(id); } };
  } };
  return t;
}

test("bru is started by name, and as bru.cmd on Windows here", () => {
  reset({ platform: "linux" });
  assert.deepEqual(machine.bruCommand(null), ["bru", []]);
  reset({ platform: "windows" });
  assert.deepEqual(machine.bruCommand(null), ["bru.cmd", []]);
  assert.deepEqual(machine.bruCommand("box"), ["bru", []]);
});

test("readCollection reads only Collection files, never .env, on this computer", async () => {
  reset();
  const files = await machine.readCollection(null, `${fx}/yaml`);
  assert.ok(existsSync(`${fx}/yaml/.env`), "the fixture has a .env");
  assert.ok(!Object.keys(files).some((p) => p.includes(".env")));
  assert.ok(!("notes/readme.md" in files));
  assert.ok("opencollection.yml" in files && "products/top sellers/Best Sellers.yml" in files);
  assert.ok(!reads.some((r) => r.path.includes(".env")), "no read of .env");
});

test("readCollection on another Machine lists then reads in two execs, never touching .env", async () => {
  reset();
  const files = await machine.readCollection("box", `${fx}/yaml`);
  const local = await machine.readCollection(null, `${fx}/yaml`);
  assert.deepEqual(files, local);
  const remote = calls.filter((c) => c.opts.on === "box");
  assert.equal(remote.length, 2);
  assert.ok(!remote.some((c) => c.args.some((a) => /(^|\/)\.env$/.test(a))));
});

test("readCollection gives nothing for a folder that is not a Collection, and throws for a missing one", async () => {
  reset();
  assert.deepEqual(await machine.readCollection(null, `${fx}/reports`), {});
  await assert.rejects(machine.readCollection(null, "/nonexistent/c"));
  await assert.rejects(machine.readCollection("box", "/nonexistent/c"));
});

test("checkCli finds bru and node", fakes, async () => {
  reset({ path: fakeBin() });
  assert.deepEqual(await machine.checkCli(null), { bru: "4.3.0", node: "v22.0.0", step: null });
});

test("checkCli with bru missing names the CLI install step", fakes, async () => {
  reset({ path: fakeBin({ bru: false }) });
  const c = await machine.checkCli(null);
  assert.equal(c.bru, null);
  assert.equal(c.node, "v22.0.0");
  assert.equal(c.step.copy, "npm i -g @usebruno/cli");
});

test("checkCli with Node missing names Node first", async () => {
  reset({ path: fakeBin({ bru: false, node: false }) });
  const c = await machine.checkCli("box");
  assert.deepEqual([c.bru, c.node], [null, null]);
  assert.match(c.step.text, /^Install Node\.js/);
});

const runArgs = { machine: null, target: { kind: "request", path: "Get Health.yml" }, environment: "local" };

test("a Run reads the report and deletes it on success", fakes, async () => {
  reset({ path: fakeBin() });
  process.env.FAKE_MODE = "ok";
  process.env.FAKE_REPORT = `${fx}/reports/pass-request.json`;
  const r = await machine.runBru({ ...runArgs, collection: collection() });
  assert.equal(r.message, null);
  assert.equal(r.responses.length, 1);
  assert.equal(r.responses[0].status, 200);
  const run = bruCall();
  assert.equal(run.opts.cwd, `${fx}/yaml`);
  assert.deepEqual(run.args.slice(0, 4), ["run", "Get Health.yml", "--env", "local"]);
  assert.match(run.args.at(-1), /\/data\/brunr\/run-[^/]+\.json$/);
  assert.equal(run.out, run.args.at(-1).replace(/\.json$/, ".log"), "the progress file sits next to the report, named like it");
  assert.deepEqual(reportsLeft(state.appHome), []);
});

test("a Run deletes its report when the CLI fails", fakes, async () => {
  reset({ path: fakeBin() });
  process.env.FAKE_MODE = "fail";
  process.env.FAKE_REPORT = `${fx}/reports/fail-assertion.json`;
  const r = await machine.runBru({ ...runArgs, collection: collection() });
  assert.equal(r.ok, false);
  assert.ok(r.responses[0].tests.some((t) => !t.ok));
  assert.deepEqual(reportsLeft(state.appHome), []);
});

test("a Run with no report shows the CLI's message", fakes, async () => {
  reset({ path: fakeBin() });
  process.env.FAKE_MODE = "noreport";
  const r = await machine.runBru({ ...runArgs, collection: collection() });
  assert.equal(r.message, "error: no such environment");
  assert.deepEqual(reportsLeft(state.appHome), []);
});

test("a Run that times out says so and deletes its report", fakes, async () => {
  reset({ path: fakeBin(), maxTimeout: 700 });
  process.env.FAKE_MODE = "slow";
  process.env.FAKE_REPORT = `${fx}/reports/pass-request.json`;
  const r = await machine.runBru({ ...runArgs, collection: collection() });
  assert.match(r.message, /timed out/i);
  assert.deepEqual(reportsLeft(state.appHome), []);
});

test("a Run whose exec throws deletes its report and names the cause", async () => {
  reset({ path: scratch() });
  const r = await machine.runBru({ ...runArgs, collection: collection() });
  assert.match(r.message, /^Cannot start bru/);
  assert.deepEqual(reportsLeft(state.appHome), []);
});

test("a Run on another Machine uses /tmp and deletes the report there", fakes, async () => {
  reset({ path: fakeBin() });
  process.env.FAKE_MODE = "ok";
  process.env.FAKE_REPORT = `${fx}/reports/pass-request.json`;
  const r = await machine.runBru({ ...runArgs, machine: "box", collection: collection() });
  assert.equal(r.responses.length, 1);
  const run = bruCall();
  assert.equal(run.opts.on, "box");
  const report = run.args.at(-1);
  assert.match(report, /^\/tmp\/brunr-[^/]+\.json$/);
  assert.equal(run.out, report.replace(/\.json$/, ".log"));
  for (const f of [report, run.out]) {
    assert.ok(calls.some((c) => c.cmd === "rm" && c.args.includes(f) && c.opts.on === "box"));
    assert.ok(!existsSync(f));
  }
});

test("clearLocalReports removes reports left by an earlier session", async () => {
  reset();
  mkdirSync(join(state.appHome, "data/brunr"), { recursive: true });
  writeFileSync(join(state.appHome, "data/brunr/run-old.json"), "[]");
  writeFileSync(join(state.appHome, "data/brunr/run-old.log"), "x");
  writeFileSync(join(state.appHome, "data/brunr/keep.txt"), "x");
  await machine.clearLocalReports();
  assert.deepEqual(reportsLeft(state.appHome), ["keep.txt"]);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const filesLeft = (home) => reportsLeft(home).filter((n) => /^run-/.test(n));

test("a Run reads its progress file while the CLI runs and stops when it ends", fakes, async () => {
  reset({ path: fakeBin() });
  process.env.FAKE_MODE = "steps";
  process.env.FAKE_REPORT = `${fx}/reports/folder.json`;
  const timer = testTimer();
  const seen = [];
  let during = [];
  const r = await machine.runBru({ ...runArgs, target: { kind: "folder", path: "products" }, collection: collection(), timer, onProgress: (text) => { seen.push(text); during = filesLeft(state.appHome); } });
  const atEnd = seen.length;
  assert.equal(r.message, null);
  assert.ok(seen.length >= 2, `progress grew in steps: ${JSON.stringify(seen)}`);
  assert.match(seen[0], /List Products/);
  assert.doesNotMatch(seen[0], /Missing Product/);
  assert.match(seen.at(-1), /Missing Product/);
  assert.equal(new Set(seen).size, seen.length, "only a changed text is handed on");
  assert.ok(during.some((n) => /^run-.*\.log$/.test(n)), "the progress file exists while the CLI runs");
  assert.equal(timer.cancelled, 1);
  await sleep(machine.PROGRESS_EVERY * 2);
  assert.equal(seen.length, atEnd, "nothing after the Run ended");
  assert.deepEqual(filesLeft(state.appHome), [], "no report or progress file is left");
});

test("the progress timer stops on a timeout and on a thrown exec, and no file is left", fakes, async () => {
  reset({ path: fakeBin(), maxTimeout: 1200 });
  process.env.FAKE_MODE = "slow";
  process.env.FAKE_REPORT = `${fx}/reports/pass-request.json`;
  let timer = testTimer();
  const r = await machine.runBru({ ...runArgs, collection: collection(), timer, onProgress: () => {} });
  assert.match(r.message, /timed out/i);
  assert.equal(timer.cancelled, 1);
  await machine.sweepReports();
  assert.deepEqual(filesLeft(state.appHome), []);
  reset({ path: scratch() });
  timer = testTimer();
  const t = await machine.runBru({ ...runArgs, collection: collection(), timer, onProgress: () => {} });
  assert.match(t.message, /^Cannot start bru/);
  assert.equal(timer.cancelled, 1);
  assert.deepEqual(filesLeft(state.appHome), []);
});

test("a missing bru names it, through sh", async () => {
  reset({ path: fakeBin({ bru: false }) });
  const r = await machine.runBru({ ...runArgs, collection: collection() });
  assert.match(r.message, /bru/);
  assert.match(r.message, /not found/);
  assert.deepEqual(filesLeft(state.appHome), []);
});

const ODD = { path: `odd/we$ird "quo'te" & (x) %PATH% ;x.yml`, env: `my env & "q" %USERNAME% (1)` };

test("every argument reaches bru as it is, never through a shell string", fakes, async () => {
  reset({ path: fakeBin() });
  Object.assign(process.env, { FAKE_MODE: "args", FAKE_REPORT: `${fx}/reports/pass-request.json`, FAKE_ARGS: join(scratch(), "args.txt") });
  await machine.runBru({ ...runArgs, collection: collection(), target: { kind: "request", path: ODD.path }, environment: ODD.env });
  const got = readFileSync(process.env.FAKE_ARGS, "utf8").split("\n").slice(0, -1);
  assert.deepEqual(got, bruCall().args);
  assert.deepEqual(got.slice(0, 4), ["run", ODD.path, "--env", ODD.env]);
});

/** A Windows-like folder: bru.cmd as npm writes it, the CLI script beside it, and the real node. */
function windowsBin({ script = true } = {}) {
  const bin = fakeBin({ node: false, bru: false });
  writeFileSync(join(bin, "node"), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
  chmodSync(join(bin, "node"), 0o755);
  if (!script) {
    writeFileSync(join(bin, "bru.cmd"), `#!/bin/sh\nout=""; while [ $# -gt 0 ]; do [ "$1" = --reporter-json ] && out=$2; shift; done\ncat "$FAKE_REPORT" > "$out"\necho direct\n`);
    chmodSync(join(bin, "bru.cmd"), 0o755);
    return bin;
  }
  writeFileSync(join(bin, "bru.cmd"), '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@usebruno\\cli\\bin\\bru.js" %*\r\n');
  mkdirSync(join(bin, "node_modules/@usebruno/cli/bin"), { recursive: true });
  writeFileSync(join(bin, "node_modules/@usebruno/cli/bin/bru.js"), [
    'const fs = require("fs"); const args = process.argv.slice(2);',
    'fs.writeFileSync(process.env.FAKE_ARGS, JSON.stringify(args));',
    'console.log("products/List Products (200 OK) - 2 ms"); console.error("a warning");',
    'setTimeout(() => { fs.copyFileSync(process.env.FAKE_REPORT, args[args.indexOf("--reporter-json") + 1]); process.exit(Number(process.env.FAKE_CODE || 0)); }, 1200);',
  ].join("\n"));
  return bin;
}

test("on Windows node starts the CLI's script with no shell, with progress and the exit code", fakes, async () => {
  reset({ platform: "windows", path: windowsBin() });
  Object.assign(process.env, { FAKE_REPORT: `${fx}/reports/fail-assertion.json`, FAKE_ARGS: join(scratch(), "args.json"), FAKE_CODE: "1" });
  const seen = [];
  const r = await machine.runBru({ ...runArgs, collection: collection(), target: { kind: "request", path: ODD.path }, environment: ODD.env, timer: testTimer(), onProgress: (t) => seen.push(t) });
  delete process.env.FAKE_CODE;
  const call = calls.find((c) => c.cmd === "node");
  assert.equal(call.args[0], "-e");
  assert.deepEqual(JSON.parse(readFileSync(process.env.FAKE_ARGS, "utf8")), call.args.slice(4));
  assert.deepEqual(call.args.slice(4, 8), ["run", ODD.path, "--env", ODD.env]);
  assert.ok(seen.some((t) => /List Products/.test(t) && /a warning/.test(t)), "stdout and stderr reach the progress file");
  assert.equal(r.ok, false);
  assert.ok(r.responses[0].tests.some((x) => !x.ok), "the report is read after a nonzero exit");
  assert.ok(!calls.some((c) => c.cmd === "bru.cmd"));
  assert.deepEqual(filesLeft(state.appHome), []);
});

test("on Windows without the CLI's script beside bru.cmd, bru.cmd is started as before", fakes, async () => {
  reset({ platform: "windows", path: windowsBin({ script: false }) });
  process.env.FAKE_REPORT = `${fx}/reports/pass-request.json`;
  const r = await machine.runBru({ ...runArgs, collection: collection(), timer: testTimer(), onProgress: () => {} });
  assert.equal(r.message, null);
  assert.ok(calls.some((c) => c.cmd === "bru.cmd"));
  assert.deepEqual(filesLeft(state.appHome), []);
});

// The real Bruno CLI against the fixture server, as Dockr's stack test runs Docker.
const realBru = (() => {
  if (process.env.BRUNR_SKIP_BRU === "1") return false;
  try { execFileSync("bru", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

test("the real bru runs a Request and a folder through runBru", { skip: !realBru && "bru is not on PATH" }, async () => {
  reset();
  const server = spawn(process.execPath, [`${fx}/server.mjs`], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    // A fixture server already running on the port (started by hand) serves the Run as well.
    const started = await new Promise((res) => { server.stdout.once("data", () => res(true)); server.once("exit", () => res(false)); });
    if (!started) assert.ok((await fetch("http://127.0.0.1:47911/health")).ok, "the fixture server did not start and none answers on 47911");
    const files = await machine.readCollection(null, `${fx}/yaml`);
    const c = parseCollection({ root: `${fx}/yaml`, files });
    const one = await machine.runBru({ machine: null, collection: c, target: { kind: "request", path: "products/List Products.yml" }, environment: "local" });
    assert.equal(one.message, null, one.message);
    assert.equal(one.responses[0].status, 200);
    assert.equal(one.responses[0].language, "json");
    const folder = await machine.runBru({ machine: null, collection: c, target: { kind: "folder", path: "products" }, environment: "local" });
    assert.ok(folder.responses.length >= 3);
    assert.ok(folder.responses.some((r) => !r.ok), "Missing Product fails its assertion");
    assert.deepEqual(reportsLeft(state.appHome), []);
  } finally { server.kill(); }
});

test("the real bru's progress grows before a Run of slow Requests ends", { skip: !realBru && "bru is not on PATH" }, async () => {
  reset();
  const server = spawn(process.execPath, [`${fx}/server.mjs`], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const started = await new Promise((res) => { server.stdout.once("data", () => res(true)); server.once("exit", () => res(false)); });
    if (!started) assert.ok((await fetch("http://127.0.0.1:47911/health")).ok, "the fixture server did not start and none answers on 47911");
    // A scratch copy of the fixture Collection with a folder of slow Requests.
    const root = join(scratch(), "Shop copy");
    cpSync(`${fx}/yaml`, root, { recursive: true });
    mkdirSync(join(root, "slow"));
    for (let i = 1; i <= 5; i++) writeFileSync(join(root, `slow/Slow ${i}.yml`), `info:\n  name: Slow ${i}\n  type: http\n  seq: ${i}\n\nhttp:\n  method: GET\n  url: "{{baseUrl}}/slow"\n`);
    const c = parseCollection({ root, files: await machine.readCollection(null, root) });
    const seen = [];
    const r = await machine.runBru({ machine: null, collection: c, target: { kind: "folder", path: "slow" }, environment: "local", timer: testTimer(),
      onProgress: (text) => seen.push(parseProgress(text).finished.length) });
    assert.equal(r.message, null, r.message);
    assert.equal(r.responses.length, 5);
    assert.ok(seen.some((n) => n > 0 && n < 5), `a count below the total was seen mid-Run: ${seen}`);
    assert.ok(seen.every((n, i) => i === 0 || n >= seen[i - 1]), "the count only grows");
    assert.deepEqual(filesLeft(state.appHome), [], "no report or progress file is left");
  } finally { server.kill(); }
});
