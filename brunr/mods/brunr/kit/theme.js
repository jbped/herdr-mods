// The kit: the look and the building blocks every mod in this repo shares.
//
// This folder at the repo root is the one place to edit. A mod can only import from its own
// folder, so `node scripts/sync-kit.mjs` copies it into each mod as `mods/<name>/kit/`, and
// mods import from "./kit/...". Never edit a copy: the next sync overwrites it.
//
// This file: the theme's colors and the sizes the other kit files draw with.
import { theme, layout, props, shared } from "herdr";

/** @typedef {import("gpui-kit").Color} Color */
/** @typedef {Record<string, Color>} Theme */

/** The fills that follow the terminals' opacity. Popover (menus, cards over content) stays solid. */
const SEE_THROUGH = ["background", "canvas", "chrome", "surface", "raised", "hover", "selected", "input", "selection"];

/**
 * The app's theme colors by name, typed as colors the builders accept. In a tab over a background
 * picture with see-through terminals (seeThroughOpacity), the fills come at the terminals'
 * opacity, so a mod's rows, inputs and buttons match them. Dialogs keep the solid colors.
 * @returns {Theme}
 */
export function colors() {
  const t = /** @type {Theme} */ (theme());
  const opacity = props()?.overlay === undefined ? seeThroughOpacity() : null;
  if (opacity === null) return t;
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, "0");
  const faded = { ...t };
  for (const key of SEE_THROUGH) {
    const c = String(t[key] ?? "");
    if (/^#[0-9a-f]{6}$/i.test(c)) faded[key] = /** @type {Color} */ (c + alpha);
  }
  return faded;
}

/**
 * The panes' opacity when the background picker made them see-through on the shown layout: it
 * records { layout, opacity } in shared state ("backgrounds.seeThrough"), clears the terminals and
 * gives the pane frame the theme's background at that opacity. Null otherwise, so other setups
 * look as they always have.
 * @returns {number | null}
 */
export function seeThroughOpacity() {
  const s = /** @type {any} */ (shared("backgrounds.seeThrough"));
  if (!s || typeof s !== "object" || s.layout !== shared("layout")) return null;
  const root = /** @type {any} */ (layout());
  if (!root || typeof root.background !== "object" || typeof root.background?.image !== "string") return null;
  const o = Number(s.opacity);
  return Number.isFinite(o) && o < 1 ? Math.max(0, o) : null;
}

/**
 * A mod's own background in a tab: `color` as it is, or clear when the panes are see-through,
 * because the pane frame under the mod then draws the theme's background at the panes' opacity.
 * @param {Color} color the mod's usual background @returns {Color}
 */
export function paneBackground(color) {
  return seeThroughOpacity() === null ? color : /** @type {Color} */ ("#00000000");
}

/**
 * A bar or panel's fill around the tabs: `color` as it is, or, when the layout shows its
 * background picture through the terminals, `color` at the terminals' opacity.
 * @param {Color} color @returns {Color}
 */
export function seeThroughFill(color) {
  const opacity = seeThroughOpacity();
  if (opacity === null || !/^#[0-9a-f]{6}$/i.test(String(color))) return color;
  return /** @type {Color} */ (`${color}${Math.round(opacity * 255).toString(16).padStart(2, "0")}`);
}

/**
 * The border that shows where the keyboard is: a text box you're typing in, the pane or card that
 * has the keys. The text color at 20%, a little lighter than `border`, so it shows without pulling
 * the eye the way the accent does. Selection and "on" states keep the accent.
 * @param {Theme} t @returns {Color}
 */
export function focusBorder(t) {
  const c = String(t.foreground ?? "");
  return /** @type {Color} */ (/^#[0-9a-f]{6}$/i.test(c) ? `${c}33` : t.input);
}

/** Sizes in pixels. One table, so every mod's frame, rows and text match. */
export const SIZE = {
  /** The space between a frame's edge and its content. */
  framePad: 22,
  /** The space between a frame's sections. */
  frameGap: 14,
  frameRadius: 16,
  /** The space between a pane's edge and its content, sideways. A pane is tighter than a frame. */
  panePad: 14,
  /** A list row, and the tighter row for long lists. */
  row: 38,
  compactRow: 32,
  /** A row with a second, dim line under its name. */
  tallRow: 48,
  rowRadius: 8,
  /** Text: a frame's title, a list row, and small print such as key hints. */
  title: 16,
  text: 13.5,
  small: 11,
};
