// The Request side of the pane: a bar with the method menu, the URL field and Run, a line with the
// Request's name, path, unsaved mark, Save and Discard, the file as text in an editor, and lint
// warnings. The text is the Draft in drafts.js; this file draws it and turns input into calls.
// Rules live in edit.js, lint.js, drafts.js and saveflow.js.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState } from "gpui-base";
import { openOverlay, panes, settings, theme } from "herdr";
import * as store from "./store.js";
import * as drafts from "./drafts.js";
import * as machine from "./machine.js";
import * as saveflow from "./saveflow.js";
import { canSetMethod, canSetUrl, readHead, setMethod, setUrl } from "./edit.js";
import { lintRequest } from "./lint.js";
import { menuHeight } from "./popup.js";
import { methodColor } from "./panel.js";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");
const absPath = (req) => `${String(req.root).replace(/\/+$/, "")}/${req.path}`;

export function init(self, cx) {
  self.addr = `pane:${self.tab}`;
  self.req = null;              // the shown Request: { key, ck, machine, root, path, format, name, n }
  self.reqSeen = null;
  self.reqEditor = null;
  self.reqText = null;          // the text the editor holds, as last read from it
  self.reqError = null;
  self.lint = { text: null, warnings: [] };
  self.question = null;
  self.saving = null;
  self.syncing = false;
  self.urlInput = InputState.new({ placeholder: "URL" });
  self.urlInput.on("change", (_e, cx) => { urlChanged(self); cx.notify(); });
  syncRequest(self, cx);
  cx.spawn(async (cx) => { for (;;) { await drafts.nextChange(); draftChanged(self); cx.notify(); } });
}

export function close(self) {
  self.reqEditor?.release();
  self.reqEditor = null;
  self.urlInput?.release();
  self.urlInput = null;
}

/** Takes the tab's shown Request from the store. A new one is read from disk; the same one again is read again. */
export function syncRequest(self, cx) {
  const req = store.shownRequest(self.tab);
  if (!req || req.n === self.reqSeen) return;
  self.reqSeen = req.n;
  const fresh = req.key !== self.req?.key;
  self.req = req;
  self.reqError = null;
  if (fresh) setText(self, drafts.get(req.key)?.text ?? null);
  cx.spawn(async (cx) => {
    const text = await machine.readText(req.machine, absPath(req));
    if (self.req?.key !== req.key) return;
    if (text == null) self.reqError = `Cannot read ${req.path}.`;
    const rec = drafts.open(req.key, text);
    setText(self, rec?.text ?? null);
    cx.notify();
  });
}

/** Puts `text` in the editor (a new editor for a new Request) and the bar. Change events it causes are ignored. */
function setText(self, text) {
  if (text == null) { self.reqEditor?.release(); self.reqEditor = null; self.reqText = null; return; }
  self.syncing = true;
  try {
    if (!self.reqEditor || self.reqEditorKey !== self.req.key) {
      self.reqEditor?.release();
      const t = theme();
      self.reqEditor = EditorState.new({ language: self.req.format === "yaml" ? "yaml" : "text", value: text, readonly: self.req.machine != null,
        font_family: mono(), font_size: 12, soft_wrap: true,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 } });
      self.reqEditorKey = self.req.key;
      self.reqEditor.on("change", (_e, cx) => { editorChanged(self); cx.notify(); });
    } else if (self.reqEditor.value() !== text) self.reqEditor.set_value(text);
    self.reqText = text;
    const url = readHead(text, self.req.format).url ?? "";
    if (self.urlInput && self.urlInput.value() !== url) self.urlInput.set_value(url);
  } finally { self.syncing = false; }
}

/** The editor's text changed: it becomes the Draft, and the bar follows it. */
export function editorChanged(self) {
  if (self.syncing || !self.reqEditor || !self.req || self.req.machine != null) return;
  const text = self.reqEditor.value();
  if (text === self.reqText) return;
  self.reqText = text;
  drafts.edit(self.req.key, text);
  const url = readHead(text, self.req.format).url ?? "";
  if (self.urlInput.value() !== url) { self.syncing = true; try { self.urlInput.set_value(url); } finally { self.syncing = false; } }
}

