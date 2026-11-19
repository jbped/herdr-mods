// The Request form's view state and shared parts: the tab strip, the row table, field frames,
// menus and the fields' inputs and editors. The Draft text (`self.reqText`) is the only state of
// truth. A tab draws from readTab(text); an edit builds new data (formview.js), writeTab makes the
// new text, and `self.form.apply(text)` (request.js) makes it the Draft as a File edit would.
// `self.form` holds only what the text cannot: the shown tab, the fields' inputs and editors, the
// reveal toggles, and a short message. Nothing here writes a value to shared state, stored state,
// a toast, a log or an overlay's props: menus get option lists and keys only.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState } from "gpui-base";
import { openOverlay, settings, theme } from "herdr";
import { readTab, writeTab, tabBadge, ASSERT_OPERATORS } from "./form.js";
import * as fv from "./formview.js";
import { menuHeight } from "./popup.js";

const STORE_KEY = "requestTab";
export const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");
const stop = (_e, cx) => cx.stop_propagation();

/** `apply(text)`: makes `text` the Draft, as the File editor does, then calls syncForm. */
export function initForm(self, apply) {
  self.form = { tab: fv.pickTab(loadTab()), key: null, wid: new Map(), specs: new Map(), reveal: new Set(), syncing: false, note: null, cache: {}, apply };
}

function loadTab() { try { return globalThis.localStorage?.getItem(STORE_KEY) ?? null; } catch { return null; } }
function rememberTab(tab) { try { globalThis.localStorage?.setItem(STORE_KEY, tab); } catch {} }

/** Releases every input and editor of the form. */
export function releaseForm(self) {
  const f = self.form;
  if (!f) return;
  for (const w of f.wid.values()) w.release();
  f.wid.clear();
  f.specs = new Map();
}

// ---- reads, cached by text ----------------------------------------------------------------------

function cached(self) {
  const c = self.form.cache;
  if (c.text !== self.reqText || c.format !== self.req?.format) {
    self.form.cache = { text: self.reqText, format: self.req?.format, reads: {}, badges: null, tabs: fv.visibleTabs(self.reqText, self.req?.format) };
  }
  return self.form.cache;
}

/** The tabs the strip shows, none when the form does not apply. */
export const tabsOf = (self) => (self.req ? cached(self).tabs : []);

/** readTab of the Draft text, cached until the text changes. */
export function readOf(self, tab) {
  const c = cached(self);
  return (c.reads[tab] ??= readTab(self.reqText, tab));
}

function badges(self) {
  const c = cached(self);
  if (!c.badges) {
    c.badges = {};
    for (const tab of c.tabs) if (tab !== fv.FILE) { try { c.badges[tab] = fv.badgeOf(tabBadge(self.reqText, tab)); } catch { c.badges[tab] = null; } }
  }
  return c.badges;
}

/** True when the shown tab is a form tab (not File) and the form applies. */
export const onForm = (self) => tabsOf(self).length > 0 && self.form.tab !== fv.FILE;

// ---- the fields' inputs and editors -------------------------------------------------------------

/**
 * Makes the shown tab's inputs and editors follow the Draft text: new fields get theirs, gone ones
 * are released, and a field is given the text's value only when formview.needsReset says so.
 * Call after every change of the text, the tab or the Request, never from render.
 */
export function syncForm(self) {
  const f = self.form;
  if (!f) return;
  if (f.key !== (self.req?.key ?? null)) { releaseForm(self); f.key = self.req?.key ?? null; f.reveal.clear(); f.note = null; }
  const r = self.req && self.reqText != null && onForm(self) ? readOf(self, f.tab) : null;
  const specs = r?.ok ? fv.fieldsOf(f.tab, r.data) : [];
  const want = new Map(specs.map((s) => [s.id, s]));
  for (const [id, w] of [...f.wid]) if (!want.has(id)) { w.release(); f.wid.delete(id); }
  f.syncing = true;
  try {
    for (const s of specs) {
      const w = f.wid.get(s.id);
      if (!w) f.wid.set(s.id, make(self, s));
      else if (fv.needsReset(w.value(), s.value, s.compare)) w.set_value(s.value);
      if (s.masked) f.wid.get(s.id).set_masked(!f.reveal.has(s.id));
    }
  } finally { f.syncing = false; }
  f.specs = want;
}

