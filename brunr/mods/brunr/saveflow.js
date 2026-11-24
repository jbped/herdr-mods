// The save path with its questions. A question is a picker in the dialog (picker.js), answered in
// the dialog's own turn. The owner `o` is the Request column (request.js): it opens pickers through
// `o.host.openPicker`, says what happened through `o.host.say`, and keeps its save in progress in
// `o.saving`.
//
// The dialog can close during a save. Herdr then cancels the copy's tasks, so `settle`, called from
// the dialog's close, finishes what was being written and releases the save's state here and on
// the owner. A Draft that waited on a question stays a Draft.
import * as drafts from "./drafts.js";
import { saveDraft } from "./save.js";
import { breaksRequest } from "./lint.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {Context | AsyncContext} AnyContext */
/** A Request to save: `{ key, machine, root, path, format, name }`. @typedef {{ key: string, machine: string | null, root: string, path: string, format: string, name: string }} Target */
/**
 * A save in progress. `phase`: "writing" while a write is under way, "asking" while a question is
 * open. `options`: the save options of the Request being written. `closed`: settled by a close.
 * @typedef {{ queue: Target[], total: number, saved: number, done: ((cx: AnyContext, ok: boolean) => void) | null, phase: string, options: object, closed: boolean }} Flow
 */
/**
 * What the save path needs from its owner.
 * @typedef {{ saving: Flow | null, host: { openPicker: (p: import("./picker.js").Picker, cx?: AnyContext | null) => void, say: (text: string, bad?: boolean) => void } }} Owner
 */

/** Draft key -> the save in progress that holds it, across every copy of the mod. */
const active = new Map();

/** True while a save holds this Draft. @param {string} key */
export const isSaving = (key) => active.has(key);

/**
 * Asks a question in a picker: `{ title, detail?, lines?, choices: [{ id, label, primary? }] }`.
 * `handler(cx, choiceId)` gets the choice, or "cancel" when the picker closes with none.
 * @param {Owner} o @param {{ title: string, detail?: string, lines?: import("./picker.js").Line[], choices: { id: string, label: string, primary?: boolean }[] }} dialog
 * @param {(cx: AnyContext | null, choice: string) => void} handler @param {AnyContext | null} [cx]
 */
export function ask(o, dialog, handler, cx = null) {
  o.host.openPicker({
    title: dialog.title, detail: dialog.detail, lines: dialog.lines,
    options: dialog.choices.map((c) => ({ label: c.label, value: c.id })),
    at: Math.max(0, dialog.choices.findIndex((c) => c.primary)),
    choose: (value, cx) => handler(cx, value),
    cancel: (cx) => handler(cx, "cancel"),
  }, cx);
}

/**
 * Saves the Drafts of `targets` one after another by the save path: lint warnings ask "Save anyway"
 * or "Cancel", a conflict asks "Reload from disk" or "Overwrite". Stops at the first that does not
 * complete and says which. Then calls `done(cx, ok)`. Targets without a Draft are skipped.
 * @param {Owner} o @param {AnyContext} cx @param {Target[]} targets @param {((cx: AnyContext, ok: boolean) => void) | null} [done]
 */
export function saveAll(o, cx, targets, done = null) {
  const queue = targets.filter((t) => drafts.has(t.key));
  /** @type {Flow} */
  const flow = { queue, total: queue.length, saved: 0, done, phase: "writing", options: {}, closed: false };
  for (const t of queue) active.set(t.key, flow);
  o.saving = flow;
  next(o, cx, flow, {});
}

/** @param {Flow} flow */
function release(flow) {
  for (const [key, f] of [...active]) if (f === flow) active.delete(key);
}

/** @param {Owner} o @param {AnyContext | null} cx @param {Flow} flow @param {boolean} ok */
function finish(o, cx, flow, ok) {
  release(flow);
  if (o.saving === flow) o.saving = null;
  if (flow.closed || !cx) return;
  flow.done?.(cx, ok);
  cx.notify();
}

