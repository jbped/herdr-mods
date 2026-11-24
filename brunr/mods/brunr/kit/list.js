// List rows: the row shell with its selected highlight, the two-line name for a tall row, and
// the note a list shows when it has no rows.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { SIZE } from "./theme.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("./theme.js").Theme} Theme */

/**
 * A row's shell. Add its columns with `.child(...)` or `.children(...)`.
 * @param {Theme} t
 * @param {{ id: string, on: boolean, click?: (cx: Context) => void, compact?: boolean, tall?: boolean }} r
 *   `on`: this row is selected. `compact`: the tighter height, for long lists.
 *   `tall`: room for rowText's two lines.
 *   `click`: leave it out when the list reports clicks itself, as a virtual list does.
 */
export function listRow(t, r) {
  return h_flex().id(r.id).w_full().flex_none()
    // A tall row grows when its second line wraps. The others have one fixed height.
    .when(Boolean(r.tall), (el) => el.min_h(SIZE.tallRow).py(6))
    .when(!r.tall, (el) => el.h(r.compact ? SIZE.compactRow : SIZE.row)).px(12).gap(10).items_center()
    .rounded(SIZE.rowRadius).cursor_pointer().text_size(SIZE.text)
    .when(r.on, (el) => el.bg(t.selected))
    .hover((s) => s.bg(r.on ? t.selected : t.hover))
    .when(Boolean(r.click), (el) => el.on_click((_e, cx) => r.click?.(cx)));
}

/**
 * A row's name with a dim line under it, for a tall row. It takes the row's spare width.
 * @param {Theme} t @param {string} name @param {string} [detail]
 * @param {boolean} [wrap] long text goes onto more lines. Without it, long text is cut off.
 */
export function rowText(t, name, detail, wrap = false) {
  return v_flex().flex_1().min_w(0).gap(1)
    .child(div().when(!wrap, (el) => el.truncate()).font_medium().child(name))
    .when(Boolean(detail), (el) => el.child(div().when(!wrap, (d) => d.truncate()).text_size(SIZE.small).text_color(t.dim).child(detail ?? "")));
}

/** One dim line in place of rows: "nothing here", an error, or a spinner. @param {Theme} t @param {any} child */
export function listNote(t, child) {
  return h_flex().px(12).py(10).gap(8).items_center().text_size(13).text_color(t.dim).child(child);
}
