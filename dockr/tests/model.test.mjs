import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../mods/dockr/model.js";

const CONFIG = JSON.stringify({
  stacks: [{
    name: "shop-local", machine: "wsl", compose: "/mnt/c/dev/shop/deploy/docker-compose.local.yml",
    services: {
      gateway: { var: "API_PATH", repo: "ado/api-server", main: "/mnt/c/dev/shop/api-server" },
      "billing": { var: "BILLING_PATH", repo: "ado/billing", manifests: ["Billing.API/Billing.API.csproj"] },
    },
    urls: { "https://app.example.test": "Review UI" },
  }],
});

const MAIN = { path: "/mnt/c/dev/shop/api-server", branch: "102-x", head: "a".repeat(40), main: true };
const WT = { path: "/mnt/c/dev/shop/.worktrees/101-t/api-server", branch: "101-t", head: "b".repeat(40), main: false };
const stack = () => m.withMains(m.parseConfig(CONFIG).stacks, { repos: { "ado/billing": { on: { wsl: { path: "/mnt/c/dev/shop/billing" } } } } }).stacks[0];

const container = (over = {}) => ({
  id: "1", name: "shop-local-gateway-1", image: "shop-local-gateway", imageId: "sha256:1", state: "running", exitCode: 0, health: "healthy",
  created: "", project: "shop-local", service: "gateway", binds: [], ports: [], ...over,
});

test("norm makes Windows, Docker Desktop and WSL spellings of one path equal", () => {
  const want = "/mnt/c/dev/shop/api-server";
  assert.equal(m.norm("C:\\Dev\\shop\\api-server\\"), want);
  assert.equal(m.norm("/run/desktop/mnt/host/c/dev/shop/api-server"), want);
  assert.equal(m.norm("/mnt/c/dev/shop/api-server/"), want);
  assert.equal(m.norm("/home/J/Repo/"), "/home/J/Repo");
});

test("parseConfig keeps good stacks and names the bad parts", () => {
  const ok = m.parseConfig(CONFIG);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.stacks[0].dir, "/mnt/c/dev/shop/deploy");
  assert.deepEqual(ok.stacks[0].services.gateway.manifests, m.DEFAULT_MANIFESTS);
  assert.deepEqual(m.parseConfig(null), { stacks: [], problems: [] });
  assert.equal(m.parseConfig("{").problems.length, 1);
  const bad = m.parseConfig(JSON.stringify({ stacks: [{ name: "a", compose: "rel.yml" }, { name: "b", compose: "/c.yml", services: { s: { var: "1X" }, t: { var: "T", manifests: ["../x"] } }, urls: { "javascript:1": "x" } }] }));
  assert.equal(bad.stacks.length, 1);
  assert.deepEqual(Object.keys(bad.stacks[0].services), ["t"]);
  assert.equal(bad.problems.length, 4);
});

test("withMains takes a Main checkout from Wranglr when the Service names none", () => {
  const s = stack();
  assert.equal(s.services.gateway.main, "/mnt/c/dev/shop/api-server");
  assert.equal(s.services["billing"].main, "/mnt/c/dev/shop/billing");
  const none = m.withMains(m.parseConfig(CONFIG).stacks, null);
  assert.equal(none.stacks[0].services["billing"].main, null);
  assert.equal(none.problems.length, 1);
  const ws = { workspaces: [{ on: { wsl: { paths: { "ado/billing": "/ws/billing" } } } }] };
  assert.equal(m.wranglrMain(ws, "ado/billing", "wsl"), "/ws/billing");
  assert.equal(m.wranglrMain(ws, "ado/billing", null), null);
});

test("parseWorktrees lists the Main checkout first and skips prunable ones", () => {
  const text = `worktree /r/main\nHEAD ${"a".repeat(40)}\nbranch refs/heads/staging\n\nworktree /r/wt1\nHEAD ${"b".repeat(40)}\nbranch refs/heads/46382/14-x\n\nworktree /r/gone\nHEAD ${"c".repeat(40)}\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n\nworktree /r/det\nHEAD ${"d".repeat(40)}\ndetached\n`;
  const list = m.parseWorktrees(text);
  assert.deepEqual(list.map((s) => [s.path, s.branch, s.main]), [["/r/main", "staging", true], ["/r/wt1", "46382/14-x", false], ["/r/det", null, false]]);
  assert.equal(m.sourceName(list[2]), "dddddddd");
});

test("setEnv changes only the named lines", () => {
  const text = "# Dockr\nA=/x\nB=/y\n";
  assert.equal(m.setEnv(text, { A: null, C: "/z" }), "# Dockr\nB=/y\nC=/z\n");
  assert.equal(m.setEnv(text, { B: "/q" }), "# Dockr\nA=/x\nB=/q\n");
  assert.equal(m.setEnv("", { A: null }), "");
  assert.deepEqual(m.parseEnv('A=/x\n B = "/y z" \n#C=1\n'), { A: "/x", B: "/y z" });
});

