// Brunr: Bruno Collections in a side panel, run with the Bruno CLI, Responses in a pane.
// One mod draws every part. The copy is chosen by its props:
//   { view: "response", tab }  the Request and Response pane of a tab (response.js, request.js)
//   { picker } / { menu }       a popup over the panel or the pane (popup.js)
//   { dialog }                  a save, Run or delete question (popup.js, saveflow.js)
//   { form }                    New Request, New folder, Rename or Clone (forms.js, actions.js)
//   { overlay } alone           opened by its key (mod.open): toggles the panel, closes
//   none                        the panel (panel.js)
// Config: brunr.json in the app home. Nothing from a Response is written to disk. Request files
// are changed only through effects.js, and Drafts live in memory (drafts.js).
import { View } from "gpui-kit";
import { ScrollHandle } from "gpui-base";
import { checking, closeOverlay, focused, layout, nextCommand, notify, openOverlay, panes, props, run } from "herdr";
import * as sources from "./sources.js";
import * as machine from "./machine.js";
import * as store from "./store.js";
import * as tree from "./tree.js";
import * as panel from "./panel.js";
import * as response from "./response.js";
import * as popup from "./popup.js";
import * as drafts from "./drafts.js";
import * as saveflow from "./saveflow.js";
import * as actions from "./actions.js";
import * as forms from "./forms.js";
import { findNode } from "./parser.js";
import { planRun, plannedRequests } from "./plan.js";
import { parseProgress, progressOf } from "./progress.js";

const REMOTE_REFRESH = 30000;
const machineKey = (m) => m ?? "";

