// Moddr: lists the mods in the mods folder, where each came from on GitHub, and whether its
// Source has changed since it was installed.
//
// Two views, chosen by props:
//   dialog  opened by mod.open moddr: the list, with keys.
//   badge   props { badge: true }: a status-bar block with the number of mods with updates. It
//           refreshes in the background when one is due.
// Both refresh through engine.js. The dialog also refreshes when it opens and one is due.
// The record is <appHome>/moddr.json (store.js). The comparison is track.js.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState, Input } from "gpui-base";
import { checking, closeOverlay, props, run, settings, shared, theme } from "herdr";
import { SEARCH, parseSource, resolve, sourceUrl, state } from "./track.js";
import { Ctx, RUNNING, SUMMARY, busyElsewhere, io, settings as settings_ } from "./engine.js";
import { backups, openDrift, restore, update } from "./update.js";
import { openUrl } from "./store.js";

const HALF_PAGE = 6;
const SHOWN_COMMITS = 8;
const BADGE_POLL = 10 * 60e3; // how often the badge asks whether a refresh is due
const BADGE_FIRST = 30e3; // the badge's first look, after Herdr has settled
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// The legend: [key, what]. KEYS is the list "?" shows; the footer line is built in render.
const KEYS = [
  ["j / k", "down / up"], ["g / G", "first / last"], ["ctrl-r", "refresh"], ["f", "find sources again"],
  ["] / [", "group by source / state"], ["enter", "check this one"], ["u", "update"], ["U", "update every mod with updates"], ["a", "discuss drift with an agent"],
  ["s", "set source"], ["o", "open the source in the browser"], ["m", "mark installed"], ["z", "restore the last backup"], ["x", "stop tracking"],
  ["q", "close"], ["?", "hide this list"],
];
const SORT = "moddr.sort"; // localStorage: "state" or "source"
const SECTIONS = [
  { key: "updates", title: "Updates" },
  { key: "attention", title: "Needs a look" },
  { key: "current", title: "Up to date" },
  { key: "untracked", title: "Not tracked" },
];

/** The list section a mod is in, from its saved state (a running check does not move it). */
function section(entry) {
  const s = state(entry);
  if (s === "updates") return "updates";
  if (s === "current") return "current";
  if (s === "untracked") return "untracked";
  return "attention";
}

/** The groups the list shows, in order, each { key, title, names }. By state: the SECTIONS. By
 *  source: one per repo, by name, then the mods with no source. */
function groups(names, entry, by) {
  if (by === "source") {
    const repos = new Map();
    const none = [];
    for (const n of names) {
      const src = entry(n)?.source;
      if (!src) { none.push(n); continue; }
      const k = `${src.owner}/${src.repo}`;
      if (!repos.has(k)) repos.set(k, []);
      repos.get(k).push(n);
    }
    const out = [...repos.keys()].sort((a, b) => a.localeCompare(b)).map((k) => ({ key: k, title: k, names: repos.get(k) }));
    if (none.length) out.push({ key: "none", title: "No source", names: none });
    return out;
  }
  return SECTIONS.map((g) => ({ ...g, names: names.filter((n) => section(entry(n)) === g.key) })).filter((g) => g.names.length);
}

function loadSort() {
  try { return localStorage.getItem(SORT) === "source" ? "source" : "state"; } catch { return "state"; }
}

