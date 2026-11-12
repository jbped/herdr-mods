// PROTOTYPE, throwaway. Answers one question: can a mod fake niri-style
// Scrolling by rewriting its layout with terminal blocks?
//   A1 a terminal block shows a pane's terminal while the tab block is gone
//   A2 layout.set from a mod on tab change, without a loop
//   A3 how long layout.set takes to show
//   A4 the shipped pane header mod works on a composition column
// Lives in a bar above the panes of the `scroll-proto` layout. The bar shows
// every piece of state it acts on.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, focused, layout, run, theme, props, shared, setShared, nextCommand } from "herdr";

const MAIN = "main";                 // id of the tab block in the cloned layout
const UNITS = 6;                     // window width in sixths: 2 = 1/3, 3 = 1/2, 4 = 2/3
const WIDTHS = [2, 3, 4];
const K = (k) => `scroll-proto.${k}`;
const get = (k, d) => shared(K(k)) ?? d;
const safe = (s) => String(s).replace(/[^A-Za-z0-9]/g, "-");

function findNode(n, id) {
  if (!n) return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) { const f = findNode(c, id); if (f) return f; }
  return null;
}
function replaceNode(n, id, next) {
  if (n.id === id) return next;
  return n.children ? { ...n, children: n.children.map((c) => replaceNode(c, id, next)) } : n;
}

