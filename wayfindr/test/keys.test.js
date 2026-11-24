import { test } from "node:test";
import assert from "node:assert/strict";
import { keyAction, keyHints, coreHints, HINT_KEYS, RESERVED } from "../mods/wayfindr/keys.js";

const ALL_FACTS = { nextProfile: "work", url: true, canLaunch: true, canReview: true, canUpdate: true, canMove: true, canComment: true, canPost: true, hasFile: true, hasRows: true, pane: false, full: false, vim: true };
const PLAIN = { ...ALL_FACTS, vim: false };
const NONE = {};
const LAYERS = ["board", "ticket", "move", "launch", "prs", "pr", "review", "confirm", "help", "settings"];
const a = (layer, k, facts = ALL_FACTS) => keyAction(layer, k, facts)?.action ?? null;

test("shared movement: j/k, arrows, ctrl-n/ctrl-p, g/G, ctrl-d/ctrl-u, enter, ctrl-r, q, ?", () => {
  for (const layer of ["board", "ticket", "prs"]) {
    for (const k of ["j", "down", "ctrl-n"]) assert.equal(a(layer, k), "next", `${layer} ${k}`);
    for (const k of ["k", "up", "ctrl-p"]) assert.equal(a(layer, k), "prev", `${layer} ${k}`);
    assert.equal(a(layer, "g"), "first");
    assert.equal(a(layer, "shift-g"), "last");
    assert.equal(a(layer, "enter"), "open");
    assert.equal(a(layer, "ctrl-d"), "halfDown");
    assert.equal(a(layer, "ctrl-u"), "halfUp");
    assert.equal(a(layer, "ctrl-r"), "refresh");
    assert.equal(a(layer, "r"), layer === "prs" ? "letter" : null);
    assert.equal(a(layer, "q"), "close");
    assert.equal(a(layer, "?"), "help");
    assert.equal(a(layer, "shift-/"), "help");
  }
});

test("modifiers make another key: ctrl-left is not left, ctrl-j is not j", () => {
  assert.equal(a("board", "left"), "colPrev");
  assert.equal(a("board", "ctrl-left"), null);
  assert.equal(a("board", "alt-right"), null);
  assert.equal(a("board", "ctrl-j"), null);
  assert.equal(a("prs", "ctrl-a"), null);
  assert.equal(a("prs", "shift-a"), null);
  assert.equal(a("pr", "ctrl-v"), null);
});

test("board: columns, moving a card, browser, copy, launch, views", () => {
  assert.equal(a("board", "h"), "colPrev");
  assert.equal(a("board", "l"), "colNext");
  assert.equal(a("board", "right"), "colNext");
  for (const k of ["shift-h", "shift-left"]) assert.equal(a("board", k), "moveLeft");
  for (const k of ["shift-l", "shift-right"]) assert.equal(a("board", k), "moveRight");
  assert.equal(a("board", "shift-left", { ...ALL_FACTS, canMove: false }), null);
  assert.equal(a("board", "o"), "browser");
  assert.equal(a("board", "y"), "copy");
  assert.equal(a("board", "o", { ...ALL_FACTS, url: false }), null);
  assert.equal(a("board", "a"), "launch");
  assert.equal(a("board", "a", { ...ALL_FACTS, canLaunch: false }), null);
  assert.equal(a("board", "tab"), "toggleView");
  assert.equal(a("board", "]"), "toggleView");
  assert.equal(a("board", "["), "toggleView");
  assert.equal(a("ticket", "]"), "toggleView");
  assert.equal(a("board", "shift-p"), "profile");
  assert.equal(a("board", "shift-p", { ...ALL_FACTS, nextProfile: null }), null);
  assert.equal(a("board", "b"), null);
  assert.equal(a("board", ","), "settings");
  assert.equal(a("board", "c"), null); // the comment box is the detail panel's
  assert.equal(a("board", "j", NONE), null); // no cards
});

