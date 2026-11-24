// Dockr's decisions, with no Herdr or Docker calls: what the config means, which Source a
// container runs from, what a Switch changes, when it rebuilds, and which toasts an event earns.

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const DEFAULT_MANIFESTS = ["package.json", "package-lock.json"];

/** One comparable form of a path: forward slashes, no trailing slash, a Windows drive as /mnt/<d>. */
export function norm(p) {
  let s = String(p ?? "").trim().replace(/\\/g, "/");
  const m = /^\/run\/desktop\/mnt\/host\/([a-z])(\/.*)?$/i.exec(s) || /^([A-Za-z]):(\/.*)?$/.exec(s) || /^\/mnt\/([a-z])(\/.*)?$/i.exec(s);
  // Windows drives ignore case, so everything under one compares in lower case.
  if (m) s = `/mnt/${m[1].toLowerCase()}${(m[2] ?? "").toLowerCase()}`;
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

export const dirname = (p) => String(p).replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "") || "/";
const inside = (path, dir) => path === dir || path.startsWith(dir + "/");

/** { stacks, problems } from dockr.json's text. A null text is no config. Bad entries are dropped and named. */
export function parseConfig(text) {
  const problems = [], stacks = [];
  if (text == null || !String(text).trim()) return { stacks, problems };
  let json;
  try { json = JSON.parse(text); } catch (e) { return { stacks, problems: [`dockr.json is not valid JSON: ${e.message}`] }; }
  if (!Array.isArray(json?.stacks)) return { stacks, problems: ['dockr.json needs { "stacks": [...] }'] };
  const seen = new Set();
  json.stacks.forEach((s, i) => {
    const at = `stacks[${i}]`;
    if (!s || typeof s.name !== "string" || !s.name) return problems.push(`${at} needs a name (the compose project name)`);
    if (seen.has(s.name)) return problems.push(`${at}: "${s.name}" is listed twice`);
    if (typeof s.compose !== "string" || !s.compose) return problems.push(`${s.name}: needs "compose", the compose file's path`);
    if (!/^(\/|[A-Za-z]:[\\/])/.test(s.compose)) return problems.push(`${s.name}: "compose" must be an absolute path`);
    seen.add(s.name);
    const services = {};
    for (const [name, v] of Object.entries(s.services && typeof s.services === "object" ? s.services : {})) {
      if (!v || typeof v.var !== "string" || !VAR_RE.test(v.var)) { problems.push(`${s.name}.${name}: "var" must be a variable name`); continue; }
      const manifests = Array.isArray(v.manifests) && v.manifests.every((m) => typeof m === "string" && m && !m.startsWith("/") && !m.includes("..")) ? v.manifests : null;
      if (v.manifests != null && !manifests) problems.push(`${s.name}.${name}: "manifests" must be relative paths`);
      services[name] = { var: v.var, repo: typeof v.repo === "string" ? v.repo : null, main: typeof v.main === "string" && v.main ? v.main : null, manifests: manifests ?? DEFAULT_MANIFESTS };
    }
    const urls = [];
    for (const [url, v] of Object.entries(s.urls && typeof s.urls === "object" ? s.urls : {})) {
      // A label, or { label, service } to say which Service serves it.
      const o = v && typeof v === "object" ? v : { label: v };
      if (/^https?:\/\/[^\s"'<>]+$/.test(url)) urls.push({ url, label: String(o.label || url), service: typeof o.service === "string" && o.service ? o.service : null });
      else problems.push(`${s.name}: "${url}" is not an http or https URL`);
    }
    stacks.push({ name: s.name, machine: s.machine ? String(s.machine) : null, compose: s.compose, dir: dirname(s.compose), services, urls });
  });
  return { stacks, problems };
}

/** Where Wranglr's config says a Repo's Main checkout is on a Machine, or null. */
export function wranglrMain(wranglr, repo, machine) {
  if (!wranglr || !repo) return null;
  const mk = machine ?? "";
  for (const w of Array.isArray(wranglr.workspaces) ? wranglr.workspaces : []) {
    const p = w?.on?.[mk]?.paths?.[repo];
    if (typeof p === "string" && p) return p;
  }
  const p = wranglr.repos?.[repo]?.on?.[mk]?.path;
  return typeof p === "string" && p ? p : null;
}

/** The stacks with each Service's Main checkout filled in: its own `main`, else Wranglr's. */
export function withMains(stacks, wranglr) {
  const problems = [];
  const out = stacks.map((s) => {
    const services = {};
    for (const [name, v] of Object.entries(s.services)) {
      const main = v.main ?? wranglrMain(wranglr, v.repo, s.machine);
      if (!main) problems.push(`${s.name}.${name}: no Main checkout. Set "main", or list the Repo in wranglr.json.`);
      services[name] = { ...v, main };
    }
    return { ...s, services };
  });
  return { stacks: out, problems };
}

/** The checkouts in `git worktree list --porcelain`: the Main checkout first, then its worktrees. */
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? "").split(/\r?\n\r?\n/)) {
    let path = null, branch = null, head = null, skip = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice(9);
      else if (line.startsWith("HEAD ")) head = line.slice(5);
      else if (line.startsWith("branch ")) branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "bare" || line.startsWith("prunable")) skip = true;
    }
    if (path && !skip) out.push({ path, branch, head, main: out.length === 0 });
  }
  return out;
}

/** What a checkout is called in the panel: its branch, else a short commit. */
export const sourceName = (s) => (s ? s.branch ?? (s.head ? s.head.slice(0, 8) : "detached") : "unknown");

/** The variables an env file sets, as { NAME: value }. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** The env file's text after `changes` ({ NAME: value | null }, null removes). Other lines are kept. */
export function setEnv(text, changes) {
  const left = { ...changes };
  const lines = String(text ?? "").split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === ""));
  const out = [];
  for (const line of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !(m[1] in left)) { out.push(line); continue; }
    if (left[m[1]] != null) out.push(`${m[1]}=${left[m[1]]}`);
    delete left[m[1]];
  }
  for (const [k, v] of Object.entries(left)) if (v != null) out.push(`${k}=${v}`);
  return out.length ? out.join("\n") + "\n" : "";
}

