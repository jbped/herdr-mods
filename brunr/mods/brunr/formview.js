// The rules of the Request form's views: which tabs show, the labels Bruno uses, the row tables,
// the fields each tab draws and what an edit of one makes of the tab's data, when a field is reset
// from the text, and JSON Prettify. Pure: the views (formui.js, formpanes.js) call these and hand
// the data they return to form.js's writeTab. Nothing here keeps state.
import { canForm, TABS, UNARY_OPERATORS } from "./form.js";

export const FILE = "file";
export const FORM_NOTE = "The form is available for HTTP Requests in YAML Collections.";
export const UNREADABLE_NOTE = "This section can only be edited in File.";
export const PRETTIFY_FAILED = "Unable to prettify. Invalid JSON format.";
export const TIMEOUT_ERROR = "Use a number of milliseconds, or inherit.";
export const NUMBER_ERROR = "Use a whole number, 0 or more.";
export const INHERIT_NOTE = "The auth comes from the folder or Collection.";

/** Bruno's tab labels, File last. */
export const TAB_LABELS = Object.freeze({
  params: "Params", body: "Body", headers: "Headers", auth: "Auth", vars: "Vars", script: "Script",
  assert: "Assert", tests: "Tests", docs: "Docs", settings: "Settings", file: "File",
});

/** Bruno's body mode menu: Form, Raw and Other groups, with Bruno's labels. `null` is a separator. */
export const BODY_MENU = Object.freeze(["multipart-form", "form-urlencoded", null, "json", "xml", "text", null, "none"]);
export const BODY_LABELS = Object.freeze({
  "multipart-form": "Multipart Form", "form-urlencoded": "Form URL Encoded", json: "JSON", xml: "XML", text: "TEXT", none: "No Body",
});
/** Bruno's auth mode menu order (the five modes Brunr models) and labels. */
export const AUTH_MENU = Object.freeze(["basic", "bearer", "apikey", "inherit", "none"]);
export const AUTH_LABELS = Object.freeze({ basic: "Basic Auth", bearer: "Bearer Token", apikey: "API Key", inherit: "Inherit", none: "No Auth" });
export const PLACEMENTS = Object.freeze(["header", "query"]);
export const PLACEMENT_LABELS = Object.freeze({ header: "Header", query: "Query Params" });
export const EDITOR_LANGUAGE = Object.freeze({ json: "json", xml: "xml", text: "text" });

/** The tabs the strip shows: the form tabs and File, or none when the form does not apply. */
export function visibleTabs(text, format) {
  if (text == null) return [];
  try { return canForm(text, format) ? [...TABS, FILE] : []; } catch { return []; }
}

/** The tab to open on: the remembered one when it is a tab, else Params. */
export const pickTab = (stored) => (stored === FILE || TABS.includes(stored) ? stored : "params");

/** What a tab label shows after its name: a count, a dot, or nothing. */
export function badgeOf(badge) {
  if (typeof badge === "number") return badge > 0 ? { count: badge } : null;
  return badge === true ? { dot: true } : null;
}

// ---- row tables ---------------------------------------------------------------------------------

const kvRow = { name: "", value: "", enabled: true };

/**
 * The row tables. `cols`: the columns after the enabled checkbox, `{ key, label, placeholder }`,
 * `readonly` for a name that follows the URL, `menu` for the assertion operator. `check`: an
 * enabled checkbox. `add`: an empty last row that adds a row, and a remove button per row.
 */
