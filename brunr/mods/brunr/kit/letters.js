// Letter hints: every row gets a letter, and typing it selects the row. Also the shared key
// handling for such a list (j/k, arrows, enter, escape).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { listRow } from "./list.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {{ at: number, typed: string }} NavState the selected row's index, and the letters typed so far */
/** @typedef {{ hint?: string }} Lettered anything that carries its letters in `hint` */
/** @typedef {{ spaces: Record<string, string>, tabs: Record<string, string>, spaceColor?: string, jumpLayout?: string }} LetterConfig */
/** @typedef {{ border?: boolean, color?: import("./theme.js").Color | null }} BadgeLook `border: false` draws no border. `color` is the letters' color. */

// Home row first, then everything else. One letter each until we run out, then pairs.
const HOME = "asdfghjkl";
const REST = "qwertyuiopzxcvbnm";

/**
 * Hands out letters, one entry per item, skipping `reserved` letters. `preferred[i]` is what
 * the user asked for in their config and wins if it's free. The rest fill in from the
 * alphabet, never starting with a preferred letter, so typing yours always lands where you expect.
 * @param {number} count
 * @param {string} [reserved]
 * @param {(string | null | undefined)[]} [preferred]
 * @returns {string[]}
 */
export function assignLetters(count, reserved = "", preferred = []) {
  /** @type {(string | null)[]} */
  const out = new Array(count).fill(null);
  /** @type {Set<string>} */
  const taken = new Set();
  for (let i = 0; i < count; i++) {
    const p = String(preferred[i] ?? "").toLowerCase();
    if (/^[a-z]+$/.test(p) && ![...p].some((c) => reserved.includes(c)) && !taken.has(p)) { out[i] = p; taken.add(p); }
  }
  // If someone picked "ab", nobody else gets plain "a" or typing it would stop there.
  const starts = new Set([...taken].map((h) => h[0]));
  const letters = [...(HOME + REST)].filter((c) => !reserved.includes(c) && !starts.has(c));
  const need = out.filter((h) => !h).length;
  /** @type {string[]} */
  const pool = [];
  if (need <= letters.length) pool.push(...letters);
  else for (const a of letters) for (const b of letters) pool.push(a + b);
  let next = 0;
  return out.map((h) => h ?? pool[next++] ?? "");
}

/**
 * The letter badge at a row's start.
 * @param {Theme} t
 * @param {string} letters
 * @param {string} typed the letters typed so far, shown highlighted
 * @param {boolean} [strong] drawn in the accent color: the row is selected, or the person chose this letter
 * @param {BadgeLook} [look]
 */
export function letterBadge(t, letters, typed, strong = false, look = {}) {
  const lit = typed && letters.startsWith(typed) ? typed.length : 0;
  return h_flex().flex_none().min_w(22).h(20).px(5).items_center().justify_center().rounded(5)
    .bg(t.raised).when(look.border !== false, (el) => el.border_1().border_color(strong ? t.accent : t.border))
    .text_size(11).font_semibold()
    .children([...letters].map((c, i) => div().text_color(look.color ?? (i < lit || strong ? t.accent : t.muted)).child(c)));
}

/**
 * A list row that starts with its letter badge. Add the rest with `.child(...)`.
 * @param {Theme} t
 * @param {{ id: string, letters: string, typed: string, pinned?: boolean, on: boolean, click: (cx: Context) => void, compact?: boolean, tall?: boolean, badge?: BadgeLook }} r
 *   `pinned`: the person chose this letter in their config.
 */
export function letterRow(t, r) {
  return listRow(t, r).child(letterBadge(t, r.letters, r.typed, Boolean(r.pinned) || r.on, r.badge));
}

/**
 * Key handling for a lettered list. Changes `state` and tells the caller what happened:
 * "done" (the key was used), "hit" (the typed letters matched a row), "act" (enter),
 * "close" (escape), or null (not a key this handles).
 * @param {NavState} state
 * @param {KeyEvent} e
 * @param {Lettered[]} items every lettered thing in order
 * @returns {"done" | "hit" | "act" | "close" | null}
 */
export function navigateByLetter(state, e, items) {
  const k = e.key;
  if (k === "escape") {
    if (state.typed) { state.typed = ""; return "done"; }
    return "close";
  }
  // ctrl-n / ctrl-p for the emacs and readline crowd.
  if (e.keystroke === "ctrl-n") { state.at = Math.min(items.length - 1, state.at + 1); state.typed = ""; return "done"; }
  if (e.keystroke === "ctrl-p") { state.at = Math.max(0, state.at - 1); state.typed = ""; return "done"; }
  if (e.modifiers.control || e.modifiers.alt || e.modifiers.platform) return null;
  // Mods that use this reserve j and k, so they are safe to use for movement here.
  if (k === "down" || k === "j") { state.at = Math.min(items.length - 1, state.at + 1); state.typed = ""; return "done"; }
  if (k === "up" || k === "k") { state.at = Math.max(0, state.at - 1); state.typed = ""; return "done"; }
  if (k === "enter") return "act";
  if (/^[a-z]$/.test(k) && !e.modifiers.shift) {
    const typed = state.typed + k;
    const exact = items.findIndex((it) => it.hint === typed);
    if (exact >= 0) { state.at = exact; state.typed = ""; return "hit"; }
    if (items.some((it) => it.hint?.startsWith(typed))) { state.typed = typed; return "done"; }
    state.typed = "";
    return null;
  }
  return null;
}

// A person's own letters live in ~/.config/herdr-app/hints.json, shared by every mod that uses letters:
//   { "spaces": { "Logos": "l" }, "tabs": { "Code": "c", "Logos/Tests": "e" } }
// Spaces by name. Tabs by name for every space, or as "space/tab" for one. Reserved letters get ignored.
// "spaceColor" is the color of a space's letter: a theme color's name ("ansi3"), a plain color
// name ("yellow"), or a hex color ("#e5c07b"). "jumpLayout": "cards" draws the jump mod's spaces
// as cards in columns.
export const LETTERS_FILE = "hints.json";

/** The eight plain terminal colors, by the theme's name for each. @type {Record<string, string>} */
const PLAIN = { black: "ansi0", red: "ansi1", green: "ansi2", yellow: "ansi3", blue: "ansi4", magenta: "ansi5", cyan: "ansi6", white: "ansi7" };

/**
 * A color from the config: a theme color's name, a plain color name, or a hex color. Null when it is none of these.
 * @param {Theme} t
 * @param {string | undefined} name
 * @returns {import("./theme.js").Color | null}
 */
export function configColor(t, name) {
  if (!name) return null;
  const key = name.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(key)) return /** @type {import("./theme.js").Color} */ (/** @type {unknown} */ (key));
  return t[PLAIN[key.toLowerCase()] ?? key] ?? null;
}

/**
 * @param {typeof import("herdr").readTextFile} readTextFile
 * @param {typeof import("herdr").appHome} appHome
 * @returns {Promise<LetterConfig>}
 */
export async function readLetterConfig(readTextFile, appHome) {
  try {
    const text = await readTextFile(appHome() + "/" + LETTERS_FILE);
    const json = text ? JSON.parse(text) : {};
    return { spaces: json.spaces ?? {}, tabs: json.tabs ?? {}, spaceColor: typeof json.spaceColor === "string" ? json.spaceColor : undefined, jumpLayout: typeof json.jumpLayout === "string" ? json.jumpLayout : undefined };
  } catch {
    return { spaces: {}, tabs: {} };
  }
}