export default class ScrollProto extends View {
  init(_props, cx) {
    this.log = [];
    this.sets = [];            // timestamps of layout.set calls (loop detector)
    this.halted = false;
    this.pending = null;       // { at, sig } waiting to show in layout()
    this.lastSig = null;
    this.firsts = {};
    this.orig = null;
    if (props()?.filler) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^scroll-proto[.:]/, "");
        this.command(c);
        cx.notify();
      }
    });
  }

  note(s) { this.log = [`${new Date().toISOString().slice(11, 23)} ${s}`, ...this.log].slice(0, 6); }

  tab() { return focused()?.tab ?? null; }
  tabPanes(tab) { return panes().filter((p) => p.tab === tab); }

  focusIndex(list) {
    const f = focused();
    let i = list.findIndex((p) => f?.terminal && p.terminal === f.terminal);
    if (i < 0) i = list.findIndex((p) => p.pane === f?.pane);
    if (i < 0) i = list.findIndex((p) => p.pane === this.lastFocus);
    return Math.max(0, i);
  }

  width(pane) { return get("widths", {})[pane] ?? 3; }

  // Which whole Columns fit, scrolling just enough to keep the focused one visible.
  view(tab, list, fi) {
    let first = Math.min(this.firsts[tab] ?? 0, Math.max(0, list.length - 1));
    if (fi < first) first = fi;
    const sum = (a, b) => list.slice(a, b + 1).reduce((s, p) => s + this.width(p.pane), 0);
    while (first < fi && sum(first, fi) > UNITS) first++;
    const shown = [];
    let used = 0;
    for (let i = first; i < list.length; i++) {
      const w = this.width(list[i].pane);
      if (shown.length && used + w > UNITS) break;
      shown.push(i); used += w;
    }
    return { first, shown, used };
  }

  composition(list, v) {
    const cols = v.shown.map((i) => {
      const p = list[i];
      const body = p.terminal ? { terminal: p.terminal } : { mod: p.mod };
      return {
        id: `sp-col-${safe(p.pane)}`, type: "column", size: { weight: this.width(p.pane) },
        radius: 10, background: "background", border: { width: 1, color: "border" },
        focus: { border: { width: 1, color: "accent" } }, resizable: false,
        children: [
          { id: `sp-head-${safe(p.pane)}`, type: "block", size: { px: 30 }, content: { mod: "pane", props: { pane: p.pane, terminal: p.terminal } } },
          { id: `sp-term-${safe(p.pane)}`, type: "block", content: body },
        ],
      };
    });
    if (v.used < UNITS) cols.push({ id: "sp-filler", type: "block", size: { weight: UNITS - v.used }, content: { mod: "scroll-proto", props: { filler: true } } });
    return { id: MAIN, type: "row", gap: 8, resizable: false, children: cols };
  }

  // Desired main node for the shown tab, or null when nothing should change.
  desired() {
    const tab = this.tab();
    const root = layout();
    const cur = findNode(root, MAIN);
    if (!tab || !cur) return null;
    if (cur.content?.tab) this.orig = cur;
    const orig = this.orig ?? get("orig", null);
    const list = this.tabPanes(tab);
    if (get("modes", {})[tab] !== "scrolling" || list.length === 0) return orig;
    const fi = this.focusIndex(list);
    this.lastFocus = list[fi]?.pane;
    const v = this.view(tab, list, fi);
    this.firsts[tab] = v.first;
    this.state = { list, fi, v };
    return this.composition(list, v);
  }

  apply(cx) {
    const want = this.desired();
    if (!want || this.halted) return;
    const sig = JSON.stringify(want);
    const cur = findNode(layout(), MAIN);
    const same = (a, b) => a?.type === b?.type && (a?.children?.length ?? 0) === (b?.children?.length ?? 0) && a?.children?.[0]?.id === b?.children?.[0]?.id;
    if (this.pending && same(cur, this.pending.want)) {
      this.note(`shown after ${Date.now() - this.pending.at} ms (run took ${this.pending.runMs} ms)`);
      this.pending = null;
    }
    if (sig === this.lastSig) return;          // already sent this exact tree
    const now = Date.now();
    this.sets = [...this.sets.filter((t) => now - t < 2000), now];
    if (this.sets.length > 8) { this.halted = true; this.note("HALTED: >8 layout.set in 2 s (loop)"); return; }
    this.lastSig = sig;
    cx.spawn(async (cx) => {
      const at = Date.now();
      const r = run("layout.set", { layout: replaceNode(layout(), MAIN, want) });
      this.pending = { at, want, runMs: Date.now() - at };
      if (this.orig && !get("orig", null)) setShared(K("orig"), this.orig);
      if (r?.error) this.note(`layout.set error: ${r.error}`);
      cx.notify();
    });
  }

  command(c) {
    const tab = this.tab();
    const list = this.tabPanes(tab);
    const fi = this.focusIndex(list);
    const cur = list[fi];
    const modes = get("modes", {});
    if (c === "toggle") {
      setShared(K("modes"), { ...modes, [tab]: modes[tab] === "scrolling" ? "dwindle" : "scrolling" });
      this.note(`toggle -> ${modes[tab] === "scrolling" ? "dwindle" : "scrolling"}`);
    } else if (c === "left" || c === "right") {
      const t = list[Math.min(list.length - 1, Math.max(0, fi + (c === "left" ? -1 : 1)))];
      if (t) { this.lastFocus = t.pane; run("pane.focus", t.terminal ? { terminal: t.terminal } : { pane: t.pane }); }
      this.note(`${c} -> ${t?.pane}`);
    } else if (c === "width" && cur) {
      const w = this.width(cur.pane);
      setShared(K("widths"), { ...get("widths", {}), [cur.pane]: WIDTHS[(WIDTHS.indexOf(w) + 1) % WIDTHS.length] });
      this.note(`width ${cur.pane} ${w} -> ${WIDTHS[(WIDTHS.indexOf(w) + 1) % WIDTHS.length]}`);
    } else if (c === "new" && cur) {
      const r = run("pane.split", { pane: cur.pane, direction: "right" });
      this.note(`new -> ${JSON.stringify(r)}`);
      if (r?.terminal) run("pane.focus", { terminal: r.terminal });
    } else if (c === "reset") {
      this.halted = false; this.sets = []; this.lastSig = null; this.note("reset");
    }
  }

  btn(t, id, label, c) {
    return div().id(`sp-${id}`).px(8).py(2).rounded(4).bg(t.surface).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.command(c); cx.notify(); })
      .child(label);
  }

  render(cx) {
    const t = theme();
    if (props()?.filler) return div().size_full();
    this.apply(cx);
    const tab = this.tab();
    const mode = get("modes", {})[tab] ?? "dwindle";
    const s = this.state && mode === "scrolling" ? this.state : null;
    const dots = s ? s.list.map((p, i) => (i === s.fi ? "●" : s.v.shown.includes(i) ? "○" : "·")).join(" ") : "";
    const widths = s ? s.list.map((p) => `${this.width(p.pane)}/6`).join(" ") : "";
    const f = focused();
    return h_flex().size_full().px(8).gap(8).items_center().text_size(11).text_color(t.muted).bg(t.chrome)
      .child(div().text_color(t.blocked).child("PROTOTYPE"))
      .child(this.btn(t, "toggle", mode === "scrolling" ? "Scrolling" : "Dwindle", "toggle"))
      .child(this.btn(t, "left", "◀", "left"))
      .child(this.btn(t, "right", "▶", "right"))
      .child(this.btn(t, "width", "Width", "width"))
      .child(this.btn(t, "new", "New", "new"))
      .child(this.btn(t, "reset", "Reset", "reset"))
      .child(div().text_color(t.foreground).child(dots))
      .child(div().child(s ? `first ${s.v.first} shown [${s.v.shown}] w ${widths}` : ""))
      .child(div().child(`focus pane=${f?.pane ?? "null"} term=${f?.terminal ?? "null"}`))
      .child(div().flex_1().truncate().text_color(this.halted ? t.blocked : t.dim).child(this.log.join("  |  ")));
  }
}
