// Wayfindr: one Profile's Boards and Pull Requests, in its own "wayfindr" block in the layout's
// "work-body" row. tabs-plus hides the terminals and the side panel while it shows.
// Keys as CodeyPacker's mods and Dockr have them (keys.js): ctrl-shift-j shows Wayfindr and takes the keyboard,
// j/k move, enter opens, q closes a layer, ? lists every key, and a legend shows the few that apply now.
// Board data comes from the cache at once, then refreshes in the background on show and every
// 30 minutes while shown. Nothing runs while hidden (D25).
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input, TextareaState, Textarea, Popup, Scrollbar } from "gpui-base";
import * as fs from "fs/promises";
import { run, layout, props, panes, focused, closeOverlay, shared, setShared, theme, settings, home, appHome, readTextFile, writeTextFile, nextCommand, notify, spaces, machines, pickFolder, window as herdrWindow } from "herdr";
import { parseConfig, defaultRunner } from "./config.js";
import { parseWranglr } from "./wranglr.js";
import { createRunner } from "./runner.js";
import { loadBoard, loadTicket, loadPullRequests, loadPullRequestDetail, loadLocalPrDiff, signInStates, discoverBoards, discoverRepos, loadImages, IMAGE_MD, existingWorktrees, makeLaunchWorktrees, makeReviewWorktree, listClones, cloneOrigin, loadReviewInfo, moveTicket, updateTicket, commentOnTicket, postPrReview, replyToPrThread, pruneImages, boardStatuses, providerFor, renameProfileData } from "./flow.js";
import * as edits from "./settings.js";
import { DEFAULT_LAUNCH, DEFAULT_REVIEW, resolveTemplate, agentArgv, launchPrompt, reviewPrompt, ticketFolder, ticketPrefix, reviewFolder, slug, repoName, spaceTarget, launchSpaceName, reviewSpaceName, reviewPaneSpot } from "./launch.js";
import { shellInvocation } from "./command.js";
import { sameRepo, scanRoots } from "./clones.js";
import { diffRows, longestLine } from "./prdiff.js";
import { groupFiles, viewedKey, applyViewed, threadsOn, unplacedThreads, barePath } from "./prfiles.js";
import { COMMENTS_DIR, parseComments, commentsOn, coveredRows, openAt, extendOpen, saveComment, removeComment, linesOf, rowOf, verdictsFor, verdictLabel, canPost, toReview, confirmText } from "./prcomments.js";
import { newItems, toastsFor } from "./background.js";
import { byColumn, byRepo, initials, trackColumns, can, repoFilter, moveTarget, NO_COLUMN } from "./providers/contract.js";
import { panesFile, parsePanes, serializePanes, addPane, prunePanes, tabIdsOf, recordedPanes, remakePlan } from "./panes.js";
import { cacheFile, parseCache, serializeCache, cachedBoard, withBoard, cachedPrs, withPrs, prsKey, formatAge, isShown, due, POLL_MS } from "./cache.js";
import { PR_CACHE_DIR, prCacheFile, parsePrCache, serializePrCache, detailStale, prunePrKeys } from "./prcache.js";
import { keyAction, keyHints, coreHints, RESERVED } from "./keys.js";
import { assignLetters, letterBadge, navigateByLetter } from "./kit/letters.js";
import { legend } from "./kit/legend.js";

const REQUEST = "wayfindr.request"; // the key's popup copy asks the main copy for the keyboard (D8)

const VIEW_KEY = "wayfindr.view.v1";
const COLUMN_W = 280, PANEL_W = 460;
const IMAGE_DIR = "data/wayfindr-images"; // under Herdr's home: image() reads from there
const SITE = { github: "GitHub", azure: "Azure", clickup: "ClickUp" }; // for the Board's "View in …" link
const FILE_STATUS = { added: "A", modified: "M", deleted: "D", renamed: "R" };
// The Pull Request overlay's width as a fraction of Wayfindr's: 60% to start, dragged by its left edge.
const PR_W_KEY = "wayfindr.prWidth", PR_W_DEFAULT = 0.6, PR_W_MIN = 0.3, PR_W_MAX = 0.95;
// The overlay's file rail (#24): 210 px to start, dragged by its right edge.
// The overlay fullscreen (#29): "1" or "0" in this copy's localStorage, off by default.
const PR_FULL_KEY = "wayfindr.prFull";
const PR_RAIL_KEY = "wayfindr.prRail", PR_RAIL_DEFAULT = 210, PR_RAIL_MIN = 140, PR_RAIL_MAX = 560;
// Viewed marks, one file per Pull Request: { head, files: { [path]: true } }, under Herdr's home.
const VIEWED_DIR = "data/wayfindr/viewed";
const viewedDir = () => `${appHome()}/${VIEWED_DIR}`.replace(/\\/g, "/");
const prCacheDir = () => `${appHome()}/${PR_CACHE_DIR}`.replace(/\\/g, "/"); // the Pull Request detail cache (#31)
// Line comments (#27), one file per Pull Request: [{ id, path, line, side, startLine?, startSide?, text, code }].
// The save path is data/wayfindr/comments/<viewedKey>.json under Herdr's home (COMMENTS_DIR).
const commentsDir = () => `${appHome()}/${COMMENTS_DIR}`.replace(/\\/g, "/");
const REVIEW_SCREEN = "__review__"; // prShown's value for the Post review screen (#27): not a file, not in the rail order
const DIFF_LINES = 500; // a patch's rows shown before "Show N more lines"
const DIFF_CHAR_W = 7, DIFF_GUTTER = 80; // about one terminal-font character at 11.5 px; number, mark and gaps
const PR_SITE = { github: "GitHub", azure: "Azure DevOps" }; // where API diffs come from
const diffRowsOf = new WeakMap(); // a PrDetail file -> { rows, longest }, so a render doesn't parse again
// A faint background of a theme color (#rrggbb), or none.
const tint = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? `${c}1f` : null);

const configPath = () => `${appHome()}/data/wayfindr.json`;
// Review panes that come back without props (#30): a copy that may be one asks, one copy re-makes them.
const ORPHAN = "wayfindr.orphan", REMAKE = "wayfindr.remake";
// Every copy started without pr or overlay props registers here: { [copy id]: when }. One such copy is the main
// one; a second means a Review pane lost its props. The id is this copy's own (localStorage), so a reload keeps it.
const COPIES = "wayfindr.copies", COPY_WINDOW_MS = 30_000;
// Wranglr's config: its worktree rule is the default Worktree Placement when Wranglr is set up.
const wranglrPath = () => `${appHome()}/wranglr.json`;

const EXAMPLE = `{
  "activeProfile": "work",
  "profiles": {
    "work": {
      "runner": "wsl:Ubuntu",
      "accounts": [{ "id": "gh-work", "provider": "github", "login": "<gh user>" }],
      "repos": [],
      "boards": [{ "id": "team", "account": "gh-work", "ref": { "owner": "<user or org>", "number": 1 } }]
    }
  }
}`;

const stop = (_e, cx) => cx.stop_propagation();
// localStorage holds per-viewer niceties only; it can be missing, so every access is guarded.
// Remembered view state lives in Herdr's shared state: saved across restarts and the same for every
// copy (localStorage is per copy, so a Wayfindr in another space or layout started blank). A value
// only localStorage has is still read.
const load = (k, fallback) => {
  const v = shared(k);
  if (v != null) return v;
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
};
const save = (k, v) => setShared(k, v);

// A header action as an icon, like Herdr's pane actions. `on` marks the one that is open.
function iconButton(id, icon, t, onClick, { on = false } = {}) {
  return div().id(id).p(4).flex_none().rounded(4).cursor_pointer()
    .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.hover))
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", stop).on_click((_e, cx) => onClick(cx))
    .child(svg(`mods/wayfindr/icons/${icon}.svg`).size(14));
}

// `inert`: under the Pull Request overlay's scrim, which takes the events: no hover or pointer cursor.
function button(id, label, t, onClick, { on = false, inert = false } = {}) {
  return h_flex().id(id).h(26).px(10).flex_none().items_center().rounded(6)
    .text_size(12).text_color(on ? t.foreground : t.muted).bg(on ? t.selected : t.background)
    .when(!inert, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .on_mouse_down("left", stop).on_click((_e, cx) => onClick(cx))
    .child(label);
}

function segmented(id, options, value, t, onPick) {
  return h_flex().id(id).p(2).gap(2).rounded(8).bg(t.chrome).border_1().border_color(t.border).children(options.map(([key, label]) => {
    const on = key === value;
    return h_flex().id(`${id}-${key}`).h(24).px(12).items_center().rounded(6)
      .bg(on ? t.raised : t.chrome).text_size(12).text_color(on ? t.foreground : t.muted).when(on, (el) => el.font_semibold())
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => onPick(key, cx))
      .child(div().truncate().child(label));
  }));
}

function checkRow(id, on, label, t, onClick) {
  return h_flex().id(id).flex_1().min_w(0).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => onClick(cx))
    .child(h_flex().w(14).h(14).flex_none().justify_center().items_center().rounded(3).border_1()
      .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background).text_size(10).text_color(t.background).when(on, (el) => el.child("✓")))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(label));
}

// The wrapper keeps the click from reaching the root, whose mouse-down would take the focus back.
const FOLD_PARTS = ["", "boards", "repos", "repos.others"];
const field = (state, t, w = 260) => div().on_mouse_down("left", stop)
  .child(Input.new(state).w(w).h(28).px(8).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground));

// Markdown link text: brackets would end the link early.
const linkText = (s) => String(s ?? "").replace(/([[\]\\])/g, "\\$1");
// Only web and mail links are links (security F3). Others show as plain text. `<`, `>` and whitespace
// would end the `<…>` destination early, so they are percent-encoded.
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const linkUrl = (url) => String(url).replace(/[<>\s]/g, (c) => encodeURIComponent(c));
const link = (label, url) => url && SAFE_URL.test(String(url)) ? `[${linkText(label)}](<${linkUrl(url)}>)` : linkText(label);

// `cursor`: the card the arrow keys are on (#20).
function card(tk, t, selected, onClick, cursor = false) {
  return v_flex().id(`wf-card-${tk.key}`).gap(6).p(10).rounded(8).bg(cursor ? t.hover : t.surface).border_1().border_color(selected ? t.accent : cursor ? t.foreground : t.border)
    .cursor_pointer().hover((s) => s.border_color(selected ? t.accent : t.input))
    .on_mouse_down("left", stop).on_click((_e, cx) => onClick(cx))
    .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
      .child(div().child(tk.id)).child(div().child("·")).child(div().truncate().child(tk.type)))
    .child(div().text_size(13).text_color(t.foreground).child(tk.title))
    .when(Boolean(tk.priority) || tk.assignees.length > 0, (el) => el.child(h_flex().gap(4).items_center()
      .when(Boolean(tk.priority), (r) => r.child(h_flex().h(18).px(6).items_center().rounded(9).bg(t.selected).text_size(11).text_color(t.muted).child(tk.priority)))
      .child(div().flex_1())
      .children(tk.assignees.slice(0, 3).map((a) => h_flex().id(`wf-a-${tk.key}-${a.id}`).w(20).h(20).flex_none().justify_center().items_center()
        .rounded(10).bg(t.raised).border_1().border_color(t.border).text_size(9).font_semibold().text_color(t.muted).child(initials(a.name))))));
}

const prAge = (pr) => pr.updatedAt ? ` · updated ${formatAge(Date.now() - Date.parse(pr.updatedAt))}`
  : pr.createdAt ? ` · opened ${formatAge(Date.now() - Date.parse(pr.createdAt))}` : "";

// A scanned clone as a button label: its full path, then a `worktree` tag when it is a worktree.
function hitLabel(h, t) {
  return h_flex().gap(6).items_center().child(div().child(h.path))
    .when(h.kind === "worktree", (el) => el.child(div().text_size(11).text_color(t.muted).child("worktree")));
}

// The one hit to save without asking: exactly one, and a clone. A worktree never counts as the one.
const soleClone = (hits) => hits.length === 1 && hits[0].kind === "clone" ? hits[0] : null;

// A clone state (cloneState) as a coloured dot, or a spinner while searching.
const STATE_TEXT = { unscanned: "not looked for", searching: "searching…", none: "no clone found", several: "several found", one: "found, not saved" };
const stateColor = (status, t) => status === "found" ? t.done : status === "unscanned" ? t.dim : status === "none" ? t.blocked : t.working;
function stateMark(status, t) {
  if (status === "searching") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
  return div().w(8).h(8).flex_none().rounded(4).bg(stateColor(status, t));
}

// A Pull Request's checks (#26): a mark and a colour per state, and the header badge's text.
const CHECK_MARK = { fail: "✗", pending: "●", pass: "✓", skipped: "–" };
const checkColor = (state, t) => state === "fail" ? t.blocked : state === "pending" ? t.working : state === "pass" ? t.done : t.dim;
const CHECK_ORDER = { fail: 0, pending: 1, pass: 2, skipped: 3 };
function checksBadge(checks) {
  const n = (s) => (checks?.list ?? []).filter((c) => c.state === s).length;
  if (n("fail")) return { state: "fail", text: `✗ ${n("fail")} failing` };
  if (n("pending")) return { state: "pending", text: `● ${n("pending")} running` };
  if (n("pass")) return { state: "pass", text: `✓ ${n("pass")} passed` };
  return null;
}

// Where a Repo's worktrees go, as the Launch card says it. wr: Wranglr's parsed config, or null.
const placementText = (w, wr) => w === "wranglr" ? (wr ? `Wranglr's rule (${wr.worktrees})` : "Herdr's worktrees folder (Wranglr isn't set up)")
  : w === "herdr" ? "Herdr's worktrees folder" : w === "beside" ? "beside the clone" : w;

// Several clones of the Pull Request's repo: one button per clone, then Cancel. `review` as in prRow.
function cloneChooser(id, review, t, inert = false) {
  return v_flex().id(id).gap(4).items_start()
    .child(div().text_size(11).text_color(t.dim).child("Several clones found. Review in:"))
    .children(review.state.hits.map((h, i) => button(`${id}-${i}`, hitLabel(h, t), t, (cx) => review.choose(h.path, cx), { inert })))
    .child(button(`${id}-cancel`, "Cancel", t, (cx) => review.cancel(cx), { inert }));
}

// `review`: { state, start, choose, cancel } from reviewActions.
// `select`: { selected, onClick, inert }, the row opens the Pull Request panel; inert while the overlay's
// scrim covers the list (hit testing has no occlusion, so the row's hover is left off instead).
// `badge`: the row's letter (D7), drawn before its title while Wayfindr holds the keyboard, else null.
function prRow(pr, t, review = null, select = null, badge = null) {
  const inert = Boolean(select?.inert);
  return h_flex().id(`wf-pr-${pr.key}`).gap(12).px(12).py(8).items_center().border_t(1).border_color(t.border)
    .when(Boolean(select?.selected), (el) => el.bg(t.selected))
    .when(Boolean(select) && !inert, (el) => el.cursor_pointer()
      .hover((s) => s.bg(select.selected ? t.selected : t.hover))
      .on_mouse_down("left", stop).on_click((_e, cx) => select.onClick(cx)))
    .when(Boolean(badge), (el) => el.child(badge))
    .child(v_flex().flex_1().min_w(0).gap(4)
      .child(h_flex().gap(8).items_center().min_w(0)
        .when(pr.checks != null && pr.checks !== "none" && pr.checks in CHECK_MARK, (el) => el.child(div().flex_none().text_size(11).text_color(checkColor(pr.checks, t)).child(CHECK_MARK[pr.checks])))
        .when(pr.draft, (el) => el.child(h_flex().h(18).px(6).flex_none().items_center().rounded(9).bg(t.selected).text_size(11).text_color(t.muted).child("Draft")))
        .child(div().min_w(0).truncate().text_size(13).text_color(t.foreground).child(pr.title)))
      .child(div().text_size(11).text_color(t.dim).truncate()
        .child(`${pr.id} · ${pr.author.name}${prAge(pr)}`))
      .when(review?.state?.status === "choose", (el) => el.child(cloneChooser(`wf-pr-choose-${pr.key}`, review, t, inert))))
    .when(Boolean(review?.state?.status === "error"), (el) => el.child(div().max_w(260).flex_none().text_size(11).text_color(t.blocked).child(review.state.error)))
    .when(Boolean(review), (el) => el.child(button(`wf-pr-review-${pr.key}`, review.state?.status === "busy" ? (review.state.message ?? "Starting…") : "Review", t,
      (cx) => review.start(cx), { on: review.state?.status === "busy", inert })))
    .when(Boolean(pr.url), (el) => el.child(div().flex_none().text_size(12).on_mouse_down("left", stop).child(TextView.markdown(`wf-pr-open-${pr.key}`, link("Open in browser", pr.url)))));
}

// Loading placeholders: grey bars in the shape of what's coming, pulsing (native animation, no timer).
const bar = (t, w, h = 10) => div().w(w).h(h).flex_none().rounded(4).bg(t.raised);
const pulse = (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1400 });

function skeletonColumns(t) {
  return pulse(h_flex().id("wf-columns-skeleton").size_full().min_w(0).min_h(0).px(16).pb(16).gap(12).items_start().overflow_hidden()
    .children([3, 2, 4, 1].map((n, i) => v_flex().id(`wf-col-skel-${i}`).w(COLUMN_W).flex_none().rounded(10).bg(t.chrome).border_1().border_color(t.border)
      .child(h_flex().h(36).px(12).gap(8).flex_none().items_center().child(bar(t, 80, 12)).child(bar(t, 14)))
      .child(v_flex().px(8).pb(8).gap(8).children(Array.from({ length: n }, (_, j) =>
        v_flex().gap(8).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
          .child(bar(t, 70, 9)).child(bar(t, (i + j) % 2 ? 210 : 230, 12)).child(bar(t, (i + j) % 2 ? 120 : 160, 12))))))));
}

// Both skeletons follow their panel's order below the title.
const skelRow = (t, w) => h_flex().gap(8).items_center().child(div().w(84).flex_none().child(bar(t, 56))).child(bar(t, w));
const skelSection = (t, w) => div().pt(8).child(bar(t, w, 9));
const skelComment = (t) => v_flex().gap(8).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
  .child(bar(t, 120, 9)).child(bar(t, 360, 11)).child(bar(t, 240, 11));

// Column, Assignees, Tags, Priority, Parent; Open in browser; Move to; description; Pull requests; Comments.
function skeletonTicket(t) {
  return pulse(v_flex().gap(10)
    .child(v_flex().gap(8).children([90, 140, 70, 40, 180].map((w) => skelRow(t, w))))
    .child(bar(t, 96, 12))
    .child(bar(t, 180, 26))
    .child(skelSection(t, 80))
    .child(v_flex().gap(8).children([380, 400, 340, 360, 300, 390, 220].map((w) => bar(t, w, 11))))
    .child(skelSection(t, 100)).child(bar(t, 240, 11))
    .child(skelSection(t, 110))
    .child(skelComment(t)));
}

// Author, Branch, Reviewers, Opened, Updated; Open in browser; description; files; comments.
function skeletonPr(t) {
  return pulse(v_flex().gap(10)
    .child(v_flex().gap(8).children([110, 200, 160, 80, 80].map((w) => skelRow(t, w))))
    .child(bar(t, 96, 12))
    .child(skelSection(t, 80))
    .child(v_flex().gap(8).children([380, 400, 340, 360, 220].map((w) => bar(t, w, 11))))
    .child(skelSection(t, 60))
    .child(v_flex().gap(6).children([0, 1, 2].map(() => div().w_full().h(22).rounded(4).bg(t.raised))))
    .child(skelSection(t, 110))
    .child(skelComment(t)));
}

