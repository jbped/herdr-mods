// Brunr: your Bruno Collections in one dialog. The tree of Collections, folders and Requests is
// on the left, the selected Request in the middle (request.js) and the last Run's Response on the
// right. A narrow dialog puts the Request above the Response. Requests are run with the Bruno CLI.
// Each key is also a command: `herdr-app do brunr.<command>`.
//
// The keyboard is on the tree, the Request or the Response. ctrl-h and ctrl-l move it left and
// right. j/k (or the arrows) move in the tree, and through a Run's Requests when it is there.
// Keys: h/l fold and unfold, enter runs a Request or folds a folder, r runs the row (a folder or
// Collection asks first), p runs a Request with other values for its URL's {{variables}}, e picks the Environment, o shows the Request's file, y copies its URL,
// b opens Bruno desktop, 1-4 pick the Response's view, / searches a Run's Requests, f fills the
// window, ctrl-s saves the shown Request's Draft, ctrl-r reads everything again, ? shows or hides
// the key list, esc closes.
//
// Config: brunr.json in the app home. Nothing from a Response is written to disk. Request files
// change only through saves (saveflow.js), and Drafts live in memory (drafts.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState } from "gpui-base";
import { checking, closeOverlay, nextCommand, props, settings } from "herdr";
import { colors, SIZE } from "./kit/theme.js";
import { frame, divider } from "./kit/frame.js";
import { legend, hint } from "./kit/legend.js";
import { listRow, listNote } from "./kit/list.js";
import { sectionLabel } from "./kit/pane.js";
import { chip, toolButton, textInput } from "./kit/controls.js";
import { Shortcuts } from "./kit/shortcuts.js";
import { isLauncher, launch, toggleDialog, dialogClosed, closeTab, sharedStorage, openAsOption, onOpenAsChange } from "./kit/open-as.js";
import * as sources from "./sources.js";
import * as machine from "./machine.js";
import * as store from "./store.js";
import * as tree from "./tree.js";
import { planRun, plannedRequests } from "./plan.js";
import { parseProgress, progressOf } from "./progress.js";
import { Response, methodBadge } from "./response.js";
import { Pickers, PICKER_KEYS } from "./picker.js";
import { RequestColumn, stepPlace } from "./request.js";
import * as drafts from "./drafts.js";
import * as saveflow from "./saveflow.js";
import { FILE } from "./formview.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {ReturnType<typeof colors>} Theme */
/** A row of the tree, as tree.buildRows makes it. @typedef {any} Row */
/** One {{variable}} of the "run with values" form. @typedef {{ name: string, known: boolean, secret: boolean, input: any }} VarField */
/** The "run with values" form. @typedef {{ key: string, name: string, url: string, fields: VarField[], at: number }} VarsForm */
/** @typedef {import("./picker.js").Choice} Choice */

/** The mod's folder name: its icons live there. */
const MOD = "brunr";
/** How Brunr opens: as a tab, or as a dialog that fills the window (kit/open-as.js). */
const HOW = {
  name: "Brunr",
  tab: { tab: true },
  dialog: () => toggleDialog(MOD, { mod: MOD, props: { dialog: true }, kind: "dialog", width: 1, height: 1, frame: "none" }),
};
const ICON = (/** @type {string} */ name) => `mods/${MOD}/icons/${name}.svg`;
/**
 * The dialog's size when it does not fill the window. Its overlay always covers the window
 * (mod.json), and the dialog is drawn inside it at this size, so full screen is only a bigger box.
 */
const DIALOG = { width: 1120, height: /** @type {const} */ ("85%") };
/** The tree column's width, in the dialog and in full screen. */
const TREE_W = 340;
const TREE_W_FULL = 400;
/** The frame is this wide or wider: the Request and the Response sit side by side, else the Request is above. */
const THREE_COLUMNS = 1100;
/** The Request column's key context: the save key is bound in it, so it works in a field or an editor. */
const REQUEST_CONTEXT = "BrunrRequest";
const saveAction = (/** @type {string} */ key) => `brunr-save-${key.replace(/[^a-z0-9]/gi, "_")}`;
const INDENT = 14;
/** Collections on other Machines are read again this often, in milliseconds. */
const REMOTE_REFRESH = 30000;
/** The keyboard is taken again this long after the dialog opens, once the app has placed it. */
const REFOCUS_MS = 600;
/** After esc closes a picker or leaves the Search box, a second esc this soon does not close the dialog, in milliseconds. */
const ESC_GAP_MS = 300;

/** The command each key stands for. @type {Record<string, string>} */
const KEYS = {
  up: "up", k: "up", down: "down", j: "down", left: "left", h: "left", right: "right", l: "right", home: "home", end: "end", enter: "enter",
  r: "run", p: "vars", e: "env", o: "file", y: "url", b: "app", f: "full", "ctrl-r": "reload",
  "1": "part-1", "2": "part-2", "3": "part-3", "4": "part-4", "/": "search",
  "ctrl-h": "focus-left", "ctrl-l": "focus-right", escape: "cancel", "?": "keys", "shift-/": "keys", ",": "settings",
  "ctrl-x": "close-tab",
};
/**
 * The keys a user can turn off or change in the settings. Each id is the command its key runs.
 * The keys that move around, enter, esc, ? and , always work, and so does every button.
 * @type {import("./kit/shortcuts.js").Shortcut[]}
 */
const SHORTCUTS = [
  { id: "run", key: "r", what: "run" }, { id: "vars", key: "p", what: "run with values" }, { id: "env", key: "e", what: "environment" },
  { id: "file", key: "o", what: "open file" }, { id: "url", key: "y", what: "copy URL" },
  { id: "app", key: "b", what: "open Bruno" }, { id: "full", key: "f", what: "full screen" },
  { id: "reload", key: "ctrl-r", what: "reload" }, { id: "save", key: "ctrl-s", what: "save" },
];
/** What tree.keyAction calls each command that acts on the selected row. @type {Record<string, string>} */
const TREE_KEY = { up: "up", down: "down", left: "left", right: "right", home: "home", end: "end", enter: "enter", run: "r", env: "e", file: "o", app: "b" };
/**
 * Esc with something open. The app closes the top dialog on esc before the mod's key handler
 * hears of it, so the dialog sits in this key context while a picker, the settings or the Search
 * box is open, where esc is bound to the mod's own action. The nearest binding wins.
 */
const BOX_CONTEXT = "BrunrStepBack";
const BACK_ACTION = "brunr-back";

const machineKey = (/** @type {string | null | undefined} */ m) => m ?? "";

