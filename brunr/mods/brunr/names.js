// File and display names by Bruno's rules (bruno-common utils/naming.ts and the electron
// filesystem utils writeFileUnique, mkdirUnique and getUniqueRenamePath). Pure.

const INVALID = /[<>:"/\\|?*\x00-\x1F]/g;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;
const FIRST = /^[^\s\-<>:"/\\|?*\x00-\x1F]/;
const MIDDLE = /^[^<>:"/\\|?*\x00-\x1F]*$/;
const LAST = /[^.\s<>:"/\\|?*\x00-\x1F]$/;
const MAX_DUPLICATES = 200;
const MAX_FILENAME = 255;

/** A name made safe for the file system: bad characters to `-`, no leading space or hyphen, no trailing dot or space. */
export function sanitizeName(name) {
  return String(name ?? "")
    .replace(INVALID, "-")
    .replace(/^[\s-]+/, "")
    .replace(/[.\s]+$/, "");
}

/** null for a valid file or directory name, else Bruno's message. */
export function validateName(name) {
  const s = String(name ?? "");
  if (!s) return "Name cannot be empty.";
  if (s.length > 255) return "Name cannot exceed 255 characters.";
  if (RESERVED.test(s)) return "Name cannot be a reserved device name.";
  const bad = (c) => `Special characters aren't allowed in the name. Invalid character '${c}'.`;
  if (!FIRST.test(s[0])) return bad(s[0]);
  for (let i = 1; i < s.length - 1; i++) if (!MIDDLE.test(s[i])) return bad(s[i]);
  if (!LAST.test(s[s.length - 1])) return bad(s[s.length - 1]);
  return null;
}

/**
 * The first free name of `base`, `base 1`, `base 2` … with `ext` (".yml", ".bru", or "" for a
 * directory) appended, compared with `taken` ignoring case. The base is shortened so every
 * candidate fits 255 characters. null after 200 tries.
 */
export function uniqueName(taken, base, ext = "") {
  const used = new Set([...(taken ?? [])].map((n) => String(n).toLowerCase()));
  const reserve = String(MAX_DUPLICATES - 1).length + 1;
  const max = Math.max(1, MAX_FILENAME - ext.length - reserve);
  const safe = base.length > max ? base.slice(0, max) : base;
  for (let n = 0; n < MAX_DUPLICATES; n++) {
    const candidate = `${safe}${n ? ` ${n}` : ""}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

/** `<base> copy`, then `<base> copy 2` …, the first not in `siblingNames`, after stripping copy suffixes from `name`. */
export function cloneName(siblingNames, name) {
  const base = String(name ?? "").replace(/( copy( \d+)?)+$/, "") || String(name ?? "");
  const taken = new Set(siblingNames ?? []);
  const exists = (n) => n === base || taken.has(n);
  let candidate = `${base} copy`;
  for (let n = 2; exists(candidate); n++) candidate = `${base} copy ${n}`;
  return candidate;
}
