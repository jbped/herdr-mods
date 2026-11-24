// Notifyr: keeps every notification Herdr shows, and lists them later.
//
// One mod, three views, chosen by props:
//   toast  the layout root's "toast": "notifyr". Draws the notification as Herdr's own
//          toast mod does, and records it. This is the only place that sees every one.
//   bell   props { bell: true }. A small block for the layout: a bell and the unread count.
//          It also watches where the person goes, to mark entries read.
//   list   opened by the bell or by mod.open: the record, newest first, with vim keys.
//
// The record is the shared value "notifyr.log":
//   [{ id, at, overlay, title, body, level, icon, action, terminal, space, program, read }]
// read is null while unread, else { at, how }: "clicked" (the toast), "visited" (the person arrived at its
// space or terminal), "opened" (from the list), "listed" (seen in the list), "marked" (by hand).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { agents, checking, closeOverlay, focused, layout, panes, props, run, setShared, shared, spaces, terminals, theme } from "herdr";

const LOG = "notifyr.log";
const SEEN = "notifyr.seen"; // Only for entries recorded before read was kept per entry.
const MAX = 200;
const BODY_MAX = 600;
const HALF_PAGE = 6;
const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const LEVELS = ["success", "warning", "error", "info"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOW = { clicked: "clicked", visited: "visited", opened: "opened", listed: "seen", marked: "read" };
const HOW_TIP = {
  clicked: "You clicked its toast",
  visited: "You went to its space",
  opened: "You opened it from this list",
  listed: "You saw it in this list",
  marked: "You marked it read",
};
const KEYS = [
  ["j / k", "down / up"], ["g / G", "first / last"], ["ctrl-d / ctrl-u", "half a page"],
  ["enter", "go to it"], ["r", "read / unread"], ["R", "all read"],
  ["x / delete", "delete"], ["X", "delete all"], ["u", "unread only"], ["q", "close"],
  ["?", "hide this list"],
];

function entries() {
  const v = shared(LOG);
  return Array.isArray(v) ? v : [];
}

function isRead(e) {
  if (e.read) return true;
  return e.read === undefined && e.at <= (Number(shared(SEEN)) || 0);
}

/** Rewrites the record through fn. Writes only when an entry changed or went (fn returns null). */
function update(fn) {
  const log = entries();
  let changed = false;
  const next = [];
  for (const e of log) {
    const r = fn(e);
    if (r !== e) changed = true;
    if (r) next.push(r);
  }
  if (changed) setShared(LOG, next);
}

function markRead(match, how) {
  const at = Date.now();
  update((e) => (!isRead(e) && match(e) ? { ...e, read: { at, how } } : e));
}

function spaceOfTab(tab) {
  return spaces().find((s) => s.tabs.some((x) => x.id === tab))?.id ?? null;
}

/** The terminal and space a toast's action goes to, when it names one. */
function target(action) {
  const a = action?.args ?? {};
  const str = (v) => (typeof v === "string" && v ? v : null);
  const terminal = str(a.terminal);
  let space = str(a.space);
  if (!space && action?.name?.startsWith("space.")) space = str(a.id);
  if (!space && action?.name?.startsWith("tab.") && str(a.id)) space = spaceOfTab(a.id);
  if (!space && str(a.tab)) space = spaceOfTab(a.tab);
  if (!space && terminal) {
    space = agents().find((x) => x.address === terminal)?.space ?? null;
    const pane = space ? null : panes().find((x) => x.terminal === terminal);
    if (pane) space = spaceOfTab(pane.tab);
  }
  if (!space && str(a.pane)) {
    const pane = panes().find((x) => x.pane === a.pane);
    if (pane) space = spaceOfTab(pane.tab);
  }
  return { terminal, space };
}

/** Adds one toast to the record and returns its id. A toast whose copy starts again (a hot
 *  reload) is not added twice. */
function record(p) {
  const now = Date.now();
  const log = entries();
  const again = log.find((e) => e.overlay === p.overlay && e.title === (p.title ?? "") && now - e.at < 60000);
  if (again) return again.id;
  const action = p.action?.name ? { name: p.action.name, args: p.action.args ?? {} } : null;
  const entry = {
    id: `${now}-${p.overlay ?? ""}`,
    at: now,
    overlay: p.overlay ?? null,
    title: String(p.title ?? ""),
    body: p.body ? String(p.body).slice(0, BODY_MAX) : "",
    level: p.level ?? "info",
    icon: p.icon ?? null,
    action,
    ...target(action),
    program: programOf(target(action).terminal),
    read: null,
  };
  setShared(LOG, [entry, ...log].slice(0, MAX));
  return entry.id;
}

const two = (n) => String(n).padStart(2, "0");

function clock(at) {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "now", "5m", "3h", then "Nov 16". */
function ago(at, now) {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function stamp(at) {
  const d = new Date(at);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${clock(at)}`;
}

/** What ran in a terminal, as Herdr's program table shows it. Kept on the entry, so the icon
 *  outlives the terminal. */
function programOf(terminal) {
  const p = terminal ? terminals().find((x) => x.address === terminal)?.program : null;
  return p?.icon ? { name: p.name, icon: p.icon, tint: Boolean(p.tint) } : null;
}

/** The list's mark for an entry: the toast's own icon, else the program of its terminal (with
 *  a corner dot for a level other than info), else a glyph for its level. */
function mark(t, e, read) {
  const color = t[DOT[e.level] ?? "accent"];
  if (e.icon) return image(e.icon).w(16).h(16).flex_none();
  const p = e.program ?? programOf(e.terminal);
  if (!p) return svg(`mods/notifyr/icons/${LEVELS.includes(e.level) ? e.level : "info"}.svg`).size(16).flex_none().text_color(color);
  const pic = p.tint ? svg(p.icon).size(16).flex_none().text_color(read ? t.muted : t.foreground) : image(p.icon).w(16).h(16).flex_none();
  if (!e.level || e.level === "info") return pic;
  return div().relative().size(16).flex_none().child(pic)
    .child(div().absolute().right(-3).bottom(-3).size(7).rounded(3.5).border(1).border_color(t.popover).bg(color));
}

export default class Notifyr extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const toast = p.title != null || p.body != null || p.level != null;
    this.view = p.bell ? "bell" : toast && !p.list ? "toast" : "list";
    this.lastSpace = focused()?.space ?? null;
    this.lastTerminal = focused()?.terminal ?? null;
    if (this.view === "list") {
      this.at = 0;
      this.onlyUnread = false;
      this.help = false;
      this.fresh = new Set();
      this.scroll = ScrollHandle.new();
      this.handle = cx.focus_handle();
      this.handle.focus();
      cx.timer.after(600, () => this.handle.focus());
    }
    if (checking()) return;
    if (this.view === "toast") this.entry = record(p);
    if (this.view === "list") {
      // An entry with nowhere to go is read once the list has shown it. It keeps its mark while the list is open.
      const plain = (e) => !e.action && !e.space;
      for (const e of entries()) if (!isRead(e) && plain(e)) this.fresh.add(e.id);
      markRead(plain, "listed");
    }
  }

  /** The person clicked this toast. */
  touched() {
    if (this.entry) markRead((e) => e.id === this.entry, "clicked");
  }

  /** Marks entries read when the person arrives at their space or their terminal. Being there
   *  already does not count, so an entry marked unread by hand stays unread. */
  sweep(cx) {
    if (checking()) return;
    const f = focused();
    // An overlay with the keyboard can leave nothing focused. That is not leaving the space.
    const space = f?.space ?? this.lastSpace;
    const terminal = f?.terminal ?? this.lastTerminal;
    const enteredSpace = space !== this.lastSpace ? space : null;
    const enteredTerminal = terminal !== this.lastTerminal ? terminal : null;
    this.lastSpace = space;
    this.lastTerminal = terminal;
    if (enteredSpace == null && enteredTerminal == null) return;
    const hit = (e) => (enteredSpace != null && e.space === enteredSpace) || (enteredTerminal != null && e.terminal === enteredTerminal);
    if (entries().some((e) => !isRead(e) && hit(e))) cx.spawn(async () => markRead(hit, "visited"));
  }

  render(cx) {
    const t = theme();
    if (this.view === "toast") return this.renderToast(t);
    this.sweep(cx);
    if (this.view === "bell") return this.renderBell(t);
    return this.renderList(t);
  }

  /** Herdr's own toast, unchanged: click runs the action and dismisses it. */
  renderToast(t) {
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        this.touched();
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); this.touched(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      );
  }

  /** The layout's mark. props { bare: true } drops the status-bar background and top border. */
  renderBell(t) {
    const p = props() ?? {};
    const all = entries();
    const unread = all.filter((e) => !isRead(e)).length;
    const color = unread ? t.accent : t.muted;
    const tip = unread ? `${unread} unread ${unread === 1 ? "notification" : "notifications"}` : all.length ? "No unread notifications" : "No notifications yet";
    return h_flex()
      .id("notifyr-bell")
      .size_full()
      .gap(5)
      .items_center()
      .justify_center()
      .when(!p.bare, (el) => el.bg(t.chrome).border_t(1).border_color(t.border))
      .text_size(11.8)
      .text_color(color)
      .cursor_pointer()
      .hover((x) => x.text_color(t.foreground))
      .tooltip(`${tip}. Click to open the list (ctrl-shift-i)`)
      .on_click(() => run("mod.open", { name: "notifyr" }))
      .child(svg("mods/notifyr/bell.svg").size(14).flex_none().text_color(color))
      .when(unread > 0, (el) => el.child(div().child(unread > 99 ? "99+" : String(unread))));
  }

  shownEntries() {
    const log = entries();
    return this.onlyUnread ? log.filter((e) => !isRead(e) || this.fresh.has(e.id)) : log;
  }

  closeList() {
    const id = props()?.overlay;
    if (id != null) closeOverlay(id);
  }

  /** Goes where the entry's toast would have gone. One with nowhere to go is only marked read. */
  go(e) {
    if (!e) return;
    markRead((x) => x.id === e.id, "opened");
    if (!e.action?.name) return;
    this.closeList();
    run(e.action.name, e.action.args ?? {});
  }

  toggleRead(e) {
    if (!e) return;
    this.fresh.delete(e.id);
    const read = isRead(e) ? null : { at: Date.now(), how: "marked" };
    update((x) => (x.id === e.id ? { ...x, read } : x));
  }

  listKey(ev, cx) {
    const rows = this.shownEntries();
    const last = Math.max(0, rows.length - 1);
    const m = ev.modifiers ?? {};
    const k = ev.key;
    const ks = ev.keystroke;
    const plain = !m.control && !m.alt && !m.platform;
    const shift = Boolean(m.shift);
    if (k === "escape" || (plain && !shift && k === "q")) this.closeList();
    else if (ks === "ctrl-d") this.at = Math.min(last, this.at + HALF_PAGE);
    else if (ks === "ctrl-u") this.at = Math.max(0, this.at - HALF_PAGE);
    else if (!plain) return;
    else if (k === "?" || (shift && k === "/")) this.help = !this.help;
    else if (k === "down" || (!shift && k === "j")) this.at = Math.min(last, this.at + 1);
    else if (k === "up" || (!shift && k === "k")) this.at = Math.max(0, this.at - 1);
    else if (k === "G" || (shift && k === "g") || k === "end") this.at = last;
    else if (k === "g" || k === "home") this.at = 0;
    else if (k === "pagedown") this.at = Math.min(last, this.at + HALF_PAGE * 2);
    else if (k === "pageup") this.at = Math.max(0, this.at - HALF_PAGE * 2);
    else if (k === "enter") this.go(rows[this.at]);
    else if (k === "R" || (shift && k === "r")) { this.fresh.clear(); markRead(() => true, "marked"); }
    else if (k === "r") this.toggleRead(rows[this.at]);
    else if (k === "X" || (shift && k === "x")) { setShared(LOG, []); this.at = 0; }
    else if (k === "delete" || (!shift && k === "x")) {
      const e = rows[this.at];
      if (e) update((x) => (x.id === e.id ? null : x));
    }
    else if (!shift && k === "u") { this.onlyUnread = !this.onlyUnread; this.at = 0; }
    else return;
    this.scroll.scroll_to_item(this.at);
    cx.stop_propagation();
    cx.notify();
  }

  renderList(t) {
    const all = entries();
    const rows = this.shownEntries();
    const unread = all.filter((e) => !isRead(e)).length;
    const now = Date.now();
    const wired = layout()?.toast === "notifyr";
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));

    const button = (id, label, on) =>
      div().id(id).flex_none().px(8).py(3).rounded(4).bg(t.raised)
        .text_size(12).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { on(); cx.notify(); })
        .child(label);

    const row = (e, i) => {
      const read = isRead(e);
      const marked = !read || this.fresh.has(e.id);
      const how = e.read?.how;
      return h_flex()
        .id(`notifyr-row-${e.id ?? i}`)
        .flex_none()
        .px(14)
        .py(9)
        .gap(10)
        .items_start()
        .border_b(1)
        .border_color(t.border)
        .when(i === this.at, (el) => el.bg(t.selected))
        .when(Boolean(e.action?.name), (el) => el.cursor_pointer())
        .hover((s) => s.bg(t.hover))
        .on_click((_ev, cx) => { this.at = i; this.go(e); cx.notify(); })
        .child(h_flex().flex_none().h(18).w(18).items_center().justify_center().child(mark(t, e, read && !marked)))
        .child(
          v_flex()
            .flex_1()
            .min_w(0)
            .gap(2)
            .child(div().font_semibold().text_size(13).text_color(marked ? t.foreground : t.muted).child(e.title || "(no title)"))
            .when(Boolean(e.body), (el) => el.child(div().text_size(12).text_color(marked ? t.muted : t.dim).child(e.body))),
        )
        .child(
          v_flex().flex_none().items_end().gap(2)
            .child(
              h_flex().h(18).gap(6).items_center()
                .when(marked, (el) => el.child(div().size(6).rounded(3).flex_none().bg(t.accent)))
                .child(div().text_size(11).text_color(marked ? t.accent : t.dim).tooltip(stamp(e.at)).child(ago(e.at, now))),
            )
            .when(read && !marked && Boolean(how), (el) => el.child(
              div().text_size(10.5).text_color(t.dim).tooltip(`${HOW_TIP[how] ?? "Read"}, ${stamp(e.read.at)}`).child(HOW[how] ?? "read"),
            )),
        );
    };

    const key = (k, what) => h_flex().gap(5).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(what));
    const legend = this.help
      ? h_flex().flex_none().flex_wrap().px(14).py(8).gap_x(16).gap_y(4).bg(t.raised).border_t(1).border_color(t.border).text_size(11)
          .children(KEYS.map(([k, what]) => key(k, what)))
      : h_flex().flex_none().h(28).px(14).gap(14).items_center().border_t(1).border_color(t.border).text_size(11)
          .child(key("j/k", "move")).child(key("enter", "go")).child(key("r", "read")).child(key("x", "delete")).child(key("u", "unread only")).child(key("?", "keys"));

    return v_flex()
      .id("notifyr-list")
      .track_focus(this.handle)
      .on_key_down((ev, cx) => this.listKey(ev, cx))
      .on_click(() => this.handle.focus())
      .size_full()
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .flex_none()
          .h(40)
          .px(14)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(div().font_semibold().text_size(13).child("Notifications"))
          .child(div().flex_1().text_size(11.5).text_color(t.dim).child(
            all.length ? `${unread} unread of ${all.length}${this.onlyUnread ? ", showing unread" : ""}` : ""))
          .when(unread > 0, (el) => el.child(button("notifyr-all-read", "Mark all read", () => { this.fresh.clear(); markRead(() => true, "marked"); })))
          .when(all.length > 0, (el) => el.child(button("notifyr-clear", "Clear", () => { setShared(LOG, []); this.at = 0; }))),
      )
      .when(!wired, (el) => el.child(
        div().flex_none().px(14).py(8).border_b(1).border_color(t.border).text_size(11.5).text_color(t.working)
          .child('This layout does not record notifications. Set "toast": "notifyr" on its root.'),
      ))
      .child(
        rows.length
          ? v_flex().id("notifyr-rows").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).children(rows.map(row))
          : v_flex().flex_1().items_center().justify_center().text_size(12).text_color(t.dim).child(all.length ? "Nothing unread." : "No notifications yet."),
      )
      .child(legend);
  }
}
