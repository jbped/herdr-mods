// Claude hook events -> review stores. The hook (hooks/wingman-hook.sh) saves each
// Edit/Write as data/wingman/events/<ns>-<terminal>-<pid>.json. Each edited file goes to
// the store of the repo it lives in, so one space's review can span several repos.
// The first edit of a file sets its baseline from Claude's own `originalFile`, which is
// exactly what was on disk before the edit. Files outside any git repo are skipped.
import * as fs from "fs/promises";
import { readTextFile, writeTextFile, appHome, terminals } from "herdr";
import { Store, ensureDir } from "./store.js";
import { hostPath } from "./capture.js";

export const reviewDir = () => `${appHome()}/data/wingman`;
const SPACES = () => `${reviewDir()}/spaces.json`;

/** Repos each space's agents have edited: { "<space id>": ["C:/dev/a", ...] }. */
export async function spaceRepos() {
  const t = await readTextFile(SPACES());
  return t ? JSON.parse(t) : {};
}

async function addSpaceRepos(add) {
  const before = await readTextFile(SPACES()), map = before ? JSON.parse(before) : {};
  let changed = false;
  for (const [space, root] of add) {
    const list = (map[space] ??= []);
    if (!list.includes(root)) { list.push(root); changed = true; }
  }
  if (changed) await writeTextFile(SPACES(), JSON.stringify(map, null, 2) + "\n", before);
}

const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/"))) || p;

export class Journal {
  constructor(log) { this.log = log; this.stores = new Map(); this.failures = new Map(); }

  /** The store for the repo that holds `path`'s folder, cached by folder; null outside git. */
  async storeFor(folder) {
    if (!this.stores.has(folder)) this.stores.set(folder, await Store.open(folder).catch(() => null));
    return this.stores.get(folder);
  }

  /** Processes every pending event file in order, then removes it. Returns files adopted. */
  async drain() {
    const dir = `${reviewDir()}/events`;
    if (!(await fs.exists(dir))) return 0;
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    let adopted = 0;
    const spaces = [];
    for (const name of names) {
      const path = `${dir}/${name}`;
      let done = true;
      try {
        const text = await readTextFile(path);
        if (text) {
          const { terminal, event } = JSON.parse(text);
          const space = terminals().find((t) => t.address === terminal)?.labels?.["herdr.space"] ?? null;
          const r = await this.apply(event, terminal);
          this.log(`hook ${terminal} ${event?.tool_name} ${event?.tool_input?.file_path ?? ""} -> ${r?.added ? "added" : r ? "already reviewed" : "not in a repo"}`);
          if (r && space) spaces.push([space, r.root]);
          if (r?.added) adopted++;
          // Claude's own folder belongs to the space too, even before it edits there.
          const cwd = hostPath(event.cwd);
          const home = cwd && (await this.storeFor(cwd));
          if (home && space) spaces.push([space, home.root]);
        }
      } catch (e) {
        // Keep the event for a retry (a file may be mid-write); drop it after 3 failures.
        const n = (this.failures.get(name) ?? 0) + 1;
        this.failures.set(name, n);
        done = n >= 3 || e instanceof SyntaxError;
        this.log(`event ${name}: ${e.message ?? e}${done ? " (dropped)" : " (will retry)"}`);
      }
      if (done) { this.failures.delete(name); await fs.unlink(path).catch(() => {}); }
      else break; // keep order: later events for the same file must wait
    }
    if (spaces.length) await addSpaceRepos(spaces);
    return adopted;
  }

