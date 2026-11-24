// The container window: Logs, Inspect and Stats for one container, as Docker Desktop lays them out,
// or the log lines of a whole Stack in time order. Lines arrive by waiting on `docker logs -f`, one
// wait per container, and Stats samples only while its tab shows. Nothing here runs on a timer.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { closeOverlay, props, setShared, settings } from "herdr";
import * as model from "./model.js";
import * as docker from "./docker.js";
import { legend } from "./kit/legend.js";

const ROW = 17, CHAR = 6.7, CAP = 5000;
const icon = (name) => `mods/dockr/icons/${name}.svg`;

export function init(self, cx) {
  const p = self.logging;
  self.log = { lines: [], follow: true, query: "", time: false, off: {}, at: -1, ended: {}, errors: [], jump: null,
    tab: "logs", samples: [], sampling: false, seen: false };
  self.logScroll = VirtualListScrollHandle.new();
  self.logInput = InputState.new({ value: "", placeholder: "Search. /regex/ works too" });
  self.logInput.on("change", (_e, cx) => { self.log.query = self.logInput.value(); self.log.at = -1; cx.notify(); });
  self.logInput.on("submit", (_e, cx) => { step(self, 1); self.handle.focus(); cx.notify(); });
  self.logInput.on("focus", (_e, cx) => { self.log.typing = true; cx.notify(); });
  self.logInput.on("blur", (_e, cx) => { self.log.typing = false; cx.notify(); });
  self.handle.focus();
  for (const s of p.sources) {
    cx.spawn(async (cx) => {
      let since = "";
      for (;;) {
        const r = await docker.waitLogs(p.machine, s.name, since);
        if (r.error) { self.log.errors.push(`${s.label}: ${model.explain(r.error, p.machine)}`); cx.notify(); return; }
        const got = model.parseLogs(r.text, s.label);
        self.log.seen = true;
        self.log.lines = model.addLogs(self.log.lines, got.lines, since, CAP);
        for (const l of got.lines) if (l.at > since) since = l.at;
        if (self.log.follow) self.log.jump = "end";
        if (got.ended) {
          self.log.ended[s.label] = true;
          cx.notify();
          const w = await docker.waitStart(p.machine, s.name);
          if (w.error) { self.log.errors.push(`${s.label}: ${model.explain(w.error, p.machine)}`); cx.notify(); return; }
          delete self.log.ended[s.label];
        }
        cx.notify();
      }
    });
  }
}

/** Samples CPU and memory for this container while the Stats tab shows. */
function sample(self, cx) {
  const p = self.logging, L = self.log;
  if (L.sampling) return;
  L.sampling = true;
  cx.spawn(async (cx) => {
    try {
      while (L.tab === "stats") {
        const r = await docker.waitStats(p.machine);
        if (r.error) { L.errors.push(model.explain(r.error, p.machine)); return; }
        const now = model.parseStats(r.text)[p.info.container.name];
        if (now) L.samples = [...L.samples, now].slice(-90);
        cx.notify();
      }
    } finally { L.sampling = false; cx.notify(); }
  });
}

const act = (self, action) => setShared("dockr.request", { n: Date.now(), kind: "act", key: self.logging.info.key, action, arg: null });

function inspect(self, t) {
  const i = self.logging.info, c = i.container;
  const row = (label, value, color) => h_flex().w_full().gap(12).py(3).text_size(12)
    .child(div().w(110).flex_none().text_color(t.dim).child(label))
    .child(div().flex_1().min_w(0).text_color(color ?? t.foreground).child(value || "—"));
  const list = (label, items) => v_flex().w_full().py(3).gap(2).text_size(12)
    .child(div().text_color(t.dim).child(`${label} (${items.length})`))
    .children(items.map((x) => div().pl(12).text_color(t.muted).child(x)));
  const out = v_flex().w_full().p(14).gap(1)
    .child(row("Name", c.name)).child(row("Image", c.image)).child(row("Command", c.command))
    .child(row("State", `${c.health ? `${c.state}, ${c.health}` : c.state}${c.restarts ? `, ${c.restarts} restarts` : ""}`))
    .child(row("Created", c.created)).child(row("Started", c.startedAt));
  if (i.why) out.child(row("Problem", i.why, t.ansi1));
  if (c.healthOutput) out.child(row("Health check", c.healthOutput));
  if (i.runs || i.set) {
    out.child(row("Runs from", i.runs ?? "unknown: built outside Dockr", i.drift ? t.ansi3 : undefined));
    if (i.set && i.set !== i.runs) out.child(row("Set to", i.set));
  }
  out.child(row("Ports", c.ports.map((p) => `${p.host} → ${p.container}`).join(", ")));
  if (c.mounts.length) out.child(list("Mounts", c.mounts.map((m) => `${m.source} → ${m.target}${m.rw ? "" : " (read only)"}`)));
  if (c.networks.length) out.child(list("Networks", c.networks.map((n) => (n.ip ? `${n.name}  ${n.ip}` : n.name))));
  if (c.env.length) out.child(list("Environment, names only", c.env));
  const labels = Object.entries(c.labels);
  if (labels.length) out.child(list("Labels", labels.map(([k, v]) => `${k}=${v}`)));
  return div().id("inspect-body").flex_1().min_h(0).overflow_y_scrollbar().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(out);
}

