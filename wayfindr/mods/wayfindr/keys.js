// Wayfindr's keys, as CodeyPacker's mods and Dockr have them: what a keystroke does in each layer, and
// what the legend and the "?" list say. One function decides both, so the legend never names a key
// that does nothing. No Herdr calls here.
//
// Layers: "board", "ticket" (the detail panel open), "move" (the Move list open), "launch" (the Launch
// card open), "prs" (the Pull Request list), "pr" (the overlay or the pane copy), "review" (the Post review
// screen), "confirm" (the Post confirm), "help" (the "?" list), "settings".
// Facts, all booleans: url, canLaunch, canReview, canUpdate, canMove, canComment, canPost, pane, full,
// hasFile (a file is shown, not the Overview), hasRows, vim. In "pr", f is "full" (the overlay) or "zoom" (the pane copy). In "review", canPost means the review is ready to post.
// `nextProfile` is a string, the Profile that P switches to, or null with one Profile. `vim` is the "vimKeys" setting (D13). Off, only the keys Wayfindr had before work: arrows, home, end, enter,
// esc, shift-left/right, ctrl-n/ctrl-p, and v/p/f in the overlay, plus ctrl-r (refresh) and ctrl-d/ctrl-u (half a page).
// No letters, q, g/G, ? or letter jumps.

/** The letters the "prs" layer's own keys use, so no Pull Request row gets one as its hint. */
export const RESERVED = "jkghlsoyqnv";

const NAV = {
  j: "next", down: "next", "ctrl-n": "next",
  k: "prev", up: "prev", "ctrl-p": "prev",
  g: "first", home: "first",
  "shift-g": "last", end: "last",
  "ctrl-d": "halfDown", "ctrl-u": "halfUp",
};
const HELP = new Set(["?", "shift-/"]);
const PLAIN = new Set(["up", "down", "left", "right", "home", "end", "enter", "escape", "shift-left", "shift-right", "ctrl-n", "ctrl-p", "ctrl-r", "ctrl-d", "ctrl-u"]);
const LAYERS = ["board", "ticket", "move", "launch", "prs", "pr", "review", "confirm", "help", "settings"];

const act = (action, arg) => (arg === undefined ? { action } : { action, arg });
const when = (ok, action) => (ok ? act(action) : null);

/**
 * What keystroke `k` does in `layer`: { action, arg? }, or null when it does nothing there.
 * `k` is the keystroke as Herdr gives it ("j", "shift-g", "shift-/", "ctrl-n", "down", "enter", "escape").
 * A modifier makes another key: "ctrl-left" is not "left".
 * @param {string} layer
 * @param {string} k
 * @param {Record<string, boolean>} [facts]
 * @returns {{ action: string, arg?: string } | null}
 */
