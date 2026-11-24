// Draws the .env editor (dotedit.js): the .env files on the left with New and Delete, the selected
// file on the right as a table or as Raw text, with Save and Discard. Views hold no rules.
import { div } from "gpui-kit";
import { v_flex, h_flex, Editor } from "gpui-base";
import { theme } from "herdr";
import * as de from "./dotedit.js";
import * as parts from "./editparts.js";
import * as tbl from "./envtable.js";

export function render(self) {
  const t = theme();
  const e = self.ed;
  if (!e) return div();
  const title = `.env files · ${e.root.split("/").pop() || e.root}`;
  if (e.machine != null) return parts.frame(self, t, title, parts.note(t, t.muted, e.error));
  return parts.frame(self, t, title, h_flex().flex_1().min_h(0).items_stretch().child(list(self, t)).child(detail(self, t)));
}

function list(self, t) {
  const e = self.ed;
  const box = v_flex().id("brunr-dot-list").w(200).flex_none().border_r(1).border_color(t.border).bg(t.surface)
    .child(h_flex().h(36).flex_none().px(12).gap(8).items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child("Files"))
      .child(parts.button(t, "brunr-dot-new", "New", !e.busy, () => de.startNew(self))));
  box.child(v_flex().id("brunr-dot-items").flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(e.files.map((name) => {
    const on = name === e.sel;
    const item = v_flex().id(`brunr-dot-${name}`).flex_none().mx(6).px(8).py(5).gap(4).rounded(5).font_family(parts.mono()).text_size(12)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { de.select(self, cx, name); cx.notify(); }))
      .child(div().truncate().child(name));
    if (on) item.child(h_flex().child(parts.button(t, "brunr-dot-delete", "Delete", !e.busy, () => de.startDelete(self), false, true)));
    return item;
  })));
  if (e.sel && e.sel !== ".env") {
    box.child(div().flex_none().px(12).py(10).border_t(1).border_color(t.border).text_size(11).text_color(t.ansi3)
      .child(`Only .env feeds a Run. Brunr does not pass ${e.sel} to the Bruno CLI.`));
  }
  return box;
}

function detail(self, t) {
  const e = self.ed;
  const box = v_flex().id("brunr-dot-detail").flex_1().min_w(0).min_h(0);
  if (e.loading) return box.child(parts.note(t, t.muted, "Reading…"));
  if (!e.sel) return box.child(parts.note(t, t.muted, "This Collection has no .env file. New creates one."));
  const dirty = e.dirty();
  const tab = (id, label, on, click) => div().id(id).h(26).px(10).flex().items_center().rounded(5).text_size(11.5)
    .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
    .when(!on, (el) => el.text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => { click(); cx.notify(); }))
    .child(label);
  box.child(h_flex().h(36).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
    .child(div().flex_none().font_semibold().font_family(parts.mono()).child(e.sel))
    .when(dirty, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_color(t.ansi3).text_size(11.5).child(div().size(7).rounded(4).bg(t.ansi3)).child("Unsaved")))
    .child(div().flex_1())
    .child(tab("brunr-dot-table", "Table", e.view === "table", () => de.showTable(self)))
    .child(tab("brunr-dot-raw", "Raw (shows values)", e.view === "raw", () => de.showRaw(self))));
  if (e.error) return box.child(parts.note(t, t.blocked, e.error));
  if (e.conflict) {
    box.child(parts.note(t, t.ansi3, `${e.sel} changed on disk since it was opened.`,
      parts.button(t, "brunr-dot-reload", "Reload", !e.busy, (cx) => de.reload(self, cx)),
      parts.button(t, "brunr-dot-overwrite", "Overwrite", !e.busy, (cx) => de.overwrite(self, cx), true)));
  }
  if (e.view === "raw" && e.raw) box.child(Editor.new(e.raw).flex_1().min_h(0));
  else if (e.table) box.child(parts.tableView(self, t, { enabled: false, idPrefix: "brunr-dot-row" }));
  const status = e.status?.error ? [t.blocked, e.status.error] : e.status?.ok ? [t.done, e.status.ok]
    : e.view === "table" ? [t.dim, "The table changes only the lines you edit. Comments and blank lines stay."] : null;
  const canSave = dirty && !e.busy && (e.view === "raw" || (e.table && tbl.canSave(e.table)));
  return box.child(h_flex().h(44).flex_none().px(12).gap(8).items_center().border_t(1).border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(status?.[0] ?? t.dim).child(status?.[1] ?? ""))
    .child(parts.button(t, "brunr-dot-discard", "Discard", dirty && !e.busy, (cx) => de.discard(self, cx)))
    .child(parts.button(t, "brunr-dot-save", e.busy ? "Saving…" : "Save", Boolean(canSave), (cx) => de.save(self, cx), true)));
}