/** "now", "5m", "3h", "2d", then "Nov 16". */
function ago(at, now = Date.now()) {
  if (!at) return "";
  const t = typeof at === "number" ? at : Date.parse(at);
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const short = (sha) => String(sha ?? "").slice(0, 7);

/** A backup's id, 20261123-191918-3ca957c, as "Nov 23, 19:19 · 3ca957c". */
function backupName(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}(?:-(.+))?$/.exec(String(id ?? ""));
  if (!m) return String(id ?? "");
  const label = { "before-restore": "before a restore", drift: "before a drift talk" }[m[6]] ?? m[6];
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[4]}:${m[5]}${label ? ` · ${label}` : ""}`;
}

export default class Moddr extends View {
  init(_props, cx) {
    this.ctx = new Ctx();
    this.view = props()?.badge ? "badge" : "dialog";
    this.seen = 0; // the summary this copy last loaded
    if (this.view === "badge") return this.initBadge(cx);
    this.sel = null; // the selected mod's name: rows move between sections as their state changes
    this.help = false;
    this.sort = loadSort(); // "state" or "source": how the list is grouped
    this.editing = null; // the mod whose source is being typed
    this.editError = null;
    this.resolving = false;
    this.confirm = null; // { name, kind: "update" | "restore" } or { kind: "all", names, skipped } waiting for y
    this.op = null; // { name, kind, step, error } while files change or a drift space is prepared
    this.batch = null; // U: { names, at, failed: [[name, error]], done } while and after it runs
    this.saved = {}; // name -> its backups, newest first
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "https://github.com/<owner>/<repo>/tree/<branch>/<folder>" });
    this.input.on("submit", (_e, cx) => this.saveSource(cx));
    this.input.on("change", (_e, cx) => { this.editError = null; cx.notify(); });
    this.handle.focus();
    if (checking()) return;
    cx.timer.after(600, () => { if (!this.editing) this.handle.focus(); });
    cx.spawn(async (cx) => {
      await this.ctx.load();
      await this.loadBackups();
      this.seen = shared(SUMMARY)?.at ?? 0;
      cx.notify();
      await this.ctx.signIn();
      cx.notify();
      if (this.ctx.due()) this.refresh(cx);
    });
    // Another copy (the badge) may refresh while this is open: load what it saved.
    cx.timer.every(3000, (cx) => {
      const at = shared(SUMMARY)?.at ?? 0;
      if (at > this.seen && !this.ctx.running) {
        this.seen = at;
        cx.spawn(async (cx) => { await this.ctx.load(); cx.notify(); });
      }
    });
  }

  initBadge(cx) {
    if (checking()) return;
    const tick = (cx) => cx.spawn(async (cx) => {
      if (this.ctx.running || busyElsewhere(false)) return;
      await this.ctx.load();
      if (!this.ctx.due()) { if (!shared(SUMMARY)) this.ctx.share(); return; }
      if (this.ctx.gh === null) await this.ctx.signIn();
      await this.ctx.refresh({ onChange: () => cx.notify() });
      this.seen = shared(SUMMARY)?.at ?? 0;
    });
    cx.timer.after(BADGE_FIRST, (cx) => tick(cx));
    cx.timer.every(BADGE_POLL, (cx) => tick(cx));
  }

  refresh(cx, force = false) {
    if (this.ctx.running || checking()) return;
    cx.spawn(async (cx) => {
      await this.ctx.refresh({ force, onChange: () => cx.notify() });
      this.seen = shared(SUMMARY)?.at ?? 0;
      cx.notify();
    });
  }

  checkOne(name, cx) {
    cx.spawn(async (cx) => {
      try { await this.ctx.checkOne(name, () => cx.notify()); } catch { /* the error is on the record */ }
      this.ctx.share();
      cx.notify();
    });
  }

  /** The mods in the order the list shows them: by section, then by name. */
  ordered() {
    return groups(this.ctx.names, (n) => this.ctx.entry(n), this.sort).flatMap((g) => g.names);
  }

  selected() {
    const list = this.ordered();
    return list.includes(this.sel) ? this.sel : list[0] ?? null;
  }

  /** Moves the selection by `by` rows, or to an end with Infinity. */
  move(by) {
    const list = this.ordered();
    if (!list.length) return;
    const at = Math.max(0, list.indexOf(this.selected()));
    this.sel = list[Math.max(0, Math.min(list.length - 1, at + by))];
  }

  async loadBackups() {
    for (const n of this.ctx.names) this.saved[n] = await backups(n);
  }

  /** u: asks first. Only a tracked mod with something to take. */
  askUpdate(name) {
    const e = this.ctx.entry(name);
    const s = state(e, this.ctx.busy.has(name));
    if (!e?.source || this.op || this.batch?.done === false || !["updates", "edited", "unknown"].includes(s)) return;
    this.confirm = { name, kind: "update" };
  }

  /** The mods U updates: updates waiting, no local edits, not Moddr itself. And the ones it leaves. */
  updatable() {
    const all = this.ctx.tracked().filter((n) => n !== "moddr" && state(this.ctx.entry(n), this.ctx.busy.has(n)) === "updates");
    const edited = (n) => (this.ctx.entry(n)?.check?.edited?.length ?? 0) > 0;
    return { names: all.filter((n) => !edited(n)), skipped: all.filter(edited) };
  }

  /** U: asks once, naming every mod it will update and every one it leaves. */
  askUpdateAll() {
    if (this.op || this.batch?.done === false) return;
    const { names, skipped } = this.updatable();
    if (!names.length) return;
    this.batch = null;
    this.confirm = { name: null, kind: "all", names, skipped };
  }

  /** Updates each mod in turn, a backup first, then checks it again. A failure does not stop the rest. */
  updateAll(cx, names) {
    this.confirm = null;
    this.batch = { names, at: 0, failed: [], done: false };
    cx.spawn(async (cx) => {
      const wait = (ms) => new Promise((done) => cx.timer.after(ms, () => done()));
      for (const [i, name] of names.entries()) {
        const e = this.ctx.entry(name);
        this.batch.at = i;
        this.op = { name, kind: "update", step: "Starting", error: null };
        cx.notify();
        try {
          await update(name, e, { wait, onStep: (step) => { this.op.step = step; cx.notify(); } });
        } catch (err) {
          this.batch.failed.push([name, String(err?.message ?? err)]);
        }
        this.op = null;
        this.saved[name] = await backups(name);
        if (e?.source) this.checkOne(name, cx);
      }
      this.batch.done = true;
      cx.notify();
    });
  }

  askRestore(name) {
    if (!this.saved[name]?.length || this.op) return;
    this.confirm = { name, kind: "restore" };
  }

  /** Runs an update or a restore, then checks the mod again. */
  change(cx, name, kind) {
    this.confirm = null;
    const e = this.ctx.entry(name);
    this.op = { name, kind, step: "Starting", error: null };
    cx.spawn(async (cx) => {
      const wait = (ms) => new Promise((done) => cx.timer.after(ms, () => done()));
      const onStep = (step) => { this.op.step = step; cx.notify(); };
      try {
        if (kind === "update") await update(name, e, { wait, onStep });
        else await restore(name, this.saved[name][0].dir, { wait, onStep });
        this.op = null;
      } catch (err) {
        this.op = { name, kind, step: null, error: String(err?.message ?? err) };
      }
      this.saved[name] = await backups(name);
      cx.notify();
      if (e?.source) this.checkOne(name, cx);
    });
  }

  /** d: a new space where an agent walks the person through the mod's drift. */
  discuss(cx, name) {
    const e = this.ctx.entry(name);
    if (!e?.source || !e.check?.latest || this.op) return;
    this.op = { name, kind: "drift", step: "Starting", error: null };
    cx.spawn(async (cx) => {
      try {
        await openDrift(name, e, { onStep: (step) => { this.op.step = step; cx.notify(); } });
        this.op = null;
        this.saved[name] = await backups(name);
        this.close();
      } catch (err) {
        this.op = { name, kind: "drift", step: null, error: String(err?.message ?? err) };
      }
      cx.notify();
    });
  }

  /** o: the source's GitHub folder in the browser, or the folder Moddr offered. */
  openSource(name) {
    const e = this.ctx.entry(name);
    const src = e?.source ?? e?.candidate;
    if (src) openUrl(sourceUrl(src));
  }

  startEdit(name) {
    if (!name) return;
    this.editing = name;
    this.editError = null;
    const e = this.ctx.entry(name);
    const guess = e?.source ?? e?.candidate;
    this.input.set_value(guess ? sourceUrl(guess) : (this.ctx.readmes[name]?.[0] ?? ""));
    this.input.focus();
  }

  stopEdit() {
    this.editing = null;
    this.editError = null;
    this.handle.focus();
  }

  /** Reads what was typed, finds the mod's folder in that repo, saves it and checks it. */
  saveSource(cx) {
    const name = this.editing;
    if (!name || this.resolving) return;
    let src;
    try { src = parseSource(this.input.value()); } catch (e) { this.editError = e.message; cx.notify(); return; }
    this.resolving = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        src = await resolve(io, src, name, this.ctx.token());
      } catch (e) {
        this.resolving = false;
        this.editError = String(e?.message ?? e);
        cx.notify();
        return;
      }
      this.resolving = false;
      const old = this.ctx.entry(name) ?? {};
      const same = old.source && sourceUrl(old.source) === sourceUrl(src);
      this.ctx.data.mods[name] = {
        ...old, source: src, installed: same ? old.installed ?? null : null, tracked: old.tracked ?? Date.now(),
        check: same ? old.check : null, ignored: undefined, candidate: undefined, found: undefined,
      };
      this.stopEdit();
      await this.ctx.persist([name]);
      this.checkOne(name, cx);
    });
  }

  /** Takes the newest upstream version as the installed one. Local differences then show as edits. */
  markInstalled(name, cx) {
    const e = this.ctx.entry(name);
    const latest = e?.check?.latest?.sha;
    if (!latest || this.ctx.busy.has(name)) return;
    e.installed = latest;
    e.check = null;
    cx.spawn(async (cx) => { await this.ctx.persist([name]); this.checkOne(name, cx); });
  }

  /** Stops tracking, and stops looking for its source: a found source would track it again. */
  untrack(name, cx) {
    if (!this.ctx.entry(name)?.source || this.ctx.busy.has(name)) return;
    this.ctx.data.mods[name] = { ignored: true };
    cx.spawn(async (cx) => { await this.ctx.persist([name]); this.ctx.share(); cx.notify(); });
  }


  close() {
    const id = props()?.overlay;
    if (id != null) closeOverlay(id);
  }

  onKey(ev, cx) {
    const m = ev.modifiers ?? {};
    const k = ev.key;
    if (this.editing) {
      if (k === "escape") { this.stopEdit(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (this.confirm) {
      const { name, kind } = this.confirm;
      if ((k === "y" || k === "enter") && kind === "all") this.updateAll(cx, this.confirm.names);
      else if (k === "y" || k === "enter") this.change(cx, name, kind);
      else this.confirm = null;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    const plain = !m.control && !m.alt && !m.platform;
    const shift = Boolean(m.shift);
    const name = this.selected();
    if (k === "escape" || (plain && !shift && k === "q")) this.close();
    else if (ev.keystroke === "ctrl-d") this.move(HALF_PAGE);
    else if (ev.keystroke === "ctrl-u") this.move(-HALF_PAGE);
    else if (ev.keystroke === "ctrl-r") this.refresh(cx);
    else if (!plain) return;
    else if (k === "?" || (shift && k === "/")) this.help = !this.help;
    else if (k === "down" || (!shift && k === "j")) this.move(1);
    else if (k === "up" || (!shift && k === "k")) this.move(-1);
    else if (k === "G" || (shift && k === "g") || k === "end") this.move(Infinity);
    else if (k === "g" || k === "home") this.move(-Infinity);
    else if (!shift && k === "f") this.refresh(cx, true);
    else if (!shift && (k === "]" || k === "[")) {
      this.sort = this.sort === "source" ? "state" : "source";
      try { localStorage.setItem(SORT, this.sort); } catch { /* remembered for this session only */ }
    }
    else if (k === "enter") { if (name && this.ctx.entry(name)?.source) this.checkOne(name, cx); }
    else if (!shift && k === "u") this.askUpdate(name);
    else if (k === "U" || (shift && k === "u")) this.askUpdateAll();
    else if (!shift && k === "a") this.discuss(cx, name);
    else if (!shift && k === "s") this.startEdit(name);
    else if (!shift && k === "o") this.openSource(name);
    else if (!shift && k === "m") this.markInstalled(name, cx);
    else if (!shift && k === "x") this.untrack(name, cx);
    else if (!shift && k === "z") this.askRestore(name);
    else return;
    this.sel = this.selected();
    if (this.rowIndex != null) this.scroll.scroll_to_item(this.rowIndex(this.sel));
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    return this.view === "badge" ? this.renderBadge(t) : this.renderDialog(t);
  }

  /** The status-bar block. props { bare: true } drops its background and top border. */
  renderBadge(t) {
    const p = props() ?? {};
    const sum = shared(SUMMARY);
    const updates = Array.isArray(sum?.updates) ? sum.updates : [];
    const running = this.ctx.running || Boolean(shared(RUNNING)?.at);
    const color = updates.length ? t.done : sum?.error ? t.working : t.muted;
    const tip = running ? "Moddr is checking your mods"
      : updates.length ? `Updates: ${updates.join(", ")}`
      : sum?.error ? sum.error
      : sum ? `${sum.tracked} tracked mods, none with updates. Checked ${ago(sum.at)}`
      : "Moddr has not checked yet";
    return h_flex()
      .id("moddr-badge")
      .size_full()
      .gap(5)
      .items_center()
      .justify_center()
      .when(!p.bare, (el) => el.bg(t.chrome).border_t(1).border_color(t.border))
      .text_size(11.8)
      .text_color(color)
      .cursor_pointer()
      .hover((x) => x.text_color(t.foreground))
      .tooltip(`${tip}. Click to open Moddr (ctrl-shift-u)`)
      .on_click(() => run("mod.open", { name: "moddr" }))
      .child(running
        ? div().text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)
        : svg("mods/moddr/box.svg").size(14).flex_none().text_color(color))
      .when(updates.length > 0, (el) => el.child(div().child(String(updates.length))));
  }

  renderDialog(t) {
    const ctx = this.ctx;
    const mono = String(settings()?.font ?? "") || "JetBrains Mono";
    const elsewhere = !ctx.running && busyElsewhere(false);
    const busy = ctx.running || elsewhere;
    const free = !this.op && !busy && !(this.batch && !this.batch.done);
    const sel = this.selected();
    const tracked = ctx.tracked();
    const updates = tracked.filter((n) => state(ctx.entry(n)) === "updates").length;
    const lastAt = Number(ctx.data.lastRun?.at) || 0;
    const every = settings_(ctx.data).every;

    // ---- small parts ----
    const text = (s, size, color) => div().text_size(size).text_color(color).child(s);
    const keyHint = (k) => div().text_size(10.5).text_color(t.dim).font_family(mono).child(k);
    const button = (id, label, on, { key: k = null, primary = false, enabled = true } = {}) =>
      h_flex().id(id).flex_none().h(26).px(10).gap(6).items_center().rounded(5).text_size(12)
        .when(primary, (el) => el.bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim))
        .when(!primary, (el) => el.border(1).border_color(t.border).text_color(enabled ? t.foreground : t.dim))
        .when(enabled, (el) => el.cursor_pointer()
          .hover((x) => (primary ? x.opacity(0.9) : x.bg(t.hover)))
          .on_click((_e, cx) => { on(cx); cx.notify(); }))
        .child(label)
        .when(Boolean(k), (el) => el.child(div().text_size(10.5).font_family(mono).text_color(primary && enabled ? t.solid_foreground : t.dim).opacity(primary ? 0.7 : 1).child(k)));
    // ---- a row ----
    const STATUS = {
      untracked: ["no source", t.dim], unchecked: ["not checked", t.muted], checking: ["checking…", t.accent],
      error: ["error", t.blocked], unknown: ["unknown version", t.working], edited: ["edited here", t.working], current: ["up to date", t.dim],
    };
    const status = (s, e) => {
      if (s === "updates") {
        const n = e.check.behind.length;
        return [`${n}${e.check.more ? "+" : ""} ${n === 1 && !e.check.more ? "update" : "updates"}`, t.done];
      }
      return STATUS[s];
    };

    const details = (name, e, s) => {
      const c = e?.check;
      const box = v_flex().gap(8).pt(6);
      const op = this.op?.name === name ? this.op : null;
      const ask = this.confirm?.name === name ? this.confirm.kind : null;
      const saved = this.saved[name] ?? [];
      const edits = c?.edited ?? [];

      // One line saying why, only when the state is not obvious from the commits.
      const why = s === "untracked"
        ? (e?.ignored ? "Not tracked. Moddr won't look for its source."
          : e?.candidate ? `${e.candidate.owner}/${e.candidate.repo} has a ${name} folder, but no version matches your files.`
          : e?.discovered ? `No source found ${ago(e.discovered)} ago.` : "Not looked for yet.")
        : s === "unknown" ? `Your files match none of the last ${1 + SEARCH} upstream versions.`
        : s === "unchecked" ? "Not checked yet."
        : null;
      if (why) box.child(text(why, 12, t.muted));
      if (c?.error) box.child(text(c.error, 12, t.blocked));

      // New commits.
      if (c?.behind?.length) {
        const list = v_flex().gap(3);
        for (const b of c.behind.slice(0, SHOWN_COMMITS)) {
          list.child(h_flex().gap(10).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(b.message))
            .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(b.date))));
        }
        const rest = c.behind.length - SHOWN_COMMITS;
        if (rest > 0 || c.more) list.child(text(`and ${c.more ? "more" : rest} older`, 11, t.dim));
        box.child(list);
      }

      // Files changed here, as one line.
      if (edits.length) {
        const shown = edits.slice(0, 4).join(", ") + (edits.length > 4 ? ` and ${edits.length - 4} more` : "");
        box.child(text(`${e.installed ? "You changed" : "Differs in"} ${shown}`, 12, t.working));
      }

      // Progress, a question, or the actions.
      if (op?.step) {
        box.child(h_flex().gap(8).items_center().text_size(12).text_color(t.accent)
          .child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
          .child(`${op.kind === "drift" ? "Preparing the drift space" : op.kind === "update" ? "Updating" : "Restoring"} · ${op.step}`));
        return box;
      }
      if (op?.error) box.child(text(op.error, 12, t.blocked));
      if (ask) {
        const q = ask === "update"
          ? `${edits.length ? `Replace your changes to ${edits.length} ${edits.length === 1 ? "file" : "files"}?` : `Update ${name}?`} A backup is kept.`
          : `Put back the backup from ${backupName(saved[0]?.id)}? A backup is kept.`;
        box.child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(12).text_color(edits.length && ask === "update" ? t.working : t.foreground).child(q))
          .child(button(`moddr-yes-${name}`, ask === "update" ? "Update" : "Restore", (cx) => this.change(cx, name, ask), { key: "y", primary: true }))
          .child(button(`moddr-no-${name}`, "Cancel", () => { this.confirm = null; }, { key: "n" })));
        return box;
      }

      // At most two buttons, the first solid. Every other action is a key, listed under ?.
      const self = name === "moddr";
      const acts = [];
      if (s === "updates" && !self) acts.push(["update", "Update", () => this.askUpdate(name), "u"]);
      if (edits.length || s === "unknown") acts.push(["drift", "Discuss drift", (cx) => this.discuss(cx, name), "a"]);
      if (s === "unknown") acts.push(["mark", "Mark installed", (cx) => this.markInstalled(name, cx), "m"]);
      if (s === "untracked") acts.push(["set", "Set source", () => this.startEdit(name), "s"]);
      if (s === "error" || s === "unchecked") acts.push(["check", "Check", (cx) => this.checkOne(name, cx), "enter"]);
      const ver = !e?.installed ? ""
        : c?.latest && c.latest.sha !== e.installed ? `${short(e.installed)} → ${short(c.latest.sha)}`
        : `${short(e.installed)}${c?.latest?.date ? ` · ${ago(c.latest.date)} old` : ""}`;
      const src = e?.source ?? e?.candidate;
      const repo = src && !(e?.source && this.sort === "source") ? `${src.owner}/${src.repo}` : "GitHub";
      // The repo (or "GitHub" when the heading names it) opens the source in the browser, like o.
      const open = src
        ? h_flex().id(`moddr-open-${name}`).flex_none().gap(5).items_center().text_color(t.muted).cursor_pointer()
          .hover((x) => x.text_color(t.foreground)).tooltip(sourceUrl(src)).on_click(() => this.openSource(name))
          .child(repo).child(svg("mods/moddr/external.svg").size(10).text_color(t.dim)).child(div().text_color(t.dim).child("o"))
        : null;
      if (!acts.length && !src && !ver) return box;
      box.child(h_flex().pt(2).gap(6).items_center()
        .children(acts.slice(0, 2).map(([id, label, on, k], i) => button(`moddr-${id}-${name}`, label, on, { key: k, primary: i === 0, enabled: free })))
        .child(h_flex().flex_1().min_w(0).justify_end().gap(10).items_center().text_size(11).font_family(mono)
          .when(Boolean(ver), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(ver)))
          .when(Boolean(open), (el) => el.child(open))));
      return box;
    };

    const row = (name) => {
      const e = ctx.entry(name);
      const s = state(e, ctx.busy.has(name));
      const [label, color] = status(s, e);
      const open = name === sel;
      // Up to date and not tracked rows need no word: their section says it.
      const quiet = this.sort === "state" && (s === "current" || s === "untracked");
      return v_flex()
        .id(`moddr-row-${name}`)
        .flex_none()
        .mx(6)
        .px(10)
        .py(7)
        .rounded(6)
        .when(open, (el) => el.bg(t.selected).pb(10))
        .when(!open, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover)))
        .on_click((_ev, cx) => { if (!this.editing) { this.sel = name; this.confirm = null; this.handle.focus(); cx.notify(); } })
        .child(h_flex().gap(10).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(quiet && !open ? t.muted : t.foreground).child(name))
          .when(!quiet, (el) => el.child(div().flex_none().text_size(12).text_color(color).child(label))))
        .when(open, (el) => el.child(details(name, e, s)));
    };

    // ---- sections ----
    const children = [];
    const index = {};
    for (const g of groups(ctx.names, (n) => ctx.entry(n), this.sort)) {
      const names = g.names;
      const all = g.key === "updates" && this.sort === "state" && this.updatable().names.length >= 2;
      children.push(h_flex().flex_none().px(16).pt(children.length ? 14 : 10).pb(4).gap(6).items_center()
        .child(div().text_size(11).font_semibold().text_color(t.muted).child(g.title))
        .child(div().text_size(11).text_color(t.dim).child(String(names.length)))
        .when(all, (el) => el.child(div().flex_1()).child(h_flex().id("moddr-update-all").flex_none().gap(5).items_center().text_size(11)
          .text_color(free ? t.muted : t.dim)
          .when(free, (x) => x.cursor_pointer().hover((y) => y.text_color(t.foreground)).on_click((_e, cx) => { this.askUpdateAll(); cx.notify(); }))
          .child("Update all").child(keyHint("U")))));
      // The first row of a section scrolls to its heading, so the heading stays in view.
      names.forEach((n, i) => { index[n] = i === 0 ? children.length - 1 : children.length; children.push(row(n)); });
    }
    children.push(div().flex_none().h(8));
    this.rowIndex = (n) => index[n] ?? 0;

    // ---- source editor ----
    const editor = this.editing
      ? v_flex().flex_none().mx(12).mt(10).p(10).gap(6).rounded(6).bg(t.raised).border(1).border_color(t.border)
          .child(text(`Source of ${this.editing}`, 12, t.foreground))
          .child(h_flex().h(28).px(8).rounded(4).border(1).border_color(t.input).bg(t.background).items_center()
            .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
          .child(text(this.resolving ? "Looking it up on GitHub…" : this.editError ?? "A GitHub folder that holds the mod, or its share. enter saves, escape cancels.",
            11.5, this.resolving ? t.accent : this.editError ? t.blocked : t.dim))
      : null;

    // ---- header ----
    const when = lastAt ? `checked ${ago(lastAt)} ago`.replace("now ago", "just now") : "not checked yet";
    const sub = busy
      ? div().text_color(t.accent).child(ctx.phase === "finding" ? "Finding sources…" : "Checking…")
      : h_flex().gap(6)
        .when(updates > 0, (el) => el.child(div().text_color(t.done).child(`${updates} with ${updates === 1 ? "an update" : "updates"}`)).child(div().text_color(t.dim).child("·")))
        .child(div().text_color(t.dim).child(when));
    const header = h_flex().flex_none().h(52).px(16).gap(10).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().font_semibold().text_size(14).child("Mods"))
        .child(div().text_size(11.5).child(sub)))
      .child(h_flex().id("moddr-refresh").flex_none().gap(6).items_center().text_size(12)
        .text_color(busy ? t.accent : t.muted)
        .when(!busy && ctx.names.length > 0, (el) => el.cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click((_e, cx) => { this.refresh(cx); cx.notify(); }))
        .child(busy ? div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90) : svg("mods/moddr/refresh.svg").size(13).text_color(t.muted))
        .when(!busy, (el) => el.child("Refresh").child(keyHint("ctrl-r"))));

    // ---- banners ----
    const runError = !busy ? ctx.data.lastRun?.error : null;
    const banner = (msg, color) => h_flex().flex_none().mx(12).mt(10).px(10).py(7).gap(8).items_start().rounded(6).bg(t.raised)
      .child(div().flex_none().mt(5).size(6).rounded(3).bg(color))
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child(msg));

    // ---- update all: the question, then progress, then what happened ----
    const list = (ns) => ns.length > 3 ? `${ns.slice(0, 3).join(", ")} and ${ns.length - 3} more` : ns.join(", ");
    const ask = this.confirm?.kind === "all" ? this.confirm : null;
    const b = this.batch;
    const allBox = ask
      ? v_flex().flex_none().mx(12).mt(10).p(10).gap(6).rounded(6).bg(t.raised).border(1).border_color(t.border)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(`Update ${ask.names.length} mods: ${list(ask.names)}? A backup of each is kept.`))
          .child(button("moddr-all-yes", "Update all", (cx) => this.updateAll(cx, ask.names), { key: "y", primary: true }))
          .child(button("moddr-all-no", "Cancel", () => { this.confirm = null; }, { key: "n" })))
        .when(ask.skipped.length > 0, (el) => el.child(text(`Leaves ${list(ask.skipped)}: changed here. a on a mod talks its changes through with an agent.`, 11.5, t.working)))
      : b && !b.done
        ? h_flex().flex_none().mx(12).mt(10).px(10).py(7).gap(8).items_center().rounded(6).bg(t.raised).text_size(12).text_color(t.accent)
          .child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90))
          .child(`Updating ${b.at + 1} of ${b.names.length} · ${b.names[b.at]}${this.op?.step ? ` · ${this.op.step}` : ""}`)
        : b?.done
          ? h_flex().flex_none().mx(12).mt(10).px(10).py(7).gap(8).items_center().rounded(6).bg(t.raised).text_size(11.5)
            .child(div().flex_none().size(6).rounded(3).bg(b.failed.length ? t.blocked : t.done))
            .child(div().flex_1().min_w(0).text_color(t.muted).child(b.failed.length
              ? `Updated ${b.names.length - b.failed.length} of ${b.names.length}. ${b.failed.map(([n, err]) => `${n}: ${err}`).join(" · ")}`
              : `Updated ${b.names.length} mods. A backup of each is kept.`))
            .child(div().id("moddr-all-done").flex_none().text_color(t.dim).cursor_pointer().hover((x) => x.text_color(t.foreground))
              .on_click((_e, cx) => { this.batch = null; cx.notify(); }).child("✕"))
          : null;

    // ---- footer ----
    const hint = ([k, what]) => h_flex().flex_none().gap(5).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const core = [["j/k", "move"], ["o", "open source"], ["] / [", this.sort === "source" ? "by state" : "by source"], ["?", "keys"]];
    const keyList = h_flex().flex_none().flex_wrap().px(12).py(8).gap_x(16).gap_y(4).bg(t.raised).border_t(1).border_color(t.border).text_size(11)
      .children(KEYS.map(hint));
    const footer = h_flex().flex_none().h(28).px(12).gap(12).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(h_flex().flex_1().min_w(0).gap(14).items_center().overflow_hidden().children(this.help ? [] : core.map(hint)))
      .child(div().flex_none().child(`${every ? `every ${every}h` : "manual"} · ${ctx.auth()}`));

    return v_flex()
      .id("moddr")
      .track_focus(this.handle)
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .size_full()
      .bg(t.popover)
      .text_color(t.foreground)
      .child(header)
      .when(Boolean(ctx.error), (el) => el.child(banner(ctx.error, t.blocked)))
      .when(Boolean(runError), (el) => el.child(banner(runError, t.working)))
      .when(Boolean(editor), (el) => el.child(editor))
      .when(Boolean(allBox), (el) => el.child(allBox))
      .child(ctx.names.length
        ? v_flex().id("moddr-rows").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(children)
        : v_flex().flex_1().items_center().justify_center().text_size(12).text_color(t.dim).child("No mods of your own in the mods folder."))
      .when(this.help, (el) => el.child(keyList))
      .child(footer);
  }
}