test("parseContainers prefers Docker Desktop's bind labels over its opaque mount paths", () => {
  const ps = JSON.stringify({ ID: "abc", Labels: "com.docker.compose.service=gateway,desktop.docker.io/binds/2/Source=/mnt/c/dev/shop/.worktrees/101-t/api-server/src,desktop.docker.io/binds/2/SourceKind=hostFile,x=1" }) + "\nnot json\n";
  assert.deepEqual(m.desktopBinds(ps), { abc: ["/mnt/c/dev/shop/.worktrees/101-t/api-server/src"] });
  const [c] = m.parseContainers([{
    Id: "abc", Name: "/shop-local-gateway-1", Image: "sha256:9", Created: "2026",
    Config: { Image: "shop-local-gateway", Labels: { "com.docker.compose.project": "shop-local", "com.docker.compose.service": "gateway" } },
    State: { Status: "running", ExitCode: 0, Health: { Status: "healthy" } },
    Mounts: [{ Type: "bind", Source: "/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Ubuntu/92b1" }, { Type: "volume", Source: "/var/lib/docker/volumes/x/_data" }],
    HostConfig: { PortBindings: { "5858/tcp": [{ HostIp: "127.0.0.1", HostPort: "5858" }], "3010/tcp": [{ HostIp: "127.0.0.1", HostPort: "3010" }] } },
  }], m.desktopBinds(ps));
  assert.deepEqual(c.binds, ["/mnt/c/dev/shop/.worktrees/101-t/api-server/src"]);
  assert.deepEqual(c.ports.map((p) => p.host), [3010, 5858]);
  assert.equal(c.health, "healthy");
  assert.equal(m.sourceOf(c, [MAIN, WT]), WT);
  assert.deepEqual(m.parseContainers("not json"), []);
  const [plain] = m.parseContainers([{ Id: "d", Name: "/x", Mounts: [{ Type: "bind", Source: "/run/desktop/mnt/host/c/dev/shop/api-server/src" }] }]);
  assert.equal(m.sourceOf(plain, [MAIN, WT]), MAIN);
});

test("view shows the real Source and marks Drift against the env file", () => {
  const s = stack(), sources = { "shop-local/gateway": [MAIN, WT] };
  const c = container({ binds: [WT.path + "/src"] });
  const drifted = m.view([s], [c], {}, sources).groups[0].rows.find((r) => r.name === "gateway");
  assert.equal(drifted.actual, WT);
  assert.equal(drifted.set, MAIN);
  assert.equal(drifted.drift, true);
  assert.equal(drifted.mounted, true);
  const same = m.view([s], [c], { "shop-local": { API_PATH: WT.path } }, sources).groups[0].rows.find((r) => r.name === "gateway");
  assert.equal(same.drift, false);
});

test("view lists configured Services with no container, and containers outside every Stack", () => {
  const s = stack();
  const v = m.view([s], [container({ name: "pg", project: null, service: null }), container({ name: "n", service: "nginx" })], {}, {});
  assert.deepEqual(v.groups[0].rows.map((r) => r.name), ["nginx", "gateway", "billing"]);
  assert.equal(v.groups[0].rows[1].container, null);
  assert.deepEqual(v.other.map((r) => r.name), ["pg"]);
});

test("view takes the Source of an unmounted Service from Dockr's own build record", () => {
  const s = stack(), key = "shop-local/billing";
  const sources = { [key]: [{ ...MAIN, path: "/mnt/c/dev/shop/billing" }, { ...WT, path: "/wt/billing" }] };
  const c = container({ name: "a", service: "billing", imageId: "sha256:7" });
  const row = (built) => m.view([s], [c], {}, sources, built).groups[0].rows.find((r) => r.name === "billing");
  assert.equal(row({}).actual, null);
  assert.equal(row({}).drift, false);
  assert.equal(row({ [key]: { imageId: "sha256:7", path: "/wt/billing" } }).actual.path, "/wt/billing");
  assert.equal(row({ [key]: { imageId: "sha256:7", path: "/wt/billing" } }).drift, true);
  assert.equal(row({ [key]: { imageId: "sha256:other", path: "/wt/billing" } }).actual, null);
});

test("planSwitch writes a worktree's path and removes the line for the Main checkout", () => {
  const s = stack();
  assert.deepEqual(m.planSwitch(s, {}, { gateway: WT }), { changes: { API_PATH: WT.path }, services: ["gateway"] });
  assert.deepEqual(m.planSwitch(s, { API_PATH: WT.path }, { gateway: MAIN }), { changes: { API_PATH: null }, services: ["gateway"] });
  assert.deepEqual(m.planSwitch(s, { API_PATH: WT.path }, { gateway: WT }), { changes: {}, services: [] });
  assert.deepEqual(m.planSwitch(s, {}, { gateway: MAIN }), { changes: {}, services: [] });
});

test("siblings are the other Services with a worktree on the picked branch", () => {
  const s = stack();
  const billingMain = { path: "/mnt/c/dev/shop/billing", branch: "staging", head: "e", main: true };
  const billingWt = { path: "/wt/101/billing", branch: "101-t", head: "f", main: false };
  const sources = { "shop-local/gateway": [MAIN, WT], "shop-local/billing": [billingMain, billingWt] };
  assert.deepEqual(m.siblings(s, sources, "gateway", WT), [{ name: "billing", source: billingWt }]);
  assert.deepEqual(m.siblings(s, sources, "gateway", MAIN), []);
  assert.deepEqual(m.siblings(s, sources, "gateway", { ...WT, branch: null }), []);
  assert.deepEqual(m.siblings(s, { "shop-local/gateway": [MAIN, WT] }, "gateway", WT), []);
  // A Switch names only the Services that move, so the rest keep their Source.
  const plan = m.planSwitch(s, { BILLING_PATH: "/wt/103/billing" }, { gateway: WT });
  assert.deepEqual(plan.changes, { API_PATH: WT.path });
});

test("needsBuild rebuilds unmounted Services and changed manifests only", () => {
  assert.equal(m.needsBuild({ mounted: false, hostHash: "a", imageHash: "a" }), true);
  assert.equal(m.needsBuild({ mounted: true, hostHash: "a", imageHash: "a" }), false);
  assert.equal(m.needsBuild({ mounted: true, hostHash: "a", imageHash: "b" }), true);
  assert.equal(m.needsBuild({ mounted: true, hostHash: "a", imageHash: null }), true);
});

test("composeArgs passes .env before .dockr.env and leaves out a missing file", () => {
  const s = stack();
  assert.deepEqual(m.composeArgs(s), ["compose", "-f", s.compose, "--env-file", `${s.dir}/.env`, "--env-file", `${s.dir}/.dockr.env`]);
  assert.deepEqual(m.composeArgs(s, { env: false, dockr: true }), ["compose", "-f", s.compose, "--env-file", `${s.dir}/.dockr.env`]);
  assert.equal(m.q("it's"), "'it'\\''s'");
});

