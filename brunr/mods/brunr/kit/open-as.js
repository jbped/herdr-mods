// A mod that opens as a full-screen dialog or as its own tab, as each person chooses in its
// settings. The choice and the mod's settings live in Herdr's shared state, not localStorage:
// every dialog is a new copy of the mod with its own localStorage, and so is every tab.
//
// The mod's key (mod.open:<mod>) opens a tiny overlay copy that only does this and closes:
//   init:  if (isLauncher()) { launch(MOD, { name: "My Mod", tab: { tab: true }, dialog: { ... } }, cx); return; }
// Dialog: the key opens it, and again closes it.
// Tab: the key goes to the mod's tab (making it the first time), and again goes back to the tab
// you came from. closeTab (ctrl-x in the mod) closes it.
//
// The settings panel's row:
//   new Shortcuts({ ..., storage: sharedStorage(MOD), options: [openAsOption(MOD)], onChange: (id, on) => onOpenAsChange(MOD, id, on, HOW) })
// Switching the row moves the mod at once: a dialog closes and the tab opens, or the other way.
//
// HOW, the same object launch takes: { name: "My Mod", tab: { tab: true }, dialog: () => toggleDialog(MOD, { ... }) }
import { shared, setShared, focused, spaces, panes, run, props, openOverlay, closeOverlay } from "herdr";

/** The settings row's id. */
export const OPEN_AS = "open-as-tab";

/** @param {string} mod */
const openAsKey = (mod) => `${mod}.open-as`;
/** The tab to go back to: `{ space, tab }`. @param {string} mod */
const backKey = (mod) => `${mod}.back`;
/** The open dialog's overlay id. @param {string} mod */
const dialogKey = (mod) => `${mod}.dialog`;

/**
 * localStorage's getItem and setItem, kept in Herdr's shared state under `<mod>.saved.<key>`,
 * so every copy of the mod (dialogs, tabs) reads and writes the same values.
 * @param {string} mod
 */
export function sharedStorage(mod) {
  return {
    /** @param {string} key */
    getItem: (key) => {
      const v = shared(`${mod}.saved.${key}`);
      return typeof v === "string" ? v : null;
    },
    /** @param {string} key @param {string} value */
    setItem: (key, value) => { setShared(`${mod}.saved.${key}`, String(value)); },
    /** @param {string} key */
    removeItem: (key) => { setShared(`${mod}.saved.${key}`, null); },
  };
}

/** True when this person chose to open the mod as a tab. The default is the dialog. @param {string} mod */
export function opensAsTab(mod) {
  return shared(openAsKey(mod)) === "tab";
}

/** The settings panel's row for the choice. Pass to Shortcuts' `options`. @param {string} mod */
export function openAsOption(mod) {
  return { id: OPEN_AS, label: "Open as a tab (off: a full-screen dialog)", on: opensAsTab(mod) };
}

/**
 * How the mod opens: the tab's name and props, and `dialog`, which opens the dialog.
 * @typedef {{ name: string, tab: Record<string, unknown>, dialog: () => unknown }} How
 */

/**
 * Saves the choice when its row is switched, and moves this copy at once: from a dialog to the
 * tab, or from the tab to a dialog. Call from Shortcuts' `onChange`.
 * @param {string} mod @param {string} id @param {boolean} on @param {How} how
 */
export function onOpenAsChange(mod, id, on, how) {
  if (id !== OPEN_AS) return;
  setShared(openAsKey(mod), on ? "tab" : "dialog");
  const overlay = props()?.overlay;
  if (on && overlay !== undefined) {
    // The tab opens first: closing the dialog ends this copy.
    toggleTab(mod, how.name, how.tab);
    if (shared(dialogKey(mod)) === overlay) setShared(dialogKey(mod), null);
    closeOverlay(overlay);
  } else if (!on && overlay === undefined && modTab(mod)?.tab === focused()?.tab) {
    // The dialog opens first: closing the tab ends this copy.
    Promise.resolve(how.dialog()).finally(() => closeTab(mod));
  }
}

/** True for the copy the key opens, which only launches the mod and closes. */
export function isLauncher() {
  const p = props() ?? {};
  return p.overlay !== undefined && !p.dialog;
}

/** The tab showing the mod, when there is one: `{ space, tab }`. @param {string} mod */
function modTab(mod) {
  const pane = panes().find((p) => p.mod === mod);
  if (!pane) return null;
  const space = spaces().find((s) => s.tabs.some((t) => t.id === pane.tab));
  return space ? { space: space.id, tab: pane.tab } : null;
}

/** True when that tab is still open. @param {any} spot */
function stillOpen(spot) {
  return Boolean(spot && typeof spot.tab === "string" && spaces().some((s) => s.tabs.some((t) => t.id === spot.tab)));
}

/** Shows a tab, in its space. @param {{ space: string, tab: string }} spot */
function show(spot) {
  if (focused()?.space !== spot.space) run("space.select", { id: spot.space });
  run("tab.select", { id: spot.tab });
}

/**
 * Goes to the mod's tab, making it the first time, or from it back to the tab you came from.
 * @param {string} mod @param {string} name the new tab's name @param {Record<string, unknown>} tabProps
 */
export function toggleTab(mod, name, tabProps) {
  const here = focused();
  const own = modTab(mod);
  if (own && here?.tab === own.tab) {
    const back = shared(backKey(mod));
    if (stillOpen(back) && back.tab !== own.tab) show(back);
    return;
  }
  if (here) setShared(backKey(mod), { space: here.space, tab: here.tab });
  if (own) show(own);
  else run("tab.new", { name, mod, props: tabProps });
}

/** Closes the mod's tab and goes back to the tab you came from. @param {string} mod */
export function closeTab(mod) {
  const own = modTab(mod);
  if (!own) return;
  const back = shared(backKey(mod));
  if (stillOpen(back) && back.tab !== own.tab) show(back);
  run("tab.close", { id: own.tab, confirmed: true });
}

/**
 * Opens the dialog, or closes it when it is open. The dialog's copy calls dialogClosed as it
 * closes, so a dialog closed by esc or its own button is not taken for open.
 * @param {string} mod @param {import("herdr").OverlaySpec} spec
 */
export function toggleDialog(mod, spec) {
  const open = shared(dialogKey(mod));
  if (typeof open === "string") {
    setShared(dialogKey(mod), null);
    closeOverlay(open);
    return;
  }
  setShared(dialogKey(mod), openOverlay(spec));
}

/** Call from the dialog copy's close(): the dialog is gone. @param {string} mod */
export function dialogClosed(mod) {
  if (shared(dialogKey(mod)) === props()?.overlay) setShared(dialogKey(mod), null);
}

/**
 * What the launcher copy does: the tab or the dialog, as the person chose. Then it closes.
 * @param {string} mod
 * @param {How} how
 * @param {import("gpui-kit").Context} cx
 */
export function launch(mod, how, cx) {
  const overlay = props()?.overlay;
  cx.spawn(async () => {
    try {
      // An open dialog closes first, even when the setting changed to a tab while it was open.
      const open = shared(dialogKey(mod));
      if (typeof open === "string") { setShared(dialogKey(mod), null); closeOverlay(open); }
      else if (opensAsTab(mod)) toggleTab(mod, how.name, how.tab);
      else await how.dialog();
    } catch {
      // Nothing to show: the launcher closes either way.
    } finally {
      closeOverlay(overlay);
    }
  });
}
