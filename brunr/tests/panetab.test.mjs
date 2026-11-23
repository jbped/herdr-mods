// Which tab a Response pane belongs to. A pane the panel opens in a new tab (tab.new) cannot see its
// own tab when it starts: Herdr gives it no pane id, and focused() and panes() still describe the
// tab that was shown before. The panel reads the new tab from Herdr and hands it to the pane.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as herdr from "./herdr-shim.mjs";
import * as store from "../mods/brunr/store.js";
import { cx, waitFor, draw } from "./panehelp.mjs";
import { newTab, ownTab, tabIds } from "../mods/brunr/panetab.js";

const space = (...tabs) => [{ id: "s1", tabs: tabs.map((id) => ({ id })) }];
const req = (name) => ({ key: `|/x#${name}.yml`, ck: "|/x", machine: null, root: "/x", path: `${name}.yml`, format: "yaml", name });

test("newTab: the one tab Herdr lists that was not there before; none or two give null", () => {
  assert.deepEqual(tabIds([{ tabs: [{ id: "a" }] }, { tabs: [{ id: "b" }, { id: "c" }] }]), ["a", "b", "c"]);
  assert.deepEqual(tabIds(null), []);
  assert.equal(newTab(["a", "b"], space("a", "b")), null, "Herdr does not list it yet");
  assert.equal(newTab(["a", "b"], space("a", "b", "c")), "c");
  assert.equal(newTab(["a", "b"], space("b", "c")), "c", "a tab closed meanwhile does not matter");
  assert.equal(newTab(["a"], space("a", "c", "d")), null, "two new tabs: not a guess");
});

test("ownTab: the tab prop, else the claimed tab, never the focused tab for a claimed pane", () => {
  assert.equal(ownTab({ props: { view: "response", tab: "tA" }, focusedTab: "tB" }), "tA", "a split pane");
  assert.equal(ownTab({ props: { view: "response", claim: "k" }, focusedTab: "tB" }), null, "waits for its claim");
  assert.equal(ownTab({ props: { view: "response", claim: "k" }, claimed: "tC", focusedTab: "tB" }), "tC");
  assert.equal(ownTab({ props: { view: "response", claim: "k" }, stored: "tC", focusedTab: "tB" }), "tC", "kept from an earlier start");
  assert.equal(ownTab({ props: { view: "response" }, paneTab: "tP", focusedTab: "tB" }), "tP");
  assert.equal(ownTab({ props: { view: "response" }, focusedTab: "tB" }), "tB", "a pane made outside Brunr");
  assert.equal(ownTab({ props: null }), null);
});

async function paneCopy(props) {
  herdr.state.props = props;
  const { default: Brunr } = await import("../mods/brunr/main.js");
  const self = new Brunr();
  self.init(undefined, cx);
  return self;
}

test("the panel's new tab: the Run goes to the tab tab.new made, not the tab that was focused", async () => {
  const { default: Brunr } = await import("../mods/brunr/main.js");
  herdr.state.focused = { space: "s1", tab: "tabB", pane: null, terminal: "t2" };
  herdr.state.panes = [{ pane: "pA", tab: "tabA", mod: "brunr", terminal: null }];
  herdr.state.spaces = space("tabA", "tabB");
  const ranBefore = herdr.ran.length;
  const got = Brunr.prototype.responseTab.call({}, cx);
  const made = herdr.ran.slice(ranBefore).find((r) => r.name === "tab.new");
  assert.ok(made, "a new tab is made");
  herdr.state.spaces = space("tabA", "tabB", "tabC");   // Herdr lists the new tab a moment later
  assert.equal(await got, "tabC");
  herdr.state.focused = null; herdr.state.panes = null; herdr.state.spaces = null;
});

test("a pane in a new tab shows the Request its own tab is given, and closing it leaves another tab's Request", async () => {
  store.showRequest("tabA", req("Alpha"));
  const a = await paneCopy({ view: "response", tab: "tabA" });
  await waitFor(() => a.reqText !== undefined, "pane A");
  // The panel opened a pane in a new tab while tabA was still focused.
  herdr.state.focused = { space: "s1", tab: "tabA", pane: null, terminal: "t2" };
  const { default: Brunr } = await import("../mods/brunr/main.js");
  herdr.state.spaces = space("tabA");
  const got = Brunr.prototype.responseTab.call({}, cx);
  const props = herdr.ran.filter((r) => r.name === "tab.new").pop().args.props;
  const c = await paneCopy(props);
  assert.notEqual(c.tab, "tabA", "the new pane does not take the focused tab");
  herdr.state.spaces = space("tabA", "tabC");
  assert.equal(await got, "tabC");
  await waitFor(() => c.tab === "tabC", "the new pane to learn its tab");
  assert.equal(c.addr, "pane:tabC");
  store.showRequest("tabC", req("Gamma"));
  await waitFor(() => c.req?.name === "Gamma", "pane C to show Gamma");
  draw(a); draw(c);
  assert.equal(store.shownRequest("tabA").name, "Alpha");
  assert.equal(a.req?.name ?? store.shownRequest(a.tab).name, "Alpha", "pane A is unchanged");
  await c.close();
  assert.equal(store.shownRequest("tabA")?.name, "Alpha", "closing the new pane leaves tabA's Request");
  assert.equal(store.shownRequest("tabC"), null);
  herdr.state.focused = null; herdr.state.spaces = null; herdr.state.props = null;
});