function make(self, s) {
  let w;
  if (s.kind === "editor") {
    const t = theme();
    w = EditorState.new({ language: s.language, value: s.value, readonly: self.req.machine != null, font_family: mono(), font_size: 12, soft_wrap: true,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 } });
  } else w = InputState.new({ placeholder: s.placeholder, value: s.value });
  w.on("change", (_e, cx) => { fieldChanged(self, s.id); cx.notify(); });
  return w;
}

/** A field's text changed: the tab's data is built from it and written into the Draft text. */
export function fieldChanged(self, id) {
  const f = self.form;
  if (!f || f.syncing || !self.req) return;
  const s = f.specs.get(id), w = f.wid.get(id);
  if (!s || !w) return;
  if (self.req.machine != null) {
    // Another Machine's Request is read-only: the field goes back to the text's value.
    f.syncing = true;
    try { w.set_value(s.value); } finally { f.syncing = false; }
    return;
  }
  const r = readTab(self.reqText, f.tab);
  if (!r.ok) return;
  f.note = null;
  const next = s.edit(r.data, w.value());
  if (next != null) write(self, f.tab, next);
}

/** Writes the tab's data into the Draft text. An unreadable section is never written. */
export function write(self, tab, data) {
  if (!self.req || self.req.machine != null || self.reqText == null) return false;
  let text;
  try { text = writeTab(self.reqText, tab, data); } catch { return false; }
  if (text !== self.reqText) self.form.apply(text);
  return true;
}

/** Applies `fn(data) → data | null` to the shown tab's data read from the Draft text now. */
export function editTab(self, fn) {
  const tab = self.form.tab;
  const r = self.reqText != null ? readTab(self.reqText, tab) : null;
  if (!r?.ok) return;
  self.form.note = null;
  const next = fn(r.data);
  if (next != null) write(self, tab, next);
}

/** Shows another tab and remembers its name, the only thing stored. */
export function selectTab(self, tab) {
  const f = self.form;
  if (f.tab === tab) return;
  releaseForm(self);
  f.tab = tab;
  f.note = null;
  f.reveal.clear();
  rememberTab(tab);
  syncForm(self);
}

/** A masked field shown or hidden. */
export function toggleReveal(self, id) {
  const f = self.form;
  if (f.reveal.has(id)) f.reveal.delete(id); else f.reveal.add(id);
  f.wid.get(id)?.set_masked(!f.reveal.has(id));
}

// ---- menus --------------------------------------------------------------------------------------

/**
 * Opens a popup menu of `options` (null: a separator) with `labels`. The choice comes back as a
 * `form` ask to this pane copy, with the option's key only: a mode or an operator, never a field value.
 */
export function openMenu(self, field, row, options, labels, current, width = 200) {
  const items = options.map((v) => (v == null ? { sep: true } : {
    label: labels[v] ?? v, hint: v === current ? "✓" : "",
    ask: { to: self.addr, kind: "formMenu", key: self.req.key, tab: self.form.tab, field, row, value: v },
  }));
  openOverlay({ mod: "brunr", kind: "popup", width, height: menuHeight(items), props: { menu: { key: self.req.key, items } } });
}

/** A menu's choice, from the pane copy's asks. */
export function menuChosen(self, a) {
  if (!self.req || a.key !== self.req.key || a.tab !== self.form.tab) return;
  editTab(self, (d) => fv.menuEdit(self.form.tab, d, a));
}

// ---- drawing ------------------------------------------------------------------------------------

/** The tab strip. It wraps onto more lines when the pane is narrow, so every tab stays reachable. */
export function strip(self, t) {
  const b = badges(self);
  return h_flex().id("brunr-form-tabs").flex_none().flex_wrap().px(6).border_b(1).border_color(t.border).text_size(12)
    .children(tabsOf(self).map((tab) => {
      const on = tab === self.form.tab, badge = b[tab];
      return h_flex().id(`brunr-tab-${tab}`).h(30).flex_none().px(8).gap(4).items_center().cursor_pointer()
        .when(on, (el) => el.border_b(2).border_color(t.accent).text_color(t.foreground))
        .when(!on, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => { selectTab(self, tab); cx.notify(); })
        .child(div().child(fv.TAB_LABELS[tab]))
        .when(Boolean(badge?.count), (el) => el.child(div().text_size(10).font_semibold().text_color(t.accent).child(String(badge.count))))
        .when(Boolean(badge?.dot), (el) => el.child(div().size(6).rounded(3).bg(t.accent)));
    }));
}

export function button(t, id, label, enabled, click, primary = false) {
  return div().id(id).h(24).px(10).flex_none().flex().items_center().rounded(5).text_size(11.5).border_1()
    .border_color(primary && enabled ? t.solid : t.border)
    .when(primary && enabled, (el) => el.bg(t.solid).text_color(t.solid_foreground))
    .when(!enabled, (el) => el.text_color(t.dim))
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(label);
}