export default class Brunr extends View {
  /** @param {unknown} _props @param {Context} cx */
  init(_props, cx) {
    // The key (mod.open:brunr) opens a tiny overlay that opens Brunr as a tab or a full-window
    // dialog, as the settings say, then closes (kit/open-as.js). Nothing else starts in it.
    this.launcher = isLauncher();
    if (this.launcher) {
      if (!checking()) launch(MOD, HOW, cx);
      return;
    }
    const p = props() ?? {};
    this.handle = cx.focus_handle();
    cx.bind_keys([{ keystroke: "escape", action: BACK_ACTION, context: BOX_CONTEXT }]);
    // Shared by every copy: each dialog and each tab is a new copy with its own localStorage.
    this.saved = new store.Saved(sharedStorage(MOD));
    /** @type {any} sources.discover's result */
    this.found = null;
    /** @type {Map<string, any>} Collection key -> { collection?, error?, loading? } */
    this.loaded = new Map();
    /** @type {Record<string, any>} Machine key -> machine.checkCli's result, or "checking" */
    this.cli = {};
    /** @type {Map<string, any>} Collection root on this computer -> its pending watch */
    this.watches = new Map();
    /** @type {Row[]} */
    this.rows = [];
    /** @type {string | null} the selected row's key */
    this.sel = null;
    /** True after the selection moves, until the next render scrolls to it. */
    this.reveal = true;
    this.scroll = ScrollHandle.new();
    this.loadingAll = true;
    /** @type {string} where the keyboard is: "tree", "request" or "response" (request.js PLACES) */
    this.focus = "tree";
    this.pickers = new Pickers();
    /** @type {Set<string>} the save keys bound in the Request column's key context */
    this.saveKeys = new Set();
    /** @type {VarsForm | null} */
    this.vars = null;
    /** @type {Map<string, Record<string, string>>} Request key -> the values its last "run with values" used. Kept until the dialog closes, never saved. */
    this.lastVars = new Map();
    /** @type {{ text: string, bad: boolean } | null} the line under the panes */
    this.note = null;
    /** @type {number} the frame's width in pixels, once it has been laid out */
    this.width = DIALOG.width;
    /** @type {number} when esc last stepped back from something, as Date.now() */
    this.steppedBack = 0;
    /** The settings panel: a tab or a dialog, whether the dialog opens filling the window, and a switch per shortcut key. */
    this.shortcuts = new Shortcuts({
      mod: MOD, keys: SHORTCUTS, rebind: true, storage: sharedStorage(MOD),
      options: [openAsOption(MOD), { id: "full", label: "Open the dialog in full screen" }],
      onChange: (id, on) => onOpenAsChange(MOD, id, on, HOW),
    });
    /** @type {boolean} the dialog fills the window */
    this.full = Boolean(p.full ?? (p.overlay !== undefined && this.shortcuts.option("full")));
    this.response = new Response();
    this.request = new RequestColumn({
      openPicker: (p, cx) => { this.pickers.show(p, cx); this.handle.focus(); },
      say: (text, bad) => this.say(text, bad),
      run: (cx, key) => this.runKey(cx, key, false),
      saved: this.saved,
    });
    this.bindSave(cx);
    if (checking()) return;

    this.handle.focus();
    cx.timer.after(REFOCUS_MS, () => { if (!this.response.typing) this.handle.focus(); });
    cx.spawn(async (cx) => { await machine.clearLocalReports().catch(() => {}); await this.reload(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else if (c) this.command(c, cx);
        cx.notify();
      }
    });
    // The Run lives in store.js: each change is taken here and drawn.
    cx.spawn(async (cx) => { for (;;) { await store.nextChange(); this.response.sync(); cx.notify(); } });
    // Drafts live in drafts.js: a save, a discard or a change on disk is taken here.
    cx.spawn(async (cx) => { for (;;) { await drafts.nextChange(); this.request.draftChanged(); cx.notify(); } });
    cx.timer.every(REMOTE_REFRESH, (cx) => this.refreshRemote(cx));
  }

  /** The app calls this when the dialog goes. A Run in progress cannot report back to a closed dialog. */
  async close() {
    if (this.launcher) return;
    dialogClosed(MOD);
    for (const w of this.watches?.values() ?? []) w?.cancel();
    this.watches?.clear();
    if (store.running()) store.finishRun({ ok: false, message: "Brunr was closed before the Run finished.", summary: { requests: 0, passed: 0, failed: 0, skipped: 0, duration: 0 }, responses: [] });
    // A save in progress is finished and released here: the copy's tasks are cancelled after close.
    await this.request?.close();
    this.response?.release();
    this.closeVars();
  }

  /** Closes the dialog. Placed as a layout block there is nothing to close. */
  dismiss() {
    const overlay = props()?.overlay;
    if (overlay !== undefined) closeOverlay(overlay);
  }

  // Loading

  /** Reads the config, the workspace, every Collection and the Bruno CLI check. @param {Context | AsyncContext} cx */
  async reload(cx) {
    this.loadingAll = true;
    cx.notify();
    const config = await sources.readConfig();
    this.found = await sources.discover(config);
    const keep = new Set(this.found.entries.map((/** @type {any} */ e) => e.key));
    for (const k of [...this.loaded.keys()]) if (!keep.has(k)) this.loaded.delete(k);
    this.checkClis(cx);
    await Promise.all(this.found.entries.map((/** @type {any} */ e) => this.loadOne(cx, e)));
    this.loadingAll = false;
    this.startWatches(cx);
    cx.notify();
  }

  /** @param {Context | AsyncContext} cx @param {any} entry */
  async loadOne(cx, entry) {
    const prev = this.loaded.get(entry.key) ?? {};
    this.loaded.set(entry.key, { ...prev, loading: true });
    const { files, ...r } = await sources.loadCollection(entry);
    // The texts just read tell the Drafts whether a shown Request changed on disk. They are not kept.
    if (files) drafts.collectionRead(entry.key, files);
    this.loaded.set(entry.key, { ...r, loading: false });
    cx.notify();
  }

  /** One `bru` and `node` check per Machine, at start and on reload. @param {Context | AsyncContext} cx */
  checkClis(cx) {
    const ms = new Set((this.found?.entries ?? []).map((/** @type {any} */ e) => machineKey(e.machine)));
    for (const m of ms) {
      this.cli[m] = "checking";
      cx.spawn(async (cx) => { this.cli[m] = await machine.checkCli(m || null); cx.notify(); });
    }
  }

