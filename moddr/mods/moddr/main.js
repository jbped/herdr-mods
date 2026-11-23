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
import { checking, closeOverlay, props, run, shared, theme } from "herdr";
import { SEARCH, parseSource, resolve, sourceUrl, state } from "./track.js";
import { Ctx, RUNNING, SUMMARY, busyElsewhere, io, settings } from "./engine.js";
import { backups, openDrift, restore, update } from "./update.js";

const HALF_PAGE = 6;
const SHOWN_COMMITS = 8;
const BADGE_POLL = 10 * 60e3; // how often the badge asks whether a refresh is due
const BADGE_FIRST = 30e3; // the badge's first look, after Herdr has settled
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEYS = [
  ["j / k", "down / up"], ["g / G", "first / last"], ["r", "refresh"], ["f", "find sources again"],
  ["enter", "check this one"], ["u", "update"], ["d", "discuss drift with an agent"], ["s", "set source"],
  ["m", "mark installed"], ["z", "restore the last backup"], ["x", "stop tracking"], ["q", "close"],
];
const BADGE = {
  untracked: ["no source", "dim"],
  unchecked: ["not checked", "muted"],
  checking: ["checking", "accent"],
  error: ["error", "blocked"],
  unknown: ["unknown version", "working"],
  updates: ["update", "done"],
  edited: ["edited here", "working"],
  current: ["up to date", "idle"],
};

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
const repoText = (s) => `${s.owner}/${s.repo}${s.path ? ` · ${s.path}` : ""}`;

