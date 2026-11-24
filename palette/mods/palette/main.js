// Command palette with user and mod entries. Lists the user's entries from
// ~/.config/herdr-app/palette.json, then what mods declare in their mod.json ("palette":
// [{ "title", "command", "args" }]), then every app command from commands(), each with its
// key from keys.json. It opens on the list: j/k or ↑/↓ move, Enter runs, / goes to the search box
// (type to filter), tab comes back, q or Esc leaves. A command with
// required arguments asks for them first: one value fills the first argument, or a JSON object.
// ctrl-b asks for a key for the selected row and writes it to keys.json's global section.
// Open it with mod.open {"name": "palette"}, e.g. bound to ctrl-shift-p in keys.json.
import * as fs from "fs/promises";
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, commands, readTextFile, writeTextFile, run, props, closeOverlay, theme } from "herdr";

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

/** Each command's first argument name: what "name:value" in keys.json fills. */
const firstArgs = () => new Map(commands().map((c) => [c.name, c.args[0]?.name]));

/** A keys.json action's signature, or null when it runs no command with known arguments. */
function actSig(act, firstArg) {
  if (typeof act === "object" && act?.command) return sig(act.command, act.args);
  if (typeof act !== "string") return null;
  const i = act.indexOf(":"), name = i < 0 ? act : act.slice(0, i);
  if (i < 0) return sig(name);
  return firstArg.get(name) ? sig(name, { [firstArg.get(name)]: act.slice(i + 1) }) : null;
}

/** keys.json's global section as signature -> key. The first key of a signature wins. */
function keysBySig(keys) {
  const out = new Map(), firstArg = firstArgs();
  for (const [key, act] of Object.entries(keys?.global ?? {})) {
    const s = actSig(act, firstArg);
    if (s && !out.has(s)) out.set(s, key);
  }
  return out;
}

const MODS = ["ctrl", "alt", "shift", "cmd", "fn"];
/** "ctrl-shift-t" -> ["ctrl", "shift", "t"]. A trailing "-" is the minus key. */
const chordParts = (c) => (c === "-" ? ["-"] : c.endsWith("--") ? [...c.slice(0, -2).split("-"), "-"] : c.split("-"));

/** Why `key` can't be a global key, or null. Chords in a sequence are space-separated. */
function keyProblem(key) {
  const chords = key.split(" ");
  for (const c of chords) {
    const parts = chordParts(c), k = parts.pop();
    if (!/^(\S|[a-z][a-z0-9]+)$/.test(k ?? "") || parts.some((m) => !MODS.includes(m))) return `"${c}" is not a key. Write it like ctrl-shift-g, alt-f5 or f8.`;
  }
  const first = chordParts(chords[0]), k = first.pop();
  if (!first.some((m) => m === "ctrl" || m === "alt" || m === "cmd") && !/^f\d{1,2}$/.test(k)) return "A global key needs ctrl, alt or cmd, or is a function key. Anything else takes the key from typing.";
  return null;
}