  /** Watches each Collection root on this computer. A watch that starts reloads, as idle ones can be reclaimed. @param {Context | AsyncContext} cx */
  startWatches(cx) {
    const roots = new Map(this.found.entries.filter((/** @type {any} */ e) => e.machine == null).map((/** @type {any} */ e) => [e.root, e]));
    for (const [root, w] of [...this.watches]) if (!roots.has(root)) { w?.cancel(); this.watches.delete(root); }
    for (const [root] of roots) {
      if (this.watches.has(root)) continue;
      this.watches.set(root, null);
      cx.spawn(async (cx) => {
        let first = true;
        for (;;) {
          const entry = this.found?.entries.find((/** @type {any} */ e) => e.machine == null && e.root === root);
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

  /** @param {Context} cx */
  refreshRemote(cx) {
    for (const e of this.found?.entries ?? []) if (e.machine != null) cx.spawn(async (cx) => { await this.loadOne(cx, e); });
  }

  // Facts the view asks for

  /** @param {string} ck */
  entry(ck) { return this.found?.entries.find((/** @type {any} */ e) => e.key === ck) ?? null; }
  /** @param {string} ck */
  collection(ck) { return this.loaded.get(ck)?.collection ?? null; }

  /** The Environment a Run of this Collection uses, and its secret variable names. @param {any} entry @param {any} collection */
  envOf(entry, collection) {
    const name = store.chosenEnv(this.saved, entry.key, collection);
    const env = collection?.environments.find((/** @type {any} */ e) => e.name === name);
    return { name, secrets: (env?.variables ?? []).filter((/** @type {any} */ v) => v.secret).map((/** @type {any} */ v) => v.name) };
  }

  /** @param {string} wsPath */
  globalOf(wsPath) {
    const g = this.saved.globalEnv(wsPath);
    return g && this.found?.workspace?.globals.includes(g) ? g : null;
  }

  /** @returns {Row[]} */
  buildRows() {
    this.rows = /** @type {any} */ (tree).buildRows({
      entries: this.found?.entries ?? [], loaded: this.loaded, workspace: this.found?.workspace ?? null,
      isOpen: (/** @type {string} */ k, /** @type {boolean} */ d) => this.saved.isOpen(k, d),
      envOf: (/** @type {any} */ e, /** @type {any} */ c) => this.envOf(e, c), globalOf: (/** @type {string} */ p) => this.globalOf(p),
    });
    if (this.rows.length && !this.rows.some((r) => r.key === this.sel)) this.sel = this.rows[0].key;
    return this.rows;
  }

  /** The selected row. @returns {Row | null} */
  selected() {
    return this.rows.find((r) => r.key === this.sel) ?? null;
  }

  /** False while a Run is in progress, or when `bru` was found missing on the row's Machine. @param {Row | null} row */
  canRun(row) {
    const c = this.cli[machineKey(row?.machine)];
    return Boolean(row) && !store.running() && !(c && c !== "checking" && !c.bru);
  }

  /** Shows a line under the panes. `bad` is true for something that went wrong. @param {string} text @param {boolean} [bad] */
  say(text, bad = true) {
    this.note = { text, bad };
  }

  // Keys and commands

  /** @param {KeyEvent} e @param {Context} cx */
  key(e, cx) {
    // Ctrl with a letter is read from the key and its modifiers, so it works however the app spells the keystroke.
    const m = e.modifiers;
    const ctrlOnly = m.control && !m.shift && !m.alt && !m.platform;
    const k = ctrlOnly && /^[a-z]$/.test(e.key) ? `ctrl-${e.key}` : e.keystroke;
    let c = "";
    if (this.pickers.open) c = PICKER_KEYS[k] ?? "";
    else if (this.vars) c = k === "escape" ? "cancel" : k === "tab" || k === "down" ? "vars-next" : k === "shift-tab" || k === "up" ? "vars-prev" : "";
    else if (this.shortcuts.open) { this.shortcuts.key(e, cx); return; }
    else if (this.response.typing) c = k === "escape" ? "cancel" : k === "enter" ? "focus-response" : "";
    // Typing in a Request field runs no tree key. The save key, esc, ctrl-h and ctrl-l still work.
    else if (this.request.typing) c = k === "escape" ? "cancel" : k === "ctrl-h" ? "focus-left" : k === "ctrl-l" ? "focus-right" : this.shortcuts.matches("save", k) ? "save" : "";
    else {
      // The settings say which key each shortcut is on. A key the user gave to a shortcut wins.
      // The key a shortcut came with works only while the shortcut is still on it.
      c = this.shortcuts.idFor(k) || KEYS[k] || "";
      const own = SHORTCUTS.find((s) => s.id === c);
      if (own && (this.shortcuts.isOff(c) || (own.key === k && this.shortcuts.keyFor(c) !== k))) c = "";
    }
    this.bindSave(cx);
    if (!c) return;
    this.command(c, cx);
    cx.stop_propagation();
  }

  /**
   * Binds the save key in the Request column's key context, so it reaches the dialog even when an
   * editor holds the keyboard. A key changed in the settings is bound when the next key arrives.
   * @param {Context} cx
   */
  bindSave(cx) {
    const k = this.shortcuts.keyFor("save");
    if (!k || this.saveKeys.has(k)) return;
    this.saveKeys.add(k);
    try { cx.bind_keys([{ keystroke: k, action: saveAction(k), context: REQUEST_CONTEXT }]); } catch { /* not a key the app can bind */ }
  }

  /**
   * Does what a key, a button or a `herdr-app do brunr.<command>` asks.
   * @param {string} c @param {Context | AsyncContext} cx
   */
  command(c, cx) {
    this.note = null;
    if (c === "cancel") this.cancel(cx);
    else if (this.pickers.open) this.pickers.command(c, cx);
    else if (this.vars) this.varsCommand(c, cx);
    else if (this.shortcuts.command(c)) { /* the settings panel took it */ }
    else if (c === "focus-left" || c === "focus-right") this.focusOn(stepPlace(this.focus, c === "focus-left" ? -1 : 1, Boolean(this.request.req)));
    else if (c === "focus-tree" || c === "focus-request" || c === "focus-response") this.focusOn(c.slice(6));
    else if (c === "save") this.request.save(cx);
    // On the Request column, enter puts the keyboard in its URL field. The tree does not move under it.
    else if (this.focus === "request" && c === "enter") this.request.focusFirst();
    else if (this.focus === "request" && TREE_KEY[c] && ["up", "down", "left", "right", "home", "end"].includes(c)) { /* nothing to move here */ }
    else if (c === "keys") this.shortcuts.setOption("hints", !this.shortcuts.showHints);
    else if (c === "full") this.toggleFull();
    // In a tab: close it and go back to the tab you came from. A dialog closes with esc.
    else if (c === "close-tab") { if (props()?.overlay === undefined) closeTab(MOD); }
    else if (c === "reload") cx.spawn((cx) => this.reload(cx));
    else if (c === "search") { if (this.response.many) { this.focus = "response"; this.response.filterInput.focus(); } }
    else if (c.startsWith("part-")) this.response.setPart(Number(c.slice(5)) - 1);
    else if (c === "url") this.copyUrl(cx);
    else if (c === "vars") this.openVars();
    else if (this.focus === "response" && (c === "up" || c === "down")) this.response.move(c === "up" ? -1 : 1);
    else if (TREE_KEY[c]) {
      const at = Math.max(0, this.rows.findIndex((r) => r.key === this.sel));
      const a = tree.keyAction(TREE_KEY[c], this.rows, at);
      if (a) this.act(cx, a);
    }
    cx.notify();
  }

  /** Moves the keyboard: the tree, the Request column or the Response. Enter on the Request column goes into its URL field. @param {string} place */
  focusOn(place) {
    this.focus = place;
    this.handle.focus();
  }

  /** Esc: closes the picker, then the settings, then leaves a text box, then closes the dialog. @param {Context | AsyncContext} cx */
  cancel(cx) {
    if (this.pickers.open) { this.pickers.close(cx); this.steppedBack = Date.now(); }
    else if (this.vars) {
      this.closeVars();
      this.steppedBack = Date.now();
      cx.spawn(async (cx) => { this.steppedBack = Date.now(); this.handle.focus(); cx.notify(); });
    }
    else if (this.shortcuts.open) this.shortcuts.back();
    else if (this.response.typing || this.request.typing) {
      if (this.request.typing) this.focus = "tree";
      // The keyboard moves back after this key press is over, so the press is not handed on as a second esc.
      this.steppedBack = Date.now();
      cx.spawn(async (cx) => { this.steppedBack = Date.now(); this.handle.focus(); cx.notify(); });
    }
    // The same esc can arrive again after the keyboard moved out of a text box. It must not close the dialog too.
    else if (Date.now() - this.steppedBack > ESC_GAP_MS) this.dismiss();
  }

  toggleFull() {
    if (props()?.overlay === undefined) return this.say("Full screen works when Brunr is open as a dialog");
    this.full = !this.full;
  }

  /** @param {Context | AsyncContext} cx @param {any} a what tree.keyAction answered */
  act(cx, a) {
    if (a.act === "move") { this.sel = this.rows[a.to]?.key ?? this.sel; this.reveal = true; this.showSelected(cx); }
    else if (a.act === "fold") this.saved.setOpen(a.key, a.open);
    else if (a.act === "run" || a.act === "runMany") this.runKey(cx, a.row.key, false);
    else if (a.act === "env") this.openEnvPicker(a.row);
    else if (a.act === "global") this.openGlobalPicker(a.row);
    else if (a.act === "open") this.openFile(cx, a.row);
    else if (a.act === "bruno") this.openBruno(cx);
  }

  /** @param {Context | AsyncContext} cx */
  copyUrl(cx) {
    const row = this.selected();
    if (row?.kind !== "request" || !row.url) return this.say("Select a Request to copy its URL");
    /** @type {Context} */ (cx).write_to_clipboard(row.url);
    this.say("Copied the URL", false);
  }

  // Clicks

  /** @param {Context} cx @param {Row} row @param {{ click_count?: number }} e */
  clickRow(cx, row, e) {
    this.sel = row.key;
    this.focus = "tree";
    this.handle.focus();
    this.note = null;
    this.showSelected(cx);
    if (e?.click_count === 2 && row.kind === "request") this.runKey(cx, row.key, false);
    else if (e?.click_count === 2 && tree.foldable(row)) this.saved.setOpen(row.key, !row.open);
    else if (row.kind === "global") this.openGlobalPicker(row);
    cx.notify();
  }

  /** Right-click: the row's menu, as a picker. @param {Row} row */
  openMenu(row) {
    this.sel = row.key;
    this.focus = "tree";
    this.note = null;
    const key = (/** @type {string} */ id) => (this.shortcuts.isOff(id) ? "" : this.shortcuts.keyFor(id) ?? "");
    /** @type {Choice[]} */
    const options = [];
    if (row.kind === "request" && this.canRun(row)) options.push({ label: "Run", value: "run", hint: "enter" });
    if (tree.runsMany(row) && this.canRun(row)) options.push({ label: row.kind === "folder" ? "Run folder" : "Run Collection", value: "run", hint: key("run") });
    if (row.kind === "request") options.push({ label: "Open file", value: "file", hint: key("file") });
    if (row.ck) options.push({ label: "Environment", value: "env", hint: key("env") });
    if (row.kind === "global") options.push({ label: "Global environment", value: "global", hint: key("env") });
    if (row.ck && row.machine == null) options.push({ label: "Open Bruno", value: "app", hint: key("app") });
    if (row.kind === "request" && row.url) options.push({ label: "Copy URL", value: "url", hint: key("url") });
    if (row.ck) options.push({ label: "Copy path", value: "path" });
    options.push({ label: "Reload", value: "reload", hint: key("reload") });
    this.pickers.show({
      title: row.name, options, at: 0,
      choose: (value, cx) => {
        if (value === "path") this.copyPath(cx, row);
        else if (value === "run") this.runKey(cx, row.key, false);
        else if (value === "file") this.openFile(cx, row);
        else if (value === "env") this.openEnvPicker(row);
        else if (value === "global") this.openGlobalPicker(row);
        else if (value === "app") this.openBruno(cx);
        else this.command(value, cx);
      },
    });
  }

  /** Copies the row's path on its Machine: the Collection root, or a file or folder inside it. @param {Context | AsyncContext} cx @param {Row} row */
  copyPath(cx, row) {
    const root = this.entry(row.ck)?.root;
    if (!root) return;
    /** @type {Context} */ (cx).write_to_clipboard(row.path ? `${root}/${row.path}` : root);
    this.say("Copied the path", false);
  }

  // Pickers

  /** @param {Row} row any row of the Collection */
  openEnvPicker(row) {
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    if (!entry || !c) return;
    const current = this.envOf(entry, c).name;
    /** @type {Choice[]} */
    const options = [{ label: "No Environment", value: null }, ...c.environments.map((/** @type {any} */ env) => {
      const secrets = env.variables.filter((/** @type {any} */ v) => v.secret).map((/** @type {any} */ v) => v.name);
      return { label: env.name, value: env.name, warn: tree.secretWarning(secrets) };
    })];
    this.pickers.show({ title: `Environment of ${c.name}`, options, current, choose: (value) => this.saved.setEnv(entry.key, value) });
  }

  /** @param {Row} row the Global environment row */
  openGlobalPicker(row) {
    /** @type {Choice[]} */
    const options = [{ label: "No Global environment", value: null }, ...row.options.map((/** @type {string} */ n) => ({ label: n, value: n }))];
    this.pickers.show({ title: "Global environment", options, current: row.env, choose: (value) => this.saved.setGlobalEnv(row.wsPath, value) });
  }

  // Run with values

  /** Opens the form with one box per {{variable}} in the selected Request's URL. */
  openVars() {
    const row = this.selected();
    if (row?.kind !== "request") return this.say("Select a Request to run it with other values");
    const names = tree.urlVariables(row.url);
    if (!names.length) return this.say("This Request's URL has no {{variables}}");
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    if (!entry || !c) return;
    const envName = this.envOf(entry, c).name;
    const env = c.environments.find((/** @type {any} */ e) => e.name === envName);
    const last = this.lastVars.get(row.key) ?? {};
    this.closeVars();
    // The boxes start empty, or with what the last "run with values" of this Request used. Environment values are never read.
    const fields = names.map((name) => {
      const v = env?.variables.find((/** @type {any} */ x) => x.name === name);
      const input = InputState.new({ value: last[name] ?? "", placeholder: v ? `Empty keeps ${envName}'s value` : "Empty leaves it as it is" });
      input.on("submit", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.runVars(cx); cx.notify(); });
      return { name, known: Boolean(v), secret: Boolean(v?.secret), input };
    });
    this.vars = { key: row.key, name: row.name, url: row.url, fields, at: 0 };
    fields[0].input.focus();
  }

  closeVars() {
    for (const f of this.vars?.fields ?? []) f.input.release();
    this.vars = null;
  }

  /** @param {string} c @param {Context | AsyncContext} cx */
  varsCommand(c, cx) {
    const v = this.vars;
    if (!v) return;
    if (c === "vars-next" || c === "vars-prev") {
      v.at = (v.at + (c === "vars-prev" ? -1 : 1) + v.fields.length) % v.fields.length;
      v.fields[v.at].input.focus();
    } else if (c === "vars-run") this.runVars(cx);
  }

  /** Runs the form's Request with each changed box as an `--env-var`. Nothing is written to disk. @param {Context | AsyncContext} cx */
  runVars(cx) {
    const v = this.vars;
    if (!v) return;
    /** @type {Record<string, string>} */
    const changed = {};
    /** @type {Record<string, string>} */
    const typed = {};
    for (const f of v.fields) {
      const value = f.input.value();
      typed[f.name] = value;
      if (value !== "") changed[f.name] = value;
    }
    this.lastVars.set(v.key, typed);
    this.closeVars();
    this.handle.focus();
    this.runKey(cx, v.key, false, changed);
    if (store.running()) {
      const list = Object.entries(changed).map(([n, x]) => `${n}=${x}`).join(", ");
      this.say(list ? `This Run only: ${list}` : "Nothing changed, so this Run uses the Environment's values", false);
    }
  }

  // Runs

  /**
   * Runs the row: a Request at once, a folder or Collection after a confirmation. A Request's
   * Draft is saved first, by the same save path. A folder or Collection with Drafts in it asks
   * whether to save them first. `envVars` replaces those Environment variables for this Run only.
   * `saved`: the Draft was just saved.
   * @param {Context | AsyncContext} cx @param {string} key @param {boolean} confirmed @param {Record<string, string> | null} [envVars] @param {boolean} [saved]
   */
  runKey(cx, key, confirmed, envVars = null, saved = false) {
    const row = this.buildRows().find((r) => r.key === key);
    if (!row || !row.ck) return;
    if (store.running()) return this.say("A Run is in progress");
    if (!this.canRun(row)) return this.say(`No Bruno CLI on ${row.machine ?? "this computer"}. Runs are off`);
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    if (!entry || !c) return;
    const target = row.kind === "request" ? { kind: "request", path: row.path } : row.kind === "folder" ? { kind: "folder", path: row.path } : { kind: "collection" };
    const environment = this.envOf(entry, c).name;
    const ws = entry.workspace && this.found?.workspace?.path === entry.workspace ? this.found.workspace : null;
    const globalEnvironment = ws ? this.globalOf(ws.path) : null;
    if (target.kind === "request" && !saved && drafts.has(row.key)) {
      return this.request.saveThen(cx, [this.requestInfo(row)], (cx) => this.runKey(cx, key, confirmed, envVars, true));
    }
    if (target.kind !== "request" && !confirmed) {
      const plan = planRun({ collection: c, target, environment, reportPath: "" });
      if (!plan.count) return this.say(`"${row.name}" has no Requests`);
      const withDrafts = plannedRequests(c, target).filter((/** @type {any} */ n) => drafts.has(`${entry.key}#${n.path}`))
        .map((/** @type {any} */ n) => this.requestInfo({ key: `${entry.key}#${n.path}`, ck: row.ck, path: n.path, name: n.name }));
      if (withDrafts.length) return saveflow.askBeforeRun(this.request, cx, withDrafts, tree.confirmText(plan.count, row.name, environment), (cx) => this.runKey(cx, key, true));
      this.pickers.show({
        title: tree.confirmText(plan.count, row.name, environment), at: 0,
        options: [{ label: `Run ${plan.count} ${plan.count === 1 ? "Request" : "Requests"}`, value: true, warn: `The Bruno CLI sends them one after another${entry.machine ? ` on ${entry.machine}` : ""}.` }, { label: "Cancel", value: false }],
        choose: (yes, cx) => { if (yes) this.runKey(cx, key, true); },
      });
      return;
    }
    // The Requests the CLI is expected to send, in its order, so the progress can name the next one.
    // A single Request Run has no progress.
    const many = target.kind !== "request";
    const planned = plannedRequests(c, target);
    const info = { key, ck: row.ck, kind: target.kind, label: row.name, method: row.method ?? null, url: row.url ?? null, environment, collection: c.name, machine: entry.machine ?? null, tree: c, target, planned };
    if (!store.beginRun(info, many ? progressOf({ planned, finished: [] }) : null)) return this.say("A Run is in progress");
    this.response.sync();
    const onProgress = many ? (/** @type {string} */ text) => store.setProgress(progressOf({ planned, finished: parseProgress(text).finished })) : null;
    cx.spawn(async (cx) => {
      const result = await machine.runBru({ machine: entry.machine ?? null, collection: c, target, environment, globalEnvironment, workspacePath: ws?.dir ?? null, envVars, timer: many ? cx.timer : null, onProgress });
      store.finishRun(result);
      this.response.sync();
      cx.notify();
    });
  }

  /** Shows the Request in the Request column on its File tab. @param {Context | AsyncContext} cx @param {Row} row */
  openFile(cx, row) {
    if (row.kind !== "request" || !this.entry(row.ck)) return;
    this.sel = row.key;
    this.showSelected(cx, FILE);
  }

  /** The selected Request shows in the Request column. It never runs. Any other row empties it. @param {Context | AsyncContext} cx @param {string | null} [tab] */
  showSelected(cx, tab = null) {
    const row = this.selected();
    if (row?.kind === "request" && this.entry(row.ck)) this.request.show(this.requestInfo(row), cx, tab);
    else this.request.clear();
  }

  /** What the Request column needs: `{ key, ck, machine, root, path, format, name }`. @param {{ key: string, ck: string, path: string, name: string }} row */
  requestInfo(row) {
    const entry = this.entry(row.ck), c = this.collection(row.ck);
    return { key: row.key, ck: row.ck, machine: entry?.machine ?? null, root: entry?.root ?? "", path: row.path, format: c?.format ?? "yaml", name: row.name };
  }

  /** @param {Context | AsyncContext} cx */
  openBruno(cx) {
    cx.spawn(async (cx) => {
      const ok = await machine.openBruno().catch(() => false);
      if (!ok) { this.say("Bruno desktop was not found where its installer puts it"); cx.notify(); }
    });
  }

  // Drawing

  /** The font Requests' URLs are drawn in. */
  mono() {
    return String(settings().font_family ?? "JetBrains Mono");
  }

  /**
   * A bordered button of the title row. Add its icon or text with `.child(...)`.
   * @param {Theme} t @param {string} id @param {string} tip @param {string} command
   */
  button(t, id, tip, command) {
    return toolButton(t, { id, tip, click: (cx) => this.command(command, cx) }).px(10).gap(6).text_size(12).text_color(t.foreground);
  }

  /** The key of a shortcut for a tooltip: " (r)", or nothing when it is off or hints are hidden. @param {string} id */
  tipKey(id) {
    const k = this.shortcuts.shown(id);
    return k ? ` (${k})` : "";
  }

  /** The title row's middle: the counts, then run, reload, full screen and the settings. @param {Theme} t */
  details(t) {
    const entries = this.found?.entries.length ?? 0;
    const requests = this.rows.filter((r) => r.kind === "collection").reduce((n, r) => n + r.count, 0);
    const counts = this.found ? `${entries} ${entries === 1 ? "Collection" : "Collections"} · ${requests} ${requests === 1 ? "Request" : "Requests"}` : "";
    const row = this.selected();
    const runs = row?.kind === "request" ? "Run" : row?.kind === "folder" ? "Run folder" : row?.kind === "collection" ? "Run Collection" : "";
    return h_flex().flex_1().min_w(0).gap(10).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(SIZE.small).text_color(t.dim).child(counts))
      .when(this.loadingAll || Boolean(store.running()), (el) => el.child(svg(ICON("spinner")).size(13).flex_none().text_color(t.working).spin(900)))
      .when(Boolean(runs) && this.canRun(row), (el) => el.child(this.button(t, "brunr-run", `${runs}${this.tipKey("run")}`, "run")
        .child(svg(ICON("play")).size(10).flex_none().text_color(t.done)).child(runs)))
      .child(this.button(t, "brunr-reload", `Read everything again${this.tipKey("reload")}`, "reload").px(6)
        .child(svg(ICON("reload")).size(13).flex_none().text_color(t.foreground)))
      .when(props()?.overlay !== undefined, (el) => el.child(this.button(t, "brunr-full", `${this.full ? "Leave full screen" : "Full screen"}${this.tipKey("full")}`, "full").px(6)
        .child(svg(ICON(this.full ? "shrink" : "expand")).size(13).flex_none().text_color(t.foreground))))
      .child(this.shortcuts.button(t))
      // With the key list hidden there is no footer: the way back to it sits here, beside "Esc".
      .when(!this.shortcuts.showHints, (el) => el.child(hint(t, ["?", "keys"], { id: "brunr-keys", click: (cx) => this.command("keys", cx) }).flex_none().text_size(SIZE.small)));
  }

  /** Config problems, and the install step for each Machine where `bru` is missing. @param {Theme} t */
  notices(t) {
    const out = [];
    for (const p of this.found?.problems ?? []) {
      out.push(h_flex().flex_none().p(10).gap(8).items_start().rounded(SIZE.rowRadius).bg(t.raised).text_size(12).text_color(t.blocked)
        .child(svg(ICON("warning")).size(13).flex_none().mt(1)).child(div().flex_1().min_w(0).child(p)));
    }
    for (const [m, c] of Object.entries(this.cli)) {
      if (!c || c === "checking" || c.bru) continue;
      out.push(v_flex().flex_none().p(10).gap(6).rounded(SIZE.rowRadius).bg(t.raised).text_size(12)
        .child(h_flex().gap(8).items_center().text_color(t.ansi3).child(svg(ICON("warning")).size(13).flex_none()).child(div().font_semibold().child(`No Bruno CLI on ${m || "this computer"}. Runs are off.`)))
        .child(div().text_color(t.muted).child(c.step.text))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().font_family(this.mono()).text_size(SIZE.small).text_color(t.foreground).child(c.step.copy))
          .child(toolButton(t, { id: `brunr-copy-${m}`, tip: "Copy", click: (cx) => cx.write_to_clipboard(c.step.copy) }).px(10).text_size(SIZE.small).text_color(t.foreground).child("Copy"))));
    }
    return out;
  }

  /** What the tree says when it has no rows. @param {Theme} t */
  emptyNote(t) {
    const f = this.found;
    if (!f) return listNote(t, "Reading Collections…");
    if (f.workspace.missing) return listNote(t, `No Bruno workspace at ${f.workspace.path}. Set "workspace" or "collections" in ${sources.configPath()}.`);
    return listNote(t, `The workspace lists no Collections. Add one in Bruno, or list one under "collections" in ${sources.configPath()}.`);
  }

  /** One row of the tree. @param {Theme} t @param {Row} r @param {number} i */
  treeRow(t, r, i) {
    if (r.kind === "machine") return sectionLabel(t, r.name).id(`brunr-row-${i}`).px(8);
    const on = r.key === this.sel;
    const mark = tree.runMark(r, store.running());
    const el = listRow(t, { id: `brunr-row-${i}`, on, compact: true }).pl(8 + r.depth * INDENT).pr(8).gap(6)
      // The selection is dimmer while j and k act on the Response.
      .when(on && this.focus !== "tree", (e) => e.bg(t.hover))
      .on_click((e, cx) => this.clickRow(cx, r, e))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(r); cx.notify(); });
    if (r.kind === "global") {
      return el.child(svg(ICON("globe")).size(13).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.name))
        .child(this.envChip(t, `brunr-global-${i}`, r.env, "None", false, () => { this.sel = r.key; this.openGlobalPicker(r); }));
    }
    if (tree.foldable(r)) {
      el.child(div().id(`brunr-fold-${i}`).size(16).flex_none().flex().items_center().justify_center().text_color(t.dim)
        .on_click((_e, cx) => { cx.stop_propagation(); this.sel = r.key; this.saved.setOpen(r.key, !r.open); cx.notify(); })
        .child(svg(ICON(r.open ? "chevron-down" : "chevron-right")).size(12)));
    }
    if (r.kind === "collection") {
      el.child(div().flex_1().min_w(0).truncate().font_medium().child(r.name));
      if (r.loading) el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.dim).spin(900));
      if (r.error) el.child(svg(ICON("warning")).size(13).flex_none().text_color(t.blocked).tooltip(r.error));
      if (r.errors.length) el.child(div().flex_none().text_size(SIZE.small).text_color(t.blocked).tooltip(`${r.errors.length} ${r.errors.length === 1 ? "file" : "files"} could not be read`).child(String(r.errors.length)));
    } else if (r.kind === "folder") {
      el.child(svg(ICON("folder")).size(13).flex_none().text_color(t.muted)).child(div().flex_1().min_w(0).truncate().child(r.name))
        .child(div().flex_none().text_size(SIZE.small).text_color(t.dim).child(String(r.count)));
    } else {
      el.child(div().w(16).flex_none()).child(methodBadge(t, r.method)).child(div().flex_1().min_w(0).truncate().child(r.name));
    }
    if (r.kind === "request" && drafts.has(r.key)) el.child(div().id(`brunr-draft-${i}`).size(7).flex_none().rounded(4).bg(t.ansi3).tooltip("Unsaved changes"));
    if (mark.count) el.child(div().flex_none().text_size(SIZE.small).text_color(t.muted).child(mark.count));
    if (mark.spinner) el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.working).spin(900));
    if (r.kind === "collection" && !r.error && !r.loading) {
      el.child(this.envChip(t, `brunr-env-${i}`, r.env, "No Environment", r.secrets.length > 0, () => { this.sel = r.key; this.openEnvPicker(r); }));
    }
    return el;
  }

  /**
   * The chip that shows and picks an Environment.
   * @param {Theme} t @param {string} id @param {string | null} name @param {string} placeholder @param {boolean} warn @param {() => void} click
   */
  envChip(t, id, name, placeholder, warn, click) {
    const label = h_flex().gap(4).items_center().max_w(130)
      .when(warn, (e) => e.child(svg(ICON("warning")).size(11).flex_none().text_color(t.ansi3)))
      .child(div().min_w(0).truncate().text_color(name ? t.foreground : t.dim).child(name ?? placeholder));
    return chip(t, { id, label, on: false, click: (cx) => { cx.stop_propagation(); click(); cx.notify(); } }).h(22).px(8)
      .tooltip(warn ? "This Environment has secret variables. Select the row for details." : `Pick the Environment${this.tipKey("env")}`);
  }

  /** The selected row's details: a Request's method and URL, a Collection's errors, secret warnings. @param {Theme} t */
  selection(t) {
    const r = this.selected();
    const box = v_flex().id("brunr-selection").flex_none().p(10).gap(5).rounded(SIZE.rowRadius).bg(t.raised).text_size(12);
    const dim = (/** @type {string} */ text) => div().text_color(t.dim).child(text);
    const now = store.running()?.progress?.running;
    if (now) box.child(div().truncate().text_color(t.muted).child(`Running: ${now.name}`));
    if (!r || r.kind === "machine") return box.child(dim("Enter or a double-click runs a Request."));
    const coll = r.ck ? this.rows.find((x) => x.key === r.ck) : null;
    if (r.kind === "request") {
      box.child(h_flex().gap(6).items_start().child(methodBadge(t, r.method, 40)).child(div().flex_1().min_w(0).font_family(this.mono()).text_size(SIZE.small).text_color(t.foreground).child(r.url || "(no URL)")));
    } else if (r.kind === "global") {
      box.child(dim(`Applies to every Collection of this workspace. ${r.env ? `Now: ${r.env}.` : "None chosen."}`));
    } else if (r.kind === "folder") {
      box.child(dim(`${r.count} ${r.count === 1 ? "Request" : "Requests"} in this folder.`));
    } else if (r.kind === "collection") {
      if (r.error) box.child(div().text_color(t.blocked).child(r.error));
      else box.child(dim(`${r.count} ${r.count === 1 ? "Request" : "Requests"} on ${r.machine ?? "this computer"}.`));
      if (r.errors.length) {
        box.child(div().text_color(t.blocked).child(`${r.errors.length} ${r.errors.length === 1 ? "file" : "files"} could not be read:`));
        for (const e of r.errors.slice(0, 5)) box.child(div().text_color(t.muted).truncate().child(`${e.path}: ${e.message}`));
      }
    }
    if (coll) {
      const warn = tree.secretWarning(coll.secrets);
      box.child(h_flex().gap(6).items_center().text_color(t.dim)
        .child(div().child("Environment:")).child(div().text_color(coll.env ? t.foreground : t.dim).child(coll.env ?? "No Environment")));
      if (warn) box.child(h_flex().gap(6).items_start().text_color(t.ansi3).child(svg(ICON("warning")).size(12).flex_none().mt(1)).child(div().flex_1().min_w(0).child(warn)));
    }
    return box;
  }

  /** The tree column: notices, the rows, and the selected row's details. @param {Theme} t */
  treePane(t) {
    const rows = this.rows;
    if (this.reveal) {
      const at = rows.findIndex((r) => r.key === this.sel);
      if (at >= 0) this.scroll.scroll_to_item(at);
      this.reveal = false;
    }
    return v_flex().w(this.full ? TREE_W_FULL : TREE_W).flex_none().min_h(0).gap(SIZE.frameGap)
      .children(this.notices(t))
      .child(v_flex().id("brunr-tree").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).gap(2)
        .children(rows.map((r, i) => this.treeRow(t, r, i)))
        .when(!rows.length, (el) => el.child(this.emptyNote(t))))
      .child(this.selection(t));
  }

  /** The "run with values" form, placed over the dialog. A press beside it closes it. @param {Theme} t @param {VarsForm} v */
  varsPanel(t, v) {
    const mono = this.mono();
    const panel = v_flex().id("brunr-vars").absolute().top(60).left(SIZE.framePad).w(460).max_w("100%").p(12).gap(10)
      .bg(t.popover).rounded(12).border_1().border_color(t.border).shadow_lg().text_size(SIZE.text)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .child(v_flex().px(4).gap(4)
        .child(div().font_semibold().text_color(t.foreground).child(`Run ${v.name} with other values`))
        .child(div().font_family(mono).text_size(SIZE.small).text_color(t.muted).child(v.url))
        .child(div().text_size(SIZE.small).text_color(t.dim).child("For this Run only. Nothing is saved.")))
      .children(v.fields.map((f, i) => v_flex().id(`brunr-var-${i}`).gap(4)
        .on_mouse_down("left", (_e, cx) => { v.at = i; cx.notify(); })
        .child(h_flex().gap(8).items_center().px(4)
          .child(div().font_family(mono).text_size(SIZE.small).text_color(t.foreground).child(f.name))
          .child(div().flex_1().min_w(0).truncate().text_size(SIZE.small).text_color(t.dim)
            .child(f.secret ? "secret in the Environment" : f.known ? "from the Environment" : "not in the Environment")))
        .child(textInput(t, f.input, i === v.at).w_full())))
      .child(divider(t))
      .child(legend(t, [["tab", "next"], ["enter", "run"], ["esc", "back"]]));
    return div().id("brunr-vars-around").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { this.closeVars(); this.handle.focus(); cx.stop_propagation(); cx.notify(); })
      .on_click((_e, cx) => cx.stop_propagation())
      .child(panel);
  }

  /** Wraps the Search box so esc in it steps back (see BOX_CONTEXT) and does not close the dialog. @param {any} box */
  escBox(box) {
    return v_flex().w_full().key_context(BOX_CONTEXT)
      .on_action(BACK_ACTION, (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.command("cancel", cx); cx.notify(); })
      .child(box);
  }

  /** @param {Context} _cx */
  render(_cx) {
    if (this.launcher) return div();
    const t = colors();
    this.buildRows();
    const treeW = this.full ? TREE_W_FULL : TREE_W;
    /** @type {import("./kit/legend.js").Hint[]} */
    const hints = [["?", "hide keys"], ["j/k", this.focus === "response" ? "requests" : "move"], ["h/l", "fold"], ["enter", this.focus === "request" ? "edit" : "run"],
      ["ctrl-h", "left"], ["ctrl-l", "right"], ["1-4", "view"], ["/", "search"],
      // A key that is turned off is not listed.
      ...this.shortcuts.keys.filter((k) => !this.shortcuts.isOff(k.id) && this.shortcuts.keyFor(k.id)).map((k) => /** @type {[string, string]} */ (
        [this.shortcuts.keyFor(k.id), k.id === "full" ? (this.full ? "leave full screen" : "full screen") : k.what])),
      [",", "settings"], ["esc", "close"]];
    const picker = this.pickers.open;
    // Three columns when the frame is wide enough, else the Request above the Response.
    const three = this.width >= THREE_COLUMNS;
    const rest = this.width - treeW - SIZE.frameGap - 2 * SIZE.framePad;
    const saveKey = this.shortcuts.keyFor("save");
    const requestCol = this.request.render(t, { focused: this.focus === "request", canRun: this.canRun(this.selected()), stacked: !three })
      .key_context(REQUEST_CONTEXT)
      .when(Boolean(saveKey), (el) => el.on_action(saveAction(saveKey), (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { if (!this.shortcuts.isOff("save")) this.command("save", cx); cx.notify(); }));
    const responseCol = this.response.render(t, { width: three ? (rest - SIZE.frameGap) / 2 : rest, focused: this.focus === "response", escBox: (box) => this.escBox(box) });
    const panel = frame(t, { id: "brunr", title: "Brunr", handle: this.handle, onKey: (e, cx) => this.key(e, cx), fill: true, details: this.details(t),
      onResize: (width, cx) => { if (width !== this.width) { this.width = width; cx.notify(); } } })
      .child(div().flex().flex_row().flex_1().min_h(0).gap(SIZE.frameGap)
        .child(this.treePane(t))
        .child((three ? h_flex().items_stretch() : v_flex()).flex_1().min_w(0).min_h(0).gap(SIZE.frameGap).child(requestCol).child(responseCol)))
      .when(Boolean(this.note), (el) => el.child(div().flex_none().text_size(SIZE.small).text_color(this.note?.bad ? t.blocked : t.dim).child(this.note?.text ?? "")))
      .when(this.shortcuts.showHints, (el) => el.child(divider(t)).child(legend(t, hints)))
      // Esc with something open steps back from it. Without this the app closes the whole dialog (see BOX_CONTEXT).
      .when(Boolean(picker) || Boolean(this.vars) || this.shortcuts.open || this.response.typing || this.request.typing, (el) => el.key_context(BOX_CONTEXT)
        .on_action(BACK_ACTION, (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.command("cancel", cx); cx.notify(); }))
      .when(Boolean(picker), (el) => el.child(this.pickers.panel(t)))
      .when(Boolean(this.vars), (el) => el.child(this.varsPanel(t, /** @type {VarsForm} */ (this.vars))))
      .when(this.shortcuts.open, (el) => el.child(this.shortcuts.panel(t)));
    // Placed as a layout block, or in full screen, the panel fills its room.
    if (props()?.overlay === undefined || this.full) return panel;
    // The overlay covers the window. A click beside the dialog closes it, a click in it does not.
    return div().id("brunr-around").size_full().flex().items_center().justify_center()
      .on_click(() => this.dismiss())
      .child(div().id("brunr-box").w(DIALOG.width).max_w("100%").h(DIALOG.height).flex_none()
        .on_click((_e, cx) => cx.stop_propagation())
        .child(panel));
  }
}