export function keyAction(layer, k, facts = {}) {
  const f = facts ?? {};
  if (!f.vim && !PLAIN.has(k) && !(layer === "pr" && (k === "v" || k === "p" || k === "f"))) return null;
  if (layer === "help") return HELP.has(k) || k === "q" || k === "escape" ? act("hide") : null;
  if (layer === "settings") return k === "q" || k === "escape" ? act("back") : null;
  if (HELP.has(k)) return LAYERS.includes(layer) ? act("help") : null;
  if (layer === "confirm") {
    if (k === "y") return act("yes");
    if (k === "n" || k === "q" || k === "escape") return act("no");
    return null;
  }
  if (layer === "launch") {
    if (k === "enter") return act("start");
    if (k === "q" || k === "escape") return act("close");
    return null;
  }
  if (layer === "move") {
    if (NAV[k]) return act(NAV[k]);
    if (k === "enter") return act("pick");
    if (k === "q" || k === "escape") return act("close");
    return null;
  }
  if (layer === "review") {
    if (k === "p" || k === "enter") return when(f.canPost, "ask");
    if (k === "q" || k === "escape") return act("back");
    if (NAV[k]) return act(NAV[k]);
    if (k === "ctrl-r") return act("refresh");
    return null;
  }
  if (layer === "pr") {
    if (NAV[k]) return act(NAV[k]);
    if (k === "v") return when(f.hasFile, "viewed");
    if (k === "c") return act("checks");
    if (k === "p") return when(f.canPost, "post");
    if (k === "f") return act(f.pane ? "zoom" : "full"); // the pane copy: Herdr's pane zoom is its fullscreen
    if (k === "o") return when(f.url, "browser");
    if (k === "y") return when(f.url, "copy");
    if (k === "s") return when(f.canReview && !f.pane, "review");
    if (k === "ctrl-r") return act("refresh");
    if (k === "q" || k === "escape") return when(!f.pane, "close");
    return null;
  }
  if (layer === "prs") {
    if (NAV[k] || k === "enter") return when(f.hasRows, NAV[k] ?? "open");
    if (k === "o") return when(f.url, "browser");
    if (k === "y") return when(f.url, "copy");
    if (k === "s") return when(f.canReview, "review");
    if (k === "tab" || k === "v" || k === "shift-v") return act("toggleView");
    if (k === "shift-p") return when(Boolean(f.nextProfile), "profile");
    if (k === ",") return act("settings");
    if (k === "ctrl-r") return act("refresh");
    if (k === "q" || k === "escape") return act("close");
    if (/^[a-z]$/.test(k) && !RESERVED.includes(k)) return when(f.hasRows, "letter");
    return null;
  }
  if (layer === "board" || layer === "ticket") {
    if (NAV[k] || k === "enter") return when(f.hasRows, NAV[k] ?? "open");
    if (k === "h" || k === "left") return when(f.hasRows, "colPrev");
    if (k === "l" || k === "right") return when(f.hasRows, "colNext");
    if (k === "shift-h" || k === "shift-left") return when(f.canMove, "moveLeft");
    if (k === "shift-l" || k === "shift-right") return when(f.canMove, "moveRight");
    if (k === "o") return when(f.url, "browser");
    if (k === "y") return when(f.url, "copy");
    if (k === "s") return when(f.canLaunch, "launch");
    if (k === "tab" || k === "v" || k === "shift-v") return act("toggleView");
    if (k === "shift-p") return when(Boolean(f.nextProfile), "profile");
    if (k === ",") return act("settings");
    if (k === "ctrl-r") return act("refresh");
    if (k === "q" || k === "escape") return act("close");
    if (layer === "ticket") {
      if (k === "c") return when(f.canComment, "comment");
      if (k === "e") return when(f.canUpdate, "edit");
      if (k === "m") return when(f.canMove, "move");
    }
    return null;
  }
  return null;
}

/** The keystroke a hint's label stands for, where the label is not itself one. */
export const HINT_KEYS = { "j/k": "j", "g/G": "g", "h/l": "h", "H/L": "shift-h", P: "shift-p", "a letter": "a", "?": "?",
  "up/down": "down", "left/right": "left", "home/end": "home", "shift-left/right": "shift-left", esc: "escape", "ctrl-d/u": "ctrl-d" };
// The labels the legend uses with vim off. With it on, j/k, h/l, g/G, H/L and q say the same.
const PLAIN_LABELS = new Set(["up/down", "left/right", "home/end", "shift-left/right", "esc"]);

