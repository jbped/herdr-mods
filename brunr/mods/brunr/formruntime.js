// The form tabs over the `runtime` block: Vars (`runtime.variables`, and the `set-variable`
// actions Bruno writes for post-response variables), Script and Tests (`runtime.scripts`) and
// Assert (`runtime.assertions`). Each changes only its own sub-block. Shapes are from
// @usebruno/filestore formats/yml common/variables, actions, scripts and assertions. Pure.
import { childLines, putChild, layout, writeList, matchRows } from "./formsec.js";
import { entryLines, setValue, setDisabled, nestedMap, putNested, itemLines, freshItem } from "./yamlblock.js";
import { list, str, fail } from "./formtabs.js";

const on = (obj) => obj.disabled !== true;

// ---- vars -------------------------------------------------------------------------------------

const VAR_ORDER = ["name", "value", "description", "disabled"];
const ACTION_ORDER = ["type", "phase", "selector", "variable", "description", "disabled"];
const isVarAction = (obj) => obj.type === "set-variable" && obj.phase === "after-response";

function readVars(L) {
  const pre = list(childLines(L, "runtime", "variables"), "variables");
  for (const { obj } of pre.items) if (obj.value && typeof obj.value === "object") fail("a variable with a typed value");
  const actions = list(childLines(L, "runtime", "actions"), "actions");
  for (const { obj, map } of actions.items) {
    if (!isVarAction(obj)) continue;
    const ok = (k) => obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k]) && nestedMap(map, k);
    if (!ok("selector") || !ok("variable")) fail("a post-response variable not in block form");
  }
  return { pre, actions };
}

const PRE_SPEC = {
  name: (row) => row.name,
  oldName: (obj) => str(obj.name),
  same: (obj, row) => str(obj.name) === row.name && str(obj.value) === row.value && on(obj) === row.enabled,
  edit: (map, obj, row) => setDisabled(setValue(setValue(map, "name", row.name, obj.name, VAR_ORDER), "value", row.value, obj.value, VAR_ORDER), row.enabled, obj.disabled, VAR_ORDER),
  fresh: (row, col) => [...entryLines(col, "name", row.name), ...entryLines(col, "value", row.value), ...(row.enabled ? [] : entryLines(col, "disabled", true))],
};

const postRow = (obj) => ({ name: str(obj.variable.name), expression: str(obj.selector.expression), enabled: on(obj) });

function editAction(map, obj, row) {
  let m = map;
  const sel = nestedMap(m, "selector");
  m = putNested(m, "selector", setValue(sel, "expression", row.expression, obj.selector.expression, ["expression", "method"]));
  const v = nestedMap(m, "variable");
  m = putNested(m, "variable", setValue(v, "name", row.name, obj.variable.name, ["name", "scope"]));
  return setDisabled(m, row.enabled, obj.disabled, ACTION_ORDER);
}

/** The lines Bruno writes for a post-response variable, keys at `col`. */
function freshAction(row, col) {
  const pad = " ".repeat(col);
  return [
    `${pad}type: set-variable`, `${pad}phase: after-response`, `${pad}selector:`, ...entryLines(col + 2, "expression", row.expression),
    `${pad}  method: jsonq`, `${pad}variable:`, ...entryLines(col + 2, "name", row.name), `${pad}  scope: runtime`,
    ...(row.enabled ? [] : entryLines(col, "disabled", true)),
  ];
}

/**
 * The actions list with the post-response variables replaced by `rows`. The variable actions are
 * slots: rows fill them in order, extra rows follow the last one (or end the list), and slots left
 * over go. Every other action keeps its lines and its place.
 */
function writeActions(r, actions, rows) {
  const vars = actions.items.filter((it) => isVarAction(it.obj));
  const match = matchRows(vars.map((it) => postRow(it.obj).name), rows.map((x) => x.name));
  const col = actions.itemCol + 2;
  const line = (j) => {
    const old = match[j] >= 0 ? vars[match[j]] : null;
    if (!old) return freshItem(freshAction(rows[j], col), col);
    const same = JSON.stringify(postRow(old.obj)) === JSON.stringify(rows[j]);
    return itemLines(same ? old.map : editAction(old.map, old.obj, rows[j]));
  };
  const out = [];
  let j = 0, seen = 0;
  for (const it of actions.items) {
    if (!isVarAction(it.obj)) { out.push(...itemLines(it.map)); continue; }
    seen++;
    if (j < rows.length) out.push(...line(j++));
    if (seen === vars.length) while (j < rows.length) out.push(...line(j++));
  }
  while (j < rows.length) out.push(...line(j++));
  if (!out.length) return null;
  return [...(r && !actions.inline ? [r[0], ...(actions.lead ?? [])] : ["actions:"]), ...out];
}

export const vars = {
  read(L) {
    const { pre, actions } = readVars(L);
    return {
      pre: pre.items.map(({ obj }) => ({ name: str(obj.name), value: str(obj.value), enabled: on(obj) })),
      post: actions.items.filter((it) => isVarAction(it.obj)).map((it) => postRow(it.obj)),
    };
  },
  write(L, data) {
    const r = childLines(L, "runtime", "variables");
    const text = putChild(L, "runtime", "variables", writeList(r, "variables", readVars(L).pre, data.pre, PRE_SPEC));
    const L2 = layout(text);
    const ra = childLines(L2, "runtime", "actions");
    return putChild(L2, "runtime", "actions", writeActions(ra, readVars(L2).actions, data.post));
  },
  badge: (L, data) => data.pre.filter((x) => x.enabled).length + data.post.filter((x) => x.enabled).length || null,
};