/** @param {Owner} o @param {AnyContext | null} cx @param {Flow} flow @param {Target} t @param {string} why */
function stopped(o, cx, flow, t, why) {
  if (flow.total > 1) o.host.say(`Saved ${flow.saved} of ${flow.total}. "${t.name}" was not saved${why ? `: ${why}` : "."}`);
  else if (why) o.host.say(`"${t.name}" was not saved: ${why}`);
  finish(o, cx, flow, false);
}

/** @param {Owner} o @param {AnyContext | null} cx @param {Flow} flow @param {object} options */
function next(o, cx, flow, options) {
  if (flow.closed) return;
  const t = flow.queue[0];
  if (!t) return finish(o, cx, flow, true);
  flow.phase = "writing";
  flow.options = options;
  if (!cx) return;
  cx.spawn(async (cx) => {
    const r = await saveDraft(t, options);
    if (flow.closed || o.saving !== flow) return;
    if (r.status === "saved" || r.status === "none") {
      flow.queue.shift();
      if (r.status === "saved") flow.saved++;
      return next(o, cx, flow, {});
    }
    flow.phase = "asking";
    if (r.status === "lint") {
      ask(o, {
        title: `Save "${t.name}" with ${r.warnings.length === 1 ? "a warning" : `${r.warnings.length} warnings`}?`,
        detail: `The Bruno CLI may not read this Request as you expect.${breaksRequest(r.warnings) ? " Brunr will list it as a broken file and leave it out of Runs." : ""}`,
        lines: r.warnings.map((/** @type {any} */ w) => ({ line: w.line, text: w.message })),
        choices: [{ id: "cancel", label: "Cancel" }, { id: "anyway", label: "Save anyway", primary: true }],
      }, (cx, choice) => (choice === "anyway" ? next(o, cx, flow, { force: true }) : stopped(o, cx, flow, t, "")), cx);
    } else if (r.status === "conflict") {
      ask(o, {
        title: `"${t.name}" changed on disk`,
        detail: "It changed since you started editing. Reload it and lose your changes, or overwrite it with yours.",
        choices: [{ id: "reload", label: "Reload from disk" }, { id: "overwrite", label: "Overwrite", primary: true }],
      }, (cx, choice) => {
        if (choice === "overwrite") return next(o, cx, flow, { force: true, expected: r.current });
        if (choice === "reload") drafts.discard(t.key, r.current);
        stopped(o, cx, flow, t, "");
      }, cx);
    } else stopped(o, cx, flow, t, r.message);
    cx.notify();
  });
}

/**
 * Ends the owner's save when the dialog closes, whether or not its tasks still run. The Request
 * being written is written, by the same options, and the ones queued after it are saved unless
 * one needs a question. A write that landed before the close is taken as saved. A save waiting on
 * a question stops there and its Draft stays. The save's state is released either way.
 * @param {Owner} o
 */
export async function settle(o) {
  const flow = o.saving;
  o.saving = null;
  if (!flow) return;
  flow.closed = true;
  try {
    /** @type {object | null} */
    let options = flow.phase === "writing" ? flow.options : null;
    for (const t of flow.queue) {
      if (!options) break;
      const r = await saveDraft(t, options);
      if (r.status === "conflict" && r.current === drafts.get(t.key)?.text) drafts.saved(t.key, r.current);
      else if (r.status !== "saved" && r.status !== "none") break;
      options = {};
    }
  } finally {
    release(flow);
  }
}

/**
 * A folder or Collection Run with Drafts in it asks first: save them and run, run without saving,
 * or cancel. `run(cx)` starts the Run. `text` is the Run's confirmation.
 * @param {Owner} o @param {AnyContext} cx @param {Target[]} targets the Requests with a Draft @param {string} text
 * @param {(cx: AnyContext) => void} run
 */
export function askBeforeRun(o, cx, targets, text, run) {
  const n = targets.length;
  ask(o, {
    title: `${n} ${n === 1 ? "Request has" : "Requests have"} unsaved changes.`,
    detail: `Save them and run, run without saving, or cancel. ${text}`,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "run", label: "Run without saving" }, { id: "save", label: "Save and run", primary: true }],
  }, (cx, choice) => {
    if (!cx) return;
    if (choice === "run") run(cx);
    else if (choice === "save") saveAll(o, cx, targets, (cx, ok) => { if (ok) run(cx); });
  }, cx);
}
