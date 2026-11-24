// Cases taken from Bruno's own naming.spec.ts and filesystem utils.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeName, validateName, uniqueName, cloneName } from "../mods/brunr/names.js";
import { deepFreeze } from "./helpers.mjs";

test("sanitizeName keeps interior spaces, replaces bad characters and trims the ends", () => {
  assert.equal(sanitizeName("my login request"), "my login request");
  assert.equal(sanitizeName("a/b:c*d"), "a-b-c-d");
  assert.equal(sanitizeName("  -hello.  "), "hello");
  assert.equal(sanitizeName("source copy"), "source copy");
  assert.equal(sanitizeName('x<>"\\|?y\u0001z'), "x------y-z");
  assert.equal(sanitizeName("--- ..."), "");
  assert.equal(sanitizeName(null), "");
});

test("validateName returns null for a good name and Bruno's message otherwise", () => {
  for (const ok of ["login", "my login request", "source copy", "a".repeat(255), "CONSOLE", "a-b", "v1.2"]) assert.equal(validateName(ok), null, ok);
  assert.equal(validateName(""), "Name cannot be empty.");
  assert.equal(validateName(undefined), "Name cannot be empty.");
  assert.equal(validateName("a".repeat(256)), "Name cannot exceed 255 characters.");
  for (const r of ["CON", "con", "LPT1", "COM9", "NUL", "aux"]) assert.equal(validateName(r), "Name cannot be a reserved device name.", r);
  assert.equal(validateName("a/b"), "Special characters aren't allowed in the name. Invalid character '/'.");
  assert.equal(validateName(" leading"), "Special characters aren't allowed in the name. Invalid character ' '.");
  assert.equal(validateName("-leading"), "Special characters aren't allowed in the name. Invalid character '-'.");
  assert.equal(validateName("trailing."), "Special characters aren't allowed in the name. Invalid character '.'.");
});

test("uniqueName appends 1, 2 … on a clash, ignoring case", () => {
  const taken = deepFreeze(["Get Health.yml", "get health 1.yml", "orders"]);
  assert.equal(uniqueName(taken, "Get Health", ".yml"), "Get Health 2.yml");
  assert.equal(uniqueName(taken, "Ping", ".yml"), "Ping.yml");
  assert.equal(uniqueName(taken, "Orders", ""), "Orders 1");
  assert.equal(uniqueName(new Set(["x.bru"]), "x", ".bru"), "x 1.bru");
});

test("uniqueName shortens a long base so every candidate fits 255 characters, and gives up after 200", () => {
  const long = "n".repeat(300);
  const name = uniqueName([], long, ".yml");
  assert.equal(name.length, 255 - 4);
  assert.equal(uniqueName([name], long, ".yml").length, 255 - 4 + 2);
  const all = ["t", ...Array.from({ length: 199 }, (_, i) => `t ${i + 1}`)];
  assert.equal(uniqueName(all, "t", ""), null);
});

test("cloneName is Bruno's nextCopyName", () => {
  assert.equal(cloneName(["login"], "login"), "login copy");
  assert.equal(cloneName(["login", "login copy"], "login"), "login copy 2");
  assert.equal(cloneName(["login", "login copy"], "login copy"), "login copy 2");
  assert.equal(cloneName(["login", "login copy", "login copy 2"], "login copy 2"), "login copy 3");
  assert.equal(cloneName(["login", "login copy 2"], "login"), "login copy");
  assert.equal(cloneName(["login", "login copy", "login copy 3"], "login"), "login copy 2");
  assert.equal(cloneName(["login", "login Copy"], "login"), "login copy", "case-sensitive");
  assert.equal(cloneName([], "Get Entity Details copy copy copy"), "Get Entity Details copy");
  assert.equal(cloneName([], "Hard Copy"), "Hard Copy copy");
  assert.equal(cloneName([], "copy"), "copy copy");
  assert.equal(cloneName(deepFreeze(["Release"]), "Release copy 2024"), "Release copy");
});
