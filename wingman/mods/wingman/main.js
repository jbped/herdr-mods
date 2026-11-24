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
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle, ScrollHandle, TextareaState, Textarea, InputState, Input } from "gpui-base";
import { theme, settings, props, readTextFile, writeTextFile, panes, spaces, machines, agents, terminals, appHome, exec, pickFolder, openOverlay, closeOverlay, nextCommand, run, layout, shared, setShared, hc } from "herdr";
import * as fs from "fs/promises";
import { MAX_BATCH, MAX_TEXT as MAX_COMMENT, makeComment, checkText, addComment, editComment, deleteComment, clearComments, undoClear, relocateFile, spansOn, snippetOf, loadComments, updateComments } from "./comments.js";
import { buildPrompt, chooseTarget, isWslArgv, promptProblem, sendToAgent } from "./commentprompt.js";
import { rows as buildRows, acceptAt, rejectAt, acceptAll, rejectAll, partialAt } from "./model.js";
import { Store, PlainRoot, norm, shows, swap, MAX_TEXT } from "./store.js";
import { highlight, highlightLines, languageOf, color } from "./highlight.js";
import { formatText, newFormatCache } from "./formatrun.js";
import { applyFormat } from "./format.js";
import { edit, body, cmp, linesOf, wordMove, wordAt, textBetween, indentUnit, visualCol, charAt, expandTabs } from "./edit.js";
import { hostPath } from "./capture.js";
import { captureNotices } from "./captureplan.js";
import { merge3, diffHunks, changedRanges, mapLine } from "./merge.js";
import { createTree, setFolder, toggle, reveal, loaded, rows as treeRows, folderIndex, STATUS_TREE, parseStatus as parseTreeStatus, ignoredMatcher, PER_FOLDER, relistAfter, navMove } from "./filetree.js";
import { ownerOf, nestedIn, holdsRoot, linkRows, caselessRoot, relUnder } from "./roots.js";
import { viewShown, copyView } from "./panelview.js";
import { listDir, join as pjoin, fingerprints, createFile, createDir, movePath, deleteFile, deleteTree, revealPath, chunkArgs, execOn } from "./fsx.js";
import { checkRel, newTarget, renameTarget, parentOf, nameOf, under, windowsRoot, remap, within, copyPaths, countUnder, deleteQuestion, stemEnd } from "./fileops.js";
import { sha256Hex } from "./sha256.js";
import { openInNvim, openInEditor, EDITORS, editorName } from "./nvim.js";
import { PAIRS, typed, inEmptyPair, betweenBrackets } from "./pairs.js";
import { tagKind, closingTag, completeClose, betweenTags } from "./tags.js";
import { segments, segmentOf } from "./wrap.js";
import { git, onWindows, toWsl } from "./git.js";
import { cleanInstruction, target as inlineTarget, targetProblem, relocate, buildPrompt as inlinePrompt, cleanAnswer, replaceLines, expand as expandCommand, usesFile, failure as runFailure, whereLabel, words as commandWords, DEFAULT_COMMAND as INLINE_COMMAND, TIMEOUT_MS as INLINE_MS, MAX_PROMPT as INLINE_MAX_PROMPT } from "./inlineedit.js";
import { plan as runPlan } from "./toolpath.js";
import { toolWhere } from "./toolrun.js";
import { unitOf, toElem, charWidth, colAtX, wrapColumns } from "./zoom.js";
import { kindOf, nameOf as cmdName, rank as cmdRank, winner as cmdWinner, prune as cmdPrune, SETTLE_MS, ownerView, ownedAction, handoff, HANDOFF_MS } from "./cmdroute.js";
import { READ, STATUS, STATUS_V2, MAX_FILES, parseStatus, parseStatusV2, onDisk, statusLetter, reviewTag, discardCommands, inHeadArgs, inHeadOf, commitCommands, pathspecText, NUMSTAT, NUMSTAT_NO_HEAD, parseNumstat, countLines, headDiffArgs, fitHunks } from "./changes.js";
import { compile, findAll, nextMatch, prevMatch, replacement, parseLine } from "./find.js";
import { rank, parseQuery } from "./quickopen.js";
import { ACTIONS, BY_ID, resolve, index, holders, bind, unbind, reset as resetKey, refused, keystrokeOf, keyLabel, withModSection, herdrGlobal, allowedIn } from "./keymap.js";
import { lineSpan, moveLines, copyLines, deleteLines, joinLines, toggleComment, commentFor } from "./lineops.js";
import { splitLines, parseHunks } from "./model.js";
import { spaceRoots, addFolder, removeFolder, repoInfo, addWorktree, removeWorktree, scanRepos, sharedBranch, worktreeDest, isHome } from "./workspace.js";
import { REMOTE, NVIM_NOTE, EDITOR_NOTE, NOTES_NOTE, REASON_NOTE, remotePath, rootId, idOf, mapLimit, addSleeper } from "./remote.js";
import { grepArgs, searchRepo, replacePlan } from "./search.js";
import { MAX_RESULTS, fmt, many, resultRows, occurrences, summaryOf, matchPieces, replaceState } from "./searchview.js";
import { matchBracket, tokenSkip } from "./brackets.js";
import { spans as spansOf, packSpans } from "./spans.js";
import { sync as syncPanels } from "./panels.js";
import { addSpaceRepos, queueFeedback, withdrawFeedback, queuePrompt, postEdit, loadSettings, saveSettings, loadKeys, saveKeys, hookKnown, forgetHook } from "./journal.js";
import { hookStatus, hookSummary, installHook, uninstallHook } from "./hooksetup.js";
import { capSteps } from "./undocap.js";
import { FILE_H, REPO_H, listRows, rowSizes, clickTarget, shownCommitted, neighbours, toUnload, sizeError, binaryError, CHANGES_CHARS } from "./changelist.js";
import { toLighten, HEAVY_VIEWS } from "./retain.js";
import { CaptureLoop, ACTIVE, CAPTURE_ERRORS, CONTROLLER, spaceOfAgent } from "./captureloop.js";
import { crumb, openCrumbs, ALIVE_MS } from "./crumbs.js";
import { stateFor, failIn, loadFailed, loadOk } from "./spacestate.js";
import { fitBar, fitHeader, fitFindRow, findRowItems, replaceRowItems, hunkButtons, withKey, LAST_DROP, settingsTabs, settingsHeight } from "./barfit.js";
import { AgentFiles } from "./agentview.js"; // session log source: Agent files list, Review backfill note
import { Problems, PROBLEMS_REQ } from "./problemsview.js"; // the Problems tab, gutter marks and checker runs
import { parse as parseCheckpoints, turnRows, agentsSince, timeLabel, confirmText, restoreNote, planSig, planRestore, applyRestore } from "./checkpoints.js";
import { isClaude } from "./sessionlog.js";
import { GitActions, GIT_COMMANDS } from "./gitview.js"; // G6 in Changes: sync, branches, Discard change, Generate message
import { noteAfterUndo, fileDiscardWrite } from "./hunkdiscard.js";
import { layoutOf, WANT } from "./columns.js"; // the left column of Changes and Edit at any width

const TABS_MIN = 140, SUBTITLE_MIN = 80; // px the file tabs and the header's subtitle keep when buttons fit around them
const ROW = 20, GUTTER = 58, BTN_GAP = 6, BUTTONS = 4; // Reject, Accept, Ask (prompt now), Comment (review comment); their width: barfit.hunkButtons
const base = (p) => p.split("/").pop();
const SROW = 22; // a Search result row's height
const TOK_CHARS = 4e6; // the highlight cache's texts, in characters (tok)
// Changes' "Committed on this branch": repos whose list is kept (loaded texts: changelist.CHANGES_CHARS).
const COMMITTED_REPOS = 16;
const STATS_MS = 300000; // each copy logs one line of what it holds this often (F7)
/** A Changes row before its texts are read (loadRow): no lines, not a file to edit. */
const LAZY = { lazy: true, Btext: "", Ctext: undefined, B: [], C: [], hunks: [], oldTok: null, newTok: null };

/** A space's Search view state (the Edit tab's left column): kept per space like the rest of the view. */
function newSearch() {
  return { left: "explorer", query: "", include: "", exclude: "", replace: "", opts: { cased: false, word: false, regex: false }, more: false,
    results: null, running: false, seq: 0, collapsed: new Set(), shutVer: 0, sel: null, confirm: false, note: null, busy: false };
}

/**
 * A file state for undo and redo, without its caches (fields starting with "_": rowsOf's rows,
 * matches' find results). They're rebuilt when the state is shown again; kept, every undo step
 * would hold a row object per line of the file.
 */
const bare = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith("_")));

/** A path as the agent in `terminal` sees it: /mnt/c/... for an agent running in WSL. */
function agentPath(path, terminal) {
  const t = terminals().find((x) => x.address === terminal);
  const wsl = /(^|[\\/])wsl(\.exe)?$/i.test(t?.argv?.[0] ?? "");
  const m = /^([A-Za-z]):\/(.*)$/.exec(path);
  return wsl && m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : path;
}

/** Capture runs in whichever copy leads, often a hidden one, so it logs to a file (in order). */
let logQueue = Promise.resolve();
function log(msg) {
  const path = `${appHome()}/data/wingman-capture.log`, line = `${new Date().toISOString()} ${msg}\n`;
  logQueue = logQueue.then(async () => {
    const old = await readTextFile(path);
    await writeTextFile(path, ((old ?? "").length > 20000 ? old.slice(-10000) : old ?? "") + line, old);
  }).catch(() => {});
}

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

// Panel split: a copy whose block has props {view: "review" | "edit"} shows only that view. The
// copies talk through shared(): GOTO hands the current file to the other view, DIRTY lists each
// copy's files with unsaved edits, SAVE asks the copies holding them to save (autosave on).
const GOTO = "wingman.goto", DIRTY = "wingman.dirty", SAVE = "wingman.saveReq";
const REVIEW = "wingman.review"; // Review's open change count per file key, for the Changes view
const DIRTY_FRESH = 30000; // ms: an entry older than this is from a copy that's gone
// The Explorer's file operations: TREE_MENU names the copy whose tree the right-click menu is for
// (every shown copy gets the menu's command); FILEOP tells the other copies what was renamed or deleted.
const TREE_MENU = "wingman.treeMenu", FILEOP = "wingman.fileop";
// Commands (cmdroute.js): SETTINGS_REV / HOOK_REV ({ stamp }) tell every copy, hidden ones too, to read
// the settings or look for the Claude hook again. CMD_INBOX: the shown copies' deliveries of a command,
// so one acts (claim); module scope is shared by every copy of this build.
const SETTINGS_REV = "wingman.settingsRev", HOOK_REV = "wingman.hookRev";
const CMD_INBOX = [];
// A git command won by a copy that isn't the shown Changes copy: GIT_REQ ({ space, cmd, stamp }) hands it
// over; GIT_TAKEN (stamp -> when) is where the Changes copy that took it says so, so exactly one acts.
const GIT_REQ = "wingman.gitReq", GIT_TAKEN = new Map();

// Review comments (comments.js): one file per space under data/wingman/comments, written compare-and-swap.
// COMMENTS ({ "<space>": stamp }) tells every copy, the dialogs too, that a space's file changed;
// CMT_JUMP asks a pane copy (no panel view) to open a comment's place.
const COMMENTS = "wingman.comments", CMT_JUMP = "wingman.commentJump";
const cmtDir = () => `${appHome()}/data/wingman`;
const cmtIo = {
  read: (p) => readTextFile(p),
  write: (p, text, expected) => writeTextFile(p, text, expected),
  mkdir: (d) => fs.mkdir(d, { recursive: true }).catch(() => {}),
};

/** Marks a space's comments as changed for every copy (never cleared: a stamp per space, newest 64 kept). */
function bumpComments(space) {
  const all = { ...(shared(COMMENTS) ?? {}) };
  all[space] = Math.max(Date.now(), (all[space] ?? 0) + 1);
  setShared(COMMENTS, Object.fromEntries(Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 64)));
}

/** Applies `op` to a space's comments file (retrying on a conflicting write) and tells the copies. */
async function changeComments(space, op) {
  const r = await updateComments(cmtIo, cmtDir(), space, op);
  if (r.changed) bumpComments(space);
  return r.state;
}

/** Opens a comment's file at its line: in the Edit panel, else the Review panel, else a pane copy (CMT_JUMP). */
function jumpTo(c) {
  const at = { line: Math.max(0, c.start - 1), col: 0 };
  for (const view of ["edit", "review"]) {
    if (!hasView(view)) continue;
    showView(view);
    setShared(GOTO, { view, space: c.space, key: c.key, at, stamp: Date.now() });
    return;
  }
  setShared(CMT_JUMP, { space: c.space, root: c.root, rel: c.rel, line: at.line, stamp: Date.now() });
}

/** An agent as the comments dialog names it. */
function agentLabel(a) {
  if (!a) return "the agent";
  const tab = a.tab_name || (a.tab_index != null ? `tab ${a.tab_index + 1}` : "");
  return `${a.program?.name ?? a.app ?? "Agent"}${tab ? ` · ${tab}` : ""} · ${a.address}`;
}

/** Whether the layout has a Wingman panel copy for `view`. */
function hasView(view) {
  const walk = (n) => !!n && ((n.content?.mod === "wingman" && n.content.props?.view === view) || (n.children ?? []).some(walk));
  return walk(layout());
}

/** Shows the layout block of the Wingman copy for `view`: selects it in its stacks, shows hidden parents. */
function showView(view) {
  const path = [];
  const walk = (n) => {
    if (!n) return false;
    path.push(n);
    if (n.content?.mod === "wingman" && n.content.props?.view === view) return true;
    for (const c of n.children ?? []) if (walk(c)) return true;
    path.pop(); return false;
  };
  if (!walk(layout())) return false;
  path.forEach((n, i) => {
    const next = path[i + 1];
    if (n.type === "stack" && next && n.active !== next.id) run("layout.select", { stack: n.id, child: next.id });
    if (n.hidden) run("layout.show", { id: n.id });
  });
  return true;
}

export default class Review extends View {
  // A pane copy can't tell which pane it is (mod panes get no props, and every copy
  // restarts together on reload), so copies don't depend on it:
  // - Display: a Wingman pane is only visible while its space is active, so every copy
  //   shows the active space's review, and keeps each space's state for when it returns.
  // - Capture: one copy holds a lease (.leader.json) and captures for every reviewed space
  //   (reviewSpaces), so the work never runs twice. A repo has one capture record, shared by
  //   every space that includes it (captureplan.js). A failing repo is retried on its own slower
  //   schedule and shown to every copy as a one-line notice (CAPTURE_ERRORS), never as this.error.
  init(_props, cx) {
    // Opened as a popup (reason or follow-up prompt): a small form, none of the pane's work.
    if (props()?.form) return this.initForm(cx);
    if (props()?.role === CONTROLLER) return this.initController(cx);
    this.id = Math.random().toString(36).slice(2);
    this.dropSleeper = addSleeper((ms) => cx.sleep(ms)); // time limits on calls to other machines (remote.withTimeout)
    this.settings = { autoNote: true, editNote: true, autosave: true, autosaveDelay: 0, editor: "wingman", autoPairs: true, autoTags: true, externalEditor: "code", externalCommand: "", inlineCommand: INLINE_COMMAND, wordWrap: false, hideHerdrPanels: false, formatOnSave: false, problems: true, problemsAfterTurn: false, problemsCommands: {} };
    this.formatting = new Set(); // "<space>|<file key>" of the formats running
    this.fmtCaches = new Map(); // space -> what formatrun.js found for it (the formatter per folder), cleared with the space
    this.editNotes = new Map(); // file key -> the edit note last queued for it
    // Q48: Review (tabs are changed files) or Edit (file tree, tabs for changed and opened files).
    // A panel copy shows one view; a tab or pane opened with props.view outside the panel layout starts in
    // that view as a pane copy (panelview.copyView), so dialogs' jumps reach it.
    const cv = copyView(props()?.view, layout());
    this.view = cv.view; this.startMode = cv.mode;
    this.gotoSeen = Date.now(); this.dirtySig = ""; this.dirtyAt = 0; this.saveSeen = Date.now(); this.fileopSeen = Date.now(); this.gitReqSeen = Date.now();
    // Review comments per space (comments.js), loaded from their file when COMMENTS says it changed.
    this.cmts = new Map(); this.cmtSeen = new Map(); this.jumpSeen = Date.now(); this.anchorSeen = new Map();
    try { this.repoShut = new Set(JSON.parse(localStorage.getItem("repoShut") ?? "[]")); } catch { this.repoShut = new Set(); }
    try { this.repoOpen = new Set(JSON.parse(localStorage.getItem("repoOpen") ?? "[]")); } catch { this.repoOpen = new Set(); }
    this.mode = this.startMode; this.treeOn = true; this.trees = new Map(); this.ftrees = new Map();
    cx.spawn(async (cx) => { this.settings = await loadSettings(); syncPanels(shared, setShared, this.settings.hideHerdrPanels); this.paint(cx); }); // host reads only from a task, never from init itself
    this.setKeymap({});
    cx.spawn(async () => { this.setKeymap(await loadKeys()); await syncHerdrKeys(this.keymap); });
    // Commands (cmdroute.js): Herdr hands wingman.<command> to every shown copy. "focus" (a popup over
    // this copy closed) and tree menu commands are this copy's own; settings and hook reloads reach
    // every copy, hidden ones too, through a shared stamp; any other command is done by one copy only.
    this.settingsRev = shared(SETTINGS_REV)?.stamp ?? 0; this.hookRev = shared(HOOK_REV)?.stamp ?? 0;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^wingman\./, ""), name = cmdName(c), kind = kindOf(name);
        if (kind === "all") { setShared(name === "hook" ? HOOK_REV : SETTINGS_REV, { stamp: Date.now() }); continue; } // tick() reloads
        if (kind === "one" && !(await this.claim(name, cx))) continue;
        if (c === "focus") { if (this.treeEdit && !this.treeEdit.busy) this.focusTreeInput(true); else this.handle.focus(); }
        // G6: Changes' git commands run in the shown Changes copy; another copy shows Changes and hands them over (GIT_REQ).
        else if (GIT_COMMANDS.test(c)) this.gitCommand(c, cx);
        else if (/^tree[A-Z]/.test(c)) this.treeMenuCmd(c, cx);
        // Problems' commands run in the copy that owns Problems (the Edit panel's, else a pane copy with
        // no Edit panel); another copy hands them over (PROBLEMS_REQ) and shows the Edit panel.
        else if (c === "checkProblems" || /^problems[A-Z]/.test(c)) {
          if (this.problems.owner()) { if (c === "checkProblems") this.problems.checkNow(cx); else this.problems.command(c, cx); }
          else { showView("edit"); setShared(PROBLEMS_REQ, { space: this.spaceId, ...(c === "checkProblems" ? {} : { cmd: c }), stamp: Date.now() }); }
        }
        else if (c === "openSettings") this.openSettings();
        // Inline edit as a command (the right-click menu, keys.json, `herdr-app do
        // "wingman.inlineEdit:<instruction>"`, which also runs it): the Edit copy when it got it, else
        // the copy that did hands it to Edit at its lines (openInline, as ctrl-k in Review).
        else if (name === "inlineEdit") this.openInline(cx, c.startsWith("inlineEdit:") ? c.slice("inlineEdit:".length) : null);
        // The checkpoints dialog: one, from whichever copy got the command.
        else if (c === "checkpoints") this.openCheckpoints(cx);
        else {
          // The diff's right-click menu: [the action whose focus rule applies, what it does].
          const menu = {
            prompt: ["comment", () => this.askPrompt(this.current, cx)],
            // Reject, then open the reason popup for that rejection right away.
            rejectReason: ["reject", () => this.decide("reject", cx, true)],
            // Reject the current change, then add a review comment on where it was.
            rejectComment: ["reject", () => this.rejectWithComment(cx)],
            clear: [null, () => this.clearSelection(cx)],
          }[c];
          // Every action (a key keys.json sends as wingman.<action>, e.g. "alt-up": "wingman.moveLineUp",
          // or the menu's reject, accept, reason) goes through the same focus rule as its key (act).
          if (menu) { if (!menu[0] || allowedIn(menu[0], this.focusKind())) await menu[1](); }
          else if (BY_ID.has(c)) this.act(c, cx);
        }
        this.paint(cx);
      }
    });
    this.handle = cx.focus_handle(); this.scroll = VirtualListScrollHandle.new(); this.searchScroll = VirtualListScrollHandle.new(); this.treeScroll = ScrollHandle.new();
    this.chgScroll = VirtualListScrollHandle.new();
    this.initFind();
    this.views = new Map(); this.loop = new CaptureLoop({ id: this.id, log, paint: (cx) => this.paint(cx) }); this.tokens = new Map();
    this.reset([]);
    this.queue = Promise.resolve(); this.writing = 0;
    // D7: async passes run in a task of their own. A timer's cx is the callback's only: a pass that
    // awaits and then calls cx.notify() on it redraws nothing, so a repo found after the first look
    // (spaces() and terminals() lag a new space by a moment) only showed on the next redraw from elsewhere.
    cx.timer.every(1000, (cx) => { if (!this.following) cx.spawn(async (cx) => this.follow(cx)); });
    cx.timer.every(1000, () => crumb(`alive ${this.view ?? this.mode} leader=${!!this.loop.isLeader}`, null, ALIVE_MS)); // crash breadcrumbs: every copy, first 10 s after Changes shows
    cx.timer.every(250, (cx) => {
      if (this.paintAsk) { this.paintAsk = false; cx.notify(); } // paint(): a redraw asked from a task, from this callback's own cx
      crumb("tick: autosave", "changes", 2000); this.autosave(cx); this.publishDirty(); crumb("tick: publishReview", "changes", 2000); this.publishReview(); this.takeShared(cx); this.takeGit(cx);
      this.syncComments(cx); this.reloadShared(cx);
      if (this.mode === "changes") {
        // The picked row's texts (selected some other way too: a hand-off), then its neighbours'.
        const f = this.file();
        crumb(`tick: loadRow selected ${f?.key ?? "none"}`, "changes", 2000); this.loadRow(f, cx);
        if (f && !f.loading && !f.lazy) for (const n of neighbours(this.files, f.key)) { crumb(`tick: loadRow neighbour ${n.key}`, "changes", 2000); this.loadRow(n, cx); }
        // Shown again after being hidden (refreshChanges does nothing meanwhile): look now, not at the next poll.
        const shown = this.changesShown();
        if (shown && this.changesHidden !== false) { this.crumbRendered = false; this.crumbListRendered = false; this.crumbSized = false; this.crumbRange = false; this.crumbBuilt = false; openCrumbs(); crumb(`hidden->shown detected (first=${this.changesHidden === undefined}, refresh=${!!this.changesHidden})`, "changes"); }
        if (shown && this.changesHidden) {
          log(`changes shown: ${this.files.length} uncommitted, ${this.committed?.length ?? 0} committed, ${this.changesChars()} chars loaded`);
          crumb("before spawn refreshChanges (from 250ms timer)", "changes");
          cx.spawn(async (cx) => this.refreshChanges(cx));
          crumb("after spawn refreshChanges (from 250ms timer)", "changes");
        }
        this.changesHidden = !shown;
      }
    });
    if (this.view === "changes") this.initChanges(cx);
    this.captureTimers(cx);
    cx.timer.every(STATS_MS, () => this.logStats());
    cx.timer.every(1000, (cx) => this.anchorComments(cx));
    this.cpCounts = new Map(); cx.timer.every(3000, (cx) => this.countCheckpoints(cx)); // G4: the header's Checkpoints N, per space
    cx.timer.every(1000, (cx) => { if (this.inlines.get(this.spaceId)?.status === "running") this.paint(cx); }); // the inline edit box's seconds
    cx.timer.every(5000, (cx) => this.mode === "edit" && (this.treeOn || this.nvim()) && this.refreshTrees(cx));
    // Session log source (agentview.js): reads only while this copy shows Agent files or Review.
    this.agentFiles = new AgentFiles(this); cx.timer.every(5000, (cx) => this.agentFiles.tick(cx));
    // Problems (problemsview.js): runs and shows in the owner copy only; its tick watches agents' turns.
    this.problems = new Problems(this, { log, agentLabel, hasView }); cx.timer.every(1000, (cx) => this.problems.tick(cx));
    // Watch events would be the fast path, but they did not fire on Windows in testing,
    // so a 2 s content check is what catches outside edits. "#index" keeps the index
    // checked even when no files are listed (e.g. right after a reset).
    cx.timer.every(2000, (cx) => this.stores.length && this.onWatch(new Set(["#index", ...this.files.map((f) => norm(f.path ?? ""))]), cx));
    cx.spawn(async (cx) => this.follow(cx));
  }

  /**
   * Redraws this copy. D7: a cx.notify() from a task didn't always reach the pane: a copy made by
   * a tab.new right after other tab.new calls redrew only from timer callbacks (until its tab was
   * shown again), so a repo or tree found by a task stayed off screen. The 250 ms tick redraws
   * again, from its own cx, whenever this was asked since its last run.
   */
  paint(cx) {
    // The shown file's rows are built here, in the handler or task (about 500 ms allowed), not in
    // render() (about 50 ms): a long file's wrapped rows can take longer than a render may.
    // A failure here is render()'s to report (it builds them again): this only warms the cache.
    try { if (this.role !== CONTROLLER && !this.form && this.files) { const f = this.file(); if (f) this.rowsOf(f); } } catch { /* render reports it */ }
    this.paintAsk = true; cx.notify();
  }

  /**
   * Whether this copy is the one that acts on command `name` (cmdroute.js): every copy that got it
   * waits SETTLE_MS for the others, then the highest ranked acts. Its rank: it opened the menu that
   * sent the command, it has the keyboard, the command is Problems' or inline edit's and this is
   * their copy, it's a panel copy.
   */
  async claim(name, cx) {
    const now = Date.now();
    const owner = ownerView(name) ? this.view === ownerView(name) : (name === "inlineEdit" || name === "checkProblems" || /^problems[A-Z]/.test(name)) && !!this.problems?.owner();
    const me = { id: this.id, c: name, at: now, rank: cmdRank({ menu: now - (this.menuAt ?? 0) < 60000, focused: !!this.handle?.is_focused?.() || !!this.inBar,
      owner, panel: !!this.view }) };
    cmdPrune(CMD_INBOX, now).push(me);
    await cx.sleep(SETTLE_MS);
    return cmdWinner(CMD_INBOX, me) === this.id;
  }

  /** A git command this copy won (claim): the shown Changes copy runs it; any other shows Changes and hands it over (GIT_REQ). */
  gitCommand(c, cx) {
    if (ownedAction(this.view, this.mode === "changes" && this.changesShown(), "changes") === "act") return this.gitx?.command(c, cx);
    if (!showView("changes")) { this.error = "This layout has no Wingman Changes panel"; return; }
    const now = Date.now();
    for (const [k, at] of GIT_TAKEN) if (now - at > 2 * HANDOFF_MS) GIT_TAKEN.delete(k);
    setShared(GIT_REQ, { space: this.spaceId, cmd: c, stamp: now });
  }

  /** The Changes copy, every tick: a git command handed over by another copy, once this copy is shown (exactly one copy takes it). */
  takeGit(cx) {
    if (this.view !== "changes" || !this.gitx) return;
    const req = shared(GIT_REQ), now = Date.now();
    const what = handoff(req, { seen: this.gitReqSeen, taken: GIT_TAKEN, space: this.spaceId, shown: this.mode === "changes" && this.changesShown(), now });
    if (what === "wait") return;
    if (req) this.gitReqSeen = Math.max(this.gitReqSeen ?? 0, req.stamp);
    if (what === "take") { GIT_TAKEN.set(req.stamp, now); this.gitx.command(req.cmd, cx); this.paint(cx); }
  }

  /** Settings or the Claude hook changed (a shared stamp any copy sets): read them again, in every copy. */
  reloadShared(cx) {
    const s = shared(SETTINGS_REV)?.stamp ?? 0, h = shared(HOOK_REV)?.stamp ?? 0;
    if (s !== this.settingsRev) {
      this.settingsRev = s;
      cx.spawn(async (cx) => { this.settings = await loadSettings(); syncPanels(shared, setShared, this.settings.hideHerdrPanels); this.setKeymap(await loadKeys()); this.paint(cx); });
    }
    if (h !== this.hookRev) { this.hookRev = h; forgetHook(); for (const j of this.loop.journals?.values() ?? []) j.at = 0; }
  }

  /** Per-space view state; no stores means no repo found yet. */
  reset(stores) {
    this.stores = stores; this.files = []; this.sel = null; this.current = 0; this.history = [];
    this.deferred = new Set(); this.indexTexts = {}; this.error = null; this.loadError = null;
    this.cur = null; this.anchor = null; this.redo = []; this.hx = 0; this.opened = [];
    this.search = newSearch(); this.searchFocus = false; this.problemsFocus = false;
    this.treeCur = this.treeEdit = this.treeDel = null; this.treeFocus = false;
    // Changes (P5) and the workspace panel: the commit box's text is restored from commitMsg on a switch.
    this.committed = []; this.changeSig = null; this.unchecked = new Set(); this.commitRoot = this.commitNote = this.discardKey = null; this.commitMsg = "";
    this.committedOpen = new Set(); // repos whose "Committed on this branch" is expanded (collapsed by default)
    this.ws = null;
    this.status = stores.length ? "Loading…" : "Waiting for an agent in a git repo in this space, or open a folder.";
  }

  // ---- which space ---------------------------------------------------------

  /** Shows the active space's review, opening its repo when an agent there is in one. `force`: look
   *  the roots up now (a space on another machine is looked up at most every 5 s). */
  async follow(cx, force = false) {
    if (this.following) return;
    this.following = true;
    try {
      const sp = spaces().find((s) => s.active);
      const key = sp?.id ?? null;
      // A switch never waits for queued writes: each write holds its own file and store, and what it
      // reports lands in its own space's state (stateOf).
      if (key !== this.spaceId) {
        if (this.settings.autosave) this.saveAll(cx);
        if (this.spaceId) this.views.set(this.spaceId, this.snapshotView());
        this.spaceId = key;
        const saved = this.views.get(key);
        if (saved) Object.assign(this, saved); else this.reset([]);
        this.views.delete(key); // the live state is on the instance now (saved again on leaving)
        // A view kept light (its files let go, retain.js; Changes always) loads them again now.
        // While writes are queued, the reload waits for them (drain after the queue: "*").
        if (saved?.light) {
          this.light = false;
          if (this.writing) this.deferred.add("*");
          else cx.spawn(async (cx) => { if (this.spaceId === key) await this.reloadAll(cx); });
        }
        this.pruneViews();
        this.syncSearchInputs();
        this.commitInput?.set_value(this.commitMsg ?? "");
        // Boxes and lists of the space left behind close: Quick Open's files, the tree menu's item.
        if (this.qo) { this.qo = null; if (this.inBar === this.quickInput) { this.inBar = null; this.handle.focus(); } }
        if (this.inBar === this.pathInput || this.inBar === this.treeInput) { this.inBar = null; this.handle.focus(); }
        this.menuItem = null; this.treeScrollTo = null;
        this.paint(cx);
      }
      // The roots are looked up once writes are done: a reload meanwhile could read a half-written file.
      if (!sp || this.writing) return;
      const on = sp.machine ?? null;
      if (on) {
        const at = (this.rootsAt ??= new Map()).get(key) ?? 0;
        if (!force && Date.now() - at < REMOTE.rootsMs) return;
        this.rootsAt.set(key, Date.now());
      }
      // The space's repos (workspace.js): where its agents started (any agent), its workspace
      // file's folders, and every repo the Claude hook saw them edit, less the ones removed by
      // hand. A repo joins the view when it appears and leaves when it's removed.
      // D2: every terminal's folder counts. One outside any repo, or a workspace folder that isn't
      // one, is a plain root: listed and editable, never reviewed. Repos come first.
      const start = props()?.root ? await Store.open(props().root).catch(() => null) : null;
      const { repos, plain } = props()?.root ? { repos: start ? [start.root] : [], plain: [] } : await this.loop.folderRoots(sp);
      const { roots, names } = await spaceRoots(sp, [...repos, ...plain]);
      const found = [];
      for (const root of roots) {
        const st = this.stores.find((x) => x.root === root || x.asked === root) ?? (isHome(root) ? null : await this.loop.openStore(root, on))
          ?? ((await this.loop.folderKind(root, on)).dir ? new PlainRoot(root, on) : null);
        if (st && !found.includes(st)) found.push(st);
      }
      found.sort((a, b) => !!a.plain - !!b.plain);
      for (const st of found) st.label = names.get(st.asked ?? st.root) ?? names.get(st.root) ?? null;
      const same = found.length === this.stores.length && found.every((st, i) => st === this.stores[i]);
      if (!same && this.spaceId === key) {
        const left = new Set(found), files = this.files.filter((f) => left.has(f.store)), ids = new Set(found.map(idOf));
        const kept = (it) => (it && ids.has(it.id) ? it : null);
        const keep = { sel: files.some((f) => f.key === this.sel) ? this.sel : files[0]?.key ?? null, current: this.current,
          history: this.history.filter((h) => h.snaps ? h.snaps.every((f) => left.has(f.store)) : !h.key || files.some((f) => f.key === h.key)), opened: this.opened.filter((k) => files.some((f) => f.key === k)),
          search: this.search, searchFocus: this.searchFocus,
          // The tree's selection, name box and confirm stay while their root does; Changes' state stays.
          treeCur: kept(this.treeCur), treeEdit: kept(this.treeEdit), treeDel: kept(this.treeDel), treeFocus: this.treeFocus && !!kept(this.treeCur),
          committed: (this.committed ?? []).filter((f) => left.has(f.store)), changeSig: this.changeSig, unchecked: this.unchecked, committedOpen: this.committedOpen,
          commitRoot: this.commitRoot, commitNote: this.commitNote, commitMsg: this.commitMsg, discardKey: this.discardKey, ws: this.ws };
        this.reset(found);
        Object.assign(this, keep); this.files = files;
        this.rekeyFiles(); // a root added inside another takes its files over (P1)
        await this.reloadAll(cx);
        if (this.mode === "edit") this.refreshTrees(cx);
      }
    } finally { this.following = false; }
  }

  /**
   * Drops the kept views of spaces that are gone: their files, highlighting and undo steps would
   * stay for good otherwise. A space on another machine is only known gone while that machine's
   * layout is loaded (offline, its spaces aren't listed), and a view with unsaved edits stays.
   */
  pruneViews() {
    const live = new Set(spaces().map((s) => s.id)), ready = new Set(machines().filter((m) => m.layout === "ready").map((m) => m.name));
    for (const [k, v] of this.views) {
      if (live.has(k) || v.stores.some((st) => st.on && !ready.has(st.on)) || v.files.some((f) => this.dirty(f))) continue;
      this.views.delete(k); this.rootsAt?.delete(k);
    }
    // Only the HEAVY_VIEWS most recently left keep their loaded files; a view with unsaved edits,
    // undo steps or a pending merge keeps everything.
    if (this.writing) return; // a queued write reports into its space's kept files
    const pinned = (v) => v.history.length > 0 || v.redo.length > 0 || v.files.some((f) => this.dirty(f) || f.conflict);
    for (const k of toLighten([...this.views].map(([k, v]) => [k, { light: !!v.light, pinned: pinned(v) }]), HEAVY_VIEWS)) this.views.set(k, this.lighten(this.views.get(k)));
  }

  /**
   * A kept view without its loaded files (texts, highlighting, hunks): what restores it stays (the
   * selection, opened files, Search, the Changes boxes), and its files load again when it's shown.
   */
  lighten(v) {
    for (const f of v.committed ?? []) this.unloadRow(f);
    return { ...v, files: [], indexTexts: {}, changeSig: null, status: "Loading…", light: true };
  }

  /** The space's git repos: every root but the plain ones. */
  repos() { return this.stores.filter((st) => !st.plain); }

  /** The repos Review covers: every repo, on this computer or the space's machine. */
  reviewed() { return this.repos(); }

  /** The active space's machine, null for this computer. */
  machine() { return this.space()?.machine ?? null; }

  /**
   * A space's state, kept while another space is shown. Kept: its files, review, undo, Search, the
   * Changes lists (committed rows without their texts, which load again when picked), the commit
   * box's text, checked files and picked repo, and an open workspace panel (not Add repo's path box,
   * whose text is this copy's). Dropped: the cursor, the tree's selection, name box and delete
   * confirm, Discard's confirm, Quick Open.
   */
  snapshotView() {
    const { stores, files, sel, current, history, indexTexts, error, loadError, status, redo, opened, search, changeSig, unchecked, commitRoot, commitNote } = this;
    for (const f of this.committed ?? []) this.unloadRow(f);
    const v = { stores, files, sel, current, history, indexTexts, error, loadError, status, redo, opened, search, searchFocus: false, problemsFocus: false, cur: null, anchor: null, hx: 0, deferred: new Set(),
      treeCur: null, treeEdit: null, treeDel: null, treeFocus: false,
      committed: this.committed ?? [], changeSig, unchecked: unchecked ?? new Set(), committedOpen: this.committedOpen ?? new Set(), commitRoot, commitNote, commitMsg: this.commitInput?.value() ?? this.commitMsg ?? "", discardKey: null,
      ws: this.ws?.kind === "path" ? null : this.ws ?? null };
    // Changes keeps nothing loaded for a space that isn't shown (its files are read-only there):
    // the lists and texts load again when it's back. Its highlighting cache goes with them.
    if (this.mode === "changes") { this.tokens.clear(); this.tokChars = 0; return this.lighten(v); }
    return v;
  }

  /**
   * The state of `space`: this copy's own fields while it's shown, else its kept view (null when it's
   * gone). Work that outlives a space switch (a queued write, Replace All, a commit) reports here.
   */
  stateOf(space) { return stateFor(this, space); }

  // ---- capture (leader only): captureloop.js, this.loop

  /** The capture loop's timers: every copy runs them, only the lease's holder does the work. */
  captureTimers(cx) {
    // D7: each pass runs in a task of its own, never on the timer callback's cx after an await.
    cx.timer.every(500, (cx) => { if (!this.loop.leading) cx.spawn(async (cx) => this.loop.lead(cx)); });
    // Renewed while a long capture pass runs too; so are the failing repos shared with the other copies.
    cx.timer.every(1000, () => { if (this.loop.isLeader) { this.loop.lease(); this.loop.publishCaptureErrors(); } });
    // A pass every 3 s, or every 10 s while file watches wake passes (captureloop.js collectTick).
    cx.timer.every(500, (cx) => { if (this.loop.isLeader && !this.loop.collecting) cx.spawn(async (cx) => this.loop.collectTick(cx)); });
  }

  /**
   * A capture controller (props.role "capture"): a zero-size block in the layout's `floating` list,
   * always rendered, never hidden. It shows nothing and only runs the capture loop, which it leads
   * over every panel copy (captureloop.js CONTROLLER).
   */
  initController(cx) {
    this.role = CONTROLLER;
    this.id = Math.random().toString(36).slice(2);
    this.dropSleeper = addSleeper((ms) => cx.sleep(ms));
    this.loop = new CaptureLoop({ id: this.id, log, controller: true });
    this.captureTimers(cx);
    log(`capture controller ${this.id} started`);
  }

  close() {
    this.loop?.close();
    this.dropSleeper?.();
    this.gitx?.release();
    this.scroll?.release(); this.searchScroll?.release(); this.treeScroll?.release(); this.chgScroll?.release(); for (const i of [this.findInput, this.replaceInput, this.lineInput, this.quickInput, this.pathInput, this.treeInput, this.inlineInput, ...(this.searchInputs ?? [])]) i?.release();
    // The copy is going: its texts, highlighting, undo steps and file lists are let go now, not
    // whenever the runtime drops the instance (a task still waiting would keep it, and all of this).
    for (const m of [this.views, this.tokens, this.trees, this.ftrees, this.loop?.captures]) m?.clear();
    this.files = []; this.committed = []; this.history = []; this.redo = []; this.qo = null;
  }

  // ---- loading -------------------------------------------------------------

  async withTokens(f, cx) {
    // What's on disk for this state: edits change memory first, and a save writes the difference.
    f.diskC = f.Ctext; f.diskB = f.Btext;
    if (!f.error) {
      crumb(`withTokens: before highlight old ${f.rel} len=${f.Btext?.length}`, "changes");
      f.oldTok = await this.tok(f.Btext, f.rel, cx);
      crumb(`withTokens: after highlight old ${f.rel}`, "changes");
      crumb(`withTokens: before highlight new ${f.rel} len=${f.Ctext?.length ?? 0}`, "changes");
      f.newTok = await this.tok(f.Ctext ?? "", f.rel, cx);
      crumb(`withTokens: after highlight new ${f.rel}`, "changes");
    }
    return f;
  }

  async reloadAll(cx) {
    // The Changes copy loads only while it's shown: once shown, refreshChanges finds changeSig unset and loads.
    if (this.mode === "changes") { if (!this.changesShown()) { this.changeSig = null; return; } return this.loadChanges(cx); }
    // A reload that outlives a space switch or a change of roots is dropped: its files are another state's.
    const space = this.spaceId, stores = this.stores, stale = () => this.spaceId !== space || this.stores !== stores;
    try {
      const files = [], texts = {};
      for (const st of this.reviewed()) {
        // Only this branch's changes, made by this space's agents (store.shows).
        const [stamp, branch] = await Promise.all([st.stamp(), st.branch()]);
        texts[st.root] = stamp;
        if (st.on) await this.markRemote(st, stamp);
        for (const f of await st.files((e) => shows(e, branch, this.spaceId, spaceOfAgent))) files.push(await this.withTokens(f, cx));
      }
      if (stale()) return;
      const kept = [];
      for (const nf of files) kept.push(await this.keepEdits(nf, cx));
      // Opened files without changes stay open: plain ones as they are, others reread as plain.
      for (const old of this.files) {
        if (kept.some((k) => k.key === old.key) || !(old.plain || this.opened.includes(old.key))) continue;
        kept.push(old.plain || this.dirty(old) ? old : await this.loadPlain(old.store, old.rel, cx));
      }
      // Opened files of a view kept light (retain.js) are read again.
      for (const key of this.opened) {
        if (kept.some((k) => k.key === key)) continue;
        const i = key.indexOf("|"), st = this.stores.find((x) => x.root === key.slice(0, i));
        if (st) kept.push(await this.loadPlain(st, key.slice(i + 1), cx));
      }
      if (stale()) return;
      this.files = kept; this.indexTexts = texts; this.status = null; loadOk(this);
      this.settle(); this.paint(cx);
      // The review changed: the tree's counts and status letters follow.
      if (this.mode === "edit" && (this.treeOn || this.nvim())) this.refreshTrees(cx);
    } catch (e) { loadFailed(this, space, String(e.message ?? e)); this.paint(cx); }
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

  // A Changes row whose texts aren't loaded (lazy) has nothing in memory to save.
  dirty(f) { return !!f && !f.error && !f.lazy && (f.Ctext !== f.diskC || f.Btext !== f.diskB); }

  async reloadOne(f, cx) {
    if (f.plain) {
      const next = await this.loadPlain(f.store, f.rel, cx);
      this.replace(f, next); this.settle(); this.paint(cx); return;
    }
    const entry = (await f.store.index())[f.rel];
    const i = this.files.findIndex((x) => x.key === f.key);
    if (!entry || i < 0) return this.reloadAll(cx);
    this.files[i] = await this.withTokens(await f.store.load(f.rel, entry), cx);
    this.settle(); this.paint(cx);
  }

  // Watch events: our own writes match memory and are skipped; anything else reloads that file.
  // While writes are queued, events wait so a half-written state is never read back.
  onWatch(touched, cx) {
    if (this.mode === "changes") return; // the Changes view polls git itself (refreshChanges)
    if (touched === "all") this.deferred.add("*");
    else for (const n of touched) this.deferred.add(n);
    if (!this.writing) cx.spawn(async (cx) => this.drain(cx));
  }

  async drain(cx) {
    if (this.mode === "changes") { this.deferred.clear(); return; }
    if (this.draining) return;
    this.draining = true;
    const space = this.spaceId;
    try {
      while (this.deferred.size && !this.writing && this.spaceId === space) {
        const pending = this.deferred; this.deferred = new Set();
        let indexChanged = false;
        for (const st of this.reviewed()) if (!st.on && (await st.stamp()) !== this.indexTexts[st.root]) indexChanged = true;
        // Another machine isn't watched: one hash call per machine, at most every REMOTE.watchMs.
        const away = await this.remoteChanged();
        if (away.stores.size) indexChanged = true;
        if (pending.has("*") || indexChanged) { await this.reloadAll(cx); continue; }
        for (const f of this.files) {
          if (this.spaceId !== space) break; // switched meanwhile: this state isn't shown any more
          if (f.error || !(f.store?.on ? away.files.has(f.key) : pending.has(norm(f.path)))) continue;
          // Both sides: accepting only moves the baseline, so a baseline changed elsewhere
          // (another pane, capture, a reset) must be noticed even when the file itself is unchanged.
          // A plain (opened, unchanged) file has no baseline on disk: it is the file itself.
          const on = f.store?.on ?? null;
          const [c, b0] = await Promise.all([readTextFile(f.path, { on }), f.plain ? null : readTextFile(f.basePath, { on })]), b = f.plain ? c : b0;
          if (on && c === f.diskC && (b ?? "") === f.diskB) this.sameAsRead(f);
          if ((c === f.diskC && (b ?? "") === f.diskB) || this.sameConflict(f, c, b ?? "")) continue;
          if (!this.dirty(f)) { await this.reloadOne(f, cx); continue; }
          const next = await this.mergeInto(f, { ...f, Ctext: c, Btext: b ?? "" }, cx);
          // Typed into while merging: merge again from the newer edits.
          if (!this.files.includes(f)) { this.deferred.add(norm(f.path)); continue; }
          this.adoptMerge(f, next); this.paint(cx);
        }
      }
    } finally { this.draining = false; }
  }

  // ---- another machine: noticing outside changes without watching -------------------

  /** Records what Review last read of a store on another machine (its index and HEAD), as hashes. */
  async markRemote(st, stamp) {
    const [i, h] = stamp.split("\0");
    (this.remoteMarks ??= new Map()).set(idOf(st), { [`${st.dir}/index.json`]: i === "null" ? null : await sha256Hex(i), [`${st.gitDir}/HEAD`]: h === "null" ? null : await sha256Hex(h) });
  }

  /** A text's SHA-256, cached for the few texts asked about again and again. */
  async hashText(text) {
    if (text == null) return null;
    const cache = (this.hashes ??= new Map());
    if (cache.has(text)) return cache.get(text);
    const h = await sha256Hex(text);
    cache.set(text, h);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return h;
  }

  /** A remote file reread as memory has it, though its hash differs (a BOM, bytes that aren't
   *  UTF-8): its last hashes count as unchanged from now on. */
  sameAsRead(f) {
    const p = this.lastPrints?.get(f.store.on) ?? {};
    (this.okPrints ??= new Map()).set(f.key, [p[f.path], f.plain ? undefined : p[f.basePath]]);
  }

  /**
   * Another machine's changes, without watching: for each machine of the shown repos, at most every
   * REMOTE.watchMs, one call hashes each store's index and HEAD and each open file (and its
   * baseline). Returns the stores whose index or HEAD isn't what Review last read, and the keys of
   * files whose text isn't what memory holds as on disk.
   */
  async remoteChanged() {
    const out = { stores: new Set(), files: new Set() }, now = Date.now(), at = (this.printsAt ??= new Map());
    const ons = new Set(this.reviewed().filter((st) => st.on).map((st) => st.on));
    for (const f of this.files) if (f.store?.on && !f.error) ons.add(f.store.on);
    for (const on of ons) {
      if (now - (at.get(on) ?? 0) < REMOTE.watchMs) continue;
      at.set(on, now);
      const stores = this.reviewed().filter((st) => st.on === on && this.remoteMarks?.has(idOf(st)));
      const files = this.files.filter((f) => f.store?.on === on && !f.error && f.Ctext !== undefined);
      const paths = [...stores.flatMap((st) => [`${st.dir}/index.json`, `${st.gitDir}/HEAD`]), ...files.flatMap((f) => (f.plain ? [f.path] : [f.path, f.basePath]))];
      if (!paths.length) continue;
      const p = await fingerprints([...new Set(paths)], { on });
      (this.lastPrints ??= new Map()).set(on, p);
      for (const st of stores) {
        const m = this.remoteMarks.get(idOf(st));
        if (Object.entries(m).some(([k, h]) => k in p && p[k] !== h)) out.stores.add(st);
      }
      for (const f of files) {
        const ok = this.okPrints?.get(f.key);
        if (ok && ok[0] === p[f.path] && (f.plain || ok[1] === p[f.basePath])) continue;
        const differs = async (path, text) => path in p && p[path] !== (await this.hashText(text));
        if ((await differs(f.path, f.diskC ?? null)) || (!f.plain && (await differs(f.basePath, f.diskB ?? "")))) out.files.add(f.key);
      }
    }
    return out;
  }

  // Highlighting cached by content, so a reload re-tokenizes only text that changed. Each key is a
  // copy of a whole text, so the cache is capped by text size too (TOK_CHARS), not only by count:
  // Herdr's one memory limit is shared by every copy of every mod.
  async tok(text, rel, cx) {
    const lang = languageOf(rel, text.slice(0, 200)), key = `${lang}\0${text}`;
    if (!this.tokens.has(key)) {
      const lines = await highlight(text, lang, cx);
      if (this.tokens.has(key)) return this.tokens.get(key); // another call made it meanwhile
      this.tokens.set(key, lines);
      this.tokChars = (this.tokChars ?? 0) + key.length;
      while (this.tokens.size > 1 && (this.tokens.size > 40 || this.tokChars > TOK_CHARS)) {
        const old = this.tokens.keys().next().value;
        this.tokens.delete(old); this.tokChars -= old.length;
      }
    }
    return this.tokens.get(key);
  }

  // ---- selection -----------------------------------------------------------

  // A file stays in view while it's being edited, even once it has no changes left.
  shown(f) { return f.hunks.length || (f.edited && f.key === this.sel) || this.dirty(f); }
  /** The tabs: changed files, plus in the Edit view the files opened from the tree. */
  visible() {
    // Changes: committed rows count while their repo's section is expanded.
    if (this.mode === "changes") return [...this.files, ...shownCommitted(this.committed ?? [], this.committedOpen ?? new Set(), idOf)];
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
    crumb("settle enter", "changes", 8000);
    const vis = this.visible();
    if (this.restoreSel && vis.some((f) => f.key === this.restoreSel)) { this.sel = this.restoreSel; this.restoreSel = null; this.current = 0; } // see undo
    if (!vis.some((f) => f.key === this.sel)) {
      const at = this.files.findIndex((f) => f.key === this.sel);
      // Changes never picks a committed row by itself: with no uncommitted files nothing is picked.
      const next = this.files.slice(at + 1).find((f) => vis.includes(f)) ?? (this.mode === "changes" ? this.files.at(-1) : vis[vis.length - 1]);
      this.sel = next?.key ?? null; this.current = 0;
    }
    const f = this.file();
    this.current = f ? Math.max(0, Math.min(this.current, f.hunks.length - 1)) : 0;
    if (!f) this.cur = this.anchor = null;
    else if (this.cur) { this.cur = this.clampPos(f, this.cur); if (this.anchor) this.anchor = this.clampPos(f, this.anchor); }
    crumb(`settle: showTab ${this.sel}`, "changes", 8000);
    if (this.sel) this.showTab(this.sel); // no-op when its tab is already on screen
    crumb("settle exit", "changes", 8000);
  }

  rowsOf(f) {
    const w = this.wrapCols();
    // An empty file shows one empty line (P6); a deleted one, or a committed row not loaded yet, none.
    const live = typeof f.Ctext === "string";
    if (f._rowsFor !== f.hunks || f._rowsC !== f.C || f._rowsW !== w || f._rowsLive !== live) {
      const rows = buildRows(f.B, f.C, f.hunks, live);
      f._rows = w ? this.wrapRows(f, rows, w) : rows; f._rowsFor = f.hunks; f._rowsC = f.C; f._rowsW = w; f._rowsLive = live;
      f._lineRow = [];
      f._rows.forEach((r, i) => { if (r.side === "new" && !r.cont) f._lineRow[r.line] = i; });
    }
    return f._rows;
  }

  /** E5: with line wrap on, the text columns a row holds (0: wrap off). */
  wrapCols() {
    return this.settings.wordWrap ? wrapColumns(this.vw(), GUTTER, 16, this.cw()) : 0;
  }

  /** E5: a long line's row becomes one row per segment ({ seg, segs }; later ones have `cont`). */
  wrapRows(f, rows, w) {
    // This runs for every line, often inside render() (Herdr stops a render after about 50 ms): a
    // line that fits, by its length and without tabs, takes no more work.
    const out = [];
    for (const r of rows) {
      if (r.kind === "@") { out.push(r); continue; }
      const line = (r.side === "old" ? f.B : f.C)[r.line] ?? "";
      if (line.length <= w && !line.includes("\t")) { out.push(r); continue; }
      const segs = segments(body(line), w);
      if (segs.length === 1) out.push(r);
      else segs.forEach((seg, i) => out.push({ ...r, seg, segs, cont: i > 0 }));
    }
    return out;
  }

  /** The row showing position p of the current file (its segment's row when wrapped). */
  rowOfPos(f, p) {
    this.rowsOf(f);
    const i = f._lineRow[p.line];
    if (i == null) return null;
    const r = f._rows[i];
    return r.segs ? i + segmentOf(r.segs, p.col) : i;
  }

  toggleWrap(cx) {
    this.settings = { ...this.settings, wordWrap: !this.settings.wordWrap };
    this.hx = 0; this.selA = this.selB = null;
    const next = this.settings, space = this.spaceId;
    cx.spawn(async () => { try { await saveSettings({ ...(await loadSettings()), wordWrap: next.wordWrap }); } catch (e) { failIn(this, space, String(e.message ?? e)); } });
    this.showCursor(); this.paint(cx);
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

  tabTag(x) { return x.error ? (x.error === "binary file" ? "binary" : "error") : x.created ? "new" : x.Ctext === null ? "deleted" : x.hunks.length ? String(x.hunks.length) : ""; }

  /** Opened files close; changed files stay until reviewed (Q48). */
  closable(x) { return this.mode === "edit" && this.opened.includes(x.key) && !x.hunks.length; }

  tabMax() {
    const total = this.visible().reduce((w, x) => w + this.tabWidth(x), 0);
    return Math.max(0, total - this.tabVW());
  }

  setTabOffset(px) { this.tabOffset = Math.max(0, Math.min(px, this.tabMax())); }

  /** Shifts the strip just enough to show `key`'s tab. */
  showTab(key) {
    if (!this.tabViewW) return; // not laid out yet; the size callback reveals it
    const view = this.tabVW();
    let x0 = 0;
    for (const x of this.visible()) {
      const w = this.tabWidth(x);
      if (x.key === key) {
        const off = this.tabOffset ?? 0;
        if (x0 < off) this.setTabOffset(x0);
        else if (x0 + w > off + view) this.setTabOffset(x0 + w - view);
        return;
      }
      x0 += w;
    }
  }

  /** Either wheel axis, in pixels (lines count as 20 px). */
  tabWheel(ev, cx) {
    const d = ev.delta_lines ? (ev.delta_lines.x || ev.delta_lines.y) * 20 : this.px(ev.delta.x || ev.delta.y);
    if (!d) return;
    this.setTabOffset((this.tabOffset ?? 0) - d);
    this.paint(cx);
    cx.stop_propagation();
  }

  tab(x, t) {
    return h_flex().id(`file-${x.key}`).flex_none().w(this.tabWidth(x)).h_full().pr(4).items_center()
      .on_click((_e, cx) => { this.treeFocus = false; this.pick(x.key, cx); })
      .child(h_flex().w_full().h(26).px(10).gap(6).items_center().rounded(6).overflow_hidden().cursor_pointer()
        .when(x.key === this.sel, (e) => e.bg(t.selected)).hover((st) => st.bg(t.hover))
        .when(this.stores.length > 1, (e) => e.child(div().text_size(10).text_color(t.dim).whitespace_nowrap().child(base(x.store.root))))
        .child(div().text_size(12).whitespace_nowrap().when(!!this.problems.mark(x.store, x.rel), (e) => e.text_color(this.problems.mark(x.store, x.rel) === "error" ? t.ansi1 : t.ansi3)).child(base(x.rel)))
        .when(this.dirty(x), (e) => e.child(div().text_size(10).text_color(t.accent).child("●")))
        .child(div().text_size(10).whitespace_nowrap().text_color(x.error ? t.ansi1 : t.muted).child(this.tabTag(x)))
        .when(this.closable(x), (e) => e.child(div().id(`close-${x.key}`).px(3).rounded(3).text_size(11).text_color(t.dim)
          .hover((st) => st.bg(t.raised).text_color(t.foreground)).child("×")
          .on_click((_e, cx) => { cx.stop_propagation(); this.closeTab(x.key, cx); }))));
  }

  // ---- Edit view: opened files and the file tree (Q48) ---------------------------

  /** A file opened from the tree that has no changes: its own baseline, kept in memory only. */
  async loadPlain(store, rel, cx) {
    [store, rel] = this.own(store, rel);
    const path = `${store.root}/${rel}`, key = `${store.root}|${rel}`, f = { rel, path, basePath: null, store, key, plain: true, created: false, by: null, as: null, hunks: [] };
    let text = null, error = null;
    try { text = await readTextFile(path, { on: store.on ?? null }); } catch (e) { error = String(e.message ?? e); }
    if (!error && text === null) error = "file not found";
    // Binary: a NUL, or text that isn't UTF-8 (many replacement characters near the start).
    if (!error && (text.includes("\0") || (text.slice(0, 8000).match(/\uFFFD/g)?.length ?? 0) > 8)) error = "binary file";
    if (error) return { ...f, error };
    const C = splitLines(text);
    return this.withTokens({ ...f, Btext: text, Ctext: text, B: C, C }, cx);
  }

  async openFile(store, rel, cx, at = null, { check = false } = {}) {
    [store, rel] = this.own(store, rel); // one identity per file, however it was reached (P1)
    this.narrowLeft = false; // a narrow Edit view (columns.js) shows the file, not the column
    const key = `${store.root}|${rel}`, space = this.spaceId, rk = `${idOf(store)}|${rel}`;
    this.recent = [rk, ...this.recent.filter((k) => k !== rk)].slice(0, 30);
    // Neovim's Edit view is the tree alone: the file goes straight to Neovim, at its first change.
    if (this.treeOnly()) {
      if (store.on) { this.error = NVIM_NOTE; this.paint(cx); return; }
      const f = this.files.find((x) => x.key === key);
      this.treeSel = key; this.revealInTree(key, cx); this.paint(cx);
      try { await openInNvim(space, store.root, `${store.root}/${rel}`, at?.line ?? f?.hunks[0]?.n ?? 0); }
      catch (e) { failIn(this, space, String(e.message ?? e)); this.paint(cx); }
      return;
    }
    if (!this.files.some((f) => f.key === key)) {
      const f = await this.loadPlain(store, rel, cx);
      if (this.spaceId !== space || this.files.some((x) => x.key === key)) return;
      this.files.push(f);
    }
    const fresh = !this.opened.includes(key); // a tab opened now (not one shown again): its file-scope checkers run
    if (fresh) this.opened.push(key);
    this.pick(key, cx);
    const f = this.file();
    if ((fresh || check) && f?.key === key) this.problems.opened(f.store, f.rel, cx); // check: a hand-off from Review or Changes, whose file may have changed since its last run
    if (f && at && f.key === key) { this.cur = this.clampPos(f, at); this.anchor = null; this.showCursor(); this.paint(cx); }
    if (f && this.nvim()) this.toNvim(f, at?.line ?? f.hunks[0]?.n ?? 0, cx);
  }

  // ---- Quick Open (ctrl-p) ------------------------------------------------------

  openQuick(cx) {
    if (!this.repos().length) return;
    this.refreshTrees(cx);
    this.qo = { sel: 0, items: [] };
    this.quickInput.set_value(""); this.rankQuick();
    this.quickInput.focus(); this.paint(cx);
  }

  closeQuick(cx) { this.qo = null; this.inBar = null; this.handle.focus(); this.paint(cx); }

  moveQuick(by, cx) {
    if (!this.qo?.items.length) return;
    const n = this.qo.items.length;
    this.qo.sel = (this.qo.sel + by + n) % n; this.paint(cx);
  }

  /** Every file of the space's repos, recent and changed ones first (the order an empty query shows). */
  quickItems() {
    const seen = new Set(), out = [];
    const add = (store, rel) => {
      if (rel.endsWith("/")) return; // a repo inside this one, as git lists it
      [store, rel] = this.own(store, rel); // a file another root owns is listed as that root's (P1)
      const k = `${store.root}|${rel}`; if (!seen.has(k)) { seen.add(k); out.push({ key: k, store, rel }); }
    };
    const byKey = new Map(this.files.map((f) => [f.key, f]));
    // Plain roots (folders outside git) aren't searched.
    // Recent keys carry the root's id (rootId), so a file of the same path on another machine isn't one of them.
    for (const k of this.recent) { const f = byKey.get(k); if (f && !f.store.on) { if (!f.store.plain) add(f.store, f.rel); } else { const st = this.repos().find((s) => k.startsWith(idOf(s) + "|")); if (st) add(st, k.slice(idOf(st).length + 1)); } }
    for (const f of this.files) if (!f.plain && !f.error && f.hunks.length) add(f.store, f.rel);
    const head = out.length;
    for (const st of this.repos()) for (const rel of this.trees.get(idOf(st))?.paths ?? []) add(st, rel);
    return { all: out, head };
  }

  /** Tab: the box takes the highlighted file's path, keeping any :line already typed. */
  completeQuick(cx) {
    const it = this.qo?.items[this.qo.sel];
    if (!it) return;
    const at = /(:\d*(?::\d*)?)\s*$/.exec(this.quickInput.value())?.[1] ?? "";
    this.quickInput.set_value(it.rel + at);
    this.rankQuick(); this.paint(cx);
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
      if (f) { this.cur = this.clampPos(f, q.at); this.anchor = null; this.showCursor(); if (this.nvim()) this.toNvim(f, q.at.line, cx); this.paint(cx); }
      return;
    }
    if (!it) return;
    this.closeQuick(cx);
    const changed = this.files.find((f) => f.key === it.key && !f.plain && f.hunks.length);
    if ((this.view === "review" && !changed) || this.view === "changes") return this.handOff("edit", cx, q.at, it.key);
    if (this.mode === "review" && !changed) this.setMode("edit", cx);
    cx.spawn(async (cx) => this.openFile(it.store, it.rel, cx, q.at));
  }

  quickOpen(t) {
    const items = this.qo.items, multi = this.repos().length > 1, counts = new Map(this.files.map((f) => [f.key, f.hunks.length]));
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

  /** E9: the current file in the external editor chosen in Settings, at the cursor, else at the current change. Unsaved edits are saved first. */
  toVSCode(cx) {
    const f = this.file();
    if (!f || f.Ctext === null) return;
    if (f.store?.on) { this.error = EDITOR_NOTE; this.paint(cx); return; }
    if (this.dirty(f) && !f.conflict) this.save(cx, f);
    const at = this.cur ?? { line: f.hunks[this.current]?.n ?? 0, col: 0 }, space = this.spaceId;
    cx.spawn(async (cx) => {
      try { await openInEditor(this.settings.externalEditor, f.path, at.line, at.col, this.settings.externalCommand); }
      catch (e) { failIn(this, space, String(e.message ?? e)); this.paint(cx); }
    });
  }
  treeOnly() { return this.mode === "edit" && this.nvim(); }

  /** Opens `f` at `line` in the space's Neovim (N1). */
  toNvim(f, line, cx) {
    if (!f || f.Ctext === null) return;
    if (f.store?.on) { this.error = NVIM_NOTE; this.paint(cx); return; }
    const space = this.spaceId;
    cx.spawn(async (cx) => {
      try { await openInNvim(space, f.store.root, f.path, line); }
      catch (e) { failIn(this, space, String(e.message ?? e)); this.paint(cx); }
    });
  }

  /** Closing saves unsaved edits when autosave is on (Q46); without it they must be saved first. */
  closeTab(key, cx) {
    const f = this.files.find((x) => x.key === key);
    if (f && this.dirty(f)) {
      if (!this.settings.autosave || f.conflict) { this.error = `${base(f.rel)} has unsaved edits: save them first (${this.kl("save")})`; this.paint(cx); return; }
      this.save(cx, f);
    }
    this.opened = this.opened.filter((k) => k !== key);
    if (f?.plain) this.files = this.files.filter((x) => x.key !== key);
    if (this.sel === key) { this.cur = this.anchor = null; this.hx = 0; }
    this.error = null; this.settle(); this.paint(cx);
  }

  // ---- W1 workspace: adding and removing repos -------------------------------------
  // The repo strip is the tree's repo headers: each repo's name, change count and ×, with
  // "+ Add repo…" under them. Picking a folder that isn't a repo lists the repos inside it.
  // A main clone picked while the workspace's worktrees share a branch is offered as a new
  // worktree beside them. Removing asks first, and offers to delete a worktree too.

  space() { return spaces().find((s) => s.id === this.spaceId) ?? null; }
  /**
   * P1: the root of this space that owns `rel` of root `st` (roots.ownerOf: the deepest root holding
   * the path, a repo before a plain folder) and the path relative to it. A file opened through a
   * plain folder that holds a repo of the space is the repo's file: one key, one tab, one buffer, and
   * saves go through the repo's store.
   */
  own(st, rel) {
    const o = rel ? ownerOf(this.stores, under(st.root, rel), st.on ?? null) : null;
    return o && o.root !== st && o.rel ? [o.root, o.rel] : [st, rel];
  }

  /** After the roots changed: an open plain file that another root owns now moves to that root's key (own). */
  rekeyFiles() {
    const moved = new Map();
    for (const f of [...this.files]) {
      if (!f.plain) continue;
      const [o, rel] = this.own(f.store, f.rel);
      if (o === f.store) continue;
      const key = `${o.root}|${rel}`, other = this.files.find((x) => x.key === key), edited = this.dirty(f) || !!f.conflict;
      if (other && edited) continue; // both open, this one edited: left until it's saved or closed
      if (other) this.files = this.files.filter((x) => x !== f);
      else this.replace(f, { ...f, store: o, rel, key });
      moved.set(f.key, key);
    }
    if (!moved.size) return;
    this.opened = [...new Set(this.opened.map((k) => moved.get(k) ?? k))];
    if (moved.has(this.sel)) this.sel = moved.get(this.sel);
    const stale = (h) => moved.has(h.key) || h.snaps?.some((x) => moved.has(x.key));
    this.history = this.history.filter((h) => !stale(h)); this.redo = this.redo.filter((h) => !stale(h));
  }

  hasRepo(root) { return this.stores.some((st) => norm(st.root) === norm(root) || norm(st.asked ?? "") === norm(root)); }

  /** The workspace's worktrees' shared branch and the folder beside them for `repo`, or null. */
  async worktreeOffer(repo) {
    const infos = await Promise.all(this.repos().map(async (st) => ({ st, info: await repoInfo(st.root, st.on ?? null).catch(() => null) })));
    const linked = infos.filter((x) => x.info?.linked);
    const branch = sharedBranch(linked.map((x) => x.info.branch)), dest = worktreeDest(linked.map((x) => x.st.root), repo);
    return branch && dest ? { branch, dest } : null;
  }

  /** Adds a repo to this space by hand: a repo, a parent folder of repos, or a main clone as a worktree.
   *  The folder picker is this computer's: a space on another machine takes a typed path there. */
  openFolder(cx) {
    if (!this.spaceId) return;
    this.showExplorer();
    if (this.machine()) { this.ws = { kind: "path" }; this.pathInput.set_value(""); this.pathInput.focus(); this.paint(cx); return; }
    const sp = this.space(), put = (k, v) => { const s = this.stateOf(sp?.id); if (s) s[k] = v; }; // into its own space's state
    cx.spawn(async (cx) => {
      try {
        const dir = await pickFolder({ prompt: "Add a repo to this space" });
        if (!dir || this.spaceId !== sp?.id) return; // picked after leaving the space: nothing is added
        this.showExplorer(); this.wsBusySpace = sp?.id; this.wsBusy = "Looking…"; this.paint(cx);
        const st = await Store.open(dir).catch(() => null);
        if (!st) {
          const repos = await scanRepos(dir);
          if (!repos.length) throw new Error(`${dir} is not a git repo and holds none`);
          const offer = await this.worktreeOffer("x");
          put("ws", { kind: "pick", parent: dir, offer, asWorktrees: !!offer, repos: repos.map((path) => ({ path, on: false, has: this.hasRepo(path) })) });
          return;
        }
        if (this.hasRepo(st.root)) throw new Error(`${base(st.root)} is already in this space`);
        const info = await repoInfo(st.root), offer = info && !info.linked ? await this.worktreeOffer(base(st.root)) : null;
        if (offer) { put("ws", { kind: "worktree", root: st.root, ...offer }); return; }
        await this.addRepos([st.root], cx, sp);
      } catch (e) { put("error", String(e.message ?? e)); }
      finally { this.wsBusy = null; this.paint(cx); }
    });
  }

  /** Space on another machine: the typed path's repo, or the repos inside it to pick from; a main
   *  clone is offered as a worktree beside the space's others, as here. */
  addPath(cx) {
    const on = this.machine(), dir = remotePath(this.pathInput.value().trim()), sp = this.space(), put = (k, v) => { const s = this.stateOf(sp?.id); if (s) s[k] = v; };
    if (!on || !dir || this.wsBusy) return;
    this.showExplorer();
    cx.spawn(async (cx) => {
      try {
        this.wsBusySpace = sp?.id; this.wsBusy = "Looking…"; this.paint(cx);
        const st = await Store.open(dir, on).catch(() => null);
        if (!st) {
          const repos = await scanRepos(dir, on);
          if (!repos.length) throw new Error(`${dir} on ${on} is not a git repo and holds none`);
          const offer = await this.worktreeOffer("x");
          put("ws", { kind: "pick", parent: dir, offer, asWorktrees: !!offer, on, repos: repos.map((path) => ({ path, on: false, has: this.hasRepo(path) })) });
          return;
        }
        if (this.hasRepo(st.root)) throw new Error(`${base(st.root)} is already in this space`);
        const info = await repoInfo(st.root, on), offer = info && !info.linked ? await this.worktreeOffer(base(st.root)) : null;
        if (offer) { put("ws", { kind: "worktree", root: st.root, on, ...offer }); return; }
        await this.addRepos([st.root], cx, sp);
      } catch (e) { put("error", String(e.message ?? e)); }
      finally { this.wsBusy = null; this.paint(cx); }
    });
  }

  /** Adds repo folders to the space: to its workspace file (made when this makes two) and its repo map.
   *  On another machine, to Wingman's own workspace file only (workspace.js). */
  async addRepos(roots, cx, sp = this.space()) {
    if (!sp) return;
    for (const root of roots) {
      await addFolder(sp, root, (this.stateOf(sp.id)?.stores ?? []).filter((st) => !st.plain).map((st) => st.asked ?? st.root));
      // The capture leader writes the same file: retry when it wrote first.
      if (!sp.machine) for (let i = 0; ; i++) { try { await addSpaceRepos([[sp.id, root]]); break; } catch (e) { if (i >= 2) throw e; } }
      this.loop.misses?.delete(rootId(root, sp.machine ?? null));
    }
    if (this.spaceId === sp.id) { this.ws = null; this.error = null; }
    this.paint(cx);
    await this.follow(cx, true);
  }

  /** The pick panel's or worktree offer's confirm: makes worktrees where asked, then adds. */
  confirmAdd(cx) {
    const ws = this.ws, sp = this.space();
    if (!ws || this.wsBusy) return;
    cx.spawn(async (cx) => {
      try {
        const roots = [];
        const items = ws.kind === "worktree" ? [{ path: ws.root }] : ws.repos.filter((r) => r.on && !r.has);
        const on = this.machine();
        for (const r of items) {
          const info = await repoInfo(r.path, on);
          const offer = ws.kind === "worktree" ? ws : ws.asWorktrees && ws.offer && info && !info.linked ? { branch: ws.offer.branch, dest: ws.offer.dest.replace(/[^/]+$/, base(r.path)) } : null;
          if (offer) {
            this.wsBusySpace = sp?.id; this.wsBusy = `Making a worktree for ${base(r.path)} on ${offer.branch}…`; this.paint(cx);
            await addWorktree(r.path, offer.dest, offer.branch, on);
            roots.push(offer.dest);
          } else roots.push(r.path);
        }
        this.wsBusySpace = sp?.id; this.wsBusy = "Adding…"; this.paint(cx);
        await this.addRepos(roots, cx, sp);
      } catch (e) { failIn(this, sp?.id, String(e.message ?? e)); }
      finally { this.wsBusy = null; this.paint(cx); }
    });
  }

  /** × on a repo header: asks first (open changes come back when it's added again). */
  askRemove(st, cx) {
    if (this.files.some((f) => f.store === st && this.dirty(f))) { this.error = `${this.repoName(st)} has unsaved edits: save or undo them first`; this.paint(cx); return; }
    const open = this.files.filter((f) => f.store === st).reduce((n, f) => n + (f.plain ? 0 : f.hunks.length), 0);
    this.ws = { kind: "remove", st, open, linked: null };
    this.showExplorer(); this.paint(cx);
    if (!st.plain) cx.spawn(async (cx) => { const info = await repoInfo(st.root, st.on ?? null).catch(() => null); if (this.ws?.st === st) { this.ws.linked = !!info?.linked; this.paint(cx); } });
  }

  confirmRemove(deleteWorktree, cx) {
    const ws = this.ws, sp = this.space();
    if (ws?.kind !== "remove" || !sp || this.wsBusy) return;
    cx.spawn(async (cx) => {
      try {
        if (deleteWorktree) { this.wsBusySpace = sp?.id; this.wsBusy = `Deleting the worktree ${ws.st.root}…`; this.paint(cx); await removeWorktree(ws.st.root, ws.st.on ?? null); }
        await removeFolder(sp, ws.st.asked ?? ws.st.root);
        if (ws.st.asked && norm(ws.st.asked) !== norm(ws.st.root)) await removeFolder(sp, ws.st.root);
        const s = this.stateOf(sp.id); // its own space's state, shown or not
        if (s) { s.ws = null; s.error = null; }
        await this.follow(cx, true);
      } catch (e) { const s = this.stateOf(sp.id); if (s) s.error = String(e.message ?? e); }
      finally { this.wsBusy = null; this.paint(cx); }
    });
  }

  repoName(st) { return st.label ?? base(st.root); }

  /** P8: the workspace panel shows under the Explorer tree, so opening it with Search in the left column shows Explorer (Search is a click away). */
  showExplorer() {
    if (this.search?.left === "agent") this.search.left = "explorer"; // Agent files: the panel is under Explorer too
    if (this.searchShown()) { this.search.left = "explorer"; this.searchFocus = false; if (this.searchInputs?.includes(this.inBar)) { this.inBar = null; this.handle.focus(); } }
  }

  /** Collapses or expands a root in the tree. Kept across reloads (per pane copy); repoOpen
   *  remembers plain roots opened by hand, which otherwise start collapsed beside a repo. */
  toggleRepo(st, cx) {
    const shut = (this.repoShut ??= new Set()), open = (this.repoOpen ??= new Set()), was = this.rootShut(st), id = idOf(st);
    if (was) { shut.delete(id); open.add(id); } else { shut.add(id); open.delete(id); }
    try { localStorage.setItem("repoShut", JSON.stringify([...shut])); localStorage.setItem("repoOpen", JSON.stringify([...open])); } catch {}
    if (was && st.plain) this.loadFolder(st, this.rootTree(st), "", cx);
    this.paint(cx);
  }

  /** The add, pick, worktree and remove panels, under the tree (or the status line without one). */
  workspacePanel(t) {
    const ws = this.ws;
    const busy = this.wsBusySpace === this.spaceId ? this.wsBusy : null; // another space's add or remove isn't this one's
    if (!ws && !busy) return null;
    const box = v_flex().id("ws-panel").mx(8).my(6).p(8).gap(6).rounded(6).bg(t.raised).text_size(11);
    const actions = (...btns) => h_flex().gap(6).flex_wrap().children(btns.filter(Boolean));
    const cancel = this.button("ws-cancel", "Cancel", t.background, (cx) => { this.ws = null; this.paint(cx); });
    if (busy) return box.child(div().text_color(t.muted).child(busy));
    if (ws.kind === "path") {
      return box.child(div().text_color(t.muted).child(`A repo, or a folder of repos, on ${this.machine() ?? "the space's machine"}`))
        .child(Input.new(this.pathInput))
        .child(actions(this.button("ws-path-add", "Add", t.accent + "55", (cx) => this.addPath(cx)), cancel));
    }
    if (ws.kind === "pick") {
      const n = ws.repos.filter((r) => r.on && !r.has).length;
      return box.child(div().text_color(t.muted).child(`Repos in ${ws.parent}`))
        .children(ws.repos.map((r, i) => h_flex().id(`ws-pick-${i}`).gap(6).items_center().cursor_pointer()
          .when(!r.has, (e) => e.on_click((_e, cx) => { r.on = !r.on; this.paint(cx); }))
          .child(div().w(12).text_color(r.has ? t.dim : t.foreground).child(r.has ? "✓" : r.on ? "☑" : "☐"))
          .child(div().flex_1().min_w(0).truncate().text_color(r.has ? t.dim : t.foreground).child(base(r.path) + (r.has ? " (in this space)" : "")))))
        .when(!!ws.offer, (e) => e.child(h_flex().id("ws-as-wt").gap(6).items_center().cursor_pointer().on_click((_e, cx) => { ws.asWorktrees = !ws.asWorktrees; this.paint(cx); })
          .child(div().w(12).child(ws.asWorktrees ? "☑" : "☐"))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(`Main clones as new worktrees on ${ws.offer.branch}, beside the others`))))
        .child(actions(n ? this.button("ws-add", `Add ${n} repo${n === 1 ? "" : "s"}`, t.accent + "55", (cx) => this.confirmAdd(cx)) : null, cancel));
    }
    if (ws.kind === "worktree") {
      return box.child(div().text_color(t.foreground).child(`${base(ws.root)} is a main clone. This space's worktrees are on ${ws.branch}.`))
        .child(div().text_color(t.muted).child(`A new worktree goes in ${ws.dest}`))
        .child(actions(this.button("ws-wt", `Add a worktree on ${ws.branch}`, t.accent + "55", (cx) => this.confirmAdd(cx)),
          this.button("ws-clone", "Add the clone itself", t.background, (cx) => { const sp = this.space(); cx.spawn(async (cx) => { try { await this.addRepos([ws.root], cx, sp); } catch (e) { failIn(this, sp?.id, String(e.message ?? e)); this.paint(cx); } }); }),
          cancel));
    }
    if (ws.kind === "remove") {
      const name = this.repoName(ws.st);
      return box.child(div().text_color(t.foreground).child(`Remove ${name} from this space?`))
        .when(ws.open > 0, (e) => e.child(div().text_color(t.ansi3).child(`It has ${ws.open} change${ws.open === 1 ? "" : "s"} to review. They come back if you add it again.`)))
        .when(!!ws.linked, (e) => e.child(div().text_color(t.muted).child("It's a worktree. Deleting it needs it to have no uncommitted or untracked files.")))
        .child(actions(this.button("ws-remove", "Remove", t.ansi1 + "40", (cx) => this.confirmRemove(false, cx)),
          ws.linked ? this.button("ws-remove-wt", "Remove and delete the worktree", t.ansi1 + "88", (cx) => this.confirmRemove(true, cx)) : null,
          cancel));
    }
    return null;
  }

  setMode(mode, cx) {
    if (this.view && mode !== this.view) return this.handOff(mode, cx);
    if (mode === this.mode) return;
    if (this.settings.autosave) this.saveAll(cx); // leaving a view saves (Q46)
    this.mode = mode;
    if (mode === "edit" && (this.treeOn || this.nvim())) this.refreshTrees(cx);
    this.settle(); this.handle.focus(); this.paint(cx);
  }

  /**
   * ctrl-shift-r: Review → Edit → Changes → Review. A pane copy has no Changes view, so it
   * flips Review and Edit; a panel copy skips Changes when the layout has no Changes block.
   */
  nextView() {
    if (!this.view) return this.mode === "review" ? "edit" : "review";
    const order = ["review", "edit", "changes"].filter((v) => v === this.view || hasView(v));
    return order[(order.indexOf(this.view) + 1) % order.length];
  }

  /** Panel split: shows the other view's copy and hands it the current file and line (`extra`: more for it, e.g. { search }). */
  handOff(view, cx, at = null, key = null, extra = null) {
    const f = key || extra ? null : this.file();
    if (this.settings.autosave) this.saveAll(cx);
    at ??= f ? this.cur ?? (f.hunks[this.current] ? { line: f.hunks[this.current].n, col: 0 } : null) : null;
    if (!showView(view)) { this.error = `This layout has no Wingman ${view === "edit" ? "Edit" : view === "changes" ? "Changes" : "Review"} panel`; this.paint(cx); return; }
    setShared(GOTO, { view, space: this.spaceId, key: key ?? f?.openKey ?? f?.key ?? null, at, ...(extra ?? {}), stamp: Date.now() });
  }

  /** Panel split: what the other copy handed over (GOTO) and save requests from Review (SAVE). */
  takeShared(cx) {
    crumb("takeShared enter", "changes", 2000);
    const g = this.view && shared(GOTO);
    // Changes loads its list only once shown: a hand-off to it waits for that load (at most 10 s).
    const waiting = !!g && this.view === "changes" && g.space === this.spaceId && (this.changeSig == null || this.loadingChanges) && Date.now() - g.stamp < 10000;
    if (g && g.view === this.view && g.stamp > this.gotoSeen && !waiting) {
      this.gotoSeen = g.stamp;
      if (g.space === this.spaceId) {
        this.handle.focus();
        const i = g.key?.indexOf("|") ?? -1, store = i > 0 && this.stores.find((st) => st.root === g.key.slice(0, i));
        if (g.search && this.view === "edit") this.showSearch(g.search.query, cx);
        else if (store && this.view === "edit") {
          // An inline edit asked for in Review (ctrl-k there) opens here, on the same lines.
          const inline = g.inline ?? null;
          cx.spawn(async (cx) => { await this.openFile(store, g.key.slice(i + 1), cx, g.at, { check: true }); if (inline && this.file()?.key === g.key) this.openInline(cx, inline.instruction ?? null, inline.span); });
        }
        else if (store && this.visible().some((f) => f.key === g.key)) {
          this.pick(g.key, cx);
          const f = this.file(), line = g.at?.line ?? 0;
          // Changes: a row still loading goes to the line once its hunks are in (loadRow).
          if (f?.lazy && g.at) this.gotoLine = { key: f.key, line }; else this.toLine(f, line);
        }
        // G4: a checkpoint's file with nothing to review here opens in Edit.
        else if (store && g.open && this.view === "review") this.handOff("edit", cx, g.at, g.key);
        this.paint(cx);
      }
    }
    // The comments dialog's Jump, when the layout has no Edit or Review panel: a pane copy opens it in Edit.
    const j = !this.view && shared(CMT_JUMP);
    if (j && j.stamp > this.jumpSeen) {
      this.jumpSeen = j.stamp;
      if (j.space === this.spaceId) {
        const store = this.stores.find((st) => st.root === j.root);
        if (!store) this.error = "That comment's folder isn't open in this space";
        else { if (this.mode !== "edit") this.setMode("edit", cx); cx.spawn(async (cx) => this.openFile(store, j.rel, cx, { line: j.line, col: 0 })); }
        this.paint(cx);
      }
    }
    // Another copy renamed or deleted something: its tabs and tree follow here too.
    const fo = shared(FILEOP);
    if (fo && fo.stamp > this.fileopSeen) { this.fileopSeen = fo.stamp; if (fo.copy !== this.id) this.applyFileOp(fo, cx, false); }
    const r = shared(SAVE);
    if (r && r.stamp > this.saveSeen) {
      this.saveSeen = r.stamp;
      if (this.settings.autosave) for (const f of this.files) if (r.keys.includes(f.key) && this.dirty(f) && !f.conflict) this.save(cx, f);
    }
    crumb("takeShared exit", "changes", 2000);
  }

  /** Panel split: this copy's files with unsaved edits, for Review to check (renewed every 10 s while any). */
  publishDirty() {
    crumb("publishDirty enter", "changes", 2000);
    const keys = this.files.filter((f) => this.dirty(f)).map((f) => f.key).sort(), sig = keys.join("\n"), now = Date.now();
    if (sig === this.dirtySig && (!keys.length || now - this.dirtyAt < 10000)) return;
    this.dirtySig = sig; this.dirtyAt = now;
    const all = { ...(shared(DIRTY) ?? {}) };
    for (const [id, v] of Object.entries(all)) if (now - (v?.at ?? 0) > DIRTY_FRESH) delete all[id];
    if (keys.length) all[this.id] = { keys, at: now }; else if (!(this.id in all)) return; else delete all[this.id];
    crumb("publishDirty setShared DIRTY", "changes", 2000); setShared(DIRTY, all);
  }

  /** Files among `keys` that another copy holds unsaved edits to. */
  heldElsewhere(keys) {
    const now = Date.now(), held = new Set();
    for (const [id, v] of Object.entries(shared(DIRTY) ?? {}))
      if (id !== this.id && now - (v?.at ?? 0) <= DIRTY_FRESH) for (const k of v.keys ?? []) held.add(k);
    return keys.filter((k) => held.has(k));
  }

  // ---- G1/G2: the Changes view (props.view "changes") ---------------------------

  initChanges(cx) {
    this.unchecked = new Set(); this.discardKey = null; this.commitNote = null; this.commitRoot = null; this.committing = false;
    this.commitInput = TextareaState.new({ placeholder: "Commit message (Ctrl+Enter commits)", rows: 3 });
    this.commitInput.on("submit", (e, cx) => { if (e?.secondary) this.commit(cx); });
    this.commitInput.on("change", (_e, cx) => this.paint(cx));
    this.commitInput.on("focus", () => { this.inBar = this.commitInput; this.treeFocus = false; });
    this.commitInput.on("blur", () => { if (this.inBar === this.commitInput) this.inBar = null; });
    cx.timer.every(2000, (cx) => { if (!this.refreshing) cx.spawn(async (cx) => this.refreshChanges(cx)); });
    // G6: each repo's sync row, the branch list, Discard change, Generate message (gitview.js).
    this.gitx = new GitActions(this, { log });
    cx.timer.every(1000, (cx) => { if (this.gitx.running()) this.paint(cx); }); // "Pushing…", "Writing a message… N s"
  }

  /** Review publishes its open change count per file, for the Changes view's tags. */
  publishReview() {
    if (this.view !== "review") return;
    const m = {};
    for (const f of this.files) if (!f.plain && !f.error) m[f.key] = f.hunks.length;
    const sig = JSON.stringify(m);
    if (sig === this.reviewSig) return;
    this.reviewSig = sig; setShared(REVIEW, m);
  }

  /** git in a store's repo, wherever the repo lives (git.js), on its machine. */
  git(st, args, opts = {}) {
    const what = `git ${args.filter((a) => !a.startsWith("-") && !a.startsWith("core.") && !a.startsWith("diff.")).slice(0, 3).join(" ")} in ${st.root}`;
    crumb(`before ${what}`, "changes");
    return git(args, { cwd: st.root, on: st.on ?? null, ...opts }).then((r) => { crumb(`after ${what} code=${r?.code} out=${r?.stdout?.length}`, "changes"); return r; }, (e) => { crumb(`after ${what} threw ${String(e?.message ?? e).slice(0, 80)}`, "changes"); throw e; });
  }

  /** A repo's `git status`, its HEAD and its files ({ out, head, list }). On another machine one call (STATUS_V2). */
  async statusOf(st) {
    if (st.on) {
      const s = await this.git(st, STATUS_V2);
      if (s.code !== 0) throw new Error(`git status in ${base(st.root)}: ${(s.stderr || s.stdout).trim()}`);
      return { out: s.stdout, ...parseStatusV2(s.stdout) };
    }
    const [s, head] = await Promise.all([this.git(st, STATUS), this.git(st, [...READ, "rev-parse", "-q", "--verify", "HEAD"])]);
    if (s.code !== 0) throw new Error(`git status in ${base(st.root)}: ${(s.stderr || s.stdout).trim()}`);
    return { out: s.stdout, head: head.code === 0 ? head.stdout.trim() : null, list: parseStatus(s.stdout) };
  }

  /**
   * What says a repo's listed files changed, beside its status: here the review index (each listed
   * file is reread too); on another machine, where every read is a call, one `git hash-object` of
   * the listed files on disk ("!" when that fails, e.g. a file went meanwhile: the status shows it).
   */
  async stampOf(st, list) {
    if (!st.on) return st.stamp();
    const rels = onDisk(list).slice(0, REMOTE.hashMax);
    if (!rels.length) return "";
    // Long paths go in several calls, each within the safe size of one call there (fsx.chunkArgs).
    let out = "";
    for (const run of chunkArgs(rels, 28000 - st.root.length * 2)) {
      const r = await this.git(st, ["hash-object", "--no-filters", "--", ...run]);
      if (r.code !== 0) return "!";
      out += r.stdout;
    }
    return out;
  }

  /**
   * What says a repo's Changes list is out of date: its status, HEAD, stampOf and line counts.
   * Returns them with the parsed status and counts (lineCounts).
   */
  async changeSigOf(st) {
    const { out, head, list } = await this.statusOf(st), stamp = await this.stampOf(st, list), counts = await this.lineCounts(st, head);
    return { head, list, counts: counts.map, sig: [idOf(st), head, out, stamp, counts.raw] };
  }

  /**
   * Every uncommitted file in the space's repos, listed from git status and line counts alone; a
   * file's texts (HEAD as B against the working tree as C), hunks and highlighting load when it's
   * picked (loadRow; the picked one before the list shows, so it never flashes). Then "Committed on
   * this branch" (committedRows: a list kept per repo until its base or HEAD moves, whose texts load
   * the same way). A load that outlives a space switch or a change of roots is dropped.
   */
  async loadChanges(cx) {
    if (this.loadingChanges) return;
    this.loadingChanges = true;
    crumb("loadChanges enter", "changes");
    const space = this.spaceId, stores = this.stores, stale = () => this.spaceId !== space || this.stores !== stores;
    try {
      const files = [], sig = [], heads = [];
      for (const st of this.repos()) {
        crumb(`loadChanges: before changeSigOf ${st.root}`, "changes");
        const { head, list, counts, sig: s } = await this.changeSigOf(st);
        crumb(`loadChanges: after changeSigOf ${st.root} files=${list.length}`, "changes");
        sig.push(...s);
        crumb(`loadChanges: before aiMarks ${st.root}`, "changes");
        const { ai, done } = await this.aiMarks(st);
        crumb(`loadChanges: after aiMarks ${st.root}`, "changes");
        // A repo inside this one (git lists it as "inner/") is its own root: its files aren't this one's (P1).
        const mine = list.filter(({ rel }) => !rel.endsWith("/") && this.own(st, rel)[0] === st);
        // An untracked file has no line counts in git's: it's read for them (a few at a time on
        // another machine, where each read is a call) and its text isn't kept.
        crumb(`loadChanges: before changeRow x${mine.length} ${st.root}`, "changes");
        const rows = await mapLimit(mine, st.on ? REMOTE.parallel : 1, ({ rel, xy }) => this.changeRow(st, rel, xy, !!head, counts.get(rel)));
        crumb(`loadChanges: after changeRow x${mine.length} ${st.root}`, "changes");
        for (const f of rows) files.push({ ...f, ai: ai.has(f.rel) });
        heads.push({ st, head, done });
      }
      if (stale()) return;
      // The picked file loads before the list shows (as when every text was read here).
      const sel = files.find((f) => f.key === this.sel);
      crumb(`loadChanges: before loadRowNow selected ${sel?.key ?? "none"}`, "changes");
      if (sel) { await this.loadRowNow(sel, cx); if (stale()) return; }
      crumb("loadChanges: after loadRowNow selected", "changes");
      // The committed rows from the last load stay meanwhile (this space's: kept per space).
      this.files = files; this.changeSig = sig.join("\0"); this.status = null; loadOk(this);
      if (this.discardKey && !files.some((f) => f.key === this.discardKey)) this.discardKey = null;
      crumb(`loadChanges: list set (${files.length} files), before settle+notify`, "changes");
      this.settle(); this.paint(cx);
      crumb("loadChanges: after settle+notify", "changes");
      const committed = [];
      for (const { st, head, done } of heads) if (head) { crumb(`loadChanges: before committedRows ${st.root}`, "changes"); committed.push(...(await this.committedRows(st, head, done))); crumb(`loadChanges: after committedRows ${st.root}`, "changes"); }
      if (stale()) return;
      this.committed = committed;
      crumb(`loadChanges: committed set (${committed.length}), before settle+notify`, "changes");
      this.settle(); this.paint(cx);
      crumb("loadChanges: after committed settle+notify", "changes");
      await this.gitx?.afterLoad(cx); // each repo's branch, upstream and ↑/↓ (local refs)
    } catch (e) { crumb(`loadChanges threw ${String(e?.message ?? e).slice(0, 80)}`, "changes"); loadFailed(this, space, String(e.message ?? e)); this.paint(cx); }
    finally { this.loadingChanges = false; crumb("loadChanges exit", "changes"); }
  }

  /**
   * An uncommitted file's row before its texts load: its status letter and line counts (git's, or
   * an untracked file's lines, read here and let go). Binary per git's counts (or a NUL in an
   * untracked file) and unreadable files carry their error, as when their texts were read.
   */
  async changeRow(st, rel, xy, hasHead, c) {
    const path = `${st.root}/${rel}`, key = `${st.root}|${rel}`;
    const f = { rel, path, basePath: null, store: st, key, xy, letter: statusLetter(xy), plain: false, created: xy === "??" || xy[0] === "A", by: null, as: null, hasHead, ...LAZY };
    if (c?.binary) return { ...f, lazy: false, error: "binary file" };
    if (c) return { ...f, add: c.add, del: c.del };
    if (xy !== "??") return f;
    try {
      crumb(`changeRow: before readTextFile ${path}`, "changes");
      const text = await readTextFile(path, { on: st.on ?? null });
      crumb(`changeRow: after readTextFile ${path} len=${text?.length ?? null}`, "changes");
      if (text?.includes("\0")) return { ...f, lazy: false, error: "binary file" };
      return text == null ? f : { ...f, add: countLines(text), del: 0 };
    } catch (e) { return { ...f, lazy: false, error: String(e.message ?? e) }; }
  }

  /** A changed file's HEAD text (B), working-tree text (C) and hunks, read where the repo lives; not yet highlighted. */
  async changeTexts(st, rel, xy, hasHead) {
    const path = `${st.root}/${rel}`, key = `${st.root}|${rel}`;
    const f = { rel, path, basePath: null, store: st, key, xy, letter: statusLetter(xy), plain: false, created: false, by: null, as: null, hunks: [] };
    try {
      crumb(`changeTexts: before git show HEAD:${rel} in ${st.root}`, "changes");
      const show = hasHead ? await this.git(st, [...READ, "show", `HEAD:${rel}`]) : { code: 1, stdout: "" };
      crumb(`changeTexts: after git show HEAD:${rel} len=${show.stdout?.length}`, "changes");
      crumb(`changeTexts: before readTextFile ${path}`, "changes");
      const inHead = show.code === 0, Btext = inHead ? show.stdout : "", Ctext = await readTextFile(path, { on: st.on ?? null });
      crumb(`changeTexts: after readTextFile ${path} len=${Ctext?.length ?? null}`, "changes");
      if (Btext.includes("\0") || Ctext?.includes("\0")) return { ...f, inHead, error: "binary file" };
      // The diff runs here, on temp copies (merge.js), wherever the texts came from.
      crumb(`changeTexts: before diffHunks ${rel} B=${Btext.length} C=${Ctext?.length ?? 0}`, "changes");
      // The repo's git diffs a file it has, by the repo's line-ending rules (a CRLF checkout of an LF
      // blob is one changed line, not all of them); a new or deleted file, or hunks that don't fit, here.
      const hunks = (inHead && typeof Ctext === "string" && await this.headHunks(st, rel, Btext, Ctext)) || await diffHunks(Btext, Ctext ?? "");
      crumb(`changeTexts: after diffHunks ${rel} hunks=${hunks.length}`, "changes");
      return { ...f, inHead, created: !inHead, Btext, Ctext, B: splitLines(Btext), C: splitLines(Ctext ?? ""), hunks, toTok: true };
    } catch (e) { return { ...f, error: String(e.message ?? e) }; }
  }

  /** A file's change against HEAD as the repo's git sees it (changes.headDiffArgs), when its hunks fit the texts; else null. */
  async headHunks(st, rel, Btext, Ctext) {
    const r = await this.git(st, headDiffArgs(rel)).catch(() => null);
    return r?.code === 0 ? fitHunks(parseHunks(String(r.stdout)), splitLines(Btext).length, splitLines(Ctext).length) : null;
  }

  /** changeTexts' result highlighted (an error stays as it is). */
  async tokened(t, cx) {
    if (!t.toTok) return t;
    const { toTok, ...f } = t;
    try { crumb(`tokened: before withTokens ${f.rel}`, "changes"); const r = await this.withTokens(f, cx); crumb(`tokened: after withTokens ${f.rel}`, "changes"); return r; }
    catch (e) { return { rel: f.rel, path: f.path, basePath: null, store: f.store, key: f.key, xy: f.xy, letter: f.letter, plain: false, created: false, by: null, as: null, hunks: [], error: String(e.message ?? e) }; }
  }

  /** D3: line counts of a repo's uncommitted changes against HEAD (staged plus unstaged with no commits yet). */
  async lineCounts(st, head) {
    const runs = head ? [NUMSTAT] : NUMSTAT_NO_HEAD;
    crumb(`lineCounts: before numstat ${st.root}`, "changes");
    const outs = (await Promise.all(runs.map((args) => this.git(st, args)))).map((r) => (r.code === 0 ? r.stdout : ""));
    crumb(`lineCounts: after numstat ${st.root}`, "changes");
    return { map: parseNumstat(...outs), raw: outs.join("\0") };
  }

  /** Which files an agent of this space changed on this branch: `ai` (still in review), `done` (committed). */
  async aiMarks(st) {
    crumb(`aiMarks: before read index.json + branch ${st.root}`, "changes");
    const [text, branch] = await Promise.all([st.read(`${st.dir}/index.json`), st.branch()]);
    crumb(`aiMarks: after read index.json (len=${text?.length ?? null}) + branch=${branch}`, "changes");
    let index = {};
    try { index = text ? JSON.parse(text) : {}; } catch {}
    const mine = (e) => shows(e, branch, this.spaceId, spaceOfAgent), ai = new Set(), done = new Set();
    for (const [rel, e] of Object.entries(index.files ?? {})) if (mine(e)) ai.add(rel);
    for (const [k, e] of Object.entries(index.done ?? {})) if (k.startsWith(`${branch}|`) && mine({ ...e, branch })) done.add(k.slice(branch.length + 1));
    return { ai, done };
  }

  /**
   * Where this branch starts: its merge base with the remote's default branch (else main or master).
   * Looked up again when HEAD moves, and at most every 30 s otherwise (a fetch can move the remote's branch).
   */
  async branchBase(st, head) {
    const cached = (this.bases ??= new Map()).get(idOf(st));
    if (cached?.head === head && Date.now() - cached.at < 30000) return cached.base;
    let base = null;
    for (const ref of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
      crumb(`branchBase: before merge-base HEAD ${ref} in ${st.root}`, "changes");
      const r = await this.git(st, [...READ, "merge-base", "HEAD", ref]);
      crumb(`branchBase: after merge-base HEAD ${ref} code=${r.code}`, "changes");
      if (r.code === 0 && r.stdout.trim() !== head) { base = r.stdout.trim(); break; }
      if (r.code === 0) break; // HEAD is that branch's tip: nothing committed on top of it
    }
    this.bases.set(idOf(st), { head, base, at: Date.now() });
    return base;
  }

  /**
   * "Committed on this branch" for one repo (its base against HEAD), with AI marks. The list (path,
   * letter, line counts: two git calls) is kept per repo, keyed by base and HEAD, and made again only
   * when either moves; a file's texts and diff load when it's first picked (loadRow). At most
   * COMMITTED_REPOS repos' lists are kept.
   */
  async committedRows(st, head, done) {
    crumb(`committedRows: before branchBase ${st.root}`, "changes");
    const base = await this.branchBase(st, head);
    crumb(`committedRows: after branchBase ${st.root} base=${base}`, "changes");
    if (!base) return [];
    const cache = (this.committedCache ??= new Map()), id = idOf(st);
    let entry = cache.get(id);
    if (entry?.base !== base || entry?.head !== head) {
      for (const f of entry?.rows ?? []) this.unloadRow(f);
      crumb(`committedRows: before diff name-status + numstat ${st.root}`, "changes");
      const [r, n] = await Promise.all([this.git(st, [...READ, "diff", "--name-status", "-z", "--no-renames", base, head]),
        this.git(st, [...READ, "diff", "--numstat", "-z", "--no-renames", base, head])]);
      crumb(`committedRows: after diff name-status + numstat ${st.root}`, "changes");
      if (r.code !== 0) return [];
      const counts = parseNumstat(n.code === 0 ? n.stdout : ""), parts = r.stdout.split("\0").filter(Boolean), rows = [];
      for (let i = 0; i + 1 < parts.length && rows.length < MAX_FILES; i += 2) {
        const status = parts[i], rel = parts[i + 1], letter = status[0] === "A" ? "A" : status[0] === "D" ? "D" : "M", k = counts.get(rel);
        // A binary file (git's "-" counts) is never read: it shows its placeholder.
        const placeholder = binaryError(k);
        rows.push({ rel, path: `${st.root}/${rel}`, basePath: null, store: st, key: `${st.root}|${rel}#committed`, openKey: `${st.root}|${rel}`,
          committed: true, letter, ai: false, plain: false, created: letter === "A", by: null, as: null, base, head,
          ...(k && !k.binary ? { add: k.add, del: k.del } : {}), ...LAZY, ...(placeholder ? { lazy: false, placeholder, error: placeholder } : {}) });
      }
      entry = { base, head, rows };
    }
    cache.delete(id); cache.set(id, entry); // newest last
    while (cache.size > COMMITTED_REPOS) { const [k, old] = cache.entries().next().value; cache.delete(k); for (const f of old.rows) this.unloadRow(f); }
    for (const f of entry.rows) f.ai = done.has(f.rel);
    return entry.rows;
  }

  /**
   * A Changes row's texts, diff and highlighting, read when it's picked (P2) or next to the picked
   * one. The row object itself is filled (the list, and for a committed row the per-repo cache,
   * share it). Loaded texts are capped at CHANGES_CHARS in all (capLoaded).
   */
  loadRow(f, cx) {
    if (!f?.lazy || f.loading) return;
    crumb(`loadRow: before spawn ${f.key}`, "changes");
    cx.spawn(async (cx) => {
      await this.loadRowNow(f, cx);
      if (this.gotoLine?.key === f.key) { if (this.sel === f.key) this.toLine(f, this.gotoLine.line); this.gotoLine = null; }
      crumb(`loadRow: before settle+notify ${f.key}`, "changes");
      this.settle(); this.paint(cx);
      crumb(`loadRow: after settle+notify ${f.key}`, "changes");
    });
  }

  /** Makes the hunk at or before `line` of `f` the current one (a hand-off's position). */
  toLine(f, line) {
    if (!f?.hunks?.length) return;
    let h = 0; f.hunks.forEach((x, j) => { if (x.n <= line) h = j; }); this.current = h; this.reveal();
  }

  async loadRowNow(f, cx) {
    if (!f?.lazy || f.loading) return;
    f.loading = true; f.usedAt ??= Date.now();
    crumb(`loadRowNow enter ${f.key} committed=${!!f.committed}`, "changes");
    const st = f.store;
    let next;
    try {
      if (f.committed) {
        // Sizes first: a side over MAX_TEXT is never read (repos hold big binaries and PDFs).
        crumb(`loadRowNow: before blobSize x2 ${f.key}`, "changes");
        const big = sizeError(await Promise.all([st.blobSize(f.base, f.rel), st.blobSize(f.head, f.rel)]), MAX_TEXT);
        crumb(`loadRowNow: after blobSize x2 ${f.key} big=${big}`, "changes");
        if (big) next = { error: big, placeholder: big };
        else {
          crumb(`loadRowNow: before blobAt x2 ${f.key}`, "changes");
          const [b, c] = await Promise.all([st.blobAt(f.base, f.rel), st.blobAt(f.head, f.rel)]);
          crumb(`loadRowNow: after blobAt x2 ${f.key} B=${b?.length ?? null} C=${c?.length ?? null}`, "changes");
          if ((b ?? "").includes("\0") || (c ?? "").includes("\0")) next = { error: "binary file", placeholder: "binary file" };
          else {
            crumb(`loadRowNow: before diffHunks ${f.key}`, "changes");
            const hunks = await diffHunks(b ?? "", c ?? "");
            crumb(`loadRowNow: after diffHunks ${f.key} hunks=${hunks.length}`, "changes");
            next = await this.withTokens({ ...f, Btext: b ?? "", Ctext: c, B: splitLines(b ?? ""), C: splitLines(c ?? ""), hunks }, cx);
            crumb(`loadRowNow: after withTokens ${f.key}`, "changes");
          }
        }
      } else {
        crumb(`loadRowNow: before changeTexts ${f.key}`, "changes");
        const t = await this.changeTexts(st, f.rel, f.xy, f.hasHead), { add, del, ai } = f;
        crumb(`loadRowNow: after changeTexts ${f.key}; before tokened`, "changes");
        next = { ...(await this.tokened(t, cx)), add, del, ai };
        crumb(`loadRowNow: after tokened ${f.key}`, "changes");
      }
    } catch (e) { next = { error: String(e.message ?? e) }; }
    if (!f.lazy) { f.loading = false; return; } // unloaded meanwhile
    Object.assign(f, next, { lazy: false, loading: false, evicted: false });
    crumb(`loadRowNow: before capLoaded ${f.key}`, "changes");
    this.capLoaded(f);
    crumb(`loadRowNow exit ${f.key}`, "changes");
  }

  /** Puts a Changes row back to unloaded (its texts and highlighting go; picked again, they load again). A placeholder stays. */
  unloadRow(f) {
    if (!f || f.lazy || f.placeholder || f.plain || this.dirty(f)) return;
    if (!f.committed && !("xy" in f)) return; // not a Changes row
    Object.assign(f, LAZY, { _rows: null, _rowsFor: null, _find: null, diskC: undefined, diskB: undefined, error: undefined });
  }

  /** The Changes rows whose texts are loaded: uncommitted ones and every kept committed list's. */
  loadedRows() {
    const out = this.files.filter((f) => !f.lazy && f.Ctext !== undefined && !f.placeholder);
    for (const e of this.committedCache?.values() ?? []) for (const f of e.rows) if (!f.lazy && f.Ctext !== undefined && !f.placeholder) out.push(f);
    return out;
  }

  /**
   * One short log line of what this copy holds (every STATS_MS): its kept space views, loaded files
   * and their characters (shown space and kept views), loaded committed rows, highlight cache, captures.
   */
  logStats() {
    const views = [...(this.views?.values() ?? [])], size = (f) => (f.Btext?.length ?? 0) + (typeof f.Ctext === "string" ? f.Ctext.length : 0);
    const files = [this.files, ...views.map((v) => v.files)].flat().filter((f) => !f.lazy && !f.error && f.Ctext !== undefined);
    const committed = [];
    for (const e of this.committedCache?.values() ?? []) for (const f of e.rows) if (!f.lazy && f.Ctext !== undefined && !f.placeholder) committed.push(f);
    const sum = (list) => list.reduce((n, f) => n + size(f), 0);
    log(`stats ${this.view ?? "pane"}: views ${views.length}, files ${files.length}/${sum(files)} chars, committed ${committed.length}/${sum(committed)} chars, tokens ${this.tokens.size}, captures ${this.loop.captures.size}`);
  }

  /** Characters of the Changes rows' loaded texts (both sides). */
  changesChars() { return this.loadedRows().reduce((n, f) => n + (f.Btext?.length ?? 0) + (f.Ctext?.length ?? 0), 0); }

  /**
   * Keeps the loaded texts under CHANGES_CHARS, unloading the least recently picked first and `keep`
   * (the picked row) only when it alone is over: it then shows a placeholder instead of loading again.
   */
  capLoaded(keep) {
    const rows = this.loadedRows(), byKey = new Map(rows.map((f) => [f.key, f]));
    const out = toUnload(rows.map((f) => ({ key: f.key, chars: (f.Btext?.length ?? 0) + (f.Ctext?.length ?? 0), usedAt: f.usedAt })), CHANGES_CHARS, keep?.key ?? null);
    for (const k of out) {
      const f = byKey.get(k);
      this.unloadRow(f);
      if (f === keep) Object.assign(f, { lazy: false, placeholder: "too large to show", error: "too large to show" });
      else f.evicted = true; // not loaded ahead again (neighbours); picking it loads it
    }
  }

  /**
   * Whether this Changes copy is on screen: its block isn't hidden and is the shown child of every
   * stack above it (panelview.viewShown over layout()). Unknown (no such block, or no layout) counts
   * as shown, and so does a copy that has the keyboard.
   */
  changesShown() {
    let shown = null;
    try { shown = viewShown(layout(), "changes"); } catch {}
    return shown !== false || !!this.handle?.is_focused();
  }

  /**
   * Every 2 s (5 s on another machine): reloads when git status or HEAD changed, or a listed file's
   * text did. Nothing at all while the Changes tab isn't shown; the first pass after it shows again
   * catches up. A space with no repos has empty lists.
   */
  async refreshChanges(cx) {
    // One check at a time: WSL git on a Windows drive takes over a second per status.
    if (this.refreshing || this.loadingChanges || this.committing) return;
    if (!this.repos().length) {
      if (this.files.length || this.committed?.length || this.changeSig) { this.files = []; this.committed = []; this.changeSig = null; this.discardKey = null; this.settle(); this.paint(cx); }
      return;
    }
    if (!this.changesShown()) return;
    const remote = this.repos().some((st) => st.on);
    if (remote && Date.now() - (this.changesAt ?? 0) < REMOTE.changesMs) return;
    this.refreshing = true;
    crumb("refreshChanges enter", "changes");
    // What this pass finds is its space's: a pass that outlives a space switch or a change of roots
    // is dropped, and its error lands in its own space's state (D1: never in the space shown by then).
    const space = this.spaceId, stores = this.stores, moved = () => this.spaceId !== space || this.stores !== stores;
    try {
      const sig = [];
      for (const st of this.repos()) { crumb(`refreshChanges: before changeSigOf ${st.root}`, "changes"); sig.push(...(await this.changeSigOf(st)).sig); crumb(`refreshChanges: after changeSigOf ${st.root}`, "changes"); }
      if (moved()) return;
      let stale = sig.join("\0") !== this.changeSig;
      // A file whose texts aren't loaded is covered by the status and line counts; a loaded one's
      // text is read again (another machine's are covered by stampOf's hashes).
      for (const f of this.files) { if (stale) break; if (!f.error && !f.lazy && f.Ctext !== undefined && !f.store?.on && (crumb(`refreshChanges: before readTextFile ${f.path}`, "changes"), (await readTextFile(f.path)) !== f.Ctext)) stale = true; }
      crumb(`refreshChanges: stale=${stale}`, "changes");
      if (moved()) return;
      if (stale) { crumb("refreshChanges: before loadChanges", "changes"); await this.loadChanges(cx); crumb("refreshChanges: after loadChanges", "changes"); }
      else if (loadOk(this)) this.paint(cx);
      if (!moved()) await this.gitx?.tick(cx); // ↑/↓ reread from local refs every 30 s (never a fetch)
    } catch (e) { crumb(`refreshChanges threw ${String(e?.message ?? e).slice(0, 80)}`, "changes"); loadFailed(this, space, String(e.message ?? e)); this.paint(cx); }
    finally { this.refreshing = false; if (remote) this.changesAt = Date.now(); crumb("refreshChanges exit", "changes"); }
  }

  /** Puts a file back as HEAD has it (asked first by the button). Unsaved edits in Edit block it. */
  discard(f, cx) {
    this.discardKey = null;
    if (this.heldElsewhere([f.key]).length) { this.error = `${base(f.rel)} has unsaved edits in Edit: save or discard them there first`; this.paint(cx); return; }
    const space = this.spaceId;
    cx.spawn(async (cx) => {
      const s = () => this.stateOf(space) ?? {}; // its own space's state, shown or not
      try {
        // Asked now, not taken from the row: a row whose texts never loaded doesn't know, and a loaded
        // row's inHead reads a failed `git show` as "not in HEAD" (which would untrack and delete it).
        const inHead = f.hasHead === false ? false : inHeadOf(await this.git(f.store, inHeadArgs(f.rel)), f.rel);
        for (const args of discardCommands(f.rel, inHead)) {
          const r = await this.git(f.store, args);
          if (r.code !== 0) throw new Error(`git ${args[1]}: ${(r.stderr || r.stdout).trim()}`);
        }
        // A file under review: what the discard put back is the user's own edit, so the baseline takes it
        // and Review shows nothing for the file (not the lines put back as the agent's changes).
        const e = (await f.store.index())[f.rel];
        if (e) { const rf = await f.store.load(f.rel, e), w = fileDiscardWrite(rf); if (w) await f.store.apply(rf, w); }
        s().error = null; s().commitNote = `Discarded ${f.rel}`;
      } catch (e) { s().error = String(e.message ?? e); }
      await this.loadChanges(cx);
    });
    this.paint(cx);
  }

  /** The repo the commit box commits to: the one picked, else the first with changes. */
  commitStore() {
    const withChanges = this.repos().filter((st) => this.files.some((f) => f.store === st));
    return withChanges.find((st) => st.root === this.commitRoot) ?? withChanges[0] ?? null;
  }

  checkedIn(st) { return this.files.filter((f) => f.store === st && !this.unchecked.has(f.key)); }

  /** Commits the checked files of the commit repo, only them, with the message. */
  commit(cx) {
    const st = this.commitStore();
    if (!st || this.committing) return;
    const rels = this.checkedIn(st).map((f) => f.rel), spec = st.tempPath("pathspec");
    let cmds;
    try { cmds = commitCommands(rels, this.commitInput.value(), spec); }
    catch (e) { this.error = String(e.message ?? e); this.paint(cx); return; }
    const held = this.heldElsewhere(this.checkedIn(st).map((f) => f.key));
    if (held.length) { this.error = `Unsaved edits in Edit: ${held.map((k) => base(k.slice(k.indexOf("|") + 1))).join(", ")}. Save or discard them first`; this.paint(cx); return; }
    this.committing = true; this.committingIn = this.spaceId; this.error = null; this.commitNote = null; this.paint(cx);
    const space = this.spaceId, s = () => this.stateOf(space) ?? {}; // the note lands in its own space's state
    cx.spawn(async (cx) => {
      try {
        await st.remember(rels).catch(() => {}); // what Review's files are now, so their commit is recognised
        await st.withTemp(spec, pathspecText(rels), async () => {
          for (const args of cmds) {
            const r = await this.git(st, args, { timeout: 120000 });
            if (r.code !== 0) throw new Error(`git ${args[1]}: ${(r.stderr || r.stdout).trim()}`);
          }
        });
        s().commitNote = `Committed ${rels.length} file${rels.length === 1 ? "" : "s"} to ${base(st.root)}`;
        if (this.spaceId === space) this.commitInput.set_value(""); else s().commitMsg = "";
        s().unchecked?.clear();
      } catch (e) { s().error = String(e.message ?? e); }
      finally { this.committing = false; }
      await this.loadChanges(cx); this.paint(cx);
    });
  }

  /** The Changes list's rows (changelist.listRows): uncommitted files, then each repo's committed section. */
  changeRows() { return listRows(this.files, this.committed ?? [], this.committedOpen ?? new Set(), idOf); }

  /** A click in the Changes list: a repo header expands or collapses, a checkbox toggles, else the file is picked. */
  clickChange(key, cx) {
    const r = this.changeRows().find((x) => x.key === key);
    if (!r) return;
    const what = clickTarget(r, this.chgX ?? null);
    if (what === "toggle") {
      const open = (this.committedOpen ??= new Set());
      if (open.has(r.id)) open.delete(r.id); else open.add(r.id);
      this.settle(); this.paint(cx); return;
    }
    const f = r.f;
    if (what === "check") { if (this.unchecked.has(f.key)) this.unchecked.delete(f.key); else this.unchecked.add(f.key); this.paint(cx); return; }
    if (!f.error) { this.pick(f.key, cx); this.chgSide = "content"; } else { this.error = `${f.rel}: ${f.error}`; this.paint(cx); } // narrow (columns.js): the diff in the list's place
  }

  renderChanges(t, cols) {
    const review = shared(REVIEW), st = this.commitStore(), multi = this.repos().length > 1;
    const checked = st ? this.checkedIn(st) : [], open = checked.filter((f) => (review?.[f.key] ?? 0) > 0).length;
    const box = (on) => div().w(14).h(14).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.border).bg(on ? t.accent : t.background)
      .flex().items_center().justify_center().text_size(10).text_color(t.background).child(on ? "✓" : "");
    const letterColor = { A: t.ansi2, D: t.ansi1, "!": t.ansi3, M: t.ansi4 };
    // One list row (inside the virtual list: no handlers or ids here, clicks come through clickChange).
    const row = (r) => {
      if (r.kind === "repo") {
        return h_flex().w_full().h(REPO_H).px(8).pb(4).gap(4).items_end().cursor_pointer().text_size(11).font_semibold().text_color(t.muted)
          .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(r.open ? "▾" : "▸"))
          .child(div().flex_1().min_w(0).truncate().child(`Committed on this branch${multi ? ` · ${base(r.st.root)}` : ""} · ${r.count} file${r.count === 1 ? "" : "s"}${r.ai ? ` · ${r.ai} by AI` : ""}`));
      }
      const f = r.f, cut = f.rel.lastIndexOf("/") + 1, tag = f.committed ? null : reviewTag(f.key, review), on = !this.unchecked.has(f.key);
      return div().w_full().h(FILE_H).px(4).child(h_flex().h_full().px(8).gap(6).items_center().rounded(5).cursor_pointer()
        .when(f.key === this.sel, (e) => e.bg(t.selected))
        .when(!f.committed, (e) => e.child(box(on)))
        .when(!!f.committed, (e) => e.child(div().w(14).flex_none()))
        .child(div().w(12).flex_none().text_size(11).font_semibold().text_color(letterColor[f.letter] ?? t.muted).child(f.letter))
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .child(div().flex_none().text_size(12.5).when(!!f.error, (e) => e.text_color(t.dim)).child(f.rel.slice(cut)))
          .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child((multi ? base(f.store.root) + (cut ? "/" : "") : "") + f.rel.slice(0, Math.max(0, cut - 1)))))
        .when(f.add != null, (e) => e.child(h_flex().flex_none().gap(4).text_size(10)
          .child(div().text_color(t.ansi2).child(`+${f.add}`)).child(div().text_color(t.ansi1).child(`−${f.del}`))))
        .when(!!f.ai, (e) => e.child(div().flex_none().px(4).rounded(3).bg(t.accent + "33").text_size(9.5).text_color(t.accent).child("AI")))
        .when(!!tag, (e) => e.child(div().flex_none().text_size(10).text_color(tag === "reviewed" ? t.dim : t.ansi3).child(tag))));
    };
    const rows = this.changeRows();
    const adds = this.files.reduce((n, f) => n + (f.add ?? 0), 0), dels = this.files.reduce((n, f) => n + (f.del ?? 0), 0);
    const all = this.files.length > 0 && this.files.every((f) => !this.unchecked.has(f.key));
    if (!this.crumbBuilt) { this.crumbBuilt = true; crumb(`renderChanges: built ${rows.length} rows, building tree`, "changes"); }
    const gx = this.gitx, branches = !!gx?.branchOpen();
    this.chgLeftW = cols.leftW; // gitview fits the sync buttons to it
    return v_flex().h_full().when(cols.single, (e) => e.flex_1().min_w(0)).when(!cols.single, (e) => e.w(cols.leftW).flex_none().border_r(1).border_color(t.border))
      .children(gx ? gx.syncRows(t, multi) : []) // G6: branch, upstream, ↑/↓, Fetch, Pull, Push per repo
      .when(branches, (e) => e.child(gx.branchPanel(t)))
      .when(!branches, (e) => e.child(h_flex().h(36).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().id("chk-all").cursor_pointer().on_click((_e, cx) => { if (all) for (const f of this.files) this.unchecked.add(f.key); else this.unchecked.clear(); this.paint(cx); }).child(box(all)))
        .child(div().flex_1().text_size(12).text_color(t.muted).child(`${this.files.length} changed file${this.files.length === 1 ? "" : "s"}`))
        .when(adds + dels > 0, (e) => e.child(h_flex().flex_none().gap(4).text_size(11)
          .child(div().text_color(t.ansi2).child(`+${adds}`)).child(div().text_color(t.ansi1).child(`−${dels}`)))))
      // A virtual list (rows of known heights): its rows can't hold handlers, so the pointer's x is
      // kept from the area around it and a click (clickChange) tells the checkbox from the row by it.
      .child(div().id("chg-list").flex_1().min_h(0).pt(4).relative().overflow_hidden()
        .on_size_change((size, cx) => { if (!this.crumbSized) { this.crumbSized = true; crumb(`on_size_change: first Changes list size ${size.width}x${size.height}`, "changes"); } if (Math.abs((this.chgH ?? 0) - size.height) > 0.5) { this.chgH = size.height; this.paint(cx); } })
        .on_mouse_move((ev) => { this.chgX = ev.local_position ? this.px(ev.local_position.x) : null; })
        .on_mouse_down("left", (ev) => { this.chgX = ev.local_position ? this.px(ev.local_position.x) : null; })
        .when(rows.length > 0, (e) => e
          .child(v_virtual_list("chg-rows", rows.length, rowSizes(rows), (i) => rows[i].key, (range) => { if (!this.crumbRange) { this.crumbRange = true; crumb(`virtual list: first range ${range.start}-${range.end} of ${rows.length}`, "changes"); } return rows.slice(range.start, range.end).map(row); })
            .w_full().h(Math.max(FILE_H, (this.chgH ?? 300) - 4)).track_scroll(this.chgScroll)
            .on_item_click((key, cx) => this.clickChange(key, cx)))
          .child(Scrollbar.vertical("chg-rows").viewport_from_layout().absolute().inset_0()))))
      .child(v_flex().flex_none().p(8).gap(6).border_t(1).border_color(t.border)
        .when(multi && !!st, (e) => e.child(h_flex().gap(4).flex_wrap().children(this.repos().filter((s) => this.files.some((f) => f.store === s)).map((s) =>
          div().id(`repo-${s.root}`).h(22).px(8).flex().items_center().rounded(5).text_size(11).cursor_pointer()
            .bg(s === st ? t.accent + "77" : t.raised).on_click((_e, cx) => { this.commitRoot = s.root; this.paint(cx); }).child(base(s.root))))))
        .when(!!gx, (e) => e.child(gx.genRow(t))) // G6: Generate commit message
        .child(Textarea.new(this.commitInput).h(72).px(8).py(6).rounded(6).border_1().border_color(t.border).bg(t.background).text_size(12))
        .when(open > 0, (e) => e.child(div().text_size(11).text_color(t.ansi3).child(`${open} checked file${open === 1 ? " has" : "s have"} changes still to review`)))
        .when(!!this.commitNote, (e) => e.child(div().text_size(11).text_color(t.dim).child(this.commitNote)))
        .child(this.button("commit", this.committing && this.committingIn === this.spaceId ? "Committing…" : `Commit ${checked.length} file${checked.length === 1 ? "" : "s"}${multi && st ? ` to ${base(st.root)}` : ""}`, checked.length && !this.committing ? t.accent + "88" : t.raised, (cx) => this.commit(cx)).h(28).justify_center()));
  }

  /** ctrl-b: shows or hides the tree, switching to the Edit view first if needed. */
  toggleTree(cx) {
    if (this.mode !== "edit") { this.treeOn = true; return this.setMode("edit", cx); }
    // Too narrow for both (columns.js): the column shows in the editor's place, and ctrl-b swaps them.
    if (this.editCols(true).single) {
      if (!this.treeOn) { this.treeOn = true; this.narrowLeft = true; } else this.narrowLeft = !this.narrowLeft;
      if (this.narrowLeft) this.refreshTrees(cx);
      return this.paint(cx);
    }
    this.treeOn = !this.treeOn;
    if (this.treeOn) this.refreshTrees(cx);
    this.paint(cx);
  }

  // ---- D1: the Explorer tree ------------------------------------------------------
  // One lazy tree per root (filetree.js). A repo's folders come from its file list and one
  // `git status` (ignored paths), never from disk, except inside an ignored folder. A plain root
  // is listed from disk a folder at a time (fsx.listDir: about 1 s per call on a Windows drive).

  /** A root's tree state, kept per copy across spaces (as the open folders were). */
  rootTree(st) {
    const m = (this.ftrees ??= new Map());
    let R = m.get(idOf(st));
    if (!R || R.plain !== !!st.plain) {
      R = { plain: !!st.plain, tree: createTree(), ver: 0, index: null, marks: null, match: null, statOut: null, listedAt: new Map(), listSig: new Map(), errors: new Map(), pending: new Set() };
      m.set(idOf(st), R);
    }
    return R;
  }

  /** Whether a repo folder's entries come from disk: inside an ignored folder, or unknown to git. */
  onDisk(R, rel) { return !!rel && (!!R.match?.(rel) || !R.index?.has(rel)); }

  /** Fills a folder's listing: from the repo's index when it can, else a disk listing (queued). */
  loadFolder(st, R, rel, cx, refresh = false) {
    if (!st.plain) {
      if (!R.index) return; // the index fills it when it arrives
      if (!this.onDisk(R, rel)) { this.fillIndexed(R, rel); return; }
    }
    if (refresh || !R.tree.entries.has(rel)) this.queueList(st, rel, cx);
  }

  /** Disk listings run one at a time, never as a burst of slow calls. */
  queueList(st, rel, cx) {
    const jobs = (this.listJobs ??= []), R = this.rootTree(st);
    if (!R.pending.has(rel)) { R.pending.add(rel); jobs.push({ st, rel }); }
    if (this.listing) return;
    this.listing = true;
    cx.spawn(async (cx) => {
      try {
        while (jobs.length) {
          const { st, rel } = jobs.shift(), R = this.rootTree(st);
          let res, error = null;
          try { res = await listDir(pjoin(st.root, rel), { limit: PER_FOLDER, on: st.on ?? null }); }
          catch (e) { res = { entries: [], more: false }; error = String(e.message ?? e); }
          R.pending.delete(rel); R.listedAt.set(rel, Date.now());
          if (rel && !R.tree.open.has(rel)) continue; // closed meanwhile
          const sig = JSON.stringify([res, error]);
          if (R.listSig.get(rel) === sig && R.tree.entries.has(rel)) continue;
          R.listSig.set(rel, sig);
          if (error) R.errors.set(rel, error); else R.errors.delete(rel);
          setFolder(R.tree, rel, res.entries, res.more); R.ver++;
          this.paint(cx);
        }
      } finally { this.listing = false; }
    });
  }

  toggleDir(st, rel, cx) {
    const R = this.rootTree(st);
    toggle(R.tree, rel); R.ver++;
    // Opening a disk-listed folder lists it again (its old listing shows meanwhile).
    if (R.tree.open.has(rel)) this.loadFolder(st, R, rel, cx, true);
    this.paint(cx);
  }

  /** Opens the folders above a file, loading those that have no listing yet. */
  revealInTree(key, cx) {
    const i = key.indexOf("|"), root = key.slice(0, i), at = this.stores.find((x) => x.root === root);
    if (!at) return;
    const [st, rel] = this.own(at, key.slice(i + 1));
    const R = this.rootTree(st), was = R.tree.open.size, need = reveal(R.tree, rel);
    if (R.tree.open.size !== was) R.ver++;
    for (const d of need) this.loadFolder(st, R, d, cx);
  }

  /** Whether a root's header is collapsed: by the user, or a plain root by default beside a repo. */
  rootShut(st) {
    if (this.repoShut?.has(idOf(st))) return true;
    return !!st.plain && !this.repoOpen?.has(idOf(st)) && this.stores.some((x) => !x.plain);
  }

  /** The plain root's refresh button: lists its loaded folders again, one at a time. */
  refreshPlain(st, cx) {
    const R = this.rootTree(st);
    for (const rel of loaded(R.tree)) this.queueList(st, rel, cx);
    if (!R.tree.entries.has("")) this.queueList(st, "", cx);
  }

  /**
   * Each repo's file list (tracked and untracked, for the tree and Quick Open) and one status call
   * (letters and ignored paths), where the repo lives. A folder index is rebuilt only when either
   * output changed, and the view redraws only then. Plain roots: the root's first listing, then
   * their stalest open folder every 30 s at most, one per pass.
   */
  refreshTrees(cx, force = false) {
    // force: right after a file operation, remote roots too, and again after a pass already running.
    if (force) for (const st of this.stores) { const R = this.rootTree(st); R.passAt = R.listAt = 0; }
    if (this.treeBusy) { if (force) this.treeAgain = true; return; }
    this.treeBusy = true;
    cx.spawn(async (cx) => {
      let changed = false;
      // Outside the Edit view (Quick Open in Review or Changes) only the repos' file lists are
      // needed: no status, folder index or plain root listings, which only the tree shows.
      const edit = this.mode === "edit", at = edit ? "passAt" : "listAt";
      try {
        for (const st of this.stores) {
          const R = this.rootTree(st);
          // A root on another machine: one pass at most every 10 s (a remote call is about 200 ms).
          if (st.on) {
            if (Date.now() - (R[at] ?? 0) < REMOTE.treeMs) continue;
            R[at] = Date.now();
          }
          if (st.plain && !edit) continue;
          if (st.plain) {
            if (this.rootShut(st)) continue;
            if (!R.tree.entries.has("")) { this.queueList(st, "", cx); continue; }
            if (this.listJobs?.length) continue;
            const stale = loaded(R.tree).map((rel) => [rel, R.listedAt.get(rel) ?? 0]).sort((a, b) => a[1] - b[1])[0];
            if (stale && Date.now() - stale[1] > 30000) this.queueList(st, stale[0], cx);
            continue;
          }
          const [r, s] = await Promise.all([this.git(st, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]), edit ? this.git(st, STATUS_TREE) : null]);
          if (r.code !== 0) {
            const error = (r.stderr || r.stdout).trim();
            if (this.trees.get(idOf(st))?.error !== error) { this.trees.set(idOf(st), { error }); changed = true; }
            continue;
          }
          if (this.trees.get(idOf(st))?.list !== r.stdout) {
            const paths = [...new Set(r.stdout.split("\0").filter(Boolean))];
            this.trees.set(idOf(st), { list: r.stdout, paths });
            if (!edit) changed = true;
          }
          if (!edit) continue;
          const out = s.code === 0 ? s.stdout : "";
          if (R.statOut !== out) {
            const { marks, ignored } = parseTreeStatus(out);
            R.statOut = out; R.marks = marks; R.ignored = ignored; R.match = ignoredMatcher(ignored); changed = true;
          }
          const tr = this.trees.get(idOf(st));
          if (R.indexFor === tr && R.indexIgnored === R.ignored) continue;
          R.indexFor = tr; R.indexIgnored = R.ignored; R.index = folderIndex(tr.paths, R.ignored); changed = true;
          for (const m of R.made ?? []) if (R.index.has(m)) R.made.delete(m); // git lists files in it now
          for (const rel of ["", ...R.tree.open]) {
            if (!this.onDisk(R, rel)) this.fillIndexed(R, rel);
            else if (!R.tree.entries.has(rel)) this.queueList(st, rel, cx);
          }
          R.ver++;
        }
      } catch (e) { log(`tree: ${e.message ?? e}`); }
      finally {
        this.treeBusy = false;
        if (changed) { if (this.qo) this.rankQuick(); this.paint(cx); }
        if (this.treeAgain) { this.treeAgain = false; this.refreshTrees(cx, true); }
      }
    });
  }

  /** Change counts and unsaved marks per file and folder of one root (folder keys without a trailing "/"). */
  treeCounts(st) {
    const counts = new Map(), add = (rel, n, dirty) => {
      const c = counts.get(rel) ?? { n: 0, dirty: false };
      c.n += n; c.dirty ||= dirty; counts.set(rel, c);
    };
    for (const f of this.files) if (f.store === st && !f.error) {
      const n = f.hunks.length, d = this.dirty(f);
      if (!n && !d) continue;
      add(f.rel, n, d);
      for (let i = f.rel.lastIndexOf("/"); i > 0; i = f.rel.lastIndexOf("/", i - 1)) add(f.rel.slice(0, i), n, d);
    }
    return counts;
  }

  /** A root's visible rows, rebuilt only when its tree, status or counts changed. */
  rootRows(st, R) {
    const counts = this.treeCounts(st), sig = JSON.stringify([...counts]), c = R.rowsCache;
    if (c && c.ver === R.ver && c.marks === R.marks && c.sig === sig) return c.rows;
    const rows = treeRows(R.tree, { marks: R.marks ?? new Map(), ignored: R.match ?? (() => false), counts });
    R.rowsCache = { ver: R.ver, marks: R.marks, sig, rows };
    return rows;
  }

  /**
   * A root's rows as the tree shows them: rootRows with the space's other roots inside it as links
   * (roots.linkRows), so a nested repo's or folder's files are reached only through its own root (P1).
   */
  treeRowsOf(st, R) {
    const rows = this.rootRows(st, R), nested = nestedIn(this.stores, st), sig = nested.map((n) => `${n.rel}\0${idOf(n.root)}`).join("\n"), c = R.linkCache;
    if (c && c.rows === rows && c.sig === sig && c.nested.every((n, i) => n.root === nested[i].root)) return c.out;
    const out = linkRows(rows, nested, caselessRoot(st));
    R.linkCache = { rows, sig, nested, out };
    return out;
  }

  /** P1: a link row's click, or Enter or Right on it: its root's header, opened, selected and in view. */
  gotoRoot(target, cx) {
    if (this.rootShut(target)) this.toggleRepo(target, cx);
    this.treeCur = this.treeItem(target, "", true); this.treeFocus = true; this.searchFocus = false; this.problemsFocus = false; this.treeDel = null;
    this.treeScrollTo = `${target.root}|`; this.handle.focus(); this.paint(cx);
  }

  renderTree(t, full = false) {
    const multi = this.stores.length > 1, out = [], picked = full ? this.treeSel : this.sel;
    const note = (id, text, color = t.dim, depth = 0) => div().id(id).pl(10 + depth * 12).pr(10).py(4).text_size(11).text_color(color).child(text);
    const letterColor = { A: t.ansi2, M: t.ansi4, D: t.ansi1, U: t.ansi1 };
    if (full && this.error) out.push(note("tree-error", this.error, t.ansi1));
    if (!this.stores.length) out.push(note("tree-none", "No repo in this space yet"));
    let scrollAt = null; // the row a file operation asked to bring into view (treeScrollTo)
    for (const st of this.stores) {
      const R = this.rootTree(st), shut = this.rootShut(st), id = idOf(st);
      const ed = this.treeEdit?.id === id ? this.treeEdit : null, del = this.treeDel?.id === id ? this.treeDel : null;
      const editRows = (depth) => {
        if (this.treeScrollTo === "edit") scrollAt = out.length;
        out.push(h_flex().id(`tree-edit-${id}`).min_h(24).flex_none().pl(8 + depth * 12).pr(8).gap(4).items_center()
          .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
          .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(ed.isDir ? "▸" : ""))
          .child(div().flex_1().min_w(0).child(Input.new(this.treeInput))));
        if (ed.error) out.push(note(`tree-edit-err-${id}`, ed.error, t.ansi1, depth));
        else if (ed.busy) out.push(note(`tree-edit-busy-${id}`, "Working…", t.dim, depth));
      };
      // A plain root always has a header, for its refresh button.
      if (multi || st.plain) {
        const n = st.plain ? 0 : this.files.filter((f) => f.store === st && !f.plain).reduce((k, f) => k + f.hunks.length, 0);
        const here = this.treeFocus && this.treeCur?.id === id && this.treeCur.rel === "";
        if (this.treeScrollTo === `${st.root}|`) scrollAt = out.length;
        out.push(h_flex().id(`tree-repo-${st.root}`).pl(8).pr(6).pt(8).pb(2).gap(4).items_center().text_size(11).cursor_pointer()
          .when(here, (e) => e.bg(t.selected).rounded(3).border_1().border_color(t.accent + "aa"))
          .on_click((_e, cx) => { this.selectTreeRow(st, { rel: "", dir: true }, cx); this.toggleRepo(st, cx); })
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openTreeMenu(st, "", true, cx); })
          .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(shut ? "▸" : "▾"))
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.muted).child(this.repoName(st)))
          .when(n > 0, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi3).child(String(n))))
          .when(!!st.plain && !shut, (e) => e.child(div().id(`tree-repo-r-${st.root}`).flex_none().w(16).h(16).flex().items_center().justify_center().rounded(3).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); this.refreshPlain(st, cx); }).child("⟳")))
          .child(div().id(`tree-repo-x-${st.root}`).flex_none().w(16).h(16).flex().items_center().justify_center().rounded(3).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); this.askRemove(st, cx); }).child("×")));
        if (shut) continue;
      }
      const tr = st.plain ? null : this.trees.get(idOf(st));
      if (tr?.error) { out.push(note(`tree-err-${st.root}`, tr.error, t.ansi1)); continue; }
      if (R.errors.get("")) { out.push(note(`tree-err-${st.root}`, R.errors.get(""), t.ansi1)); continue; }
      if (st.plain ? !R.tree.entries.has("") : !R.index) { out.push(note(`tree-load-${st.root}`, "Loading…")); continue; }
      if (ed && ed.kind !== "rename" && ed.dir === "") editRows(0);
      for (const row of this.treeRowsOf(st, R)) {
        const k = `${st.root}|${row.rel}`;
        if (row.more) { out.push(note(`tree-more-${k}`, "… more files not shown", t.dim, row.depth)); continue; }
        if (ed?.kind === "rename" && row.rel === ed.rel) { editRows(row.depth); continue; }
        const gone = !row.dir && (row.deleted || row.mark === "D"), cur = this.treeFocus && this.treeCur?.id === id && this.treeCur.rel === row.rel;
        if (this.treeScrollTo === k) scrollAt = out.length;
        if (row.link) {
          // Another root of the space inside this one (P1): a link to its own header, never opened here.
          const to = row.link;
          out.push(h_flex().id(`tree-${k}`).h(22).flex_none().pl(8 + row.depth * 12).pr(8).gap(4).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
            .when(cur, (e) => e.bg(t.selected).rounded(3).border_1().border_color(t.accent + "aa"))
            .on_click((_e, cx) => this.gotoRoot(to, cx))
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openTreeMenu(to, "", true, cx); })
            .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child("↗"))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(row.name))
            .child(div().flex_none().text_size(10).text_color(t.dim).child(`→ ${this.repoName(to)}`)));
          continue;
        }
        out.push(h_flex().id(`tree-${k}`).h(22).flex_none().pl(8 + row.depth * 12).pr(8).gap(4).items_center().cursor_pointer()
          .when(!row.dir && k === picked, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .when(cur, (e) => e.bg(t.selected).rounded(3).border_1().border_color(t.accent + "aa"))
          .on_click((_e, cx) => { this.selectTreeRow(st, row, cx); if (row.dir) this.toggleDir(st, row.rel, cx); else cx.spawn(async (cx) => this.openFile(st, row.rel, cx)); })
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openTreeMenu(st, row.rel, row.dir, cx); })
          .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(row.dir ? (row.open ? "▾" : "▸") : ""))
          .child(div().flex_1().min_w(0).truncate().text_size(12)
            .text_color(row.ignored || gone ? t.dim : row.dir ? t.muted : { error: t.ansi1, warning: t.ansi3 }[this.problems.mark(st, row.rel)] ?? t.foreground)
            .when(row.ignored, (e) => e.opacity(0.7)).when(gone, (e) => e.line_through()).child(row.name))
          .when(!!row.dirty, (e) => e.child(div().flex_none().text_size(10).text_color(t.accent).child("●")))
          .when(!!row.n, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi3).child(String(row.n))))
          .when(!!row.mark, (e) => e.child(div().w(10).flex_none().text_size(10).font_semibold().text_color(letterColor[row.mark] ?? t.muted).child(row.mark))));
        if (del && row.rel === del.rel) out.push(this.deleteBox(del, row.depth, t));
        if (ed && ed.kind !== "rename" && row.dir && row.rel === ed.dir) editRows(row.depth + 1);
        if (row.dir && row.open && R.errors.get(row.rel)) out.push(note(`tree-err-${k}`, R.errors.get(row.rel), t.ansi1, row.depth + 1));
        else if (row.dir && row.loading) out.push(note(`tree-load-${k}`, "Loading…", t.dim, row.depth + 1));
      }
    }
    // A request is consumed after layout; a failed one only leaves the tree where it was.
    if (scrollAt != null) { try { this.treeScroll.scroll_to_item(scrollAt); } catch {} this.treeScrollTo = null; }
    out.push(div().id("tree-open-folder").mx(8).mt(6).px(6).h(22).flex().items_center().rounded(4).text_size(11).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.openFolder(cx)).child("+ Add repo…"));
    const panel = this.workspacePanel(t);
    if (panel) out.push(panel);
    // Its width and border come from the left column around it (renderLeft).
    // A right-click on the tree's empty space, with one root: that root's menu (New File… at its top).
    return v_flex().id("file-tree").flex_1().min_h(0).py(4).overflow_y_scrollbar().track_scroll(this.treeScroll)
      .on_mouse_down("right", (_e, cx) => { if (this.stores.length === 1) this.openTreeMenu(this.stores[0], "", true, cx); })
      .children(out);
  }

  // ---- Explorer file operations (fileops.js names and targets, fsx.js file-system calls) --------
  // A right-click on a tree row or root header opens the menu. A click on a row selects it and gives
  // the tree the keyboard (treeFocus), where F2 renames and Delete deletes; a click in the editor, a
  // tab or any input takes the keyboard back, so Delete in a file still deletes text. New File…, New
  // Folder… and Rename… show a name box in the tree (treeEdit), Delete a confirm under the row
  // (treeDel). Afterwards the folders and the repo's file list are read again at once, open folders
  // stay open, tabs of renamed or deleted files follow, and the other copies are told (FILEOP).

  /** A tree item: a row, or a root header (rel ""). `id` names its root across spaces (idOf). */
  treeItem(st, rel, dir) { return { id: idOf(st), rel, dir: !!dir, root: !rel }; }

  /** The root of a tree item, while it's still one of this space's. */
  itemStore(it) { return (it && this.stores.find((s) => idOf(s) === it.id)) ?? null; }

  /** A left click on a row: it's selected, and the tree has the keyboard. Open name boxes and confirms close. */
  selectTreeRow(st, row, cx) {
    this.treeCur = this.treeItem(st, row.rel, row.dir); this.treeFocus = true; this.searchFocus = false; this.problemsFocus = false;
    this.treeDel = null;
    if (this.treeEdit && !this.treeEdit.busy) this.endTreeEdit(cx, false);
    this.handle.focus(); this.paint(cx);
  }

  /** The right-click menu for a row or root header (the popup copy sends its command back: treeMenuCmd). */
  openTreeMenu(st, rel, dir, cx) {
    if (this.treeEdit?.busy) return;
    const it = this.treeItem(st, rel, dir), local = !st.on;
    if (!it.root) this.treeCur = it;
    this.treeFocus = true; this.searchFocus = false; this.problemsFocus = false; this.treeDel = null; this.menuItem = it;
    if (this.treeEdit) this.endTreeEdit(cx, false);
    this.handle.focus();
    setShared(TREE_MENU, { copy: this.id, stamp: Date.now() });
    const items = [
      { cmd: "treeNewFile", label: "New File…", key: "" },
      { cmd: "treeNewFolder", label: "New Folder…", key: "" },
      ...(local ? [{ cmd: "treeReveal", label: onWindows() ? "Reveal in File Explorer" : "Reveal in file manager", key: "" }] : []),
      ...(local && !dir ? [{ cmd: "treeExternal", label: `Open in ${editorName(this.settings.externalEditor)}`, key: "" }] : []),
      { cmd: "treeCopyPath", label: "Copy Path", key: "" },
      { cmd: "treeCopyRel", label: "Copy Relative Path", key: "" },
      ...(it.root ? [{ cmd: "treeRefresh", label: "Refresh", key: "" }]
        : [{ cmd: "treeRename", label: "Rename…", key: this.kl("renameItem") }, { cmd: "treeDelete", label: "Delete", key: this.kl("deleteItem") }]),
    ];
    this.menuAt = Date.now(); // its command comes back to every shown copy: this one acts (claim)
    openOverlay({ mod: "wingman", props: { form: "menu", items }, kind: "popup", at: "pointer", width: 260, height: items.length * 30 + 12 });
    this.paint(cx);
  }

  /** A tree menu command. Every shown copy gets it; only the copy that opened the menu acts. */
  treeMenuCmd(c, cx) {
    const it = this.menuItem;
    if (shared(TREE_MENU)?.copy !== this.id || !it) return;
    this.menuItem = null;
    const st = this.itemStore(it);
    if (!st) return;
    const copied = (text) => cx.write_to_clipboard(text);
    ({
      treeNewFile: () => this.startTreeEdit("newFile", it, cx),
      treeNewFolder: () => this.startTreeEdit("newFolder", it, cx),
      treeRename: () => this.startTreeEdit("rename", it, cx),
      treeDelete: () => this.askTreeDelete(it, cx),
      treeCopyPath: () => copied(copyPaths(st.root, it.rel, windowsRoot(st.root, st.on ?? null)).path),
      treeCopyRel: () => copied(copyPaths(st.root, it.rel, windowsRoot(st.root, st.on ?? null)).relative),
      treeReveal: () => this.revealItem(st, it, cx),
      treeExternal: () => this.externalItem(st, it, cx),
      treeRefresh: () => this.refreshRoot(st, cx),
    })[c]?.();
    this.paint(cx);
  }

  /** Shows the error line (the tree's own in the Neovim layout). */
  treeNote(msg, cx) { this.error = msg; this.paint(cx); }

  /** Files at `rel` or under it with unsaved edits, in this copy or another: why it can't be renamed or deleted, or null. */
  unsavedUnder(st, rel) {
    // By path, not key: a file of another root inside this one (P1) counts too.
    const top = under(st.root, rel), abs = (k) => { const i = k.indexOf("|"); return under(k.slice(0, i), k.slice(i + 1)); };
    const hit = (k) => relUnder(abs(k), top) != null, keys = new Set();
    for (const f of this.files) if (f.store && (f.store.on ?? null) === (st.on ?? null) && hit(f.key) && (this.dirty(f) || f.conflict)) keys.add(f.key);
    const now = Date.now();
    for (const [id, v] of Object.entries(shared(DIRTY) ?? {}))
      if (id !== this.id && now - (v?.at ?? 0) <= DIRTY_FRESH) for (const k of v.keys ?? []) if (hit(k)) keys.add(k);
    if (!keys.size) return null;
    const names = [...keys].map((k) => relUnder(abs(k), st.root) ?? k.slice(k.indexOf("|") + 1));
    return `Unsaved edits in ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}: save or discard them first`;
  }

  /** Why `rel` of `st` can't be renamed or deleted from this tree: it is another root of the space, or holds one (P1). */
  holdsRootNote(st, rel) {
    return holdsRoot(this.stores, st, rel) ? `${nameOf(rel)} is a root of this space, or holds one: rename or delete it outside Wingman, or remove that root from the space first (× on its header)` : null;
  }

  /** Opens a root and a folder in it (and the folders above), so a name box inside it shows. */
  openTreeFolder(st, dir, cx) {
    if (this.rootShut(st)) this.toggleRepo(st, cx);
    if (!dir) return;
    const R = this.rootTree(st), need = reveal(R.tree, `${dir}/x`);
    R.ver++;
    for (const d of need) this.loadFolder(st, R, d, cx);
  }

  /** New File…, New Folder… (in the item's folder, or beside a file) or Rename… of the item: the name box. */
  startTreeEdit(kind, it, cx) {
    const st = this.itemStore(it);
    if (!st || this.treeEdit?.busy || this.mode !== "edit") return;
    this.treeDel = null;
    if (kind === "rename") {
      const why = checkRel(it.rel) ?? this.holdsRootNote(st, it.rel) ?? this.unsavedUnder(st, it.rel);
      if (why) return this.treeNote(why, cx);
    } else this.openTreeFolder(st, it.dir ? it.rel : parentOf(it.rel), cx);
    const name = kind === "rename" ? nameOf(it.rel) : "", isDir = kind === "newFolder" || (kind === "rename" && it.dir);
    this.treeEdit = { kind, id: it.id, dir: kind === "rename" ? null : it.dir ? it.rel : parentOf(it.rel), rel: kind === "rename" ? it.rel : null,
      isDir, name, sel: kind === "rename" ? stemEnd(name, it.dir) : 0, error: null, busy: false };
    this.treeCur = kind === "rename" ? it : this.treeCur;
    this.treeFocus = true; this.treeScrollTo = "edit"; this.error = null;
    this.treeInput.set_value(name);
    this.focusTreeInput(true);
    this.paint(cx);
  }

  /** Puts the keyboard in the name box; `select`: Rename's name before its extension is selected (while untouched). */
  focusTreeInput(select = false) {
    const e = this.treeEdit;
    if (!e) return;
    this.treeInput.focus();
    if (select && e.sel && this.treeInput.value() === e.name) this.treeInput.set_selected_range({ start: 0, end: e.sel });
  }

  /** Closes the name box; the tree keeps the keyboard unless `keep` is false. */
  endTreeEdit(cx, keep = true) {
    this.treeEdit = null;
    if (this.inBar === this.treeInput) this.inBar = null;
    if (keep) { this.treeFocus = true; this.handle.focus(); }
    this.paint(cx);
  }

  /** Enter in the name box: checks the name (shown under the box, which stays), then creates or renames. */
  commitTreeEdit(cx) {
    const e = this.treeEdit, st = this.itemStore(e);
    if (!e || e.busy) return;
    if (!st) return this.endTreeEdit(cx);
    const name = this.treeInput.value(), windows = windowsRoot(st.root, st.on ?? null), on = st.on ?? null;
    let t;
    if (e.kind === "rename") {
      t = renameTarget({ root: st.root, rel: e.rel, name, isDir: e.isDir, windows });
      if (!t.error && t.same) return this.endTreeEdit(cx);
      if (!t.error) { const why = this.unsavedUnder(st, e.rel); if (why) t = { error: why }; }
    } else t = newTarget({ root: st.root, dir: e.dir, name, kind: e.kind === "newFolder" ? "dir" : "file", windows });
    if (t.error) { e.error = t.error; this.paint(cx); return; }
    e.busy = true; e.error = null; this.paint(cx);
    cx.spawn(async (cx) => {
      try {
        if (e.kind === "newFile") await createFile(t.path, st.root, { on });
        else if (e.kind === "newFolder") await createDir(t.path, st.root, { on });
        else await movePath(t.fromPath, t.path, st.root, { on });
      } catch (err) {
        e.busy = false; e.error = String(err.message ?? err);
        if (this.treeEdit === e) this.treeInput.focus();
        this.paint(cx); return;
      }
      if (this.treeEdit === e) this.endTreeEdit(cx);
      this.treeCur = this.treeItem(st, t.rel, e.isDir);
      if (e.kind === "rename") {
        const made = [];
        for (let p = parentOf(t.rel); p && !within(parentOf(e.rel), p) ; p = parentOf(p)) made.unshift(p);
        this.afterFileOp(st, { from: e.rel, to: t.rel, isDir: e.isDir, made: e.isDir ? [...made, t.rel] : made }, cx);
      } else this.afterFileOp(st, { added: t.rel, isDir: e.kind === "newFolder", made: t.made }, cx);
      // A new file opens with the cursor in it, as VS Code does: the editor has the keyboard.
      if (e.kind === "newFile") {
        await this.openFile(st, t.rel, cx, { line: 0, col: 0 });
        const [o, rel] = this.own(st, t.rel);
        if (this.sel === `${o.root}|${rel}`) this.treeFocus = false;
      }
      this.paint(cx);
    });
  }

  /** Delete (menu or key): the confirm under the row, naming the item and, for a folder, its file count when the repo's file list knows it. */
  askTreeDelete(it, cx) {
    const st = this.itemStore(it);
    if (!st || this.treeEdit?.busy || this.mode !== "edit") return;
    const why = checkRel(it.rel) ?? this.holdsRootNote(st, it.rel) ?? this.unsavedUnder(st, it.rel);
    if (why) return this.treeNote(why, cx);
    let count = null;
    if (it.dir && !st.plain) {
      const R = this.rootTree(st), tr = this.trees.get(idOf(st)), p = `${it.rel}/`;
      // Ignored files aren't in the list: a folder holding any says "everything in it".
      const hidden = !R.index?.has(it.rel) || R.match?.(it.rel) || (R.ignored ?? []).some((x) => x.startsWith(p));
      if (tr?.paths && !hidden) count = countUnder(tr.paths, it.rel) - [...(R.marks ?? [])].filter(([x, l]) => l === "D" && x.startsWith(p)).length;
    }
    if (this.treeEdit) this.endTreeEdit(cx, false);
    this.treeDel = { ...it, count, busy: false, error: null };
    this.treeCur = it; this.treeFocus = true; this.treeScrollTo = `${st.root}|${it.rel}`; this.error = null;
    this.handle.focus(); this.paint(cx);
  }

  /** The delete confirm, under the row it names. */
  deleteBox(d, depth, t) {
    return v_flex().id("tree-del").ml(8 + depth * 12).mr(8).my(4).p(8).gap(6).rounded(6).bg(t.raised).text_size(11)
      .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
      .child(div().text_color(t.foreground).child(deleteQuestion({ rel: d.rel, isDir: d.dir, count: d.count })))
      .when(!!d.error, (e) => e.child(div().text_color(t.ansi1).child(d.error)))
      .child(h_flex().gap(6)
        .child(this.button("tree-del-yes", d.busy ? "Deleting…" : "Delete", t.ansi1 + "88", (cx) => this.confirmTreeDelete(cx)))
        .child(this.button("tree-del-no", "Cancel", t.background, (cx) => { this.treeDel = null; this.paint(cx); })));
  }

  /** The confirm's Delete (or Enter): deletes permanently, then the tree and tabs follow. */
  confirmTreeDelete(cx) {
    const d = this.treeDel, st = this.itemStore(d);
    if (!st || d.busy) return;
    const why = this.unsavedUnder(st, d.rel); // edits made since the confirm opened
    if (why) { d.error = why; this.paint(cx); return; }
    d.busy = true; d.error = null; this.paint(cx);
    const path = under(st.root, d.rel), on = st.on ?? null;
    cx.spawn(async (cx) => {
      try { if (d.dir) await deleteTree(path, st.root, { on }); else await deleteFile(path, st.root, { on }); }
      catch (e) { if (e.code !== "missing") { d.busy = false; d.error = String(e.message ?? e); this.paint(cx); return; } }
      if (this.treeDel === d) this.treeDel = null;
      this.treeCur = null;
      this.afterFileOp(st, { removed: d.rel, isDir: d.dir }, cx);
      this.paint(cx);
    });
  }

  /**
   * P9: keys while the tree has the keyboard, as in VS Code's Explorer. Up/Down move the selected row,
   * Right opens a folder or moves into it, Left closes it or moves to the folder above, Home/End
   * jump (j / k, h / l and g / G as well), Enter opens a file (the editor takes the keyboard) or opens and closes a folder, Space
   * opens a file keeping the keyboard here, F2 renames, Delete asks to delete, Escape gives the
   * keyboard back to the editor. Pane shortcuts that don't change the file work (allowedIn "tree");
   * nothing else reaches the file. True: handled.
   */
  treeKey(e, cx) {
    const k = e.keystroke;
    if (!(this.mode === "edit" && (this.treeOn || this.treeOnly()) && this.search.left === "explorer")) { this.treeFocus = false; return false; }
    if (!keystrokeOf(e)) return false; // a modifier alone
    if (k === "enter" && this.treeDel) { this.confirmTreeDelete(cx); return true; }
    if (k === "escape") { if (this.treeDel) this.treeDel = null; else this.treeFocus = false; this.paint(cx); return true; }
    const id = this.kIdx.tree.get(k) ?? this.kIdx.pane.get(k);
    if (id) { this.act(id, cx); return true; }
    const vim = { j: "down", k: "up", h: "left", l: "right", g: "home", "shift-g": "end" }[k];
    if (vim || ["up", "down", "left", "right", "home", "end"].includes(k)) { this.treeMove(vim ?? k, cx); return true; }
    if (k === "enter" || k === "space") { this.treeActivate(k === "enter", cx); return true; }
    return true; // typing, Backspace, editing keys: nothing reaches the file while the tree has the keyboard
  }

  /** The Explorer's visible rows across roots, in order, for the keyboard: root headers (depth -1) and rows. */
  navItems() {
    const out = [], multi = this.stores.length > 1;
    for (const st of this.stores) {
      const R = this.rootTree(st), shut = this.rootShut(st);
      if (multi || st.plain) out.push({ st, rel: "", depth: -1, dir: true, open: !shut, root: true });
      if (shut) continue;
      const tr = st.plain ? null : this.trees.get(idOf(st));
      if (tr?.error || R.errors.get("") || (st.plain ? !R.tree.entries.has("") : !R.index)) continue;
      for (const row of this.treeRowsOf(st, R)) if (!row.more) out.push({ st, rel: row.rel, depth: row.depth, dir: row.dir, open: !!row.open, link: row.link ?? null });
    }
    return out;
  }

  /** The selected row's index in navItems, or -1. */
  navIndex(items) {
    const c = this.treeCur;
    return c ? items.findIndex((it) => idOf(it.st) === c.id && it.rel === c.rel) : -1;
  }

  /** Up, Down, Left, Right, Home, End in the tree (filetree.navMove). */
  treeMove(k, cx) {
    const items = this.navItems(), { at, toggle } = navMove(items, this.navIndex(items), k), it = items[at];
    if (!it) return;
    this.treeDel = null;
    if (toggle && it.link) return this.gotoRoot(it.link, cx);
    if (toggle) { if (it.root) this.toggleRepo(it.st, cx); else this.toggleDir(it.st, it.rel, cx); }
    this.treeCur = this.treeItem(it.st, it.rel, it.dir); this.treeScrollTo = `${it.st.root}|${it.rel}`;
    this.paint(cx);
  }

  /** Enter or Space on the selected row: a file opens (Enter: the editor takes the keyboard), a folder or root opens or closes, a link goes to its root. */
  treeActivate(enter, cx) {
    const items = this.navItems(), it = items[this.navIndex(items)];
    if (!it) return;
    this.treeDel = null;
    if (it.link) return this.gotoRoot(it.link, cx);
    if (it.root) { this.toggleRepo(it.st, cx); return; }
    if (it.dir) { this.toggleDir(it.st, it.rel, cx); return; }
    const [o, rel] = this.own(it.st, it.rel), key = `${o.root}|${rel}`;
    const at = enter && !(this.sel === key && this.cur) ? { line: 0, col: 0 } : null; // Enter puts the cursor in the file
    if (enter) this.treeFocus = false;
    cx.spawn(async (cx) => { await this.openFile(it.st, it.rel, cx, at); this.paint(cx); });
  }

  /** Reveal in File Explorer / Finder / the file manager (this computer's roots only). */
  revealItem(st, it, cx) {
    if (st.on) return;
    const space = this.spaceId;
    cx.spawn(async (cx) => {
      try { await revealPath(under(st.root, it.rel), it.dir); }
      catch (e) { failIn(this, space, String(e.message ?? e)); this.paint(cx); }
    });
  }

  /** Open in the external editor from the tree (this computer's files); unsaved edits are saved first. */
  externalItem(st, it, cx) {
    if (st.on || it.dir) return;
    const [o, rel] = this.own(st, it.rel), f = this.files.find((x) => x.key === `${o.root}|${rel}`);
    if (f && this.dirty(f) && !f.conflict) this.save(cx, f);
    const space = this.spaceId;
    cx.spawn(async (cx) => {
      try { await openInEditor(this.settings.externalEditor, under(st.root, it.rel), 0, 0, this.settings.externalCommand); }
      catch (e) { failIn(this, space, String(e.message ?? e)); this.paint(cx); }
    });
  }

  /** A root header's Refresh: its file list and status, and every folder listed from disk, again now. */
  refreshRoot(st, cx) {
    if (st.plain) return this.refreshPlain(st, cx);
    const R = this.rootTree(st);
    for (const rel of loaded(R.tree)) if (this.onDisk(R, rel)) this.queueList(st, rel, cx);
    this.refreshTrees(cx, true);
  }

  /** A repo folder's listing from git's file list, plus folders made here that git can't list yet (empty ones). */
  fillIndexed(R, rel) {
    let list = R.index?.get(rel) ?? [];
    if (R.made?.size) {
      const have = new Set(list.map((e) => e.name)), extra = [];
      for (const m of R.made) if (parentOf(m) === rel && m !== rel && !have.has(nameOf(m))) extra.push({ name: nameOf(m), dir: true });
      if (extra.length) list = [...list, ...extra];
    }
    setFolder(R.tree, rel, list); R.ver++;
  }

  /** After this copy's file operation: here (applyFileOp), then the other copies (FILEOP). */
  afterFileOp(st, op, cx) {
    const full = { ...op, root: st.root, on: st.on ?? null };
    this.applyFileOp(full, cx, true);
    setShared(FILEOP, { ...full, copy: this.id, stamp: Date.now() });
  }

  /**
   * What a file operation means for this copy. op: { root, on, added | removed | from+to, isDir, made }.
   * The tree: open folders follow a renamed folder, a deleted one's listings go, the affected folders
   * and the repo's file list are read again now, and (mine) the new or renamed item is revealed.
   * Tabs: an opened file that was renamed reopens at its new path, one that was deleted closes, and
   * undo steps for them are dropped. A file under review is left to Review, as git sees it: the old
   * path deleted, the new one added.
   */
  applyFileOp(op, cx, mine) {
    const st = this.stores.find((s) => s.root === op.root && (s.on ?? null) === (op.on ?? null));
    if (!st) return;
    const gone = op.removed ?? op.from ?? null, to = op.to ?? null, now = op.added ?? to;
    this.treeAfterOp(st, { gone, to, now, made: op.made ?? [] }, cx);
    // Made inside another root of the space (a plain folder's New File… "app/x.ts" into the repo app,
    // or a rename into it): that root's tree reads the folders that changed too (P1).
    if (now != null) {
      const [o, rel] = this.own(st, now);
      if (o !== st) this.treeAfterOp(o, { gone: null, to: null, now: rel, made: (op.made ?? []).map((m) => this.own(st, m)).filter(([x]) => x === o).map(([, r]) => r) }, cx);
    }
    if (this.mode === "edit") this.refreshTrees(cx, true);
    if (mine && now != null) { const [o, rel] = this.own(st, now), k = `${o.root}|${rel}`; this.revealInTree(k, cx); this.treeScrollTo = k; }
    if (gone != null) this.followTabs(st, gone, to, cx);
    this.paint(cx);
  }

  /**
   * One root's tree after a file operation: open folders follow a renamed folder, a deleted one's
   * listings go, and the folders that changed are read again (filetree.relistAfter: their parents,
   * and a renamed open folder and its open subfolders, which have no listing at their new path): from
   * disk in a plain folder or a folder git doesn't list, else refilled from the repo's file list.
   */
  treeAfterOp(st, { gone, to, now, made }, cx) {
    const R = this.rootTree(st);
    const follow = (set) => { for (const k of [...set]) if (within(k, gone)) { set.delete(k); const n = to != null ? remap(k, gone, to) : null; if (n) set.add(n); } };
    if (gone != null) {
      follow(R.tree.open);
      for (const k of [...R.tree.entries.keys()]) if (k && within(k, gone)) R.tree.entries.delete(k);
      if (R.made) follow(R.made);
      R.ver++;
    }
    if (!st.plain && made?.length) { R.made ??= new Set(); for (const m of made) R.made.add(m); }
    for (const d of relistAfter(R.tree, { gone, now, made })) {
      if (st.plain || this.onDisk(R, d)) this.queueList(st, d, cx);
      else if (R.index) this.fillIndexed(R, d);
    }
  }

  /** Tabs after `gone` (a file or folder) was deleted, or renamed to `to`. */
  followTabs(st, gone, to, cx) {
    const rid = `${idOf(st)}|`;
    this.recent = (this.recent ?? []).filter((k) => !(k.startsWith(rid) && within(k.slice(rid.length), gone)));
    const hit = this.files.filter((f) => f.store === st && within(f.rel, gone));
    if (!hit.length) return;
    const keys = new Set(hit.map((f) => f.key)), plain = hit.filter((f) => f.plain), reopen = [];
    for (const f of hit) if (to != null && (this.opened.includes(f.key) || this.sel === f.key)) reopen.push({ rel: remap(f.rel, gone, to), sel: this.sel === f.key });
    this.files = this.files.filter((f) => !plain.includes(f));
    this.opened = this.opened.filter((k) => !plain.some((f) => f.key === k));
    const touches = (h) => (h.key && keys.has(h.key)) || h.snaps?.some((s) => keys.has(s.key));
    this.history = this.history.filter((h) => !touches(h)); this.redo = this.redo.filter((h) => !touches(h));
    if (keys.has(this.sel)) { this.cur = this.anchor = null; this.hx = 0; this.selA = this.selB = null; }
    // Review's files reread from disk: a deleted or renamed file under review shows as deleted there.
    if (hit.some((f) => !f.plain)) { this.deferred.add("*"); if (!this.writing) cx.spawn(async (cx) => this.drain(cx)); }
    this.error = null; this.settle();
    if (this.mode !== "edit" || !reopen.length) return;
    cx.spawn(async (cx) => {
      for (const r of reopen) {
        // Renamed into another root of the space (P1): it reopens as that root's file.
        const [o, rel] = this.own(st, r.rel), key = `${o.root}|${rel}`;
        if (!this.files.some((f) => f.key === key)) { const g = await this.loadPlain(o, rel, cx); if (!this.files.some((f) => f.key === key)) this.files.push(g); }
        if (!this.opened.includes(key)) this.opened.push(key);
        if (r.sel) this.pick(key, cx);
      }
      this.settle(); this.paint(cx);
    });
  }

  // ---- scrolling -------------------------------------------------------------
  // The pane scrolls the list itself, in whole rows, so it always knows which row is at
  // the top: the list reports no scroll position, and its rows can't take mouse handlers,
  // so this is what lets a pointer position map to a row (clicks, drags, the menu).

  viewRows() { return Math.max(1, Math.floor(this.vh() / ROW)); }

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
    const dx = ev.delta_lines ? ev.delta_lines.x * 3 * this.cw() : this.px(ev.delta.x);
    const sideways = ev.modifiers?.shift ? (ev.delta_lines ? ev.delta_lines.y * 3 * this.cw() : this.px(ev.delta.y)) : dx;
    if (ev.modifiers?.shift || Math.abs(dx) > Math.abs(ev.delta_lines?.y ?? this.px(ev.delta.y))) {
      if (this.wrapCols()) return; // wrapped lines don't scroll sideways
      this.hx = Math.max(0, this.hx - sideways); this.paint(cx); cx.stop_propagation(); return;
    }
    const lines = ev.delta_lines?.y ?? this.px(ev.delta.y) / ROW;
    this.wheelAcc = (this.wheelAcc ?? 0) - lines;
    const step = Math.trunc(this.wheelAcc);
    if (!step) return;
    this.wheelAcc -= step;
    this.scrollTo((this.top ?? 0) + step);
    if (this.dragging && this.dragY != null) this.dragTo(this.dragY);
    this.paint(cx);
    cx.stop_propagation();
  }

  // ---- pointer: click, Shift+click, drag, right-click ------------------------

  pointerDown(ev, cx) {
    this.handle.focus(); this.searchFocus = false; this.problemsFocus = false; this.treeFocus = false;
    // A click in the editor closes the tree's name box or delete confirm (nothing is done).
    if (this.treeEdit && !this.treeEdit.busy) this.treeEdit = null;
    if (this.treeDel && !this.treeDel.busy) this.treeDel = null;
    const f = this.file(), { x, y } = this.at(ev), i = this.rowAt(y);
    if (!f || i < 0) return;
    const r = this.rowsOf(f)[i];
    if (r.kind === "@") return this.mode === "changes" ? this.gitx?.hunkClick(r.hunk, x, GUTTER, BTN_GAP, cx) : this.rowButton(r.hunk, x, cx);
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
    ({ x: this.dragX, y: this.dragY } = this.at(ev));
    if (this.dragY < ROW) this.scrollTo((this.top ?? 0) - 1);
    else if (this.dragY > this.vh() - ROW) this.scrollTo((this.top ?? 0) + 1);
    this.dragTo(this.dragY);
    this.paint(cx);
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
    // The widths the row was drawn with (hunkButtons): narrower without keys in a narrow diff.
    const { w, shown } = this.hunkBtns(), at = (k) => k < shown && x >= GUTTER + (k + 1) * BTN_GAP + k * w && x < GUTTER + (k + 1) * (BTN_GAP + w);
    if (at(0)) this.hunk("reject", i, cx);
    else if (at(1)) this.hunk("accept", i, cx);
    else if (at(2)) this.askPrompt(i, cx);
    else if (at(3)) this.commentHunk(i, cx);
    else { this.current = i; this.paint(cx); }
  }

  step(by, cx) {
    const f = this.file();
    if (!f) return;
    if (!f.hunks.length) return;
    this.current = (this.current + by + f.hunks.length) % f.hunks.length;
    if (this.cur) { const h = f.hunks[this.current]; this.cur = this.clampPos(f, { line: h.n, col: 0 }); this.anchor = null; }
    this.reveal(); this.paint(cx);
  }

  stepFile(by, cx) {
    const vis = this.visible().filter((f) => !f.error);
    if (!vis.length) return;
    const at = vis.findIndex((f) => f.key === this.sel), key = vis[(at + by + vis.length) % vis.length].key;
    this.pick(key, cx);
    // Changes: the list follows the keyboard.
    if (this.mode === "changes") { const i = this.changeRows().findIndex((r) => r.key === key); if (i >= 0) this.chgScroll.scroll_to_item(i); }
  }

  pick(key, cx) {
    if (!this.visible().some((f) => f.key === key)) return;
    this.restoreSel = null;
    if (this.mode === "edit") this.revealInTree(key, cx);
    if (key !== this.sel) {
      const old = this.file();
      if (old && this.settings.autosave && this.dirty(old) && !old.conflict) this.save(cx, old);
      this.cur = this.anchor = null; this.hx = 0;
    }
    this.sel = key; this.current = 0; this.top = 0; this.showTab(key); this.handle.focus(); this.searchFocus = false; this.problemsFocus = false; this.reveal(); this.paint(cx);
    if (this.mode === "changes") { const f = this.file(); if (f) f.usedAt = Date.now(); this.loadRow(f, cx); } // a row's texts load when it's picked
  }

  // ---- actions -------------------------------------------------------------

  /**
   * Applies model actions to files at once and queues their disk writes.
   * `plan` is a list of [file, action] where action(state) -> { state, write }.
   */
  run(plan, cx, feedback = []) {
    if (!plan.length || this.mode === "changes") return;
    if (plan.some(([f]) => f.conflict)) { this.error = "Pick Keep mine or Take agent's first"; this.paint(cx); return; }
    // Panel split: another copy (Edit) holds unsaved edits to these files. Review acts on what's
    // on disk, so they're saved first (autosave on) or left to the user (off).
    const held = this.heldElsewhere(plan.map(([f]) => f.key));
    if (held.length) {
      const names = held.map((k) => base(k.slice(k.indexOf("|") + 1))).join(", ");
      if (this.settings.autosave) {
        setShared(SAVE, { keys: held, stamp: Date.now() });
        const paths = new Set(plan.filter(([f]) => held.includes(f.key)).map(([f]) => norm(f.path ?? "")));
        cx.timer.after(800, (cx) => this.onWatch(paths, cx));
        this.error = `Saving your edits to ${names} in Edit first: try again in a moment`;
      } else this.error = `${names} has unsaved edits in Edit: save or discard them there first`;
      this.paint(cx); return;
    }
    const entry = { snaps: [], writes: [], feedback }, jobs = [], notes = [];
    for (const [f, action] of plan) {
      // Unsaved edits are saved first: the action's write expects memory and disk to agree.
      const saves = this.saveWrites(f), { state, write } = action(f), writes = [...saves, write];
      notes.push(...saves.map((w) => this.editNote(f, w)).filter(Boolean));
      Object.assign(state, { diskC: f.Ctext, diskB: f.Btext, conflict: null });
      state[write.target === "baseline" ? "diskB" : "diskC"] = write.after;
      entry.snaps.push(bare(f));
      this.files[this.files.indexOf(f)] = state;
      jobs.push([state, writes]);
    }
    this.history.push(entry); this.redo = []; capSteps(this.history);
    this.error = null; this.settle(); this.reveal(); this.paint(cx);
    this.enqueue(async () => {
      for (const [f, ws] of jobs) for (const w of ws) entry.writes.push(await f.store.apply(f, w));
      for (const m of feedback) await this.noteToClaude(m, () => queueFeedback(m.terminal, m.text, { on: m.on }));
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
    this.sel = entry.snaps[0].key; this.error = null; this.settle(); this.reveal(); this.paint(cx);
    this.commitNote = noteAfterUndo(this.commitNote, entry.note); // Changes: a discard undone takes its note with it
    this.enqueue(async () => {
      await entry.snaps[0].store.undo(entry.writes);
      for (const m of entry.feedback) await this.noteToClaude(m, () => withdrawFeedback(m.terminal, m.text, { on: m.on }));
    }, cx);
    if (this.mode === "changes") {
      // A discard that emptied a file took it off the list: it is back once the writes are, and it is the one selected then.
      const space = this.spaceId, key = entry.snaps[0].key, queued = this.queue;
      this.restoreSel = key;
      cx.spawn(async (cx) => {
        await queued;
        if (this.spaceId !== space) return;
        await this.loadChanges(cx);
        if (this.restoreSel === key) this.restoreSel = null;
        this.paint(cx);
      });
    }
  }

  /**
   * Sends (or withdraws) a note for Claude. On this computer a failure fails the job, as it always
   * did; on another machine it only shows in the status line, since the review's own writes are done.
   */
  async noteToClaude(m, send) {
    if (!m.on) return send();
    try { return await send(); }
    catch (e) {
      const s = this.stateOf(this.jobSpace === undefined ? this.spaceId : this.jobSpace); // the queued job's space, shown or not
      if (s) s.status = hookKnown(m.on) === false ? NOTES_NOTE(m.on) : `Note to Claude on ${m.on} not sent: ${e.message ?? e}`;
      return false;
    }
  }

  /** Undo or redo of an edit: memory only. What's on disk stays, so the file shows as unsaved. */
  swapEdit(entry, other, cx) {
    const now = this.files.find((x) => x.key === entry.key);
    if (!now) return;
    other.push({ edit: true, key: entry.key, state: bare(now), cur: this.cur, at: 0 }); capSteps(other);
    this.replace(now, { ...entry.state, diskC: now.diskC, diskB: now.diskB, conflict: now.conflict, edited: true });
    this.sel = entry.key; this.cur = entry.cur; this.anchor = null;
    this.settle(); this.showCursor(); this.retokenize(cx); this.paint(cx);
  }

  redoEdit(cx) {
    const entry = this.redo.pop();
    if (entry) this.swapEdit(entry, this.history, cx);
  }

  enqueue(job, cx, space = this.spaceId) {
    this.writing++;
    // `space`: the job's space (default the shown one), which may no longer be shown when it ends (P7).
    // Each job runs in its own spawned task: a handler's cx is dead after the handler
    // returns, so the queue must never hold one across an await.
    const prev = this.queue;
    this.queue = new Promise((done) => cx.spawn(async (cx) => {
      // One job runs at a time: what it reports outside its writes (noteToClaude) goes to its space.
      try { await prev; this.jobSpace = space; await job(); }
      catch (e) {
        // Disk no longer matches memory: drop undo (it would act on stale state) and reread everything.
        const s = this.stateOf(space);
        if (s) { s.error = String(e.message ?? e); s.history = []; (s.deferred ??= new Set()).add("*"); }
      } finally {
        this.jobSpace = undefined; this.writing--; done();
        if (!this.writing && this.deferred.size) await this.drain(cx);
        this.paint(cx);
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
    // These notes reach Claude through its hook; on another machine, through the hook installed there.
    const on = f.store?.on ?? null;
    if (on && hookKnown(on) === false) { this.status = NOTES_NOTE(on); return []; }
    return [{ terminal: f.by, text: `Code review: the user rejected ${what} in ${f.as ?? agentPath(f.path, f.by)}. The original lines are back on disk.`, on }];
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
    if (!r) { this.error = "Nothing rejected yet to comment on"; this.paint(cx); return; }
    if (r.remote) { this.status = REASON_NOTE(r.remote); this.paint(cx); return; }
    this.openForm({ form: "reason", terminal: r.terminal, file: r.file, where: r.where, quote: r.quote, on: r.on ?? null });
  }

  /**
   * O2: an instruction typed into the agent's terminal as the user's message: about the
   * selected lines when there is a selection, else about hunk `i`.
   */
  askPrompt(i, cx) {
    const f = this.file();
    if (!f) return;
    const terminal = this.target(f);
    if (!terminal) { this.error = "No agent to send to: none made this change, and the space doesn't have exactly one"; this.paint(cx); return; }
    const file = f.as ?? agentPath(f.path, terminal), sel = this.selection(f);
    if (sel) return this.openForm({ form: "prompt", terminal, file, ...this.quote(f, sel) });
    if (!f.hunks[i]) return;
    this.current = i;
    this.openForm({ form: "prompt", terminal, file, where: this.where(f.hunks[i]) });
  }

  // ---- inline edit (ctrl-k, inlineedit.js) --------------------------------------
  // An instruction about the selected lines (else the cursor's line) goes to a one-shot local
  // command (Settings › Inline edit command; default `claude -p` with no tools). Its answer replaces
  // those lines as a pending review change, as an agent's edit would: the review baseline keeps the
  // old lines, the buffer and the file get the new ones. A job belongs to the space and file it was
  // asked for (inlines: space -> job) and lands there, whatever is shown when the answer comes.

  /** Opens the inline edit box on the selection, else the cursor's line (`span`: [first, last] given). An `instruction` runs at once. */
  openInline(cx, instruction = null, span = null) {
    const fail = (msg) => { this.error = msg; this.paint(cx); };
    if (this.mode === "changes") return fail("Inline edit works in Edit: select lines there");
    const f = this.file();
    if (!f) return fail("Open a file to edit inline");
    span ??= this.commentSpan(f);
    if (!span) return fail("Put the cursor on a line, or select lines, to edit inline");
    // Review is read-only: the Edit panel takes over, at the same lines.
    if (this.view === "review") return this.handOff("edit", cx, { line: span[0], col: 0 }, f.key, { inline: { span, instruction } });
    if (!this.view && this.mode === "review") this.setMode("edit", cx);
    if (f.conflict) return fail("Pick Keep mine or Take agent's first");
    if (!this.editable(f)) return fail("This file can't be edited");
    if (f.store?.plain) return fail("Inline edit needs a file in a git repo: its answer is a change to review");
    const busy = this.inlines.get(this.spaceId);
    if (busy && (busy.status === "running" || busy.status === "applying")) { this.inlineInput.focus(); this.paint(cx); return; }
    const t = inlineTarget(f.Ctext, span[0], span[1]), why = targetProblem(t);
    if (why) return fail(why);
    this.error = null; this.bar = null;
    this.inlines.set(this.spaceId, { space: this.spaceId, key: f.key, rel: f.rel, path: f.path, store: f.store, t, status: "prompt", note: null, seq: 0 });
    if (instruction != null) this.inlineInput.set_value(cleanInstruction(instruction));
    else if (busy?.key !== f.key) this.inlineInput.set_value("");
    this.inlineInput.focus(); this.paint(cx);
    if (instruction != null) this.submitInline(cx);
  }

  /** Esc or ×: closes the box. A running edit is cancelled: its answer is ignored when it comes. */
  closeInline(cx) {
    const j = this.inlines.get(this.spaceId);
    if (j?.status === "applying") return; // its writes are queued: it closes itself when they're done
    if (j) { j.seq = -1; this.inlines.delete(this.spaceId); }
    if (this.inBar === this.inlineInput) this.inBar = null;
    this.handle.focus(); this.paint(cx);
  }

  /** Enter: sends the instruction with the lines as the buffer has them now (unsaved edits included). */
  submitInline(cx) {
    const j = this.inlines.get(this.spaceId);
    if (!j || j.status === "running" || j.status === "applying") return;
    const instruction = cleanInstruction(this.inlineInput.value());
    if (!instruction) { j.status = "prompt"; j.note = "Type what to change, then Enter"; this.paint(cx); return; }
    const f = this.files.find((x) => x.key === j.key);
    const t = f && typeof f.Ctext === "string" ? relocate(f.Ctext, j.t) : null;
    if (!t) { j.status = "error"; j.note = "Those lines changed: select them again"; this.paint(cx); return; }
    const prompt = inlinePrompt({ path: j.rel, language: languageOf(j.rel), text: f.Ctext, a: t.a, b: t.b, instruction });
    if (prompt.length > INLINE_MAX_PROMPT) { j.status = "error"; j.note = `Too much to send (${prompt.length} characters, at most ${INLINE_MAX_PROMPT}): select fewer lines`; this.paint(cx); return; }
    const seq = ++this.inlineSeq;
    Object.assign(j, { t, instruction, status: "running", note: null, seq, started: Date.now() });
    this.paint(cx);
    cx.spawn(async (cx) => this.runInline(j, seq, prompt, cx));
  }

  /** The job's own state is still the one asked for (not cancelled, not replaced). */
  inlineLive(j, seq) { return j.seq === seq && this.inlines.get(j.space) === j; }

  inlineFailed(j, msg, cx) { j.status = "error"; j.note = msg; this.paint(cx); }

  /** Where program `name` runs for `store`'s repo, with the PATH its tools need (toolrun.js toolWhere; Problems uses it too). */
  inlineWhere(store, name) { return toolWhere(store.root, store.on ?? null, name, INLINE_MS); }

  /** Runs the command (a task of its own) and applies its answer, unless the job was cancelled meanwhile. */
  async runInline(j, seq, prompt, cx) {
    const template = String(this.settings.inlineCommand ?? "").trim() || INLINE_COMMAND;
    const name = commandWords(template)[0] ?? "the command";
    let tmp = null, r, started = Date.now(), where = null;
    try {
      where = await this.inlineWhere(j.store, name);
      // {promptFile}: the prompt in a temp file under data/wingman, removed afterwards.
      if (usesFile(template)) {
        if (where.on) throw new Error("{promptFile} works only for files on this computer: use {prompt}");
        const dir = `${appHome()}/data/wingman`;
        await fs.mkdir(dir, { recursive: true }).catch(() => {});
        tmp = `${dir}/inline-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.txt`;
        await writeTextFile(tmp, prompt, null);
      }
      const p = runPlan(expandCommand(template, { prompt, promptFile: tmp && (where.how === "wsl" ? toWsl(tmp) : tmp) }), where);
      started = Date.now();
      r = await (p.opts.on ? execOn(p.cmd, p.args, p.opts) : exec(p.cmd, p.args, p.opts));
    } catch (e) { r = e instanceof Error ? e : new Error(String(e?.message ?? e)); }
    finally { if (tmp) await fs.unlink(tmp).catch(() => {}); }
    const elapsed = Date.now() - started, live = this.inlineLive(j, seq);
    log(`inline edit ${j.rel} lines ${j.t.a + 1}-${j.t.b + 1}: ${r instanceof Error ? `error ${r.message}` : `exit ${r.code}, ${r.stdout.length} chars`} in ${elapsed} ms${live ? "" : " (cancelled)"}`);
    if (!live) return;
    const why = runFailure(r, { name, elapsed, timeout: INLINE_MS, where: whereLabel(where) });
    if (why) return this.inlineFailed(j, why, cx);
    const answer = cleanAnswer(r.stdout);
    if (!answer) return this.inlineFailed(j, `${name} gave no answer`, cx);
    this.applyInline(j, answer, cx);
  }

  /**
   * Puts the answer in place of the job's lines, in the job's own space (shown or kept): checked
   * against the buffer as it is now, which must still hold those lines. A file under review: memory
   * first, then the file (and the baseline, when unsaved edits changed it) through the write queue,
   * like a save. A file not under review yet: the file is written, then an event like the Claude
   * hook's puts it under review with the old text as its baseline (journal.postEdit).
   */
  applyInline(j, answer, cx) {
    const space = j.space, s = this.stateOf(space), on = j.store.on ?? null;
    if (!s) return this.inlineFailed(j, "The space is gone", cx);
    const i = (s.files ?? []).findIndex((x) => x.key === j.key && !x.lazy), g = i >= 0 ? s.files[i] : null;
    if (!g) return this.inlineOnDisk(j, answer, cx);
    if (g.error || typeof g.Ctext !== "string") return this.inlineFailed(j, "The file can't be edited now", cx);
    if (g.conflict) return this.inlineFailed(j, "Settle the merge first (Keep mine or Take agent's)", cx);
    const t = relocate(g.Ctext, j.t);
    if (!t) return this.inlineFailed(j, "Those lines changed while it ran: the answer was dropped", cx);
    const next = replaceLines(g.Ctext, t.a, t.b, answer);
    if (next === g.Ctext) return this.inlineFailed(j, "The answer is the same as the lines: nothing changed", cx);
    const C = splitLines(next), lang = languageOf(g.rel);
    const newTok = g.newTok ? [...g.newTok.slice(0, t.a), ...highlightLines(answer, lang), ...g.newTok.slice(t.b + 1)] : g.newTok;
    let state, job;
    if (!g.plain) {
      // Under review: only the current text changes, so the new lines show as a pending change.
      state = { ...g, Ctext: next, C, newTok, hunks: changedRanges(g.Btext, next), edited: true, diskC: next, diskB: g.Btext };
      const writes = this.saveWrites({ ...g, Ctext: next });
      const notes = writes.map((w) => this.editNote(g, w)).filter(Boolean);
      job = async () => { for (const w of writes) await g.store.apply(state, w); await this.sendEditNotes(notes); };
    } else {
      // Not under review: memory and disk take the new text now; Review picks the file up once the
      // leader has applied the event (the reload then shows the change against the old text).
      state = { ...g, Ctext: next, Btext: next, C, B: C, newTok, oldTok: newTok, diskC: next, diskB: next, edited: true };
      job = async () => { await swap(g.path, g.diskC, next, on); await postEdit({ path: g.path, original: g.Ctext, space, on }); };
    }
    s.files[i] = state;
    j.status = "applying";
    this.inlineWrite(j, job, !g.plain, cx);
    if (this.spaceId === space && this.sel === j.key) {
      this.cur = { line: t.a, col: 0 }; this.anchor = null; this.selA = this.selB = null;
      const h = state.hunks.findIndex((x) => t.a >= x.n && t.a < x.n + Math.max(1, x.nc));
      if (h >= 0) this.current = h;
      this.settle(); this.showCursor(); this.retokenize(cx);
    }
    this.paint(cx);
  }

  /** The job's file isn't loaded in its space (closed, or its view let go): the answer goes to the file on disk. */
  async inlineOnDisk(j, answer, cx) {
    const on = j.store.on ?? null;
    try {
      j.status = "applying"; this.paint(cx);
      const text = await readTextFile(j.path, { on });
      if (text == null) return this.inlineFailed(j, "The file is gone", cx);
      const t = relocate(text, j.t);
      if (!t) return this.inlineFailed(j, "Those lines changed while it ran: the answer was dropped", cx);
      const next = replaceLines(text, t.a, t.b, answer);
      if (next === text) return this.inlineFailed(j, "The answer is the same as the lines: nothing changed", cx);
      const reviewed = !!(await j.store.index())[j.rel];
      this.inlineWrite(j, async () => { await swap(j.path, text, next, on); if (!reviewed) await postEdit({ path: j.path, original: text, space: j.space, on }); }, reviewed, cx);
    } catch (e) { this.inlineFailed(j, String(e.message ?? e), cx); }
  }

  /**
   * Queues the job's writes in its space. When they're done the box closes; for a file that wasn't
   * under review, once the review index has it (the leader applies events every half second), and
   * the space's view reloads to show the change.
   */
  inlineWrite(j, write, reviewed, cx) {
    const space = j.space;
    this.enqueue(async () => {
      try { await write(); j.wrote = true; }
      catch (e) { j.wrote = false; j.why = String(e.message ?? e); throw e; }
    }, cx, space);
    cx.spawn(async (cx) => {
      for (let n = 0; j.wrote === undefined && n < 600; n++) await cx.sleep(100);
      if (j.wrote === false) return this.inlineFailed(j, `Not written: ${j.why}`, cx);
      if (!reviewed) {
        let found = false;
        for (let n = 0; !found && n < 60; n++) { await cx.sleep(250); found = !!(await j.store.index().catch(() => ({})))[j.rel]; }
        const s = this.stateOf(space);
        if (s) (s.deferred ??= new Set()).add("*");
        if (this.spaceId === space && !this.writing) cx.spawn(async (cx) => this.drain(cx));
        if (!found) return this.inlineFailed(j, "Written, but Review didn't pick the file up: is a Wingman copy capturing?", cx);
      }
      if (this.inlines.get(space) === j) this.inlines.delete(space);
      if (this.spaceId === space && this.inBar === this.inlineInput) { this.inBar = null; this.handle.focus(); }
      log(`inline edit ${j.rel}: applied as a pending change`);
      this.paint(cx);
    });
  }

  /** The inline edit box over the editor: the lines it's for, the instruction, and its state. */
  inlineBar(j, t) {
    const f = this.files.find((x) => x.key === j.key), here = this.sel === j.key;
    const span = j.t.a === j.t.b ? `line ${j.t.a + 1}` : `lines ${j.t.a + 1}-${j.t.b + 1}`;
    const where = here ? span : `${base(j.rel)}, ${span}`;
    const running = j.status === "running", applying = j.status === "applying";
    const secs = running ? Math.max(0, Math.floor((Date.now() - (j.started ?? Date.now())) / 1000)) : 0;
    const state = running ? `Editing… ${secs} s` : applying ? "Applying…" : j.note ?? "";
    const bad = j.status === "error";
    return v_flex().id("inline-bar").flex_none().px(8).py(5).gap(4).border_b(1).border_color(t.border).bg(t.accent + "14").text_size(12)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().whitespace_nowrap().text_color(t.muted).child(`Inline edit · ${where}`))
        .child(div().flex_1().min_w(0).when(running || applying, (e) => e.opacity(0.6)).child(Input.new(this.inlineInput)))
        .when(!running && !applying, (e) => e.child(this.button("inline-run", "Edit  ⏎", t.accent + "55", (cx) => this.submitInline(cx)).flex_none().whitespace_nowrap()))
        .when(running, (e) => e.child(this.button("inline-cancel", "Cancel  Esc", t.ansi1 + "40", (cx) => this.closeInline(cx)).flex_none().whitespace_nowrap()))
        .when(!running && !applying, (e) => e.child(this.button("inline-close", "×", t.raised, (cx) => this.closeInline(cx)).flex_none())))
      .when(!!state || !f, (e) => e.child(div().text_size(11).truncate().text_color(bad ? t.ansi1 : t.muted).child(state || `${j.rel} isn't open`)));
  }

  // ---- review comments (comments.js, commentprompt.js) ------------------------
  // Kept per space in a file; added here, listed and sent to an agent from the comments dialog.

  /** The shown space's comments. */
  comments() { return this.cmts.get(this.spaceId)?.comments ?? []; }

  /** A hunk header's note of the comments on its lines ("" when none); cmtSpans is the shown file's, set by render. */
  hunkComments(f, i) {
    const h = f.hunks[i];
    if (!h || !this.cmtSpans?.length) return "";
    const b = h.n + Math.max(1, h.nc) - 1, n = this.cmtSpans.filter((s) => s.b >= h.n && s.a <= b).length;
    return n ? ` · ${n} comment${n === 1 ? "" : "s"}` : "";
  }

  /** Every 250 ms: (re)loads the shown space's comments when their file changed (COMMENTS). */
  syncComments(cx) {
    const space = this.spaceId;
    if (!space || this.cmtLoading) return;
    const stamp = shared(COMMENTS)?.[space] ?? 0;
    if (this.cmts.has(space) && this.cmtSeen.get(space) === stamp) return;
    this.cmtLoading = true; this.cmtSeen.set(space, stamp);
    cx.spawn(async (cx) => {
      try { this.cmts.set(space, await loadComments(cmtIo, cmtDir(), space)); }
      catch (e) { log(`comments: ${e.message ?? e}`); this.cmts.set(space, { v: 1, comments: [], undo: null }); }
      finally { this.cmtLoading = false; }
      this.paint(cx);
    });
  }

  /**
   * Every second: comments on a loaded file follow its saved text (relocateFile: by their snippet,
   * nearest to the old line; not found: "moved or changed"). Only files whose text changed are looked at.
   */
  anchorComments(cx) {
    if (this.mode === "changes" || this.anchoring || this.form) return;
    const space = this.spaceId, st = this.cmts.get(space);
    if (!st?.comments.length) return;
    const work = [];
    for (const f of this.files) {
      if (f.lazy || f.error || f.committed || !st.comments.some((c) => c.key === f.key)) continue;
      const text = typeof f.diskC === "string" ? f.diskC : f.Ctext, seen = this.anchorSeen.get(f.key);
      if (typeof text !== "string" || (seen && seen.text === text && seen.state === st)) continue;
      if (relocateFile(st, f.key, text) === st) this.anchorSeen.set(f.key, { text, state: st });
      else work.push([f.key, text]);
    }
    if (!work.length) return;
    this.anchoring = true;
    cx.spawn(async (cx) => {
      try {
        const next = await changeComments(space, (s) => work.reduce((acc, [key, text]) => relocateFile(acc, key, text), s));
        this.cmts.set(space, next); this.cmtSeen.set(space, shared(COMMENTS)?.[space] ?? 0);
      } catch (e) { log(`comments: ${e.message ?? e}`); }
      finally { this.anchoring = false; }
      this.paint(cx);
    });
  }

  /** A comment draft on file f's lines [a, b] (0-based, the current text): everything but its text. */
  commentDraft(f, a, b, extra = {}) {
    const lines = linesOf(f), root = f.store?.root ?? null;
    const onChange = f.hunks.some((h) => a <= h.n + Math.max(1, h.nc) - 1 && b >= h.n);
    return { space: this.spaceId, path: f.path, root, rel: f.rel, key: f.key, on: f.store?.on ?? null, repo: f.store?.label ?? (root ? base(root) : null),
      as: f.as ?? null, start: a + 1, end: b + 1, snippet: snippetOf(lines, a, b - a + 1), by: onChange ? f.by ?? null : null, kind: "line", ...extra };
  }

  /** The lines a comment is on: the selection's lines of the current file, else the cursor's, else the current change's. */
  commentSpan(f) {
    const last = Math.max(0, linesOf(f).length - 1), clamp = (n) => Math.max(0, Math.min(n, last));
    const sel = this.selection(f);
    if (sel) {
      const rows = this.rowsOf(f), lines = rows.slice(sel[0], sel[1] + 1).filter((r) => r.side === "new" && !r.cont).map((r) => r.line);
      if (lines.length) return [Math.min(...lines), Math.max(...lines)];
      // Only removed lines selected: the line where they were.
      const next = rows.slice(sel[1] + 1).find((r) => r.side === "new");
      return next ? [next.line, next.line] : [last, last];
    }
    if (this.cur) return [clamp(this.cur.line), clamp(this.cur.line)];
    const h = f.hunks[this.current];
    return h ? [clamp(h.n), clamp(h.n + Math.max(1, h.nc) - 1)] : null;
  }

  /** Why a comment can't be added to the shown space now, or null. */
  commentBlocked(f) {
    if (!f || f.error || typeof f.Ctext !== "string") return "Open a file to comment on";
    if (this.mode === "changes") return "Add comments in Review or Edit";
    if (this.comments().length >= MAX_BATCH) return `A space holds at most ${MAX_BATCH} comments: send or delete some first (${this.kl("commentList")})`;
    return null;
  }

  /** alt-m: a comment on the selection, the cursor's line, or the current change. */
  commentHere(cx) {
    const f = this.file(), why = this.commentBlocked(f);
    if (why) { this.error = why; this.paint(cx); return; }
    const span = this.commentSpan(f);
    if (!span) { this.error = "Put the cursor on a line, or select lines, to comment on"; this.paint(cx); return; }
    this.openCommentForm(this.commentDraft(f, span[0], span[1]));
  }

  /** A hunk's Comment button: a comment on its lines (a removal: the line after it, quoting what was removed). */
  commentHunk(i, cx) {
    const f = this.file(), h = f?.hunks[i], why = this.commentBlocked(f);
    if (!h) return;
    this.current = i;
    if (why) { this.error = why; this.paint(cx); return; }
    const last = Math.max(0, linesOf(f).length - 1), a = Math.min(h.n, last), b = Math.max(a, Math.min(h.n + h.nc - 1, last));
    const removal = h.nc ? {} : { snippet: snippetOf(f.B, h.o, h.oc), anchor: snippetOf(linesOf(f), a, 1) };
    this.openCommentForm(this.commentDraft(f, a, b, { kind: "hunk", by: f.by ?? null, ...removal }));
    this.paint(cx);
  }

  /**
   * Reject the current change, then a comment on where it was: its snippet is the rejected new text
   * (what the agent wrote), and it is found again by the original lines put back.
   */
  rejectWithComment(cx) {
    const f = this.file(), i = this.current, h = f?.hunks[i], why = this.commentBlocked(f);
    if (!h) return;
    if (why) { this.error = why; this.paint(cx); return; }
    const draft = this.commentDraft(f, h.n, h.n, {
      kind: "rejected", by: f.by ?? null, end: h.n + Math.max(1, h.oc),
      snippet: snippetOf(f.C, h.n, h.nc),
      anchor: h.oc ? snippetOf(f.B, h.o, h.oc) : snippetOf(f.C, h.n + h.nc, 1),
    });
    this.hunk("reject", i, cx);
    if (this.files.includes(f)) return; // not rejected (a conflict, or unsaved edits elsewhere): this.error says why
    this.openCommentForm(draft);
  }

  openCommentForm(draft) {
    openOverlay({ mod: "wingman", props: { form: "comment", space: draft.space, draft }, kind: "dialog", width: 560, height: 300 });
  }

  // ---- G4: checkpoints (checkpoints.js) ---------------------------------------------------------
  // The capture leader keeps one per agent turn and repo. The header's Checkpoints N opens the list
  // for the shown space (a dialog copy, form "checkpoints"), where a turn's files show and Restore runs.

  /** The shown space's git repos, as the checkpoints dialog takes them. */
  cpRepos() { return this.stores.filter((st) => !st.plain).map((st) => ({ root: st.root, gitDir: st.gitDir, on: st.on ?? null, name: this.repoName(st) })); }

  /**
   * The header's Checkpoints count: the shown space's turns. Every 3 s while Review shows; a repo on
   * another machine is read at most every REMOTE.reconcileMs (a call there each time).
   */
  countCheckpoints(cx) {
    const space = this.spaceId, stores = this.stores.filter((st) => !st.plain);
    if (this.cpCounting || !space || this.mode !== "review" || !stores.length) return;
    this.cpCounting = true;
    cx.spawn(async (cx) => {
      try {
        const repos = [];
        for (const st of stores) {
          if (!st.on || Date.now() - (st.cpAt ?? 0) >= REMOTE.reconcileMs) {
            st.cpAt = Date.now();
            st.cpData = parseCheckpoints(await st.read(`${st.dir}/checkpoints.json`).catch(() => null));
          }
          repos.push({ key: idOf(st), name: "", data: st.cpData });
        }
        const n = turnRows(repos, space).length;
        if (this.cpCounts.get(space) !== n) { this.cpCounts.set(space, n); this.paint(cx); }
      } catch (e) { log(`checkpoints count: ${e.message ?? e}`); }
      finally { this.cpCounting = false; }
    });
  }

  /** The header's Checkpoints N and the command wingman.checkpoints: the checkpoints dialog for the shown space. */
  openCheckpoints(cx) {
    if (!this.spaceId) return;
    const repos = this.cpRepos();
    if (!repos.length) { this.error = "Checkpoints are kept for git repos only, and this space has none"; this.paint(cx); return; }
    openOverlay({ mod: "wingman", props: { form: "checkpoints", space: this.spaceId, repos }, kind: "dialog", width: 760, height: 600 });
  }

  /** The header's Comments count and alt-shift-m: the comments dialog for the shown space. */
  openCommentList() {
    if (!this.spaceId) return;
    openOverlay({ mod: "wingman", props: { form: "comments", space: this.spaceId }, kind: "dialog", width: 700, height: 560 });
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
    this.paint(cx);
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

  clearSelection(cx) { this.selA = this.selB = null; this.anchor = null; this.paint(cx); }

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
    if (!any) { this.error = "The selection has no changed lines"; this.paint(cx); return true; }
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
    const rows = picked.filter((r) => r.kind !== "@" && !r.cont);
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
    // A space on another machine adds the "Claude hook on <machine>" section.
    const machine = this.machine();
    // The space's repos, for the Problems command (kept per repo).
    const repos = this.repos().map((st) => ({ id: idOf(st), name: this.repoName(st) }));
    openOverlay({ mod: "wingman", props: { form: "settings", repos, ...(machine ? { machine } : {}) }, kind: "dialog", width: 460, height: settingsHeight(this.paneH == null ? null : this.px(this.paneH)) });
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
    // A comment on a rejection goes through the Claude hook: on another machine, the one installed there.
    const on = f.store?.on ?? null;
    if (on && hookKnown(on) === false) { this.lastReject = { remote: on }; return; }
    const terminal = this.target(f);
    this.lastReject = terminal ? { terminal, file: f.as ?? agentPath(f.path, terminal), where, quote: this.quoteRows(f, rows).quote, on } : null;
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

  editable(f) { return !!f && !f.error && typeof f.Ctext === "string"; }

  /** Panel split: the Review copy keeps no unsaved text. */
  readOnly(cx) {
    this.error = `${this.mode === "changes" ? "Changes" : "Review"} is read-only: double-click a line to edit it in Edit`; this.paint(cx);
  }

  /** One character's width in the diff font, in element px (zoom.js: measured widths include the app's zoom). */
  cw() { return charWidth(this.charPx, 100, this.unit) ?? 7.2; }

  /** The diff's width and height in element px. */
  vw() { return this.viewW == null ? 600 : this.px(this.viewW); }
  vh() { return this.viewH == null ? 400 : this.px(this.viewH); }

  /** The file tab strip's width in element px. */
  tabVW() { return this.tabViewW ? this.px(this.tabViewW) : 0; }

  /** A pointer event's position in its element, in element px ({ x: -1, y: -1 } when it has none). */
  at(ev) { const p = ev.local_position; return p ? { x: this.px(p.x), y: this.px(p.y) } : { x: -1, y: -1 }; }
  hasTextSel() { return !!(this.anchor && this.cur && cmp(this.anchor, this.cur)); }
  ordered() { return cmp(this.anchor, this.cur) <= 0 ? [this.anchor, this.cur] : [this.cur, this.anchor]; }

  clampPos(f, p) {
    const lines = linesOf(f), line = Math.max(0, Math.min(p.line, lines.length - 1));
    return { line, col: Math.max(0, Math.min(p.col, body(lines[line]).length)) };
  }

  /** The position under x on row `r` (a line of the current file). */
  posAt(f, r, x) {
    const text = body(linesOf(f)[r.line]), seg = r.seg;
    if (!seg) return { line: r.line, col: charAt(text, colAtX(x, GUTTER, this.hx, this.cw())) };
    // A wrapped segment: its own columns; past its end stays on it (the last segment takes the line end).
    const v = colAtX(x, GUTTER, 0, this.cw()) - seg.ind + visualCol(text, seg.from);
    return { line: r.line, col: Math.max(seg.from, Math.min(charAt(text, Math.max(0, v)), seg.to === text.length ? seg.to : seg.to - 1)) };
  }

  textDown(f, r, x, y, ev, cx) {
    if (r.hunk != null) this.current = r.hunk;
    // Editor "nvim": a click opens Neovim at that line; Wingman stays the review.
    if (this.nvim()) return this.toNvim(f, r.side === "new" ? r.line : r.hunk != null ? f.hunks[r.hunk].n : 0, cx);
    if (r.side !== "new") { this.paint(cx); return; } // removed lines are read-only
    const p = this.posAt(f, r, x), lines = linesOf(f);
    this.selA = this.selB = null; this.goalX = null;
    if (ev.click_count === 2 && (this.view === "review" || this.mode === "changes")) return this.handOff("edit", cx, p);
    if (ev.click_count === 2) { [this.anchor, this.cur] = wordAt(lines, p); this.paint(cx); return; }
    if (ev.click_count >= 3) {
      this.anchor = { line: p.line, col: 0 };
      this.cur = p.line + 1 < lines.length ? { line: p.line + 1, col: 0 } : { line: p.line, col: body(lines[p.line]).length };
      this.paint(cx); return;
    }
    if (ev.modifiers?.shift && this.cur) this.anchor ??= this.cur; else this.anchor = p;
    this.cur = p;
    this.dragging = true; this.tdrag = true; this.dragY = y; this.dragX = x;
    this.paint(cx);
  }

  /** Keeps the cursor on screen: its row, and its column when lines are long. */
  showCursor() {
    const f = this.file();
    if (!f || !this.cur) return;
    const row = this.rowOfPos(f, this.cur);
    if (row != null) this.ensureVisible(row);
    if (this.wrapCols()) { this.hx = 0; return; }
    const x = visualCol(body(linesOf(f)[this.cur.line]), this.cur.col) * this.cw();
    const view = Math.max(60, this.vw() - GUTTER - 40);
    if (x < this.hx) this.hx = Math.max(0, x - 60);
    else if (x > this.hx + view) this.hx = x - view + 60;
  }

  move(to, extend, cx) {
    const f = this.file();
    if (!f || !this.cur) return;
    if (extend) this.anchor ??= this.cur; else this.anchor = null;
    this.cur = this.clampPos(f, to); this.selA = this.selB = null; this.goalX = null;
    this.showCursor(); this.paint(cx);
  }

  /** Up/Down and PageUp/PageDown keep the column the cursor started from. */
  vertical(by, extend, cx) {
    const f = this.file(), lines = linesOf(f);
    if (this.wrapCols()) return this.verticalWrapped(f, lines, by, extend, cx);
    const goal = this.goalX ?? visualCol(body(lines[this.cur.line]), this.cur.col);
    const line = Math.max(0, Math.min(lines.length - 1, this.cur.line + by));
    this.move({ line, col: charAt(body(lines[line]), goal) }, extend, cx);
    this.goalX = goal;
  }

  /** E5: Up/Down move by screen row through wrapped lines, keeping the screen column. */
  verticalWrapped(f, lines, by, extend, cx) {
    const rows = this.rowsOf(f), i = this.rowOfPos(f, this.cur);
    if (i == null) return;
    const shown = (r, text) => (r.seg ? visualCol(text, r.seg.from) - r.seg.ind : 0); // display column at the row's left edge
    const goal = this.goalX ?? visualCol(body(lines[this.cur.line]), this.cur.col) - shown(rows[i], body(lines[this.cur.line]));
    let j = i;
    for (let n = Math.abs(by), d = Math.sign(by); n > 0; n--) {
      let k = j + d;
      while (k >= 0 && k < rows.length && rows[k].side !== "new") k += d;
      if (k < 0 || k >= rows.length) break;
      j = k;
    }
    const r = rows[j], text = body(lines[r.line]);
    let col = charAt(text, Math.max(0, goal + shown(r, text)));
    if (r.seg) col = Math.max(r.seg.from, Math.min(col, r.seg.to === text.length ? r.seg.to : r.seg.to - 1));
    this.move({ line: r.line, col }, extend, cx);
    this.goalX = goal;
  }

  /**
   * Replaces the text from `from` to `to` (default: the selection, else the cursor) with `text`.
   * Quick typing (`group`) is one undo step; anything else is its own.
   */
  type(text, cx, { from, to, group = false, select = false } = {}) {
    const f = this.file();
    if (!this.editable(f) || !this.cur) return;
    if (this.view === "review" || this.mode === "changes") return this.readOnly(cx);
    const sel = this.hasTextSel(), a = from ?? (sel ? this.anchor : this.cur), b = to ?? this.cur;
    const lang = languageOf(f.rel, body(linesOf(f)[0] ?? ""));
    const { state, cursor } = edit(f, a, b, text, (ls) => highlightLines(ls, lang));
    const last = this.history[this.history.length - 1], now = Date.now();
    if (group && last?.edit && last.group && last.key === f.key && now - last.at < 1000) last.at = now;
    else { this.history.push({ edit: true, key: f.key, state: bare(f), cur: this.cur, at: now, group }); capSteps(this.history); }
    this.redo = [];
    state.edited = true;
    this.replace(f, state);
    const start = cmp(a, b) <= 0 ? a : b;
    this.anchor = select ? start : null; this.cur = cursor;
    this.selA = this.selB = null; this.goalX = null; this.error = null;
    this.settle(); this.showCursor(); this.retokenize(cx); this.paint(cx);
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
        if (g && g.Ctext === f.Ctext && g.Btext === f.Btext) { g.newTok = newTok; g.oldTok = oldTok; this.paint(cx); }
      });
    });
  }

  /** The text to copy: the text selection, else the selected lines, else the cursor's line. */
  copyText(f) {
    const lines = linesOf(f);
    if (this.hasTextSel()) return textBetween(lines, this.anchor, this.cur);
    const ls = this.lineSel(f);
    if (ls) return this.rowsOf(f).slice(ls[0], ls[1] + 1).filter((r) => r.kind !== "@" && !r.cont)
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
        const opens = (this.settings.autoPairs && betweenBrackets(body(lines[c.line]), c.col))
          || (this.settings.autoTags && tagKind(f.rel) && betweenTags(body(lines[c.line]), c.col));
        if (!sel && opens) {
          const inner = indent + indentUnit(lines);
          this.type("\n" + inner + "\n" + indent, cx);
          this.cur = { line: c.line + 1, col: inner.length }; this.showCursor(); this.paint(cx);
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
        this.anchor = null; this.paint(cx); return true;
    }
    if (ctrl && !m.alt) return false; // ctrl keys are actions (keymap.js)
    // Typed characters; Ctrl+Alt is AltGr on Windows keyboards.
    if (e.key_char && !m.platform && (!m.control || m.alt) && !/[\r\n]/.test(e.key_char)) {
      if (!sel && this.settings.autoTags && this.autoTag(e.key_char, f, lines, cx)) return true;
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
      comment: () => toggleComment(lines, l1, l2, commentFor(f.rel, body(lines[0] ?? "")), anchor, cur),
    }[name]?.();
    if (!op) { if (name === "comment" && !commentFor(f.rel, body(lines[0] ?? ""))) { this.error = `No comment syntax known for ${base(f.rel)}`; this.paint(cx); } return; }
    this.type(op.text, cx, { from: op.from, to: op.to });
    const g = this.file();
    this.anchor = op.anchor && this.clampPos(g, op.anchor); this.cur = this.clampPos(g, op.cur);
    this.showCursor(); this.paint(cx);
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
      this.showCursor(); this.paint(cx);
      return true;
    }
    const c = this.cur, d = typed(ch, body(lines[c.line]), c.col);
    if (d?.skip) return this.move({ line: c.line, col: c.col + 1 }, false, cx), true;
    if (!d?.insert) return false;
    this.type(d.insert, cx, { group: true });
    this.cur = { line: this.cur.line, col: this.cur.col - 1 }; this.showCursor(); this.paint(cx);
    return true;
  }

  /**
   * E4: in a file with tags, ">" ending an opening tag adds its closing tag after the cursor, and
   * "/" right after "<" completes the innermost open tag. True when handled.
   */
  autoTag(ch, f, lines, cx) {
    const kind = (ch === ">" || ch === "/") && tagKind(f.rel);
    if (!kind) return false;
    const c = this.cur, lo = Math.max(0, c.line - 50);
    const ls = lines.slice(lo, c.line + 1).map(body), at = c.line - lo;
    if (ch === ">") {
      const close = closingTag(ls, at, c.col, kind);
      if (!close) return false;
      this.type(">" + close, cx, { group: true });
      this.cur = { line: this.cur.line, col: this.cur.col - close.length }; this.showCursor(); this.paint(cx);
      return true;
    }
    const rest = completeClose(ls, at, c.col, kind);
    if (!rest) return false;
    this.type("/" + rest, cx, { group: true });
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
    // Add repo… for a space on another machine: a path there (the folder picker is this computer's).
    this.pathInput = InputState.new({ placeholder: "A folder on that machine, e.g. /home/me/repo" });
    this.pathInput.on("submit", (_e, cx) => this.addPath(cx));
    this.qo = null; this.recent = []; // Quick Open: null, or { sel, items }; recent: file keys, newest first
    // Inline edit (ctrl-k): the instruction box; Enter runs it. Its jobs are kept per space (inlines).
    this.inlineInput = InputState.new({ placeholder: "Describe the change, e.g. use async/await" });
    this.inlineInput.on("submit", (_e, cx) => this.submitInline(cx));
    this.inlineInput.on("change", (_e, cx) => { const j = this.inlines.get(this.spaceId); if (j?.note && j.status !== "running") { j.note = null; this.paint(cx); } });
    this.inlines = new Map(); this.inlineSeq = 0;
    this.initSearch();
    this.quickInput.on("change", (_e, cx) => { this.rankQuick(); this.paint(cx); });
    this.quickInput.on("submit", (_e, cx) => this.chooseQuick(this.qo?.sel ?? 0, cx));
    for (const i of [this.findInput, this.replaceInput, this.lineInput, this.quickInput, this.pathInput, this.inlineInput]) {
      i.on("focus", () => { this.inBar = i; this.searchFocus = false; this.problemsFocus = false; this.treeFocus = false; });
      i.on("blur", () => { if (this.inBar === i) this.inBar = null; });
    }
    // The tree's name box for New File…, New Folder… and Rename…: Enter does it, Esc cancels.
    this.treeInput = InputState.new({ placeholder: "" });
    this.treeInput.on("submit", (_e, cx) => this.commitTreeEdit(cx));
    this.treeInput.on("change", (_e, cx) => { if (this.treeEdit?.error) { this.treeEdit.error = null; this.paint(cx); } });
    this.treeInput.on("focus", () => { this.inBar = this.treeInput; this.searchFocus = false; this.problemsFocus = false; });
    this.treeInput.on("blur", () => { if (this.inBar === this.treeInput) this.inBar = null; });
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
    if (mode === "line") { this.lineInput.set_value(""); this.lineInput.focus(); this.paint(cx); return; }
    // A selection on one line becomes the query.
    if (this.hasTextSel()) {
      const [a, b] = this.ordered();
      if (a.line === b.line) this.findInput.set_value(textBetween(linesOf(f), a, b));
    }
    this.findFrom = null;
    (mode === "replace" && this.findInput.value() ? this.replaceInput : this.findInput).focus();
    this.paint(cx);
  }

  closeFind(cx) { this.bar = null; this.inBar = null; this.handle.focus(); this.paint(cx); }

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
    if (!f || !ms.length) { this.paint(cx); return; }
    const p = this.hasTextSel() ? this.ordered()[0] : this.cur ?? { line: 0, col: 0 };
    const i = dir === 0 ? nextMatch(ms, this.findFrom ?? { line: 0, col: 0 }, true) : dir > 0 ? nextMatch(ms, p) : prevMatch(ms, p);
    const m = ms[i];
    this.anchor = { line: m.line, col: m.from }; this.cur = { line: m.line, col: m.to };
    this.showCursor(); this.paint(cx);
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
    if (this.view === "review" || this.mode === "changes") return this.readOnly(cx);
    const lines = linesOf(f), repl = this.replaceInput.value(), regex = this.findOpts.regex;
    const subs = ms.map((m) => replacement(body(lines[m.line]).slice(m.from, m.to), re, repl, regex));
    this.cur ??= { line: 0, col: 0 };
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      this.type(subs[i], cx, { from: { line: m.line, col: m.from }, to: { line: m.line, col: m.to }, group: true });
    }
    this.history[this.history.length - 1].at = 0; // later typing starts its own undo step
    if (this.bar) this.bar.note = `Replaced ${ms.length}`;
    this.paint(cx);
  }

  goToLine(cx) {
    const f = this.file(), p = parseLine(this.lineInput.value());
    if (!f || !p) return;
    this.cur = this.clampPos(f, p); this.anchor = null;
    this.closeFind(cx); this.showCursor(); this.paint(cx);
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
    // Fitted to the bar's width (barfit.fitFindRow): the count, then the option toggles, then the
    // Replace toggle go as the bar narrows, the box shrinks, and nothing runs past the edge.
    const w = this.barW == null ? 0 : this.px(this.barW), short = error ? "!" : this.bar.note ? this.bar.note : !q ? "" : !ms.length ? "0" : i >= 0 ? `${i + 1}/${ms.length}` : `${ms.length}`;
    const row1 = fitFindRow(w, findRowItems([count, short], mode === "replace" ? ["Hide replace", "Hide"] : [`Replace  ${this.kl("replace")}`, "Replace", "⇄"]));
    const L = row1.labels, shows = (id) => L.has(id);
    const row2 = mode === "replace" ? fitFindRow(w, replaceRowItems([`All  ${this.kl("replaceAll")}`, "All"], this.findOpts.regex ? "$1, $2… insert groups" : null)) : null;
    return v_flex().px(8).py(4).gap(4).border_b(1).border_color(t.border).text_size(12)
      .child(h_flex().gap(6).items_center()
        .child(box(this.findInput, row1.inputW))
        .when(shows("find-cased"), (e) => e.child(chip("find-cased", "Aa", this.findOpts.cased, (cx) => this.findFlag("cased", cx))))
        .when(shows("find-word"), (e) => e.child(chip("find-word", "W", this.findOpts.word, (cx) => this.findFlag("word", cx))))
        .when(shows("find-regex"), (e) => e.child(chip("find-regex", ".*", this.findOpts.regex, (cx) => this.findFlag("regex", cx))))
        .when(shows("count"), (e) => e.child(div().min_w(L.get("count") === count ? 70 : 0).flex_none().whitespace_nowrap().text_size(11).text_color(error || (q && !ms.length) ? t.ansi1 : t.muted).child(L.get("count"))))
        .child(this.button("find-prev", L.get("find-prev"), t.raised, (cx) => this.findStep(-1, cx)).flex_none())
        .child(this.button("find-next", L.get("find-next"), t.raised, (cx) => this.findStep(1, cx)).flex_none())
        .child(div().flex_1().min_w(0))
        .when(shows("find-mode"), (e) => e.child(this.button("find-mode", L.get("find-mode"), t.raised, (cx) => { this.bar = { mode: mode === "replace" ? "find" : "replace" }; this.paint(cx); }).flex_none().whitespace_nowrap()))
        .child(this.button("find-close", "×", t.raised, (cx) => this.closeFind(cx)).flex_none()))
      .when(mode === "replace", (e) => e.child(h_flex().gap(6).items_center()
        .child(box(this.replaceInput, row2.inputW))
        .child(this.button("replace-one", "Replace", t.raised, (cx) => this.replaceOne(cx)).flex_none().whitespace_nowrap())
        .child(this.button("replace-all", row2.labels.get("replace-all"), t.raised, (cx) => this.replaceAll(cx)).flex_none().whitespace_nowrap())
        .when(row2.labels.has("hint"), (e) => e.child(div().text_size(11).text_color(t.dim).whitespace_nowrap().child("$1, $2… insert groups")))));
  }

  // ---- Search view (ctrl-shift-f) ----------------------------------------------
  // The Edit tab's left column has two modes, Explorer (the tree) and Search: git grep over every
  // repo of the space (search.js), results grouped by file, and Replace All. Its state is per space
  // (this.search, kept by snapshotView); the boxes are this copy's, refilled on a space switch.

  initSearch() {
    this.searchInput = InputState.new({ placeholder: "Search" });
    this.sReplaceInput = InputState.new({ placeholder: "Replace" });
    this.includeInput = InputState.new({ placeholder: "e.g. src/**, *.ts" });
    this.excludeInput = InputState.new({ placeholder: "e.g. dist, *.min.js" });
    this.searchInputs = [this.searchInput, this.sReplaceInput, this.includeInput, this.excludeInput];
    const fields = [["query", this.searchInput], ["replace", this.sReplaceInput], ["include", this.includeInput], ["exclude", this.excludeInput]];
    for (const [k, i] of fields) {
      i.on("focus", () => { this.inBar = i; this.searchFocus = false; this.problemsFocus = false; this.treeFocus = false; });
      i.on("blur", () => { if (this.inBar === i) this.inBar = null; });
      i.on("change", (_e, cx) => {
        const s = this.search, v = i.value();
        if (v === s[k]) return; // refilled on a space switch, or nothing changed
        s[k] = v; s.confirm = false; s.note = null;
        if (k === "replace") this.paint(cx); else this.scheduleSearch(cx);
      });
    }
    for (const i of [this.searchInput, this.includeInput, this.excludeInput]) i.on("submit", (_e, cx) => this.runSearch(cx));
    this.sReplaceInput.on("submit", (e, cx) => { if (e?.secondary) this.askReplaceAll(cx); });
  }

  /** The boxes show the active space's search. */
  syncSearchInputs() {
    const s = this.search;
    if (!this.searchInput || !s) return;
    for (const [k, i] of [["query", this.searchInput], ["replace", this.sReplaceInput], ["include", this.includeInput], ["exclude", this.excludeInput]])
      if (i.value() !== s[k]) i.set_value(s[k]);
  }

  /** Whether the Search column is on screen. */
  searchShown() { return this.mode === "edit" && (this.treeOn || this.treeOnly()) && this.search?.left === "search"; }
  problemsShown() { return this.mode === "edit" && (this.treeOn || this.treeOnly()) && this.search?.left === "problems"; }

  /** ctrl-shift-f: the Edit tab's Search, its box taking a one-line selection as the query. Other panel copies hand off. */
  openSearch(cx) {
    const f = this.file();
    let q = null;
    if (f && this.hasTextSel()) {
      const [a, b] = this.ordered();
      if (a.line === b.line) q = textBetween(linesOf(f), a, b);
    }
    if (this.view && this.view !== "edit") return this.handOff("edit", cx, null, null, { search: { query: q } });
    if (this.mode !== "edit") this.setMode("edit", cx);
    this.showSearch(q, cx);
  }

  showSearch(q, cx) {
    const s = this.search;
    s.left = "search"; this.treeOn = true; this.searchFocus = false; this.problemsFocus = false;
    if (q) { s.query = q; s.note = null; this.searchInput.set_value(q); }
    this.searchInput.focus();
    if (q || (s.query && !s.results && !s.running)) this.runSearch(cx);
    this.paint(cx);
  }

  /** The left column's switch: "explorer" or "search". */
  setLeft(which, cx) {
    this.search.left = which; this.searchFocus = false; this.problemsFocus = false;
    if (which === "search") this.searchInput.focus();
    else { this.handle.focus(); this.refreshTrees(cx); }
    if (which === "agent") this.agentFiles.show(cx);
    if (which === "problems") this.handle.focus();
    this.paint(cx);
  }

  /** Typing searches 300 ms after the last key, from 2 characters; an empty box clears the results. */
  scheduleSearch(cx) {
    const s = this.search;
    if (!s.query) { s.seq++; s.results = null; s.running = false; s.sel = null; this.paint(cx); return; }
    this.paint(cx);
    if (s.query.length < 2) return;
    const tick = (s.tick = (s.tick ?? 0) + 1);
    cx.timer.after(300, (cx) => { if (s.tick === tick && this.search === s) this.runSearch(cx); });
  }

  searchFlag(k, cx) {
    const s = this.search;
    s.opts = { ...s.opts, [k]: !s.opts[k] }; s.confirm = false; s.note = null;
    if (s.query) this.runSearch(cx); else this.paint(cx);
  }

  /** Searches every repo of the space, one after another; a newer search drops this one's results. */
  runSearch(cx) {
    const s = this.search, q = s.query, seq = ++s.seq;
    s.confirm = false;
    if (!q) { s.results = null; s.running = false; this.paint(cx); return; }
    const opts = { query: q, ...s.opts, include: s.include, exclude: s.exclude }, repos = this.repos();
    try { grepArgs(opts); } catch (e) { s.results = { opts, files: [], total: 0, truncated: false, error: e.message }; s.running = false; this.paint(cx); return; }
    if (!repos.length) { s.results = null; s.running = false; this.paint(cx); return; }
    s.running = true; this.paint(cx);
    cx.spawn(async (cx) => {
      const files = [], errors = [];
      let total = 0, truncated = false;
      for (const st of repos) {
        if (total >= MAX_RESULTS) { truncated = true; break; }
        const r = await searchRepo(git, st.root, opts, { on: st.on ?? null, max: MAX_RESULTS - total });
        if (s.seq !== seq) return;
        if (r.error) { errors.push(repos.length > 1 ? `${this.repoName(st)}: ${r.error}` : r.error); continue; }
        for (const f of r.files) files.push({ key: `${st.root}|${f.rel}`, id: idOf(st), st, rel: f.rel, matches: f.matches });
        total += r.total; truncated ||= r.truncated;
      }
      s.results = { opts, files, total, truncated, error: errors[0] ?? null };
      s.running = false; s.collapsed = new Set(); s.shutVer++;
      this.paint(cx);
    });
  }

  /** The result rows, rebuilt when the results or the collapsed files change. */
  searchRows() {
    const s = this.search, r = s?.results;
    if (!r) return [];
    if (s._rowsFor !== r || s._rowsVer !== s.shutVer) { s._rows = resultRows(r.files, s.collapsed); s._rowsFor = r; s._rowsVer = s.shutVer; }
    return s._rows;
  }

  toggleResultFile(key, open, cx) {
    const s = this.search, shut = s.collapsed.has(key);
    if (open === !shut) return;
    if (shut) s.collapsed.delete(key); else s.collapsed.add(key);
    s.shutVer++; this.paint(cx);
  }

  /** Up/Down in the results; Up from the first row goes back to the search box. */
  moveResult(by, cx) {
    const s = this.search, rows = this.searchRows();
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.key === s.sel);
    i = i < 0 ? (by > 0 ? 0 : rows.length - 1) : i + by;
    if (i < 0) { this.searchFocus = false; this.searchInput.focus(); this.paint(cx); return; }
    i = Math.min(i, rows.length - 1);
    s.sel = rows[i].key; this.searchScroll.scroll_to_item(i); this.paint(cx);
  }

  /** Left: to a match's file, then collapses it. Right: expands a file. */
  foldResult(open, cx) {
    const s = this.search, rows = this.searchRows(), row = rows.find((r) => r.key === s.sel);
    if (!row) return;
    if (row.kind === "match" && !open) {
      s.sel = `f|${row.file.key}`;
      const i = rows.findIndex((r) => r.key === s.sel);
      if (i >= 0) this.searchScroll.scroll_to_item(i);
      this.paint(cx); return;
    }
    if (row.kind === "file") this.toggleResultFile(row.file.key, open, cx);
  }

  /** Enter in the results: a file row folds, a match opens and the editor takes the keyboard. */
  enterResult(cx) {
    const s = this.search, row = this.searchRows().find((r) => r.key === s.sel);
    if (!row) return;
    if (row.kind === "file") this.toggleResultFile(row.file.key, s.collapsed.has(row.file.key), cx);
    else this.openResult(row, cx, true);
  }

  /** A click: a file row folds, a match opens; the results keep the keyboard (Up/Down, Enter). */
  clickResult(key, cx) {
    const s = this.search, row = this.searchRows().find((r) => r.key === key);
    if (!row) return;
    s.sel = key;
    if (row.kind === "match") return this.openResult(row, cx, false);
    this.toggleResultFile(row.file.key, s.collapsed.has(row.file.key), cx);
    this.handle.focus(); this.searchFocus = true; this.paint(cx);
  }

  /** Opens a match's file at its line, as Quick Open's name:line:col does, with the match selected. */
  openResult(row, cx, toEditor) {
    const { file: rf, m } = row, st = this.stores.find((x) => idOf(x) === rf.id) ?? rf.st;
    const at = { line: m.line - 1, col: m.col }, key = `${st.root}|${rf.rel}`;
    cx.spawn(async (cx) => {
      await this.openFile(st, rf.rel, cx, at);
      const f = this.file();
      if (f && f.key === key && !this.treeOnly()) {
        // A long line's result text is a cut of it: find where the cut starts.
        const text = body(linesOf(f)[at.line] ?? ""), shift = Math.max(0, text.indexOf(m.text)), [a, b] = m.ranges[0] ?? [m.col, m.col];
        this.anchor = this.clampPos(f, { line: at.line, col: shift + a }); this.cur = this.clampPos(f, { line: at.line, col: shift + b });
        this.goalX = null; this.selA = this.selB = null; this.showCursor();
      }
      this.searchFocus = !toEditor;
      this.paint(cx);
    });
  }

  /** Keys while a Search box has the keyboard. Esc: back to the editor; Down (search box): into the results. */
  searchKey(k, cx, done) {
    if (k === "escape") { this.inBar = null; this.handle.focus(); this.paint(cx); return done(); }
    if (k === "down" && this.inBar === this.searchInput && this.searchRows().length) {
      const s = this.search, rows = this.searchRows(), i = Math.max(0, rows.findIndex((r) => r.key === s.sel));
      this.inBar = null; this.searchFocus = true; this.handle.focus();
      s.sel = rows[i].key; this.searchScroll.scroll_to_item(i); this.paint(cx);
      return done();
    }
    const id = this.kIdx.find.get(k), flag = { findCase: "cased", findWord: "word", findRegex: "regex" }[id];
    if (flag) { this.searchFlag(flag, cx); return done(); }
    if (id === "replaceAll") { this.askReplaceAll(cx); return done(); }
    if (this.kIdx.pane.get(k) === "searchFiles") return done();
  }

  /** Keys while the results have the keyboard. True: handled (other keys never type into the editor). */
  resultsKey(k, cx) {
    if (!this.searchShown() || !this.searchRows().length) { this.searchFocus = false; return false; }
    const go = {
      up: () => this.moveResult(-1, cx), down: () => this.moveResult(1, cx), enter: () => this.enterResult(cx),
      left: () => this.foldResult(false, cx), right: () => this.foldResult(true, cx),
      escape: () => { this.searchFocus = false; this.paint(cx); },
    }[k];
    if (go) { go(); return true; }
    const id = this.kIdx.pane.get(k);
    if (id) this.act(id, cx);
    return true;
  }

  /** The files Replace All can write: every result's file, on this computer or the space's machine. */
  replaceTargets() {
    return { files: this.search.results?.files ?? [] };
  }

  /** Replace All, first step: the confirm line. */
  askReplaceAll(cx) {
    const s = this.search;
    if (!s.results?.total || s.running || s.busy || !s.replace || !this.replaceTargets().files.length) return;
    s.confirm = true; s.note = null; this.paint(cx);
  }

  /** A file outside the review as Replace All reads it: its own baseline, like loadPlain. */
  async plainFile(st, rel) {
    const path = `${st.root}/${rel}`, text = await readTextFile(path, { on: st.on ?? null });
    if (typeof text !== "string") return null;
    const C = splitLines(text);
    return { rel, path, basePath: null, store: st, key: `${st.root}|${rel}`, plain: true, created: false, by: null, as: null, Btext: text, Ctext: text, B: C, C, hunks: [] };
  }

  /**
   * Replace All, confirmed. Each file is read again (a file under review with its baseline,
   * store.load), its matching lines are replaced as typed edits (searchview.replaceState: the review
   * rules for a user's edit apply), and it's written compare-and-swap like a save, with the same edit
   * note to the agent. A file changed since it was read is skipped and reported. Files with unsaved
   * edits in any copy block it. Afterwards open copies reload and the search runs again.
   */
  replaceAllFiles(cx) {
    const s = this.search, r = s.results, rep = s.replace;
    s.confirm = false;
    if (!r || s.running || s.busy) return;
    const { files } = this.replaceTargets();
    if (!files.length) return;
    const keys = files.map((f) => f.key);
    const held = [...new Set([...this.files.filter((f) => keys.includes(f.key) && this.dirty(f)).map((f) => f.key), ...this.heldElsewhere(keys)])];
    if (held.length) {
      s.note = { text: `Unsaved edits in ${held.map((k) => base(k.slice(k.indexOf("|") + 1))).join(", ")}: save or discard them first`, error: true };
      this.paint(cx); return;
    }
    s.busy = true; s.note = { text: "Replacing…", error: false }; this.paint(cx);
    // The job holds its own files and stores, and `s` is its space's Search state: a space switch
    // meanwhile neither waits for it nor gets its note (P7).
    const out = { n: 0, files: 0, skipped: [] }, space = this.spaceId;
    this.enqueue(async () => {
      const notes = [], indexes = new Map();
      for (const rf of files) {
        const st = rf.st;
        try {
          if (!indexes.has(st)) indexes.set(st, await st.index());
          const entry = indexes.get(st)[rf.rel];
          const f = entry ? await st.load(rf.rel, entry) : await this.plainFile(st, rf.rel);
          if (typeof f?.Ctext !== "string") { out.skipped.push(`${base(rf.rel)} (deleted)`); continue; }
          const [p] = replacePlan([{ rel: rf.rel, matches: rf.matches }], { [rf.rel]: f.Ctext }, r.opts, rep);
          if (!p) continue;
          const res = replaceState(f, p.text);
          if (!res) { out.skipped.push(`${base(rf.rel)} (its line count would change)`); continue; }
          const applied = [];
          try { for (const w of res.writes) applied.push(await st.apply(f, w)); }
          catch (e) { if (applied.length) await st.undo(applied).catch(() => {}); throw e; } // file and baseline go together
          notes.push(...res.writes.map((w) => this.editNote(f, w)).filter(Boolean));
          this.stateOf(space)?.deferred?.add(norm(f.path)); // open copies reload once the queue is done
          out.n += p.count; out.files++;
        } catch (e) {
          const msg = String(e?.message ?? e);
          out.skipped.push(`${base(rf.rel)} (${/changed since it was read/.test(msg) ? "changed since it was read" : msg})`);
        }
      }
      try { await this.sendEditNotes(notes); } catch (e) { log(`replace notes: ${e.message ?? e}`); }
    }, cx);
    const queued = this.queue;
    cx.spawn(async (cx) => {
      await queued;
      s.busy = false;
      const parts = [`Replaced ${many(out.n, "occurrence")} in ${many(out.files, "file")}`];
      if (out.skipped.length) parts.push(`skipped ${out.skipped.join(", ")}`);
      s.note = { text: parts.join("; "), error: out.skipped.length > 0 };
      if (this.search === s) this.runSearch(cx); else this.paint(cx);
    });
  }

  /**
   * The left column's tabs that fit `width` (barfit.fitBar): [id, label] in order. The Search key
   * hint goes first, then "Agent files" shortens to "Agent"; Explorer and Search always stay.
   */
  leftTabs(width) {
    const items = [
      { id: "explorer", labels: ["Explorer"], drop: Infinity, size: 11.5, pad: 16 },
      { id: "search", labels: [withKey("Search", this.kl("searchFiles")), "Search"], drop: Infinity, size: 11.5, pad: 16 },
      { id: "agent", labels: ["Agent files", "Agent files", "Agent"], drop: Infinity, size: 11.5, pad: 16 }, // keeps its full label while only the Search key goes
      { id: "problems", labels: [`Problems ${this.problems.count()}`], drop: Infinity, size: 11.5, pad: 16 },
    ];
    const fit = fitBar(width, items, 12, 2);
    return items.filter((it) => fit.has(it.id)).map((it) => [it.id, fit.get(it.id)]);
  }

  /** The Edit tab's left column: the Explorer / Search / Agent files switch over the tree, the Search view or the agent's files. */
  /** The Changes view's sides for the pane's width now (columns.js). */
  changesCols() { return layoutOf(this.paneW == null ? 0 : this.px(this.paneW), WANT.changes, this.chgSide === "content" ? "content" : "left"); }

  /** The Edit view's sides with the tree on (columns.js); `any`: whether one side shows at a time, whatever is picked. */
  editCols(any = false) {
    const wide = this.search.left === "search" || this.search.left === "problems"; // the wider column
    return layoutOf(this.paneW == null ? 0 : this.px(this.paneW), wide ? WANT.editWide : WANT.edit, any || this.narrowLeft ? "left" : "content");
  }

  renderLeft(t, full = false, cols = null) {
    const single = !full && !!cols?.single;
    this.leftW = full ? this.px(this.paneW) : cols?.leftW ?? WANT.edit; // problemsview fits its buttons to it
    const tab = (id, label, here) => div().id(`left-${id}`).h(22).px(8).flex().items_center().rounded(4).text_size(11.5).cursor_pointer()
      .text_color(here ? t.foreground : t.muted).when(here, (e) => e.bg(t.selected)).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => this.setLeft(id, cx)).child(label);
    return v_flex().id("left-column").h_full().min_h(0)
      .when(full || single, (e) => e.flex_1().min_w(0)).when(!full && !single, (e) => e.w(this.leftW).flex_none().border_r(1).border_color(t.border))
      .child(h_flex().h(30).flex_none().px(6).gap(2).items_center().border_b(1).border_color(t.border)
        .children(this.leftTabs(this.leftW).map(([id, label]) => tab(id, label, this.search.left === id))))
      .child(this.search.left === "search" ? this.renderSearch(t) : this.search.left === "problems" ? this.problems.render(t) : this.search.left === "agent" ? this.agentFiles.render(t) : this.renderTree(t, full));
  }

  renderSearch(t) {
    const s = this.search, r = s.results, rows = this.searchRows(), multi = this.repos().length > 1;
    const chip = (id, label, on, flip) => div().id(id).h(22).px(6).flex().flex_none().items_center().rounded(4).text_size(11).cursor_pointer()
      .bg(on ? t.accent + "77" : t.raised).hover((st) => st.opacity(0.85)).on_click((_e, cx) => flip(cx)).child(label);
    const label = (text) => div().text_size(10.5).text_color(t.dim).child(text);
    const sum = summaryOf({ running: s.running, results: r, repos: this.repos().length, plain: this.stores.filter((x) => x.plain).length });
    const preview = !!s.replace && !!r?.total, { files: targets, remote } = this.replaceTargets();
    return v_flex().id("search-view").flex_1().min_h(0)
      .child(v_flex().flex_none().px(6).pt(6).pb(4).gap(4)
        .child(h_flex().gap(4).items_center()
          .child(div().id("search-more").w(16).h(22).flex().flex_none().items_center().justify_center().rounded(4).text_size(10).text_color(t.dim).cursor_pointer()
            .hover((st) => st.bg(t.hover)).on_click((_e, cx) => { s.more = !s.more; this.paint(cx); }).child(s.more ? "▾" : "▸"))
          .child(div().flex_1().min_w(0).child(Input.new(this.searchInput)))
          .child(chip("search-cased", "Aa", s.opts.cased, (cx) => this.searchFlag("cased", cx)))
          .child(chip("search-word", "W", s.opts.word, (cx) => this.searchFlag("word", cx)))
          .child(chip("search-regex", ".*", s.opts.regex, (cx) => this.searchFlag("regex", cx))))
        .when(s.more, (e) => e.child(v_flex().pl(20).gap(4)
          .child(Input.new(this.sReplaceInput))
          .child(label("files to include")).child(Input.new(this.includeInput))
          .child(label("files to exclude")).child(Input.new(this.excludeInput)))))
      .child(h_flex().flex_none().min_h(24).px(8).gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(11).text_color(sum.error ? t.ansi1 : t.muted).child(sum.text))
        .when(preview && targets.length > 0 && !s.confirm && !s.busy && !s.running, (e) => e.child(this.button("search-replace-all", "Replace All", t.raised, (cx) => this.askReplaceAll(cx)).flex_none())))
      .when(!!s.confirm, (e) => e.child(v_flex().flex_none().mx(6).mb(4).p(8).gap(6).rounded(6).bg(t.raised).text_size(11)
        .child(div().text_color(t.foreground).child(`Replace ${many(occurrences(targets), "occurrence")} in ${many(targets.length, "file")}?`))
        .when(remote > 0, (e) => e.child(div().text_color(t.dim).child(`${many(remote, "file")} on another machine left out: saving there isn't built yet.`)))
        .child(h_flex().gap(6)
          .child(this.button("search-replace-yes", "Replace", t.ansi1 + "55", (cx) => this.replaceAllFiles(cx)))
          .child(this.button("search-replace-no", "Cancel", t.background, (cx) => { s.confirm = false; this.paint(cx); })))))
      .when(preview && !targets.length, (e) => e.child(div().flex_none().px(8).pb(4).text_size(11).text_color(t.dim).child("Replace isn't available for files on other machines yet")))
      .when(!!s.note, (e) => e.child(div().flex_none().px(8).pb(4).text_size(11).text_color(s.note.error ? t.ansi1 : t.dim).child(s.note.text)))
      .child(div().id("search-results").flex_1().min_h(0).relative().overflow_hidden()
        .on_size_change((size, cx) => { if (Math.abs((this.searchH ?? 0) - size.height) > 0.5) { this.searchH = size.height; this.paint(cx); } })
        .when(rows.length > 0, (e) => e
          .child(v_virtual_list("search-rows", rows.length, SROW, (i) => rows[i].key,
            (range) => rows.slice(range.start, range.end).map((row) => this.searchRow(row, t, multi, preview)))
            .w_full().h(Math.max(SROW, this.searchH ?? 300)).track_scroll(this.searchScroll)
            .on_item_click((key, cx) => this.clickResult(key, cx)))
          .child(Scrollbar.vertical("search-rows").viewport_from_layout().absolute().inset_0())));
  }

  /** One result row (inside the virtual list: no handlers here, clicks come through on_item_click). */
  searchRow(row, t, multi, preview) {
    const s = this.search, on = row.key === s.sel, selBg = this.searchFocus ? t.selected : t.hover;
    if (row.kind === "file") {
      const f = row.file, cut = f.rel.lastIndexOf("/") + 1;
      return h_flex().w_full().h(SROW).px(6).gap(4).items_center().whitespace_nowrap().cursor_pointer()
        .when(on, (e) => e.bg(selBg))
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(s.collapsed.has(f.key) ? "▸" : "▾"))
        .child(div().flex_none().text_size(12).child(f.rel.slice(cut)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child((multi ? this.repoName(f.st) + (cut ? "/" : "") : "") + f.rel.slice(0, Math.max(0, cut - 1))))
        .child(div().flex_none().px(5).rounded(8).bg(t.raised).text_size(10).text_color(t.muted).child(fmt(occurrences([f]))));
    }
    const m = row.m, pieces = matchPieces(m.text, m.ranges, preview ? { opts: s.results.opts, replace: s.replace } : null);
    return h_flex().w_full().h(SROW).pl(22).pr(6).items_center().overflow_hidden().whitespace_nowrap().text_size(12).cursor_pointer()
      .when(on, (e) => e.bg(selBg))
      .children(pieces.map((p) => {
        const d = div().flex_none().child(p.text);
        if (p.kind === "hit") return d.bg(t.ansi3 + "55").rounded(2);
        if (p.kind === "old") return d.bg(t.ansi1 + "40").text_color(t.ansi1).line_through();
        if (p.kind === "new") return d.bg(t.ansi2 + "40").text_color(t.ansi2);
        return d.text_color(t.muted);
      }));
  }

  // ---- bracket matching ---------------------------------------------------------

  /**
   * The bracket pair beside the cursor in the current file, or null (also while text is selected).
   * Worked out again only when the cursor, the text or its highlighting changed. Brackets in strings
   * and comments don't count, as the highlighter's tokens tell (brackets.tokenSkip).
   */
  bracketPair(f) {
    if (!f || f.error || f.Ctext === null || !this.cur || this.hasTextSel()) return null;
    const c = this.cur, m = this.bmMemo;
    if (m && m.C === f.C && m.tok === f.newTok && m.line === c.line && m.col === c.col) return m.pair;
    const lines = linesOf(f), skip = tokenSkip(f.newTok, lines);
    let pair = matchBracket(lines, c, { skip });
    if (pair && (skip(pair.open.line, pair.open.col) || skip(pair.close.line, pair.close.col))) pair = null; // a bracket in a string
    this.bmMemo = { C: f.C, tok: f.newTok, line: c.line, col: c.col, pair };
    return pair;
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

  // ---- format on save ----------------------------------------------------------

  /** ctrl-s and the Save button: formats first when Settings has Format on save on. Autosave never does (save). */
  saveKey(cx) { if (this.settings.formatOnSave) this.formatThenSave(cx, false); else this.save(cx, this.file(), true); }

  /** The format command (alt-shift-f): format and save, whatever Format on save says. */
  formatNow(cx) { this.formatThenSave(cx, true); }

  /**
   * Formats the current file with the repo's formatter (formatrun.js), applies the result as one undo
   * step, then saves. A formatter that is missing or fails never blocks the save: the buffer is
   * saved as it is, with a one-line notice. A result is only applied to a buffer that hasn't changed
   * since the format began.
   */
  formatThenSave(cx, explicit) {
    const f = this.file();
    if (!f) return;
    const canEdit = this.editable(f) && this.view !== "review" && this.mode !== "changes" && !this.nvim() && !!f.store;
    if (!canEdit || f.conflict) {
      if (explicit && !f.conflict) { this.error = "Format works on a file open in the Edit view"; this.paint(cx); return; }
      return this.save(cx, f, true);
    }
    const space = this.spaceId, key = f.key, text = f.Ctext, mark = `${space}|${key}`;
    if (this.formatting.has(mark)) return;
    if (this.fmtNote && this.error === this.fmtNote) this.error = null; // the last format's notice goes when the next one starts
    this.fmtNote = null;
    this.formatting.add(mark);
    if (!this.fmtCaches.has(space)) this.fmtCaches.set(space, newFormatCache());
    const cache = this.fmtCaches.get(space), { root, on = null } = f.store, rel = f.rel;
    cx.spawn(async (cx) => {
      let r;
      try { r = await formatText({ root, on, rel, text, cache }); } catch (e) { r = { status: "failed", reason: String(e?.message ?? e).slice(0, 200) }; }
      this.formatting.delete(mark);
      try { this.finishFormat(space, key, text, r, explicit, cx); }
      catch (e) { // the buffer still holds the user's text: save it as it is
        failIn(this, space, `Not formatted (${String(e?.message ?? e).slice(0, 120)}). Saved as is`);
        const g = space === this.spaceId ? this.files.find((x) => x.key === key) : null;
        if (g) this.save(cx, g, true);
        this.paint(cx);
      }
    });
  }

  /** A format ended: apply it when the buffer is as it was, save, and say what didn't work. */
  finishFormat(space, key, text, r, explicit, cx) {
    if (space !== this.spaceId) { failIn(this, space, "Format finished after you left this space: not applied, not saved"); this.paint(cx); return; }
    const g = this.files.find((x) => x.key === key);
    if (!g) return;
    let msg = r.leftover ? `Could not remove the temp file ${r.leftover}` : null;
    if (g.Ctext !== text) msg = "Not formatted: the file changed while the formatter ran. Saved as is";
    else if (r.status === "failed") msg = `Not formatted (${r.reason}). Saved as is`;
    else if (r.status === "none") { if (explicit) msg = r.ignoredBy ? `${r.ignoredBy} ignores ${base(g.rel)}. Saved as is` : `No formatter for ${base(g.rel)} in this repo. Saved as is`; }
    else if (r.status === "ok") {
      const shown = this.sel === key;
      // Highlighting a big result line by line in one go could run too long for Herdr's script runtime:
      // past 300 lines the new lines start plain and retokenize (chunked) colours them a moment later.
      const lang = languageOf(g.rel, body(linesOf(g)[0] ?? "")), big = r.text.split("\n").length > 300;
      const res = applyFormat(g, r.text, big ? (ls) => ls.map((l) => packSpans(l ? [{ text: l, type: null }] : [])) : (ls) => highlightLines(ls, lang), shown ? this.cur : null);
      if (!res) msg = `Not formatted (${r.tool} gave a result Wingman could not apply). Saved as is`;
      else if (!res.same) {
        // One undo step for the whole format.
        this.history.push({ edit: true, key, state: bare(g), cur: this.cur, at: Date.now(), group: false }); capSteps(this.history);
        this.redo = [];
        res.state.edited = true;
        this.replace(g, res.state);
        if (shown && res.cursor) { this.cur = res.cursor; this.anchor = null; this.selA = this.selB = null; this.goalX = null; }
        this.settle(); if (shown) this.showCursor(); this.retokenize(cx);
      }
    }
    this.save(cx, this.files.find((x) => x.key === key), true);
    if (msg) { failIn(this, space, msg); this.fmtNote = msg; }
    this.paint(cx);
  }

  save(cx, f = this.file(), explicit = false) {
    if (!f) return;
    if (f.conflict) { this.error = "The file changed on disk while you were editing: pick Keep mine or Take agent's first"; this.paint(cx); return; }
    const writes = this.saveWrites(f);
    if (!writes.length) { if (explicit) this.problems.saved(f, this.queue, cx); return; } // Ctrl+S on a saved file checks it again
    const notes = writes.map((w) => this.editNote(f, w)).filter(Boolean);
    this.replace(f, { ...f, diskC: f.Ctext, diskB: f.Btext });
    this.paint(cx);
    const space = this.spaceId;
    this.enqueue(async () => {
      let done = 0;
      try { for (const w of writes) { await f.store.apply(f, w); done++; } await this.sendEditNotes(notes); }
      catch (e) {
        // Memory still holds the edits: whatever didn't reach disk counts as unsaved again (in the
        // file's own space, which may not be the one shown now).
        const g = this.stateOf(space)?.files?.find((x) => x.key === f.key);
        if (g) for (const w of writes.slice(done)) g[w.target === "baseline" ? "diskB" : "diskC"] = w.before;
        throw e;
      }
    }, cx);
    if (explicit) this.problems.saved(f, this.queue, cx); // its checkers run once this write is done
  }

  /** Q45: a passive note to the agent that changed a file, naming the lines a save changed. */
  editNote(f, w) {
    if (!f.by || !this.settings.editNote || w.target !== "current" || w.before === null || w.after === null) return null;
    const on = f.store?.on ?? null;
    if (on && hookKnown(on) === false) return null; // delivered by the Claude hook, not installed there
    const r = changedRanges(w.before, w.after);
    if (!r.length) return null;
    const at = r.slice(0, 6).map((h) => (!h.nc ? `lines removed at ${h.n + 1}` : h.nc === 1 ? `line ${h.n + 1}` : `lines ${h.n + 1}-${h.n + h.nc}`));
    if (r.length > 6) at.push(`${r.length - 6} more places`);
    return { key: f.key, terminal: f.by, path: f.as ?? agentPath(f.path, f.by), at: at.join(", "), on };
  }

  /** Queues edit notes. A file's earlier note the agent hasn't read yet is replaced, not repeated. */
  async sendEditNotes(notes) {
    for (const n of notes) {
      const prev = this.editNotes.get(n.key), earlier = !!prev && await this.noteToClaude(prev, () => withdrawFeedback(prev.terminal, prev.text, { on: prev.on }));
      const text = `Code review: the user edited ${n.path} (${n.at}${earlier ? ", plus earlier edits" : ""}). Read the file again before you change it.`;
      if ((await this.noteToClaude(n, () => queueFeedback(n.terminal, text, { on: n.on }))) === false) continue;
      this.editNotes.set(n.key, { terminal: n.terminal, text, on: n.on });
    }
  }

  /** Conflict banner: overlapping lines take mine or the agent's; the rest of both is kept. */
  resolve(how, cx) {
    const f = this.file(), k = f?.conflict;
    if (!k) return;
    if (!k[how]) { this.cur = this.anchor = null; cx.spawn(async (cx) => this.reloadOne({ ...f, conflict: null }, cx)); return; }
    cx.spawn(async (cx) => {
      const next = await this.merged(k.nf, k[how].Ctext, k[how].Btext, cx);
      if (this.files.includes(f)) { this.adoptMerge(f, next); this.paint(cx); }
    });
  }

  // ---- input ---------------------------------------------------------------

  /** Each scope's key -> action lookup, rebuilt when the user's shortcuts change. */
  setKeymap(overrides) {
    this.keymap = resolve(overrides);
    this.kIdx = { edit: index(this.keymap, "edit"), pane: index(this.keymap, "pane"), find: index(this.keymap, "find"), tree: index(this.keymap, "tree") };
  }

  /** The first key bound to an action, for buttons and menus ("" when it has none). */
  kl(id) { return keyLabel(this.keymap.get(id)?.[0]); }

  /** What has the keyboard, for allowedIn (keymap.js): a box (by kind), Search's results, the tree, else the editor. */
  focusKind() {
    const b = this.inBar;
    if (b) return b === this.quickInput ? "quick" : b === this.commitInput ? "commit" : b === this.pathInput ? "path" : b === this.inlineInput ? "inline"
      : b === this.treeInput ? "treeName" : this.searchInputs?.includes(b) ? "search" : "find";
    return this.searchFocus || this.problemsFocus ? "results" : this.treeFocus ? "tree" : "editor";
  }

  /**
   * Runs action `id` if what has the keyboard allows it (allowedIn), the same for a key and for a
   * Herdr command: a box that has the keyboard keeps actions off the file and tree behind it. In a
   * Search box its find keys toggle Search's options; in Quick Open its key moves down the list.
   */
  act(id, cx) {
    const focus = this.focusKind();
    if (!allowedIn(id, focus)) return false;
    if (focus === "search") {
      const flag = { findCase: "cased", findWord: "word", findRegex: "regex" }[id];
      if (flag) this.searchFlag(flag, cx); else if (id === "replaceAll") this.askReplaceAll(cx);
      return true;
    }
    if (focus === "quick") { this.moveQuick(1, cx); return true; }
    if (focus === "results") { this.searchFocus = false; this.problemsFocus = false; } // the action has the keyboard back in the editor
    this.runAction(id, cx);
    return true;
  }

  /** Runs one action by id (a key, a "mod:wingman" binding, or a command); act checks the focus first. */
  runAction(id, cx) {
    const f = this.file();
    const go = {
      accept: () => this.decide("accept", cx), reject: () => this.decide("reject", cx),
      acceptFile: () => this.wholeFile("accept", cx), rejectFile: () => this.wholeFile("reject", cx),
      nextChange: () => this.step(1, cx), prevChange: () => this.step(-1, cx),
      comment: () => this.askPrompt(this.current, cx), reason: () => this.askReason(cx),
      addComment: () => this.commentHere(cx), commentList: () => this.openCommentList(),
      nextFile: () => this.stepFile(1, cx), prevFile: () => this.stepFile(-1, cx),
      quickOpen: () => this.openQuick(cx), toggleView: () => this.setMode(this.nextView(), cx),
      toggleTree: () => this.toggleTree(cx), openInVSCode: () => this.toVSCode(cx), toggleWrap: () => this.toggleWrap(cx),
      openInNvim: () => { if (f) this.toNvim(f, this.cur?.line ?? f.hunks[this.current]?.n ?? 0, cx); },
      save: () => this.saveKey(cx), formatFile: () => this.formatNow(cx), undo: () => this.undo(cx), redo: () => this.redoEdit(cx), inlineEdit: () => this.openInline(cx),
      selectAll: () => this.clip("all", cx), copy: () => this.clip("copy", cx), cut: () => this.clip("cut", cx), paste: () => this.clip("paste", cx),
      moveLineUp: () => this.lineOp("moveUp", cx), moveLineDown: () => this.lineOp("moveDown", cx),
      copyLineUp: () => this.lineOp("copyUp", cx), copyLineDown: () => this.lineOp("copyDown", cx),
      deleteLine: () => this.lineOp("delete", cx), joinLines: () => this.lineOp("join", cx), toggleComment: () => this.lineOp("comment", cx),
      find: () => this.openFind("find", cx), replace: () => this.openFind("replace", cx), goToLine: () => this.openFind("line", cx),
      findNext: () => this.findStep(1, cx), findPrev: () => this.findStep(-1, cx),
      findCase: () => this.findFlag("cased", cx), findWord: () => this.findFlag("word", cx), findRegex: () => this.findFlag("regex", cx),
      replaceAll: () => this.replaceAll(cx), searchFiles: () => this.openSearch(cx),
      // Problems: Check runs in the owner copy (another copy's key asks it through PROBLEMS_REQ).
      checkProblems: () => (this.problems.owner() ? this.problems.checkNow(cx) : setShared(PROBLEMS_REQ, { space: this.spaceId, stamp: Date.now() })),
      nextProblem: () => this.problems.owner() && this.problems.step(1, cx), prevProblem: () => this.problems.owner() && this.problems.step(-1, cx),
      // Only while the tree has the keyboard (Delete in the editor deletes text), and never while a
      // name box is open: F2 there would start the rename again and drop what was typed.
      renameItem: () => { if (this.treeFocus && this.treeCur && !this.treeEdit && !this.inBar) this.startTreeEdit("rename", this.treeCur, cx); },
      deleteItem: () => { if (this.treeFocus && this.treeCur && !this.treeEdit && !this.inBar) this.askTreeDelete(this.treeCur, cx); },
    }[id];
    go?.();
  }

  /** Select all, copy, cut, paste: on the text cursor's file only. */
  clip(how, cx) {
    const f = this.file();
    if (!this.cur || !this.editable(f)) return;
    const lines = linesOf(f), c = this.cur, sel = this.hasTextSel(), lineEnd = (l) => ({ line: l, col: body(lines[l]).length });
    if (how === "all") { this.anchor = { line: 0, col: 0 }; this.cur = lineEnd(lines.length - 1); this.paint(cx); return; }
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
    if (this.commitInput && this.inBar === this.commitInput) return; // the commit message box types its own keys
    if (this.inBar === this.pathInput) { if (k === "escape") { this.ws = null; this.inBar = null; this.handle.focus(); this.paint(cx); done(); } return; }
    // The inline edit box: Esc closes it (and cancels a running edit); Enter (submit) runs it.
    if (this.inlineInput && this.inBar === this.inlineInput) { if (k === "escape") { this.closeInline(cx); done(); } return; }
    // The tree's name box: Esc cancels; Enter (submit) does it; every other key types.
    if (this.treeInput && this.inBar === this.treeInput) { if (k === "escape") { this.endTreeEdit(cx); done(); } return; }
    // A Search box has the keyboard (searchKey); then the results, after Down or a click (resultsKey).
    if (this.inBar && this.searchInputs?.includes(this.inBar)) return this.searchKey(k, cx, done);
    // The find bar has the keyboard: Esc, the bar's own actions, and switching between find, replace and line.
    if (this.inBar) {
      if (k === "escape") { this.closeFind(cx); return done(); }
      const id = this.kIdx.find.get(k) ?? this.kIdx.pane.get(k);
      if (id && this.act(id, cx)) done();
      return;
    }
    if (this.searchFocus && this.resultsKey(k, cx)) return done();
    if (this.problemsFocus && this.problems.key(k, cx)) return done();
    if (this.treeFocus && this.treeKey(e, cx)) return done();
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
      this.keySearch.on("change", (_e, cx) => this.paint(cx));
      cx.spawn(async (cx) => {
        this.overrides = await loadKeys(); this.km = resolve(this.overrides);
        this.herdr = herdrGlobal((await readTextFile(`${appHome()}/keys.json`)) ?? "{}"); this.paint(cx);
      });
      return;
    }
    if (this.form.form === "settings") {
      this.formHandle = cx.focus_handle(); this.formHandle.focus();
      // The custom editor command saves half a second after typing stops.
      this.extInput = InputState.new({ placeholder: "Command, e.g. idea --line {line} {path}" });
      this.extInput.on("change", (_e, cx) => {
        const v = this.extInput.value(); this.extTyped = v;
        cx.timer.after(500, (cx) => { if (this.extTyped === v && v !== (this.st?.externalCommand ?? "")) this.setSetting({ externalCommand: v }, cx); });
      });
      // The inline edit command, saved the same way.
      this.ieInput = InputState.new({ placeholder: INLINE_COMMAND });
      this.ieInput.on("change", (_e, cx) => {
        const v = this.ieInput.value(); this.ieTyped = v;
        cx.timer.after(500, (cx) => { if (this.ieTyped === v && v !== (this.st?.inlineCommand ?? "")) this.setSetting({ inlineCommand: v }, cx); });
      });
      // The Problems command of the picked repo, saved the same way.
      this.pcRepo = this.form.repos?.[0]?.id ?? null;
      this.pcInput = InputState.new({ placeholder: "e.g. npx vue-tsc --noEmit, or ruff check --output-format concise {file}" });
      this.pcInput.on("change", (_e, cx) => {
        const v = this.pcInput.value(), repo = this.pcRepo; this.pcTyped = v;
        cx.timer.after(500, (cx) => { if (this.pcTyped === v && repo === this.pcRepo && v !== (this.st?.problemsCommands?.[repo]?.command ?? "")) this.setProblemsCommand(repo, { command: v }, cx); });
      });
      cx.spawn(async (cx) => { this.st = await loadSettings(); this.extInput.set_value?.(this.st.externalCommand ?? ""); this.ieInput.set_value?.(this.st.inlineCommand ?? INLINE_COMMAND); this.pcInput.set_value?.(this.st.problemsCommands?.[this.pcRepo]?.command ?? ""); this.paint(cx); });
      if (this.form.machine) this.hookAction(null, cx);
      // Its sections as commands, for keys and tests: wingman.settingsTab:general | editing | inline | problems | machine.
      cx.spawn(async (cx) => {
        for (;;) {
          const c = String(await nextCommand()).replace(/^wingman\./, "");
          if (c.startsWith("settingsTab:")) { this.setTab = c.slice("settingsTab:".length); this.paint(cx); }
        }
      });
      return;
    }
    if (this.form.form === "comment") return this.initCommentForm(cx);
    if (this.form.form === "comments") return this.initCommentList(cx);
    if (this.form.form === "checkpoints") return this.initCheckpoints(cx);
    this.text = "";
    // A text area: Enter adds a line, Ctrl+Enter sends (also caught on the form, in case the
    // text area doesn't report it as a submit).
    this.input = TextareaState.new({ placeholder: this.form.form === "reason" ? "Why it was rejected" : "What should the agent do here?", rows: 3 });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.paint(cx); });
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
        if (form === "reason") await queueFeedback(terminal, `Code review: the user's comment on rejecting ${where} in ${file}: ${text}`, { on: this.form.on ?? null });
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

  // ---- review comment dialogs (forms "comment" and "comments") ------------------
  // Their own copies of the mod: they read and write the space's comments file themselves and tell
  // the pane copies through COMMENTS.

  initCommentForm(cx) {
    this.text = this.form.text ?? "";
    // One line: Enter saves (submit), Esc cancels.
    this.input = InputState.new({ placeholder: "What should the agent change here?", value: this.text });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.formError = null; this.paint(cx); });
    this.input.on("submit", (_e, cx) => this.saveComment(cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.formHandle = cx.focus_handle();
  }

  saveComment(cx) {
    const { space, draft, id, overlay } = this.form;
    if (this.sending) return;
    const made = id ? checkText(this.text) : makeComment(draft, this.text);
    if (made.error) { this.formError = made.error; this.paint(cx); return; }
    this.sending = true; this.paint(cx);
    // Write first, close after: closing ends this copy, and its unfinished work with it.
    cx.spawn(async (cx) => {
      try {
        await changeComments(space, (s) => (id ? editComment(s, id, this.text) : addComment(s, made.comment)));
        closeOverlay(overlay);
      } catch (e) { this.formError = String(e.message ?? e); this.sending = false; this.paint(cx); }
    });
  }

  /** Where a comment is, as the dialogs show it: its file in the repo and its lines. */
  commentWhere(c, repo = false) {
    return `${repo && c.repo ? `${c.repo} · ` : ""}${c.rel ?? c.path ?? ""}:${c.start === c.end ? c.start : `${c.start}-${c.end}`}`;
  }

  snippetBox(id, lines, t) {
    return v_flex().id(id).flex_none().px(8).py(4).rounded(6).bg(t.background).font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted)
      .children(lines.map((l, i) => div().id(`${id}-${i}`).w_full().min_w(0).truncate().child(`> ${l}`)));
  }

  renderCommentForm() {
    const t = theme(), { draft, id, overlay } = this.form, d = draft ?? {}, n = this.text.trim().length;
    const title = id ? "Edit review comment" : d.kind === "rejected" ? "Rejected: tell the agent why" : "Add review comment";
    return v_flex().id("comment-form").track_focus(this.formHandle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(overlay); cx.stop_propagation(); } })
      .size_full().min_h(0).p(18).gap(8).bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().items_center().child(div().flex_1().text_size(15).font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).truncate().child(`${this.commentWhere(d, true)}${d.kind === "rejected" ? " · the change you rejected" : ""}`))
      .when(!!d.snippet?.length, (e) => e.child(this.snippetBox("comment-snippet", d.snippet, t)))
      .child(div().flex_none().child(Input.new(this.input)))
      .when(!!this.formError, (e) => e.child(div().flex_none().text_size(11.5).text_color(t.ansi1).child(this.formError)))
      .child(div().flex_1())
      .child(h_flex().flex_none().items_center().gap(8)
        // Wraps (min_w 0) rather than pushing the count and Save out of the dialog.
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim).child("Enter saves, Esc cancels. Comments wait in the Comments list until you send them."))
        .child(div().flex_none().text_size(11).text_color(n > MAX_COMMENT ? t.ansi1 : t.dim).child(`${n}/${MAX_COMMENT}`))
        .child(div().id("comment-save").flex_none().whitespace_nowrap().h(30).px(14).flex().items_center().rounded(8).bg(t.solid).text_color(t.solid_foreground).text_size(12.5).cursor_pointer()
          .when(!!this.sending, (e) => e.opacity(0.5)).on_click((_e, cx) => this.saveComment(cx)).child("Save  ⏎")));
  }

  initCommentList(cx) {
    this.formHandle = cx.focus_handle(); this.formHandle.focus();
    this.cs = null; this.cSeen = null; this.branches = new Map(); this.note = null; this.pickList = null; this.confirmTo = null; this.busy = null; this.editing = null;
    this.editInput = InputState.new({ placeholder: "Comment" });
    this.editInput.on("submit", (_e, cx) => this.saveEdit(cx));
    this.loadCommentList(cx);
    cx.timer.every(400, (cx) => this.loadCommentList(cx));
  }

  /** Reads the space's comments when they changed (COMMENTS), then each repo's branch for the prompt (once). */
  loadCommentList(cx) {
    const space = this.form.space, stamp = shared(COMMENTS)?.[space] ?? 0;
    if (this.cListLoading || (this.cs && stamp === this.cSeen)) return;
    this.cListLoading = true; this.cSeen = stamp;
    cx.spawn(async (cx) => {
      try { this.cs = await loadComments(cmtIo, cmtDir(), space); }
      catch (e) { this.note = `Comments not read: ${e.message ?? e}`; this.cs ??= { v: 1, comments: [], undo: null }; }
      finally { this.cListLoading = false; }
      this.paint(cx);
      for (const c of this.cs.comments) {
        if (!c.root || this.branches.has(c.root)) continue;
        this.branches.set(c.root, null);
        try {
          const r = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: c.root, on: c.on ?? null, timeout: 5000 });
          const b = r.code === 0 ? r.stdout.trim() : "";
          if (b) this.branches.set(c.root, b === "HEAD" ? "detached HEAD" : b);
        } catch {} // not a git repo (a plain folder), or the machine didn't answer: no branch in the header
      }
      this.paint(cx);
    });
  }

  /** Applies `op` to the space's comments from the dialog; `done` is the note shown after. */
  listChange(op, cx, done = null) {
    const space = this.form.space;
    if (this.busy) return;
    cx.spawn(async (cx) => {
      try { this.cs = await changeComments(space, op); this.cSeen = shared(COMMENTS)?.[space] ?? 0; this.note = done; }
      catch (e) { this.note = String(e.message ?? e); }
      this.paint(cx);
    });
  }

  startEdit(c, cx) { this.editing = c.id; this.editInput.set_value(c.text); this.editInput.focus(); this.note = null; this.paint(cx); }

  saveEdit(cx) {
    const id = this.editing, text = this.editInput.value(), v = checkText(text);
    if (!id) return;
    if (v.error) { this.note = v.error; this.paint(cx); return; }
    this.editing = null;
    this.listChange((s) => editComment(s, id, text), cx);
    this.formHandle.focus();
  }

  /** Why Send can't work for this space now, or null: its machine is unreachable. */
  sendBlocked() {
    const sp = spaces().find((s) => s.id === this.form.space);
    if (!sp) return "This space is gone";
    const m = sp.machine;
    if (m && machines().find((x) => x.name === m)?.layout === "unavailable") return `${m} isn't reachable now, so its agents can't be sent to`;
    return null;
  }

  /** chooseTarget for the dialog's space: { address } | { pick } | { error }. */
  commentTarget() {
    const here = agents().filter((a) => a.space === this.form.space);
    const live = new Set(terminals().filter((x) => x.state === "live").map((x) => x.address));
    return chooseTarget(this.cs?.comments ?? [], here, live);
  }

  /** The prompt for `cs`, paths as agent `address` sees them (relative to its folder when inside it). */
  promptFor(cs, address) {
    const term = address ? terminals().find((x) => x.address === address) : null;
    const cwd = address ? panes().find((p) => p.terminal === address)?.cwd ?? term?.cwd ?? null : null;
    const repos = new Map();
    for (const c of cs) if (c.root && !repos.has(c.root)) repos.set(c.root, { name: c.repo ?? base(c.root), branch: this.branches.get(c.root) ?? null });
    return buildPrompt(cs, { repos, cwd, wsl: isWslArgv(term?.argv), target: address });
  }

  startSend(cx) {
    if (this.busy || !this.cs?.comments.length) return;
    const why = this.sendBlocked();
    if (why) { this.note = why; this.paint(cx); return; }
    const ch = this.commentTarget();
    this.confirmTo = null; this.pickList = null;
    if (ch.error) this.note = ch.error;
    else if (ch.pick) this.pickList = ch.pick.map((a) => a.address);
    else return this.toTarget(ch.address, cx);
    this.paint(cx);
  }

  /** A working agent asks first (confirmTo); otherwise the comments go now. */
  toTarget(address, cx) {
    this.pickList = null;
    const a = agents().find((x) => x.address === address);
    if (a && ACTIVE.has(a.status) && this.confirmTo !== address) { this.confirmTo = address; this.note = null; this.paint(cx); return; }
    this.confirmTo = null;
    this.sendNow(address, cx);
  }

  sendNow(address, cx) {
    const space = this.form.space, cs = (this.cs?.comments ?? []).slice(0, MAX_BATCH), ids = cs.map((c) => c.id);
    if (!cs.length || this.busy) return;
    const prompt = this.promptFor(cs, address), bad = promptProblem(prompt);
    if (bad) { this.note = bad; this.paint(cx); return; }
    const who = agentLabel(agents().find((a) => a.address === address) ?? { address }), many = `${cs.length} comment${cs.length === 1 ? "" : "s"}`;
    this.busy = `Sending ${many} to ${who}…`; this.note = null; this.paint(cx);
    cx.spawn(async (cx) => {
      let sent = false;
      try {
        await sendToAgent(hc, address, prompt);
        sent = true;
        this.cs = await changeComments(space, (s) => clearComments(s, "sent", Date.now(), ids));
        this.cSeen = shared(COMMENTS)?.[space] ?? 0;
        this.note = `Sent ${many} to ${who}. Undo clear puts them back in the list.`;
      } catch (e) { this.note = sent ? `Sent, but the list wasn't cleared: ${e.message ?? e}` : `Not sent: ${e.message ?? e}`; }
      this.busy = null; this.paint(cx);
    });
  }

  /** Copy prompt: the prompt on the clipboard, for pasting into an agent by hand. */
  copyPrompt(cx) {
    const cs = (this.cs?.comments ?? []).slice(0, MAX_BATCH);
    if (!cs.length) return;
    const address = this.commentTarget().address ?? null;
    cx.write_to_clipboard(this.promptFor(cs, address));
    this.note = address ? `Prompt copied, paths as ${agentLabel(agents().find((a) => a.address === address) ?? { address })} sees them` : "Prompt copied, with full paths (no single agent to send to)";
    this.paint(cx);
  }

  // ---- G4: the checkpoints dialog (props.form "checkpoints": { space, repos: [{ root, gitDir, on, name }] }) ----
  // Rows are turns (checkpoints.turnRows), newest first. A row picked shows its files (a click opens
  // one in Review, else Edit) and Restore to before this turn, which asks first. The restore runs
  // here (planRestore, applyRestore), so Esc waits while it runs.

  initCheckpoints(cx) {
    this.formHandle = cx.focus_handle(); this.formHandle.focus();
    this.dropSleeper = addSleeper((ms) => cx.sleep(ms)); // time limits on calls to another machine
    const repos = (Array.isArray(this.form.repos) ? this.form.repos : []).filter((r) => typeof r?.root === "string" && typeof r?.gitDir === "string");
    this.cp = { repos: repos.map((r) => { const store = new Store(r.root, r.gitDir, r.on ?? null); return { store, key: idOf(store), name: r.name || base(r.root) }; }),
      rows: null, sel: null, confirm: null, busy: null, note: null, loading: false };
    this.loadCheckpoints(cx);
    cx.timer.every(2000, (cx) => this.loadCheckpoints(cx));
    // Commands for keys and tests: wingman.cpNext / cpPrev / cpOpen / cpRestore / cpConfirm / cpCancel.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^wingman\./, "");
        this.cpCommand(c, cx);
        this.paint(cx);
      }
    });
  }

  /** Reads every repo's checkpoints.json again (not while a restore is asked or runs). */
  loadCheckpoints(cx) {
    const cp = this.cp;
    if (!cp || cp.loading || cp.busy || cp.confirm) return;
    cp.loading = true;
    cx.spawn(async (cx) => {
      try {
        const repos = [];
        for (const r of cp.repos) repos.push({ key: r.key, name: r.name, data: parseCheckpoints(await r.store.read(`${r.store.dir}/checkpoints.json`).catch(() => null)) });
        cp.rows = turnRows(repos, this.form.space);
        if (!cp.rows.some((x) => x.id === cp.sel)) cp.sel = cp.rows[0]?.id ?? null;
      } catch (e) { cp.note = `Checkpoints not read: ${e.message ?? e}`; cp.rows ??= []; }
      finally { cp.loading = false; }
      this.paint(cx);
    });
  }

  cpRow() { return this.cp?.rows?.find((r) => r.id === this.cp.sel) ?? null; }

  cpCommand(c, cx) {
    const cp = this.cp, rows = cp?.rows ?? [];
    if (!cp) return;
    const at = rows.findIndex((r) => r.id === cp.sel);
    const go = {
      cpNext: () => { if (!cp.busy && rows.length) { cp.sel = rows[Math.min(rows.length - 1, at + 1)].id; cp.confirm = null; } },
      cpPrev: () => { if (!cp.busy && rows.length) { cp.sel = rows[Math.max(0, at - 1)].id; cp.confirm = null; } },
      cpOpen: () => { const f = this.cpRow()?.files[0]; if (f) this.cpOpenFile(f); },
      cpRestore: () => this.cpAsk(cx),
      cpConfirm: () => this.cpRestore(cx),
      cpCancel: () => { if (!cp.busy) cp.confirm = null; },
    }[c];
    go?.();
  }

  /** Opens a checkpoint's file and closes the dialog: in the Review panel (which hands it to Edit when it has nothing to review), else a pane copy's Edit. */
  cpOpenFile(f) {
    const r = this.cp.repos.find((x) => x.key === f.key);
    if (!r || this.cp.busy) return;
    closeOverlay(this.form.overlay); // as the comments dialog's Jump: the file shows behind it
    const at = { line: 0, col: 0 }, key = `${r.store.root}|${f.rel}`;
    if (hasView("review")) { showView("review"); setShared(GOTO, { view: "review", space: this.form.space, key, at, open: true, stamp: Date.now() }); return; }
    if (hasView("edit")) { showView("edit"); setShared(GOTO, { view: "edit", space: this.form.space, key, at, stamp: Date.now() }); return; }
    setShared(CMT_JUMP, { space: this.form.space, root: r.store.root, rel: f.rel, line: 0, stamp: Date.now() });
  }

  /** The row's parts with their stores, for planRestore. */
  cpParts(row) {
    return row.parts.map((p) => ({ ...p, store: this.cp.repos.find((r) => r.key === p.key)?.store })).filter((p) => p.store);
  }

  /** File keys ("<root>|<rel>") with unsaved edits in any Wingman copy (DIRTY). */
  cpHeld(keys) {
    const now = Date.now(), held = new Set();
    for (const v of Object.values(shared(DIRTY) ?? {})) if (now - (v?.at ?? 0) <= DIRTY_FRESH) for (const k of v.keys ?? []) held.add(k);
    return keys.filter((k) => held.has(k));
  }

  /** Restore to before this turn, first step: which files would change, then the confirm. */
  cpAsk(cx) {
    const cp = this.cp, row = this.cpRow();
    if (!row || cp.busy) return;
    cp.busy = "Checking which files changed since this checkpoint…"; cp.note = null; cp.confirm = null; this.paint(cx);
    cx.spawn(async (cx) => {
      try {
        const plan = await planRestore(this.cpParts(row));
        const n = plan.parts.reduce((k, p) => k + p.files.length, 0);
        const held = this.cpHeld(plan.parts.flatMap((p) => p.files.map((f) => `${p.store.root}|${f.rel}`)));
        if (!n) cp.note = plan.parts.some((p) => p.skipped.length) ? confirmText(plan, timeLabel(row.at)).replace(/^Restore 0 files[^?]*\? ?/, "Nothing to restore as text. ") : "Nothing to restore: the files are as they were before this turn.";
        else if (held.length) cp.note = `Unsaved edits in ${held.map((k) => base(k.slice(k.indexOf("|") + 1))).join(", ")}: save or discard them in Edit first`;
        else cp.confirm = { row: row.id, plan, sig: planSig(plan), text: confirmText(plan, timeLabel(row.at)) };
      } catch (e) { cp.note = String(e.message ?? e); }
      cp.busy = null; this.paint(cx);
    });
  }

  /**
   * Restore, confirmed. The plan is made again: when its files differ from the confirmed ones, the
   * new confirm shows instead. Then applyRestore (a "before restore" checkpoint first, then the
   * compare-and-swap writes), and the factual note to each Claude whose turns are undone (Auto note on rejections).
   */
  cpRestore(cx) {
    const cp = this.cp, ask = cp?.confirm, row = cp?.rows?.find((r) => r.id === ask?.row);
    if (!ask || !row || cp.busy) return;
    const space = this.form.space, rows = cp.rows, when = timeLabel(row.at);
    cp.busy = "Restoring…"; cp.note = null; this.paint(cx);
    cx.spawn(async (cx) => {
      try {
        const plan = await planRestore(this.cpParts(row));
        if (planSig(plan) !== ask.sig) {
          cp.confirm = { row: row.id, plan, sig: planSig(plan), text: confirmText(plan, when) };
          cp.note = "The files changed since you asked: check the new count and confirm again.";
        } else {
          cp.confirm = null;
          const res = await applyRestore(plan, { held: (keys) => this.cpHeld(keys), space, when });
          const notes = await this.cpNotes(rows, row, res.restored, when);
          cp.note = `Restored ${res.restored.length} file${res.restored.length === 1 ? "" : "s"}.`
            + (res.failed.length ? ` Not restored: ${res.failed.map((f) => `${f.rel} (${f.why})`).join(", ")}.` : "")
            + (res.before.length ? " A \"Before restore\" checkpoint was kept first: restore it to go forward again." : "")
            + (notes ? ` ${notes}` : "");
          cp.rows = null; // read again
        }
      } catch (e) { cp.confirm = null; cp.note = String(e.message ?? e); }
      cp.busy = null; this.paint(cx);
      this.loadCheckpoints(cx);
    });
  }

  /** The restore's note to each Claude of the undone turns, as a rejection's (respects Auto note on rejections). Returns what to add to the status, or "". */
  async cpNotes(rows, row, restored, when) {
    if (!restored.length || !(await loadSettings()).autoNote) return "";
    const skipped = [];
    for (const address of agentsSince(rows, row)) {
      const a = agents().find((x) => x.address === address);
      if (!a || !isClaude(a)) continue;
      const on = spaces().find((s) => s.id === a.space)?.machine ?? null;
      const mine = restored.filter((f) => (f.store.on ?? null) === on);
      if (!mine.length) continue;
      if (on && hookKnown(on) === false) { skipped.push(NOTES_NOTE(on)); continue; }
      try { await queueFeedback(address, restoreNote(mine.map((f) => (on ? f.path : agentPath(f.path, address))), when), { on }); }
      catch (e) { skipped.push(`Note to ${agentLabel(a)} not sent: ${e.message ?? e}`); }
    }
    return skipped.join(". ");
  }

  renderCheckpoints() {
    const t = theme(), cp = this.cp ?? { rows: [], repos: [] }, { overlay } = this.form, rows = cp.rows ?? [], sel = this.cpRow();
    const multi = cp.repos.length > 1, mono = settings().font_family ?? "JetBrains Mono";
    const who = (row) => (row.kind === "restore" ? "Wingman" : row.agent ? agentLabel(agents().find((a) => a.address === row.agent) ?? { address: row.agent }) : "Agent");
    const files = (n) => `${n} file${n === 1 ? "" : "s"}`;
    const row = (r) => {
      const on = r.id === cp.sel, branches = [...new Set(r.parts.map((p) => p.entry.branch).filter(Boolean))];
      return v_flex().id(`cp-${r.id}`).flex_none().gap(4).px(10).py(6).rounded(6).bg(on ? t.selected : t.background).cursor_pointer()
        .on_click((_e, cx) => { if (!cp.busy) { cp.sel = r.id; cp.confirm = null; cp.note = null; this.formHandle.focus(); this.paint(cx); } })
        .child(h_flex().gap(8).items_center().text_size(12)
          .child(div().w(84).flex_none().whitespace_nowrap().text_color(t.muted).child(timeLabel(r.at)))
          .child(div().w(190).flex_none().min_w(0).truncate().child(who(r)))
          .child(div().w(64).flex_none().whitespace_nowrap().text_color(t.dim).child(files(r.count)))
          .child(div().flex_1().min_w(0).truncate().text_color(r.prompt ? t.foreground : t.dim).child(r.prompt ?? (r.kind === "restore" ? "" : "no prompt seen"))))
        .when(on, (e) => e
          .child(div().text_size(11).text_color(t.dim).child(`${branches.length ? `On ${branches.join(", ")}` : "No branch"}${multi ? ` · ${r.parts.map((p) => p.name).join(", ")}` : ""}${r.kind === "restore" ? " · the files as they were just before a restore: restoring this goes forward again" : ""}`))
          .child(v_flex().gap(1).children([
            ...r.files.slice(0, 200).map((f, i) => div().id(`cp-f-${i}`).h(18).flex().items_center().px(4).rounded(3).cursor_pointer().font_family(mono).text_size(11.5)
              .hover((s) => s.bg(t.raised)).on_click((_e, cx) => { this.cpOpenFile(f); this.paint(cx); }).child(div().min_w(0).truncate().child(multi ? `${f.name}/${f.rel}` : f.rel))),
            ...(r.count > Math.min(200, r.files.length) ? [div().text_size(11).text_color(t.dim).child(`… ${r.count - Math.min(200, r.files.length)} more`)] : []),
            ...(!r.count && r.kind !== "restore" ? [div().text_size(11).text_color(t.dim).child("No files changed in this turn (yet).")] : []),
          ]))
          .child(h_flex().gap(6).items_center().pt(2)
            .child(this.button("cp-restore", "Restore to before this turn", t.ansi3 + "55", (cx) => this.cpAsk(cx)).flex_none().whitespace_nowrap())
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child("Puts every file changed since then back, across this turn's repos"))));
    };
    return v_flex().id("checkpoint-list").track_focus(this.formHandle)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") { if (cp.busy) return cx.stop_propagation(); if (cp.confirm) cp.confirm = null; else closeOverlay(overlay); }
        else if (k === "down") this.cpCommand("cpNext", cx);
        else if (k === "up") this.cpCommand("cpPrev", cx);
        else if (k === "enter" && cp.confirm) this.cpRestore(cx);
        else return;
        this.formHandle.focus(); this.paint(cx); cx.stop_propagation();
      })
      .size_full().min_h(0).p(16).gap(8).bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child(`Checkpoints (${rows.length})`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().text_size(11).text_color(t.dim).whitespace_normal()
        .child(`Kept before each agent turn, the newest 30 per repo. Pick a turn to see the files it changed; a file opens in Review.`))
      .child(v_flex().id("cp-rows").flex_1().min_h(0).gap(4).overflow_y_scrollbar()
        .children(!cp.rows ? [div().id("cp-loading").text_size(12).text_color(t.dim).child("Loading…")]
          : rows.length ? rows.map(row) : [div().id("cp-none").text_size(12).text_color(t.dim).whitespace_normal().child("No checkpoints yet. One is kept each time an agent in this space starts working.")]))
      .when(!!cp.confirm, (e) => e.child(v_flex().flex_none().gap(6).p(8).rounded(6).bg(t.ansi3 + "22")
        .child(div().text_size(12).whitespace_normal().child(cp.confirm.text))
        .child(div().text_size(11).text_color(t.dim).whitespace_normal().child("A \"Before restore\" checkpoint is kept first, so you can restore forward again. Files with unsaved edits in Edit stop it."))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1())
          .child(this.button("cp-confirm", "Restore", t.ansi3 + "88", (cx) => this.cpRestore(cx)).flex_none().whitespace_nowrap())
          .child(this.button("cp-cancel", "Cancel", t.raised, (cx) => { cp.confirm = null; this.paint(cx); }).flex_none()))))
      .when(!!(cp.busy || cp.note), (e) => e.child(div().flex_none().text_size(12).whitespace_normal().text_color(cp.busy ? t.muted : t.foreground).child(cp.busy ?? cp.note)));
  }

  renderCommentList() {
    const t = theme(), { overlay } = this.form, cs = this.cs?.comments ?? [], undo = this.cs?.undo ?? null;
    const multi = new Set(cs.map((c) => c.root)).size > 1, blocked = this.sendBlocked(), mono = settings().font_family ?? "JetBrains Mono";
    const ch = cs.length ? this.commentTarget() : null, name = (address) => agentLabel(agents().find((a) => a.address === address) ?? { address });
    const tag = (text, bg) => div().flex_none().px(6).h(18).flex().items_center().rounded(4).bg(bg).text_size(10.5).child(text);
    const row = (c, i) => v_flex().id(`cm-${c.id}`).flex_none().gap(4).px(10).py(8).rounded(6).bg(t.background)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${i + 1}.`))
        .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(11.5).child(this.commentWhere(c, multi)))
        .when(c.kind === "rejected", (e) => e.child(tag("rejected change", t.ansi1 + "33")))
        .when(!!c.stale, (e) => e.child(tag("moved or changed", t.ansi3 + "44")))
        .child(this.button(`cm-jump-${c.id}`, "Jump", t.raised, () => { closeOverlay(overlay); jumpTo(c); }).flex_none())
        .child(this.button(`cm-edit-${c.id}`, "Edit", t.raised, (cx) => this.startEdit(c, cx)).flex_none())
        .child(this.button(`cm-del-${c.id}`, "Delete", t.ansi1 + "40", (cx) => this.listChange((s) => deleteComment(s, c.id), cx)).flex_none()))
      .when(!!c.snippet?.length, (e) => e.child(this.snippetBox(`cm-snip-${c.id}`, c.snippet, t)))
      .child(this.editing === c.id
        ? h_flex().gap(6).items_center().child(div().flex_1().min_w(0).child(Input.new(this.editInput)))
          .child(this.button(`cm-save-${c.id}`, "Save", t.accent + "55", (cx) => this.saveEdit(cx)).flex_none())
          .child(this.button(`cm-cancel-${c.id}`, "Cancel", t.raised, (cx) => { this.editing = null; this.formHandle.focus(); this.paint(cx); }).flex_none())
        : div().text_size(12.5).whitespace_normal().child(c.text));
    const off = (b) => b.opacity(0.45);
    const canSend = cs.length && !blocked && !this.busy && !ch?.error;
    return v_flex().id("comment-list").track_focus(this.formHandle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.editing) this.editing = null;
        else if (this.pickList || this.confirmTo) { this.pickList = null; this.confirmTo = null; }
        else closeOverlay(overlay);
        this.formHandle.focus(); this.paint(cx); cx.stop_propagation();
      })
      .size_full().min_h(0).p(16).gap(8).bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child(`Review comments (${cs.length})`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(!cs.length ? "" : blocked ? blocked
        : ch?.address ? `Send goes to ${name(ch.address)}${multi ? ", one prompt grouped by repo" : ""}.`
        : ch?.pick ? "This space has several agents: Send asks which one." : ch?.error ?? ""))
      .child(v_flex().id("cm-rows").flex_1().min_h(0).gap(6).overflow_y_scrollbar()
        .children(!this.cs ? [div().id("cm-loading").text_size(12).text_color(t.dim).child("Loading…")]
          : cs.length ? cs.map(row) : [div().id("cm-none").text_size(12).text_color(t.dim).child("No comments. Add one with Comment on a change in Review, or + Comment (or alt-m) on a line in Edit.")]))
      .when(!!this.pickList, (e) => e.child(v_flex().flex_none().gap(4).p(8).rounded(6).bg(t.raised)
        .child(div().text_size(12).child("Send to which agent?"))
        .children(this.pickList.map((address) => this.button(`cm-pick-${address}`, `${name(address)}${ACTIVE.has(agents().find((a) => a.address === address)?.status) ? " (working)" : ""}`, t.background, (cx) => this.toTarget(address, cx))))
        .child(this.button("cm-pick-cancel", "Cancel", t.background, (cx) => { this.pickList = null; this.paint(cx); }))))
      .when(!!this.confirmTo, (e) => e.child(h_flex().flex_none().gap(8).items_center().p(8).rounded(6).bg(t.ansi3 + "22")
        .child(div().flex_1().text_size(12).child(`${name(this.confirmTo)} ${agents().find((a) => a.address === this.confirmTo)?.status === "blocked" ? "is waiting on a question" : "is working"}. Send now anyway? It arrives as your next message.`))
        .child(this.button("cm-confirm", "Send anyway", t.accent + "55", (cx) => this.toTarget(this.confirmTo, cx)).flex_none())
        .child(this.button("cm-confirm-no", "Cancel", t.raised, (cx) => { this.confirmTo = null; this.paint(cx); }).flex_none())))
      .when(!!(this.busy || this.note), (e) => e.child(div().flex_none().text_size(12).text_color(this.busy ? t.muted : t.foreground).child(this.busy ?? this.note)))
      .child(h_flex().flex_none().gap(6).items_center()
        .when(cs.length > 0, (e) => e.child(this.button("cm-clear", "Clear all", t.ansi1 + "40", (cx) => this.listChange((s) => clearComments(s, "cleared"), cx, "Cleared. Undo clear puts them back.")).flex_none()))
        .when(!!undo, (e) => e.child(this.button("cm-undo", `Undo clear (${undo.comments.length})`, t.raised, (cx) => this.listChange(undoClear, cx, null)).flex_none()))
        .child(div().flex_1())
        .when(cs.length > 0, (e) => e.child(this.button("cm-copy", "Copy prompt", t.raised, (cx) => this.copyPrompt(cx)).flex_none()))
        .child((canSend ? this.button("cm-send", "Send to agent", t.solid, (cx) => this.startSend(cx)) : off(this.button("cm-send", "Send to agent", t.solid, () => {})))
          .text_color(t.solid_foreground).flex_none()));
  }

  // ---- selection bar and right-click menu ----------------------------------

  /** Floats over the diff while lines are selected, saying what can be done with them. */
  selectionBar(f, sel, t) {
    const n = this.rowsOf(f).slice(sel[0], sel[1] + 1).filter((r) => r.kind !== "@" && !r.cont).length;
    return h_flex().absolute().bottom(12).left(0).right(0).justify_center()
      .child(h_flex().gap(8).px(10).py(5).items_center().rounded(8).bg(t.popover).border_1().border_color(t.accent).shadow_md().text_size(11.5)
        .child(div().text_color(t.muted).child(`${n} line${n === 1 ? "" : "s"} selected`))
        .when(this.mode !== "changes" && this.picks(f, sel).any, (e) => e
          .child(this.button("sel-reject", `Reject  ${this.kl("reject")}`, t.ansi1 + "55", (cx) => this.selectionAction("reject", cx)))
          .child(this.button("sel-accept", `Accept  ${this.kl("accept")}`, t.ansi2 + "55", (cx) => this.selectionAction("accept", cx))))
        .child(this.button("sel-prompt", `Ask  ${this.kl("comment")}`, t.ansi4 + "55", (cx) => this.askPrompt(this.current, cx)))
        .when(this.mode !== "changes", (e) => e.child(this.button("sel-comment", `Comment  ${this.kl("addComment")}`, t.ansi5 + "55", (cx) => this.commentHere(cx))))
        .child(this.button("sel-clear", "Clear  Esc", t.raised, (cx) => this.clearSelection(cx))));
  }

  /**
   * Right-click opens a menu for the line under the pointer. It never changes the selection:
   * selecting is left-click only. A line in a hunk, or its button row, makes that hunk current.
   */
  openMenu(ev, cx) {
    const f = this.file(), i = this.rowAt(this.at(ev).y);
    if (!f || i < 0) return;
    this.handle.focus(); this.treeFocus = false; this.searchFocus = false; this.problemsFocus = false; // a right-click in the file gives it the keyboard
    const r = this.rowsOf(f)[i], inHunk = r.hunk != null, sel = this.selection(f), hasSel = !!sel;
    if (inHunk) this.current = r.hunk;
    // With changed lines selected, Accept/Reject act on those lines only; otherwise on the hunk.
    // The labels stay short; the selection bar shows when they act on selected lines.
    const selChanges = hasSel && this.picks(f, sel).any && this.mode !== "changes";
    const items = [
      // Edit only (Review is read-only; ctrl-k there hands over to Edit).
      ...(this.mode === "edit" && this.editable(f) && !f.store?.plain ? [{ cmd: "inlineEdit", label: "Inline edit…", key: this.kl("inlineEdit") }] : []),
      { cmd: "prompt", label: "Ask agent now", key: this.kl("comment") },
      ...(this.mode !== "changes" ? [{ cmd: "addComment", label: "Add review comment", key: this.kl("addComment") }] : []),
      ...((inHunk && this.mode !== "changes") || selChanges ? [
        { cmd: "reject", label: "Reject", key: this.kl("reject") },
        { cmd: "rejectReason", label: "Reject with comment…", key: "" },
        ...(inHunk && !selChanges ? [{ cmd: "rejectComment", label: "Reject and add review comment…", key: "" }] : []),
        { cmd: "accept", label: "Accept", key: this.kl("accept") },
      ] : []),
      // G6: Changes discards the change (or the selected changed lines) under the pointer, after asking.
      ...(this.mode === "changes" && (inHunk || (hasSel && this.picks(f, sel).any)) && !f.committed ? [{ cmd: "discardChange", label: hasSel && this.picks(f, sel).any ? "Discard selected lines…" : "Discard change…", key: "" }] : []),
      ...(this.lastReject ? [{ cmd: "reason", label: "Comment last rejection", key: this.kl("reason") }] : []),
      ...(hasSel ? [{ cmd: "clear", label: "Clear selection", key: "Esc" }] : []),
    ];
    this.menuAt = Date.now(); // its command comes back to every shown copy: this one acts (claim)
    openOverlay({ mod: "wingman", props: { form: "menu", items }, kind: "popup", at: "pointer", width: 260, height: items.length * 30 + 12 });
    this.paint(cx);
  }

  // ---- settings popup (Q47) ---------------------------------------------------

  /** Saves one setting; the pane copy rereads them through wingman.settings. */
  /** Settings: a repo's Problems command ({ command, parser }); an empty command removes it. */
  setProblemsCommand(repo, patch, cx) {
    if (!repo) return;
    const all = { ...(this.st?.problemsCommands ?? {}) }, next = { parser: "generic", ...(all[repo] ?? {}), ...patch };
    if (String(next.command ?? "").trim()) all[repo] = next; else delete all[repo];
    this.setSetting({ problemsCommands: all }, cx);
  }

  setSetting(patch, cx) {
    this.st = { ...this.st, ...patch };
    const next = this.st;
    this.paint(cx);
    cx.spawn(async () => {
      try { await saveSettings(next); syncPanels(shared, setShared, next.hideHerdrPanels); setShared(SETTINGS_REV, { stamp: Date.now() }); } catch (e) { log(`settings: ${e.message ?? e}`); }
    });
  }

  /**
   * The settings popup's Claude hook on the space's machine: `how` "install" or "remove" (null:
   * only the status). The result line says what was done; the pane copy is told to look again.
   */
  hookAction(how, cx) {
    const on = this.form.machine;
    if (this.hook?.busy) return;
    this.hook = { ...this.hook, busy: how ? (how === "install" ? "Installing…" : "Removing…") : "Checking…", ...(how ? { result: null, failed: false } : {}) };
    this.paint(cx);
    cx.spawn(async (cx) => {
      let result = this.hook.result, failed = this.hook.failed;
      try {
        const text = (await readTextFile(`${appHome()}/mods/wingman/hooks/wingman-hook.sh`))?.replace(/\r\n/g, "\n") ?? null;
        if (how === "install") {
          if (!text) throw new Error("hooks/wingman-hook.sh is missing from the mod folder");
          result = await installHook(on, text);
        } else if (how === "remove") result = await uninstallHook(on);
        if (how) { failed = false; setShared(HOOK_REV, { stamp: Date.now() }); }
        this.hook = { status: hookSummary(await hookStatus(on, { hookText: text }), on), result, failed };
      } catch (e) {
        this.hook = { status: this.hook?.status ?? null, result: String(e.message ?? e), failed: true };
      }
      this.paint(cx);
    });
  }

  // ---- keyboard shortcuts dialog (form "keys") ------------------------------------

  /** Saves the shortcut overrides, updates Herdr's mod:wingman section, and tells the pane. */
  setKeys(next, cx) {
    this.overrides = next; this.km = resolve(next); this.rec = null; this.pending = null;
    this.paint(cx);
    const km = this.km;
    cx.spawn(async () => {
      try { await saveKeys(next); await syncHerdrKeys(km); setShared(SETTINGS_REV, { stamp: Date.now() }); } catch (e) { log(`keys: ${e.message ?? e}`); }
    });
  }

  /** A key pressed while recording: refused, a conflict to confirm, or bound. */
  recordKey(e, cx) {
    const k = keystrokeOf(e);
    if (!k) return;
    cx.stop_propagation();
    if (k === "escape") { this.rec = null; this.keyMsg = null; this.paint(cx); return; }
    const why = refused(k);
    if (why) { this.keyMsg = `${keyLabel(k)} can't be bound: it's ${why}.`; this.paint(cx); return; }
    const others = holders(this.km, k, this.rec);
    if (others.length) { this.pending = { id: this.rec, key: k, others }; this.rec = null; this.keyMsg = null; this.paint(cx); return; }
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
            .hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => { this.rec = a.id; this.pending = null; this.keyMsg = null; this.formHandle.focus(); this.paint(cx); }).child("+ key")))
          .when(changed, (e) => e.child(div().id(`reset-${a.id}`).h(22).px(6).flex().items_center().rounded(4).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.raised).text_color(t.foreground)).on_click((_e, cx) => this.setKeys(resetKey(this.overrides, a.id), cx)).child("Reset")))));
    }
    const p = this.pending;
    return v_flex().id("wingman-keys").track_focus(this.formHandle)
      .on_key_down((e, cx) => {
        if (this.rec) return this.recordKey(e, cx);
        if (e.key === "escape") { if (this.pending) { this.pending = null; this.paint(cx); } else closeOverlay(overlay); cx.stop_propagation(); }
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
        .child(this.button("keys-cancel", "Cancel", t.raised, (cx) => { this.pending = null; this.paint(cx); }))))
      .child(v_flex().id("keys-list").flex_1().min_h(0).overflow_y_scrollbar().children(km ? rows : [div().id("keys-loading").text_size(12).text_color(t.dim).child("Loading…")]));
  }

  renderSettings() {
    const t = theme(), st = this.st, { overlay } = this.form;
    const toggle = (id, label, hint, on, flip) => h_flex().id(id).gap(10).py(6).items_center().cursor_pointer()
      .on_click((_e, cx) => flip(cx))
      .child(div().w(34).h(18).flex_none().rounded(9).p(2).bg(on ? t.accent : t.raised)
        .child(div().size(14).rounded(7).bg(t.foreground).when(on, (e) => e.ml(16))))
      .child(v_flex().flex_1().min_w(0).child(div().text_size(13).child(label)).child(div().text_size(11).text_color(t.dim).child(hint))); // the hint wraps instead of running past the dialog
    // The rows are split into sections (settingsTabs), each short enough for an 820 px window at zoom
    // 1.2 without scrolling; a section still scrolls when the window is smaller than that.
    const tabs = settingsTabs(!!this.form.machine), cur = tabs.some((x) => x.id === this.setTab) ? this.setTab : tabs[0].id;
    const section = !st ? [] : {
      general: () => [
        toggle("set-note", "Auto note on rejections", "Tell the agent which of its changes you rejected.", st.autoNote, (cx) => this.setSetting({ autoNote: !st.autoNote }, cx)),
        toggle("set-editnote", "Note on my edits", "Tell the agent which lines of its files you changed.", st.editNote, (cx) => this.setSetting({ editNote: !st.editNote }, cx)),
        toggle("set-sessionlog", "Read the agent's session log", "List the files Claude read and edited (Edit › Agent files) from its own log under ~/.claude/projects, outside the repo.", st.sessionLog ?? true, (cx) => this.setSetting({ sessionLog: !(st.sessionLog ?? true) }, cx)),
        toggle("set-hidepanels", "Hide Herdr's Files and Changes buttons", "Takes them out of the tab bar. Wingman's own Review, Edit and Changes stay. Turn off to put them back.", st.hideHerdrPanels ?? false, (cx) => this.setSetting({ hideHerdrPanels: !(st.hideHerdrPanels ?? false) }, cx)),
        v_flex().gap(6).pt(4)
          .child(div().text_size(12).text_color(t.muted).child("Editor"))
          .child(h_flex().gap(4).children([["wingman", "Wingman"], ["nvim", "Neovim"]].map(([v, label]) => div().id(`editor-${v}`).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
            .bg((st.editor ?? "wingman") === v ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => this.setSetting({ editor: v }, cx)).child(label))))
          .child(div().text_size(11).text_color(t.dim).child("Neovim: clicking a line, Open in Neovim, or a file in the tree opens it in a Neovim pane beside Wingman.")),
        v_flex().gap(6).pt(4)
          .child(div().text_size(12).text_color(t.muted).child("External editor (Open in external editor, and the file row's last button)"))
          .child(h_flex().gap(4).flex_wrap().children(Object.entries(EDITORS).map(([v, ed]) => div().id(`ext-${v}`).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
            .bg((st.externalEditor ?? "code") === v ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => this.setSetting({ externalEditor: v }, cx)).child(ed.name))))
          .when(st.externalEditor === "custom", (e) => e
            .child(Input.new(this.extInput))
            .child(div().text_size(11).text_color(t.dim).child('{path}, {line} and {col} are filled in; "quotes" keep spaces. Example: idea --line {line} --column {col} {path}'))),
      ],
      editing: () => [
        toggle("set-pairs", "Auto-close brackets and quotes", "Typing ( [ { \" ' ` adds the closer; Backspace in an empty pair removes both.", st.autoPairs ?? true, (cx) => this.setSetting({ autoPairs: !(st.autoPairs ?? true) }, cx)),
        toggle("set-tags", "Auto-close tags", "In HTML, XML, JSX and Vue files, typing > adds the closing tag and </ completes the open one.", st.autoTags ?? true, (cx) => this.setSetting({ autoTags: !(st.autoTags ?? true) }, cx)),
        toggle("set-wrap", "Wrap long lines", "Long lines continue on the next screen row instead of scrolling sideways. Alt+Z by default.", st.wordWrap ?? false, (cx) => this.setSetting({ wordWrap: !(st.wordWrap ?? false) }, cx)),
        toggle("set-autosave", "Autosave", "Save on focus loss and file switch. Where you and the agent change the same lines, the agent's win.", st.autosave, (cx) => this.setSetting({ autosave: !st.autosave }, cx)),
        v_flex().gap(6).when(!st.autosave, (e) => e.opacity(0.4))
          .child(div().text_size(12).text_color(t.muted).child("Also save after typing stops for"))
          .child(h_flex().gap(4).children([0, 1, 2, 3, 5, 10].map((n) => div().id(`delay-${n}`).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
            .bg(st.autosaveDelay === n ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85))
            .on_click((_e, cx) => { if (st.autosave) this.setSetting({ autosaveDelay: n }, cx); })
            .child(n ? `${n}s` : "Focus change")))),
        toggle("set-format", "Format on save", "Run the repo's Prettier (or CSharpier for C#) on Ctrl+S and Alt+Shift+F. Autosave never formats: it would move text while you are elsewhere.", st.formatOnSave ?? false, (cx) => this.setSetting({ formatOnSave: !(st.formatOnSave ?? false) }, cx)),
      ],
      inline: () => [
        v_flex().gap(6).pt(4)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().text_size(12).text_color(t.muted).child("Inline edit command"))
            .when((st.inlineCommand ?? INLINE_COMMAND) !== INLINE_COMMAND, (e) => e.child(this.button("ie-default", "Default", t.raised, (cx) => { this.ieInput.set_value?.(INLINE_COMMAND); this.setSetting({ inlineCommand: INLINE_COMMAND }, cx); }).flex_none())))
          .child(Input.new(this.ieInput))
          .child(div().text_size(11).text_color(t.dim).child('Runs once per edit where the repo\'s tools live (WSL for a WSL repo), with your shell\'s PATH. {prompt} is the whole prompt as one argument, {promptFile} a temp file holding it; neither: the prompt goes last. "quotes" keep spaces. No shell reads it.')),
      ],
      problems: () => [this.problemsSettings(t, toggle)],
      machine: () => [this.hookSection(t)],
    }[cur]();
    return v_flex().id("wingman-settings").track_focus(this.formHandle)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(overlay); cx.stop_propagation(); } })
      .size_full().p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().items_center().gap(8).child(div().flex_1().text_size(15).font_semibold().child("Settings"))
        .child(this.button("open-keys", "Keyboard shortcuts…", t.raised, () => { closeOverlay(overlay); openOverlay({ mod: "wingman", props: { form: "keys" }, kind: "dialog", width: 700, height: 620 }); }))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().flex_none().gap(2).p(2).rounded(6).bg(t.raised).children(tabs.map((x) =>
        div().id(`set-tab-${x.id}`).h(24).px(10).flex().items_center().rounded(4).text_size(12).cursor_pointer()
          .when(cur === x.id, (e) => e.bg(t.selected)).on_click((_e, cx) => { this.setTab = x.id; this.paint(cx); }).child(x.label))))
      .when(!st, (e) => e.child(div().text_size(12).text_color(t.dim).child("Loading…")))
      .when(!!st, (e) => e.child(v_flex().id(`set-section-${cur}`).flex_1().min_h(0).gap(10).overflow_y_scrollbar().children(section)));
  }

  /** Settings: Problems on or off, Check after each agent turn, and the shown space's repos' Problems command. */
  problemsSettings(t, toggle) {
    const st = this.st, repos = this.form.repos ?? [], cur = st.problemsCommands?.[this.pcRepo] ?? null, parser = cur?.parser ?? "generic";
    const chip = (id, label, on, fn) => div().id(id).h(24).px(10).flex().items_center().rounded(5).text_size(12).cursor_pointer()
      .bg(on ? t.accent + "77" : t.raised).hover((s) => s.opacity(0.85)).on_click((_e, cx) => fn(cx)).child(label);
    return v_flex().gap(4).pt(4)
      .child(toggle("set-problems", "Problems", "Run the project's own checkers and mark what they report: eslint on a file when it's opened or saved; tsc and dotnet build with Check (ctrl-shift-m). Nothing runs where none is found.", st.problems ?? true, (cx) => this.setSetting({ problems: !(st.problems ?? true) }, cx)))
      .child(toggle("set-problems-turn", "Check after each agent turn", "Check (tsc, dotnet build, the Problems command) when an agent in the space finishes a turn. A build can be slow.", st.problemsAfterTurn ?? false, (cx) => this.setSetting({ problemsAfterTurn: !(st.problemsAfterTurn ?? false) }, cx)))
      .child(v_flex().gap(6).pt(4).when(!(st.problems ?? true), (e) => e.opacity(0.4))
        .child(div().text_size(12).text_color(t.muted).child(repos.length ? `Problems command${repos.length === 1 ? ` for ${repos[0].name}` : ""}` : "Problems command (open a space with a git repo to set one)"))
        .when(repos.length > 1, (e) => e.child(h_flex().gap(4).flex_wrap().children(repos.map((r, i) => chip(`pc-repo-${i}`, r.name, r.id === this.pcRepo, (cx) => {
          this.pcRepo = r.id; this.pcInput.set_value?.(this.st?.problemsCommands?.[r.id]?.command ?? ""); this.paint(cx); })))))
        .when(repos.length > 0, (e) => e.child(Input.new(this.pcInput))
          .child(h_flex().gap(4).items_center().child(div().text_size(11).text_color(t.dim).pr(4).child("Output"))
            .children([["tsc", "tsc-style"], ["eslint-json", "eslint JSON"], ["generic", "path:line:col: message"]].map(([v, label]) =>
              chip(`pc-parser-${v}`, label, parser === v, (cx) => this.setProblemsCommand(this.pcRepo, { parser: v, command: this.pcInput.value() }, cx)))))
          .child(div().text_size(11).text_color(t.dim).child('Runs in the repo\'s top folder, where its git runs, as an argument list: no shell reads it. "quotes" keep spaces. With {file} (the file\'s path in the repo) it runs per file on open and save, else with Check.'))));
  }

  /** Settings: the Claude hook on the space's machine, with Install and Remove. */
  hookSection(t) {
    const h = this.hook ?? {}, on = this.form.machine;
    return v_flex().gap(6).pt(4)
      .child(div().text_size(12).text_color(t.muted).child(`Claude hook on ${on}`))
      .child(div().text_size(11.5).child(h.busy && !h.status ? h.busy : h.status ?? ""))
      .child(h_flex().gap(6).items_center()
        .child(this.button("hook-install", "Install", t.accent + "55", (cx) => this.hookAction("install", cx)))
        .child(this.button("hook-remove", "Remove", t.raised, (cx) => this.hookAction("remove", cx)))
        .when(!!h.busy, (e) => e.child(div().text_size(11).text_color(t.dim).child(h.busy))))
      .when(!!h.result, (e) => e.child(div().text_size(11).text_color(h.failed ? t.ansi1 : t.dim).child(h.result)))
      .child(div().text_size(11).text_color(t.dim).child("Install copies the hook to the machine and adds it to Claude's settings there. Restart Claude there to load it."));
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

  /**
   * The file bar's hint and buttons that fit its width now, each with its label (barfit.fitBar):
   * Map id -> label, absent when not shown. Keys go first, then long labels, then whole buttons
   * (the editor button first, Save and Discard never). The file tabs keep at least TABS_MIN.
   */
  fileBar(f, vis) {
    const items = [], add = (id, labels, drop, size = 11, pad = 20, group) => items.push({ id, labels, drop, size, pad, group });
    // Too narrow for the column beside it (columns.js): back to the list or the tree.
    if (this.mode === "changes" ? !!this.cols?.single : this.mode === "edit" && !this.treeOnly() && this.editCols(true).single) add("back", ["‹ Files", "‹"], Infinity);
    if (vis.length > 1 && this.mode !== "changes") {
      const pos = `${vis.findIndex((x) => x.key === this.sel) + 1}/${vis.length}`;
      add("pos", [`${pos} · ${this.kl("prevFile")}/${this.kl("nextFile")}`, pos], 2, 10, 12);
    }
    if (f && this.nvim()) add("nvim", [withKey("Neovim", this.kl("openInNvim")), "Neovim"], 3);
    if (this.dirty(f)) add("save", [withKey("Save", this.kl("save")), "Save"], Infinity);
    if (f && this.mode === "edit" && this.editable(f)) add("add-comment", [withKey("+ Comment", this.kl("addComment")), "+ Comment"], 4);
    if (this.mode === "changes" && f && !f.committed) {
      if (this.discardKey === f.key) { add("discard-yes", ["Discard all changes to this file", "Discard all changes", "Discard"], Infinity); add("discard-no", ["Cancel"], Infinity); }
      else add("discard", ["Discard file", "Discard"], Infinity);
    }
    if (this.mode !== "changes" && f && !f.plain && f.hunks.length > 0) {
      add("reject-file", [withKey("Reject file", this.kl("rejectFile")), "Reject file", "Reject"], 5, 11, 20, "file");
      add("accept-file", [withKey("Accept file", this.kl("acceptFile")), "Accept file", "Accept"], 5, 11, 20, "file");
    }
    const ed = editorName(this.settings.externalEditor);
    if (f) add("vscode", [withKey(ed, this.kl("openInVSCode")), ed], 1);
    return fitBar(this.px(this.barW), items, TABS_MIN + 16);
  }

  /**
   * The header's buttons that fit the pane's width now (as fileBar): Comments and Settings always
   * stay. The subtitle shrinks first (it truncates), down to SUBTITLE_MIN.
   */
  headerBar(total, ncomments) {
    const items = [], add = (id, labels, drop, group) => items.push({ id, labels, drop, size: 11, pad: 20, group });
    if (this.lastReject && !this.lastReject.remote) add("reason", [withKey("Comment last rejection", this.kl("reason")), "Comment last rejection", "Reason"], 1);
    if (total > 0 && this.mode === "review") { add("reject-all", ["Reject all files", "Reject all"], 2, "all"); add("accept-all", ["Accept all files", "Accept all"], 2, "all"); }
    if (this.spaceId && this.mode === "review" && this.stores.some((st) => !st.plain)) add("checkpoints", [`Checkpoints ${this.cpCounts?.get(this.spaceId) ?? 0}`], 3);
    // Comments and Settings shorten to icons (fitHeader drops the title first); Comments goes last, Settings never.
    if (this.spaceId) add("comments", [withKey(`Comments ${ncomments}`, this.kl("commentList")), `Comments ${ncomments}`, `💬 ${ncomments}`], LAST_DROP);
    add("settings", ["⚙ Settings", "⚙"], Infinity);
    const { labels, narrow } = fitHeader(this.paneW == null ? 0 : this.px(this.paneW), items, { panel: !!this.view, subtitle: SUBTITLE_MIN });
    if (narrow) labels.set("narrow", true);
    return labels;
  }

  /**
   * The header's counts. Review and Edit: the agent's open changes and the files they're in, and the
   * undo steps. Changes (D5): what its list holds, the uncommitted files, and how many of them still
   * have changes to review in Review (the list's "n to review" tags, from REVIEW). Changes doesn't
   * count changes (hunks): a row's hunks are only known once its texts load.
   */
  counts(total, vis) {
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    if (this.mode !== "changes") return `${plural(total, "change")} in ${plural(vis.length, "file")} · ${this.history.length} undoable`;
    const review = shared(REVIEW), open = this.files.filter((f) => (review?.[f.key] ?? 0) > 0).length;
    return `${plural(this.files.length, "uncommitted file")}${open ? ` · ${open} to review` : ""}`;
  }

  /** The change header row's buttons for the diff's width now (barfit.hunkButtons). */
  hunkBtns() { return hunkButtons(this.vw(), GUTTER, BTN_GAP, BUTTONS); }

  /** A measured size (on_size_change: screen px) in element px, as w() and the bars' estimates use. */
  px(measured) { return toElem(measured, this.unit); }

  button(id, label, bg, onClick) {
    return div().id(id).h(22).px(10).flex().items_center().rounded(5).cursor_pointer().bg(bg).text_size(11)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => { this.handle?.focus(); onClick(cx); }).child(label);
  }

  row(r, f, t, selected = false) {
    if (r.kind === "@" && this.mode === "changes" && this.gitx) return this.gitx.hunkRow(r, f, t, ROW, GUTTER, BTN_GAP); // G6: Discard change
    if (r.kind === "@" && this.mode === "changes") {
      return h_flex().w_full().h(ROW).flex_none().items_center().bg(t.raised)
        .child(div().w(GUTTER).flex_none())
        .child(div().flex_1().text_color(t.dim).text_size(11).child(`change ${r.hunk + 1} of ${f.hunks.length}`));
    }
    if (r.kind === "@") {
      // Row renderers can't hold handlers; the input layer maps clicks here to a button by x (rowButton).
      // A narrow diff drops the keys, then "change n of m", then the last buttons (hunkButtons).
      const current = r.hunk === this.current, hb = this.hunkBtns();
      const btn = (label, key, bg) => div().w(hb.w).flex_none().h(16).rounded(4).flex().items_center().justify_center().bg(bg).text_size(11).whitespace_nowrap().child(hb.keys ? withKey(label, this.kl(key)) : label);
      return h_flex().w_full().h(ROW).flex_none().gap(BTN_GAP).items_center().bg(current ? t.selected : t.raised)
        .child(div().w(GUTTER).flex_none())
        .children([btn("Reject", "reject", t.ansi1 + (current ? "99" : "55")), btn("Accept", "accept", t.ansi2 + (current ? "99" : "55")),
          btn("Ask", "comment", t.ansi4 + (current ? "77" : "40")), btn("Comment", "addComment", t.ansi5 + (current ? "77" : "40"))].slice(0, hb.shown))
        .when(hb.note, (e) => e.child(div().flex_1().min_w(0).pl(8).truncate().text_color(t.dim).text_size(11).child(`change ${r.hunk + 1} of ${f.hunks.length}${this.hunkComments(f, r.hunk)}`)));
    }
    // A line with a review comment on it: its number on a tinted background (paler when the comment's code moved or changed).
    const cm = r.side === "new" && !r.cont ? (this.cmtSpans ?? []).find((s) => r.line >= s.a && r.line <= s.b) : null;
    // Problems on this line (problemsview.forFile): a bar on the line number in the error or warning
    // colour, and each range underlined; dimmed while the line was edited since the check (stale).
    const pd = r.side === "new" ? this.pb?.lines.get(r.line) ?? null : null;
    const pc = pd ? (pd.some((d) => d.severity === "error" && !d.stale) ? t.ansi1 : pd.some((d) => !d.stale) ? t.ansi3 : t.dim) : null;
    const spans = expandTabs(spansOf((r.side === "old" ? f.oldTok : f.newTok)?.[r.line]));
    const text = r.side === "new" ? body(linesOf(f)[r.line]) : r.seg ? body(f.B[r.line]) : "";
    // E5: a wrapped segment shows its own columns, after the wrapping indent.
    const seg = r.seg, v0 = seg ? visualCol(text, seg.from) : 0, ind = seg?.ind ?? 0, last = !seg || seg.to === text.length;
    const cw = this.cw(), hx = this.hx, x = (col) => (visualCol(text, col) - v0 + ind) * cw - hx;
    const clip = (a, b) => (seg ? [Math.max(a, seg.from), Math.min(b, seg.to)] : [a, b]);
    // Text selection on this line: [from, to) in characters; a line selected through its end
    // shows one more cell for the line break.
    let mark = null;
    if (r.side === "new" && this.hasTextSel()) {
      const [a, b] = this.ordered();
      if (r.line >= a.line && r.line <= b.line) {
        const [from, to] = clip(r.line === a.line ? a.col : 0, r.line === b.line ? b.col : text.length);
        if (from <= to) mark = { left: x(from), w: Math.max(0, x(to) - x(from)) + (r.line < b.line && last ? cw : 0) };
      }
    }
    const onLine = r.side === "new" && this.cur?.line === r.line;
    const caret = onLine && (!r.segs || r.segs[segmentOf(r.segs, this.cur.col)] === seg);
    const found = r.side === "new" && this.bar ? this.matches(f) : null;
    const hits = (found?.byLine?.get(r.line) ?? []).filter((k) => { const [a, b] = clip(found.ms[k].from, found.ms[k].to); return a < b; });
    const onHit = hits.length ? this.onMatch(found.ms) : -1;
    // D2: the matched bracket pair's boxes on this row (never on removed lines).
    const bm = r.side === "new" && this.bm ? [this.bm.open, this.bm.close].filter((p) => p.line === r.line).map((p) => clip(p.col, p.col + 1)).filter(([a, b]) => a < b) : [];
    return h_flex().w_full().h(ROW).flex_none().whitespace_nowrap()
      .when(r.kind === "+", (e) => e.bg(t.ansi2 + "22")).when(r.kind === "-", (e) => e.bg(t.ansi1 + "22"))
      .when(selected, (e) => e.bg(t.selection).border_l(2).border_color(t.accent))
      .child(div().w(44).flex_none().pr(8).text_right().text_color(onLine || cm ? t.foreground : t.dim).when(!!cm, (e) => e.bg(t.ansi5 + (cm.stale ? "26" : "55")))
        .when(!!pc && !r.cont, (e) => e.border_l(3).border_color(pc)).child(r.cont ? "" : String(r.num)))
      .child(div().w(14).flex_none().text_color(r.kind === "+" ? t.ansi2 : r.kind === "-" ? t.ansi1 : t.dim).child(r.kind === " " || r.cont ? "" : r.kind))
      .child(div().flex_1().h_full().relative().overflow_hidden()
        .children(hits.map((k) => { const [a, b] = clip(found.ms[k].from, found.ms[k].to); return div().absolute().top(1).h(ROW - 2).rounded(2).left(x(a)).w(Math.max(2, x(b) - x(a)))
          .bg(k === onHit ? t.ansi3 + "88" : t.ansi3 + "38"); }))
        .children(bm.map(([a, b]) => div().absolute().top(1).h(ROW - 2).left(x(a)).w(Math.max(2, x(b) - x(a))).rounded(2).border_1().border_color(t.dim).bg(t.raised)))
        .when(!!mark, (e) => e.child(div().absolute().top(0).h(ROW).left(mark.left).w(mark.w).bg(t.selection)))
        .children((pd ?? []).filter((d) => !d.stale).slice(0, 8).flatMap((d) => {
          const a0 = Math.min(Math.max(0, d.col - 1), text.length), b0 = d.endLine === d.line && d.endCol > d.col ? Math.min(d.endCol - 1, text.length) : d.endLine > d.line ? text.length : Math.min(a0 + 1, text.length);
          const [a, b] = clip(a0, Math.max(b0, a0 + (text.length > a0 ? 1 : 0)));
          if (a > b || (seg && a0 >= seg.to)) return [];
          const c = d.severity === "error" ? t.ansi1 : t.ansi3, w = Math.max(cw, x(b) - x(a));
          return [div().absolute().top(0).h(ROW).left(x(a)).w(w).bg(c + "1c"), div().absolute().top(ROW - 3).h(2).left(x(a)).w(w).bg(c + "cc")];
        }))
        .child(seg
          ? div().absolute().top(0).h(ROW).left(ind * cw).w((visualCol(text, seg.to) - v0) * cw).overflow_hidden()
            .child(h_flex().absolute().top(0).h(ROW).left(-v0 * cw).children(spans.map((s) => div().text_color(color(s.type, t)).child(s.text))))
          : h_flex().absolute().top(0).h(ROW).left(-hx).children(spans.map((s) => div().text_color(color(s.type, t)).child(s.text))))
        .when(caret, (e) => e.child(div().absolute().top(3).h(ROW - 6).w(2).left(x(this.cur.col)).bg(this.handle.is_focused() && !this.treeFocus ? t.accent : t.dim))));
  }

  render() {
    if (this.role === CONTROLLER) return div();
    if (this.form?.form === "menu") return this.renderMenu();
    if (this.form?.form === "settings") return this.renderSettings();
    if (this.form?.form === "keys") return this.renderKeys();
    if (this.form?.form === "comment") return this.renderCommentForm();
    if (this.form?.form === "comments") return this.renderCommentList();
    if (this.form?.form === "checkpoints") return this.renderCheckpoints();
    if (this.form) return this.renderForm();
    if (this.view === "changes") { // crash breadcrumbs: the first render after shown, and the first after the list is set
      if (!this.crumbRendered) { this.crumbRendered = true; crumb(`render: first Changes render after shown (list set=${this.changeSig != null})`, "changes"); }
      if (!this.crumbListRendered && this.changeSig != null) { this.crumbListRendered = true; crumb(`render: first Changes render with list set (${this.files.length} files, ${this.committed?.length ?? 0} committed)`, "changes"); }
    }
    const t = theme(), f = this.file(), vis = this.visible(), total = vis.reduce((n, x) => n + x.hunks.length, 0);
    const tag = (x) => x.created ? "new" : x.Ctext === null ? "deleted" : `${x.hunks.length}`;
    const rows = f ? this.rowsOf(f) : [], sel = f ? this.selection(f) : null, lsel = f ? this.lineSel(f) : null;
    this.bm = f ? this.bracketPair(f) : null; // D2: read by row()
    const ncomments = this.comments().length;
    this.cmtSpans = f && ncomments ? spansOn(this.comments(), f.key) : []; // read by row()
    this.pb = f && this.mode !== "changes" ? this.problems.forFile(f) : null; // read by row()
    const strip = this.pb && this.mode === "edit" && this.cur ? this.problems.strip(f, this.cur.line) : null;
    const stripStale = !!(strip && strip.stale), stripErr = !!(strip && strip.severity === "error");
    const picked = (this.mode === "changes" ? this.visible() : this.files).find((x) => x.key === this.sel); // an error tab shows its error
    // The left column and the diff or editor beside it, or one at a time when narrow (columns.js).
    const cols = this.mode === "changes" ? this.changesCols() : this.mode === "edit" && this.treeOn && !this.treeOnly() ? this.editCols() : { left: false, content: true, leftW: 0, single: false };
    this.cols = cols;
    const away = this.machine(), fb = this.fileBar(f, vis), hb = this.headerBar(total, ncomments);
    // An inline edit of this space; its target lines show selected while the box is open (ij.t, current lines).
    const ij = this.inlines?.get(this.spaceId) ?? null, it = ij && f && ij.key === f.key && ij.status !== "applying" ? ij.t : null;
    const inTarget = (r) => !!it && r.side === "new" && r.line >= it.a && r.line <= it.b;
    return v_flex().id("review").relative().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.paneH = size.height; if (Math.abs((this.paneW ?? 0) - size.width) > 0.5) { this.paneW = size.width; this.paint(cx); } })
      // Sizes come back in screen px, the app's zoom included (w(100) measures 120 at zoom 1.2), and
      // the bars are laid out in element px: this 100 px probe gives the ratio (px()).
      .child(div().id("unit-probe").absolute().top(0).left(0).w(100).h(0)
        .on_size_change((size, cx) => { const u = unitOf(size.width); if (Math.abs(u - (this.unit ?? 1)) > 0.001) { this.unit = u; this.paint(cx); } }))
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(40).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border)
        .when(!hb.has("narrow"), (e) => e.child(div().font_semibold().child("Wingman")))
        // A panel copy is one view: the panel's own Review and Edit buttons switch between them.
        .when(!this.view, (e) => e.child(h_flex().flex_none().gap(2).p(2).rounded(6).bg(t.raised).children(["review", "edit"].map((m) =>
          div().id(`mode-${m}`).h(22).px(8).flex().items_center().rounded(4).text_size(12).cursor_pointer()
            .when(this.mode === m, (e) => e.bg(t.selected)).on_click((_e, cx) => this.setMode(m, cx))
            .child(hb.has("narrow") ? (m === "review" ? "R" : "E") : m === "review" ? "Review" : "Edit")))))
        .child(div().flex_shrink(1).min_w(0).text_size(11).text_color(t.muted).truncate().child(`${away ? `on ${away} · ` : ""}${this.stores.map((st) => base(st.root)).join(", ")} · ${this.counts(total, vis)}${this.writing ? " · saving…" : ""}${agents().some((a) => a.space === this.spaceId && ACTIVE.has(a.status)) ? " · agent working" : ""}`))
        .child(div().flex_1())
        .when(hb.has("reason"), (e) => e.child(this.button("reason", hb.get("reason"), t.raised, (cx) => this.askReason(cx)).flex_none().whitespace_nowrap()))
        .when(hb.has("reject-all"), (e) => e
          .child(this.button("reject-all", hb.get("reject-all"), t.ansi1 + "55", (cx) => this.everything("reject", cx)).flex_none().whitespace_nowrap()))
        .when(hb.has("accept-all"), (e) => e
          .child(this.button("accept-all", hb.get("accept-all"), t.ansi2 + "55", (cx) => this.everything("accept", cx)).flex_none().whitespace_nowrap()))
        // G4: the space's checkpoints, one per agent turn: the turn's files, Restore to before it.
        .when(hb.has("checkpoints"), (e) => e.child(this.button("checkpoints", hb.get("checkpoints"), t.raised, (cx) => this.openCheckpoints(cx)).flex_none().whitespace_nowrap()))
        // Review comments: the count opens the list (send to the agent, jump, edit, delete).
        .when(hb.has("comments"), (e) => e.child(this.button("comments", hb.get("comments"), ncomments ? t.ansi5 + "55" : t.raised, () => this.openCommentList()).flex_none().whitespace_nowrap()))
        .child(this.button("settings", hb.get("settings"), t.raised, () => this.openSettings()).flex_none().whitespace_nowrap()))
      // A failing repo's capture (the leader's, shared): a warning row each, the rest of the view works.
      .children(captureNotices(shared(CAPTURE_ERRORS), this.spaceId, this.stores.map(idOf), Date.now()).map((n, i) =>
        h_flex().id(`capture-err-${i}`).flex_none().px(12).py(4).items_center().bg(t.ansi3 + "22").border_b(1).border_color(t.border).text_size(12)
          .child(div().flex_1().min_w(0).truncate().child(n.text))))
      .when(this.mode === "review", (e) => e.children(this.agentFiles.reviewLine(t))) // edits only the session log saw
      .child(h_flex().flex_1().min_h(0)
      .when(this.treeOnly(), (e) => e.child(this.renderLeft(t, true)))
      .when(this.mode === "edit" && this.treeOn && !this.treeOnly() && cols.left, (e) => e.child(this.renderLeft(t, false, cols)))
      .when(this.mode === "changes" && cols.left, (e) => e.child(this.renderChanges(t, cols)))
      .when(!this.treeOnly() && cols.content, (e) => e.child(v_flex().flex_1().min_w(0).h_full()
      // File tabs scroll sideways in their own area; the hint and file buttons stay pinned right,
      // fitted to the bar's width (fileBar: keys go first, then long labels, then whole buttons).
      .child(h_flex().id("file-bar").h(36).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border)
        .on_size_change((size, cx) => { if (Math.abs((this.barW ?? 0) - size.width) > 0.5) { this.barW = size.width; this.paint(cx); } })
        // One side at a time (columns.js): back to the list (Changes) or the tree (Edit).
        .when(fb.has("back"), (e) => e.child(this.button("cols-back", fb.get("back"), t.raised, (cx) => { if (this.mode === "changes") this.chgSide = "left"; else { this.treeOn = true; this.narrowLeft = true; this.refreshTrees(cx); } this.paint(cx); }).flex_none().whitespace_nowrap()))
        .child(div().id("file-tabs").flex_1().min_w(0).h_full().relative().overflow_hidden()
          .on_size_change((size, cx) => { this.tabViewW = size.width; this.setTabOffset(this.tabOffset ?? 0); if (this.sel) this.showTab(this.sel); this.paint(cx); })
          .on_scroll_wheel((ev, cx) => this.tabWheel(ev, cx))
          .when(this.mode === "changes" && !!f, (e) => e.child(div().absolute().top(0).bottom(0).left(4).flex().items_center().text_size(12).text_color(t.muted).child(f?.rel ?? "")))
          .when(this.mode !== "changes", (e) => e.child(h_flex().absolute().top(0).bottom(0).left(-(this.tabOffset ?? 0)).children(vis.map((x) => this.tab(x, t)))))
          // Position indicator, only when the tabs don't all fit.
          .when(this.tabMax() > 0, (e) => {
            const view = this.tabVW(), total = this.tabMax() + view;
            return e.child(div().absolute().bottom(1).h(2).rounded(1).bg(t.dim)
              .left(((this.tabOffset ?? 0) / total) * view).w(Math.max(24, (view / total) * view)));
          }))
        .when(fb.has("pos"), (e) => e.child(div().flex_none().whitespace_nowrap().text_size(10).text_color(t.dim).px(6).child(fb.get("pos"))))
        .when(fb.has("nvim"), (e) => e.child(this.button("nvim", fb.get("nvim"), t.raised, (cx) => this.toNvim(f, f.hunks[this.current]?.n ?? 0, cx)).flex_none().whitespace_nowrap()))
        .when(fb.has("save"), (e) => e.child(this.button("save", fb.get("save"), t.accent + "55", (cx) => this.saveKey(cx)).flex_none().whitespace_nowrap()))
        // A review comment on the cursor's line or the selection (Review also has one on each change).
        .when(fb.has("add-comment"), (e) => e.child(this.button("add-comment", fb.get("add-comment"), t.ansi5 + "40", (cx) => this.commentHere(cx)).flex_none().whitespace_nowrap()))
        // Only a file with the agent's changes (an opened file's own edits aren't the agent's).
        .when(fb.has("discard-yes"), (e) => e.child(this.button("discard-yes", fb.get("discard-yes"), t.ansi1 + "88", (cx) => this.discard(f, cx)).flex_none().whitespace_nowrap())
          .child(this.button("discard-no", "Cancel", t.raised, (cx) => { this.discardKey = null; this.paint(cx); }).flex_none()))
        .when(fb.has("discard"), (e) => e.child(this.button("discard", fb.get("discard"), t.ansi1 + "40", (cx) => { this.discardKey = f.key; this.paint(cx); }).flex_none().whitespace_nowrap()))
        .when(fb.has("reject-file"), (e) => e.child(this.button("reject-file", fb.get("reject-file"), t.ansi1 + "40", (cx) => this.wholeFile("reject", cx)).flex_none().whitespace_nowrap()))
        .when(fb.has("accept-file"), (e) => e.child(this.button("accept-file", fb.get("accept-file"), t.ansi2 + "40", (cx) => this.wholeFile("accept", cx)).flex_none().whitespace_nowrap()))
        .when(fb.has("vscode"), (e) => e.child(this.button("vscode", fb.get("vscode"), t.raised, (cx) => this.toVSCode(cx)).flex_none().whitespace_nowrap())))
      .when(!(this.mode === "edit" && this.treeOn) && !!(this.ws || (this.wsBusy && this.wsBusySpace === this.spaceId)), (e) => e.child(this.workspacePanel(t)))
      .when(!!f && !!this.bar, (e) => e.child(this.findBar(f, t)))
      .when(!!ij && this.mode === "edit", (e) => e.child(this.inlineBar(ij, t)))
      .when(this.mode === "changes" && !!this.gitx?.askBar(t), (e) => e.child(this.gitx.askBar(t))) // G6: Discard change's question
      .when(!!f?.conflict, (e) => e.child(h_flex().px(12).py(6).gap(8).items_center().bg(t.ansi3 + "22").text_size(12)
        .child(div().flex_1().child(f?.conflict?.theirs ? "The agent changed the same lines you're editing." : "The file was deleted while you were editing it."))
        .child(this.button("ours", "Keep mine", t.raised, (cx) => this.resolve("ours", cx)))
        .child(this.button("theirs", f?.conflict?.theirs ? "Take agent's" : "Drop my edits", t.ansi1 + "55", (cx) => this.resolve("theirs", cx)))))
      .when(!!(this.error || this.status || !f || f?.lazy), (e) => e.child(h_flex().px(12).py(6).gap(10).items_center().text_size(12)
        .child(div().flex_1().min_w(0).text_color(this.error || picked?.error ? t.ansi1 : t.muted).child(this.error ?? this.status ?? (f?.lazy ? `Loading ${f.rel}…` : picked?.error ? `${picked.rel}: ${picked.error}` : this.mode === "edit" ? `No file open: pick one in the file tree (${this.kl("toggleTree")}) or Quick Open (${this.kl("quickOpen")})` : this.mode === "changes" ? "No uncommitted changes" : "No changes to review")))
        .when(!this.stores.length && !!this.spaceId, (e) => e.child(this.button("open-folder", "Add repo…", t.raised, (cx) => this.openFolder(cx)).flex_none()))))
      .when(!!f, (e) => e.child(div().id("review-diff").flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
        .on_size_change((size, cx) => { this.viewH = size.height; this.viewW = size.width; this.paint(cx); })
        // 100 characters' width in the diff font (screen px; cw() makes one in element px), for cursor columns (the font is monospace).
        .child(div().absolute().top(0).left(0).opacity(0).whitespace_nowrap().child("0".repeat(100))
          .on_size_change((size, cx) => { const w = size.width; if (w > 0 && Math.abs(w - (this.charPx ?? 0)) > 0.05) { this.charPx = w; this.paint(cx); } }))
        .child(v_virtual_list("review-rows", rows.length, ROW, (i) => rows[i].kind === "@" ? `h${rows[i].hunk}` : `r${i}`,
          (range) => {
            // The list calls this twice a frame: once with [0, 1) to measure a row, then with
            // the visible range. Only the second says which row is on top.
            if (!(range.start === 0 && range.end === 1 && rows.length > 1)) this.drawnTop = range.start;
            return rows.slice(range.start, range.end).map((r, k) => this.row(r, f, t, (lsel && range.start + k >= lsel[0] && range.start + k <= lsel[1]) || inTarget(r))); })
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
        .when(!!sel, (e) => e.child(this.selectionBar(f, sel, t)))))
      // The cursor line's problems, one line (no hover API: this is where their messages show).
      .when(!!strip, (e) => e.child(h_flex().id("problem-strip").h(22).flex_none().px(10).gap(6).items_center().border_t(1).border_color(t.border).bg(t.raised).text_size(11.5)
        .when(stripStale, (e) => e.opacity(0.6))
        .child(div().flex_none().text_color(stripErr ? t.ansi1 : t.ansi3).child(stripErr ? "●" : "▲"))
        .child(div().flex_1().min_w(0).truncate().child(strip ? strip.text : ""))
        .when(stripStale, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child("edited since the check"))))))))
      // Quick Open floats over everything, so it's the root's last child.
      .when(!!this.qo, (e) => e.child(this.quickOpen(t)));
  }
}