/** The real bind sources Docker Desktop names in `docker ps --format '{{json .}}'` lines, as { id: paths }. */
export function desktopBinds(psText) {
  const out = {};
  for (const line of String(psText ?? "").split(/\r?\n/)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row?.ID || typeof row.Labels !== "string") continue;
    // Labels are one comma-joined string, so a value ends where the next "key=" starts.
    const paths = [...row.Labels.matchAll(/desktop\.docker\.io\/binds\/\d+\/Source=(.*?)(?=,[A-Za-z0-9_.\/-]+=|$)/g)].map((m) => m[1]);
    if (paths.length) out[row.ID] = paths;
  }
  return out;
}

/** Text without terminal colour and cursor codes. */
export const clean = (text) => String(text ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, "");

/**
 * Containers from `docker inspect` output (one JSON object per line, or one array), with only what Dockr shows.
 * Environment entries are kept as names only, whatever the input holds.
 * `binds`: desktopBinds() of the same containers. Docker Desktop hides a WSL bind behind an opaque
 * mount path and names the real one in a label that only `docker ps` prints.
 */
export function parseContainers(json, binds = {}) {
  let list = json;
  if (typeof json === "string") {
    try { list = JSON.parse(json); } catch {
      list = json.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && typeof x === "object");
    }
  }
  if (list && !Array.isArray(list) && typeof list === "object" && list.Id) list = [list];
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const checks = c.State?.Health?.Log ?? [];
    let bind = 0;
    const labels = c.Config?.Labels ?? {};
    const named = binds[c.Id] ?? [];
    const sources = named.length ? named : (c.Mounts ?? []).filter((m) => m.Type === "bind").map((m) => m.Source);
    const ports = [];
    for (const [key, hosts] of Object.entries(c.HostConfig?.PortBindings ?? {})) {
      for (const h of hosts ?? []) if (h?.HostPort) ports.push({ host: Number(h.HostPort), container: key });
    }
    ports.sort((a, b) => a.host - b.host);
    return {
      id: c.Id, name: String(c.Name ?? "").replace(/^\//, ""), image: c.Config?.Image ?? "", imageId: c.Image ?? "",
      state: c.State?.Status ?? "unknown", exitCode: c.State?.ExitCode ?? 0, health: c.State?.Health?.Status ?? null,
      created: c.Created ?? "", project: labels["com.docker.compose.project"] ?? null, service: labels["com.docker.compose.service"] ?? null,
      binds: sources, ports, command: [c.Path, ...(c.Args ?? [])].filter(Boolean).join(" "),
      restarts: c.RestartCount ?? 0, oom: !!c.State?.OOMKilled, error: c.State?.Error || "",
      startedAt: c.State?.StartedAt ?? "", finishedAt: c.State?.FinishedAt ?? "",
      healthOutput: checks.length ? clean(checks[checks.length - 1]?.Output).trim() : "",
      mounts: (c.Mounts ?? []).map((m) => ({ type: m.Type ?? "", source: m.Type === "bind" ? named[bind++] ?? m.Source ?? "" : m.Name ?? m.Source ?? "", target: m.Destination ?? "", rw: m.RW !== false })),
      networks: Object.entries(c.Networks ?? c.NetworkSettings?.Networks ?? {}).map(([name, n]) => ({ name, ip: n?.IPAddress ?? "" })),
      labels: Object.fromEntries(Object.entries(labels).filter(([k]) => !k.startsWith("desktop.docker.io/"))),
      env: (c.Config?.Env ?? []).map((e) => String(e).split("=")[0]).sort(),
    };
  });
}

/** The checkout among `sources` that one of the container's bind mounts is in, or null. */
export function sourceOf(container, sources) {
  let best = null, len = -1;
  for (const s of sources ?? []) {
    const dir = norm(s.path);
    if (dir.length > len && (container?.binds ?? []).some((b) => inside(norm(b), dir))) { best = s; len = dir.length; }
  }
  return best;
}

/** The checkout a Stack is set to for one Service: the env file's path, else the Main checkout. */
export function setSource(service, env, sources) {
  const path = env?.[service.var];
  if (!path) return (sources ?? []).find((s) => s.main) ?? (service.main ? { path: service.main, branch: null, head: null, main: true } : null);
  return (sources ?? []).find((s) => norm(s.path) === norm(path)) ?? { path, branch: null, head: null, main: false, missing: true };
}

const up = (c) => !!c && c.state === "running" && (c.health == null || c.health === "healthy");

/**
 * The panel's groups: one per Stack, then the containers in no Stack.
 * `env`: { stack: vars }, `sources`: { "stack/service": checkouts }, `built`: { "stack/service": { imageId, path } }
 * for Services with no bind mount, whose Source only Dockr's own builds can tell.
 * `recorded`: { stack: false } for a Stack with no .dockr.env yet. There, what runs is taken as what
 * the Stack is set to, so a first look never shows Drift.
 */
export function view(stacks, containers, env = {}, sources = {}, built = {}, recorded = {}) {
  const groups = stacks.map((stack) => {
    const mine = containers.filter((c) => c.project === stack.name);
    const names = [...new Set([...mine.map((c) => c.service ?? c.name), ...Object.keys(stack.services)])];
    const rows = names.map((name) => {
      const container = mine.find((c) => (c.service ?? c.name) === name) ?? null;
      const service = stack.services[name] ?? null;
      const row = { key: `${stack.name}/${name}`, stack: stack.name, name, container, service, sources: [], actual: null, set: null, drift: false, mounted: false };
      if (!service) return row;
      row.sources = sources[row.key] ?? [];
      row.set = setSource(service, env[stack.name], row.sources);
      row.mounted = !!container && container.binds.length > 0 && !!sourceOf(container, row.sources);
      if (container) {
        row.actual = sourceOf(container, row.sources);
        const b = built[row.key];
        if (!row.actual && b && b.imageId === container.imageId) row.actual = row.sources.find((s) => norm(s.path) === norm(b.path)) ?? null;
      }
      if (recorded[stack.name] === false && row.actual) row.set = row.actual;
      row.drift = !!row.actual && !!row.set && norm(row.actual.path) !== norm(row.set.path);
      return row;
    });
    return { stack, rows, running: rows.filter((r) => r.container?.state === "running").length };
  });
  const known = new Set(stacks.map((s) => s.name));
  const other = containers.filter((c) => !c.project || !known.has(c.project))
    .map((c) => ({ key: `/${c.name}`, stack: null, name: c.name, container: c, service: null, sources: [], actual: null, set: null, drift: false, mounted: false }));
  return { groups, other };
}

