// Parts of a pane: a mod that fills a split beside the terminals, not a dialog over them.
// A pane has no frame. It has a header line on top, a scrolling body, and a bar of buttons below.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { SIZE } from "./theme.js";

/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("./theme.js").Color} Color */

/**
 * The line across a pane's top, with a border under it. Add its parts with `.child(...)`.
 * @param {Theme} t
 */
export function paneHeader(t) {
  return h_flex().flex_none().px(SIZE.panePad).py(10).gap(10).items_center().border_b_1().border_color(t.border);
}

/** A screen's name in a pane header. @param {Theme} t @param {string} text */
export function paneTitle(t, text) {
  return div().flex_none().font_semibold().text_color(t.foreground).child(text);
}

/** The dim detail after a title. It takes the spare width and cuts off when it runs out. @param {Theme} t @param {string} text */
export function paneDetail(t, text) {
  return div().flex_1().min_w(0).truncate().text_size(SIZE.small).text_color(t.dim).child(text);
}

/**
 * The bar across a pane's bottom, with a border over it. Add keyButtons with `.child(...)`.
 * It wraps when it runs out of room.
 * @param {Theme} t
 */
export function paneBar(t) {
  return h_flex().flex_none().px(SIZE.panePad).py(10).gap(6).flex_wrap().border_t_1().border_color(t.border);
}

/** A small label with a filled background, such as a group or a count. @param {Theme} t @param {string} text @param {Color} [color] defaults to the accent */
export function tag(t, text, color) {
  return div().flex_none().px(6).py(1).rounded(5).bg(t.raised).text_size(SIZE.small).text_color(color ?? t.accent).child(text);
}

/** A filled box with one message, such as an error or "done". @param {Theme} t @param {string} text @param {Color} [color] defaults to the text color */
export function banner(t, text, color) {
  return div().p(10).rounded(SIZE.rowRadius).bg(t.raised).text_size(12).text_color(color ?? t.foreground).child(text);
}

/** The dim heading over a group of rows. @param {Theme} t @param {string} text */
export function sectionLabel(t, text) {
  return div().pt(12).pb(6).text_size(SIZE.small).text_color(t.dim).child(text);
}