test("toasts fire once per change, for Stack Services only, and never on the first look", () => {
  const stacks = ["shop-local"];
  const run = container(), starting = container({ health: "starting" });
  assert.deepEqual(m.toasts(null, [run], stacks), []);
  assert.deepEqual(m.toasts([starting], [run], stacks).map((t) => t.kind), ["started"]);
  assert.deepEqual(m.toasts([run], [run], stacks), []);
  assert.deepEqual(m.toasts([], [starting], stacks), []);
  assert.deepEqual(m.toasts([run], [container({ state: "exited", exitCode: 1, health: null })], stacks).map((t) => t.title), ["gateway exited 1"]);
  assert.deepEqual(m.toasts([run], [container({ state: "exited", exitCode: 0, health: null })], stacks), []);
  assert.deepEqual(m.toasts([run], [container({ health: "unhealthy" })], stacks).map((t) => t.kind), ["unhealthy"]);
  assert.deepEqual(m.toasts([container({ health: "unhealthy" })], [container({ health: "unhealthy" })], stacks), []);
  assert.deepEqual(m.toasts([starting], [run], []), []);
  assert.deepEqual(m.toasts([run], [container({ state: "exited", exitCode: 137 })], stacks, new Set(["shop-local-gateway-1"])), []);
});

test("stackUrls puts each link under the Service that serves it", () => {
  const hosts = "127.0.0.1 app.example.test admin.example.test\n127.0.0.1 localhost\n10.0.0.1 other # x\n";
  assert.deepEqual(m.localHosts(hosts), ["app.example.test", "admin.example.test"]);
  const [s] = m.parseConfig(JSON.stringify({ stacks: [{ name: "a", compose: "/c.yml", urls: {
    "https://app.example.test": { label: "Review UI", service: "web-client" },
    "http://localhost:3010/api/health": "Gateway health",
    "https://docs.example.net": "Docs",
    "https://gone.example.net": { label: "Gone", service: "no-such-service" },
  } }] })).stacks;
  const rows = [
    { name: "nginx", container: container({ ports: [{ host: 443, container: "443/tcp" }] }) },
    { name: "gateway", container: container({ ports: [{ host: 3010, container: "3010/tcp" }] }) },
    { name: "web-client", container: container() },
  ];
  const u = m.stackUrls(s, rows, hosts);
  assert.deepEqual(u.byService["web-client"].map((x) => x.label), ["Review UI"]);
  assert.deepEqual(u.byService.gateway.map((x) => x.label), ["Gateway health"]);
  assert.deepEqual(u.byService.nginx.map((x) => x.label), ["admin.example.test"]);
  assert.deepEqual(u.stack.map((x) => x.label), ["Docs", "Gone"]);
  assert.equal(m.stackUrls(s, rows.slice(1), hosts).byService.nginx, undefined);
  assert.equal(m.localPort("https://localhost"), 443);
  assert.equal(m.localPort("http://127.0.0.1:5000/x"), 5000);
  assert.equal(m.localPort("https://localhost.example.net"), null);
  assert.equal(m.portUrl(443), "https://localhost");
  assert.equal(m.portUrl(3010), "http://localhost:3010");
});

test("modShown follows hidden nodes and a stack's active child", () => {
  const tree = (hidden, active) => ({ id: "root", type: "row", children: [{ id: "panel", type: "column", hidden, children: [{ id: "body", type: "stack", active, children: [{ id: "files", content: { mod: "files" } }, { id: "dockr", content: { mod: "dockr" } }] }] }] });
  assert.equal(m.modShown(tree(false, "dockr"), "dockr"), true);
  assert.equal(m.modShown(tree(true, "dockr"), "dockr"), false);
  assert.equal(m.modShown(tree(false, "files"), "dockr"), false);
  assert.equal(m.modShown({ id: "root", children: [] }, "dockr"), true);
});

test("a Stack with no .dockr.env takes what runs as its record, and the first write keeps it", () => {
  const s = stack(), sources = { "shop-local/gateway": [MAIN, WT] };
  const c = container({ binds: [WT.path + "/src"] });
  const rows = m.view([s], [c], {}, sources, {}, { "shop-local": false }).groups[0].rows;
  const gateway = rows.find((r) => r.name === "gateway");
  assert.equal(gateway.set, WT);
  assert.equal(gateway.drift, false);
  assert.deepEqual(m.adoptChanges(rows, { "billing": MAIN }), { API_PATH: WT.path });
  assert.deepEqual(m.adoptChanges(rows, { gateway: MAIN }), {});
});

test("statusOf is silent when a container is up and says what is wrong otherwise", () => {
  assert.deepEqual(m.statusOf(container()), { kind: "up", text: "" });
  assert.deepEqual(m.statusOf(container({ health: "starting" })), { kind: "starting", text: "waiting for healthy" });
  assert.deepEqual(m.statusOf(container({ health: "unhealthy" })), { kind: "bad", text: "unhealthy" });
  assert.deepEqual(m.statusOf(container({ state: "exited", exitCode: 137, health: null })), { kind: "bad", text: "exited 137" });
  assert.deepEqual(m.statusOf(container({ state: "exited", exitCode: 0, health: null })), { kind: "off", text: "stopped" });
  assert.deepEqual(m.statusOf(null), { kind: "off", text: "not created" });
});

