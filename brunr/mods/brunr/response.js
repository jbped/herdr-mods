// The Request and Response pane. The Request side (request.js) is beside the Response side when the
// pane is at least 900px wide, above it when narrower. The Response side is laid out like Bruno's
// response area: a top line with the Request, status, time and size, then Response, Headers,
// Timeline and Tests. A folder or Collection Run lists its
// Requests on the left, under the folders they belong to (runtree.js), with a toolbar that filters
// and sorts them (runfilter.js). Its data lives only in memory (store.js) and goes when the pane
// closes. The filters and sort stay in this pane copy across Runs.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState } from "gpui-base";
import { focused, nextCommand, panes, props, settings, theme } from "herdr";
import * as store from "./store.js";
import * as request from "./request.js";
import * as saveflow from "./saveflow.js";
import { formatSize, formatTime } from "./report.js";
import { methodBadge } from "./panel.js";
import { runRows, unfoldFor } from "./runtree.js";
import { ownTab } from "./panetab.js";
import { activeFilter, filterRun, keepMethod, keepSelection, methodValues, nextValue, LABELS, NO_FILTER, RESULTS, SORTS, STATUSES } from "./runfilter.js";

const MAX_TEXT = 400000;
const PANE_TAB = "paneTab";
const WIDE = 900;
const PARTS = ["response", "headers", "timeline", "tests"];
const INDENT = 14;
const mono = () => String(settings()?.font_family ?? settings()?.font ?? "JetBrains Mono");

export function init(self, cx) {
  const p = props() ?? {};
  self.claim = p.claim ?? null;
  self.tab = ownTab({
    props: p, claimed: p.claim ? store.claimedTab(p.claim) : null, stored: p.claim ? storedTab() : null,
    paneTab: (p.pane && panes().find((x) => x.pane === p.pane)?.tab) || null, focusedTab: focused()?.tab ?? null,
  });
  self.v = null;
  self.seen = null;
  self.sel = 0;
  self.part = "response";
  self.editor = null;
  self.runId = null;
  self.folded = new Set();      // folded folder paths in the Run list, for this Run only
  self.filter = { ...NO_FILTER };  // the toolbar's filters and sort, kept across Runs
  self.filterInput = InputState.new({ placeholder: "Search" });
  self.filterInput.on("change", (_e, cx) => { setFilter(self, { text: self.filterInput.value() }); cx.notify(); });
  self.askSeq = store.askSeq();
  request.init(self, cx);
  sync(self);
  cx.spawn(async (cx) => { for (;;) { await store.nextChange(); learnTab(self); sync(self); request.syncRequest(self, cx); cx.notify(); } });
  cx.spawn(async (cx) => {
    for (;;) {
      const c = await nextCommand();
      // ctrl-s reaches every shown brunr copy as "save": only the pane holding the keyboard saves, and
      // not while an Environment or .env editor window is open, which saves itself.
      // A failing command must not end the loop, or the pane would hear no more keys.
      try {
        if (request.paneSaves(c, store.editorOpen(), request.hasKeyboard(self))) request.save(self, cx);
        else if (c === "focus") self.reqEditor?.focus();
      } catch (e) { console.log(`brunr: ${c}: ${e?.message ?? e}`); }
      cx.notify();
    }
  });
}

/** The tab kept by a pane opened in a new tab, from an earlier start. Its storage is its own: its props hold its claim. */
function storedTab() {
  try { return globalThis.localStorage?.getItem(PANE_TAB) || null; } catch { return null; }
}

/** A pane opened in a new tab takes its tab once the panel has claimed it, and keeps it for the next start. */
function learnTab(self) {
  if (self.tab || !self.claim) return;
  const tab = store.claimedTab(self.claim);
  if (!tab) return;
  self.tab = tab;
  self.addr = `pane:${tab}`;
  try { globalThis.localStorage?.setItem(PANE_TAB, tab); } catch {}
}