export const TABLES = Object.freeze({
  query: {
    tab: "params", title: "Query", get: (d) => d.query, put: (d, rows) => ({ ...d, query: rows }), blank: kvRow, check: true, add: true,
    cols: [{ key: "name", label: "Name", placeholder: "Name" }, { key: "value", label: "Value", placeholder: "Value" }],
  },
  path: {
    tab: "params", title: "Path", get: (d) => d.path, put: (d, rows) => ({ ...d, path: rows }), blank: null, check: false, add: false,
    cols: [{ key: "name", label: "Name", readonly: true }, { key: "value", label: "Value", placeholder: "Value" }],
  },
  headers: {
    tab: "headers", title: null, get: (d) => d, put: (_d, rows) => rows, blank: kvRow, check: true, add: true,
    cols: [{ key: "name", label: "Name", placeholder: "Name" }, { key: "value", label: "Value", placeholder: "Value" }],
  },
  form: {
    tab: "body", title: null, get: (d) => d.rows ?? [], put: (d, rows) => ({ ...d, rows }), blank: kvRow, check: true, add: true,
    cols: [{ key: "name", label: "Key", placeholder: "Key" }, { key: "value", label: "Value", placeholder: "Value" }],
  },
  pre: {
    tab: "vars", title: "Pre Request", get: (d) => d.pre, put: (d, rows) => ({ ...d, pre: rows }), blank: kvRow, check: true, add: true,
    cols: [{ key: "name", label: "Name", placeholder: "Name" }, { key: "value", label: "Value", placeholder: "Value" }],
  },
  post: {
    tab: "vars", title: "Post Response", get: (d) => d.post, put: (d, rows) => ({ ...d, post: rows }), blank: { name: "", expression: "", enabled: true }, check: true, add: true,
    cols: [{ key: "name", label: "Name", placeholder: "Name" }, { key: "expression", label: "Expr", placeholder: "Expr" }],
  },
  assert: {
    tab: "assert", title: null, get: (d) => d, put: (_d, rows) => rows, blank: { expression: "", operator: "eq", value: "", enabled: true }, check: true, add: true,
    cols: [{ key: "expression", label: "Expr", placeholder: "Expr" }, { key: "operator", label: "Operator", menu: true }, { key: "value", label: "Value", placeholder: "Value" }],
  },
});

/** The tables a tab draws for its data, in order. */
export function tablesOf(tab, data) {
  if (tab === "params") return data.path.length ? ["query", "path"] : ["query"];
  if (tab === "headers") return ["headers"];
  if (tab === "body") return data.mode === "form-urlencoded" || data.mode === "multipart-form" ? ["form"] : [];
  if (tab === "vars") return ["pre", "post"];
  if (tab === "assert") return ["assert"];
  return [];
}

const typed = (spec) => spec.cols.filter((c) => !c.menu && !c.readonly).map((c) => c.key);

/** True when every typed field of a row is empty. Such a row is not written. */
export const isEmptyRow = (spec, row) => typed(spec).every((k) => !String(row?.[k] ?? ""));

/** True when the assertion operator takes no value. */
export const isUnary = (operator) => UNARY_OPERATORS.includes(operator);

/**
 * The tab's data after an edit of table `name`. `op`:
 * - `{ type: "set", index, field, value }`: a field typed in. `index` equal to the row count is the
 *   empty last row: typing there adds a row. A row edited to empty is dropped, as it is not written.
 * - `{ type: "toggle", index }`, `{ type: "remove", index }`.
 * Returns null when nothing changes.
 */
export function tableEdit(name, data, op) {
  const spec = TABLES[name];
  const rows = spec.get(data);
  const i = op.index;
  if (op.type === "remove") return spec.add && i >= 0 && i < rows.length ? spec.put(data, rows.filter((_r, j) => j !== i)) : null;
  if (op.type === "toggle") {
    if (!spec.check || i < 0 || i >= rows.length) return null;
    return spec.put(data, rows.map((r, j) => (j === i ? { ...r, enabled: r.enabled === false } : r)));
  }
  if (op.type !== "set") return null;
  const col = spec.cols.find((c) => c.key === op.field);
  if (!col || col.readonly) return null;
  const value = String(op.value ?? "");
  if (i === rows.length) {
    if (!spec.add || col.menu) return null;
    const row = { ...spec.blank, [op.field]: value };
    return isEmptyRow(spec, row) ? null : spec.put(data, [...rows, row]);
  }
  if (i < 0 || i > rows.length) return null;
  const old = rows[i];
  if (old[op.field] === value) return null;
  let row = { ...old, [op.field]: value };
  if (name === "assert" && op.field === "operator" && isUnary(value)) row = { ...row, value: "" };
  if (name === "assert" && op.field === "value" && isUnary(row.operator)) return null;
  if (spec.add && isEmptyRow(spec, row)) return spec.put(data, rows.filter((_r, j) => j !== i));
  return spec.put(data, rows.map((r, j) => (j === i ? row : r)));
}

