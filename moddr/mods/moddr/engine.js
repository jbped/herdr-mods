// One refresh, shared by the dialog and the status-bar badge: find sources for untracked mods,
// check every tracked one, save, tell the other copies, and notify about new updates.
//
// Copies coordinate through two shared values:
//   moddr.running  { at } while a copy refreshes. Another copy skips its refresh meanwhile.
//   moddr.summary  { at, updates: [names], tracked, error } after each refresh.
import { notify, setShared, shared } from "herdr";
import * as store from "./store.js";
import { check, discover, repoKey, repoOf, sourcesIn, state } from "./track.js";

export const RUNNING = "moddr.running";
export const SUMMARY = "moddr.summary";
const HOUR = 3600e3;
const RETRY_FIND = 7 * 24 * HOUR; // a mod with no source found is looked for again after this
const STALE_RUN = 20 * 60e3; // a running mark older than this is from a copy that went away

export const io = { fetch: (url, opts) => fetch(url, opts), files: (name) => store.files(name) };

/** moddr.json's settings with their defaults. */
export function settings(data) {
  const every = Number(data?.every_hours);
  return {
    every: Number.isFinite(every) ? (every <= 0 ? 0 : Math.max(1, every)) : 6,
    search: data?.search !== false,
    repos: (Array.isArray(data?.repos) ? data.repos : []).map(repoOf).filter(Boolean),
  };
}

/** True when another copy is refreshing now. */
export function busyElsewhere(mine) {
  const r = shared(RUNNING);
  return Boolean(r?.at) && !mine && Date.now() - r.at < STALE_RUN;
}

export class Ctx {
  constructor() {
    this.data = { mods: {} };
    this.names = [];
    this.readmes = {}; // name -> GitHub links in its README
    this.busy = new Set(); // mods being checked by this copy
    this.error = null; // the file or folder could not be read or written
    this.gh = null;
    this.running = false; // this copy is refreshing
    this.phase = null; // "finding" or "checking" while running
  }

  async load() {
    const { data, error } = await store.load();
    this.data = data;
    this.error = error;
    try { this.names = await store.localMods(); } catch (e) { this.error = `The mods folder could not be read: ${e?.message ?? e}`; }
    for (const n of this.names) if (!(n in this.readmes)) this.readmes[n] = sourcesIn(await store.readme(n));
  }

  async signIn() { this.gh = await store.ghToken(); }
  token() { return this.data.token || this.gh || null; }
  auth() { return this.data.token ? "token from moddr.json" : this.gh ? "signed in with gh" : "unsigned"; }
  entry(name) { return this.data.mods[name] ?? null; }
  tracked() { return this.names.filter((n) => this.entry(n)?.source); }
  untracked() { return this.names.filter((n) => !this.entry(n)?.source && !this.entry(n)?.ignored); }

  async persist(names) {
    try { await store.save(this.data, new Set(names)); } catch (e) { this.error = `moddr.json could not be saved: ${e?.message ?? e}`; }
  }

  /** True when the last refresh is older than the setting (an hour after one GitHub cut short). */
  due(now = Date.now()) {
    const { every } = settings(this.data);
    if (!every) return false;
    const last = this.data.lastRun;
    const wait = last?.error ? Math.min(every, 1) * HOUR : every * HOUR;
    return now - (Number(last?.at) || 0) >= wait;
  }

  /** Puts check()'s answer on the record. */
  apply(name, found) {
    const e = this.entry(name);
    if (!e?.source) return;
    if (found.error) { e.check = { ...(e.check ?? {}), at: Date.now(), error: found.error }; return; }
    e.installed = found.installed;
    e.check = { at: Date.now(), latest: found.latest, behind: found.behind, more: found.more, edited: found.edited, fp: found.fp, error: null };
  }