export default class Brunr extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    const p = props() ?? {};
    if (p.view === "response") { this.mode = "response"; return response.init(this, cx); }
    if (p.picker) { this.mode = "picker"; return popup.init(this, cx); }
    if (p.menu) { this.mode = "menu"; return popup.init(this, cx); }
    if (p.dialog) { this.mode = "dialog"; return popup.init(this, cx); }
    if (p.form) { this.mode = "form"; return forms.init(this, cx); }
    if (p.overlay != null) {
      // Opened by its key: a hidden panel hears no commands, and mod.open always runs.
      this.mode = "pass";
      const block = tree.findBlock(layout(), "brunr");
      // A toggle: a shown panel is hidden, a hidden one is shown and given the keyboard.
      if (block?.shown) store.ask({ kind: "hide" });
      else {
        if (block?.id) run("layout.show", { id: block.id });
        store.ask({ kind: "keys" });
      }
      closeOverlay(p.overlay);
      return;
    }
    this.mode = "panel";
    this.addr = "panel";
    this.question = null;         // the open dialog's question (saveflow.js)
    this.saving = null;           // the save in progress (saveflow.js)
    this.saved = new store.Saved(globalThis.localStorage);
    this.found = null;            // discover()'s result
    this.loaded = new Map();      // Collection key -> { collection?, error?, loading? }
    this.cli = {};                // Machine key -> checkCli()'s result, or "checking"
    this.watches = new Map();     // Collection root here -> its pending watch
    this.rows = [];
    this.sel = null;              // the selected row's key
    this.hover = null;            // the row under the pointer
    this.reveal = null;           // a row key to scroll into view
    this.scroll = ScrollHandle.new();
    this.kb = false;              // the panel holds the keyboard
    this.gone = false;            // the keyboard left the panel
    this.heldAt = 0;
    this.pending = null;          // the folder or Collection Run a confirmation asks about
    this.loadingAll = true;
    this.busy = false;            // a tree action is running (actions.js)
    this.forms = new Map();       // open forms by id: { kind, row, parent, initialFile }
    this.pressed = null;          // the row pressed for a drag
    this.over = null;             // the drop under the pointer: { key, zone, drop }
    this.seenAsk = store.lastAsk();
    if (checking()) return;
    // The pane's Run: the pane has saved its Draft first, by the same save path.
    store.setRequestRunner((cx, key) => this.runKey(cx, key, false, true));

    cx.spawn(async (cx) => { await machine.clearLocalReports().catch(() => {}); await this.reload(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "reload") await this.reload(cx);
        else if (c === "focus") { this.gotFocus = true; this.enterKeys(); }
        else if (c === "hide") this.hidePanel();
        else if (c === "runConfirmed" && this.pending) { const key = this.pending; this.pending = null; this.runKey(cx, key, true); }
        cx.notify();
      }
    });
    cx.spawn(async (cx) => { for (;;) { await store.nextChange(); cx.notify(); } });
    cx.spawn(async (cx) => { for (;;) { await drafts.nextChange(); cx.notify(); } });
    cx.timer.every(REMOTE_REFRESH, (cx) => this.refreshRemote(cx));
  }

  async close() {
    if (this.mode === "response") return response.close(this);
    if (this.mode === "form") return forms.close(this);
    if (this.mode === "panel") store.setRequestRunner(null);
    for (const w of this.watches?.values() ?? []) w.cancel();
    this.watches?.clear();
  }

  render(cx) {
    if (this.mode === "response") return response.render(this, cx);
    if (this.mode === "picker" || this.mode === "menu" || this.mode === "dialog") return popup.render(this, cx);
    if (this.mode === "form") return forms.render(this, cx);
    if (this.mode === "pass") return panel.empty();
    const a = store.takeAsk(this.seenAsk);
    if (a) { this.seenAsk = a.n; this.takeAsk(cx, a); }
    return panel.render(this, cx);
  }

  // Loading

  async reload(cx) {
    this.loadingAll = true;
    cx.notify();
    const config = await sources.readConfig();
    this.found = await sources.discover(config);
    const keep = new Set(this.found.entries.map((e) => e.key));
    for (const k of [...this.loaded.keys()]) if (!keep.has(k)) this.loaded.delete(k);
    this.checkClis(cx, true);
    await Promise.all(this.found.entries.map((e) => this.loadOne(cx, e)));
    this.loadingAll = false;
    this.startWatches(cx);
    cx.notify();
  }

  async loadOne(cx, entry) {
    const prev = this.loaded.get(entry.key) ?? {};
    this.loaded.set(entry.key, { ...prev, loading: true });
    const { files, ...r } = await sources.loadCollection(entry);
    // The texts just read tell the Drafts whether a shown Request changed on disk. They are not kept.
    if (files) drafts.collectionRead(entry.key, files);
    this.loaded.set(entry.key, { ...r, loading: false });
    cx.notify();
  }

  /** One `bru` and `node` check per Machine, at start and on reload. */
  checkClis(cx, again) {
    const ms = new Set((this.found?.entries ?? []).map((e) => machineKey(e.machine)));
    for (const m of ms) {
      if (!again && this.cli[m]) continue;
      this.cli[m] = "checking";
      cx.spawn(async (cx) => { this.cli[m] = await machine.checkCli(m || null); cx.notify(); });
    }
  }

  /** Watches each Collection root on this computer. A watch that starts reloads, as idle ones can be reclaimed. */
  startWatches(cx) {
    const roots = new Map(this.found.entries.filter((e) => e.machine == null).map((e) => [e.root, e]));
    for (const [root, w] of [...this.watches]) if (!roots.has(root)) { w.cancel(); this.watches.delete(root); }
    for (const [root] of roots) {
      if (this.watches.has(root)) continue;
      this.watches.set(root, null);
      cx.spawn(async (cx) => {
        let first = true;
        for (;;) {
          const entry = this.found?.entries.find((e) => e.machine == null && e.root === root);
          if (!entry || !this.watches.has(root)) return;
          let w;
          try { w = machine.watch(root); } catch { this.watches.delete(root); return; }
          this.watches.set(root, w);
          if (!first) await this.loadOne(cx, entry);
          first = false;
          try { await w; } catch { this.watches.delete(root); return; }
          if (this.watches.get(root) !== w) return; // cancelled, or the root left the config
        }
      });
    }
  }

  refreshRemote(cx) {
    for (const e of this.found?.entries ?? []) if (e.machine != null) cx.spawn(async (cx) => { await this.loadOne(cx, e); });
  }

  // Facts the view asks for

  entry(ck) { return this.found?.entries.find((e) => e.key === ck) ?? null; }
  collection(ck) { return this.loaded.get(ck)?.collection ?? null; }

  /** The Environment a Run of this Collection uses, and its secret variable names. */
  envOf(entry, collection) {
    const name = store.chosenEnv(this.saved, entry.key, collection);
    const env = collection?.environments.find((e) => e.name === name);
    return { name, secrets: (env?.variables ?? []).filter((v) => v.secret).map((v) => v.name) };
  }

  globalOf(wsPath) {
    const g = this.saved.globalEnv(wsPath);
    return g && this.found?.workspace?.globals.includes(g) ? g : null;
  }

  buildRows() {
    this.rows = tree.buildRows({
      entries: this.found?.entries ?? [], loaded: this.loaded, workspace: this.found?.workspace ?? null,
      isOpen: (k, d) => this.saved.isOpen(k, d), envOf: (e, c) => this.envOf(e, c), globalOf: (p) => this.globalOf(p),
    });
    if (this.rows.length && !this.rows.some((r) => r.key === this.sel)) this.sel = this.rows[0].key;
    return this.rows;
  }

  /** False when `bru` was found missing on the row's Machine. */
  canRun(row) {
    const c = this.cli[machineKey(row?.machine)];
    return !store.running() && !(c && c !== "checking" && !c.bru);
  }

  // Keys, as Dockr has them

  enterKeys() { this.gone = false; this.handle.focus(); }

  leaveKeys() { this.gone = true; run("pane.go", { direction: "left" }); }

  hidePanel() {
    this.gone = true;
    this.heldAt = 0;
    run("pane.go", { direction: "left" });
    const block = tree.findBlock(layout(), "brunr");
    if (block?.id) run("layout.hide", { id: block.id });
  }

  /** Hides the panel when another pane holds the keyboard, so focus stays where it is. */
  hideOnly() {
    const block = tree.findBlock(layout(), "brunr");
    if (block?.id) run("layout.hide", { id: block.id });
  }

  /** The key on a hidden panel: it takes the keyboard. Pressed again while holding it, it hides. */
  keysCommand(cx) {
    if (Date.now() - this.heldAt < 1500) return this.hidePanel();
    if (this.grabbing) return;
    this.grabbing = true;
    this.gotFocus = false;
    this.grabStep(cx, 0);
  }

  /**
   * Only Herdr moves the keyboard off a terminal, one pane.go at a time: step right until the
   * panel's "focus" command arrives. A panel the key has just shown is laid out a frame later,
   * so each step waits a moment.
   */
  grabStep(cx, i) {
    if (this.gotFocus || i >= 8) { this.grabbing = false; cx.notify(); return; }
    run("pane.go", { direction: "right" });
    cx.timer.after(150, (cx) => this.grabStep(cx, i + 1));
  }

  panelKey(e, cx) {
    if (e.key === "escape" && actions.cancelDrag(this)) { cx.stop_propagation(); cx.notify(); return; }
    if (!this.kb) return;
    const altArrow = e.keystroke === "alt-up" || e.keystroke === "alt-down";
    if (e.modifiers.control || (e.modifiers.alt && !altArrow) || e.modifiers.platform) return;
    const at = Math.max(0, this.rows.findIndex((r) => r.key === this.sel));
    const a = tree.keyAction(e.key === "enter" ? "enter" : e.keystroke, this.rows, at);
    if (!a) return;
    cx.stop_propagation();
    this.act(cx, a);
    cx.notify();
  }

  act(cx, a) {
    if (a.act === "move") { this.sel = this.rows[a.to]?.key ?? this.sel; this.reveal = this.sel; }
    else if (a.act === "leave") this.leaveKeys();
    else if (a.act === "fold") this.saved.setOpen(a.key, a.open);
    else if (a.act === "run" || a.act === "runMany") this.runKey(cx, a.row.key, false);
    else if (a.act === "env") this.openEnvPicker(a.row, true);
    else if (a.act === "global") this.openGlobalPicker(a.row, true);
    else if (a.act === "open") this.openRequest(a.row);
    else if (a.act === "bruno") this.openBruno(cx);
    else actions.act(this, cx, a);
  }

  takeAsk(cx, a) {
    if (a.kind === "keys") return this.keysCommand(cx);
    if (a.kind === "hide") return this.kb ? this.hidePanel() : this.hideOnly();
    if (a.kind === "env") return this.saved.setEnv(a.key, a.value);
    if (a.kind === "global") return this.saved.setGlobalEnv(a.key, a.value);
    if (a.kind === "dialog") return saveflow.answer(this, cx, a);
    if (actions.takeAsk(this, cx, a)) return;
    if (a.kind === "act") {
      const row = this.rowFor(a.key);
      if (!row) return;
      if (this.rows.some((r) => r.key === row.key)) this.sel = row.key;
      if (a.action === "reload") return void cx.spawn(async (cx) => { await this.reload(cx); });
      this.act(cx, { act: a.action, row });
    }
  }

  // Clicks

  clickRow(cx, row, e) {
    this.sel = row.key;
    this.gone = false;
    if (row.kind === "request" && e?.click_count !== 2) {
      // A click shows the Request in this tab's pane when there is one. It never opens a pane.
      const tab = this.paneTab();
      if (tab) store.showRequest(tab, this.requestInfo(row));
    }
    if (e?.click_count === 2 && row.kind === "request") this.runKey(cx, row.key, false);
    else if (e?.click_count === 2 && tree.foldable(row)) this.saved.setOpen(row.key, !row.open);
    else if (row.kind === "global") this.openGlobalPicker(row);
    cx.notify();
  }

  toggle(cx, row) { this.sel = row.key; this.saved.setOpen(row.key, !row.open); cx.notify(); }

  openMenu(row) { actions.menu(this, row); }

  /** A picker opened by a key is a dialog in the middle; by a click, a popup at the pointer. */
  openEnvPicker(row, byKey = false) {
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    if (!entry || !c) return;
    const current = this.envOf(entry, c).name;
    const options = [{ label: "No Environment", value: null }, ...c.environments.map((env) => {
      const secrets = env.variables.filter((v) => v.secret).map((v) => v.name);
      return { label: env.name, value: env.name, warn: tree.secretWarning(secrets) };
    })];
    openOverlay({ mod: "brunr", kind: byKey ? "dialog" : "popup", width: 300, height: popup.pickerHeight(options), props: { picker: { kind: "env", key: entry.key, title: `Environment of ${c.name}`, options, current } } });
  }

  openGlobalPicker(row, byKey = false) {
    const options = [{ label: "No Global environment", value: null }, ...row.options.map((n) => ({ label: n, value: n }))];
    openOverlay({ mod: "brunr", kind: byKey ? "dialog" : "popup", width: 300, height: popup.pickerHeight(options), props: { picker: { kind: "global", key: row.wsPath, title: "Global environment", options, current: row.env } } });
  }

  // Runs

  /** Runs the row: a Request at once, a folder or Collection after a confirmation. */
  runKey(cx, key, confirmed, saved = false) {
    const row = this.rowFor(key);
    if (!row || !row.ck || !this.canRun(row) || row.broken) return;
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    if (!entry || !c) return;
    const target = row.kind === "request" ? { kind: "request", path: row.path } : row.kind === "folder" ? { kind: "folder", path: row.path } : { kind: "collection" };
    const environment = this.envOf(entry, c).name;
    const ws = entry.workspace && this.found?.workspace?.path === entry.workspace ? this.found.workspace : null;
    const globalEnvironment = ws ? this.globalOf(ws.path) : null;
    // A Run uses what the pane shows: a Request's Draft is saved first, by the same save path.
    if (target.kind === "request" && !saved && drafts.has(row.key)) {
      saveflow.saveAll(this, cx, [this.requestInfo(row)], (cx, ok) => { if (ok) this.runKey(cx, key, confirmed, true); });
      return;
    }
    if (target.kind !== "request" && !confirmed && this.askDrafts(cx, row, entry, c, target, environment)) return;
    if (target.kind !== "request" && !confirmed) {
      const plan = planRun({ collection: c, target, environment, reportPath: "" });
      if (!plan.count) { notify({ title: "Nothing to run", body: `"${row.name}" has no Requests.`, level: "info" }); return; }
      this.pending = key;
      openOverlay({ mod: "confirm", kind: "dialog", width: 440, height: 170, props: {
        title: tree.confirmText(plan.count, row.name, environment),
        detail: `The Bruno CLI sends them one after another${entry.machine ? ` on ${entry.machine}` : ""}. Enter runs, Esc cancels.`,
        command: { name: "brunr.runConfirmed", args: {} },
      } });
      return;
    }
    const tab = this.responseTab();
    if (!tab) { notify({ title: "Brunr", body: "No tab to show the Response in.", level: "warning" }); return; }
    if (target.kind === "request") store.showRequest(tab, this.requestInfo(row));
    // The Requests the CLI is expected to send, in its order, so the progress can name the next one.
    // A single Request Run looks as it always did, so it has no progress.
    const many = target.kind !== "request";
    const planned = plannedRequests(c, target);
    const info = { key, ck: row.ck, kind: target.kind, label: row.name, method: row.method ?? null, url: row.url ?? null, environment, collection: c.name, machine: entry.machine ?? null, tree: c, target, planned };
    if (!store.beginRun(tab, info, many ? progressOf({ planned, finished: [] }) : null)) return;
    const onProgress = many ? (text) => store.setProgress(tab, progressOf({ planned, finished: parseProgress(text).finished })) : null;
    cx.spawn(async (cx) => {
      const result = await machine.runBru({ machine: entry.machine ?? null, collection: c, target, environment, globalEnvironment, workspacePath: ws?.dir ?? null, timer: many ? cx.timer : null, onProgress });
      store.finishRun(tab, result);
      cx.notify();
    });
  }

  /** The tab whose Response pane shows the next Run, opening the pane when the tab has none. */
  responseTab() {
    const f = focused();
    const tab = f?.tab ?? null;
    if (tab && panes().some((p) => p.mod === "brunr" && p.tab === tab)) return tab;
    if (tab && f?.pane) {
      run("pane.split", { pane: f.pane, direction: "right", mod: "brunr", props: { view: "response", tab } });
      return tab;
    }
    run("tab.new", { mod: "brunr", props: { view: "response" } });
    return focused()?.tab ?? null;
  }

  /**
   * A folder or Collection Run with Drafts in it asks first: save them and run, run without saving,
   * or cancel. True when it asked.
   */
  askDrafts(cx, row, entry, c, target, environment) {
    const withDrafts = plannedRequests(c, target).map((n) => ({ ...n, key: `${entry.key}#${n.path}` })).filter((n) => drafts.has(n.key));
    if (!withDrafts.length) return false;
    const n = withDrafts.length;
    const count = planRun({ collection: c, target, environment, reportPath: "" }).count;
    saveflow.ask(this, {
      title: `${n} ${n === 1 ? "Request has" : "Requests have"} unsaved changes.`,
      detail: `Save them and run, run without saving, or cancel. ${tree.confirmText(count, row.name, environment)}`,
      choices: [{ id: "cancel", label: "Cancel" }, { id: "run", label: "Run without saving" }, { id: "save", label: "Save and run", primary: true }],
    }, (cx, choice) => {
      if (choice === "run") this.runKey(cx, row.key, true);
      else if (choice === "save") saveflow.saveAll(this, cx, withDrafts.map((r) => this.requestInfo({ ...r, ck: entry.key })), (cx, ok) => { if (ok) this.runKey(cx, row.key, true); });
    });
    return true;
  }

  /** A row by key: the visible one, or one built from the Collection for a Request in a folded folder. */
  rowFor(key) {
    const row = this.buildRows().find((r) => r.key === key);
    if (row) return row;
    const entry = this.found?.entries.find((e) => key.startsWith(`${e.key}#`));
    const c = entry && this.collection(entry.key);
    const n = c && findNode(c, key.slice(entry.key.length + 1));
    if (!n) return null;
    const base = { key, kind: n.kind, ck: entry.key, machine: entry.machine ?? null, path: n.path, name: n.name, depth: 0, parent: null };
    return n.kind === "folder" ? { ...base, open: false, count: 0 } : { ...base, method: n.method, url: n.url, type: n.type, ...(n.broken ? { broken: true, error: n.error } : {}) };
  }

  /** What the pane needs to show a Request: `{ key, ck, machine, root, path, format, name }`. */
  requestInfo(row) {
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    return { key: row.key, ck: row.ck, machine: entry?.machine ?? null, root: entry?.root ?? "", path: row.path, format: c?.format ?? "yaml", name: row.name };
  }

  /** The focused tab when it has a Brunr pane, else null. */
  paneTab() {
    const tab = focused()?.tab ?? null;
    return tab && panes().some((p) => p.mod === "brunr" && p.tab === tab) ? tab : null;
  }

  /** "Open": shows the Request in the pane, opening the pane when the tab has none. */
  openRequest(row) {
    if (row?.kind !== "request" || !this.entry(row.ck)) return;
    const tab = this.responseTab();
    if (tab) store.showRequest(tab, this.requestInfo(row));
  }

  openBruno(cx) {
    cx.spawn(async () => {
      const ok = await machine.openBruno().catch(() => false);
      if (!ok) notify({ title: "Bruno desktop was not found", body: "Brunr looks for it where its installer puts it.", level: "warning" });
    });
  }
}