/**
 * The other Services that can move with a Switch: those whose Repo has a worktree on the picked
 * checkout's branch. The Main checkout and a detached worktree bring none.
 */
export function siblings(stack, sources, name, source) {
  if (!source || source.main || !source.branch) return [];
  const out = [];
  for (const other of Object.keys(stack.services)) {
    if (other === name) continue;
    const match = (sources[`${stack.name}/${other}`] ?? []).find((s) => !s.main && s.branch === source.branch);
    if (match) out.push({ name: other, source: match });
  }
  return out;
}

/**
 * What a Switch changes. `targets`: { service: checkout }, the picked Service and any that move with it.
 * Returns { changes: { VAR: path | null }, services: the Services whose set Source changes }.
 */
export function planSwitch(stack, env, targets) {
  const changes = {}, services = [];
  for (const [name, target] of Object.entries(targets)) {
    const service = stack.services[name];
    if (!service || !target) continue;
    const want = target.main ? null : target.path;
    const have = env?.[service.var] || null;
    if ((want == null) === (have == null) && (want == null || norm(want) === norm(have))) continue;
    changes[service.var] = want;
    services.push(name);
  }
  return { changes, services };
}

/** Whether bringing a Service up from a Source must rebuild its image. */
export function needsBuild({ mounted, hostHash, imageHash }) {
  if (!mounted) return true; // Nothing is mounted, so the image is the only copy of the code.
  if (!hostHash || !imageHash) return true;
  return hostHash !== imageHash;
}

/** The compose arguments every Dockr command starts with. `has`: which env files exist. */
export function composeArgs(stack, has = { env: true, dockr: true }) {
  const args = ["compose", "-f", stack.compose];
  if (has.env) args.push("--env-file", `${stack.dir}/.env`);
  if (has.dockr) args.push("--env-file", `${stack.dir}/.dockr.env`);
  return args;
}

/** A word quoted for sh. */
export const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * The toasts a change of containers earns. `prev` null (the first look) earns none.
 * `stacks`: names of configured Stacks. `quiet`: container names the user just acted on.
 * `loops`: names in a restart loop now, `wasLoops`: at the last look. A loop earns one toast, not one per exit.
 */
export function toasts(prev, next, stacks, quiet = new Set(), loops = new Set(), wasLoops = new Set()) {
  if (!prev) return [];
  const before = new Map(prev.map((c) => [c.name, c]));
  const out = [];
  for (const c of next) {
    if (!c.project || !stacks.includes(c.project) || quiet.has(c.name)) continue;
    const was = before.get(c.name) ?? null;
    const name = c.service ?? c.name;
    if (loops.has(c.name)) {
      if (!wasLoops.has(c.name)) out.push({ kind: "loop", name, stack: c.project, title: `${name} keeps restarting`, body: why(c), level: "error" });
      continue;
    }
    if (c.health === "unhealthy" && was?.health !== "unhealthy") out.push({ kind: "unhealthy", name, stack: c.project, title: `${name} is unhealthy`, body: why(c), level: "warning" });
    else if (c.state === "exited" && c.exitCode !== 0 && was && was.state !== "exited") out.push({ kind: "exited", name, stack: c.project, title: `${name} exited ${c.exitCode}`, body: why(c), level: "error" });
    else if (up(c) && !up(was)) out.push({ kind: "started", name, stack: c.project, title: `${name} started`, level: "success" });
  }
  return out;
}