test("phase follows a build from Herdr's terminals and the container's age", () => {
  const term = (labels, state = "live") => ({ address: "wsl/t9", state, labels: { "dockr.stack": "shop-local", "dockr.kind": "op", "dockr.at": "1000000", ...labels } });
  const ops = m.parseOps([term({ "dockr.services": "gateway,admin-client", "dockr.build": "gateway" }), term({}, "finished"), { address: "t1", state: "live", labels: {} }]);
  assert.equal(ops.length, 1);
  const op = m.opFor(ops, "shop-local", "gateway");
  assert.equal(m.opFor(ops, "shop-local", "nginx"), null);
  assert.equal(m.opFor(ops, "shop-local").address, "wsl/t9");
  const old = container({ created: new Date(900000).toISOString() }), fresh = container({ created: new Date(1000500).toISOString() });
  assert.equal(m.phase("gateway", op, old).text, "building");
  assert.equal(m.phase("admin-client", op, old).text, "recreating");
  assert.equal(m.phase("gateway", op, { ...fresh, health: "starting" }).text, "waiting for healthy");
  assert.equal(m.phase("gateway", op, fresh).text, "starting");
  assert.equal(m.phase("gateway", null, old), null);
  const failed = m.parseOps([term({ "dockr.services": "gateway", "dockr.failed": "17" })])[0];
  assert.deepEqual(m.phase("gateway", failed, old), { failed: true, text: "failed (exit 17)" });
  assert.equal(m.phase("gateway", m.parseOps([term({ "dockr.services": "gateway", "dockr.verb": "down" })])[0], old).text, "stopping");
});

test("costOf, suggestion and shortBranch", () => {
  assert.equal(m.costOf({ current: true, mounted: true }), "current");
  assert.equal(m.costOf({ current: false, mounted: true, hostHash: "a", imageHash: "a" }), "recreate");
  assert.equal(m.costOf({ current: false, mounted: true, hostHash: "a", imageHash: "b" }), "rebuild");
  assert.equal(m.costOf({ current: false, mounted: false }), "rebuild");
  const row = { service: { var: "X" }, sources: [MAIN, WT], set: MAIN };
  assert.equal(m.suggestion(row, "101-t"), WT);
  assert.equal(m.suggestion({ ...row, set: WT }, "101-t"), null);
  assert.equal(m.suggestion(row, "102-x"), null);
  assert.equal(m.suggestion(row, null), null);
  assert.equal(m.shortBranch("301-add-search"), "301");
  assert.equal(m.shortBranch("46382/14-arabic"), "46382");
  assert.equal(m.shortBranch("feature/12345-x"), "12345");
  assert.equal(m.shortBranch("staging"), "staging");
});

test("programIcon and explain", () => {
  assert.equal(m.programIcon({ image: "nginx:1.29-alpine", command: "nginx -g daemon off;" }), "icons/nginx.svg");
  assert.equal(m.programIcon({ image: "shop-local-gateway", command: "npm run dev" }), "icons/node.svg");
  assert.equal(m.programIcon({ image: "shop-local-billing", command: "dotnet Billing.API.dll" }), "icons/dotnet.svg");
  assert.equal(m.programIcon({ image: "mcr.microsoft.com/mssql/server", command: "/opt/mssql/bin/sqlservr" }), "icons/docker.svg");
  assert.match(m.explain("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?", "wsl"), /^Docker is not running\./);
  assert.match(m.explain("Bind for 127.0.0.1:3010 failed: port is already allocated"), /^Port 3010 is already in use/);
  assert.equal(m.explain("line one\nno configuration file provided: not found\n"), "no configuration file provided: not found");
});

test("parseContainers reads one object per line and keeps environment names only", () => {
  const line = (o) => JSON.stringify(o);
  const out = m.parseContainers([
    line({ Id: "a", Name: "/a", RestartCount: 4, State: { Status: "exited", ExitCode: 137, OOMKilled: true, FinishedAt: "2026-11-16T10:00:00Z", Health: { Status: "unhealthy", Log: [{ Output: "old" }, { Output: "\u001b[31mconnection refused\u001b[0m\n" }] } },
      Mounts: [{ Type: "bind", Source: "/host/src", Destination: "/app/src", RW: true }, { Type: "volume", Name: "data", Destination: "/data", RW: false }],
      Networks: { net: { IPAddress: "172.18.0.2" } }, Config: { Labels: { "com.docker.compose.project": "p", "desktop.docker.io/binds/0/Source": "/x" }, Env: ["SECRET=abc=def", "PATH=/bin"] } }),
    "", "not json",
    line({ Id: "b", Name: "/b" }),
  ].join("\n"));
  assert.equal(out.length, 2);
  const [a] = out;
  assert.deepEqual(a.env, ["PATH", "SECRET"]);
  assert.equal(JSON.stringify(out).includes("abc"), false);
  assert.equal(a.restarts, 4);
  assert.equal(a.oom, true);
  assert.equal(a.healthOutput, "connection refused");
  assert.deepEqual(a.mounts, [{ type: "bind", source: "/host/src", target: "/app/src", rw: true }, { type: "volume", source: "data", target: "/data", rw: false }]);
  assert.deepEqual(a.networks, [{ name: "net", ip: "172.18.0.2" }]);
  assert.deepEqual(Object.keys(a.labels), ["com.docker.compose.project"]);
});

test("why says what is wrong in one line", () => {
  const c = (o) => ({ state: "exited", exitCode: 1, health: null, oom: false, error: "", healthOutput: "", ...o });
  assert.equal(m.why(null), "");
  assert.equal(m.why(c({ state: "running" })), "");
  assert.equal(m.why(c({ exitCode: 0 })), "");
  assert.equal(m.why(c({})), "exited 1");
  assert.equal(m.why(c({ exitCode: 137, oom: true })), "exited 137, out of memory");
  assert.equal(m.why(c({ exitCode: 137 })), "exited 137, killed");
  assert.equal(m.why(c({ exitCode: 127 })), "exited 127, its command was not found");
  assert.equal(m.why(c({ error: "failed to create task: no such file" })), "failed to create task: no such file");
  assert.equal(m.why(c({ state: "running", health: "unhealthy", healthOutput: "curl: (7)\nconnection refused" })), "health check: connection refused");
  assert.equal(m.why(c({ state: "running", health: "unhealthy" })), "health check is failing");
});