function stats(self, t) {
  const L = self.log, last = L.samples[L.samples.length - 1];
  const chart = (label, values, top, text, color) => v_flex().w_full().gap(6)
    .child(h_flex().w_full().gap(10).items_center().child(div().font_semibold().child(label)).child(div().text_color(t.muted).child(text)))
    .child(h_flex().w_full().h(90).px(6).gap(2).items_end().rounded(6).bg(t.raised).children(values.map((v) =>
      div().w(8).flex_none().rounded(1).h(Math.max(2, Math.round((Math.min(v, top) / top) * 82))).bg(color))));
  const out = v_flex().w_full().p(14).gap(16).text_size(12);
  if (!last) return out.child(div().text_color(t.dim).child(L.ended[self.logging.sources[0].label] ? "The container is not running." : "Waiting for the first sample. It takes about two seconds…"));
  const cpus = L.samples.map((x) => x.cpu), mems = L.samples.map((x) => x.mem);
  return out
    .child(chart("CPU", cpus, Math.max(100, ...cpus), `${last.cpu.toFixed(1)}%`, t.ansi4))
    .child(chart("Memory", mems, Math.max(1, ...mems) * 1.15, `${model.size(last.mem)}${last.limit ? ` of ${model.size(last.limit)}` : ""}`, t.ansi5))
    .child(h_flex().gap(24).text_color(t.muted).child(div().child(`Network in / out: ${last.net}`)).child(div().child(`Disk read / write: ${last.disk}`)));
}

/** The lines shown: those of the sources left on. */
const shown = (self) => {
  const off = self.log.off;
  return Object.keys(off).length ? self.log.lines.filter((l) => !off[l.src]) : self.log.lines;
};

/** Moves to the next (1) or previous (-1) matching line. */
function step(self, by) {
  const test = model.matcher(self.log.query), rows = shown(self);
  if (!test || !rows.length) return;
  let i = self.log.at < 0 ? (by > 0 ? -1 : rows.length) : self.log.at;
  for (let n = 0; n < rows.length; n++) {
    i = (i + by + rows.length) % rows.length;
    if (test(rows[i].text)) { self.log.at = i; self.log.follow = false; self.log.jump = i; return; }
  }
}

