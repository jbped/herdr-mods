// The tree's forms with fields: New Request, New folder, Rename and Clone, drawn over the dialog in
// the look of its "run with values" form. What the person types stays in this form's inputs. The
// dialog runs the operation (treeactions.js) and answers with an error, which shows here, or closes
// the form. Rules live in treeops.js.
//
// In the dialog:
//   init:    this.treeForm = new TreeForm();
//   key:     if (this.treeForm.open) c = this.treeForm.keyCommand(k);   then this.treeForm.command(c, cx)
//   render:  .when(this.treeForm.open, (el) => el.child(this.treeForm.panel(t, close)))
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { settings } from "herdr";
import { SIZE } from "./kit/theme.js";
import { divider } from "./kit/frame.js";
import { legend } from "./kit/legend.js";
import { textInput } from "./kit/controls.js";
import { derivedFile, formErrors } from "./treeops.js";
import { METHODS } from "./request.js";
import { methodColor } from "./response.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("./kit/theme.js").Theme} Theme */
/**
 * What a form asks. `kind`: "newRequest", "newFolder", "clone", "rename" or "renameFile" (a file
 * that does not parse: the file name only). `ext`: the file name's extension, shown after it.
 * @typedef {{ kind: string, title: string, confirm: string, name: string, file: string, ext: string, isFolder: boolean }} FormSpec
 */
/** The values a form hands over. @typedef {{ name: string, file: string, url: string, method: string }} FormValues */

const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");

export class TreeForm {
  constructor() {
    /** @type {(FormSpec & { submit: (values: FormValues, cx: Context | AsyncContext) => void }) | null} */
    this.form = null;
    /** @type {{ name: any, file: any, url: any }} */
    this.inputs = { name: null, file: null, url: null };
    /** @type {Record<string, string>} */
    this.errors = {};
    /** Messages show once the person typed or tried to confirm. */
    this.shown = false;
    /** The file name no longer follows the name once the person edited it, as in Bruno. */
    this.fileTouched = false;
    this.syncing = false;
    this.method = "GET";
    /** @type {string | null} the operation's error, from the dialog */
    this.error = null;
    this.busy = false;
    /** @type {any} the input that has the keyboard */
    this.at = null;
  }

  get open() { return Boolean(this.form); }

  /** The inputs the form shows, in order. */
  fields() {
    const f = this.form;
    if (!f) return [];
    return [f.kind === "renameFile" ? null : this.inputs.name, this.inputs.file, f.kind === "newRequest" ? this.inputs.url : null].filter(Boolean);
  }

