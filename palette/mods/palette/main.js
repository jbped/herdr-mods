// Command palette with user and mod entries. Lists the user's entries from
// ~/.config/herdr-app/palette.json, then what mods declare in their mod.json ("palette":
// [{ "title", "command", "args" }]), then every app command from commands(), each with its
// key from keys.json. Type to filter, ↑/↓ and Enter to run, Esc to leave. A command with
// required arguments asks for them first: one value fills the first argument, or a JSON object.
// Open it with mod.open {"name": "palette"}, e.g. bound to ctrl-shift-p in keys.json.
import * as fs from "fs/promises";
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, commands, readTextFile, run, props, closeOverlay, theme } from "herdr";

const ROW_H = 32, HEAD_H = 26, LIST_H = 360;
// Groups in the order Herdr's own palette shows them; mod entries come first.
const GROUPS = ["tab", "pane", "space", "terminal", "agent", "app", "layout", "mod", "overlay", "window"];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const groupOf = (r) => (r.kind === "mod" ? r.group : cap(r.group));
/** A command's label: the first clause of its description, as Herdr's labels read. */
const labelOf = (c) => {
  const l = (c.about.split(/ \(|: |; |\. /)[0] ?? "").replace(/\.$/, "").trim();
  return l && l.length <= 60 && /^[A-Z]/.test(l) ? l : c.name;
};

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

/** Valid entries of a palette list, as rows of group `group`. */
const entriesOf = (list, group, mod) =>
  Array.isArray(list) ? list.filter((e) => e?.title && e?.command).map((e) => ({ kind: "mod", group, mod, title: e.title, name: e.command, args: e.args ?? {}, about: e.about ?? "" })) : [];

/** The user's own entries: a JSON list in ~/.config/herdr-app/palette.json. */
async function userEntries() {
  let text = null;
  try { text = await readTextFile(`${appHome()}/palette.json`); } catch {} // no file, no entries
  if (!text) return [];
  try { return entriesOf(JSON.parse(text), "Custom", ""); } catch (e) { console.log(`palette: palette.json: ${e.message ?? e}`); return []; }
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
      out.push(...entriesOf(list, "Mods", name));
    } catch {} // a broken mod.json leaves that mod out
  }
  return out;
}

const parseValue = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v);

