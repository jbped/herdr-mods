// The Response side of the dialog: the last Run or an opened file.
// A single Request: its Response, Headers, Timeline and Tests views. A folder or Collection
// Run: a summary line, the list of its Requests with filters, and the selected one's views.
// The Run itself is kept in store.js. Only the selected Response's body is in the code view.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState } from "gpui-base";
import { settings } from "herdr";
import { colors, SIZE } from "./kit/theme.js";
import { tabStrip } from "./kit/tabs.js";
import { chip, textInput } from "./kit/controls.js";
import * as store from "./store.js";
import { formatSize, formatTime } from "./report.js";
import { runRows, unfoldFor } from "./runtree.js";
import { activeFilter, filterRun, keepMethod, keepSelection, methodValues, nextValue, LABELS, NO_FILTER, RESULTS, SORTS, STATUSES } from "./runfilter.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("./kit/theme.js").Theme} Theme */

const MOD = "brunr";
const ICON = (/** @type {string} */ name) => `mods/${MOD}/icons/${name}.svg`;
const MAX_TEXT = 400000;
export const PARTS = ["response", "headers", "timeline", "tests"];
const INDENT = 14;
/** The Response side is this wide or wider: a Run's list sits beside the views, else above them. */
const WIDE = 640;
const METHOD_COLOR = { GET: "ansi2", POST: "ansi5", PUT: "ansi3", PATCH: "ansi6", DELETE: "ansi1" };
const METHOD_SHORT = { DELETE: "DEL", OPTIONS: "OPT", GRAPHQL: "GQL", CONNECT: "CONN" };

const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");
const lines = (/** @type {unknown} */ text) => String(text ?? "").replace(/\r\n/g, "\n").split("\n");

/** A method as Bruno's sidebar shows it: short text in the method's colour, in a fixed width. @param {Theme} t @param {unknown} method @param {number} [width] */
export function methodBadge(t, method, width = 36) {
  const m = String(method ?? "").toUpperCase();
  return div().w(width).flex_none().text_size(10.5).font_semibold().text_color(t[/** @type {Record<string, string>} */ (METHOD_COLOR)[m] ?? "muted"]).truncate()
    .child(/** @type {Record<string, string>} */ (METHOD_SHORT)[m] ?? m);
}

/** @param {Theme} t @param {number | null | undefined} status */
export function statusColor(t, status) {
  if (status == null) return t.blocked;
  if (status >= 200 && status < 300) return t.done;
  if (status >= 300 && status < 400) return t.ansi3;
  return t.blocked;
}

/** @param {Theme} t @param {number} size */
const spinner = (t, size) => svg(ICON("spinner")).size(size).flex_none().text_color(t.working).spin(900);

/** @param {Theme} t @param {string} text */
function center(t, text) {
  return v_flex().flex_1().items_center().justify_center().p(20).text_color(t.dim).child(div().child(text));
}

