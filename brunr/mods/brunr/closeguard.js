// Lets the launcher copy (the key) ask the open dialog to close, so the dialog can ask about an
// open editor's unsaved edits first. Module memory is shared by the mod's copies. Only a yes or no
// crosses here, never a value.

/** @type {(() => boolean) | null} the open dialog's "do I have unsaved editor edits?" */
let holds = null;
/** @type {Array<() => void>} */
let waiters = [];

/** The dialog registers its check when it starts, and passes null as it closes. @param {(() => boolean) | null} check */
export function set(check) { holds = check; }

/**
 * The launcher calls this before it closes the dialog. True: the dialog has unsaved editor edits,
 * was told to ask, and must be left open.
 */
export function request() {
  let held = false;
  try { held = Boolean(holds?.()); } catch { held = false; }
  if (!held) return false;
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
  return true;
}

/** Resolves the next time a close was held back. @returns {Promise<void>} */
export function nextRequest() { return new Promise((resolve) => waiters.push(resolve)); }
