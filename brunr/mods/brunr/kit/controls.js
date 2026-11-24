// Controls: the spinner, the text box, the round icon button, chips, buttons and the slider.
import { div, svg } from "gpui-kit";
import { h_flex, Input, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { focusBorder } from "./theme.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("./theme.js").Color} Color */

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** A small turning mark for "working on it". Herdr animates it, so it costs no redraws. @param {Theme} t */
export function spinner(t) {
  return div().text_color(t.accent).frames(SPINNER, 90).child(SPINNER[0]);
}

/** A one-line text box. `active` (it has the keyboard) outlines it in the focus color. @param {Theme} t @param {any} state an InputState @param {boolean} [active] */
export function textInput(t, state, active = true) {
  return Input.new(state).h(32).px(10).rounded(8).border_1().border_color(active ? focusBorder(t) : t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
}

/**
 * A round button with one icon.
 * @param {Theme} t @param {string} id @param {string} icon a path for svg() @param {(cx: Context) => void} click
 * @param {{ lit?: boolean, big?: boolean, large?: boolean, mark?: string }} [look]
 *   `lit`: drawn in the accent color, for a mode that is on. `big`: the main button, filled.
 *   `large`: a roomier size, for a dialog. `mark`: a small label beside the icon.
 */
export function iconButton(t, id, icon, click, look = {}) {
  const size = look.large ? (look.big ? 48 : 36) : (look.big ? 34 : 28);
  const iconSize = look.large ? (look.big ? 20 : 18) : (look.big ? 16 : 14);
  return h_flex().id(id).h(size).min_w(size).px(4).gap(2).flex_none().items_center().justify_center().rounded(size / 2)
    .cursor_pointer().hover((s) => s.bg(t.hover))
    .when(Boolean(look.big), (el) => el.bg(t.raised))
    .on_click((_e, cx) => click(cx))
    .child(svg(icon).size(iconSize).text_color(look.lit ? t.accent : look.big ? t.foreground : t.muted))
    .when(Boolean(look.mark), (el) => el.child(div().text_size(9).font_semibold().text_color(t.accent).child(look.mark ?? "")));
}

/**
 * A small toggle or choice, such as a filter. Filled and outlined in the accent color when on.
 * @param {Theme} t
 * @param {{ id: string, label: any, on: boolean, click: (cx: Context) => void }} c `label`: text or an element
 */
export function chip(t, c) {
  return h_flex().id(c.id).flex_none().h(26).px(10).items_center().rounded(8).border_1()
    .border_color(c.on ? t.accent : t.border).bg(c.on ? t.selected : t.raised)
    .text_size(11.5).text_color(c.on ? t.foreground : t.muted).cursor_pointer()
    .hover((s) => s.border_color(t.accent))
    .on_click((_e, cx) => c.click(cx))
    .child(c.label);
}

/**
 * A small bordered button for a toolbar, as tall as a chip. Add its icon or text with `.child(...)`.
 * @param {Theme} t
 * @param {{ id: string, tip: string, click: (cx: Context) => void }} b `tip`: shown on hover
 */
export function toolButton(t, b) {
  return h_flex().id(b.id).flex_none().h(26).min_w(28).px(6).gap(2).items_center().justify_center().rounded(8).border_1()
    .border_color(t.border).bg(t.raised).text_color(t.muted).cursor_pointer()
    .hover((s) => s.border_color(t.accent))
    .tooltip(b.tip)
    .on_click((_e, cx) => b.click(cx));
}

/**
 * A button that shows its key first, then what it does. Dim and inert when not enabled.
 * @param {Theme} t @param {string} id @param {string} key @param {string} label
 * @param {boolean} enabled @param {(cx: Context) => void} click
 */
export function keyButton(t, id, key, label, enabled, click) {
  return h_flex().id(id).flex_none().h(28).px(10).gap(6).items_center().rounded(8).border_1()
    .border_color(t.border).bg(t.raised).text_size(12).text_color(enabled ? t.foreground : t.dim)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.border_color(t.accent)).on_click((_e, cx) => click(cx)))
    .child(div().font_semibold().text_color(enabled ? t.accent : t.dim).child(key))
    .child(label);
}

/**
 * A line with a round knob: drag the knob, or click along the line. Herdr places the fill
 * and the knob from `state`, a SliderState. Pair it with DragSlider (drag-slider.js) when the
 * value also changes by itself.
 * @param {Theme} t @param {any} state @param {number} width
 * @param {{ color?: Color, thick?: boolean, onHover?: (hovered: boolean, cx: Context) => void }} [look]
 *   `color`: the fill (default: the accent). `thick`: a heavier line with a bright knob, for a dialog.
 *   `onHover`: told when the pointer comes onto or leaves the slider.
 */
export function slider(t, state, width, look = {}) {
  const color = look.color ?? t.accent;
  const line = look.thick ? 5 : 3;
  const knob = look.thick ? 14 : 10;
  const onHover = look.onHover;
  return Slider.new(state).child(
    SliderTrack.new(state).flex().items_center().h(knob + 4).w(width).cursor_pointer()
      .when(Boolean(onHover), (el) => el.on_hover((hovered, cx) => onHover?.(hovered, cx))).child(
      SliderIndicator.new(state).relative().w_full().h(line).rounded(line / 2).bg(t.raised)
        .range_style((fill) => fill.rounded(line / 2).bg(color))
        // The knob starts at the line's top left: pull it up and left by half its extra size to center it.
        .child(SliderThumb.new(state).size(knob).rounded(knob / 2).bg(look.thick ? t.foreground : color)
          .ml(-knob / 2).mt(-(knob - line) / 2))));
}
