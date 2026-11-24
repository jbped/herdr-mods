// Saving a Draft: lint, then one change-checked write through the effects runner. No views and no
// dialogs here: the result says what the view must ask. The Draft text never leaves memory.
import * as drafts from "./drafts.js";
import { runEffects } from "./effects.js";
import { lintRequest } from "./lint.js";

/**
 * Saves the Draft of one Request. `target`: `{ key, machine, root, path, format }`, `path` being
 * relative to `root`.
 * `options.force`: save even when lint warns. `options.expected`: the text on disk to write over,
 * for "Overwrite" after a conflict (default: the text the Draft started from).
 * Resolves with `{ status, ... }`:
 * - "none": the Request has no Draft.
 * - "saved".
 * - "lint": `{ warnings }`, nothing written.
 * - "conflict": `{ current }`, the file changed on disk, nothing written.
 * - "failed": `{ message }`.
 */
export async function saveDraft(target, { force = false, expected = null } = {}) {
  const rec = drafts.get(target.key);
  if (!drafts.isDraft(rec)) return { status: "none" };
  if (target.machine != null) return { status: "failed", message: "Editing works on this computer only." };
  const text = rec.text;
  if (!force) {
    const warnings = lintRequest(text, target.format);
    if (warnings.length) return { status: "lint", warnings };
  }
  const root = String(target.root).replace(/\\/g, "/").replace(/\/+$/, "");
  const r = await runEffects([{ op: "write", path: `${root}/${target.path}`, text, expected: expected ?? rec.base }], { machine: target.machine, root });
  if (r.ok) { drafts.saved(target.key, text); return { status: "saved" }; }
  if (r.failed.kind === "conflict") return { status: "conflict", current: r.failed.current };
  return { status: "failed", message: r.failed.message };
}