/** The names a hosts file maps to this computer, without localhost itself. */
export function localHosts(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const [ip, ...names] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (ip !== "127.0.0.1" && ip !== "::1") continue;
    for (const n of names) if (n && !/^localhost(\.localdomain)?$/i.test(n) && /^[A-Za-z0-9.-]+$/.test(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The host port a localhost URL points at, or null for any other host. */
export function localPort(url) {
  const m = /^(https?):\/\/(localhost|127\.0\.0\.1)(?::(\d+))?(?:[\/?#]|$)/i.exec(url);
  return m ? (m[3] ? Number(m[3]) : m[1].toLowerCase() === "https" ? 443 : 80) : null;
}

/**
 * A Stack's links, each under the Service that serves it: { byService: { name: links }, stack: links }.
 * A link goes to the Service its config entry names, else to the one publishing its localhost port,
 * else it stays with the Stack. Local host names the config does not list go to the Service publishing 443.
 */
export function stackUrls(stack, rows, hostsText) {
  const byService = {}, rest = [];
  const publishing = (port) => rows.find((r) => r.container?.ports.some((p) => p.host === port))?.name ?? null;
  const put = (name, link) => { (byService[name] ??= []).push(link); };
  for (const u of stack.urls) {
    const port = localPort(u.url);
    const name = (u.service && rows.some((r) => r.name === u.service) ? u.service : null) ?? (port == null ? null : publishing(port));
    if (name) put(name, u); else rest.push(u);
  }
  const has = new Set(stack.urls.map((u) => u.url.replace(/\/+$/, "")));
  const tls = rows.find((r) => r.container?.state === "running" && r.container.ports.some((p) => p.host === 443));
  if (tls) for (const n of localHosts(hostsText)) if (!has.has(`https://${n}`)) put(tls.name, { url: `https://${n}`, label: n, service: tls.name });
  return { byService, stack: rest };
}

/** The link for a published port. */
export const portUrl = (port) => (port === 443 ? "https://localhost" : port === 80 ? "http://localhost" : `http://localhost:${port}`);

/** The node showing `mod` in a layout tree is on screen: not hidden, and the active child of any stack above it. */
export function modShown(root, mod) {
  const walk = (n, shown) => {
    if (!n || typeof n !== "object") return null;
    const here = shown && !n.hidden;
    if (n.content?.mod === mod) return here;
    let found = null;
    for (const c of n.children ?? []) {
      const r = walk(c, here && (n.type !== "stack" || n.active === c.id));
      if (r === true) return true;
      if (r === false) found = false;
    }
    return found;
  };
  return walk(root, true) ?? true; // Not in the layout (a pane, a window): it is shown when it runs.
}

/**
 * The lines a Stack's first .dockr.env needs besides the Switch itself: every other Service that
 * runs from a worktree keeps it, so writing the file does not put them in Drift.
 */
export function adoptChanges(rows, targets) {
  const out = {};
  for (const r of rows) if (r.service && !(r.name in targets) && r.actual && !r.actual.main) out[r.service.var] = r.actual.path;
  return out;
}

/** What a row says about its container: { kind: "up" | "starting" | "bad" | "off", text }. Text is empty when all is well. */
export function statusOf(c, loop = false) {
  if (!c) return { kind: "off", text: "not created" };
  if (loop) return { kind: "bad", text: "restart loop" };
  if (c.health === "unhealthy") return { kind: "bad", text: "unhealthy" };
  if (c.state === "exited") return c.exitCode !== 0 ? { kind: "bad", text: `exited ${c.exitCode}` } : { kind: "off", text: "stopped" };
  if (c.state === "running") return c.health === "starting" ? { kind: "starting", text: "waiting for healthy" } : { kind: "up", text: "" };
  if (c.state === "restarting") return { kind: "starting", text: "restarting" };
  return { kind: "off", text: c.state };
}

const EXITS = { 126: "its command cannot run", 127: "its command was not found", 137: "killed", 139: "crashed (segmentation fault)", 143: "terminated" };

/** Why a container is not well, in one line. Empty when it is. */
export function why(c) {
  if (!c) return "";
  if (c.state === "running" && c.health === "unhealthy") {
    const said = String(c.healthOutput ?? "").split(/\r?\n/).filter(Boolean).pop();
    return said ? `health check: ${said}` : "health check is failing";
  }
  if (c.state !== "exited" && c.state !== "dead" && c.state !== "restarting") return "";
  if (c.state === "exited" && c.exitCode === 0) return "";
  if (c.oom) return `exited ${c.exitCode}, out of memory`;
  if (c.error) return c.error;
  return EXITS[c.exitCode] ? `exited ${c.exitCode}, ${EXITS[c.exitCode]}` : `exited ${c.exitCode}`;
}

/** Whether exit times (ms) show a restart loop: `count` of them inside `windowMs`, the last one recent. */
export function looping(times, now, count = 3, windowMs = 60000) {
  return (times ?? []).filter((t) => now - t <= windowMs).length >= count;
}

/**
 * Adds a container's new exits to `seen` ({ finishedAt, restarts, times }) and returns it.
 * The first sight of a container records where it stands and counts nothing.
 */
export function noteExits(seen, c) {
  const at = Date.parse(c.finishedAt);
  const ended = Number.isFinite(at) && at > 0 ? at : null;
  if (!seen) return { finishedAt: c.finishedAt, restarts: c.restarts, times: [] };
  const more = Math.max((c.restarts ?? 0) - (seen.restarts ?? 0), c.finishedAt !== seen.finishedAt && ended ? 1 : 0);
  const times = more > 0 ? [...seen.times, ...Array(Math.min(more, 5)).fill(ended ?? Date.now())].slice(-10) : seen.times;
  return { finishedAt: c.finishedAt, restarts: c.restarts, times };
}

/** The terminals Dockr started that still run, from Herdr's terminal list. */
export function parseOps(terms) {
  const list = (v) => String(v ?? "").split(",").filter(Boolean);
  return (terms ?? []).filter((t) => t?.state === "live" && t.labels?.["dockr.stack"]).map((t) => ({
    address: t.address, stack: t.labels["dockr.stack"], kind: t.labels["dockr.kind"] ?? "op", service: t.labels["dockr.service"] ?? null,
    services: list(t.labels["dockr.services"]), build: list(t.labels["dockr.build"]), verb: t.labels["dockr.verb"] ?? "switch",
    title: t.labels["dockr.title"] ?? "Dockr", at: Number(t.labels["dockr.at"]) || 0, failed: t.labels["dockr.failed"] ?? null,
  }));
}

/** The build or bring-up that is working on a Service, or null. Without a service: any in the Stack. */
export const opFor = (ops, stack, service) =>
  ops.filter((o) => o.kind === "op" && o.stack === stack && (service == null || o.services.includes(service)))
    .sort((a, b) => b.at - a.at)[0] ?? null; // the newest: an old failed one left open must not hide it

/** Where a Service is in a running build or bring-up: { text, failed? }, or null with none. */
export function phase(name, op, container) {
  if (!op) return null;
  if (op.failed != null) return { failed: true, text: `failed (exit ${op.failed})` };
  if (op.verb === "down") return { text: "stopping" };
  // A container made after the work began is the new one: the build is over.
  if (container && Date.parse(container.created) >= op.at - 2000) return { text: container.health === "starting" ? "waiting for healthy" : "starting" };
  return { text: op.build.includes(name) ? "building" : op.verb === "up" ? "starting" : "recreating" };
}

/** What switching to a checkout costs: "current", "recreate" (seconds) or "rebuild". */
export function costOf({ current, mounted, hostHash, imageHash }) {
  if (current) return "current";
  return needsBuild({ mounted, hostHash, imageHash }) ? "rebuild" : "recreate";
}

/** The worktree a Service could move to because it is on `branch` (the focused space's), or null. */
export function suggestion(row, branch) {
  if (!row.service || !branch) return null;
  const s = row.sources.find((x) => !x.main && x.branch === branch);
  return s && !(row.set && norm(row.set.path) === norm(s.path)) ? s : null;
}

/** A branch in a few characters: its ticket number, else its start. */
export function shortBranch(b) {
  const m = /^(?:[A-Za-z]+\/)?#?(\d{3,})/.exec(String(b ?? ""));
  return m ? m[1] : String(b ?? "").length > 14 ? `${String(b).slice(0, 13)}…` : String(b ?? "");
}

/** The shipped icon that fits a container's program, by its image and command. */
export function programIcon(c) {
  const text = `${c?.image ?? ""} ${c?.command ?? ""}`.toLowerCase();
  const rules = [[/nginx/, "nginx"], [/postgres/, "psql"], [/redis/, "redis-cli"], [/mongo/, "mongosh"], [/mysql|mariadb/, "mysql"],
    [/dotnet|aspnet/, "dotnet"], [/vite/, "vite"], [/\b(npm|node|yarn|pnpm)\b/, "node"], [/python|uvicorn|gunicorn/, "python"]];
  return `icons/${rules.find(([re]) => re.test(text))?.[1] ?? "docker"}.svg`;
}

/** A Docker or compose error in words that say what to do. Unknown ones keep their last line. */
export function explain(text, machine = null) {
  const s = String(text ?? ""), where = machine ? ` on ${machine}` : "";
  if (/cannot connect to the docker daemon|is the docker daemon running|error during connect|dockerDesktopLinuxEngine|could not be found in this WSL 2 distro|docker (events|stats) ended|timed out/i.test(s)) return "Docker is not running. Start it, then press Refresh.";
  if (/port is already allocated|address already in use/i.test(s)) {
    const port = /(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]|:::?):(\d+)/.exec(s)?.[1];
    return `Port ${port ?? "it needs"} is already in use. Stop what holds it, then try again.`;
  }
  if (/permission denied.*docker\.sock/i.test(s)) return `No permission to use Docker${where}. Add your user to the docker group.`;
  if (/program not found|command not found|executable file not found|cannot start (docker|bash|sh)\b/i.test(s)) return `Docker's command line was not found${where}.`;
  if (/no such service/i.test(s)) return "The compose file has no service by that name. Check dockr.json.";
  if (/no such file or directory/i.test(s) && /\.ya?ml|compose/i.test(s)) return "The compose file is not where dockr.json says it is.";
  if (/unreachable|not connected|no such machine/i.test(s)) return `Herdr cannot reach${machine ? ` ${machine}` : " that Machine"}. Connect it, then press Refresh.`;
  return s.trim().split(/\r?\n/).pop() ?? "";
}

/**
 * What an agent is told about a failing container. It holds what Docker reports and the last log
 * lines, and no environment values.
 */
export function brief({ stack, row, container: c, lines, loop, build = null }) {
  const src = row?.actual ?? row?.set ?? null;
  const facts = [
    `Container: ${c.name}`,
    `Image: ${c.image}`,
    `State: ${c.state}${c.health ? `, health ${c.health}` : ""}${loop ? ", in a restart loop" : ""}`,
    `Problem: ${why(c) || (loop ? "it keeps restarting" : "none that Docker reports")}`,
    `Restarts: ${c.restarts ?? 0}`,
    c.healthOutput ? `Health check output: ${c.healthOutput.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")}` : null,
    c.command ? `Command: ${c.command}` : null,
    c.ports?.length ? `Published ports: ${c.ports.map((p) => `${p.host}->${p.container}`).join(", ")}` : null,
    src ? `Runs from: ${src.path}${src.branch ? ` (branch ${src.branch})` : ""}` : null,
    stack?.compose ? `Compose file: ${stack.compose}` : null,
  ].filter(Boolean);
  const log = (lines ?? []).slice(-100).map((l) => (l.length > 400 ? `${l.slice(0, 400)}…` : l));
  const built = build?.lines?.length ? build : null, broke = built && built.failed != null;
  return [
    broke && !(why(c) || loop)
      ? `"${built.title}" failed for "${row?.name ?? c.name}"${stack ? ` in the compose project "${stack.name}"` : ""}. Find the cause in its output below and propose a fix.`
      : why(c) || loop
      ? `The Docker container for "${row?.name ?? c.name}"${stack ? ` in the compose project "${stack.name}"` : ""} is failing. Find the cause and propose a fix.`
      : `Look into the Docker container for "${row?.name ?? c.name}"${stack ? ` in the compose project "${stack.name}"` : ""}. Docker reports no failure. Say what state it is in and point out anything in its logs that looks wrong.`,
    "",
    "What Docker reports:",
    ...facts.map((f) => `- ${f}`),
    "",
    log.length ? `Its last ${log.length} log lines:` : "It wrote no log lines.",
    ...log,
    ...(built ? ["", `The last ${built.lines.length} lines that "${built.title}" printed (${broke ? `it failed with exit code ${built.failed}` : "it is still working"}):`, ...built.lines] : []),
    "",
    "Rules:",
    "- Do not run docker compose up, down, build or restart, and do not stop or remove containers. Dockr manages them.",
    "- Read-only commands such as docker logs and docker inspect are fine.",
    "- Do not print environment values or open .env files.",
    why(c) || loop || broke ? "- Say the cause first, then the fix. Ask before you change files." : "- Say what you found first. Ask before you change files.",
  ].join("\n");
}

/**
 * The space a diagnosing agent's tab belongs in: one on that Machine whose folder is the checkout
 * or inside it, else one on the same branch. Null when there is none.
 */
export function pickSpace(spaces, machine, folder, branch) {
  const here = (spaces ?? []).filter((s) => (s.machine ?? "") === (machine ?? ""));
  if (folder) {
    const f = norm(folder);
    const by = here.find((s) => s.folder && inside(norm(s.folder), f));
    if (by) return by;
  }
  return (branch && here.find((s) => s.branch === branch)) || null;
}

const STAMP = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/;
const ERROR = /\b(error|errors|err|fatal|panic|exception|fail|failed|failure|critical|unhandled)\b/i;
const WARN = /\b(warn|warning|deprecated)\b/i;

/**
 * Log lines from a wait's output: { lines: [{ at, text, src, level }], ended }.
 * `at` is Docker's timestamp. A line with none takes the one before it.
 */
export function parseLogs(text, src = "") {
  const lines = [];
  let ended = false, at = "";
  for (const raw of String(text ?? "").split("\n")) {
    if (raw === "\x01ended") { ended = true; continue; }
    if (!raw) continue;
    const m = STAMP.exec(raw);
    if (m) at = m[1];
    const body = clean(m ? m[2] : raw);
    lines.push({ at, text: body, src, level: ERROR.test(body) ? "error" : WARN.test(body) ? "warn" : "" });
  }
  return { lines, ended };
}

/**
 * `all` with `more` added: lines at or before `since` (already shown) are dropped, the whole stays
 * in time order, and only the last `cap` lines are kept.
 */
export function addLogs(all, more, since = "", cap = 5000) {
  const fresh = since ? more.filter((l) => l.at > since) : more;
  if (!fresh.length) return all;
  const out = all.concat(fresh);
  const last = all.length ? all[all.length - 1].at : "";
  if (fresh.some((l) => l.at < last)) {
    const order = new Map(out.map((l, i) => [l, i]));
    out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : order.get(a) - order.get(b)));
  }
  return out.length > cap ? out.slice(out.length - cap) : out;
}

/** A search box's text as a test for a line: /regex/ or plain text, both ignoring case. Null when empty or not a valid regex. */
export function matcher(query) {
  const q = String(query ?? "").trim();
  if (!q) return null;
  const re = /^\/(.+)\/$/.exec(q);
  if (re) { try { const r = new RegExp(re[1], "i"); return (text) => r.test(text); } catch { return null; } }
  const low = q.toLowerCase();
  return (text) => text.toLowerCase().includes(low);
}

/** A Docker timestamp as local HH:MM:SS.mmm. */
export function clock(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** "452.7MiB" as bytes. 0 when it is not a size. */
export function bytes(text) {
  const m = /^([\d.]+)\s*([A-Za-z]+)$/.exec(String(text ?? "").trim());
  return m ? Number(m[1]) * (UNITS[m[2].toLowerCase()] ?? 0) : 0;
}

/** Bytes as a short size: 452M, 1.4G. */
export function size(n) {
  if (!(n > 0)) return "0";
  const steps = [["T", 1024 ** 4], ["G", 1024 ** 3], ["M", 1024 ** 2], ["K", 1024]];
  for (const [unit, by] of steps) if (n >= by) { const v = n / by; return `${v >= 100 || unit === "M" || unit === "K" ? Math.round(v) : v.toFixed(1)}${unit}`; }
  return `${Math.round(n)}B`;
}

/** One sample from Docker's stats stream, by container name: { name: { cpu, mem, limit, net, disk } }. */
export function parseStats(text) {
  const out = {};
  for (const raw of clean(text).split("\n")) {
    const f = raw.trim().split("|");
    if (f.length < 6 || !f[1]) continue;
    const cpu = parseFloat(f[2]), [mem, limit] = f[3].split("/").map((x) => bytes(x));
    if (Number.isNaN(cpu)) continue;
    out[f[1]] = { cpu, mem, limit: limit ?? 0, net: f[4].trim(), disk: f[5].trim() };
  }
  return out;
}

/** `history` ({ name: samples }) with one more sample each, keeping the last `keep` and dropping containers that are gone. */
export function addStats(history, sample, keep = 60) {
  const out = {};
  for (const [name, s] of Object.entries(sample)) out[name] = [...(history[name] ?? []), s].slice(-keep);
  return out;
}

/** CPU percent and memory as a row shows them: "24% · 236M". */
export const usage = (s) => (s ? `${s.cpu >= 10 ? Math.round(s.cpu) : s.cpu.toFixed(1)}% · ${size(s.mem)}` : "");

/**
 * Docker's disk use from docker.disk()'s text: engine totals, the Stack's images, the untagged
 * images its rebuilds left, every untagged image on the engine, and the Stack's volumes.
 */
export function parseDisk(text) {
  const [totals = "", images = "", unused = "", all = "", names = "", sizes = ""] = String(text ?? "").split(/^---$/m).map((x) => x.trim());
  const rows = (t) => t.split(/\r?\n/).map((l) => l.trim().split("|")).filter((f) => f[0]);
  const engine = {};
  for (const [type, count, size, reclaim] of rows(totals)) {
    const key = /image/i.test(type) ? "images" : /volume/i.test(type) ? "volumes" : /cache/i.test(type) ? "cache" : /container/i.test(type) ? "containers" : null;
    if (key) engine[key] = { count: Number(count) || 0, size: bytes(size), reclaimable: bytes(String(reclaim ?? "").split(" ")[0]) };
  }
  const sizeOf = Object.fromEntries(rows(sizes).map(([name, size, links]) => [name, { size: bytes(size), used: Number(links) > 0 }]));
  const allRows = rows(all);
  return {
    engine,
    images: rows(images).map(([name, size]) => ({ name, size: bytes(size) })),
    unused: rows(unused).map(([id, size, age]) => ({ id, size: bytes(size), age: age ?? "" })),
    allUnused: { count: allRows.length, size: allRows.reduce((n, f) => n + bytes(f[1]), 0) },
    volumes: rows(names).map(([name]) => ({ name, size: sizeOf[name]?.size ?? 0, used: !!sizeOf[name]?.used })),
  };
}

/**
 * The containers outside every configured Stack as Docker Desktop groups them: one group per
 * compose project, then one (name null) for those in no project. Empty groups are left out.
 */
export function groupOther(other) {
  const by = new Map();
  for (const r of other ?? []) {
    const name = r.container?.project ?? null;
    if (!by.has(name)) by.set(name, []);
    by.get(name).push(name ? { ...r, name: r.container.service ?? r.name } : r);
  }
  const named = [...by.entries()].filter(([n]) => n).sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => ({ name, rows }));
  return by.has(null) ? [...named, { name: null, rows: by.get(null) }] : named;
}

/** Whether a row matches the search box: every word is in its name, image, branch or a published port. */
export function rowMatches(row, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const c = row.container;
  const hay = [row.name, c?.name, c?.image, row.actual?.branch, row.set?.branch, ...(c?.ports ?? []).map((p) => String(p.host))].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "Running (2/3)" as Docker Desktop words a group, and how well it is: "up", "part", "off" or "bad". */
export function groupState(rows, statusOf_ = statusOf) {
  const total = rows.length, running = rows.filter((r) => r.container?.state === "running").length;
  const bad = rows.some((r) => statusOf_(r.container).kind === "bad");
  const text = running ? `Running (${running}/${total})` : rows.some((r) => r.container) ? `Stopped (0/${total})` : "Not created";
  return { text, running, total, kind: bad ? "bad" : running === total ? "up" : running ? "part" : "off" };
}

/** The local branches that no checkout is on, so nothing can run from them yet. */
export function looseBranches(branches, sources) {
  const taken = new Set((sources ?? []).map((s) => s.branch).filter(Boolean));
  return (branches ?? []).filter((b) => !taken.has(b));
}

/** The letters Dockr's own keys use, so no row is given one of them as its hint. */
export const KEY_LETTERS = "sxrtcbpdoyhlgmqjk";

/**
 * The panel as one list for the keyboard: each group's header, then its rows unless it is folded.
 * `shown(group)` gives the rows the search leaves. A group with none is left out while filtering.
 */
export function panelItems(groups, folded, shown, filtering) {
  const out = [];
  for (const g of groups) {
    const rows = shown(g);
    if (!rows.length && (filtering || !g.rows.length)) continue;
    out.push({ kind: "group", key: g.key, group: g });
    if (!folded[g.key]) for (const r of rows) out.push({ kind: "row", key: r.key, row: r, group: g });
  }
  return out;
}

/**
 * What a key does to the selected item, as CodeyPacker's `run` mod maps them: { on: "row" | "group" | "panel", action }.
 * Null when the key does nothing there. `k` is the keystroke ("s", "shift-s", "enter", "/").
 * `facts`: { running, created, service, bad, link } for a row, and { anyDown, anyUp } for its group.
 */
export function keyAction(k, item, facts = {}) {
  if (k === "q") return { on: "panel", action: "leave" };
  if (k === "?" || k === "shift-/") return { on: "panel", action: "help" };
  if (k === "/") return { on: "panel", action: "search" };
  if (k === "g" || k === "home") return { on: "panel", action: "first" };
  if (k === "shift-g" || k === "end") return { on: "panel", action: "last" };
  if (!item) return null;
  const group = (action) => ({ on: "group", action });
  if (k === "shift-s") return item.group.name && facts.anyDown !== false ? group("up") : null;
  if (k === "shift-x") return item.group.name && facts.anyUp !== false ? group("stop") : null;
  if (k === "shift-d") return item.group.managed ? group("down") : null;
  if (k === "h") return group("fold");
  if (item.kind === "group") {
    if (k === "enter" || k === "l") return group(k === "l" ? "unfold" : "toggle");
    if (k === "m") return item.group.name ? group("menu") : null;
    return null;
  }
  const row = (action) => ({ on: "row", action });
  if (k === "enter") return facts.created ? row("open") : null;
  if (k === "s") return facts.running ? null : row("start");
  if (k === "x") return facts.running ? row("stop") : null;
  if (k === "r") return facts.running ? row("restart") : null;
  if (k === "t") return facts.running ? row("terminal") : null;
  if (k === "c") return facts.service ? row("source") : null;
  if (k === "b") return facts.service ? row("rebuild") : null;
  if (k === "d") return facts.created ? row("diagnose") : null;
  if (k === "o") return facts.link ? row("browser") : null;
  if (k === "p") return facts.output ? row("output") : null;
  if (k === "y") return facts.created ? row("copy") : null;
  if (k === "m") return row("menu");
  return null;
}

/**
 * The legend under the list: every key that acts on the selected item, and how to see the rest.
 * For a container that leaves out browser, copy name, its group's keys, search and leave, which "?" lists.
 */
export function coreHints(item, facts = {}) {
  const rest = new Set(item?.kind === "row" ? ["o", "y", "S", "X", "D", "/", "q"] : ["/", "q"]);
  return [...keyHints(item, facts).filter(([k]) => !rest.has(k)), ["?", "all keys"]];
}

/** Every key hint for the selected item: [key, what] pairs, only the ones that do something now. */
export function keyHints(item, facts = {}) {
  const all = [["j/k", "move"]];
  const add = (k, label, what) => { if (keyAction(k, item, facts)) all.push([label ?? k, what]); };
  if (item?.kind === "group") { add("enter", "enter", "fold"); }
  add("enter", "enter", item?.kind === "row" ? "logs" : null);
  // The row's buttons, left to right, then what only its menu has, in the menu's order.
  add("d", null, "diagnose"); add("t", null, "terminal"); add("r", null, "restart"); add("x", null, "stop"); add("s", null, "start");
  add("p", null, "build output"); add("o", null, "browser"); add("c", null, "checkout"); add("b", null, "rebuild"); add("y", null, "copy name");
  add("shift-s", "S", "start all"); add("shift-x", "X", "stop all"); add("shift-d", "D", "remove");
  add("m", null, "menu");
  all.push(["/", "search"], ["q", "leave"]);
  return all.filter(([, what]) => what);
}

/** Why `git switch` refused, in a sentence. */
export function gitRefusal(text) {
  const s = String(text ?? "");
  if (/would be overwritten by checkout/i.test(s)) return "Git kept the branch: uncommitted changes there would be overwritten. Commit or stash them first.";
  if (/already (checked out|used by worktree) at/i.test(s)) return "That branch is checked out in a worktree. Pick the worktree instead.";
  if (/invalid reference|did not match any/i.test(s)) return "Git has no such branch.";
  const line = s.split(/\r?\n/).map((l) => l.trim()).find((l) => /^(error|fatal):/i.test(l)) ?? s.trim().split(/\r?\n/).pop() ?? "";
  return line.replace(/^(error|fatal):\s*/i, "") || "git switch failed.";
}

// The dashboard

/** Docker's "1.2MB / 340kB" as [in, out] bytes. */
export function pair(text) {
  const [a, b] = String(text ?? "").split("/").map((x) => bytes(x.trim()));
  return [a || 0, b || 0];
}

/** How long ago `iso` was, as "45s", "12m", "3h" or "2d". Empty when it is not a time. */
export function ago(iso, now = Date.now()) {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at) || at <= 0) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

/**
 * What the dashboard shows, from the panel's groups and the stats history ({ container name: samples }).
 * `statusOf_` says whether a container has failed. `sort`: "cpu" or "mem", highest first.
 * - totals: containers running and in all, CPU percent, memory, the engine's memory, network and disk bytes
 * - groups: one line per group with its CPU and memory
 * - rows: one per created container
 * - attention: the containers to look at, each with why
 * - history: total CPU and memory per sample, oldest first
 */
export function dashboard(groups, stats, statusOf_ = statusOf, sort = "cpu", now = Date.now()) {
  const rows = [], perGroup = [];
  for (const g of groups) {
    let cpu = 0, mem = 0, running = 0, total = 0;
    for (const r of g.rows) {
      const c = r.container;
      if (!c) continue;
      total++;
      const up = c.state === "running", samples = stats[c.name] ?? [], s = up ? samples[samples.length - 1] ?? null : null;
      const [netIn, netOut] = pair(s?.net), [diskIn, diskOut] = pair(s?.disk), status = statusOf_(c);
      if (up) running++;
      cpu += s?.cpu ?? 0;
      mem += s?.mem ?? 0;
      rows.push({
        key: r.key, row: r, name: r.name, group: g.name ?? "", running: up, sampled: !!s, cpu: s?.cpu ?? 0, mem: s?.mem ?? 0, limit: s?.limit ?? 0,
        memPct: s?.limit ? (s.mem / s.limit) * 100 : 0, netIn, netOut, diskIn, diskOut, restarts: c.restarts ?? 0,
        up: up ? ago(c.startedAt, now) : "", bad: status.kind === "bad", status: status.text, oom: !!c.oom,
      });
    }
    if (total) perGroup.push({ key: g.key, name: g.name ?? "No project", running, total, cpu, mem });
  }
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const totals = {
    running: rows.filter((r) => r.running).length, total: rows.length, cpu: sum((r) => r.cpu), mem: sum((r) => r.mem),
    limit: Math.max(0, ...rows.map((r) => r.limit)), netIn: sum((r) => r.netIn), netOut: sum((r) => r.netOut), diskIn: sum((r) => r.diskIn), diskOut: sum((r) => r.diskOut),
  };
  const attention = [];
  for (const r of rows) {
    const why = r.bad ? r.status : r.oom ? "killed for memory" : r.memPct >= 90 ? `memory at ${Math.round(r.memPct)}% of its limit` : r.restarts >= 3 && r.running ? `restarted ${r.restarts} times` : "";
    if (why) attention.push({ key: r.key, row: r.row, name: r.name, why, bad: r.bad || r.oom });
  }
  const names = rows.filter((r) => r.running).map((r) => r.row.container.name);
  const length = Math.max(0, ...names.map((n) => (stats[n] ?? []).length));
  const history = { cpu: [], mem: [] };
  for (let back = length; back >= 1; back--) {
    let cpu = 0, mem = 0;
    for (const n of names) { const list = stats[n] ?? [], s = list[list.length - back]; if (s) { cpu += s.cpu; mem += s.mem; } }
    history.cpu.push(cpu);
    history.mem.push(mem);
  }
  rows.sort((a, b) => (sort === "mem" ? b.mem - a.mem : b.cpu - a.cpu) || a.name.localeCompare(b.name));
  return { totals, groups: perGroup, rows, attention, history };
}

// The line a booting container shows

/**
 * Whether a container is still booting: Docker says its health is "starting", or it has no
 * health check and started less than `window` ms ago.
 */
export function booting(c, now = Date.now(), window = 60000) {
  if (!c || c.state !== "running") return false;
  if (c.health === "starting") return true;
  if (c.health) return false;
  const at = Date.parse(c.startedAt);
  return !Number.isNaN(at) && now - at >= 0 && now - at < window;
}

/** The newest line worth showing from log lines ({ text }), or "": the last one that says something. */
export function bootLine(lines) {
  for (let i = (lines ?? []).length - 1; i >= 0; i--) {
    const text = String(lines[i]?.text ?? "").replace(/\s+/g, " ").trim();
    if (/[A-Za-z0-9]/.test(text)) return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  }
  return "";
}

/**
 * The step a build or bring-up is on, from its terminal's screen: the newest build step line
 * (" => [web 4/6] RUN npm ci"), for `service` when the screen names services, else the last line
 * that says something. "" when there is none.
 */
export function buildLine(screen, service = null) {
  const lines = clean(screen).split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => /[A-Za-z0-9]/.test(l));
  const steps = lines.map((l) => /^=> (?:CACHED )?(\[(?:(\S+) )?\d+\/\d+\] .*)$/.exec(l)).filter(Boolean);
  const mine = service ? steps.filter((m) => m[2] === service) : [];
  const step = (mine.length ? mine : steps.filter((m) => !service || !m[2])).pop() ?? steps[steps.length - 1];
  const text = step ? step[1].replace(/ \d+(\.\d+)?s$/, "") : (lines.filter((l) => !/^Failed with exit code|^=> =>/.test(l)).pop() ?? "");
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * What a build or bring-up printed, from its terminal's screen and history: its last `max` lines
 * that say something, each cut to 400 characters, without Dockr's own "Failed with exit code" line.
 */
export function buildLog(screen, max = 80) {
  return clean(screen).split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => /\S/.test(l) && !/^Failed with exit code \d+\. Press Enter/.test(l))
    .slice(-max).map((l) => (l.length > 400 ? `${l.slice(0, 400)}…` : l));
}
