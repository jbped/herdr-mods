// Vaultr: reads an Obsidian vault inside Herdr. The folder tree and a name search on the left,
// the note on the right. Wikilinks open in place, embedded images draw, backlinks are listed, and
// the note follows the file as Obsidian or an agent writes it. It never writes to the vault.
// The vault folder is shared state ("vaultr.vault"), one of the saved vaults ("vaultr.vaults"),
// or props { vault, note? } for one copy.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input, ScrollHandle } from "gpui-base";
import { props, theme, appHome, watchFolder, checking, nextCommand, shared, setShared, pickFolder, closeOverlay } from "herdr";
import * as fs from "fs/promises";
import { splitFrontmatter, transform, parseLink, linkTargets, splitTarget, headingKey, isImage } from "./md.js";
import { slash, base, stem, isNote, order, ancestors, makeIndex, resolve, rows, vaultKey, vaultList, nextVault } from "./vault.js";
import { openExternal, copyFile, fileUrl } from "./platform.js";

const VAULT = "vaultr.vault";   // shared: every copy reads the same vault
const VAULTS = "vaultr.vaults"; // shared: the vaults to switch between
const NARROW = 620;           // below this width the list and the note take turns
const ROW_H = 24;
// The legend: [key, what]. CORE is the footer line, KEYS the list "?" shows.
const CORE = [["j/k", "move"], ["enter", "open"], ["/", "search"], ["[ / ]", "heading"], ["v", "vault"], ["?", "keys"]];
const KEYS = [
  ["j / k", "down / up"], ["enter", "open"], ["h / l", "close / open folder"], ["/", "search"],
  ["[ / ]", "previous / next heading"], ["backspace", "back"], ["v / V", "next / previous vault"],
  ["b", "list"], ["o", "Obsidian"], ["r", "reload"], ["esc", "leave the search"], ["?", "hide this list"],
];

