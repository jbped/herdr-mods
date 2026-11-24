// Wranglr: the spaces sidebar sorted into Groups (Workspaces, Repos, Custom groups), with
// Subgroups, drag and drop, a move dialog and its own select/next/prev keys. Started from
// Herdr's `spaces` mod: the row, its git tail, the rail and the machine guidance are its.
// Every rule lives in model.js. This file builds the World, sends actions through `act`,
// runs the effects and draws the Tree. The copy in the layout owns the state; overlay copies
// of this mod (move dialog, menus, text input) send their action to it through shared state.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import {
  spaces, machines, panes, agents, focused, run, openOverlay, closeOverlay, props, exec, hc, theme,
  shared, setShared, watchFolder, window, layout, home, nextCommand, readTextFile, appHome,
} from "herdr";
import { emptyState, mkey, clonedMap, arrange, act, workspaceHome } from "./model.js";
import { parseConfig, loadConfig, settingError, groupError, DEFAULT_SETTINGS } from "./config.js";
import { makeResolver } from "./repos.js";
import { loadState, makeSaver } from "./store.js";
import { writeWorkspaceFile } from "./workspacefile.js";
import { runEffects } from "./effects.js";
import { agentFacts, terminalNow } from "./agentdir.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
const CONFIG_EVERY = 5000;
const HALF_PAGE = 6; // rows ctrl-d and ctrl-u move the cursor

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const SORT_LABEL = { recent: "Recent", kind: "Kind", az: "A-Z", manual: "Manual" };
const KIND_ICON = { workspace: "layers", repo: "git-branch", custom: "folder" };
const icon = (name) => `mods/workspace-chrome/${name}.svg`;

// Agent status on a space's row. The label rule and the marks are those of Herdr's `agents` mod.
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// Each tab's lead pane: its first agent, else its first focused terminal, else its first terminal.
function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

