import { test } from "node:test";
import assert from "node:assert/strict";
import { isDotenvFile, readDotenv, applyDotenv } from "../mods/brunr/dotenv.js";
import { deepFreeze } from "./helpers.mjs";

const FILE = deepFreeze([
  "# Shop secrets",
  "SHOP_KEY=fixture-not-a-secret",
  "",
  'export TOKEN="abc\\ndef" # rotated monthly',
  "HASH=a#b",
  "SINGLE = 'q x'",
  'MULTI="m',
  'l"',
  "SHOP_KEY=second",
  "EMPTY=",
  "URL=http://a.test/x?y=1&z=2",
].join("\n") + "\n");

test("isDotenvFile accepts .env and .env.<suffix> only", () => {
  for (const ok of [".env", ".env.local", ".env.prod-2", ".env.a_b.c"]) assert.equal(isDotenvFile(ok), true, ok);
  for (const bad of ["env", ".env.", ".envrc", ".env.a b", "x.env", ".env/x", ""]) assert.equal(isDotenvFile(bad), false, bad);
});

test("readDotenv reads rows the way dotenv does: quotes, export, comments, = in values", () => {
  assert.deepEqual(readDotenv(FILE), [
    { line: 2, name: "SHOP_KEY", value: "fixture-not-a-secret" },
    { line: 4, name: "TOKEN", value: "abc\ndef" },
    { line: 5, name: "HASH", value: "a" },
    { line: 6, name: "SINGLE", value: "q x" },
    { line: 7, name: "MULTI", value: "m\nl" },
    { line: 9, name: "SHOP_KEY", value: "second" },
    { line: 10, name: "EMPTY", value: "" },
    { line: 11, name: "URL", value: "http://a.test/x?y=1&z=2" },
  ]);
  assert.deepEqual(readDotenv(FILE.replace(/\n/g, "\r\n")), readDotenv(FILE));
  assert.deepEqual(readDotenv(""), []);
});

test("set changes only the value of the last row with that name, keeping its quotes and comment", () => {
  const out = applyDotenv(FILE, [{ op: "set", name: "SHOP_KEY", value: "third" }, { op: "set", name: "TOKEN", value: "new" }]);
  assert.equal(out, FILE.replace("SHOP_KEY=second", "SHOP_KEY=third").replace('"abc\\ndef" # rotated', '"new" # rotated'));
  assert.equal(applyDotenv(FILE, [{ op: "set", name: "SHOP_KEY", line: 2, value: "first" }]), FILE.replace("=fixture-not-a-secret", "=first"));
  assert.equal(applyDotenv(FILE, [{ op: "set", name: "MULTI", value: "one" }]), FILE.replace('MULTI="m\nl"', 'MULTI="one"'));
});

test("a new value is quoted only when it needs it", () => {
  const set = (value) => applyDotenv("A=1\n", [{ op: "set", name: "A", value }]);
  assert.equal(set("plain-value_1"), "A=plain-value_1\n");
  assert.equal(set("has # hash"), 'A="has # hash"\n');
  assert.equal(set(" lead"), 'A=" lead"\n');
  assert.equal(set("two\nlines"), 'A="two\\nlines"\n');
  assert.equal(set('say "hi"'), "A='say \"hi\"'\n");
  assert.equal(set(`it's "x"`), "A=`it's \"x\"`\n");
  assert.equal(set(""), "A=\n");
  for (const value of ["has # hash", " lead", "two\nlines", 'say "hi"', `it's "x"`, "a=b"]) assert.equal(readDotenv(set(value))[0].value, value, value);
});

test("rename, add and remove change only their lines; comments, blanks and order survive", () => {
  const out = applyDotenv(FILE, [{ op: "rename", name: "HASH", to: "HASH2" }, { op: "remove", name: "SINGLE" }, { op: "add", name: "NEW_ONE", value: "v" }]);
  assert.equal(out, FILE.replace("HASH=", "HASH2=").replace("SINGLE = 'q x'\n", "") + "NEW_ONE=v\n");
  assert.deepEqual(readDotenv(out).map((r) => r.name), ["SHOP_KEY", "TOKEN", "HASH2", "MULTI", "SHOP_KEY", "EMPTY", "URL", "NEW_ONE"]);
});

test("CRLF and a missing final newline are kept", () => {
  assert.equal(applyDotenv("# c\r\nA=1\r\nB=2", [{ op: "set", name: "B", value: "3" }]), "# c\r\nA=1\r\nB=3");
  assert.equal(applyDotenv("A=1\r\nB=2", [{ op: "add", name: "C", value: "4" }]), "A=1\r\nB=2\r\nC=4");
  assert.equal(applyDotenv("A=1\r\nB=2\r\n", [{ op: "add", name: "C", value: "4" }]), "A=1\r\nB=2\r\nC=4\r\n");
  assert.equal(applyDotenv("A=1\r\nB=2", [{ op: "remove", name: "B" }]), "A=1");
  assert.equal(applyDotenv("A=1\r\nB=2\r\n", [{ op: "remove", name: "A" }]), "B=2\r\n");
  assert.equal(applyDotenv("", [{ op: "add", name: "A", value: "1" }]), "A=1\n");
});

test("bad names and missing rows throw", () => {
  assert.throws(() => applyDotenv(FILE, [{ op: "add", name: "BAD NAME", value: "x" }]), /not a valid .env name/);
  assert.throws(() => applyDotenv(FILE, [{ op: "rename", name: "HASH", to: "a=b" }]), /not a valid/);
  assert.throws(() => applyDotenv(FILE, [{ op: "set", name: "NOPE", value: "x" }]), /no variable NOPE/);
});
