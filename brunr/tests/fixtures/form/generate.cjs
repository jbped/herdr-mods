// Writes the "written by Bruno" fixtures for the form tests with Bruno's own YAML writer, the
// @usebruno/filestore that ships inside the global @usebruno/cli install. Not part of the suite:
//   node brunr/tests/fixtures/form/generate.cjs
// Each case is a Bruno item before and after one form edit. `<case>.yml` is the file before the
// edit and `<case>.after.yml` the file Bruno writes after it; the tests apply the same edit with
// writeTab and expect the second text. Names and values are invented.
const { execSync } = require("node:child_process");
const { writeFileSync, mkdirSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const root = execSync("npm root -g", { encoding: "utf8" }).trim();
const { stringifyRequest } = require(join(root, "@usebruno/cli/node_modules/@usebruno/filestore"));
const out = __dirname;

const clone = (x) => JSON.parse(JSON.stringify(x));

/** A Bruno http-request item with the given request fields. */
function item({ name = "Shop Item", seq = 1, tags, description, settings, examples, ...req } = {}) {
  return {
    type: "http-request", name, seq, tags, description, settings, examples,
    request: {
      method: "GET", url: "{{baseUrl}}/products", headers: [], params: [], body: { mode: "none" },
      auth: { mode: "none" }, vars: { req: [], res: [] }, script: { req: null, res: null },
      assertions: [], tests: null, docs: null, ...req,
    },
  };
}

const kv = (name, value, extra = {}) => ({ name, value, enabled: true, ...extra });
const write = (file, it) => writeFileSync(join(out, file), stringifyRequest(it, { format: "yml" }));

for (const f of readdirSync(out)) if (f.endsWith(".yml")) rmSync(join(out, f));
mkdirSync(out, { recursive: true });

// Every tab with content, as a Request Bruno saved.
const full = item({
  name: "Full Order", seq: 3, tags: ["smoke"], description: "Every tab.",
  method: "POST", url: "{{baseUrl}}/orders/:shop?verbose=1&lang={{lang}}",
  headers: [kv("content-type", "application/json"), kv("x-trace", "full-1", { description: "trace id" }), kv("x-off", "no", { enabled: false })],
  params: [
    { name: "verbose", value: "1", type: "query", enabled: true },
    { name: "lang", value: "{{lang}}", type: "query", enabled: true, description: "language" },
    { name: "debug", value: "true", type: "query", enabled: false },
    { name: "shop", value: "7", type: "path", enabled: true },
  ],
  body: { mode: "json", json: '{\n  "productId": 1,\n  "quantity": 2\n}', formUrlEncoded: [], multipartForm: [] },
  auth: { mode: "bearer", bearer: { token: "{{token}}" } },
  vars: {
    req: [kv("orderSource", "form"), kv("unused", "x: y", { enabled: false, description: "kept off" })],
    res: [kv("orderId", "res.body.id"), { name: "localNote", value: "res.body.note", enabled: false, local: true }],
  },
  script: { req: 'req.setHeader("x-pre", "1");', res: "bru.setVar(\"seen\", true);\n// done" },
  assertions: [kv("res.status", "eq 201"), kv("res.body.id", "isNumber"), kv("res.body.items", "isEmpty", { enabled: false })],
  tests: 'test("created", () => {\n  expect(res.status).to.equal(201);\n});',
  docs: "# Create an order\n\nPosts a JSON order.",
  settings: { encodeUrl: false, timeout: 3000, followRedirects: false, maxRedirects: 2, forwardAuthorizationHeader: false, omitHeaders: ["user-agent"] },
  examples: [{ name: "Created", request: { url: "{{baseUrl}}/orders", method: "POST" }, response: { status: 201, body: { type: "json", content: '{"id":7}' } } }],
});
write("full.yml", full);

// Nothing but the method and URL.
const minimal = item({ name: "Bare Ping", url: "{{baseUrl}}/health" });
write("minimal.yml", minimal);

/** A case: the file before, and after the same edit made in Bruno. */
function edit(name, before, change) {
  write(`${name}.yml`, before);
  const after = clone(before);
  change(after.request, after);
  write(`${name}.after.yml`, after);
}

// ---- headers --------------------------------------------------------------------------------
edit("headers-add", minimal, (r) => { r.headers = [kv("accept", "application/json"), kv("x-n", "1: 2", { enabled: false })]; });
edit("headers-edit", full, (r) => { r.headers[0].value = "text/plain"; r.headers[1].name = "x-trace-id"; r.headers[2].enabled = true; });
edit("headers-remove-one", full, (r) => { r.headers.splice(0, 1); });
edit("headers-clear", full, (r) => { r.headers = []; });

// ---- params: query rows rewrite the URL as setQueryParams does ---------------------------------
edit("params-edit", full, (r) => {
  r.params[0].value = "2";
  r.params[2].enabled = true;
  r.params[3].value = "9";
  r.url = "{{baseUrl}}/orders/:shop?verbose=2&lang={{lang}}&debug=true";
});
edit("params-add", minimal, (r) => {
  r.params = [{ name: "q", value: "tea pot", type: "query", enabled: true }];
  r.url = "{{baseUrl}}/health?q=tea pot";
});
edit("params-clear-query", full, (r) => {
  r.params = r.params.filter((p) => p.type === "path");
  r.url = "{{baseUrl}}/orders/:shop";
});

// ---- body ---------------------------------------------------------------------------------------
const body = (mode, extra) => ({ mode, json: null, text: null, xml: null, formUrlEncoded: [], multipartForm: [], ...extra });
edit("body-json-add", minimal, (r) => { r.body = body("json", { json: '{\n  "a": 1\n}' }); });
edit("body-json-edit", full, (r) => { r.body.json = '{"productId": 2}\n'; });
edit("body-to-text", full, (r) => { r.body = body("text", { text: "plain words  \nsecond line" }); });
edit("body-to-xml", full, (r) => { r.body = body("xml", { xml: "<order id=\"1\"/>" }); });
edit("body-to-form", full, (r) => { r.body = body("formUrlEncoded", { formUrlEncoded: [kv("a", "1"), kv("b", "x y", { enabled: false })] }); });
edit("body-to-multipart", full, (r) => { r.body = body("multipartForm", { multipartForm: [{ type: "text", name: "note", value: "hi", enabled: true }] }); });
edit("body-to-none", full, (r) => { r.body = body("none"); });
edit("body-json-empty", minimal, (r) => { r.body = body("json", { json: "" }); });
edit("body-form-empty", minimal, (r) => { r.body = body("formUrlEncoded"); });
const form = item({ name: "Form Order", method: "POST", body: body("formUrlEncoded", { formUrlEncoded: [kv("a", "1", { description: "first" }), kv("b", "2"), kv("c", "3")] }) });
edit("body-form-edit", form, (r) => { r.body.formUrlEncoded = [r.body.formUrlEncoded[0], r.body.formUrlEncoded[2], kv("d", "4")]; r.body.formUrlEncoded[0].value = "11"; });
const multipart = item({ name: "Multipart Order", method: "POST", body: body("multipartForm", { multipartForm: [
  { type: "text", name: "note", value: "hi", contentType: "text/plain", enabled: true, description: "a note" },
  { type: "text", name: "tag", value: "", enabled: false },
] }) });
edit("body-multipart-edit", multipart, (r) => { r.body.multipartForm[0].value = "hello"; r.body.multipartForm[1].enabled = true; r.body.multipartForm[1].value = "red"; });
write("body-multipart-file.yml", item({ name: "Upload", method: "POST", body: body("multipartForm", { multipartForm: [{ type: "file", name: "f", value: ["a.txt"], enabled: true }] }) }));
write("body-file.yml", item({ name: "Raw File", method: "POST", body: { mode: "file", file: [{ filePath: "a.bin", contentType: "application/octet-stream", selected: true }] } }));
write("body-sparql.yml", item({ name: "Sparql", method: "POST", body: body("sparql", { sparql: "SELECT * {}" }) }));

// ---- auth -------------------------------------------------------------------------------------
edit("auth-add-bearer", minimal, (r) => { r.auth = { mode: "bearer", bearer: { token: "abc" } }; });
edit("auth-to-basic", full, (r) => { r.auth = { mode: "basic", basic: { username: "ann", password: "p: w" } }; });
edit("auth-to-apikey", full, (r) => { r.auth = { mode: "apikey", apikey: { key: "x-api-key", value: "{{apiKey}}", placement: "queryparams" } }; });
edit("auth-to-inherit", full, (r) => { r.auth = { mode: "inherit" }; });
edit("auth-to-none", full, (r) => { r.auth = { mode: "none" }; });
edit("auth-bearer-edit", full, (r) => { r.auth.bearer.token = "{{otherToken}}"; });
const basic = item({ name: "Basic", auth: { mode: "basic", basic: { username: "ann", password: "secret" } } });
edit("auth-basic-edit", basic, (r) => { r.auth.basic.password = "new secret"; });
write("auth-digest.yml", item({ name: "Digest", auth: { mode: "digest", digest: { username: "a", password: "b" } } }));

// ---- vars -------------------------------------------------------------------------------------
edit("vars-add", minimal, (r) => { r.vars = { req: [kv("a", "1")], res: [kv("id", "res.body.id")] }; });
edit("vars-edit", full, (r) => {
  r.vars.req[0].value = "edited";
  r.vars.req.push(kv("added", "{{x}}"));
  r.vars.res[1].enabled = true;
  r.vars.res[0].value = "res.body.orderId";
});
edit("vars-clear", full, (r) => { r.vars = { req: [], res: [] }; });
const onlyVars = item({ name: "Only Vars", vars: { req: [kv("a", "1")], res: [] } });
edit("vars-clear-runtime", onlyVars, (r) => { r.vars.req = []; });

// ---- script, tests ----------------------------------------------------------------------------
edit("script-add", minimal, (r) => { r.script = { req: "const a = 1;\nreq.setHeader(\"x-a\", a);", res: null }; });
edit("script-edit", full, (r) => { r.script.req = "  // indented first line\nreq.setHeader(\"x-pre\", \"2\");\n\n"; r.script.res = ""; });
edit("tests-add", minimal, (r) => { r.tests = 'test("ok", () => expect(res.status).to.equal(200));'; });
edit("tests-clear", full, (r) => { r.tests = ""; });

// ---- assert -----------------------------------------------------------------------------------
edit("assert-add", minimal, (r) => { r.assertions = [kv("res.status", "eq 200"), kv("res.body", "isJson"), kv("res.body.n", "gt "), kv("res.body.x", "between 1 and 5", { enabled: false })]; });
edit("assert-edit", full, (r) => { r.assertions[0].value = "neq 500"; r.assertions[1].value = "isString"; r.assertions[2].enabled = true; });

// ---- docs -------------------------------------------------------------------------------------
edit("docs-add", minimal, (r) => { r.docs = "Line one\n\nline: two  \n"; });
edit("docs-clear", full, (r) => { r.docs = ""; });

// ---- settings ---------------------------------------------------------------------------------
edit("settings-edit", full, (_, it) => { it.settings = { ...it.settings, encodeUrl: true, timeout: 0, maxRedirects: 9 }; });
edit("settings-inherit", minimal, (_, it) => { it.settings = { encodeUrl: true, timeout: "inherit", followRedirects: true, maxRedirects: 5, forwardAuthorizationHeader: true }; });

console.log(readdirSync(out).filter((f) => f.endsWith(".yml")).length, "fixtures");