/**
 * The asks for this pane copy, taken when it draws: a dialog's answer, the method menu's choice, a
 * form menu's choice. Each is taken once, in order, from store's in-memory log, so two asks made
 * before a draw are both taken and an ask to another pane copy is left alone.
 * They are taken while this copy draws, never in the asking popup's turn: the popup closes at once,
 * and host calls started in its turn are cancelled with it (a save's write would never answer).
 * A choice that changes the text waits for cx.sleep(0), because it can make new fields, which
 * cannot be made while drawing.
 */
function takeAsks(self, cx) {
  for (const e of store.asksSince(self.askSeq)) {
    self.askSeq = e.seq;
    const a = e.ask;
    if ((a.to ?? "panel") !== self.addr) continue;
    if (a.kind === "dialog") saveflow.answer(self, cx, a);
    else if (a.kind === "method" || a.kind === "formMenu") {
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        if (a.kind === "method" && a.key === self.req?.key) request.methodChosen(self, a.value);
        if (a.kind === "formMenu") request.formMenuChosen(self, a);
        cx.notify();
      });
    }
  }
}

export function close(self) {
  request.close(self);
  self.editor?.release();
  self.editor = null;
  self.filterInput?.release();
  self.filterInput = null;
  store.clearView(self.tab);
}

/**
 * Takes the tab's latest Run from the store, selecting the first failed Request. Folds reset when
 * a new Run starts, and the folders of the selected and first failed Request open when it ends.
 */
function sync(self) {
  const v = store.getView(self.tab);
  if (!v) { self.v = null; self.seen = null; setEditor(self, null); return; }
  if (v.n === self.seen) return;
  self.seen = v.n;
  self.v = v;
  if (v.id !== self.runId) { self.runId = v.id; self.folded = new Set(); }
  const list = v.result?.responses ?? [];
  if (v.state === "done") self.filter = { ...self.filter, method: keepMethod(self.filter.method, list) };
  const failed = list.findIndex((r) => !r.ok);
  self.sel = keepSelection(failed >= 0 ? failed : 0, shown(self).indexes);
  const show = [list[self.sel], list[failed]].filter(Boolean).map((r) => r.path);
  if (show.length) self.folded = unfoldFor({ target: v.info?.target, folded: self.folded, paths: show });
  self.part = "response";
  showBody(self);
}

/** The finished Run's list after the toolbar's filters and sort (runfilter.js). */
function shown(self) {
  const list = self.v?.result?.responses ?? [];
  return filterRun({ target: self.v?.info?.target ?? null, entries: list, ...activeFilter(self.filter, list.length) });
}

/** Changes the filters or sort. A selected Request the filters hide gives way to the first shown one. */
function setFilter(self, change) {
  self.filter = { ...self.filter, ...change };
  if (self.v?.kind !== "run" || self.v.state !== "done") return;
  const sel = keepSelection(self.sel, shown(self).indexes);
  if (sel === self.sel) return;
  self.sel = sel;
  const r = self.v.result?.responses?.[sel];
  if (r) self.folded = unfoldFor({ target: self.v.info?.target, folded: self.folded, paths: [r.path] });
  showBody(self);
}

function clearFilters(self) {
  self.filterInput?.set_value("");
  setFilter(self, { text: "", result: NO_FILTER.result, status: NO_FILTER.status, method: NO_FILTER.method });
}

function showBody(self) {
  const r = self.v?.result?.responses?.[self.sel];
  setEditor(self, r ? { language: r.language === "text" ? "text" : r.language, value: r.body } : null);
}

function setEditor(self, spec) {
  self.editor?.release();
  self.editor = null;
  if (!spec) return;
  const t = theme();
  const value = spec.value.length > MAX_TEXT ? `${spec.value.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters)` : spec.value;
  self.editor = EditorState.new({ language: spec.language, value, readonly: true, font_family: mono(), font_size: 12, soft_wrap: true,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 } });
}

