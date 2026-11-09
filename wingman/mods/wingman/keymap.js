// Keyboard shortcuts: every rebindable action, its defaults (VS Code-like), the user's overrides
// (data/wingman/keys.json: { "<action>": ["key", ...] }) and conflicts. Pure.
// Scope "edit" acts while the text cursor is in a file, before basic editing; "pane" acts after
// basic editing, so a pane key that text editing also uses only works outside the cursor;
// "find" acts while the find bar has the keyboard.

export const ACTIONS = [
  // Review
  { id: "accept", label: "Accept selected lines, else the current change", group: "Review", scope: "pane", keys: ["ctrl-y"] },
  { id: "reject", label: "Reject selected lines, else the current change", group: "Review", scope: "pane", keys: ["ctrl-n"] },
  { id: "acceptFile", label: "Accept file", group: "Review", scope: "pane", keys: ["ctrl-shift-enter"] },
  { id: "rejectFile", label: "Reject file", group: "Review", scope: "pane", keys: ["ctrl-shift-backspace"] },
  { id: "nextChange", label: "Next change", group: "Review", scope: "pane", keys: ["ctrl-down"] },
  { id: "prevChange", label: "Previous change", group: "Review", scope: "pane", keys: ["ctrl-up"] },
  { id: "comment", label: "Comment on the selection or change", group: "Review", scope: "pane", keys: ["ctrl-m"] },
  { id: "reason", label: "Comment on the last rejection", group: "Review", scope: "pane", keys: ["ctrl-r"] },
  // Files and views
  { id: "nextFile", label: "Next file", group: "Files and views", scope: "pane", keys: ["ctrl-shift-down"] },
  { id: "prevFile", label: "Previous file", group: "Files and views", scope: "pane", keys: ["ctrl-shift-up"] },
  { id: "quickOpen", label: "Quick Open", group: "Files and views", scope: "pane", keys: ["ctrl-p"] },
  { id: "toggleView", label: "Switch Review / Edit view", group: "Files and views", scope: "pane", keys: ["ctrl-shift-r"] },
  { id: "toggleTree", label: "Show or hide the file tree", group: "Files and views", scope: "pane", keys: ["ctrl-b"] },
  { id: "openInVSCode", label: "Open in external editor", group: "Files and views", scope: "pane", keys: ["ctrl-e"] },
  { id: "toggleWrap", label: "Toggle line wrap", group: "Files and views", scope: "pane", keys: ["alt-z"] },
  { id: "openInNvim", label: "Open in Neovim", group: "Files and views", scope: "pane", keys: ["ctrl-o"] },
  // Editing
  { id: "save", label: "Save", group: "Editing", scope: "pane", keys: ["ctrl-s"] },
  { id: "undo", label: "Undo", group: "Editing", scope: "pane", keys: ["ctrl-z"] },
  { id: "redo", label: "Redo", group: "Editing", scope: "pane", keys: ["ctrl-shift-y"] },
  { id: "selectAll", label: "Select all", group: "Editing", scope: "edit", keys: ["ctrl-a"] },
  { id: "copy", label: "Copy", group: "Editing", scope: "edit", keys: ["ctrl-c"] },
  { id: "cut", label: "Cut", group: "Editing", scope: "edit", keys: ["ctrl-x"] },
  { id: "paste", label: "Paste", group: "Editing", scope: "edit", keys: ["ctrl-v"] },
  // Lines
  { id: "moveLineUp", label: "Move lines up", group: "Lines", scope: "edit", keys: ["alt-up"] },
  { id: "moveLineDown", label: "Move lines down", group: "Lines", scope: "edit", keys: ["alt-down"] },
  { id: "copyLineUp", label: "Copy lines up", group: "Lines", scope: "edit", keys: ["alt-shift-up"] },
  { id: "copyLineDown", label: "Copy lines down", group: "Lines", scope: "edit", keys: ["alt-shift-down"] },
  { id: "deleteLine", label: "Delete lines", group: "Lines", scope: "edit", keys: ["ctrl-shift-k"] },
  { id: "joinLines", label: "Join lines", group: "Lines", scope: "edit", keys: ["ctrl-j"] },
  { id: "toggleComment", label: "Toggle comment", group: "Lines", scope: "edit", keys: ["ctrl-/"] },
  // Find
  { id: "find", label: "Find", group: "Find", scope: "pane", keys: ["ctrl-f"] },
  { id: "replace", label: "Replace", group: "Find", scope: "pane", keys: ["ctrl-h"] },
  { id: "goToLine", label: "Go to line", group: "Find", scope: "pane", keys: ["ctrl-g"] },
  { id: "findNext", label: "Next match", group: "Find", scope: "pane", keys: ["f3"] },
  { id: "findPrev", label: "Previous match", group: "Find", scope: "pane", keys: ["shift-f3"] },
  { id: "findCase", label: "Toggle match case (find bar)", group: "Find", scope: "find", keys: ["alt-c"] },
  { id: "findWord", label: "Toggle whole word (find bar)", group: "Find", scope: "find", keys: ["alt-w"] },
  { id: "findRegex", label: "Toggle regular expression (find bar)", group: "Find", scope: "find", keys: ["alt-r"] },
  { id: "replaceAll", label: "Replace all (find bar)", group: "Find", scope: "find", keys: ["ctrl-alt-enter"] },
];