test("three exits inside a minute are a restart loop, with one toast", () => {
  const at = (s) => `2026-11-16T10:00:${String(s).padStart(2, "0")}Z`, t0 = Date.parse(at(0));
  let seen = m.noteExits(undefined, { finishedAt: at(0), restarts: 0 });
  assert.deepEqual(seen.times, []); // first sight counts nothing
  seen = m.noteExits(seen, { finishedAt: at(0), restarts: 0 });
  assert.deepEqual(seen.times, []);
  seen = m.noteExits(seen, { finishedAt: at(10), restarts: 1 });
  seen = m.noteExits(seen, { finishedAt: at(20), restarts: 2 });
  assert.equal(m.looping(seen.times, t0 + 21000), false);
  seen = m.noteExits(seen, { finishedAt: at(30), restarts: 3 });
  assert.equal(m.looping(seen.times, t0 + 31000), true);
  assert.equal(m.looping(seen.times, t0 + 200000), false); // it stopped looping
  // Several restarts between two looks all count.
  assert.equal(m.noteExits({ finishedAt: at(0), restarts: 0, times: [] }, { finishedAt: at(5), restarts: 3 }).times.length, 3);
  assert.equal(m.statusOf({ state: "running", health: null }, true).text, "restart loop");

  const stacks = ["shop-local"], dead = container({ state: "exited", exitCode: 1, health: null }), name = dead.name;
  const first = m.toasts([container()], [dead], stacks, new Set(), new Set([name]), new Set());
  assert.deepEqual(first.map((t) => t.kind), ["loop"]);
  assert.deepEqual(m.toasts([container()], [dead], stacks, new Set(), new Set([name]), new Set([name])), []);
});

test("brief tells an agent what failed, with no environment values, and pickSpace finds its space", () => {
  const c = { name: "p-web-1", image: "p-web", state: "exited", exitCode: 3, health: null, restarts: 2, oom: false, error: "", healthOutput: "",
    command: "npm run dev", ports: [{ host: 3000, container: "3000/tcp" }], env: ["SECRET"] };
  const row = { name: "web", actual: { path: "/wt/feat/web", branch: "feat" } };
  const text = m.brief({ stack: { name: "p", compose: "/s/compose.yml" }, row, container: c, lines: ["one", "x".repeat(900), "boom"], loop: true });
  assert.match(text, /"web" in the compose project "p" is failing/);
  assert.match(text, /Problem: exited 3/);
  assert.match(text, /in a restart loop/);
  assert.match(text, /Runs from: \/wt\/feat\/web \(branch feat\)/);
  assert.match(text, /Its last 3 log lines:\none\n/);
  assert.equal(text.includes("SECRET"), false);
  assert.ok(text.split("\n").every((l) => l.length <= 401));
  assert.match(m.brief({ stack: null, row: { name: "x" }, container: c, lines: [] }), /It wrote no log lines\./);

  const spaces = [{ id: 1, machine: null, folder: "/wt/feat/web", branch: "feat" }, { id: 2, machine: "wsl", folder: "/home/me", branch: "feat" }, { id: 3, machine: "wsl", folder: "/wt/feat/web/src", branch: "other" }];
  assert.equal(m.pickSpace(spaces, "wsl", "/wt/feat/web", "feat").id, 3); // the folder wins over the branch
  assert.equal(m.pickSpace(spaces, "wsl", "/elsewhere", "feat").id, 2);
  assert.equal(m.pickSpace(spaces, null, "/wt/feat/web", null).id, 1);
  assert.equal(m.pickSpace(spaces, "wsl", "/elsewhere", "nope"), null);
});

test("parseLogs, addLogs and matcher", () => {
  const got = m.parseLogs("2026-11-16T10:00:00.000000001Z first\n2026-11-16T10:00:00.000000002Z \u001b[31mError: boom\u001b[0m\n  at stack line\n2026-11-16T10:00:00.000000003Z warning: slow\n\u0001ended\n", "web");
  assert.equal(got.ended, true);
  assert.deepEqual(got.lines.map((l) => [l.text, l.level, l.src]), [["first", "", "web"], ["Error: boom", "error", "web"], ["  at stack line", "", "web"], ["warning: slow", "warn", "web"]]);
  assert.equal(got.lines[2].at, got.lines[1].at); // a line with no timestamp takes the one before it
  assert.equal(m.parseLogs("").ended, false);

  const line = (n, src = "a") => ({ at: `2026-11-16T10:00:00.00000000${n}Z`, text: `l${n}`, src, level: "" });
  let all = m.addLogs([], [line(1), line(2)]);
  all = m.addLogs(all, [line(2), line(3)], line(2).at); // the join between two waits repeats nothing
  assert.deepEqual(all.map((l) => l.text), ["l1", "l2", "l3"]);
  all = m.addLogs(all, [line(2, "b"), line(4, "b")]); // another container's lines land in time order
  assert.deepEqual(all.map((l) => `${l.text}${l.src}`), ["l1a", "l2a", "l2b", "l3a", "l4b"]);
  assert.deepEqual(m.addLogs(all, [line(5), line(6)], "", 3).map((l) => l.text), ["l4", "l5", "l6"]);
  assert.equal(m.addLogs(all, [], ""), all);

  assert.equal(m.matcher("  "), null);
  assert.equal(m.matcher("BOOM")("Error: boom"), true);
  assert.equal(m.matcher("/err(or)?|warn/")("a Warning"), true);
  assert.equal(m.matcher("/(/"), null);
  assert.match(m.clock("2026-11-16T10:00:00.123456789Z"), /^\d\d:\d\d:00\.123$/);
});

