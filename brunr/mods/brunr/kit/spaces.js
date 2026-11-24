// Small pieces for lists of Herdr's own things: spaces, tabs, agents, processes.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

/** @typedef {import("herdr").SpaceInfo} SpaceInfo */
/** @typedef {import("./theme.js").Theme} Theme */
/** @typedef {import("./theme.js").Color} Color */

const SPIN = "mods/workspace-chrome/spinner.svg";

/**
 * The colored mark that shows a row's status.
 * @param {Theme} t
 * @param {string | null} status working | blocked | done | idle | running | exited | null
 */
export function statusDot(t, status) {
  const slot = () => h_flex().w(12).flex_none();
  if (status === "working") return slot().child(svg(SPIN).size(12).flex_none().text_color(t.working).spin(900));
  // Running green, dead red. Agent statuses use whatever the theme says.
  /** @type {Record<string, Color>} */
  const tone = { blocked: t.blocked, done: t.done, idle: t.idle, running: t.ansi2, exited: t.ansi1 };
  const color = tone[status ?? ""] ?? t.dim;
  const ch = status === "idle" ? "○" : status ? "●" : "·";
  return slot().text_color(color).child(ch);
}

/**
 * Tells spaces with the same name apart: the folder, plus the branch when the folders match too.
 * Empty when the name is unique.
 * @param {SpaceInfo[]} all
 * @param {SpaceInfo} s
 * @param {string} home the home folder, shown as "~"
 */
export function spaceNote(all, s, home) {
  const same = all.filter((o) => o.id !== s.id && o.name === s.name);
  if (!same.length) return "";
  const folder = s.folder.replace(home, "~");
  return same.some((o) => o.folder === s.folder) && s.branch ? `${folder} · ${s.branch}` : folder;
}

// The avatar colors the built-in sidebar uses, so a space looks the same everywhere.
/** @type {Record<string, Color>} */
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

/**
 * A space's own color.
 * @param {Theme} t
 * @param {SpaceInfo} s
 * @param {Record<string, string> | undefined} chosen shared("space.colors"): the color each space was given, by id
 * @returns {Color}
 */
export function spaceColor(t, s, chosen) {
  if (s.name === "~") return t.dim;
  const c = chosen?.[s.id] ?? "ansi6";
  return c.startsWith("#") ? /** @type {Color} */ (c) : (MARK[c] ?? t[c]);
}

/** A space's colored square with its first letter. @param {SpaceInfo} s @param {Color} color */
export function avatar(s, color) {
  return h_flex().size(18).flex_none().rounded(5).bg(color).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...s.name][0]?.toUpperCase() ?? "?");
}

/** A space's name, as a list row shows it. @param {Theme} t @param {SpaceInfo} s */
export function spaceName(t, s) {
  return div().flex_none().max_w(200).truncate().text_size(14).font_semibold().text_color(t.foreground).child(s.name);
}
