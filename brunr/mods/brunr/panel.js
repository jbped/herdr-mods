// The panel: Collections as a tree, as Bruno's sidebar draws them, in the Herdr theme's colours.
// It draws and turns clicks into calls on the copy (main.js). It holds no rules.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings, theme } from "herdr";
import * as store from "./store.js";
import * as drafts from "./drafts.js";
import * as sources from "./sources.js";
import { foldable, runMark, runsMany, secretWarning } from "./tree.js";
import * as actions from "./actions.js";

const ICON = (name) => `mods/brunr/icons/${name}.svg`;
const METHOD_COLOR = { GET: "ansi2", POST: "ansi5", PUT: "ansi3", PATCH: "ansi6", DELETE: "ansi1" };
const METHOD_SHORT = { DELETE: "DEL", OPTIONS: "OPT", GRAPHQL: "GQL", CONNECT: "CONN" };
const ROW = 26;
const INDENT = 14;

/** A method as Bruno's sidebar shows it: short text in the method's colour, in a fixed width. */
export function methodBadge(t, method, width = 34) {
  const m = String(method ?? "").toUpperCase();
  return div().w(width).flex_none().text_size(10).font_semibold().text_color(t[METHOD_COLOR[m] ?? "muted"]).truncate().child(METHOD_SHORT[m] ?? m);
}

export const methodColor = (t, method) => t[METHOD_COLOR[String(method ?? "").toUpperCase()] ?? "muted"];

/** What a copy that has nothing to show draws. */
export function empty() {
  return div().size_full();
}

const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");

export function render(self, cx) {
  const t = theme();
  self.kb = self.handle.is_focused() && !self.gone;
  if (self.kb) self.heldAt = Date.now();
  const rows = self.buildRows();
  const body = v_flex().id("brunr-tree").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(self.scroll).px(4).py(2);
  rows.forEach((r, i) => body.child(rowView(self, t, r, i)));
  if (self.reveal) {
    const at = rows.findIndex((r) => r.key === self.reveal);
    self.reveal = null;
    if (at >= 0) { try { self.scroll.scroll_to_item(at); } catch {} }
  }
  if (!rows.length) body.child(emptyNote(self, t));

  return v_flex().id("brunr").track_focus(self.handle).size_full().min_h(0).overflow_hidden()
    .bg(t.chrome).border_1().border_color(self.kb ? t.accent : t.border).rounded(8).text_color(t.foreground).text_size(12.5)
    .on_key_down((e, cx) => self.panelKey(e, cx))
    .on_mouse_down("left", (_e, cx) => { self.gone = false; self.handle.focus(); cx.notify(); })
    .on_mouse_down_out((_e, cx) => { if (!self.gone) { self.gone = true; cx.notify(); } })
    // A release that no row took ends a drag with no drop.
    .on_mouse_up("left", (_e, cx) => { if (actions.cancelDrag(self)) cx.notify(); })
    .child(header(self, t))
    .children(notices(self, t))
    .child(body)
    .child(footer(self, t, rows.find((r) => r.key === self.sel) ?? null));
}

function header(self, t) {
  return h_flex().h(38).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
    .child(div().font_semibold().text_size(13).child("Brunr"))
    .child(div().flex_1())
    .when(self.loadingAll || self.busy, (el) => el.child(svg(ICON("spinner")).size(13).text_color(t.dim).spin(900)))
    .child(iconButton(t, "brunr-reload", "reload", "Read brunr.json, the workspace and every Collection again", (cx) => cx.spawn(async (cx) => { await self.reload(cx); })));
}

function iconButton(t, id, icon, tip, click) {
  return div().id(id).size(22).flex_none().rounded(5).flex().items_center().justify_center().cursor_pointer().text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_click((_e, cx) => { cx.stop_propagation(); click(cx); })
    .child(svg(ICON(icon)).size(13));
}

/** Config problems, and the install step for each Machine where `bru` is missing. */
function notices(self, t) {
  const out = [];
  for (const p of self.found?.problems ?? []) {
    out.push(h_flex().flex_none().mx(8).mt(8).px(10).py(7).gap(8).items_start().rounded(6).bg(t.raised).text_size(11.5).text_color(t.blocked)
      .child(svg(ICON("warning")).size(13).flex_none().mt(1)).child(div().flex_1().min_w(0).child(p)));
  }
  for (const [m, c] of Object.entries(self.cli)) {
    if (!c || c === "checking" || c.bru) continue;
    const where = m || "this computer";
    out.push(v_flex().flex_none().mx(8).mt(8).px(10).py(8).gap(6).rounded(6).bg(t.raised).border_1().border_color(t.border).text_size(11.5)
      .child(h_flex().gap(8).items_center().text_color(t.ansi3).child(svg(ICON("warning")).size(13).flex_none()).child(div().font_semibold().child(`No Bruno CLI on ${where}. Runs are off.`)))
      .child(div().text_color(t.muted).child(c.step.text))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().font_family(mono()).text_size(11).text_color(t.foreground).child(c.step.copy))
        .child(div().id(`copy-${m}`).px(8).h(22).flex_none().flex().items_center().rounded(5).bg(t.solid).text_color(t.solid_foreground).cursor_pointer().text_size(11)
          .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(c.step.copy); })
          .child("Copy"))));
  }
  return out;
}