test("ticket: the Board's keys plus comment, edit and Move", () => {
  assert.equal(a("ticket", "h"), "colPrev");
  assert.equal(a("ticket", "a"), "launch");
  assert.equal(a("ticket", "c"), "comment");
  assert.equal(a("ticket", "e"), "edit");
  assert.equal(a("ticket", "m"), "move");
  assert.equal(a("ticket", "c", { ...ALL_FACTS, canComment: false }), null);
  assert.equal(a("ticket", "e", { ...ALL_FACTS, canUpdate: false }), null);
  assert.equal(a("ticket", "m", { ...ALL_FACTS, canMove: false }), null);
});

test("move: j/k move in the list, enter picks, q and esc close it", () => {
  assert.equal(a("move", "j"), "next");
  assert.equal(a("move", "up"), "prev");
  assert.equal(a("move", "ctrl-u"), "halfUp");
  assert.equal(a("move", "enter"), "pick");
  assert.equal(a("move", "q"), "close");
  assert.equal(a("move", "escape"), "close");
  assert.equal(a("move", "a"), null);
});

test("launch: enter starts, q and esc close the card", () => {
  assert.equal(a("launch", "enter"), "start");
  assert.equal(a("launch", "q"), "close");
  assert.equal(a("launch", "escape"), "close");
  assert.equal(a("launch", "j"), null);
});

test("prs: browser, copy, review, views and a letter per row", () => {
  assert.equal(a("prs", "o"), "browser");
  assert.equal(a("prs", "y"), "copy");
  assert.equal(a("prs", "a"), "review");
  assert.equal(a("prs", "a", { ...ALL_FACTS, canReview: false }), null);
  assert.equal(a("prs", "tab"), "toggleView");
  assert.equal(a("prs", "]"), "toggleView");
  assert.equal(a("prs", "["), "toggleView");
  assert.equal(a("prs", "shift-p"), "profile");
  assert.equal(a("prs", "b"), "letter");
  assert.equal(a("prs", "p"), "letter");
  assert.equal(a("prs", ","), "settings");
  assert.equal(a("prs", "s"), "letter");
  assert.equal(a("prs", "z"), "letter");
  assert.equal(a("prs", "s", { ...ALL_FACTS, hasRows: false }), null);
  for (const c of RESERVED) assert.notEqual(a("prs", c), "letter", c);
});

test("pr: files, viewed, checks, post, fullscreen, browser, copy, review, refetch, close", () => {
  assert.equal(a("pr", "j"), "next");
  assert.equal(a("pr", "k"), "prev");
  assert.equal(a("pr", "g"), "first");
  assert.equal(a("pr", "shift-g"), "last");
  assert.equal(a("pr", "v"), "viewed");
  assert.equal(a("pr", "v", { ...ALL_FACTS, hasFile: false }), null);
  assert.equal(a("pr", "c"), "checks");
  assert.equal(a("pr", "p"), "post");
  assert.equal(a("pr", "p", { ...ALL_FACTS, canPost: false }), null);
  assert.equal(a("pr", "f"), "full");
  assert.equal(a("pr", "o"), "browser");
  assert.equal(a("pr", "y"), "copy");
  assert.equal(a("pr", "a"), "review");
  assert.equal(a("pr", "ctrl-d"), "halfDown");
  assert.equal(a("pr", "ctrl-r"), "refresh");
  assert.equal(a("pr", "r"), null);
  assert.equal(a("pr", "q"), "close");
  assert.equal(a("pr", "enter"), null);
});

test("pr in the pane copy: f zooms the pane, no Review, q does nothing", () => {
  const pane = { ...ALL_FACTS, pane: true };
  assert.equal(a("pr", "f", pane), "zoom");
  assert.equal(a("pr", "a", pane), null);
  assert.equal(a("pr", "q", pane), null);
  assert.equal(a("pr", "j", pane), "next");
});

