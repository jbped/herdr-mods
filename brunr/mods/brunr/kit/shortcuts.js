// A mod's settings: a switch per shortcut key, and any on/off options of its own. The gear
// button opens a panel over the mod. What the user chose is saved in the mod's own storage.
//
// In the mod:
//   init:    this.shortcuts = new Shortcuts({ mod: "my-mod", keys: [{ id: "push", key: "p", what: "push" }] });
//   key:     if (this.shortcuts.key(e, cx)) return;          // first, where single keys are commands
//            if (this.shortcuts.isOff("push")) return;       // before doing what a key asks
//            With `rebind: true` the user can also change each key. Then ask the panel which
//            shortcut a key press means, and never compare against a letter yourself:
//            if (this.shortcuts.matches("push", e.keystroke)) ...   or   this.shortcuts.idFor(e.keystroke)
//            and draw a key with this.shortcuts.shown("push").
//   render:  .child(this.shortcuts.button(t))                // the gear
//            .when(this.shortcuts.open, (el) => el.child(this.shortcuts.panel(t)))   // in a `relative()` root
import { div, svg } from "gpui-kit";
import { v_flex, ScrollHandle } from "gpui-base";
import { SIZE } from "./theme.js";
import { divider } from "./frame.js";
import { legend } from "./legend.js";
import { listRow } from "./list.js";
import { sectionLabel } from "./pane.js";
import { toolButton } from "./controls.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").KeyEvent} KeyEvent */
/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("./legend.js").Hint} Hint */

/**
 * A shortcut the user can turn off. `id` is saved, so keep it. `key` is how the key is shown,
 * and with `rebind` it is also the keystroke the shortcut starts with ("" for none).
 * `fixed`: the key cannot be changed, for a row that stands for several keys ("a /", "1-9").
 * @typedef {{ id: string, key: string, what: string, fixed?: boolean }} Shortcut
 */
/** An on/off option of the mod's own. `id` is saved, so keep it. @typedef {{ id: string, label: string, on?: boolean }} Option `on`: its value until the user changes it */

/**
 * @typedef {object} ShortcutsSpec
 * @property {string} mod the mod's folder name, for the gear icon
 * @property {Shortcut[]} keys
 * @property {Option[]} [options] shown above the keys, after the "Show key hints" option every mod gets
 * @property {boolean} [rebind] the user can change each key that is not `fixed`. The mod must then
 *   match key presses with `matches` or `idFor`, and draw keys with `shown` or `keyFor`.
 * @property {boolean} [hints] whether key hints show until the user chooses. Defaults to true.
 * @property {string} [openKey] the keystroke that opens the settings. Defaults to ",". Give a
 *   ctrl key such as "ctrl-," when the mod's keyboard is in a text box.
 * @property {string} [saved] the name the settings are saved under in the mod's storage. Defaults to "settings".
 * @property {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} [storage]
 *   where they are saved. Defaults to localStorage, which is this copy's own. A mod that opens
 *   as a new copy each time (a dialog, a tab) passes open-as.js's sharedStorage.
 * @property {() => void} [onOpen] runs when the panel opens. A mod whose keyboard is in a text
 *   box moves it to its frame here, so the panel's j, k and space arrive as keys.
 * @property {() => void} [onClose] runs when the panel closes, to give the keyboard back
 * @property {(id: string, on: boolean) => void} [onChange] runs after a switch changed: a key's id (on: the key works) or an option's
 */

/** About the height a section heading takes in the list, in pixels. */
const HEADING_H = 36;

/** The id of the option every mod gets: show the key hints, or hide them and keep the keys working. */
const HINTS = "hints";
/**
 * Esc while the panel is open. The app closes a dialog on esc whatever the mod's key handler
 * does, so the mod's root sits in this key context while the panel is open, where esc is bound
 * to the panel's own action. The nearest binding wins, and the action closes only the panel.
 */
const OPEN_CONTEXT = "KitSettingsOpen";
const BACK_ACTION = "kit-settings-back";

/** The keys while the panel is open. Enter changes a key where the mod allows it, else it switches like space. @type {Record<string, string>} */
const PANEL_KEYS = { up: "up", k: "up", "ctrl-k": "up", down: "down", j: "down", "ctrl-j": "down", space: "toggle", enter: "change", escape: "cancel" };
/** Presses of these alone are not a key to bind: they are held for another key. */
const HELD_KEYS = new Set(["shift", "control", "ctrl", "alt", "cmd", "platform", "meta", "super", "fn", "function", "capslock"]);

