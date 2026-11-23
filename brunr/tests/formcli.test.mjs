// Acceptance: Requests edited through the form's writeTab, run with the real Bruno CLI against the
// fixture server's /echo route, which answers with the request it received. Skipped when `bru` is
// not on PATH or BRUNR_SKIP_BRU=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FIXTURES } from "./helpers.mjs";
import { newRequestText, setUrl } from "../mods/brunr/edit.js";
import { readTab, writeTab } from "../mods/brunr/form.js";

const PORT = 47916;
const realBru = (() => {
  if (process.env.BRUNR_SKIP_BRU === "1") return false;
  try { execFileSync("bru", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

async function withServer(fn) {
  const server = spawn(process.execPath, [join(FIXTURES, "server.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const started = await new Promise((res) => { server.stdout.once("data", () => res(true)); server.once("exit", () => res(false)); });
    assert.ok(started, `the fixture server did not start on ${PORT}`);
    await fn();
  } finally { server.kill(); }
}

const kv = (name, value, enabled = true) => ({ name, value, enabled });
/** A new POST Request to /echo/:id, as Bruno writes it, then each form edit in turn. */
function request(seq, edits) {
  let text = newRequestText({ format: "yaml", name: `Form ${seq}`, method: "POST", url: "{{baseUrl}}/echo/:id", seq });
  text = writeTab(text, "params", { query: [], path: [{ name: "id", value: String(seq) }] });
  for (const [tab, data] of edits) text = tab === "url" ? setUrl(text, "yaml", data) : writeTab(text, tab, typeof data === "function" ? data(readTab(text, tab).data) : data);
  return text;
}

const SCENARIOS = {
  params: [["params", (d) => ({ ...d, query: [kv("q", "tea-pot"), kv("off", "1", false), kv("n", "2")] })]],
  headers: [["headers", [kv("x-form", "yes"), kv("x-off", "no", false)]]],
  json: [["body", { mode: "json", text: '{\n  "productId": 1\n}' }], ["headers", [kv("content-type", "application/json")]]],
  text: [["body", { mode: "text", text: "plain words: ok\nline two" }]],
  xml: [["body", { mode: "xml", text: '<order id="1"/>' }]],
  form: [["body", { mode: "form-urlencoded", rows: [kv("a", "1"), kv("b", "x y"), kv("c", "off", false)] }]],
  multipart: [["body", { mode: "multipart-form", rows: [kv("note", "hi there"), kv("skip", "x", false)] }]],
  none: [["body", { mode: "json", text: "{}" }], ["body", { mode: "none" }]],
  basic: [["auth", { mode: "basic", username: "ann", password: "p: w" }]],
  bearer: [["auth", { mode: "bearer", token: "tok-123" }]],
  apikeyHeader: [["auth", { mode: "apikey", key: "x-api-key", value: "k1", placement: "header" }]],
  // The CLI adds a query API key with `new URL(request.url)` before it interpolates the URL, so
  // this Request has a literal URL.
  apikeyQuery: [["auth", { mode: "apikey", key: "api_key", value: "k2", placement: "query" }], ["url", `http://127.0.0.1:${PORT}/echo/12`]],
  preVar: [["vars", { pre: [kv("who", "form-var")], post: [] }], ["headers", [kv("x-who", "{{who}}")]]],
  script: [["script", { pre: 'req.setHeader("x-script", "set-by-script");', post: "" }]],
  assert: [["assert", [
    { expression: "res.status", operator: "eq", value: "200", enabled: true },
    { expression: "res.body.method", operator: "eq", value: "POST", enabled: true },
    { expression: "res.body.url", operator: "isString", value: "", enabled: true },
    { expression: "res.status", operator: "eq", value: "500", enabled: false },
  ]]],
  postVar: [
    ["vars", { pre: [], post: [{ name: "seenMethod", expression: "res.body.method", enabled: true }] }],
    ["tests", 'test("post var", () => {\n  expect(bru.getVar("seenMethod")).to.equal("POST");\n});'],
    ["settings", (d) => ({ ...d, timeout: 5000, encodeUrl: false })],
    ["docs", "Made by the form test."],
  ],
};

test("Requests edited through every form tab run with the real bru and send what the form says", { skip: !realBru && "bru is not on PATH" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "brunr-form-"));
  writeFileSync(join(root, "opencollection.yml"), "opencollection: 1.0.0\n\ninfo:\n  name: Form CLI\n");
  const names = Object.keys(SCENARIOS);
  names.forEach((name, i) => writeFileSync(join(root, `${name}.yml`), request(i + 1, SCENARIOS[name])));
  await withServer(async () => {
    const report = join(root, "report.json");
    const r = spawnSync("bru", ["run", "-r", "--env-var", `baseUrl=http://127.0.0.1:${PORT}`, "--reporter-json", report], { cwd: root, encoding: "utf8", timeout: 90000 });
    assert.ok(existsSync(report), `bru wrote no report: ${r.stderr || r.stdout}`);
    const results = Object.fromEntries(JSON.parse(readFileSync(report, "utf8")).flatMap((it) => it.results).map((x) => [x.test.filename.replace(/\.yml$/, ""), x]));
    for (const name of names) {
      assert.equal(results[name]?.error ?? null, null, `${name}: ${results[name]?.error}`);
      assert.equal(results[name].response.status, 200, name);
    }
    const got = (name) => results[name].response.data;
    const h = (name) => got(name).headers;

    assert.equal(got("params").url, "/echo/1?q=tea-pot&n=2");
    assert.equal(got("headers").url, "/echo/2");
    assert.equal(h("headers")["x-form"], "yes");
    assert.equal(h("headers")["x-off"], undefined);
    assert.deepEqual(JSON.parse(got("json").body), { productId: 1 });
    assert.match(h("json")["content-type"], /application\/json/);
    assert.equal(got("text").body, "plain words: ok\nline two");
    assert.match(h("text")["content-type"], /text\/plain/);
    assert.equal(got("xml").body, '<order id="1"/>');
    assert.match(h("xml")["content-type"], /xml/);
    assert.deepEqual([...new URLSearchParams(got("form").body)], [["a", "1"], ["b", "x y"]]);
    assert.match(h("form")["content-type"], /application\/x-www-form-urlencoded/);
    assert.match(got("multipart").body, /name="note"\r\n\r\nhi there\r\n/);
    assert.ok(!got("multipart").body.includes('name="skip"'));
    assert.match(h("multipart")["content-type"], /multipart\/form-data/);
    assert.equal(got("none").body, "");
    const sha = (s) => createHash("sha256").update(s).digest("hex");
    // The report masks secrets in what the server echoed, so the server echoes their SHA-256 too.
    const hashed = (name) => Object.fromEntries(got(name).sha256.headers);
    assert.equal(hashed("basic").authorization, sha(`Basic ${Buffer.from("ann:p: w").toString("base64")}`));
    assert.equal(hashed("bearer").authorization, sha("Bearer tok-123"));
    assert.equal(hashed("none").authorization, undefined);
    assert.equal(hashed("apikeyHeader")["x-api-key"], sha("k1"));
    assert.equal(got("apikeyQuery").sha256.url, sha("/echo/12?api_key=k2"));
    assert.equal(h("preVar")["x-who"], "form-var");
    assert.equal(h("script")["x-script"], "set-by-script");
    assert.deepEqual(results.assert.assertionResults.map((a) => [a.lhsExpr, a.status]), [["res.status", "pass"], ["res.body.method", "pass"], ["res.body.url", "pass"]]);
    assert.deepEqual(results.postVar.testResults.map((t) => t.status), ["pass"]);
  });
});

test("a hand-written URL query with no params rows is kept when a param is added in the Params tab, and bru sends both", { skip: !realBru && "bru is not on PATH" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "brunr-form-"));
  writeFileSync(join(root, "opencollection.yml"), "opencollection: 1.0.0\n\ninfo:\n  name: Form CLI\n");
  const hand = "info:\n  name: Hand Query\n  type: http\n  seq: 1\n\nhttp:\n  method: GET\n  url: \"{{baseUrl}}/echo?a=1\"\n";
  const { query, path } = readTab(hand, "params").data;
  writeFileSync(join(root, "hand.yml"), writeTab(hand, "params", { query: [...query, kv("b", "2")], path }));
  await withServer(async () => {
    const report = join(root, "report.json");
    const r = spawnSync("bru", ["run", "-r", "--env-var", `baseUrl=http://127.0.0.1:${PORT}`, "--reporter-json", report], { cwd: root, encoding: "utf8", timeout: 90000 });
    assert.ok(existsSync(report), `bru wrote no report: ${r.stderr || r.stdout}`);
    const [result] = JSON.parse(readFileSync(report, "utf8")).flatMap((it) => it.results);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.data.url, "/echo?a=1&b=2");
  });
});
