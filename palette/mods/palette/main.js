// Command palette with mod entries. Lists what mods declare in their mod.json ("palette":
// [{ "title", "command", "args" }]), then every app command from commands(), each with its
// key from keys.json. Type to filter, ↑/↓ and Enter to run, Esc to leave. A command with
// required arguments asks for them first: one value fills the first argument, or a JSON object.
// Open it with mod.open {"name": "palette"}, e.g. bound to ctrl-shift-p in keys.json.
import * as fs from "fs/promises";
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, commands, readTextFile, run, props, closeOverlay, theme } from "herdr";

const ROWS = 10, ROW_H = 46;

/** The value a key action stands for, comparable with an entry's: "name" + JSON args. */
const sig = (name, args) => `${name} ${JSON.stringify(args ?? {}, Object.keys(args ?? {}).sort())}`;

/** keys.json's global section as signature -> key. "name:value" fills the first argument. */
function keysBySig(keys) {
  const out = new Map(), firstArg = new Map(commands().map((c) => [c.name, c.args[0]?.name]));
  for (const [key, act] of Object.entries(keys?.global ?? {})) {
    let s = null;
    if (typeof act === "object" && act?.command) s = sig(act.command, act.args);
    else if (typeof act === "string") {
      const i = act.indexOf(":"), name = i < 0 ? act : act.slice(0, i);
      s = i < 0 ? sig(name) : firstArg.get(name) ? sig(name, { [firstArg.get(name)]: act.slice(i + 1) }) : null;
    }
    if (s && !out.has(s)) out.set(s, key);
  }
  return out;
}

/** Entries mods declare in their mod.json. */
async function modEntries() {
  const dir = `${appHome()}/mods`, out = [];
  let names = [];
  try { names = await fs.readdir(dir); } catch { return out; }
  for (const name of names.sort()) {
    try {
      const text = await readTextFile(`${dir}/${name}/mod.json`);
      const list = text ? JSON.parse(text).palette : null;
      if (Array.isArray(list)) for (const e of list) if (e?.title && e?.command) out.push({ mod: name, title: e.title, name: e.command, args: e.args ?? {}, about: e.about ?? "" });
    } catch {} // a broken mod.json leaves that mod out
  }
  return out;
}

const parseValue = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v);

export default class Palette extends View {
  init(_props, cx) {
    this.filter = ""; this.at = 0; this.top = 0; this.asking = null; this.error = null;
    this.mods = []; this.keys = new Map();
    this.input = InputState.new({ placeholder: "Run a command or open a mod…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.submit(); cx.notify(); });
    this.argInput = InputState.new({ placeholder: "A value for the first argument, or {\"name\": value, …}" });
    this.argInput.on("submit", (_e, cx) => { this.runAsked(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      this.mods = await modEntries();
      try { this.keys = keysBySig(JSON.parse((await readTextFile(`${appHome()}/keys.json`)) ?? "{}")); } catch {}
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  /** Mod entries first, then app commands; every typed word must match. */
  rows() {
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const all = [
      ...this.mods.map((e) => ({ ...e, kind: "mod" })),
      ...commands().map((c) => ({ kind: "app", title: c.name, name: c.name, args: null, spec: c.args, about: c.about })),
    ];
    return all.filter((r) => { const hay = `${r.title} ${r.name} ${r.mod ?? ""} ${r.about}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  }

  submit() {
    const r = this.rows()[this.at];
    if (!r) return;
    // Required arguments: ask for them in the same box.
    if (r.kind === "app" && r.spec.some((a) => a.required)) {
      this.asking = r; this.error = null;
      this.argInput.set_value(""); this.argInput.focus();
      return;
    }
    this.go(r.name, r.args ?? {});
  }

  runAsked() {
    const r = this.asking, text = this.argInput.value().trim();
    let args;
    if (text.startsWith("{")) { try { args = JSON.parse(text); } catch (e) { this.error = `Not JSON: ${e.message}`; return; } }
    else args = { [r.spec[0].name]: parseValue(text) };
    this.go(r.name, args);
  }

  go(name, args) {
    this.close();
    try { run(name, args); } catch (e) { console.log(`palette: ${name}: ${e.message ?? e}`); }
  }

  back(cx) {
    this.asking = null; this.error = null; this.input.focus();
    cx.notify();
  }

  render() {
    const t = theme(), rows = this.asking ? [] : this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - ROWS)));
    const shown = rows.slice(this.top, this.top + ROWS);
    const keyOf = (r) => this.keys.get(sig(r.name, r.args ?? {}));
    const row = (r, i) => {
      const on = this.top + i === this.at, key = r.kind === "mod" || !r.spec.some((a) => a.required) ? keyOf(r) : null;
      return h_flex().id(`pl-${r.kind}-${r.mod ?? ""}-${r.title}`).mx(4).px(10).h(ROW_H).flex_none().gap(10).items_center().rounded(7).cursor_pointer()
        .when(on, (e) => e.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.at = this.top + i; this.submit(); cx.notify(); })
        .child(div().w(34).flex_none().text_size(10).text_color(r.kind === "mod" ? t.accent : t.dim).child(r.kind === "mod" ? "mod" : ""))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_color(t.foreground).child(r.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(r.kind === "mod" ? `${r.mod} · ${r.name}` : r.about)))
        .when(!!key, (e) => e.child(div().flex_none().px(6).py(1).rounded(4).bg(t.raised).text_size(11).text_color(t.muted).child(key)));
    };
    return v_flex().id("palette").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") { if (this.asking) this.back(cx); else this.close(); }
        else if (this.asking) return;
        else if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "pagedown") this.at = Math.min(this.at + ROWS, rows.length - 1);
        else if (k === "pageup") this.at = Math.max(this.at - ROWS, 0);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(this.asking ? this.asking.name : "Palette"))
        .child(div().text_size(11).text_color(t.dim).child(this.asking ? "Enter runs · Esc back" : "Esc")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.asking ? this.argInput : this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(!!this.asking, (e) => e
        .child(div().text_size(12).text_color(t.muted).child(`Arguments: ${this.asking?.spec.map((a) => a.name + (a.required ? "" : " (optional)")).join(", ")}`))
        .child(div().text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(this.error ?? this.asking?.about ?? "")))
      .when(!this.asking, (e) => e.child(v_flex().id("pl-list").min_h(0)
        .on_scroll_wheel((ev, cx) => {
          const d = Math.sign(ev.delta_lines?.y ?? ev.delta.y);
          this.top = Math.max(0, Math.min(this.top - d * 3, Math.max(0, rows.length - ROWS)));
          this.at = Math.max(this.top, Math.min(this.at, this.top + ROWS - 1));
          cx.notify(); cx.stop_propagation();
        })
        .children(shown.length ? shown.map(row) : [div().px(14).py(8).text_size(12).text_color(t.dim).child("No match")])
        .when(rows.length > ROWS, (e) => e.child(div().px(14).pt(4).text_size(11).text_color(t.dim).child(`${this.top + 1}-${this.top + shown.length} of ${rows.length}`)))));
  }
}