// Every hint each layer can show, in order: [label, what]. keyHints keeps the ones whose key does something.
const ALL = {
  board: [["up/down", "card"], ["left/right", "column"], ["home/end", "first / last"], ["shift-left/right", "move card"], ["esc", "close"],
    ["j/k", "card"], ["h/l", "column"], ["g/G", "first / last"], ["ctrl-d/u", "half a page"], ["enter", "open"], ["H/L", "move card"],
    ["s", "launch"], ["o", "browser"], ["y", "copy URL"], ["v", "Pull Requests"], ["tab", "Pull Requests"], ["P", "profile"], [",", "Settings"], ["ctrl-r", "refresh"], ["q", "close"]],
  ticket: [["up/down", "card"], ["left/right", "column"], ["home/end", "first / last"], ["shift-left/right", "move card"], ["esc", "close"],
    ["j/k", "card"], ["h/l", "column"], ["g/G", "first / last"], ["ctrl-d/u", "half a page"], ["enter", "open"], ["H/L", "move card"],
    ["c", "comment"], ["e", "edit title"], ["m", "move to"], ["s", "launch"], ["o", "browser"], ["y", "copy URL"],
    ["v", "Pull Requests"], ["tab", "Pull Requests"], ["P", "profile"], [",", "Settings"], ["ctrl-r", "refresh"], ["q", "close"]],
  move: [["up/down", "column"], ["esc", "close"], ["j/k", "column"], ["g/G", "first / last"], ["ctrl-d/u", "half a page"], ["enter", "move here"], ["q", "close"]],
  launch: [["enter", "launch"], ["esc", "close"], ["q", "close"]],
  prs: [["up/down", "move"], ["home/end", "first / last"], ["esc", "close"], ["j/k", "move"], ["a letter", "open that row"], ["g/G", "first / last"], ["ctrl-d/u", "half a page"], ["enter", "open"], ["s", "review"],
    ["o", "browser"], ["y", "copy URL"], ["v", "Board"], ["tab", "Board"], ["P", "profile"], [",", "Settings"], ["ctrl-r", "refresh"], ["q", "close"]],
  pr: [["up/down", "file"], ["home/end", "Overview / last file"], ["esc", "close"], ["j/k", "file"], ["g/G", "Overview / last file"], ["ctrl-d/u", "half a page"], ["v", "viewed"], ["c", "checks"], ["p", "post review"],
    ["s", "review"], ["f", "fullscreen"], ["o", "browser"], ["y", "copy URL"], ["ctrl-r", "refetch"], ["q", "close"]],
  review: [["up/down", "file"], ["esc", "back"], ["p", "post"], ["enter", "post"], ["j/k", "file"], ["ctrl-d/u", "half a page"], ["ctrl-r", "refetch"], ["q", "back"]],
  confirm: [["esc", "no"], ["y", "yes, post"], ["n", "no"], ["q", "no"]],
  help: [["esc", "hide this list"], ["?", "hide this list"], ["q", "hide this list"]],
  settings: [["esc", "back"], ["q", "back"]],
};

// The few each layer's legend shows with vim off.
const CORE_PLAIN = {
  board: ["left/right", "up/down", "enter", "esc"],
  ticket: ["up/down", "enter", "esc"],
  move: ["up/down", "enter", "esc"],
  launch: ["enter", "esc"],
  prs: ["up/down", "enter", "esc"],
  pr: ["up/down", "v", "p", "esc"],
  review: ["enter", "esc"],
  confirm: ["esc"],
  help: ["esc"],
  settings: ["esc"],
};

// The few each layer's legend shows with vim on.
const CORE = {
  board: ["h/l", "j/k", "enter", "s", "P", "q"],
  ticket: ["j/k", "c", "s", "m", "q"],
  move: ["j/k", "enter", "q"],
  launch: ["enter", "q"],
  prs: ["j/k", "a letter", "enter", "s", "P", "q"],
  pr: ["j/k", "v", "p", "s", "q"],
  review: ["p", "q"],
  confirm: ["y", "n"],
  help: ["q"],
  settings: ["q"],
};

const works = (layer, label, facts) => keyAction(layer, HINT_KEYS[label] ?? label, facts) != null;

/**
 * Every key that does something in `layer` now: [label, what] pairs, plus "?" when it works there.
 * @param {string} layer
 * @param {Record<string, boolean>} [facts]
 * @returns {[string, string][]}
 */
export function keyHints(layer, facts = {}) {
  const vim = Boolean(facts?.vim);
  const out = (ALL[layer] ?? []).filter(([label]) => (vim ? !PLAIN_LABELS.has(label) : true) && works(layer, label, facts))
    .map(([label, what]) => (label === "P" && typeof facts?.nextProfile === "string" ? [label, facts.nextProfile] : [label, what]));
  // esc closes, so it goes last, as q does.
  out.sort((x, y) => (x[0] === "esc") - (y[0] === "esc"));
  if (layer !== "help" && works(layer, "?", facts)) out.push(["?", "all keys"]);
  return out;
}

/**
 * The legend's few keys for `layer`, then "?" when it works there.
 * @param {string} layer
 * @param {Record<string, boolean>} [facts]
 * @returns {[string, string][]}
 */
export function coreHints(layer, facts = {}) {
  const core = new Set((facts?.vim ? CORE : CORE_PLAIN)[layer] ?? []);
  const seen = new Set();
  const out = keyHints(layer, facts).filter(([label]) => core.has(label) && label !== "?" && !seen.has(label) && seen.add(label));
  if (layer !== "help" && works(layer, "?", facts)) out.push(["?", "all keys"]);
  return out;
}
