// The bodies of the Request form's tabs. Each draws from readTab of the Draft text (formui.readOf)
// and the fields formui.syncForm made; every edit goes through formui.editTab or a field's change
// handler, so the Draft text stays the only state of truth. Rules live in formview.js.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { SETTINGS_FIELDS } from "./form.js";
import * as fv from "./formview.js";
import * as ui from "./formui.js";

/** The shown form tab's body. `local`: false for another Machine's Request, which is read-only. */
export function render(self, t, local) {
  const tab = self.form.tab;
  const r = ui.readOf(self, tab);
  if (!r.ok) return unreadable(self, t);
  const d = r.data;
  switch (tab) {
    case "params": return scroll(t, "params", [ui.title(t, "Query"), ui.rowTable(self, t, "query", d, local)]
      .concat(d.path.length ? [ui.title(t, "Path"), ui.rowTable(self, t, "path", d, local)] : []));
    case "headers": return scroll(t, "headers", [ui.rowTable(self, t, "headers", d, local)]);
    case "body": return body(self, t, d, local);
    case "auth": return auth(self, t, d, local);
    case "vars": return scroll(t, "vars", [ui.title(t, "Pre Request"), ui.rowTable(self, t, "pre", d, local), ui.title(t, "Post Response"), ui.rowTable(self, t, "post", d, local)]);
    case "script": return v_flex().id("brunr-form-script").flex_1().min_h(0)
      .child(ui.title(t, "Pre Request")).child(ui.editorOf(self, t, "script:pre"))
      .child(ui.title(t, "Post Response")).child(ui.editorOf(self, t, "script:post"));
    case "assert": return scroll(t, "assert", [ui.rowTable(self, t, "assert", d, local)]);
    case "tests": return v_flex().id("brunr-form-tests").flex_1().min_h(0).pt(4).child(ui.editorOf(self, t, "tests"));
    case "docs": return v_flex().id("brunr-form-docs").flex_1().min_h(0).pt(4).child(ui.editorOf(self, t, "docs"));
    case "settings": return settingsView(self, t, d, local);
  }
  return v_flex().flex_1();
}

const scroll = (t, id, parts) => v_flex().id(`brunr-form-${id}`).flex_1().min_h(0).overflow_y_scrollbar().pb(8).children(parts);

/** A section the reader does not expect: no controls, and a way to File. */
function unreadable(self, t) {
  return v_flex().id("brunr-form-unreadable").flex_1().items_center().justify_center().gap(10).p(20)
    .child(h_flex().gap(8).items_center().text_color(t.ansi3)
      .child(svg("mods/brunr/icons/warning.svg").size(13).flex_none()).child(div().child(fv.UNREADABLE_NOTE)))
    .child(ui.button(t, "brunr-form-open-file", "Open File", true, () => ui.selectTab(self, fv.FILE), true));
}

const toolbar = () => h_flex().h(40).flex_none().px(12).gap(8).items_center();

function body(self, t, d, local) {
  const bar = toolbar().child(ui.menuButton(t, "brunr-body-mode", fv.BODY_LABELS[d.mode], local,
    (cx) => ui.openMenu(self, "bodyMode", null, fv.BODY_MENU, fv.BODY_LABELS, d.mode, cx)));
  if (d.mode === "json") {
    bar.child(div().flex_1()).child(ui.button(t, "brunr-body-prettify", "Prettify", local, () => prettify(self)));
  }
  const box = v_flex().id("brunr-form-body").flex_1().min_h(0).child(bar);
  if (self.form.note) box.child(div().flex_none().px(12).pb(6).text_size(11.5).text_color(t.blocked).child(self.form.note));
  if (d.mode === "none") return box.child(v_flex().flex_1().items_center().justify_center().text_color(t.dim).child(div().child("No Body")));
  if (d.mode === "form-urlencoded" || d.mode === "multipart-form") return box.child(scroll(t, "body-rows", [ui.rowTable(self, t, "form", d, local)]));
  return box.child(ui.editorOf(self, t, `body:${d.mode}`));
}