export function statusColor(t, status) {
  if (status == null) return t.blocked;
  if (status >= 200 && status < 300) return t.done;
  if (status >= 300 && status < 400) return t.ansi3;
  return t.blocked;
}

const lines = (text) => String(text ?? "").replace(/\r\n/g, "\n").split("\n");

export function render(self, cx) {
  const t = theme();
  takeAsks(self, cx);
  const width = self.size?.width ?? 0;
  const wide = width >= WIDE;
  self.respWidth = wide ? width / 2 : width;
  const root = (wide ? h_flex().items_stretch() : v_flex()).id("brunr-response").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(12.5)
    .on_size_change((size, cx) => { self.size = size; cx.notify(); });
  const side = v_flex().id("brunr-response-side").flex_1().min_w(0).min_h(0).overflow_hidden()
    .when(wide, (el) => el.border_l(1).border_color(t.border)).when(!wide, (el) => el.border_t(1).border_color(t.border));
  return root.child(request.render(self, t, !store.running())).child(responseSide(self, t, side));
}

function responseSide(self, t, root) {
  const v = self.v;
  if (!v) return root.child(center(t, "No Response here yet. Run a Request from the Brunr panel or with Run."));
  const info = v.info;
  if (v.state === "running") {
    const waiting = v_flex().flex_1().items_center().justify_center().gap(10).text_color(t.muted)
      .child(spinner(t, 22))
      .child(div().child(`Running ${info.label}${info.environment ? ` against ${info.environment}` : ""}…`));
    const p = v.progress;
    if (info.kind === "request" || !p) return root.child(topLine(t, info.label, info.method, info.url, null)).child(waiting);
    // Requests are listed as they finish. Request rows do nothing until the Run ends and the report is read.
    const entries = p.running ? [...p.finished, { ...p.running, running: true, method: null }] : p.finished;
    // The live list is unfiltered in Run order: pass and fail are not known until the Run ends.
    return root.child(progressLine(t, p)).when(p.total > 1, (el) => el.child(toolbar(self, t, false)))
      .child(withList(self, t, listRows(self, t, entries, info.planned ?? null, false), waiting));
  }
  const result = v.result;
  const list = result.responses ?? [];
  if (result.message) {
    return root.child(topLine(t, info.label, info.method, info.url, null))
      .when(result.summary?.requests > 0, (el) => el.child(summaryLine(t, result.summary)))
      .child(v_flex().id("brunr-message").flex_1().min_h(0).overflow_y_scrollbar().m(12).p(12).rounded(6).bg(t.surface).border_1().border_color(t.border)
        .font_family(mono()).text_size(11.5).text_color(t.foreground).children(lines(result.message).map((l) => div().min_h(16).child(l))));
  }
  const many = info.kind !== "request" || list.length > 1;
  const f = shown(self);
  const none = list.length > 0 && f.visible === 0;
  const detail = list[self.sel] ? responseView(self, t, list[self.sel]) : center(t, none ? "No Requests match." : "No Request was sent.");
  if (!many) return root.child(detail);
  const rows = none ? [noMatch(self, t)] : listRows(self, t, f.entries, null, true, f);
  return root.child(summaryLine(t, result.summary, f)).when(list.length > 1, (el) => el.child(toolbar(self, t, true))).child(withList(self, t, rows, detail));
}

/**
 * The row above the Run list: the text filter, then the result, status, method and sort controls, each
 * cycling on click. A control off its first value is drawn in `accent`. The text field gives way
 * first when the pane is narrow. While a Run is in progress it is drawn disabled.
 */