// ---- modes --------------------------------------------------------------------------------------

const RAW = ["json", "text", "xml"];
const FORMS = ["form-urlencoded", "multipart-form"];

/**
 * The body after a mode change. Raw modes keep the text between them and the two form modes keep
 * their rows, so a mode tried and changed back loses nothing. Otherwise the new mode starts empty.
 */
export function switchBodyMode(data, mode) {
  if (data.mode === mode) return null;
  if (mode === "none") return { mode };
  if (RAW.includes(mode)) return { mode, text: RAW.includes(data.mode) ? data.text : "" };
  if (FORMS.includes(mode)) return { mode, rows: FORMS.includes(data.mode) ? data.rows : [] };
  return null;
}

/** The auth after a mode change: as Bruno, the new mode starts with only its type. */
export const switchAuthMode = (data, mode) => (data.mode === mode || !AUTH_LABELS[mode] ? null : { mode });

/** What a popup menu's choice makes of the tab's data: `field` is bodyMode, authMode, placement or operator. */
export function menuEdit(tab, data, { field, row, value }) {
  if (tab === "body" && field === "bodyMode") return switchBodyMode(data, value);
  if (tab === "auth" && field === "authMode") return switchAuthMode(data, value);
  if (tab === "auth" && field === "placement") return data.mode === "apikey" && PLACEMENTS.includes(value) && data.placement !== value ? { ...data, placement: value } : null;
  if (tab === "assert" && field === "operator") return tableEdit("assert", data, { type: "set", index: row, field: "operator", value });
  return null;
}

// ---- fields -------------------------------------------------------------------------------------