function emptyNote(self, t) {
  const note = (text) => div().px(10).py(10).text_size(12).text_color(t.dim).child(text);
  const f = self.found;
  if (!f) return note("Reading Collections…");
  if (f.workspace.missing) return note(`No Bruno workspace at ${f.workspace.path}. Set "workspace" or "collections" in ${sources.configPath()}.`);
  return note(`The workspace lists no Collections. Add one in Bruno, or list one under "collections" in ${sources.configPath()}.`);
}

function rowView(self, t, r, i) {
  const sel = r.key === self.sel;
  const hovered = r.key === self.hover;
  const running = store.running();
  const mark = runMark(r, running);
  // Drag and drop: the row is the handle. The rules are in treeops.js; this only reports the pointer.
  const drag = actions.dragMark(self, r);
  const el = h_flex().id(`row-${i}-${r.key}`).relative().h(ROW).flex_none().w_full().pl(6 + r.depth * INDENT).pr(4).gap(6).items_center().rounded(5).cursor_pointer()
    .when(sel, (e) => e.bg(self.kb ? t.selected : t.hover))
    .hover((s) => s.bg(sel ? t.selected : t.hover))
    .when(drag === "inside", (e) => e.bg(t.selected).border_1().border_color(t.accent))
    .when(drag === "dragged", (e) => e.opacity(0.5))
    .when(drag === "above" || drag === "below", (e) => e.child(div().absolute().left(0).right(0).h(2).bg(t.accent).when(drag === "below", (l) => l.bottom(0)).when(drag === "above", (l) => l.top(0))))
    .on_hover((h, cx) => { if (h) self.hover = r.key; else if (self.hover === r.key) self.hover = null; cx.notify(); })
    .on_click((e, cx) => self.clickRow(cx, r, e))
    .on_mouse_down("left", () => actions.press(self, r))
    .on_mouse_move((e, cx) => actions.hover(self, r, e, cx))
    .on_mouse_up("left", (_e, cx) => { actions.release(self, r, cx); cx.notify(); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); self.openMenu(r); cx.notify(); });

  if (r.kind === "machine") {
    return el.h(24).text_size(10.5).font_semibold().text_color(t.dim).child(div().flex_1().truncate().child(String(r.name).toUpperCase()));
  }
  if (r.kind === "global") {
    return el.child(svg(ICON("globe")).size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.name))
      .child(chip(self, t, `global-${r.key}`, r.env, "None", false, (cx) => { self.sel = r.key; self.openGlobalPicker(r); cx.notify(); }));
  }
  if (foldable(r)) {
    el.child(div().id(`fold-${r.key}`).size(14).flex_none().flex().items_center().justify_center().text_color(t.dim)
      .on_click((_e, cx) => { cx.stop_propagation(); self.toggle(cx, r); })
      .child(svg(ICON(r.open ? "chevron-down" : "chevron-right")).size(12)));
  }
  if (r.kind === "collection") {
    el.child(div().flex_1().min_w(0).truncate().font_medium().child(r.name));
    if (r.loading) el.child(svg(ICON("spinner")).size(12).flex_none().text_color(t.dim).spin(900));
    if (r.error) el.child(svg(ICON("warning")).size(13).flex_none().text_color(t.blocked).tooltip(r.error));
    if (r.errors.length) el.child(div().px(5).h(16).flex_none().flex().items_center().rounded(8).bg(t.raised).text_size(10).text_color(t.blocked).tooltip(`${r.errors.length} ${r.errors.length === 1 ? "file" : "files"} could not be read`).child(String(r.errors.length)));
    if (!r.error && !r.loading) el.child(chip(self, t, `env-${r.key}`, r.env, "No Environment", r.secrets.length > 0, (cx) => { self.sel = r.key; self.openEnvPicker(r); cx.notify(); }));
  } else if (r.kind === "folder") {
    el.child(svg(ICON("folder")).size(13).flex_none().text_color(t.muted)).child(div().flex_1().min_w(0).truncate().child(r.name));
  } else if (r.broken) {
    // A file that does not parse: its file name, a warning mark and no method.
    el.child(div().w(14).flex_none()).child(div().w(34).flex_none().child(svg(ICON("warning")).size(12).text_color(t.blocked)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(r.name));
  } else {
    el.child(div().w(14).flex_none()).child(methodBadge(t, r.method)).child(div().flex_1().min_w(0).truncate().child(r.name));
    if (drafts.has(r.key)) el.child(div().size(7).flex_none().rounded(4).bg(t.ansi3).tooltip("Unsaved changes"));
  }
  if (mark.count) el.child(div().flex_none().text_size(10.5).text_color(t.muted).child(mark.count));
  if (mark.spinner) return el.child(div().size(18).flex_none().flex().items_center().justify_center().child(svg(ICON("spinner")).size(12).text_color(t.working).spin(900)));
  if (runsMany(r) && (hovered || sel) && !r.error) {
    const can = self.canRun(r);
    el.child(div().id(`run-${r.key}`).size(18).flex_none().rounded(4).flex().items_center().justify_center()
      .text_color(can ? t.done : t.dim).tooltip(can ? `Run ${r.count} ${r.count === 1 ? "Request" : "Requests"} (r)` : running ? "Another Run is in progress" : "No Bruno CLI on this Machine")
      .when(can, (e) => e.cursor_pointer().hover((s) => s.bg(t.raised)).on_click((_e, cx) => { cx.stop_propagation(); self.sel = r.key; self.runKey(cx, r.key, false); cx.notify(); }))
      .child(svg(ICON("play")).size(10)));
  }
  return el;
}

