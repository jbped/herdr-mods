// The Environment editor (envedit.js) and the .env editor (dotedit.js) in the dialog. A Herdr window
// sits under a dialog, so an editor is drawn inside the dialog instead, in place of its three
// columns, until it closes. One editor at a time. Its values live only in its state, which this
// object holds while it is open and drops when it closes. Nothing of it reaches store.Saved,
// shared state, a picker, the note line or a log.
//
// In the dialog:
//   init:    this.editors = new Editors({ handle, envGone(ck, name, newName, cx) });
//   open:    this.editors.show("env" | "dotenv", entry, path, cx)
//   keys:    while it is open, esc is this.editors.escape() and the save key this.editors.save(cx)
//   render:  this.editors.render(t) in place of the columns
//   close:   this.editors.close()
import * as envedit from "./envedit.js";
import * as envview from "./envview.js";
import * as dotedit from "./dotedit.js";
import * as dotview from "./dotview.js";
import * as parts from "./editparts.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/**
 * What the editors need from the dialog: its keyboard, and what to do after an Environment was
 * renamed (`newName`) or deleted (`newName` null). Names only, never a value.
 * @typedef {{ handle: any, envGone: (ck: string, name: string, newName: string | null, cx: Context | AsyncContext) => void }} EditorsHost
 */

export class Editors {
  /** @param {EditorsHost} host */
  constructor(host) {
    this.host = host;
    /** @type {any} the open editor: `{ kind, ed, handle, ... }`, or null */
    this.self = null;
  }

  get open() { return Boolean(this.self); }

  /**
   * Opens an editor for a Collection on this computer. `path`: the Environment file (relative to
   * the root) or the .env file name to show first, else the first one.
   * @param {"env" | "dotenv"} kind @param {{ key: string, machine: string | null, root: string }} entry @param {string | null} path @param {Context | AsyncContext} cx
   */
  show(kind, entry, path, cx) {
    this.close();
    /** @type {any} */
    const self = {
      kind, ck: entry.key, ed: null, handle: this.host.handle,
      closeEditor: () => { if (this.self === self) this.close(); },
      // Each call takes the context of its own turn: one kept from an earlier turn cannot spawn.
      openDotenv: (/** @type {Context | AsyncContext} */ cx) => { if (this.self === self) this.show("dotenv", entry, ".env", cx); },
      envGone: (/** @type {string} */ name, /** @type {string | null} */ newName, /** @type {Context | AsyncContext} */ cx) => this.host.envGone(entry.key, name, newName, cx),
    };
    this.self = self;
    const p = { machine: entry.machine ?? null, root: entry.root, path };
    if (kind === "env") envedit.init(self, cx, p);
    else dotedit.init(self, cx, p);
  }

  /** Drops the editor and every value in it, unsaved edits too. */
  close() {
    const self = this.self;
    this.self = null;
    if (!self) return;
    if (self.kind === "env") envedit.close(self);
    else dotedit.close(self);
    this.host.handle.focus();
  }

  /** Esc: cancels an open question, else closes, asking first when there are unsaved edits. */
  escape() {
    if (this.self) parts.requestClose(this.self);
  }

  /** The save key: the editor saves its file. A Request's Draft is not saved while an editor is open. @param {Context | AsyncContext} cx */
  save(cx) {
    this.self?.ed?.save?.(cx);
  }

  /** @param {any} _t the theme (the editor views read it themselves) */
  render(_t) {
    const self = this.self;
    return self.kind === "env" ? envview.render(self) : dotview.render(self);
  }
}
