// Acceptance: file operations applied to a copy of a fixture Collection, then run with the real
// Bruno CLI against the fixture server. Skipped when `bru` is not on PATH or BRUNR_SKIP_BRU=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES } from "./helpers.mjs";
import { parseCollection, isCollectionFile } from "../mods/brunr/parser.js";
import * as ops from "../mods/brunr/fileops.js";
import { setUrl, setMethod } from "../mods/brunr/edit.js";
import { setUrlFromBar } from "../mods/brunr/urlsync.js";
import { readEnvironment, writeEnvironment } from "../mods/brunr/envfile.js";

const PORT = 47915;
const realBru = (() => {
  if (process.env.BRUNR_SKIP_BRU === "1") return false;
  try { execFileSync("bru", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const EXT = { yaml: "yml", bru: "bru" };

/** A fresh copy of a fixture Collection in a temp directory. */
function copyFixture(format) {
  const dir = join(mkdtempSync(join(tmpdir(), "brunr-cli-")), "Shop Copy");
  cpSync(join(FIXTURES, format), dir, { recursive: true });
  return dir;
}

function load(root) {
  const files = {};
  const walk = (rel) => {
    for (const name of readdirSync(join(root, rel))) {
      const p = rel ? `${rel}/${name}` : name;
      if (statSync(join(root, p)).isDirectory()) walk(p);
      else files[p] = readFileSync(join(root, p), "utf8");
    }
  };
  walk("");
  const format = "opencollection.yml" in files ? "yaml" : "bru";
  return parseCollection({ root, files: Object.fromEntries(Object.entries(files).filter(([p]) => isCollectionFile(p, format))) });
}

const readOrNull = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** Performs effects as the effects runner will: a changed or existing file refuses the write. */
function perform(effects) {
  for (const e of effects) {
    if (e.op === "write") {
      assert.equal(readOrNull(e.path), e.expected, `the file changed before the write: ${e.path}`);
      writeFileSync(e.path, e.text);
    } else if (e.op === "mkdir") {
      if (!(e.existsOk && existsSync(e.path))) mkdirSync(e.path);
    } else if (e.op === "move") {
      assert.ok(!existsSync(e.to), `move target exists: ${e.to}`);
      renameSync(e.from, e.to);
    } else if (e.op === "trash") rmSync(e.path, { recursive: true });
  }
}

/** Runs an operation against the Collection on disk: needs, read, operate, perform. */
function apply(root, op, args) {
  const collection = load(root);
  const texts = {};
  for (const p of ops.needs({ op, ...args }, collection)) texts[p] = readOrNull(join(root, p));
  const out = ops[op]({ collection, texts, ...args });
  assert.equal(out.error, undefined, out.error);
  perform(out.effects);
  return out.result;
}

/** The results of `bru run`, from its JSON report. */
function bru(root, args) {
  const report = join(root, "..", `report-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync("bru", ["run", ...args, "--reporter-json", report], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.ok(existsSync(report), `bru wrote no report: ${r.stderr || r.stdout}`);
  return JSON.parse(readFileSync(report, "utf8")).flatMap((it) => it.results);
}

async function withServer(fn) {
  const server = spawn(process.execPath, [join(FIXTURES, "server.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const started = await new Promise((res) => { server.stdout.once("data", () => res(true)); server.once("exit", () => res(false)); });
    assert.ok(started, `the fixture server did not start on ${PORT}`);
    await fn();
  } finally { server.kill(); }
}

for (const format of ["yaml", "bru"]) {
  const x = EXT[format];

  test(`${format}: new, cloned, renamed, reordered and moved Requests run with the real bru, and a written Environment resolves`, { skip: !realBru && "bru is not on PATH" }, async () => {
    await withServer(async () => {
      const root = copyFixture(format);
      const env = apply(root, "newEnvironment", { name: "cli run" });
      const envFile = join(root, env.path);
      const rows = [
        { name: "baseUrl", value: `http://127.0.0.1:${PORT}`, enabled: true, secret: false, description: "the test server" },
        { name: "shopId", value: "1", enabled: true, secret: false, description: "" },
        { name: "unused", value: "a: b", enabled: false, secret: false, description: "" },
      ];
      writeFileSync(envFile, writeEnvironment({ format, name: env.name, rows, previousText: readFileSync(envFile, "utf8") }));
      assert.deepEqual(readEnvironment(readFileSync(envFile, "utf8"), format).rows, rows);

      const ping = apply(root, "newRequest", { name: "Ping: health", method: "GET", url: "{{baseUrl}}/health" });
      const clone = apply(root, "cloneRequest", { path: `products/List Products.${x}` });
      const renamed = apply(root, "renameItem", { path: `Get Health.${x}`, name: "Health Check", fileName: "Health Check" });
      apply(root, "reorder", { path: renamed.path, index: 0 });
      apply(root, "deleteItem", { path: `products/Missing Product.${x}` });
      assert.ok(existsSync(join(root, `products/top sellers/folder.${x}`)), "renumbering wrote a folder file for top sellers");
      const moved = apply(root, "move", { path: `products/top sellers/Best Sellers.${x}`, to: "orders", index: 0 });
      const folder = apply(root, "newFolder", { name: "Extras" });
      const inner = apply(root, "newRequest", { parent: folder.path, name: "Top", method: "GET", url: "{{baseUrl}}/products/top" });
      const order = apply(root, "newRequest", { parent: folder.path, name: "Order", method: "GET", url: "x" });
      const orderFile = join(root, order.path);
      writeFileSync(orderFile, setMethod(setUrl(readFileSync(orderFile, "utf8"), format, "{{baseUrl}}/orders"), format, "POST"));

      for (const path of [ping.path, clone.path, renamed.path, moved.path, inner.path, order.path]) {
        const [result] = bru(root, [path, "--env", env.name]);
        assert.equal(result.error ?? null, null, `${path}: ${result.error}`);
        assert.ok(String(result.request.url).startsWith(`http://127.0.0.1:${PORT}/`), `${path}: the Environment resolves baseUrl`);
        assert.ok([200, 201].includes(result.response.status), `${path}: ${result.response.status}`);
      }
      assert.equal(bru(root, [order.path, "--env", env.name])[0].request.method, "POST");
      const orders = bru(root, ["orders", "-r", "--env", env.name]).map((r) => r.test.filename).filter((f) => f.startsWith("orders/"));
      assert.equal(orders[0], `orders/Best Sellers.${x}`, "moved to the top of orders");
      const products = bru(root, ["products", "-r", "--env", env.name]);
      // The CLI also lists the Collection's unparsable Broken file; only the folder's own Requests count here.
      assert.deepEqual(products.filter((r) => r.test.filename.startsWith("products/")).map((r) => [r.test.filename, r.error ?? null]).sort(), [
        [`products/List Products copy.${x}`, null], [`products/List Products.${x}`, null], [`products/Product Page.${x}`, null],
      ]);
      const top = load(root).children.map((n) => n.name);
      assert.ok(top.indexOf("Health Check") > top.indexOf("Extras"), "the tree shows folders first");
    });
  });

  test(`${format}: a Request moved to another Collection runs there`, { skip: !realBru && "bru is not on PATH" }, async () => {
    await withServer(async () => {
      const from = copyFixture(format);
      const to = copyFixture(format);
      const source = load(from);
      const target = load(to);
      const args = { target, path: `products/Product Page.${x}`, to: "orders", index: 1 };
      const read = (root, list) => Object.fromEntries(list.map((p) => [p, readOrNull(join(root, p))]));
      const out = ops.moveBetween({
        collection: source, ...args,
        texts: read(from, ops.needs({ op: "moveBetween", ...args }, source)),
        targetTexts: read(to, ops.needs({ op: "moveBetween", side: "target", ...args }, source)),
      });
      assert.equal(out.error, undefined, out.error);
      perform(out.effects);
      assert.ok(!existsSync(join(from, `products/Product Page.${x}`)));
      const [result] = bru(to, [out.result.path, "--env-var", `baseUrl=http://127.0.0.1:${PORT}`]);
      assert.equal(result.response.status, 200);
      const names = bru(to, ["orders", "-r", "--env-var", `baseUrl=http://127.0.0.1:${PORT}`]).map((r) => r.test.filename).filter((f) => f.startsWith("orders/"));
      assert.equal(names[1], `orders/Product Page.${x}`, "placed second");
    });
  });
}

