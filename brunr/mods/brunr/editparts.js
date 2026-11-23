// What the Environment editor and the .env editor share: the window frame, the table of rows with
// masked values, the questions drawn inside the editor, buttons and notes. Each editor is a brunr
// copy opened as a window, and `self.ed` is its state. A value lives only there: in the table
// (envtable.js) and in the row's inputs. Nothing here writes to shared state, localStorage, a toast
// or a log, and a message names a file, never a value. Rules live in envtable.js.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { closeOverlay, nextCommand, settings } from "herdr";
import * as tbl from "./envtable.js";

export const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");
export const SECRET_TEXT = "Secret. Its value is kept by Bruno, not in this file.";
const stop = (_e, cx) => cx.stop_propagation();

// ---- the table and its inputs ---------------------------------------------------------------------

/** Replaces the table: every row input is made again, every value masked. */
export function resetTable(self, table) {
  releaseInputs(self);
  self.ed.table = table;
  syncInputs(self);
}

export function releaseInputs(self) {
  for (const inp of self.ed?.inputs?.values() ?? []) { inp.name.release(); inp.value.release(); }
  self.ed?.inputs?.clear();
}

/** The inputs follow the table: new rows get theirs, removed rows lose theirs, masks follow the reveals. */
export function syncInputs(self) {
  const ed = self.ed, t = ed.table;
  const want = new Set(t ? tbl.ids(t) : []);
  for (const [id, inp] of [...ed.inputs]) if (!want.has(id)) { inp.name.release(); inp.value.release(); ed.inputs.delete(id); }
  if (!t) return;
  for (const id of want) {
    let inp = ed.inputs.get(id);
    if (!inp) {
      const row = tbl.rowOf(t, id);
      inp = {
        name: InputState.new({ placeholder: id === t.blank ? "Add a variable" : "Name", value: row.name }),
        value: InputState.new({ placeholder: "Value", value: row.secret ? "" : row.value }),
        masked: null,
      };
      inp.name.on("change", (_e, cx) => { rowEdited(self, id, "name"); cx.notify(); });
      inp.value.on("change", (_e, cx) => { rowEdited(self, id, "value"); cx.notify(); });
      for (const i of [inp.name, inp.value]) watchFocus(self, i);
      ed.inputs.set(id, inp);
    }
    const masked = !tbl.isRevealed(t, id);
    if (inp.masked !== masked) { inp.value.set_masked(masked); inp.masked = masked; }
  }
}

/** Remembers whether one of the editor's inputs holds the keyboard, for ctrl-s. */
export function watchFocus(self, input) {
  input.on("focus", () => { if (self.ed) self.ed.kb = true; });
  input.on("blur", () => { if (self.ed) self.ed.kb = false; });
}

/** A row input changed: its text goes into the table. */
export function rowEdited(self, id, field) {
  const ed = self.ed, inp = ed?.inputs.get(id);
  if (!inp || !ed.table) return;
  const value = inp[field].value();
  if (value === tbl.rowOf(ed.table, id)?.[field]) return;
  ed.table = tbl.editRow(ed.table, id, { [field]: value });
  ed.status = null;
  syncInputs(self);
}

/** A table change from a button: remove, enable, reveal. */
export function change(self, fn) {
  if (!self.ed?.table) return;
  self.ed.table = fn(self.ed.table);
  self.ed.status = null;
  syncInputs(self);
}

// ---- keys, closing and questions ------------------------------------------------------------------

/** ctrl-s reaches every shown brunr copy as "save": the editor saves only while it holds the keyboard. */
export function commandLoop(self, cx, onSave) {
  cx.spawn(async (cx) => {
    for (;;) {
      const c = await nextCommand();
      if (!self.ed) return;
      try { if (c === "save" && hasKeyboard(self)) onSave(cx); } catch {}
      cx.notify();
    }
  });
}

export const hasKeyboard = (self) => Boolean(self.ed?.kb) || self.handle.is_focused();

/** Close or Esc: a question open is cancelled; unsaved changes ask first; then the window closes. */
export function requestClose(self) {
  const ed = self.ed;
  if (!ed) return;
  if (ed.ask) return closeAsk(self);
  guard(self, () => closeOverlay(self.overlayId));
}

/** Runs `then` at once, or after "Discard unsaved changes?" when the editor has unsaved changes. */
export function guard(self, then) {
  if (!self.ed.dirty()) return then();
  openAsk(self, {
    title: "Discard unsaved changes?",
    detail: `Your changes to ${self.ed.fileLabel()} are not saved. Discarding them cannot be undone.`,
    choices: [{ label: "Keep editing" }, { label: "Discard", primary: true, run: () => { closeAsk(self); then(); } }],
  });
}