function toolbar(self, t, on) {
  const control = (key, name, values) => {
    const value = self.filter[key];
    const active = on && value !== values[0];
    return div().id(`brunr-filter-${key}`).h(24).flex_none().px(8).flex().items_center().rounded(5).border_1().whitespace_nowrap().text_size(11.5)
      .border_color(active ? t.accent : t.border).text_color(!on ? t.dim : active ? t.accent : t.muted).gap(4)
      .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { setFilter(self, { [key]: nextValue(values, value) }); cx.notify(); }))
      .child(div().text_color(on ? t.muted : t.dim).child(name))
      .child(key === "method" ? value ?? LABELS.anyMethod : LABELS[value]);
  };
  const methods = methodValues(self.v?.state === "done" ? self.v.result?.responses : []);
  const text = self.filter.text;
  const field = on && self.filterInput
    ? Input.new(self.filterInput).w_full().h(24).px(8).items_center().rounded(5).border(1).border_color(text.trim() ? t.accent : t.border).bg(t.background).text_color(t.foreground).text_size(11.5)
    : div().w_full().h(24).px(8).flex().items_center().rounded(5).border_1().border_color(t.border).text_size(11.5).text_color(t.dim).truncate().child(text || "Search");
  return h_flex().id("brunr-filters").h(36).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
    .child(div().flex_1().min_w(0).child(field))
    .child(control("result", "Result", RESULTS)).child(control("status", "Status", STATUSES)).child(control("method", "Method", methods)).child(control("sort", "Sort", SORTS));
}

/** The list area when the filters leave no Request. Clear filters keeps the sort. */
function noMatch(self, t) {
  return v_flex().id("brunr-no-match").flex_none().p(8).gap(6).items_start()
    .child(div().text_color(t.dim).child("No Requests match."))
    .child(div().id("brunr-clear-filters").px(8).h(24).flex().items_center().rounded(5).border_1().border_color(t.border).text_size(11.5).text_color(t.accent)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { clearFilters(self); cx.notify(); })
      .child("Clear filters"));
}

const spinner = (t, size) => svg("mods/brunr/icons/spinner.svg").size(size).flex_none().text_color(t.working).spin(900);

/** The list of Requests beside the views. Wide: on the left. Narrow: on top, so the views keep the pane's width. */
function withList(self, t, rows, detail) {
  const wide = (self.respWidth ?? 0) >= 720;
  const listBox = v_flex().id("brunr-runlist").flex_none().min_h(0).overflow_y_scrollbar().p(4).border_color(t.border)
    .when(wide, (el) => el.w(240).border_r(1)).when(!wide, (el) => el.w_full().max_h(Math.min(180, 12 + rows.length * 28)).border_b(1));
  return (wide ? h_flex() : v_flex()).flex_1().min_h(0).items_stretch()
    .child(listBox.children(rows))
    .child(v_flex().flex_1().min_w(0).min_h(0).child(detail));
}

/**
 * The Run list's rows: folder rows and Request rows. Request rows select only once the Run ended.
 * `f`: filterRun's result for a finished Run, which maps each row to its Request in the Run.
 */
function listRows(self, t, entries, planned, done, f = null) {
  const info = self.v.info;
  return runRows({ collection: info.tree ?? null, target: info.target ?? null, entries, planned, folded: self.folded, counts: f?.counts ?? null }).map((row) => {
    if (row.kind === "folder") return folderRow(t, row, (cx) => {
      const next = new Set(self.folded);
      if (next.has(row.path)) next.delete(row.path); else next.add(row.path);
      self.folded = next;
      cx.notify();
    });
    const i = f ? f.indexes[row.index] : row.index;
    return listRow(t, row.key, row.depth, row.entry, done && i === self.sel, done ? (cx) => { self.sel = i; showBody(self); cx.notify(); } : null);
  });
}