export default class Wayfindr extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    // Opened by its key (mod.open, D8): this popup copy shows the block, asks the main copy for the keyboard
    // through shared state, and closes. A hidden block hears no commands; mod.open always runs.
    this.passing = props()?.overlay != null;
    if (this.passing) {
      if (!isShown(layout(), (n) => n.content?.mod === "wayfindr")) run("layout.show", { id: "wayfindr" });
      setShared(REQUEST, { n: Date.now(), kind: "keys" });
      closeOverlay(props().overlay);
      return;
    }
    // Keys (keys.js, D9). `kb`: Wayfindr holds the keyboard, asked of the handle at each render.
    this.kb = false;
    this.gone = false; // the keyboard left: a press outside, or a close
    this.heldAt = 0; // when Wayfindr last drew holding the keyboard
    this.gotFocus = false; // Herdr's "focus" command arrived during grabKeys
    this.help = false; // the "?" list is shown
    this.typed = ""; // letters typed toward a Pull Request row's hint
    this.prCursor = null; // the selected Pull Request row's key (D6)
    this.moveCursor = 0; // the Move list's highlighted Column
    this.note = null; // { text, until }: shown in the legend's place, as "Copied"
    this.lastView = "board"; // where Settings goes back to
    this.seenRequest = shared(REQUEST)?.n ?? 0;
    // A pane copy (#30): Review's pane beside the agent, opened with pane.split props { pr: { account, pr } }.
    // It shows only that Pull Request: no views, no list, no Boards, no toasts.
    const pp = props()?.pr;
    this.paneFor = pp && typeof pp === "object" && typeof pp.account === "string" && pp.pr && typeof pp.pr.key === "string" ? { account: pp.account, pr: pp.pr } : null;
    this.view = ["prs", "settings"].includes(load(VIEW_KEY, "board")) ? load(VIEW_KEY, "board") : "board";
    this.state = { status: "loading" };
    this.checks = null;
    this.boards = {}; // board id -> { status: "cached" | "loading" | "ok" | "error", data, at, tried, error }
    this.boardSeq = {}; // board id -> the newest fetch's number: an older result is dropped
    this.movedRecently = {}; // board id -> { key, columnId, status, until }: the last Move, kept through stale reads
    this.hidden = true; // until seen on screen: the first show refreshes
    this.lastRefresh = null;
    this.selected = null; // { boardId, summary }: the Ticket in the detail panel
    this.tickets = {}; // ticket key -> { status, data, error }
    this.images = {}; // image url -> { status, file, error }: saved files stay across reloads
    this.launch = null; // the Launch dialog: { key, selected: repo ids, exists: names | null, status, error, message }
    this.reviews = {}; // pr key -> { status: "busy" | "error" | "choose", message, error, hits }
    this.clones = null; // the clone index, scanned once per session: { status: "loading" | "ok" | "error", list, error, at }
    this.wranglr = null; // Wranglr's worktree rule (parseWranglr), read on reload and before each Launch and Review; null when Wranglr isn't set up
    this.cloneFind = {}; // settings: "<account id>:<repo>" -> { status: "loading" | "none" | "choose" | "error", hits, error }
    this.selectedPr = null; // { account, pr }: the Pull Request in the detail panel
    this.prDetails = {}; // pr key -> { status, data, at, error }: at is when data was fetched (#31)
    this.prCacheText = {}; // pr key -> the cache file's text last read or written, for compare-and-swap (#31)
    this.prAll = {}; // pr key -> { file path -> true }: every diff row shows, not only the first DIFF_LINES
    this.prShown = {}; // pr key -> the shown file's path, or null for the Overview (#24)
    this.prLast = null; // the last opened Pull Request's key: opening another shows its Overview
    this.prViewed = {}; // pr key -> { head, files: { path -> true }, file, text, saving }: the viewed marks (D8)
    this.prThreadsOpen = {}; // pr key -> Set of resolved thread ids drawn open (#25)
    this.railDrag = null; // the rail's edge drag: { x, from, w }
    this.prFull = (() => { try { return localStorage.getItem(PR_FULL_KEY) === "1"; } catch { return false; } })(); // the overlay fullscreen (#29)
    // Writing a review (#27).
    this.prComments = {}; // pr key -> { list, file, text, saving }: the line comments saved on this computer
    this.prOpen = {}; // pr key -> the comment box: { path, line, side, startLine?, startSide?, editId? } or { reply: thread id }, or null
    this.prBox = TextareaState.new({ placeholder: "Comment on this line (markdown)", rows: 3 });
    this.prBox.set_auto_grow(3, 10);
    this.prBox.on("focus", () => { this.typing = "pr"; });
    this.prBox.on("blur", () => { if (this.typing === "pr") this.typing = false; });
    this.prBox.on("submit", (_e, cx) => { this.savePrBox(cx); cx.notify(); });
    this.prSummary = TextareaState.new({ placeholder: "Summary (optional)", rows: 3 });
    this.prSummary.set_auto_grow(3, 10);
    this.prSummary.on("focus", () => { this.typing = "summary"; });
    this.prSummary.on("blur", () => { if (this.typing === "summary") this.typing = false; });
    this.prSummary.on("change", (_e, cx) => cx.notify()); // the Post button wakes when a summary is typed
    this.prVerdict = {}; // pr key -> "comment" | "approve" | "changes"
    this.prConfirm = null; // the pr key whose Post waits for Yes
    this.prPosting = null; // { key, status: "busy" | "done" | "error", url, error }
    this.prReplying = null; // { key, id (thread), status: "busy" | "error", error }
    this.editing = null; // the title being edited: { key, input, status, error }
    this.commentBox = TextareaState.new({ placeholder: "Write a comment (markdown)", rows: 3 });
    this.commentBox.set_auto_grow(3, 10);
    // `typing`: which text box has focus ("comment" or "title"), else false.
    this.commentBox.on("focus", () => { this.typing = "comment"; });
    this.commentBox.on("blur", () => { this.typing = false; });
    this.commentDrafts = {}; // ticket key -> the comment box's text, kept while another Ticket is open
    this.draftKey = null; // the Ticket whose draft is in the box
    this.commenting = null; // { key, status, error }
    this.prs = null; // { status, data: loadPullRequests()'s list, at, tried, error }
    this.found = {}; // settings: account id -> { boards: { status, data, error }, repos: { ... } }
    this.statusLists = {}; // settings: board id -> { status, data, error }
    this.statusOpen = null; // settings: the board id whose statuses are shown
    this.confirm = null; // settings: the remove button waiting for a second click
    this.settingsError = null;
    this.inputs = {
      profile: InputState.new({ placeholder: "new profile name" }),
      gh: InputState.new({ placeholder: "GitHub user name" }),
      ado: InputState.new({ placeholder: "https://dev.azure.com/<org>" }),
      boards: {}, // account id -> InputState: each list's search
      repos: {},
    };
    this.renaming = null; // { name, input }: the Profile being renamed
    this.signInToasted = new Set(); // account ids already toasted for sign-in this session
    this.lastBackground = null;
    this.pendingView = null; // { view, boardId, until }: where the last toast's click lands
    if (this.paneFor) return this.initPane(cx);
    this.orphanSeen = null; // the last wayfindr.orphan this copy looked at
    this.registerCopy();
    this.lookForOrphans(cx);
    cx.timer.after(500, (cx) => this.remakeIfAsked(cx));
    this.reload(cx);
    // Reads the layout only (due() gates requests), often enough that a show from anywhere is noticed.
    // Redraws on a show, and once a minute while shown (the "Updated" age).
    let drawn = 0;
    cx.timer.every(2_000, (cx) => {
      if (this.paneFor) return; // became a Review pane late (lookForOrphans)
      const was = this.hidden;
      this.takeRequest(cx);
      this.remakeIfAsked(cx);
      if (this.watch(cx) && (was || Date.now() - drawn >= 60_000)) { drawn = Date.now(); cx.notify(); }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^wayfindr\./, "");
        if (c === "focus") { this.gotFocus = true; this.gone = false; this.handle.focus(); }
        else if (c === "close") this.close_(cx);
        else if (c === "refresh") { if (this.paneFor) { if (this.profile) this.fetchPr(cx, { force: true }); } else this.reload(cx); }
        else if (c === "profile") { if (!this.paneFor) await this.nextProfile(cx); }
        cx.notify();
      }
    });
    cx.timer.every(60_000, (cx) => this.backgroundTick(cx));
  }

  // The pane copy (#30): the config (runner, templates), then the Pull Request. refresh reloads the PR; focus
  // focuses; close and profile do nothing here (Herdr's pane header closes the pane).
  initPane(cx, { loop = true } = {}) {
    this.hidden = false;
    this.selectedPr = this.paneFor; this.prLast = this.paneFor.pr.key; this.prShown[this.paneFor.pr.key] = null;
    this.reload(cx);
    if (!loop) return; // the main loop above already handles a copy that became a pane late
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^wayfindr\./, "");
        if (c === "focus") { this.gone = false; this.handle.focus(); }
        else if (c === "refresh" && this.profile) this.fetchPr(cx, { force: true }); // Refresh always refetches (#31)
        cx.notify();
      }
    });
  }

  // The exception to "never while hidden": every notifications.minutes, shown or hidden, the Pull Requests
  // and every followed Board refresh so their diffs can toast. Skipped when a foreground refresh ran
  // within the window, so a shown Wayfindr doesn't fetch twice.
  backgroundTick(cx) {
    if (this.state.status !== "ok" || !this.profile.notifications.enabled) return;
    const span = this.profile.notifications.minutes * 60000, now = Date.now();
    if (now - (this.lastBackground ?? 0) < span) return;
    if (this.lastRefresh != null && now - this.lastRefresh < span) return;
    this.lastBackground = now;
    this.checkSignIn(cx, { toast: true });
    this.fetchPrs(cx);
    for (const b of this.profile.boards) this.fetchBoard(b, cx);
  }

  // Toasts unless Wayfindr is shown on the toast's own view. A click shows Wayfindr and lands on pendingView.
  announce(toasts, cx) {
    if (this.paneFor) return;
    const shown = toasts.length ? this.shownNow() : false;
    for (const x of toasts) {
      if (shown && ((x.view === "prs" && this.view === "prs") || (x.view === "board" && this.view === "board" && this.board?.id === x.boardId))) continue;
      notify({ title: x.title, body: x.body, level: "info", icon: "mods/wayfindr/wayfindr.svg", timeout: 12000, action: { name: "layout.show", args: { id: "wayfindr" } } });
      this.pendingView = { view: x.view, boardId: x.boardId, until: Date.now() + 120000 };
    }
  }

  // Hidden from now: the next show is noticed at once (it refreshes). The terminals come back, and the keyboard
  // goes to one of them (D8): pane.go steps, 100 ms apart, until a terminal pane is focused.
  close_(cx) {
    if (this.paneFor) return;
    run("layout.hide", { id: "wayfindr" });
    this.hidden = true; this.gone = true; this.heldAt = 0; this.help = false; this.typed = "";
    if (!cx) return;
    cx.spawn(async (cx) => {
      const dirs = ["right", "left", "down", "up"];
      for (let i = 0; i < 6; i++) {
        await cx.sleep(100);
        if (this.terminalFocused()) return;
        run("pane.go", { direction: dirs[i % dirs.length] });
      }
    });
  }

  // A terminal pane has the keyboard: focused() names a pane that panes() lists as focused.
  terminalFocused() {
    const f = focused();
    return Boolean(f?.pane) && panes().some((p) => p.pane === f.pane && p.focused);
  }

  // The key's request (D8), from the popup copy through shared state.
  takeRequest(cx) {
    const req = shared(REQUEST);
    if (!req?.n || req.n === this.seenRequest) return;
    this.seenRequest = req.n;
    if (req.kind === "keys") this.keysCommand(cx);
  }

  // The key (ctrl-shift-j): holding the keyboard a moment ago, it hides Wayfindr; else it takes the keyboard.
  // Wayfindr's own key section (mod:wayfindr) hides it while it holds the keyboard; this covers that section missing,
  // when the key's popup has just taken the keyboard off Wayfindr.
  keysCommand(cx) {
    if (Date.now() - this.heldAt < 1500) return this.close_(cx);
    cx.spawn(async (cx) => { await this.grabKeys(cx); });
  }

  // Only Herdr moves the keyboard off a terminal, with pane.go, one step at a time: step until "focus" arrives.
  async grabKeys(cx) {
    if (this.grabbing) return;
    this.grabbing = true;
    this.gotFocus = false;
    const dirs = ["right", "left", "down", "up"];
    try {
      for (let i = 0; i < 8 && !this.gotFocus; i++) {
        run("pane.go", { direction: dirs[i % dirs.length] });
        await cx.sleep(80); // lets the "focus" command arrive before the next step
      }
    } finally { this.grabbing = false; cx.notify(); }
  }

  shownNow() { return Boolean(this.paneFor) || isShown(layout(), (n) => n.content?.mod === "wayfindr"); }

  // Refreshes on show and every POLL_MS while shown. Never while hidden (D25), except backgroundTick. True when shown.
  watch(cx) {
    if (!this.shownNow()) { this.hidden = true; return false; }
    const showing = this.hidden;
    this.hidden = false;
    if (showing && this.pendingView) {
      const pv = this.pendingView;
      this.pendingView = null;
      if (pv.until > Date.now() && this.profile) {
        this.showView(pv.view, cx);
        if (pv.view === "board" && this.profile.boards.some((x) => x.id === pv.boardId)) this.selectBoard(pv.boardId, cx);
      }
    }
    if (this.profile && due(this.lastRefresh, Date.now(), { showing })) this.refresh(cx);
    return true;
  }

  // Sign-in states and the shown view's data: the selected Board (or the CLI checks without one) or the
  // Pull Requests. Plus a Ticket a reload left open.
  refresh(cx) {
    this.lastRefresh = Date.now();
    this.checkSignIn(cx);
    if (this.view === "settings") this.loadSettings(cx, true);
    else if (this.view === "prs") this.fetchPrs(cx);
    else if (this.board) this.fetchBoard(this.board, cx);
    else cx.spawn((cx) => this.check(cx));
    if (this.fetchTicketLater) { this.fetchTicketLater = false; this.fetchTicket(cx); }
    if (this.fetchPrLater) { this.fetchPrLater = false; this.fetchPr(cx, { force: true }); } // a reload (Refresh) refetches (#31)
  }

  // What a Provider gets: the runner, fetch, and the Profile's name (Azure keeps an az login per Profile).
  io() { return { run: this.state.runner.run, fetch, profile: this.profile.name }; }

  get profile() { return this.state.status === "ok" ? this.state.profile : null; }

  // The selected Board's config: the remembered one, else the first.
  get board() {
    const p = this.profile;
    if (!p || p.boards.length === 0) return null;
    const id = load(`wayfindr.board.${p.name}`, null);
    return p.boards.find((b) => b.id === id) ?? p.boards[0];
  }

  mineKey(b) { return `wayfindr.mine.${this.profile.name}.${b.id}`; }

  // The Board's Columns as shown: Tracked Statuses or the Provider's, with the Mine filter.
  columnsOf(b, data) {
    const mine = load(this.mineKey(b), "0") === "1";
    return byColumn(b.trackedStatuses?.length ? trackColumns(data, b.trackedStatuses) : data, { mine });
  }

  // The Board's cursor keys (#20, keys.js): next/prev in a Column, colPrev/colNext to the next Column with cards,
  // first/last in a Column, open the card. While the detail panel is open it follows the cursor.
  // moveLeft/moveRight move the card under the cursor one Column over (#15). True when the action was used.
  boardAct(action, cx) {
    const b = this.board, data = b && this.boards[b.id]?.data;
    if (this.view !== "board" || !data) return false;
    const cols = this.columnsOf(b, data);
    if (!cols.length) return false;
    let c = this.cursor?.board === b.id ? { ...this.cursor } : null;
    if (c && (action === "moveLeft" || action === "moveRight")) {
      const tk = cols[c.col]?.tickets[c.row], to = cols[c.col + (action === "moveLeft" ? -1 : 1)];
      // GitHub's "No Status" is not a target. The cursor follows the card only when the Move started.
      if (tk && to && to.column.id !== NO_COLUMN && this.canMove(b) && this.moveCard(b, tk, to.column.id, cx)) {
        const now = this.columnsOf(b, this.boards[b.id].data);
        const col = now.findIndex((x) => x.tickets.some((y) => y.key === tk.key));
        if (col >= 0) this.cursor = { board: b.id, col, row: now[col].tickets.findIndex((y) => y.key === tk.key) };
      }
      return true;
    }
    if (!c) {
      if (action === "moveLeft" || action === "moveRight") return false;
      const first = Math.max(0, cols.findIndex((x) => x.tickets.length));
      c = { board: b.id, col: first, row: 0 };
    } else if (action === "colPrev" || action === "colNext") {
      const step = action === "colPrev" ? -1 : 1;
      let i = c.col + step;
      while (i >= 0 && i < cols.length && !cols[i].tickets.length) i += step;
      if (i < 0 || i >= cols.length) return true;
      c.col = i; c.row = Math.min(c.row, cols[i].tickets.length - 1);
    } else if (action === "prev") c.row = Math.max(0, c.row - 1);
    else if (action === "next") c.row = Math.min(cols[c.col].tickets.length - 1, c.row + 1);
    else if (action === "halfUp") c.row = Math.max(0, c.row - this.halfPage("board"));
    else if (action === "halfDown") c.row = Math.min(cols[c.col].tickets.length - 1, c.row + this.halfPage("board"));
    else if (action === "first") c.row = 0;
    else if (action === "last") c.row = Math.max(0, cols[c.col].tickets.length - 1);
    else if (action !== "open") return false;
    c.col = Math.min(c.col, cols.length - 1);
    c.row = Math.max(0, Math.min(c.row, cols[c.col].tickets.length - 1));
    this.cursor = c;
    const tk = cols[c.col].tickets[c.row];
    if (tk && (action === "open" || this.selected)) this.openTicket(b, tk, cx);
    return true;
  }

  // The card under the Board's cursor (the open one while the detail panel shows): { b, tk } or null.
  cursorCard() {
    const b = this.board, data = b && this.boards[b.id]?.data;
    if (!data) return null;
    if (this.selected?.boardId === b.id) return { b, tk: this.selected.summary };
    const c = this.cursor?.board === b.id ? this.cursor : null;
    const tk = c ? this.columnsOf(b, data)[c.col]?.tickets[c.row] : null;
    return tk ? { b, tk } : null;
  }

  // Wranglr's worktree rule from its config file; null when Wranglr isn't set up or the file isn't readable.
  async readWranglr() {
    let text = null;
    try { text = await readTextFile(wranglrPath()); } catch { /* not set up */ }
    this.wranglr = parseWranglr(text);
    return this.wranglr;
  }

  reload(cx) {
    const before = this.profile?.name ?? this.lastProfile;
    this.state = { status: "loading" };
    this.boards = {};
    this.movedRecently = {};
    this.tickets = {};
    this.prDetails = {};
    this.prs = null;
    this.found = {};
    this.clones = null;
    this.cloneFind = {};
    this.statusLists = {};
    this.signIn = null; // account id -> { ok } | { ok: false, reason, command }; null until checked
    this.lastRefresh = null;
    this.pendingView = null; // signInToasted and lastBackground stay
    if (this.selected) this.fetchTicketLater = true;
    if (this.selectedPr) this.fetchPrLater = true;
    cx.spawn(async (cx) => {
      await this.readWranglr();
      const path = configPath();
      let text = null;
      try { text = await readTextFile(path); } catch (e) { this.state = { status: "invalid", path, errors: [String(e.message ?? e)] }; cx.notify(); return; }
      if (text == null) { this.state = { status: "missing", path }; cx.notify(); return; }
      const parsed = parseConfig(text, herdrWindow().platform);
      this.state = parsed.errors.length
        ? { status: "invalid", path, errors: parsed.errors }
        : { status: "ok", path, text, ...parsed, runner: createRunner(parsed.profile.runner) };
      // Another Profile: its Ticket detail must not carry over, even to a Board with the same id (D10).
      const now = parsed.profile?.name ?? null;
      if (now !== before) {
        this.selected = null; this.fetchTicketLater = false; this.moveOpen = null;
        this.selectedPr = null; this.fetchPrLater = false; this.prAll = {}; this.prShown = {}; this.prLast = null; this.prViewed = {}; this.prThreadsOpen = {};
        this.prComments = {}; this.prOpen = {}; this.prVerdict = {}; this.prConfirm = null; this.prPosting = null; this.prReplying = null;
        this.prBox.set_value(""); this.prSummary.set_value("");
        this.launch = null; this.reviews = {}; this.editing = null; this.typing = false;
        this.commenting = null; this.moving = null; this.cursor = null;
        if (this.paneFor) { this.selectedPr = this.paneFor; this.prLast = this.paneFor.pr.key; this.prShown[this.paneFor.pr.key] = null; }
      }
      this.lastProfile = now;
      // The pane copy (#30) fetches only its Pull Request: no cache, no Boards, no list.
      if (this.paneFor) {
        this.fetchPrLater = false;
        if (this.state.status === "ok") this.fetchPr(cx);
        cx.notify();
        return;
      }
      if (this.state.status === "ok") {
        let cached = null;
        try { cached = await readTextFile(cacheFile(appHome(), parsed.profile.name)); } catch { /* no cache */ }
        const cache = parseCache(cached);
        for (const b of parsed.profile.boards) {
          const c = cachedBoard(cache, b);
          if (c) this.boards[b.id] = { status: "cached", ...c };
        }
        const cp = cachedPrs(cache, prsKey(parsed.profile.accounts));
        if (cp) this.prs = { status: "cached", ...cp };
      }
      cx.notify();
      if (this.state.status === "ok") { this.ensureInputs(); this.watch(cx); }
    });
  }

  // A failed refresh keeps the data it had and shows the error beside its age.
  fetchBoard(b, cx) {
    const prev = this.boards[b.id], profile = this.profile, tried = Date.now();
    // Only the newest fetch of a Board lands: an older one finishing later is dropped.
    const seq = this.boardSeq[b.id] = (this.boardSeq[b.id] ?? 0) + 1;
    this.boards[b.id] = { status: "loading", data: prev?.data ?? null, at: prev?.at ?? null, tried };
    const io = this.io();
    cx.spawn(async (cx) => {
      let data = null;
      try { data = await loadBoard(profile, b, io); } catch (e) {
        if (this.profile?.name !== profile.name || this.boardSeq[b.id] !== seq) return; // a reload or a newer fetch replaced it
        this.boards[b.id] = { status: "error", data: prev?.data ?? null, at: prev?.at ?? null, tried, error: String(e.message ?? e) };
        cx.notify();
        return;
      }
      if (this.profile?.name !== profile.name || this.boardSeq[b.id] !== seq) return;
      const at = Date.now();
      // A service can answer with the pre-move Column for a while after a Move (Q4). For 15 seconds
      // after the write, the moved card keeps its new Column. A read that agrees, or the window
      // running out, drops the entry.
      const moved = this.movedRecently[b.id];
      if (moved) {
        const tk = moved.until > at ? data.tickets.find((x) => x.key === moved.key) : null;
        if (tk && (tk.columnId !== moved.columnId || tk.status !== moved.status)) {
          data = { ...data, tickets: data.tickets.map((x) => (x === tk ? { ...x, columnId: moved.columnId, status: moved.status } : x)) };
        } else delete this.movedRecently[b.id];
      }
      if (profile.notifications.enabled) {
        this.announce(toastsFor(newItems({ prevPrs: null, nextPrs: null, prevBoards: { [b.id]: this.boards[b.id]?.data ?? null }, nextBoards: { [b.id]: data } })), cx);
      }
      this.boards[b.id] = { status: "ok", data, at, tried };
      this.clampCursor(b, data);
      cx.notify();
      await this.saveCache(profile, (c) => withBoard(c, profile.boards, b, data, at));
    });
  }

  // After a Board's data changes: the cursor stays on a card, or goes when its Column has none.
  clampCursor(b, data) {
    const c = this.cursor;
    if (!c || c.board !== b.id) return;
    const cols = this.columnsOf(b, data);
    if (cols[c.col]?.tickets[c.row]) return;
    const col = Math.min(c.col, cols.length - 1), n = cols[col]?.tickets.length ?? 0;
    this.cursor = n ? { ...c, col, row: Math.min(c.row, n - 1) } : null;
  }

  // One request per Account. Accounts that fail show their error and the rest still list (D19).
  fetchPrs(cx) {
    const prev = this.prs, profile = this.profile, tried = Date.now();
    this.prs = { status: "loading", data: prev?.data ?? null, at: prev?.at ?? null, tried };
    const io = this.io();
    cx.spawn(async (cx) => {
      const data = await loadPullRequests(profile, io);
      if (this.profile?.name !== profile.name) return; // a reload replaced the Profile meanwhile
      const at = Date.now();
      if (profile.notifications.enabled) {
        this.announce(toastsFor(newItems({ prevPrs: this.prs?.data ?? null, nextPrs: data, prevBoards: {}, nextBoards: {} })), cx);
      }
      this.prs = { status: "ok", data, at, tried };
      cx.notify();
      await this.saveCache(profile, (c) => withPrs(c, prsKey(profile.accounts), data, at));
      await this.prunePrFiles(data);
    });
  }

  // After a list fetch (#31): the cached details and viewed marks of PRs no longer listed (merged, closed, or no
  // longer the person's) are deleted, on disk and in memory, except the open PR's. Comments files are kept: they
  // are the person's own text. When an Account's list failed, nothing is pruned. Errors are swallowed: the next
  // list fetch tries again.
  async prunePrFiles(data) {
    if (!Array.isArray(data) || data.some((r) => r?.error)) return;
    const summaries = data.flatMap((r) => [...(r.mine ?? []), ...(r.needsReview ?? [])]);
    for (const dir of [prCacheDir(), viewedDir()]) {
      let names = [];
      try { names = (await fs.readdir(dir)).map((e) => (typeof e === "string" ? e : e?.name)); } catch { continue; } // no folder yet
      for (const name of prunePrKeys(names, summaries)) {
        try { await fs.unlink(`${dir}/${name}`); } catch { /* next list fetch */ } // Herdr's fs has unlink, not rm
      }
    }
    const listed = new Set(summaries.map((s) => s.key)), open = this.selectedPr?.pr.key;
    for (const key of new Set([...Object.keys(this.prDetails), ...Object.keys(this.prViewed)])) {
      if (listed.has(key) || key === open) continue;
      delete this.prDetails[key]; delete this.prViewed[key]; delete this.prCacheText[key];
    }
  }

  // The view's data, when it has none yet, only a cached copy, or one older than a minute.
  showView(key, cx) {
    this.view = key; save(VIEW_KEY, key);
    if (!this.profile) return;
    const e = key === "prs" ? this.prs : this.board && this.boards[this.board.id];
    const stale = !e || e.status === "cached" || (e.status !== "loading" && due(e.tried, Date.now(), { showing: true }));
    if (key === "prs" && stale) this.fetchPrs(cx);
    else if (key === "board" && this.board && stale) this.fetchBoard(this.board, cx);
  }

  // Best effort: a failed write leaves the old cache, and the next refresh writes again.
  async saveCache(profile, update) {
    const path = cacheFile(appHome(), profile.name);
    for (let i = 0; i < 2; i++) { // a second try when another copy wrote in between
      let cur = null;
      try { cur = await readTextFile(path); } catch { /* unreadable: start over */ }
      try { await writeTextFile(path, serializeCache(update(parseCache(cur))), cur); return; } catch { /* stale snapshot */ }
    }
  }

  // `toast`: the background path only. One warning per Account per session; the panel's card covers the rest.
  checkSignIn(cx, { toast = false } = {}) {
    const profile = this.profile, io = this.io();
    cx.spawn(async (cx) => {
      const states = await signInStates(profile, io);
      if (this.profile?.name !== profile.name) return; // a reload replaced the Profile meanwhile
      this.signIn = states;
      if (toast) {
        for (const [id, st] of Object.entries(states ?? {})) {
          if (st?.ok !== false || this.signInToasted.has(id)) continue;
          this.signInToasted.add(id);
          notify({ title: "Wayfindr: sign in needed", body: `${id}: ${st.reason}`, level: "warning", icon: "mods/wayfindr/wayfindr.svg", timeout: 12000, action: { name: "layout.show", args: { id: "wayfindr" } } });
        }
      }
      cx.notify();
    });
  }

  // Runs an Account's sign-in command in a new tab, through the Profile's runner (D19).
  signInTab(account, command) {
    try {
      const inv = shellInvocation(this.profile.runner, herdrWindow().platform, command);
      run("tab.new", { name: `Sign in: ${account.id}`, argv: [inv.command, ...inv.args] });
    } catch (e) {
      notify({ title: "Wayfindr", body: `Couldn't open the sign-in tab: ${e.message ?? e}`, level: "error" });
    }
  }

  signInCard(t, account, si) {
    const who = account.login ? `${account.id} (${account.login})` : account.id;
    return v_flex().id(`wf-signin-${account.id}`).p(14).gap(8).max_w(720).rounded(10).bg(t.surface).border_1().border_color(t.border)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Sign in needed"))
      .child(div().text_size(12).text_color(t.muted).child(`${who}: ${si.reason}`))
      .when(Boolean(si.command), (el) => el
        .child(div().text_size(12).child(TextView.markdown(`wf-signin-cmd-${account.id}`, "```sh\n" + si.command + "\n```").selectable(true)))
        .child(h_flex().gap(8).items_center()
          .child(button(`wf-signin-run-${account.id}`, "Run in a new tab", t, () => this.signInTab(account, si.command), { on: true }))
          .child(div().text_size(12).text_color(t.dim).child("Then press Refresh."))));
  }

  // Opens the detail panel on a Ticket, or switches it to another.
  openTicket(b, summary, cx) {
    this.selected = { boardId: b.id, summary };
    this.moveOpen = null;
    this.handle.focus(); // a card's click stops the root's, which would focus: keys need it (#20)
    // One comment draft per Ticket: the box keeps the old Ticket's text aside and shows this one's.
    if (summary.key !== this.draftKey) {
      if (this.draftKey != null) {
        const text = this.commentBox.value();
        if (text.trim()) this.commentDrafts[this.draftKey] = text; else delete this.commentDrafts[this.draftKey];
      }
      this.commentBox.set_value(this.commentDrafts[summary.key] ?? "");
      this.draftKey = summary.key;
    }
    if (this.tickets[summary.key]?.status !== "ok") this.fetchTicket(cx);
    cx.notify();
  }

  closeTicket() {
    const key = this.selected?.summary.key;
    if (this.moving?.status === "error" && this.moving.key === key) this.moving = null;
    this.selected = null; this.editing = null; this.typing = false; this.launch = null; this.moveOpen = null;
  }

  fetchTicket(cx) {
    const sel = this.selected, p = this.profile;
    const b = p?.boards.find((x) => x.id === sel?.boardId);
    if (!b) { this.selected = null; return; }
    const key = sel.summary.key;
    this.tickets[key] = { status: "loading", data: this.tickets[key]?.data ?? null };
    const io = this.io();
    cx.spawn(async (cx) => {
      let next;
      try { next = { status: "ok", data: await loadTicket(p, b, sel.summary, io) }; } catch (e) {
        next = { status: "error", data: this.tickets[key]?.data ?? null, error: String(e.message ?? e) };
      }
      if (this.profile?.name !== p.name) return; // a reload replaced the Profile meanwhile
      this.tickets[key] = next;
      if (next.status === "ok") this.fetchImages(p, b, next.data, io, cx);
      cx.notify();
    });
  }

  // Opens the Pull Request panel, or switches it to another.
  openPr(accountId, pr, cx) {
    if (this.prLast !== pr.key) {
      this.prShown[pr.key] = null; this.prLast = pr.key;
      // One comment box and one summary for the overlay: another PR starts them empty.
      this.prOpen = {}; this.prBox.set_value(""); this.prSummary.set_value(""); this.prConfirm = null;
    }
    this.selectedPr = { account: accountId, pr };
    this.prCursor = pr.key; // the list's cursor stays on this row when the overlay closes (D6)
    this.handle.focus(); // the row's click stops the root's, which would focus: Esc needs it
    // The cached copy shows at once; fetchPr refetches only when detailStale says the PR moved or the copy is old (#31).
    if (this.prDetails[pr.key]?.status !== "loading") this.fetchPr(cx);
    cx.notify();
  }

  closePr() { if (!this.paneFor) this.selectedPr = null; } // the pane copy keeps its PR (#30)

  // The overlay's fullscreen (#29): the choice stays for the next Pull Request.
  toggleFull() {
    this.prFull = !this.prFull;
    try { localStorage.setItem(PR_FULL_KEY, this.prFull ? "1" : "0"); } catch { /* kept for this session only */ }
  }

  // A Pull Request's clone (D1): the Profile Repo for its repo, else the one clone of it the index found, else
  // null. Never asks and never scans: without a clone the diffs come from the API.
  cloneForPr(pr) {
    const repo = this.profile?.repos.find((r) => r.prRepo && sameRepo(r.prRepo, pr.repo));
    if (repo) return repo.path;
    return soleClone(this.clonesOf(pr.repo))?.path ?? null;
  }

  // The detail (#31): the cached copy on disk shows at once, then the Provider is asked only when `force`
  // (Refresh) or detailStale says so (no copy, an old copy, or the list row says the PR moved).
  // From the Provider: with a clone, its files and patches come from git there (#22); when git
  // fails, the Provider's are fetched instead and gitError says why. Each fetch is written to the cache file.
  fetchPr(cx, { force = false } = {}) {
    const sel = this.selectedPr, p = this.profile;
    if (!sel || !p) return;
    const key = sel.pr.key, clone = this.cloneForPr(sel.pr), file = prCacheFile(appHome().replace(/\\/g, "/"), sel.pr);
    const io = this.io();
    cx.spawn(async (cx) => {
      if (!this.prDetails[key]?.data) {
        let text = null;
        try { text = await readTextFile(file); } catch { /* none yet */ }
        if (this.profile?.name !== p.name) return; // a reload replaced the Profile meanwhile
        this.prCacheText[key] = text;
        const c = parsePrCache(text, key);
        if (c && !this.prDetails[key]?.data) {
          this.prDetails[key] = { status: "ok", data: c.data, at: c.at };
          this.loadViewed(key, c.data, cx); this.loadPrComments(key, c.data, cx);
          cx.notify();
        }
      }
      const cur = this.prDetails[key];
      if (!force && cur?.status !== "error" && !detailStale(cur?.data ? { at: cur.at, data: cur.data } : null, sel.pr, Date.now(), POLL_MS)) return;
      this.prDetails[key] = { status: "loading", data: cur?.data ?? null, at: cur?.at ?? null };
      cx.notify();
      let next;
      try {
        let data = await loadPullRequestDetail(p, sel.account, sel.pr, io, clone ? { patches: false } : {});
        if (!clone) data = { ...data, source: { kind: "api" } };
        else {
          try {
            const number = String(data.id ?? sel.pr.id ?? "").split(/[#!]/).pop();
            const local = await loadLocalPrDiff(clone, data.branch, data.target, number, io);
            data = { ...data, files: local.files, moreFiles: 0, truncated: local.truncated, head: local.head, source: { kind: "clone", path: clone } };
          } catch (e) {
            const api = await loadPullRequestDetail(p, sel.account, sel.pr, io);
            data = { ...api, source: { kind: "api" }, gitError: String(e.message ?? e) };
          }
        }
        next = { status: "ok", data, at: Date.now() };
      } catch (e) {
        next = { status: "error", data: this.prDetails[key]?.data ?? null, at: this.prDetails[key]?.at ?? null, error: String(e.message ?? e) };
      }
      if (this.profile?.name !== p.name) return; // a reload replaced the Profile meanwhile
      this.prDetails[key] = next;
      if (next.status === "ok") { this.loadViewed(key, next.data, cx); this.loadPrComments(key, next.data, cx); }
      cx.notify();
      if (next.status === "ok") await this.writePrCache(key, file, serializePrCache(key, next.at, next.data));
    });
  }

  // Best effort (#31): compare-and-swap on the text read before; on a conflict, read again and write once more.
  // A failed write leaves the old file, and the next fetch writes again.
  async writePrCache(key, file, text) {
    try {
      await fs.mkdir(prCacheDir(), { recursive: true });
      if (this.prCacheText[key] === undefined) { try { this.prCacheText[key] = await readTextFile(file); } catch { this.prCacheText[key] = null; } }
      try { await writeTextFile(file, text, this.prCacheText[key] ?? null); } catch {
        const now = await readTextFile(file);
        await writeTextFile(file, text, now ?? null);
      }
      this.prCacheText[key] = text;
    } catch { /* kept in memory only */ }
  }

  // The PR's saved line comments (#27), read once per PR when its detail first arrives. Comments made while the
  // file is read are kept.
  loadPrComments(key, d, cx) {
    if (this.prComments[key]?.file) return;
    const entry = { list: this.prComments[key]?.list ?? [], file: `${commentsDir()}/${viewedKey(d)}.json`, text: null };
    this.prComments[key] = entry;
    cx.spawn(async (cx) => {
      let text = null;
      try { text = await readTextFile(entry.file); } catch { /* none yet */ }
      entry.text = text;
      const ids = new Set(entry.list.map((c) => c.id));
      entry.list = [...parseComments(text).filter((c) => !ids.has(c.id)), ...entry.list];
      cx.notify();
    });
  }

  // Saves the PR's comments, one save after another. An empty list removes the file.
  persistPrComments(key, cx) {
    const c = this.prComments[key];
    if (!c?.file) return;
    const before = c.saving ?? Promise.resolve();
    let done;
    c.saving = new Promise((r) => { done = r; });
    cx.spawn(async () => {
      await before;
      try { await this.writePrComments(c); } catch { /* the comments stay in memory */ }
      done();
    });
  }

  // Compare-and-swap on the text read before, as the viewed marks; on a conflict, read again and write once more.
  async writePrComments(c) {
    if (c.list.length === 0) {
      try { await fs.unlink(c.file); c.text = null; return; } catch { /* already gone, or no unlink here: write an empty list */ }
    }
    const text = JSON.stringify(c.list, null, 2);
    await fs.mkdir(commentsDir(), { recursive: true });
    try { await writeTextFile(c.file, text, c.text); } catch {
      const cur = await readTextFile(c.file);
      await writeTextFile(c.file, text, cur ?? null);
    }
    c.text = text;
  }

  // Opens the comment box at a place (a line, a range, or { reply }) with its text, and gives it the keyboard.
  openPrBox(key, place, text = "") {
    this.prOpen[key] = place;
    this.prBox.set_value(text);
    this.prBox.focus();
    if (this.prReplying?.key === key && this.prReplying.status === "error") this.prReplying = null;
  }

  closePrBox(key) {
    this.prOpen[key] = null;
    this.prBox.set_value("");
    if (this.typing === "pr") this.typing = false;
    this.handle.focus();
  }

  // A click on a numbered diff row (D5): opens the box on it. With shift while the box is open on this file,
  // the box spans the rows between, cut at a hunk header, and keeps its text.
  clickPrRow(key, f, rows, i, shift) {
    const open = this.prOpen[key];
    if (shift && open && open.reply == null && barePath(open.path) === barePath(f.path)) {
      const text = this.prBox.value();
      this.prOpen[key] = extendOpen(rows, open, i);
      this.prBox.focus();
      if (this.prBox.value() !== text) this.prBox.set_value(text);
      return;
    }
    const place = openAt(rows, f.path, i);
    if (place) this.openPrBox(key, place);
  }

  // Enter or Save in the box: a reply posts at once; a line comment is saved on this computer. Empty text closes.
  savePrBox(cx) {
    const sel = this.selectedPr, key = sel?.pr.key, open = key ? this.prOpen[key] : null;
    if (!open) return;
    const text = this.prBox.value().trim();
    if (open.reply != null) { if (text) this.postPrReply(key, open.reply, text, cx); return; }
    if (text) {
      const d = this.prDetails[key]?.data, f = (d?.files ?? []).find((x) => barePath(x.path) === barePath(open.path));
      const rows = f && !f.binary && f.patch != null ? this.rowsOf(f).rows : [];
      const code = rows[rowOf(rows, open.line, open.side)]?.text ?? "";
      const c = (this.prComments[key] ??= { list: [], file: null, text: null });
      c.list = saveComment(c.list, open, text, code, `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
      this.persistPrComments(key, cx);
    }
    this.closePrBox(key);
  }

  deletePrComment(key, id, cx) {
    const c = this.prComments[key];
    if (!c) return;
    c.list = removeComment(c.list, id);
    if (this.prOpen[key]?.editId === id) this.closePrBox(key);
    this.persistPrComments(key, cx);
  }

  // Reply (D6): posts under the thread at once, then reloads the detail. A refusal shows under the thread and the
  // text stays in the box.
  postPrReply(key, threadId, text, cx) {
    const sel = this.selectedPr, p = this.profile, d = this.prDetails[key]?.data;
    const th = (d?.threads ?? []).find((x) => String(x.id) === String(threadId));
    if (!sel || !th || this.prReplying?.status === "busy") return;
    const R = this.prReplying = { key, id: String(threadId), status: "busy" };
    const io = this.io();
    cx.spawn(async (cx) => {
      try {
        await replyToPrThread(p, sel.account, sel.pr, d, th, text, io);
        if (this.prReplying === R) this.prReplying = null;
        if (this.prOpen[key]?.reply === threadId) this.closePrBox(key);
        if (this.selectedPr?.pr.key === key) this.fetchPr(cx, { force: true });
      } catch (e) {
        R.status = "error"; R.error = `Couldn't post the reply: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  // Post review (D7), after Yes: one review with every saved comment, the verdict and the summary. Posted
  // comments leave this computer's list; a failure keeps them all.
  sendPrReview(cx) {
    const sel = this.selectedPr, p = this.profile, key = sel?.pr.key, d = this.prDetails[key]?.data;
    if (!d || this.prPosting?.status === "busy") return;
    const list = this.prComments[key]?.list ?? [], mine = Boolean(d.me && d.author?.id === d.me.id);
    const event = mine ? "comment" : (this.prVerdict[key] ?? "comment"), body = this.prSummary.value();
    this.prConfirm = null;
    if (!canPost(list, event, body)) return;
    const P = this.prPosting = { key, status: "busy" };
    const io = this.io(), posted = new Set(list.map((c) => c.id));
    cx.spawn(async (cx) => {
      try {
        const r = await postPrReview(p, sel.account, sel.pr, d, toReview(list, event, body), io);
        Object.assign(P, { status: "done", url: r?.url ?? d.url ?? null });
        const c = this.prComments[key];
        if (c) { c.list = c.list.filter((x) => !posted.has(x.id)); this.persistPrComments(key, cx); }
        if (this.selectedPr?.pr.key === key) { this.prSummary.set_value(""); this.fetchPr(cx, { force: true }); }
      } catch (e) {
        Object.assign(P, { status: "error", error: `Couldn't post the review: ${e.message ?? e}` });
        // Azure posts one thread per comment: the ones that went out leave the list, so a retry doesn't repeat them.
        const n = Number.isInteger(e?.posted) ? e.posted : 0, c = this.prComments[key];
        if (n > 0 && c) { const gone = new Set(list.slice(0, n).map((x) => x.id)); c.list = c.list.filter((x) => !gone.has(x.id)); this.persistPrComments(key, cx); }
      }
      cx.notify();
    });
  }

  // The viewed marks for the detail's head (D8): read from the PR's file, kept only when saved on the same head.
  // Without a head they live in memory only. Marks made while the file is read are kept.
  loadViewed(key, d, cx) {
    const head = d?.head ?? null, cur = this.prViewed[key];
    if (!head) {
      if (!cur || cur.head) this.prViewed[key] = { head: null, files: {}, file: null, text: null };
      return;
    }
    if (cur?.head === head) return;
    const entry = { head, files: {}, file: `${viewedDir()}/${viewedKey(d)}.json`, text: null };
    this.prViewed[key] = entry;
    cx.spawn(async (cx) => {
      let text = null, saved = null;
      try { text = await readTextFile(entry.file); } catch { /* none yet */ }
      try { saved = JSON.parse(text ?? "null"); } catch { /* unreadable: start over */ }
      entry.text = text;
      entry.files = { ...applyViewed(saved, head), ...entry.files };
      cx.notify();
    });
  }

  // Marks or unmarks one file, and saves at once when there is a head. Saves run one after another. Marks are
  // keyed by the path without a leading "/", so the API's Azure paths and the clone's match.
  toggleViewed(key, filePath, cx) {
    const v = (this.prViewed[key] ??= { head: null, files: {}, file: null, text: null }), path = barePath(filePath);
    if (v.files[path]) delete v.files[path]; else v.files[path] = true;
    cx.notify();
    if (!v.file) return;
    const before = v.saving ?? Promise.resolve();
    let done;
    v.saving = new Promise((r) => { done = r; });
    cx.spawn(async () => {
      await before;
      try { await this.saveViewed(v); } catch { /* the marks stay in memory */ }
      done();
    });
  }

  // Compare-and-swap on the text read before; on a conflict, read again and write once more.
  async saveViewed(v) {
    const text = JSON.stringify({ head: v.head, files: v.files }, null, 2);
    await fs.mkdir(viewedDir(), { recursive: true });
    try { await writeTextFile(v.file, text, v.text); } catch {
      const cur = await readTextFile(v.file);
      await writeTextFile(v.file, text, cur ?? null);
    }
    v.text = text;
  }

  // The rail's files in order: code, then tests, docs and generated files.
  railOrder(d) {
    const g = groupFiles(d?.files);
    return [...g.code, ...g.side];
  }

  // The overlay's file keys (D5): next and previous through the rail's order (previous from the first file is
  // the Overview), first is the Overview, last the last file. The Post review screen isn't in the order: next
  // from it goes to the first file, previous to the Overview.
  prFile(action) {
    const sel = this.selectedPr;
    if (!sel) return;
    const k = sel.pr.key, order = this.railOrder(this.prDetails[k]?.data).map((f) => f.path);
    const cur = this.prShown[k] ?? null, i = cur == null ? -1 : order.indexOf(cur);
    if (action === "first") this.prShown[k] = null;
    else if (action === "last") { if (order.length) this.prShown[k] = order[order.length - 1]; }
    else if (action === "next") { if (i + 1 < order.length) this.prShown[k] = order[i + 1]; }
    else if (action === "prev") this.prShown[k] = i <= 0 ? null : order[i - 1];
    else if (action === "halfDown" || action === "halfUp") {
      for (let n = this.halfPage("pr"); n > 0; n--) this.prFile(action === "halfDown" ? "next" : "prev");
    }
  }

  // Half a page of rows in `layer`'s list (ctrl-d / ctrl-u): Wayfindr's height over about one row's.
  halfPage(layer) {
    const rowH = layer === "board" ? 90 : layer === "prs" ? 52 : 28;
    return Math.max(1, Math.floor((this.height ?? 600) / rowH / 2));
  }

  // The Pull Request list's rows in draw order (D6): Mine, then Needs my review, each by Account then repo, as
  // prsView draws them. Each with its letter (D7): [{ account, pr, hint }].
  prListRows() {
    const p = this.profile, lists = this.prs?.data;
    if (!p || !lists) return [];
    const ok = lists.filter((l) => !l.error && this.signIn?.[l.account]?.ok !== false);
    const rows = [];
    for (const field of ["mine", "needsReview"]) {
      for (const l of ok) for (const g of byRepo(l[field] ?? [])) for (const pr of g.prs) rows.push({ account: l.account, pr });
    }
    const hints = assignLetters(rows.length, RESERVED);
    rows.forEach((r, i) => { r.hint = hints[i]; });
    return rows;
  }

  // Which keys apply (keys.js): the top layer now. `withHelp` false gives the layer under the "?" list.
  layerNow(withHelp = true) {
    if (withHelp && this.help) return "help";
    const pane = Boolean(this.paneFor);
    if (!pane && this.view === "settings") return "settings";
    if (pane || this.view === "prs") {
      const sel = this.selectedPr, k = sel?.pr.key;
      if (!k) return "prs";
      if (this.prConfirm === k) return "confirm";
      if (this.prShown[k] === REVIEW_SCREEN && this.canWritePr(sel.account, "postReview")) return "review";
      return "pr";
    }
    if (this.moveOpen) return "move";
    if (this.selected && this.launch?.key === this.selected.summary.key && this.tickets[this.launch.key]?.data) return "launch";
    if (this.selected) return "ticket";
    return "board";
  }

  // The "vimKeys" setting (D13): off, only arrows, home, end, enter, esc, shift-arrows, ctrl-n/ctrl-p and the
  // overlay's v/p/f work, and Pull Request rows have no letters.
  get vim() { return this.state.status === "ok" && this.state.vimKeys === true; }

  // What keyAction needs to know in `layer`, with the vim setting.
  keyFacts(layer) { return { ...this.layerFacts(layer), nextProfile: this.nextProfileName(), vim: this.vim }; }

  // The Profile P switches to, or null with one Profile.
  nextProfileName() {
    const s = this.state, names = s.status === "ok" ? s.profileNames : [];
    return names.length > 1 ? names[(names.indexOf(s.profile.name) + 1) % names.length] : null;
  }

  layerFacts(layer) {
    const p = this.profile;
    if (!p) return {};
    if (layer === "board" || layer === "ticket") {
      const b = this.board, data = b && this.boards[b.id]?.data;
      const hasRows = Boolean(data) && this.columnsOf(b, data).some((c) => c.tickets.length > 0);
      const cc = this.cursorCard(), tk = cc?.tk, full = tk ? this.tickets[tk.key]?.data : null;
      const open = layer === "ticket" && Boolean(full);
      return { hasRows, url: Boolean(full?.url ?? tk?.url), canLaunch: Boolean(tk), canMove: Boolean(tk) && this.canMove(b),
        canUpdate: open && this.canUpdate(b), canComment: open && this.canUpdate(b) };
    }
    if (layer === "prs") {
      const rows = this.prListRows(), cur = rows.find((r) => r.pr.key === this.prCursor);
      return { hasRows: rows.length > 0, url: Boolean(cur?.pr.url), canReview: Boolean(cur) };
    }
    if (layer === "pr" || layer === "review") {
      const sel = this.selectedPr, k = sel.pr.key, d = this.prDetails[k]?.data, shown = this.prShown[k] ?? null;
      const writable = this.canWritePr(sel.account, "postReview");
      // In "review", canPost is what wakes the Post button: the review is ready and nothing is posting.
      let ready = writable;
      if (layer === "review") {
        const mine = Boolean(d?.me && d.author?.id === d.me.id), verdicts = verdictsFor(mine);
        const event = verdicts.some((v) => v.event === this.prVerdict[k]) ? this.prVerdict[k] : "comment";
        ready = Boolean(d) && canPost(this.prComments[k]?.list ?? [], event, this.prSummary.value()) && this.prPosting?.status !== "busy";
      }
      return { pane: Boolean(this.paneFor), full: this.prFull, url: Boolean((d ?? sel.pr).url), canReview: true, canPost: ready,
        hasFile: shown != null && shown !== REVIEW_SCREEN };
    }
    return {};
  }

  // Every key (D5): Esc as the ladder always had it, then nothing while a text box has the keyboard; then a
  // letter toward a Pull Request row in the list, then keyAction. Handled keys stop here.
  onKey(e, cx) {
    if (e.key === "escape") {
      this.typed = "";
      const pane = Boolean(this.paneFor), prOn = pane || this.view === "prs", pk = this.selectedPr?.pr.key;
      // In a text box Esc only leaves it: a title edit is cancelled, a comment draft is kept.
      if (this.typing === "pr" || (prOn && pk && this.prOpen[pk])) {
        if (pk) this.closePrBox(pk); // the comment box: cancelled, before anything else (D5)
        this.typing = false; this.handle.focus();
      } else if (this.typing) {
        if (this.typing === "title") this.editing = null;
        this.typing = false;
        this.handle.focus();
      } else this.closeStep(cx);
      cx.stop_propagation(); cx.notify(); return;
    }
    if (this.typing) return; // keys in a text box are for the text
    if (!this.handle.is_focused()) return; // a Settings box or another element has the keyboard
    const layer = this.layerNow(), m = e.modifiers ?? {};
    // A Pull Request row's letter (D7), as Dockr's panelKey: only letters no key of the list uses.
    if (layer === "prs" && this.vim && /^[a-z]$/.test(e.key) && !m.shift && !m.control && !m.alt && !m.platform && !RESERVED.includes(e.key)) {
      const rows = this.prListRows();
      const state = { at: Math.max(0, rows.findIndex((r) => r.pr.key === this.prCursor)), typed: this.typed };
      const nav = navigateByLetter(state, e, rows);
      this.typed = state.typed;
      if (nav === "hit") { const r = rows[state.at]; this.prCursor = r.pr.key; this.openPr(r.account, r.pr, cx); }
      if (nav === "hit" || nav === "done") { cx.stop_propagation(); cx.notify(); return; }
    }
    this.typed = "";
    const a = keyAction(layer, e.keystroke, this.keyFacts(layer));
    if (!a) return;
    cx.stop_propagation();
    this.doKey(layer, a.action, cx);
    cx.notify();
  }

  // One step back (Esc and q, D4): the top layer closes; at the top, Wayfindr hides.
  closeStep(cx) {
    const layer = this.layerNow(), k = this.selectedPr?.pr.key;
    if (layer === "help") this.help = false;
    else if (layer === "settings") this.showView(this.lastView === "settings" ? "board" : this.lastView, cx);
    else if (layer === "move") this.moveOpen = null;
    else if (layer === "launch") this.launch = null;
    else if (layer === "confirm") this.prConfirm = null;
    else if (layer === "review") { this.prShown[k] = null; this.prConfirm = null; } // back to the Overview (D7)
    else if (layer === "pr") { if (!this.paneFor) this.closePr(); } // the pane copy (#30): nothing after its detail steps
    else if (layer === "ticket") this.closeTicket();
    else this.close_(cx);
  }

  // "Copied" in the legend's place for 2 s.
  flash(text, cx) {
    this.note = { text, until: Date.now() + 2000 };
    cx.spawn(async (cx) => { await cx.sleep(2050); cx.notify(); });
  }

  // What a key's action does (D10).
  doKey(layer, action, cx) {
    const sel = this.selectedPr, k = sel?.pr.key;
    const nav = ["next", "prev", "first", "last", "halfDown", "halfUp", "open"].includes(action);
    if (action === "help") { this.help = true; return; }
    if (action === "hide") { this.help = false; return; }
    if (action === "close" || action === "back" || action === "no") return this.closeStep(cx);
    if (action === "refresh") return layer === "pr" || layer === "review" ? this.fetchPr(cx, { force: true }) : this.reload(cx);
    if (action === "toggleView") { this.showView(this.view === "prs" ? "board" : "prs", cx); return; }
    if (action === "profile") { cx.spawn(async (cx) => { await this.nextProfile(cx); cx.notify(); }); return; }
    if (action === "settings") { this.openSettings(cx); return; }
    if (layer === "board" || layer === "ticket") {
      if (nav || ["colPrev", "colNext", "moveLeft", "moveRight"].includes(action)) { this.boardAct(action, cx); return; }
      const cc = this.cursorCard();
      if (!cc) return;
      const { b, tk } = cc, full = this.tickets[tk.key]?.data;
      if (action === "browser" || action === "copy") {
        const url = full?.url ?? tk.url;
        if (!url) return;
        if (action === "browser") cx.open_url(url); else { cx.write_to_clipboard(url); this.flash("Copied", cx); }
      } else if (action === "launch") {
        if (this.selected?.summary.key !== tk.key) this.openTicket(b, tk, cx);
        this.openLaunch(full ?? tk, cx);
      } else if (action === "comment") this.commentBox.focus();
      else if (action === "edit") this.startEdit(tk, (full ?? tk).title);
      else if (action === "move") {
        const cols = this.moveCols(b, tk), cur = cols.findIndex((c) => c.here);
        this.moveOpen = tk.key; this.moveCursor = Math.max(0, cur);
      }
      return;
    }
    if (layer === "move") {
      const cc = this.cursorCard();
      if (!cc) return;
      const cols = this.moveCols(cc.b, cc.tk), n = cols.length;
      if (action === "next") this.moveCursor = Math.min(n - 1, this.moveCursor + 1);
      else if (action === "prev") this.moveCursor = Math.max(0, this.moveCursor - 1);
      else if (action === "halfDown") this.moveCursor = Math.min(n - 1, this.moveCursor + this.halfPage("move"));
      else if (action === "halfUp") this.moveCursor = Math.max(0, this.moveCursor - this.halfPage("move"));
      else if (action === "first") this.moveCursor = 0;
      else if (action === "last") this.moveCursor = Math.max(0, n - 1);
      else if (action === "pick") {
        const c = cols[this.moveCursor];
        this.moveOpen = null;
        if (c && !c.here) this.moveCard(cc.b, cc.tk, c.id, cx);
      }
      return;
    }
    if (layer === "launch") {
      const key = this.launch?.key, tk = key && this.tickets[key]?.data;
      if (action === "start" && tk) this.startLaunch(tk, cx);
      return;
    }
    if (layer === "prs") {
      const rows = this.prListRows(), at = rows.findIndex((r) => r.pr.key === this.prCursor), cur = rows[at];
      if (nav && rows.length) {
        const i = action === "first" ? 0 : action === "last" ? rows.length - 1
          : action === "next" ? Math.min(rows.length - 1, at + 1) : action === "prev" ? Math.max(0, at - 1)
          : action === "halfDown" ? Math.min(rows.length - 1, Math.max(0, at) + this.halfPage("prs"))
          : action === "halfUp" ? Math.max(0, at - this.halfPage("prs")) : Math.max(0, at);
        this.prCursor = rows[i].pr.key;
        if (action === "open") this.openPr(rows[i].account, rows[i].pr, cx);
      } else if (cur && (action === "browser" || action === "copy") && cur.pr.url) {
        if (action === "browser") cx.open_url(cur.pr.url); else { cx.write_to_clipboard(cur.pr.url); this.flash("Copied", cx); }
      } else if (cur && action === "review") this.reviewActions(cur.account, cur.pr).start(cx);
      return;
    }
    if (!sel) return;
    if (nav) { this.prFile(action); return; }
    const d = this.prDetails[k]?.data, url = (d ?? sel.pr).url;
    if (action === "viewed") { const cur = this.prShown[k]; if (cur && cur !== REVIEW_SCREEN) this.toggleViewed(k, cur, cx); }
    else if (action === "checks") this.prShown[k] = null;
    else if (action === "post") this.prShown[k] = REVIEW_SCREEN;
    else if (action === "full") this.toggleFull();
    else if (action === "zoom") run("pane.zoom", {}); // the pane copy holds the keyboard, so the zoom is its own pane
    else if (action === "browser" && url) cx.open_url(url);
    else if (action === "copy" && url) { cx.write_to_clipboard(url); this.flash("Copied", cx); }
    else if (action === "review") this.reviewActions(sel.account, sel.pr).start(cx);
    else if (action === "ask") { this.prConfirm = k; if (this.prPosting?.key === k) this.prPosting = null; }
    else if (action === "yes") this.sendPrReview(cx);
  }

  // The legend at Wayfindr's foot while it holds the keyboard (D9): the few keys that apply now, the text
  // box's two while typing, every key in two columns after "?", or "Copied" for 2 s.
  keysFooter(t) {
    if (this.help && !this.typing) {
      const all = keyHints(this.layerNow(false), this.keyFacts(this.layerNow(false)));
      const rows = [...all.filter(([k]) => k !== "?"), ["?, q, esc", "hide this list"]];
      const half = Math.ceil(rows.length / 2);
      const col = (list) => v_flex().flex_1().min_w(0).gap(3).children(list.map(([k, what]) => h_flex().w_full().h(18).gap(8).items_center().text_size(11)
        .child(div().w(64).flex_none().font_semibold().text_color(t.accent).child(k))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(what))));
      return h_flex().id("wf-keys").w_full().flex_none().px(12).py(10).gap(14).items_start().border_t(1).border_color(t.border).bg(t.raised)
        .child(col(rows.slice(0, half))).child(col(rows.slice(half)));
    }
    const note = this.note && this.note.until > Date.now() ? this.note.text : null;
    const layer = this.layerNow();
    return h_flex().id("wf-legend").w_full().flex_none().px(12).py(8).border_t(1).border_color(t.border).bg(t.chrome)
      .child(note ? div().text_size(12).text_color(t.muted).child(note)
        : legend(t, this.typing ? [["ctrl-enter", "save"], ["esc", "back"]] : coreHints(layer, this.keyFacts(layer))));
  }

  // Whether the Account's Provider can post reviews or replies (#27).
  canWritePr(accountId, capability) {
    const a = this.profile?.accounts.find((x) => x.id === accountId);
    return Boolean(a) && can(providerFor(a), capability);
  }

  // A Ticket's images, saved under Herdr's home so image() can show them. Each shows as it arrives.
  fetchImages(p, b, ticket, io, cx) {
    cx.spawn(async (cx) => {
      // Once a session: images not saved again in 30 days go.
      if (!this.pruned) { this.pruned = true; try { await pruneImages(`${appHome()}/${IMAGE_DIR}`, io); } catch { /* next session */ } }
      await loadImages(p, b, ticket, `${appHome()}/${IMAGE_DIR}`, io, (url, name, error) => {
        this.images[url] = name ? { status: "ok", file: `${IMAGE_DIR}/${name}` } : { status: "error", error };
        cx.notify();
      }, { onStart: (url) => { if (!this.images[url]) this.images[url] = { status: "loading" }; } });
      cx.notify();
    });
  }

  selectBoard(id, cx) {
    this.closeTicket();
    save(`wayfindr.board.${this.profile.name}`, id);
    const e = this.boards[id];
    if (!e || e.status === "cached" || (e.status !== "loading" && due(e.tried, Date.now(), { showing: true }))) this.fetchBoard(this.board, cx);
    cx.notify();
  }

  // Confirms the Profile's runner can reach the CLIs Wayfindr signs in with.
  async check(cx) {
    const r = this.state.runner;
    this.checks = null;
    const version = async (cmd, args) => {
      const res = await r.run(cmd, args, { timeout: 20000 });
      return res.code === 0 ? { ok: true, text: res.stdout.split("\n")[0].trim() } : { ok: false, text: (res.stderr || res.stdout).trim().split("\n")[0] || `exit ${res.code}` };
    };
    const [gh, az] = await Promise.all([version("gh", ["--version"]), version("az", ["version", "--query", '"azure-cli"', "-o", "tsv"])]);
    this.checks = { gh, az };
    cx.notify();
  }

  async nextProfile(cx) {
    const s = this.state;
    if (s.status !== "ok") return;
    const names = s.profileNames;
    if (names.length < 2) { notify({ title: "Wayfindr", body: "Only one profile is configured.", level: "info" }); return; }
    await this.switchProfile(names[(names.indexOf(s.profile.name) + 1) % names.length], cx);
  }

  // Saves the choice as the config's activeProfile, so it holds across restarts, then shows it.
  async switchProfile(name, cx) {
    const s = this.state;
    if (s.status !== "ok" || name === s.profile.name || !s.profileNames.includes(name)) return;
    const updated = JSON.stringify({ ...s.config, activeProfile: name }, null, 2) + "\n";
    try { await writeTextFile(s.path, updated, s.text); } catch (e) {
      notify({ title: "Wayfindr", body: `Couldn't switch profile: ${e.message ?? e}`, level: "error" });
    }
    this.reload(cx);
  }

  // ---- Settings (#17): edits wayfindr.json. Each change is written at once, in order.

  openSettings(cx) {
    if (this.view !== "settings") this.lastView = this.view;
    this.view = "settings"; save(VIEW_KEY, "settings");
    this.settingsError = null;
    this.ensureInputs();
    this.loadSettings(cx);
  }

  // A search box per Account list. InputState needs a live host call, so never from render.
  ensureInputs() {
    for (const a of this.profile?.accounts ?? []) {
      for (const [kind, placeholder] of [["boards", "Search boards"], ["repos", "Search repos"]]) {
        if (this.inputs[kind][a.id]) continue;
        const input = InputState.new({ placeholder });
        input.on("change", (_e, cx) => cx.notify());
        this.inputs[kind][a.id] = input;
      }
    }
  }

  // Whether part of an Account's Settings is folded away. Remembered per Profile and Account.
  // "" is the other Boards, "boards" and "repos" the whole cards, "repos.others" the other repos.
  foldKey(a, part = "", profile = this.profile.name) { return `wayfindr.settings.fold.${profile}.${a.id}${part ? `.${part}` : ""}`; }

  startRename(name) {
    const input = InputState.new({ value: name, placeholder: "profile name" });
    input.on("submit", (_e, cx) => this.finishRename(cx));
    this.renaming = { name, input };
    input.focus();
  }

  // Renames the Profile in the file, then moves what is keyed by its name: the az login folder (through
  // that Profile's runner), the cache (copied: Herdr can't delete files, so the old one stays), and the
  // remembered Board and Mine choices.
  finishRename(cx) {
    const r = this.renaming, s = this.state;
    if (!r || s.status !== "ok") return;
    const from = r.name, to = r.input.value().trim();
    this.renaming = null;
    if (to === from) { cx.notify(); return; }
    const rawProfile = s.config.profiles?.[from];
    const platform = herdrWindow().platform;
    this.saveConfig((raw) => edits.renameProfile(raw, from, to), cx, {
      after: async () => {
        const runner = from === s.profile.name ? s.runner : createRunner(rawProfile?.runner ?? defaultRunner(platform));
        const accounts = rawProfile?.accounts ?? [];
        try { await renameProfileData({ name: from, accounts }, to, { run: runner.run, fetch, profile: from }); } catch (e) {
          this.settingsError = `Renamed, but ${e.message ?? e}. Sign in again for ${to}.`;
        }
        try {
          const cache = await readTextFile(cacheFile(appHome(), from));
          if (cache != null) await writeTextFile(cacheFile(appHome(), to), cache, null);
        } catch { /* the cache is rebuilt on the next refresh */ }
        const key = (k) => `wayfindr.${k}.${from}`;
        const b = load(key("board"), null);
        if (b != null) save(`wayfindr.board.${to}`, b);
        for (const x of rawProfile?.boards ?? []) {
          const m = load(`wayfindr.mine.${from}.${x.id}`, null);
          if (m != null) save(`wayfindr.mine.${to}.${x.id}`, m);
        }
        for (const a of accounts) {
          for (const part of FOLD_PARTS) {
            const f = load(this.foldKey(a, part, from), null);
            if (f != null) save(this.foldKey(a, part, to), f);
          }
        }
      },
    });
  }

  // What each Account can offer: its Boards and its repos. Loaded once per open, or on Refresh.
  loadSettings(cx, force = false) {
    const p = this.profile;
    if (!p) return;
    const io = this.io();
    for (const a of p.accounts) {
      const f = (this.found[a.id] ??= {});
      const provider = providerFor(a);
      for (const [key, cap, fn] of [["boards", "boards", discoverBoards], ["repos", "repos", discoverRepos]]) {
        if (!can(provider, cap) || (!force && f[key] && f[key].status !== "error")) continue;
        f[key] = { status: "loading", data: f[key]?.data ?? null };
        cx.spawn(async (cx) => {
          let next;
          try { next = { status: "ok", data: await fn(a, io) }; } catch (e) { next = { status: "error", data: f[key]?.data ?? null, error: String(e.message ?? e) }; }
          if (this.profile?.name !== p.name || this.found[a.id] !== f) return;
          f[key] = next;
          cx.notify();
        });
      }
    }
    if (force) { this.statusLists = {}; if (this.statusOpen) this.loadStatuses(this.statusOpen, cx); }
  }

  loadStatuses(boardId, cx) {
    const p = this.profile, b = p?.boards.find((x) => x.id === boardId);
    if (!b) return;
    this.statusLists[boardId] = { status: "loading" };
    const io = this.io();
    cx.spawn(async (cx) => {
      let next;
      try { next = { status: "ok", data: await boardStatuses(p, b, io) }; } catch (e) { next = { status: "error", error: String(e.message ?? e) }; }
      if (this.profile?.name !== p.name) return;
      this.statusLists[boardId] = next;
      cx.notify();
    });
  }

  // Applies `change(rawConfig)` and writes it. A change that leaves the config invalid is refused.
  // Returns the refusal's message, else null (a failed write shows later, in settingsError).
  saveConfig(change, cx, { after = null } = {}) {
    const s = this.state;
    const base = s.status === "ok" ? s.config : s.status === "missing" ? {} : null;
    if (!base) return "the configuration isn't loaded";
    let raw;
    try { raw = change(base); } catch (e) { this.settingsError = String(e.message ?? e); cx.notify(); return this.settingsError; }
    const text = JSON.stringify(raw, null, 2) + "\n";
    const parsed = parseConfig(text, herdrWindow().platform);
    if (parsed.errors.length) { this.settingsError = parsed.errors[0]; cx.notify(); return this.settingsError; }
    this.settingsError = null;
    this.confirm = null;
    const expected = s.status === "ok" ? s.text : null;
    // Another active Profile or runner needs a full reload. Otherwise the change applies in place.
    const reload = s.status !== "ok" || parsed.profile.name !== s.profile.name || parsed.profile.runner !== s.profile.runner;
    if (!reload && !after) {
      this.state = { ...s, text, config: parsed.config, profile: parsed.profile, profileNames: parsed.profileNames, vimKeys: parsed.vimKeys };
      if (this.prs) this.prs = { ...this.prs, status: "cached" }; // followed repos may have changed: refetch on show
    }
    // The chain only orders the file writes. What follows a write runs in this call's own task, with its own cx.
    const write = this.writes = (this.writes ?? Promise.resolve()).then(async () => {
      try { await writeTextFile(s.path, text, expected); return null; } catch (e) { return e; }
    });
    cx.spawn(async (cx) => {
      const failed = await write;
      if (failed) {
        this.settingsError = `Couldn't save (${failed.message ?? failed}). The file changed elsewhere, so it was read again.`;
        this.reload(cx); cx.notify(); return;
      }
      if (after) await after();
      if (reload || after) this.reload(cx);
      cx.notify();
    });
    cx.notify();
    return null;
  }

  // A remove button: the first click asks, the second removes.
  removeButton(id, t, onRemove) {
    const armed = this.confirm === id;
    return button(`wf-rm-${id}`, armed ? "Click again to remove" : "Remove", t, (cx) => {
      if (armed) onRemove(cx); else this.confirm = id;
      cx.notify();
    }, { on: armed });
  }

  settingsView(t) {
    const s = this.state, p = this.profile;
    const heading = (text) => div().pt(8).text_size(13).font_semibold().text_color(t.foreground).child(text);
    const note = (text, color = t.dim) => div().text_size(12).text_color(color).child(text);
    const card = (id, kids) => v_flex().id(id).p(12).gap(6).rounded(8).bg(t.surface).border_1().border_color(t.border).children(kids);
    const who = (a) => `${a.id} · ${a.provider === "azure" ? a.org : a.provider === "clickup" ? `ClickUp (token from ${a.tokenEnv ?? "CLICKUP_API_TOKEN"})` : a.login}`;
    const line = () => div().h(1).my(4).bg(t.border);
    // A clickable row that folds what follows it. Returns [row, folded].
    const fold = (id, a, part, label, color = t.muted) => {
      const folded = load(this.foldKey(a, part), "0") === "1";
      return [h_flex().id(id).gap(8).items_center().cursor_pointer()
        .on_mouse_down("left", stop).on_click((_e, cx) => { save(this.foldKey(a, part), folded ? "0" : "1"); cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(color).child(label))
        .child(div().text_size(12).text_color(t.dim).hover((x) => x.text_color(t.foreground)).child(folded ? "Show" : "Hide")), folded];
    };
    const out = [];
    if (this.settingsError) out.push(note(this.settingsError, t.blocked));

    // Vim keys (D13): the whole file's, above the Profiles.
    if (s.status === "ok") {
      out.push(card("wf-set-vim", [
        checkRow("wf-vim", this.vim, "Vim keys", t, (cx) => this.saveConfig((raw) => edits.setVimKeys(raw, !this.vim), cx)),
        note("j/k/h/l move, enter opens, q closes, ? lists every key, letters jump to Pull Requests"),
      ]));
    }

    // Profiles: order is the switcher's order.
    const names = s.profileNames ?? [];
    out.push(heading("Profiles"), note("Each Profile is a separate set of Accounts and Boards. Wayfindr shows one at a time, and the switcher lists them in this order."));
    out.push(card("wf-set-profiles", [
      ...names.flatMap((n, i) => {
        const renaming = this.renaming?.name === n;
        const row = h_flex().id(`wf-set-p-${n}`).gap(6).items_center()
          .when(renaming, (el) => el.child(field(this.renaming.input, t, 200))
            .child(button(`wf-ren-ok-${n}`, "Save", t, (cx) => this.finishRename(cx), { on: true }))
            .child(button(`wf-ren-no-${n}`, "Cancel", t, (cx) => { this.renaming = null; cx.notify(); }))
            .child(div().flex_1()))
          .when(!renaming, (el) => el.child(div().flex_1().text_size(12).text_color(t.foreground).child(n === p?.name ? `${n} (shown)` : n))
            .when(n !== p?.name, (r) => r.child(button(`wf-use-${n}`, "Show", t, (cx) => cx.spawn(async (cx) => { await this.switchProfile(n, cx); cx.notify(); }))))
            .child(button(`wf-ren-${n}`, "Rename", t, (cx) => { this.startRename(n); cx.notify(); })))
          .child(button(`wf-pu-${n}`, "↑", t, (cx) => this.saveConfig((raw) => edits.moveProfile(raw, n, -1), cx)))
          .child(button(`wf-pd-${n}`, "↓", t, (cx) => this.saveConfig((raw) => edits.moveProfile(raw, n, 1), cx)))
          .when(names.length > 1, (el) => el.child(this.removeButton(`profile-${n}`, t, (cx) => this.saveConfig((raw) => edits.removeProfile(raw, n), cx))));
        if (n !== p?.name) return [row];
        return [row, h_flex().child(checkRow("wf-notify", p.notifications.enabled,
          `Background checks every ${p.notifications.minutes} min with toasts for new reviews and assignments`, t,
          (cx) => this.saveConfig((raw) => edits.setNotifications(raw, p.name, { enabled: !p.notifications.enabled }), cx)))];
      }),
      h_flex().gap(8).items_center().child(field(this.inputs.profile, t, 200))
        .child(button("wf-add-profile", "Add profile", t, (cx) => {
          const name = this.inputs.profile.value().trim();
          this.saveConfig((raw) => {
            const next = edits.addProfile(raw, name);
            if (!names.length) next.activeProfile = name;
            return next;
          }, cx);
          this.inputs.profile.set_value("");
        })),
    ]));
    if (!p) return v_flex().id("wf-settings").size_full().min_h(0).p(16).gap(10).overflow_y_scrollbar().children(out);

    // Accounts
    out.push(heading(`Accounts in ${p.name}`), note("Wayfindr signs in through the gh and az CLIs, or a token it reads from an environment variable, and stores no secrets."));
    out.push(card("wf-set-accounts", [
      ...(p.accounts.length ? [] : [note("No accounts yet.")]),
      ...p.accounts.flatMap((a) => {
        const si = this.signIn?.[a.id];
        return [
          h_flex().id(`wf-set-a-${a.id}`).gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(who(a)))
            .child(div().text_size(11).text_color(si?.ok === false ? t.blocked : t.dim).child(si ? (si.ok ? "signed in" : "sign in needed") : ""))
            .child(this.removeButton(`account-${a.id}`, t, (cx) => this.saveConfig((raw) => edits.removeAccount(raw, p.name, a.id), cx))),
          ...(si && !si.ok ? [this.signInCard(t, a, si)] : []),
        ];
      }),
      h_flex().gap(8).items_center().child(field(this.inputs.gh, t))
        .child(button("wf-add-gh", "Add GitHub account", t, (cx) => {
          this.saveConfig((raw) => edits.addAccount(raw, p.name, { provider: "github", login: this.inputs.gh.value().trim() }), cx);
          this.inputs.gh.set_value(""); this.ensureInputs(); this.checkSignIn(cx); this.loadSettings(cx);
        })),
      h_flex().gap(8).items_center().child(field(this.inputs.ado, t))
        .child(button("wf-add-ado", "Add Azure account", t, (cx) => {
          this.saveConfig((raw) => edits.addAccount(raw, p.name, { provider: "azure", org: this.inputs.ado.value().trim() }), cx);
          this.inputs.ado.set_value(""); this.ensureInputs(); this.checkSignIn(cx); this.loadSettings(cx);
        })),
      h_flex().gap(8).items_center()
        .child(button("wf-add-cu", "Add ClickUp account", t, (cx) => {
          this.saveConfig((raw) => edits.addAccount(raw, p.name, { provider: "clickup" }), cx);
          this.ensureInputs(); this.checkSignIn(cx); this.loadSettings(cx);
        }))
        .child(note("Reads a personal token from CLICKUP_API_TOKEN in the runner's ~/.profile.")),
    ]));

    // Boards: one card per Account. Its followed Boards first, a line, then the others (foldable, searchable).
    out.push(heading("Boards"), note("Ticked Boards show in Wayfindr. With two or more, a switcher shows above the Board."));
    for (const a of p.accounts.filter((x) => can(providerFor(x), "boards"))) {
      const f = this.found[a.id]?.boards;
      const found = f?.data ?? [];
      const mine = p.boards.filter((b) => b.account === a.id);
      const cfgFor = (d) => mine.find((b) => edits.showsBoard(b, a.id, d, Boolean(d.teamDefault)));
      const search = this.inputs.boards[a.id];
      const unfollowed = found.filter((d) => !cfgFor(d));
      const others = edits.matchBoards(unfollowed, search?.value());
      const active = mine.flatMap((b) => {
        const open = this.statusOpen === b.id;
        const tracked = b.trackedStatuses?.length ?? 0;
        return [
          h_flex().id(`wf-set-ab-${b.id}`).gap(8).items_center()
            .child(checkRow(`wf-set-abc-${b.id}`, true, b.name ?? b.id, t, (cx) => this.saveConfig((raw) => edits.unfollowBoard(raw, p.name, b.id), cx)))
            .when(can(providerFor(a), "statuses"), (el) => el.child(button(`wf-st-${b.id}`,
              open ? "Done" : tracked ? `Edit displayed statuses (${tracked})` : "Edit displayed statuses", t,
              (cx) => { this.statusOpen = open ? null : b.id; if (this.statusOpen && !this.statusLists[b.id]) this.loadStatuses(b.id, cx); cx.notify(); },
              { on: open || tracked > 0 }))),
          ...(open ? [this.statusEditor(t, p, b)] : []),
        ];
      });
      const [cardRow, cardFolded] = fold(`wf-set-bc-${a.id}`, a, "boards", `${who(a)} · ${mine.length} followed`, t.foreground);
      const [othersRow, folded] = fold(`wf-set-bh-${a.id}`, a, "", `Other Boards${f?.status === "ok" ? ` · ${unfollowed.length}` : ""}`);
      out.push(card(`wf-set-boards-${a.id}`, [
        cardRow,
        ...(cardFolded ? [] : [
          ...(active.length ? active : [note("No Boards followed. Tick one below.")]),
          line(),
          othersRow,
          ...(folded ? [] : [
            ...(search ? [field(search, t)] : []),
            ...(f?.status === "loading" ? [note("Finding boards…")] : []),
            ...(f?.status === "error" ? [note(`Couldn't list boards: ${f.error}`, t.blocked)] : []),
            ...(f?.status === "ok" && !unfollowed.length ? [note(found.length ? "All followed." : "No boards found.")] : []),
            ...(unfollowed.length && !others.length ? [note("No match.")] : []),
            ...others.map((d) => h_flex().child(checkRow(`wf-set-bo-${a.id}-${found.indexOf(d)}`, false, d.title, t,
              (cx) => this.saveConfig((raw) => edits.followBoard(raw, p.name, a.id, d), cx)))),
          ]),
        ]),
      ]));
    }

    // Pull Request repos
    out.push(heading("Pull Request repos"), note("All: every repo's Pull Requests. Selected: only the ticked repos. Ignored: every repo except the ticked ones."));
    for (const a of p.accounts.filter((x) => can(providerFor(x), "repos"))) {
      const f = this.found[a.id]?.repos;
      const rf = repoFilter(a);
      const ticked = rf.mode === "all" ? [] : rf[rf.mode];
      const search = this.inputs.repos[a.id];
      const all = f?.data ?? [];
      // The ticked repos first, then the others to search. A ticked repo no longer listed still shows.
      const { rows, hidden } = edits.repoRows(all.filter((r) => !ticked.includes(r)), [], search?.value());
      const untickedCount = all.filter((r) => !ticked.includes(r)).length;
      const summary = rf.mode === "all" ? "all repos"
        : rf.mode === "selected" ? (ticked.length ? `only ${ticked.length} selected` : "nothing selected, so no Pull Requests")
        : `all but ${ticked.length} ignored`;
      const [cardRow, cardFolded] = fold(`wf-set-rc-${a.id}`, a, "repos", `${who(a)} · ${summary}`, t.foreground);
      const [othersRow, folded] = fold(`wf-set-rh-${a.id}`, a, "repos.others", `Other repos${f?.status === "ok" ? ` · ${untickedCount}` : ""}`);
      const tickLabel = rf.mode === "selected" ? "Selected repos" : "Ignored repos";
      out.push(card(`wf-set-repos-${a.id}`, [
        cardRow,
        ...(cardFolded ? [] : [
          h_flex().child(segmented(`wf-rm-${a.id}`, [["all", "All"], ["selected", "Selected"], ["ignored", "Ignored"]], rf.mode, t,
            (mode, cx) => this.saveConfig((raw) => edits.setRepoMode(raw, p.name, a.id, mode), cx))),
          ...(rf.mode === "all" ? [] : [
            note(tickLabel),
            ...(ticked.length ? ticked.map((r) => h_flex().child(checkRow(`wf-set-rt-${a.id}-${r}`, true, r, t,
              (cx) => this.saveConfig((raw) => edits.toggleRepo(raw, p.name, a.id, r), cx))))
              : [note(rf.mode === "selected" ? "None selected. Tick one below." : "None ignored. Tick one below.")]),
            line(),
            othersRow,
            ...(folded ? [] : [
              ...(search ? [field(search, t)] : []),
              ...(f?.status === "loading" ? [note("Listing repos…")] : []),
              ...(f?.status === "error" ? [note(`Couldn't list repos: ${f.error}`, t.blocked)] : []),
              ...(f?.status === "ok" && !untickedCount ? [note("All ticked.")] : []),
              ...(untickedCount && !rows.length ? [note("No match.")] : []),
              ...rows.map((r) => h_flex().child(checkRow(`wf-set-r-${a.id}-${r}`, false, r, t, (cx) => {
                const failed = this.saveConfig((raw) => edits.toggleRepo(raw, p.name, a.id, r), cx);
                if (!failed && rf.mode === "selected") this.autoClone(r, cx);
              }))),
              ...(hidden ? [note(`${hidden} more match. Search to narrow the list.`)] : []),
            ]),
          ]),
        ]),
      ]));
    }

    // Local clones: every Repo, then the Selected repos without one.
    const missing = this.missingClones(p);
    const c = this.clones;
    out.push(heading("Local clones"), note("A Review starts in the clone of the Pull Request's repo. Worktree: a new worktree. Branch: the branch checked out in the clone itself. Wranglr, Herdr, Beside or Folder: where the worktrees go."));
    out.push(card("wf-set-clones", [
      ...(p.repos.length || missing.length ? [] : [note("No clones yet.")]),
      ...p.repos.map((r) => {
        const placement = ["wranglr", "herdr", "beside"].includes(r.worktrees) ? r.worktrees : "folder";
        return v_flex().id(`wf-clone-${r.id}`).gap(4)
          .child(h_flex().gap(8).items_center()
            .child(stateMark("found", t))
            .child(v_flex().flex_1().min_w(0)
              .child(div().truncate().text_size(12).text_color(r.prRepo ? t.foreground : t.muted).child(r.prRepo ?? "Board clone"))
              .child(div().truncate().text_size(11).text_color(t.dim).child(r.path)))
            .child(segmented(`wf-co-${r.id}`, [["worktree", "Worktree"], ["branch", "Branch"]], r.checkout, t,
              (mode, cx) => this.saveConfig((raw) => edits.setRepoCheckout(raw, p.name, r.id, mode), cx)))
            .child(segmented(`wf-wp-${r.id}`, [["wranglr", "Wranglr"], ["herdr", "Herdr"], ["beside", "Beside"], ["folder", "Folder…"]], placement, t,
              (key, cx) => this.setPlacement(r.id, key, cx)))
            .child(button(`wf-clone-rm-${r.id}`, "Remove", t, (cx) => this.saveConfig((raw) => edits.removeRepo(raw, p.name, r.id), cx))))
          .when(placement === "folder", (el) => el.child(div().pl(16).truncate().text_size(11).text_color(t.dim).child(`Worktrees in ${r.worktrees}`)))
          .when(placement === "wranglr", (el) => el.child(div().pl(16).truncate().text_size(11).text_color(t.dim).child(`Worktrees by ${placementText("wranglr", this.wranglr)}`)));
      }),
      ...missing.flatMap(({ a, name, i }) => {
        const f = this.cloneFind[`${a.id}:${name}`];
        const st = this.cloneState(name);
        return [
          h_flex().id(`wf-nc-${a.id}-${i}`).gap(8).items_center()
            .child(stateMark(st.status, t))
            .child(h_flex().flex_1().min_w(0).gap(6).items_center()
              .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(name))
              .child(div().flex_none().text_size(12).text_color(st.status === "searching" ? t.working : stateColor(st.status, t)).child(STATE_TEXT[st.status] ?? "")))
            .child(button(`wf-find-${a.id}-${i}`, "Find", t, (cx) => this.findClone(a.id, name, cx)))
            .child(button(`wf-pick-${a.id}-${i}`, "Pick…", t, (cx) => this.pickClone(a.id, name, cx))),
          ...(st.status === "several" || st.status === "one" ? [v_flex().id(`wf-hits-${a.id}-${i}`).gap(4).items_start()
            .children(st.hits.map((h, j) => button(`wf-hit-${a.id}-${i}-${j}`, hitLabel(h, t), t, (cx) => {
              delete this.cloneFind[`${a.id}:${name}`];
              this.saveConfig((raw) => edits.addRepo(raw, p.name, { path: h.path, prRepo: name }).raw, cx);
            })))] : []),
          ...(f?.status === "error" ? [note(f.error, t.blocked)] : []),
        ];
      }),
      line(),
      h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(c?.status === "error" ? t.blocked : t.dim)
          .child(!c ? "Not scanned yet." : c.status === "loading" ? "Scanning…"
            : c.status === "error" ? c.error : `Scanned ${c.list.length} clones ${formatAge(Date.now() - c.at)}`))
        .child(button("wf-clones-scan", "Search all", t, (cx) => this.searchAll(cx))),
    ]));
    return v_flex().id("wf-settings").size_full().min_h(0).p(16).gap(10).overflow_y_scrollbar().children(out);
  }

  // The Selected repos without a Repo: [{ a, name, i }], `i` the index within the account's list.
  missingClones(p) {
    const hasClone = (name) => p.repos.some((r) => r.prRepo && sameRepo(r.prRepo, name));
    return p.accounts.filter((a) => can(providerFor(a), "repos") && repoFilter(a).mode === "selected")
      .flatMap((a) => repoFilter(a).selected.filter((name) => !hasClone(name)).map((name, i) => ({ a, name, i })));
  }

  // A repo name's clone state in Settings: { status, hits }, status found | searching | unscanned | several | none | one.
  cloneState(name) {
    const p = this.profile;
    if (p?.repos.some((r) => r.prRepo && sameRepo(r.prRepo, name))) return { status: "found", hits: [] };
    const finding = Object.entries(this.cloneFind).some(([k, f]) => f?.status === "loading" && k.endsWith(`:${name}`));
    if (this.clones?.status === "loading" || finding) return { status: "searching", hits: [] };
    if (!this.clones || this.clones.status === "error") return { status: "unscanned", hits: [] };
    const hits = this.clonesOf(name);
    return { status: hits.length > 1 ? "several" : hits.length ? "one" : "none", hits };
  }

  // Settings' Worktree Placement: herdr or beside saves at once; folder asks for one (cancel keeps the old value).
  setPlacement(repoId, key, cx) {
    const pName = this.profile?.name;
    if (!pName) return;
    if (key !== "folder") { this.saveConfig((raw) => edits.setRepoWorktrees(raw, pName, repoId, key), cx); return; }
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: `Worktrees folder for ${repoId}` });
      if (!folder || this.profile?.name !== pName) return;
      this.saveConfig((raw) => edits.setRepoWorktrees(raw, pName, repoId, folder), cx);
      cx.notify();
    });
  }

  // Settings' Search all: scans again, then saves each Selected repo's one clone, one save per name in sequence.
  searchAll(cx) {
    const pName = this.profile?.name;
    if (!pName) return;
    cx.spawn(async (cx) => {
      await this.scanClones(cx, { force: true });
      const p = this.profile;
      if (p?.name !== pName || this.clones?.status !== "ok") { cx.notify(); return; }
      for (const name of new Set(this.missingClones(p).map((m) => m.name))) {
        if (this.profile?.name !== pName) break;
        const hit = soleClone(this.clonesOf(name));
        if (!hit || this.cloneState(name).status === "found") continue;
        this.saveConfig((raw) => edits.addRepo(raw, pName, { path: hit.path, prRepo: name }).raw, cx);
      }
      cx.notify();
    });
  }

  // Settings' Find: scans again, then saves the one clone of `name`, or lists several.
  findClone(accountId, name, cx) {
    const pName = this.profile?.name, key = `${accountId}:${name}`;
    if (!pName) return;
    this.cloneFind[key] = { status: "loading" }; cx.notify();
    cx.spawn(async (cx) => {
      await this.scanClones(cx, { force: true });
      if (this.profile?.name !== pName) return;
      const hits = this.clonesOf(name);
      if (this.clones?.status === "error") this.cloneFind[key] = { status: "error", error: `Couldn't scan for clones: ${this.clones.error}` };
      else if (!hits.length) this.cloneFind[key] = { status: "none" };
      else if (!soleClone(hits)) this.cloneFind[key] = { status: "choose", hits };
      else {
        delete this.cloneFind[key];
        const failed = this.saveConfig((raw) => edits.addRepo(raw, pName, { path: hits[0].path, prRepo: name }).raw, cx);
        if (failed) this.cloneFind[key] = { status: "error", error: `Couldn't save the clone: ${failed}` };
      }
      cx.notify();
    });
  }

  // Settings' Pick…: a folder whose origin is `name`, saved as its Repo.
  pickClone(accountId, name, cx) {
    const pName = this.profile?.name, key = `${accountId}:${name}`;
    if (!pName) return;
    const io = this.io();
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: `Pick your local clone of ${name}` });
      if (!folder || this.profile?.name !== pName) return;
      const wrong = await this.checkClone(folder, name, io);
      if (this.profile?.name !== pName) return;
      if (wrong) { this.cloneFind[key] = { status: "error", error: wrong }; cx.notify(); return; }
      delete this.cloneFind[key];
      const failed = this.saveConfig((raw) => edits.addRepo(raw, pName, { path: folder, prRepo: name }).raw, cx);
      if (failed) this.cloneFind[key] = { status: "error", error: `Couldn't save the clone: ${failed}` };
      cx.notify();
    });
  }

  // A repo just ticked in Selected mode: its one scanned clone becomes its Repo. Several or none wait for Settings.
  autoClone(name, cx) {
    const pName = this.profile?.name;
    if (!pName) return;
    cx.spawn(async (cx) => {
      await this.scanClones(cx);
      const p = this.profile;
      if (p?.name !== pName) return;
      const hits = this.clonesOf(name);
      if (!soleClone(hits) || p.repos.some((r) => r.prRepo && sameRepo(r.prRepo, name))) { cx.notify(); return; }
      this.saveConfig((raw) => edits.addRepo(raw, pName, { path: hits[0].path, prRepo: name }).raw, cx);
      cx.notify();
    });
  }

  // A Board's Tracked Statuses: ticked ones in Column order with up and down, then the rest.
  statusEditor(t, p, b) {
    const st = this.statusLists[b.id];
    const tracked = b.trackedStatuses ?? [];
    const set = (list, cx) => this.saveConfig((raw) => edits.setTrackedStatuses(raw, p.name, b.id, list), cx);
    const rest = (st?.data ?? []).filter((x) => !tracked.some((y) => y.toLowerCase() === x.toLowerCase()));
    return v_flex().id(`wf-st-ed-${b.id}`).ml(22).p(8).gap(2).rounded(6).bg(t.background).border_1().border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(tracked.length ? "Each ticked status is one Column, in this order." : "None ticked: the Board's own Columns."))
      .when(st?.status === "loading", (el) => el.child(div().text_size(11).text_color(t.dim).child("Loading statuses…")))
      .when(st?.status === "error", (el) => el.child(div().text_size(11).text_color(t.blocked).child(`Couldn't list statuses: ${st?.error}`)))
      .children(tracked.map((x, i) => h_flex().id(`wf-st-t-${b.id}-${i}`).gap(4).items_center()
        .child(checkRow(`wf-st-c-${b.id}-${i}`, true, x, t, (cx) => set(edits.toggleStatus(tracked, x), cx)))
        .child(button(`wf-st-up-${b.id}-${i}`, "↑", t, (cx) => set(edits.move(tracked, i, -1), cx)))
        .child(button(`wf-st-dn-${b.id}-${i}`, "↓", t, (cx) => set(edits.move(tracked, i, 1), cx)))))
      .children(rest.map((x, i) => h_flex().child(checkRow(`wf-st-r-${b.id}-${i}`, false, x, t, (cx) => set(edits.toggleStatus(tracked, x), cx)))));
  }

  header(t) {
    return h_flex().h(44).px(12).gap(10).flex_none().items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Wayfindr"))
      .child(segmented("wf-view", [["board", "Board"], ["prs", "Pull Requests"]], this.view, t, (key, cx) => {
        this.showView(key, cx); cx.notify();
      }))
      .child(div().flex_1())
      .when(Boolean(this.profile) && this.state.profileNames.length > 1, (el) => el.child(segmented("wf-profiles",
        this.state.profileNames.map((n) => [n, n]), this.profile.name, t, (name, cx) => cx.spawn(async (cx) => { await this.switchProfile(name, cx); cx.notify(); }))))
      .child(h_flex().gap(2).items_center()
        .child(iconButton("wf-settings", "settings", t, (cx) => { this.openSettings(cx); cx.notify(); }, { on: this.view === "settings" }))
        .child(iconButton("wf-refresh", "refresh", t, (cx) => this.reload(cx)))
        .child(iconButton("wf-close", "close", t, (cx) => this.close_(cx))));
  }

  message(t, title, lines) {
    return v_flex().p(16).gap(8).max_w(720).child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
      .children(lines.map((l) => div().text_size(12).text_color(t.muted).child(l)));
  }

  boardView(t) {
    const p = this.profile, b = this.board;
    if (!b) {
      const c = this.checks;
      const check = (name, r) => r ? `${name}: ${r.ok ? r.text : `not reachable (${r.text})`}` : `${name}: checking…`;
      const bad = p.accounts.filter((a) => this.signIn?.[a.id]?.ok === false);
      return v_flex().p(16).gap(12)
        .child(this.message(t, "No Boards", [`Profile ${p.name} has no Boards. Add one under "boards" in ${this.state.path}.`, check("gh", c?.gh), check("az", c?.az)]).p(0))
        .children(bad.map((a) => this.signInCard(t, a, this.signIn[a.id])));
    }
    const entry = this.boards[b.id] ?? { status: "loading" };
    const mine = load(this.mineKey(b), "0") === "1";
    const title = b.name ?? entry.data?.title ?? b.id;
    const site = p.accounts.find((a) => a.id === b.account)?.provider;

    const bar = h_flex().h(40).px(16).gap(10).flex_none().items_center()
      .when(p.boards.length > 1, (el) => el.child(segmented("wf-boards", p.boards.map((x) => [x.id, x.name ?? this.boards[x.id]?.data?.title ?? x.id]), b.id, t, (id, cx) => this.selectBoard(id, cx))))
      .when(p.boards.length <= 1, (el) => el.child(div().text_size(13).font_semibold().text_color(t.foreground).child(title)))
      .child(button("wf-mine", "Mine", t, (cx) => { save(this.mineKey(b), mine ? "0" : "1"); cx.notify(); }, { on: mine }))
      .when(Boolean(entry.data?.url), (el) => el.child(div().flex_none().text_size(12)
        .child(TextView.markdown(`wf-board-link-${b.id}`, link(`View in ${SITE[site] ?? "browser"}`, entry.data.url)))))
      .child(div().flex_1())
      .when(entry.status === "error" && Boolean(entry.data), (el) => el.child(div().min_w(0).text_size(12).text_color(t.blocked).truncate().child(`Couldn't refresh: ${entry.error}`)))
      .when(entry.status === "loading" || Boolean(entry.at), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim)
        .child(entry.status === "loading" ? (entry.data ? "Refreshing…" : "Loading…") : `Updated ${formatAge(Date.now() - entry.at)}`)));

    const account = p.accounts.find((a) => a.id === b.account);
    const si = account ? this.signIn?.[account.id] : null;
    let content;
    if (si && !si.ok) {
      content = v_flex().p(16).child(this.signInCard(t, account, si));
    } else if (!entry.data) {
      content = entry.status === "error" ? this.message(t, "Couldn't load this Board", [entry.error]) : skeletonColumns(t);
    } else {
      content = h_flex().id("wf-columns").size_full().min_w(0).min_h(0).px(16).pb(16).gap(12).items_start().overflow_x_scrollbar()
        .children(this.columnsOf(b, entry.data).map(({ column, tickets }, ci) =>
          v_flex().id(`wf-col-${column.id}`).w(COLUMN_W).flex_none().max_h_full().rounded(10).bg(t.chrome).border_1().border_color(t.border)
            .child(h_flex().h(36).px(12).gap(8).flex_none().items_center()
              .child(div().text_size(12).font_semibold().text_color(t.foreground).truncate().child(column.name))
              .child(div().text_size(11).text_color(t.dim).child(String(tickets.length))))
            .child(v_flex().id(`wf-col-body-${column.id}`).px(8).pb(8).gap(8).overflow_y_scrollbar()
              .children(tickets.map((tk, ri) => card(tk, t, this.selected?.summary.key === tk.key, (cx) => { this.cursor = { board: b.id, col: ci, row: ri }; this.openTicket(b, tk, cx); },
                this.cursor?.board === b.id && this.cursor.col === ci && this.cursor.row === ri))))));
    }
    const panel = this.selected?.boardId === b.id && !(si && !si.ok) ? this.ticketPanel(t) : null;
    // The detail panel takes the full height under the header, beside the Board's bar and Columns.
    return h_flex().size_full().items_start()
      // A click on the Board outside a card closes the detail panel. Cards and buttons stop their own.
      .child(v_flex().id("wf-board-area").flex_1().min_w(0).h_full()
        .on_click((_e, cx) => { if (this.moveOpen) this.moveOpen = null; else if (this.selected) this.closeTicket(); cx.notify(); })
        .child(bar).child(content))
      .when(Boolean(panel), (el) => el.child(panel));
  }

  canMove(b) {
    const a = this.profile.accounts.find((x) => x.id === b.account);
    return Boolean(a) && can(providerFor(a), "move");
  }

  // Moves a card (#15): shown in its new Column at once, then the Board reloads. A failure puts it back.
  // True when a write started.
  moveCard(b, summary, columnId, cx) {
    const entry = this.boards[b.id], data = entry?.data;
    if (!data || this.moving?.status === "busy") return false;
    let target;
    try { target = moveTarget(data, b, columnId); } catch (e) { this.moving = { key: summary.key, status: "error", error: String(e.message ?? e) }; return false; }
    const before = data.tickets.find((x) => x.key === summary.key);
    if (!before) return false;
    // Columns without states (GitHub, ClickUp) are the status themselves.
    const col = target.column;
    const status = target.status ?? (col?.states ? col.states[before.type] : col?.name) ?? before.status;
    const after = { ...before, columnId: col?.id ?? before.columnId, status };
    entry.data = { ...data, tickets: data.tickets.map((x) => (x.key === summary.key ? after : x)) };
    if (this.selected?.summary.key === summary.key) this.selected = { ...this.selected, summary: { ...this.selected.summary, ...after } };
    this.moving = { key: summary.key, status: "busy" };
    const io = this.io(), p = this.profile;
    cx.spawn(async (cx) => {
      try {
        await moveTicket(p, b, data, before, columnId, io);
        if (this.profile?.name === p.name) this.movedRecently[b.id] = { key: summary.key, columnId: after.columnId, status, until: Date.now() + 15000 };
        this.moving = null; this.moveOpen = null;
        delete this.tickets[summary.key]; // its Column changed: the detail reloads
        if (this.selected?.summary.key === summary.key) this.fetchTicket(cx);
      } catch (e) {
        if (this.profile?.name !== p.name) return; // a reload replaced the Profile meanwhile
        const cur = this.boards[b.id];
        if (cur?.data) cur.data = { ...cur.data, tickets: cur.data.tickets.map((x) => (x.key === summary.key ? before : x)) };
        if (this.selected?.summary.key === summary.key) {
          this.selected = { ...this.selected, summary: { ...this.selected.summary, columnId: before.columnId, status: before.status } };
        }
        this.moving = { key: summary.key, status: "error", error: `Couldn't move it: ${e.message ?? e}` };
        this.moveOpen = null;
      }
      if (this.profile?.name === p.name) this.fetchBoard(b, cx);
      cx.notify();
    });
    return true;
  }

  // The Move list's Columns for a card: [{ id, name, here }], `here` its current one. GitHub's "No Status" is not
  // a target: it shows only as the card's current Column.
  moveCols(b, sum) {
    const data = this.boards[b.id]?.data;
    if (!data) return [];
    const all = this.columnsOf(b, data), cur = all.find((x) => x.tickets.some((tk) => tk.key === sum.key))?.column.id;
    return all.map((x) => x.column).filter((c) => c.id !== NO_COLUMN || c.id === cur).map((c) => ({ id: c.id, name: c.name, here: c.id === cur }));
  }

  moveRow(t, b, sum) {
    const data = this.boards[b.id]?.data;
    if (!data || !this.canMove(b)) return null;
    const cols = this.moveCols(b, sum);
    const m = this.moving?.key === sum.key ? this.moving : null;
    const open = this.moveOpen === sum.key;
    const name = cols.find((c) => c.here)?.name ?? "—";
    const trigger = button("wf-move-trigger", h_flex().gap(6).items_center().child(name).child(svg("mods/workspace-chrome/chevron-down.svg").size(12)), t,
      (cx) => { this.moveOpen = open ? null : sum.key; this.moveCursor = Math.max(0, cols.findIndex((c) => c.here)); cx.notify(); }, { on: open });
    // The current Column shows selected and is not a target. The key cursor (j/k) has an accent border.
    const list = v_flex().id("wf-move-list").min_w(180).p(4).rounded(6).bg(t.popover).border_1().border_color(t.border).on_mouse_down("left", stop).on_scroll_wheel(stop)
      .children(cols.map((c, i) => {
        const here = c.here, keyed = this.kb && i === this.moveCursor;
        return h_flex().id(`wf-move-${c.id}`).px(10).h(26).items_center().rounded(4).text_size(12).border_1().border_color(keyed ? t.accent : t.popover)
          .text_color(here ? t.foreground : t.muted).when(here, (el) => el.bg(t.selected))
          .when(!here, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { this.moveOpen = null; this.moveCard(b, sum, c.id, cx); cx.notify(); }))
          .child(div().truncate().child(c.name));
      }));
    return v_flex().gap(6)
      .child(h_flex().gap(6).items_center()
        .child(div().w(84).flex_none().text_size(12).text_color(t.dim).child("Move to"))
        .child(Popup.new("wf-move-pop", trigger).anchor("bottom_left").when(open, (el) => el.content(list))))
      .when(m?.status === "busy", (el) => el.child(div().text_size(12).text_color(t.dim).child("Moving…")))
      .when(m?.status === "error", (el) => el.child(div().text_size(12).text_color(t.blocked).child(m.error)));
  }

  canUpdate(b) {
    const a = this.profile.accounts.find((x) => x.id === b.account);
    return Boolean(a) && can(providerFor(a), "update");
  }

  // Title editing (#16): an input in place of the title, saved with Enter or Save.
  startEdit(sum, title) {
    const input = InputState.new({ value: title });
    input.on("submit", (_e, cx) => { this.saveTitle(cx); cx.notify(); });
    input.on("focus", () => { this.typing = "title"; });
    input.on("blur", () => { this.typing = false; });
    this.editing = { key: sum.key, input, status: "idle" };
    input.focus();
  }

  saveTitle(cx) {
    const E = this.editing, sel = this.selected, p = this.profile;
    const b = p.boards.find((x) => x.id === sel?.boardId);
    if (!E || !b || E.status === "busy" || E.key !== sel.summary.key) return;
    const title = E.input.value().trim();
    E.status = "busy"; E.error = null;
    const io = this.io(), sum = sel.summary;
    cx.spawn(async (cx) => {
      try {
        await updateTicket(p, b, sum, { title }, io);
        if (this.editing === E) { this.editing = null; this.typing = false; }
        const entry = this.boards[b.id];
        if (entry?.data) entry.data = { ...entry.data, tickets: entry.data.tickets.map((x) => (x.key === sum.key ? { ...x, title } : x)) };
        if (this.selected?.summary.key === sum.key) { this.selected = { ...this.selected, summary: { ...this.selected.summary, title } }; this.fetchTicket(cx); }
      } catch (e) {
        E.status = "error"; E.error = `Couldn't save the title: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  postComment(cx) {
    const sel = this.selected, p = this.profile, b = p.boards.find((x) => x.id === sel?.boardId);
    if (!b || this.commenting?.status === "busy") return;
    const text = this.commentBox.value().trim();
    if (!text) return;
    const C = this.commenting = { key: sel.summary.key, status: "busy" };
    const io = this.io(), sum = sel.summary;
    cx.spawn(async (cx) => {
      try {
        await commentOnTicket(p, b, sum, text, io);
        // The box is cleared only while it still holds this Ticket's draft. A draft put aside is
        // dropped when it is the text just posted.
        if (this.draftKey === sum.key && this.selected?.summary.key === sum.key) { this.commentBox.set_value(""); delete this.commentDrafts[sum.key]; }
        else if (this.commentDrafts[sum.key]?.trim() === text) delete this.commentDrafts[sum.key];
        if (this.commenting === C) this.commenting = null;
        if (this.selected?.summary.key === sum.key) this.fetchTicket(cx);
      } catch (e) {
        C.status = "error"; C.error = `Couldn't post the comment: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  // Launch (#13, D5, D18). The repos offered are the Board's, else the Profile's.
  launchRepos() {
    const p = this.profile, b = p.boards.find((x) => x.id === this.selected?.boardId);
    const ids = b?.repos?.length ? b.repos : p.repos.map((r) => r.id);
    return ids.map((id) => p.repos.find((r) => r.id === id)).filter(Boolean);
  }

  launchTemplate() {
    const b = this.profile.boards.find((x) => x.id === this.selected?.boardId);
    return resolveTemplate(DEFAULT_LAUNCH, this.state.templates?.launch, b?.launch);
  }

  openLaunch(tk, cx) {
    const repos = this.launchRepos();
    const key = this.selected.summary.key;
    this.launch = { key, selected: repos.map((r) => r.id), exists: null, folder: null, status: "idle" };
    const io = this.io();
    cx.spawn(async (cx) => {
      let exists = [];
      let folder = null;
      const wr = await this.readWranglr();
      try { ({ names: exists, folder } = await existingWorktrees(ticketPrefix(tk), ticketFolder(tk), repos.map((r) => ({ path: r.path, name: repoName(r), worktrees: r.worktrees })), io, wr)); } catch { /* shown as not made */ }
      if (this.launch?.key !== key) return;
      this.launch.exists = exists; this.launch.folder = folder;
      cx.notify();
    });
  }

  addLaunchRepo(cx) {
    const boardId = this.selected?.boardId, name = this.profile.name;
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: "Pick a local clone for this Board" });
      if (!folder || this.profile?.name !== name) return; // none picked, or a reload replaced the Profile meanwhile
      let id = null;
      this.saveConfig((raw) => { const r = edits.addRepo(raw, name, { path: folder, boardId }); id = r.id; return r.raw; }, cx, {
        after: () => { if (this.launch && id && !this.launch.selected.includes(id)) this.launch.selected.push(id); },
      });
    });
  }

  startLaunch(tk, cx) {
    const L = this.launch, p = this.profile;
    if (!L || L.status === "busy") return;
    // A second Launch selects the space it made (D18), found by the Ticket's id: a title edit renames the Ticket.
    const name = launchSpaceName(tk);
    const open = spaces().find((x) => x.name?.startsWith(`${tk.id} `) || x.name === name);
    if (open) { run("space.select", { id: open.id }); this.launch = null; this.close_(cx); return; }
    const repos = this.launchRepos().filter((r) => L.selected.includes(r.id));
    let argv;
    const tpl = this.launchTemplate();
    try { argv = agentArgv(tpl); } catch (e) { L.status = "error"; L.error = String(e.message ?? e); return; }
    const prefix = ticketPrefix(tk), folder = ticketFolder(tk);
    L.status = "busy"; L.message = repos.length ? "Making worktrees…" : "Starting…"; L.error = null;
    const io = this.io(), runner = p.runner;
    cx.spawn(async (cx) => {
      try {
        // An earlier Launch's folder and branch are reused when the title has changed since.
        const wr = await this.readWranglr();
        const made = await makeLaunchWorktrees(prefix, folder, repos.map((r) => ({ path: r.path, name: repoName(r), worktrees: r.worktrees })), io, wr);
        const info = repos.map((r) => ({ id: r.id, branch: made.branch, worktree: made.worktrees?.[repoName(r)] ?? `${made.path}/${repoName(r)}` }));
        // On the runner's machine when Herdr has it (the agent runs there directly), else this computer.
        const target = spaceTarget(runner, herdrWindow().platform, p.machine, machines().map((m) => m.name), made.path, made.space, argv);
        run("space.new", { name, ...target, task: launchPrompt(tk, info, tpl) });
        if (this.launch === L) this.launch = null;
        this.close_(cx); // the space is what you came for
      } catch (e) {
        L.status = "error"; L.error = `Launch failed: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  launchCard(t, tk) {
    const L = this.launch, repos = this.launchRepos(), tpl = this.launchTemplate();
    const note = (text, color = t.dim) => div().text_size(12).text_color(color).child(text);
    const exists = (r) => L.exists?.includes(repoName(r));
    const open = spaces().find((x) => x.name?.startsWith(`${tk.id} `) || x.name === launchSpaceName(tk));
    return v_flex().id("wf-launch-card").p(12).gap(8).rounded(8).bg(t.surface).border_1().border_color(t.accent)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Launch"))
      .child(note(open ? `The space "${open.name}" is open. Launch selects it.`
        : `A space with ${tpl.agent}${tpl.model ? ` (${tpl.model})` : ""} on branch ${L.folder ?? ticketFolder(tk)}.`))
      .children(repos.length ? repos.map((r) => h_flex().gap(8).items_center()
        .child(checkRow(`wf-launch-r-${r.id}`, L.selected.includes(r.id), r.id, t, (cx) => {
          L.selected = L.selected.includes(r.id) ? L.selected.filter((x) => x !== r.id) : [...L.selected, r.id]; cx.notify();
        }))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(r.path))
        .child(div().flex_none().max_w(220).truncate().text_size(11).text_color(t.dim).child(placementText(r.worktrees, this.wranglr)))
        .child(note(L.exists == null ? "" : exists(r) ? "worktree exists" : ""))) : [note("No repos for this Board yet. Add a local clone, or launch without one.")])
      .child(h_flex().gap(8).items_center()
        .child(button("wf-launch-add", "Add repo…", t, (cx) => this.addLaunchRepo(cx)))
        .child(div().flex_1())
        .when(L.status === "busy", (el) => el.child(note(L.message ?? "Working…")))
        .child(button("wf-launch-go", open ? "Show space" : "Launch", t, (cx) => { this.startLaunch(tk, cx); cx.notify(); }, { on: true })))
      .when(L.status === "error", (el) => el.child(note(L.error, t.blocked)));
  }

  // The clone index (#14): the git clones on this machine, scanned once per session. Resolves when the
  // scan ends, either way. A scan in flight is shared. `force` scans again after a finished one.
  scanClones(cx, { force = false } = {}) {
    const c = this.clones, p = this.profile;
    if (c?.status === "loading") return c.promise;
    if ((c?.status === "ok" && !force) || !p) return Promise.resolve();
    const roots = scanRoots({ folders: [...spaces().map((s) => s.folder), ...p.repos.map((r) => r.path)] });
    // The script scans the runner's home itself; on Windows the user's home is another folder, so it is a root too.
    const h = String(home() ?? "").replace(/[\\/]+$/, "");
    if (h && !roots.some((r) => r.toLowerCase() === h.toLowerCase())) roots.push(h);
    const io = this.io();
    const entry = { status: "loading", list: c?.list ?? [], error: null, at: c?.at ?? null };
    entry.promise = new Promise((resolve) => cx.spawn(async (cx) => {
      let next;
      try { next = { status: "ok", list: await listClones(roots, io), error: null, at: Date.now() }; }
      catch (e) { next = { status: "error", list: [], error: String(e.message ?? e), at: Date.now() }; }
      if (this.clones === entry) this.clones = next; // a reload meanwhile dropped this scan
      resolve();
      cx.notify();
    }));
    this.clones = entry;
    cx.notify();
    return entry.promise;
  }

  // The scanned clones of a Pull Request repo.
  clonesOf(prRepo) {
    return (this.clones?.list ?? []).filter((c) => c.repo && sameRepo(c.repo, prRepo));
  }

  // Saves a clone as the Profile's Repo for `prRepo`. Returns the Repo to use now and the save's refusal, if any.
  rememberClone(profileName, folder, prRepo, cx) {
    let id = null;
    const failed = this.saveConfig((raw) => { const r = edits.addRepo(raw, profileName, { path: folder, prRepo }); id = r.id; return r.raw; }, cx);
    return { failed, repo: { id: id ?? "repo", path: folder.replace(/[\\/]+$/, ""), prRepo, checkout: "worktree", worktrees: "wranglr" } };
  }

  // A picked folder's origin must be `prRepo`. Returns the error text, else null.
  async checkClone(folder, prRepo, io) {
    let origin;
    try { origin = await cloneOrigin(folder, io); } catch { return `${folder} isn't a git repository`; }
    if (!origin.repo || !sameRepo(origin.repo, prRepo)) return `${folder} clones ${origin.repo ?? origin.url ?? "nothing"}, not ${prRepo}`;
    return null;
  }

  // What a Pull Request row and the overlay's header need to start, choose a clone for, or cancel a Review.
  reviewActions(accountId, pr) {
    return {
      state: this.reviews[pr.key],
      start: (cx) => this.startReview(accountId, pr, cx),
      choose: (path, cx) => this.reviewWith(accountId, pr, path, cx),
      cancel: (cx) => { delete this.reviews[pr.key]; cx.notify(); },
    };
  }

  // The chooser's pick: saved as the Repo, then the Review starts with it.
  reviewWith(accountId, pr, path, cx) {
    const p = this.profile;
    if (!p) return;
    const failed = this.saveConfig((raw) => edits.addRepo(raw, p.name, { path, prRepo: pr.repo }).raw, cx);
    if (failed) { this.reviews[pr.key] = { status: "error", error: `Couldn't save the clone: ${failed}` }; cx.notify(); return; }
    delete this.reviews[pr.key];
    this.startReview(accountId, pr, cx);
  }

  // Review (#14, D15 to D17): the PR's clone from the Profile's repos, else the scanned clone, else asked for once.
  startReview(accountId, pr, cx) {
    if (this.reviews[pr.key]?.status === "busy") return;
    const name = reviewSpaceName(pr);
    const open = spaces().find((x) => x.name === name);
    if (open) {
      run("space.select", { id: open.id });
      // The pane too, unless the space has a Wayfindr pane already (#30).
      const repo = this.profile?.repos.find((r) => r.prRepo && sameRepo(r.prRepo, pr.repo));
      if (resolveTemplate(DEFAULT_REVIEW, this.state.templates?.review, repo?.review).pane !== false) this.openReviewPane(name, accountId, pr, cx);
      this.close_(cx); return;
    }
    // The Profile as the Review started: a reload during an await must not mix in another's.
    const p = this.profile;
    if (!p) return;
    const st = this.reviews[pr.key] = { status: "busy", message: "Starting…" };
    const io = this.io(), runner = p.runner, templates = this.state.templates;
    const changed = (cx) => {
      if (this.profile?.name === p.name) return false;
      this.reviews[pr.key] = { status: "error", error: "The profile changed while finding the clone. Start the Review again." };
      cx.notify(); return true;
    };
    cx.spawn(async (cx) => {
      try {
        let repo = p.repos.find((r) => r.prRepo && sameRepo(r.prRepo, pr.repo));
        if (!repo) {
          st.message = "Looking for a clone…"; cx.notify();
          await this.scanClones(cx);
          if (changed(cx)) return;
          const hits = this.clonesOf(pr.repo);
          if (hits.length && !soleClone(hits)) { this.reviews[pr.key] = { status: "choose", hits }; cx.notify(); return; }
          let folder = hits[0]?.path;
          if (!folder) {
            st.message = "Pick its clone…"; cx.notify();
            folder = await pickFolder({ prompt: `Pick your local clone of ${pr.repo}` });
            if (changed(cx)) return;
            if (!folder) { delete this.reviews[pr.key]; cx.notify(); return; }
            st.message = "Checking the clone…"; cx.notify();
            const wrong = await this.checkClone(folder, pr.repo, io);
            if (changed(cx)) return;
            if (wrong) { this.reviews[pr.key] = { status: "error", error: wrong }; cx.notify(); return; }
          }
          const saved = this.rememberClone(p.name, folder, pr.repo, cx);
          // Not remembered, but this Review still goes ahead with the folder.
          if (saved.failed) st.error = `Couldn't save the clone: ${saved.failed}`;
          repo = saved.repo;
        }
        st.message = "Reading the Pull Request…"; cx.notify();
        const info = await loadReviewInfo(p, accountId, pr, io);
        st.message = "Making the worktree…"; cx.notify();
        const tpl = resolveTemplate(DEFAULT_REVIEW, templates?.review, repo.review);
        const wr = await this.readWranglr();
        const made = await makeReviewWorktree(reviewFolder(pr), { ...repo, name: repoName(repo) }, info.branch, io, repo.checkout ?? "worktree", wr);
        const target = spaceTarget(runner, herdrWindow().platform, p.machine, machines().map((m) => m.name), made.path, made.space, agentArgv(tpl));
        run("space.new", { name, ...target, task: reviewPrompt(pr, info, made.path, tpl) });
        if (tpl.pane !== false) this.openReviewPane(name, accountId, pr, cx);
        this.close_(cx);
        const notes = [...(st.error ? [st.error] : []), ...(made.notes?.length ? [`Note: ${made.notes.join(" ")}`] : [])];
        if (notes.length) this.reviews[pr.key] = { status: "error", error: notes.join(" ") };
        else delete this.reviews[pr.key];
      } catch (e) {
        this.reviews[pr.key] = { status: "error", error: `Review failed: ${e.message ?? e}` };
      }
      cx.notify();
    });
  }

  // Review's Pull Request pane (#30): a Wayfindr copy showing the PR, split right of the space's first terminal
  // pane. Waits up to 15 s for the space and its terminal; then quietly gives up (the user can split by hand).
  // One Wayfindr pane per space: none is added when one is there.
  openReviewPane(name, accountId, pr, cx) {
    cx.spawn(async (cx) => {
      for (const end = Date.now() + 15_000; Date.now() < end; await cx.sleep(250)) {
        const spot = reviewPaneSpot(spaces(), panes(), name);
        if (spot?.wayfindr) return;
        if (spot?.terminal) {
          run("pane.split", { pane: spot.terminal, direction: "right", mod: "wayfindr", props: { pr: { account: accountId, pr } } });
          const tab = panes().find((p) => p.pane === spot.terminal)?.tab;
          if (tab) await this.updatePanes((rec) => addPane(rec, tab, { space: name, account: accountId, pr, at: Date.now() }));
          return;
        }
      }
    });
  }

  // panes.json (#30), read-modify-write with compare-and-swap as saveCache. Best effort.
  async updatePanes(update) {
    const path = panesFile(appHome());
    for (let i = 0; i < 2; i++) {
      let cur = null;
      try { cur = await readTextFile(path); } catch { /* unreadable: start over */ }
      try { await writeTextFile(path, serializePanes(update(parsePanes(cur))), cur); return; } catch { /* stale snapshot */ }
    }
  }

  // This copy's own id (its localStorage, so a reload keeps it), registered in the shared COPIES map with
  // entries older than the window dropped.
  registerCopy() {
    let id = null;
    try { id = localStorage.getItem("wayfindr.copyId"); } catch { /* no storage */ }
    if (!id) { id = `${Date.now()}-${Math.random()}`; try { localStorage.setItem("wayfindr.copyId", id); } catch { /* no storage */ } }
    this.copyId = id;
    this.touchCopies((m) => { m[id] = Date.now(); });
  }

  touchCopies(change) {
    const now = Date.now(), cur = shared(COPIES), next = {};
    for (const [k, at] of Object.entries(cur && typeof cur === "object" ? cur : {})) if (typeof at === "number" && now - at < COPY_WINDOW_MS) next[k] = at;
    change(next);
    setShared(COPIES, next);
  }

  proplessCopies() {
    const now = Date.now(), cur = shared(COPIES);
    return Object.values(cur && typeof cur === "object" ? cur : {}).filter((at) => typeof at === "number" && now - at < COPY_WINDOW_MS).length;
  }

  // A copy started without pr or overlay props is the main copy or a Review pane that lost its props in a
  // restart; it can't tell which by itself. For 20 s it does two things each second. It reads props() again:
  // a pane on another machine can get its props after the view exists, and then it becomes that pane. And,
  // from the third second, when panes() lists a Wayfindr pane in a tab panes.json recorded and more than
  // one copy without props is registered (the main copy is one), it asks for a re-make.
  lookForOrphans(cx) {
    cx.spawn(async (cx) => {
      let rec = null;
      try { rec = parsePanes(await readTextFile(panesFile(appHome()))); } catch { /* no record: only the props re-read */ }
      const recorded = rec && Object.keys(rec.panes).length > 0;
      for (let i = 0; i < 20; i++) {
        const pp = props()?.pr;
        if (pp && typeof pp === "object" && typeof pp.account === "string" && pp.pr && typeof pp.pr.key === "string") {
          this.paneFor = { account: pp.account, pr: pp.pr };
          this.touchCopies((m) => { delete m[this.copyId]; });
          this.initPane(cx, { loop: false });
          cx.notify();
          return;
        }
        if (recorded && i >= 2 && recordedPanes(rec, panes()).length && this.proplessCopies() > 1) { setShared(ORPHAN, { n: Date.now() }); return; }
        await cx.sleep(1000);
      }
    });
  }

  // Every non-pane copy runs this; the wayfindr.remake claim lets one act per ask. It closes the Wayfindr
  // panes in recorded tabs and splits each again with its recorded props, so a re-made pane has its props
  // again. Records whose tab is gone are pruned. A second ask within 10 s of a re-make is only marked.
  remakeIfAsked(cx) {
    const o = shared(ORPHAN);
    if (!o?.n || o.n === this.orphanSeen) return;
    this.orphanSeen = o.n;
    const done = shared(REMAKE);
    if (done?.n === o.n) return;
    const me = `${Date.now()}-${Math.random()}`;
    const recent = done?.at && Date.now() - done.at < 10_000;
    setShared(REMAKE, { n: o.n, by: me, at: recent ? done.at : Date.now() });
    if (recent) return;
    cx.spawn(async (cx) => {
      await cx.sleep(150);
      if (shared(REMAKE)?.by !== me) return; // another copy claimed it
      let rec;
      try { rec = parsePanes(await readTextFile(panesFile(appHome()))); } catch { return; }
      const plan = remakePlan(rec, spaces(), panes());
      await this.updatePanes((r) => prunePanes(r, tabIdsOf(spaces())));
      // Splits first, closes last: this copy may be one of the panes it closes.
      for (const step of plan) run("pane.split", step.split);
      for (const step of plan) for (const pane of step.close) run("pane.close", { pane });
    });
  }

  titleRow(t, sum, tk) {
    const title = (tk ?? sum).title, E = this.editing?.key === sum.key ? this.editing : null;
    const b = this.profile.boards.find((x) => x.id === this.selected.boardId);
    if (E) {
      return v_flex().gap(6)
        .child(h_flex().gap(6).items_center().child(field(E.input, t, 300))
          .child(button("wf-title-save", E.status === "busy" ? "Saving…" : "Save", t, (cx) => { this.saveTitle(cx); cx.notify(); }, { on: true }))
          .child(button("wf-title-cancel", "Cancel", t, (cx) => { this.editing = null; this.typing = false; cx.notify(); })))
        .when(E.status === "error", (el) => el.child(div().text_size(12).text_color(t.blocked).child(E.error)));
    }
    return h_flex().gap(8).items_start()
      .child(div().flex_1().min_w(0).text_size(16).font_semibold().text_color(t.foreground).child(title))
      .when(Boolean(tk) && Boolean(b) && this.canUpdate(b), (el) => el.child(button("wf-title-edit", "Edit", t, (cx) => { this.startEdit(sum, title); cx.notify(); })));
  }

  commentForm(t, k) {
    const C = this.commenting?.key === k ? this.commenting : null;
    return v_flex().gap(6)
      .child(div().on_mouse_down("left", stop).rounded(6).border(1).border_color(t.input).bg(t.background).p(6).text_size(12).text_color(t.foreground)
        .child(Textarea.new(this.commentBox).w_full()))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(12).text_color(C?.status === "error" ? t.blocked : t.dim).child(C?.status === "error" ? C.error : ""))
        .child(button("wf-comment-post", C?.status === "busy" ? "Posting…" : "Post comment", t, (cx) => { this.postComment(cx); cx.notify(); }, { on: true })));
  }

  // The detail panel (D11, D23): the summary shows at once, the rest when the Ticket arrives.
  ticketPanel(t) {
    const sum = this.selected.summary;
    const entry = this.tickets[sum.key] ?? { status: "loading" };
    const tk = entry.data;
    const k = sum.key;
    const md = (id, text) => div().text_size(13).text_color(t.foreground).child(TextView.markdown(`wf-${id}-${k}`, text).selectable(true));
    // Text with its images shown in place. One not saved (yet) shows as a link.
    const pic = (url, alt) => {
      const im = this.images[url];
      if (im?.status === "ok") return div().max_w_full().rounded(6).overflow_hidden().border_1().border_color(t.border).child(image(im.file).max_w_full());
      return div().text_size(12).text_color(t.dim).child(im?.status === "error" ? `Couldn't load image: ${im.error}` : `Loading ${alt || "image"}…`);
    };
    const rich = (id, text) => {
      const parts = [];
      let at = 0, n = 0;
      for (const m of String(text).matchAll(IMAGE_MD)) {
        const before = text.slice(at, m.index);
        if (before.trim()) parts.push(md(`${id}-${n++}`, before));
        const alt = m[1].replace(/\\(.)/g, "$1");
        parts.push(this.images[m[2]] ? pic(m[2], alt) : md(`${id}-${n++}`, link(alt || "image", m[2])));
        at = m.index + m[0].length;
      }
      if (String(text).slice(at).trim() || !parts.length) parts.push(md(`${id}-${n}`, String(text).slice(at)));
      return v_flex().gap(8).children(parts);
    };
    const section = (title) => div().pt(8).text_size(11).font_semibold().text_color(t.dim).child(title.toUpperCase());
    const row = (label, value) => h_flex().gap(8).items_start().text_size(12)
      .child(div().w(84).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(t.foreground).child(value || "—"));

    const head = h_flex().h(40).px(14).gap(8).flex_none().items_center().border_b(1).border_color(t.border)
      .child(div().text_size(12).text_color(t.muted).truncate().child(`${(tk ?? sum).id} · ${(tk ?? sum).type}`))
      .child(div().flex_1())
      .when(entry.status === "loading", (el) => el.child(div().text_size(12).text_color(t.dim).child("Loading…")))
      .when(Boolean(tk), (el) => el.child(button("wf-launch", this.launch?.key === k ? "Cancel launch" : "Launch", t,
        (cx) => { if (this.launch?.key === k) this.launch = null; else this.openLaunch(tk, cx); cx.notify(); }, { on: this.launch?.key === k })))
      .child(button("wf-ticket-close", "Close", t, (cx) => { this.closeTicket(); cx.notify(); }));

    const body = v_flex().id(`wf-ticket-body-${k}`).flex_1().min_h(0).p(14).gap(10).overflow_y_scrollbar()
      .child(this.titleRow(t, sum, tk))
      .when(entry.status === "error", (el) => el.child(div().text_size(12).text_color(t.blocked).child(entry.error)))
      .when(!tk && entry.status === "loading", (el) => el.child(skeletonTicket(t)));
    const ub = this.profile.boards.find((x) => x.id === this.selected.boardId);
    if (tk && this.launch?.key === k) body.child(this.launchCard(t, tk));
    const mb = this.profile.boards.find((x) => x.id === this.selected.boardId);
    // Below "Open in browser" once the Ticket is here (the skeleton's bar holds its place), else after the error.
    const mr = mb && (tk || entry.status !== "loading") ? this.moveRow(t, mb, sum) : null;
    if (mr && !tk) body.child(mr);
    if (tk) {
      body
        .child(v_flex().gap(6)
          .child(row("Column", tk.column))
          .child(row("Assignees", tk.assignees.map((a) => a.name).join(", ")))
          .child(row("Tags", tk.tags.join(", ")))
          .child(row("Priority", tk.priority))
          .child(row("Parent", tk.parent ? `${tk.parent.id} ${tk.parent.title}` : null)))
        .when(Boolean(tk.url), (el) => el.child(md("url", link("Open in browser", tk.url))))
        .when(Boolean(mr), (el) => el.child(mr))
        .child(section(tk.descriptionLabel ?? "Description"))
        .child(tk.description.trim() ? rich("desc", tk.description) : div().text_size(12).text_color(t.dim).child("No description."))
        .when(tk.acceptanceCriteria != null, (el) => el.child(section("Acceptance criteria")).child(rich("ac", tk.acceptanceCriteria ?? "")))
        .when((tk.images ?? []).length > 0, (el) => el.child(section(`Attached images (${tk.images.length})`))
          .children(tk.images.map((im) => v_flex().gap(4).child(div().text_size(11).text_color(t.dim).child(im.name)).child(pic(im.url, im.name)))))
        .child(section(`Pull requests (${tk.pullRequests.length})`))
        .when(tk.pullRequests.length > 0, (el) => el.child(md("prs", tk.pullRequests
          .map((pr) => `- ${link(`${pr.id} ${pr.title}`, pr.url)}${pr.draft || pr.state ? ` · ${pr.draft ? "draft" : pr.state}` : ""}`).join("\n"))))
        .child(section(`Comments (${tk.comments.length + tk.moreComments})`))
        .when(Boolean(ub) && this.canUpdate(ub), (el) => el.child(this.commentForm(t, k)))
        .when(tk.moreComments > 0, (el) => el.child(md("more", link(tk.moreComments === 1 ? "1 older comment" : `${tk.moreComments} older comments`, tk.url))))
        .children(tk.comments.map((c, i) => v_flex().gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
          .child(div().text_size(11).text_color(t.dim).child(`${c.author} · ${String(c.createdAt ?? "").slice(0, 10)}`))
          .child(rich(`c${i}`, c.body))));
    }
    // Wheel events end here: the panel's own scroll area has had them, the Board under it must not.
    return v_flex().id("wf-ticket").w(PANEL_W).flex_none().h_full().bg(t.chrome).border_l(1).border_color(t.border).on_scroll_wheel(stop)
      .child(head).child(body);
  }

  body(t) {
    const s = this.state;
    if (s.status === "loading") return this.message(t, "Loading…", []);
    if (this.view === "settings" && s.status !== "invalid") return this.settingsView(t);
    if (s.status === "missing") {
      return this.message(t, "No configuration yet", [`Open Settings to add a profile, or create ${s.path} and press Refresh. A minimal file:`])
        .child(div().p(10).rounded(6).bg(t.surface).border_1().border_color(t.border).text_size(12)
          .child(TextView.markdown("wf-example", "```json\n" + EXAMPLE + "\n```").selectable(true)));
    }
    if (s.status === "invalid") return this.message(t, "The configuration has problems", [s.path, ...s.errors]);
    if (this.view === "board") return this.boardView(t);
    return this.prsView(t);
  }

  // Two sections (D6), each grouped by Account, then repo.
  prsView(t) {
    const p = this.profile, entry = this.prs ?? { status: "loading" };
    const bar = h_flex().h(40).px(16).gap(10).flex_none().items_center()
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Pull Requests"))
      .child(div().flex_1())
      .when(entry.status === "loading" || Boolean(entry.at), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim)
        .child(entry.status === "loading" ? (entry.data ? "Refreshing…" : "Loading…") : `Updated ${formatAge(Date.now() - entry.at)}`)));
    const signedOut = (id) => this.signIn?.[id]?.ok === false;
    const inert = Boolean(this.selectedPr);
    const lists = entry.data ?? [];
    const ok = lists.filter((l) => !l.error && !signedOut(l.account));
    const accounts = new Map(p.accounts.map((a) => [a.id, a]));
    const note = (text, color = t.dim) => div().text_size(12).text_color(color).child(text);
    // The key cursor and letters (D6, D7): the cursor starts on the first row. No scroll handle follows it.
    const rows = this.prListRows(), hintOf = new Map(rows.map((r) => [r.pr.key, r.hint]));
    if (rows.length && !rows.some((r) => r.pr.key === this.prCursor)) this.prCursor = rows[0].pr.key;
    const keyed = this.kb && !this.selectedPr, lettered = keyed && this.vim;
    const section = (title, field) => {
      const total = ok.reduce((n, l) => n + l[field].length, 0);
      const groups = ok.filter((l) => l[field].length > 0).flatMap((l) => {
        const a = accounts.get(l.account);
        return [
          ...(ok.length > 1 ? [div().pt(4).text_size(12).text_color(t.dim).child(`${l.account} · ${a?.login ?? a?.org ?? ""}`)] : []),
          ...byRepo(l[field]).map((g) => v_flex().rounded(8).bg(t.surface).border_1().border_color(t.border).overflow_hidden()
            .child(div().px(12).py(6).text_size(12).font_semibold().text_color(t.foreground).child(g.repo))
            .children(g.prs.map((pr) => prRow(pr, t, this.reviewActions(l.account, pr),
              { selected: this.selectedPr?.pr.key === pr.key || (keyed && this.prCursor === pr.key), inert, onClick: (cx) => this.openPr(l.account, pr, cx) },
              lettered && hintOf.has(pr.key) ? letterBadge(t, hintOf.get(pr.key), this.typed, this.prCursor === pr.key) : null)))),
          ...(l.more?.[field] ? [note(`${l.more[field]} more not shown`)] : []),
        ];
      });
      return v_flex().gap(8).child(div().text_size(12).font_semibold().text_color(t.muted).child(`${title} (${total})`))
        .children(total === 0 ? [note("None")] : groups);
    };
    const top = [
      ...p.accounts.filter((a) => signedOut(a.id)).map((a) => this.signInCard(t, a, this.signIn[a.id])),
      ...lists.filter((l) => l.error && !signedOut(l.account)).map((l) => note(`${l.account}: couldn't load Pull Requests: ${l.error}`, t.blocked)),
    ];
    const body = entry.data ? [section("Mine", "mine"), section("Needs my review", "needsReview")] : (entry.status === "loading" ? [] : [note("No Pull Requests yet.")]);
    // The list fills the view; with a Pull Request open, the scrim covers the list and the overlay
    // covers the scrim's right part. A click on the scrim closes the overlay. Fullscreen (#29): the overlay
    // alone, with no list or scrim under it.
    if (this.selectedPr && this.prFull) return div().id("wf-prs-wrap").relative().size_full().child(this.prPanel(t));
    return div().id("wf-prs-wrap").relative().size_full()
      .child(v_flex().id("wf-prs-area").size_full().min_h(0)
        .child(bar)
        .child(v_flex().id("wf-prs").flex_1().min_h(0).px(16).pb(16).gap(16).overflow_y_scrollbar().children([...top, ...body])))
      .when(Boolean(this.selectedPr), (el) => el.child(this.prScrim(t)).child(this.prPanel(t)));
  }

  // Under the overlay, over the whole list: a dimmed layer that takes every press, release, move and
  // wheel event, so nothing reaches the list under the overlay (events go to every element under the
  // pointer until one stops them; there is no occlusion to lean on). It does what the root's press does
  // (focus, a stale drag), carries the overlay's edge drag with its own width as the whole, and a click
  // on it closes the overlay. The overlay stops its own clicks so they don't count as one.
  prScrim(t) {
    return div().id("wf-pr-scrim").absolute().top(0).bottom(0).left(0).right(0).bg(t.background).opacity(0.6)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.handle.focus(); this.prDrag = null; this.railDrag = null; if (this.moveOpen) { this.moveOpen = null; cx.notify(); } })
      .on_mouse_down("right", stop)
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.prDragEnd(cx); })
      .on_mouse_move((e, cx) => { cx.stop_propagation(); this.prDragMove(e, cx); })
      .on_scroll_wheel(stop)
      .on_click((_e, cx) => { cx.stop_propagation(); this.closePr(); cx.notify(); });
  }

  // The overlay's width: the live drag value, else the remembered one, else 60%.
  get prFrac() {
    if (this.prDrag) return this.prDrag.frac;
    const v = Number(load(PR_W_KEY, PR_W_DEFAULT));
    return Number.isFinite(v) && v >= PR_W_MIN && v <= PR_W_MAX ? v : PR_W_DEFAULT;
  }

  // The rail's width in px: the live drag value, else the remembered one, else 210.
  get prRailW() {
    if (this.railDrag) return this.railDrag.w;
    const v = Number(load(PR_RAIL_KEY, PR_RAIL_DEFAULT));
    return Number.isFinite(v) && v >= PR_RAIL_MIN && v <= PR_RAIL_MAX ? v : PR_RAIL_DEFAULT;
  }

  // The left-edge drag: the press records where it started and the width then; each move turns the
  // distance into a fraction of the handling element's width (the scrim's, which is the list's; the
  // root's once the pointer leaves the list); the release keeps it. A release outside Wayfindr isn't
  // reported, so the next press clears a stale drag. The rail's right-edge drag (#24) goes through here too:
  // its width in px follows the pointer.
  prDragMove(e, cx) {
    if (this.railDrag) {
      const w = Math.round(Math.min(PR_RAIL_MAX, Math.max(PR_RAIL_MIN, this.railDrag.from + e.position.x - this.railDrag.x)));
      if (w !== this.railDrag.w) { this.railDrag.w = w; cx.notify(); }
      return;
    }
    if (!this.prDrag || !e.bounds?.width) return;
    const frac = Math.min(PR_W_MAX, Math.max(PR_W_MIN, this.prDrag.from + (this.prDrag.x - e.position.x) / e.bounds.width));
    if (frac !== this.prDrag.frac) { this.prDrag.frac = frac; cx.notify(); }
  }

  prDragEnd(cx) {
    if (this.railDrag) { save(PR_RAIL_KEY, this.railDrag.w); this.railDrag = null; cx.notify(); return; }
    if (!this.prDrag) return;
    save(PR_W_KEY, Math.round(this.prDrag.frac * 1000) / 1000);
    this.prDrag = null;
    cx.notify();
  }

  // A file's diff rows, parsed once per file object.
  rowsOf(f) {
    let parsed = diffRowsOf.get(f);
    if (!parsed) { const rows = diffRows(f.patch); parsed = { rows, longest: longestLine(rows) }; diffRowsOf.set(f, parsed); }
    return parsed;
  }

  // One review thread under its line (#25): the first comment, then the replies indented. A resolved thread
  // folds to one dim line until clicked; open, it says so and has a Fold word.
  prThread(t, k, th, site) {
    const id = String(th.id), open = Boolean(this.prThreadsOpen[k]?.has(id)), first = th.comments[0];
    const flip = (cx) => {
      const s = (this.prThreadsOpen[k] ??= new Set());
      if (s.has(id)) s.delete(id); else s.add(id);
      cx.notify();
    };
    const box = v_flex().id(`wf-pr-th-${k}-${id}`).min_w(0).ml(56).mr(10).my(3).max_w(640).px(10).py(6).gap(6).rounded(7)
      .border_1().border_color(t.border).bg(t.raised).text_size(12);
    if (th.resolved && !open) {
      return box.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => flip(cx))
        .child(div().truncate().text_size(11.5).text_color(t.dim)
          .child(`Resolved · ${first.author}: ${String(first.body ?? "").split("\n")[0]}`));
    }
    return box
      .when(Boolean(th.resolved), (el) => el.child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(`Resolved · on ${site}`))
        .child(div().id(`wf-pr-th-fold-${k}-${id}`).flex_none().text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => flip(cx)).child("Fold"))))
      .children(th.comments.map((c, i) => v_flex().min_w(0).gap(1).when(i > 0, (el) => el.pl(10).border_l_2().border_color(t.border))
        .child(div().text_size(11).font_semibold().text_color(t.muted).child(`${c.author} · ${String(c.createdAt ?? "").slice(0, 10)}`))
        .child(div().min_w(0).text_size(12).text_color(t.foreground).child(TextView.markdown(`wf-pr-th-${k}-${id}-${i}`, c.body ?? "").selectable(true)))))
      // Reply (D6): opens the comment box under the thread.
      .when(th.reply != null && this.prOpen[k]?.reply !== th.id && this.canWritePr(this.selectedPr?.account, "reply"), (el) => el
        .child(div().id(`wf-pr-th-reply-${k}-${id}`).text_size(11.5).text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.openPrBox(k, { reply: th.id }); cx.notify(); })
          .child("Reply")));
  }

  // The comment box under a row or a thread (D5, D6): the text, Save (Reply) and Cancel. Ctrl+Enter saves (Enter
  // is a new line in a markdown comment), Esc cancels.
  prBoxEl(t, k, { reply = false, busy = false, error = null, label = null } = {}) {
    return v_flex().id(`wf-pr-box-${k}`).min_w(0).ml(56).mr(10).my(4).max_w(640).gap(6)
      .when(Boolean(label), (el) => el.child(div().text_size(11).text_color(t.dim).child(label)))
      .child(div().on_mouse_down("left", stop).rounded(6).border(1).border_color(t.accent).bg(t.background).p(6).text_size(12).text_color(t.foreground)
        .on_key_down((e, cx) => { if (e.keystroke === "ctrl-enter" || e.keystroke === "cmd-enter") { cx.stop_propagation(); this.savePrBox(cx); cx.notify(); } })
        .child(Textarea.new(this.prBox).w_full()))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(error ? t.blocked : t.dim)
          .child(error ?? (reply ? "Posts at once, as the signed-in account." : "Saved on this computer until you post a review.")))
        .child(button(`wf-pr-box-cancel-${k}`, "Cancel", t, (cx) => { this.closePrBox(k); cx.notify(); }))
        .child(button(`wf-pr-box-save-${k}`, busy ? "Posting…" : reply ? "Reply" : "Save", t, (cx) => { this.savePrBox(cx); cx.notify(); }, { on: true })));
  }

  // A saved line comment under its last line (D5): "Lines a-b" on a range, the text (a click edits it), × deletes.
  prBubble(t, k, c) {
    return h_flex().id(`wf-pr-cm-${k}-${c.id}`).min_w(0).ml(56).mr(10).my(3).max_w(640).px(10).py(6).gap(8).items_start().rounded(7)
      .border_1().border_color(t.accent).bg(t.raised).text_size(12)
      .child(v_flex().id(`wf-pr-cm-edit-${k}-${c.id}`).flex_1().min_w(0).gap(2).cursor_pointer()
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          const place = { path: c.path, line: c.line, side: c.side, ...(c.startLine !== undefined ? { startLine: c.startLine, startSide: c.startSide } : {}), editId: c.id };
          this.openPrBox(k, place, c.text); cx.notify();
        })
        .when(c.startLine !== undefined, (el) => el.child(div().text_size(11).text_color(t.dim).child(`Lines ${linesOf(c)}`)))
        .child(div().min_w(0).text_color(t.foreground).child(c.text)))
      .child(div().id(`wf-pr-cm-del-${k}-${c.id}`).flex_none().px(4).rounded(4).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.deletePrComment(k, c.id, cx); cx.notify(); })
        .child("×"));
  }

  // One file's diff rows (#23) with its review threads under their lines (#25). The first DIFF_LINES rows show,
  // then a row for the rest. Rows keep the longest line's width and scroll sideways; threads keep the visible width.
  prDiff(t, k, f, threads, site) {
    const note = (text) => div().px(8).py(6).text_size(11).text_color(t.dim).child(text);
    if (f.binary) return note("Binary file");
    if (f.patch == null) return note("Diff not shown");
    const { rows, longest } = this.rowsOf(f);
    const shown = this.prAll[k]?.[f.path] ? rows : rows.slice(0, DIFF_LINES);
    const width = DIFF_GUTTER + longest * DIFF_CHAR_W, mono = settings().font_family ?? settings().font ?? "monospace";
    const row = (r) => {
      if (r.kind === "@") return div().w_full().h(20).flex_none().px(12).whitespace_nowrap().bg(t.raised).text_color(t.dim).child(r.text);
      return h_flex().w_full().h(20).flex_none().gap(10).items_center()
        .when(r.kind === "+", (el) => el.bg(tint(t.done) ?? t.surface)).when(r.kind === "-", (el) => el.bg(tint(t.blocked) ?? t.surface))
        .child(div().w(36).flex_none().text_right().text_color(t.dim).child(r.number === undefined ? "" : String(r.number)))
        .child(div().w(10).flex_none().text_color(r.kind === "+" ? t.done : t.blocked).child(r.kind === "+" ? "+" : r.kind === "-" ? "−" : ""))
        .child(div().flex_none().pr(12).whitespace_nowrap().text_color(r.kind === "" ? t.dim : t.foreground).child(r.text.replace(/\t/g, "    ")));
    };
    // Comments (#27): a numbered row takes a click (shift extends the open box); saved ones and the box sit under
    // their last line; the rows a range covers get an accent edge.
    const i = (this.prDetails[k]?.data?.files ?? []).indexOf(f);
    const writable = this.canWritePr(this.selectedPr?.account, "postReview");
    const saved = this.prComments[k]?.list ?? [], open = this.prOpen[k] ?? null, covered = coveredRows(rows, saved, f.path, open);
    const R = this.prReplying?.key === k ? this.prReplying : null;
    const items = [];
    shown.forEach((r, idx) => {
      const clickable = writable && r.kind !== "@" && r.number !== undefined;
      items.push(div().id(`wf-pr-row-${k}-${i}-${idx}`).min_w(width).flex_none().font_family(mono).text_size(11.5)
        .when(covered.has(idx), (el) => el.border_l_2().border_color(t.accent))
        .when(clickable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
          .on_mouse_down("left", stop)
          .on_click((e, cx) => { cx.stop_propagation(); this.clickPrRow(k, f, rows, idx, Boolean(e.modifiers?.shift)); cx.notify(); }))
        .child(row(r)));
      for (const th of threadsOn(threads, f.path, r)) {
        items.push(this.prThread(t, k, th, site));
        if (open?.reply != null && open.reply === th.id) items.push(this.prBoxEl(t, k, { reply: true, busy: R?.id === String(th.id) && R.status === "busy", error: R?.id === String(th.id) ? R.error ?? null : null }));
        else if (R?.id === String(th.id) && R.status === "error") items.push(div().ml(56).mr(10).max_w(640).text_size(11.5).text_color(t.blocked).child(R.error));
      }
      for (const c of commentsOn(saved, f.path, r)) if (c.id !== open?.editId) items.push(this.prBubble(t, k, c));
      if (open && open.reply == null && commentsOn([open], f.path, r).length) {
        items.push(this.prBoxEl(t, k, { label: open.startLine !== undefined ? `Lines ${linesOf(open)}` : null }));
      }
    });
    // A plain sideways scroll area with the bar drawn over it (Tourist's way): overflow_x_scrollbar sizes its
    // content to the longest row, which would make the threads as wide as it too.
    const sid = `wf-pr-diff-${k}-${i}`;
    return v_flex().w_full().min_w(0)
      .child(div().relative().w_full().min_w(0)
        .child(v_flex().id(sid).w_full().min_w(0).py(4).overflow_x_scroll().children(items))
        .child(Scrollbar.horizontal(sid).absolute().inset_0()))
      .when(shown.length < rows.length, (el) => el.child(h_flex().id(`wf-pr-more-${k}-${i}`).h(26).px(8).items_center().border_t(1).border_color(t.border)
        .cursor_pointer().text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => { (this.prAll[k] ??= {})[f.path] = true; cx.notify(); })
        .child(`Show ${rows.length - shown.length} more lines`)));
  }

  // The file rail (#24): how many files are viewed, the Overview, then code files and the tests, docs and
  // generated ones. A row shows its file; its first cell marks it viewed. The strip on its right edge resizes it.
  prRail(t, k, d, threads) {
    const files = d?.files ?? [], g = groupFiles(files), shown = this.prShown[k] ?? null;
    const marks = this.prViewed[k]?.files ?? {}, viewed = files.filter((f) => marks[barePath(f.path)]).length;
    const bare = barePath, counts = new Map();
    for (const th of threads) counts.set(bare(th.path), (counts.get(bare(th.path)) ?? 0) + 1);
    const label = (text) => div().pt(8).pb(2).px(8).text_size(11).text_color(t.dim).child(text);
    const fileRow = (f) => {
      const i = files.indexOf(f), on = shown === f.path, seen = Boolean(marks[barePath(f.path)]), n = counts.get(bare(f.path)) ?? 0;
      const slash = f.path.lastIndexOf("/"), folder = f.path.slice(0, slash + 1), name = f.path.slice(slash + 1);
      return h_flex().id(`wf-pr-rail-${k}-${i}`).h(26).flex_none().px(6).gap(6).items_center().rounded(5).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.prShown[k] = f.path; cx.notify(); })
        .child(h_flex().id(`wf-pr-rail-v-${k}-${i}`).w(14).h(20).flex_none().justify_center().items_center().rounded(3)
          .text_size(11).text_color(seen ? t.done : t.dim).hover((s) => s.bg(t.raised))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.toggleViewed(k, f.path, cx); })
          .child(seen ? "✓" : FILE_STATUS[f.status] ?? "?"))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(12)
          // The folder gives way first; a long name is cut after it.
          .child(div().min_w(0).flex_shrink(100).truncate().text_color(t.dim).child(folder))
          .child(div().min_w(0).truncate().text_color(seen ? t.dim : t.foreground).child(name)))
        .child(h_flex().flex_none().gap(4).text_size(11)
          .child(div().text_color(t.done).child(`+${f.additions ?? 0}`))
          .child(div().text_color(t.blocked).child(`−${f.deletions ?? 0}`)))
        .when(n > 0, (el) => el.child(h_flex().h(16).min_w(16).px(4).flex_none().justify_center().items_center().rounded(8)
          .bg(t.accent).text_size(10).text_color(t.background).child(String(n))));
    };
    const top = d ? (viewed === files.length && files.length ? `All ${files.length} viewed` : `${viewed} of ${files.length} viewed`) : "";
    const overview = h_flex().id(`wf-pr-rail-o-${k}`).h(26).flex_none().px(8).items_center().rounded(5).cursor_pointer()
      .text_size(12).text_color(t.foreground).when(shown == null, (el) => el.bg(t.selected)).when(shown != null, (el) => el.hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.prShown[k] = null; cx.notify(); })
      .child("Overview");
    const strip = div().id("wf-pr-rail-grip").absolute().top(0).bottom(0).right(0).w(6).cursor_col_resize()
      .hover((s) => s.bg(t.accent)).when(Boolean(this.railDrag), (el) => el.bg(t.accent))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.railDrag = { x: e.position.x, from: this.prRailW, w: this.prRailW }; cx.notify(); });
    return div().id(`wf-pr-rail-${k}`).relative().flex_none().w(this.prRailW).h_full().border_r(1).border_color(t.border)
      .child(v_flex().id(`wf-pr-rail-list-${k}`).size_full().p(6).gap(1).overflow_y_scrollbar()
        .child(div().px(8).pb(4).text_size(11).text_color(t.dim).child(top))
        .child(overview)
        .when(g.code.length > 0, (el) => el.child(label("Code")).children(g.code.map(fileRow)))
        .when(g.side.length > 0, (el) => el.child(label("Tests, docs and generated")).children(g.side.map(fileRow))))
      .child(strip);
  }

  // The Post review screen (D7), in the content column: who posts, the saved comments, the verdict, the summary,
  // then Post with a confirm line in its place. Nothing leaves this computer until Yes.
  prReviewScreen(t, k, d, cur, body, site) {
    const list = this.prComments[k]?.list ?? [], me = d?.me?.name ?? "the signed-in account";
    const mine = Boolean(d?.me && d.author?.id === d.me.id), verdicts = verdictsFor(mine);
    const event = verdicts.some((v) => v.event === this.prVerdict[k]) ? this.prVerdict[k] : "comment";
    const P = this.prPosting?.key === k ? this.prPosting : null, ready = Boolean(d) && canPost(list, event, this.prSummary.value());
    const mono = settings().font_family ?? settings().font ?? "monospace";
    const section = (title) => div().pt(8).text_size(11).font_semibold().text_color(t.dim).child(title.toUpperCase());
    body
      .child(h_flex().gap(8).items_baseline()
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child(`Post review on ${cur.id}`))
        .child(div().text_size(12).text_color(t.dim).child(`posting as ${me}`)))
      .child(section(`Comments (${list.length})`))
      .when(list.length === 0, (el) => el.child(div().text_size(12).text_color(t.dim).child("No line comments. Click a line in a file to add one.")))
      .children(list.map((c) => v_flex().id(`wf-pr-rv-c-${k}-${c.id}`).gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(div().font_family(mono).text_size(11.5).text_color(t.dim).truncate().child(`${c.path}:${linesOf(c)}`))
        .when(Boolean(c.code), (el) => el.child(div().font_family(mono).text_size(11.5).text_color(t.muted).truncate().child(c.code.replace(/\t/g, "    "))))
        .child(div().text_size(12).text_color(t.foreground).child(c.text))))
      .child(section("Verdict"))
      .children(verdicts.map((v) => {
        const on = v.event === event;
        return h_flex().id(`wf-pr-rv-v-${k}-${v.event}`).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer()
          .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
          .on_mouse_down("left", stop).on_click((_e, cx) => { this.prVerdict[k] = v.event; this.prConfirm = null; cx.notify(); })
          .child(div().w(12).flex_none().text_size(12).text_color(on ? t.accent : t.dim).child(on ? "●" : "○"))
          .child(div().w(120).flex_none().text_size(12).text_color(t.foreground).child(v.label))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(v.hint));
      }))
      .when(mine, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("This is your own Pull Request, so the verdict is Comment.")))
      .child(section("Summary"))
      .child(div().on_mouse_down("left", stop).rounded(6).border(1).border_color(t.input).bg(t.background).p(6).text_size(12).text_color(t.foreground)
        .child(Textarea.new(this.prSummary).w_full()));
    const label = verdictLabel(event);
    if (P?.status === "busy") body.child(div().text_size(12).text_color(t.dim).child("Posting…"));
    else if (this.prConfirm === k) {
      body.child(v_flex().gap(8).p(10).rounded(8).border_1().border_color(t.accent).bg(t.raised)
        .child(div().text_size(12).text_color(t.foreground).child(confirmText(event, cur.id, me, list.length)))
        .child(h_flex().gap(8)
          .child(button("wf-pr-rv-yes", "Yes", t, (cx) => { this.sendPrReview(cx); cx.notify(); }, { on: true }))
          .child(button("wf-pr-rv-no", "No", t, (cx) => { this.prConfirm = null; cx.notify(); }))));
    } else {
      body.child(h_flex().gap(8).items_center()
        .child(ready
          ? button("wf-pr-rv-post", `Post as ${label}`, t, (cx) => { this.prConfirm = k; if (this.prPosting?.key === k) this.prPosting = null; cx.notify(); }, { on: true })
          : h_flex().h(26).px(10).flex_none().items_center().rounded(6).text_size(12).text_color(t.dim).bg(t.background).child(`Post as ${label}`))
        .child(button("wf-pr-rv-back", "Back", t, (cx) => { this.prShown[k] = null; this.prConfirm = null; cx.notify(); }))
        .when(!ready, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Add a comment, choose Approve, or write a summary first."))));
    }
    if (P?.status === "done") body.child(div().text_size(12).text_color(t.foreground).child(TextView.markdown(`wf-pr-rv-done-${k}`, `Posted. ${link(`Open on ${site}`, P.url)}`)));
    if (P?.status === "error") body.child(div().text_size(12).text_color(t.blocked).child(P.error));
  }

  // The Pull Request overlay: a header, then the file rail and the content column (#24). The content is the
  // Overview (the summary, description, files line and comments) or one file's diff with its threads.
  // The Pull Request's header, rail and content column (#30): inside the overlay, or the whole of a pane copy.
  // A pane has no Review, Close or fullscreen: the space is the Review and Herdr's pane header closes it.
  prContent(t) {
    const sel = this.selectedPr, pr = sel.pr, k = pr.key, pane = Boolean(this.paneFor);
    const entry = this.prDetails[k] ?? { status: "loading" };
    const d = entry.data, cur = d ?? pr;
    const md = (id, text) => div().text_size(13).text_color(t.foreground).child(TextView.markdown(`wf-pr-${id}-${k}`, text).selectable(true));
    const section = (title) => div().pt(8).text_size(11).font_semibold().text_color(t.dim).child(title.toUpperCase());
    const note = (text) => div().text_size(12).text_color(t.dim).child(text);
    const row = (label, value) => h_flex().gap(8).items_start().text_size(12)
      .child(div().w(84).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(t.foreground).child(value || "—"));
    const date = (s) => String(s ?? "").slice(0, 10);
    const review = this.reviewActions(sel.account, pr), rv = review.state;
    const site = PR_SITE[this.profile?.accounts.find((a) => a.id === sel.account)?.provider] ?? "the API";
    const badge = checksBadge(d?.checks);
    const writable = this.canWritePr(sel.account, "postReview"), saved = this.prComments[k]?.list ?? [];

    const head = h_flex().h(40).px(14).gap(8).flex_none().items_center().border_b(1).border_color(t.border)
      .child(div().min_w(0).text_size(12).text_color(t.muted).truncate().child([cur.id, cur.repo, cur.state].filter(Boolean).join(" · ")))
      // The checks badge: a click shows the Overview, where the Checks section is.
      .when(Boolean(badge), (el) => el.child(div().id("wf-pr-checks-badge").flex_none().px(6).rounded(9).text_size(11).cursor_pointer()
        .text_color(checkColor(badge.state, t)).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.prShown[k] = null; cx.notify(); })
        .child(badge.text)))
      .when(Boolean(cur.draft), (el) => el.child(h_flex().h(18).px(6).flex_none().items_center().rounded(9).bg(t.selected).text_size(11).text_color(t.muted).child("Draft")))
      .child(div().flex_1())
      .when(entry.status === "loading", (el) => el.child(div().text_size(12).text_color(t.dim).child(d ? "Refreshing…" : "Loading…")))
      // Post review (#27): the saved comments, a verdict and a summary, posted as one review.
      .when(writable, (el) => el.child(button("wf-pr-post-review", `Post review (${saved.length})`, t,
        (cx) => { this.prShown[k] = REVIEW_SCREEN; cx.notify(); }, { on: this.prShown[k] === REVIEW_SCREEN })))
      .when(!pane, (el) => el
        .child(button("wf-pr-panel-review", rv?.status === "busy" ? (rv.message ?? "Starting…") : "Review", t,
          (cx) => review.start(cx), { on: rv?.status === "busy" }))
        .child(iconButton("wf-pr-full", this.prFull ? "exit-fullscreen" : "fullscreen", t, (cx) => { this.toggleFull(); cx.notify(); }))
        .child(button("wf-pr-close", "Close", t, (cx) => { this.closePr(); cx.notify(); })));

    const files = d?.files ?? [], threads = d?.threads ?? [];
    const shownPath = this.prShown[k] ?? null, f = shownPath == null ? null : files.find((x) => x.path === shownPath) ?? null;
    const reviewing = shownPath === REVIEW_SCREEN && writable;
    const body = v_flex().id(`wf-pr-body-${k}-${f ? files.indexOf(f) : reviewing ? "r" : "o"}`).flex_1().min_w(0).min_h(0).p(14).gap(10).overflow_y_scrollbar();
    if (f) {
      const seen = Boolean(this.prViewed[k]?.files[barePath(f.path)]);
      body
        .child(h_flex().gap(8).items_center()
          .child(div().w(12).flex_none().text_size(11).text_color(t.dim).child(FILE_STATUS[f.status] ?? "?"))
          .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground)
            .child(f.status === "renamed" && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path))
          .child(h_flex().flex_none().gap(6).text_size(11)
            .child(div().text_color(t.done).child(`+${f.additions ?? 0}`))
            .child(div().text_color(t.blocked).child(`−${f.deletions ?? 0}`)))
          .child(button("wf-pr-viewed", seen ? "Viewed" : "Unviewed", t, (cx) => this.toggleViewed(k, f.path, cx), { on: seen })))
        .when(writable, (el) => el.child(div().text_size(11).text_color(t.dim)
          .child(`click a line to comment, shift-click to extend (${saved.filter((c) => barePath(c.path) === barePath(f.path)).length} saved)`)))
        .child(v_flex().min_w(0).rounded(6).bg(t.surface).border_1().border_color(t.border).overflow_hidden().child(this.prDiff(t, k, f, threads, site)));
    } else if (reviewing) {
      this.prReviewScreen(t, k, d, cur, body, site);
    } else {
      body
        .child(div().text_size(16).font_semibold().text_color(t.foreground).child(cur.title))
        .when(entry.status === "error", (el) => el.child(div().text_size(12).text_color(t.blocked).child(entry.error)))
        .when(rv?.status === "error", (el) => el.child(div().text_size(12).text_color(t.blocked).child(rv.error)))
        .when(!d && entry.status === "loading", (el) => el.child(skeletonPr(t)));
    }
    if (d && !f && !reviewing) {
      const general = (d.comments ?? []).filter((c) => !c.path);
      const checks = [...(d.checks?.list ?? [])].sort((a, b) => (CHECK_ORDER[a.state] ?? 4) - (CHECK_ORDER[b.state] ?? 4));
      const unplaced = unplacedThreads(threads, files, (x) => (x.binary || x.patch == null ? [] : this.rowsOf(x).rows));
      const adds = files.reduce((n, x) => n + (x.additions ?? 0), 0), dels = files.reduce((n, x) => n + (x.deletions ?? 0), 0);
      const summary = [`${files.length} ${files.length === 1 ? "file" : "files"} · +${adds} −${dels}`,
        ...(d.moreFiles ? [`${d.moreFiles} more not shown`] : []), ...(d.truncated ? ["Some diffs were cut"] : []),
        ...(d.source?.kind === "clone" ? [`diffs from ${d.source.path}`] : [])].join(" · ");
      const card = (id, c, where) => v_flex().id(id).gap(4).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).child(`${c.author} · ${date(c.createdAt)}${where ? ` · ${where}` : ""}`))
        .child(div().text_size(13).text_color(t.foreground).child(TextView.markdown(`${id}-md`, c.body ?? "").selectable(true)));
      body
        .child(v_flex().gap(6)
          .child(row("Author", d.author?.name))
          .child(row("Branch", d.branch ? `${d.branch} → ${d.target ?? "?"}` : null))
          .child(row("Reviewers", (d.reviewers ?? []).map((r) => `${r.name} (${r.state})`).join(", ")))
          .child(row("Opened", date(d.createdAt)))
          .child(row("Updated", date(d.updatedAt))))
        .when(Boolean(d.url), (el) => el.child(md("url", link("Open in browser", d.url))))
        .child(section("Description"))
        .child(String(d.description ?? "").trim() ? md("desc", d.description) : note("No description."))
        .child(section("Files"))
        .child(note(summary))
        .when(Boolean(d.gitError), (el) => el.child(note(`Diffs from ${site}: ${String(d.gitError).split("\n")[0]}`)))
        .child(section("Checks"))
        .when(checks.length === 0, (el) => el.child(note("No checks reported")))
        .children(checks.map((c, i) => h_flex().id(`wf-pr-check-${k}-${i}`).h(24).gap(8).items_center().min_w(0).text_size(12)
          .when(Boolean(c.url), (r) => r.cursor_pointer().hover((s) => s.bg(t.hover))
            .on_mouse_down("left", stop).on_click((_e, cx) => cx.open_url(c.url)))
          .child(div().w(12).flex_none().text_color(checkColor(c.state, t)).child(CHECK_MARK[c.state] ?? "?"))
          .child(div().flex_none().max_w(320).truncate().text_color(t.foreground).child(c.group ? `${c.group} / ${c.name}` : c.name))
          .when(Boolean(c.description), (r) => r.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(c.description)))))
        .child(section(`Comments (${general.length + (d.moreComments ?? 0)})`))
        .children(general.map((c, i) => card(`wf-pr-c-${k}-${i}`, c, null)))
        // Threads no diff row takes: on no line, outdated, or on a file or line the diff doesn't show.
        .children(unplaced.flatMap((th) => th.comments.map((c, i) => card(`wf-pr-u-${k}-${th.id}-${i}`, c, `${th.path}${th.line != null ? `:${th.line}` : ""}`))));
    }
    return v_flex().id("wf-pr-content").size_full().min_h(0).bg(t.chrome)
      .child(head)
      .when(!pane && rv?.status === "choose", (el) => el.child(div().px(14).py(8).flex_none().border_b(1).border_color(t.border)
        .child(cloneChooser("wf-pr-panel-choose", review, t))))
      .child(h_flex().id(`wf-pr-main-${k}`).flex_1().min_h(0).items_stretch()
        .child(this.prRail(t, k, d, threads))
        .child(body));
  }

  // The overlay: prContent over the list, against the right edge, 60% wide to start; the strip on its left
  // edge resizes it.
  prPanel(t) {
    const grip = div().id("wf-pr-grip").absolute().top(0).bottom(0).left(0).w(6).cursor_col_resize()
      .hover((s) => s.bg(t.accent)).when(Boolean(this.prDrag), (el) => el.bg(t.accent))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.prDrag = { x: e.position.x, from: this.prFrac, frac: this.prFrac }; cx.notify(); });
    // Wheel events end here: the body has had them, the list under the overlay must not. Clicks end
    // here too: the scrim under the overlay closes it on a click of its own.
    // Fullscreen (#29): the whole width, no edge and no grip.
    return v_flex().id("wf-pr-panel").absolute().top(0).bottom(0).right(0)
      .when(this.prFull, (el) => el.w_full()).when(!this.prFull, (el) => el.w(`${Math.round(this.prFrac * 1000) / 10}%`).border_l(1).border_color(t.border))
      .bg(t.chrome).shadow_lg().on_scroll_wheel(stop).on_click(stop)
      .child(this.prContent(t))
      .when(!this.prFull, (el) => el.child(grip));
  }

  render(cx) {
    if (this.passing) return div();
    if (this.hidden && !this.paneFor) this.watch(cx); // just shown: refresh in the background
    if (!this.paneFor) { this.takeRequest(cx); this.remakeIfAsked(cx); }
    const t = theme();
    const pane = Boolean(this.paneFor);
    // The handle still answers "focused" in the render after a press elsewhere or a close, so `gone` says so (D9).
    this.kb = (this.handle.is_focused() && !this.gone) || Boolean(this.typing);
    if (this.kb) this.heldAt = Date.now();
    const root = v_flex().id("wf-root").size_full().bg(t.background).border_1().border_color(this.kb ? t.accent : t.border)
      .track_focus(this.handle)
      // A press anywhere in Wayfindr closes the Move dropdown; its trigger and list stop their own.
      .on_mouse_down("left", (_e, cx) => { this.handle.focus(); this.gone = false; this.prDrag = null; this.railDrag = null; if (this.moveOpen) { this.moveOpen = null; } cx.notify(); })
      // The Pull Request overlay's edge drag: moves over Wayfindr resize it, the release keeps it.
      .on_mouse_move((e, cx) => this.prDragMove(e, cx))
      .on_mouse_up("left", (_e, cx) => this.prDragEnd(cx))
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_size_change((size) => { this.height = size.height; })
      // A press outside: the keyboard has gone, so no letters, legend or accent border (not in the pane copy).
      .when(!pane, (el) => el.on_mouse_down_out((_e, cx) => { if (!this.gone) { this.gone = true; this.help = false; this.typed = ""; cx.notify(); } }));
    const footer = this.kb ? this.keysFooter(t) : null;
    // The pane copy (#30): only the Pull Request, at full size. A config that won't load says so instead.
    if (pane) {
      const s = this.state;
      if (s.status === "missing") return root.child(this.message(t, "No configuration yet", [`Open Wayfindr's Settings to add a profile (${s.path}).`]));
      if (s.status === "invalid") return root.child(this.message(t, "The configuration has problems", [s.path, ...s.errors]));
      return root.child(v_flex().id("wf-pane-body").flex_1().min_h(0).child(this.prContent(t))).when(Boolean(footer), (el) => el.child(footer));
    }
    return root
      .child(this.header(t))
      .child(v_flex().id("wf-body").flex_1().min_h(0).child(this.body(t)))
      .when(Boolean(footer), (el) => el.child(footer));
  }
}
