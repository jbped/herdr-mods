// The form tabs over the `http` block and the top-level `docs` and `settings`: Params, Headers,
// Body, Auth, Docs and Settings. Each tab reads its section into plain data, or throws when the
// section is not in a shape it can edit, and writes edited data back as Bruno's stringify writes
// it, changing only that section's lines (Params also changes the url line, as Bruno does).
// Shapes are from @usebruno/filestore formats/yml (stringifyHttpRequest, common/*). Pure.
import { childLines, topLines, sectionValue, putChild, putTop, readList, writeList } from "./formsec.js";
import { mapEntries, entryLines, setEntry, setValue, setDisabled, indent, blankOrComment } from "./yamlblock.js";
import { readHead, setUrl } from "./edit.js";
import { splitOnFirst, parseQueryParams } from "./urlsync.js";

export class Unreadable extends Error {}
export const fail = (what) => { throw new Unreadable(what); };

/** A scalar as the form shows it: "" for none, numbers and booleans as text. Throws on a block. */
export function str(v, what = "value") {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") fail(`a ${what} is not a plain value`);
  return String(v);
}

const on = (obj) => obj.disabled !== true;

/** A section that must be a block map: `{ obj, map }` with `map` its entries below the key line. */
function mapSection(r, key) {
  const value = sectionValue(r, key);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${key} is not a map`);
  const first = r.slice(1).find((s) => !blankOrComment(s));
  const col = first ? indent(first) : 2;
  const bodies = r.slice(1);
  const entries = mapEntries(bodies, 0, bodies.length, col);
  if (!entries || col === 0 || entries.length !== Object.keys(value).length) fail(`${key} is not in block form`);
  return { obj: value, map: { bodies, col, entries, head: null, prefix: null } };
}

/** A list section's rows; fails when it, or the block holding it, cannot be read. */
export function list(r, key) {
  if (r === false) fail("the block holding the section cannot be read");
  return readList(r, key) ?? fail(`${key} is not a list of rows in block form`);
}

/** A row spec for `{ name, value, enabled }` rows; `extra(row, col)` adds lines after the value. */
function kvSpec(order, extra = () => []) {
  return {
    name: (row) => row.name,
    oldName: (obj) => str(obj.name),
    same: (obj, row) => str(obj.name) === row.name && str(obj.value) === row.value && on(obj) === row.enabled,
    edit: (map, obj, row) => setDisabled(setValue(setValue(map, "name", row.name, obj.name, order), "value", row.value, obj.value, order), row.enabled, obj.disabled, order),
    fresh: (row, col) => [...entryLines(col, "name", row.name), ...entryLines(col, "value", row.value), ...extra(row, col), ...(row.enabled ? [] : entryLines(col, "disabled", true))],
  };
}

const kvRows = (items, what) => items.map(({ obj }) => ({ name: str(obj.name, what), value: str(obj.value, what), enabled: on(obj) }));

// ---- headers --------------------------------------------------------------------------------

const HEADER_ORDER = ["name", "value", "description", "disabled"];

export const headers = {
  read: (L) => kvRows(list(childLines(L, "http", "headers"), "headers").items, "header"),
  write(L, rows) {
    const r = childLines(L, "http", "headers");
    return putChild(L, "http", "headers", writeList(r, "headers", list(r, "headers"), rows, kvSpec(HEADER_ORDER)));
  },
  badge: (L, rows) => rows.filter((x) => x.enabled).length || null,
};

// ---- params -----------------------------------------------------------------------------------

const PARAM_ORDER = ["name", "value", "type", "description", "disabled"];

function readParams(L) {
  const { items } = list(childLines(L, "http", "params"), "params");
  for (const { obj } of items) if (obj.type !== "query" && obj.type !== "path") fail("a param has no query or path type");
  return items;
}

/** Bruno's buildQueryString: `name=value` pairs of the rows with a name, not encoded. */
export const buildQueryString = (rows) => rows.filter((p) => p.name.trim()).map((p) => `${p.name}=${p.value}`).join("&");

/**
 * The Query rows: the file's rows as they are, as Bruno's Params tab shows them, then the URL's
 * query params that no enabled row names, enabled. So a row the URL lacks still shows, and an edit
 * keeps every param the URL had.
 */
function queryRows(L, rows) {
  const url = readHead(L.text, "yaml").url;
  if (url === null) return rows;
  const left = rows.filter((r) => r.enabled).map((r) => r.name);
  const extra = [];
  for (const p of parseQueryParams(splitOnFirst(url, "?")[1])) {
    const at = left.indexOf(p.name);
    if (at >= 0) left.splice(at, 1);
    else extra.push({ name: p.name, value: p.value ?? "", enabled: true });
  }
  return extra.length ? [...rows, ...extra] : rows;
}

export const params = {
  read(L) {
    const items = readParams(L);
    return {
      query: queryRows(L, items.filter((x) => x.obj.type === "query").map(({ obj }) => ({ name: str(obj.name), value: str(obj.value), enabled: on(obj) }))),
      path: items.filter((x) => x.obj.type === "path").map(({ obj }) => ({ name: str(obj.name), value: str(obj.value) })),
    };
  },
  /**
   * Bruno's setQueryParams: query rows first, then the path rows as they are (a path row whose
   * `:name` left the URL stays, as in Bruno); the URL's query is rebuilt.
   */
  write(L, data) {
    const r = childLines(L, "http", "params");
    const old = list(r, "params");
    const url = readHead(L.text, "yaml").url;
    const parts = url === null ? null : splitOnFirst(url, "?");
    const rows = [...data.query.map((p) => ({ ...p, type: "query" })), ...data.path.map((p) => ({ ...p, type: "path", enabled: true }))];
    const spec = {
      name: (row) => `${row.type}:${row.name}`,
      oldName: (obj) => `${obj.type}:${str(obj.name)}`,
      same: (obj, row) => obj.type === row.type && str(obj.name) === row.name && str(obj.value) === row.value && (row.type === "path" || on(obj) === row.enabled),
      edit(map, obj, row) {
        let m = setValue(setValue(map, "name", row.name, obj.name, PARAM_ORDER), "value", row.value, obj.value, PARAM_ORDER);
        m = setValue(m, "type", row.type, obj.type, PARAM_ORDER);
        return row.type === "path" ? m : setDisabled(m, row.enabled, obj.disabled, PARAM_ORDER);
      },
      fresh: (row, col) => kvSpec(PARAM_ORDER, (x, c) => entryLines(c, "type", x.type)).fresh(row, col),
    };
    const text = putChild(L, "http", "params", writeList(r, "params", { ...old, items: old.items }, rows, spec));
    if (!parts) return text;
    const query = buildQueryString(data.query.filter((p) => p.enabled));
    const next = query ? `${parts[0]}?${query}` : parts[0];
    return next === url ? text : setUrl(text, "yaml", next);
  },
  badge: (L, data) => data.query.filter((p) => p.enabled).length + readParams(L).filter(({ obj }) => obj.type === "path" && on(obj)).length || null,
};

// ---- body -------------------------------------------------------------------------------------

export const BODY_MODES = ["none", "json", "text", "xml", "form-urlencoded", "multipart-form"];
const TEXT_MODES = ["json", "text", "xml"];
const BODY_ORDER = ["type", "data"];
const MULTIPART_ORDER = ["name", "type", "value", "contentType", "description", "disabled"];
const FORM_SPEC = kvSpec(HEADER_ORDER);
const MULTIPART_SPEC = { ...kvSpec(MULTIPART_ORDER), fresh: (row, col) => [...entryLines(col, "name", row.name), ...entryLines(col, "type", "text"), ...entryLines(col, "value", row.value), ...(row.enabled ? [] : entryLines(col, "disabled", true))] };

/** The body section: `{ obj, map, data, dataLines }` or null when there is none. */
function readBody(L) {
  const r = childLines(L, "http", "body");
  if (r === false) fail("the http block cannot be read");
  if (!r) return null;
  const { obj, map } = mapSection(r, "body");
  if (!BODY_MODES.includes(obj.type) || obj.type === "none") fail(`a ${obj.type} body`);
  const e = map.entries.find((x) => x.key === "data");
  const dataLines = e ? map.bodies.slice(e.line, e.end).map((s) => s.slice(Math.min(map.col, indent(s)))) : null;
  if (TEXT_MODES.includes(obj.type)) return { r, obj, map, data: { mode: obj.type, text: str(obj.data, "body") } };
  const rows = list(dataLines, "data");
  if (obj.type === "multipart-form" && rows.items.some(({ obj: x }) => x.type !== "text")) fail("a multipart row that is a file");
  return { r, obj, map, rows, dataLines, data: { mode: obj.type, rows: kvRows(rows.items, "form row") } };
}

export const body = {
  read: (L) => readBody(L)?.data ?? { mode: "none" },
  write(L, data) {
    const cur = readBody(L);
    if (data.mode === "none") return putChild(L, "http", "body", null);
    const spec = data.mode === "multipart-form" ? MULTIPART_SPEC : FORM_SPEC;
    if (cur && cur.data.mode === data.mode) {
      let m = cur.map;
      if (TEXT_MODES.includes(data.mode)) m = setValue(m, "data", data.text, cur.obj.data, BODY_ORDER);
      else {
        const rel = writeList(cur.dataLines, "data", cur.rows, data.rows, spec);
        m = setEntry(m, "data", rel && rel.map((s) => (s ? " ".repeat(m.col) + s : s)), BODY_ORDER);
      }
      return putChild(L, "http", "body", [cur.r[0], ...m.bodies]);
    }
    const out = ["body:", ...entryLines(2, "type", data.mode)];
    if (TEXT_MODES.includes(data.mode)) out.push(...entryLines(2, "data", data.text));
    else if (data.rows.length) out.push(...writeList(null, "data", { itemCol: 2, items: [] }, data.rows, spec).map((s) => "  " + s));
    return putChild(L, "http", "body", out);
  },
  badge: (L, data) => (data.mode !== "none" ? true : null),
};

// ---- auth -------------------------------------------------------------------------------------

export const AUTH_MODES = ["none", "inherit", "basic", "bearer", "apikey"];
const AUTH_FIELDS = { basic: ["username", "password"], bearer: ["token"], apikey: ["key", "value", "placement"] };
const AUTH_ORDER = ["type", "username", "password", "token", "key", "value", "placement"];

function readAuth(L) {
  const r = childLines(L, "http", "auth");
  if (r === false) fail("the http block cannot be read");
  if (!r) return { data: { mode: "none" } };
  const head = mapEntries(r, 0, 1, 0)?.[0];
  if (head?.inline) {
    const v = sectionValue(r, "auth");
    if ((v === "inherit" || v === "none") && r.length === 1) return { data: { mode: v } };
    fail(`auth ${head.inline}`);
  }
  const { obj, map } = mapSection(r, "auth");
  const fields = AUTH_FIELDS[obj.type] ?? fail(`${obj.type ?? "unknown"} auth`);
  const data = { mode: obj.type };
  for (const f of fields) data[f] = str(obj[f], "auth field");
  if (obj.type === "apikey") {
    data.placement = data.placement || "header";
    if (data.placement !== "header" && data.placement !== "query") fail(`api key placement ${data.placement}`);
  }
  return { r, obj, map, data };
}

export const auth = {
  read: (L) => readAuth(L).data,
  write(L, data) {
    const cur = readAuth(L);
    if (data.mode === "none") return putChild(L, "http", "auth", null);
    if (data.mode === "inherit") return putChild(L, "http", "auth", ["auth: inherit"]);
    const fields = AUTH_FIELDS[data.mode];
    if (cur.map && cur.data.mode === data.mode) {
      let m = cur.map;
      for (const f of fields) {
        const empty = f === "placement" ? data[f] === "header" : data[f] === "";
        if (!(cur.obj[f] === undefined && empty)) m = setValue(m, f, data[f], cur.obj[f], AUTH_ORDER);
      }
      return putChild(L, "http", "auth", [cur.r[0], ...m.bodies]);
    }
    // A new mode is written as Bruno saves it once its fields are typed: basic writes both fields
    // once either has a value; an API key always has its placement.
    const any = fields.some((f) => f !== "placement" && data[f] !== "");
    const keep = (f) => (data.mode === "basic" ? any : f === "placement" || data[f] !== "");
    return putChild(L, "http", "auth", ["auth:", ...entryLines(2, "type", data.mode), ...fields.filter(keep).flatMap((f) => entryLines(2, f, data[f]))]);
  },
  badge: (L, data) => (data.mode !== "none" && data.mode !== "inherit" ? true : null),
};

// ---- docs -------------------------------------------------------------------------------------

export const docs = {
  read(L) {
    const r = topLines(L, "docs");
    if (r === false) fail("the file cannot be read");
    return r ? str(sectionValue(r, "docs"), "docs") : "";
  },
  write: (L, text) => putTop(L, "docs", text.trim() ? entryLines(0, "docs", text) : null),
  badge: (L, text) => (text ? true : null),
};

// ---- settings ---------------------------------------------------------------------------------

export const SETTINGS_FIELDS = [
  { key: "encodeUrl", label: "URL Encoding", kind: "toggle" },
  { key: "timeout", label: "Timeout (ms)", kind: "number", inherit: true },
  { key: "followRedirects", label: "Automatically Follow Redirects", kind: "toggle" },
  { key: "maxRedirects", label: "Max Redirects", kind: "number" },
  { key: "forwardAuthorizationHeader", label: "Forward Authorization on Redirect", kind: "toggle" },
];
const SETTINGS_ORDER = [...SETTINGS_FIELDS.map((f) => f.key), "omitHeaders"];
/** What Bruno's Settings tab shows for a Request with no settings block. */
export const SETTINGS_DEFAULTS = Object.freeze({ encodeUrl: false, timeout: "inherit", followRedirects: true, maxRedirects: 5, forwardAuthorizationHeader: true });

function toBool(v, key) {
  if (v === undefined || v === null) return true;
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return fail(`setting ${key} is not true or false`);
}

/** Bruno's parse of a settings block: missing keys take its defaults; values it would drop fail. */
function readSettings(L) {
  const r = topLines(L, "settings");
  if (r === false) fail("the file cannot be read");
  if (!r) return { data: { ...SETTINGS_DEFAULTS } };
  const head = mapEntries(r, 0, 1, 0)?.[0];
  const inlineEmpty = head?.inline === "{}" && r.length === 1;
  const { obj, map } = inlineEmpty ? { obj: {}, map: null } : mapSection(r, "settings");
  const t = obj.timeout;
  const m = obj.maxRedirects;
  if (t !== undefined && t !== null && t !== "inherit" && !(typeof t === "number" && Number.isFinite(t))) fail("setting timeout is not a number");
  if (m !== undefined && m !== null && !(typeof m === "number" && Number.isFinite(m) && m >= 0)) fail("setting maxRedirects is not a number");
  const data = {
    encodeUrl: toBool(obj.encodeUrl, "encodeUrl"),
    timeout: typeof t === "number" || t === "inherit" ? t : 0,
    followRedirects: toBool(obj.followRedirects, "followRedirects"),
    maxRedirects: typeof m === "number" ? Math.trunc(m) : 5,
    forwardAuthorizationHeader: toBool(obj.forwardAuthorizationHeader, "forwardAuthorizationHeader"),
  };
  return { r, obj, map, data };
}

export const settings = {
  read: (L) => readSettings(L).data,
  /** Every key is written, as Bruno's stringify always writes them; other keys stay. */
  write(L, data) {
    const cur = readSettings(L);
    if (!cur.map) return putTop(L, "settings", ["settings:", ...SETTINGS_FIELDS.flatMap((f) => entryLines(2, f.key, data[f.key]))]);
    let m = cur.map;
    for (const f of SETTINGS_FIELDS) m = setValue(m, f.key, data[f.key], cur.obj[f.key], SETTINGS_ORDER);
    return putTop(L, "settings", [cur.r[0], ...m.bodies]);
  },
  /** Bruno's Settings tab shows a dot when the Request has tags. */
  badge(L) {
    const r = topLines(L, "info");
    const tags = r ? sectionValue(r, "info")?.tags : null;
    return Array.isArray(tags) && tags.length ? true : null;
  },
};
