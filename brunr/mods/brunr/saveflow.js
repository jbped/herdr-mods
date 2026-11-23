// The save path with its questions, for the copy that saves (the pane on ctrl-s or Save, the
// panel before a Run). A question is a brunr dialog. Its answer comes back to the asking copy
// through store.ask, which the copy hands to `answer` when it draws. The owner `o` is the copy:
// it has `o.addr` ("panel" or "pane:<tab>") and keeps its open question in `o.question`.
import { notify, openOverlay } from "herdr";
import * as drafts from "./drafts.js";
import { saveDraft } from "./save.js";
import { dialogHeight } from "./popup.js";
import { breaksRequest } from "./lint.js";

let counter = 0;

/**
 * Opens a dialog `{ title, detail?, lines?, choices: [{ id, label, primary? }] }` and calls
 * `handler(cx, choiceId)` with the choice. Esc closes it with no answer, which is a cancel.
 */
export function ask(o, dialog, handler) {
  const id = `${o.addr}-${Date.now().toString(36)}-${++counter}`;
  o.question = { id, handler };
  const d = { ...dialog, to: o.addr, flow: id };
  openOverlay({ mod: "brunr", kind: "dialog", width: 460, height: dialogHeight(d), props: { dialog: d } });
}

/** Hands an answer from store.ask to the open question. True when it was this copy's. */
export function answer(o, cx, a) {
  const q = o.question;
  if (!q || a.kind !== "dialog" || a.flow !== q.id) return false;
  o.question = null;
  q.handler(cx, a.choice);
  return true;
}

/**
 * Saves the Drafts of `targets` (`{ key, machine, root, path, format, name }`) one after another
 * by the save path: lint warnings ask "Save anyway" or "Cancel", a conflict asks "Reload from
 * disk" or "Overwrite". Stops at the first that does not complete and says which. Then calls
 * `done(cx, ok)`. Targets without a Draft are skipped.
 */
export function saveAll(o, cx, targets, done = null) {
  const flow = { queue: targets.filter((t) => drafts.has(t.key)), total: 0, saved: 0, done };
  flow.total = flow.queue.length;
  o.saving = flow;
  next(o, cx, flow, {});
}

function finish(o, cx, flow, ok) {
  if (o.saving === flow) o.saving = null;
  flow.done?.(cx, ok);
  cx.notify();
}

function stopped(o, cx, flow, t, why) {
  if (flow.total > 1) notify({ title: "Not all saved", body: `Saved ${flow.saved} of ${flow.total}. "${t.name}" was not saved${why ? `: ${why}` : "."}`, level: "warning" });
  else if (why) notify({ title: "Not saved", body: `"${t.name}": ${why}`, level: "warning" });
  finish(o, cx, flow, false);
}

function next(o, cx, flow, options) {
  const t = flow.queue[0];
  if (!t) return finish(o, cx, flow, true);
  cx.spawn(async (cx) => {
    const r = await saveDraft(t, options);
    if (o.saving !== flow) return;
    if (r.status === "saved" || r.status === "none") {
      flow.queue.shift();
      if (r.status === "saved") flow.saved++;
      return next(o, cx, flow, {});
    }
    if (r.status === "lint") {
      ask(o, {
        title: `Save "${t.name}" with ${r.warnings.length === 1 ? "a warning" : `${r.warnings.length} warnings`}?`,
        detail: `The Bruno CLI may not read this Request as you expect.${breaksRequest(r.warnings) ? " Brunr will list it as a broken file and leave it out of Runs." : ""}`,
        lines: r.warnings.map((w) => ({ line: w.line, text: w.message })),
        choices: [{ id: "cancel", label: "Cancel" }, { id: "anyway", label: "Save anyway", primary: true }],
      }, (cx, choice) => (choice === "anyway" ? next(o, cx, flow, { force: true }) : stopped(o, cx, flow, t, "")));
    } else if (r.status === "conflict") {
      ask(o, {
        title: `"${t.name}" changed on disk`,
        detail: "It changed since you started editing. Reload it and lose your changes, or overwrite it with yours.",
        choices: [{ id: "reload", label: "Reload from disk" }, { id: "overwrite", label: "Overwrite", primary: true }],
      }, (cx, choice) => {
        if (choice === "overwrite") return next(o, cx, flow, { force: true, expected: r.current });
        if (choice === "reload") drafts.discard(t.key, r.current);
        stopped(o, cx, flow, t, "");
      });
    } else stopped(o, cx, flow, t, r.message);
    cx.notify();
  });
}