/**
 * Draws a question in place of the editor's content: `{ title, detail?, note?, error?, fields?,
 * choices }`. A field is `{ label, input, check?: () => message | null, mask?: boolean }`. A choice
 * is `{ label, primary?, run?(cx) }`; one without `run` cancels.
 */
export function openAsk(self, ask) {
  closeAsk(self);
  for (const f of ask.fields ?? []) {
    watchFocus(self, f.input);
    f.input.on("change", (_e, cx) => { if (self.ed?.ask === ask) ask.error = null; cx.notify(); });
    f.input.on("submit", (_e, cx) => { choose(self, cx, ask.choices.findIndex((c) => c.primary)); cx.notify(); });
    if (f.mask) { f.input.set_masked(true); f.shown = false; }
  }
  self.ed.ask = ask;
  if (ask.fields?.length) ask.fields[0].input.focus(); else self.handle.focus();
}

/** Closes the question and forgets what was typed in it. */
export function closeAsk(self) {
  const ask = self.ed?.ask;
  if (!ask) return;
  for (const f of ask.fields ?? []) { try { f.input.set_value(""); } catch {} f.input.release(); }
  self.ed.ask = null;
  self.ed.kb = false;
  self.handle.focus();
}

export function choose(self, cx, i) {
  const ask = self.ed?.ask;
  const c = ask?.choices[i];
  if (!c || self.ed.busy) return;
  if (!c.run) return closeAsk(self);
  if (c.primary && (ask.fields ?? []).some((f) => f.check?.())) { ask.tried = true; return; }
  c.run(cx);
}

// ---- drawing --------------------------------------------------------------------------------------

export function button(t, id, label, enabled, click, primary = false, small = false) {
  return div().id(id).h(small ? 22 : 26).px(small ? 7 : 10).flex_none().flex().items_center().rounded(5).text_size(11.5).border_1()
    .border_color(primary && enabled ? t.solid : t.border)
    .when(primary && enabled, (el) => el.bg(t.solid).text_color(t.solid_foreground))
    .when(!enabled, (el) => el.text_color(t.dim))
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(label);
}

export function iconButton(t, id, icon, enabled, click, color = null) {
  return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(5)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(svg(`mods/brunr/icons/${icon}.svg`).size(13).text_color(enabled ? color ?? t.muted : t.dim));
}

export function note(t, color, text, ...buttons) {
  return h_flex().flex_none().mx(12).mt(8).px(10).py(6).gap(8).items_center().rounded(6).bg(t.raised).text_size(11.5).text_color(color)
    .child(svg("mods/brunr/icons/warning.svg").size(12).flex_none()).child(div().flex_1().min_w(0).child(text)).children(buttons);
}

const field = (t, input, error, extra = {}) => Input.new(input).flex_1().min_w(0).h(26).px(7).items_center().rounded(5).border(1)
  .border_color(error ? t.blocked : t.border).bg(t.background).text_color(t.foreground).text_size(12)
  .when(Boolean(extra.mono), (el) => el.font_family(mono()));

/** The window: a title bar to drag it by, with Close, and the content, or the open question. */
export function frame(self, t, title, content) {
  const root = v_flex().id("brunr-editor").track_focus(self.handle).size_full().bg(t.popover).text_color(t.foreground).text_size(12.5)
    .on_key_down((e, cx) => {
      if (e.key === "escape") requestClose(self);
      else if ((e.keystroke === "ctrl-s" || e.keystroke === "cmd-s") && self.ed?.save) self.ed.save(cx);
      else return;
      cx.stop_propagation();
      cx.notify();
    });
  root.child(h_flex().id("brunr-editor-title").h(36).flex_none().pl(14).pr(6).gap(8).items_center().border_b(1).border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).child(title))
    .child(iconButton(t, "brunr-editor-close", "close", true, () => requestClose(self))));
  const body = v_flex().id("brunr-editor-body").flex_1().min_h(0).on_mouse_down("left", stop);
  return root.child(self.ed?.ask ? body.child(askView(self, t, self.ed.ask)) : body.child(content));
}

