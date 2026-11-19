// Moddr: lists the mods in the mods folder, where each came from on GitHub, and whether its
// Source has changed since it was installed. Opened as a dialog (mod.open moddr).
//
// Nothing is checked on its own: Refresh (r) checks every tracked mod, one at a time.
// The record is <appHome>/moddr.json (store.js). The comparison is track.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState, Input } from "gpui-base";
import { checking, closeOverlay, notify, props, theme } from "herdr";
import { SEARCH, check, parseSource, resolve, sourcesIn, sourceUrl, state } from "./track.js";
import * as store from "./store.js";

const HALF_PAGE = 6;
const SHOWN_COMMITS = 8;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KEYS = [
  ["j / k", "down / up"], ["g / G", "first / last"], ["r", "refresh all"], ["enter", "refresh this one"],
  ["s", "set source"], ["m", "mark installed"], ["x", "stop tracking"], ["q", "close"],
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
const io = { fetch: (url, opts) => fetch(url, opts), files: (name) => store.files(name) };

export default class Moddr extends View {
  init(_props, cx) {
    this.names = [];
    this.data = { mods: {} };
    this.fileError = null;
    this.at = 0;
    this.help = false;
    this.busy = new Set();
    this.refreshing = false;
    this.editing = null; // the mod whose source is being typed
    this.editError = null;
    this.suggest = {}; // name -> GitHub links in its README
    this.gh = null; // gh's token, looked up once when the dialog opens
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "https://github.com/<owner>/<repo>/tree/<branch>/<folder>" });
    this.input.on("submit", (_e, cx) => this.saveSource(cx));
    this.input.on("change", (_e, cx) => { this.editError = null; cx.notify(); });
    this.handle.focus();
    cx.timer.after(600, () => { if (!this.editing) this.handle.focus(); });
    if (checking()) return;
    cx.spawn(async (cx) => { await this.reload(); cx.notify(); this.gh = await store.ghToken(); cx.notify(); });
  }

  /** moddr.json's token, else gh's, else none (unsigned requests). */
  token() { return this.data.token || this.gh || null; }
  auth() { return this.data.token ? "token from moddr.json" : this.gh ? "signed in with gh" : "unsigned"; }

  async reload() {
    const { data, error } = await store.load();
    this.data = data;
    this.fileError = error;
    try { this.names = await store.localMods(); } catch (e) { this.fileError = `The mods folder could not be read: ${e?.message ?? e}`; }
    for (const n of this.names) if (!(n in this.suggest)) this.suggest[n] = sourcesIn(await store.readme(n));
  }

  entry(name) { return this.data.mods[name] ?? null; }
  tracked() { return this.names.filter((n) => this.entry(n)?.source); }
  selected() { return this.names[this.at] ?? null; }

  async persist(name) {
    try { await store.save(this.data, new Set([name])); } catch (e) { this.fileError = `moddr.json could not be saved: ${e?.message ?? e}`; }
  }

  /** Checks one mod against its Source and saves what was found. */
  async checkOne(name, cx) {
    const e = this.entry(name);
    if (!e?.source || this.busy.has(name)) return;
    this.busy.add(name);
    cx.notify();
    let found;
    try { found = await check(io, name, e, this.token()); } catch (err) { found = { error: String(err?.message ?? err) }; }
    this.busy.delete(name);
    const now = this.entry(name);
    if (!now?.source) { cx.notify(); return; } // untracked meanwhile
    if (found.error) now.check = { ...(now.check ?? {}), at: Date.now(), error: found.error };
    else {
      now.installed = found.installed;
      now.check = { at: Date.now(), latest: found.latest, behind: found.behind, more: found.more, edited: found.edited, error: null };
    }
    await this.persist(name);
    cx.notify();
  }

  refreshAll(cx) {
    if (this.refreshing || checking()) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      await this.reload();
      for (const name of this.tracked()) await this.checkOne(name, cx);
      this.refreshing = false;
      const updated = this.tracked().filter((n) => state(this.entry(n)) === "updates");
      if (updated.length) {
        notify({
          title: updated.length === 1 ? `${updated[0]} has an update` : `${updated.length} mods have updates`,
          body: updated.join(", "),
          level: "info",
          action: { name: "mod.open", args: { name: "moddr" } },
        });
      }
      cx.notify();
    });
  }

  startEdit(name) {
    if (!name) return;
    this.editing = name;
    this.editError = null;
    const e = this.entry(name);
    this.input.set_value(e?.source ? sourceUrl(e.source) : (this.suggest[name]?.[0] ?? ""));
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
    if (!name || this.busy.has(name)) return;
    let src;
    try { src = parseSource(this.input.value()); } catch (e) { this.editError = e.message; cx.notify(); return; }
    this.busy.add(name);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        src = await resolve(io, src, name, this.token());
      } catch (e) {
        this.busy.delete(name);
        this.editError = String(e?.message ?? e);
        cx.notify();
        return;
      }
      this.busy.delete(name);
      const old = this.entry(name);
      const same = old?.source && sourceUrl(old.source) === sourceUrl(src);
      this.data.mods[name] = { ...(old ?? {}), source: src, installed: same ? old.installed ?? null : null, tracked: old?.tracked ?? Date.now(), check: same ? old.check : null };
      this.stopEdit();
      await this.persist(name);
      await this.checkOne(name, cx);
    });
  }

  /** Takes the newest upstream version as the installed one. Local differences then show as edits. */
  markInstalled(name, cx) {
    const e = this.entry(name);
    const latest = e?.check?.latest?.sha;
    if (!latest || this.busy.has(name)) return;
    e.installed = latest;
    e.check = null;
    cx.spawn(async (cx) => { await this.persist(name); await this.checkOne(name, cx); });
  }

  untrack(name, cx) {
    if (!this.entry(name) || this.busy.has(name)) return;
    delete this.data.mods[name];
    cx.spawn(async (cx) => { await this.persist(name); cx.notify(); });
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
    const last = Math.max(0, this.names.length - 1);
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
    else if (!shift && k === "r") this.refreshAll(cx);
    else if (k === "enter") { if (name) cx.spawn(async (cx) => this.checkOne(name, cx)); }
    else if (!shift && k === "s") this.startEdit(name);
    else if (!shift && k === "m") this.markInstalled(name, cx);
    else if (!shift && k === "x") this.untrack(name, cx);
    else return;
    this.scroll.scroll_to_item(this.at);
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    this.at = Math.max(0, Math.min(this.at, this.names.length - 1));
    const tracked = this.tracked();
    const counts = {};
    for (const n of tracked) { const s = state(this.entry(n), this.busy.has(n)); counts[s] = (counts[s] ?? 0) + 1; }
    const lastAt = Math.max(0, ...tracked.map((n) => this.entry(n)?.check?.at ?? 0));
    const summary = !this.names.length ? "" : [
      `${tracked.length} of ${this.names.length} tracked`,
      counts.updates ? `${counts.updates} with updates` : null,
      lastAt ? `checked ${ago(lastAt)}` : null,
      this.auth(),
    ].filter(Boolean).join(" · ");

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
        const sug = this.suggest[name] ?? [];
        lines.child(note(sug.length ? `Its README links ${sug[0]}. Press s to use it or type another.` : "Press s and paste the GitHub folder it was installed from."));
      }
      if (e?.source) lines.child(note(sourceUrl(e.source), t.dim));
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
      lines.child(h_flex().gap(6).pt(2)
        .child(button(`moddr-set-${name}`, e?.source ? "Change source" : "Set source", () => this.startEdit(name)))
        .when(Boolean(e?.source), (el) => el
          .child(button(`moddr-check-${name}`, "Check", (cx) => cx.spawn(async (cx) => this.checkOne(name, cx)), !this.busy.has(name)))
          .when(s === "unknown", (el) => el.child(button(`moddr-mark-${name}`, "Mark installed", (cx) => this.markInstalled(name, cx))))
          .child(button(`moddr-untrack-${name}`, "Stop tracking", (cx) => this.untrack(name, cx)))));
      return lines;
    };

    const row = (name, i) => {
      const e = this.entry(name);
      const s = state(e, this.busy.has(name));
      const src = e?.source ? `${e.source.owner}/${e.source.repo}${e.source.path ? ` · ${e.source.path}` : ""}` : "";
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
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(src))
          .child(badge(s, e)))
        .when(open, (el) => el.child(details(name, e, s)));
    };

    const editor = this.editing
      ? v_flex().flex_none().px(14).py(8).gap(6).border_b(1).border_color(t.border).bg(t.raised)
          .child(div().text_size(12).text_color(t.muted).child(`Source of ${this.editing}: a GitHub folder holding the mod or its share`))
          .child(h_flex().h(28).px(8).rounded(4).border(1).border_color(t.input).bg(t.background).items_center()
            .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
          .when(this.busy.has(this.editing), (el) => el.child(div().text_size(11.5).text_color(t.accent).child("Looking it up on GitHub…")))
          .when(Boolean(this.editError), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.editError)))
          .child(div().text_size(11).text_color(t.dim).child("enter saves · escape cancels"))
      : null;

    const key = (k, what) => h_flex().gap(5).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const legend = this.help
      ? h_flex().flex_none().flex_wrap().px(14).py(8).gap_x(16).gap_y(4).bg(t.raised).border_t(1).border_color(t.border).text_size(11)
          .children(KEYS.map(([k, what]) => key(k, what)))
      : h_flex().flex_none().h(28).px(14).gap(14).items_center().border_t(1).border_color(t.border).text_size(11)
          .child(key("j/k", "move")).child(key("r", "refresh")).child(key("s", "source")).child(key("m", "mark installed")).child(key("?", "keys"));

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
        .child(button("moddr-refresh", this.refreshing ? "Refreshing…" : "Refresh", (cx) => this.refreshAll(cx), !this.refreshing && tracked.length > 0)))
      .when(Boolean(this.fileError), (el) => el.child(
        div().flex_none().px(14).py(8).border_b(1).border_color(t.border).text_size(11.5).text_color(t.blocked).child(this.fileError)))
      .when(Boolean(editor), (el) => el.child(editor))
      .child(this.names.length
        ? v_flex().id("moddr-rows").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(this.names.map(row))
        : v_flex().flex_1().items_center().justify_center().text_size(12).text_color(t.dim).child("No mods of your own in the mods folder."))
      .child(legend);
  }
}