for (const format of ["yaml", "bru"]) {
  test(`${format}: after URL bar edits that add and remove query params, bru sends the URL the bar shows`, { skip: !realBru && "bru is not on PATH" }, async () => {
    await withServer(async () => {
      const root = copyFixture(format);
      const file = join(root, `products/List Products.${EXT[format]}`);
      let text = readFileSync(file, "utf8");
      text = setUrlFromBar(text, format, "{{baseUrl}}/products?shop={{shopId}}&limit=2");
      text = setUrlFromBar(text, format, "{{baseUrl}}/products?limit=2&page=1");
      writeFileSync(file, text);
      const [result] = bru(root, [`products/List Products.${EXT[format]}`, "--env-var", `baseUrl=http://127.0.0.1:${PORT}`, "--env-var", "shopId=1"]);
      assert.equal(result.error ?? null, null, result.error);
      assert.equal(result.request.url, `http://127.0.0.1:${PORT}/products?limit=2&page=1`);
      assert.equal(result.response.status, 200);
    });
  });
}

// Quoting cases for the YAML writer and the bru writer, read back by the real CLI. bru trims a
// value's edges, as Bruno's own bru writer does, so edge whitespace is a YAML-only case.
const TRICKY = ["true", "123", "null", "~", "0x1F", "1e3", ".inf", "a: b", "a:b", "a #b", "a#b", "#x", "[x", "@x", "*x", "&x", "!x", "|x", ">x",
  "'x", '"x', "%x", ",x", "- x", "-x", "? x", "`x", "line1\nline2", '{"a":1}', "it's", "say \"hi\"", "http://h:1/p?q=1#f"];
