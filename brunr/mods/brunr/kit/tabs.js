// A strip of tabs, each an icon and a name. The active one has a filled background.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { SIZE } from "./theme.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("./theme.js").Theme} Theme */

/**
 * @typedef {object} TabItem
 * @property {string} id
 * @property {string} label
 * @property {string} [icon] a path for svg()
 * @property {boolean} on true for the tab that is showing
 * @property {(cx: Context) => void} click
 */

/** @param {Theme} t @param {TabItem[]} tabs */
export function tabStrip(t, tabs) {
  return h_flex().flex_none().gap(6).children(tabs.map((tab) => {
    const ink = tab.on ? t.foreground : t.muted;
    return h_flex().id(`tab-${tab.id}`).h(34).px(14).gap(8).items_center().rounded(SIZE.rowRadius).cursor_pointer()
      .when(tab.on, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => tab.click(cx))
      .when(Boolean(tab.icon), (el) => el.child(svg(tab.icon ?? "").size(15).flex_none().text_color(ink)))
      .child(div().text_size(SIZE.text).text_color(ink).child(tab.label));
  }));
}