export class Response {
  /** Call it in `init`: it makes a text box, which `render` must not. */
  constructor() {
    /** @type {any} the store's view this one last took */
    this.v = null;
    this.seen = null;
    /** @type {number} the selected Request of a Run */
    this.at = 0;
    this.part = "response";
    /** @type {any} the code view's state */
    this.editor = null;
    this.runId = null;
    /** @type {Set<string>} folded folder paths in the Run list, for this Run only */
    this.folded = new Set();
    /** @type {any} the toolbar's filters and sort, kept across Runs */
    this.filter = { ...NO_FILTER };
    /** @type {boolean} the Search box has the keyboard */
    this.typing = false;
    this.filterInput = InputState.new({ placeholder: "Search" });
    this.filterInput.on("change", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.setFilter({ text: this.filterInput.value() }); cx.notify(); });
    this.filterInput.on("focus", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.typing = true; cx.notify(); });
    this.filterInput.on("blur", (/** @type {unknown} */ _e, /** @type {Context} */ cx) => { this.typing = false; cx.notify(); });
    this.sync();
  }

  release() {
    this.editor?.release();
    this.editor = null;
    this.filterInput?.release();
  }

  /**
   * Takes the latest Run from the store, selecting the first failed Request. Folds reset when
   * a new Run starts, and the folders of the selected and first failed Request open when it ends.
   * Never call it from `render`: it makes the code view's state.
   */
  sync() {
    const v = store.getView();
    if (!v) { this.v = null; this.seen = null; this.setEditor(null); return; }
    if (v.n === this.seen) return;
    this.seen = v.n;
    this.v = v;
    if (v.kind === "file") { this.setEditor({ language: v.file.language, value: v.file.text }); return; }
    if (v.id !== this.runId) { this.runId = v.id; this.folded = new Set(); }
    const list = v.result?.responses ?? [];
    if (v.state === "done") this.filter = { ...this.filter, method: keepMethod(this.filter.method, list) };
    const failed = list.findIndex((/** @type {any} */ r) => !r.ok);
    this.at = keepSelection(failed >= 0 ? failed : 0, this.shown().indexes);
    const show = [list[this.at], list[failed]].filter(Boolean).map((r) => r.path);
    if (show.length) this.folded = unfoldFor({ target: v.info?.target, folded: this.folded, paths: show });
    this.part = "response";
    this.showBody();
  }

  /** True when a finished Run with more than one Request is showing: it has a list and a Search box. */
  get many() {
    return this.v?.kind === "run" && this.v.state === "done" && (this.v.result?.responses?.length ?? 0) > 1;
  }

  /** The finished Run's list after the toolbar's filters and sort (runfilter.js). */
  shown() {
    const list = this.v?.result?.responses ?? [];
    return filterRun({ target: this.v?.info?.target ?? null, entries: list, ...activeFilter(this.filter, list.length) });
  }

  /** Changes the filters or sort. A selected Request the filters hide gives way to the first shown one. @param {Record<string, unknown>} change */
  setFilter(change) {
    this.filter = { ...this.filter, ...change };
    if (this.v?.kind !== "run" || this.v.state !== "done") return;
    const at = keepSelection(this.at, this.shown().indexes);
    if (at === this.at) return;
    this.select(at);
  }

  clearFilters() {
    this.filterInput?.set_value("");
    this.setFilter({ text: "", result: NO_FILTER.result, status: NO_FILTER.status, method: NO_FILTER.method });
  }

  /** Selects a Request of the Run by its place in the Run. @param {number} at */
  select(at) {
    this.at = at;
    const r = this.v?.result?.responses?.[at];
    if (r) this.folded = unfoldFor({ target: this.v.info?.target, folded: this.folded, paths: [r.path] });
    this.showBody();
  }

  /** j and k on the Response side: the Request above or below in the shown list. @param {number} by */
  move(by) {
    if (!this.many) return;
    const order = this.shown().indexes;
    const i = order.indexOf(this.at);
    const next = order[Math.max(0, Math.min(order.length - 1, (i < 0 ? 0 : i) + by))];
    if (next !== undefined && next !== this.at) this.select(next);
  }

  /** Shows one of the four views. @param {number} i */
  setPart(i) {
    if (PARTS[i]) this.part = PARTS[i];
  }

  showBody() {
    const r = this.v?.result?.responses?.[this.at];
    this.setEditor(r ? { language: r.language === "text" ? "text" : r.language, value: r.body } : null);
  }

  /** @param {{ language: string, value: string } | null} spec */
  setEditor(spec) {
    this.editor?.release();
    this.editor = null;
    if (!spec) return;
    const t = colors();
    const value = spec.value.length > MAX_TEXT ? `${spec.value.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters)` : spec.value;
    this.editor = EditorState.new({ language: spec.language, value, readonly: true, font_family: mono(), font_size: 12, soft_wrap: true,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 } });
  }

  /**
   * @param {Theme} t
   * @param {{ width: number, focused: boolean, escBox: (box: any) => any }} o `width`: the room in pixels.
   *   `focused`: j and k act here. `escBox`: wraps a text box so esc leaves it and the dialog stays.
   */
  render(t, o) {
    const root = v_flex().id("brunr-response").flex_1().min_w(0).min_h(0).overflow_hidden().rounded(SIZE.rowRadius).bg(t.background)
      .border_1().border_color(o.focused ? t.input : t.border).text_color(t.foreground).text_size(12.5);
    const v = this.v;
    if (!v) return root.child(center(t, "No Response yet. Select a Request and press enter to run it."));
    if (v.kind === "file") {
      return root.child(h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(SIZE.small).text_color(t.dim).child("Read only"))
        .child(div().flex_1().min_w(0).truncate().text_ellipsis_start().font_family(mono()).text_size(11.5).child(v.file.path)))
        .child(this.editor ? Editor.new(this.editor).flex_1().min_h(0) : center(t, "Empty file"));
    }
    const info = v.info;
    if (v.state === "running") {
      const waiting = v_flex().flex_1().items_center().justify_center().gap(10).text_color(t.muted)
        .child(spinner(t, 22))
        .child(div().child(`Running ${info.label}${info.environment ? ` against ${info.environment}` : ""}…`));
      const p = v.progress;
      if (info.kind === "request" || !p) return root.child(this.topLine(t, info.label, info.method, info.url, null)).child(waiting);
      // Requests are listed as they finish. Their rows do nothing until the Run ends and the report is read.
      const entries = p.running ? [...p.finished, { ...p.running, running: true, method: null }] : p.finished;
      return root.child(this.progressLine(t, p)).when(p.total > 1, (/** @type {any} */ el) => el.child(this.toolbar(t, false, o)))
        .child(this.withList(t, o, this.listRows(t, entries, info.planned ?? null, false), waiting));
    }
    const result = v.result;
    const list = result.responses ?? [];
    if (result.message) {
      return root.child(this.topLine(t, info.label, info.method, info.url, null))
        .when(result.summary?.requests > 0, (/** @type {any} */ el) => el.child(this.summaryLine(t, result.summary)))
        .child(v_flex().id("brunr-message").flex_1().min_h(0).overflow_y_scrollbar().m(12).p(12).rounded(6).bg(t.surface).border_1().border_color(t.border)
          .font_family(mono()).text_size(11.5).text_color(t.foreground).children(lines(result.message).map((l) => div().min_h(16).child(l))));
    }
    const many = info.kind !== "request" || list.length > 1;
    const f = this.shown();
    const none = list.length > 0 && f.visible === 0;
    const detail = list[this.at] ? this.responseView(t, list[this.at]) : center(t, none ? "No Requests match." : "No Request was sent.");
    if (!many) return root.child(detail);
    const rows = none ? [this.noMatch(t)] : this.listRows(t, f.entries, null, true, f);
    return root.child(this.summaryLine(t, result.summary, f)).when(list.length > 1, (/** @type {any} */ el) => el.child(this.toolbar(t, true, o))).child(this.withList(t, o, rows, detail));
  }

  /**
   * The row above the Run list: the text filter, then the result, status, method and sort
   * controls, each cycling on click. While a Run is in progress it is drawn dim and does nothing.
   * @param {Theme} t @param {boolean} on @param {{ escBox: (box: any) => any }} o
   */
  toolbar(t, on, o) {
    /** @param {string} key @param {string} name @param {readonly (string | null)[]} values */
    const control = (key, name, values) => {
      const value = this.filter[key];
      const label = h_flex().gap(4).child(div().text_color(t.dim).child(name)).child(key === "method" ? value ?? LABELS.anyMethod : /** @type {Record<string, string>} */ (LABELS)[value]);
      return chip(t, { id: `brunr-filter-${key}`, label, on: on && value !== values[0], click: (cx) => { if (on) this.setFilter({ [key]: nextValue(values, value) }); cx.notify(); } });
    };
    const methods = methodValues(this.v?.state === "done" ? this.v.result?.responses : []);
    const field = on
      ? o.escBox(textInput(t, this.filterInput, this.typing).h(26).w_full())
      : div().w_full().h(26).px(10).flex().items_center().rounded(8).border_1().border_color(t.border).text_size(11.5).text_color(t.dim).child("Search");
    return h_flex().id("brunr-filters").h(40).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).child(field))
      .child(control("result", "Result", RESULTS)).child(control("status", "Status", STATUSES)).child(control("method", "Method", methods)).child(control("sort", "Sort", SORTS));
  }

  /** The list area when the filters leave no Request. Clear filters keeps the sort. @param {Theme} t */
  noMatch(t) {
    return v_flex().id("brunr-no-match").flex_none().p(8).gap(6).items_start()
      .child(div().text_color(t.dim).child("No Requests match."))
      .child(chip(t, { id: "brunr-clear-filters", label: "Clear filters", on: false, click: (cx) => { this.clearFilters(); cx.notify(); } }));
  }

  /**
   * The list of Requests beside the views. Wide: on the left. Narrow: on top, so the views keep the width.
   * @param {Theme} t @param {{ width: number }} o @param {any[]} rows @param {any} detail
   */
  withList(t, o, rows, detail) {
    const wide = o.width >= WIDE;
    const listBox = v_flex().id("brunr-runlist").flex_none().min_h(0).overflow_y_scrollbar().p(4).border_color(t.border)
      .when(wide, (/** @type {any} */ el) => el.w(240).border_r(1)).when(!wide, (/** @type {any} */ el) => el.w_full().max_h(Math.min(180, 12 + rows.length * 28)).border_b(1));
    return (wide ? h_flex() : v_flex()).flex_1().min_h(0).items_stretch()
      .child(listBox.children(rows))
      .child(v_flex().flex_1().min_w(0).min_h(0).child(detail));
  }

  /**
   * The Run list's rows: folder rows and Request rows. Request rows select only once the Run ended.
   * `f`: filterRun's result for a finished Run, which maps each row to its Request in the Run.
   * @param {Theme} t @param {any[]} entries @param {any[] | null} planned @param {boolean} done @param {any} [f]
   */
  listRows(t, entries, planned, done, f = null) {
    const info = this.v.info;
    return runRows({ collection: info.tree ?? null, target: info.target ?? null, entries, planned, folded: this.folded, counts: f?.counts ?? null }).map((/** @type {any} */ row) => {
      if (row.kind === "folder") return this.folderRow(t, row, (cx) => {
        const next = new Set(this.folded);
        if (next.has(row.path)) next.delete(row.path); else next.add(row.path);
        this.folded = next;
        cx.notify();
      });
      const i = f ? f.indexes[row.index] : row.index;
      return this.requestRow(t, row.key, row.depth, row.entry, done && i === this.at, done ? (cx) => { this.select(i); cx.notify(); } : null);
    });
  }

  /** A folder in the Run list: chevron, name, a spinner while a Request in it runs, and passed/total. @param {Theme} t @param {any} f @param {(cx: Context) => void} click */
  folderRow(t, f, click) {
    return h_flex().id(`resp-${f.key}`).h(28).flex_none().pl(4 + f.depth * INDENT).pr(8).gap(6).items_center().rounded(6).cursor_pointer()
      .hover((/** @type {any} */ s) => s.bg(t.hover)).on_click((/** @type {unknown} */ _e, /** @type {Context} */ cx) => click(cx))
      .child(div().w(12).flex_none().flex().items_center().text_color(t.dim).child(svg(ICON(f.folded ? "chevron-right" : "chevron-down")).size(12)))
      .child(svg(ICON("folder")).size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(f.name))
      .when(f.running, (/** @type {any} */ el) => el.child(spinner(t, 11)))
      .child(div().flex_none().text_size(10.5).text_color(f.failed ? t.blocked : t.done).child(`${f.passed}/${f.total}`));
  }

  /**
   * One Request in the list: its mark (a spinner while it runs), method, name and status.
   * @param {Theme} t @param {string} key @param {number} depth @param {any} r @param {boolean} selected @param {((cx: Context) => void) | null} click
   */
  requestRow(t, key, depth, r, selected, click) {
    return h_flex().id(`resp-${key}`).h(28).flex_none().pl(8 + depth * INDENT).pr(8).gap(6).items_center().rounded(6)
      .when(Boolean(click), (/** @type {any} */ el) => el.cursor_pointer().hover((/** @type {any} */ s) => s.bg(selected ? t.selected : t.hover)).on_click((/** @type {unknown} */ _e, /** @type {Context} */ cx) => click?.(cx)))
      .when(selected, (/** @type {any} */ el) => el.bg(t.selected))
      .child(r.running ? div().w(12).flex_none().flex().items_center().child(spinner(t, 11))
        : div().w(12).flex_none().text_color(r.ok ? t.done : t.blocked).child(r.ok ? "✓" : "✗"))
      .child(methodBadge(t, r.method))
      .child(div().flex_1().min_w(0).truncate().text_color(r.running ? t.muted : t.foreground).child(r.name))
      .when(r.status !== undefined, (/** @type {any} */ el) => el.child(div().flex_none().text_size(10.5).text_color(statusColor(t, r.status)).child(r.status == null ? "ERR" : String(r.status))));
  }

  /** The summary line while a folder or Collection Run is in progress: a spinner and the count. @param {Theme} t @param {any} p */
  progressLine(t, p) {
    return h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
      .child(spinner(t, 12))
      .child(div().text_color(t.muted).child(`${p.done} of ${p.total}`))
      .child(div().flex_1());
  }

  /** @param {Theme} t @param {any} s @param {any} [f] */
  summaryLine(t, s, f = null) {
    /** @param {number} n @param {string} label @param {any} color */
    const part = (n, label, color) => div().text_color(n ? color : t.dim).child(`${n} ${label}`);
    return h_flex().h(34).flex_none().px(12).gap(12).items_center().border_b(1).border_color(t.border).text_size(11.5)
      .child(div().text_color(t.muted).child(`${s.requests} ${s.requests === 1 ? "Request" : "Requests"}`))
      .child(part(s.passed, "passed", t.done)).child(part(s.failed, "failed", t.blocked)).child(part(s.skipped, "skipped", t.ansi3))
      .when(Boolean(f?.filtering), (/** @type {any} */ el) => el.child(div().text_color(t.accent).child(`showing ${f.visible} of ${f.total}`)))
      .child(div().flex_1()).child(div().text_color(t.dim).child(formatTime(s.duration)));
  }

  /** A Request's name, method and URL, then its status, time and size once it has a Response. @param {Theme} t @param {string} name @param {unknown} method @param {string} url @param {any} r */
  topLine(t, name, method, url, r) {
    const line = h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().min_w(0).max_w(220).truncate().font_semibold().child(name ?? ""))
      .when(Boolean(method), (/** @type {any} */ el) => el.child(methodBadge(t, method, 44)))
      .child(div().flex_1().min_w(0).truncate().font_family(mono()).text_size(11.5).text_color(t.muted).child(url ?? ""));
    if (!r) return line;
    // The status, time and size never give way: the name and URL shorten instead.
    return line.child(h_flex().flex_none().gap(8).items_center()
      .child(div().px(6).h(20).flex().items_center().rounded(5).bg(t.raised).font_semibold().text_size(11.5).text_color(statusColor(t, r.status))
        .child(r.status == null ? "Error" : `${r.status} ${r.statusText ?? ""}`.trim()))
      .when(r.time != null, (/** @type {any} */ el) => el.child(div().text_size(11.5).text_color(t.muted).child(formatTime(r.time))))
      .when(r.size != null, (/** @type {any} */ el) => el.child(div().text_size(11.5).text_color(t.muted).child(formatSize(r.size)))));
  }

  /** One Response: its top line, the four tabs and the chosen view. @param {Theme} t @param {any} r */
  responseView(t, r) {
    const passed = r.tests.filter((/** @type {any} */ x) => x.ok).length;
    /** @type {Record<string, string>} */
    const label = { response: "Response", headers: `Headers ${r.headers.length}`, timeline: "Timeline", tests: `Tests ${passed}/${r.tests.length}` };
    const tabs = h_flex().flex_none().px(8).py(6).border_b(1).border_color(t.border)
      .child(tabStrip(t, PARTS.map((p) => ({ id: `brunr-part-${p}`, label: label[p], on: p === this.part, click: (cx) => { this.part = p; cx.notify(); } }))));
    const body = this.part === "headers" ? this.headersView(t, r.headers)
      : this.part === "timeline" ? this.timelineView(t, r)
      : this.part === "tests" ? this.testsView(t, r)
      : this.editor && r.body ? Editor.new(this.editor).flex_1().min_h(0)
      : center(t, r.error ?? "No body");
    return v_flex().flex_1().min_h(0).child(this.topLine(t, r.name, r.method, r.url, r)).child(tabs).child(body);
  }

  /** @param {Theme} t @param {[string, unknown][]} headers */
  headersView(t, headers) {
    if (!headers.length) return center(t, "No headers");
    return v_flex().id("brunr-headers").flex_1().min_h(0).overflow_y_scrollbar().p(8).font_family(mono()).text_size(11.5)
      .children(headers.map(([k, v], i) => h_flex().id(`h-${i}`).flex_none().px(6).py(4).gap(12).items_start().border_b(1).border_color(t.border)
        .child(div().w(200).flex_none().text_color(t.muted).child(k)).child(div().flex_1().min_w(0).child(String(v)))));
  }

  /** @param {Theme} t @param {any} r */
  timelineView(t, r) {
    const box = v_flex().id("brunr-timeline").flex_1().min_h(0).overflow_y_scrollbar().p(12).gap(4).font_family(mono()).text_size(11.5);
    box.child(h_flex().gap(8).child(methodBadge(t, r.method, 44)).child(div().flex_1().min_w(0).child(r.url)));
    for (const [k, v] of r.requestHeaders) box.child(div().pl(12).text_color(t.muted).child(`${k}: ${v}`));
    if (r.requestBody) {
      box.child(div().pt(6).text_color(t.dim).child("Body"));
      for (const l of lines(r.requestBody)) box.child(div().pl(12).min_h(16).child(l));
    }
    box.child(div().h(10));
    if (r.status == null) box.child(div().text_color(t.blocked).child(r.error ?? "No response"));
    else box.child(h_flex().gap(10).child(div().text_color(statusColor(t, r.status)).child(`${r.status} ${r.statusText ?? ""}`.trim())).when(r.time != null, (/** @type {any} */ el) => el.child(div().text_color(t.muted).child(formatTime(r.time)))));
    return box;
  }

  /** @param {Theme} t @param {any} r */
  testsView(t, r) {
    const box = v_flex().id("brunr-tests").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(2);
    if (r.error) box.child(div().px(8).py(6).text_color(t.blocked).child(r.error));
    if (!r.tests.length) return box.child(div().px(8).py(6).text_color(t.dim).child("No assertions or tests."));
    return box.children(r.tests.map((/** @type {any} */ x, /** @type {number} */ i) => v_flex().id(`test-${i}`).flex_none().px(8).py(6).gap(3).rounded(5).border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center()
        .child(div().w(12).flex_none().text_color(x.ok ? t.done : t.blocked).child(x.ok ? "✓" : "✗"))
        .child(div().flex_1().min_w(0).font_family(mono()).text_size(11.5).child(x.name || "(unnamed)"))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(x.kind === "assert" ? "assertion" : "test")))
      .when(Boolean(x.error), (/** @type {any} */ el) => el.child(div().pl(20).text_size(11.5).text_color(t.blocked).child(String(x.error))))));
  }
}