/** Prettify (JSON): reformats valid JSON, else says so and changes nothing. */
function prettify(self) {
  ui.editTab(self, (d) => {
    if (d.mode !== "json") return null;
    const p = fv.prettifyJson(d.text);
    if (!p.ok) { self.form.note = p.message; return null; }
    return p.text === d.text ? null : { ...d, text: p.text };
  });
}

const label = (t, text) => div().flex_none().pb(4).text_size(11.5).text_color(t.muted).child(text);

/** A labelled input; `masked` adds the reveal toggle. */
function labelled(self, t, text, id, masked = false) {
  const row = h_flex().gap(6).items_center().child(ui.field(self, t, id))
    .when(masked, (el) => el.child(ui.iconButton(t, `brunr-reveal-${id.replace(":", "-")}`, self.form.reveal.has(id) ? "eye-off" : "eye", true, () => ui.toggleReveal(self, id))));
  return v_flex().flex_none().px(12).pt(8).child(label(t, text)).child(row);
}

function auth(self, t, d, local) {
  const box = v_flex().id("brunr-form-auth").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
    .child(toolbar().child(ui.menuButton(t, "brunr-auth-mode", fv.AUTH_LABELS[d.mode], local,
      (cx) => ui.openMenu(self, "authMode", null, fv.AUTH_MENU, fv.AUTH_LABELS, d.mode, cx))));
  if (d.mode === "basic") return box.child(labelled(self, t, "Username", "auth:username")).child(labelled(self, t, "Password", "auth:password", true));
  if (d.mode === "bearer") return box.child(labelled(self, t, "Token", "auth:token", true));
  if (d.mode === "apikey") {
    return box.child(labelled(self, t, "Key", "auth:key")).child(labelled(self, t, "Value", "auth:value", true))
      .child(v_flex().flex_none().px(12).pt(8).items_start().child(label(t, "Add To"))
        .child(ui.menuButton(t, "brunr-auth-placement", fv.PLACEMENT_LABELS[d.placement], local,
          (cx) => ui.openMenu(self, "placement", null, fv.PLACEMENTS, fv.PLACEMENT_LABELS, d.placement, cx))));
  }
  if (d.mode === "inherit") return box.child(div().px(12).pt(4).text_color(t.muted).child(fv.INHERIT_NOTE));
  return box;
}

/** A toggle drawn as a small switch. */
function toggle(t, id, on, click) {
  return h_flex().id(id).w(30).h(16).flex_none().px(2).items_center().rounded(8).border_1()
    .border_color(on ? t.accent : t.border).bg(on ? t.accent : t.background)
    .when(on, (el) => el.justify_end())
    .when(Boolean(click), (el) => el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); click(cx); cx.notify(); }))
    .child(div().size(10).rounded(5).bg(on ? t.accent_foreground : t.muted));
}

function settingsView(self, t, d, local) {
  const box = v_flex().id("brunr-form-settings").flex_1().min_h(0).overflow_y_scrollbar().py(6);
  for (const s of SETTINGS_FIELDS) {
    if (s.kind === "toggle") {
      box.child(h_flex().id(`brunr-setting-${s.key}`).h(34).flex_none().px(12).gap(10).items_center()
        .child(toggle(t, `brunr-setting-${s.key}-toggle`, d[s.key] === true, local ? () => ui.editTab(self, (x) => fv.toggleSetting(x, s.key)) : null))
        .child(div().child(s.label)));
      continue;
    }
    const id = `settings:${s.key}`;
    const w = self.form.wid.get(id);
    const error = w ? fv.settingError(s.key, w.value()) : null;
    box.child(v_flex().id(`brunr-setting-${s.key}`).flex_none().px(12).py(4)
      .child(label(t, s.inherit ? `${s.label}, or inherit` : s.label))
      .child(h_flex().w(220).child(ui.field(self, t, id, Boolean(error))))
      .child(div().h(14).text_size(11).text_color(t.blocked).child(error ?? "")));
  }
  return box;
}