function chip(self, t, id, name, placeholder, warn, click) {
  return h_flex().id(id).h(18).max_w(120).flex_none().px(6).gap(4).items_center().rounded(4).border_1().border_color(t.border).text_size(10.5).cursor_pointer()
    .hover((s) => s.bg(t.raised)).tooltip(warn ? "This Environment has secret variables. Select the row for details." : "Pick the Environment (e)")
    .on_click((_e, cx) => { cx.stop_propagation(); click(cx); })
    .when(warn, (e) => e.child(svg(ICON("warning")).size(11).flex_none().text_color(t.ansi3)))
    .child(div().min_w(0).truncate().text_color(name ? t.foreground : t.dim).child(name ?? placeholder));
}

/** The selected row's details: a Request's method and URL, a Collection's errors, secret warnings. */
function footer(self, t, r) {
  const box = v_flex().id("brunr-footer").flex_none().px(12).py(9).gap(5).border_t(1).border_color(t.border).text_size(11.5);
  const dim = (text) => div().text_color(t.dim).child(text);
  const now = store.running()?.progress?.running;
  if (now) box.child(h_flex().gap(6).items_center().text_color(t.muted)
    .child(svg(ICON("spinner")).size(11).flex_none().text_color(t.working).spin(900))
    .child(div().flex_1().min_w(0).truncate().child(`Running: ${now.name}`)));
  if (!r || r.kind === "machine") return box.child(dim("Click shows a Request in the pane. o opens it. Double-click or Enter runs it."));
  const coll = r.ck ? self.rows.find((x) => x.key === r.ck) : null;
  if (r.kind === "request" && r.broken) {
    box.child(div().text_color(t.blocked).child(`${r.path} does not parse: ${r.error}`));
    box.child(dim("o opens it as text. It cannot run until it parses."));
  } else if (r.kind === "request") {
    box.child(h_flex().gap(6).items_start().child(methodBadge(t, r.method, 40)).child(div().flex_1().min_w(0).font_family(mono()).text_size(11).text_color(t.foreground).child(r.url || "(no URL)")));
  } else if (r.kind === "global") {
    box.child(dim(`Applies to every Collection of this workspace. ${r.env ? `Now: ${r.env}.` : "None chosen."}`));
  } else if (r.kind === "folder") {
    box.child(dim(`${r.count} ${r.count === 1 ? "Request" : "Requests"}. r or the play button runs them.`));
  } else if (r.kind === "collection") {
    if (r.error) box.child(div().text_color(t.blocked).child(r.error));
    else box.child(dim(`${r.count} ${r.count === 1 ? "Request" : "Requests"} on ${r.machine ?? "this computer"}.`));
    if (r.errors.length) {
      box.child(div().text_color(t.blocked).child(`${r.errors.length} ${r.errors.length === 1 ? "file" : "files"} could not be read:`));
      for (const e of r.errors.slice(0, 5)) box.child(div().text_color(t.muted).truncate().child(`${e.path}: ${e.message}`));
    }
  }
  if (coll) {
    const warn = secretWarning(coll.secrets);
    box.child(h_flex().gap(6).items_center().text_color(t.dim)
      .child(div().child("Environment:")).child(div().text_color(coll.env ? t.foreground : t.dim).child(coll.env ?? "No Environment")));
    if (warn) box.child(h_flex().gap(6).items_start().text_color(t.ansi3).child(svg(ICON("warning")).size(12).flex_none().mt(1)).child(div().flex_1().min_w(0).child(warn)));
  }
  return box;
}
