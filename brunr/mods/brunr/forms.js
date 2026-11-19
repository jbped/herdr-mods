// The tree's dialogs with fields: New Request, New folder, Rename and Clone. Drawn by a brunr copy
// opened as a dialog with props `{ form }`. What the person types stays in memory (store.setForm);
// the ask to the panel carries only the form's id. The panel runs the operation and answers with
// an error, which shows here, or `done`, which closes the dialog. Rules live in treeops.js.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { closeOverlay, props, settings, theme } from "herdr";
import * as store from "./store.js";
import { derivedFile, formErrors } from "./treeops.js";
import { METHODS } from "./request.js";
import { methodColor } from "./panel.js";

const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");

/** The dialog's height for a form: title, the fields with room for their messages, the buttons. */
export function formHeight(f) {
  return 130 + (f.kind === "renameFile" ? 0 : 66) + 66 + (f.kind === "newRequest" ? 112 : 0);
}

export function init(self, cx) {
  const f = props().form;
  self.form = f;
  self.overlayId = props().overlay;  // props() is not there in a task, so it is kept
  self.errors = {};
  self.shown = false;            // messages show once the person typed or tried to confirm
  self.fileTouched = f.kind === "rename" || f.kind === "renameFile";
  self.method = f.method ?? "GET";
  self.syncing = false;
  self.nameInput = InputState.new({ placeholder: "Name", value: f.name ?? "" });
  self.fileInput = InputState.new({ placeholder: f.kind === "newFolder" || f.isFolder ? "Directory name" : "File name", value: f.file ?? "" });
  self.urlInput = f.kind === "newRequest" ? InputState.new({ placeholder: "URL", value: "" }) : null;
  self.nameInput.on("change", (_e, cx) => { nameChanged(self); cx.notify(); });
  self.fileInput.on("change", (_e, cx) => { fileChanged(self); cx.notify(); });
  for (const input of [self.nameInput, self.fileInput, self.urlInput]) input?.on("submit", (_e, cx) => { confirm(self); cx.notify(); });
  (f.kind === "renameFile" ? self.fileInput : self.nameInput).focus();
  cx.spawn(async (cx) => {
    for (;;) {
      await store.nextChange();
      if (store.form(f.id)?.done) { closeOverlay(self.overlayId); return; }
      cx.notify();
    }
  });
}

export function close(self) {
  if (!store.form(self.form.id)?.done) store.dropForm(self.form.id);
  for (const input of [self.nameInput, self.fileInput, self.urlInput]) input?.release();
}

/** The name changed: the file name follows it until the person edits the file name, as in Bruno. */
export function nameChanged(self) {
  if (self.syncing) return;
  if (!self.fileTouched) { self.syncing = true; try { self.fileInput.set_value(derivedFile(self.nameInput.value())); } finally { self.syncing = false; } }
  check(self, true);
}

/** The person edited the file name: it no longer follows the name. */
export function fileChanged(self) {
  if (self.syncing) return;
  self.fileTouched = true;
  check(self, true);
}

const values = (self) => ({ name: self.nameInput.value(), file: self.fileInput.value(), url: self.urlInput?.value() ?? "", method: self.method });

function check(self, show) {
  if (show) self.shown = true;
  self.errors = formErrors(self.form.kind, values(self));
  return !Object.keys(self.errors).length;
}

/** Enter or the button: the values go to the panel, which answers with an error or closes the dialog. */
function confirm(self) {
  if (store.form(self.form.id)?.busy || !check(self, true)) return;
  store.setForm(self.form.id, { values: values(self), busy: true, error: null });
  store.ask({ kind: "form", flow: self.form.id });
}

function field(self, t, _id, label, input, suffix, error) {
  return v_flex().flex_none().gap(4)
    .child(div().text_size(11.5).text_color(t.muted).child(label))
    .child(h_flex().gap(6).items_center()
      .child(Input.new(input).flex_1().min_w(0).h(28).px(8).items_center().rounded(5).border(1).border_color(error ? t.blocked : t.border).bg(t.background).text_color(t.foreground).text_size(12.5))
      .when(Boolean(suffix), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(suffix))))
    .child(div().h(14).text_size(11).text_color(t.blocked).child(error ?? ""));
}

export function render(self) {
  const t = theme();
  const f = self.form;
  const state = store.form(f.id) ?? {};
  const err = self.shown ? self.errors : {};
  const root = v_flex().id("brunr-form").size_full().p(14).gap(8).bg(t.popover).text_color(t.foreground).text_size(12.5)
    .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(self.overlayId); cx.stop_propagation(); } })
    .child(div().font_semibold().text_size(13.5).child(f.title));
  if (f.kind !== "renameFile") root.child(field(self, t, "brunr-form-name", "Name", self.nameInput, null, err.name));
  root.child(field(self, t, "brunr-form-file", f.isFolder ? "Directory name" : "File name", self.fileInput, f.ext || null, err.file));
  if (f.kind === "newRequest") {
    root.child(v_flex().flex_none().gap(4).child(div().text_size(11.5).text_color(t.muted).child("Method"))
      .child(h_flex().gap(4).children(METHODS.map((m) => div().id(`brunr-form-m-${m}`).h(24).px(7).flex().items_center().rounded(5).cursor_pointer()
        .text_size(11).font_semibold().border_1().border_color(m === self.method ? t.accent : t.border).text_color(methodColor(t, m))
        .when(m === self.method, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { self.method = m; cx.notify(); })
        .child(m)))));
    root.child(v_flex().flex_none().gap(4).child(div().text_size(11.5).text_color(t.muted).child("URL"))
      .child(Input.new(self.urlInput).h(28).px(8).items_center().rounded(5).border(1).border_color(t.border).bg(t.background).text_color(t.foreground).font_family(mono()).text_size(11.5)));
  }
  root.child(div().flex_1());
  if (state.error) root.child(div().flex_none().text_size(11.5).text_color(t.blocked).child(state.error));
  const button = (id, label, primary, click, enabled = true) => div().id(id).h(28).px(12).flex().items_center().rounded(5).border_1()
    .border_color(primary ? t.accent : t.border).when(primary && enabled, (el) => el.bg(t.solid).text_color(t.solid_foreground))
    .when(!enabled, (el) => el.text_color(t.dim)).when(enabled, (el) => el.cursor_pointer().on_click((_e, cx) => { click(); cx.notify(); }))
    .child(label);
  return root.child(h_flex().flex_none().gap(8).justify_end()
    .child(button("brunr-form-cancel", "Cancel", false, () => closeOverlay(self.overlayId)))
    .child(button("brunr-form-ok", state.busy ? "Working…" : f.confirm, true, () => confirm(self), !state.busy)));
}

/** For the test hook and the keys: confirm as Enter does. */
export const submit = confirm;