export class Shortcuts {
  /** Call it in `init`: it makes a scroll handle, which `render` must not. @param {ShortcutsSpec} spec */
  constructor(spec) {
    this.spec = spec;
    this.keys = spec.keys;
    this.options = [{ id: HINTS, label: "Show key hints", on: spec.hints ?? true }, ...(spec.options ?? [])];
    /** @type {boolean} esc is bound to the panel's action (see OPEN_CONTEXT) */
    this.bound = false;
    this.openKey = spec.openKey ?? ",";
    this.saved = spec.saved ?? "settings";
    this.storage = spec.storage ?? localStorage;
    /** @type {boolean} the panel is open */
    this.open = false;
    /** @type {number} the selected row: the options first, then the keys */
    this.at = 0;
    this.scroll = ScrollHandle.new();
    this.reveal = false;
    /** @type {Set<string>} the ids of the keys that are turned off */
    this.off = new Set();
    /** @type {Record<string, string>} the keys the user changed: a shortcut's id, then its keystroke ("" for none) */
    this.bindings = {};
    /** @type {string | null} the id of the shortcut waiting for its new key, while the user is choosing one */
    this.capturing = null;
    /** @type {Record<string, boolean>} each option's value */
    this.values = Object.fromEntries(this.options.map((o) => [o.id, Boolean(o.on)]));
    try {
      const saved = JSON.parse(this.storage.getItem(this.saved) ?? "{}") ?? {};
      if (Array.isArray(saved.off)) for (const id of saved.off) if (this.keys.some((k) => k.id === id)) this.off.add(id);
      for (const o of this.options) if (typeof saved[o.id] === "boolean") this.values[o.id] = saved[o.id];
      if (spec.rebind && saved.keys && typeof saved.keys === "object") {
        for (const k of this.keys) if (!k.fixed && typeof saved.keys[k.id] === "string") this.bindings[k.id] = saved.keys[k.id];
      }
    } catch {
      // Unreadable settings are the defaults.
    }
  }

  /** True when the user turned this shortcut's key off. Its button, if it has one, still works. @param {string} id */
  isOff(id) {
    return this.off.has(id);
  }

  /** The keystroke a shortcut is on now: the user's, else the one it came with. "" when it has none. @param {string} id */
  keyFor(id) {
    return this.bindings[id] ?? this.keys.find((k) => k.id === id)?.key ?? "";
  }

  /** True when this key press is this shortcut's, and the shortcut is on. @param {string} id @param {string} keystroke as the event spells it */
  matches(id, keystroke) {
    return !this.off.has(id) && keystroke !== "" && this.keyFor(id) === keystroke;
  }

  /** The shortcut a key press means, or "" when it is none that is on. Rows marked `fixed` are not looked at. @param {string} keystroke */
  idFor(keystroke) {
    return this.keys.find((k) => !k.fixed && this.matches(k.id, keystroke))?.id ?? "";
  }

  /**
   * The key to draw for a shortcut, on a button or in a hint: "" when it is off or key hints are
   * hidden, else the key it is on now. `fallback` is drawn for a `fixed` row, which stands for
   * several keys.
   * @param {string} id @param {string} [fallback]
   */
  shown(id, fallback) {
    if (this.isHidden(id)) return "";
    const k = this.keys.find((x) => x.id === id);
    return !k || k.fixed ? fallback ?? k?.key ?? "" : this.keyFor(id);
  }

  /** An option's value. @param {string} id */
  option(id) {
    return Boolean(this.values[id]);
  }

  /** False when the user chose to hide key hints: the mod leaves out its key list and the keys on its buttons. The keys still work. */
  get showHints() {
    return this.option(HINTS);
  }

  /** True when a key should not be shown: it is turned off, or key hints are hidden. @param {string} id */
  isHidden(id) {
    return !this.showHints || this.off.has(id);
  }

  /** Sets an option and saves. @param {string} id @param {boolean} on */
  setOption(id, on) {
    const i = this.options.findIndex((o) => o.id === id);
    if (i >= 0 && this.option(id) !== on) this.flip(i);
  }

  /** The keys that are on, as legend hints. None when key hints are hidden. @returns {Hint[]} */
  hints() {
    if (!this.showHints) return [];
    return this.keys.filter((k) => !this.off.has(k.id) && this.keyFor(k.id)).map((k) => /** @type {Hint} */ ([this.keyFor(k.id), k.what]));
  }

