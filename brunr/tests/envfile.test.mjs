import { test } from "node:test";
import assert from "node:assert/strict";
import { readEnvironment, writeEnvironment, moveSecretToDotenv, readExtends, setExtends, setEnvironmentName, dropColor } from "../mods/brunr/envfile.js";
import { parseCollection } from "../mods/brunr/parser.js";
import { readTree, deepFreeze } from "./helpers.mjs";

const ROWS = deepFreeze([
  { name: "baseUrl", value: "http://x:1", enabled: true, secret: false, description: "the url" },
  { name: "off", value: "true", enabled: false, secret: false, description: "" },
  { name: "tok", value: "", enabled: true, secret: true, description: "" },
  { name: "tok2", value: "", enabled: false, secret: true, description: "d" },
]);

test("readEnvironment returns the fixture rows with values in both formats", () => {
  const y = readEnvironment(readTree("yaml")["environments/local.yml"], "yaml");
  assert.equal(y.name, "local");
  assert.deepEqual(y.rows, [
    { name: "baseUrl", value: "http://127.0.0.1:47911", enabled: true, secret: false, description: "the fixture server" },
    { name: "shopId", value: "1", enabled: true, secret: false, description: "" },
    { name: "apiKey", value: "", enabled: true, secret: true, description: "a secret has no value key" },
  ]);
  const b = readEnvironment(readTree("bru")["environments/local.bru"], "bru");
  assert.equal(b.name, null);
  assert.deepEqual(b.rows.map((r) => [r.name, r.value, r.enabled, r.secret]), [["baseUrl", "http://127.0.0.1:47911", true, false], ["shopId", "1", true, false], ["apiKey", "", true, true]]);
});

// The expected texts are what @usebruno/filestore's stringifyEnvironment produces for the same rows.
test("writeEnvironment writes Bruno's YAML shape, keeping extends from the previous text", () => {
  const out = writeEnvironment(deepFreeze({ format: "yaml", name: "dev", rows: ROWS, previousText: "name: old\nextends: base\nvariables:\n  - name: a\n    value: b\n" }));
  assert.equal(out, 'name: dev\nextends: base\nvariables:\n  - name: baseUrl\n    value: http://x:1\n    description: the url\n  - name: off\n    value: "true"\n    disabled: true\n  - secret: true\n    name: tok\n  - secret: true\n    name: tok2\n    disabled: true\n    description: d\n');
  assert.deepEqual(readEnvironment(out, "yaml").rows, ROWS);
  assert.equal(writeEnvironment({ format: "yaml", name: "dev", rows: [] }), "name: dev\n");
  assert.equal(writeEnvironment({ format: "yaml", name: "dev", rows: [{ name: "a", value: "x\ny", enabled: true, secret: false, description: "it's\nmulti" }] }),
    "name: dev\nvariables:\n  - name: a\n    value: |-\n      x\n      y\n    description: |-\n      it's\n      multi\n");
});

test("writeEnvironment writes Bruno's bru shape: ~ for disabled, vars:secret, annotations, extends kept", () => {
  const out = writeEnvironment({ format: "bru", name: "dev", rows: ROWS, previousText: "extends: base\nvars {\n  a: b\n}\ncolor: #ff0000\n" });
  assert.equal(out, "extends: base\nvars {\n  @description('the url')\n  baseUrl: http://x:1\n  ~off: true\n}\nvars:secret [\n  tok,\n  @description('d')\n  ~tok2\n]\ncolor: #ff0000\n");
  assert.deepEqual(readEnvironment(out, "bru").rows, ROWS);
  assert.equal(writeEnvironment({ format: "bru", name: "dev", rows: [] }), "vars {\n}\n");
  const multi = writeEnvironment({ format: "bru", name: "dev", rows: [{ name: "a", value: "x\ny", enabled: true, secret: false, description: "it's\nmulti" }] });
  assert.equal(multi, "vars {\n  @description('''\n    it's\n    multi\n  ''')\n  a: '''\n    x\n    y\n  '''\n}\n");
  assert.deepEqual(readEnvironment(multi, "bru").rows, [{ name: "a", value: "x\ny", enabled: true, secret: false, description: "it's\nmulti" }]);
  assert.equal(writeEnvironment({ format: "bru", name: "d", rows: [{ name: "q", value: "1", enabled: true, secret: false, description: "it's" }] }), "vars {\n  @description(\"it's\")\n  q: 1\n}\n");
});

test("writeEnvironment keeps CRLF and keys Brunr does not model", () => {
  const prev = "name: old\r\ncolor: \"#00ff00\"\r\nvariables:\r\n  - name: a\r\n    value: b\r\nexternalSecrets:\r\n  type: vault\r\n";
  assert.equal(writeEnvironment({ format: "yaml", name: "old", rows: [{ name: "a", value: "c", enabled: true, secret: false, description: "" }], previousText: prev }),
    "name: old\r\ncolor: \"#00ff00\"\r\nvariables:\r\n  - name: a\r\n    value: c\r\nexternalSecrets:\r\n  type: vault\r\n");
});

test("a written Environment parses in the parser with names and secret flags only", () => {
  for (const format of ["yaml", "bru"]) {
    const ext = format === "yaml" ? "yml" : "bru";
    const c = parseCollection({ root: "/t", files: {
      [format === "yaml" ? "opencollection.yml" : "bruno.json"]: format === "yaml" ? "info:\n  name: T\n" : '{"name":"T"}',
      [`environments/dev.${ext}`]: writeEnvironment({ format, name: "dev", rows: ROWS, previousText: format === "yaml" ? "extends: base\n" : "extends: base\ncolor: red\n" }),
    } });
    assert.deepEqual(c.errors, [], format);
    // The parser lists disabled YAML variables and skips disabled bru ones, as before this change.
    const want = format === "yaml" ? [["baseUrl", false], ["off", false], ["tok", true], ["tok2", true]] : [["baseUrl", false], ["tok", true]];
    assert.deepEqual(c.environments[0].variables.map((v) => [v.name, v.secret]), want, format);
  }
});

test("moveSecretToDotenv turns the secret into a process.env reference and leaves the rest", () => {
  const out = moveSecretToDotenv(ROWS, "tok");
  assert.deepEqual(out[2], { name: "tok", value: "{{process.env.tok}}", enabled: true, secret: false, description: "" });
  assert.deepEqual(out.filter((_, i) => i !== 2), ROWS.filter((_, i) => i !== 2));
});

test("extends, name and color lines are edited in place", () => {
  const y = "name: qa\r\nextends: base\r\ncolor: red\r\nvariables:\r\n  - name: a\r\n    value: b\r\n";
  assert.equal(readExtends(y, "yaml"), "base");
  assert.equal(setExtends(y, "yaml", "prod"), y.replace("extends: base", "extends: prod"));
  assert.equal(setExtends(y, "yaml", "true"), y.replace("extends: base", 'extends: "true"'));
  assert.equal(setEnvironmentName(y, "yaml", "qa 2"), y.replace("name: qa", "name: qa 2"));
  assert.equal(dropColor(y), y.replace("color: red\r\n", ""));
  const b = "extends: base\nvars {\n  a: b\n}\n";
  assert.equal(readExtends(b, "bru"), "base");
  assert.equal(setExtends(b, "bru", "prod"), b.replace("base", "prod"));
  assert.equal(setEnvironmentName(b, "bru", "x"), b);
  assert.equal(readExtends("vars {\n}\n", "bru"), null);
  assert.equal(readExtends("name: x\nextends:\n  - a\n", "yaml"), null);
});
