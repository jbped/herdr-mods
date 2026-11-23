// The dialog's picker: one small list over the dialog for one choice. An Environment, a Run to
// confirm, a row's menu, the method and form menus, and the save questions all use it. It lives
// in the dialog copy, so a choice is taken in the dialog's own turn and nothing crosses to another
// copy. A picker holds labels and values only: never a field's text.
//
// In the dialog:
//   init:    this.pickers = new Pickers();
//   key:     if (this.pickers.open) c = PICKER_KEYS[k] ?? "";   then this.pickers.command(c, cx)
//   open:    this.pickers.show({ title, options: [{ label, value }], choose: (value, cx) => ... });
//   render:  .when(Boolean(this.pickers.open), (el) => el.child(this.pickers.panel(t)))
import { div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { SIZE } from "./kit/theme.js";
import { divider } from "./kit/frame.js";
import { legend } from "./kit/legend.js";
import { listRow } from "./kit/list.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("./kit/theme.js").Theme} Theme */
/** One choice in a picker. `warn` is a dim line under it. `hint` is its key, at the right. @typedef {{ label: string, value: any, warn?: string | null, hint?: string }} Choice */
/** A numbered line under a question's detail, such as a lint warning. @typedef {{ line: number | null, text: string }} Line */
/**
 * A picker. `at`: the highlighted choice (default: `current`'s, else the first). `current`: the
 * value marked with a dot. `detail` and `lines`: a question's text under the title. `choose` gets
 * the chosen value. `cancel` runs when it closes with no choice: esc, a press beside it, or another
 * picker taking its place.
 * @typedef {{ title: string, options: Choice[], at?: number, current?: any, detail?: string, lines?: Line[], choose: (value: any, cx: Context | AsyncContext) => void, cancel?: (cx: Context | AsyncContext | null) => void }} Picker
 */

/** The keys while a picker is open. */
export const PICKER_KEYS = /** @type {Record<string, string>} */ ({ up: "up", k: "up", "ctrl-k": "up", down: "down", j: "down", "ctrl-j": "down", enter: "enter", space: "enter", escape: "cancel" });

/** How many lines a question shows before they scroll, and the room for one, which may wrap once. */
const LINES_SHOWN = 5;
const LINE_H = 34;
/** The most the choices take before they scroll. */
const LIST_MAX = 320;

export class Pickers {
  /** Call it in `init`: it makes a scroll handle, which `render` must not. */
  constructor() {
    /** @type {(Picker & { at: number }) | null} */
    this.open = null;
    this.scroll = ScrollHandle.new();
  }

  /** Shows a picker. One that was open closes first, as a cancel. @param {Picker} p @param {Context | AsyncContext | null} [cx] */
  show(p, cx = null) {
    if (this.open) this.close(cx);
    const current = p.current === undefined ? -1 : p.options.findIndex((o) => o.value === p.current);
    this.open = { ...p, at: p.at ?? Math.max(0, current) };
    this.scroll.scroll_to_item(this.open.at);
  }

  /** Closes the picker with no choice. @param {Context | AsyncContext | null} [cx] */
  close(cx = null) {
    const p = this.open;
    this.open = null;
    p?.cancel?.(cx);
  }

  /** "up", "down" or "enter" while it is open. @param {string} c @param {Context | AsyncContext} cx */
  command(c, cx) {
    const p = this.open;
    if (!p || !p.options.length) return;
    if (c === "up" || c === "down") {
      p.at = (p.at + (c === "up" ? -1 : 1) + p.options.length) % p.options.length;
      this.scroll.scroll_to_item(p.at);
    } else if (c === "enter") this.pick(p.at, cx);
  }

  /** Takes a choice and closes the picker. @param {number} i @param {Context | AsyncContext} cx */
  pick(i, cx) {
    const p = this.open;
    const option = p?.options[i];
    if (!p || !option) return;
    this.open = null;
    p.choose(option.value, cx);
  }

  /** The open picker, placed over the dialog. A press beside it closes it. @param {Theme} t */
  panel(t) {
    const p = /** @type {Picker & { at: number }} */ (this.open);
    const lines = p.lines ?? [];
    // The scrolling parts get a set height: left to size themselves, they came out taller or shorter
    // than the panel around them, and the choices were drawn below it.
    const listH = Math.min(LIST_MAX, p.options.reduce((h, o) => h + (o.warn ? SIZE.tallRow + 4 : SIZE.compactRow), 0) + 2 * Math.max(0, p.options.length - 1));
    const panel = v_flex().id("brunr-picker").absolute().top(60).left(SIZE.framePad).w(p.lines?.length || p.detail ? 460 : 400).max_w("100%").p(12).gap(8)
      .bg(t.popover).rounded(12).border_1().border_color(t.border).shadow_lg().text_size(SIZE.text)
      // A press on the panel stays on it: the rows under it do not get it.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .child(div().px(4).font_semibold().text_color(t.foreground).child(p.title))
      .when(Boolean(p.detail), (el) => el.child(div().px(4).text_size(SIZE.small).text_color(t.muted).child(p.detail ?? "")))
      .when(lines.length > 0, (el) => el.child(v_flex().id("brunr-picker-lines").flex_none().h(Math.min(LINES_SHOWN, lines.length) * LINE_H + 12).overflow_y_scrollbar().gap(2).px(8).py(6)
        .rounded(SIZE.rowRadius).bg(t.surface).text_size(SIZE.small)
        .children(lines.map((l, i) => h_flex().id(`brunr-picker-line-${i}`).flex_none().gap(8).items_start()
          .child(div().w(52).flex_none().text_color(t.dim).child(l.line == null ? "file" : `line ${l.line}`))
          .child(div().flex_1().min_w(0).text_color(t.ansi3).child(l.text))))))
      .child(v_flex().id("brunr-picker-list").flex_none().h(listH).overflow_y_scrollbar().track_scroll(this.scroll).gap(2)
        .children(p.options.map((o, i) => listRow(t, { id: `brunr-pick-${i}`, on: i === p.at, compact: !o.warn, tall: Boolean(o.warn), click: (cx) => { this.pick(i, cx); cx.notify(); } })
          .child(div().w(10).flex_none().text_color(t.accent).child(p.current !== undefined && o.value === p.current ? "●" : ""))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().truncate().text_color(t.foreground).child(o.label))
            .when(Boolean(o.warn), (el) => el.child(div().text_size(SIZE.small).text_color(t.dim).child(o.warn ?? ""))))
          .when(Boolean(o.hint), (el) => el.child(div().flex_none().text_size(SIZE.small).text_color(t.dim).child(o.hint ?? ""))))))
      .child(divider(t))
      .child(legend(t, [["j/k", "move"], ["enter", "choose"], ["esc", "back"]]));
    return div().id("brunr-picker-around").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { this.close(cx); cx.stop_propagation(); cx.notify(); })
      .on_click((_e, cx) => cx.stop_propagation())
      .child(panel);
  }
}
