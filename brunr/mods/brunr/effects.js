// The effects runner: the only place Brunr changes files. It performs the effects fileops.js plans
// (write, mkdir, move, trash) on this computer, in order, and stops at the first failure.
//
// - write: Herdr's writeTextFile, atomic and change-checked against the expected text.
// - mkdir, move and a permanent delete: one `node` exec with a fixed script. fs/promises may write
//   only under the app home, and a shell would read the paths, so every path is an argument of
//   its own and no shell ever sees one.
// - trash: the system's trash. Windows: the shell's recycle bin through PowerShell, which gets the
//   path in an environment variable from a `node` wrapper, never in its command text. macOS: its
//   `trash` command. Linux: `gio trash`.
// Effects are never performed for a Collection on another Machine, nor outside the Collection root.
import { exec, readTextFile, writeTextFile } from "herdr";
import { platform } from "./machine.js";

const TIMEOUT = 30000;
const slash = (p) => String(p ?? "").replace(/\\/g, "/");
const trimEnd = (p) => slash(p).replace(/\/+$/, "");

// Exit codes the node script uses.
const EXISTS = 17;
const MISSING = 2;
const NO_PROGRAM = 127;

const FS_SCRIPT = [
  'const fs = require("fs");',
  "const [op, a, b] = process.argv.slice(1);",
  "const fail = (code, m) => { process.stderr.write(m); process.exit(code); };",
  "const same = (x, y) => { try { const s = fs.statSync(x), t = fs.statSync(y); return s.ino !== 0 && s.ino === t.ino && s.dev === t.dev; } catch { return false; } };",
  "try {",
  `  if (op === "mkdir") { if (fs.existsSync(a)) { if (b === "existsOk" && fs.statSync(a).isDirectory()) process.exit(0); fail(${EXISTS}, "It already exists."); } fs.mkdirSync(a); }`,
  `  else if (op === "move") { if (!fs.existsSync(a)) fail(${MISSING}, "It is not there."); if (fs.existsSync(b) && !same(a, b)) fail(${EXISTS}, "The target already exists."); fs.renameSync(a, b); }`,
  `  else if (op === "remove") { if (!fs.existsSync(a)) fail(${MISSING}, "It is not there."); fs.rmSync(a, { recursive: true }); }`,
  '  else fail(64, "Unknown operation.");',
  "} catch (e) { fail(1, String((e && e.message) || e)); }",
].join("\n");

// Windows: PowerShell reads the path from BRUNR_TRASH. Its command text is fixed.
const TRASH_PS = [
  "$ErrorActionPreference = 'Stop';",
  "$p = $env:BRUNR_TRASH -replace '/', '\\';",
  "if (-not (Test-Path -LiteralPath $p)) { exit 2 };",
  "Add-Type -AssemblyName Microsoft.VisualBasic;",
  "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
  "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') };",
  "if (Test-Path -LiteralPath $p) { exit 1 }",
].join(" ");

const TRASH_WINDOWS = [
  'const cp = require("child_process");',
  `const r = cp.spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ${JSON.stringify(TRASH_PS)}], { env: { ...process.env, BRUNR_TRASH: process.argv[1] }, encoding: "utf8", windowsHide: true });`,
  `if (r.error) { process.stderr.write("brunr: cannot start PowerShell: " + r.error.message); process.exit(${NO_PROGRAM}); }`,
  'process.stderr.write(r.stderr || "");',
  "process.exit(r.status == null ? 1 : r.status);",
].join("\n");

