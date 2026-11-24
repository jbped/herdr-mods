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
/**
 * One choice in a picker. `warn` is a dim line under it. `hint` is its key, at the right. `depth`
 * indents it, `header` draws it in bold, and `disabled` greys it out so it cannot be chosen. `side`
 * is a small button at its right, such as "Edit…", that does something else than choosing it.
 * @typedef {{ label: string, value: any, warn?: string | null, hint?: string, depth?: number, header?: boolean, disabled?: boolean, side?: { label: string, run: (cx: Context) => void } }} Choice
 */
/** A numbered line under a question's detail, such as a lint warning. @typedef {{ line: number | null, text: string }} Line */
/**
 * A picker. `at`: the highlighted choice (default: `current`'s, else the first). `current`: the
 * value marked with a dot. `detail` and `lines`: a question's text under the title. `choose` gets
 * the chosen value. `cancel` runs when it closes with no choice: esc, a press beside it, or another
 * picker taking its place.
 * @typedef {{ title: string, options: Choice[], at?: number, current?: any, detail?: string, lines?: Line[], choose: (value: any, cx: Context | AsyncContext) => void, cancel?: (cx: Context | AsyncContext | null) => void }} Picker
 */

/** Where a picker opens: the trigger's box in window coordinates. A point (a right-click) has no width or height. @typedef {{ x: number, y: number, width?: number, height?: number }} Anchor */

/** A press on a trigger this long ago or less places the picker it opens. */
const ANCHOR_MS = 800;
/** @type {{ rect: Anchor, at: number } | null} */
let pending = null;

/**
 * Call it from a trigger's mouse-down with the event's `bounds` (a button) or `position` (a
 * right-click): the picker opened by that press is placed there. A picker opened by a key has
 * no anchor and opens at the dialog's top left.
 * @param {Anchor | null | undefined} rect
 */
export function anchor(rect) {
  pending = rect ? { rect, at: Date.now() } : null;
}

/** The keys while a picker is open. */
export const PICKER_KEYS = /** @type {Record<string, string>} */ ({ up: "up", k: "up", "ctrl-k": "up", down: "down", j: "down", "ctrl-j": "down", enter: "enter", space: "enter", escape: "cancel" });

/** How many lines a question shows before they scroll, and the room for one, which may wrap once. */
const LINES_SHOWN = 5;
const LINE_H = 34;
/** The most the choices take before they scroll. */
const LIST_MAX = 320;
/** A plain menu's width under its trigger, the room between the two, and the room kept to the dialog's edge. */
const MENU_W = 280;
const GAP = 4;
const EDGE = 8;
/** A picker's height without its choices: the padding, the title, the divider and the key line. */
const HEAD_H = 112;

export class Pickers {
  /** Call it in `init`: it makes a scroll handle, which `render` must not. */
  constructor() {
    /** @type {(Picker & { at: number, anchor: Anchor | null }) | null} */
    this.open = null;
    this.scroll = ScrollHandle.new();
  }

  /** Shows a picker. One that was open closes first, as a cancel. @param {Picker} p @param {Context | AsyncContext | null} [cx] */
  show(p, cx = null) {
    if (this.open) this.close(cx);
    const current = p.current === undefined ? -1 : p.options.findIndex((o) => o.value === p.current);
    const a = pending && Date.now() - pending.at <= ANCHOR_MS ? pending.rect : null;
    pending = null;
    this.open = { ...p, at: p.at ?? Math.max(0, current), anchor: a };
    if (this.open.options[this.open.at]?.disabled) this.command("down", null);
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
      const n = p.options.length;
      // A greyed-out choice is stepped over.
      for (let i = 1; i <= n; i++) {
        const at = (p.at + (c === "up" ? -i : i) + n * n) % n;
        if (!p.options[at].disabled) { p.at = at; break; }
      }
      this.scroll.scroll_to_item(p.at);
    } else if (c === "enter") this.pick(p.at, cx);
  }

  /** Takes a choice and closes the picker. @param {number} i @param {Context | AsyncContext} cx */
  pick(i, cx) {
    const p = this.open;
    const option = p?.options[i];
    if (!p || !option || option.disabled) return;
    this.open = null;
    // A picker that this choice opens (a menu entry that asks something) takes the same place.
    anchor(p.anchor);
    p.choose(option.value, cx);
    pending = null;
  }

  /**
   * The open picker, placed over the dialog: under its trigger when a press opened it, else at the
   * top left. `box` is the dialog frame's place in the window, which the anchor is measured against.
   * A press beside it closes it.
   * @param {Theme} t @param {{ x: number, y: number, width: number, height: number } | null} [box]
   */
  panel(t, box = null) {
    const p = /** @type {Picker & { at: number, anchor: Anchor | null }} */ (this.open);
    const lines = p.lines ?? [];
    // The scrolling parts get a set height: left to size themselves, they came out taller or shorter
    // than the panel around them, and the choices were drawn below it.
    const listH = Math.min(LIST_MAX, p.options.reduce((h, o) => h + (o.warn ? SIZE.tallRow + 4 + (o.side ? 18 : 0) : SIZE.compactRow), 0) + 2 * Math.max(0, p.options.length - 1));
    const plain = !lines.length && !p.detail;
    const a = box ? p.anchor : null;
    // A plain menu under its button is narrow. A question, or a list with warnings or buttons, keeps its width.
    const width = !plain ? 460 : a && !p.options.some((o) => o.warn || o.side || o.hint) ? MENU_W : 400;
    let left = SIZE.framePad, top = 60;
    if (a && box) {
      const height = HEAD_H + listH + (p.detail ? 34 : 0) + (lines.length ? Math.min(LINES_SHOWN, lines.length) * LINE_H + 20 : 0);
      const under = a.y + (a.height ?? 0) + GAP - box.y, above = a.y - GAP - height - box.y;
      // Under the trigger when it fits, else above it, else as low as the dialog allows.
      top = under + height <= box.height - EDGE ? under : above >= EDGE ? above : Math.max(EDGE, box.height - height - EDGE);
      left = Math.max(EDGE, Math.min(a.x - box.x, box.width - width - EDGE));
    }
    const panel = v_flex().id("brunr-picker").absolute().top(top).left(left).w(width).max_w("100%").p(12).gap(8)
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
          .when(Boolean(o.depth), (el) => el.pl(8 + 14 * (o.depth ?? 0)))
          .child(div().w(10).flex_none().text_color(t.accent).child(p.current !== undefined && o.value === p.current ? "●" : ""))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().truncate().text_color(o.disabled ? t.dim : t.foreground).when(Boolean(o.header), (el) => el.font_semibold()).child(o.label))
            .when(Boolean(o.warn), (el) => el.child(div().text_size(SIZE.small).text_color(t.dim).child(o.warn ?? ""))))
          .when(Boolean(o.side), (el) => el.child(div().id(`brunr-pick-side-${i}`).flex_none().h(20).px(7).flex().items_center().rounded(5).border_1().border_color(t.border)
            .text_size(SIZE.small).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); const side = o.side; this.open = null; side?.run(cx); cx.notify(); })
            .child(o.side?.label ?? "")))
          .when(Boolean(o.hint), (el) => el.child(div().flex_none().text_size(SIZE.small).text_color(t.dim).child(o.hint ?? ""))))))
      .child(divider(t))
      .child(legend(t, [["j/k", "move"], ["enter", "choose"], ["esc", "back"]]));
    return div().id("brunr-picker-around").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { this.close(cx); cx.stop_propagation(); cx.notify(); })
      .on_click((_e, cx) => cx.stop_propagation())
      .child(panel);
  }
}
