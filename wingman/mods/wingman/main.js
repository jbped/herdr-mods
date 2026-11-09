// Wingman: Cursor-style whole-file diffs of an agent's changes, with per-hunk
// Accept/Reject that write to disk and undo. A space's review covers every repo its
// agents touched: the repo its agents started in (capture.js, any agent) and every
// repo Claude edited (journal.js, from the Claude hook). Each repo keeps its own store
// in <git-dir>/wingman.
//
// Actions update the in-memory file state and redraw at once; disk writes run
// after, in order, on a queue. Every write is compare-and-swap, so a failure
// never overwrites someone else's edit: the view reports it and reloads.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { theme, settings, props, readTextFile, writeTextFile, panes, spaces, agents, terminals, appHome, exec, hc, pickFolder, openOverlay, closeOverlay, nextCommand, run } from "herdr";
import { rows as buildRows, acceptAt, rejectAt, acceptAll, rejectAll, partialAt } from "./model.js";
import { Store, norm } from "./store.js";
import { highlight, highlightLines, languageOf, color } from "./highlight.js";
import { edit, body, cmp, linesOf, wordMove, wordAt, textBetween, indentUnit, visualCol, charAt, expandTabs } from "./edit.js";
import { Capture, hostPath } from "./capture.js";
import { merge3, diffHunks, changedRanges, mapLine } from "./merge.js";
import { buildTree, flatten, parents } from "./tree.js";
import { openInNvim, openInVSCode } from "./nvim.js";
import { PAIRS, typed, inEmptyPair, betweenBrackets } from "./pairs.js";
import { compile, findAll, nextMatch, prevMatch, replacement, parseLine } from "./find.js";
import { rank, parseQuery } from "./quickopen.js";
import { ACTIONS, BY_ID, resolve, index, holders, bind, unbind, reset as resetKey, refused, keystrokeOf, keyLabel, withModSection, herdrGlobal } from "./keymap.js";
import { lineSpan, moveLines, copyLines, deleteLines, joinLines, toggleComment, commentFor } from "./lineops.js";
import { splitLines } from "./model.js";
import { Journal, spaceRepos, addSpaceRepos, queueFeedback, withdrawFeedback, queuePrompt, drainOutbox, loadSettings, saveSettings, loadKeys, saveKeys } from "./journal.js";

const ROW = 20, GUTTER = 58, BTN_W = 110, BTN_GAP = 6, BUTTONS = 3; // Reject, Accept, Prompt
// Agents count as working while they are in a turn, including while blocked on a question.
const ACTIVE = new Set(["working", "blocked"]);
const base = (p) => p.split("/").pop();

/** A path as the agent in `terminal` sees it: /mnt/c/... for an agent running in WSL. */
function agentPath(path, terminal) {
  const t = terminals().find((x) => x.address === terminal);
  const wsl = /(^|[\\/])wsl(\.exe)?$/i.test(t?.argv?.[0] ?? "");
  const m = /^([A-Za-z]):\/(.*)$/.exec(path);
  return wsl && m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : path;
}

// Outside mods/: any write under a mod folder (even a hidden file) hot-reloads every copy.
const LEADER_FILE = () => `${appHome()}/data/wingman-leader.json`;
const LEASE_MS = 5000;

/** Capture runs in whichever copy leads, often a hidden one, so it logs to a file (in order). */
let logQueue = Promise.resolve();
function log(msg) {
  const path = `${appHome()}/data/wingman-capture.log`, line = `${new Date().toISOString()} ${msg}\n`;
  logQueue = logQueue.then(async () => {
    const old = await readTextFile(path);
    await writeTextFile(path, ((old ?? "").length > 20000 ? old.slice(-10000) : old ?? "") + line, old);
  }).catch(() => {});
}

/** Folders an agent in `space` works in, as this machine's git sees them. */
function agentFolders(space) {
  return agents().filter((a) => a.space === space.id).map((a) => hostPath(panes().find((p) => p.pane === a.pane)?.cwd
    ?? terminals().find((t) => t.address === a.address)?.cwd)).filter(Boolean);
}

/** Spaces that hold a Wingman pane. */
function reviewSpaces() {
  const tabs = new Set(panes().filter((p) => p.mod === "wingman").map((p) => p.tab));
  return spaces().filter((s) => s.tabs.some((t) => tabs.has(t.id)));
}

/** The first folder that opens as a git repo, or null. */
/**
 * Herdr's global keys reach Herdr before Wingman. For each Wingman key that Herdr binds globally,
 * the "mod:wingman" section of Herdr's keys.json sends it to Wingman while Wingman has focus
 * (Q4). Only Wingman's own entries ("wingman.<action>") in that section are rewritten.
 */
async function syncHerdrKeys(keymap) {
  const path = `${appHome()}/keys.json`, text = await readTextFile(path);
  if (!text) return;
  try {
    const global = herdrGlobal(text), entries = {};
    for (const a of ACTIONS) for (const k of keymap.get(a.id) ?? []) if (global[k] && !(k in entries)) entries[k] = `wingman.${a.id}`;
    const next = withModSection(text, entries);
    if (next) { await writeTextFile(path, next, text); log(`keys.json: mod:wingman now ${JSON.stringify(entries)}`); }
  } catch (e) { log(`keys.json: ${e.message ?? e}`); } // another copy wrote it first, or the file isn't JSON
}

async function openFirst(folders) {
  for (const f of folders) { try { return await Store.open(f); } catch {} }
  return null;
}