/** True when `path` is an absolute path strictly inside `root`. Case is ignored on Windows. */
export function insideRoot(root, path) {
  const r = trimEnd(root), p = slash(path);
  if (!r || !/^([A-Za-z]:)?\//.test(p) || p.split("/").some((s) => s === ".." || s === ".")) return false;
  const fold = platform() === "windows" ? (s) => s.toLowerCase() : (s) => s;
  return fold(p).startsWith(`${fold(r)}/`) && p.length > r.length + 1;
}

const pathsOf = (e) => (e.op === "move" ? [e.from, e.to] : [e.path]);

const failure = (effect, index, kind, message, extra = {}) => ({ effect, index, kind, message, ...extra });

/** What a program failure means: "missing" when it could not start. */
const startFailed = (e) => /not found|cannot start|no such file|ENOENT/i.test(String(e?.message ?? e));

async function node(args) {
  try {
    const r = await exec("node", ["-e", ...args], { timeout: TIMEOUT });
    return { code: r.code, message: (r.stderr || r.stdout || "").trim() };
  } catch (e) {
    return { code: startFailed(e) ? NO_PROGRAM : 1, message: startFailed(e) ? "Node.js was not found." : String(e?.message ?? e) };
  }
}

async function doWrite(e, i) {
  try {
    await writeTextFile(slash(e.path), e.text, e.expected ?? null);
    return null;
  } catch (err) {
    // The rejection does not say why, so the file is read again to tell a conflict from the rest.
    const current = await readTextFile(slash(e.path)).catch(() => null);
    if (e.expected == null) {
      if (current != null) return failure(e, i, "exists", `${baseName(e.path)} already exists.`);
      return failure(e, i, "error", `Cannot create ${baseName(e.path)}: ${err?.message ?? err}`);
    }
    if (current == null) return failure(e, i, "missing", `${baseName(e.path)} is not on disk any more.`);
    if (current !== e.expected) return failure(e, i, "conflict", `${baseName(e.path)} changed on disk.`, { current });
    return failure(e, i, "error", `Cannot write ${baseName(e.path)}: ${err?.message ?? err}`);
  }
}

const baseName = (p) => trimEnd(p).split("/").pop();

async function doFs(e, i) {
  const args = e.op === "mkdir" ? [FS_SCRIPT, "--", "mkdir", slash(e.path), e.existsOk ? "existsOk" : ""] : [FS_SCRIPT, "--", "move", slash(e.from), slash(e.to)];
  const r = await node(args);
  if (r.code === 0) return null;
  const name = baseName(e.op === "move" ? e.to : e.path);
  if (r.code === EXISTS) return failure(e, i, "exists", `${name} already exists.`);
  if (r.code === MISSING) return failure(e, i, "missing", `${baseName(e.from)} is not on disk any more.`);
  return failure(e, i, "error", `Cannot ${e.op === "mkdir" ? "create" : "move"} ${name}: ${r.message}`);
}

/** Moves one path to the system trash: `{ ok, missing, message }`. `missing` when there is no trash command. */
export async function trash(path) {
  const p = slash(path), os = platform();
  try {
    if (os === "windows") {
      const r = await node([TRASH_WINDOWS, "--", p]);
      if (r.code === 0) return { ok: true, missing: false, message: "" };
      if (r.code === MISSING) return { ok: false, missing: false, message: `${baseName(p)} is not on disk any more.` };
      return { ok: false, missing: r.code === NO_PROGRAM, message: r.message || "The recycle bin refused it." };
    }
    const [cmd, args] = os === "macos" ? ["trash", [p]] : ["gio", ["trash", "--", p]];
    const r = await exec(cmd, args, { timeout: TIMEOUT });
    if (r.code === 0) return { ok: true, missing: false, message: "" };
    return { ok: false, missing: r.code === NO_PROGRAM, message: (r.stderr || r.stdout || "").trim() || `${cmd} failed.` };
  } catch (e) {
    const missing = startFailed(e);
    return { ok: false, missing, message: missing ? `No trash command on this computer (${os === "macos" ? "trash" : os === "windows" ? "PowerShell" : "gio"}).` : String(e?.message ?? e) };
  }
}

/**
 * Deletes a file or folder for good. Only ever called after the person confirmed a second time
 * that the trash failed. `{ ok, message }`. Refused outside `root` and on another Machine.
 */
export async function deletePermanently(path, { machine = null, root } = {}) {
  if (machine != null) return { ok: false, message: "Editing works on this computer only." };
  if (!insideRoot(root, path)) return { ok: false, message: "Brunr deletes only inside the Collection." };
  const r = await node([FS_SCRIPT, "--", "remove", slash(path)]);
  return r.code === 0 ? { ok: true, message: "" } : { ok: false, message: r.code === MISSING ? `${baseName(path)} is not on disk any more.` : r.message };
}

/**
 * Performs `effects` in order on this computer and stops at the first failure.
 * `options.machine`: the Collection's Machine (null here). `options.root`: its root; every path
 * must be inside it. Returns `{ ok, ran, failed }`: `ran` lists the effects that completed, and
 * `failed` is null or `{ effect, index, kind, message, current? }`.
 * `kind`: "remote" (another Machine: nothing runs), "outside" (a path outside the root: nothing
 * runs), "conflict" (a write whose expected text is stale; `current` is the text on disk),
 * "exists" (a create, mkdir or move target that exists), "missing" (the file or source is gone),
 * "trash" (the trash failed; `missing` says there is no trash command, so the caller may offer
 * deletePermanently), or "error".
 */
export async function runEffects(effects, { machine = null, root = null } = {}) {
  const list = effects ?? [];
  if (machine != null) return { ok: false, ran: [], failed: failure(list[0] ?? null, 0, "remote", "Editing works on this computer only.") };
  const bad = list.findIndex((e) => !["write", "mkdir", "move", "trash"].includes(e?.op) || !pathsOf(e).every((p) => insideRoot(root, p)));
  if (bad >= 0) return { ok: false, ran: [], failed: failure(list[bad], bad, "outside", "Brunr changes files only inside the Collection.") };
  const ran = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    let f = null;
    if (e.op === "write") f = await doWrite(e, i);
    else if (e.op === "trash") {
      const r = await trash(e.path);
      if (!r.ok) f = failure(e, i, "trash", r.message, { missing: r.missing });
    } else f = await doFs(e, i);
    if (f) return { ok: false, ran, failed: f };
    ran.push(e);
  }
  return { ok: true, ran, failed: null };
}

/**
 * The texts an operation needs: `{ [relPath]: text | null }`, null for a file that is not there.
 * `paths` are relative to `root`. `machine`: read there (reading is allowed anywhere).
 */
export async function readTexts(root, paths, machine = null) {
  const base = trimEnd(root);
  const out = {};
  await Promise.all([...new Set(paths ?? [])].map(async (rel) => {
    try { out[rel] = await readTextFile(`${base}/${rel}`, { on: machine ?? null }); } catch { out[rel] = null; }
    if (out[rel] === undefined) out[rel] = null;
  }));
  return out;
}