  /**
   * Opens a form. `submit(values, cx)` runs the operation, then calls `fail(message)` or `close()`.
   * @param {FormSpec} spec @param {(values: FormValues, cx: Context | AsyncContext) => void} submit
   */
  show(spec, submit) {
    this.close();
    this.form = { ...spec, submit };
    this.errors = {};
    this.shown = false;
    this.error = null;
    this.busy = false;
    this.method = "GET";
    this.fileTouched = spec.kind === "rename" || spec.kind === "renameFile";
    const make = (/** @type {string} */ placeholder, /** @type {string} */ value) => {
      const input = InputState.new({ placeholder, value });
      input.on("submit", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.confirm(cx); cx.notify(); });
      input.on("focus", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.at = input; cx.notify(); });
      return input;
    };
    this.inputs.name = make("Name", spec.name);
    this.inputs.file = make(spec.isFolder ? "Directory name" : "File name", spec.file);
    this.inputs.url = spec.kind === "newRequest" ? make("URL", "") : null;
    this.inputs.name.on("change", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.nameChanged(); cx.notify(); });
    this.inputs.file.on("change", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.fileChanged(); cx.notify(); });
    this.at = this.fields()[0];
    this.at.focus();
  }

  /** Closes the form and forgets what was typed. */
  close() {
    for (const input of Object.values(this.inputs)) input?.release();
    this.inputs = { name: null, file: null, url: null };
    this.form = null;
    this.at = null;
  }

  /** The name changed: the file name follows it until the person edits the file name. */
  nameChanged() {
    if (this.syncing || !this.form) return;
    if (!this.fileTouched) {
      this.syncing = true;
      try { this.inputs.file.set_value(derivedFile(this.inputs.name.value())); } finally { this.syncing = false; }
    }
    this.check(true);
  }

  /** The person edited the file name: it no longer follows the name. */
  fileChanged() {
    if (this.syncing || !this.form) return;
    this.fileTouched = true;
    this.check(true);
  }

  /** @returns {FormValues} */
  values() {
    return { name: this.inputs.name?.value() ?? "", file: this.inputs.file?.value() ?? "", url: this.inputs.url?.value() ?? "", method: this.method };
  }

  /** @param {boolean} show */
  check(show) {
    if (!this.form) return false;
    if (show) this.shown = true;
    this.errors = formErrors(this.form.kind, this.values());
    this.error = null;
    return !Object.keys(this.errors).length;
  }

  /** Enter or the button: the values go to the dialog. @param {Context | AsyncContext} cx */
  confirm(cx) {
    const f = this.form;
    if (!f || this.busy || !this.check(true)) return;
    this.busy = true;
    this.error = null;
    f.submit(this.values(), cx);
  }

  /** The operation failed: its message shows in the form, which stays open. @param {string} message */
  fail(message) {
    this.busy = false;
    this.error = message;
  }

  /** The command a key stands for while the form is open: esc, tab and shift-tab. @param {string} k */
  keyCommand(k) {
    return k === "escape" ? "cancel" : k === "tab" ? "form-next" : k === "shift-tab" ? "form-prev" : "";
  }

  /** @param {string} c @param {Context | AsyncContext} _cx */
  command(c, _cx) {
    const list = this.fields();
    if (!list.length || (c !== "form-next" && c !== "form-prev")) return;
    const i = Math.max(0, list.indexOf(this.at));
    this.at = list[(i + (c === "form-prev" ? -1 : 1) + list.length) % list.length];
    this.at.focus();
  }

  /**
   * The form over the dialog. A press beside it, or Cancel, calls `dismiss`.
   * @param {Theme} t @param {(cx: Context) => void} dismiss
   */
  panel(t, dismiss) {
    const f = /** @type {FormSpec} */ (this.form);
    const err = this.shown ? this.errors : {};
    /** @param {string} id @param {string} label @param {any} input @param {string | null} suffix @param {string | undefined} error */
    const field = (id, label, input, suffix, error) => v_flex().id(id).flex_none().gap(4)
      .child(div().px(4).text_size(SIZE.small).text_color(t.muted).child(label))
      .child(h_flex().gap(6).items_center()
        .child(textInput(t, input, input === this.at).flex_1().min_w(0).when(Boolean(error), (el) => el.border_color(t.blocked)))
        .when(Boolean(suffix), (el) => el.child(div().flex_none().text_size(SIZE.small).text_color(t.dim).child(suffix ?? ""))))
      .child(div().h(14).px(4).text_size(SIZE.small).text_color(t.blocked).child(error ?? ""));
    /** @param {string} id @param {string} label @param {boolean} primary @param {boolean} on @param {(cx: Context) => void} click */
    const button = (id, label, primary, on, click) => div().id(id).h(28).px(12).flex().items_center().rounded(8).border_1()
      .border_color(primary && on ? t.solid : t.border).when(primary && on, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!on, (el) => el.text_color(t.dim)).when(on, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => { click(cx); cx.notify(); }))
      .child(label);
    const box = v_flex().id("brunr-form").absolute().top(60).left(SIZE.framePad).w(460).max_w("100%").p(12).gap(8)
      .bg(t.popover).rounded(12).border_1().border_color(t.border).shadow_lg().text_size(SIZE.text)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .child(div().px(4).font_semibold().text_color(t.foreground).child(f.title));
    if (f.kind !== "renameFile") box.child(field("brunr-form-name", "Name", this.inputs.name, null, err.name));
    box.child(field("brunr-form-file", f.isFolder ? "Directory name" : "File name", this.inputs.file, f.ext || null, err.file));
    if (f.kind === "newRequest") {
      box.child(v_flex().flex_none().gap(4).child(div().px(4).text_size(SIZE.small).text_color(t.muted).child("Method"))
        .child(h_flex().gap(4).flex_wrap().children(METHODS.map((m) => div().id(`brunr-form-m-${m}`).h(24).px(7).flex().items_center().rounded(6).cursor_pointer()
          .text_size(SIZE.small).font_semibold().border_1().border_color(m === this.method ? t.accent : t.border).text_color(methodColor(t, m))
          .when(m === this.method, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.method = m; cx.notify(); })
          .child(m)))));
      box.child(v_flex().flex_none().gap(4).child(div().px(4).text_size(SIZE.small).text_color(t.muted).child("URL"))
        .child(textInput(t, this.inputs.url, this.inputs.url === this.at).font_family(mono()).text_size(SIZE.small)));
    }
    if (this.error) box.child(div().px(4).text_size(SIZE.small).text_color(t.blocked).child(this.error));
    box.child(h_flex().flex_none().gap(8).justify_end()
      .child(button("brunr-form-cancel", "Cancel", false, true, dismiss))
      .child(button("brunr-form-ok", this.busy ? "Working…" : f.confirm, true, !this.busy, (cx) => this.confirm(cx))))
      .child(divider(t))
      .child(legend(t, [["tab", "next"], ["enter", f.confirm.toLowerCase()], ["esc", "back"]]));
    return div().id("brunr-form-around").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { dismiss(cx); cx.stop_propagation(); cx.notify(); })
      .on_click((_e, cx) => cx.stop_propagation())
      .child(box);
  }
}
