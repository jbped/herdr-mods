// Popups over the panel and the pane: the Environment pickers, a row's menu, the method menu and
// the save dialogs. Each hands its choice to the copy that opened it through store.ask and closes.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { closeOverlay, props, theme } from "herdr";
import * as store from "./store.js";

const ITEM = 28;
const SEP = 9;

export const menuHeight = (items) => 12 + items.reduce((n, i) => n + (i.sep ? SEP : ITEM), 0);
/** A picker's height: its title and options, at most 440px; a longer list scrolls. */
export const pickerHeight = (options) => Math.min(440, 52 + options.reduce((n, o) => n + (o.warn ? 44 : ITEM), 0));
const LINE = 40;
const linesHeight = (d) => (d.lines?.length ? 12 + Math.min(5, d.lines.length) * LINE : 0);
/** A dialog's height: title, detail, up to 5 lines (each may wrap once; more scroll), buttons. */
export const dialogHeight = (d) => 120 + (d.detail ? 44 : 0) + (d.lines?.length ? linesHeight(d) + 8 : 0);

const usable = (i) => i && !i.sep && !i.disabled;

export function init(self) {
  const p = props();
  self.menu = p.menu ?? null;
  self.picker = p.picker ?? null;
  self.dialog = p.dialog ?? null;
  if (self.dialog) { self.at = Math.max(0, self.dialog.choices.findIndex((c) => c.primary)); self.handle.focus(); return; }
  const list = self.menu ? self.menu.items : self.picker.options;
  const current = self.picker ? list.findIndex((o) => o.value === (self.picker.current ?? null)) : -1;
  self.at = current >= 0 ? current : Math.max(0, list.findIndex(usable));
  self.handle.focus();
}

const close = () => closeOverlay(props().overlay);

function choose(self, cx, i) {
  if (self.dialog) {
    const c = self.dialog.choices[i];
    if (!c) return;
    store.ask({ to: self.dialog.to, kind: "dialog", flow: self.dialog.flow, choice: c.id });
    return close();
  }
  if (self.picker) {
    const o = self.picker.options[i];
    if (!usable(o)) return;
    store.ask({ kind: self.picker.kind, key: self.picker.key, value: o.value ?? null });
    return close();
  }
  const item = self.menu.items[i];
  if (!usable(item)) return;
  if (item.copy != null) cx.write_to_clipboard(item.copy);
  else if (item.ask) store.ask(item.ask);
  else store.ask({ kind: "act", key: self.menu.key, action: item.action });
  close();
}

function step(self, by) {
  if (self.dialog) { const n = self.dialog.choices.length; self.at = (self.at + by + n) % n; return; }
  const list = self.menu ? self.menu.items : self.picker.options;
  let i = self.at;
  for (let n = 0; n < list.length; n++) {
    i = (i + by + list.length) % list.length;
    if (usable(list[i])) break;
  }
  self.at = i;
}

export function render(self) {
  const t = theme();
  const root = v_flex().id("brunr-popup").track_focus(self.handle).size_full().p(5).bg(t.popover).text_color(t.foreground).text_size(12.5)
    .on_key_down((e, cx) => {
      if (e.key === "escape") close();
      else if (e.key === "down" || (self.dialog && (e.key === "right" || e.key === "tab"))) step(self, 1);
      else if (e.key === "up" || (self.dialog && e.key === "left")) step(self, -1);
      else if (e.key === "enter") choose(self, cx, self.at);
      else return;
      cx.stop_propagation();
      cx.notify();
    });
  if (self.dialog) return dialogView(self, t, root);
  if (self.picker) {
    const p = self.picker;
    root.child(h_flex().h(34).px(8).items_center().border_b(1).border_color(t.border).mb(4)
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(p.title)).child(div().text_size(10.5).text_color(t.dim).child("Esc")));
    // Move to's folders are indented by depth, and a long list scrolls.
    return root.child(v_flex().id("brunr-picker-list").flex_1().min_h(0).overflow_y_scrollbar().children(p.options.map((o, i) => {
      const on = (o.value ?? null) === (p.current ?? null);
      return v_flex().id(`opt-${i}`).w_full().flex_none().pl(8 + (o.depth ?? 0) * 14).pr(8).py(5).gap(2).rounded(5)
        .when(!o.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.selected)).on_click((_e, cx) => choose(self, cx, i)))
        .when(i === self.at && !o.disabled, (el) => el.bg(t.selected))
        .child(h_flex().h(18).gap(8).items_center()
          .child(div().w(12).flex_none().text_color(t.accent).child(on ? "✓" : ""))
          .child(div().flex_1().min_w(0).truncate().text_color(o.disabled ? t.dim : o.value == null ? t.muted : t.foreground).when(Boolean(o.header), (el) => el.font_semibold()).child(o.label))
          .when(Boolean(o.warn), (el) => el.child(svg("mods/brunr/icons/warning.svg").size(12).flex_none().text_color(t.ansi3))))
        .when(Boolean(o.warn), (el) => el.child(div().pl(20).text_size(10.5).text_color(t.ansi3).child(o.warn)));
    })));
  }
  return root.children(self.menu.items.map((item, i) => {
    if (item.sep) return div().w_full().h(1).my(4).bg(t.border);
    return h_flex().id(`menu-${i}`).w_full().h(ITEM).flex_none().px(8).gap(8).items_center().rounded(5)
      .text_color(item.disabled ? t.dim : t.foreground)
      .when(!item.disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.selected)).on_click((_e, cx) => choose(self, cx, i)))
      .when(i === self.at && !item.disabled, (el) => el.bg(t.selected))
      .child(div().flex_1().min_w(0).truncate().child(item.label))
      .when(Boolean(item.hint), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(item.hint)));
  }));
}

/** A question with buttons: a title, an optional detail, numbered lines (warnings) and the choices. */
function dialogView(self, t, root) {
  const d = self.dialog;
  return root.p(14).gap(8)
    .child(div().font_semibold().text_size(13.5).child(d.title))
    .when(Boolean(d.detail), (el) => el.child(div().text_color(t.muted).child(d.detail)))
    .when(Boolean(d.lines?.length), (el) => el.child(v_flex().id("brunr-dialog-lines").flex_none().h(linesHeight(d)).overflow_y_scrollbar().gap(2).px(8).py(6).rounded(5).bg(t.surface).text_size(11.5)
      .children(d.lines.map((l, i) => h_flex().id(`dl-${i}`).flex_none().gap(8).items_start()
        .child(div().w(52).flex_none().text_color(t.dim).child(l.line == null ? "file" : `line ${l.line}`))
        .child(div().flex_1().min_w(0).text_color(t.ansi3).child(l.text))))))
    .child(div().flex_1())
    .child(h_flex().flex_none().gap(8).justify_end().children(d.choices.map((c, i) => div().id(`dc-${c.id}`).h(28).px(12).flex().items_center().rounded(5).cursor_pointer()
      .border_1().border_color(i === self.at ? t.accent : t.border)
      .when(Boolean(c.primary), (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!c.primary, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => choose(self, cx, i))
      .child(c.label))));
}
