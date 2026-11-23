// The Request column of the dialog, between the tree and the Response: a bar with the method menu,
// the URL field and Run, a line with the Request's name, path, Draft mark, Save and Discard, Bruno's
// tabs for a YAML HTTP Request (formpanes.js, formui.js) and File (the file as text in an editor),
// lint warnings and the on-disk conflict line. The text is the Draft in drafts.js and the only state
// of truth. This file draws it and turns input into calls. Rules live in edit.js, lint.js,
// drafts.js, saveflow.js, form.js and formview.js.
//
// The dialog makes one column in `init` with a host (see RequestHost), then:
//   show(info, cx, tab?)   a Request selected in the tree. It never runs.
//   clear()                nothing selected
//   draftChanged()         after drafts.nextChange(): a save, a discard, a change on disk
//   save(cx)               ctrl-s and the Save button
//   typing                 true while a field of the column has the keyboard
//   render(t, o)           the column, in the dialog's look
//   close()                from the dialog's close: finishes a save, releases the fields
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState } from "gpui-base";
import { settings } from "herdr";
import { SIZE } from "./kit/theme.js";
import { textInput } from "./kit/controls.js";
import * as drafts from "./drafts.js";
import * as machine from "./machine.js";
import * as saveflow from "./saveflow.js";
import { canSetMethod, canSetUrl, readHead, setMethod } from "./edit.js";
import { setUrlFromBar } from "./urlsync.js";
import { lintRequest } from "./lint.js";
import { readRequestText } from "./parser.js";
import { methodColor } from "./response.js";
import * as formui from "./formui.js";
import * as formpanes from "./formpanes.js";
import { FILE, FORM_NOTE } from "./formview.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {Context | AsyncContext} AnyContext */
/** @typedef {import("./kit/theme.js").Theme} Theme */
/** The Request shown: its tree row's key, its Collection's key and where its file is. @typedef {{ key: string, ck: string, machine: string | null, root: string, path: string, format: string, name: string }} RequestInfo */
/**
 * What the column needs from the dialog.
 * @typedef {object} RequestHost
 * @property {(p: import("./picker.js").Picker, cx?: AnyContext | null) => void} openPicker shows a picker over the dialog
 * @property {(text: string, bad?: boolean) => void} say the line under the panes
 * @property {(cx: AnyContext, key: string) => void} run runs a Request by its key. It saves a Draft first.
 * @property {{ formTab: () => string | null, setFormTab: (name: string) => void }} saved where the form's tab is remembered
 */

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
/** The keyboard's places in the dialog, left to right. */
export const PLACES = ["tree", "request", "response"];
const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");
const absPath = (/** @type {RequestInfo} */ req) => `${String(req.root).replace(/\/+$/, "")}/${req.path}`;
const target = (/** @type {RequestInfo} */ req) => ({ key: req.key, machine: req.machine, root: req.root, path: req.path, format: req.format, name: req.name });

/**
 * Where ctrl-h (`by` -1) or ctrl-l (+1) moves the keyboard. The Request column is skipped when it
 * shows no Request. Pure. @param {string} at @param {number} by @param {boolean} hasRequest
 */
export function stepPlace(at, by, hasRequest) {
  const places = PLACES.filter((p) => p !== "request" || hasRequest);
  const i = Math.max(0, places.indexOf(at === "request" && !hasRequest ? "tree" : at));
  return places[Math.max(0, Math.min(places.length - 1, i + by))];
}