export function iconButton(t, id, icon, enabled, click) {
  return div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(5)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(svg(`mods/brunr/icons/${icon}.svg`).size(13).text_color(enabled ? t.muted : t.dim));
}

/** A menu button: the current choice and a chevron. */
export function menuButton(t, id, label, enabled, click) {
  return h_flex().id(id).h(26).px(8).gap(6).flex_none().items_center().rounded(5).border_1().border_color(t.border).text_size(12)
    .text_color(enabled ? t.foreground : t.dim)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(div().child(label)).child(svg("mods/brunr/icons/chevron-down.svg").size(10).text_color(t.dim));
}

/** A checkbox drawn as the Environment table draws it. */
export function checkbox(t, id, checked, click) {
  return div().id(id).size(16).mx(1).flex_none().flex().items_center().justify_center().rounded(4).border_1()
    .border_color(checked ? t.accent : t.border).text_size(11).text_color(t.accent)
    .when(Boolean(click), (el) => el.cursor_pointer().on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(checked ? "✓" : "");
}

/** The frame of a field's input, or an empty frame while it has none. */
export function field(self, t, id, error = false) {
  const w = self.form.wid.get(id);
  if (!w) return div().flex_1().min_w(0).h(26);
  return Input.new(w).flex_1().min_w(0).h(26).px(7).items_center().rounded(5).border(1).border_color(error ? t.blocked : t.border)
    .bg(t.background).text_color(t.foreground).font_family(mono()).text_size(12);
}

/** A field's editor, filling the height it is given. */
export function editorOf(self, t, id) {
  const w = self.form.wid.get(id);
  return w ? Editor.new(w).flex_1().min_h(0) : v_flex().flex_1();
}

export const title = (t, text) => div().flex_none().px(12).pt(10).pb(4).text_size(11).font_semibold().text_color(t.muted).child(text);

/**
 * A row table (formview.TABLES[name]) over the tab's data: the enabled checkbox, the columns,
 * a remove button per row, and an empty last row that adds a row when typed in.
 */
export function rowTable(self, t, name, data, local) {
  const spec = fv.TABLES[name];
  const rows = spec.get(data);
  const n = rows.length + (spec.add ? 1 : 0);
  const colBox = (c) => (c.menu ? div().w(112).flex_none() : div().flex_1().min_w(0));
  const header = h_flex().h(24).flex_none().px(12).gap(6).items_center().text_size(11).text_color(t.dim)
    .when(spec.check, (el) => el.child(div().w(18).flex_none()))
    .children(spec.cols.map((c) => colBox(c).child(c.label)))
    .when(spec.add, (el) => el.child(div().w(24).flex_none()));
  const lines = [];
  for (let i = 0; i < n; i++) {
    const blank = i === rows.length, r = rows[i] ?? spec.blank;
    const op = (o) => (cx) => { editTab(self, (d) => fv.tableEdit(name, d, { ...o, index: i })); };
    const line = h_flex().id(`brunr-${name}-row-${i}`).h(30).flex_none().px(12).gap(6).items_center()
      .when(spec.check, (el) => el.child(checkbox(t, `brunr-${name}-on-${i}`, !blank && r.enabled !== false, !blank && local ? op({ type: "toggle" }) : null)));
    for (const c of spec.cols) {
      if (c.readonly) line.child(div().flex_1().min_w(0).px(7).truncate().font_family(mono()).text_size(12).child(String(r[c.key] ?? "")));
      else if (c.menu) {
        line.child(div().w(112).flex_none().child(menuButton(t, `brunr-${name}-op-${i}`, r[c.key], local && !blank,
          () => openMenu(self, c.key, i, ASSERT_OPERATORS, {}, r[c.key], 180))));
      } else if (name === "assert" && c.key === "value" && fv.isUnary(r.operator)) {
        line.child(div().flex_1().min_w(0).h(26).rounded(5).border_1().border_color(t.border).bg(t.raised));
      } else line.child(div().flex_1().min_w(0).child(field(self, t, `${name}:${i}:${c.key}`)));
    }
    if (spec.add) line.child(blank || !local ? div().w(24).flex_none() : iconButton(t, `brunr-${name}-remove-${i}`, "close", true, op({ type: "remove" })));
    lines.push(line);
  }
  return v_flex().id(`brunr-${name}-table`).flex_none().py(2).child(header).children(lines);
}

