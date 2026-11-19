// Stands in for "gpui-kit" and "gpui-base" under Node, so a view's init, render and handlers run in
// a test. Elements are chains that record their id, their click and key handlers and their text.
// Input and editor states hold their value and record set_masked, like the real ones.
export const elements = new Map();   // id -> { id, handlers, text }

function element() {
  const rec = { id: null, handlers: {}, text: [] };
  const el = new Proxy(rec, {
    get(_t, key) {
      if (key === "then") return undefined;
      if (key === "__rec") return rec;
      if (key === "id") return (v) => { rec.id = v; elements.set(v, rec); return el; };
      if (key === "when") return (c, f) => (c ? f(el) ?? el : el);
      if (key === "child") return (c) => { if (typeof c === "string") rec.text.push(c); return el; };
      if (key === "children") return () => el;
      if (typeof key === "string" && key.startsWith("on_")) return (...a) => { rec.handlers[key] = a[a.length - 1]; return el; };
      return () => el;
    },
  });
  return el;
}

export class View {}
export const div = () => element();
export const svg = () => element();
export const img = () => element();
export const v_flex = () => element();
export const h_flex = () => element();

function textState(options = {}) {
  const handlers = {};
  const s = {
    _value: String(options.value ?? ""), masked: false, released: false, handlers,
    value: () => s._value,
    set_value: (v) => { s._value = String(v); },
    on: (event, fn) => { (handlers[event] ??= []).push(fn); return true; },
    set_masked: (m) => { s.masked = Boolean(m); },
    is_masked: () => s.masked,
    focus: () => {}, release: () => { s.released = true; return true; },
    set_selected_range: () => {}, selected_range: () => ({ start: 0, end: 0 }),
  };
  return s;
}

export const InputState = { new: (o) => textState(o) };
export const EditorState = { new: (o) => textState(o) };
export const Input = { new: () => element() };
export const Editor = { new: () => element() };
export const ScrollHandle = { new: () => ({ scroll_to_item() {}, release() { return true; } }) };

/** Types `text` into a state as a person would: the value changes, then its change handlers run. */
export function type(state, text, cx) {
  state._value = String(text);
  for (const fn of state.handlers.change ?? []) fn({}, cx);
}

/** Clicks the element drawn with this id in the last render. */
export function click(id, cx) {
  const rec = elements.get(id);
  if (!rec?.handlers.on_click) throw new Error(`no clickable element ${id}`);
  rec.handlers.on_click({}, cx);
}