export class RequestColumn {
  /** Call it in `init`: it makes the URL field, which `render` must not. @param {RequestHost} host */
  constructor(host) {
    this.host = host;
    /** @type {RequestInfo | null} */
    this.req = null;
    /** @type {any} the File editor */
    this.reqEditor = null;
    this.reqEditorKey = null;
    /** @type {string | null} the text the editor holds, as last read from it */
    this.reqText = null;
    /** @type {string | null} */
    this.reqError = null;
    /** @type {{ text: string | null, warnings: any[], parses?: boolean }} */
    this.lint = { text: null, warnings: [] };
    /** @type {any} the save in progress (saveflow.js) */
    this.saving = null;
    this.syncing = false;
    /** @type {Set<any>} the column's inputs and editors that have the keyboard */
    this.focused = new Set();
    this.urlInput = InputState.new({ placeholder: "URL" });
    this.urlInput.on("change", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.urlChanged(); cx.notify(); });
    this.watch(this.urlInput);
    formui.initForm(this, (/** @type {string} */ text) => this.applyText(text));
  }

  /** True while a field of the column has the keyboard: tree keys must not run then. */
  get typing() { return this.focused.size > 0; }

  /** Follows a field's focus, for `typing`. @param {any} state an InputState or EditorState */
  watch(state) {
    state.on("focus", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.focused.add(state); cx.notify(); });
    state.on("blur", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.focused.delete(state); cx.notify(); });
  }

  /** A field about to be released. @param {any} state */
  forget(state) { this.focused.delete(state); }

  /** Puts the keyboard in the URL field, or nowhere when it is read-only. True when it did. */
  focusFirst() {
    if (!this.req || this.req.machine != null || this.reqText == null) return false;
    this.urlInput.focus();
    return true;
  }

  /** Ends a save in progress and releases every field. @returns {Promise<void>} */
  async close() {
    await saveflow.settle(this);
    formui.releaseForm(this);
    this.reqEditor?.release();
    this.reqEditor = null;
    this.urlInput?.release();
    this.focused.clear();
  }

  /**
   * Shows a Request, read again from disk. Its Draft, if it has one, is what shows. `tab`: the
   * tab to show it on (File for "Open file"). @param {RequestInfo} info @param {AnyContext} cx @param {string | null} [tab]
   */
  show(info, cx, tab = null) {
    const fresh = info.key !== this.req?.key;
    this.req = info;
    this.reqError = null;
    if (fresh) this.setText(drafts.get(info.key)?.text ?? null);
    if (tab) formui.selectTab(this, tab);
    cx.spawn(async (cx) => {
      const text = await machine.readText(info.machine, absPath(info));
      if (this.req?.key !== info.key) return;
      if (text == null) this.reqError = `Cannot read ${info.path}.`;
      const rec = drafts.open(info.key, text);
      this.setText(rec?.text ?? null);
      cx.notify();
    });
  }

  /** No Request selected: the column empties. Drafts stay. */
  clear() {
    if (!this.req) return;
    this.req = null;
    this.reqError = null;
    this.setText(null);
  }

  /** Puts `text` in the editor (a new editor for a new Request) and the bar. Change events it causes are ignored. @param {string | null} text */
  setText(text) {
    if (text == null || !this.req) {
      if (this.reqEditor) { this.forget(this.reqEditor); this.reqEditor.release(); }
      this.reqEditor = null;
      this.reqEditorKey = null;
      this.reqText = null;
      formui.syncForm(this);
      return;
    }
    this.syncing = true;
    try {
      if (!this.reqEditor || this.reqEditorKey !== this.req.key) {
        if (this.reqEditor) { this.forget(this.reqEditor); this.reqEditor.release(); }
        this.reqEditor = formui.newEditor(this.req.format === "yaml" ? "yaml" : "text", text, this.req.machine != null);
        this.reqEditorKey = this.req.key;
        this.reqEditor.on("change", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.editorChanged(); cx.notify(); });
        this.watch(this.reqEditor);
      } else if (this.reqEditor.value() !== text) this.reqEditor.set_value(text);
      this.reqText = text;
      this.setUrlField(readHead(text, this.req.format).url ?? "");
    } finally { this.syncing = false; }
    formui.syncForm(this);
  }

  /** @param {string} url */
  setUrlField(url) {
    if (this.urlInput.value() === url) return;
    const was = this.syncing;
    this.syncing = true;
    try { this.urlInput.set_value(url); } finally { this.syncing = was; }
  }

  /** The File editor's text changed: it becomes the Draft, and the bar follows it. */
  editorChanged() {
    if (this.syncing || !this.reqEditor || !this.req || this.req.machine != null) return;
    const text = this.reqEditor.value();
    if (text === this.reqText) return;
    this.reqText = text;
    drafts.edit(this.req.key, text);
    this.setUrlField(readHead(text, this.req.format).url ?? "");
    formui.syncForm(this);
  }

  /** The URL field changed: its line in the text changes, and the params follow it as in Bruno. */
  urlChanged() {
    if (this.syncing || !this.req || this.reqText == null || this.req.machine != null) return;
    const text = setUrlFromBar(this.reqText, this.req.format, this.urlInput.value());
    if (text !== this.reqText) this.replaceText(text);
  }

  /** The method menu's choice: its one line in the text changes. @param {string} method */
  methodChosen(method) {
    if (!this.req || this.reqText == null || this.req.machine != null) return;
    const text = setMethod(this.reqText, this.req.format, method);
    if (text !== this.reqText) this.replaceText(text);
  }

  /** @param {string} text */
  replaceText(text) {
    if (!this.req) return;
    this.syncing = true;
    try { this.reqEditor?.set_value(text); } finally { this.syncing = false; }
    this.reqText = text;
    drafts.edit(this.req.key, text);
    formui.syncForm(this);
  }

  /** A form tab's edit: the new text becomes the Draft by the File editor's path, and the URL bar follows it. @param {string} text */
  applyText(text) {
    if (!this.req || this.req.machine != null) return;
    this.setUrlField(readHead(text, this.req.format).url ?? "");
    this.replaceText(text);
  }

  /** A Draft changed elsewhere (saved, discarded, reloaded, the file changed on disk). */
  draftChanged() {
    const rec = this.req ? drafts.get(this.req.key) : null;
    if (rec && rec.text !== this.reqText) this.setText(rec.text);
  }

  /** Save: ctrl-s or the Save button. The tree reloads by the Collection's watch. @param {AnyContext} cx */
  save(cx) {
    if (!this.req || !drafts.has(this.req.key) || this.saving) return;
    saveflow.saveAll(this, cx, [target(this.req)]);
  }

  /**
   * Saves the Drafts of `infos` by the same save path, then calls `then(cx)` when all were saved.
   * The Run uses it. @param {AnyContext} cx @param {RequestInfo[]} infos @param {(cx: AnyContext) => void} then
   */
  saveThen(cx, infos, then) {
    if (this.saving) return this.host.say("A save is in progress");
    saveflow.saveAll(this, cx, infos.map(target), (cx, ok) => { if (ok) then(cx); });
  }

  /** Discard and Reload: back to the file on disk, read again. @param {AnyContext} cx */
  discard(cx) {
    const req = this.req;
    if (!req) return;
    cx.spawn(async (cx) => {
      const text = await machine.readText(req.machine, absPath(req));
      drafts.discard(req.key, text);
      cx.notify();
    });
  }

  /** The method menu, as a picker. @param {AnyContext} cx */
  openMethodMenu(cx) {
    const req = this.req;
    if (!req) return;
    const head = readHead(this.reqText ?? "", req.format);
    this.host.openPicker({
      title: "Method", current: head.method, options: METHODS.map((m) => ({ label: m, value: m })),
      choose: (value) => { if (this.req?.key === req.key) this.methodChosen(value); },
    }, cx);
  }

  /** Moves the File editor's cursor to the start of a 1-based line. @param {number | null} line */
  goToLine(line) {
    if (!line || this.reqText == null) return;
    formui.selectTab(this, FILE);
    if (!this.reqEditor) return;
    let at = 0;
    const lines = this.reqText.split("\n");
    for (let i = 0; i < line - 1 && i < lines.length; i++) at += lines[i].length + 1;
    try { this.reqEditor.set_selected_range({ start: at, end: at }); this.reqEditor.focus(); } catch {}
  }

  /** Lint warnings of the Draft text, read again when the text changed. */
  warnings() {
    if (this.reqText == null || !this.req) return [];
    if (this.lint.text !== this.reqText) {
      let parses = true;
      try { readRequestText(this.reqText, this.req.format); } catch { parses = false; }
      this.lint = { text: this.reqText, warnings: lintRequest(this.reqText, this.req.format), parses };
    }
    return this.lint.warnings;
  }

  /** False when the text does not parse as a Request: such a file cannot run until it is fixed. */
  parses() { this.warnings(); return this.lint.parses !== false; }

  /**
   * The column. `focused`: the keyboard's place is here. `canRun`: no other Run is in progress and
   * the CLI is there. `stacked`: it sits above the Response, so it is short when it shows nothing.
   * @param {Theme} t @param {{ focused: boolean, canRun: boolean, stacked: boolean }} o
   */
  render(t, o) {
    const box = v_flex().id("brunr-request").min_w(0).min_h(0).overflow_hidden().rounded(SIZE.rowRadius).bg(t.background)
      .border_1().border_color(o.focused ? t.input : t.border).text_color(t.foreground).text_size(12.5);
    const req = this.req;
    if (!req) {
      return box.when(o.stacked, (el) => el.flex_none().h(46)).when(!o.stacked, (el) => el.flex_1())
        .child(v_flex().flex_1().items_center().justify_center().px(12).text_color(t.dim).child(div().child("Select a Request to see it here.")));
    }
    box.flex_1();
    const text = this.reqText;
    const local = req.machine == null;
    const head = text != null ? readHead(text, req.format) : null;
    const methodOn = local && text != null && canSetMethod(text, req.format);
    const urlOn = local && text != null && canSetUrl(text, req.format);
    const rec = drafts.get(req.key);
    const dirty = drafts.isDraft(rec);
    const method = head?.method ?? "";
    const methodBtn = formui.menuButton(t, "brunr-method", method || "—", methodOn, (cx) => this.openMethodMenu(cx))
      .h(28).font_semibold().when(methodOn, (el) => el.text_color(methodColor(t, method)));
    const urlField = urlOn
      ? textInput(t, this.urlInput, this.focused.has(this.urlInput)).flex_1().min_w(0).h(28).font_family(mono()).text_size(11.5)
      : div().flex_1().min_w(0).h(28).px(10).flex().items_center().rounded(8).border_1().border_color(t.border).font_family(mono()).text_size(11.5).text_color(t.muted).truncate().child(head?.url ?? "");
    const runOn = o.canRun && !this.saving && (text == null || this.parses());
    box.child(h_flex().id("brunr-request-bar").h(44).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(methodBtn).child(urlField)
      .child(formui.button(t, "brunr-request-run", "Run", runOn, (cx) => this.host.run(cx, req.key), true)));
    box.child(h_flex().id("brunr-request-info").h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
      .child(div().flex_none().max_w(200).truncate().font_semibold().child(head?.name ?? req.name ?? ""))
      .child(div().flex_1().min_w(0).truncate().text_ellipsis_start().text_color(t.dim).child(req.path))
      .when(dirty, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_color(t.ansi3).child(div().size(7).rounded(4).bg(t.ansi3)).child("Unsaved")))
      .when(local, (el) => el.child(formui.button(t, "brunr-save", "Save", dirty && !this.saving, (cx) => this.save(cx)))
        .child(formui.button(t, "brunr-discard", "Discard", dirty, (cx) => this.discard(cx)))));
    /** @param {any} color @param {string} label */
    const note = (color, label) => h_flex().flex_none().mx(10).mt(8).px(10).py(6).gap(8).items_center().rounded(SIZE.rowRadius).bg(t.raised).text_size(11.5).text_color(color)
      .child(svg("mods/brunr/icons/warning.svg").size(12).flex_none()).child(div().flex_1().min_w(0).child(label));
    if (!local) box.child(note(t.muted, "Editing works on this computer only."));
    if (this.reqError) box.child(note(t.blocked, this.reqError));
    if (rec?.changed != null && dirty) {
      box.child(note(t.ansi3, "The file changed on disk.")
        .child(formui.button(t, "brunr-reload-disk", "Reload", true, (cx) => this.discard(cx)))
        .child(formui.button(t, "brunr-keep-mine", "Keep mine", true, () => drafts.keep(req.key))));
    }
    const fileView = () => (this.reqEditor ? Editor.new(this.reqEditor).flex_1().min_h(0) : v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(div().child(this.reqError ? "" : "Reading…")));
    if (formui.tabsOf(this).length) {
      // Bruno's tabs. The notes above and the lint warnings below stay the same on every tab.
      box.child(formui.strip(this, t)).child(formui.onForm(this) ? formpanes.render(this, t, local) : fileView());
    } else {
      if (text != null) box.child(div().flex_none().px(12).py(6).text_size(11.5).text_color(t.dim).child(FORM_NOTE));
      box.child(fileView());
    }
    const ws = local ? this.warnings() : [];
    if (ws.length) {
      box.child(v_flex().id("brunr-lint").flex_none().max_h(120).overflow_y_scrollbar().px(10).py(6).gap(2).border_t(1).border_color(t.border).text_size(11.5)
        .children(ws.map((w, i) => h_flex().id(`lint-${i}`).flex_none().gap(8).items_start().px(4).py(2).rounded(4)
          .when(w.line != null, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.goToLine(w.line); cx.notify(); }))
          .child(svg("mods/brunr/icons/warning.svg").size(11).flex_none().mt(2).text_color(t.ansi3))
          .child(div().w(52).flex_none().text_color(t.dim).child(w.line == null ? "file" : `line ${w.line}`))
          .child(div().flex_1().min_w(0).text_color(t.foreground).child(w.message)))));
    }
    return box;
  }
}