// ---- script, tests ----------------------------------------------------------------------------

const SCRIPT_ORDER = ["before-request", "after-response", "grpc:before-call-start", "grpc:before-message-send", "grpc:after-message-receive", "grpc:after-call-end", "tests"];
const OWNED = ["before-request", "after-response", "tests"];

function readScripts(L) {
  const r = childLines(L, "runtime", "scripts");
  const scripts = list(r, "scripts");
  const code = {};
  for (const { obj } of scripts.items) {
    if (typeof obj.type !== "string") fail("a script with no type");
    if (OWNED.includes(obj.type) && obj.type in code) fail(`two ${obj.type} scripts`);
    code[obj.type] = str(obj.code, "script");
  }
  return { r, scripts, code };
}

/**
 * The text with the scripts of the given types set. Bruno saves a script trimmed and leaves out
 * one that is empty, so a script that only differs by surrounding whitespace is left as it is.
 */
function writeScripts(L, changes) {
  const { r, scripts } = readScripts(L);
  let items = scripts.items.map((it) => ({ type: it.obj.type, lines: itemLines(it.map), it }));
  const col = scripts.itemCol + 2;
  for (const [type, value] of Object.entries(changes)) {
    const code = String(value ?? "").trim();
    const at = items.findIndex((x) => x.type === type);
    if (!code) { if (at >= 0) items = items.filter((_, k) => k !== at); continue; }
    if (at >= 0) {
      const { it } = items[at];
      const m = setValue(it.map, "code", code, it.obj.code, ["type", "code"]);
      items = items.map((x, k) => (k === at ? { ...x, lines: itemLines(m) } : x));
      continue;
    }
    const rank = SCRIPT_ORDER.indexOf(type);
    const later = items.findIndex((x) => SCRIPT_ORDER.indexOf(x.type) > rank);
    const fresh = { type, lines: freshItem([...entryLines(col, "type", type), ...entryLines(col, "code", code)], col) };
    items = later < 0 ? [...items, fresh] : [...items.slice(0, later), fresh, ...items.slice(later)];
  }
  const out = items.flatMap((x) => x.lines);
  return putChild(L, "runtime", "scripts", out.length ? [...(r && !scripts.inline ? [r[0], ...(scripts.lead ?? [])] : ["scripts:"]), ...out] : null);
}

export const script = {
  read(L) {
    const { code } = readScripts(L);
    return { pre: code["before-request"] ?? "", post: code["after-response"] ?? "" };
  },
  write: (L, data) => writeScripts(L, { "before-request": data.pre, "after-response": data.post }),
  badge: (L, data) => (data.pre || data.post ? true : null),
};

export const tests = {
  read: (L) => readScripts(L).code.tests ?? "",
  write: (L, text) => writeScripts(L, { tests: text }),
  badge: (L, text) => (text ? true : null),
};

// ---- assert -----------------------------------------------------------------------------------

/** Bruno's assertion operators, in the order of its operator menu. */
export const ASSERT_OPERATORS = Object.freeze([
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains", "notContains", "length", "matches", "notMatches",
  "startsWith", "endsWith", "between", "isEmpty", "isNotEmpty", "isNull", "isUndefined", "isDefined", "isTruthy",
  "isFalsy", "isJson", "isNumber", "isString", "isBoolean", "isArray",
]);
/** The operators that take no value: Bruno writes no `value` key for them. */
export const UNARY_OPERATORS = Object.freeze(ASSERT_OPERATORS.slice(ASSERT_OPERATORS.indexOf("isEmpty")));
const ASSERT_ORDER = ["expression", "operator", "value", "description", "disabled"];
const unary = (op) => UNARY_OPERATORS.includes(op);

function assertRow(obj) {
  if (!ASSERT_OPERATORS.includes(obj.operator)) fail(`assertion operator ${obj.operator}`);
  return { expression: str(obj.expression), operator: obj.operator, value: unary(obj.operator) ? "" : str(obj.value), enabled: on(obj) };
}

const ASSERT_SPEC = {
  name: (row) => row.expression,
  oldName: (obj) => str(obj.expression),
  same: (obj, row) => JSON.stringify(assertRow(obj)) === JSON.stringify(row),
  edit(map, obj, row) {
    let m = setValue(map, "expression", row.expression, obj.expression, ASSERT_ORDER);
    m = setValue(m, "operator", row.operator, obj.operator, ASSERT_ORDER);
    m = setValue(m, "value", unary(row.operator) ? undefined : row.value, obj.value, ASSERT_ORDER);
    return setDisabled(m, row.enabled, obj.disabled, ASSERT_ORDER);
  },
  fresh: (row, col) => [
    ...entryLines(col, "expression", row.expression), ...entryLines(col, "operator", row.operator),
    ...(unary(row.operator) ? [] : entryLines(col, "value", row.value)), ...(row.enabled ? [] : entryLines(col, "disabled", true)),
  ],
};

export const assert = {
  read: (L) => list(childLines(L, "runtime", "assertions"), "assertions").items.map(({ obj }) => assertRow(obj)),
  write(L, rows) {
    const r = childLines(L, "runtime", "assertions");
    return putChild(L, "runtime", "assertions", writeList(r, "assertions", list(r, "assertions"), rows, ASSERT_SPEC));
  },
  badge: (L, rows) => rows.filter((x) => x.enabled).length || null,
};

