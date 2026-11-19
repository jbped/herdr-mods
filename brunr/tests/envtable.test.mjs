import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeTable, ids, rowOf, editRow, removeRow, toggleEnabled, isRevealed, allRevealed, toggleReveal, toggleRevealAll,
  isDirty, markSaved, problems, canSave, envRows, dotenvEdits, dotenvNameFor, dotenvNameError, dotenvFileError, newDotenvName,
  EMPTY_NAME, INVALID_NAME, DUPLICATE_NAME,
} from "../mods/brunr/envtable.js";
import { readDotenv, applyDotenv } from "../mods/brunr/dotenv.js";
import { readEnvironment, writeEnvironment, moveSecretToDotenv } from "../mods/brunr/envfile.js";
import { deepFreeze } from "./helpers.mjs";

const ROWS = deepFreeze([
  { name: "baseUrl", value: "http://127.0.0.1:47911", description: "the fixture server" },
  { name: "shopId", value: "1", enabled: false },
  { name: "apiKey", value: "", secret: true },
]);

test("makeTable: every row has an id, a blank row comes last, nothing is revealed or dirty", () => {
  const t = makeTable(ROWS);
  assert.deepEqual(ids(t), [1, 2, 3, 4]);
  assert.deepEqual(rowOf(t, 2), { id: 2, name: "shopId", value: "1", enabled: false, secret: false, description: "", line: null });
  assert.equal(rowOf(t, 4).name, "");
  assert.deepEqual(t.revealed, []);
  assert.equal(isDirty(t), false);
});

test("editRow: a name or a value typed in the blank row adds a row and a new blank row", () => {
  const t0 = deepFreeze(makeTable(ROWS));
  assert.equal(editRow(t0, 4, { name: "" }), t0);
  const t1 = editRow(t0, 4, { name: "token" });
  assert.deepEqual(ids(t1), [1, 2, 3, 4, 5]);
  assert.deepEqual(rowOf(t1, 4), { id: 4, name: "token", value: "", enabled: true, secret: false, description: "", line: null });
  const t2 = editRow(t1, 4, { value: "demo-token-123" });
  assert.equal(rowOf(t2, 4).value, "demo-token-123");
  assert.equal(isDirty(t2), true);
});

test("editRow: a secret's value cannot be edited, its name and enabled can", () => {
  const t = editRow(makeTable(ROWS), 3, { value: "x", name: "apiKey2", enabled: false });
  assert.deepEqual(rowOf(t, 3), { id: 3, name: "apiKey2", value: "", enabled: false, secret: true, description: "", line: null });
});

test("removeRow and toggleEnabled change only that row; dirty follows the change back", () => {
  const t0 = makeTable(ROWS);
  const t1 = toggleEnabled(t0, 2);
  assert.equal(rowOf(t1, 2).enabled, true);
  assert.equal(isDirty(t1), true);
  assert.equal(isDirty(toggleEnabled(t1, 2)), false);
  const t2 = removeRow(t0, 1);
  assert.deepEqual(ids(t2), [2, 3, 4]);
  assert.equal(isDirty(t2), true);
  assert.equal(removeRow(t0, 99), t0);
  const back = editRow(editRow(t0, 1, { value: "x" }), 1, { value: "http://127.0.0.1:47911" });
  assert.equal(isDirty(back), false);
});

test("reveal: masked by default, per row and for all; secrets have no value to reveal", () => {
  const t0 = makeTable(ROWS);
  assert.equal(isRevealed(t0, 1), false);
  const t1 = toggleReveal(t0, 1);
  assert.equal(isRevealed(t1, 1), true);
  assert.equal(isRevealed(t1, 2), false);
  assert.equal(allRevealed(t1), false);
  const t2 = toggleRevealAll(t1);
  assert.deepEqual(t2.revealed, [1, 2, 4]);
  assert.equal(allRevealed(t2), true);
  assert.deepEqual(toggleRevealAll(t2).revealed, []);
  assert.deepEqual(removeRow(t2, 1).revealed, [2, 4]);
});

test("markSaved: the rows become the base, reveals stay", () => {
  const t = markSaved(toggleReveal(editRow(makeTable(ROWS), 1, { value: "y" }), 1));
  assert.equal(isDirty(t), false);
  assert.equal(isRevealed(t, 1), true);
});

test("problems: Bruno's name rule and message, empty names, duplicate names flagged", () => {
  let t = makeTable(ROWS);
  t = editRow(t, 1, { name: "base url" });
  t = editRow(t, 2, { name: "" });
  t = editRow(t, 4, { name: "apiKey" });
  t = editRow(t, 5, { name: "ok.name-1_x" });
  assert.deepEqual(problems(t), { 1: { error: INVALID_NAME }, 2: { error: EMPTY_NAME }, 3: { warn: DUPLICATE_NAME }, 4: { warn: DUPLICATE_NAME } });
  assert.equal(canSave(t), false);
  assert.equal(canSave(editRow(editRow(t, 1, { name: "baseUrl" }), 2, { name: "shopId" })), true);
  assert.equal(INVALID_NAME, 'Variable contains invalid characters. Must only contain alphanumeric characters, "-", "_", "."');
});