/** Parses a settings number field: a whole number 0 or more, or "inherit" for the timeout. Null when invalid. */
export function parseSetting(key, text) {
  const s = String(text ?? "").trim();
  if (key === "timeout" && s.toLowerCase() === "inherit") return "inherit";
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/**
 * Whether a field must be given the section's value again. A field being typed in keeps its text
 * while that text is what the section holds:
 * - "text": the same string.
 * - "code": the same once trimmed, as Bruno and writeTab trim scripts and tests.
 * - "number:<key>": the same number, or "inherit", so 007 is not turned into 7 while typing. A
 *   field whose text does not parse keeps it until the section changes.
 */
export function needsReset(fieldText, sectionValue, compare = "text") {
  const f = String(fieldText ?? "");
  if (compare === "code") return f.trim() !== String(sectionValue ?? "").trim();
  if (compare.startsWith("number:")) return parseSetting(compare.slice(7), f) !== sectionValue;
  return f !== String(sectionValue ?? "");
}

const tableFields = (name, data) => {
  const spec = TABLES[name];
  const rows = spec.get(data);
  const out = [];
  const n = rows.length + (spec.add ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const r = rows[i] ?? spec.blank;
    for (const c of spec.cols) {
      if (c.menu || c.readonly) continue;
      out.push({
        id: `${name}:${i}:${c.key}`, kind: "input", value: String(r[c.key] ?? ""), compare: "text", placeholder: c.placeholder ?? "",
        edit: (d, v) => tableEdit(name, d, { type: "set", index: i, field: c.key, value: v }),
      });
    }
  }
  return out;
};

const input = (id, value, placeholder, edit, extra = {}) => ({ id, kind: "input", value: String(value ?? ""), compare: "text", placeholder, edit, ...extra });
const editor = (id, value, language, compare, edit) => ({ id, kind: "editor", value: String(value ?? ""), language, compare, edit });
const set = (key) => (d, v) => (d[key] === v ? null : { ...d, [key]: v });

/**
 * The text fields a tab draws for its data: `{ id, kind: "input"|"editor", value, compare,
 * placeholder?, masked?, language?, edit(data, text) → data | null }`. `edit` makes the tab's data
 * from the field's new text and data read from the Draft text at that moment.
 */
export function fieldsOf(tab, data) {
  const out = tablesOf(tab, data).flatMap((name) => tableFields(name, data));
  if (tab === "body" && RAW.includes(data.mode)) {
    out.push(editor(`body:${data.mode}`, data.text, EDITOR_LANGUAGE[data.mode], "text", (d, v) => (RAW.includes(d.mode) && d.text !== v ? { ...d, text: v } : null)));
  }
  if (tab === "auth") {
    if (data.mode === "basic") out.push(input("auth:username", data.username, "Username", set("username")), input("auth:password", data.password, "Password", set("password"), { masked: true }));
    if (data.mode === "bearer") out.push(input("auth:token", data.token, "Token", set("token"), { masked: true }));
    if (data.mode === "apikey") out.push(input("auth:key", data.key, "Key", set("key")), input("auth:value", data.value, "Value", set("value"), { masked: true }));
  }
  if (tab === "script") {
    out.push(editor("script:pre", data.pre, "javascript", "code", (d, v) => (d.pre.trim() === v.trim() ? null : { ...d, pre: v })));
    out.push(editor("script:post", data.post, "javascript", "code", (d, v) => (d.post.trim() === v.trim() ? null : { ...d, post: v })));
  }
  if (tab === "tests") out.push(editor("tests", data, "javascript", "code", (d, v) => (d.trim() === v.trim() ? null : v)));
  if (tab === "docs") out.push(editor("docs", data, "markdown", "text", (d, v) => (d === v ? null : v)));
  if (tab === "settings") {
    for (const key of ["timeout", "maxRedirects"]) {
      out.push(input(`settings:${key}`, String(data[key]), key === "timeout" ? "inherit" : "5", (d, v) => {
        const n = parseSetting(key, v);
        return n == null || n === d[key] ? null : { ...d, [key]: n };
      }, { compare: `number:${key}` }));
    }
  }
  return out;
}

/** The settings data with a toggle flipped. */
export const toggleSetting = (data, key) => ({ ...data, [key]: !data[key] });

/** The message under a settings number field whose text does not parse, else null. */
export function settingError(key, text) {
  if (parseSetting(key, text) != null) return null;
  return key === "timeout" ? TIMEOUT_ERROR : NUMBER_ERROR;
}

// ---- Prettify -----------------------------------------------------------------------------------

const VAR = /\{\{[^{}]*\}\}/y;

/**
 * Bruno's Prettify for a JSON body: two-space indents. Bruno variables (`{{name}}`) outside strings
 * are allowed and kept, as Bruno hashes them before formatting. Strings are copied as written.
 * `{ ok: true, text }`, or `{ ok: false, message }` when the text is not valid JSON.
 */
export function prettifyJson(text) {
  const src = String(text ?? "");
  // Validate with each variable outside a string read as a value.
  let check = "";
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"') { const end = stringEnd(src, i); if (end < 0) return fail(); check += src.slice(i, end); i = end; continue; }
    VAR.lastIndex = i;
    if (c === "{" && VAR.test(src)) { check += "0"; i = VAR.lastIndex; continue; }
    check += c; i++;
  }
  try { JSON.parse(check); } catch { return fail(); }
  let out = "", depth = 0;
  const nl = () => `\n${"  ".repeat(depth)}`;
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"') { const end = stringEnd(src, i); out += src.slice(i, end); i = end; continue; }
    VAR.lastIndex = i;
    if (c === "{" && VAR.test(src)) { out += src.slice(i, VAR.lastIndex); i = VAR.lastIndex; continue; }
    i++;
    if (/\s/.test(c)) continue;
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === close) { out += c + close; i = j + 1; continue; }
      depth++;
      out += c + nl();
    } else if (c === "}" || c === "]") { depth--; out += nl() + c; }
    else if (c === ",") out += `,${nl()}`;
    else if (c === ":") out += ": ";
    else out += c;
  }
  return { ok: true, text: out };
}

const fail = () => ({ ok: false, message: PRETTIFY_FAILED });

/** The index after the string that starts at `i`, or -1 when it does not end. */
function stringEnd(s, i) {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === '"') return j + 1;
    if (s[j] === "\n") return -1;
  }
  return -1;
}