  /** Adds an edited file to its repo's review unless it is already there. */
  async apply(event, terminal) {
    const asSeen = event?.tool_input?.file_path ?? event?.tool_input?.notebook_path;
    const file = hostPath(asSeen);
    if (!file) return null;
    const store = await this.storeFor(dirOf(file));
    if (!store) return null; // outside git: not reviewed (MVP)
    const rel = file.slice(store.root.length + 1);
    if (!rel || file.slice(0, store.root.length).toLowerCase() !== store.root.toLowerCase()) return null;
    const res = event.tool_response ?? {};
    const created = res.type === "create";
    const original = created ? "" : res.originalFile;
    // Write on a very large file reports no originalFile; generic capture covers those.
    if (typeof original !== "string") { this.log(`no original for ${file}; left to capture`); return { root: store.root }; }

    const indexPath = `${store.dir}/index.json`, before = await readTextFile(indexPath);
    const index = before ? JSON.parse(before) : { version: 1, files: {} };
    if (index.files[rel]) {
      if (!index.files[rel].by) {
        Object.assign(index.files[rel], { by: terminal, as: asSeen });
        await writeTextFile(indexPath, JSON.stringify(index, null, 2) + "\n", before);
      }
      return { root: store.root };
    }
    await ensureDir(`${store.dir}/baselines`);
    const name = `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.txt`;
    await writeTextFile(`${store.dir}/baselines/${name}`, original, null);
    // `as`: the path as Claude wrote it (/mnt/c/... in WSL), so feedback names the file its way.
    index.files[rel] = { baseline: name, created, by: terminal, as: asSeen };
    await writeTextFile(indexPath, JSON.stringify(index, null, 2) + "\n", before);
    this.log(`claude ${terminal}: ${store.root} ${rel}${created ? " (new)" : ""}`);
    return { root: store.root, added: true };
  }
}

/**
 * Queues a message for the Claude in `terminal`; its hook passes it on as additionalContext
 * on the next tool call or prompt. Stored as one JSON string, ready for the hook to embed.
 */
export async function queueFeedback(terminal, text) {
  const dir = `${reviewDir()}/feedback`, path = `${dir}/${terminal}.ctx`;
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const before = await readTextFile(path);
  const lines = before ? JSON.parse(before).split("\n") : [];
  lines.push(text);
  await writeTextFile(path, JSON.stringify(lines.join("\n")), before);
}

/** Withdraws a queued message (an undone rejection) if the hook hasn't delivered it yet. */
export async function withdrawFeedback(terminal, text) {
  const path = `${reviewDir()}/feedback/${terminal}.ctx`, before = await readTextFile(path);
  if (!before) return;
  const lines = JSON.parse(before).split("\n").filter((l) => l !== text);
  if (lines.length) await writeTextFile(path, JSON.stringify(lines.join("\n")), before);
  else await fs.unlink(path).catch(() => {});
}

// ---- follow-up prompts (O2) and settings (O3) ------------------------------

/**
 * Queues a message to type into an agent's terminal as if the user sent it. The capture
 * leader delivers it once that agent isn't mid-turn, so it never interrupts work.
 */
export async function queuePrompt(terminal, text) {
  const dir = `${reviewDir()}/outbox`;
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const name = `${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}-${terminal}.json`;
  await writeTextFile(`${dir}/${name}`, JSON.stringify({ terminal, text }), null);
}

/** Delivers queued prompts to agents that are idle; `busy(terminal)` says who is mid-turn. */
export async function drainOutbox(busy, send, log) {
  const dir = `${reviewDir()}/outbox`;
  if (!(await fs.exists(dir))) return;
  for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    const path = `${dir}/${name}`;
    let msg;
    try { msg = JSON.parse(await readTextFile(path)); } catch { await fs.unlink(path).catch(() => {}); continue; }
    if (!terminals().some((t) => t.address === msg.terminal && t.state === "live")) {
      log(`prompt for ${msg.terminal} dropped: terminal is gone`);
      await fs.unlink(path).catch(() => {});
      continue;
    }
    if (busy(msg.terminal)) continue;
    const r = await send(msg.terminal, msg.text);
    log(`prompt to ${msg.terminal}: ${r.code === 0 ? "sent" : `failed ${(r.stderr || r.stdout).trim()}`}`);
    await fs.unlink(path).catch(() => {});
  }
}

const SETTINGS = () => `${reviewDir()}/settings.json`;
export async function loadSettings() {
  const t = await readTextFile(SETTINGS());
  return { autoNote: true, ...(t ? JSON.parse(t) : {}) };
}
export async function saveSettings(next) {
  await writeTextFile(SETTINGS(), JSON.stringify(next, null, 2) + "\n", await readTextFile(SETTINGS()));
}
