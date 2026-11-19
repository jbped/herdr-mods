// The rows of the Environment table and the .env table: edit, add, remove, enable, reveal, the
// dirty check, Bruno's name rules, and the line edits a .env table save makes. Pure: the views
// hold a table and replace it with what these functions return. A table never leaves the editor.
//
// A table is `{ rows, base, blank, next, revealed }`:
// - rows: `[{ id, name, value, enabled, secret, description, line }]`, in file order. `line` is the
//   1-based line of a .env row read from the file, null for a row added since.
// - base: the rows as last read or saved, for the dirty check and the .env edits.
// - blank: the id of the empty last row the view draws. Typing in it makes it a row.
// - revealed: the ids whose value is shown. Every value is masked until revealed.

/** Bruno's variableNameRegex (`/^[\w-.]*$/`), with an empty name refused separately. */
const NAME = /^[\w.-]*$/;
export const EMPTY_NAME = "Name cannot be empty";
export const INVALID_NAME = 'Variable contains invalid characters. Must only contain alphanumeric characters, "-", "_", "."';
export const DUPLICATE_NAME = "Another variable has this name. The last one is used.";

const clean = (r, id) => ({
  id, name: String(r.name ?? ""), value: String(r.value ?? ""), enabled: r.enabled !== false, secret: r.secret === true,
  description: String(r.description ?? ""), line: r.line ?? null,
});

/** A table of `rows` (`{ name, value, enabled?, secret?, description?, line? }`), all masked. */
export function makeTable(rows = []) {
  const list = rows.map((r, i) => clean(r, i + 1));
  return { rows: list, base: list, blank: list.length + 1, next: list.length + 2, revealed: [] };
}

/** The ids the view draws, the blank row last. */
export const ids = (t) => [...t.rows.map((r) => r.id), t.blank];

/** The row with `id`, or a fresh blank row for the blank id. */
export function rowOf(t, id) {
  return t.rows.find((r) => r.id === id) ?? (id === t.blank ? clean({}, t.blank) : null);
}

/**
 * The table with `patch` (`name`, `value`, `enabled`) made to row `id`. Typing a name or a value in
 * the blank row makes it a row and adds a new blank row. A secret row's value cannot be edited here.
 */
export function editRow(t, id, patch) {
  const allowed = {};
  for (const k of ["name", "value", "enabled"]) if (k in (patch ?? {})) allowed[k] = k === "enabled" ? patch[k] !== false : String(patch[k] ?? "");
  if (id === t.blank) {
    if (!allowed.name && !allowed.value) return t;
    const row = { ...clean({}, t.blank), ...allowed };
    return { ...t, rows: [...t.rows, row], blank: t.next, next: t.next + 1 };
  }
  const at = t.rows.findIndex((r) => r.id === id);
  if (at < 0) return t;
  if (t.rows[at].secret) delete allowed.value;
  const rows = t.rows.slice();
  rows[at] = { ...rows[at], ...allowed };
  return { ...t, rows };
}

/** The table without row `id`. */
export function removeRow(t, id) {
  if (!t.rows.some((r) => r.id === id)) return t;
  return { ...t, rows: t.rows.filter((r) => r.id !== id), revealed: t.revealed.filter((x) => x !== id) };
}

/** The table with row `id` enabled or disabled, the other way round. */
export function toggleEnabled(t, id) {
  const r = t.rows.find((x) => x.id === id);
  return r ? editRow(t, id, { enabled: !r.enabled }) : t;
}

/** Whether row `id`'s value is shown. */
export const isRevealed = (t, id) => t.revealed.includes(id);

/** True when every row with a value field, the blank one too, is revealed. */
export const allRevealed = (t) => ids(t).filter((id) => !rowOf(t, id)?.secret).every((id) => t.revealed.includes(id));

/** Shows or masks one row's value. */
export function toggleReveal(t, id) {
  return { ...t, revealed: isRevealed(t, id) ? t.revealed.filter((x) => x !== id) : [...t.revealed, id] };
}