export function render(self, t) {
  const p = self.logging, L = self.log, rows = shown(self), test = model.matcher(L.query);
  const info = p.info ?? null, logsTab = L.tab === "logs";
  const up = info ? (L.seen ? !L.ended[p.sources[0].label] : info.running) : false;
  const mono = settings().font_family ?? "JetBrains Mono", close = () => closeOverlay(props().overlay);
  const many = p.sources.length > 1;
  const colors = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1];
  const colorOf = Object.fromEntries(p.sources.map((s, i) => [s.label, colors[i % colors.length]]));
  const labelW = many ? Math.max(...p.sources.map((s) => s.label.length)) * CHAR + 12 : 0;
  const hits = test ? rows.reduce((n, l) => n + (test(l.text) ? 1 : 0), 0) : 0;
  const longest = rows.reduce((n, l) => Math.max(n, l.text.length), 0);
  const width = Math.min(longest, 2000) * CHAR + labelW + (L.time ? 96 : 0) + 24;

  if (L.jump != null && rows.length) {
    try { self.logScroll.scroll_to_item(L.jump === "end" ? rows.length - 1 : L.jump, L.jump === "end" ? undefined : "top"); } catch {}
    L.jump = null;
  }

  const line = (l, i) => {
    const hit = test && test(l.text);
    return h_flex().w_full().h(ROW).px(8).gap(8).items_center()
      .when(i === L.at, (el) => el.bg(t.selected)).when(hit && i !== L.at, (el) => el.bg(t.raised))
      .when(L.time, (el) => el.child(div().w(88).flex_none().text_color(t.dim).child(model.clock(l.at))))
      .when(many, (el) => el.child(div().w(labelW - 12).flex_none().truncate().text_color(colorOf[l.src] ?? t.dim).child(l.src)))
      .child(div().flex_none().text_color(l.level === "error" ? t.ansi1 : l.level === "warn" ? t.ansi3 : t.foreground).child(l.text || " "));
  };
  const toggle = (id, label, on, tip, click) =>
    div().id(id).px(7).h(22).flex_none().rounded(5).text_size(11.5).cursor_pointer().border_1().border_color(on ? t.accent : t.border)
      .text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { click(); cx.notify(); })
      .child(h_flex().h_full().items_center().child(label));
  const stopped = Object.keys(L.ended);

  return v_flex().id("dockr-logs").track_focus(self.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
    .on_key_down((e, cx) => {
      const k = e.keystroke, tabs = ["logs", "inspect", "stats"];
      const line = (by) => { L.at = Math.max(0, Math.min(rows.length - 1, (L.at < 0 ? rows.length - 1 : L.at) + by)); L.follow = false; L.jump = L.at; };
      const tab = (by) => { L.tab = tabs[(tabs.indexOf(L.tab) + by + 3) % 3]; if (L.tab === "stats") sample(self, cx); if (L.tab === "logs" && L.follow) L.jump = "end"; };
      if (L.typing) {
        if (e.key !== "escape") return;
        self.handle.focus();
      }
      else if (e.key === "escape" || k === "q") close();
      else if (logsTab && (k === "ctrl-n" || k === "ctrl-p")) step(self, k === "ctrl-n" ? 1 : -1);
      else if (e.modifiers?.control || e.modifiers?.alt || e.modifiers?.platform) return;
      else if (info && (k === "h" || k === "l")) tab(k === "h" ? -1 : 1);
      else if (info && k === "s" && !up) act(self, "start");
      else if (info && k === "x" && up) act(self, "stop");
      else if (info && k === "r" && up) act(self, "restart");
      else if (info && k === "a") act(self, "diagnose");
      else if (info && k === "shift-t" && up) act(self, "terminal");
      else if (!logsTab) return;
      else if (k === "j" || e.key === "down") line(1);
      else if (k === "k" || e.key === "up") line(-1);
      else if (k === "g") { L.follow = false; L.at = 0; L.jump = 0; }
      else if (k === "shift-g" || e.key === "end") { L.follow = true; L.at = -1; L.jump = "end"; }
      else if (k === "/") self.logInput.focus();
      else if (k === "n" || e.key === "f3") step(self, 1);
      else if (k === "shift-n") step(self, -1);
      else if (k === "f") { L.follow = !L.follow; if (L.follow) L.jump = "end"; }
      else if (k === "t") L.time = !L.time;
      else if (k === "y") cx.write_to_clipboard(rows.map((l) => `${L.time ? `${model.clock(l.at)} ` : ""}${many ? `${l.src} | ` : ""}${l.text}`).join("\n"));
      else return;
      cx.stop_propagation();
      cx.notify();
    })
    .child(h_flex().w_full().h(38).flex_none().pl(12).pr(8).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(svg(icon("logs")).size(13).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(260).truncate().font_semibold().child(p.title))
      .when(!!info, (el) => el
        .child(h_flex().flex_none().gap(5).items_center().child(div().w(7).h(7).rounded(4).bg(up ? t.ansi2 : t.dim)).child(div().text_size(11).text_color(t.muted).child(up ? "Running" : "Stopped")))
        .child(h_flex().flex_none().gap(2).ml(6).children([["logs", "Logs"], ["inspect", "Inspect"], ["stats", "Stats"]].map(([id, label]) =>
          div().id(`tab-${id}`).px(10).h(24).rounded(5).text_size(12).cursor_pointer().text_color(L.tab === id ? t.foreground : t.muted)
            .when(L.tab === id, (x) => x.bg(t.selected)).hover((x) => x.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { L.tab = id; if (id === "stats") sample(self, cx); if (id === "logs" && L.follow) L.jump = "end"; cx.notify(); })
            .child(h_flex().h_full().items_center().child(label))))))
      .when(!info, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${rows.length}${L.lines.length >= CAP ? "+" : ""} lines${stopped.length ? ` · ${stopped.join(", ")} stopped` : ""}`)))
      .child(div().flex_1().min_w(0))
      .when(logsTab, (el) => el.child(div().w(220).flex_none().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(self.logInput).h(24).px(8).items_center().rounded(5).border(1).border_color(t.border).bg(t.background).text_color(t.foreground).text_size(11.5))))
      .when(logsTab && !!test, (el) => el
        .child(div().flex_none().text_size(11).text_color(hits ? t.muted : t.ansi1).child(hits ? `${hits} matches` : "no match"))
        .child(self.iconButton(t, "log-prev", "up", "Previous match (Shift+F3)", () => step(self, -1)))
        .child(self.iconButton(t, "log-next", "down", "Next match (Enter or F3)", () => step(self, 1))))
      .when(logsTab, (el) => el
        .child(toggle("log-time", "Time", L.time, "Show each line's time", () => { L.time = !L.time; }))
        .child(toggle("log-follow", "Follow", L.follow, "Stay at the newest line (End). Scrolling up turns it off.", () => { L.follow = !L.follow; if (L.follow) L.jump = "end"; }))
        .child(self.iconButton(t, "log-copy", "copy", "Copy the lines shown", (cx) => { cx.write_to_clipboard(rows.map((l) => `${L.time ? `${model.clock(l.at)} ` : ""}${many ? `${l.src} | ` : ""}${l.text}`).join("\n")); })))
      .when(logsTab && !!p.terminal, (el) => el.child(self.iconButton(t, "log-term", "output", "Open the raw tail in a terminal, with all of its history", () => { setShared("dockr.request", { n: Date.now(), kind: "tail", ...p.terminal }); close(); })))
      .when(!!info, (el) => el
        .child(div().w(1).h(18).flex_none().bg(t.border))
        .child(self.iconButton(t, "win-diagnose", "diagnose", "Investigate with an agent: shows what it will be told first (d)", () => act(self, "diagnose")))
        .when(up, (x) => x
          .child(self.iconButton(t, "win-term", "shell", "Open a terminal in the container", () => act(self, "terminal")))
          .child(self.iconButton(t, "win-restart", "restart", "Restart", () => act(self, "restart")))
          .child(self.iconButton(t, "win-stop", "stop", "Stop", () => act(self, "stop"))))
        .when(!up, (x) => x.child(self.iconButton(t, "win-start", "play", "Start", () => act(self, "start")))))
      .child(self.button(t, "log-close", "Close", () => close())))
    .when(many && logsTab, (el) => el.child(h_flex().w_full().flex_none().px(12).py(5).gap(5).flex_wrap().border_b(1).border_color(t.border)
      .children(p.sources.map((s, i) => {
        const on = !L.off[s.label];
        return h_flex().id(`log-src-${i}`).h(20).px(7).gap(5).flex_none().items_center().rounded(4).text_size(11).cursor_pointer()
          .border_1().border_color(t.border).text_color(on ? t.foreground : t.dim).hover((x) => x.bg(t.hover))
          .tooltip(on ? `Hide ${s.label}` : `Show ${s.label}`)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { if (on) L.off[s.label] = true; else delete L.off[s.label]; L.at = -1; cx.notify(); })
          .child(div().w(7).h(7).rounded(4).bg(on ? colorOf[s.label] : t.dim)).child(s.label);
      }))))
    .when(L.errors.length > 0, (el) => el.child(div().w_full().flex_none().px(12).py(4).text_size(11).text_color(t.ansi3).child(L.errors.join("  "))))
    .when(L.tab === "inspect", (el) => el.child(inspect(self, t)))
    .when(L.tab === "stats", (el) => el.child(div().id("stats-body").flex_1().min_h(0).overflow_y_scrollbar().child(stats(self, t))))
    .when(logsTab, (el) => el.child(div().id("log-body").flex_1().min_h(0).relative().font_family(mono).text_size(11.5)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_scroll_wheel((e, cx) => { if ((e.delta?.y ?? e.delta_y ?? 0) > 0 && L.follow) { L.follow = false; cx.notify(); } })
      .when(rows.length > 0, (el) => el
        .child(div().id("log-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(width).h_full()
            .child(v_virtual_list("log-rows", rows.length, ROW, (i) => String(i), (range) => rows.slice(range.start, range.end).map((l, k) => line(l, range.start + k)))
              .size_full().track_scroll(self.logScroll))))
        .child(Scrollbar.vertical("log-rows").viewport_from_layout().absolute().inset_0()))
      .when(!rows.length, (el) => el.child(div().p(12).text_color(t.dim).child(L.lines.length ? "Every service is hidden." : L.seen ? "This container has written nothing." : "Waiting for lines…")))))
    .child(div().w_full().flex_none().px(12).py(5).border_t(1).border_color(t.border).child(legend(t, L.typing
      ? [["enter", "next match"], ["esc", "back to the lines"]]
      : [...(info ? [["h/l", "tabs"], up ? ["x", "stop"] : ["s", "start"], ...(up ? [["r", "restart"], ["T", "terminal"]] : []), ["a", "investigate"]] : []),
        ...(logsTab ? [["j/k", "line"], ["g/G", "top/end"], ["/", "search"], ["n/N", "match"], ["f", "follow"], ["t", "time"], ["y", "copy"]] : []), ["q", "close"]])));
}
