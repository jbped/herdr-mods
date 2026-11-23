// Which tab a Response pane belongs to. Herdr gives a mod pane no pane id, and a pane opened in a
// new tab (tab.new) starts before focused(), panes() and spaces() list that tab: they still describe
// the tab shown before. So the panel reads the new tab from spaces() once Herdr lists it, and hands
// it to the pane by a claim in the pane's props. A pane split into a tab gets its tab in its props.
// Pure.

/** The ids of every tab in `spaces()`. */
export const tabIds = (spaces) => (spaces ?? []).flatMap((s) => (s.tabs ?? []).map((t) => t.id));

/** The one tab in `spaces` that is not in `before`, or null (none yet, or more than one). */
export function newTab(before, spaces) {
  const had = new Set(before);
  const added = tabIds(spaces).filter((id) => !had.has(id));
  return added.length === 1 ? added[0] : null;
}

/**
 * The pane's tab: its `tab` prop; else, for a pane the panel opened in a new tab (`claim` prop),
 * the tab the panel claimed for it (`claimed`) or the one it kept from an earlier start (`stored`),
 * else null until the claim arrives. Only a pane with neither prop (made outside Brunr) falls back
 * to the tab of its pane id (`paneTab`) or the focused tab.
 */
export function ownTab({ props, claimed = null, stored = null, paneTab = null, focusedTab = null }) {
  if (props?.tab) return props.tab;
  if (props?.claim) return claimed ?? stored ?? null;
  return paneTab ?? focusedTab ?? null;
}