test("review: p and enter ask when ready, q and esc go back", () => {
  assert.equal(a("review", "p"), "ask");
  assert.equal(a("review", "enter"), "ask");
  assert.equal(a("review", "p", { ...ALL_FACTS, canPost: false }), null);
  assert.equal(a("review", "q"), "back");
  assert.equal(a("review", "escape"), "back");
  assert.equal(a("review", "down"), "next"); // arrows keep working
});

test("confirm: y yes, n q esc no", () => {
  assert.equal(a("confirm", "y"), "yes");
  for (const k of ["n", "q", "escape"]) assert.equal(a("confirm", k), "no");
  assert.equal(a("confirm", "j"), null);
  assert.equal(a("confirm", "enter"), null);
});

test("help: ?, q and esc hide it, nothing else", () => {
  for (const k of ["?", "shift-/", "q", "escape"]) assert.equal(a("help", k), "hide");
  assert.equal(a("help", "j"), null);
});

test("settings: q and esc go back, nothing else (its boxes take letters)", () => {
  assert.equal(a("settings", "q"), "back");
  assert.equal(a("settings", "escape"), "back");
  assert.equal(a("settings", "j"), null);
  assert.equal(a("settings", "?"), null);
});

test("unknown layers do nothing", () => {
  assert.equal(keyAction("nope", "j", ALL_FACTS), null);
});

// The Dockr invariant: the legend and the "?" list name only keys that do something now.
for (const layer of LAYERS) {
  test(`hints in ${layer} name only keys keyAction does something with`, () => {
    for (const facts of [ALL_FACTS, NONE, { ...ALL_FACTS, pane: true }, { hasRows: true, vim: true }, PLAIN, { ...PLAIN, pane: true }]) {
      const hints = keyHints(layer, facts), core = coreHints(layer, facts);
      for (const [label] of [...hints, ...core]) {
        assert.notEqual(keyAction(layer, HINT_KEYS[label] ?? label, facts), null, `${layer} ${label} ${JSON.stringify(facts)}`);
      }
      for (const h of core) assert.ok(hints.some((x) => x[0] === h[0]), `${layer} core ${h[0]} is in keyHints`);
    }
  });
}

test("coreHints: the few per layer, then ? when it works", () => {
  const labels = (layer, facts = ALL_FACTS) => coreHints(layer, facts).map(([k]) => k);
  assert.deepEqual(labels("board"), ["j/k", "h/l", "enter", "a", "P", "q", "?"]);
  assert.deepEqual(labels("board", { ...ALL_FACTS, nextProfile: null }), ["j/k", "h/l", "enter", "a", "q", "?"]);
  assert.deepEqual(labels("ticket"), ["j/k", "c", "m", "a", "q", "?"]);
  assert.deepEqual(labels("prs"), ["j/k", "a letter", "enter", "a", "P", "q", "?"]);
  assert.deepEqual(labels("pr"), ["j/k", "v", "p", "a", "q", "?"]);
  assert.deepEqual(labels("review"), ["p", "q", "?"]);
  assert.deepEqual(labels("confirm"), ["y", "n", "?"]);
  assert.deepEqual(labels("settings"), ["q"]);
  assert.deepEqual(labels("pr", { ...ALL_FACTS, pane: true, hasFile: false }), ["j/k", "p", "?"]);
  assert.deepEqual(labels("board", { vim: true }), ["q", "?"]);
});

test("keyHints lists every key that works, and drops the rest", () => {
  const labels = keyHints("pr", { ...ALL_FACTS, pane: true }).map(([k]) => k);
  assert.ok(labels.includes("f") && !labels.includes("a") && !labels.includes("q"));
  assert.ok(labels.includes("v") && labels.includes("o") && labels.includes("?"));
  assert.deepEqual(keyHints("help", ALL_FACTS).map(([k]) => k), ["?", "q"]);
});