/** Shows every value, or masks every value when all are shown. */
export function toggleRevealAll(t) {
  return { ...t, revealed: allRevealed(t) ? [] : ids(t).filter((id) => !rowOf(t, id)?.secret) };
}

const same = (a, b) => a.name === b.name && a.value === b.value && a.enabled === b.enabled && a.secret === b.secret;

/** True when the rows differ from the rows last read or saved. */
export function isDirty(t) {
  if (t.rows.length !== t.base.length) return true;
  return t.rows.some((r, i) => r.id !== t.base[i].id || !same(r, t.base[i]));
}

/** The table with its rows as the new base: after a save. Reveals stay. */
export const markSaved = (t) => ({ ...t, base: t.rows });

/**
 * The messages for each row: `{ [id]: { error?, warn? } }`. An error blocks a save: an empty name
 * or a name with other characters than Bruno allows. A name used twice is a warning.
 */
export function problems(t) {
  const out = {};
  const count = new Map();
  for (const r of t.rows) count.set(r.name, (count.get(r.name) ?? 0) + 1);
  for (const r of t.rows) {
    if (!r.name.trim()) out[r.id] = { error: EMPTY_NAME };
    else if (!NAME.test(r.name)) out[r.id] = { error: INVALID_NAME };
    else if (count.get(r.name) > 1) out[r.id] = { warn: DUPLICATE_NAME };
  }
  return out;
}

/** True when no row has an error. */
export const canSave = (t) => !Object.values(problems(t)).some((p) => p.error);

/** The rows for envfile.writeEnvironment. */
export const envRows = (t) => t.rows.map(({ name, value, enabled, secret, description }) => ({ name, value, enabled, secret, description }));

/**
 * The edits for dotenv.applyDotenv that turn the text the table was read from into the table:
 * edited rows set and rename their own line, removed rows remove theirs, new rows are added at the
 * end. Edits go from the last line up, so a removed line never moves one still to be edited.
 */
export function dotenvEdits(t) {
  const now = new Map(t.rows.map((r) => [r.id, r]));
  const edits = [];
  for (const b of [...t.base].filter((r) => r.line != null).sort((x, y) => y.line - x.line)) {
    const r = now.get(b.id);
    if (!r) { edits.push({ op: "remove", name: b.name, line: b.line }); continue; }
    if (r.value !== b.value) edits.push({ op: "set", name: b.name, value: r.value, line: b.line });
    if (r.name !== b.name) edits.push({ op: "rename", name: b.name, to: r.name, line: b.line });
  }
  for (const r of t.rows) if (r.line == null) edits.push({ op: "add", name: r.name, value: r.value });
  return edits;
}

/**
 * A .env name for an Environment variable: words split at a change from lower to upper case,
 * other characters to `_`, upper case. `apiKey` → `API_KEY`, `x-token.v2` → `X_TOKEN_V2`.
 */
export function dotenvNameFor(name) {
  const s = String(name ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
  return s || "SECRET";
}

/** The message for a .env name typed in Move to .env, or null when it is valid. */
export function dotenvNameError(name) {
  const s = String(name ?? "");
  if (!s.trim()) return EMPTY_NAME;
  return /^[\w.-]+$/.test(s) ? null : INVALID_NAME;
}

/** The message for a new .env file name, or null. `taken`: the names in the Collection root. */
export function dotenvFileError(name, taken = []) {
  const s = String(name ?? "");
  if (!/^\.env(\.[A-Za-z0-9._-]+)?$/.test(s)) return "Use .env or .env.<name>, with letters, digits, '.', '_' and '-'.";
  if (taken.some((n) => n.toLowerCase() === s.toLowerCase())) return `${s} already exists.`;
  return null;
}

/** The name a new .env file gets by default: `.env` when the Collection has none, else `.env.local`, `.env.local2` … */
export function newDotenvName(taken = []) {
  const has = (n) => taken.some((x) => x.toLowerCase() === n);
  if (!has(".env")) return ".env";
  if (!has(".env.local")) return ".env.local";
  let n = 2;
  while (has(`.env.local${n}`)) n++;
  return `.env.local${n}`;
}
