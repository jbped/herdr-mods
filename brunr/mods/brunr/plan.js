// @ts-nocheck
// The Run planner: a Collection, a target and the chosen Environments to the `bru run` command.
// Pure: no Herdr, no Node APIs.
import { countRequests, findNode } from "./parser.js";

/** ms for a single Request Run. */
export const SINGLE_TIMEOUT = 60000;
/** ms for a folder or Collection Run, which is also the exec cap. */
export const MULTI_TIMEOUT = 600000;

const relPath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");

/**
 * `{ cmd, args, cwd, timeout, count, confirm }` for one Run. `target` is `{ kind: "collection" }`
 * or `{ kind: "folder" | "request", path }`. Each argument is one array item and is never quoted.
 * `envVars` (`{ name: value }`) replaces those Environment variables for this Run only.
 */
export function planRun({ collection, target, environment = null, globalEnvironment = null, workspacePath = null, reportPath, envVars = null }) {
  const kind = target?.kind === "folder" || target?.kind === "request" ? target.kind : "collection";
  const path = kind === "collection" ? "" : relPath(target.path);
  const args = ["run"];
  if (path) args.push(path);
  if (kind === "folder") args.push("-r");
  if (environment) args.push("--env", environment);
  if (globalEnvironment && workspacePath) {
    args.push("--global-env", globalEnvironment, "--workspace-path", String(workspacePath).replace(/\\/g, "/"));
  }
  for (const [name, value] of Object.entries(envVars ?? {})) args.push("--env-var", `${name}=${value}`);
  args.push("--reporter-json", String(reportPath ?? ""));
  const count = runCount(collection, kind, path);
  return {
    cmd: "bru", args, cwd: collection?.root ?? "",
    timeout: kind === "request" ? SINGLE_TIMEOUT : MULTI_TIMEOUT,
    count,
    confirm: kind === "request" ? null : { count, environment: environment || null },
  };
}

/**
 * The Request nodes a Run sends, in the order the Bruno CLI sends them. In each folder the CLI
 * sends its subfolders first, then its Requests. Subfolders sort by folder name, then each one
 * with a `seq` moves to place `seq`. Requests sort by `seq`, a missing one counting as 1, and keep
 * the folder's listing order on a tie, taken here as the file name ignoring case.
 */
export function plannedRequests(collection, target) {
  const kind = target?.kind === "folder" || target?.kind === "request" ? target.kind : "collection";
  if (kind === "collection") return cliOrder(collection?.children);
  const path = relPath(target.path);
  const node = findNode(collection, path);
  if (kind === "request") return node?.broken ? [] : [node?.kind === "request" ? node : { kind: "request", name: path.slice(path.lastIndexOf("/") + 1), path }];
  return node?.kind === "folder" ? cliOrder(node.children) : [];
}

const fileName = (n) => n.path.slice(n.path.lastIndexOf("/") + 1);
const validSeq = (s) => Number.isInteger(s) && s > 0;

function cliOrder(nodes) {
  const folders = placeBySeq((nodes ?? []).filter((n) => n.kind === "folder"));
  const upper = (n) => fileName(n).toUpperCase();
  const requests = (nodes ?? []).filter((n) => n.kind === "request" && !n.broken)
    .sort((a, b) => (upper(a) < upper(b) ? -1 : upper(a) > upper(b) ? 1 : 0))
    .sort((a, b) => (a.seq ?? 1) - (b.seq ?? 1));
  return [...folders.flatMap((f) => cliOrder(f.children)), ...requests];
}

/** The CLI's folder order: by name, then each folder with a valid seq inserted at place seq. */
function placeBySeq(folders) {
  const byName = [...folders].sort((a, b) => fileName(a).localeCompare(fileName(b)));
  const out = byName.filter((f) => !validSeq(f.seq));
  for (const f of byName.filter((x) => validSeq(x.seq)).sort((a, b) => a.seq - b.seq)) {
    const at = f.seq - 1;
    const there = out[at];
    if (Array.isArray(there) ? there[0].seq === f.seq : there?.seq === f.seq) out.splice(at, 1, [].concat(there, f));
    else out.splice(at, 0, f);
  }
  return out.flat();
}

function runCount(collection, kind, path) {
  if (kind === "collection") return countRequests(collection);
  const node = findNode(collection, path);
  if (node) return countRequests(node);
  return kind === "request" ? 1 : 0;
}