export const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** Keys the editor keeps for text editing and moving: rebinding one is refused. */
const FIXED = /^(shift-)?(ctrl-)?(shift-)?(left|right|up|down|home|end|pageup|pagedown)$|^(ctrl-)?(backspace|delete)$|^(shift-)?(enter|tab|escape)$/;

/** Why `key` can't be bound, or null. Plain characters type text; moving and deleting keys are fixed. */
export function refused(key) {
  if (FIXED.test(key)) return "used for moving and editing text";
  const parts = key.split("-"), last = parts[parts.length - 1] || "-";
  const mods = parts.slice(0, -1).filter(Boolean);
  if (!mods.some((m) => m === "ctrl" || m === "alt" || m === "cmd" || m === "platform") && !/^f\d+$/.test(last)) return "types text";
  return null;
}

/** Each action's keys: the defaults with the user's overrides on top. */
export function resolve(overrides = {}) {
  const map = new Map();
  for (const a of ACTIONS) map.set(a.id, Array.isArray(overrides[a.id]) ? overrides[a.id].filter((k) => typeof k === "string") : a.keys);
  return map;
}

/** key -> action ids for one scope ("edit", "pane", "find"); the first action listed wins a shared key. */
export function index(keymap, scope) {
  const out = new Map();
  for (const a of ACTIONS) if (a.scope === scope) for (const k of keymap.get(a.id) ?? []) if (!out.has(k)) out.set(k, a.id);
  return out;
}

/** The other actions bound to `key`. */
export function holders(keymap, key, except) {
  return ACTIONS.filter((a) => a.id !== except && (keymap.get(a.id) ?? []).includes(key)).map((a) => a.id);
}

/** Overrides after `key` goes to `id` (removed from any other action that had it). */
export function bind(overrides, keymap, id, key) {
  const next = { ...overrides };
  for (const other of holders(keymap, key, id)) next[other] = (keymap.get(other) ?? []).filter((k) => k !== key);
  const mine = keymap.get(id) ?? [];
  if (!mine.includes(key)) next[id] = [...mine, key];
  return clean(next);
}

export function unbind(overrides, keymap, id, key) {
  return clean({ ...overrides, [id]: (keymap.get(id) ?? []).filter((k) => k !== key) });
}

export function reset(overrides, id) {
  const next = { ...overrides };
  delete next[id];
  return next;
}

/** Drops overrides that equal the defaults. */
function clean(o) {
  const out = {};
  for (const [id, keys] of Object.entries(o)) {
    const a = BY_ID.get(id);
    if (a && !(keys.length === a.keys.length && keys.every((k, i) => k === a.keys[i]))) out[id] = keys;
  }
  return out;
}

/** A keystroke as gpui reports it ("ctrl-shift-k"), or null for a lone modifier. */
export function keystrokeOf(e) {
  if (!e?.key || /^(shift|control|ctrl|alt|platform|meta|cmd|super|fn|capslock)$/i.test(e.key)) return null;
  return e.keystroke ?? null;
}

const NAMES = { up: "↑", down: "↓", left: "←", right: "→", enter: "⏎", backspace: "⌫", escape: "Esc", space: "Space" };

/** A key for buttons and menus: "ctrl-shift-enter" -> "ctrl-shift-⏎". */
export function keyLabel(key) {
  if (!key) return "";
  const parts = key.split("-"), last = parts.pop() || "-";
  return [...parts.filter(Boolean), NAMES[last] ?? last].join("-");
}

/**
 * Herdr's keys.json text with its "mod:wingman" section set to `entries` ({ key: "wingman.<id>" })
 * plus whatever the user put there that isn't Wingman's. Only that section's text changes.
 * Returns the new text, or null when nothing changes.
 */
export function withModSection(text, entries) {
  const data = JSON.parse(text);
  const old = data["mod:wingman"] ?? {};
  const mine = (v) => typeof v === "string" && v.startsWith("wingman.");
  const merged = {};
  for (const [k, v] of Object.entries(old)) if (!mine(v)) merged[k] = v;
  for (const [k, v] of Object.entries(entries)) if (!(k in merged)) merged[k] = v;
  if (JSON.stringify(merged) === JSON.stringify(old)) return null;
  const body = Object.entries(merged).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  const section = `"mod:wingman": {\n${body}\n  }`;
  const at = /"mod:wingman"\s*:\s*\{[^{}]*\}/.exec(text);
  // A section holding objects ({ command, args }) can't be found as plain text: rewrite the file.
  if (!at && "mod:wingman" in data) {
    if (body) data["mod:wingman"] = merged; else delete data["mod:wingman"];
    return JSON.stringify(data, null, 2) + "\n";
  }
  if (at) {
    if (!body) return text.slice(0, at.index).replace(/,\s*$/, "") + text.slice(at.index + at[0].length).replace(/^\s*,?/, "\n");
    return text.slice(0, at.index) + section + text.slice(at.index + at[0].length);
  }
  if (!body) return null;
  const end = text.lastIndexOf("}");
  return text.slice(0, end).replace(/\s*$/, "") + `,\n  ${section}\n}\n`;
}

/** Herdr's global bindings: { key: action description }. */
export function herdrGlobal(text) {
  try {
    const g = JSON.parse(text).global ?? {};
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === "string" ? v : v?.command ?? "?"]));
  } catch { return {}; }
}