  /** Checks one tracked mod and saves it. Throws GitHub's rate limit so a refresh can stop. */
  async checkOne(name, onChange = () => {}) {
    const e = this.entry(name);
    if (!e?.source || this.busy.has(name)) return;
    this.busy.add(name);
    onChange();
    let found;
    try { found = await check(io, name, e, this.token()); } catch (err) {
      found = { error: String(err?.message ?? err) };
      if (err?.rate) { this.busy.delete(name); onChange(); throw err; }
    }
    this.busy.delete(name);
    this.apply(name, found);
    await this.persist([name]);
    onChange();
  }

  /** Looks for the sources of untracked mods. force: also the ones looked for in the last week. */
  async find({ force = false, onChange = () => {} } = {}) {
    const now = Date.now();
    const names = this.untracked().filter((n) => force || now - (Number(this.entry(n)?.discovered) || 0) >= RETRY_FIND);
    if (!names.length) return { checked: new Set(), stopped: null };
    const { search, repos: configured } = settings(this.data);
    const repos = [];
    const add = (r) => { if (r && !repos.some((x) => repoKey(x) === repoKey(r))) repos.push(r); };
    for (const n of this.names) for (const link of this.readmes[n] ?? []) add(repoOf(link));
    for (const n of this.tracked()) add(this.entry(n).source);
    for (const r of configured) add(r);

    const checked = new Set();
    const changed = new Set();
    const { tried, stopped } = await discover(io, names, repos, {
      token: this.token(),
      search,
      onResult: (name, { source, result, tracked }) => {
        const old = this.entry(name) ?? {};
        changed.add(name);
        if (tracked) {
          this.data.mods[name] = { ...old, source, installed: null, tracked: Date.now(), found: true, discovered: Date.now(), candidate: undefined };
          this.apply(name, result);
          checked.add(name);
        } else {
          this.data.mods[name] = { ...old, candidate: source, discovered: Date.now() };
        }
        onChange();
      },
    });
    for (const n of tried) {
      if (changed.has(n)) continue;
      this.data.mods[n] = { ...(this.entry(n) ?? {}), discovered: Date.now() };
      changed.add(n);
    }
    if (changed.size) await this.persist([...changed]);
    return { checked, stopped };
  }

  /**
   * A whole refresh: find sources, check every tracked mod not checked while finding, save, share
   * the summary, and notify about updates not notified before. Returns false when another copy
   * is refreshing.
   */
  async refresh({ force = false, onChange = () => {} } = {}) {
    if (this.running || busyElsewhere(false)) return false;
    this.running = true;
    setShared(RUNNING, { at: Date.now() });
    let stopped = null;
    try {
      await this.load();
      this.phase = "finding";
      onChange();
      let checked = new Set();
      try { ({ checked, stopped } = await this.find({ force, onChange })); } catch (e) { stopped = String(e?.message ?? e); }
      this.phase = "checking";
      onChange();
      if (!stopped) {
        for (const name of this.tracked()) {
          if (checked.has(name)) continue;
          try { await this.checkOne(name, onChange); } catch (e) { stopped = String(e?.message ?? e); break; }
        }
      }
      this.data.lastRun = { at: Date.now(), error: stopped };
      const fresh = this.tracked().filter((n) => state(this.entry(n)) === "updates" && this.entry(n).notified !== this.entry(n).check?.latest?.sha);
      for (const n of fresh) this.entry(n).notified = this.entry(n).check.latest.sha;
      await this.persist(fresh);
      if (fresh.length) {
        notify({
          title: fresh.length === 1 ? `${fresh[0]} has an update` : `${fresh.length} mods have updates`,
          body: fresh.join(", "),
          level: "info",
          action: { name: "mod.open", args: { name: "moddr" } },
        });
      }
    } finally {
      this.running = false;
      this.phase = null;
      setShared(RUNNING, null);
      this.share(stopped);
      onChange();
    }
    return true;
  }

  /** Tells every copy what the record says now. */
  share(error = this.data.lastRun?.error ?? null) {
    const updates = this.tracked().filter((n) => state(this.entry(n)) === "updates");
    setShared(SUMMARY, { at: Date.now(), updates, tracked: this.tracked().length, error });
  }
}