const YAML_ONLY = ["", "  lead", "trail ", "x\n", "tab\t", "a\n\nb", " line\nx"];

for (const format of ["yaml", "bru"]) {
  test(`${format}: the real bru reads every quoting case the Environment writer produces`, { skip: !realBru && "bru is not on PATH" }, async () => {
    await withServer(async () => {
      const root = copyFixture(format);
      const values = format === "yaml" ? [...TRICKY, ...YAML_ONLY] : TRICKY;
      const env = apply(root, "newEnvironment", { name: "quoting" });
      const rows = [{ name: "baseUrl", value: `http://127.0.0.1:${PORT}`, enabled: true, secret: false, description: "" },
        ...values.map((value, i) => ({ name: `v${i}`, value, enabled: true, secret: false, description: i % 3 ? "" : `about: v${i}` }))];
      writeFileSync(join(root, env.path), writeEnvironment({ format, name: env.name, rows }));
      const checks = values.map((v, i) => `  expect(bru.getEnvVar("v${i}")).to.equal(${JSON.stringify(v)});`).join("\n");
      const code = `test("values", function () {\n${checks}\n});`;
      const req = apply(root, "newRequest", { name: "Quoting", method: "GET", url: "{{baseUrl}}/health" });
      const file = join(root, req.path);
      const extra = format === "yaml"
        ? `\nruntime:\n  scripts:\n    - type: tests\n      code: |-\n${code.split("\n").map((l) => "        " + l).join("\n")}\n`
        : `\ntests {\n${code.split("\n").map((l) => "  " + l).join("\n")}\n}\n`;
      writeFileSync(file, readFileSync(file, "utf8") + extra);
      const [result] = bru(root, [req.path, "--env", env.name]);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.testResults.map((t) => [t.description, t.status, t.error ?? null]), [["values", "pass", null]]);
    });
  });
}