test("envRows: what writeEnvironment gets, a secret stays a secret with no value", () => {
  const t = editRow(makeTable(ROWS), 4, { name: "token", value: "demo-token-123" });
  const text = writeEnvironment({ format: "yaml", name: "local", rows: envRows(t) });
  assert.deepEqual(readEnvironment(text, "yaml").rows.map((r) => [r.name, r.value, r.enabled, r.secret]), [
    ["baseUrl", "http://127.0.0.1:47911", true, false], ["shopId", "1", false, false], ["apiKey", "", true, true], ["token", "demo-token-123", true, false],
  ]);
  const bru = writeEnvironment({ format: "bru", name: null, rows: envRows(t) });
  assert.match(bru, /~shopId: 1/);
  assert.match(bru, /vars:secret \[\n {2}apiKey\n\]/);
});

const DOTENV = deepFreeze([
  "# Shop secrets",
  "SHOP_KEY=demo-key-1",
  "",
  'export TOKEN="abc" # rotated monthly',
  "SHOP_KEY=demo-key-2",
  "OLD=gone",
  "LAST=end",
].join("\n") + "\n");

const dotTable = (text) => makeTable(readDotenv(text));

test("dotenvEdits: set, rename and remove their own line, adds at the end, comments and blank lines kept", () => {
  let t = dotTable(DOTENV);
  t = editRow(t, 3, { value: "demo-key-3" });          // the second SHOP_KEY, line 5
  t = editRow(t, 2, { name: "API_TOKEN", value: "demo-token-123" });
  t = removeRow(t, 4);                                // OLD, line 6
  t = editRow(t, t.blank, { name: "NEW_ONE", value: "a b#c" });
  const edits = dotenvEdits(t);
  assert.deepEqual(edits.map((e) => [e.op, e.line ?? null]), [["remove", 6], ["set", 5], ["set", 4], ["rename", 4], ["add", null]]);
  assert.equal(applyDotenv(DOTENV, edits), [
    "# Shop secrets",
    "SHOP_KEY=demo-key-1",
    "",
    'export API_TOKEN="demo-token-123" # rotated monthly',
    "SHOP_KEY=demo-key-3",
    "LAST=end",
    'NEW_ONE="a b#c"',
  ].join("\n") + "\n");
});

test("dotenvEdits: no change gives no edit; a removed row before an edited one keeps the right line", () => {
  assert.deepEqual(dotenvEdits(dotTable(DOTENV)), []);
  let t = dotTable(DOTENV);
  t = removeRow(t, 1);                                // first SHOP_KEY, line 2
  t = editRow(t, 5, { value: "fin" });                // LAST, line 7
  assert.equal(applyDotenv(DOTENV, dotenvEdits(t)), [
    "# Shop secrets", "", 'export TOKEN="abc" # rotated monthly', "SHOP_KEY=demo-key-2", "OLD=gone", "LAST=fin",
  ].join("\n") + "\n");
});

test("dotenvEdits on CRLF text keeps CRLF", () => {
  const crlf = "A=1\r\nB=2\r\n";
  let t = dotTable(crlf);
  t = editRow(t, 2, { value: "3" });
  t = editRow(t, t.blank, { name: "C", value: "4" });
  assert.equal(applyDotenv(crlf, dotenvEdits(t)), "A=1\r\nB=3\r\nC=4\r\n");
});

test("dotenvNameFor: upper case with underscores, always a valid .env name", () => {
  assert.equal(dotenvNameFor("apiKey"), "API_KEY");
  assert.equal(dotenvNameFor("x-token.v2"), "X_TOKEN_V2");
  assert.equal(dotenvNameFor("already_UPPER"), "ALREADY_UPPER");
  assert.equal(dotenvNameFor("a1B"), "A1_B");
  assert.equal(dotenvNameFor("--"), "SECRET");
  for (const n of ["apiKey", "x-token.v2", "a b", "ü"]) assert.equal(dotenvNameError(dotenvNameFor(n)), null, n);
  assert.equal(dotenvNameError(""), EMPTY_NAME);
  assert.equal(dotenvNameError("A B"), INVALID_NAME);
});

test("moveSecretToDotenv with a .env name rewrites the variable as process.env of that name", () => {
  const rows = moveSecretToDotenv(ROWS, "apiKey", "API_KEY");
  assert.deepEqual(rows[2], { name: "apiKey", value: "{{process.env.API_KEY}}", secret: false });
  assert.equal(moveSecretToDotenv(ROWS, "apiKey")[2].value, "{{process.env.apiKey}}");
});

test("dotenvFileError and newDotenvName follow isDotenvFile and the names taken", () => {
  assert.equal(dotenvFileError(".env.local", [".env"]), null);
  assert.equal(dotenvFileError(".ENV", [".env"]), "Use .env or .env.<name>, with letters, digits, '.', '_' and '-'.");
  assert.equal(dotenvFileError(".env", [".env"]), ".env already exists.");
  assert.match(dotenvFileError("env.local", []), /^Use \.env/);
  assert.equal(newDotenvName([]), ".env");
  assert.equal(newDotenvName([".env"]), ".env.local");
  assert.equal(newDotenvName([".env", ".env.local", ".env.local2"]), ".env.local3");
});