/** The URL field changed: its one line in the text changes. */
export function urlChanged(self) {
  if (self.syncing || !self.req || self.reqText == null || self.req.machine != null) return;
  const text = setUrl(self.reqText, self.req.format, self.urlInput.value());
  if (text !== self.reqText) replaceText(self, text);
}

/** The method menu's choice: its one line in the text changes. */
export function methodChosen(self, method) {
  if (!self.req || self.reqText == null || self.req.machine != null) return;
  const text = setMethod(self.reqText, self.req.format, method);
  if (text !== self.reqText) replaceText(self, text);
}

function replaceText(self, text) {
  self.syncing = true;
  try { self.reqEditor?.set_value(text); } finally { self.syncing = false; }
  self.reqText = text;
  drafts.edit(self.req.key, text);
}

/** A Draft changed elsewhere (saved, discarded, reloaded, the file changed on disk). */
function draftChanged(self) {
  const rec = self.req ? drafts.get(self.req.key) : null;
  if (rec && rec.text !== self.reqText) setText(self, rec.text);
}

const target = (req) => ({ key: req.key, machine: req.machine, root: req.root, path: req.path, format: req.format, name: req.name });

/** Save (ctrl-s or the Save action). The tree reloads by the Collection's watch. */
export function save(self, cx) {
  if (!self.req || !drafts.has(self.req.key) || self.saving) return;
  saveflow.saveAll(self, cx, [target(self.req)]);
}

/** Discard and Reload: back to the file on disk, read again. */
export function discard(self, cx) {
  const req = self.req;
  if (!req) return;
  cx.spawn(async (cx) => {
    const text = await machine.readText(req.machine, absPath(req));
    drafts.discard(req.key, text);
    cx.notify();
  });
}

/** Run: a Draft is saved first by the same save path, then the panel copy runs the Request. */
export function runShown(self, cx) {
  const req = self.req;
  if (!req || self.saving) return;
  const start = (cx) => {
    if (!store.runRequest(cx, req.key)) store.ask({ to: "panel", kind: "act", key: req.key, action: "run" });
  };
  if (drafts.has(req.key)) saveflow.saveAll(self, cx, [target(req)], (cx, ok) => { if (ok) start(cx); });
  else start(cx);
}

function openMethodMenu(self) {
  const head = readHead(self.reqText ?? "", self.req.format);
  const items = METHODS.map((m) => ({ label: m, hint: m === head.method ? "✓" : "", ask: { to: self.addr, kind: "method", key: self.req.key, value: m } }));
  openOverlay({ mod: "brunr", kind: "popup", width: 160, height: menuHeight(items), props: { menu: { key: self.req.key, items } } });
}

/** Moves the editor's cursor to the start of a 1-based line. */
function goToLine(self, line) {
  if (!self.reqEditor || !line || self.reqText == null) return;
  let at = 0;
  const lines = self.reqText.split("\n");
  for (let i = 0; i < line - 1 && i < lines.length; i++) at += lines[i].length + 1;
  try { self.reqEditor.set_selected_range({ start: at, end: at }); self.reqEditor.focus(); } catch {}
}

/** True while the pane copy holds the keyboard: its pane is the focused one. */
export function hasKeyboard(self) {
  return panes().some((p) => p.mod === "brunr" && p.tab === self.tab && p.focused);
}

function warnings(self) {
  if (self.reqText == null || !self.req) return [];
  if (self.lint.text !== self.reqText) self.lint = { text: self.reqText, warnings: lintRequest(self.reqText, self.req.format) };
  return self.lint.warnings;
}

const button = (t, id, label, enabled, click, primary = false) => div().id(id).h(24).px(10).flex_none().flex().items_center().rounded(5).text_size(11.5).border_1()
  .border_color(primary && enabled ? t.solid : t.border)
  .when(primary && enabled, (el) => el.bg(t.solid).text_color(t.solid_foreground))
  .when(!enabled, (el) => el.text_color(t.dim))
  .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { cx.stop_propagation(); click(cx); }))
  .child(label);