export default class Moddr extends View {
  init(_props, cx) {
    this.ctx = new Ctx();
    this.view = props()?.badge ? "badge" : "dialog";
    this.seen = 0; // the summary this copy last loaded
    if (this.view === "badge") return this.initBadge(cx);
    this.at = 0;
    this.help = false;
    this.editing = null; // the mod whose source is being typed
    this.editError = null;
    this.resolving = false;
    this.confirm = null; // { name, kind: "update" | "restore" } waiting for y
    this.op = null; // { name, kind, step, error } while files change or a drift space is prepared
    this.saved = {}; // name -> its backups, newest first
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "https://github.com/<owner>/<repo>/tree/<branch>/<folder>" });
    this.input.on("submit", (_e, cx) => this.saveSource(cx));
    this.input.on("change", (_e, cx) => { this.editError = null; cx.notify(); });
    this.handle.focus();
    cx.timer.after(600, () => { if (!this.editing) this.handle.focus(); });
    if (checking()) return;
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

  selected() { return this.ctx.names[this.at] ?? null; }

  async loadBackups() {
    for (const n of this.ctx.names) this.saved[n] = await backups(n);
  }

  /** u: asks first. Only a tracked mod with something to take. */
  askUpdate(name) {
    const e = this.ctx.entry(name);
    const s = state(e, this.ctx.busy.has(name));
    if (!e?.source || this.op || !["updates", "edited", "unknown"].includes(s)) return;
    this.confirm = { name, kind: "update" };
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
      if (k === "y" || k === "enter") this.change(cx, name, kind);
      else this.confirm = null;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    const last = Math.max(0, this.ctx.names.length - 1);
    const plain = !m.control && !m.alt && !m.platform;
    const shift = Boolean(m.shift);
    const name = this.selected();
    if (k === "escape" || (plain && !shift && k === "q")) this.close();
    else if (ev.keystroke === "ctrl-d") this.at = Math.min(last, this.at + HALF_PAGE);
    else if (ev.keystroke === "ctrl-u") this.at = Math.max(0, this.at - HALF_PAGE);
    else if (!plain) return;
    else if (k === "?" || (shift && k === "/")) this.help = !this.help;
    else if (k === "down" || (!shift && k === "j")) this.at = Math.min(last, this.at + 1);
    else if (k === "up" || (!shift && k === "k")) this.at = Math.max(0, this.at - 1);
    else if (k === "G" || (shift && k === "g") || k === "end") this.at = last;
    else if (k === "g" || k === "home") this.at = 0;
    else if (!shift && k === "r") this.refresh(cx);
    else if (!shift && k === "f") this.refresh(cx, true);
    else if (k === "enter") { if (name && this.ctx.entry(name)?.source) this.checkOne(name, cx); }
    else if (!shift && k === "u") this.askUpdate(name);
    else if (!shift && k === "d") this.discuss(cx, name);
    else if (!shift && k === "s") this.startEdit(name);
    else if (!shift && k === "m") this.markInstalled(name, cx);
    else if (!shift && k === "x") this.untrack(name, cx);
    else if (!shift && k === "z") this.askRestore(name);
    else return;
    this.scroll.scroll_to_item(this.at);
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
      .tooltip(`${tip}. Click to open Moddr (ctrl-shift-g)`)
      .on_click(() => run("mod.open", { name: "moddr" }))
      .child(running
        ? div().text_color(t.accent).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)
        : svg("mods/moddr/box.svg").size(14).flex_none().text_color(color))
      .when(updates.length > 0, (el) => el.child(div().child(String(updates.length))));
  }

  renderDialog(t) {
    const ctx = this.ctx;
    const names = ctx.names;
    this.at = Math.max(0, Math.min(this.at, names.length - 1));
    const tracked = ctx.tracked();
    const counts = {};
    for (const n of tracked) { const s = state(ctx.entry(n), ctx.busy.has(n)); counts[s] = (counts[s] ?? 0) + 1; }
    const elsewhere = !ctx.running && busyElsewhere(false);
    const lastAt = Number(ctx.data.lastRun?.at) || Math.max(0, ...tracked.map((n) => ctx.entry(n)?.check?.at ?? 0));
    const every = settings(ctx.data).every;
    const status = ctx.phase === "finding" ? "finding sources…" : ctx.phase === "checking" ? "checking…" : elsewhere ? "checking in the background…" : null;
    const summary = !names.length ? "" : [
      `${tracked.length} of ${names.length} tracked`,
      counts.updates ? `${counts.updates} with updates` : null,
      status ?? (lastAt ? `checked ${ago(lastAt)}` : null),
      every ? `every ${every}h` : "manual",
      ctx.auth(),
    ].filter(Boolean).join(" · ");
    const busy = ctx.running || elsewhere;

    const button = (id, label, on, enabled = true) =>
      div().id(id).flex_none().px(8).py(3).rounded(4).bg(t.raised).text_size(12)
        .text_color(enabled ? t.foreground : t.dim)
        .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { on(cx); cx.notify(); }))
        .child(label);

    const badge = (s, e) => {
      const [label, color] = BADGE[s];
      const n = e?.check?.behind?.length ?? 0;
      const text = s === "updates" ? `${n}${e.check.more ? "+" : ""} ${n === 1 && !e.check.more ? "update" : "updates"}` : label;
      return div().flex_none().px(6).py(1).rounded(4).border(1).border_color(t[color]).text_size(11).text_color(t[color]).child(text);
    };

    const details = (name, e, s) => {
      const c = e?.check;
      const lines = v_flex().gap(4).pt(6).text_size(12);
      const note = (text, color = t.muted) => div().text_color(color).child(text);
      if (s === "untracked") {
        if (e?.ignored) lines.child(note("Not tracked, and Moddr does not look for its source. Press s to set one."));
        else if (e?.candidate) lines.child(note(`${repoText(e.candidate)} has a mod of this name, but the files here match none of its recent versions. Press s to track it anyway.`));
        else if (e?.discovered) lines.child(note(`No source found ${ago(e.discovered)}. Press s to set one, or f to look again.`));
        else lines.child(note("Not looked for yet. Press r to look for its source, or s to set one."));
      }
      if (e?.source) lines.child(note(`${sourceUrl(e.source)}${e.found ? " (found by Moddr)" : ""}`, t.dim));
      if (c?.error) lines.child(note(c.error, t.blocked));
      if (s === "unknown") lines.child(note(`The files here match none of the last ${1 + SEARCH} versions upstream. Press m to count the newest as installed.`));
      if (c?.behind?.length) {
        lines.child(note(`New upstream since ${short(e.installed)}:`, t.foreground));
        for (const b of c.behind.slice(0, SHOWN_COMMITS)) {
          lines.child(h_flex().gap(8)
            .child(div().flex_none().w(52).text_color(t.dim).child(short(b.sha)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(b.message))
            .child(div().flex_none().text_color(t.dim).child(ago(b.date))));
        }
        const rest = c.behind.length - SHOWN_COMMITS;
        if (rest > 0 || c.more) lines.child(note(`and ${c.more ? "more" : rest} older`, t.dim));
      }
      if (c?.edited?.length) lines.child(note(e.installed ? `Changed here since ${short(e.installed)}: ${c.edited.join(", ")}` : `Differs from the newest upstream: ${c.edited.join(", ")}`, t.working));
      if (s === "current") lines.child(note(`At ${short(e.installed)}, the newest upstream (${ago(c.latest?.date)}).`));
      const saved = this.saved[name] ?? [];
      if (saved.length) lines.child(note(`Backup: ${saved[0].id}${saved.length > 1 ? ` and ${saved.length - 1} older` : ""}`, t.dim));
      const op = this.op?.name === name ? this.op : null;
      if (op?.step) lines.child(note(`${op.kind === "drift" ? "Preparing the drift space" : op.kind === "update" ? "Updating" : "Restoring"}: ${op.step}…`, t.accent));
      if (op?.error) lines.child(note(op.error, t.blocked));
      const ask = this.confirm?.name === name ? this.confirm.kind : null;
      if (ask === "update") {
        const edits = c?.edited ?? [];
        lines.child(v_flex().gap(4).p(8).rounded(4).border(1).border_color(edits.length ? t.working : t.accent).bg(t.raised)
          .child(note(`Update ${name} to ${short(c?.latest?.sha)}${c?.behind?.length ? `, bringing in ${c.behind.length}${c.more ? "+" : ""} commits` : ""}?`, t.foreground))
          .when(edits.length > 0, (el) => el.child(note(`This replaces your changes to ${edits.join(", ")}. Press d instead to talk them through with an agent.`, t.working)))
          .child(note("Your files are backed up first, and Restore puts them back. Press y to update, any other key to cancel.", t.muted))
          .child(h_flex().gap(6)
            .child(button(`moddr-yes-${name}`, "Update", (cx) => this.change(cx, name, "update")))
            .child(button(`moddr-no-${name}`, "Cancel", () => { this.confirm = null; }))));
      }
      if (ask === "restore") {
        lines.child(v_flex().gap(4).p(8).rounded(4).border(1).border_color(t.working).bg(t.raised)
          .child(note(`Put back the backup ${saved[0]?.id}? The files there now are backed up first. Press y to restore, any other key to cancel.`, t.foreground))
          .child(h_flex().gap(6)
            .child(button(`moddr-ryes-${name}`, "Restore", (cx) => this.change(cx, name, "restore")))
            .child(button(`moddr-rno-${name}`, "Cancel", () => { this.confirm = null; }))));
      }
      const canUpdate = Boolean(e?.source) && ["updates", "edited", "unknown"].includes(s) && name !== "moddr";
      const free = !this.op && !busy;
      lines.child(h_flex().gap(6).pt(2).flex_wrap()
        .when(canUpdate, (el) => el.child(button(`moddr-update-${name}`, "Update", () => this.askUpdate(name), free)))
        .when(Boolean(e?.source && c?.latest) && s !== "current", (el) => el.child(button(`moddr-drift-${name}`, "Discuss drift", (cx) => this.discuss(cx, name), free)))
        .when(saved.length > 0, (el) => el.child(button(`moddr-restore-${name}`, "Restore", () => this.askRestore(name), free))))
      lines.child(h_flex().gap(6).pt(2)
        .child(button(`moddr-set-${name}`, e?.source ? "Change source" : "Set source", () => this.startEdit(name)))
        .when(Boolean(e?.source), (el) => el
          .child(button(`moddr-check-${name}`, "Check", (cx) => this.checkOne(name, cx), !ctx.busy.has(name) && !busy))
          .when(s === "unknown", (el) => el.child(button(`moddr-mark-${name}`, "Mark installed", (cx) => this.markInstalled(name, cx))))
          .child(button(`moddr-untrack-${name}`, "Stop tracking", (cx) => this.untrack(name, cx)))));
      return lines;
    };

    const row = (name, i) => {
      const e = ctx.entry(name);
      const s = state(e, ctx.busy.has(name));
      const open = i === this.at;
      return v_flex()
        .id(`moddr-row-${name}`)
        .flex_none()
        .px(14)
        .py(8)
        .border_b(1)
        .border_color(t.border)
        .when(open, (el) => el.bg(t.selected))
        .when(!open, (el) => el.cursor_pointer().hover((x) => x.bg(t.hover)))
        .on_click((_ev, cx) => { if (!this.editing) { this.at = i; this.handle.focus(); cx.notify(); } })
        .child(h_flex().gap(10).items_center()
          .child(div().flex_none().font_semibold().text_size(13).child(name))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(e?.source ? repoText(e.source) : ""))
          .child(badge(s, e)))
        .when(open, (el) => el.child(details(name, e, s)));
    };

    const editor = this.editing
      ? v_flex().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border).bg(t.raised)
          .child(div().text_size(12).text_color(t.muted).child(`Source of ${this.editing}: a GitHub folder holding the mod or its share`))
          .child(h_flex().h(28).px(8).rounded(4).border(1).border_color(t.input).bg(t.background).items_center()
            .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
          .when(this.resolving, (el) => el.child(div().text_size(11.5).text_color(t.accent).child("Looking it up on GitHub…")))
          .when(Boolean(this.editError), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.editError)))
          .child(div().text_size(11).text_color(t.dim).child("enter saves · escape cancels"))
      : null;

    const runError = ctx.data.lastRun?.error;
    const key = (k, what) => h_flex().gap(5).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const legend = this.help
      ? h_flex().flex_none().flex_wrap().px(14).py(8).gap_x(16).gap_y(4).bg(t.raised).border_t(1).border_color(t.border).text_size(11)
          .children(KEYS.map(([k, what]) => key(k, what)))
      : h_flex().flex_none().h(28).px(14).gap(14).items_center().border_t(1).border_color(t.border).text_size(11)
          .child(key("j/k", "move")).child(key("r", "refresh")).child(key("u", "update")).child(key("d", "discuss drift")).child(key("s", "source")).child(key("?", "keys"));

    return v_flex()
      .id("moddr")
      .track_focus(this.handle)
      .on_key_down((ev, cx) => this.onKey(ev, cx))
      .size_full()
      .bg(t.popover)
      .text_color(t.foreground)
      .child(h_flex().flex_none().h(40).px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Mods"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(summary))
        .child(button("moddr-refresh", busy ? "Refreshing…" : "Refresh", (cx) => this.refresh(cx), !busy && names.length > 0)))
      .when(Boolean(ctx.error), (el) => el.child(
        div().flex_none().px(14).py(8).border_b(1).border_color(t.border).text_size(11.5).text_color(t.blocked).child(ctx.error)))
      .when(Boolean(runError) && !busy, (el) => el.child(
        div().flex_none().px(14).py(8).border_b(1).border_color(t.border).text_size(11.5).text_color(t.working).child(runError)))
      .when(Boolean(editor), (el) => el.child(editor))
      .child(names.length
        ? v_flex().id("moddr-rows").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(names.map(row))
        : v_flex().flex_1().items_center().justify_center().text_size(12).text_color(t.dim).child("No mods of your own in the mods folder."))
      .child(legend);
  }
}