export default class Palette extends View {
  init(_props, cx) {
    this.filter = ""; this.at = 0; this.top = 0; this.asking = null; this.error = null;
    this.mods = []; this.keys = new Map();
    this.input = InputState.new({ placeholder: "Type a command…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.submit(); cx.notify(); });
    this.argInput = InputState.new({ placeholder: "Value, or {\"name\": value, …}" });
    this.argInput.on("submit", (_e, cx) => { this.runAsked(); cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      this.mods = [...(await userEntries()), ...(await modEntries())];
      try { this.keys = keysBySig(JSON.parse((await readTextFile(`${appHome()}/keys.json`)) ?? "{}")); } catch {}
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  /** Mod entries first, then app commands by group; every typed word must match. */
  rows() {
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const rank = (g) => { const i = GROUPS.indexOf(g); return i < 0 ? GROUPS.length : i; };
    const app = commands().map((c, i) => ({ kind: "app", group: c.name.split(".")[0], i, title: labelOf(c), name: c.name, args: null, spec: c.args, about: c.about }))
      .sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || a.i - b.i);
    const all = [...this.mods, ...app];
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

  /** Keycaps, as Herdr draws them: "ctrl-shift-t" -> ctrl | shift | t. */
  keycaps(key, t) {
    const parts = key.endsWith("--") ? [...key.slice(0, -2).split("-"), "-"] : key.split("-");
    return h_flex().flex_none().gap(3).children(parts.filter(Boolean).map((p) =>
      div().h(18).min_w(18).px(5).flex().items_center().justify_center().rounded(4).border_1().border_color(t.border)
        .text_size(10.5).text_color(t.dim).child(p)));
  }

  /** Jumps to a group: its first row selected, its heading at the top. */
  jump(head, cx) {
    const rows = this.rows(), i = rows.findIndex((r) => groupOf(r) === head);
    if (i < 0) return;
    this.at = i; this.top = this.headY.get(head) ?? 0; this.input.focus(); cx.notify();
  }

  /** The index of groups down the left; the selected row's group is marked. */
  sidebar(heads, current, t) {
    return v_flex().id("pl-groups").w(120).flex_none().gap(1).pr(8).border_r(1).border_color(t.border)
      .children(heads.map((h) => div().id(`pl-g-${h}`).h(24).px(8).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .text_color(h === current ? t.foreground : t.dim).when(h === current, (e) => e.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.jump(h, cx)).child(h)));
  }

  render() {
    const t = theme(), rows = this.asking ? [] : this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    // One strip of group headings and rows at fixed y; it scrolls only as far as the selection needs.
    const items = [], tops = [];
    this.headY = new Map();
    let y = 0, last = null;
    rows.forEach((r, i) => {
      const head = groupOf(r);
      if (head !== last) { items.push({ head, y }); this.headY.set(head, y); y += HEAD_H; last = head; }
      items.push({ r, i, y }); tops[i] = y; y += ROW_H;
    });
    const total = y, height = Math.min(LIST_H, total);
    if (rows.length) {
      // Keep the selected row, and its group's heading when it's the first in the group, in view.
      const top = tops[this.at], k = items.findIndex((it) => it.r === rows[this.at]);
      const want = items[k - 1]?.head ? top - HEAD_H : top;
      if (want < this.top) this.top = Math.max(0, want);
      if (top + ROW_H > this.top + height) this.top = top + ROW_H - height;
    }
    this.top = Math.max(0, Math.min(this.top, total - height));
    const keyOf = (r) => this.keys.get(sig(r.name, r.args ?? {}));
    const place = (el, at, h) => el.absolute().left(0).right(0).top(at - this.top).h(h);
    const draw = (it) => {
      if (it.head) return place(div().px(12).pt(8).text_size(11).text_color(t.dim).child(it.head), it.y, HEAD_H);
      const r = it.r, on = it.i === this.at, key = r.kind === "mod" || !r.spec.some((a) => a.required) ? keyOf(r) : null;
      return place(h_flex().id(`pl-${r.kind}-${r.mod ?? ""}-${r.name}-${r.title}`).px(4).items_center()
        .child(h_flex().flex_1().h(ROW_H - 4).px(8).gap(10).items_center().rounded(6).cursor_pointer()
          .when(on, (e) => e.bg(t.hover)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.at = it.i; this.submit(); cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(on ? t.foreground : t.muted).child(r.title))
          .when(r.kind === "mod" && !!r.mod, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(r.mod)))
          .when(!!key, (e) => e.child(this.keycaps(key, t)))), it.y, ROW_H);
    };
    const visible = items.filter((it) => it.y + (it.head ? HEAD_H : ROW_H) > this.top && it.y < this.top + height);
    return v_flex().id("palette").track_focus(this.handle).w_full().min_h(0).p(12).gap(6).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") { if (this.asking) this.back(cx); else this.close(); }
        else if (this.asking) return;
        // Shift+arrows jump between groups, as the sidebar does.
        else if ((k === "down" || k === "up") && e.modifiers.shift && rows.length) {
          const heads = [...this.headY.keys()], gi = heads.indexOf(groupOf(rows[this.at]));
          return this.jump(heads[Math.max(0, Math.min(heads.length - 1, gi + (k === "down" ? 1 : -1)))], cx), cx.stop_propagation();
        }
        else if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "pagedown") this.at = Math.min(this.at + 8, rows.length - 1);
        else if (k === "pageup") this.at = Math.max(this.at - 8, 0);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
        .when(!!this.asking, (e) => e.child(div().flex_none().text_size(12.8).text_color(t.muted).child(`${this.asking.title} ›`)))
        .child(Input.new(this.asking ? this.argInput : this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .when(!!this.asking, (e) => e
        .child(div().px(12).pt(4).text_size(12).text_color(t.muted).child(`${this.asking?.name}: ${this.asking?.spec.map((a) => a.name + (a.required ? "" : " (optional)")).join(", ")}`))
        .child(div().px(12).pb(6).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(this.error ?? this.asking?.about ?? "")))
      .when(!this.asking, (e) => e.child(rows.length
        ? h_flex().items_start().gap(8)
          .child(this.sidebar([...this.headY.keys()], groupOf(rows[this.at]), t))
          .child(div().id("pl-list").flex_1().min_w(0).relative().overflow_hidden().h(height)
          .on_scroll_wheel((ev, cx) => {
            const d = ev.delta_lines ? -ev.delta_lines.y * ROW_H : -ev.delta.y;
            this.top = Math.max(0, Math.min(this.top + d, total - height));
            // The selection follows the wheel, so the next frame doesn't scroll back to it.
            while (this.at < rows.length - 1 && tops[this.at] < this.top) this.at++;
            while (this.at > 0 && tops[this.at] + ROW_H > this.top + height) this.at--;
            cx.notify(); cx.stop_propagation();
          })
          .children(visible.map(draw)))
        : div().px(12).py(8).text_size(12).text_color(t.dim).child("No matching command")));
  }
}
