// Gitr's rules: the rows of one Repo on one Machine, and what each action asks or does.
// Pure: no Herdr, no Node APIs, no clock. act never mutates its inputs.

const SORTS = ["recent", "az"];
const FILTERS = ["all", "worktree", "nowhere"];
// The only actions allowed while the Machine is not reachable.
const OFFLINE = new Set(["refresh", "sort", "filter", "remotes"]);
const NO_ROW = new Set(["create", "fetch", "refresh", "cleanup", "cleanupRun", "sort", "filter", "remotes"]);
const FETCH_TIMEOUT = 60000;

export const LABELS = {
  go: "go to space",
  open: "open",
  worktree: "worktree + space",
  checkout: "check out in main",
  newFrom: "new branch from here",
  create: "create branch",
  delete: "delete",
  rename: "rename",
  remove: "remove worktree",
  fetch: "fetch",
  refresh: "refresh",
  cleanup: "clean up",
  cleanupRun: "clean up",
  sort: "sort",
  filter: "filter",
  remotes: "remote branches",
};

// Keys the view binds. "repo" and "machine" are handled by the view, not by act.
export const KEYS = [
  { key: "enter", type: "enter", label: "open" },
  { key: "ctrl-o", type: "checkout", label: LABELS.checkout },
  { key: "ctrl-w", type: "worktree", label: LABELS.worktree },
  { key: "ctrl-n", type: "newFrom", label: LABELS.newFrom },
  { key: "ctrl-d", type: "delete", label: LABELS.delete },
  { key: "f2", type: "rename", label: LABELS.rename },
  { key: "ctrl-u", type: "remove", label: LABELS.remove },
  { key: "ctrl-f", type: "fetch", label: LABELS.fetch },
  { key: "ctrl-r", type: "refresh", label: LABELS.refresh },
  { key: "ctrl-k", type: "cleanup", label: LABELS.cleanup },
  { key: "ctrl-s", type: "sort", label: LABELS.sort },
  { key: "ctrl-t", type: "filter", label: LABELS.filter },
  { key: "ctrl-g", type: "remotes", label: LABELS.remotes },
  { key: "ctrl-p", type: "repo", label: "switch repo" },
  { key: "ctrl-e", type: "machine", label: "switch machine" },
];

export function mkey(machine) {
  return machine ?? "";
}