// What an agent row says: a tab someone named, else the agent's own title when it tells something, else the program.
function agentLabel(a, tab, lead) {
  const prog = a.program?.name;
  if (tab?.named && tab.name && tab.name !== prog) return tab.name;
  const live = clean(lead?.pane === a.pane ? lead.title : a.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== a.program?.key;
  return telling ? live : prog || a.title || "agent";
}

// What a tab's row says: the name someone gave it, else its lead terminal's title when it tells something, else its program.
function tabLabel(tab, lead) {
  const prog = lead?.program?.name;
  if (tab.named && tab.name && tab.name !== prog) return tab.name;
  const live = clean(lead?.title);
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead?.program?.key;
  return telling ? live : prog || `Tab ${tab.name ?? ""}`.trim();
}

// The Agents tab's sections, most urgent first.
const SECTIONS = [["pinned", "Pinned"], ["blocked", "Needs you"], ["working", "Working"], ["done", "Done"], ["idle", "Idle"]];

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

// Overlays hand their action to the owner: a counter, so the owner runs each one once.
function send(action) {
  const n = (shared("wranglr.action")?.n ?? 0) + 1;
  setShared("wranglr.action", { n, action });
}

// The key an input dialog's text fills in its action.
const textKey = (action) => (action?.type === "plus" ? "branch" : "name");

function openInput(input) {
  openOverlay({ mod: "wranglr", kind: "dialog", width: 420, props: { dialog: "input", ...input } });
}

function openMenu(items) {
  // A popup is as tall as its items; height is only the most.
  openOverlay({ mod: "wranglr", kind: "popup", width: 220, height: 300, props: { dialog: "menu", items } });
}

export default class Wranglr extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.dialog = p.overlay ? p.dialog ?? "none" : null;
    if (this.dialog === "move" || this.dialog === "input") this.initInput(cx);
    else if (this.dialog === "settings") this.initSettings(cx);
    else if (this.dialog === "group") this.initGroup(cx);
    else if (this.dialog === "confirm") { this.handle = cx.focus_handle(); this.handle.focus(); }
    else if (this.dialog === "menu") { this.at = 0; this.handle = cx.focus_handle(); this.handle.focus(); }
    else if (!this.dialog) this.initOwner(cx);
  }

  // The owner

  initOwner(cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.real = {}; // space -> the folder its Claude Code agent is in now, when it could be told
    this.realAt = {}; // agent -> when it was last asked about
    this.realBusy = new Set(); // agents being asked about
    this.backAt = undefined; // when remembered agents' terminals were last looked at
    this.backKey = null; // the ready Machines at that look
    this.backBusy = false;
    this.agentWas = {}; // agent -> its status at the last look
    this.watching = new Set(); // local repos' git folders
    this.pressed = null; // { kind: "row" | "group" | "sub", id, group?, sub? } while the button is down
    this.over = null; // the drop target under the pointer: { kind, id, group?, sub?, below }
    this.machines = [];
    this.hovered = null; // the agent row under the pointer
    this.tab = "spaces"; // the list shown: "spaces" or "agents"
    this.homes = {}; // machine -> its home folder, once asked
    this.handle = cx.focus_handle(); // holds the keyboard while the list is driven by keys
    this.scroll = ScrollHandle.new();
    this.nav = []; // the rows the keys can reach, in the order drawn: { key, index, kind, ... }
    this.cursor = null; // the key of the row the keys are on
    this.reveal = false; // scroll the cursor's row into view at the next draw
    this.help = false; // every key is listed, after "?"
    this.wanted = false; // wranglr.keys asked for the keyboard and Herdr's "focus" has not come yet
    this.popup = undefined; // the pane under the window when a key opened a popup over the list
    this.back = null; // the pane the keyboard came from
    try { if (localStorage.getItem("wranglr.tab") === "agents") this.tab = "agents"; } catch {}
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;

    const parsed = parseConfig(null);
    this.config = parsed.config;
    this.errors = [];
    this.configText = undefined;
    this.state = emptyState();
    this.resolver = makeResolver();
    this.saver = makeSaver();
    this.resolving = new Set();
    this.making = []; // worktrees being made for a "+": { group, sub, branch, machine, folder, done }
    this.tree = null;
    this.loaded = false;
    this.syncedKey = null;
    this.filesKey = null;
    this.kicked = false;
    // Actions sent before this copy started are not ours to run.
    this.handled = shared("wranglr.action")?.n ?? 0;

    this.keysKey = null; // the key bound to wranglr.keys, as "Alt+S"
    this.gitr = false; // the gitr mod is installed: Repo group menus offer "Open in Gitr"
    cx.spawn(async (cx) => {
      await this.reloadConfig();
      await this.checkGitr();
      await this.checkKey();
      this.state = await loadState(emptyState()).catch(() => emptyState());
      this.loaded = true;
      this.tick(cx);
      cx.notify();
    });
    this.refreshMachines(cx);
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.timer.every(CONFIG_EVERY, (cx) => cx.spawn(async (cx) => {
      await this.checkGitr();
      if (await this.checkKey()) cx.notify();
      if (await this.reloadConfig()) { this.filesKey = null; this.tick(cx); cx.notify(); }
    }));
    // "wranglr.<command>" in keys.json and the palette.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^wranglr[.:]/, "");
        this.command(c, cx);
        cx.notify();
      }
    });
  }

  async close() {
    if (!this.dialog && this.saver) await this.saver.flush();
  }

  // The key bound to wranglr.keys in keys.json, as "Alt+S", or null. Shown under the list.
  async checkKey() {
    let found = null;
    try {
      const keys = JSON.parse(await readTextFile(appHome() + "/keys.json"));
      for (const section of ["global", "mod:wranglr"]) {
        for (const [key, action] of Object.entries(keys?.[section] ?? {})) {
          if (action === "wranglr.keys" || action?.command === "wranglr.keys") found = key;
        }
      }
    } catch {}
    const label = found ? found.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : "-")).join("+") : null;
    const changed = label !== this.keysKey;
    this.keysKey = label;
    return changed;
  }

  async checkGitr() {
    try { this.gitr = (await readTextFile(appHome() + "/mods/gitr/mod.json")) != null; } catch { this.gitr = false; }
  }

  // The config file's text changed: true. A missing file is the defaults.
  async reloadConfig() {
    let loaded;
    try { loaded = await loadConfig(); } catch { loaded = { ...parseConfig(null), text: null }; }
    if (loaded.text === this.configText) return false;
    this.configText = loaded.text;
    this.config = loaded.config;
    this.errors = loaded.errors;
    return true;
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    this.refreshReal(now, sp, cx);
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    this.tick(cx);
    if (this.pruneMaking()) cx.notify();
  }

  // A "making" row goes when its worktree failed, when its space is in the list, or a while after space.new.
  pruneMaking() {
    const before = this.making.length;
    const waiting = (m) => (this.state.pending ?? []).some((p) => p.group === m.group && p.folder === m.folder && mkey(p.machine) === mkey(m.machine));
    this.making = this.making.filter((m) => m.done === null || (waiting(m) && Date.now() - m.done < 8000));
    return this.making.length !== before;
  }

  // Runs an action an overlay sent, then a sync when the World's inputs changed.
  tick(cx) {
    this.kicked = false;
    if (!this.loaded) return;
    const msg = shared("wranglr.action");
    if (msg && typeof msg.n === "number") {
      if (msg.n < this.handled) this.handled = msg.n;
      else if (msg.n > this.handled) {
        this.handled = msg.n;
        if (msg.action) this.dispatch(msg.action, cx);
      }
    }
    const world = this.world(cx);
    const key = this.inputsKey(world);
    if (key !== this.syncedKey) {
      this.syncedKey = key;
      this.dispatch({ type: "sync" }, cx, world);
    }
    this.writeFiles(cx);
  }

  // What the model sees. With a cx, Repos not resolved yet are asked for.
  world(cx) {
    const all = spaces(), ps = panes();
    const repos = {};
    // A space made just now waits (at most a moment) for its git, so it appears in its Group instead of jumping there.
    const now = Date.now();
    this.born ??= {};
    const sp = all.filter((s) => {
      if (s.id in (this.state?.snap ?? {})) return true;
      const dir = place(s, ps);
      if (!dir || this.resolver.get(dir, s.machine) !== undefined) return true;
      if (cx) this.resolve(dir, s.machine, cx);
      return now - (this.born[s.id] ??= now) > 1500;
    });
    for (const s of sp) {
      const dir = place(s, ps);
      if (!dir) { repos[s.id] = null; continue; }
      let repo = this.repoAt(dir, s.machine, cx);
      // A pane can report a folder git cannot run in. The space's own folder is asked next.
      if (repo === null && s.folder && s.folder !== dir) repo = this.repoAt(s.folder, s.machine, cx);
      repos[s.id] = repo;
    }
    const titles = {};
    for (const a of agents()) if (a.title && !(a.space in titles)) titles[a.space] = a.title;
    const ms = machines().map((m) => ({ name: m.name, layout: m.layout }));
    if (!ms.some((m) => m.name === null)) ms.push({ name: null, layout: "ready" });
    return {
      spaces: sp, machines: ms, repos, titles,
      focus: focused()?.space ?? null,
      local: { home: home(), windows: window().platform === "windows" },
      cloned: clonedMap(this.config, this.state),
    };
  }

  // The Repo a folder is in: undefined while git is asked, null when it is in none.
  repoAt(dir, machine, cx) {
    const repo = this.resolver.get(dir, machine);
    // Not in a repo is asked again after a minute: git may have failed, or the folder became a repo.
    if (cx && (repo === undefined || (repo === null && this.retryDue(dir, machine)))) this.resolve(dir, machine, cx);
    return repo;
  }

  retryDue(dir, machine) {
    const k = JSON.stringify([machine ?? null, dir]);
    return Date.now() - ((this.tried ??= {})[k] ?? 0) > 61000;
  }

  resolve(dir, machine, cx) {
    const k = JSON.stringify([machine ?? null, dir]);
    if (this.resolving.has(k)) return;
    (this.tried ??= {})[k] = Date.now();
    this.resolving.add(k);
    cx.spawn(async (cx) => {
      try { await this.resolver.want(dir, machine); } catch {}
      this.resolving.delete(k);
      cx.notify();
    });
  }

  // A sync is due when this changes. Activity counts only under the recent sort.
  inputsKey(world) {
    const activity = (s) => Math.max(0, ...(s.tabs ?? []).map((t) => Math.max(t.changed_at || 0, t.working_since || 0)));
    return JSON.stringify([
      world.spaces.map((s) => [s.id, s.name, s.named, s.folder, s.branch, s.machine]),
      world.machines.map((m) => [m.name, m.layout]),
      world.repos, world.titles, world.cloned, this.configText ?? null,
      this.config.settings.sort === "recent" ? world.spaces.map(activity) : 0,
    ]);
  }

  // The one place `act` is called.
  dispatch(action, cx, world = this.world(cx)) {
    if (!this.loaded) return;
    const { state, effects } = act(action, world, this.config, this.state);
    if (state !== this.state) {
      this.state = state;
      this.saver.save(state);
    }
    // A worktree takes git a few seconds (a fetch, a checkout): its Group shows a row for it meanwhile.
    for (const e of effects)
      if (e.type === "start" && e.worktree && e.place)
        this.making.push({ group: e.place.group, sub: e.place.sub, branch: e.worktree.branch, machine: e.machine ?? null, folder: e.folder, done: null });
    if (action.type === "made") {
      const m = this.making.find((x) => x.done === null && x.folder === action.folder && mkey(x.machine) === mkey(action.machine));
      if (m && action.ok) m.done = Date.now();
      else if (m) this.making = this.making.filter((x) => x !== m);
    }
    this.pruneMaking();
    // The file is read again only every few seconds: the new setting applies now.
    for (const e of effects)
      if (e.type === "setting" || e.type === "settings")
        this.config = { ...this.config, settings: { ...this.config.settings, ...(e.type === "setting" ? { [e.key]: e.value } : e.values) } };
    // An `ask` can take a minute: it runs apart, and nothing waits for either.
    const asks = effects.filter((e) => e.type === "ask"), rest = effects.filter((e) => e.type !== "ask");
    for (const list of [rest, asks])
      if (list.length) cx.spawn(async (cx) => {
        await runEffects(list, { dispatch: (a) => this.dispatch(a, cx) });
        // After a save the file is the truth: read it now, also when the save failed.
        if (!list.some((e) => e.type === "setting" || e.type === "settings" || e.type === "group")) return;
        this.configText = undefined;
        await this.reloadConfig();
        this.filesKey = null;
        this.tick(cx);
        cx.notify();
      });
    this.tree = arrange({ ...world, cloned: clonedMap(this.config, this.state) }, this.config, this.state);
    this.publish();
    cx.notify();
  }

  // What overlays need, shared only when it changed (a setShared re-renders every mod).
  publish() {
    const s = this.config.settings;
    const view = {
      groups: this.tree.groups.map((g) => ({
        id: g.id, kind: g.kind, name: g.name, subgroups: g.subgroups.map((x) => ({ id: x.id, name: x.name })), machines: g.machines,
      })),
      focus: focused()?.space ?? null, sort: s.sort, plus: s.plus,
      repos: this.tree.repos,
    };
    if (JSON.stringify(view) !== JSON.stringify(shared("wranglr.view") ?? null)) setShared("wranglr.view", view);
  }

  // Each Workspace's .code-workspace file, on each ready Machine where it has a home.
  writeFiles(cx) {
    const cloned = clonedMap(this.config, this.state);
    const ms = machines();
    const ready = ms.filter((m) => m.layout === "ready").map((m) => mkey(m.name));
    if (!ms.some((m) => m.name === null)) ready.push("");
    const key = JSON.stringify([cloned, this.configText ?? null, ready]);
    if (key === this.filesKey) return;
    this.filesKey = key;
    const local = { home: home(), windows: window().platform === "windows" };
    const jobs = [];
    for (const ws of this.config.workspaces)
      for (const mk of ready) {
        const dir = workspaceHome(ws, mk, cloned, local);
        if (dir != null) jobs.push(() => writeWorkspaceFile(ws, mk === "" ? null : mk, cloned, dir));
      }
    if (jobs.length) cx.spawn(async () => { for (const job of jobs) { try { await job(); } catch {} } });
  }

  // Where a space is in the Tree: { group, sub } ("" for loose), or null.
  placeOf(id) {
    for (const g of this.tree?.groups ?? []) {
      if (g.rows.some((r) => r.id === id)) return { group: g.id, sub: null };
      for (const s of g.subgroups) if (s.rows.some((r) => r.id === id)) return { group: g.id, sub: s.id };
    }
    return this.tree?.loose.some((r) => r.id === id) ? { group: "", sub: null } : null;
  }

  command(c, cx) {
    const focus = focused()?.space ?? null;
    const n = /^select:?(\d+)$/.exec(c);
    if (n) this.dispatch({ type: "select", index: Number(n[1]) }, cx);
    else if (c === "keys") this.grabKeys(cx);
    // Herdr handed this copy the keyboard. Asked for (wranglr.keys), or back after a popup over the
    // list closed: take it. Reached by pane.go alone: send it back, so pane.go stops at the last pane.
    else if (c === "focus") {
      const popup = this.popup;
      this.popup = undefined;
      if (this.wanted) { this.wanted = false; this.cursor = null; this.reveal = true; this.handle.focus(); }
      // The popup chose nothing: the pane under the window is the one it opened over.
      else if (popup !== undefined && popup === (focused()?.pane ?? null)) this.handle.focus();
      else run("pane.go", { direction: "right" });
    }
    else if (c === "next" || c === "prev") this.dispatch({ type: c }, cx);
    else if (c === "fold") this.dispatch({ type: "foldFocused" }, cx);
    else if (c === "sort") this.dispatch({ type: "sort", value: null }, cx);
    else if (c === "settings") this.openSettings();
    else if (c === "agents") this.showTab(this.tab === "agents" ? "spaces" : "agents");
    else if (c === "pin" && focus) this.dispatch({ type: "pin", space: focus }, cx);
    else if (c === "tabs" && focus) this.dispatch({ type: "expand", space: focus }, cx);
    else if (c === "group") {
      const at = focus && this.placeOf(focus);
      const g = at?.group && this.tree.groups.find((x) => x.id === at.group);
      if (g) openOverlay({ mod: "wranglr", kind: "dialog", width: 460, props: this.groupProps(g) });
    }
    else if (c === "name" && focus) this.dispatch({ type: "name", space: focus }, cx);
    else if (c === "move" && focus) this.openMove(focus);
    else if (c === "new") {
      const at = focus && this.placeOf(focus);
      const g = at?.group && this.tree.groups.find((x) => x.id === at.group);
      if (g) this.plus(g, at.sub, cx);
      else this.newSpace();
    }
  }

  showTab(tab) {
    this.tab = tab;
    this.cursor = null;
    this.pressed = this.over = null;
    try { localStorage.setItem("wranglr.tab", tab); } catch {}
  }

  // Keys while the list holds the keyboard.

  isCursor(key) { return this.kb && this.cursor === key; }

  // The cursor's look on a row.
  ring(el, key, t) {
    // Drawn over the row, not as its border: a border would move the row's content by its width.
    return el.when(this.isCursor(key), (e) => e.relative().bg(t.hover)
      .child(div().absolute().top(0).bottom(0).left(0).right(0).rounded(6).border_1().border_color(t.accent)));
  }

  // The row the keys start on: the shown space or the focused agent, else the first.
  firstCursor() {
    const f = focused();
    const want = this.tab === "agents" ? `a:${agents().find((a) => a.focused)?.address}` : `r:${f?.space}`;
    return (this.nav.find((x) => x.key === want) ?? this.nav[0])?.key ?? null;
  }

  // While the list holds the keyboard: the legend line (key in accent, word dim), or after "?" every key on raised.
  keyHelp(t) {
    const box = v_flex().flex_none().px(12).py(6).border_t(1).border_color(t.border).text_size(11);
    if (!this.help) return box.child(h_flex().flex_wrap().gap(12).children([["j/k", "move"], ["enter", "open"], ["?", "keys"]].map(([key, what]) => h_flex().gap(4).items_center()
      .child(div().text_color(t.accent).font_semibold().child(key))
      .child(div().text_color(t.dim).child(what)))));
    // One job per key here. enter also folds a header, as h and l do.
    const keys = [
      ["Move"], ["j/k", "down, up"], ["g/G", "top, bottom"], ["ctrl-d/u", "half a page"],
      ["Spaces"], ["enter", "open it"], ["t", "show or hide its tabs"], ["n", "new space here"], ["/", "find a space"],
      ["Groups"], ["h/l", "fold, open this group"], ["C", "fold or open all groups"],
      ["Sidebar"], ["s/a", "Spaces list, Agents list"], ["esc/q", "back to the terminal"], ["?", "hide these keys"],
    ];
    return box.gap(2).bg(t.raised).children(keys.map(([key, what], i) => what === undefined
      ? div().mt(i ? 5 : 0).text_color(t.muted).font_semibold().child(key)
      : h_flex().pl(10).gap(8)
        .child(div().w(48).flex_none().text_color(t.accent).font_semibold().child(key))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(what))));
  }

  // The keyboard goes back to the pane beside the sidebar.
  // moved: enter went to another space or tab, so the pane the keyboard came from is not the place to go back to.
  leaveKeys(moved = false) {
    this.popup = undefined;
    run("pane.go", { direction: "right" });
    if (this.back && !moved) run("pane.focus", { pane: this.back });
    this.back = null;
  }

  // A key bound to wranglr.keys. Only Herdr moves the keyboard off a terminal, with pane.go, one
  // step at a time: step left until its "focus" arrives. The pane left behind gets it back.
  grabKeys(cx) {
    if (this.wanted || this.handle.is_focused()) return;
    this.back = focused()?.pane ?? null;
    this.popup = undefined;
    this.wanted = true;
    cx.spawn(async (cx) => {
      for (let i = 0; i < 8 && this.wanted; i++) {
        run("pane.go", { direction: "left" });
        await cx.sleep(80);
      }
      this.wanted = false;
      cx.notify();
    });
  }

  // A key opened a popup over the list: Herdr's "focus" comes when it closes.
  popupOpened() { this.popup = focused()?.pane ?? null; }

  onKey(e, cx) {
    const nav = this.nav, k = e.keystroke;
    const i = nav.findIndex((x) => x.key === this.cursor), it = nav[i];
    const to = (n) => { if (nav.length) { this.cursor = nav[Math.max(0, Math.min(nav.length - 1, n))].key; this.reveal = true; } };
    const head = it?.kind === "group" || it?.kind === "sub";
    const fold = () => this.dispatch({ type: "fold", group: it.group, sub: it.sub }, cx);
    // The header the cursor is on or under: a row's Subgroup or Group, a tab's through its space.
    const byKey = (key) => nav.find((x) => x.key === key);
    const over = head ? it : byKey((it?.kind === "tab" ? byKey(it.parent) : it)?.parent);
    if (k === "j" || k === "down") to(i + 1);
    else if (k === "k" || k === "up") to(i - 1);
    else if (k === "g") to(0);
    else if (k === "shift-g") to(nav.length - 1);
    else if (k === "ctrl-d") to(i + HALF_PAGE);
    else if (k === "ctrl-u") to(i - HALF_PAGE);
    // Not Tab: the window takes it to step the keyboard to the next control.
    else if (k === "s" || k === "a") this.showTab(k === "a" ? "agents" : "spaces");
    else if (k === "escape" || k === "q") this.leaveKeys();
    else if (k === "?" || k === "shift-/" || e.key_char === "?") this.help = !this.help;
    else if (k === "n") {
      // A space in the cursor's Group, as its + starts one. Outside a Group: a plain new space.
      const g = over && this.tree.groups.find((x) => x.id === over.group);
      if (g?.can.plus) { if (g.kind === "repo" && this.config.settings.plus === "worktree") this.popupOpened(); this.plus(g, over.sub, cx); }
      else this.newSpace();
    }
    else if (k === "/" || e.key === "/") { this.popupOpened(); run("mod.open", { name: "picker" }); }
    else if (k === "h" || k === "left" || k === "l" || k === "right") {
      // h folds the cursor's Group or Subgroup, l opens it.
      const shut = k === "h" || k === "left";
      if (over && !!over.folded !== shut) { this.dispatch({ type: "fold", group: over.group, sub: over.sub }, cx); this.cursor = over.key; this.reveal = true; }
    }
    else if (k === "shift-c") {
      // Folds every Group while any is open, else opens them all.
      const groups = this.tree?.groups ?? [], open = groups.some((g) => !g.folded);
      for (const g of groups) if (g.folded !== open) this.dispatch({ type: "fold", group: g.id, sub: null }, cx);
      if (over) { this.cursor = `g:${over.group}`; this.reveal = true; }
    }
    else if (k === "enter" || k === "space") {
      if (head) fold();
      else if (it?.kind === "row") { run("space.select", { id: it.space }); this.leaveKeys(true); }
      else if (it?.kind === "tab") { run("space.select", { id: it.space }); run("tab.select", { id: it.tab }); this.leaveKeys(true); }
      else if (it?.kind === "agent") { this.popup = undefined; this.back = null; run("pane.focus", { pane: it.pane }); }
    }
    else if (k === "t") {
      // On a tab: its space's tabs close and the cursor goes up to the space.
      const row = it?.kind === "tab" ? byKey(it.parent) : it;
      if (row?.kind === "row" && (row.open || row.tabs > 1)) {
        this.dispatch({ type: "expand", space: row.space }, cx);
        this.cursor = row.key; this.reveal = true;
      }
    }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  openMove(space) {
    openOverlay({ mod: "wranglr", kind: "dialog", width: 420, props: { dialog: "move", space, at: this.placeOf(space) } });
  }

  // Machine keys a picker offers: this computer, Herdr's Machines, and any others already named.
  knownMachines(extra = []) {
    const names = machines().map((m) => m.name).filter((n) => typeof n === "string" && n);
    return [...new Set(["", ...names, ...extra.filter((m) => typeof m === "string")])];
  }

  // A space in no Group: on the default Machine when it is set and ready, else as Herdr starts one.
  newSpace() {
    // In the `folder` setting, else the Machine's home. Herdr alone would start it in the focused
    // space's folder, on the focused space's Machine.
    const set = this.config.settings.machine, folder = this.config.settings.folder;
    let mk = typeof set === "string" ? set : spaces().find((s) => s.active)?.machine ?? "";
    const ready = mk === "" || machines().some((x) => x.name === mk && x.layout === "ready");
    // The folder is a path on the default Machine: not used when that Machine is away.
    const named = folder && (typeof set !== "string" || ready) ? folder : null;
    if (!ready) mk = "";
    (named ? Promise.resolve(named) : this.homeOf(mk)).then((f) => run("space.new", { machine: mk, ...(f ? { folder: f } : {}) }));
  }

  // A Machine's home folder, or null when it could not be told (then Herdr chooses the folder).
  async homeOf(mk) {
    if (!mk) return home();
    if (this.homes[mk]) return this.homes[mk];
    try {
      const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: mk, timeout: 5000 });
      const h = r.code === 0 ? r.stdout.trim() : "";
      if (/^([\/\\]|[A-Za-z]:[\/\\])/.test(h) && !/[\r\n]/.test(h)) return (this.homes[mk] = h);
    } catch {}
    return null;
  }

  openSettings() {
    const s = this.config.settings;
    openOverlay({ mod: "wranglr", kind: "dialog", width: 460, props: { dialog: "settings", settings: s, known: this.knownMachines([s.machine]) } });
  }

  // A Group's own settings as the dialog's props. A Workspace's and a Repo's are in the config file, a Custom group's in the State.
  groupProps(g) {
    let values;
    if (g.kind === "workspace") {
      const ws = this.config.workspaces.find((w) => w.name === g.id.slice(3)) ?? {};
      values = { machines: ws.machines ?? [], homes: Object.fromEntries(Object.entries(ws.on ?? {}).map(([mk, on]) => [mk, typeof on?.home === "string" ? on.home : ""])) };
    } else if (g.kind === "repo") {
      const r = this.config.repos[g.id.slice(5)] ?? {};
      values = { machines: r.machines ?? [], worktrees: r.worktrees ?? "", from: r.from ?? "" };
    } else {
      values = { machines: this.state.custom.find((x) => "custom:" + x.id === g.id)?.machines ?? [] };
    }
    const known = this.knownMachines([...values.machines, ...Object.keys(values.homes ?? {})]);
    return { dialog: "group", group: { id: g.id, kind: g.kind, name: g.name }, values, known, worktrees: this.config.settings.worktrees };
  }

  // "+": a new space in that Group. A worktree by default asks for its branch first.
  plus(g, sub, cx) {
    const action = { type: "plus", group: g.id, sub, mode: null };
    if (g.kind === "repo" && this.config.settings.plus === "worktree") openInput({ title: "New worktree", value: "", action: { ...action, mode: "worktree" } });
    else this.dispatch(action, cx);
  }

  plusMenu(g, sub) {
    const action = { type: "plus", group: g.id, sub };
    // Machines in priority order, picked with 1, 2, 3…; W makes a worktree.
    const items = g.machines.map((m, i) => ({ label: `Open on ${m || "this computer"}`, key: i < 9 ? String(i + 1) : undefined, action: { ...action, mode: "open", machine: m === "" ? null : m } }));
    if (!items.length) items.push({ label: "Open on this computer", key: "1", action: { ...action, mode: "open" } });
    if (g.kind === "repo") items.push({ label: "New worktree…", key: "w", input: { title: "New worktree", value: "", action: { ...action, mode: "worktree" } } });
    openMenu(items);
  }

  groupMenu(g) {
    const items = [{ label: "Add subgroup…", input: { title: "New subgroup", value: "", action: { type: "addSub", group: g.id } } }];
    if (g.kind === "custom") {
      items.push({ label: "Rename…", input: { title: "Rename group", value: g.name, action: { type: "renameGroup", group: g.id } } });
      items.push({ label: "Remove group", action: { type: "removeCustom", group: g.id } });
    }
    if (g.kind === "repo" && this.gitr) {
      const gitr = this.gitrOverlay(g.id.slice(5));
      if (gitr) items.push({ label: "Open in Gitr", key: "g", icon: "git-branch", overlay: gitr });
    }
    if (g.can.dismiss) items.push({ label: "Dismiss", action: { type: "dismiss", group: g.id } });
    const n = [...g.rows, ...g.subgroups.flatMap((x) => x.rows)].filter((r) => !r.dim).length;
    if (n) items.push({
      label: "Close group…", key: "c", icon: "x", width: 420,
      dialog: {
        dialog: "confirm", title: `Close ${g.name}?`, yes: n > 1 ? `Close ${n} spaces` : "Close 1 space",
        detail: `This closes ${n > 1 ? `the ${n} spaces` : "the 1 space"} in this group and ends ${n > 1 ? "their" : "its"} terminals.${g.kind === "repo" ? " The group goes with them." : ""}`,
        action: { type: "closeGroup", group: g.id },
      },
    });
    items.push({ label: "Settings…", key: "s", dialog: this.groupProps(g) });
    openMenu(items);
  }

  // Gitr on a Repo, placed as `mod.open gitr` places it. The Machine: the focused space's when the Repo
  // is cloned there, else the Group's first, else any with a path. Null when the Repo is not published.
  gitrOverlay(identity) {
    const repo = this.tree?.repos.find((r) => r.identity === identity);
    if (!repo) return null;
    const focus = focused()?.space;
    const here = focus ? spaces().find((s) => s.id === focus)?.machine ?? null : undefined;
    const g = this.tree.groups.find((x) => x.id === "repo:" + identity);
    const mk = here !== undefined && mkey(here) in repo.on ? mkey(here) : g?.machines.find((m) => m in repo.on) ?? Object.keys(repo.on)[0];
    return { mod: "gitr", kind: "popup", at: "top", offset: 40, width: 860, height: 0.75, props: { repo: identity, machine: mk === "" ? null : mk } };
  }

  subMenu(g, s) {
    openMenu([
      { label: "Rename…", input: { title: "Rename subgroup", value: s.name, action: { type: "renameSub", group: g.id, sub: s.id } } },
      { label: "Remove subgroup", action: { type: "removeSub", group: g.id, sub: s.id } },
    ]);
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = this.whereOf(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // Where a space's git is read: the folder its Claude Code agent works in when that is known,
  // else where Herdr says its first terminal is.
  whereOf(s, ps) {
    return this.real[s.id] ? JSON.stringify([s.machine ?? null, this.real[s.id]]) : where(s, ps);
  }

  // Asks about each Claude Code agent: once when it is first seen, when its turn ends, and after the
  // fallback time while the window is in front. Its session is remembered for a revive, and the
  // first one in a space says where that space's git is read.
  refreshReal(now, sp, cx) {
    const all = agents(), list = all.filter((a) => a.app === "claude-code");
    const first = new Map(), was = {};
    for (const a of all) was[a.address] = a.status;
    for (const a of list) if (!first.has(a.space)) first.set(a.space, a.address);
    for (const id of Object.keys(this.real)) if (!first.has(id)) delete this.real[id];
    const live = new Set(list.map((a) => a.address));
    for (const t of Object.keys(this.realAt)) if (!live.has(t)) delete this.realAt[t];
    const active = window().active;
    for (const a of list) {
      const ended = this.agentWas[a.address] === "working" && a.status !== "working";
      const last = this.realAt[a.address];
      if (this.realBusy.has(a.address) || (last !== undefined && !ended && !(active && now - last > FALLBACK))) continue;
      const space = sp.find((s) => s.id === a.space);
      if (!space) continue;
      this.realAt[a.address] = now;
      this.realBusy.add(a.address);
      cx.spawn(async (cx) => {
        const facts = await agentFacts(a.address, space.machine ?? null);
        this.realBusy.delete(a.address);
        // Not told this time: what it showed stays.
        if (!facts) return;
        if (facts.pid && facts.cwd) this.dispatch({ type: "agentSeen", terminal: a.address, pid: facts.pid, session: facts.session, cwd: facts.cwd, flags: facts.flags }, cx);
        if (facts.dir && first.get(a.space) === a.address && this.real[a.space] !== facts.dir) { this.real[a.space] = facts.dir; cx.notify(); }
      });
    }
    this.agentWas = was;
    this.checkBack(now, new Set(all.map((a) => a.address)), cx);
  }

  // Looks at the terminals of remembered agents that have no agent now: at the start, when a
  // Machine becomes ready, and after the fallback time. A closed terminal, or one whose agent left
  // by itself, is forgotten. One that is back as a new shell gets its agent resumed.
  checkBack(now, live, cx) {
    if (!this.loaded || this.backBusy) return;
    const ms = machines();
    const ready = new Set(ms.filter((m) => m.layout === "ready").map((m) => mkey(m.name)));
    if (!ms.some((m) => m.name === null)) ready.add("");
    const key = [...ready].sort().join("\n");
    if (this.backAt !== undefined && key === this.backKey && now - this.backAt <= FALLBACK) return;
    this.backAt = now;
    this.backKey = key;
    const machineOf = (t) => (t.includes("/") ? t.slice(0, t.indexOf("/")) : "");
    const todo = Object.keys(this.state.revive ?? {}).filter((t) => !live.has(t) && ready.has(machineOf(t)));
    if (!todo.length) return;
    this.backBusy = true;
    cx.spawn(async (cx) => {
      const gone = [], back = [];
      for (const t of todo) {
        const seen = await terminalNow(t);
        const entry = this.state.revive?.[t];
        if (!seen || !entry) continue;
        if (seen.gone || (seen.idle && seen.pid === entry.pid)) gone.push(t);
        else if (seen.idle) back.push({ terminal: t, pid: seen.pid });
      }
      this.backBusy = false;
      if (gone.length) this.dispatch({ type: "agentGone", terminals: gone }, cx);
      if (back.length) this.dispatch({ type: "terminalsBack", list: back }, cx);
    });
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        await Promise.all(keys.map((key) => this.check(key, cx)));
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await Promise.all([
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      ]);
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git`, tree: base(top) };
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // A space's menu: Wranglr's own entries, then Herdr's. "More…" opens the shipped space menu.
  spaceMenu(id) {
    const pinned = (this.state.pinned ?? []).includes(id);
    openMenu([
      { label: pinned ? "Unpin" : "Pin to the top", key: "p", icon: pinned ? "pin-off" : "pin", action: { type: "pin", space: id } },
      { label: this.state.open?.[id] ? "Hide tabs" : "Show tabs", key: "t", icon: "files", action: { type: "expand", space: id } },
      { label: "Move to group…", key: "m", icon: "folder", width: 420, dialog: { dialog: "move", space: id, at: this.placeOf(id) } },
      { label: "Rename", key: "r", icon: "square-pen", run: { name: "space.rename", args: { id } } },
      { label: "Close", key: "c", icon: "x", run: { name: "space.close", args: { id } } },
      { label: "More…", icon: "chevron-right", shipped: { tab: "space", target: { id } } },
    ]);
  }

  // Drag and drop

  press(target) {
    this.pressed = target;
    this.over = null;
  }

  hover(target, e, cx) {
    if (!this.pressed) return;
    const below = e?.local_position && e?.bounds ? e.local_position.y > e.bounds.height / 2 : false;
    const next = { ...target, below };
    if (JSON.stringify(next) !== JSON.stringify(this.over)) { this.over = next; cx.notify(); }
  }

  // Released on a row: a press there with no drop elsewhere selects it.
  releaseRow(r, at, after, cx) {
    const from = this.pressed, below = this.over?.id === r.id && this.over.below;
    this.pressed = this.over = null;
    if (from?.kind !== "row") return;
    if (from.id === r.id) run("space.select", { id: r.id });
    else if (at) this.dispatch({ type: "drop", space: from.id, group: at.group, sub: at.sub, before: below ? after : r.id }, cx);
  }

  releaseGroup(g, after, cx) {
    const from = this.pressed, below = this.over?.id === g.id && this.over.below;
    this.pressed = this.over = null;
    if (from?.kind === "row") this.dispatch({ type: "drop", space: from.id, group: g.id, sub: null, before: null }, cx);
    else if (from?.kind === "group" && from.id === g.id) this.dispatch({ type: "fold", group: g.id, sub: null }, cx);
    else if (from?.kind === "group") this.dispatch({ type: "dropGroup", group: from.id, before: below ? after : g.id }, cx);
  }

  releaseSub(g, s, cx) {
    const from = this.pressed;
    this.pressed = this.over = null;
    if (from?.kind === "row") this.dispatch({ type: "drop", space: from.id, group: g.id, sub: s.id, before: null }, cx);
    else if (from?.kind === "sub" && from.id === `${g.id}/${s.id}`) this.dispatch({ type: "fold", group: g.id, sub: s.id }, cx);
  }

  releaseEnd(cx) {
    const from = this.pressed;
    this.pressed = this.over = null;
    if (from?.kind === "row") this.dispatch({ type: "drop", space: from.id, group: "", sub: null, before: null }, cx);
  }

  // Drawing the owner. Nothing here calls the model's actions: it reads the last Tree.

  // Only what's unusual, after the name: "herdr · spike ↑2 ↓1". The repo or
  // branch goes when the name already says it, and master/main go: nearly every space is on one.
  // In a Repo group the header already names the repo, so the row says only the branch,
  // or the worktree's folder when nothing is checked out by name there.
  gitTail(g, name, t, inRepo) {
    const none = !g.branch || g.branch === "(detached)";
    const raw = none && inRepo && g.linked && g.tree ? g.tree : g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = inRepo || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" · ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)));
  }

  chip(machine, t) {
    return div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.dim).child(machine);
  }

  avatar(id, name, t) {
    const color = (shared("space.colors") ?? {})[id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...name][0]?.toUpperCase() ?? "?");
  }

  // r: a Row. at: its container. after: the id of the row below it there, or null.
  row(r, at, after, indent, d) {
    const { t, live, ps } = d;
    const w = live.get(r.id) ?? r.space;
    const name = w?.name ?? r.name;
    const g = w ? this.git[this.whereOf(w, ps)] ?? null : null;
    const marks = r.dim || !d.agents.get(r.id)?.length ? null : this.agentMarks(r.id, d.agents.get(r.id), d);
    const tabs = r.dim ? [] : (w?.tabs ?? []).filter((x) => !x.settled);
    const open = !r.dim && !!this.state.open?.[r.id];
    // The tabs toggle: shown once a space has more than one tab, or while its tabs are open.
    const toggle = tabs.length > 1 || open
      ? h_flex().id(`tabs-${r.id}`).flex_none().h(20).px(3).gap(2).items_center().rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(open ? "Hide tabs" : `Show ${tabs.length} tabs`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.dispatch({ type: "expand", space: r.id }, cx); })
        .child(svg(icon(open ? "chevron-down" : "chevron-right")).size(10).flex_none())
        .child(String(tabs.length))
      : null;
    const content = h_flex().gap(9).items_center().pl(indent)
      .child(this.avatar(r.id, name, t))
      .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(name))
      .when(Boolean(marks), (el) => el.child(marks))
      .when(Boolean(r.machine), (el) => el.child(this.chip(r.machine, t)))
      .child(g && !r.dim ? this.gitTail(g, name, t, !!at?.group?.startsWith("repo:")) : div().flex_1())
      .when(Boolean(toggle), (el) => el.child(toggle));
    const el = v_flex().relative().id(`space-${r.id}`).px(8).h(30).flex_none().justify_center().rounded(8);
    if (r.dim) return el.opacity(0.5).child(content);
    const on = !!w?.active;
    const target = this.pressed?.kind === "row" && this.pressed.id !== r.id && this.over?.kind === "row" && this.over.id === r.id;
    return this.ring(el, `r:${r.id}`, t)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed?.kind === "row" && this.pressed.id === r.id && this.over && this.over.id !== r.id, (el) => el.opacity(0.5))
      .when(target, (el) => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent).when(this.over.below, (l) => l.bottom(0)).when(!this.over.below, (l) => l.top(0))))
      .on_mouse_down("left", () => this.press({ kind: "row", id: r.id }))
      .on_mouse_move((e, cx) => this.hover({ kind: "row", id: r.id }, e, cx))
      .on_mouse_up("left", (_e, cx) => { this.releaseRow(r, at, after, cx); cx.notify(); })
      .on_mouse_down("right", () => this.spaceMenu(r.id))
      .child(content);
  }

  // Adds the rows to `out`, and each one the keys can reach to this.nav. parent: the key of the header above.
  rows(out, list, at, indent, d, parent = null) {
    list.forEach((r, i) => {
      const open = !r.dim && !!this.state.open?.[r.id];
      const tabs = r.dim ? [] : ((d.live.get(r.id) ?? r.space)?.tabs ?? []).filter((x) => !x.settled);
      if (!r.dim) this.nav.push({ key: `r:${r.id}`, index: out.length, kind: "row", space: r.id, open, tabs: tabs.length, parent });
      out.push(this.row(r, at, list.slice(i + 1).find((x) => !x.dim)?.id ?? null, indent, d));
      if (!open) return;
      const els = this.tabRows(r, indent, d);
      tabs.forEach((tab, n) => this.nav.push({ key: `t:${tab.id}`, index: out.length + n, kind: "tab", space: r.id, tab: tab.id, parent: `r:${r.id}` }));
      out.push(...els);
    });
  }

  // A row for each worktree being made in this Group: the space is not there until git is done.
  makingRows(group, sub, indent, d) {
    const { t } = d;
    return this.making.filter((m) => m.group === group && (m.sub ?? null) === sub).map((m, i) =>
      h_flex().id(`making-${group}-${sub ?? ""}-${i}`).h(30).px(8).pl(indent + 8).gap(9).flex_none().items_center().rounded(8).text_color(t.muted)
        .tooltip(m.folder)
        .child(h_flex().w(18).flex_none().justify_center().child(svg(icon("spinner")).size(12).flex_none().text_color(t.working).spin(900)))
        .child(div().flex_1().min_w(0).truncate().child(`Making worktree ${m.branch}…`))
        .when(Boolean(m.machine), (el) => el.child(this.chip(m.machine, t))));
  }

  // A space's tabs under its row. A click shows the space at that tab.
  tabRows(r, indent, d) {
    const { t, live } = d;
    const w = live.get(r.id) ?? r.space;
    return (w?.tabs ?? []).filter((x) => !x.settled).map((tab) => {
      const lead = d.leads.get(tab.id);
      // An agent's tab shows the agent's own icon and always its state. A plain terminal shows neither.
      const agent = lead?.program?.agent ? lead.program : null;
      const status = agent ? lead.status ?? "idle" : null;
      const pic = agent?.icon
        ? (agent.tint ? svg(agent.icon).size(13).flex_none().text_color(t.muted) : image(agent.icon).size(13).flex_none())
        : svg(icon(agent ? "square" : "terminal")).size(11).flex_none().text_color(t.dim);
      const on = !!w.active && !!tab.active;
      return this.ring(h_flex().id(`tab-${tab.id}`).h(24).flex_none().pl(indent + 35).pr(8).gap(7).items_center().rounded(6), `t:${tab.id}`, t)
        .text_size(12).text_color(on ? t.foreground : t.muted).cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: r.id }); run("tab.select", { id: tab.id }); })
        .child(h_flex().w(13).flex_none().justify_center().child(pic))
        .child(div().flex_1().min_w(0).truncate().child(tabLabel(tab, lead)))
        .when(Boolean(agent), (el) => el.tooltip(`${agent.name ?? "Agent"}: ${{ blocked: "needs you", working: "working", done: "done" }[status] ?? "idle"}`)
          .child(status === "blocked" || status === "working" || status === "done"
            ? this.agentStatus(t, status)
            : div().size(7).mx(2).flex_none().rounded(4).border_1().border_color(t.dim)));
    });
  }

  // The Agents tab: every agent by how much it needs you, each row naming its space.
  agentList(d) {
    const { t } = d;
    const all = agents();
    if (!all.length) return [div().px(8).py(10).text_size(12).text_color(t.dim).child("No agents running.")];
    const leads = d.leads;
    const tabs = new Map([...d.live.values()].flatMap((s) => s.tabs ?? []).map((tab) => [tab.id, tab]));
    const out = [];
    for (const [key, title] of SECTIONS) {
      const members = all.filter((a) => (key === "pinned" ? a.pinned : !a.pinned && (a.status ?? "idle") === key)).sort((x, y) => (y.seq ?? 0) - (x.seq ?? 0));
      if (!members.length) continue;
      out.push(h_flex().h(24).mt(out.length ? 6 : 0).px(8).gap(6).flex_none().items_center().text_size(11).text_color(t[key] ?? t.dim)
        .child(div().child(title)).child(div().text_color(t.dim).child(String(members.length))));
      for (const a of members) {
        this.nav.push({ key: `a:${a.address}`, index: out.length, kind: "agent", pane: a.pane });
        out.push(this.agentRow(a, agentLabel(a, tabs.get(a.tab), leads.get(a.tab)), d));
      }
    }
    return out;
  }

  agentRow(a, label, d) {
    const { t } = d;
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    const pin = div().id(`agent-pin-${a.address}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(a.pinned ? "Unpin" : "Pin to the top")
      .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.pin", { terminal: a.address, pinned: !a.pinned }); this.hovered = null; cx.notify(); })
      .child(svg(icon(a.pinned ? "pin-off" : "pin")).size(13));
    const mark = a.status === "blocked" || a.status === "working" || a.status === "done"
      ? this.agentStatus(t, a.status)
      : div().size(7).mx(2).flex_none().rounded(4).border_1().border_color(t.dim);
    return this.ring(h_flex().id(`agent-${a.address}`).h(30).px(8).gap(8).flex_none().items_center().rounded(8).cursor_pointer(), `a:${a.address}`, t)
      .when(!!a.focused, (el) => el.bg(t.selected))
      .when(!a.focused, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(h_flex().w(16).flex_none().justify_center().child(mark))
      .child(div().flex_1().min_w(0).truncate().text_color(a.status === "idle" && !a.focused ? t.muted : t.foreground).child(label))
      .child(div().flex_shrink(0).max_w(120).min_w(0).truncate().text_size(11.5).text_color(t.dim).child(a.space_name ?? ""))
      .when(Boolean(machine), (el) => el.child(this.chip(machine, t)))
      .when(this.hovered === a.address || !!a.pinned, (el) => el.child(pin));
  }

  // Each space's agents and what each row's tooltip calls them. Empty when the setting is off.
  agentData(sp, ps) {
    const bySpace = new Map(), labels = new Map();
    if (this.config.settings.agents === false) return { agents: bySpace, labels };
    const leads = leadPanes(ps);
    const tabs = new Map(sp.flatMap((s) => s.tabs ?? []).map((tab) => [tab.id, tab]));
    for (const a of agents()) {
      if (!bySpace.has(a.space)) bySpace.set(a.space, []);
      bySpace.get(a.space).push(a);
      labels.set(a.address, agentLabel(a, tabs.get(a.tab), leads.get(a.tab)));
    }
    return { agents: bySpace, labels };
  }

  // What a space's agents are doing, right after its name: one mark per state that has agents
  // (needs you, working, done), with a count above one. Idle agents show nothing.
  // A click goes to the most urgent agent's pane.
  agentMarks(id, list, d) {
    const { t } = d;
    const shown = ["blocked", "working", "done"].map((status) => [status, list.filter((a) => a.status === status).length]).filter(([, n]) => n > 0);
    if (!shown.length) return null;
    const top = list.reduce((best, a) => ((RANK[a.status] ?? 0) > (RANK[best.status] ?? 0) ? a : best), list[0]);
    const word = { blocked: "needs you", working: "working", done: "done", idle: "idle" };
    return h_flex().id(`agents-${id}`).flex_none().h(20).px(3).gap(5).items_center().rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(list.map((a) => `${d.labels.get(a.address) ?? "agent"}: ${word[a.status] ?? a.status}`).join("\n"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run("pane.focus", { pane: top.pane }); })
      .children(shown.map(([status, n]) => h_flex().gap(2).items_center().child(this.agentStatus(t, status)).when(n > 1, (el) => el.child(String(n)))));
  }

  agentStatus(t, status) {
    if (status === "working") return svg(icon("spinner")).size(12).flex_none().text_color(t.working).spin(900);
    if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    return div().size(7).mx(2).flex_none().rounded(4).bg(t.done ?? t.dim);
  }

  plusButton(id, g, sub, t) {
    return div().id(id).size(20).flex_none().flex().items_center().justify_center().rounded(5)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.plusMenu(g, sub); })
      .on_click((_e, cx) => { cx.stop_propagation(); this.plus(g, sub, cx); })
      .child(svg(icon("plus")).size(11));
  }

  groupHead(g, after, d) {
    const { t } = d;
    const count = g.rows.length + g.subgroups.reduce((n, s) => n + s.rows.length, 0);
    const dragging = this.pressed?.kind === "row" || (this.pressed?.kind === "group" && this.pressed.id !== g.id);
    const over = dragging && this.over?.kind === "group" && this.over.id === g.id;
    const lineFor = this.pressed?.kind === "group" && over;
    return this.ring(h_flex().relative().id(`group-${g.id}`).h(26).mt(4).px(8).gap(6).flex_none().items_center().rounded(6), `g:${g.id}`, t)
      .text_size(11.5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .when(over && !lineFor, (el) => el.bg(t.hover).border_1().border_color(t.accent))
      .when(lineFor, (el) => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent).when(this.over.below, (l) => l.bottom(0)).when(!this.over.below, (l) => l.top(0))))
      .on_mouse_down("left", () => this.press({ kind: "group", id: g.id }))
      .on_mouse_move((e, cx) => this.hover({ kind: "group", id: g.id }, e, cx))
      .on_mouse_up("left", (_e, cx) => { this.releaseGroup(g, after, cx); cx.notify(); })
      .on_mouse_down("right", () => this.groupMenu(g))
      .child(svg(icon(g.folded ? "chevron-right" : "chevron-down")).size(11).flex_none())
      .child(svg(icon(KIND_ICON[g.kind])).size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(g.name))
      .when(g.folded && count > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(count))))
      .when(g.can.plus, (el) => el.child(this.plusButton(`group-plus-${g.id}`, g, null, t)));
  }

  subHead(g, s, d) {
    const { t } = d;
    const key = `${g.id}/${s.id}`;
    const over = this.pressed?.kind === "row" && this.over?.kind === "sub" && this.over.id === key;
    return this.ring(h_flex().id(`sub-${key}`).h(24).pl(24).pr(8).gap(6).flex_none().items_center().rounded(6), `s:${key}`, t)
      .text_size(11.5).text_color(t.muted).cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .when(over, (el) => el.bg(t.hover).border_1().border_color(t.accent))
      .on_mouse_down("left", () => this.press({ kind: "sub", id: key }))
      .on_mouse_move((e, cx) => this.hover({ kind: "sub", id: key }, e, cx))
      .on_mouse_up("left", (_e, cx) => { this.releaseSub(g, s, cx); cx.notify(); })
      .on_mouse_down("right", () => this.subMenu(g, s))
      .child(svg(icon(s.folded ? "chevron-right" : "chevron-down")).size(10).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(s.name))
      .when(s.folded && s.rows.length > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(s.rows.length))))
      .when(g.can.plus, (el) => el.child(this.plusButton(`sub-plus-${key}`, g, s.id, t)));
  }

  list(d) {
    const out = [];
    const groups = this.tree.groups;
    const pinned = this.tree.pinned ?? [];
    if (pinned.length) {
      out.push(h_flex().h(24).px(8).gap(6).flex_none().items_center().text_size(11.5).text_color(d.t.muted)
        .child(svg(icon("pin")).size(11).flex_none().text_color(d.t.dim))
        .child(div().font_semibold().child("Pinned")));
      this.rows(out, pinned, null, 0, d);
      if (groups.length || this.tree.loose.length) out.push(div().h(1).mx(8).my(6).flex_none().bg(d.t.border));
    }
    groups.forEach((g, i) => {
      this.nav.push({ key: `g:${g.id}`, index: out.length, kind: "group", group: g.id, sub: null, folded: g.folded });
      out.push(this.groupHead(g, groups[i + 1]?.id ?? null, d));
      if (g.folded) return;
      this.rows(out, g.rows, { group: g.id, sub: null }, 0, d, `g:${g.id}`);
      out.push(...this.makingRows(g.id, null, 0, d));
      for (const s of g.subgroups) {
        const key = `s:${g.id}/${s.id}`;
        this.nav.push({ key, index: out.length, kind: "sub", group: g.id, sub: s.id, folded: s.folded, parent: `g:${g.id}` });
        out.push(this.subHead(g, s, d));
        if (!s.folded) this.rows(out, s.rows, { group: g.id, sub: s.id }, 16, d, key);
        if (!s.folded) out.push(...this.makingRows(g.id, s.id, 16, d));
      }
    });
    // A line between the Groups and the spaces in no Group.
    if (this.tree.loose.length && groups.length) out.push(div().h(1).mx(8).my(6).flex_none().bg(d.t.border));
    else if (this.tree.loose.length) out.push(div().h(8).flex_none());
    this.rows(out, this.tree.loose, { group: "", sub: null }, 0, d);
    const { t } = d;
    const over = this.pressed?.kind === "row" && this.over?.kind === "end";
    out.push(div().id("wranglr-end").flex_1().min_h(36).rounded(6)
      .when(over, (el) => el.border_t(2).border_color(t.accent))
      .on_mouse_move((e, cx) => this.hover({ kind: "end", id: "" }, e, cx))
      .on_mouse_up("left", (_e, cx) => { this.releaseEnd(cx); cx.notify(); }));
    return out;
  }

  // The rail: every row in Tree order, numbered as the select keys count.
  railRows(d) {
    const { t, live } = d;
    const byId = new Map();
    for (const g of this.tree.groups) for (const r of [...g.rows, ...g.subgroups.flatMap((s) => s.rows)]) byId.set(r.id, r);
    for (const r of [...this.tree.loose, ...(this.tree.pinned ?? [])]) byId.set(r.id, r);
    return this.tree.order.map((id, i) => {
      const w = live.get(id) ?? byId.get(id)?.space;
      return railCell(h_flex()
        .id(`space-${id}`)
        .relative()
        .w(RAIL_CELL)
        .h(26)
        .rounded(6)
        .justify_center()
        .items_center()
        .tooltip(w?.name ?? byId.get(id)?.name ?? "")
        .when(!!w?.active, (el) => el.bg(t.selected))
        .when(!w?.active, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => run("space.select", { id }))
        .child(div().text_color(w?.active ? t.foreground : t.muted).child(String(i + 1)))
        .child(div().absolute().right(5).text_color(tone(t, w?.status)).child(glyph(w?.status))));
    });
  }

  // One line per other Machine that is not connected, with the shipped Connect and login Copy.
  machineLines(t, collapsed) {
    const names = [...new Set([...this.machines.map((m) => m.name), ...Object.keys(this.reconnecting)])].sort();
    return names.flatMap((m) => {
      const repair = this.reconnecting[m];
      const machine = this.machines.find((k) => k.name === m) ?? repair?.machine;
      if (machine?.state === "connected" && !repair) return [];
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const state = (machine?.state ?? "asleep").replace(/_/g, " ");
      const server = svg(icon("server")).size(13).flex_none();
      if (collapsed) {
        return [railCell(h_flex().id(`machine-${m}`).w(RAIL_CELL).h(26).justify_center().items_center().rounded(6).text_color(t.dim)
          .tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : `${m} · ${state}`)
          .hover((s) => s.bg(t.hover))
          .on_click(() => { if (login) run("app.settings", { section: "machines" }); })
          .child(server))];
      }
      const head = h_flex().id(`machine-${m}`).h(26).flex_none().px(8).gap(7).items_center().text_size(11).text_color(t.dim)
        .child(server)
        .child(div().flex_1().truncate().child(m))
        .when(!rebuilt && !login, (el) => el.child(div().flex_none().child(state)))
        .when(rebuilt, (el) => el.child(h_flex().flex_none().gap(3).items_center()
          .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
          .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
            .hover((s) => s.text_color(t.foreground))
            .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
            .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
            .child(repair?.busy ? "Connecting…" : "Connect"))))
        .child(div().size(6).rounded(3).flex_none().bg(t.dim));
      const guidance = login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      return [head, ...guidance];
    });
  }

  headerButton(id, t, child, tip, onClick) {
    return div().id(id).h(26).min_w(26).px(4).flex_none().flex().items_center().justify_center().rounded(6)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(onClick).child(child);
  }

  renderOwner(cx) {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    this.kick(cx);

    const ps = panes();
    const d = { t, live: new Map(sp.map((s) => [s.id, s])), ps, leads: leadPanes(ps), ...(collapsed ? { agents: new Map(), labels: new Map() } : this.agentData(sp, ps)) };
    const onAgents = this.tab === "agents" && !collapsed;
    const waiting = collapsed ? 0 : agents().filter((a) => a.status === "blocked").length;
    const tabButton = (id, label, badge) => h_flex().id(`wranglr-tab-${id}`).h(24).px(7).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
      .text_color(this.tab === id ? t.foreground : t.dim)
      .when(this.tab === id, (el) => el.bg(t.selected))
      .when(this.tab !== id, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { this.showTab(id); cx.notify(); })
      .child(label)
      .when(badge > 0, (el) => el.child(div().px(4).rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).child(String(badge))));
    const sort = this.config.settings.sort;
    const header = h_flex().h(31).pl(9).pr(10).gap(2).items_center().text_size(11.5).text_color(t.dim)
      .when(collapsed, (el) => el.pl(0).pr(0).justify_center())
      .when(!collapsed, (el) => el.child(tabButton("spaces", "Spaces", 0)).child(tabButton("agents", "Agents", waiting)).child(div().flex_1().min_w(0)))
      .when(!collapsed && !onAgents, (el) => el
        .child(this.headerButton("wranglr-sort", t, div().text_size(11).child(SORT_LABEL[sort] ?? sort), "Sort: click for the next", (_e, cx) => this.dispatch({ type: "sort", value: null }, cx)))
        .child(this.headerButton("wranglr-group", t, svg(icon("folder-plus")).size(14), "New group", () => openInput({ title: "New group", value: "", action: { type: "addCustom" } })))
        .child(this.headerButton("wranglr-settings", t, svg(icon("settings")).size(14), "Wranglr settings", () => this.openSettings())))
      .child(this.headerButton("space-new", t, svg(icon("plus")).size(14), "New space", () => this.newSpace()));
    const warning = this.errors.length && !collapsed
      ? h_flex().id("wranglr-errors").mx(8).mb(4).px(8).h(24).flex_none().gap(6).items_center().rounded(6).bg(t.raised)
        .text_size(11).text_color(t.blocked).tooltip(this.errors.join("\n"))
        .child(div().flex_1().truncate().child(`wranglr.json: ${this.errors.length} problem${this.errors.length > 1 ? "s" : ""}`))
      : null;
    this.kb = this.handle.is_focused();
    const build = () => {
      this.nav = [];
      return !this.tree
        ? [h_flex().h(28).px(collapsed ? 0 : 8).items_center().when(collapsed, (el) => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…")]
        : collapsed ? this.railRows(d) : onAgents ? this.agentList(d) : this.list(d);
    };
    let body = build();
    // The cursor's row is gone, or the keys have just arrived: start again from the shown space.
    if (this.kb && this.nav.length && !this.nav.some((x) => x.key === this.cursor)) {
      this.cursor = this.firstCursor();
      this.reveal = true;
      body = build();
    }
    if (this.kb && this.reveal) {
      const at = this.nav.find((x) => x.key === this.cursor);
      if (at) this.scroll.scroll_to_item(at.index);
    }
    this.reveal = false;
    return v_flex().id("wranglr-keys").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_mouse_up("left", (_e, cx) => { if (this.pressed) { this.pressed = this.over = null; cx.notify(); } })
      .child(header)
      .when(Boolean(warning), (el) => el.child(warning))
      .child(v_flex().id("wranglr-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(6).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        .children(body))
      .when(this.kb && !collapsed, (el) => el.child(this.keyHelp(t)))
      .when(!this.kb && !collapsed && Boolean(this.keysKey), (el) => el.child(div().flex_none().px(12).py(4).text_size(10.5).text_color(t.dim).truncate()
        .child(`${this.keysKey} · keys for this list`)))
      .child(v_flex().flex_none().pb(8).children(this.machineLines(t, collapsed)));
  }

  // Herdr re-rendered: a sync or an overlay's action may be due. It runs in a task, never here.
  kick(cx) {
    if (this.kicked || !this.loaded) return;
    const msg = shared("wranglr.action");
    const waiting = typeof msg?.n === "number" && msg.n !== this.handled;
    if (!waiting && this.inputsKey(this.world(null)) === this.syncedKey) return;
    this.kicked = true;
    try { cx.spawn(async (cx) => this.tick(cx)); } catch { this.kicked = false; }
  }

  // Overlays

  initInput(cx) {
    const p = props() ?? {};
    const move = this.dialog === "move";
    this.text = move ? "" : p.value ?? "";
    this.input = InputState.new(move ? { placeholder: "Filter groups…" } : { value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.at = null;
    this.scroll = ScrollHandle.new();
  }

  // Move dialog choices: "No group", then each Group and its Subgroups, filtered by words.
  choices() {
    const view = shared("wranglr.view") ?? { groups: [] };
    const all = [{ group: "", sub: null, label: "No group", words: "no group loose" }];
    for (const g of view.groups ?? []) {
      all.push({ group: g.id, sub: null, label: g.name, kind: g.kind, words: g.name });
      for (const s of g.subgroups ?? []) all.push({ group: g.id, sub: s.id, label: s.name, parent: g.name, words: `${g.name} ${s.name}` });
    }
    const words = this.text.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => words.every((w) => c.words.toLowerCase().includes(w)));
  }

  submit() {
    const p = props() ?? {};
    if (this.dialog === "move") {
      const c = this.choices()[this.at ?? 0];
      if (c) send({ type: "move", space: p.space, group: c.group, sub: c.sub });
    } else {
      const text = this.text.trim();
      if (text) send({ ...p.action, [textKey(p.action)]: text });
    }
    closeOverlay(p.overlay);
  }

  renderMove() {
    const t = theme();
    const p = props() ?? {};
    const list = this.choices();
    const here = p.at ?? null;
    if (this.at === null) this.at = Math.max(0, list.findIndex((c) => here && c.group === here.group && (c.sub ?? null) === (here.sub ?? null)));
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    const name = spaces().find((s) => s.id === p.space)?.name ?? "space";
    return v_flex().id("wranglr-move").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(p.overlay);
        else if (e.key === "down" && list.length) this.at = (this.at + 1) % list.length;
        else if (e.key === "up" && list.length) this.at = (this.at + list.length - 1) % list.length;
        else return;
        this.scroll.scroll_to_item(this.at);
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().truncate().text_size(15).font_semibold().text_color(t.foreground).child(`Move ${name}`))
        .child(div().id("wm-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(p.overlay)).child("Esc")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg(icon("search")).size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().id("wm-list").max_h(300).min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(list.map((c, i) => {
          const current = here && c.group === here.group && (c.sub ?? null) === (here.sub ?? null);
          return h_flex().id(`wm-${i}`).h(30).flex_none().mx(2).px(10).gap(8).items_center().rounded(7).cursor_pointer()
            .when(c.sub != null, (el) => el.pl(30))
            .when(i === this.at, (el) => el.bg(t.selected))
            .hover((s) => s.bg(t.hover))
            .on_click(() => { this.at = i; this.submit(); })
            .when(c.sub == null, (el) => el.child(svg(icon(c.kind ? KIND_ICON[c.kind] : "minus")).size(13).flex_none().text_color(t.dim)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.label))
            .when(Boolean(current), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("current")));
        })));
  }

  renderInput() {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("wranglr-input").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(p.title ?? ""))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(textKey(p.action) === "branch" ? "Branch" : "Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("wi-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("wi-save", "Save", true, () => this.submit())));
  }

  // The settings dialogs. Each saves only what changed, and shows what is wrong under its field.

  // One text input per key of `text`, kept in this.inputs.
  makeInputs(text, hint, save) {
    this.wasText = { ...text };
    this.text = { ...text };
    this.bad = {};
    this.inputs = {};
    for (const key of Object.keys(text)) {
      const input = InputState.new({ value: text[key], placeholder: hint(key) });
      input.on("change", (_e, cx) => { this.text[key] = input.value(); delete this.bad[key]; cx.notify(); });
      input.on("submit", (_e, cx) => { save(); cx?.notify?.(); });
      this.inputs[key] = input;
    }
  }

  // The text fields that differ from what the dialog opened with, trimmed.
  changedText() {
    const out = {};
    for (const key of Object.keys(this.text)) {
      const raw = String(this.text[key] ?? "").trim();
      if (raw !== String(this.wasText[key] ?? "").trim()) out[key] = raw;
    }
    return out;
  }

  field(t, label, control, key, about) {
    const why = this.bad[key];
    return v_flex().gap(6)
      .child(div().text_size(11.5).text_color(t.dim).child(label))
      .child(control)
      .when(Boolean(why || about), (el) => el.child(div().text_size(11).text_color(why ? t.blocked : t.dim).child(why ? `This ${why}.` : about)));
  }

  // A field on one line: its label, then a short control.
  inline(t, label, control, key) {
    const why = this.bad[key];
    return v_flex().gap(6)
      .child(h_flex().gap(10).items_center().child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(label)).child(control))
      .when(Boolean(why), (el) => el.child(div().text_size(11).text_color(t.blocked).child(`This ${why}.`)));
  }

  choice(t, id, label, on, click, badge) {
    return h_flex().id(id).h(28).px(11).gap(6).items_center().rounded(7).border_1().cursor_pointer()
      .border_color(on ? t.accent : t.input).bg(on ? t.selected : t.raised).text_size(12).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground))
      .on_click(click)
      .when(badge != null, (el) => el.child(div().text_size(11).text_color(t.accent).child(String(badge))))
      .child(label);
  }

  textInput(t, key) {
    return Input.new(this.inputs[key]).h(32).px(10).rounded(8).border_1().border_color(this.bad[key] ? t.blocked : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
  }

  // need: the fields' height when it may pass the window's. They then scroll, and Save stays in view.
  dialogFrame(t, id, title, fields, save, need) {
    const p = props() ?? {};
    const button = (bid, label, primary, action) => h_flex().id(bid).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(label);
    // A dialog gets most of the window's height. `window` here is Herdr's: the GPUI one is the global.
    let most = 480;
    try { most = Math.max(200, globalThis.window.viewport_size().height * 0.85 - 230); } catch {}
    return v_flex().id(id).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .w_full().min_h(0).p(18).gap(14).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().child(title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      // A scroll area has no height of its own in a dialog, which is as tall as its content: it is given one.
      .when(!need || need <= most, (el) => el.children(fields))
      .when(Boolean(need) && need > most, (el) => el.child(v_flex().id(`${id}-fields`).h(Math.min(most, need)).flex_none().gap(14).pr(14).overflow_y_scrollbar()
        .children(fields.map((f) => div().flex_none().child(f)))))
      .child(h_flex().flex_none().pt(4).gap(8).justify_end()
        .child(button(`${id}-cancel`, "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button(`${id}-save`, "Save", true, (_e, cx) => { save(); cx.notify(); })));
  }

  machineLabel(mk) {
    return mk === "" ? "This computer" : mk;
  }

  // The settings menu: the `settings` block of wranglr.json.
  initSettings(cx) {
    const p = props() ?? {};
    const s = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
    this.known = Array.isArray(p.known) ? p.known.filter((m) => typeof m === "string") : [""];
    this.was = { sort: s.sort, plus: s.plus, autoname: s.autoname, agents: s.agents !== false, revive: s.revive !== false, machine: typeof s.machine === "string" ? s.machine : null };
    this.pick = { ...this.was };
    const hint = { worktrees: DEFAULT_SETTINGS.worktrees, ticket: DEFAULT_SETTINGS.ticket, agent: "Empty: a plain terminal", folder: "Empty: the home folder" };
    this.makeInputs(
      { worktrees: String(s.worktrees ?? ""), ticket: String(s.ticket ?? ""), agent: Array.isArray(s.agent) ? s.agent.join(" ") : "", folder: String(s.folder ?? "") },
      (key) => hint[key], () => this.saveSettings());
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  saveSettings() {
    const values = {}, bad = {};
    for (const key of Object.keys(this.pick)) if (this.pick[key] !== this.was[key]) values[key] = this.pick[key];
    for (const [key, raw] of Object.entries(this.changedText()))
      // An empty field is the default: a plain terminal for the agent.
      values[key] = key === "agent" ? (raw ? raw.split(/\s+/) : null) : raw || DEFAULT_SETTINGS[key];
    for (const [key, value] of Object.entries(values)) {
      const why = settingError(key, value);
      if (why) bad[key] = why;
    }
    this.bad = bad;
    if (Object.keys(bad).length) return;
    if (Object.keys(values).length) send({ type: "settings", values });
    closeOverlay(props()?.overlay);
  }

  renderSettings() {
    const t = theme();
    const pick = (key, options) => h_flex().flex_wrap().gap(5).children(options.map(([value, label]) =>
      this.choice(t, `ws-${key}-${value}`, label, this.pick[key] === value, (_e, cx) => { this.pick[key] = value; delete this.bad[key]; cx.notify(); })));
    const onOff = (key) => pick(key, [[true, "On"], [false, "Off"]]);
    const head = (title, first) => div().when(!first, (el) => el.mt(4).pt(12).border_t(1).border_color(t.border))
      .text_size(11).font_semibold().text_color(t.muted).child(title);
    return this.dialogFrame(t, "wranglr-settings", "Wranglr settings", [
      head("The list", true),
      this.field(t, "Sort", pick("sort", Object.entries(SORT_LABEL)), "sort"),
      this.inline(t, "Agent status on rows", onOff("agents"), "agents"),
      head("New spaces"),
      this.field(t, "Machine", pick("machine", [[null, "Not set"], ...this.known.map((mk) => [mk, this.machineLabel(mk)])]), "machine", "Used when a Group names none."),
      this.field(t, "Folder for the header +", this.textInput(t, "folder"), "folder"),
      this.field(t, "Command to run", this.textInput(t, "agent"), "agent"),
      this.field(t, "+ on a Repo group", pick("plus", [["open", "Open the main checkout"], ["worktree", "New worktree"]]), "plus", "Right-click + for the other."),
      head("Worktrees and names"),
      this.field(t, "Worktree location", this.textInput(t, "worktrees"), "worktrees", "{clone}, {branch} and {repo} are filled in."),
      this.inline(t, "Name spaces from their branch", onOff("autoname"), "autoname"),
      this.field(t, "Ticket pattern", this.textInput(t, "ticket"), "ticket", "A regular expression. Its first group is the ticket id."),
      head("Restart"),
      this.inline(t, "Resume Claude Code agents", onOff("revive"), "revive"),
    ], () => this.saveSettings(), 870 + 22 * Object.keys(this.bad).length);
  }

  // A Group's settings: Machines for every kind, worktree rules for a Repo, homes for a Workspace.
  initGroup(cx) {
    const p = props() ?? {};
    const v = p.values ?? {};
    const strings = (list) => (Array.isArray(list) ? [...new Set(list.filter((m) => typeof m === "string"))] : []);
    this.kind = p.group?.kind;
    this.known = [...new Set(["", ...strings(p.known)])];
    this.wasList = strings(v.machines);
    this.list = [...this.wasList];
    const text = {};
    if (this.kind === "repo") { text.worktrees = String(v.worktrees ?? ""); text.from = String(v.from ?? ""); }
    if (this.kind === "workspace") for (const mk of this.known) text[`home:${mk}`] = String(v.homes?.[mk] ?? "");
    const hint = (key) => key === "worktrees" ? String(p.worktrees ?? DEFAULT_SETTINGS.worktrees) : key === "from" ? "The Repo's default branch" : "The folder that holds its Repos";
    this.makeInputs(text, hint, () => this.saveGroup());
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  saveGroup() {
    const p = props() ?? {};
    const values = {};
    if (JSON.stringify(this.list) !== JSON.stringify(this.wasList)) values.machines = [...this.list];
    for (const [key, raw] of Object.entries(this.changedText())) {
      if (key.startsWith("home:")) (values.homes ??= {})[key.slice(5)] = raw;
      else values[key] = raw;
    }
    this.bad = groupError(this.kind, values);
    if (Object.keys(this.bad).length) return;
    if (Object.keys(values).length && p.group?.id) send({ type: "groupSettings", group: p.group.id, values });
    closeOverlay(p.overlay);
  }

  renderGroup() {
    const t = theme();
    const p = props() ?? {};
    const toggle = (mk) => (_e, cx) => {
      this.list = this.list.includes(mk) ? this.list.filter((m) => m !== mk) : [...this.list, mk];
      delete this.bad.machines;
      cx.notify();
    };
    const picker = h_flex().flex_wrap().gap(5).children(this.known.map((mk) => {
      const at = this.list.indexOf(mk);
      return this.choice(t, `wg-m-${mk}`, this.machineLabel(mk), at >= 0, toggle(mk), at >= 0 ? at + 1 : null);
    }));
    const fields = [this.field(t, "Machines, in order of preference", picker, "machines",
      "Click to add or remove. + starts on the first one that is ready. None: the default Machine.")];
    if (this.kind === "repo") {
      fields.push(this.field(t, "Worktree location", this.textInput(t, "worktrees"), "worktrees", "Starts with {clone} or is an absolute path. Empty: the setting."));
      fields.push(this.field(t, "New branches start from", this.textInput(t, "from"), "from", "A ref such as origin/staging. Empty: the Repo's default branch."));
    }
    if (this.kind === "workspace")
      for (const mk of this.known) fields.push(this.field(t, `Workspace home on ${mk === "" ? "this computer" : mk}`, this.textInput(t, `home:${mk}`), `home:${mk}`));
    const kind = { workspace: "Workspace", repo: "Repo", custom: "Group" }[this.kind] ?? "Group";
    const bad = this.bad.settings ? [div().text_size(11).text_color(t.blocked).child(`These ${this.bad.settings}.`)] : [];
    // About what the fields take: a Workspace has a home for each Machine, which can be more than the window holds.
    const need = fields.length * 82 + 22 * (Object.keys(this.bad).length + 1);
    return this.dialogFrame(t, "wranglr-group", `${kind} settings: ${p.group?.name ?? ""}`, [...fields, ...bad], () => this.saveGroup(), need);
  }

  // Asks before closing a Group's spaces. Enter confirms, Esc cancels.
  renderConfirm() {
    const t = theme();
    const p = props() ?? {};
    const yes = () => { closeOverlay(p.overlay); if (p.action) send(p.action); };
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.blocked : t.input).bg(primary ? t.blocked : t.raised)
      .text_color(primary ? "#ffffff" : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().id("wranglr-confirm").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") yes();
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
      })
      .w_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(15).font_semibold().child(p.title ?? ""))
      .child(div().text_size(12.5).text_color(t.muted).child(p.detail ?? ""))
      .child(h_flex().pt(10).gap(8).justify_end()
        .child(button("wc-cancel", "Cancel", false, () => closeOverlay(p.overlay)))
        .child(button("wc-yes", p.yes ?? "Close", true, yes)));
  }

  choose(item) {
    closeOverlay(props()?.overlay);
    if (!item) return;
    if (item.dialog) openOverlay({ mod: "wranglr", kind: "dialog", width: item.width ?? 460, props: item.dialog });
    else if (item.run) run(item.run.name, item.run.args ?? {});
    else if (item.overlay) openOverlay(item.overlay);
    else if (item.shipped) openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: item.shipped });
    else if (item.input) openInput(item.input);
    else if (item.action) send(item.action);
  }

  menuIcon(item) {
    if (item.icon) return item.icon;
    if (item.dialog) return "settings";
    const type = item.input?.action?.type ?? item.action?.type;
    if (type === "plus") return item.input ? "git-branch" : "plus";
    if (/^remove|^dismiss/.test(type)) return "x";
    if (/^rename/.test(type)) return "square-pen";
    return "folder-plus";
  }

  renderMenu() {
    const t = theme();
    const list = props()?.items ?? [];
    return v_flex().id("wranglr-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down" && list.length) this.at = (this.at + 1) % list.length;
        else if (e.key === "up" && list.length) this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(list[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else {
          const hit = list.find((it) => it.key && it.key === String(e.key ?? "").toLowerCase());
          if (!hit) return;
          this.choose(hit);
        }
        cx.stop_propagation();
        cx.notify();
      })
      .children(list.map((it, i) => h_flex().id(`wmi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.choose(it))
        .child(svg(icon(this.menuIcon(it))).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().truncate().child(it.label))
        .when(Boolean(it.key), (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(11).text_color(t.muted).child(String(it.key).toUpperCase())))));
  }

  render(cx) {
    if (this.dialog === "move") return this.renderMove();
    if (this.dialog === "input") return this.renderInput();
    if (this.dialog === "menu") return this.renderMenu();
    if (this.dialog === "settings") return this.renderSettings();
    if (this.dialog === "group") return this.renderGroup();
    if (this.dialog === "confirm") return this.renderConfirm();
    if (this.dialog) return div();
    return this.renderOwner(cx);
  }
}