// D13: with vim off, only the keys Wayfindr had before, plus ctrl-n/ctrl-p, ctrl-r and ctrl-d/ctrl-u.
for (const layer of LAYERS) {
  test(`vim off: ${layer} lists and takes no letter keys but the overlay's v/p/f`, () => {
    for (const facts of [PLAIN, { ...PLAIN, pane: true }, NONE]) {
      const allowed = layer === "pr" ? ["v", "p", "f"] : [];
      for (const [label] of [...keyHints(layer, facts), ...coreHints(layer, facts)]) {
        const k = HINT_KEYS[label] ?? label;
        assert.ok(!/^[a-z?]$|^shift-[a-z/]$/.test(k) || allowed.includes(k), `${layer} hint ${label}`);
      }
      for (const c of "abcdefghijklmnopqrstuvwxyz") {
        if (!allowed.includes(c)) assert.equal(keyAction(layer, c, facts), null, `${layer} ${c}`);
        assert.equal(keyAction(layer, `shift-${c}`, facts), null, `${layer} shift-${c}`);
      }
      for (const k of ["?", "shift-/"]) assert.equal(keyAction(layer, k, facts), null, `${layer} ${k}`);
    }
  });
}

test("vim off: arrows, home/end, enter, esc, shift-arrows, ctrl-n/ctrl-p, ctrl-r and ctrl-d/ctrl-u still work", () => {
  assert.equal(a("board", "down", PLAIN), "next");
  assert.equal(a("board", "ctrl-n", PLAIN), "next");
  assert.equal(a("board", "ctrl-p", PLAIN), "prev");
  assert.equal(a("board", "left", PLAIN), "colPrev");
  assert.equal(a("board", "home", PLAIN), "first");
  assert.equal(a("board", "end", PLAIN), "last");
  assert.equal(a("board", "enter", PLAIN), "open");
  assert.equal(a("board", "escape", PLAIN), "close");
  assert.equal(a("board", "shift-right", PLAIN), "moveRight");
  assert.equal(a("pr", "up", PLAIN), "prev");
  assert.equal(a("pr", "home", PLAIN), "first");
  assert.equal(a("board", "ctrl-r", PLAIN), "refresh");
  assert.equal(a("board", "ctrl-d", PLAIN), "halfDown");
  assert.equal(a("prs", "ctrl-u", PLAIN), "halfUp");
  for (const [k, act] of [["v", "viewed"], ["p", "post"], ["f", "full"]]) assert.equal(a("pr", k, PLAIN), act);
  assert.equal(a("prs", "enter", PLAIN), "open");
  assert.equal(a("move", "enter", PLAIN), "pick");
  assert.equal(a("confirm", "escape", PLAIN), "no");
  assert.equal(a("settings", "escape", PLAIN), "back");
});

test("vim off: the legend lists arrow keys and esc, and no ?", () => {
  const labels = (layer, facts = PLAIN) => coreHints(layer, facts).map(([k]) => k);
  assert.deepEqual(labels("board"), ["up/down", "left/right", "enter", "esc"]);
  assert.deepEqual(labels("prs"), ["up/down", "enter", "esc"]);
  assert.deepEqual(labels("pr"), ["up/down", "v", "p", "esc"]);
  assert.deepEqual(labels("pr", { ...PLAIN, pane: true }), ["up/down", "v", "p"]);
  // With vim on, the arrow labels give way to j/k and the rest.
  assert.ok(!keyHints("board", ALL_FACTS).some(([k]) => k === "up/down" || k === "esc"));
});

test("the legend names the Profile P switches to, and drops P with one Profile", () => {
  assert.deepEqual(keyHints("board", ALL_FACTS).find(([k]) => k === "P"), ["P", "work"]);
  assert.equal(keyHints("board", { ...ALL_FACTS, nextProfile: null }).find(([k]) => k === "P"), undefined);
  assert.deepEqual(keyHints("prs", ALL_FACTS).find(([k]) => k === "tab"), ["tab", "Board"]);
  assert.deepEqual(keyHints("board", ALL_FACTS).find(([k]) => k === "tab"), ["tab", "Pull Requests"]);
});