function askView(self, t, ask) {
  const card = v_flex().id("brunr-ask").w(440).flex_none().p(16).gap(10).rounded(8).border_1().border_color(t.border).bg(t.surface)
    .child(div().font_semibold().text_size(13.5).child(ask.title))
    .when(Boolean(ask.detail), (el) => el.child(div().text_color(t.muted).child(ask.detail)));
  (ask.fields ?? []).forEach((f, i) => {
    const error = ask.tried || f.input.value() ? f.check?.() ?? null : null;
    card.child(v_flex().flex_none().gap(4)
      .child(div().text_size(11.5).text_color(t.muted).child(f.label))
      .child(h_flex().gap(6).items_center().child(field(t, f.input, error, { mono: f.mono }))
        .when(Boolean(f.mask), (el) => el.child(iconButton(t, `brunr-ask-reveal-${i}`, f.shown ? "eye-off" : "eye", true, () => { f.shown = !f.shown; f.input.set_masked(!f.shown); }))))
      .child(div().h(14).text_size(11).text_color(t.blocked).child(error ?? "")));
  });
  if (ask.note) card.child(div().text_size(11.5).text_color(t.ansi3).child(ask.note));
  if (ask.error) card.child(div().text_size(11.5).text_color(t.blocked).child(ask.error));
  card.child(h_flex().flex_none().gap(8).justify_end().children(ask.choices.map((c, i) =>
    button(t, `brunr-ask-${i}`, self.ed.busy && c.primary ? "Working…" : c.label, !(self.ed.busy && c.primary), (cx) => choose(self, cx, i), Boolean(c.primary)))));
  return v_flex().flex_1().items_center().justify_center().bg(t.canvas).child(card);
}

/**
 * The table: an enabled checkbox (when `enabled`), Name, Value (masked), a reveal toggle and a
 * remove button per row, and an empty last row that adds a variable. `secretCell(row)` draws a
 * secret's value cell.
 */
export function tableView(self, t, { enabled = true, secretCell = null, idPrefix = "brunr-row" } = {}) {
  const tb = self.ed.table;
  const probs = tbl.problems(tb);
  const all = tbl.allRevealed(tb);
  const header = h_flex().h(26).flex_none().px(12).gap(6).items_center().text_size(11).text_color(t.dim).border_b(1).border_color(t.border)
    .when(enabled, (el) => el.child(div().w(18).flex_none()))
    .child(div().w(190).flex_none().child("Name"))
    .child(div().flex_1().min_w(0).child("Value"))
    .child(h_flex().id(`${idPrefix}-reveal-all`).w(54).flex_none().gap(4).items_center().cursor_pointer().on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); change(self, tbl.toggleRevealAll); cx.notify(); })
      .child(svg(`mods/brunr/icons/${all ? "eye-off" : "eye"}.svg`).size(12).text_color(t.muted)).child(div().text_color(t.muted).child(all ? "Hide" : "Show")))
    .child(div().w(24).flex_none());
  const rows = tbl.ids(tb).map((id) => {
    const r = tbl.rowOf(tb, id), inp = self.ed.inputs.get(id), blank = id === tb.blank;
    const p = probs[id];
    const line = h_flex().h(30).flex_none().gap(6).items_center()
      .when(enabled, (el) => el.child(div().id(`${idPrefix}-on-${id}`).size(16).mx(1).flex_none().flex().items_center().justify_center().rounded(4).border_1()
        .border_color(r.enabled && !blank ? t.accent : t.border).text_size(11).text_color(t.accent)
        .when(!blank, (e2) => e2.cursor_pointer().on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); change(self, (x) => tbl.toggleEnabled(x, id)); cx.notify(); }))
        .child(r.enabled && !blank ? "✓" : "")))
      .child(div().w(190).flex_none().child(inp ? field(t, inp.name, p?.error, { mono: true }) : ""));
    if (r.secret && secretCell) line.child(secretCell(r)).child(div().w(24).flex_none());
    else {
      line.child(div().flex_1().min_w(0).child(inp ? field(t, inp.value, false, { mono: true }) : ""))
        .child(div().w(54).flex_none().flex().justify_center().child(iconButton(t, `${idPrefix}-reveal-${id}`, tbl.isRevealed(tb, id) ? "eye-off" : "eye", true, () => change(self, (x) => tbl.toggleReveal(x, id)))));
    }
    line.child(blank ? div().w(24).flex_none() : iconButton(t, `${idPrefix}-remove-${id}`, "close", true, () => change(self, (x) => tbl.removeRow(x, id))));
    const box = v_flex().id(`${idPrefix}-${id}`).flex_none().px(12).py(1).child(line);
    if (p) box.child(div().pl(enabled ? 24 : 0).pb(2).text_size(11).text_color(p.error ? t.blocked : t.ansi3).child(p.error ?? p.warn));
    return box;
  });
  return v_flex().flex_1().min_h(0).child(header).child(v_flex().id(`${idPrefix}s`).flex_1().min_h(0).overflow_y_scrollbar().py(4).children(rows));
}