/** The Request side. `canRun`: false while another Run is in progress. */
export function render(self, t, canRun) {
  const box = v_flex().id("brunr-request").flex_1().min_w(0).min_h(0).overflow_hidden();
  const req = self.req;
  if (!req) return box.child(v_flex().flex_1().items_center().justify_center().p(20).text_color(t.dim).child(div().child("Click a Request in the Brunr panel to show it here.")));
  const text = self.reqText;
  const local = req.machine == null;
  const head = text != null ? readHead(text, req.format) : null;
  const methodOn = local && text != null && canSetMethod(text, req.format);
  const urlOn = local && text != null && canSetUrl(text, req.format);
  const rec = drafts.get(req.key);
  const dirty = drafts.isDraft(rec);
  const method = head?.method ?? "";

  const methodBtn = h_flex().id("brunr-method").h(28).px(8).gap(4).flex_none().items_center().rounded(5).border_1().border_color(t.border)
    .text_size(11.5).font_semibold().text_color(methodOn ? methodColor(t, method) : t.dim)
    .when(methodOn, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { openMethodMenu(self); cx.notify(); }))
    .child(div().child(method || "—"))
    .when(methodOn, (el) => el.child(svg("mods/brunr/icons/chevron-down.svg").size(10).text_color(t.dim)));
  const urlField = urlOn && self.urlInput
    ? Input.new(self.urlInput).flex_1().min_w(0).h(28).px(8).items_center().rounded(5).border(1).border_color(t.border).bg(t.background).text_color(t.foreground).font_family(mono()).text_size(11.5)
    : div().flex_1().min_w(0).h(28).px(8).flex().items_center().rounded(5).border_1().border_color(t.border).font_family(mono()).text_size(11.5).text_color(t.muted).truncate().child(head?.url ?? "");
  const bar = h_flex().id("brunr-request-bar").h(44).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
    .child(methodBtn).child(urlField).child(button(t, "brunr-run", "Run", canRun && !self.saving, (cx) => runShown(self, cx), true));

  const info = h_flex().id("brunr-request-info").h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
    .child(div().flex_none().max_w(200).truncate().font_semibold().child(head?.name ?? req.name ?? ""))
    .child(div().flex_1().min_w(0).truncate().text_ellipsis_start().text_color(t.dim).child(req.path))
    .when(dirty, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_color(t.ansi3).child(div().size(7).rounded(4).bg(t.ansi3)).child("Unsaved")))
    .when(local, (el) => el.child(button(t, "brunr-save", "Save", dirty && !self.saving, (cx) => save(self, cx))).child(button(t, "brunr-discard", "Discard", dirty, (cx) => discard(self, cx))));

  box.child(bar).child(info);
  const note = (color, label) => h_flex().flex_none().mx(10).mt(8).px(10).py(6).gap(8).items_center().rounded(6).bg(t.raised).text_size(11.5).text_color(color)
    .child(svg("mods/brunr/icons/warning.svg").size(12).flex_none()).child(div().flex_1().min_w(0).child(label));
  if (!local) box.child(note(t.muted, "Editing works on this computer only."));
  if (self.reqError) box.child(note(t.blocked, self.reqError));
  if (rec?.changed != null && dirty) {
    box.child(note(t.ansi3, "The file changed on disk.")
      .child(button(t, "brunr-reload-disk", "Reload", true, (cx) => discard(self, cx)))
      .child(button(t, "brunr-keep-mine", "Keep mine", true, (cx) => { drafts.keep(req.key); cx.notify(); })));
  }
  box.child(self.reqEditor ? Editor.new(self.reqEditor).flex_1().min_h(0) : v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(div().child(self.reqError ? "" : "Reading…")));
  const ws = local ? warnings(self) : [];
  if (ws.length) {
    box.child(v_flex().id("brunr-lint").flex_none().max_h(120).overflow_y_scrollbar().px(10).py(6).gap(2).border_t(1).border_color(t.border).text_size(11.5)
      .children(ws.map((w, i) => h_flex().id(`lint-${i}`).flex_none().gap(8).items_start().px(4).py(2).rounded(4)
        .when(w.line != null, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { goToLine(self, w.line); cx.notify(); }))
        .child(svg("mods/brunr/icons/warning.svg").size(11).flex_none().mt(2).text_color(t.ansi3))
        .child(div().w(52).flex_none().text_color(t.dim).child(w.line == null ? "file" : `line ${w.line}`))
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(w.message)))));
  }
  return box;
}
