// The Request form's entry points: one reader, one writer and one badge per tab over the Draft
// text of a YAML HTTP Request. A tab owns one section of the file; writing it changes only that
// section's lines, in the shape Bruno's stringify writes it. A section the tab cannot read is
// reported (ok: false) and never rewritten. Pure: it imports only this mod's pure modules.
//
//   readTab(text, tab)        { ok: true, data } | { ok: false, reason }
//   writeTab(text, tab, data) the new text; throws when readTab is not ok
//   tabBadge(text, tab)       a count, true for a dot, or null
import { layout } from "./formsec.js";
import { sameData } from "./yamlblock.js";
import { yamlType } from "./edit.js";
import { splitLines } from "./lines.js";
import { Unreadable, params, headers, body, auth, docs, settings, BODY_MODES, AUTH_MODES, SETTINGS_FIELDS, SETTINGS_DEFAULTS } from "./formtabs.js";
import { vars, script, tests, assert, ASSERT_OPERATORS, UNARY_OPERATORS } from "./formruntime.js";

export { BODY_MODES, AUTH_MODES, SETTINGS_FIELDS, SETTINGS_DEFAULTS, ASSERT_OPERATORS, UNARY_OPERATORS };

/** The form tabs in Bruno's order. File is the view's own tab and is not listed. */
export const TABS = Object.freeze(["params", "body", "headers", "auth", "vars", "script", "assert", "tests", "docs", "settings"]);

const IMPL = { params, body, headers, auth, vars, script, assert, tests, docs, settings };

/** True when the form tabs apply: a YAML file whose top level reads and whose type is `http`. */
export function canForm(text, format) {
  if (format !== "yaml") return false;
  if (!layout(text).top) return false;
  return yamlType(splitLines(text)) === "http";
}

// ---- the data the view hands in, made into the exact shapes the readers return ------------------

const s = (v) => (v === null || v === undefined ? "" : String(v));
const rows = (list, f) => (Array.isArray(list) ? list.map(f) : []);
const kv = (r) => ({ name: s(r?.name), value: s(r?.value), enabled: r?.enabled !== false });

function num(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const NORMALIZE = {
  params: (d) => ({ query: rows(d?.query, kv), path: rows(d?.path, (r) => ({ name: s(r?.name), value: s(r?.value) })) }),
  headers: (d) => rows(d, kv),
  body(d) {
    const mode = BODY_MODES.includes(d?.mode) ? d.mode : "none";
    if (mode === "none") return { mode };
    if (mode === "form-urlencoded" || mode === "multipart-form") return { mode, rows: rows(d.rows, kv) };
    return { mode, text: s(d.text) };
  },
  auth(d) {
    const mode = AUTH_MODES.includes(d?.mode) ? d.mode : "none";
    if (mode === "basic") return { mode, username: s(d.username), password: s(d.password) };
    if (mode === "bearer") return { mode, token: s(d.token) };
    if (mode === "apikey") return { mode, key: s(d.key), value: s(d.value), placement: d.placement === "query" ? "query" : "header" };
    return { mode };
  },
  vars: (d) => ({
    pre: rows(d?.pre, kv),
    post: rows(d?.post, (r) => ({ name: s(r?.name), expression: s(r?.expression), enabled: r?.enabled !== false })),
  }),
  script: (d) => ({ pre: s(d?.pre), post: s(d?.post) }),
  tests: (d) => s(d),
  docs: (d) => s(d),
  assert: (d) => rows(d, (r) => {
    const operator = ASSERT_OPERATORS.includes(r?.operator) ? r.operator : "eq";
    return { expression: s(r?.expression), operator, value: UNARY_OPERATORS.includes(operator) ? "" : s(r?.value), enabled: r?.enabled !== false };
  }),
  /** Bruno's stringify: a timeout of 0 or less is 0, a negative redirect limit is the default 5. */
  settings: (d) => {
    const timeout = d?.timeout === "inherit" ? "inherit" : Math.max(0, num(d?.timeout, 0));
    const max = Math.trunc(num(d?.maxRedirects, 5));
    return {
      encodeUrl: d?.encodeUrl === true, timeout, followRedirects: d?.followRedirects !== false,
      maxRedirects: max >= 0 ? max : 5, forwardAuthorizationHeader: d?.forwardAuthorizationHeader !== false,
    };
  },
};

function tabOf(tab) {
  const impl = IMPL[tab];
  if (!impl) throw new Error(`unknown form tab: ${tab}`);
  return impl;
}

function readIn(L, tab) {
  if (!L.top) return { ok: false, reason: "the file is not a YAML map Brunr can read" };
  // Any failure to read is reported, so a section is never rewritten from a partial reading.
  try {
    return { ok: true, data: tabOf(tab).read(L) };
  } catch (e) {
    return { ok: false, reason: e instanceof Unreadable ? e.message : `cannot read: ${e?.message ?? e}` };
  }
}

/** The tab's section as form data, `{ ok: true, data }`, or `{ ok: false, reason }` when it cannot be read. */
export function readTab(text, tab) {
  tabOf(tab);
  return readIn(layout(text), tab);
}

/**
 * The text with the tab's section written from `data`. Unchanged data returns `text` itself.
 * Throws when the section cannot be read (readTab not ok), so an unreadable section is never
 * rewritten; the view checks readTab first and offers File instead.
 */
export function writeTab(text, tab, data) {
  const L = layout(text);
  const cur = readIn(L, tab);
  if (!cur.ok) throw new Error(`the ${tab} section can only be edited in File: ${cur.reason}`);
  const next = NORMALIZE[tab](data);
  if (sameData(next, cur.data)) return L.text;
  return tabOf(tab).write(L, next);
}

/** What the tab's label shows, as Bruno's tabs do: a count, true for a dot, or null. */
export function tabBadge(text, tab) {
  const L = layout(text);
  const cur = readIn(L, tab);
  if (!cur.ok) return true;
  try {
    return tabOf(tab).badge(L, cur.data);
  } catch {
    return null;  // Settings' dot reads info.tags, which may not read
  }
}