const clean = (p) => (p ? slash(String(p).trim()).replace(/\/+$/, "") : null);
const fixed = () => clean(props()?.vault); // this copy's own vault, which no switch changes
const configured = () => fixed() ?? clean(shared(VAULT));
const vaults = () => vaultList(shared(VAULTS), clean(shared(VAULT)));

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export default class Vaultr extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.listScroll = ScrollHandle.new();
    this.noteScroll = ScrollHandle.new();
    this.search = InputState.new({ placeholder: "Search notes" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.sel = null; cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.search.on("submit", (_e, cx) => { const row = this.rowAt() ?? this.rows.find((r) => r.kind === "note"); this.handle.focus(); if (row) this.activate(row, cx); });
    this.pathInput = InputState.new({ placeholder: "Path to a vault folder" });
    this.pathInput.on("submit", (_e, cx) => this.choose(this.pathInput.value(), cx));
    this.size = null;
    this.listShown = true;
    this.choosing = false;      // the folder form, over a vault that is already set
    this.help = false;          // every key is listed, after "?"
    this.gen = 0;               // a new vault or a reload ends the tasks of the one before
    this.reset(null);
    if (checking()) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c === "reload") this.start(this.vault, cx);
        else if (c === "vault") this.choosing = true;
        else if (c === "next") this.cycle(1);
        else if (c === "prev") this.cycle(-1);
        cx.notify();
      }
    });
    this.handle.focus();
    if (props()?.overlay) cx.timer.after(600, () => this.handle.focus());
    this.start(configured(), cx);
  }

  reset(vault) {
    this.vault = vault;
    this.index = makeIndex([]);
    this.backlinks = new Map(); // note path -> Set of note paths that link to it
    this.indexed = false;
    this.images = new Map();    // file path below the vault -> its copy below the app's folder
    this.open = new Set(vault ? load(`open:${vault}`, []) : []);
    this.history = [];
    this.note = null;           // { path, front, segs, version, nav }
    this.version = 0;
    this.nav = 0;
    this.headAt = -1;
    this.query = "";
    this.sel = null;            // the row key the keyboard is on
    this.rows = [];
    this.typing = false;
    this.error = null;
    this.notice = null;
    this.loading = Boolean(vault);
    try { this.watch?.cancel(); } catch {}
    this.watch = null;
  }

  start(vault, cx) {
    const gen = ++this.gen;
    this.reset(vault);
    if (this.search.value()) this.search.set_value("");
    if (!vault) return;
    const live = () => gen === this.gen;
    cx.spawn(async (cx) => {
      try {
        await this.walk();
        if (!live()) return;
        const last = load(`note:${vault}`, null);
        const first = [props()?.note, last].map((p) => p && this.index.lower.get(slash(p).toLowerCase())).find(Boolean) ?? this.index.notes[0];
        if (first) await this.show(first, { push: false }); else this.notice = "This folder has no notes.";
        this.loading = false;
        cx.notify();
        await this.indexLinks();
      } catch (e) { if (live()) { this.loading = false; this.error = `Cannot read ${vault}: ${e?.message ?? e}`; } }
      if (!live()) return;
      cx.notify();
      for (;;) {
        let changed;
        // Too many folders to watch (Linux), or the folder is gone: r still reloads.
        try { this.watch = watchFolder(vault); changed = (await this.watch).map(slash); } catch { return; }
        if (!live()) return;
        // Obsidian rewrites .obsidian/workspace.json as the person clicks around.
        if (!changed.length || changed.every((p) => p.includes("/.obsidian/"))) continue;
        for (const p of changed) this.images.delete(p.startsWith(`${vault}/`) ? p.slice(vault.length + 1) : p);
        if (changed.includes(vault)) this.images.clear();
        try {
          await this.walk();
          if (!live()) return;
          if (this.note && this.index.lower.has(this.note.path.toLowerCase())) await this.show(this.note.path, { push: false });
          else if (this.note) { this.notice = `${stem(this.note.path)} was moved or deleted.`; }
          cx.notify();
          await this.indexLinks();
        } catch (e) { this.error = String(e?.message ?? e); }
        if (!live()) return;
        cx.notify();
      }
    });
  }

  async walk() {
    const vault = this.vault;
    const files = [];
    const walk = async (dir) => {
      for (const e of await fs.readdir(dir ? `${vault}/${dir}` : vault, { withFileTypes: true })) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const path = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path); else files.push(path);
      }
    };
    await walk("");
    if (vault === this.vault) this.index = makeIndex(files);
  }

  // Backlinks. Reads every note, so it runs after the first note is on screen.
  async indexLinks() {
    const vault = this.vault, index = this.index;
    const backlinks = new Map();
    for (let i = 0; i < index.notes.length; i += 16) {
      await Promise.all(index.notes.slice(i, i + 16).map(async (from) => {
        const text = await fs.readFile(`${vault}/${from}`, "utf8").catch(() => "");
        for (const target of linkTargets(text)) {
          const to = resolve(index, splitTarget(target).note, from);
          if (!to || to === from || !isNote(to)) continue;
          if (backlinks.has(to)) backlinks.get(to).add(from); else backlinks.set(to, new Set([from]));
        }
      }));
      if (vault !== this.vault) return;
    }
    this.backlinks = backlinks;
    this.indexed = true;
  }

  // The copy of a vault image that image() can draw: it only draws files below the app's folder.
  async imageCopy(file) {
    if (this.images.has(file)) return this.images.get(file);
    const cache = `data/vaultr/${vaultKey(this.vault)}`;
    const at = file.lastIndexOf("/");
    const dir = at < 0 ? "" : `/${file.slice(0, at)}`;
    await copyFile(`${this.vault}${dir}`, `${slash(appHome())}/${cache}${dir}`, file.slice(at + 1));
    this.images.set(file, `${cache}/${file}`);
    return this.images.get(file);
  }

  async show(path, { push = true, heading = null } = {}) {
    const vault = this.vault;
    const text = await fs.readFile(`${vault}/${path}`, "utf8");
    const { front, body } = splitFrontmatter(text);
    const segs = transform(body);
    await Promise.all(segs.filter((s) => s.type === "image").map(async (seg) => {
      const file = resolve(this.index, seg.target, path);
      if (!file) { seg.error = `Missing image: ${seg.target}`; return; }
      try { seg.src = await this.imageCopy(file); } catch (e) { seg.error = `${seg.target}: ${e?.message ?? e}`; }
    }));
    if (vault !== this.vault) return;
    const moved = this.note?.path !== path;
    if (moved && push && this.note) this.history.push(this.note.path);
    if (moved) {
      // A new scroll area and handle, so the note starts at its top.
      this.nav++; this.headAt = -1; this.anchor = null;
      try { this.noteScroll.release(); } catch {}
      this.noteScroll = ScrollHandle.new();
      for (const dir of ancestors(path)) this.open.add(dir);
      save(`open:${vault}`, [...this.open]);
      save(`note:${vault}`, path);
    }
    this.note = { path, front, segs, version: ++this.version, nav: this.nav };
    this.sel = `n:${path}`;
    this.error = null; this.notice = null;
    if (this.narrow()) this.listShown = false;
    if (heading) this.pendingHeading = heading;
  }

  // Scroll-area children: the properties box when there is one, then one per segment.
  child(seg) { return seg + (this.note.front ? 1 : 0); }

  toHeading(heading, cx) {
    const at = this.note.segs.findIndex((s) => s.heading === headingKey(heading));
    if (at < 0) { this.notice = `No heading "${heading}" in this note.`; return; }
    this.reveal(at, cx);
  }

  // scroll_to_item moves as little as it can, which leaves a segment below the view at the bottom
  // edge. So the target is an anchor: an empty child as tall as the view, in front of the segment,
  // which is pulled up over it (see body()). Bringing its bottom into view puts its top, and the
  // heading, at the top of the view, in one step.
  reveal(at, cx) {
    this.help = false; // the key list's height is not known, and the anchor needs the view's
    this.headAt = at;
    this.anchor = at;
    // The anchor shifts the children after it by one, and is itself at the segment's old index.
    this.noteScroll.scroll_to_item(this.child(at));
    cx.notify();
  }

  stepHeading(by, cx) {
    const heads = this.note ? this.note.segs.map((s, i) => (s.heading ? i : -1)).filter((i) => i >= 0) : [];
    if (!heads.length) return;
    const next = by > 0 ? heads.find((i) => i > this.headAt) : [...heads].reverse().find((i) => i < this.headAt);
    if (next == null) return;
    this.reveal(next, cx);
  }

  // A clicked link: a note opens here, any other file opens in its own app.
  follow(target, cx) {
    // The clicked text is about to go, and the keyboard with it.
    this.handle.focus();
    const { note, heading } = splitTarget(target);
    const path = resolve(this.index, note, this.note?.path);
    if (!path) { this.notice = `No note named "${note}".`; cx.notify(); return; }
    if (!isNote(path)) { openExternal(fileUrl(`${this.vault}/${path}`)); return; }
    if (path === this.note?.path) { if (heading) this.toHeading(heading, cx); cx.notify(); return; }
    this.go(path, cx, { heading });
  }

  go(path, cx, options) {
    cx.spawn(async (cx) => {
      try { await this.show(path, options); } catch (e) { this.error = `Cannot read ${path}: ${e?.message ?? e}`; }
      cx.notify();
      // After the note has been laid out once.
      const heading = this.pendingHeading; this.pendingHeading = null;
      if (heading) cx.timer.after(40, (cx) => { this.toHeading(heading, cx); cx.notify(); });
    });
  }

  back(cx) { const p = this.history.pop(); if (p) this.go(p, cx, { push: false }); }

  choose(path, cx) {
    const vault = clean(path);
    if (!vault) return;
    cx.spawn(async (cx) => {
      // The mod's fs reads inside the home folder only, and throws for anything else.
      let found = false, why = `No folder at ${vault}`;
      try { found = await fs.exists(vault); } catch { why = `${vault} is outside your home folder, which is all Vaultr can read.`; }
      if (!found) { this.error = why; cx.notify(); return; }
      this.choosing = false;
      this.handle.focus();
      if (fixed()) { this.start(vault, cx); cx.notify(); return; }
      setShared(VAULTS, vaultList(vaults(), vault));
      // Every copy sees the change and starts over in render().
      setShared(VAULT, vault);
      cx.notify();
    });
  }

  // The next saved vault, or the one before. Each vault comes back on the note it last showed.
  cycle(by) {
    if (fixed()) { this.notice = "This copy reads one vault, set in its props."; return; }
    const list = vaults();
    if (list.length < 2) { this.notice = 'One vault is saved. Add another with "vaults" at the bottom right.'; return; }
    this.choosing = false;
    setShared(VAULT, nextVault(list, this.vault, by));
  }

  pick(vault, cx) {
    this.choosing = false; this.error = null;
    this.handle.focus();
    setShared(VAULT, vault);
    cx.notify();
  }

  // Drops a vault from the list. Its folder is not touched.
  forget(vault, cx) {
    const list = vaults().filter((v) => v !== vault);
    if (vault === clean(shared(VAULT))) setShared(VAULT, list[0] ?? "");
    setShared(VAULTS, list);
    cx.notify();
  }

  narrow() { return this.size != null && this.size.width < NARROW; }
  rowAt() { return this.rows.find((r) => r.key === this.sel) ?? null; }

  move(by, cx) {
    if (!this.rows.length) return;
    const at = this.rows.findIndex((r) => r.key === this.sel);
    const next = Math.max(0, Math.min(this.rows.length - 1, at < 0 ? 0 : at + by));
    this.sel = this.rows[next].key;
    this.listScroll.scroll_to_item(next);
    cx.notify();
  }

  // A breadcrumb's folder: shown in the list, opened, with the keyboard on it.
  showFolder(dir, cx) {
    for (const d of [...ancestors(`${dir}/x`)]) this.open.add(d);
    save(`open:${this.vault}`, [...this.open]);
    if (this.query) this.search.set_value("");
    this.query = "";
    this.listShown = true;
    this.sel = `d:${dir}`;
    this.rows = rows(this.index, this.open, "");
    const at = this.rows.findIndex((r) => r.key === this.sel);
    if (at >= 0) this.listScroll.scroll_to_item(at);
    this.handle.focus();
    cx.notify();
  }

  // The note's folders, then its name. A narrow copy shows the last folder only.
  crumbs(t) {
    const n = this.note;
    const bar = h_flex().flex_1().min_w(0).gap(4).items_center().overflow_hidden();
    if (!n) return bar.child(div().font_semibold().child("Vaultr"));
    let dirs = ancestors(n.path);
    const cut = this.narrow() && dirs.length > 1;
    if (cut) dirs = dirs.slice(-1);
    const sep = () => div().flex_none().text_size(11).text_color(t.dim).child("›");
    return bar
      .when(cut, (el) => el.child(div().flex_none().text_color(t.dim).child("…")).child(sep()))
      .children(dirs.flatMap((dir) => [
        div().id(`vaultr-crumb-${dir}`).flex_none().max_w(160).truncate().px(4).rounded(4).text_size(12).text_color(t.muted)
          .hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.showFolder(dir, cx))
          .child(dir.slice(dir.lastIndexOf("/") + 1)),
        sep(),
      ]))
      .child(div().min_w(0).truncate().font_semibold().child(stem(n.path)));
  }

  toggle(dir, to) {
    const open = to ?? !this.open.has(dir);
    if (open) this.open.add(dir); else this.open.delete(dir);
    save(`open:${this.vault}`, [...this.open]);
  }

  activate(row, cx) {
    if (row.kind === "dir") { this.toggle(row.path); cx.notify(); } else this.go(row.path, cx);
  }

  key(e, cx) {
    const k = e.key;
    if (e.modifiers?.control || e.modifiers?.alt || e.modifiers?.platform) return;
    if (this.typing) {
      if (k === "escape") this.handle.focus();
      else if (k === "down") this.move(1, cx);
      else if (k === "up") this.move(-1, cx);
      else return;
    } else if (!this.vault || this.choosing) {
      if (k === "escape" && this.choosing) this.choosing = false; else return;
    } else {
      const row = this.rowAt();
      if (k === "j" || k === "down") this.move(1, cx);
      else if (k === "k" || k === "up") this.move(-1, cx);
      else if (k === "enter") { if (row) this.activate(row, cx); }
      else if (k === "l" || k === "right") { if (row?.kind === "dir") this.toggle(row.path, true); }
      else if (k === "h" || k === "left") { if (row?.kind === "dir") this.toggle(row.path, false); }
      else if (k === "backspace") this.back(cx);
      else if (k === "/" && !e.modifiers?.shift) { this.listShown = true; this.search.focus(); }
      else if (k === "]") this.stepHeading(1, cx);
      else if (k === "[") this.stepHeading(-1, cx);
      else if (k === "?" || (e.modifiers?.shift && k === "/")) this.help = !this.help;
      else if (k === "b") this.listShown = !this.listShown;
      else if (k === "v") this.cycle(e.modifiers?.shift ? -1 : 1);
      else if (k === "r") this.start(this.vault, cx);
      else if (k === "o") { if (this.note) openExternal(`obsidian://open?path=${encodeURIComponent(`${this.vault}/${this.note.path}`)}`); }
      else if (k === "escape" && this.query) this.search.set_value("");
      else if (k === "escape" && this.narrow() && this.listShown && this.note) this.listShown = false;
      else return;
    }
    cx.stop_propagation(); cx.notify();
  }

  // The vaults form: first run, or the footer's "vaults". The saved vaults, and a field to add one.
  setup(t) {
    const saved = fixed() ? [] : vaults();
    const button = (id, label, on) => div().id(id).px(10).h(28).flex_none().rounded(6).border(1).border_color(t.border).bg(t.surface)
      .hover((s) => s.bg(t.hover)).on_click(on).child(h_flex().h_full().items_center().child(label));
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(12).p(24)
      .child(div().text_size(16).font_semibold().child(this.vault ? "Vaults" : "Choose your Obsidian vault"))
      .child(div().text_color(t.muted).child(saved.length > 1 ? "Click a vault to read it, or press v in a note for the next one. Vaultr never writes to them." : "Vaultr reads the notes in this folder. It never writes to them."))
      .when(saved.length > 0, (el) => el.child(v_flex().w_full().max_w(520).gap(2).children(saved.map((v, i) => h_flex().h(30).flex_none().gap(4).items_center().rounded(6)
        .when(v === this.vault, (row) => row.bg(t.selected))
        .child(h_flex().id(`vaultr-vault-${i}`).flex_1().min_w(0).h_full().px(8).gap(8).items_center().rounded(6)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(v, cx))
          .child(div().flex_none().max_w(200).truncate().font_semibold().child(base(v)))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(v)))
        .child(div().id(`vaultr-forget-${i}`).flex_none().px(8).h_full().rounded(6).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.blocked)).on_click((_e, cx) => this.forget(v, cx))
          .child(h_flex().h_full().items_center().child("✕")))))))
      .child(h_flex().w_full().max_w(520).gap(8).items_center()
        .child(h_flex().flex_1().min_w(0).h(30).px(8).items_center().rounded(6).border(1).border_color(t.input).bg(t.background)
          .child(Input.new(this.pathInput).flex_1().text_size(12.5).text_color(t.foreground)))
        .child(button("vaultr-use", saved.length ? "Add" : "Use", (_e, cx) => this.choose(this.pathInput.value(), cx))))
      .child(h_flex().gap(8)
        .child(button("vaultr-pick", "Browse…", (_e, cx) => cx.spawn(async (cx) => {
          const dir = await pickFolder({ prompt: "Use this vault" });
          if (dir) this.choose(dir, cx);
        })))
        .when(this.choosing, (el) => el.child(button("vaultr-cancel", "Cancel", (_e, cx) => { this.choosing = false; this.error = null; this.handle.focus(); cx.notify(); }))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error ?? "")));
  }

  list(t) {
    // In a narrow copy the list covers the note, so it carries the way back to it.
    const back = this.narrow() && this.note;
    return v_flex().h_full().border_color(t.border).bg(t.chrome)
      .when(Boolean(back), (el) => el.child(h_flex().id("vaultr-return").flex_none().h(32).px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.listShown = false; this.handle.focus(); cx.notify(); })
        .child(div().flex_none().child("←"))
        .child(div().min_w(0).truncate().child(`Back to ${stem(this.note.path)}`))))
      .child(h_flex().flex_none().h(30).mx(8).my(6).px(8).gap(6).items_center().rounded(6).border(1)
        .border_color(this.typing ? t.accent : t.border).bg(t.background)
        .child(Input.new(this.search).flex_1().text_size(12.5).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("/")))
      .child(v_flex().id("vaultr-list").flex_1().min_h(0).pb(6).overflow_y_scrollbar().track_scroll(this.listScroll)
        .on_mouse_down("left", () => this.handle.focus())
        .children(this.rows.length ? this.rows.map((row) => {
          const shown = row.kind === "note" && this.note?.path === row.path, sel = this.sel === row.key;
          return h_flex().id(`vaultr-${row.key}`).pl(10 + row.depth * 12).pr(8).h(ROW_H).flex_none().gap(6).items_center()
            .when(shown, (el) => el.bg(t.selected))
            .when(sel && !shown, (el) => el.bg(t.hover))
            .hover((s) => s.bg(t.hover))
            .text_color(shown || sel ? t.foreground : t.muted)
            .on_click((_e, cx) => { this.sel = row.key; this.handle.focus(); this.activate(row, cx); })
            .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(row.kind === "dir" ? (row.open ? "▾" : "▸") : ""))
            .child(div().min_w(0).truncate().child(row.label));
        }) : [div().px(12).py(6).text_color(t.dim).child(this.loading ? "Reading the vault…" : this.query ? "No notes match." : "No notes.")]));
  }

  body(t) {
    const n = this.note;
    const out = [];
    if (n.front) {
      out.push(v_flex().p(8).gap(2).rounded(6).bg(t.surface).border(1).border_color(t.border).text_size(12).text_color(t.muted)
        .children(n.front.split(/\r?\n/).map((l) => div().child(l))));
    }
    // The view's height: the copy's, less the bar, the footer, the notice strip and a margin.
    const viewH = Math.max(80, (this.size?.height ?? 600) - 32 - 28 - (this.error ?? this.notice ? 32 : 0) - 12);
    n.segs.forEach((seg, i) => {
      if (i === this.anchor) out.push(div().flex_none().h(viewH));
      if (seg.type === "md") {
        // After an anchor the segment moves up over it; the 10 is the scroll area's gap. (The same
        // negative margin on the anchor's own bottom edge stops the scroll from happening.)
        out.push(div().when(i === this.anchor, (el) => el.mt(-(viewH + 10))).child(TextView.markdown(`vaultr-md-${n.version}-${i}`, seg.text).selectable(true)
          .on_link_click((url, cx) => {
            const target = parseLink(url);
            if (target != null) this.follow(target, cx); else openExternal(url);
          })));
      } else if (seg.error) {
        out.push(div().text_color(t.blocked).child(seg.error));
      } else {
        out.push(div().max_w(720).rounded(4).overflow_hidden().child(image(seg.src).max_w_full()));
      }
    });
    const back = [...(this.backlinks.get(n.path) ?? [])].sort(order);
    out.push(v_flex().mt(12).pt(8).pb(16).gap(2).border_t(1).border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(this.indexed ? `BACKLINKS (${back.length})` : "BACKLINKS (reading the vault…)"))
      .children(back.map((b) => div().id(`vaultr-back-${b}`).text_color(t.accent).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.go(b, cx)).child(stem(b)))));
    return out;
  }

  reader(t) {
    const n = this.note;
    const strip = this.error ?? this.notice;
    const hint = ([k, what]) => h_flex().flex_none().gap(5).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const tool = (id, label, on, active = true) => div().id(id).px(6).h(22).flex_none().rounded(4).text_color(active ? t.muted : t.dim)
      .hover((s) => s.bg(t.hover)).on_click(on).child(h_flex().h_full().items_center().child(label));
    return v_flex().h_full()
      .child(h_flex().flex_none().h(32).px(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(tool("vaultr-list-toggle", "☰", (_e, cx) => { this.listShown = !this.listShown; cx.notify(); }))
        .child(tool("vaultr-back", "←", (_e, cx) => this.back(cx), this.history.length > 0))
        .child(this.crumbs(t))
        .when(Boolean(n), (el) => el.child(tool("vaultr-obsidian", "Open in Obsidian", () => openExternal(`obsidian://open?path=${encodeURIComponent(`${this.vault}/${n.path}`)}`))))
        .when(Boolean(props()?.overlay), (el) => el.child(tool("vaultr-close", "✕", () => closeOverlay(props().overlay)))))
      .when(Boolean(strip), (el) => el.child(div().flex_none().px(12).py(6).text_color(this.error ? t.blocked : t.muted).bg(t.surface).child(strip ?? "")))
      .child(v_flex().id(`vaultr-note-${this.nav}`).flex_1().min_h(0).px(16).py(12).gap(10).overflow_y_scrollbar().track_scroll(this.noteScroll)
        .on_mouse_down("left", () => this.handle.focus())
        .children(n ? this.body(t) : [div().text_color(t.dim).child(this.loading ? "Reading the vault…" : "")]))
      .when(this.help, (el) => el.child(h_flex().flex_none().flex_wrap().px(12).py(8).gap_x(16).gap_y(4).bg(t.raised).border_t(1).border_color(t.border).text_size(11)
        .children(KEYS.map(hint))))
      .child(h_flex().flex_none().h(28).px(12).gap(12).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(h_flex().flex_1().min_w(0).gap(14).items_center().overflow_hidden().children(this.help ? [] : CORE.map(hint)))
        .child(div().id("vaultr-change").flex_none().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.choosing = true; this.error = null; this.pathInput.set_value(""); cx.notify(); })
          .child(`${base(this.vault)} · ${this.index.notes.length} notes · vaults`)));
  }

  render(cx) {
    const t = theme();
    // Another copy, or the folder form, changed the vault.
    if (!checking() && configured() !== this.vault) this.start(configured(), cx);
    const root = h_flex().id("vaultr").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .size_full().bg(t.background).text_color(t.foreground).text_size(13);
    if (!this.vault || this.choosing) return root.child(this.setup(t));
    this.rows = rows(this.index, this.open, this.query);
    const narrow = this.narrow();
    const showList = this.listShown, showNote = !(narrow && this.listShown);
    return root
      .when(showList, (el) => el.child(div().h_full().when(narrow, (d) => d.flex_1().min_w(0)).when(!narrow, (d) => d.w(260).flex_none().border_r(1).border_color(t.border)).child(this.list(t))))
      .when(showNote, (el) => el.child(div().flex_1().min_w(0).h_full().child(this.reader(t))));
  }
}
