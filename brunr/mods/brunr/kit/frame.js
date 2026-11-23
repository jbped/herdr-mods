// The frame around a dialog or popup: the rounded panel with its border, and the title row.
// Use it with "frame": "none" in mod.json, so Herdr draws no frame of its own around it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props } from "herdr";
import { SIZE, paneBackground, seeThroughOpacity } from "./theme.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {import("gpui-kit").FocusHandle} FocusHandle */
/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("./theme.js").Color} Color */

/**
 * @typedef {object} FrameOptions
 * @property {string} id
 * @property {string} title
 * @property {FocusHandle} handle the mod's focus handle, so the frame takes the keyboard
 * @property {(e: KeyEvent, cx: Context) => void} onKey every key pressed while the frame has the keyboard
 * @property {boolean} [fill] true for a dialog, which fills its overlay. A popup is as tall as its content.
 * @property {string} [icon] a picture before the title, as a path for svg()
 * @property {Color} [iconColor] defaults to the text color
 * @property {(width: number, cx: Context) => void} [onResize] told the frame's width, for content that needs widths in pixels
 * @property {any} [details] an element for the room between the title and "Esc", such as counts or a status. It should take the spare width (flex_1).
 */

/**
 * The frame with its title row. Add the content with `.child(...)`.
 * @param {Theme} t
 * @param {FrameOptions} o
 */
export function frame(t, o) {
  // A dialog keeps its solid fill. In a tab over a see-through layout, the terminals' color at their opacity.
  const fill = props()?.overlay === undefined && seeThroughOpacity() !== null ? paneBackground(t.popover) : t.popover;
  const root = v_flex()
    .id(o.id)
    .track_focus(o.handle)
    .on_key_down(o.onKey)
    .w_full()
    .min_h(0)
    .p(SIZE.framePad)
    .gap(SIZE.frameGap)
    .bg(fill)
    .rounded(SIZE.frameRadius).overflow_hidden().border_1().border_color(t.border)
    .text_size(13)
    .when(Boolean(o.fill), (el) => el.h_full())
    .when(Boolean(o.onResize), (el) => el.on_size_change((size, cx) => o.onResize?.(size.width, cx)));
  return root.child(h_flex().flex_none().items_center().gap(10)
    .when(Boolean(o.icon), (el) => el.child(svg(o.icon ?? "").size(22).flex_none().text_color(o.iconColor ?? t.foreground)))
    .child(div().flex_none().text_size(SIZE.title).font_semibold().text_color(t.foreground).child(o.title))
    .child(o.details ?? div().flex_1())
    .child(div().text_size(SIZE.small).text_color(t.dim).child("Esc")));
}

/** A thin line between sections. @param {Theme} t */
export function divider(t) {
  return div().h(1).flex_none().bg(t.border);
}
