// Brunr as a pane in the current tab, beside the terminals: the third way it opens, after the
// dialog and the tab (kit/open-as.js). The key (mod.open:brunr) splits the focused pane the first
// time, then moves the keyboard to Brunr's pane, and from it back to the pane you came from. The
// close key closes the pane. Only pane ids and a yes or no are kept in shared state.
import { shared, setShared, focused, panes, run } from "herdr";

/** The settings row's id. */
export const OPEN_AS_PANE = "open-as-pane";

/** @param {string} mod */
const choiceKey = (mod) => `${mod}.open-as-pane`;
/** The pane to go back to. @param {string} mod */
const backKey = (mod) => `${mod}.pane-back`;

/** True when this person chose to open the mod as a pane. @param {string} mod */
export const opensAsPane = (mod) => shared(choiceKey(mod)) === true;

/** Saves the choice. @param {string} mod @param {boolean} on */
export function setOpensAsPane(mod, on) { setShared(choiceKey(mod), Boolean(on)); }

/** The settings panel's row for the choice. @param {string} mod */
export function paneOption(mod) {
  return { id: OPEN_AS_PANE, label: "Open as a pane in the current tab", on: opensAsPane(mod) };
}

/** True while the mod's dialog is open (kit/open-as.js keeps its overlay id here). @param {string} mod */
export const dialogOpen = (mod) => typeof shared(`${mod}.dialog`) === "string";

/**
 * Which of the mod's panes the key acts on: the one in the focused tab, or null.
 * @param {{ pane: string, mod?: string, tab: string, focused: boolean }[]} all @param {string} mod @param {string | null | undefined} tab
 */
export function paneIn(all, mod, tab) {
  return tab ? all.find((p) => p.mod === mod && p.tab === tab) ?? null : null;
}

/**
 * What the key does, from the panes and the focus: "split" (no pane of the mod in this tab),
 * "focus" (go to it) or "back" (it has the keyboard: go back to `to`, or stay when that pane is gone).
 * @param {{ pane: string, mod?: string, tab: string, focused: boolean }[]} all @param {string} mod
 * @param {{ tab: string, pane: string | null } | null} here @param {unknown} back
 * @returns {{ do: "split" } | { do: "focus", pane: string } | { do: "back", to: string | null }}
 */
export function keyAction(all, mod, here, back) {
  const own = paneIn(all, mod, here?.tab);
  if (!own) return { do: "split" };
  if (!own.focused) return { do: "focus", pane: own.pane };
  return { do: "back", to: typeof back === "string" && back !== own.pane && all.some((p) => p.pane === back) ? back : null };
}

/** The key: opens the pane, goes to it, or goes back from it. @param {string} mod */
export function togglePane(mod) {
  const here = focused();
  const a = keyAction(panes(), mod, here, shared(backKey(mod)));
  if (a.do === "back") { if (a.to) run("pane.focus", { pane: a.to }); return; }
  if (here?.pane) setShared(backKey(mod), here.pane);
  // Herdr focuses the pane. The mod's own command then gives its copy the keyboard.
  if (a.do === "focus") { run("pane.focus", { pane: a.pane }); run(`${mod}.focus`); }
  else run("pane.split", { direction: "right", mod, props: { pane: true } });
}

/** Closes the mod's pane in the focused tab and gives the keyboard back. @param {string} mod */
export function closePane(mod) {
  const all = panes();
  const own = paneIn(all, mod, focused()?.tab);
  if (!own) return;
  const back = shared(backKey(mod));
  run("pane.close", { pane: own.pane });
  if (typeof back === "string" && back !== own.pane && all.some((p) => p.pane === back)) run("pane.focus", { pane: back });
}
