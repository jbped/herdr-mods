// The legend: the line of key hints at the bottom of a frame.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { SIZE } from "./theme.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("./theme.js").Theme} Theme */

/**
 * One key hint: the key, then what it does, as a word or as an icon (a path for svg()).
 * @typedef {[string, string | { icon: string }]} Hint
 */

/**
 * An icon's size in the legend. At 11 px the icon's drawing is about as tall as a lowercase
 * letter of the 11 px text, so centered on the line it sits on the letters' baseline.
 */
const ICON = 11;

/**
 * One hint. With `click` it is also a button that does what the key does.
 * @param {Theme} t @param {Hint} hint @param {{ id: string, click: (cx: Context) => void }} [button]
 */
export function hint(t, [key, what], button) {
  const el = h_flex().gap(4).items_center()
    .child(div().text_color(t.accent).font_semibold().child(key))
    .child(typeof what === "string"
      ? div().text_color(t.dim).child(what)
      : svg(what.icon).size(ICON).flex_none().text_color(t.dim));
  if (!button) return el;
  return el.id(button.id).rounded(3).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => button.click(cx));
}

/** The whole line: each key in the accent color, its meaning dim. Wraps when it runs out of room. @param {Theme} t @param {Hint[]} hints */
export function legend(t, hints) {
  return h_flex().flex_none().flex_wrap().gap(12).text_size(SIZE.small).children(hints.map((h) => hint(t, h)));
}