test("parseStats, addStats, size and usage", () => {
  const text = "\u001b[J\u001b[H075c|p-web-1|2.42%|453.1MiB / 15.35GiB|17.1MB / 32.9MB|4.8MB / 245MB\u001b[K\ndf8d|p-db-1|124.50%|1.409GiB / 15.35GiB|1kB / 2kB|0B / 0B\u001b[K\n\u001b[K\nbad line\nx|y|--|-- / --|a|b\n";
  const s = m.parseStats(text);
  assert.deepEqual(Object.keys(s), ["p-web-1", "p-db-1"]);
  assert.equal(s["p-web-1"].cpu, 2.42);
  assert.equal(Math.round(s["p-web-1"].mem / 1024 / 1024), 453);
  assert.equal(s["p-web-1"].net, "17.1MB / 32.9MB");
  assert.equal(m.usage(s["p-web-1"]), "2.4% · 453M");
  assert.equal(m.usage(s["p-db-1"]), "125% · 1.4G");
  assert.equal(m.usage(undefined), "");
  assert.equal(m.size(0), "0");
  assert.equal(m.size(512), "512B");
  assert.equal(m.bytes("1.5kB"), 1500);

  let h = m.addStats({}, s);
  h = m.addStats(h, { "p-web-1": { cpu: 3, mem: 1 } }, 2); // p-db-1 is gone
  assert.deepEqual(Object.keys(h), ["p-web-1"]);
  h = m.addStats(h, { "p-web-1": { cpu: 4, mem: 1 } }, 2);
  assert.deepEqual(h["p-web-1"].map((x) => x.cpu), [3, 4]);
});

test("parseDisk reads the engine totals, the Stack's unused images and its volumes", () => {
  const text = ["Images|91|58.84GB|28.31GB (48%)", "Containers|6|160.5MB|0B (0%)", "Local Volumes|7|2.783GB|2.319GB (83%)", "Build Cache|455|68.58GB|21.23GB", "---",
    "p-web:latest|1.15GB", "---", "abc123|2GB|4 weeks ago", "def456|1GB|2 days ago", "---", "abc123|2GB", "def456|1GB", "zzz999|4GB", "---", "p_data", "---", "p_data|642.1MB|1", "other|1GB|0", ""].join("\n");
  const d = m.parseDisk(text);
  assert.equal(d.engine.images.count, 91);
  assert.equal(m.size(d.engine.images.reclaimable), "26.4G"); // 28.31 GB in powers of ten
  assert.equal(d.engine.cache.count, 455);
  assert.deepEqual(d.images.map((i) => i.name), ["p-web:latest"]);
  assert.deepEqual(d.unused.map((u) => u.id), ["abc123", "def456"]);
  assert.equal(d.allUnused.count, 3);
  assert.deepEqual(d.volumes.map((v) => [v.name, v.used]), [["p_data", true]]);
  assert.deepEqual(m.parseDisk("").unused, []);
});

test("groupOther, rowMatches and groupState", () => {
  const row = (name, project, o = {}) => ({ key: `/${name}`, name, container: { name, project, service: name.replace(/^.*-(\w+)-1$/, "$1"), image: "img", state: "running", health: null, exitCode: 0, ports: [{ host: 8080 }], ...o } });
  const g = m.groupOther([row("solo", null), row("zeta-web-1", "zeta"), row("alpha-db-1", "alpha"), row("zeta-api-1", "zeta")]);
  assert.deepEqual(g.map((x) => [x.name, x.rows.map((r) => r.name)]), [["alpha", ["db"]], ["zeta", ["web", "api"]], [null, ["solo"]]]);
  assert.deepEqual(m.groupOther([]), []);

  const r = { name: "gateway", container: { name: "shop-gateway-1", image: "shop-gateway", ports: [{ host: 3010 }] }, actual: { branch: "301-add" } };
  assert.equal(m.rowMatches(r, ""), true);
  assert.equal(m.rowMatches(r, "GATE 301"), true);
  assert.equal(m.rowMatches(r, "3010"), true);
  assert.equal(m.rowMatches(r, "nginx"), false);

  assert.deepEqual(m.groupState([row("a", "p"), row("b", "p")]), { text: "Running (2/2)", running: 2, total: 2, kind: "up" });
  assert.equal(m.groupState([row("a", "p"), row("b", "p", { state: "exited" })]).text, "Running (1/2)");
  assert.equal(m.groupState([row("a", "p"), row("b", "p", { state: "exited", exitCode: 1 })]).kind, "bad");
  assert.equal(m.groupState([row("b", "p", { state: "exited" })]).text, "Stopped (0/1)");
  assert.equal(m.groupState([{ name: "x", container: null }]).text, "Not created");
});

test("looseBranches are the branches no checkout is on", () => {
  assert.deepEqual(m.looseBranches(["main", "feat", "old", "spike"], [{ branch: "main" }, { branch: "feat" }, { branch: null }]), ["old", "spike"]);
  assert.deepEqual(m.looseBranches([], [{ branch: "main" }]), []);
});

