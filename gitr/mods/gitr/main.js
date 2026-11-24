// Gitr: one Repo on one Machine, its Main checkout, Worktrees, Branches and the spaces on them.
// The view holds no rules: rows come from arrange, every key and click goes through act,
// and effects run through runEffects. Open it with mod.open {"name": "gitr"} (alt-shift-g).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { checking, props, closeOverlay, notify, theme, spaces, panes, focused } from "herdr";
import { arrange, act, KEYS, LABELS, mkey } from "./model.js";
import { resolveRepo } from "./repos.js";
import { readRefs, readStatuses } from "./gitread.js";
import { runEffects } from "./effects.js";
import { makeSource } from "./source.js";
import { loadSettings, loadState, makeSaver, emptyState } from "./store.js";

const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const PAGE = 10;
// The popup sizes to its content, so the list and the asks have a fixed height.
const LIST_H = 440;
const THIS = "this computer";
const machineName = (key) => (key ? key : THIS);
const keyLabel = (key) => key.replace(/^ctrl-/, "^");
const KEY_OF = Object.fromEntries(KEYS.map((k) => [k.type, k.key]));
const TYPE_OF = Object.fromEntries(KEYS.filter((k) => k.key !== "enter").map((k) => [k.key, k.type]));
// The global actions the footer always offers, after the selected row's.
const GLOBAL = ["fetch", "cleanup", "refresh"];

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// 1h, 2d: how long ago a unix time in seconds was.
function age(date, now) {
  if (!date) return "";
  const m = Math.max(0, Math.floor((now / 1000 - date) / 60));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h`;
  const d = Math.floor(m / (60 * 24));
  if (d < 60) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

// The search field keeps Home and End for its cursor. These bindings, only inside Gitr's field,
// turn them into actions the list handles. The keymap is the app's: bind once per module load.
let homeEndBound = false;
function bindHomeEnd(cx) {
  if (homeEndBound) return;
  homeEndBound = true;
  try {
    cx.bind_keys([
      { keystroke: "home", action: "gitr::Home", context: "Gitr > Input" },
      { keystroke: "end", action: "gitr::End", context: "Gitr > Input" },
      { keystroke: "escape", action: "gitr::Escape", context: "Gitr" },
      { keystroke: "escape", action: "gitr::Escape", context: "Gitr > Input" },
      // Herdr binds f2 to tab.rename; a binding in Gitr's own context reaches Gitr first.
      { keystroke: "f2", action: "gitr::Rename", context: "Gitr" },
      { keystroke: "f2", action: "gitr::Rename", context: "Gitr > Input" },
    ]);
  } catch (e) { console.log(`gitr: home and end not bound: ${e?.message ?? e}`); }
}

const flatPath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
// `dir` is `root` or inside it. Drive paths compare without case.
const under = (dir, root) => {
  let d = flatPath(dir), r = flatPath(root);
  if (/^[A-Za-z]:/.test(r)) { d = d.toLowerCase(); r = r.toLowerCase(); }
  return d === r || d.startsWith(r + "/");
};
const errText = (e) => String(e?.message ?? e ?? "").trim() || "git failed";

export default class Gitr extends View {
  init(_props, cx) {
    this.settings = { enter: "worktree", run: null };
    this.state = emptyState();
    this.saver = makeSaver();
    this.source = makeSource({ settings: () => this.settings });
    this.repos = [];
    this.repo = null;      // { identity, name, on }
    this.machine = null;
    this.git = null;
    this.reachable = true;
    this.readError = null;
    this.loading = true;
    this.query = "";
    this.sort = "recent";
    this.filter = "all";
    this.remotesOpen = false;
    this.busy = {};
    this.sel = null;
    this.selIndex = 0;
    this.workspaces = [];  // Wranglr's Workspaces
    this.workspace = null; // the Workspace of the space Gitr opened in, when that space is in no Repo
    this.ask = null;       // an Ask from act, or { kind: "picker", which, items }
    this.askAt = 0;
    this.ticks = {};
    this.scroll = ScrollHandle.new();
    this.pickScroll = ScrollHandle.new();
    this.handle = cx.focus_handle();

    this.input = InputState.new({ placeholder: "Search branches, worktrees, spaces" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.sel = null; this.selIndex = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.perform({ type: "enter", row: this.sel }, cx));
    this.askInput = InputState.new({ placeholder: "Branch name" });
    this.askInput.on("submit", (_e, cx) => this.answer(cx));
    this.pickInput = InputState.new({ placeholder: "Filter" });
    this.pickInput.on("change", (_e, cx) => { this.askAt = 0; cx.notify(); });
    this.pickInput.on("submit", (_e, cx) => this.pick(cx));
    bindHomeEnd(cx);
    this.input.focus();
    cx.timer.after(600, () => { if (!this.ask) this.input.focus(); });

    if (checking()) return;
    cx.spawn(async (cx) => {
      const { settings, errors } = await loadSettings();
      this.settings = settings;
      for (const e of errors) notify({ title: "Gitr settings", body: e, level: "warning" });
      this.state = await loadState();
      this.sort = this.state.sort;
      this.remotesOpen = this.state.remotesOpen;
      this.repos = await this.source.repos().catch(() => []);
      this.workspaces = await this.source.workspaces().catch(() => []);
      const p = props() ?? {};
      let repo = null, machine = null;
      if (p.repo) {
        repo = this.repos.find((r) => r.identity === p.repo) ?? null;
        machine = p.machine ?? null;
      } else {
        const f = focused(), ps = panes();
        const s = spaces().find((x) => x.id === f?.space);
        const dir = s ? place(s, ps) : null;
        // A directory inside a known Main checkout needs no git call. The deepest one wins.
        const mk0 = mkey(s?.machine ?? null), d0 = dir ? flatPath(dir) : null;
        const known = d0 ? this.repos.filter((x) => x.on?.[mk0] && under(d0, x.on[mk0])).sort((a, b) => b.on[mk0].length - a.on[mk0].length)[0] : null;
        const r = known ? { identity: known.identity, name: known.name, main: known.on[mk0] } : dir ? await resolveRepo(dir, s.machine ?? null) : null;
        // In no Repo: a space in a Workspace home picks among that Workspace's Repos.
        if (!r && d0) {
          const ws = this.workspaces.filter((w) => w.homes[mk0] && under(d0, w.homes[mk0])).sort((a, b) => b.homes[mk0].length - a.homes[mk0].length)[0];
          if (ws) { this.workspace = ws; this.machine = s.machine ?? null; }
        }
        if (r) {
          machine = s.machine ?? null;
          repo = this.repos.find((x) => x.identity === r.identity) ?? { identity: r.identity, name: r.name, on: {} };
          repo = { ...repo, on: { ...repo.on, [mkey(machine)]: repo.on[mkey(machine)] ?? r.main } };
        }
      }
      if (repo && !(mkey(machine) in repo.on)) machine = this.firstMachine(repo);
      if (!repo) { this.loading = false; this.openPicker("repo", cx); return; }
      await this.show(repo, machine, cx);
    });
  }

  firstMachine(repo) {
    const k = Object.keys(repo.on ?? {})[0];
    return k ? k : null;
  }

  // Live data in the model's shape.
  world() {
    const ps = panes();
    const list = spaces();
    const spaceOfTab = new Map();
    for (const s of list) for (const t of s.tabs ?? []) spaceOfTab.set(t.id, s.id);
    return {
      git: this.git,
      repo: this.repo ? { identity: this.repo.identity, name: this.repo.name } : { identity: "", name: "" },
      machine: this.machine,
      reachable: this.reachable,
      spaces: list.map((s) => ({ id: s.id, name: s.name, machine: s.machine ?? null, status: s.status ?? null, dir: place(s, ps) || null })),
      panes: ps.filter((p) => p.terminal && p.cwd).map((p) => ({ space: spaceOfTab.get(p.tab) ?? null, cwd: p.cwd, machine: list.find((s) => s.id === spaceOfTab.get(p.tab))?.machine ?? null, title: p.title })),
      source: { kind: this.source.kind(), enter: this.source.enter(this.settings) },
      query: this.query,
      sort: this.sort,
      filter: this.filter,
      remotesOpen: this.remotesOpen,
      busy: this.busy,
      now: Date.now(),
    };
  }

  lastKey() {
    return `${mkey(this.machine)}\u0000${this.repo.identity}`;
  }

  save() {
    if (checking()) return;
    this.saver.save({ sort: this.sort, remotesOpen: this.remotesOpen, last: this.state.last });
  }

  // Shows a Repo on a Machine and reads it.
  async show(repo, machine, cx) {
    this.repo = repo;
    this.machine = machine;
    // The last known list shows at once. The read replaces it.
    this.git = this.state.last?.[`${mkey(machine)}\u0000${repo.identity}`] ?? null;
    this.readError = null;
    this.reachable = true;
    this.loading = !this.git;
    this.sel = null; this.selIndex = 0;
    this.redraw(cx);
    await this.read(cx);
  }

  async read(cx) {
    if (!this.repo) return;
    const main = this.repo.on?.[mkey(this.machine)];
    try {
      if (!main) throw new Error(`${this.repo.name} has no Main checkout on ${machineName(mkey(this.machine))}`);
      const n = this.reads = (this.reads ?? 0) + 1;
      const key = this.lastKey(), machine = this.machine;
      // Refs first: the list is right in a few seconds. Change counts follow, one checkout at a time,
      // because a status takes seconds per checkout on a slow disk. Until then the last counts stay.
      const old = new Map((this.git?.checkouts ?? []).map((c) => [c.path, c]));
      let git = await readRefs(main, machine);
      if (n !== this.reads) return;
      git = { ...git, checkouts: git.checkouts.map((c) => {
        const o = old.get(c.path);
        return o && !c.prunable ? { ...c, changes: o.changes, tracked: o.tracked } : c;
      }) };
      this.git = git;
      this.reachable = true;
      this.readError = null;
      this.loading = false;
      this.redraw(cx);
      await readStatuses(git, machine, (path, st) => {
        if (n !== this.reads) return;
        this.git = { ...this.git, checkouts: this.git.checkouts.map((c) => (c.path === path ? { ...c, ...st } : c)) };
        this.redraw(cx);
      });
      if (n !== this.reads) return;
      this.state.last = { ...this.state.last, [key]: this.git };
      this.save();
      return;
    } catch (e) {
      this.readError = errText(e);
      const last = this.state.last[this.lastKey()] ?? null;
      this.git = last;
      this.reachable = !last;
    }
    this.loading = false;
    this.redraw(cx);
  }

  redraw(cx) {
    try { cx.notify(); } catch {} // The overlay may have closed meanwhile.
  }

  // The selected row id, kept across refreshes. A row that is gone gives the nearest one.
  selected(order) {
    if (!order.length) { this.sel = null; return null; }
    const i = order.indexOf(this.sel);
    if (i >= 0) { this.selIndex = i; return this.sel; }
    this.selIndex = Math.max(0, Math.min(this.selIndex, order.length - 1));
    this.sel = order[this.selIndex];
    return this.sel;
  }

  move(by, order, cx) {
    if (!order.length) return;
    const i = order.indexOf(this.sel);
    const n = Math.max(0, Math.min(order.length - 1, (i < 0 ? 0 : i) + by));
    this.sel = order[n]; this.selIndex = n;
    this.reveal = true;
    this.redraw(cx);
  }

  // Every action goes through act. An ask is shown, effects are run.
  perform(action, cx) {
    if (this.ask || !this.repo) return;
    if (action.type === "repo") return this.openPicker("repo", cx);
    if (action.type === "machine") return this.openPicker("machine", cx);
    this.apply(act(this.world(), action), action.row ?? null, cx);
  }

  apply(result, row, cx) {
    if (result.ask) return this.showAsk(result.ask, cx);
    if (result.effects?.length) cx.spawn(async (cx) => this.runList(result.effects, row, cx));
    this.redraw(cx);
  }

  async runList(effects, row, cx) {
    if (row) { this.busy = { ...this.busy, [row]: true }; this.redraw(cx); }
    const ctx = {
      main: this.git?.main ?? this.repo.on?.[mkey(this.machine)],
      machine: this.machine,
      repo: this.repo.identity,
      source: this.source,
      overlay: props()?.overlay,
      onSet: (key, value) => {
        this[key] = value;
        if (key !== "filter") this.save();
      },
      onRefresh: () => this.read(cx),
    };
    const r = await runEffects(effects, ctx);
    if (row) { const { [row]: _, ...rest } = this.busy; this.busy = rest; }
    if (r.next) {
      this.apply(act(this.world(), { ...r.next, said: r.said }), r.next.row ?? null, cx);
      return;
    }
    if (!r.ok) {
      notify({ title: "Gitr", body: r.error, level: "error" });
      await this.read(cx);
    }
    this.redraw(cx);
  }

  // Asks

  showAsk(ask, cx) {
    this.ask = ask;
    this.askAt = 0;
    this.ticks = {};
    if (ask.kind === "confirm") for (const c of ask.checks ?? []) this.ticks[c.id] = !!c.checked;
    if (ask.kind === "checklist") for (const it of ask.items) this.ticks[it.id] = !!it.checked;
    if (ask.kind === "input") {
      this.askInput.set_value(ask.value ?? "");
      if (ask.value) this.askInput.set_selected_range({ start: 0, end: ask.value.length });
      this.askInput.focus();
    } else this.handle.focus();
    this.redraw(cx);
  }

  closeAsk(cx) {
    this.ask = null;
    this.input.focus();
    this.redraw(cx);
  }

  // Yes, submit or run: the ask's action goes back to act with the answer.
  answer(cx) {
    const ask = this.ask;
    if (!ask || ask.kind === "picker") return;
    let action;
    if (ask.kind === "confirm") {
      const checks = {};
      for (const c of ask.checks ?? []) checks[c.id] = !!this.ticks[c.id];
      action = { ...ask.action, confirmed: true, checks };
    } else if (ask.kind === "input") action = { ...ask.action, name: this.askInput.value() };
    else action = { ...ask.action, items: ask.items.filter((it) => this.ticks[it.id]).map((it) => it.id) };
    this.ask = null;
    this.input.focus();
    this.apply(act(this.world(), action), action.row ?? null, cx);
  }

  toggle(cx) {
    const ask = this.ask;
    const list = ask.kind === "confirm" ? ask.checks ?? [] : ask.items;
    const it = list[this.askAt];
    if (it) this.ticks[it.id] = !this.ticks[it.id];
    this.redraw(cx);
  }

  // The Repo picker and the Machine picker.

  openPicker(which, cx) {
    if (which === "machine" && !this.repo) return;
    this.ask = { kind: "picker", which, items: [] };
    this.askAt = 0;
    this.pickInput.set_value("");
    this.pickInput.focus();
    if (which === "machine") {
      this.ask.items = Object.keys(this.repo.on ?? {}).map((k) => ({ id: k, label: machineName(k), detail: this.repo.on[k] }));
      this.askAt = Math.max(0, this.ask.items.findIndex((it) => it.id === mkey(this.machine)));
      this.redraw(cx);
      return;
    }
    const fill = () => {
      if (this.ask?.kind !== "picker") return;
      // The Workspace's Repos first when Gitr opened in a Workspace space. Each Repo names its Workspaces, so typing one filters to it.
      const inWs = new Set(this.workspace?.repos ?? []);
      const names = (id) => (this.workspaces ?? []).filter((w) => w.repos.includes(id)).map((w) => w.name);
      const all = this.repos.map((r) => ({ id: r.identity, label: r.name, detail: [...names(r.identity), r.identity].join(" · "), first: inWs.has(r.identity) }));
      this.ask.items = [...all.filter((x) => x.first), ...all.filter((x) => !x.first)];
      this.askAt = Math.max(0, this.ask.items.findIndex((it) => it.id === this.repo?.identity));
    };
    fill();
    this.redraw(cx);
    if (checking()) return;
    cx.spawn(async (cx) => {
      this.repos = await this.source.repos().catch(() => this.repos);
      fill();
      this.redraw(cx);
    });
  }

  pickItems() {
    const words = this.pickInput.value().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.ask?.items ?? []).filter((it) => words.every((w) => `${it.label} ${it.detail}`.toLowerCase().includes(w)));
  }

  pick(cx) {
    const ask = this.ask;
    const it = this.pickItems()[this.askAt];
    if (!ask || ask.kind !== "picker" || !it) return;
    this.ask = null;
    this.input.focus();
    if (ask.which === "machine") {
      cx.spawn(async (cx) => this.show(this.repo, it.id || null, cx));
      return;
    }
    const repo = this.repos.find((r) => r.identity === it.id);
    const machine = mkey(this.machine) in repo.on ? this.machine : this.firstMachine(repo);
    cx.spawn(async (cx) => this.show(repo, machine, cx));
  }

  // Keys

  // Closes an ask, else clears the search, else closes Gitr.
  escape(cx) {
    const ask = this.ask;
    if (ask) { if (ask.kind === "picker" && !this.repo) closeOverlay(props().overlay); else this.closeAsk(cx); }
    else if (this.query) { this.input.set_value(""); this.query = ""; this.sel = null; this.selIndex = 0; this.redraw(cx); }
    else closeOverlay(props().overlay);
  }

  key(e, cx, view) {
    // ctrl keys by their whole chord, the others by the key alone (shift is ignored).
    const m = e.modifiers ?? {};
    const k = m.control || m.alt || m.platform ? e.keystroke ?? e.key : e.key;
    const ask = this.ask;
    if (k === "escape") return this.escape(cx), cx.stop_propagation();
    if (ask) {
      const n = ask.kind === "picker" ? this.pickItems().length : ask.kind === "checklist" ? ask.items.length : (ask.checks ?? []).length;
      if (k === "down" && n) this.askAt = Math.min(n - 1, this.askAt + 1);
      else if (k === "up" && n) this.askAt = Math.max(0, this.askAt - 1);
      else if (ask.kind === "picker" || ask.kind === "input") return;
      else if (k === "space") return this.toggle(cx), cx.stop_propagation();
      else if (k === "enter" || (k === "y" && ask.kind === "confirm")) return this.answer(cx), cx.stop_propagation();
      else if (k === "a" && ask.kind === "checklist") {
        const all = ask.items.every((it) => this.ticks[it.id]);
        for (const it of ask.items) this.ticks[it.id] = !all;
      } else return;
      if (ask.kind === "picker") this.pickScroll.scroll_to_item(this.askAt);
      this.redraw(cx);
      return cx.stop_propagation();
    }
    const order = view.order;
    const i = Math.max(0, order.indexOf(this.sel));
    if (k === "down") this.move(1, order, cx);
    else if (k === "up") this.move(-1, order, cx);
    else if (k === "pagedown") this.move(PAGE, order, cx);
    else if (k === "pageup") this.move(-PAGE, order, cx);
    else if (k === "home") this.move(-i, order, cx);
    else if (k === "end") this.move(order.length - 1 - i, order, cx);
    else if (TYPE_OF[k]) this.perform({ type: TYPE_OF[k], row: this.sel }, cx);
    else return;
    cx.stop_propagation();
  }

  // Drawing

  render(cx) {
    const t = theme();
    const view = arrange(this.world());
    this.selected(view.order);
    return v_flex().id("gitr").track_focus(this.handle).w_full().p(12).gap(8).bg(t.popover).text_size(13).text_color(t.foreground)
      .key_context("Gitr")
      .on_key_down((e, cx) => this.key(e, cx, view))
      .on_action("gitr::Home", (_e, cx) => { if (!this.ask) this.move(-view.order.length, view.order, cx); })
      .on_action("gitr::Escape", (_e, cx) => this.escape(cx))
      .on_action("gitr::Rename", (_e, cx) => { if (!this.ask) this.perform({ type: "rename", row: this.sel }, cx); })
      .on_action("gitr::End", (_e, cx) => { if (!this.ask) this.move(view.order.length, view.order, cx); })
      .child(this.titleRow(t))
      .children(this.ask ? [this.askPanel(t)] : this.listPanel(t, view));
  }

  chip(id, text, t, onClick) {
    return div().id(id).flex_none().px(8).py(2).rounded(5).border_1().border_color(t.border).text_size(11).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(text);
  }

  titleRow(t) {
    const machines = Object.keys(this.repo?.on ?? {});
    return h_flex().h(26).flex_none().px(4).gap(8).items_center()
      .child(div().flex_none().text_size(14).font_semibold().child("Gitr"))
      .when(!!this.workspace, (e) => e.child(div().flex_none().text_color(t.muted).child(this.workspace?.name ?? "")))
      .when(!!this.repo, (e) => e.child(h_flex().id("gitr-repo").flex_none().gap(4).px(6).py(2).rounded(5).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.perform({ type: "repo" }, cx))
        .child(div().text_color(t.foreground).child(this.repo?.name ?? ""))
        .child(svg(ICON("chevron-down")).size(12).text_color(t.dim))))
      .when(!!this.repo && machines.length > 1, (e) => e.child(h_flex().id("gitr-machine").flex_none().gap(4).px(6).py(2).rounded(5).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.perform({ type: "machine" }, cx))
        .child(div().text_color(t.muted).child(machineName(mkey(this.machine))))
        .child(svg(ICON("chevron-down")).size(12).text_color(t.dim))))
      .child(div().flex_1())
      .when(!this.ask && !!this.repo, (e) => e
        .child(this.chip("gitr-sort", `sort: ${this.sort === "az" ? "A to Z" : "recent"}`, t, (_e, cx) => this.perform({ type: "sort" }, cx)))
        .child(this.chip("gitr-filter", `show: ${{ all: "all", worktree: "with worktree", nowhere: "checked out nowhere" }[this.filter]}`, t, (_e, cx) => this.perform({ type: "filter" }, cx))));
  }

  searchBar(t) {
    return h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
      .child(svg(ICON("search")).size(14).flex_none().text_color(t.dim))
      .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc"));
  }

  listPanel(t, view) {
    const out = [this.searchBar(t)];
    if (this.readError && this.git) out.push(div().flex_none().px(4).truncate().text_size(12).text_color(t.dim).child(this.readError));
    let body;
    if (this.loading) {
      body = h_flex().h(LIST_H).flex_none().gap(8).justify_center().items_center().text_color(t.dim)
        .child(svg(ICON("spinner")).size(14).text_color(t.dim).spin(900)).child("Reading...");
    } else if (!this.git && this.readError) {
      body = div().h(LIST_H).flex_none().p(16).text_color(t.muted).child(this.readError);
    } else {
      const kids = [];
      let at = -1;
      for (const s of view.sections) {
        kids.push(this.sectionTitle(s, t, kids.length));
        for (const r of s.rows) {
          if (r.id === this.sel) at = kids.length;
          kids.push(this.row(r, t));
        }
      }
      if (view.empty) kids.push(div().flex_none().px(12).py(10).text_color(t.dim).child(view.empty));
      if (this.reveal && at >= 0) { this.scroll.scroll_to_item(at); this.reveal = false; }
      body = v_flex().id("gitr-list").h(LIST_H).flex_none().overflow_y_scrollbar().track_scroll(this.scroll).children(kids);
    }
    out.push(body);
    out.push(this.footer(t, view));
    return out;
  }

  sectionTitle(s, t, n) {
    const title = s.id === "remotes" ? `${s.title.toUpperCase()} (${s.count})` : s.title.toUpperCase();
    const el = h_flex().id(`gitr-sec-${s.id}`).h(26).flex_none().px(10).pt(n ? 8 : 2).gap(4).items_center().text_size(11).text_color(t.dim).child(title);
    if (s.id !== "remotes") return el;
    return el.cursor_pointer().hover((st) => st.text_color(t.foreground))
      .on_click((_e, cx) => this.perform({ type: "remotes" }, cx))
      .child(svg(ICON(s.folded ? "chevron-right" : "chevron-down")).size(11).text_color(t.dim));
  }

  row(r, t) {
    const on = r.id === this.sel;
    const fg = r.dim ? t.dim : on ? t.foreground : t.muted;
    const el = h_flex().id(`gitr-row-${r.id}`).h(28).flex_none().px(10).gap(8).items_center().rounded(6).cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_click((e, cx) => {
        if (on || e.click_count > 1) this.perform({ type: "enter", row: r.id }, cx);
        else { this.sel = r.id; this.redraw(cx); }
      })
      .child(div().w(10).flex_none().text_color(t.accent).child(on ? "▸" : ""));
    if (r.kind === "space") {
      return el.child(div().w(12).flex_none())
        .child(div().size(7).flex_none().rounded_full().bg(t[r.status] ?? t.unknown ?? t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(fg).child(r.name))
        .child(div().flex_none().text_size(12).text_color(r.status ? t[r.status] ?? t.dim : t.dim).child(r.status ?? ""));
    }
    const right = [];
    const counts = [r.ahead, r.behind].some((n) => n) ? `↑${r.ahead ?? 0} ↓${r.behind ?? 0}` : "";
    if (counts) right.push(div().text_color(t.dim).child(counts));
    if (r.changes) right.push(div().text_color(t.done ?? t.dim).child(`±${r.changes}`));
    if (r.gone) right.push(div().text_color(t.blocked).child("gone"));
    if (r.prunable) right.push(div().text_color(t.blocked).child("prunable"));
    const when = age(r.date, Date.now());
    right.push(div().w(34).text_color(t.dim).child(when));
    return el
      .child(div().flex_none().max_w(300).truncate().text_color(r.kind === "create" ? t.accent : fg).child(r.name))
      .when(r.worktree && !!r.path, (e) => e.child(h_flex().flex_1().min_w(0).gap(5).items_center()
        .child(div().flex_none().text_color(t.dim).child("⑂"))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(r.path))))
      .when(r.kind === "main" && !!r.path, (e) => e.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(r.path)))
      .when(!(r.worktree && r.path) && !(r.kind === "main" && r.path), (e) => e.child(div().flex_1()))
      .when(r.busy, (e) => e.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900)))
      .child(h_flex().flex_none().gap(10).justify_end().items_center().text_size(12).children(right));
  }

  // The selected row's actions, Enter first, then the global ones. Each is clickable.
  footer(t, view) {
    const row = view.sections.flatMap((s) => s.rows).find((r) => r.id === this.sel) ?? null;
    const items = [];
    if (row?.enter) items.push({ key: "enter", type: "enter", label: LABELS[row.enter] });
    for (const a of row?.actions ?? []) if (a !== row.enter && KEY_OF[a]) items.push({ key: KEY_OF[a], type: a, label: LABELS[a] });
    // An unreachable Machine allows only refresh.
    if (this.repo && this.git) for (const a of this.reachable ? GLOBAL : ["refresh"]) items.push({ key: KEY_OF[a], type: a, label: LABELS[a], global: true });
    return this.keyBar(t, items.map((it) => ({ ...it, run: (cx) => this.perform({ type: it.type, ...(it.global ? {} : { row: row.id }) }, cx) })));
  }

  keyBar(t, items) {
    return h_flex().flex_none().flex_wrap().pt(6).px(4).gap(2).border_t_1().border_color(t.border).text_size(11)
      .children(items.map((it, i) => h_flex().id(`gitr-key-${i}`).flex_none().px(6).py(2).gap(4).rounded(5).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => it.run(cx))
        .child(div().text_color(t.accent).font_semibold().child(keyLabel(it.key)))
        .child(div().text_color(t.dim).child(it.label))));
  }

  button(id, text, kind, t, onClick) {
    const bg = kind === "danger" ? t.blocked : kind === "yes" ? t.solid : t.raised;
    const fg = kind === "danger" ? t.solid_foreground : kind === "yes" ? t.solid_foreground : t.foreground;
    return h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(kind === "no" ? t.input : bg).bg(bg).text_color(fg)
      .text_size(12.5).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(text);
  }

  tick(on, t) {
    return h_flex().size(14).flex_none().justify_center().items_center().rounded(3).border_1().border_color(on ? t.accent : t.input).when(on, (e) => e.bg(t.accent))
      .when(on, (e) => e.child(svg(ICON("check")).size(11).text_color(t.accent_foreground)));
  }

  askPanel(t) {
    const ask = this.ask;
    const panel = v_flex().id("gitr-ask").h(LIST_H + 80).flex_none().p(8).gap(10);
    const head = div().text_size(15).font_semibold().text_color(t.foreground);
    if (ask.kind === "picker") {
      const items = this.pickItems();
      this.askAt = Math.max(0, Math.min(this.askAt, items.length - 1));
      return panel.child(head.child(ask.which === "machine" ? "Switch Machine" : this.workspace ? `${this.workspace.name}: pick a Repo` : "Switch Repo"))
        .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
          .child(svg(ICON("search")).size(14).flex_none().text_color(t.dim))
          .child(Input.new(this.pickInput).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
        .child(v_flex().id("gitr-pick").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.pickScroll)
          .children(items.length ? items.map((it, i) => h_flex().id(`gitr-pick-${i}`).h(30).flex_none().px(10).gap(10).items_center().rounded(6).cursor_pointer()
            .when(i === this.askAt, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.askAt = i; this.pick(cx); })
            .child(div().flex_none().text_color(t.foreground).child(it.label))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(it.detail)))
            : [div().px(10).py(8).text_color(t.dim).child(ask.which === "repo" ? "No Repos found in the open spaces" : "No Machines")]))
        .child(this.keyBar(t, [
          { key: "enter", label: "pick", run: (cx) => this.pick(cx) },
          { key: "esc", label: "cancel", run: (cx) => this.repo ? this.closeAsk(cx) : closeOverlay(props().overlay) },
        ]));
    }
    const cancel = { key: "esc", label: "cancel", run: (cx) => this.closeAsk(cx) };
    if (ask.kind === "confirm") {
      return panel.child(head.child(ask.title))
        .child(v_flex().flex_1().min_h(0).gap(4).id("gitr-lines").overflow_y_scrollbar()
          .children(ask.lines.map((l) => div().text_color(t.muted).child(l)))
          .children((ask.checks ?? []).map((c, i) => h_flex().id(`gitr-check-${c.id}`).mt(6).px(6).py(4).gap(8).items_center().rounded(6).cursor_pointer()
            .when(i === this.askAt, (e) => e.bg(t.hover))
            .on_click((_e, cx) => { this.askAt = i; this.toggle(cx); })
            .child(this.tick(!!this.ticks[c.id], t)).child(div().text_color(t.foreground).child(c.label)))))
        .child(h_flex().flex_none().justify_end().gap(8)
          .child(this.button("gitr-no", "Cancel", "no", t, (_e, cx) => this.closeAsk(cx)))
          .child(this.button("gitr-yes", ask.yes, ask.danger ? "danger" : "yes", t, (_e, cx) => this.answer(cx))))
        .child(this.keyBar(t, [
          { key: "enter", label: ask.yes, run: (cx) => this.answer(cx) },
          ...((ask.checks ?? []).length ? [{ key: "space", label: "toggle", run: (cx) => this.toggle(cx) }] : []),
          cancel,
        ]));
    }
    if (ask.kind === "input") {
      return panel.child(head.child(ask.title))
        .child(Input.new(this.askInput).h(36).flex_none().px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
        .when(!!ask.error, (e) => e.child(div().text_size(12).text_color(t.blocked).child(ask.error)))
        .child(div().flex_1())
        .child(h_flex().flex_none().justify_end().gap(8)
          .child(this.button("gitr-no", "Cancel", "no", t, (_e, cx) => this.closeAsk(cx)))
          .child(this.button("gitr-yes", ask.action.type === "rename" ? "Rename" : "Create", "yes", t, (_e, cx) => this.answer(cx))))
        .child(this.keyBar(t, [{ key: "enter", label: "submit", run: (cx) => this.answer(cx) }, cancel]));
    }
    // checklist
    return panel.child(head.child(ask.title))
      .child(v_flex().id("gitr-items").flex_1().min_h(0).gap(2).overflow_y_scrollbar()
        .children(ask.items.map((it, i) => h_flex().id(`gitr-item-${i}`).flex_none().px(8).py(5).gap(10).items_center().rounded(6).cursor_pointer()
          .when(i === this.askAt, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.askAt = i; this.toggle(cx); })
          .child(this.tick(!!this.ticks[it.id], t))
          .child(div().flex_none().text_color(t.foreground).child(it.label))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(it.detail)))))
      .child(h_flex().flex_none().justify_end().gap(8)
        .child(this.button("gitr-no", "Cancel", "no", t, (_e, cx) => this.closeAsk(cx)))
        .child(this.button("gitr-yes", ask.yes, "yes", t, (_e, cx) => this.answer(cx))))
      .child(this.keyBar(t, [
        { key: "enter", label: ask.yes, run: (cx) => this.answer(cx) },
        { key: "space", label: "toggle", run: (cx) => this.toggle(cx) },
        { key: "a", label: "all or none", run: (cx) => { const all = ask.items.every((x) => this.ticks[x.id]); for (const x of ask.items) this.ticks[x.id] = !all; this.redraw(cx); } },
        cancel,
      ]));
  }
}