/** A folder in the Run list: chevron, name, a spinner while a Request in it runs, and passed/total. */
function folderRow(t, f, click) {
  return h_flex().id(`resp-${f.key}`).h(28).flex_none().pl(4 + f.depth * INDENT).pr(8).gap(6).items_center().rounded(5).cursor_pointer()
    .hover((s) => s.bg(t.hover)).on_click((_e, cx) => click(cx))
    .child(div().w(12).flex_none().flex().items_center().text_color(t.dim).child(svg(`mods/brunr/icons/${f.folded ? "chevron-right" : "chevron-down"}.svg`).size(12)))
    .child(svg("mods/brunr/icons/folder.svg").size(13).flex_none().text_color(t.muted))
    .child(div().flex_1().min_w(0).truncate().child(f.name))
    .when(f.running, (el) => el.child(spinner(t, 11)))
    .child(div().flex_none().text_size(10.5).text_color(f.failed ? t.blocked : t.done).child(`${f.passed}/${f.total}`));
}

/** One Request in the list: its mark (a spinner while it runs), method, name and status. */
function listRow(t, key, depth, r, selected, click) {
  return h_flex().id(`resp-${key}`).h(28).flex_none().pl(8 + depth * INDENT).pr(8).gap(6).items_center().rounded(5)
    .when(Boolean(click), (el) => el.cursor_pointer().hover((s) => s.bg(selected ? t.selected : t.hover)).on_click((_e, cx) => click(cx)))
    .when(selected, (el) => el.bg(t.selected))
    .child(r.running ? div().w(12).flex_none().flex().items_center().child(spinner(t, 11))
      : div().w(12).flex_none().text_color(r.ok ? t.done : t.blocked).child(r.ok ? "✓" : "✗"))
    .child(methodBadge(t, r.method))
    .child(div().flex_1().min_w(0).truncate().text_color(r.running ? t.muted : t.foreground).child(r.name))
    .when(r.status !== undefined, (el) => el.child(div().flex_none().text_size(10.5).text_color(statusColor(t, r.status)).child(r.status == null ? "ERR" : String(r.status))));
}

/** The summary line while a folder or Collection Run is in progress: a spinner and the count. */
function progressLine(t, p) {
  return h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(11.5)
    .child(spinner(t, 12))
    .child(div().text_color(t.muted).child(`${p.done} of ${p.total}`))
    .child(div().flex_1());
}

function center(t, text) {
  return v_flex().flex_1().items_center().justify_center().p(20).text_color(t.dim).child(div().child(text));
}

function summaryLine(t, s, f = null) {
  const part = (n, label, color) => div().text_color(n ? color : t.dim).child(`${n} ${label}`);
  return h_flex().h(30).flex_none().px(12).gap(12).items_center().border_b(1).border_color(t.border).text_size(11.5)
    .child(div().text_color(t.muted).child(`${s.requests} ${s.requests === 1 ? "Request" : "Requests"}`))
    .child(part(s.passed, "passed", t.done)).child(part(s.failed, "failed", t.blocked)).child(part(s.skipped, "skipped", t.ansi3))
    .when(Boolean(f?.filtering), (el) => el.child(div().text_color(t.accent).child(`showing ${f.visible} of ${f.total}`)))
    .child(div().flex_1()).child(div().text_color(t.dim).child(formatTime(s.duration)));
}

function topLine(t, name, method, url, r) {
  const line = h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
    .child(div().min_w(0).max_w(220).truncate().font_semibold().child(name ?? ""))
    .when(Boolean(method), (el) => el.child(methodBadge(t, method, 44)))
    .child(div().flex_1().min_w(0).truncate().font_family(mono()).text_size(11.5).text_color(t.muted).child(url ?? ""));
  if (!r) return line;
  // The status, time and size never give way: the name and URL shorten instead.
  return line.child(h_flex().flex_none().gap(8).items_center()
    .child(div().px(6).h(20).flex().items_center().rounded(4).bg(t.raised).font_semibold().text_size(11.5).text_color(statusColor(t, r.status))
      .child(r.status == null ? "Error" : `${r.status} ${r.statusText ?? ""}`.trim()))
    .when(r.time != null, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(formatTime(r.time))))
    .when(r.size != null, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(formatSize(r.size)))));
}