  /** Opens the panel. */
  show() {
    if (this.open) return;
    this.open = true;
    this.at = 0;
    this.reveal = true;
    this.spec.onOpen?.();
  }

  /** Esc: stops waiting for a new key, else closes the panel. */
  back() {
    if (this.capturing !== null) this.capturing = null;
    else this.hide();
  }

  /** Closes the panel. */
  hide() {
    if (!this.open) return;
    this.open = false;
    this.capturing = null;
    this.spec.onClose?.();
  }

  /**
   * Does what a command asks: "settings" opens or closes the panel, and while it is open "up",
   * "down", "toggle" and "cancel" work in it. True when the command was the panel's, so the
   * mod should do nothing more with it.
   * @param {string} c @param {Context} [cx] the event's context, when there is one
   */
  command(c, cx) {
    // The binding is made the first time the panel opens from a key or a click, where a context is at hand.
    if (cx && !this.bound) {
      cx.bind_keys([{ keystroke: "escape", action: BACK_ACTION, context: OPEN_CONTEXT }]);
      this.bound = true;
    }
    if (c === "settings") {
      if (this.open) this.hide(); else this.show();
      return true;
    }
    if (!this.open) return false;
    const n = this.options.length + this.keys.length;
    if ((c === "up" || c === "down") && n) {
      this.at = (this.at + (c === "up" ? -1 : 1) + n) % n;
      this.reveal = true;
      this.capturing = null;
    } else if (c === "toggle") this.flip(this.at);
    else if (c === "change") { if (!this.change(this.at)) this.flip(this.at); }
    else if (c === "cancel") this.back();
    return true;
  }

  /**
   * Takes a key press. Closed, only the opening key is the panel's. Open, every key is, so no
   * shortcut of the mod runs behind the panel. True when the key was taken: it is stopped and
   * the mod is drawn again.
   * @param {KeyEvent} e @param {Context} cx
   */
  key(e, cx) {
    if (!this.open && e.keystroke !== this.openKey) return false;
    if (this.capturing !== null) {
      this.capture(e);
      cx.stop_propagation();
      cx.notify();
      return true;
    }
    this.command(this.open ? (e.keystroke === this.openKey ? "settings" : PANEL_KEYS[e.keystroke] ?? "") : "settings", cx);
    cx.stop_propagation();
    cx.notify();
    return true;
  }

  /**
   * Starts waiting for a new key for one row. False when the row's key cannot be changed: the
   * mod does not allow it, the row is an option, or it is `fixed`.
   * @param {number} i a row: the options first, then the keys
   */
  change(i) {
    const key = this.keys[i - this.options.length];
    if (!this.spec.rebind || !key || key.fixed) return false;
    this.at = i;
    this.capturing = key.id;
    return true;
  }

  /**
   * The key press that answers "press a key": it becomes the shortcut's key. Esc keeps the old
   * key, backspace or delete brings back the one the shortcut came with. A key held for another
   * key (shift alone) is waited through. Two shortcuts may share a key: some mods use one key on
   * different screens, so that is not refused.
   * @param {KeyEvent} e
   */
  capture(e) {
    const id = this.capturing;
    if (id === null || HELD_KEYS.has(e.key)) return;
    this.capturing = null;
    const k = e.keystroke;
    if (k === "escape" || k === this.openKey) return;
    if (k === "backspace" || k === "delete") delete this.bindings[id];
    else this.bindings[id] = k;
    this.save();
    this.spec.onChange?.(id, !this.off.has(id));
  }

  /** Writes every setting to the mod's storage. */
  save() {
    this.storage.setItem(this.saved, JSON.stringify({ ...this.values, off: [...this.off], keys: this.bindings }));
  }

  /** Switches one row and saves everything. @param {number} i a row: the options first, then the keys */
  flip(i) {
    this.at = i;
    this.capturing = null;
    const option = this.options[i];
    const key = this.keys[i - this.options.length];
    if (option) this.values[option.id] = !this.values[option.id];
    else if (key && !this.off.delete(key.id)) this.off.add(key.id);
    else if (!key) return;
    this.save();
    if (option) this.spec.onChange?.(option.id, this.values[option.id]);
    else if (key) this.spec.onChange?.(key.id, !this.off.has(key.id));
  }