export default class Review extends View {
  // A pane copy can't tell which pane it is (mod panes get no props, and every copy
  // restarts together on reload), so copies don't depend on it:
  // - Display: a Wingman pane is only visible while its space is active, so every copy
  //   shows the active space's review, and keeps each space's state for when it returns.
  // - Capture: one copy holds a lease (.leader.json) and captures for every space that
  //   has a Wingman pane, so the work never runs twice.
  init(_props, cx) {
    // Opened as a popup (reason or follow-up prompt): a small form, none of the pane's work.
    if (props()?.form) return this.initForm(cx);
    this.id = Math.random().toString(36).slice(2);
    this.settings = { autoNote: true, editNote: true, autosave: true, autosaveDelay: 0, editor: "wingman", autoPairs: true };
    this.editNotes = new Map(); // file key -> the edit note last queued for it
    // Q48: Review (tabs are changed files) or Edit (file tree, tabs for changed and opened files).
    this.mode = "review"; this.treeOn = true; this.trees = new Map(); this.expanded = new Set();
    loadSettings().then((st) => { this.settings = st; });
    this.setKeymap({});
    cx.spawn(async () => { this.setKeymap(await loadKeys()); await syncHerdrKeys(this.keymap); });
    // The pane takes the keyboard back after its popup closes.
    // Commands: "focus" when a popup over the pane closes; the rest come from the right-click menu.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^wingman\./, "");
        if (c === "focus") this.handle.focus();
        else await ({
          prompt: () => this.askPrompt(this.current, cx),
          reject: () => this.decide("reject", cx),
          // Reject, then open the reason popup for that rejection right away.
          rejectReason: () => this.decide("reject", cx, true),
          accept: () => this.decide("accept", cx),
          reason: () => this.askReason(cx),
          clear: () => this.clearSelection(cx),
          save: () => this.save(cx),
          // E3 line operations, for keys.json's "mod:wingman" section (e.g. "alt-up": "wingman.moveLineUp").
          moveLineUp: () => this.lineOp("moveUp", cx),
          moveLineDown: () => this.lineOp("moveDown", cx),
          copyLineUp: () => this.lineOp("copyUp", cx),
          copyLineDown: () => this.lineOp("copyDown", cx),
          deleteLine: () => this.lineOp("delete", cx),
          joinLines: () => this.lineOp("join", cx),
          toggleComment: () => this.lineOp("comment", cx),
          openInVSCode: () => this.toVSCode(cx),
          // The settings popup saved a change.
          settings: async () => { this.settings = await loadSettings(); this.setKeymap(await loadKeys()); },
        })[c]?.() ?? (BY_ID.has(c) ? this.runAction(c, cx) : undefined);
        cx.notify();
      }
    });
    this.handle = cx.focus_handle(); this.scroll = VirtualListScrollHandle.new();
    this.initFind();
    this.views = new Map(); this.captures = new Map(); this.tokens = new Map();
    this.reset([]);
    this.queue = Promise.resolve(); this.writing = 0;
    cx.timer.every(1000, (cx) => this.follow(cx));
    cx.timer.every(250, (cx) => this.autosave(cx));
    cx.timer.every(500, (cx) => this.lead(cx));
    cx.timer.every(3000, (cx) => this.collectAll(cx));
    cx.timer.every(5000, (cx) => this.mode === "edit" && (this.treeOn || this.nvim()) && this.refreshTrees(cx));
    // Watch events would be the fast path, but they did not fire on Windows in testing,
    // so a 2 s content check is what catches outside edits. "#index" keeps the index
    // checked even when no files are listed (e.g. right after a reset).
    cx.timer.every(2000, (cx) => this.stores.length && this.onWatch(new Set(["#index", ...this.files.map((f) => norm(f.path ?? ""))]), cx));
    this.follow(cx);
  }

  /** Per-space view state; no stores means no repo found yet. */
  reset(stores) {
    this.stores = stores; this.files = []; this.sel = null; this.current = 0; this.history = [];
    this.deferred = new Set(); this.indexTexts = {}; this.error = null;
    this.cur = null; this.anchor = null; this.redo = []; this.hx = 0; this.opened = [];
    this.status = stores.length ? "Loading…" : "Waiting for an agent in a git repo in this space, or open a folder.";
  }

  // ---- which space ---------------------------------------------------------

  /** Shows the active space's review, opening its repo when an agent there is in one. */
  async follow(cx) {
    if (this.following || this.writing) return;
    this.following = true;
    try {
      const sp = spaces().find((s) => s.active);
      const key = sp?.id ?? null;
      if (key !== this.spaceId) {
        if (this.settings.autosave) this.saveAll(cx);
        if (this.spaceId) this.views.set(this.spaceId, this.snapshotView());
        this.spaceId = key;
        const saved = this.views.get(key);
        if (saved) Object.assign(this, saved); else this.reset([]);
        cx.notify();
      }
      if (!sp) return;
      // The space's repos: where its agents started (any agent), plus every repo the
      // Claude hook saw them edit. A newly touched repo joins the view when it appears.
      const roots = new Set(this.stores.map((st) => st.root));
      const found = [];
      const start = props()?.root ? await Store.open(props().root).catch(() => null) : await openFirst(agentFolders(sp));
      if (start) found.push(start);
      for (const root of (await spaceRepos())[key] ?? []) if (!found.some((f) => f.root === root)) {
        const st = await Store.open(root).catch(() => null);
        if (st) found.push(st);
      }
      const fresh = found.filter((f) => !roots.has(f.root));
      if (fresh.length && this.spaceId === key) {
        const files = this.files, keep = { sel: this.sel, current: this.current, history: this.history, opened: this.opened };
        this.reset([...this.stores, ...fresh]);
        Object.assign(this, keep); this.files = files;
        await this.reloadAll(cx);
      }
    } finally { this.following = false; }
  }

  snapshotView() {
    const { stores, files, sel, current, history, indexTexts, error, status, redo, opened } = this;
    return { stores, files, sel, current, history, indexTexts, error, status, redo, opened, cur: null, anchor: null, hx: 0, deferred: new Set() };
  }

  // ---- capture (leader only) -----------------------------------------------

  /** Renews or takes the capture lease; true while this copy holds it. */
  async leader() {
    const path = LEADER_FILE(), text = await readTextFile(path), now = Date.now();
    const lease = text ? JSON.parse(text) : null;
    if (lease && lease.id !== this.id && now - lease.at < LEASE_MS) return false;
    try { await writeTextFile(path, JSON.stringify({ id: this.id, at: now }), text); return true; }
    catch { return false; } // another copy renewed or took it first
  }

  /** Every 500 ms: agent status is cheap, and a snapshot must land before the first edit. */
  async lead(cx) {
    if (this.leading) return;
    this.leading = true;
    try {
      this.isLeader = await this.leader();
      if (!this.isLeader) return;
      this.journal ??= new Journal(log);
      await this.journal.drain();
      await drainOutbox((t) => agents().some((a) => a.address === t && ACTIVE.has(a.status)),
        (t, text) => hc(["send", t, text]), log);
      for (const sp of reviewSpaces()) {
        let c = this.captures.get(sp.id);
        if (!c) {
          const store = await openFirst(agentFolders(sp));
          if (!store) { if (!this.noRepo?.has(sp.id)) { (this.noRepo ??= new Set()).add(sp.id); log(`${sp.name}: no repo in ${JSON.stringify(agentFolders(sp))}`); } continue; }
          log(`${sp.name}: capturing ${store.root}`);
          c = { capture: new Capture(store), space: sp.id, active: false, busy: false };
          this.captures.set(sp.id, c);
        }
        const working = agents().filter((a) => a.space === sp.id && ACTIVE.has(a.status)), active = working.length > 0;
        // Credit captured edits to the working agent when it is a lone Claude: its hook delivers
        // rejection feedback even for edits made through Bash. Kept until the next turn starts,
        // so the last pass after the agent stops is credited too.
        if (active) c.by = working.length === 1 && working[0].app === "claude-code" ? working[0].address : null;
        if (active !== c.active) {
          c.active = active; log(`${sp.name}: agent ${active ? "working" : "stopped"} (${c.capture.store.root})`);
          if (active) await this.collect(c, cx, true);
          cx.notify();
        }
      }
    } catch (e) { this.error = `capture: ${e.message ?? e}`; log(`lead error ${e.message ?? e}`); cx.notify(); }
    finally { this.leading = false; }
  }

  async collectAll(cx) {
    if (!this.isLeader) return;
    for (const c of this.captures.values()) await this.collect(c, cx);
  }

  /**
   * One capture pass for a space. Starting: snapshot the working tree. While working,
   * and once after: adopt files that changed since that snapshot. The snapshot is kept
   * in capture.json, so a new leader or a reloaded pane carries on where it was.
   */
  async collect(c, cx, starting = false) {
    if (c.busy) return;
    c.busy = true;
    try {
      const st = await c.capture.state();
      if (!st.tree) {
        if (c.active) { const tree = await c.capture.snapshot(); await c.capture.setState({ tree, since: Date.now() }); log(`snapshot ${tree}`); }
      } else if (!starting) {
        const added = await c.capture.adopt(st.tree, await c.capture.snapshot(), c.by);
        if (added) log(`adopted ${added} files`);
        if (!c.active) await c.capture.setState({ tree: null });
      }
    } catch (e) { this.error = `capture: ${e.message ?? e}`; log(`error ${e.message ?? e}`); cx.notify(); }
    finally { c.busy = false; }
  }

  close() { this.scroll?.release(); for (const i of [this.findInput, this.replaceInput, this.lineInput, this.quickInput]) i?.release(); }

  // ---- loading -------------------------------------------------------------

  async withTokens(f, cx) {
    // What's on disk for this state: edits change memory first, and a save writes the difference.
    f.diskC = f.Ctext; f.diskB = f.Btext;
    if (!f.error) {
      f.oldTok = await this.tok(f.Btext, f.rel, cx);
      f.newTok = await this.tok(f.Ctext ?? "", f.rel, cx);
    }
    return f;
  }

  async reloadAll(cx) {
    try {
      const files = [], texts = {};
      for (const st of this.stores) {
        texts[st.root] = await readTextFile(`${st.dir}/index.json`);
        for (const f of await st.files()) files.push(await this.withTokens(f, cx));
      }
      const kept = [];
      for (const nf of files) kept.push(await this.keepEdits(nf, cx));
      // Opened files without changes stay open: plain ones as they are, others reread as plain.
      for (const old of this.files) {
        if (kept.some((k) => k.key === old.key) || !(old.plain || this.opened.includes(old.key))) continue;
        kept.push(old.plain || this.dirty(old) ? old : await this.loadPlain(old.store, old.rel, cx));
      }
      this.files = kept; this.indexTexts = texts; this.status = null;
      this.settle(); cx.notify();
    } catch (e) { this.error = String(e.message ?? e); cx.notify(); }
  }

  /** A reloaded file, unless this pane holds unsaved edits to it: a disk change under them
   *  is merged into them (mergeInto). */
  async keepEdits(nf, cx) {
    const old = this.files.find((x) => x.key === nf.key);
    if (!old || !this.dirty(old)) return nf;
    if ((nf.Ctext === old.diskC && nf.Btext === old.diskB) || this.sameConflict(old, nf.Ctext, nf.Btext)) return old;
    const next = await this.mergeInto(old, nf, cx), now = this.files.find((x) => x.key === nf.key);
    // Typed into while merging: keep the newer edits and merge again on the next pass.
    if (now !== old) { this.deferred.add(norm(nf.path)); return now; }
    this.adoptMerge(old, next);
    return next;
  }

  /** The disk change behind an open conflict banner is already known. */
  sameConflict(f, c, b) { return !!f.conflict && f.conflict.nf.Ctext === c && f.conflict.nf.Btext === b; }

  /**
   * Q44: a write to a file with unsaved edits merges into them, three-way from what was on disk.
   * Overlapping lines go to the agent when autosave is on; with it off, both outcomes are kept
   * and the banner picks one. A deleted file always asks.
   */
  async mergeInto(f, nf, cx) {
    if (nf.Ctext === null || f.Ctext === null) return { ...f, conflict: { nf, ours: { Ctext: f.Ctext, Btext: f.Btext }, theirs: null } };
    const both = (favor) => Promise.all([merge3(f.diskC, f.Ctext, nf.Ctext, favor), merge3(f.diskB, f.Btext, nf.Btext, favor)]);
    const [c, b] = await both(this.settings.autosave ? "theirs" : null);
    if (!c.conflicts && !b.conflicts) return this.merged(nf, c.text, b.text, cx);
    const [[oc, ob], [tc, tb]] = await Promise.all([both("ours"), both("theirs")]);
    return { ...f, conflict: { nf, ours: { Ctext: oc.text, Btext: ob.text }, theirs: { Ctext: tc.text, Btext: tb.text } } };
  }

  /** The state for merged texts over what's on disk now (`nf`); unsaved where they differ. */
  async merged(nf, Ctext, Btext, cx) {
    const B = splitLines(Btext), C = splitLines(Ctext ?? "");
    return { ...nf, Btext, Ctext, B, C, hunks: await diffHunks(Btext, Ctext ?? ""), edited: true, conflict: null,
      oldTok: await this.tok(Btext, nf.rel, cx), newTok: await this.tok(Ctext ?? "", nf.rel, cx), diskC: nf.Ctext, diskB: nf.Btext };
  }

  /** Puts a merge result in place: the cursor follows its line, and edit undo for the file is dropped
   *  (it would put back text from before the agent's write). */
  adoptMerge(f, next) {
    if (next.Ctext !== f.Ctext || next.Btext !== f.Btext) {
      if (this.sel === f.key) for (const k of ["cur", "anchor"]) if (this[k]) this[k] = { ...this[k], line: mapLine(this[k].line, f.Ctext ?? "", next.Ctext ?? "") };
      this.history = this.history.filter((e) => !(e.edit && e.key === f.key)); this.redo = this.redo.filter((e) => e.key !== f.key);
    }
    this.replace(f, next); this.settle();
  }

  dirty(f) { return !!f && !f.error && (f.Ctext !== f.diskC || f.Btext !== f.diskB); }

  async reloadOne(f, cx) {
    if (f.plain) {
      const next = await this.loadPlain(f.store, f.rel, cx);
      this.replace(f, next); this.settle(); cx.notify(); return;
    }
    const entry = (await f.store.index())[f.rel];
    const i = this.files.findIndex((x) => x.key === f.key);
    if (!entry || i < 0) return this.reloadAll(cx);
    this.files[i] = await this.withTokens(await f.store.load(f.rel, entry), cx);
    this.settle(); cx.notify();
  }

  // Watch events: our own writes match memory and are skipped; anything else reloads that file.
  // While writes are queued, events wait so a half-written state is never read back.
  onWatch(touched, cx) {
    if (touched === "all") this.deferred.add("*");
    else for (const n of touched) this.deferred.add(n);
    if (!this.writing) cx.spawn(async (cx) => this.drain(cx));
  }

  async drain(cx) {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.deferred.size && !this.writing) {
        const pending = this.deferred; this.deferred = new Set();
        let indexChanged = false;
        for (const st of this.stores) if ((await readTextFile(`${st.dir}/index.json`)) !== this.indexTexts[st.root]) indexChanged = true;
        if (pending.has("*") || indexChanged) { await this.reloadAll(cx); continue; }
        for (const f of this.files) {
          if (f.error || !pending.has(norm(f.path))) continue;
          // Both sides: accepting only moves the baseline, so a baseline changed elsewhere
          // (another pane, capture, a reset) must be noticed even when the file itself is unchanged.
          // A plain (opened, unchanged) file has no baseline on disk: it is the file itself.
          const [c, b0] = await Promise.all([readTextFile(f.path), f.plain ? null : readTextFile(f.basePath)]), b = f.plain ? c : b0;
          if ((c === f.diskC && (b ?? "") === f.diskB) || this.sameConflict(f, c, b ?? "")) continue;
          if (!this.dirty(f)) { await this.reloadOne(f, cx); continue; }
          const next = await this.mergeInto(f, { ...f, Ctext: c, Btext: b ?? "" }, cx);
          // Typed into while merging: merge again from the newer edits.
          if (!this.files.includes(f)) { this.deferred.add(norm(f.path)); continue; }
          this.adoptMerge(f, next); cx.notify();
        }
      }
    } finally { this.draining = false; }
  }

  // Highlighting cached by content, so a reload re-tokenizes only text that changed.
  async tok(text, rel, cx) {
    const key = `${languageOf(rel)}\0${text}`;
    if (!this.tokens.has(key)) {
      this.tokens.set(key, await highlight(text, languageOf(rel), cx));
      if (this.tokens.size > 40) this.tokens.delete(this.tokens.keys().next().value);
    }
    return this.tokens.get(key);
  }

  // ---- selection -----------------------------------------------------------

  // A file stays in view while it's being edited, even once it has no changes left.
  shown(f) { return f.hunks.length || (f.edited && f.key === this.sel) || this.dirty(f); }
  /** The tabs: changed files, plus in the Edit view the files opened from the tree. */
  visible() {
    const changed = (f) => !f.plain && (f.error || this.shown(f));
    return this.files.filter((f) => changed(f) || (this.mode === "edit" && this.opened.includes(f.key)));
  }
  file() { return this.visible().find((f) => f.key === this.sel && !f.error); }

  replace(f, state) {
    const i = this.files.findIndex((x) => x.key === f.key);
    if (i >= 0) this.files[i] = state;
  }

  /** Keeps the selection on a file that still has hunks, preferring the next one. */
  settle() {
    const vis = this.visible();
    if (!vis.some((f) => f.key === this.sel)) {
      const at = this.files.findIndex((f) => f.key === this.sel);
      const next = this.files.slice(at + 1).find((f) => vis.includes(f)) ?? vis[vis.length - 1];
      this.sel = next?.key ?? null; this.current = 0;
    }
    const f = this.file();
    this.current = f ? Math.max(0, Math.min(this.current, f.hunks.length - 1)) : 0;
    if (!f) this.cur = this.anchor = null;
    else if (this.cur) { this.cur = this.clampPos(f, this.cur); if (this.anchor) this.anchor = this.clampPos(f, this.anchor); }
    if (this.sel) this.showTab(this.sel); // no-op when its tab is already on screen
  }

  rowsOf(f) {
    if (f._rowsFor !== f.hunks || f._rowsC !== f.C) {
      f._rows = buildRows(f.B, f.C, f.hunks); f._rowsFor = f.hunks; f._rowsC = f.C;
      f._lineRow = [];
      f._rows.forEach((r, i) => { if (r.side === "new") f._lineRow[r.line] = i; });
    }
    return f._rows;
  }

  reveal() {
    const f = this.file();
    if (!f) return;
    const at = this.rowsOf(f).findIndex((r) => r.hunk === this.current);
    if (at >= 0) this.scrollTo(at - Math.floor(this.viewRows() / 2));
  }

  // ---- file tab strip -------------------------------------------------------
  // The pane scrolls the strip itself: a clipped row shifted left by a pixel offset. The wheel
  // moves it by its real pixel distance (smooth, unlike a list's jump-to-item handle), and the
  // selected tab is brought into view by working out its position from the tab widths.

  /** A tab's width, estimated from its text; the same widths place tabs and find them again. */
  tabWidth(x) {
    const tag = this.tabTag(x);
    const repo = this.stores.length > 1 ? base(x.store.root).length * 6.2 + 6 : 0;
    return Math.ceil(26 + base(x.rel).length * 7.4 + repo + tag.length * 6.2 + 6 + (this.dirty(x) ? 12 : 0) + (this.closable(x) ? 16 : 0));
  }

  tabTag(x) { return x.error ? "error" : x.created ? "new" : x.Ctext === null ? "deleted" : x.hunks.length ? String(x.hunks.length) : ""; }

  /** Opened files close; changed files stay until reviewed (Q48). */
  closable(x) { return this.mode === "edit" && this.opened.includes(x.key) && !x.hunks.length; }

  tabMax() {
    const total = this.visible().reduce((w, x) => w + this.tabWidth(x), 0);
    return Math.max(0, total - (this.tabViewW ?? 0));
  }

  setTabOffset(px) { this.tabOffset = Math.max(0, Math.min(px, this.tabMax())); }

  /** Shifts the strip just enough to show `key`'s tab. */
  showTab(key) {
    if (!this.tabViewW) return; // not laid out yet; the size callback reveals it
    let x0 = 0;
    for (const x of this.visible()) {
      const w = this.tabWidth(x);
      if (x.key === key) {
        const off = this.tabOffset ?? 0, view = this.tabViewW ?? 0;
        if (x0 < off) this.setTabOffset(x0);
        else if (x0 + w > off + view) this.setTabOffset(x0 + w - view);
        return;
      }
      x0 += w;
    }
  }

  /** Either wheel axis, in pixels (lines count as 20 px). */
  tabWheel(ev, cx) {
    const d = ev.delta_lines ? (ev.delta_lines.x || ev.delta_lines.y) * 20 : ev.delta.x || ev.delta.y;
    if (!d) return;
    this.setTabOffset((this.tabOffset ?? 0) - d);
    cx.notify();
    cx.stop_propagation();
  }

  tab(x, t) {
    return h_flex().id(`file-${x.key}`).flex_none().w(this.tabWidth(x)).h_full().pr(4).items_center()
      .on_click((_e, cx) => this.pick(x.key, cx))
      .child(h_flex().w_full().h(26).px(10).gap(6).items_center().rounded(6).overflow_hidden().cursor_pointer()
        .when(x.key === this.sel, (e) => e.bg(t.selected)).hover((st) => st.bg(t.hover))
        .when(this.stores.length > 1, (e) => e.child(div().text_size(10).text_color(t.dim).whitespace_nowrap().child(base(x.store.root))))
        .child(div().text_size(12).whitespace_nowrap().child(base(x.rel)))
        .when(this.dirty(x), (e) => e.child(div().text_size(10).text_color(t.accent).child("●")))
        .child(div().text_size(10).whitespace_nowrap().text_color(x.error ? t.ansi1 : t.muted).child(this.tabTag(x)))
        .when(this.closable(x), (e) => e.child(div().id(`close-${x.key}`).px(3).rounded(3).text_size(11).text_color(t.dim)
          .hover((st) => st.bg(t.raised).text_color(t.foreground)).child("×")
          .on_click((_e, cx) => { cx.stop_propagation(); this.closeTab(x.key, cx); }))));
  }

  // ---- Edit view: opened files and the file tree (Q48) ---------------------------

  /** A file opened from the tree that has no changes: its own baseline, kept in memory only. */
  async loadPlain(store, rel, cx) {
    const path = `${store.root}/${rel}`, key = `${store.root}|${rel}`, f = { rel, path, basePath: null, store, key, plain: true, created: false, by: null, as: null, hunks: [] };
    let text = null, error = null;
    try { text = await readTextFile(path); } catch (e) { error = String(e.message ?? e); }
    if (!error && text === null) error = "file not found";
    if (!error && text.includes("\0")) error = "binary file";
    if (error) return { ...f, error };
    const C = splitLines(text);
    return this.withTokens({ ...f, Btext: text, Ctext: text, B: C, C }, cx);
  }

  async openFile(store, rel, cx, at = null) {
    const key = `${store.root}|${rel}`, space = this.spaceId;
    this.recent = [key, ...this.recent.filter((k) => k !== key)].slice(0, 30);
    // Neovim's Edit view is the tree alone: the file goes straight to Neovim, at its first change.
    if (this.treeOnly()) {
      const f = this.files.find((x) => x.key === key);
      this.treeSel = key; this.revealInTree(key); cx.notify();
      try { await openInNvim(space, store.root, `${store.root}/${rel}`, at?.line ?? f?.hunks[0]?.n ?? 0); }
      catch (e) { this.error = String(e.message ?? e); cx.notify(); }
      return;
    }
    if (!this.files.some((f) => f.key === key)) {
      const f = await this.loadPlain(store, rel, cx);
      if (this.spaceId !== space || this.files.some((x) => x.key === key)) return;
      this.files.push(f);
    }
    if (!this.opened.includes(key)) this.opened.push(key);
    this.pick(key, cx);
    const f = this.file();
    if (f && at && f.key === key) { this.cur = this.clampPos(f, at); this.anchor = null; this.showCursor(); cx.notify(); }
    if (f && this.nvim()) this.toNvim(f, at?.line ?? f.hunks[0]?.n ?? 0, cx);
  }

  // ---- Quick Open (ctrl-p) ------------------------------------------------------

  openQuick(cx) {
    if (!this.stores.length) return;
    this.refreshTrees(cx);
    this.qo = { sel: 0, items: [] };
    this.quickInput.set_value(""); this.rankQuick();
    this.quickInput.focus(); cx.notify();
  }

  closeQuick(cx) { this.qo = null; this.inBar = null; this.handle.focus(); cx.notify(); }

  moveQuick(by, cx) {
    if (!this.qo?.items.length) return;
    const n = this.qo.items.length;
    this.qo.sel = (this.qo.sel + by + n) % n; cx.notify();
  }

  /** Every file of the space's repos, recent and changed ones first (the order an empty query shows). */
  quickItems() {
    const seen = new Set(), out = [];
    const add = (store, rel) => { const k = `${store.root}|${rel}`; if (!seen.has(k)) { seen.add(k); out.push({ key: k, store, rel }); } };
    const byKey = new Map(this.files.map((f) => [f.key, f]));
    for (const k of this.recent) { const f = byKey.get(k); if (f) add(f.store, f.rel); else { const st = this.stores.find((s) => k.startsWith(s.root + "|")); if (st) add(st, k.slice(st.root.length + 1)); } }
    for (const f of this.files) if (!f.plain && !f.error && f.hunks.length) add(f.store, f.rel);
    const head = out.length;
    for (const st of this.stores) for (const rel of this.trees.get(st.root)?.paths ?? []) add(st, rel);
    return { all: out, head };
  }

  /** Tab: the box takes the highlighted file's path, keeping any :line already typed. */
  completeQuick(cx) {
    const it = this.qo?.items[this.qo.sel];
    if (!it) return;
    const at = /(:\d*(?::\d*)?)\s*$/.exec(this.quickInput.value())?.[1] ?? "";
    this.quickInput.set_value(it.rel + at);
    this.rankQuick(); cx.notify();
  }

  rankQuick() {
    if (!this.qo) return;
    const { name } = parseQuery(this.quickInput.value()), { all, head } = this.quickItems();
    this.qo.items = name ? rank(all, name) : all.slice(0, Math.max(head, 15)).map((it) => ({ ...it, pos: [] }));
    this.qo.sel = 0;
  }

  chooseQuick(i, cx) {
    const q = parseQuery(this.quickInput.value()), it = this.qo?.items[i];
    // ":12" alone: a line in the current file.
    if (!q.name && q.at) {
      const f = this.file();
      this.closeQuick(cx);
      if (f) { this.cur = this.clampPos(f, q.at); this.anchor = null; this.showCursor(); if (this.nvim()) this.toNvim(f, q.at.line, cx); cx.notify(); }
      return;
    }
    if (!it) return;
    this.closeQuick(cx);
    const changed = this.files.find((f) => f.key === it.key && !f.plain && f.hunks.length);
    if (this.mode === "review" && !changed) this.setMode("edit", cx);
    cx.spawn(async (cx) => this.openFile(it.store, it.rel, cx, q.at));
  }

  quickOpen(t) {
    const items = this.qo.items, multi = this.stores.length > 1, counts = new Map(this.files.map((f) => [f.key, f.hunks.length]));
    const label = (it) => {
      const cut = it.rel.lastIndexOf("/") + 1, name = it.rel.slice(cut), dir = it.rel.slice(0, Math.max(0, cut - 1)), hit = new Set(it.pos);
      // The file name with its matched letters in the accent color.
      const parts = [];
      for (let i = 0; i < name.length; ) {
        const on = hit.has(cut + i); let j = i;
        while (j < name.length && hit.has(cut + j) === on) j++;
        parts.push(div().when(on, (e) => e.text_color(t.accent).font_semibold()).child(name.slice(i, j)));
        i = j;
      }
      return h_flex().min_w(0).gap(8).items_center()
        .child(h_flex().flex_none().text_size(13).children(parts))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child((multi ? base(it.store.root) + (dir ? "/" : "") : "") + dir));
    };
    return div().absolute().top(44).left(0).right(0).flex().justify_center().child(
      v_flex().w(620).max_w_full().max_h(440).p(6).gap(4).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .child(Input.new(this.quickInput))
        .child(v_flex().id("quick-list").overflow_y_scrollbar().children(items.map((it, i) =>
          h_flex().id(`quick-${it.key}`).h(26).flex_none().px(8).gap(8).items_center().rounded(4).cursor_pointer()
            .when(i === this.qo.sel, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.chooseQuick(i, cx))
            .child(div().flex_1().min_w(0).child(label(it)))
            .when(!!counts.get(it.key), (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi3).child(String(counts.get(it.key))))))))
        .when(!items.length, (e) => e.child(div().px(8).py(6).text_size(12).text_color(t.dim).child(this.trees.size ? "No matching files" : "Loading files…"))));
  }

  nvim() { return this.settings.editor === "nvim"; }

  /** E9: the current file in VS Code, at the cursor, else at the current change. Unsaved edits are saved first. */
  toVSCode(cx) {
    const f = this.file();
    if (!f || f.Ctext === null) return;
    if (this.dirty(f) && !f.conflict) this.save(cx, f);
    const at = this.cur ?? { line: f.hunks[this.current]?.n ?? 0, col: 0 };
    cx.spawn(async (cx) => {
      try { await openInVSCode(f.path, at.line, at.col); }
      catch (e) { this.error = String(e.message ?? e); cx.notify(); }
    });
  }
  treeOnly() { return this.mode === "edit" && this.nvim(); }

  /** Opens `f` at `line` in the space's Neovim (N1). */
  toNvim(f, line, cx) {
    if (!f || f.Ctext === null) return;
    const space = this.spaceId;
    cx.spawn(async (cx) => {
      try { await openInNvim(space, f.store.root, f.path, line); }
      catch (e) { this.error = String(e.message ?? e); cx.notify(); }
    });
  }

  /** Closing saves unsaved edits when autosave is on (Q46); without it they must be saved first. */
  closeTab(key, cx) {
    const f = this.files.find((x) => x.key === key);
    if (f && this.dirty(f)) {
      if (!this.settings.autosave || f.conflict) { this.error = `${base(f.rel)} has unsaved edits: save them first (${this.kl("save")})`; cx.notify(); return; }
      this.save(cx, f);
    }
    this.opened = this.opened.filter((k) => k !== key);
    if (f?.plain) this.files = this.files.filter((x) => x.key !== key);
    if (this.sel === key) { this.cur = this.anchor = null; this.hx = 0; }
    this.error = null; this.settle(); cx.notify();
  }

  /** Adds a repo to this space by hand: for agents Wingman can't place (a WSL agent started in a
   *  Windows folder, or one the hook hasn't seen edit). Kept in the space -> repos map. */
  openFolder(cx) {
    const space = this.spaceId;
    if (!space) return;
    cx.spawn(async (cx) => {
      try {
        const dir = await pickFolder({ prompt: "Open in Wingman" });
        if (!dir) return;
        const st = await Store.open(dir).catch(() => null);
        if (!st) { this.error = `${dir} is not in a git repository`; cx.notify(); return; }
        // The capture leader writes the same file: retry when it wrote first.
        for (let i = 0; ; i++) {
          try { await addSpaceRepos([[space, st.root]]); break; } catch (e) { if (i >= 2) throw e; }
        }
        this.error = null; cx.notify();
        await this.follow(cx);
      } catch (e) { this.error = String(e.message ?? e); cx.notify(); }
    });
  }

  setMode(mode, cx) {
    if (mode === this.mode) return;
    if (this.settings.autosave) this.saveAll(cx); // leaving a view saves (Q46)
    this.mode = mode;
    if (mode === "edit" && (this.treeOn || this.nvim())) this.refreshTrees(cx);
    this.settle(); this.handle.focus(); cx.notify();
  }

  /** ctrl-b: shows or hides the tree, switching to the Edit view first if needed. */
  toggleTree(cx) {
    if (this.mode !== "edit") { this.treeOn = true; return this.setMode("edit", cx); }
    this.treeOn = !this.treeOn;
    if (this.treeOn) this.refreshTrees(cx);
    cx.notify();
  }

  toggleDir(k, cx) { if (!this.expanded.delete(k)) this.expanded.add(k); cx.notify(); }

  revealInTree(key) {
    const i = key.indexOf("|"), root = key.slice(0, i), rel = key.slice(i + 1);
    for (const p of parents(rel)) this.expanded.add(`${root}|${p}`);
  }

  /** Each repo's files: tracked and untracked, without ignored ones. */
  refreshTrees(cx) {
    if (this.treeBusy) return;
    this.treeBusy = true;
    cx.spawn(async (cx) => {
      try {
        for (const st of this.stores) {
          const r = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: st.root });
          if (r.code !== 0) { this.trees.set(st.root, { error: (r.stderr || r.stdout).trim() }); continue; }
          if (this.trees.get(st.root)?.list === r.stdout) continue;
          const paths = [...new Set(r.stdout.split("\0").filter(Boolean))];
          this.trees.set(st.root, { list: r.stdout, paths, set: new Set(paths) });
        }
      } catch (e) { log(`tree: ${e.message ?? e}`); }
      finally { this.treeBusy = false; if (this.qo) this.rankQuick(); cx.notify(); }
    });
  }

  /** Change counts and unsaved marks per file and folder of one repo. */
  treeCounts(st) {
    const counts = new Map(), add = (rel, n, dirty) => {
      const c = counts.get(rel) ?? { n: 0, dirty: false };
      c.n += n; c.dirty ||= dirty; counts.set(rel, c);
    };
    for (const f of this.files) if (f.store === st && !f.error) {
      const n = f.hunks.length, d = this.dirty(f);
      if (!n && !d) continue;
      add(f.rel, n, d);
      for (const p of parents(f.rel)) add(p, n, d);
    }
    return counts;
  }

  /** A repo's folder tree; changed files the listing lacks (deleted ones) are added. */
  treeOf(st) {
    const tr = this.trees.get(st.root);
    if (!tr?.paths) return null;
    const extra = this.files.filter((f) => f.store === st && !f.plain && !tr.set.has(f.rel)).map((f) => f.rel).sort().join("\n");
    if (tr.node && tr.extra === extra) return tr.node;
    tr.extra = extra; tr.node = buildTree(extra ? [...tr.paths, ...extra.split("\n")] : tr.paths);
    return tr.node;
  }

  renderTree(t, full = false) {
    const multi = this.stores.length > 1, out = [], picked = full ? this.treeSel : this.sel;
    const note = (id, text, color = t.dim) => div().id(id).px(10).py(4).text_size(11).text_color(color).child(text);
    if (full && this.error) out.push(note("tree-error", this.error, t.ansi1));
    if (!this.stores.length) out.push(note("tree-none", "No repo in this space yet"));
    for (const st of this.stores) {
      const tr = this.trees.get(st.root), node = this.treeOf(st), counts = this.treeCounts(st);
      if (multi) out.push(div().id(`tree-repo-${st.root}`).px(10).pt(8).pb(2).text_size(11).font_semibold().text_color(t.muted).child(base(st.root)));
      if (tr?.error) { out.push(note(`tree-err-${st.root}`, tr.error, t.ansi1)); continue; }
      if (!node) { out.push(note(`tree-load-${st.root}`, "Loading…")); continue; }
      for (const row of flatten(node, (rel) => this.expanded.has(`${st.root}|${rel}`))) {
        const k = `${st.root}|${row.rel}`, c = counts.get(row.rel), open = this.expanded.has(k);
        out.push(h_flex().id(`tree-${k}`).h(22).flex_none().pl(8 + row.depth * 12).pr(8).gap(4).items_center().cursor_pointer()
          .when(!row.dir && k === picked, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => (row.dir ? this.toggleDir(k, cx) : cx.spawn(async (cx) => this.openFile(st, row.rel, cx))))
          .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(row.dir ? (open ? "▾" : "▸") : ""))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(row.dir ? t.muted : t.foreground).child(row.name))
          .when(!!c?.dirty, (e) => e.child(div().flex_none().text_size(10).text_color(t.accent).child("●")))
          .when(!!c?.n, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi3).child(String(c.n)))));
      }
    }
    out.push(div().id("tree-open-folder").mx(8).mt(6).px(6).h(22).flex().items_center().rounded(4).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.openFolder(cx)).child("+ Open folder…"));
    return v_flex().id("file-tree").h_full().py(4).overflow_y_scrollbar()
      .when(full, (e) => e.flex_1().min_w(0)).when(!full, (e) => e.w(240).flex_none().border_r(1).border_color(t.border)).children(out);
  }

  // ---- scrolling -------------------------------------------------------------
  // The pane scrolls the list itself, in whole rows, so it always knows which row is at
  // the top: the list reports no scroll position, and its rows can't take mouse handlers,
  // so this is what lets a pointer position map to a row (clicks, drags, the menu).

  viewRows() { return Math.max(1, Math.floor((this.viewH ?? 400) / ROW)); }

  /**
   * scroll_to_item only moves the list when the row is off screen, bringing it to the nearest
   * edge. So scrolling up asks for the new top row (above the view: lands at the top), and
   * scrolling down asks for the new bottom row (below the view: lands at the bottom). The list
   * is a whole number of rows tall, so either way the top lands exactly on a row.
   */
  scrollTo(top) {
    const f = this.file(), n = f ? this.rowsOf(f).length : 0, rows = this.viewRows(), cur = this.top ?? 0;
    const next = Math.max(0, Math.min(Math.round(top), Math.max(0, n - rows)));
    if (next < cur) this.scroll.scroll_to_item(next, "top");
    else if (next > cur) this.scroll.scroll_to_item(Math.min(n - 1, next + rows - 1), "top");
    this.top = next;
  }

  /** Keeps row `i` on screen, moving as little as possible. */
  ensureVisible(i) {
    const top = this.top ?? 0, rows = this.viewRows();
    if (i < top) this.scrollTo(i);
    else if (i >= top + rows) this.scrollTo(i - rows + 1);
  }

  /** The row under a y position in the diff, or -1. The scrollbar can also move the list, so
   *  the first row the list last drew wins over the pane's own idea of the top. */
  rowAt(y) {
    const f = this.file();
    if (!f) return -1;
    if (this.drawnTop != null && this.drawnTop !== this.top) this.top = this.drawnTop;
    const i = (this.top ?? 0) + Math.floor(y / ROW);
    return i >= 0 && i < this.rowsOf(f).length ? i : -1;
  }

  wheel(ev, cx) {
    // Sideways (Shift+wheel, or a sideways swipe) scrolls long lines.
    const dx = ev.delta_lines ? ev.delta_lines.x * 3 * this.cw() : ev.delta.x;
    const sideways = ev.modifiers?.shift ? (ev.delta_lines ? ev.delta_lines.y * 3 * this.cw() : ev.delta.y) : dx;
    if (ev.modifiers?.shift || Math.abs(dx) > Math.abs(ev.delta_lines?.y ?? ev.delta.y)) {
      this.hx = Math.max(0, this.hx - sideways); cx.notify(); cx.stop_propagation(); return;
    }
    const lines = ev.delta_lines?.y ?? ev.delta.y / ROW;
    this.wheelAcc = (this.wheelAcc ?? 0) - lines;
    const step = Math.trunc(this.wheelAcc);
    if (!step) return;
    this.wheelAcc -= step;
    this.scrollTo((this.top ?? 0) + step);
    if (this.dragging && this.dragY != null) this.dragTo(this.dragY);
    cx.notify();
    cx.stop_propagation();
  }

  // ---- pointer: click, Shift+click, drag, right-click ------------------------

  pointerDown(ev, cx) {
    this.handle.focus();
    const f = this.file(), x = ev.local_position?.x ?? -1, y = ev.local_position?.y ?? -1, i = this.rowAt(y);
    if (!f || i < 0) return;
    const r = this.rowsOf(f)[i];
    if (r.kind === "@") return this.rowButton(r.hunk, x, cx);
    // The text: place the cursor, select words or lines, or start a text drag (Q42).
    if (x >= GUTTER && this.editable(f)) return this.textDown(f, r, x, y, ev, cx);
    this.anchor = null; // the line numbers: line selection, as before
    const sel = this.lineSel(f), shift = !!ev.modifiers?.shift;
    this.dragging = true; this.dragY = y; this.downRow = i;
    // A press inside the selection deselects on release, unless it turns into a drag.
    this.pendingDeselect = !shift && !!sel && i >= sel[0] && i <= sel[1];
    if (!this.pendingDeselect) this.select(i, shift, cx);
  }

  /** While the button is held: extend the selection to the row under the pointer, scrolling
   *  a row at a time near the top and bottom edges. */
  pointerMove(ev, cx) {
    if (!this.dragging) return;
    this.dragY = ev.local_position.y; this.dragX = ev.local_position.x;
    if (this.dragY < ROW) this.scrollTo((this.top ?? 0) - 1);
    else if (this.dragY > (this.viewH ?? 400) - ROW) this.scrollTo((this.top ?? 0) + 1);
    this.dragTo(this.dragY);
    cx.notify();
  }

  dragTo(y) {
    const f = this.file(), n = f ? this.rowsOf(f).length : 0;
    const i = Math.max(0, Math.min((this.top ?? 0) + Math.floor(y / ROW), n - 1));
    if (this.tdrag) {
      const r = this.rowsOf(f)[i];
      if (r?.side === "new") this.cur = this.posAt(f, r, this.dragX ?? GUTTER);
      return;
    }
    if (this.pendingDeselect) {
      if (i === this.downRow) return;
      // Dragging from inside the selection starts a new one at the pressed line.
      this.pendingDeselect = false;
      this.selA = this.downRow; this.selFor = this.rowsOf(f);
    }
    if (this.selA != null) this.selB = i;
  }

  // A release outside the diff isn't reported, so leaving it ends the drag too (and is
  // never a deselecting click).
  pointerUp(cx, released = true) {
    if (released && this.pendingDeselect) this.clearSelection(cx);
    this.pendingDeselect = false; this.dragging = false; this.tdrag = false;
  }

  /** A hunk's button row: which button the x position falls on. */
  rowButton(i, x, cx) {
    if (x >= GUTTER + BTN_GAP && x < GUTTER + BTN_GAP + BTN_W) this.hunk("reject", i, cx);
    else if (x >= GUTTER + 2 * BTN_GAP + BTN_W && x < GUTTER + 2 * (BTN_GAP + BTN_W)) this.hunk("accept", i, cx);
    else if (x >= GUTTER + 3 * BTN_GAP + 2 * BTN_W && x < GUTTER + 3 * (BTN_GAP + BTN_W)) this.askPrompt(i, cx);
    else { this.current = i; cx.notify(); }
  }

  step(by, cx) {
    const f = this.file();
    if (!f) return;
    if (!f.hunks.length) return;
    this.current = (this.current + by + f.hunks.length) % f.hunks.length;
    if (this.cur) { const h = f.hunks[this.current]; this.cur = this.clampPos(f, { line: h.n, col: 0 }); this.anchor = null; }
    this.reveal(); cx.notify();
  }

  stepFile(by, cx) {
    const vis = this.visible().filter((f) => !f.error);
    if (!vis.length) return;
    const at = vis.findIndex((f) => f.key === this.sel);
    this.pick(vis[(at + by + vis.length) % vis.length].key, cx);
  }

  pick(key, cx) {
    if (!this.visible().some((f) => f.key === key)) return;
    if (this.mode === "edit") this.revealInTree(key);
    if (key !== this.sel) {
      const old = this.file();
      if (old && this.settings.autosave && this.dirty(old) && !old.conflict) this.save(cx, old);
      this.cur = this.anchor = null; this.hx = 0;
    }
    this.sel = key; this.current = 0; this.top = 0; this.showTab(key); this.handle.focus(); this.reveal(); cx.notify();
  }

  // ---- actions -------------------------------------------------------------

  /**
   * Applies model actions to files at once and queues their disk writes.
   * `plan` is a list of [file, action] where action(state) -> { state, write }.
   */
  run(plan, cx, feedback = []) {
    if (!plan.length) return;
    if (plan.some(([f]) => f.conflict)) { this.error = "Pick Keep mine or Take agent's first"; cx.notify(); return; }
    const entry = { snaps: [], writes: [], feedback }, jobs = [], notes = [];
    for (const [f, action] of plan) {
      // Unsaved edits are saved first: the action's write expects memory and disk to agree.
      const saves = this.saveWrites(f), { state, write } = action(f), writes = [...saves, write];
      notes.push(...saves.map((w) => this.editNote(f, w)).filter(Boolean));
      Object.assign(state, { diskC: f.Ctext, diskB: f.Btext, conflict: null });
      state[write.target === "baseline" ? "diskB" : "diskC"] = write.after;
      entry.snaps.push(f);
      this.files[this.files.indexOf(f)] = state;
      jobs.push([state, writes]);
    }
    this.history.push(entry); this.redo = [];
    this.error = null; this.settle(); this.reveal(); cx.notify();
    this.enqueue(async () => {
      for (const [f, ws] of jobs) for (const w of ws) entry.writes.push(await f.store.apply(f, w));
      for (const m of feedback) await queueFeedback(m.terminal, m.text);
      await this.sendEditNotes(notes);
    }, cx);
  }

  undo(cx) {
    const entry = this.history.pop();
    if (!entry) return;
    if (entry.edit) return this.swapEdit(entry, this.redo, cx);
    this.redo = [];
    for (const snap of entry.snaps) {
      const i = this.files.findIndex((f) => f.key === snap.key);
      if (i >= 0) this.files[i] = snap;
    }
    this.sel = entry.snaps[0].key; this.error = null; this.settle(); this.reveal(); cx.notify();
    this.enqueue(async () => {
      await entry.snaps[0].store.undo(entry.writes);
      for (const m of entry.feedback) await withdrawFeedback(m.terminal, m.text);
    }, cx);
  }

  /** Undo or redo of an edit: memory only. What's on disk stays, so the file shows as unsaved. */
  swapEdit(entry, other, cx) {
    const now = this.files.find((x) => x.key === entry.key);
    if (!now) return;
    other.push({ edit: true, key: entry.key, state: now, cur: this.cur, at: 0 });
    this.replace(now, { ...entry.state, diskC: now.diskC, diskB: now.diskB, conflict: now.conflict, edited: true });
    this.sel = entry.key; this.cur = entry.cur; this.anchor = null;
    this.settle(); this.showCursor(); this.retokenize(cx); cx.notify();
  }

  redoEdit(cx) {
    const entry = this.redo.pop();
    if (entry) this.swapEdit(entry, this.history, cx);
  }

  enqueue(job, cx) {
    this.writing++;
    // Each job runs in its own spawned task: a handler's cx is dead after the handler
    // returns, so the queue must never hold one across an await.
    const prev = this.queue;
    this.queue = new Promise((done) => cx.spawn(async (cx) => {
      try { await prev; await job(); }
      catch (e) {
        // Disk no longer matches memory: drop undo (it would act on stale state) and reread everything.
        this.error = String(e.message ?? e); this.history = []; this.deferred.add("*");
      } finally {
        this.writing--; done();
        if (!this.writing && this.deferred.size) await this.drain(cx);
        cx.notify();
      }
    }));
  }

  // ---- notes, reasons and prompts -----------------------------------------

  /**
   * The factual note for the agent that made a rejected change (O3: can be turned off).
   * It keeps the agent's picture of the file right; intent is left to the user's own reason.
   */
  rejected(f, what) {
    if (!f.by || !this.settings.autoNote) return [];
    return [{ terminal: f.by, text: `Code review: the user rejected ${what} in ${f.as ?? agentPath(f.path, f.by)}. The original lines are back on disk.` }];
  }

  /** The agent to ask about a file: the one that made the change, else the space's only agent. */
  target(f) {
    if (f.by && terminals().some((t) => t.address === f.by && t.state === "live")) return f.by;
    const here = agents().filter((a) => a.space === this.spaceId);
    return here.length === 1 ? here[0].address : null;
  }

  where(h) {
    return !h.nc ? `the removal at line ${h.n + 1}` : h.nc === 1 ? `line ${h.n + 1}` : `lines ${h.n + 1}-${h.n + h.nc}`;
  }

  /** O1: a reason for the last rejection, sent along as its own note. */
  askReason(cx) {
    const r = this.lastReject;
    if (!r) { this.error = "Nothing rejected yet to comment on"; cx.notify(); return; }
    this.openForm({ form: "reason", terminal: r.terminal, file: r.file, where: r.where, quote: r.quote });
  }

  /**
   * O2: an instruction typed into the agent's terminal as the user's message: about the
   * selected lines when there is a selection, else about hunk `i`.
   */
  askPrompt(i, cx) {
    const f = this.file();
    if (!f) return;
    const terminal = this.target(f);
    if (!terminal) { this.error = "No agent to send to: none made this change, and the space doesn't have exactly one"; cx.notify(); return; }
    const file = f.as ?? agentPath(f.path, terminal), sel = this.selection(f);
    if (sel) return this.openForm({ form: "prompt", terminal, file, ...this.quote(f, sel) });
    if (!f.hunks[i]) return;
    this.current = i;
    this.openForm({ form: "prompt", terminal, file, where: this.where(f.hunks[i]) });
  }

  // ---- line selection ------------------------------------------------------
  // Whole lines only: Herdr's rows have no text selection, and its Editor doesn't report one.

  /** [first, last] rows of the line selection, or null. Cleared when the rows change. */
  lineSel(f) {
    if (this.selA == null || this.selFor !== this.rowsOf(f)) return null;
    return [Math.min(this.selA, this.selB), Math.max(this.selA, this.selB)];
  }

  /** The rows Comment, Accept and Reject act on: the line selection, else the lines a text
   *  selection covers (a selection ending at the start of a line leaves that line out). */
  selection(f) {
    const ls = this.lineSel(f);
    if (ls || !this.hasTextSel()) return ls;
    this.rowsOf(f);
    const [a, b] = this.ordered();
    const last = b.col === 0 && b.line > a.line ? b.line - 1 : b.line;
    const ra = f._lineRow[a.line], rb = f._lineRow[last];
    return ra == null || rb == null ? null : [ra, rb];
  }

  select(i, extend, cx) {
    const f = this.file();
    if (!f) return;
    const rows = this.rowsOf(f);
    i = Math.max(0, Math.min(i, rows.length - 1));
    if (extend && this.lineSel(f)) this.selB = i;
    else { this.selA = this.selB = i; this.selFor = rows; }
    this.ensureVisible(i);
    cx.notify();
  }

  /** Shift+Up/Down: grow or shrink the selection from its moving end (or start at the current hunk). */
  extend(by, cx) {
    const f = this.file();
    if (!f) return;
    if (!this.lineSel(f)) {
      const at = this.rowsOf(f).findIndex((r) => r.hunk === this.current && r.kind !== "@");
      return this.select(Math.max(0, at), false, cx);
    }
    this.select(this.selB + by, true, cx);
  }

  clearSelection(cx) { this.selA = this.selB = null; this.anchor = null; cx.notify(); }

  /** The changed lines in the selection: baseline indexes of removed lines, current indexes of added. */
  picks(f, sel) {
    const pick = { old: new Set(), new: new Set() }, rows = this.rowsOf(f).slice(sel[0], sel[1] + 1);
    for (const r of rows) { if (r.kind === "-") pick.old.add(r.line); else if (r.kind === "+") pick.new.add(r.line); }
    return { pick, rows, any: pick.old.size + pick.new.size > 0 };
  }

  /**
   * Accept or reject only the selected changed lines. Unselected changes in the same hunks stay
   * pending. Returns false when there is no selection with changes, so callers fall back to the hunk.
   */
  selectionAction(how, cx, withReason = false) {
    const f = this.file(), sel = f && this.selection(f);
    if (!sel) return false;
    const { pick, rows, any } = this.picks(f, sel);
    if (!any) { this.error = "The selection has no changed lines"; cx.notify(); return true; }
    const where = `your change at ${this.quoteRows(f, rows).where}`;
    if (how === "reject") this.noteReject(f, where, rows.filter((r) => r.kind === "+" || r.kind === "-"));
    this.selA = this.selB = null; this.anchor = null;
    this.run([[f, (s) => partialAt(s, how, pick)]], cx, how === "reject" ? this.rejected(f, where) : []);
    if (withReason) this.askReason(cx);
    return true;
  }

  /** Keys and menu: the selected lines when there are any, else the current hunk. */
  decide(how, cx, withReason = false) {
    if (this.selectionAction(how, cx, withReason)) return;
    this.hunk(how, this.current, cx);
    if (withReason && how === "reject") this.askReason(cx);
  }

  /**
   * The selected lines as the agent should read them: where they are (current file's line
   * numbers, with removed lines noted) and the code itself, capped at 40 lines.
   */
  quote(f, [a, b]) { return this.quoteRows(f, this.rowsOf(f).slice(a, b + 1)); }

  quoteRows(f, picked) {
    const rows = picked.filter((r) => r.kind !== "@");
    const text = (r) => ((r.side === "old" ? f.B : f.C)[r.line] ?? "").replace(/\r?\n$/, "");
    const nums = rows.filter((r) => r.side === "new").map((r) => r.num);
    const removed = rows.filter((r) => r.kind === "-").length;
    const span = nums.length ? (nums[0] === nums[nums.length - 1] ? `line ${nums[0]}` : `lines ${nums[0]}-${nums[nums.length - 1]}`) : `removed lines`;
    const where = removed && nums.length ? `${span} (with ${removed} removed line${removed > 1 ? "s" : ""})` : span;
    const shown = rows.slice(0, 40).map((r) => `${r.kind === " " ? " " : r.kind} ${text(r)}`);
    if (rows.length > 40) shown.push(`… ${rows.length - 40} more lines`);
    return { where, quote: shown.join("\n") };
  }

  openForm(p) {
    openOverlay({ mod: "wingman", props: p, kind: "dialog", width: 560, height: p.quote ? 430 : 290 });
  }

  openSettings() {
    openOverlay({ mod: "wingman", props: { form: "settings" }, kind: "dialog", width: 460, height: 500 });
  }

  /** Every 250 ms (Q46). Herdr has no blur event, so focus is polled: the pane losing the
   *  keyboard, or the window losing focus, saves every file with unsaved edits. With a delay
   *  set, a pause in typing that long saves too. */
  autosave(cx) {
    if (!this.handle || !this.settings.autosave) return;
    let active = true;
    try { active = window.is_window_active(); } catch {}
    const focused = (this.handle.is_focused() || !!this.inBar) && active, lost = this.wasFocused && !focused;
    this.wasFocused = focused;
    const delay = this.settings.autosaveDelay, idle = delay > 0 && this.typedAt && Date.now() - this.typedAt >= delay * 1000;
    if (lost || idle) this.saveAll(cx);
  }

  saveAll(cx) {
    for (const f of this.files) if (this.dirty(f) && !f.conflict) this.save(cx, f);
  }


  hunk(how, i, cx) {
    const f = this.file();
    if (!f || !f.hunks[i]) return;
    this.current = i;
    const where = `your change at ${this.where(f.hunks[i])}`;
    // The hunk's own lines, captured before it goes, for the reason popup's preview.
    if (how === "reject") this.noteReject(f, where, this.rowsOf(f).filter((r) => r.hunk === i));
    this.run([[f, (s) => (how === "accept" ? acceptAt(s, i) : rejectAt(s, i))]], cx, how === "reject" ? this.rejected(f, where) : []);
  }

  /** Remembers the rejection a reason (ctrl-r) would explain. */
  noteReject(f, where, rows) {
    const terminal = this.target(f);
    this.lastReject = terminal ? { terminal, file: f.as ?? agentPath(f.path, terminal), where, quote: this.quoteRows(f, rows).quote } : null;
  }

  wholeFile(how, cx) {
    const f = this.file();
    if (!f?.hunks.length) return;
    if (how === "reject") this.noteReject(f, "all your changes", this.rowsOf(f).filter((r) => r.kind === "+" || r.kind === "-"));
    this.run([[f, how === "accept" ? acceptAll : rejectAll]], cx, how === "reject" ? this.rejected(f, "all your changes") : []);
  }

  everything(how, cx) {
    const files = this.files.filter((f) => !f.error && f.hunks.length);
    if (how === "reject") this.lastReject = null; // one reason can't name several files
    this.run(files.map((f) => [f, how === "accept" ? acceptAll : rejectAll]), cx,
      how === "reject" ? files.flatMap((f) => this.rejected(f, "all your changes")) : []);
  }

  // ---- editing (Q40-Q43) ------------------------------------------------------
  // The diff rows are the editor: the cursor sits in the current file (context and added
  // lines), removed lines are read-only. Edits change memory at once; ctrl-s writes them.

  editable(f) { return !!f && !f.error && f.Ctext !== null; }
  cw() { return this.charW ?? 7.2; }
  hasTextSel() { return !!(this.anchor && this.cur && cmp(this.anchor, this.cur)); }
  ordered() { return cmp(this.anchor, this.cur) <= 0 ? [this.anchor, this.cur] : [this.cur, this.anchor]; }

  clampPos(f, p) {
    const lines = linesOf(f), line = Math.max(0, Math.min(p.line, lines.length - 1));
    return { line, col: Math.max(0, Math.min(p.col, body(lines[line]).length)) };
  }

  /** The position under x on row `r` (a line of the current file). */
  posAt(f, r, x) {
    const text = body(linesOf(f)[r.line]);
    return { line: r.line, col: charAt(text, (x - GUTTER + this.hx) / this.cw()) };
  }

  textDown(f, r, x, y, ev, cx) {
    if (r.hunk != null) this.current = r.hunk;
    // Editor "nvim": a click opens Neovim at that line; Wingman stays the review.
    if (this.nvim()) return this.toNvim(f, r.side === "new" ? r.line : r.hunk != null ? f.hunks[r.hunk].n : 0, cx);
    if (r.side !== "new") { cx.notify(); return; } // removed lines are read-only
    const p = this.posAt(f, r, x), lines = linesOf(f);
    this.selA = this.selB = null; this.goalX = null;
    if (ev.click_count === 2) { [this.anchor, this.cur] = wordAt(lines, p); cx.notify(); return; }
    if (ev.click_count >= 3) {
      this.anchor = { line: p.line, col: 0 };
      this.cur = p.line + 1 < lines.length ? { line: p.line + 1, col: 0 } : { line: p.line, col: body(lines[p.line]).length };
      cx.notify(); return;
    }
    if (ev.modifiers?.shift && this.cur) this.anchor ??= this.cur; else this.anchor = p;
    this.cur = p;
    this.dragging = true; this.tdrag = true; this.dragY = y; this.dragX = x;
    cx.notify();
  }

  /** Keeps the cursor on screen: its row, and its column when lines are long. */
  showCursor() {
    const f = this.file();
    if (!f || !this.cur) return;
    this.rowsOf(f);
    const row = f._lineRow[this.cur.line];
    if (row != null) this.ensureVisible(row);
    const x = visualCol(body(linesOf(f)[this.cur.line]), this.cur.col) * this.cw();
    const view = Math.max(60, (this.viewW ?? 600) - GUTTER - 40);
    if (x < this.hx) this.hx = Math.max(0, x - 60);
    else if (x > this.hx + view) this.hx = x - view + 60;
  }

  move(to, extend, cx) {
    const f = this.file();
    if (!f || !this.cur) return;
    if (extend) this.anchor ??= this.cur; else this.anchor = null;
    this.cur = this.clampPos(f, to); this.selA = this.selB = null; this.goalX = null;
    this.showCursor(); cx.notify();
  }

  /** Up/Down and PageUp/PageDown keep the column the cursor started from. */
  vertical(by, extend, cx) {
    const f = this.file(), lines = linesOf(f);
    const goal = this.goalX ?? visualCol(body(lines[this.cur.line]), this.cur.col);
    const line = Math.max(0, Math.min(lines.length - 1, this.cur.line + by));
    this.move({ line, col: charAt(body(lines[line]), goal) }, extend, cx);
    this.goalX = goal;
  }

  /**
   * Replaces the text from `from` to `to` (default: the selection, else the cursor) with `text`.
   * Quick typing (`group`) is one undo step; anything else is its own.
   */
  type(text, cx, { from, to, group = false, select = false } = {}) {
    const f = this.file();
    if (!this.editable(f) || !this.cur) return;
    const sel = this.hasTextSel(), a = from ?? (sel ? this.anchor : this.cur), b = to ?? this.cur;
    const lang = languageOf(f.rel);
    const { state, cursor } = edit(f, a, b, text, (ls) => highlightLines(ls, lang));
    const last = this.history[this.history.length - 1], now = Date.now();
    if (group && last?.edit && last.group && last.key === f.key && now - last.at < 1000) last.at = now;
    else this.history.push({ edit: true, key: f.key, state: f, cur: this.cur, at: now, group });
    this.redo = [];
    state.edited = true;
    this.replace(f, state);
    const start = cmp(a, b) <= 0 ? a : b;
    this.anchor = select ? start : null; this.cur = cursor;
    this.selA = this.selB = null; this.goalX = null; this.error = null;
    this.settle(); this.showCursor(); this.retokenize(cx); cx.notify();
  }

  /** Rewrites whole lines l1..l2 (indent, outdent) and keeps them selected. */
  editLines(l1, l2, fn, cx) {
    const f = this.file(), lines = linesOf(f);
    const text = lines.slice(l1, l2 + 1).map((l) => fn(body(l))).join("\n");
    this.type(text, cx, { from: { line: l1, col: 0 }, to: { line: l2, col: body(lines[l2]).length }, select: l2 > l1 });
  }

  /** Lines typed are highlighted one by one; the whole file again once typing pauses. */
  retokenize(cx) {
    const at = (this.typedAt = Date.now());
    cx.timer.after(500, (cx) => {
      const f = this.file();
      if (this.typedAt !== at || !f) return;
      cx.spawn(async (cx) => {
        const newTok = await this.tok(f.Ctext ?? "", f.rel, cx), oldTok = await this.tok(f.Btext, f.rel, cx);
        const g = this.files.find((x) => x.key === f.key);
        if (g && g.Ctext === f.Ctext && g.Btext === f.Btext) { g.newTok = newTok; g.oldTok = oldTok; cx.notify(); }
      });
    });
  }

  /** The text to copy: the text selection, else the selected lines, else the cursor's line. */
  copyText(f) {
    const lines = linesOf(f);
    if (this.hasTextSel()) return textBetween(lines, this.anchor, this.cur);
    const ls = this.lineSel(f);
    if (ls) return this.rowsOf(f).slice(ls[0], ls[1] + 1).filter((r) => r.kind !== "@")
      .map((r) => body((r.side === "old" ? f.B : f.C)[r.line]) + "\n").join("");
    return this.cur ? body(lines[this.cur.line]) + "\n" : "";
  }

  /** Editing keys while the cursor is in the file. False lets the review keys have it. */
  editKey(e, f, cx) {
    const m = e.modifiers, ctrl = m.control || m.platform, shift = m.shift, lines = linesOf(f), c = this.cur;
    const sel = this.hasTextSel(), [sa, sb] = sel ? this.ordered() : [c, c];
    const lineEnd = (l) => ({ line: l, col: body(lines[l]).length });
    if (m.alt && !ctrl) return false;
    switch (e.key) {
      case "left":
        if (sel && !shift) return this.move(sa, false, cx), true;
        return this.move(ctrl ? wordMove(lines, c, -1) : c.col > 0 ? { line: c.line, col: c.col - 1 } : c.line > 0 ? lineEnd(c.line - 1) : c, shift, cx), true;
      case "right":
        if (sel && !shift) return this.move(sb, false, cx), true;
        return this.move(ctrl ? wordMove(lines, c, 1) : c.col < body(lines[c.line]).length ? { line: c.line, col: c.col + 1 } : c.line + 1 < lines.length ? { line: c.line + 1, col: 0 } : c, shift, cx), true;
      case "up": case "down":
        if (ctrl || (shift && this.lineSel(f))) return false; // ctrl-up/down: changes, ctrl-shift-up/down: files; Shift grows a line selection
        return this.vertical(e.key === "up" ? -1 : 1, shift, cx), true;
      case "pageup": case "pagedown":
        return this.vertical((e.key === "pageup" ? -1 : 1) * this.viewRows(), shift, cx), true;
      case "home": {
        if (ctrl) return this.move({ line: 0, col: 0 }, shift, cx), true;
        const ind = /^\s*/.exec(body(lines[c.line]))[0].length; // first press: after the indent
        return this.move({ line: c.line, col: c.col === ind ? 0 : ind }, shift, cx), true;
      }
      case "end":
        return this.move(ctrl ? lineEnd(lines.length - 1) : lineEnd(c.line), shift, cx), true;
      case "backspace":
        if (ctrl && shift) return false; // reject file
        if (sel) return this.type("", cx), true;
        if (c.line === 0 && c.col === 0) return true;
        if (!ctrl && this.settings.autoPairs && inEmptyPair(body(lines[c.line]), c.col))
          return this.type("", cx, { from: { line: c.line, col: c.col - 1 }, to: { line: c.line, col: c.col + 1 }, group: true }), true;
        return this.type("", cx, { from: ctrl ? wordMove(lines, c, -1) : c.col > 0 ? { line: c.line, col: c.col - 1 } : lineEnd(c.line - 1), to: c, group: !ctrl }), true;
      case "delete": {
        if (sel) return this.type("", cx), true;
        const end = c.col < body(lines[c.line]).length ? { line: c.line, col: c.col + 1 } : c.line + 1 < lines.length ? { line: c.line + 1, col: 0 } : c;
        return this.type("", cx, { from: c, to: ctrl ? wordMove(lines, c, 1) : end, group: !ctrl }), true;
      }
      case "enter": {
        if (ctrl || shift) return false; // ctrl-shift-enter: accept file
        const indent = /^\s*/.exec(body(lines[sa.line]).slice(0, sa.col))[0];
        // Between brackets, "{|}": the closer goes to its own line and the cursor to an indented one.
        if (!sel && this.settings.autoPairs && betweenBrackets(body(lines[c.line]), c.col)) {
          const inner = indent + indentUnit(lines);
          this.type("\n" + inner + "\n" + indent, cx);
          this.cur = { line: c.line + 1, col: inner.length }; this.showCursor(); cx.notify();
          return true;
        }
        return this.type("\n" + indent, cx), true;
      }
      case "tab": {
        if (ctrl) return false;
        const unit = indentUnit(lines);
        if (shift) return this.editLines(sa.line, sb.line, (t) => t.replace(unit === "\t" ? /^\t/ : new RegExp(`^ {1,${unit.length}}`), ""), cx), true;
        if (sel && sa.line !== sb.line) return this.editLines(sa.line, sb.line, (t) => (t ? unit + t : t), cx), true;
        return this.type(unit, cx, { group: true }), true;
      }
      case "escape":
        if (!sel) return false;
        this.anchor = null; cx.notify(); return true;
    }
    if (ctrl && !m.alt) return false; // ctrl keys are actions (keymap.js)
    // Typed characters; Ctrl+Alt is AltGr on Windows keyboards.
    if (e.key_char && !m.platform && (!m.control || m.alt) && !/[\r\n]/.test(e.key_char)) {
      if (this.settings.autoPairs && this.autoPair(e.key_char, lines, sel, sa, sb, cx)) return true;
      this.type(e.key_char, cx, { group: true });
      return true;
    }
    return false;
  }

  /** E3: a line operation on the lines the cursor or selection covers, as one undo step. */
  lineOp(name, cx) {
    const f = this.file();
    if (!this.editable(f) || !this.cur) return;
    const lines = linesOf(f), anchor = this.hasTextSel() ? this.anchor : null, cur = this.cur;
    const [l1, l2] = lineSpan(anchor, cur);
    const op = {
      moveUp: () => moveLines(lines, l1, l2, -1, anchor, cur),
      moveDown: () => moveLines(lines, l1, l2, 1, anchor, cur),
      copyUp: () => copyLines(lines, l1, l2, -1, anchor, cur),
      copyDown: () => copyLines(lines, l1, l2, 1, anchor, cur),
      delete: () => deleteLines(lines, l1, l2, cur),
      join: () => joinLines(lines, l1, l2),
      comment: () => toggleComment(lines, l1, l2, commentFor(f.rel), anchor, cur),
    }[name]?.();
    if (!op) { if (name === "comment" && !commentFor(f.rel)) { this.error = `No comment syntax known for ${base(f.rel)}`; cx.notify(); } return; }
    this.type(op.text, cx, { from: op.from, to: op.to });
    const g = this.file();
    this.anchor = op.anchor && this.clampPos(g, op.anchor); this.cur = this.clampPos(g, op.cur);
    this.showCursor(); cx.notify();
  }

  /**
   * E2: a typed bracket or quote. With text selected it wraps the selection (kept selected);
   * otherwise it may step over the same closer or type the pair with the cursor between.
   * True when handled.
   */
  autoPair(ch, lines, sel, sa, sb, cx) {
    const close = PAIRS[ch];
    if (sel) {
      if (!close) return false;
      const inner = textBetween(lines, sa, sb);
      this.type(ch + inner + close, cx);
      this.anchor = { line: sa.line, col: sa.col + 1 };
      this.cur = sa.line === sb.line ? { line: sa.line, col: sb.col + 1 } : { line: sb.line, col: sb.col };
      this.showCursor(); cx.notify();
      return true;
    }
    const c = this.cur, d = typed(ch, body(lines[c.line]), c.col);
    if (d?.skip) return this.move({ line: c.line, col: c.col + 1 }, false, cx), true;
    if (!d?.insert) return false;
    this.type(d.insert, cx, { group: true });
    this.cur = { line: this.cur.line, col: this.cur.col - 1 }; this.showCursor(); cx.notify();
    return true;
  }

  // ---- find, replace, go to line (E6) ----------------------------------------

  initFind() {
    this.bar = null; // null, or { mode: "find" | "replace" | "line" }
    this.findOpts = { cased: false, word: false, regex: false };
    this.findInput = InputState.new({ placeholder: "Find" });
    this.replaceInput = InputState.new({ placeholder: "Replace" });
    this.lineInput = InputState.new({ placeholder: "Line, or line:column" });
    this.quickInput = InputState.new({ placeholder: "Search files by name (add :line to go to a line, or start with : for this file)" });
    this.qo = null; this.recent = []; // Quick Open: null, or { sel, items }; recent: file keys, newest first
    this.quickInput.on("change", (_e, cx) => { this.rankQuick(); cx.notify(); });
    this.quickInput.on("submit", (_e, cx) => this.chooseQuick(this.qo?.sel ?? 0, cx));
    for (const i of [this.findInput, this.replaceInput, this.lineInput, this.quickInput]) {
      i.on("focus", () => { this.inBar = i; });
      i.on("blur", () => { if (this.inBar === i) this.inBar = null; });
    }
    // Typing a query jumps to the first match from where the search started (VS Code's incremental find).
    this.findInput.on("change", (_e, cx) => { this.findFrom ??= this.cur; this.findStep(0, cx); });
    this.findInput.on("submit", (e, cx) => this.findStep(e?.shift ? -1 : 1, cx));
    this.replaceInput.on("submit", (e, cx) => (e?.secondary ? this.replaceAll(cx) : this.replaceOne(cx)));
    this.lineInput.on("submit", (_e, cx) => this.goToLine(cx));
  }

  openFind(mode, cx) {
    const f = this.file();
    if (!f) return;
    this.bar = { mode };
    if (mode === "line") { this.lineInput.set_value(""); this.lineInput.focus(); cx.notify(); return; }
    // A selection on one line becomes the query.
    if (this.hasTextSel()) {
      const [a, b] = this.ordered();
      if (a.line === b.line) this.findInput.set_value(textBetween(linesOf(f), a, b));
    }
    this.findFrom = null;
    (mode === "replace" && this.findInput.value() ? this.replaceInput : this.findInput).focus();
    cx.notify();
  }

  closeFind(cx) { this.bar = null; this.inBar = null; this.handle.focus(); cx.notify(); }

  findFlag(k, cx) { this.findOpts = { ...this.findOpts, [k]: !this.findOpts[k] }; this.findStep(0, cx); }

  /** The current file's matches, cached until the text, query or options change. */
  matches(f) {
    if (!this.bar || this.bar.mode === "line" || !f || f.Ctext === null) return { ms: [] };
    const q = this.findInput.value(), o = this.findOpts, key = `${q}\0${o.cased}${o.word}${o.regex}`;
    if (f._findC === f.C && f._findKey === key) return f._find;
    const c = compile(q, o), ms = c?.re ? findAll(linesOf(f).map(body), c.re) : [];
    const byLine = new Map();
    ms.forEach((m, i) => { if (!byLine.has(m.line)) byLine.set(m.line, []); byLine.get(m.line).push(i); });
    f._find = { ms, byLine, re: c?.re ?? null, error: c?.error ?? null }; f._findC = f.C; f._findKey = key;
    return f._find;
  }

  /** The match the text selection is exactly on, or -1. */
  onMatch(ms) {
    if (!this.hasTextSel()) return -1;
    const [a, b] = this.ordered();
    return ms.findIndex((m) => m.line === a.line && m.from === a.col && b.line === a.line && m.to === b.col);
  }

  /** Selects the next (1) or previous (-1) match, or for 0 the first one from where typing started. */
  findStep(dir, cx) {
    const f = this.file(), { ms } = this.matches(f);
    if (this.bar) this.bar.note = null;
    if (!f || !ms.length) { cx.notify(); return; }
    const p = this.hasTextSel() ? this.ordered()[0] : this.cur ?? { line: 0, col: 0 };
    const i = dir === 0 ? nextMatch(ms, this.findFrom ?? { line: 0, col: 0 }, true) : dir > 0 ? nextMatch(ms, p) : prevMatch(ms, p);
    const m = ms[i];
    this.anchor = { line: m.line, col: m.from }; this.cur = { line: m.line, col: m.to };
    this.showCursor(); cx.notify();
  }

  replaceOne(cx) {
    const f = this.file(), { ms, re } = this.matches(f);
    if (!this.editable(f) || !re) return;
    const i = this.onMatch(ms);
    if (i < 0) return this.findStep(1, cx);
    const m = ms[i], text = body(linesOf(f)[m.line]).slice(m.from, m.to);
    this.type(replacement(text, re, this.replaceInput.value(), this.findOpts.regex), cx, { from: { line: m.line, col: m.from }, to: { line: m.line, col: m.to } });
    this.findStep(1, cx);
  }

  /** Every match, last to first so earlier positions stay right, as one undo step. */
  replaceAll(cx) {
    const f = this.file(), { ms, re } = this.matches(f);
    if (!this.editable(f) || !re || !ms.length) return;
    const lines = linesOf(f), repl = this.replaceInput.value(), regex = this.findOpts.regex;
    const subs = ms.map((m) => replacement(body(lines[m.line]).slice(m.from, m.to), re, repl, regex));
    this.cur ??= { line: 0, col: 0 };
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      this.type(subs[i], cx, { from: { line: m.line, col: m.from }, to: { line: m.line, col: m.to }, group: true });
    }
    this.history[this.history.length - 1].at = 0; // later typing starts its own undo step
    if (this.bar) this.bar.note = `Replaced ${ms.length}`;
    cx.notify();
  }

  goToLine(cx) {
    const f = this.file(), p = parseLine(this.lineInput.value());
    if (!f || !p) return;
    this.cur = this.clampPos(f, p); this.anchor = null;
    this.closeFind(cx); this.showCursor(); cx.notify();
  }

  findBar(f, t) {
    const mode = this.bar.mode, chip = (id, label, on, flip) => div().id(id).h(22).px(6).flex().items_center().rounded(4).text_size(11).cursor_pointer()
      .bg(on ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85)).on_click((_e, cx) => flip(cx)).child(label);
    const box = (state, w) => div().w(w).flex_none().child(Input.new(state));
    if (mode === "line") return h_flex().px(8).py(4).gap(6).items_center().border_b(1).border_color(t.border).text_size(12)
      .child(div().text_color(t.muted).child("Go to line")).child(box(this.lineInput, 180))
      .child(div().text_size(11).text_color(t.dim).child(`1-${linesOf(f).length} · Enter · Esc`))
      .child(div().flex_1()).child(this.button("find-close", "×", t.raised, (cx) => this.closeFind(cx)));
    const { ms, error } = this.matches(f), i = this.onMatch(ms), q = this.findInput.value();
    const count = error ? "Bad pattern" : this.bar.note ?? (!q ? "" : !ms.length ? "No results" : i >= 0 ? `${i + 1} of ${ms.length}` : `${ms.length} result${ms.length === 1 ? "" : "s"}`);
    return v_flex().px(8).py(4).gap(4).border_b(1).border_color(t.border).text_size(12)
      .child(h_flex().gap(6).items_center()
        .child(box(this.findInput, 240))
        .child(chip("find-cased", "Aa", this.findOpts.cased, (cx) => this.findFlag("cased", cx)))
        .child(chip("find-word", "W", this.findOpts.word, (cx) => this.findFlag("word", cx)))
        .child(chip("find-regex", ".*", this.findOpts.regex, (cx) => this.findFlag("regex", cx)))
        .child(div().min_w(70).text_size(11).text_color(error || (q && !ms.length) ? t.ansi1 : t.muted).child(count))
        .child(this.button("find-prev", "↑", t.raised, (cx) => this.findStep(-1, cx)))
        .child(this.button("find-next", "↓", t.raised, (cx) => this.findStep(1, cx)))
        .child(div().flex_1())
        .child(this.button("find-mode", mode === "replace" ? "Hide replace" : `Replace  ${this.kl("replace")}`, t.raised, (cx) => { this.bar = { mode: mode === "replace" ? "find" : "replace" }; cx.notify(); }))
        .child(this.button("find-close", "×", t.raised, (cx) => this.closeFind(cx))))
      .when(mode === "replace", (e) => e.child(h_flex().gap(6).items_center()
        .child(box(this.replaceInput, 240))
        .child(this.button("replace-one", "Replace", t.raised, (cx) => this.replaceOne(cx)))
        .child(this.button("replace-all", `All  ${this.kl("replaceAll")}`, t.raised, (cx) => this.replaceAll(cx)))
        .when(this.findOpts.regex, (e) => e.child(div().text_size(11).text_color(t.dim).child("$1, $2… insert groups")))));
  }

  // ---- saving ---------------------------------------------------------------

  /** The writes that bring disk up to memory for `f`. */
  saveWrites(f) {
    if (!this.dirty(f)) return [];
    const w = [];
    if (f.Ctext !== f.diskC) w.push({ target: "current", before: f.diskC, after: f.Ctext });
    if (!f.plain && f.Btext !== f.diskB) w.push({ target: "baseline", before: f.diskB, after: f.Btext });
    return w;
  }

  save(cx, f = this.file()) {
    if (!f) return;
    if (f.conflict) { this.error = "The file changed on disk while you were editing: pick Keep mine or Take agent's first"; cx.notify(); return; }
    const writes = this.saveWrites(f);
    if (!writes.length) return;
    const notes = writes.map((w) => this.editNote(f, w)).filter(Boolean);
    this.replace(f, { ...f, diskC: f.Ctext, diskB: f.Btext });
    cx.notify();
    this.enqueue(async () => {
      let done = 0;
      try { for (const w of writes) { await f.store.apply(f, w); done++; } await this.sendEditNotes(notes); }
      catch (e) {
        // Memory still holds the edits: whatever didn't reach disk counts as unsaved again.
        const g = this.files.find((x) => x.key === f.key);
        if (g) for (const w of writes.slice(done)) g[w.target === "baseline" ? "diskB" : "diskC"] = w.before;
        throw e;
      }
    }, cx);
  }

  /** Q45: a passive note to the agent that changed a file, naming the lines a save changed. */
  editNote(f, w) {
    if (!f.by || !this.settings.editNote || w.target !== "current" || w.before === null || w.after === null) return null;
    const r = changedRanges(w.before, w.after);
    if (!r.length) return null;
    const at = r.slice(0, 6).map((h) => (!h.nc ? `lines removed at ${h.n + 1}` : h.nc === 1 ? `line ${h.n + 1}` : `lines ${h.n + 1}-${h.n + h.nc}`));
    if (r.length > 6) at.push(`${r.length - 6} more places`);
    return { key: f.key, terminal: f.by, path: f.as ?? agentPath(f.path, f.by), at: at.join(", ") };
  }

  /** Queues edit notes. A file's earlier note the agent hasn't read yet is replaced, not repeated. */
  async sendEditNotes(notes) {
    for (const n of notes) {
      const prev = this.editNotes.get(n.key), earlier = !!prev && await withdrawFeedback(prev.terminal, prev.text);
      const text = `Code review: the user edited ${n.path} (${n.at}${earlier ? ", plus earlier edits" : ""}). Read the file again before you change it.`;
      await queueFeedback(n.terminal, text);
      this.editNotes.set(n.key, { terminal: n.terminal, text });
    }
  }

  /** Conflict banner: overlapping lines take mine or the agent's; the rest of both is kept. */
  resolve(how, cx) {
    const f = this.file(), k = f?.conflict;
    if (!k) return;
    if (!k[how]) { this.cur = this.anchor = null; cx.spawn(async (cx) => this.reloadOne({ ...f, conflict: null }, cx)); return; }
    cx.spawn(async (cx) => {
      const next = await this.merged(k.nf, k[how].Ctext, k[how].Btext, cx);
      if (this.files.includes(f)) { this.adoptMerge(f, next); cx.notify(); }
    });
  }

  // ---- input ---------------------------------------------------------------

  /** Each scope's key -> action lookup, rebuilt when the user's shortcuts change. */
  setKeymap(overrides) {
    this.keymap = resolve(overrides);
    this.kIdx = { edit: index(this.keymap, "edit"), pane: index(this.keymap, "pane"), find: index(this.keymap, "find") };
  }

  /** The first key bound to an action, for buttons and menus ("" when it has none). */
  kl(id) { return keyLabel(this.keymap.get(id)?.[0]); }

  /** Runs one action by id (a key, a "mod:wingman" binding, or a command). */
  runAction(id, cx) {
    const f = this.file();
    const go = {
      accept: () => this.decide("accept", cx), reject: () => this.decide("reject", cx),
      acceptFile: () => this.wholeFile("accept", cx), rejectFile: () => this.wholeFile("reject", cx),
      nextChange: () => this.step(1, cx), prevChange: () => this.step(-1, cx),
      comment: () => this.askPrompt(this.current, cx), reason: () => this.askReason(cx),
      nextFile: () => this.stepFile(1, cx), prevFile: () => this.stepFile(-1, cx),
      quickOpen: () => this.openQuick(cx), toggleView: () => this.setMode(this.mode === "review" ? "edit" : "review", cx),
      toggleTree: () => this.toggleTree(cx), openInVSCode: () => this.toVSCode(cx),
      openInNvim: () => { if (f) this.toNvim(f, this.cur?.line ?? f.hunks[this.current]?.n ?? 0, cx); },
      save: () => this.save(cx), undo: () => this.undo(cx), redo: () => this.redoEdit(cx),
      selectAll: () => this.clip("all", cx), copy: () => this.clip("copy", cx), cut: () => this.clip("cut", cx), paste: () => this.clip("paste", cx),
      moveLineUp: () => this.lineOp("moveUp", cx), moveLineDown: () => this.lineOp("moveDown", cx),
      copyLineUp: () => this.lineOp("copyUp", cx), copyLineDown: () => this.lineOp("copyDown", cx),
      deleteLine: () => this.lineOp("delete", cx), joinLines: () => this.lineOp("join", cx), toggleComment: () => this.lineOp("comment", cx),
      find: () => this.openFind("find", cx), replace: () => this.openFind("replace", cx), goToLine: () => this.openFind("line", cx),
      findNext: () => this.findStep(1, cx), findPrev: () => this.findStep(-1, cx),
      findCase: () => this.findFlag("cased", cx), findWord: () => this.findFlag("word", cx), findRegex: () => this.findFlag("regex", cx),
      replaceAll: () => this.replaceAll(cx),
    }[id];
    go?.();
  }

  /** Select all, copy, cut, paste: on the text cursor's file only. */
  clip(how, cx) {
    const f = this.file();
    if (!this.cur || !this.editable(f)) return;
    const lines = linesOf(f), c = this.cur, sel = this.hasTextSel(), lineEnd = (l) => ({ line: l, col: body(lines[l]).length });
    if (how === "all") { this.anchor = { line: 0, col: 0 }; this.cur = lineEnd(lines.length - 1); cx.notify(); return; }
    if (how === "paste") { const t = cx.read_from_clipboard(); if (t) this.type(t, cx); return; }
    cx.write_to_clipboard(this.copyText(f));
    if (how !== "cut") return;
    // Cut without a selection takes the whole line.
    if (sel) this.type("", cx);
    else if (c.line + 1 < lines.length) this.type("", cx, { from: { line: c.line, col: 0 }, to: { line: c.line + 1, col: 0 } });
    else this.type("", cx, { from: c.line > 0 ? lineEnd(c.line - 1) : { line: 0, col: 0 }, to: lineEnd(c.line) });
  }

  key(e, cx) {
    const f = this.file(), k = e.keystroke, done = () => cx.stop_propagation();
    // Quick Open has the keyboard: its own keys, and its key again moves down the list.
    if (this.inBar === this.quickInput) {
      const qk = { escape: () => this.closeQuick(cx), up: () => this.moveQuick(-1, cx), down: () => this.moveQuick(1, cx), tab: () => this.completeQuick(cx) }[k]
        ?? (this.kIdx.pane.get(k) === "quickOpen" ? () => this.moveQuick(1, cx) : null);
      if (qk) { qk(); done(); }
      return;
    }
    // The find bar has the keyboard: Esc, the bar's own actions, and switching between find, replace and line.
    if (this.inBar) {
      if (k === "escape") { this.closeFind(cx); return done(); }
      const id = this.kIdx.find.get(k) ?? (["find", "replace", "goToLine"].includes(this.kIdx.pane.get(k)) ? this.kIdx.pane.get(k) : null);
      if (id) { this.runAction(id, cx); done(); }
      return;
    }
    if (this.cur && this.editable(f)) {
      const id = this.kIdx.edit.get(k);
      if (id) { this.runAction(id, cx); return done(); }
      if (this.editKey(e, f, cx)) return done();
    }
    const id = this.kIdx.pane.get(k);
    if (id) { this.runAction(id, cx); return done(); }
    const fixed = {
      "shift-down": () => this.extend(1, cx),
      "shift-up": () => this.extend(-1, cx),
      "escape": () => (this.selA == null && !this.anchor ? null : this.clearSelection(cx)),
    }[k];
    if (fixed) { fixed(); done(); }
  }

  // ---- popup form (O1 reason, O2 prompt) ----------------------------------

  initForm(cx) {
    this.form = props();
    if (this.form.form === "menu") return; // the right-click menu has no input
    if (this.form.form === "keys") {
      this.formHandle = cx.focus_handle(); this.formHandle.focus();
      this.keySearch = InputState.new({ placeholder: "Search shortcuts by action or key" });
      this.keySearch.on("change", (_e, cx) => cx.notify());
      cx.spawn(async (cx) => {
        this.overrides = await loadKeys(); this.km = resolve(this.overrides);
        this.herdr = herdrGlobal((await readTextFile(`${appHome()}/keys.json`)) ?? "{}"); cx.notify();
      });
      return;
    }
    if (this.form.form === "settings") {
      this.formHandle = cx.focus_handle(); this.formHandle.focus();
      cx.spawn(async (cx) => { this.st = await loadSettings(); cx.notify(); });
      return;
    }
    this.text = "";
    // A text area: Enter adds a line, Ctrl+Enter sends (also caught on the form, in case the
    // text area doesn't report it as a submit).
    this.input = TextareaState.new({ placeholder: this.form.form === "reason" ? "Why it was rejected" : "What should the agent do here?", rows: 3 });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (e, cx) => { if (e?.secondary) this.submitForm(cx); });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.formHandle = cx.focus_handle();
  }

  submitForm(cx) {
    const { form, terminal, file, where, overlay } = this.form, text = this.text.trim();
    if (!text) { closeOverlay(overlay); return; }
    if (this.sending) return;
    this.sending = true;
    // Write first, close after: closing ends this copy, and its unfinished work with it.
    // A reason is context for the agent's next step; a prompt is a message from the user.
    cx.spawn(async () => {
      try {
        if (form === "reason") await queueFeedback(terminal, `Code review: the user's comment on rejecting ${where} in ${file}: ${text}`);
        else if (this.form.quote) await queuePrompt(terminal, `${text}\n\nRe: ${file}, ${where}:\n\`\`\`\n${this.form.quote}\n\`\`\``);
        else await queuePrompt(terminal, `${text} (re: ${file}, ${where})`);
      } catch (e) { log(`${form} for ${terminal} failed: ${e.message ?? e}`); }
      closeOverlay(overlay);
    });
  }

  renderForm() {
    const t = theme(), { form, terminal, file, where, overlay } = this.form;
    const title = form === "reason" ? "Comment last rejection" : "Comment";
    const hint = form === "reason"
      ? `Sent to ${terminal} with the next tool call or prompt.`
      : `Typed into ${terminal} as your message once it's idle.`;
    return v_flex().id("review-form").track_focus(this.formHandle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(overlay); cx.stop_propagation(); }
        else if (e.keystroke === "ctrl-enter" || e.keystroke === "cmd-enter") { this.submitForm(cx); cx.stop_propagation(); }
      })
      // Fixed parts keep their size; the text area takes what is left and scrolls inside,
      // so the footer and its button always stay in the popup.
      .size_full().min_h(0).p(18).gap(8).bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().items_center().child(div().flex_1().text_size(15).font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).truncate().child(`${file}, ${where}`))
      // Every quoted line (up to the 40 sent), scrolling inside a fixed-height box.
      .when(!!this.form.quote, (e) => e.child(v_flex().id("form-quote").h(130).flex_none().overflow_y_scrollbar().px(8).py(4).rounded(6).bg(t.background)
        .font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted)
        // Long lines wrap inside the box rather than being cut off.
        .children(this.form.quote.split("\n").map((l, i) => div().id(`q${i}`).flex_none().w_full().min_w(0).whitespace_normal()
          .text_color(l.startsWith("+") ? t.ansi2 : l.startsWith("-") ? t.ansi1 : t.muted).child(l || " ")))))
      .child(div().flex_1().min_h(0).child(Textarea.new(this.input).size_full().px(10).py(6).rounded(9).border_1().border_color(t.accent).bg(t.background).text_size(12.8).text_color(t.foreground)))
      .child(h_flex().flex_none().items_center().gap(8)
        .child(div().flex_1().text_size(11).text_color(t.dim).child(hint))
        .child(div().id("form-send").flex_none().whitespace_nowrap().h(30).px(14).flex().items_center().rounded(8).bg(t.solid).text_color(t.solid_foreground).text_size(12.5).cursor_pointer()
          .on_click((_e, cx) => this.submitForm(cx)).child("Send  Ctrl+⏎")));
  }

  // ---- selection bar and right-click menu ----------------------------------

  /** Floats over the diff while lines are selected, saying what can be done with them. */
  selectionBar(f, sel, t) {
    const n = this.rowsOf(f).slice(sel[0], sel[1] + 1).filter((r) => r.kind !== "@").length;
    return h_flex().absolute().bottom(12).left(0).right(0).justify_center()
      .child(h_flex().gap(8).px(10).py(5).items_center().rounded(8).bg(t.popover).border_1().border_color(t.accent).shadow_md().text_size(11.5)
        .child(div().text_color(t.muted).child(`${n} line${n === 1 ? "" : "s"} selected`))
        .when(this.picks(f, sel).any, (e) => e
          .child(this.button("sel-reject", `Reject  ${this.kl("reject")}`, t.ansi1 + "55", (cx) => this.selectionAction("reject", cx)))
          .child(this.button("sel-accept", `Accept  ${this.kl("accept")}`, t.ansi2 + "55", (cx) => this.selectionAction("accept", cx))))
        .child(this.button("sel-prompt", `Comment  ${this.kl("comment")}`, t.ansi4 + "55", (cx) => this.askPrompt(this.current, cx)))
        .child(this.button("sel-clear", "Clear  Esc", t.raised, (cx) => this.clearSelection(cx))));
  }

  /**
   * Right-click opens a menu for the line under the pointer. It never changes the selection:
   * selecting is left-click only. A line in a hunk, or its button row, makes that hunk current.
   */
  openMenu(ev, cx) {
    const f = this.file(), i = this.rowAt(ev.local_position?.y ?? -1);
    if (!f || i < 0) return;
    this.handle.focus();
    const r = this.rowsOf(f)[i], inHunk = r.hunk != null, sel = this.selection(f), hasSel = !!sel;
    if (inHunk) this.current = r.hunk;
    // With changed lines selected, Accept/Reject act on those lines only; otherwise on the hunk.
    // The labels stay short; the selection bar shows when they act on selected lines.
    const selChanges = hasSel && this.picks(f, sel).any;
    const items = [
      { cmd: "prompt", label: "Comment", key: this.kl("comment") },
      ...(inHunk || selChanges ? [
        { cmd: "reject", label: "Reject", key: this.kl("reject") },
        { cmd: "rejectReason", label: "Reject with comment…", key: "" },
        { cmd: "accept", label: "Accept", key: this.kl("accept") },
      ] : []),
      ...(this.lastReject ? [{ cmd: "reason", label: "Comment last rejection", key: this.kl("reason") }] : []),
      ...(hasSel ? [{ cmd: "clear", label: "Clear selection", key: "Esc" }] : []),
    ];
    openOverlay({ mod: "wingman", props: { form: "menu", items }, kind: "popup", at: "pointer", width: 260, height: items.length * 30 + 12 });
    cx.notify();
  }

  // ---- settings popup (Q47) ---------------------------------------------------

  /** Saves one setting; the pane copy rereads them through wingman.settings. */
  setSetting(patch, cx) {
    this.st = { ...this.st, ...patch };
    const next = this.st;
    cx.notify();
    cx.spawn(async () => {
      try { await saveSettings(next); run("wingman.settings"); } catch (e) { log(`settings: ${e.message ?? e}`); }
    });
  }

  // ---- keyboard shortcuts dialog (form "keys") ------------------------------------

  /** Saves the shortcut overrides, updates Herdr's mod:wingman section, and tells the pane. */
  setKeys(next, cx) {
    this.overrides = next; this.km = resolve(next); this.rec = null; this.pending = null;
    cx.notify();
    const km = this.km;
    cx.spawn(async () => {
      try { await saveKeys(next); await syncHerdrKeys(km); run("wingman.settings"); } catch (e) { log(`keys: ${e.message ?? e}`); }
    });
  }

  /** A key pressed while recording: refused, a conflict to confirm, or bound. */
  recordKey(e, cx) {
    const k = keystrokeOf(e);
    if (!k) return;
    cx.stop_propagation();
    if (k === "escape") { this.rec = null; this.keyMsg = null; cx.notify(); return; }
    const why = refused(k);
    if (why) { this.keyMsg = `${keyLabel(k)} can't be bound: it's ${why}.`; cx.notify(); return; }
    const others = holders(this.km, k, this.rec);
    if (others.length) { this.pending = { id: this.rec, key: k, others }; this.rec = null; this.keyMsg = null; cx.notify(); return; }
    this.keyMsg = null;
    this.setKeys(bind(this.overrides, this.km, this.rec, k), cx);
  }

  renderKeys() {
    const t = theme(), { overlay } = this.form, km = this.km, q = (this.keySearch?.value() ?? "").trim().toLowerCase();
    const chip = (id, k) => h_flex().id(`key-${id}-${k}`).h(22).px(6).gap(4).items_center().rounded(4).bg(t.raised).text_size(11)
      .child(div().child(keyLabel(k)))
      .when(!!this.herdr?.[k], (e) => e.child(div().text_size(10).text_color(t.ansi3).child(`hides Herdr ${this.herdr[k]}`)))
      .child(div().id(`unkey-${id}-${k}`).px(2).rounded(2).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.setKeys(unbind(this.overrides, this.km, id, k), cx)).child("×"));
    const rows = [];
    let group = null;
    for (const a of ACTIONS) {
      const keys = km?.get(a.id) ?? [];
      if (q && !a.label.toLowerCase().includes(q) && !keys.some((k) => k.includes(q))) continue;
      if (a.group !== group) { group = a.group; rows.push(div().id(`group-${group}`).pt(10).pb(2).text_size(11).font_semibold().text_color(t.muted).child(group)); }
      const changed = !!this.overrides?.[a.id], recording = this.rec === a.id;
      rows.push(h_flex().id(`act-${a.id}`).min_h(30).py(2).gap(8).items_center().rounded(4).hover((s) => s.bg(t.hover)).px(6)
        .child(div().flex_1().min_w(0).text_size(12).child(a.label))
        .child(h_flex().flex_none().gap(4).items_center().flex_wrap()
          .children(keys.map((k) => chip(a.id, k)))
          .when(recording, (e) => e.child(div().h(22).px(8).flex().items_center().rounded(4).bg(t.accent + "55").text_size(11).child("Press a key… (Esc cancels)")))
          .when(!recording, (e) => e.child(div().id(`add-${a.id}`).h(22).px(6).flex().items_center().rounded(4).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => { this.rec = a.id; this.pending = null; this.keyMsg = null; this.formHandle.focus(); cx.notify(); }).child("+ key")))
          .when(changed, (e) => e.child(div().id(`reset-${a.id}`).h(22).px(6).flex().items_center().rounded(4).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => this.setKeys(resetKey(this.overrides, a.id), cx)).child("Reset")))));
    }
    const p = this.pending;
    return v_flex().id("wingman-keys").track_focus(this.formHandle)
      .on_key_down((e, cx) => {
        if (this.rec) return this.recordKey(e, cx);
        if (e.key === "escape") { if (this.pending) { this.pending = null; cx.notify(); } else closeOverlay(overlay); cx.stop_propagation(); }
      })
      .size_full().p(16).gap(8).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child("Keyboard shortcuts"))
        .child(this.button("keys-reset-all", "Reset all", t.raised, (cx) => this.setKeys({}, cx)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(11).text_color(t.dim).child("Click + key and press the shortcut. Keys Herdr uses globally are sent to Wingman while it has focus. Arrows, Home/End, Page Up/Down, Backspace, Delete, Enter, Tab and plain typing stay fixed."))
      .when(!!this.keySearch, (e) => e.child(Input.new(this.keySearch)))
      .when(!!this.keyMsg, (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.keyMsg)))
      .when(!!p, (e) => e.child(h_flex().gap(8).items_center().p(8).rounded(6).bg(t.ansi3 + "22").text_size(12)
        .child(div().flex_1().child(`${keyLabel(p.key)} is bound to ${p.others.map((o) => BY_ID.get(o).label).join(", ")}. Move it to ${BY_ID.get(p.id).label}?`))
        .child(this.button("keys-move", "Move it", t.accent + "55", (cx) => this.setKeys(bind(this.overrides, this.km, p.id, p.key), cx)))
        .child(this.button("keys-cancel", "Cancel", t.raised, (cx) => { this.pending = null; cx.notify(); }))))
      .child(v_flex().id("keys-list").flex_1().min_h(0).overflow_y_scrollbar().children(km ? rows : [div().id("keys-loading").text_size(12).text_color(t.dim).child("Loading…")]));
  }

  renderSettings() {
    const t = theme(), st = this.st, { overlay } = this.form;
    const toggle = (id, label, hint, on, flip) => h_flex().id(id).gap(10).py(6).items_center().cursor_pointer()
      .on_click((_e, cx) => flip(cx))
      .child(div().w(34).h(18).flex_none().rounded(9).p(2).bg(on ? t.accent : t.raised)
        .child(div().size(14).rounded(7).bg(t.foreground).when(on, (e) => e.ml(16))))
      .child(v_flex().child(div().text_size(13).child(label)).child(div().text_size(11).text_color(t.dim).child(hint)));
    return v_flex().id("wingman-settings").track_focus(this.formHandle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(overlay); cx.stop_propagation(); } })
      .size_full().p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().gap(8).child(div().flex_1().text_size(15).font_semibold().child("Settings"))
        .child(this.button("open-keys", "Keyboard shortcuts…", t.raised, () => { closeOverlay(overlay); openOverlay({ mod: "wingman", props: { form: "keys" }, kind: "dialog", width: 700, height: 620 }); }))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(!st, (e) => e.child(div().text_size(12).text_color(t.dim).child("Loading…")))
      .when(!!st, (e) => e
        .child(toggle("set-note", "Auto note on rejections", "Tell the agent which of its changes you rejected.", st.autoNote, (cx) => this.setSetting({ autoNote: !st.autoNote }, cx)))
        .child(toggle("set-editnote", "Note on my edits", "Tell the agent which lines of its files you changed.", st.editNote, (cx) => this.setSetting({ editNote: !st.editNote }, cx)))
        .child(toggle("set-pairs", "Auto-close brackets and quotes", "Typing ( [ { \" ' ` adds the closer; Backspace in an empty pair removes both.", st.autoPairs ?? true, (cx) => this.setSetting({ autoPairs: !(st.autoPairs ?? true) }, cx)))
        .child(toggle("set-autosave", "Autosave", "Save on focus loss and file switch. Where you and the agent change the same lines, the agent's win.", st.autosave, (cx) => this.setSetting({ autosave: !st.autosave }, cx)))
        .child(v_flex().gap(6).when(!st.autosave, (e) => e.opacity(0.4))
          .child(div().text_size(12).text_color(t.muted).child("Also save after typing stops for"))
          .child(h_flex().gap(4).children([0, 1, 2, 3, 5, 10].map((n) => div().id(`delay-${n}`).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
            .bg(st.autosaveDelay === n ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => { if (st.autosave) this.setSetting({ autosaveDelay: n }, cx); })
            .child(n ? `${n}s` : "Focus change")))))
        .child(v_flex().gap(6).pt(4)
          .child(div().text_size(12).text_color(t.muted).child("Editor"))
          .child(h_flex().gap(4).children([["wingman", "Wingman"], ["nvim", "Neovim"]].map(([v, label]) => div().id(`editor-${v}`).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
            .bg((st.editor ?? "wingman") === v ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => this.setSetting({ editor: v }, cx)).child(label))))
          .child(div().text_size(11).text_color(t.dim).child("Neovim: clicking a line, Open in Neovim, or a file in the tree opens it in a Neovim pane beside Wingman."))));
  }

  renderMenu() {
    const t = theme(), { items, overlay } = this.form;
    return v_flex().id("review-menu").size_full().p(6).gap(2).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .children(items.map((it) => h_flex().id(`m-${it.cmd}`).h(28).flex_none().px(10).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        // The menu is its own copy of the mod; the pane does the work, reached as wingman.<cmd>.
        .on_click(() => { closeOverlay(overlay); run(`wingman.${it.cmd}`); })
        .child(div().flex_1().child(it.label)).child(div().text_size(11).text_color(t.dim).child(it.key))));
  }

  // ---- view ----------------------------------------------------------------

  button(id, label, bg, onClick) {
    return div().id(id).h(22).px(10).flex().items_center().rounded(5).cursor_pointer().bg(bg).text_size(11)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { this.handle?.focus(); onClick(cx); }).child(label);
  }

  row(r, f, t, selected = false) {
    if (r.kind === "@") {
      // Row renderers can't hold handlers; the input layer maps clicks here to a button by x (rowButton).
      const current = r.hunk === this.current;
      return h_flex().w_full().h(ROW).flex_none().gap(BTN_GAP).items_center().bg(current ? t.selected : t.raised)
        .child(div().w(GUTTER).flex_none())
        .child(div().w(BTN_W).flex_none().h(16).rounded(4).flex().items_center().justify_center().bg(t.ansi1 + (current ? "99" : "55")).text_size(11).child(`Reject  ${this.kl("reject")}`))
        .child(div().w(BTN_W).flex_none().h(16).rounded(4).flex().items_center().justify_center().bg(t.ansi2 + (current ? "99" : "55")).text_size(11).child(`Accept  ${this.kl("accept")}`))
        .child(div().w(BTN_W).flex_none().h(16).rounded(4).flex().items_center().justify_center().bg(t.ansi4 + (current ? "77" : "40")).text_size(11).child(`Comment  ${this.kl("comment")}`))
        .child(div().flex_1().pl(8).text_color(t.dim).text_size(11).child(`change ${r.hunk + 1} of ${f.hunks.length}`));
    }
    const spans = expandTabs((r.side === "old" ? f.oldTok : f.newTok)?.[r.line] ?? []);
    const cw = this.cw(), hx = this.hx, x = (col) => visualCol(text, col) * cw - hx;
    const text = r.side === "new" ? body(linesOf(f)[r.line]) : "";
    // Text selection on this line: [from, to) in characters; a line selected through its end
    // shows one more cell for the line break.
    let mark = null;
    if (r.side === "new" && this.hasTextSel()) {
      const [a, b] = this.ordered();
      if (r.line >= a.line && r.line <= b.line) {
        const from = r.line === a.line ? a.col : 0, to = r.line === b.line ? b.col : text.length;
        mark = { left: x(from), w: Math.max(0, x(to) - x(from)) + (r.line < b.line ? cw : 0) };
      }
    }
    const caret = r.side === "new" && this.cur?.line === r.line;
    const found = r.side === "new" && this.bar ? this.matches(f) : null, hits = found?.byLine?.get(r.line) ?? [];
    const onHit = hits.length ? this.onMatch(found.ms) : -1;
    return h_flex().w_full().h(ROW).flex_none().whitespace_nowrap()
      .when(r.kind === "+", (e) => e.bg(t.ansi2 + "22")).when(r.kind === "-", (e) => e.bg(t.ansi1 + "22"))
      .when(selected, (e) => e.bg(t.selection).border_l(2).border_color(t.accent))
      .child(div().w(44).flex_none().pr(8).text_right().text_color(caret ? t.foreground : t.dim).child(String(r.num)))
      .child(div().w(14).flex_none().text_color(r.kind === "+" ? t.ansi2 : r.kind === "-" ? t.ansi1 : t.dim).child(r.kind === " " ? "" : r.kind))
      .child(div().flex_1().h_full().relative().overflow_hidden()
        .children(hits.map((k) => { const m = found.ms[k]; return div().absolute().top(1).h(ROW - 2).rounded(2).left(x(m.from)).w(Math.max(2, x(m.to) - x(m.from)))
          .bg(k === onHit ? t.ansi3 + "88" : t.ansi3 + "38"); }))
        .when(!!mark, (e) => e.child(div().absolute().top(0).h(ROW).left(mark.left).w(mark.w).bg(t.selection)))
        .child(h_flex().absolute().top(0).h(ROW).left(-hx).children(spans.map((s) => div().text_color(color(s.type, t)).child(s.text))))
        .when(caret, (e) => e.child(div().absolute().top(3).h(ROW - 6).w(2).left(x(this.cur.col)).bg(this.handle.is_focused() ? t.accent : t.dim))));
  }

  render() {
    if (this.form?.form === "menu") return this.renderMenu();
    if (this.form?.form === "settings") return this.renderSettings();
    if (this.form?.form === "keys") return this.renderKeys();
    if (this.form) return this.renderForm();
    const t = theme(), f = this.file(), vis = this.visible(), total = vis.reduce((n, x) => n + x.hunks.length, 0);
    const tag = (x) => x.created ? "new" : x.Ctext === null ? "deleted" : `${x.hunks.length}`;
    const rows = f ? this.rowsOf(f) : [], sel = f ? this.selection(f) : null, lsel = f ? this.lineSel(f) : null;
    const picked = this.files.find((x) => x.key === this.sel); // an error tab shows its error
    return v_flex().id("review").relative().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(40).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Wingman"))
        .child(h_flex().flex_none().gap(2).p(2).rounded(6).bg(t.raised).children(["review", "edit"].map((m) =>
          div().id(`mode-${m}`).h(22).px(8).flex().items_center().rounded(4).text_size(12).cursor_pointer()
            .when(this.mode === m, (e) => e.bg(t.selected)).on_click((_e, cx) => this.setMode(m, cx))
            .child(m === "review" ? "Review" : "Edit"))))
        .child(div().text_size(11).text_color(t.muted).truncate().child(`${this.stores.map((st) => base(st.root)).join(", ")} · ${total} change${total === 1 ? "" : "s"} in ${vis.length} file${vis.length === 1 ? "" : "s"} · ${this.history.length} undoable${this.writing ? " · saving…" : ""}${agents().some((a) => a.space === this.spaceId && ACTIVE.has(a.status)) ? " · agent working" : ""}`))
        .child(div().flex_1())
        .when(!!this.lastReject, (e) => e.child(this.button("reason", `Comment last rejection  ${this.kl("reason")}`, t.raised, (cx) => this.askReason(cx))))
        .child(this.button("settings", "⚙ Settings", t.raised, () => this.openSettings()))
        .when(total > 0, (e) => e
          .child(this.button("reject-all", "Reject all files", t.ansi1 + "55", (cx) => this.everything("reject", cx)))
          .child(this.button("accept-all", "Accept all files", t.ansi2 + "55", (cx) => this.everything("accept", cx)))))
      .child(h_flex().flex_1().min_h(0)
      .when(this.treeOnly(), (e) => e.child(this.renderTree(t, true)))
      .when(this.mode === "edit" && this.treeOn && !this.treeOnly(), (e) => e.child(this.renderTree(t)))
      .when(!this.treeOnly(), (e) => e.child(v_flex().flex_1().min_w(0).h_full()
      // File tabs scroll sideways in their own area; the hint and file buttons stay pinned right.
      .child(h_flex().h(36).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
        .child(div().id("file-tabs").flex_1().min_w(0).h_full().relative().overflow_hidden()
          .on_size_change((size, cx) => { this.tabViewW = size.width; this.setTabOffset(this.tabOffset ?? 0); if (this.sel) this.showTab(this.sel); cx.notify(); })
          .on_scroll_wheel((ev, cx) => this.tabWheel(ev, cx))
          .child(h_flex().absolute().top(0).bottom(0).left(-(this.tabOffset ?? 0)).children(vis.map((x) => this.tab(x, t))))
          // Position indicator, only when the tabs don't all fit.
          .when(this.tabMax() > 0, (e) => {
            const total = this.tabMax() + (this.tabViewW ?? 0), view = this.tabViewW ?? 0;
            return e.child(div().absolute().bottom(1).h(2).rounded(1).bg(t.dim)
              .left(((this.tabOffset ?? 0) / total) * view).w(Math.max(24, (view / total) * view)));
          }))
        .when(vis.length > 1, (e) => e.child(div().flex_none().whitespace_nowrap().text_size(10).text_color(t.dim).px(6).child(`${vis.findIndex((x) => x.key === this.sel) + 1}/${vis.length} · ${this.kl("prevFile")}/${this.kl("nextFile")}`)))
        .when(!!f, (e) => e.child(this.button("vscode", `VS Code  ${this.kl("openInVSCode")}`, t.raised, (cx) => this.toVSCode(cx)).flex_none().whitespace_nowrap()))
        .when(!!f && this.nvim(), (e) => e.child(this.button("nvim", `Neovim  ${this.kl("openInNvim")}`, t.raised, (cx) => this.toNvim(f, f.hunks[this.current]?.n ?? 0, cx)).flex_none().whitespace_nowrap()))
        .when(this.dirty(f), (e) => e.child(this.button("save", `Save  ${this.kl("save")}`, t.accent + "55", (cx) => this.save(cx)).flex_none().whitespace_nowrap()))
        .when(!!f?.hunks.length, (e) => e
          .child(this.button("reject-file", `Reject file  ${this.kl("rejectFile")}`, t.ansi1 + "40", (cx) => this.wholeFile("reject", cx)).flex_none().whitespace_nowrap())
          .child(this.button("accept-file", `Accept file  ${this.kl("acceptFile")}`, t.ansi2 + "40", (cx) => this.wholeFile("accept", cx)).flex_none().whitespace_nowrap())))
      .when(!!f && !!this.bar, (e) => e.child(this.findBar(f, t)))
      .when(!!f?.conflict, (e) => e.child(h_flex().px(12).py(6).gap(8).items_center().bg(t.ansi3 + "22").text_size(12)
        .child(div().flex_1().child(f?.conflict?.theirs ? "The agent changed the same lines you're editing." : "The file was deleted while you were editing it."))
        .child(this.button("ours", "Keep mine", t.raised, (cx) => this.resolve("ours", cx)))
        .child(this.button("theirs", f?.conflict?.theirs ? "Take agent's" : "Drop my edits", t.ansi1 + "55", (cx) => this.resolve("theirs", cx)))))
      .when(!!(this.error || this.status || !f), (e) => e.child(h_flex().px(12).py(6).gap(10).items_center().text_size(12)
        .child(div().flex_1().min_w(0).text_color(this.error || picked?.error ? t.ansi1 : t.muted).child(this.error ?? this.status ?? (picked?.error ? `${picked.rel}: ${picked.error}` : this.mode === "edit" ? `No file open: pick one in the file tree (${this.kl("toggleTree")}) or Quick Open (${this.kl("quickOpen")})` : "No changes to review")))
        .when(!this.stores.length && !!this.spaceId, (e) => e.child(this.button("open-folder", "Open folder…", t.raised, (cx) => this.openFolder(cx)).flex_none()))))
      .when(!!f, (e) => e.child(div().id("review-diff").flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
        .on_size_change((size, cx) => { this.viewH = size.height; this.viewW = size.width; cx.notify(); })
        // One character's width in the diff font, for cursor columns (the font is monospace).
        .child(div().absolute().top(0).left(0).opacity(0).whitespace_nowrap().child("0".repeat(100))
          .on_size_change((size, cx) => { const w = size.width / 100; if (w > 0 && Math.abs(w - (this.charW ?? 0)) > 0.001) { this.charW = w; cx.notify(); } }))
        .child(v_virtual_list("review-rows", rows.length, ROW, (i) => rows[i].kind === "@" ? `h${rows[i].hunk}` : `r${i}`,
          (range) => {
            // The list calls this twice a frame: once with [0, 1) to measure a row, then with
            // the visible range. Only the second says which row is on top.
            if (!(range.start === 0 && range.end === 1 && rows.length > 1)) this.drawnTop = range.start;
            return rows.slice(range.start, range.end).map((r, k) => this.row(r, f, t, lsel && range.start + k >= lsel[0] && range.start + k <= lsel[1])); })
          .w_full().h(this.viewRows() * ROW)
          .track_scroll(this.scroll))
        // Input layer over the rows (under the scrollbar and the selection bar): every click,
        // drag, right-click and wheel turn on the diff lands here and is mapped to a row.
        .child(div().id("review-input").absolute().top(0).left(0).bottom(0).right(14).cursor_text()
          .on_mouse_down("left", (ev, cx) => this.pointerDown(ev, cx))
          .on_mouse_move((ev, cx) => this.pointerMove(ev, cx))
          .on_mouse_up("left", (_e, cx) => this.pointerUp(cx))
          .on_hover((hovered, cx) => { if (!hovered) this.pointerUp(cx, false); })
          .on_mouse_down("right", (ev, cx) => this.openMenu(ev, cx))
          .on_scroll_wheel((ev, cx) => this.wheel(ev, cx)))
        .child(Scrollbar.vertical("review-rows").viewport_from_layout().absolute().inset_0())
        .when(!!sel, (e) => e.child(this.selectionBar(f, sel, t))))))))
      // Quick Open floats over everything, so it's the root's last child.
      .when(!!this.qo, (e) => e.child(this.quickOpen(t)));
  }
}