function responseView(self, t, r) {
  const passed = r.tests.filter((x) => x.ok).length;
  const label = { response: "Response", headers: `Headers ${r.headers.length}`, timeline: "Timeline", tests: `Tests ${passed}/${r.tests.length}` };
  const tabs = h_flex().h(32).flex_none().px(8).gap(2).items_end().border_b(1).border_color(t.border).text_size(12)
    .children(PARTS.map((p) => h_flex().id(`part-${p}`).h_full().px(10).items_center().cursor_pointer()
      .when(p === self.part, (el) => el.border_b(2).border_color(t.accent).text_color(t.foreground))
      .when(p !== self.part, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
      .when(p === "tests" && r.tests.some((x) => !x.ok), (el) => el.text_color(t.blocked))
      .on_click((_e, cx) => { self.part = p; cx.notify(); })
      .child(label[p])));
  const body = self.part === "headers" ? headersView(t, r.headers)
    : self.part === "timeline" ? timelineView(t, r)
    : self.part === "tests" ? testsView(t, r)
    : self.editor && r.body ? Editor.new(self.editor).flex_1().min_h(0)
    : center(t, r.error ?? "No body");
  return v_flex().flex_1().min_h(0).child(topLine(t, r.name, r.method, r.url, r)).child(tabs).child(body);
}

function headersView(t, headers) {
  if (!headers.length) return center(t, "No headers");
  return v_flex().id("brunr-headers").flex_1().min_h(0).overflow_y_scrollbar().p(8).font_family(mono()).text_size(11.5)
    .children(headers.map(([k, v], i) => h_flex().id(`h-${i}`).flex_none().px(6).py(4).gap(12).items_start().border_b(1).border_color(t.border)
      .child(div().w(200).flex_none().text_color(t.muted).child(k)).child(div().flex_1().min_w(0).child(String(v)))));
}

function timelineView(t, r) {
  const box = v_flex().id("brunr-timeline").flex_1().min_h(0).overflow_y_scrollbar().p(12).gap(4).font_family(mono()).text_size(11.5);
  box.child(h_flex().gap(8).child(methodBadge(t, r.method, 44)).child(div().flex_1().min_w(0).child(r.url)));
  for (const [k, v] of r.requestHeaders) box.child(div().pl(12).text_color(t.muted).child(`${k}: ${v}`));
  if (r.requestBody) {
    box.child(div().pt(6).text_color(t.dim).child("Body"));
    for (const l of lines(r.requestBody)) box.child(div().pl(12).min_h(16).child(l));
  }
  box.child(div().h(10));
  if (r.status == null) box.child(div().text_color(t.blocked).child(r.error ?? "No response"));
  else box.child(h_flex().gap(10).child(div().text_color(statusColor(t, r.status)).child(`${r.status} ${r.statusText ?? ""}`.trim())).when(r.time != null, (el) => el.child(div().text_color(t.muted).child(formatTime(r.time)))));
  return box;
}

function testsView(t, r) {
  const box = v_flex().id("brunr-tests").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(2);
  if (r.error) box.child(div().px(8).py(6).text_color(t.blocked).child(r.error));
  if (!r.tests.length) return box.child(div().px(8).py(6).text_color(t.dim).child("No assertions or tests."));
  return box.children(r.tests.map((x, i) => v_flex().id(`test-${i}`).flex_none().px(8).py(6).gap(3).rounded(5).border_b(1).border_color(t.border)
    .child(h_flex().gap(8).items_center()
      .child(div().w(12).flex_none().text_color(x.ok ? t.done : t.blocked).child(x.ok ? "✓" : "✗"))
      .child(div().flex_1().min_w(0).font_family(mono()).text_size(11.5).child(x.name || "(unnamed)"))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(x.kind === "assert" ? "assertion" : "test")))
    .when(Boolean(x.error), (el) => el.child(div().pl(20).text_size(11.5).text_color(t.blocked).child(String(x.error))))));
}