  /** The gear button that opens the panel, as tall as a chip. @param {Theme} t */
  button(t) {
    return toolButton(t, { id: "kit-settings", tip: `Settings (${this.openKey})`, click: (cx) => { this.command("settings", cx); cx.notify(); } })
      .child(svg(`mods/${this.spec.mod}/kit/gear.svg`).size(13).flex_none().text_color(t.foreground));
  }

  /**
   * For a mod that is a dialog or popup: makes esc close the panel and not the mod. Give it the
   * mod's root, the element that tracks its focus handle, while the panel is open:
   * `.when(this.shortcuts.open, (el) => this.shortcuts.guard(el).child(this.shortcuts.panel(t)))`.
   * @template T @param {T} root @returns {T}
   */
  guard(root) {
    return /** @type {any} */ (root).key_context(OPEN_CONTEXT).on_action(BACK_ACTION, (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.back(); cx.notify(); });
  }

  /**
   * The panel, placed over the mod. A press beside it closes it. Its parent must be `relative()` (a kit frame is fine).
   * @param {Theme} t
   * @param {{ top?: number, right?: number, width?: number, maxHeight?: number, note?: any }} [place] where it sits in its
   *   parent, in pixels. `note`: an element for one line under the list, such as a pointer to another mod.
   */
  panel(t, place = {}) {
    const options = this.options.length;
    if (this.reveal) {
      // The headings are items of the list too: one over the options, one over the keys.
      this.scroll.scroll_to_item(this.at < options ? this.at + 1 : this.at + 2);
      this.reveal = false;
    }
    // Room for every row and heading, up to the most the mod allows. Past that the list scrolls.
    const headings = 2;
    const listHeight = Math.min(place.maxHeight ?? 420, (options + this.keys.length) * (SIZE.compactRow + 2) + headings * HEADING_H);
    const rebind = Boolean(this.spec.rebind);
    /**
     * One row. With `can`, a click on its key waits for a new key (a click on the rest switches the row).
     * @param {number} i @param {string} key @param {string} what @param {boolean} on @param {boolean} [can]
     */
    const row = (i, key, what, on, can) => listRow(t, { id: `kit-setting-${i}`, on: i === this.at, compact: true, click: (cx) => { this.flip(i); cx.notify(); } })
      .when(Boolean(key), (el) => el.child(div().id(`kit-setting-key-${i}`).w(64).flex_none().truncate().text_size(SIZE.small).font_semibold().text_color(on ? t.accent : t.dim)
        .when(Boolean(can), (k) => k.cursor_pointer().on_click((_e, cx) => { this.change(i); cx.stop_propagation(); cx.notify(); }))
        .child(key)))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.dim).child(what))
      .child(div().flex_none().text_size(SIZE.small).text_color(on ? t.accent : t.dim).child(on ? "On" : "Off"));
    const panel = v_flex().id("kit-settings-panel").absolute().top(place.top ?? 60).right(place.right ?? SIZE.framePad).w(place.width ?? 340).max_w("100%").p(12).gap(8)
      .bg(t.popover).rounded(12).border_1().border_color(t.border).shadow_lg().text_size(SIZE.text)
      // A press on the panel stays on it: what is under it does not get it.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      // The list has a set height: left to size itself it came out taller than the panel around it.
      .child(v_flex().id("kit-setting-list").flex_none().h(listHeight).overflow_y_scrollbar().track_scroll(this.scroll).gap(2)
        .child(sectionLabel(t, "Options"))
        .children(this.options.map((o, i) => row(i, "", o.label, this.option(o.id))))
        .child(sectionLabel(t, "Shortcut keys"))
        .children(this.keys.map((k, i) => row(options + i,
          this.capturing === k.id ? "press a key" : rebind && !k.fixed ? this.keyFor(k.id) || "none" : k.key, k.what, !this.off.has(k.id), rebind && !k.fixed))))
      .when(Boolean(place.note), (el) => el.child(place.note))
      .child(divider(t).flex_none())
      .child(legend(t, this.capturing !== null ? [["esc", "keep the old key"], ["backspace", "the key it came with"]]
        : rebind ? [["j/k", "move"], ["space", "on or off"], ["enter", "change key"], ["esc", "back"]]
        : [["j/k", "move"], ["space", "switch on or off"], ["esc", "back"]]));
    // A clear sheet over the whole mod, under the panel: a press beside the panel closes it, and
    // does nothing to what is under it.
    return div().id("kit-settings-around").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { this.hide(); cx.stop_propagation(); cx.notify(); })
      .on_click((_e, cx) => cx.stop_propagation())
      .child(panel);
  }
}