/** A keys.json action in words, for the message about a key already in use. */
const actText = (act) => (typeof act === "string" ? act : `${act?.command} ${JSON.stringify(act?.args ?? {})}`);

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
    this.binding = null; this.confirmed = null; this.searching = false;
    this.mods = []; this.keys = new Map();
    this.input = InputState.new({ placeholder: "Press / to search…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.submit(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    // Leaving the box (tab, a click beside it) puts the keyboard on the list. The box's own tab
    // handling moves focus after ours, so the list takes it once that has settled.
    this.input.on("blur", (_e, cx) => {
      this.searching = false; cx.notify();
      cx.timer.after(30, (cx) => { if (!this.searching && !this.asking && !this.binding) { this.handle.focus(); cx.notify(); } });
    });
    this.argInput = InputState.new({ placeholder: "Value, or {\"name\": value, …}" });
    this.argInput.on("submit", (_e, cx) => { this.runAsked(); cx.notify(); });
    this.bindInput = InputState.new({ placeholder: "Key, such as ctrl-shift-g. Empty removes it" });
    this.bindInput.on("change", (_e, cx) => { this.error = null; this.confirmed = null; cx.notify(); });
    this.bindInput.on("submit", (_e, cx) => this.saveKey(cx));
    // It opens with the keyboard on the list: / goes to the search box, tab comes back.
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => { if (!this.searching && !this.asking && !this.binding) this.handle.focus(); });
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
      this.wasSearching = this.searching; this.asking = r; this.error = null;
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

  /** Puts the keyboard back on the search box or the list, whichever had it. */
  refocus() { if (this.wasSearching) this.input.focus(); else this.handle.focus(); }

  back(cx) {
    this.asking = null; this.binding = null; this.confirmed = null; this.error = null; this.refocus();
    cx.notify();
  }

  /** Whether a row is one exact command and arguments, which is what a key runs. */
  bindable(r) { return r.kind === "mod" || !r.spec.some((a) => a.required); }

  /** Asks for the selected row's key in the same box. */
  bind(r) {
    this.wasSearching = this.searching; this.binding = r; this.confirmed = null;
    this.error = this.bindable(r) ? null : "A key can't fill in arguments. Add this command with its arguments to palette.json, then set that entry's key.";
    this.bindInput.set_value(this.keys.get(sig(r.name, r.args ?? {})) ?? ""); this.bindInput.focus();
  }

  /** Writes the typed key as the row's key in keys.json's global section. No key removes it. */
  saveKey(cx) {
    const r = this.binding, key = this.bindInput.value().trim().toLowerCase().replace(/\s+/g, " ");
    if (!r || !this.bindable(r)) return;
    this.error = key ? keyProblem(key) : null;
    if (this.error) return cx.notify();
    cx.spawn(async (cx) => {
      try {
        const path = `${appHome()}/keys.json`, text = await readTextFile(path);
        if (text === null) throw new Error("There is no keys.json");
        const doc = JSON.parse(text), firstArg = firstArgs(), mine = sig(r.name, r.args ?? {});
        const g = (doc.global ??= {});
        // A key in use: say what it runs and where, and take a second Enter as the answer.
        if (key && this.confirmed !== key) {
          const taken = g[key] !== undefined && actSig(g[key], firstArg) !== mine ? `${key} runs ${actText(g[key])}. ` : "";
          const wins = Object.keys(doc).filter((s) => s !== "global" && doc[s]?.[key] !== undefined);
          const over = wins.length ? `${key} is also set in ${wins.join(", ")}, which wins there. ` : "";
          if (taken || over) { this.confirmed = key; this.error = `${taken}${over}Enter ${taken ? "replaces it" : "sets it anyway"}.`; return cx.notify(); }
        }
        const old = Object.keys(g).find((k) => actSig(g[k], firstArg) === mine);
        if (old !== undefined) delete g[old];
        if (key) g[key] = Object.keys(r.args ?? {}).length ? { command: r.name, args: r.args } : r.name;
        // Written as Herdr writes it: two spaces, the file's own line ends.
        const out = JSON.stringify(doc, null, 2) + (text.endsWith("\n") ? "\n" : "");
        await writeTextFile(path, text.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out, text);
        this.keys = keysBySig(doc);
        this.back(cx);
      } catch (e) { this.error = `keys.json: ${e.message ?? e}`; cx.notify(); }
    });
  }

  /** Keycaps, as Herdr draws them: "ctrl-shift-t" -> ctrl | shift | t. */
  keycaps(key, t) {
    const parts = key.endsWith("--") ? [...key.slice(0, -2).split("-"), "-"] : key.split("-");
    return h_flex().flex_none().gap(3).children(parts.filter(Boolean).map((p) =>
      div().h(18).min_w(18).px(5).flex().items_center().justify_center().rounded(4).border_1().border_color(t.border)
        .text_size(10.5).text_color(t.dim).child(p)));
  }

  /** The line of key hints along the bottom: each key in the accent color, its meaning dim. */
  legend(t) {
    const hints = this.binding ? [["enter", "save"], ["esc", "close"]]
      : this.asking ? [["enter", "run"], ["esc", "close"]]
      : this.searching ? [["tab", "list"], ["↑/↓", "move"], ["ctrl-j/k/↑/↓", "page"], ["shift-↑/↓", "group"], ["enter", "run"], ["ctrl-b", "set key"], ["esc", "close"]]
      : [["j/k/↑/↓", "move"], ["ctrl-j/k/↑/↓", "page"], ["shift-j/k/↑/↓", "group"], ["/", "search"], ["enter", "run"], ["ctrl-b", "set key"], ["q/esc", "close"]];
    return h_flex().flex_none().flex_wrap().gap(12).px(8).pt(8).border_t(1).border_color(t.border).text_size(11)
      .children(hints.map(([key, what]) => h_flex().gap(4).items_center()
        .child(div().text_color(t.accent).font_semibold().child(key))
        .child(div().text_color(t.dim).child(what))));
  }

  /** Jumps to a group: its first row selected, its heading at the top. */
  jump(head, cx) {
    const rows = this.rows(), i = rows.findIndex((r) => groupOf(r) === head);
    if (i < 0) return;
    this.at = i; this.top = this.headY.get(head) ?? 0; if (this.searching) this.input.focus(); else this.handle.focus(); cx.notify();
  }

  /** The index of groups down the left; the selected row's group is marked. */
  sidebar(heads, current, t) {
    return v_flex().id("pl-groups").w(120).flex_none().gap(1).pr(8).border_r(1).border_color(t.border)
      .children(heads.map((h) => div().id(`pl-g-${h}`).h(24).px(8).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .text_color(h === current ? t.foreground : t.dim).when(h === current, (e) => e.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.jump(h, cx)).child(h)));
  }

  render() {
    const t = theme(), ask = this.asking ?? this.binding, rows = ask ? [] : this.rows();
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
        // ctrl-j/k, ctrl-n/p and ctrl-d/u move as the arrows and page keys do.
        // ctrl with j/k or the arrows pages and ctrl-n/p move, wherever the keyboard is. On the list, j and k move,
        // shift-j/k jump a group, enter runs, / goes to the search box and q closes. In the box those are text.
        const onList = !ask && !this.searching;
        const k = { "ctrl-j": "pagedown", "ctrl-d": "pagedown", "ctrl-k": "pageup", "ctrl-u": "pageup", "ctrl-down": "pagedown", "ctrl-up": "pageup", "ctrl-n": "down", "ctrl-p": "up", ...(onList ? { j: "down", k: "up" } : {}) }[e.keystroke] ?? e.key;
        const group = onList && e.keystroke === "shift-j" ? 1 : onList && e.keystroke === "shift-k" ? -1 : e.modifiers.shift && k === "down" ? 1 : e.modifiers.shift && k === "up" ? -1 : 0;
        if (k === "escape") { if (ask) this.back(cx); else this.close(); }
        else if (ask) return;
        else if (onList && (e.keystroke === "/" || e.key === "/")) this.input.focus();
        else if (onList && e.keystroke === "q") this.close();
        else if (!onList && e.keystroke === "tab") this.handle.focus();
        else if (onList && e.keystroke === "enter") this.submit();
        else if (e.keystroke === "ctrl-b" && rows.length) this.bind(rows[this.at]);
        // Shift with j/k or the arrows jumps between groups, as the sidebar does.
        else if (group && rows.length) {
          const heads = [...this.headY.keys()], gi = heads.indexOf(groupOf(rows[this.at]));
          return this.jump(heads[Math.max(0, Math.min(heads.length - 1, gi + group))], cx), cx.stop_propagation();
        }
        else if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "pagedown") this.at = Math.min(this.at + 8, rows.length - 1);
        else if (k === "pageup") this.at = Math.max(this.at - 8, 0);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(ask || this.searching ? t.accent : t.border).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
        .when(!!ask, (e) => e.child(div().flex_none().text_size(12.8).text_color(t.muted).child(`${ask.title} ›`)))
        .child(Input.new(this.binding ? this.bindInput : this.asking ? this.argInput : this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
        .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc")))
      .when(!!this.binding, (e) => e
        .child(div().px(12).pt(4).text_size(12).text_color(t.muted).child(`Key for ${this.binding?.name}${Object.keys(this.binding?.args ?? {}).length ? ` ${JSON.stringify(this.binding?.args)}` : ""}`))
        .child(div().px(12).pb(6).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(this.error ?? "Type the key and press Enter. It is saved in keys.json and works at once.")))
      .when(!!this.asking, (e) => e
        .child(div().px(12).pt(4).text_size(12).text_color(t.muted).child(`${this.asking?.name}: ${this.asking?.spec.map((a) => a.name + (a.required ? "" : " (optional)")).join(", ")}`))
        .child(div().px(12).pb(6).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(this.error ?? this.asking?.about ?? "")))
      .when(!ask, (e) => e.child(rows.length
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
        : div().px(12).py(8).text_size(12).text_color(t.dim).child("No matching command")))
      .child(this.legend(t));
  }
}
