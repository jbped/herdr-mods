// The Request form's secret-handling test (spec D9). The dialog is opened through the herdr and gpui
// shims, with a scratch Request in its Request column. Marker values are typed into a header, a
// basic password, a bearer token, a JSON body and a pre-request variable through each tab's own
// fields, and saved with ctrl-s. Then no marker may be in shared state, localStorage, an overlay's
// props, a picker, the ask log, a toast, a log line, a command or an exec argument, and each must be
// in the saved file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scratch, openRequest, press, typeIn, choose, save, draw, herdr, errors } from "./dialoghelp.mjs";

const MARK = {
  header: "leak-marker-header-5150",
  password: "leak-marker-password-2718",
  token: "leak-marker-token-3141",
  body: "leak-marker-body-1618",
  variable: "leak-marker-var-4669",
};

const REQUEST = `info:
  name: Leak Check
  type: http
  seq: 1

http:
  method: POST
  url: "{{baseUrl}}/echo"
`;

const logs = [];
const storage = new Map();
const realLog = console.log;
let dir;

before(() => {
  dir = scratch({ "Leak Check.yml": REQUEST });
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
  console.log = (...a) => { logs.push(a.map(String).join(" ")); };
});

after(() => {
  console.log = realLog;
  delete globalThis.localStorage;
  dir.cleanup();
});

test("form values typed in every tab reach the saved file and nothing else", async () => {
  herdr.state.shared = {};
  const { dialog: self, col } = await openRequest(dir.root, "Leak Check.yml");
  const pickers = [];
  const show = self.pickers.show.bind(self.pickers);
  self.pickers.show = (p, cx) => { pickers.push(p); show(p, cx); };
  const file = () => readFileSync(join(dir.root, "Leak Check.yml"), "utf8");
  assert.equal(col.form.tab, "params", "the first time, Params");

  press(self, "brunr-tab-headers");
  typeIn(self, "headers:0:name", "x-leak");
  typeIn(self, "headers:0:value", MARK.header);

  press(self, "brunr-tab-auth");
  await choose(self, "brunr-auth-mode", "basic");
  typeIn(self, "auth:username", "demo-user");
  typeIn(self, "auth:password", MARK.password);
  assert.equal(col.form.wid.get("auth:password").masked, true, "the password is masked");
  await save(self);
  assert.match(file(), new RegExp(`value: ${MARK.header}`));
  assert.match(file(), new RegExp(`password: ${MARK.password}`));

  await choose(self, "brunr-auth-mode", "bearer");
  typeIn(self, "auth:token", MARK.token);
  assert.equal(col.form.wid.get("auth:token").masked, true, "the token is masked");
  press(self, "brunr-reveal-auth-token");
  assert.equal(col.form.wid.get("auth:token").masked, false, "revealed");

  press(self, "brunr-tab-body");
  await choose(self, "brunr-body-mode", "json");
  typeIn(self, "body:json", `{"note":"${MARK.body}"}`);

  press(self, "brunr-tab-vars");
  typeIn(self, "pre:0:name", "leakVar");
  typeIn(self, "pre:0:value", MARK.variable);
  await save(self);

  const text = file();
  assert.match(text, new RegExp(`token: ${MARK.token}`));
  assert.match(text, new RegExp(`data: '\\{"note":"${MARK.body}"\\}'`));
  assert.match(text, new RegExp(`- name: leakVar\\n {6}value: ${MARK.variable}`));
  assert.match(text, new RegExp(`value: ${MARK.header}`));
  assert.ok(!text.includes(MARK.password), "the basic password went with the mode change");
  draw(self);
  assert.deepEqual(errors, []);

  const outside = JSON.stringify({
    shared: herdr.state.shared, storage: [...storage], overlays: herdr.overlays, notices: herdr.notices,
    ran: herdr.ran, calls: herdr.calls.map((c) => [c.cmd, c.args, c.opts]), logs,
    pickers: pickers.map((p) => ({ title: p.title, detail: p.detail, lines: p.lines, options: p.options, current: p.current })),
    note: self.note,
  });
  for (const [name, mark] of Object.entries(MARK)) assert.ok(!outside.includes(mark), `the ${name} marker left the Request column`);
  assert.deepEqual([...storage], [], "the dialog's localStorage holds nothing");
  const saved = Object.entries(herdr.state.shared).filter(([k]) => k.startsWith("brunr.saved."));
  assert.deepEqual(saved, [["brunr.saved.formTab", "vars"]], "stored state holds the tab name only");
  // Menus carry option keys only: a mode, never a field's text.
  assert.equal(pickers.length, 3, "three menus were used");
  for (const p of pickers) for (const o of p.options) assert.equal(typeof o.value, "string");
  assert.equal(herdr.overlays.length, 0, "no menu or question opens an overlay");
});
