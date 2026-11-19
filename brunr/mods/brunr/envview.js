// Draws the Environment editor (envedit.js): the Environments on the left with New, and Clone,
// Rename and Delete on the selected one; its table on the right with Save and Discard. Views hold
// no rules: a click calls envedit.js or editparts.js.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme } from "herdr";
import * as ed from "./envedit.js";
import * as parts from "./editparts.js";
import * as tbl from "./envtable.js";

const root = (self) => self.ed.root.split("/").pop() || self.ed.root;

export function render(self) {
  const t = theme();
  const e = self.ed;
  if (!e) return div();
  const title = `Environments · ${root(self)}`;
  if (e.machine != null || (!e.format && !e.loading)) return parts.frame(self, t, title, parts.note(t, t.muted, e.error ?? "Nothing to edit."));
  return parts.frame(self, t, title, h_flex().flex_1().min_h(0).items_stretch().child(list(self, t)).child(detail(self, t)));
}

function list(self, t) {
  const e = self.ed;
  const box = v_flex().id("brunr-env-list").w(200).flex_none().border_r(1).border_color(t.border).bg(t.surface)
    .child(h_flex().h(36).flex_none().px(12).gap(8).items_center()
      .child(div().flex_1().text_size(11.5).text_color(t.muted).child("Environments"))
      .child(parts.button(t, "brunr-env-new", "New", !e.busy && Boolean(e.format), () => ed.startNew(self))));
  const items = e.list.map((env) => {
    const on = env.path === e.sel;
    const item = v_flex().id(`brunr-env-${env.path}`).flex_none().mx(6).px(8).py(5).gap(4).rounded(5)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { ed.select(self, cx, env.path); cx.notify(); }))
      .child(div().truncate().child(env.name));
    if (on) {
      item.child(h_flex().gap(4)
        .child(parts.button(t, "brunr-env-clone", "Clone", !e.busy, () => ed.startClone(self, env), false, true))
        .child(parts.button(t, "brunr-env-rename", "Rename", !e.busy, () => ed.startRename(self, env), false, true))
        .child(parts.button(t, "brunr-env-delete", "Delete", !e.busy, () => ed.startDelete(self, env), false, true)));
    }
    return item;
  });
  box.child(v_flex().id("brunr-env-items").flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(items));
  if (!e.list.length && !e.loading) box.child(div().px(12).pb(8).text_size(11.5).text_color(t.dim).child("No Environment yet. New creates one."));
  return box.child(h_flex().flex_none().px(12).py(10).border_t(1).border_color(t.border)
    .child(parts.button(t, "brunr-env-dotenv", "Edit .env…", true, () => ed.openDotenv(self))));
}

function detail(self, t) {
  const e = self.ed;
  const box = v_flex().id("brunr-env-detail").flex_1().min_w(0).min_h(0);
  if (e.loading) return box.child(parts.note(t, t.muted, "Reading…"));
  if (!e.sel) return box.child(parts.note(t, t.muted, "Choose an Environment, or create one with New."));
  const dirty = e.dirty();
  box.child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
    .child(div().flex_none().font_semibold().child(e.envName ?? ""))
    .child(div().flex_1().min_w(0).truncate().text_color(t.dim).text_size(11.5).child(e.sel))
    .when(dirty, (el) => el.child(h_flex().flex_none().gap(4).items_center().text_color(t.ansi3).text_size(11.5).child(div().size(7).rounded(4).bg(t.ansi3)).child("Unsaved"))));
  if (e.error) return box.child(parts.note(t, t.blocked, e.error));
  if (e.conflict) {
    box.child(parts.note(t, t.ansi3, `${e.fileLabel()} changed on disk since it was opened.`,
      parts.button(t, "brunr-env-reload", "Reload", !e.busy, (cx) => ed.reload(self, cx)),
      parts.button(t, "brunr-env-overwrite", "Overwrite", !e.busy, (cx) => ed.overwrite(self, cx), true)));
  }
  if (!e.table) return box;
  const secretCell = (row) => h_flex().flex_1().min_w(0).gap(8).items_center()
    .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(parts.SECRET_TEXT))
    .child(parts.button(t, `brunr-env-move-${row.id}`, "Move to .env", !e.busy && !dirty, () => ed.startMove(self, row)));
  box.child(parts.tableView(self, t, { enabled: true, secretCell, idPrefix: "brunr-env-row" }));
  const status = e.status?.error ? [t.blocked, e.status.error] : e.status?.ok ? [t.done, e.status.ok]
    : dirty && e.table.rows.some((r) => r.secret) ? [t.dim, "Move to .env works once the changes are saved or discarded."] : null;
  return box.child(h_flex().h(44).flex_none().px(12).gap(8).items_center().border_t(1).border_color(t.border)
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(status?.[0] ?? t.dim).child(status?.[1] ?? ""))
    .child(parts.button(t, "brunr-env-discard", "Discard", dirty && !e.busy, (cx) => ed.discard(self, cx)))
    .child(parts.button(t, "brunr-env-save", e.busy ? "Saving…" : "Save", dirty && !e.busy && tbl.canSave(e.table), (cx) => ed.save(self, cx), true)));
}