// Git's main ref name rules, plus no path component starting with ".".
export function validBranchName(name) {
  if (typeof name !== "string" || name === "") return false;
  if (/[\s\x00-\x1f\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  if (name.startsWith("-") || name.startsWith("/") || /(^|\/)\./.test(name)) return false;
  if (name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return false;
  return true;
}

// Paths

function norm(path) {
  let p = String(path ?? "").replace(/\\/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

// Drive-letter paths compare case-insensitively.
function pkey(path) {
  const p = norm(path);
  return /^[A-Za-z]:/.test(p) ? p.toLowerCase() : p;
}

function inside(path, dir) {
  const d = pkey(dir);
  return pkey(path).startsWith(d.endsWith("/") ? d : d + "/");
}

function within(path, dir) {
  return pkey(path) === pkey(dir) || inside(path, dir);
}

// Relative to the Main checkout when strictly inside it, else absolute.
function shown(path, main) {
  return inside(path, main) ? norm(path).slice(norm(main).length + 1) : norm(path);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Occupied

// Each space on this Machine occupies the deepest checkout that holds its directory.
function occupancy(world) {
  const out = new Map();
  const checkouts = world.git?.checkouts || [];
  for (const space of world.spaces || []) {
    if (mkey(space.machine) !== mkey(world.machine) || !space.dir) continue;
    let best = null;
    for (const c of checkouts)
      if (within(space.dir, c.path) && (!best || norm(c.path).length > norm(best.path).length)) best = c;
    if (!best) continue;
    const k = pkey(best.path);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(space);
  }
  return out;
}

function occupants(occ, path) {
  return occ.get(pkey(path)) || [];
}

// Rows

function baseRow(world, o) {
  return {
    depth: 0, path: null, dir: null, worktree: false,
    ahead: null, behind: null, changes: null, date: null,
    gone: false, prunable: false, dim: !world.reachable, status: null,
    busy: !!world.busy?.[o.id], enter: null, actions: [],
    ...o,
  };
}

function spaceRow(world, space) {
  return baseRow(world, {
    id: "s:" + space.id, kind: "space", depth: 1, name: space.name ?? space.id,
    dir: space.dir ? norm(space.dir) : null, status: space.status ?? null,
    enter: "go", actions: ["go"],
  });
}

function other(enter) {
  return enter === "worktree" ? "checkout" : "worktree";
}

function sourceEnter(world) {
  return world.source?.enter === "checkout" ? "checkout" : "worktree";
}

// Every row of the Repo, before search, filter, sort and fold.
function build(world) {
  const git = world.git;
  const occ = occupancy(world);
  const enter = sourceEnter(world);
  const main = git.checkouts.find((c) => c.main) || null;
  const refs = new Map(git.branches.map((b) => [b.name, b]));
  const spacesOf = (path) => occupants(occ, path).map((s) => spaceRow(world, s));

  let mainItem = null;
  if (main) {
    const ref = main.branch ? refs.get(main.branch) : null;
    mainItem = {
      row: baseRow(world, {
        id: "main", kind: "main", name: main.branch ?? "(detached)",
        path: norm(main.path), dir: norm(main.path),
        ahead: ref?.ahead ?? null, behind: ref?.behind ?? null, changes: main.changes,
        date: ref?.date ?? null, gone: !!ref?.gone,
        enter: "open", actions: ["open", "newFrom"],
      }),
      spaces: spacesOf(main.path),
    };
  }

  const branches = [];
  for (const b of git.branches) {
    if (main && b.name === main.branch) continue;
    const wt = git.checkouts.find((c) => !c.main && c.branch === b.name) || null;
    const row = baseRow(world, {
      id: "b:" + b.name, kind: "branch", name: b.name,
      path: wt ? shown(wt.path, git.main) : null, dir: wt ? norm(wt.path) : null,
      worktree: !!wt, ahead: b.ahead, behind: b.behind, changes: wt ? wt.changes : null,
      date: b.date, gone: !!b.gone, prunable: !!wt?.prunable,
      dim: !wt || !world.reachable,
    });
    if (wt?.prunable) row.actions = ["remove"];
    else if (wt) Object.assign(row, { enter: "open", actions: ["open", "newFrom", "remove"] });
    else Object.assign(row, { enter, actions: [enter, other(enter), "newFrom", "delete", "rename"] });
    branches.push({ row, spaces: wt ? spacesOf(wt.path) : [] });
  }

  const detached = git.checkouts
    .filter((c) => !c.main && !c.branch)
    .map((c) => ({
      row: baseRow(world, {
        id: "d:" + norm(c.path), kind: "detached", name: "(detached)",
        path: shown(c.path, git.main), dir: norm(c.path), worktree: true,
        changes: c.changes, prunable: !!c.prunable,
        enter: c.prunable ? null : "open", actions: c.prunable ? ["remove"] : ["open", "remove"],
      }),
      spaces: spacesOf(c.path),
    }));

  const remotes = git.remotes
    .filter((r) => !refs.has(r.branch))
    .map((r) => ({
      row: baseRow(world, {
        id: "r:" + r.name, kind: "remote", name: r.name, date: r.date, dim: true,
        enter, actions: [enter, other(enter), "newFrom"],
      }),
      spaces: [],
    }));

  return { mainItem, branches, detached, remotes };
}

function sortItems(items, sort) {
  const az = (a, b) => a.row.name.toLowerCase().localeCompare(b.row.name.toLowerCase()) || (a.row.name < b.row.name ? -1 : 1);
  return [...items].sort(sort === "az" ? az : (a, b) => (b.row.date ?? 0) - (a.row.date ?? 0) || az(a, b));
}

// A row that matches keeps all its spaces. A space that matches keeps its parent.
function search(item, q, fields) {
  if (!q) return item;
  if (fields.some((f) => f && f.toLowerCase().includes(q))) return item;
  const spaces = item.spaces.filter((s) => s.name.toLowerCase().includes(q));
  return spaces.length ? { ...item, spaces } : null;
}

function flatten(items) {
  return items.flatMap((i) => [i.row, ...i.spaces]);
}

function createName(world) {
  const name = String(world.query ?? "").trim();
  if (!validBranchName(name) || !world.reachable) return null;
  if (world.git.branches.some((b) => b.name === name)) return null;
  if (world.git.remotes.some((r) => r.branch === name)) return null;
  return name;
}

function createRow(world, name) {
  const enter = sourceEnter(world);
  return baseRow(world, {
    id: "create:" + name, kind: "create", name: `Create "${name}"`,
    enter, actions: [enter, other(enter)],
  });
}

export function arrange(world) {
  if (!world.git) return { sections: [], order: [], empty: "Nothing read yet" };
  const q = String(world.query ?? "").trim().toLowerCase();
  const { mainItem, branches, detached, remotes } = build(world);
  const sections = [];

  const mainItems = mainItem ? [search(mainItem, q, [mainItem.row.name, mainItem.row.path])].filter(Boolean) : [];
  sections.push({ id: "main", title: "Main checkout", count: mainItems.length, folded: false, rows: flatten(mainItems) });

  const filter = world.filter ?? "all";
  let bItems = branches.filter((i) => filter === "all" || (filter === "worktree") === i.row.worktree);
  let dItems = filter === "nowhere" ? [] : detached;
  bItems = sortItems(bItems.map((i) => search(i, q, [i.row.name, i.row.path])).filter(Boolean), world.sort);
  dItems = dItems.map((i) => search(i, q, [i.row.path])).filter(Boolean);
  const bRows = flatten([...bItems, ...dItems]);
  const create = createName(world);
  if (create) bRows.push(createRow(world, create));
  if (bRows.length)
    sections.push({ id: "branches", title: "Branches", count: bItems.length + dItems.length, folded: false, rows: bRows });

  const rItems = sortItems(remotes.map((i) => search(i, q, [i.row.name])).filter(Boolean), world.sort);
  if (rItems.length) {
    const folded = !world.remotesOpen && !q;
    sections.push({ id: "remotes", title: "Remote branches", count: rItems.length, folded, rows: folded ? [] : flatten(rItems) });
  }

  // An unreachable Machine shows its last known state with no actions.
  if (!world.reachable)
    for (const s of sections) s.rows = s.rows.map((r) => ({ ...r, enter: null, actions: [] }));
  const order = sections.flatMap((s) => s.rows.map((r) => r.id));
  const hidden = sections.some((s) => s.folded && s.count > 0);
  const empty = !order.length && !hidden ? (q ? `Nothing matches "${String(world.query).trim()}"` : "No branches") : null;
  return { sections, order, empty };
}

// Act

function toast(title, level = "warning") {
  return { effects: [{ type: "toast", level, title }] };
}

// The row as the view showed it, else the same row with no search, filter or fold.
function findRow(world, id) {
  const tries = [
    { ...world, filter: "all", remotesOpen: true },
    { ...world, filter: "all", remotesOpen: true, query: "" },
  ];
  for (const w of tries) {
    for (const s of arrange(w).sections) {
      const row = s.rows.find((r) => r.id === id);
      if (row) return row;
    }
  }
  return null;
}

function mainCheckout(world) {
  return world.git.checkouts.find((c) => c.main) || null;
}

function spaceName(world, id) {
  return world.spaces.find((s) => s.id === id)?.name ?? id;
}

function spaceLine(verb, s) {
  return `${verb} space "${s.name ?? s.id}"${s.status ? ` (${s.status})` : ""}`;
}

// Go to the first space in dir, else start one there.
function goTo(occ, dir) {
  const first = occupants(occ, dir)[0];
  return first ? { type: "space.select", id: first.id } : { type: "space.start", dir: norm(dir) };
}

function remoteOf(world, name) {
  return world.git.remotes.find((r) => r.name === name) || null;
}

// Effects that make the row's Branch a local Branch, and its name.
function localBranch(world, row) {
  if (row.kind === "remote") {
    const r = remoteOf(world, row.name);
    return { branch: r.branch, pre: [{ type: "git", args: ["branch", "--track", r.branch, r.name] }] };
  }
  return { branch: row.name, pre: [] };
}

function worktreeResult(branch, pre) {
  return { effects: [...pre, { type: "worktree", branch }, { type: "close" }] };
}

// Check out in the Main checkout. Asks first when it has tracked changes or is Occupied.
function checkoutResult(world, action, branch, pre) {
  const main = mainCheckout(world);
  const occ = occupancy(world);
  const spaces = occupants(occ, main.path);
  const tracked = main.tracked ?? 0;
  const needStash = tracked > 0 && !action.stash;
  const needOk = spaces.length > 0 && !action.confirmed;
  if (needStash || needOk) {
    const lines = [];
    if (tracked > 0) lines.push(`${plural(tracked, "uncommitted change")} will be stashed and reapplied`);
    for (const s of spaces) lines.push(`Space "${s.name ?? s.id}" is in the Main checkout (${s.status ?? "no status"})`);
    return {
      ask: {
        kind: "confirm",
        title: tracked > 0
          ? `The Main checkout has ${plural(tracked, "uncommitted change")}`
          : `Check out "${branch}" in the Main checkout?`,
        lines,
        yes: tracked > 0 ? "Stash, check out and reapply" : "Check out",
        danger: false,
        action: { ...action, ...(tracked > 0 ? { stash: true } : {}) },
      },
    };
  }
  return {
    effects: [
      ...pre,
      { type: "checkout", branch, stash: tracked > 0 && !!action.stash },
      goTo(occ, main.path),
      { type: "close" },
    ],
  };
}

// from, else the default branch, else main, else master, else none.
function startPoint(world, from) {
  if (from) return from;
  if (world.git.defaultBranch) return world.git.defaultBranch;
  for (const name of ["main", "master"]) if (world.git.branches.some((b) => b.name === name)) return name;
  return null;
}

function nameError(world, name) {
  if (!validBranchName(name)) return "Not a valid branch name";
  if (world.git.branches.some((b) => b.name === name)) return `Branch "${name}" already exists`;
  return null;
}

function newFromAsk(action, from, value = "", error) {
  const { name, ...rest } = action;
  return {
    ask: {
      kind: "input", title: from ? `New branch from ${from}` : "New branch",
      placeholder: "Branch name", value, action: rest, ...(error ? { error } : {}),
    },
  };
}

function createResult(world, action) {
  const name = String(action.name ?? "").trim();
  const error = nameError(world, name);
  if (error) return newFromAsk(action, action.from ?? null, String(action.name ?? ""), error);
  const start = startPoint(world, action.from ?? null);
  const pre = [];
  if (start && (remoteOf(world, start) || start === world.git.defaultBranch)) pre.push({ type: "fetch", ref: start });
  pre.push({ type: "git", args: start ? ["branch", "--no-track", name, start] : ["branch", "--no-track", name] });
  const mode = action.mode ?? sourceEnter(world);
  return mode === "checkout" ? checkoutResult(world, action, name, pre) : worktreeResult(name, pre);
}

function removeResult(world, action, row) {
  const occ = occupancy(world);
  const spaces = occupants(occ, row.dir);
  const changes = row.changes ?? 0;
  if (!action.confirmed) {
    const closing = new Set(spaces.map((s) => s.id));
    const lines = spaces.map((s) => spaceLine("Closes", s));
    for (const p of world.panes || []) {
      if (closing.has(p.space) || mkey(p.machine) !== mkey(world.machine) || !p.cwd || !within(p.cwd, row.dir)) continue;
      lines.push(`Pane "${p.title}" in space "${spaceName(world, p.space)}" is inside this Worktree and stays open`);
    }
    if (changes > 0) lines.push(`${plural(changes, "uncommitted change")} will be lost`);
    const ask = {
      kind: "confirm", title: `Remove Worktree ${row.path}?`, lines,
      yes: "Remove", danger: changes > 0, action: { ...action, type: "remove" },
    };
    if (row.kind === "branch") ask.checks = [{ id: "branch", label: `Also delete branch "${row.name}"`, checked: false }];
    return { ask };
  }
  const effects = spaces.map((s) => ({ type: "space.close", id: s.id }));
  effects.push({ type: "git", args: ["worktree", "remove", ...(changes > 0 ? ["--force"] : []), row.dir] });
  if (row.kind === "branch" && action.checks?.branch) effects.push({ type: "git", args: ["branch", "-D", row.name] });
  effects.push({ type: "refresh" });
  return { effects };
}

function deleteResult(action, row) {
  if (action.force && !action.confirmed) {
    const said = String(action.said ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      ask: {
        kind: "confirm", title: `Branch "${row.name}" is not merged`,
        lines: [...said, "Its unmerged commits will be lost"],
        yes: "Delete anyway", danger: true, action: { ...action, type: "delete" },
      },
    };
  }
  if (action.force)
    return { effects: [{ type: "git", args: ["branch", "-D", row.name] }, { type: "refresh" }] };
  return {
    effects: [
      { type: "git", args: ["branch", "-d", row.name], refuse: { type: "delete", row: row.id, force: true } },
      { type: "refresh" },
    ],
  };
}

function renameResult(world, action, row) {
  const ask = (value, error) => ({
    ask: {
      kind: "input", title: `Rename ${row.name}`, placeholder: "Branch name", value,
      action: { type: "rename", row: row.id }, ...(error ? { error } : {}),
    },
  });
  if (action.name === undefined) return ask(row.name);
  const name = String(action.name).trim();
  const error = nameError(world, name);
  if (error) return ask(String(action.name), error);
  return { effects: [{ type: "git", args: ["branch", "-m", row.name, name] }, { type: "refresh" }] };
}

function cleanupItems(world) {
  const occ = occupancy(world);
  const main = mainCheckout(world);
  const items = [];
  for (const b of world.git.branches) {
    if (!b.gone || b.name === main?.branch) continue;
    const wt = world.git.checkouts.find((c) => !c.main && c.branch === b.name);
    let detail = "Upstream is gone";
    let checked = true;
    if (wt) {
      const spaces = occupants(occ, wt.path);
      const notes = [`Removes Worktree ${shown(wt.path, world.git.main)} too`];
      if (spaces.length) notes.push(`${plural(spaces.length, "space")} in it`);
      if ((wt.changes ?? 0) > 0) notes.push(plural(wt.changes, "uncommitted change"));
      detail = notes.join(", ");
      checked = !spaces.length && !((wt.changes ?? 0) > 0);
    }
    items.push({ id: "b:" + b.name, label: b.name, detail, checked });
  }
  for (const c of world.git.checkouts)
    if (!c.main && c.prunable)
      items.push({ id: "p:" + norm(c.path), label: shown(c.path, world.git.main), detail: "Directory is missing", checked: true });
  return items;
}

function cleanupRunResult(world, action) {
  const occ = occupancy(world);
  const ticked = new Set(action.items || []);
  const effects = [];
  let prune = false;
  for (const id of ticked) {
    if (id.startsWith("p:")) {
      prune ||= world.git.checkouts.some((c) => !c.main && c.prunable && pkey(c.path) === pkey(id.slice(2)));
      continue;
    }
    if (!id.startsWith("b:")) continue;
    const name = id.slice(2);
    if (!world.git.branches.some((b) => b.name === name)) continue;
    const wt = world.git.checkouts.find((c) => !c.main && c.branch === name);
    if (wt) {
      for (const s of occupants(occ, wt.path)) effects.push({ type: "space.close", id: s.id });
      effects.push({ type: "git", args: ["worktree", "remove", "--force", norm(wt.path)] });
    }
    effects.push({ type: "git", args: ["branch", "-D", name] });
  }
  if (prune) effects.push({ type: "git", args: ["worktree", "prune"] });
  if (!effects.length) return toast("Nothing ticked", "info");
  effects.push({ type: "refresh" });
  return { effects };
}

function cycle(list, value) {
  return list[(list.indexOf(value) + 1) % list.length];
}

function noRow(world, action) {
  switch (action.type) {
    case "refresh": return { effects: [{ type: "refresh" }] };
    case "sort": return { effects: [{ type: "set", key: "sort", value: cycle(SORTS, world.sort) }] };
    case "filter": return { effects: [{ type: "set", key: "filter", value: cycle(FILTERS, world.filter) }] };
    case "remotes": return { effects: [{ type: "set", key: "remotesOpen", value: !world.remotesOpen }] };
  }
  if (!world.git) return toast("Nothing read yet");
  switch (action.type) {
    case "fetch":
      return { effects: [{ type: "git", args: ["fetch", "--all", "--prune"], timeout: FETCH_TIMEOUT }, { type: "refresh" }] };
    case "create": return createResult(world, action);
    case "cleanup": {
      const items = cleanupItems(world);
      if (!items.length) return toast("Nothing to clean up", "info");
      return { ask: { kind: "checklist", title: "Clean up", items, yes: "Clean up", action: { type: "cleanupRun" } } };
    }
    case "cleanupRun": return cleanupRunResult(world, action);
  }
}

export function act(world, action) {
  if (!world.reachable && !OFFLINE.has(action.type)) return toast("The Machine is not reachable");
  if (NO_ROW.has(action.type)) return noRow(world, action);
  const row = world.git ? findRow(world, action.row) : null;
  if (!row) return toast("That row is gone");
  if (row.busy) return toast("Still working");
  const type = action.type === "enter" ? row.enter : action.type;
  if (!type || !row.actions.includes(type))
    return toast(`${LABELS[action.type] ? `"${LABELS[action.type]}"` : "That"} is not available here`);
  action = { ...action, type };

  switch (type) {
    case "go": return { effects: [{ type: "space.select", id: row.id.slice(2) }, { type: "close" }] };
    case "open": return { effects: [goTo(occupancy(world), row.dir), { type: "close" }] };
    case "worktree":
    case "checkout": {
      if (row.kind === "create")
        return createResult(world, { type: "create", name: row.id.slice("create:".length), from: null, mode: type, ...pick(action) });
      const { branch, pre } = localBranch(world, row);
      return type === "worktree" ? worktreeResult(branch, pre) : checkoutResult(world, action, branch, pre);
    }
    case "newFrom": {
      const from = row.kind === "main" ? (mainCheckout(world).branch ?? mainCheckout(world).head) : row.name;
      return newFromAsk({ type: "create", from, mode: null }, from);
    }
    case "delete": return deleteResult(action, row);
    case "rename": return renameResult(world, action, row);
    case "remove": return removeResult(world, action, row);
  }
  return toast("That is not available here");
}

// Confirmation fields carried from a create row's checkout ask.
function pick(action) {
  const out = {};
  if (action.confirmed) out.confirmed = true;
  if (action.stash) out.stash = true;
  return out;
}