test("panelItems, keyAction and keyHints follow the run mod's keys", () => {
  const g = (key, name, rows, managed = true) => ({ key, name, managed, rows });
  const r = (key) => ({ key, name: key });
  const groups = [g("stack:a", "a", [r("a/web"), r("a/api")]), g("loose", null, [r("/solo")], false), g("stack:empty", "empty", [])];
  const items = m.panelItems(groups, { loose: true }, (x) => x.rows, false);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.key}`), ["group:stack:a", "row:a/web", "row:a/api", "group:loose"]);
  assert.deepEqual(m.panelItems(groups, {}, (x) => x.rows.filter((y) => y.key === "/solo"), true).map((i) => i.key), ["loose", "/solo"]);

  const row = items[1], head = items[0], loose = items[3];
  const up = { running: true, created: true, service: true, bad: false, link: true }, down = { running: false, created: true, service: false, bad: true, link: false };
  const act = (k, item, f) => { const a = m.keyAction(k, item, f); return a ? `${a.on}:${a.action}` : null; };
  assert.equal(act("s", row, up), null);
  assert.equal(act("s", row, down), "row:start");
  assert.equal(act("x", row, up), "row:stop");
  assert.equal(act("x", row, down), null);
  assert.equal(act("r", row, up), "row:restart");
  assert.equal(act("t", row, up), "row:terminal");
  assert.equal(act("c", row, up), "row:source");
  assert.equal(act("c", row, down), null);
  assert.equal(act("d", row, down), "row:diagnose");
  assert.equal(act("d", row, up), "row:diagnose"); // a running container can be looked into too
  assert.equal(act("d", row, { ...up, created: false }), null);
  assert.equal(act("o", row, up), "row:browser");
  assert.equal(act("enter", row, up), "row:open");
  assert.equal(act("shift-s", row, up), "group:up");
  assert.equal(act("shift-x", row, up), "group:stop");
  assert.equal(act("shift-d", row, up), "group:down");
  assert.equal(act("h", row, up), "group:fold");
  assert.equal(act("enter", head), "group:toggle");
  assert.equal(act("s", head), null);
  assert.equal(act("shift-s", loose), null); // the containers in no project have no group actions
  assert.equal(act("shift-s", row, { ...up, anyDown: false }), null); // nothing to start
  assert.equal(act("shift-x", row, { ...up, anyUp: false }), null); // nothing to stop
  assert.equal(act("shift-d", loose), null);
  assert.equal(act("q", null), "panel:leave");
  assert.equal(act("/", row, up), "panel:search");
  assert.equal(act("shift-g", row, up), "panel:last");
  assert.equal(act("z", row, up), null);
  for (const [key] of m.keyHints(row, up)) if (/^[a-z]$/.test(key)) assert.ok(m.KEY_LETTERS.includes(key), key);
  assert.ok(m.keyHints(row, up).some(([k, w]) => k === "x" && w === "stop"));
  assert.ok(!m.keyHints(row, up).some(([k]) => k === "s"));
  assert.ok(m.keyHints(head).some(([k, w]) => k === "enter" && w === "fold"));
  assert.deepEqual(m.coreHints(row, up).map(([k]) => k), ["j/k", "enter", "d", "t", "r", "x", "c", "b", "m", "?"]);
  assert.ok(m.coreHints(row, up).some(([k, w]) => k === "enter" && w === "logs"));
  assert.deepEqual(m.coreHints(row, down).map(([k]) => k).slice(0, 4), ["j/k", "enter", "d", "s"]);
  assert.ok(!m.coreHints(row, down).some(([k]) => k === "t" || k === "S"));
  assert.ok(m.coreHints(head, up).some(([k]) => k === "S"));
  assert.equal(act("?", row, up), "panel:help");
  assert.equal(act("shift-/", null), "panel:help");
});

test("the dashboard sums what the stats say and names what needs a look", () => {
  const c = (name, over = {}) => ({ name, state: "running", restarts: 0, oom: false, startedAt: new Date(10_000_000 - 7_200_000).toISOString(), ...over });
  const groups = [
    { key: "stack:a", name: "a", rows: [{ key: "a/web", name: "web", container: c("a-web-1") }, { key: "a/db", name: "db", container: c("a-db-1") }, { key: "a/new", name: "new", container: null }] },
    { key: "loose", name: null, rows: [{ key: "x", name: "x", container: c("x", { state: "exited", exitCode: 2 }) }] },
  ];
  const s = (cpu, mem, limit = 1000) => ({ cpu, mem, limit, net: "1kB / 2kB", disk: "0B / 3MB" });
  const stats = { "a-web-1": [s(10, 100), s(30, 200)], "a-db-1": [s(5, 950)], x: [s(99, 99)] };
  const status = (k) => (k.state === "exited" ? { kind: "bad", text: "exited 2" } : { kind: "up", text: "" });
  const d = m.dashboard(groups, stats, status, "cpu", 10_000_000);
  assert.deepEqual([d.totals.running, d.totals.total, d.totals.cpu, d.totals.mem, d.totals.limit], [2, 3, 35, 1150, 1000]);
  assert.deepEqual([d.totals.netIn, d.totals.netOut, d.totals.diskOut], [2000, 4000, 6e6]);
  assert.deepEqual(d.groups.map((g) => [g.name, g.running, g.total, g.cpu]), [["a", 2, 2, 35], ["No project", 0, 1, 0]]);
  assert.deepEqual(d.rows.map((r) => r.name), ["web", "db", "x"]);
  assert.equal(d.rows[0].up, "2h");
  assert.deepEqual(m.dashboard(groups, stats, status, "mem").rows.map((r) => r.name), ["db", "web", "x"]);
  assert.deepEqual(d.attention.map((a) => [a.name, a.why]), [["db", "memory at 95% of its limit"], ["x", "exited 2"]]);
  assert.deepEqual(d.history, { cpu: [10, 35], mem: [100, 1150] });
});

test("a stopped Docker Desktop is named as such, whatever it printed", () => {
  const stub = "\nThe command 'docker' could not be found in this WSL 2 distro.\nWe recommend to activate the WSL integration in Docker Desktop settings.\n\nhttps://docs.docker.com/go/wsl2/\n";
  for (const text of [stub, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.", "docker events ended"]) {
    assert.equal(m.explain(text, "wsl"), "Docker is not running. Start it, then press Refresh.");
  }
});

test("the newest build or bring-up speaks for a Service, not an old failed one left open", () => {
  const op = (at, failed) => ({ kind: "op", stack: "s", services: ["web"], at, failed });
  assert.equal(m.opFor([op(1, "1"), op(5, null)], "s", "web").at, 5);
  assert.equal(m.opFor([op(5, null), op(1, "1")], "s", "web").at, 5);
});

test("a refused git switch is said in a sentence", () => {
  assert.match(m.gitRefusal("error: Your local changes to the following files would be overwritten by checkout:\n\tf\nPlease commit your changes or stash them before you switch branches.\nAborting"), /^Git kept the branch: uncommitted changes/);
  assert.match(m.gitRefusal("fatal: 'other' is already used by worktree at '/x/wt'"), /checked out in a worktree/);
  assert.match(m.gitRefusal("fatal: 'other' is already checked out at '/x/wt'"), /checked out in a worktree/);
  assert.equal(m.gitRefusal("fatal: invalid reference: nope"), "Git has no such branch.");
  assert.equal(m.gitRefusal("fatal: something else\n"), "something else");
});

test("the brief for a container that has not failed asks for a look, not a fix", () => {
  const c = { name: "p-web-1", image: "web", state: "running", health: "healthy", exitCode: 0, restarts: 0, oom: false, error: "", healthOutput: "", ports: [], command: "" };
  const text = m.brief({ stack: { name: "p", compose: "/s/c.yml" }, row: { name: "web" }, container: c, lines: ["ready"] });
  assert.match(text, /^Look into the Docker container for "web" in the compose project "p"\. Docker reports no failure\./);
  assert.match(text, /- Problem: none that Docker reports/);
  assert.doesNotMatch(text, /is failing/);
});

test("a container boots until it is healthy, or for a minute when it has no health check", () => {
  const now = 1_000_000_000, at = (ms) => new Date(now - ms).toISOString();
  assert.equal(m.booting({ state: "running", health: "starting", startedAt: at(600_000) }, now), true);
  assert.equal(m.booting({ state: "running", health: "healthy", startedAt: at(1_000) }, now), false);
  assert.equal(m.booting({ state: "running", health: "", startedAt: at(20_000) }, now), true);
  assert.equal(m.booting({ state: "running", health: "", startedAt: at(61_000) }, now), false);
  assert.equal(m.booting({ state: "exited", health: "", startedAt: at(1_000) }, now), false);
  assert.equal(m.booting(null, now), false);
});

test("the boot line is the newest log line that says something", () => {
  assert.equal(m.bootLine([{ text: "Starting up" }, { text: "  Now   listening on: http://[::]:80 " }, { text: "   " }, { text: "---" }]), "Now listening on: http://[::]:80");
  assert.equal(m.bootLine([{ text: "x".repeat(300) }]).length, 201);
  assert.equal(m.bootLine([]), "");
});

test("the build line is the newest step on the terminal's screen, for the row's service when named", () => {
  const screen = [" => [internal] load build context", " => => transferring context: 25B", " => CACHED [2/6] WORKDIR /app", " => [3/6] RUN echo one && sleep 3     3.1s", " => [4/6] RUN npm ci", " => => # added 12 packages", ""].join("\n");
  assert.equal(m.buildLine(screen), "[4/6] RUN npm ci");
  const two = [" => [web 2/5] COPY package.json ./", " => [api 3/4] RUN dotnet restore   12.0s", " => [web 3/5] RUN npm ci"].join("\n");
  assert.equal(m.buildLine(two, "api"), "[api 3/4] RUN dotnet restore");
  assert.equal(m.buildLine(two, "web"), "[web 3/5] RUN npm ci");
  assert.equal(m.buildLine(two, "other"), "[web 3/5] RUN npm ci");
  assert.equal(m.buildLine(" ✔ Container p-web-1  Recreated   0.4s\n ⠋ Container p-web-1  Starting\n"), "⠋ Container p-web-1 Starting");
  assert.equal(m.buildLine("\n\n"), "");
});

test("the brief carries what a failed build printed, and buildLog keeps only its last lines", () => {
  const c = { name: "p-web-1", image: "p-web", state: "running", health: null, restarts: 0 };
  const screen = "\x1b[32m => [web 3/6] RUN npm ci\x1b[0m\r\n\n" + "y".repeat(900) + "\nnpm ERR! missing script\n\nFailed with exit code 17. Press Enter to close.\n";
  const lines = m.buildLog(screen);
  assert.deepEqual([lines[0], lines[2]], [" => [web 3/6] RUN npm ci", "npm ERR! missing script"]);
  assert.equal(lines.length, 3);
  assert.equal(lines[1].length, 401);
  assert.equal(m.buildLog("a\nb\nc", 2).join(), "b,c");
  const text = m.brief({ stack: { name: "p" }, row: { name: "web" }, container: c, lines: ["ready"], build: { title: "Rebuild web", failed: "17", lines } });
  assert.match(text, /^"Rebuild web" failed for "web" in the compose project "p"\./);
  assert.match(text, /The last 3 lines that "Rebuild web" printed \(it failed with exit code 17\):\n => \[web 3\/6\] RUN npm ci\n/);
  assert.match(text, /Say the cause first/);
  const working = m.brief({ stack: null, row: { name: "web" }, container: c, lines: [], build: { title: "Rebuild web", failed: null, lines: ["step"] } });
  assert.match(working, /printed \(it is still working\):\nstep/);
  assert.equal(m.brief({ stack: null, row: { name: "web" }, container: c, lines: [], build: { title: "x", failed: "1", lines: [] } }).includes("printed"), false);
});

test("p opens the build output only while a build or bring-up has a terminal open", () => {
  const item = { kind: "row", group: { name: "p", managed: true } };
  assert.deepEqual(m.keyAction("p", item, { output: true }), { on: "row", action: "output" });
  assert.equal(m.keyAction("p", item, {}), null);
  assert.ok(m.coreHints(item, { output: true }).some(([k, what]) => k === "p" && what === "build output"));
});
