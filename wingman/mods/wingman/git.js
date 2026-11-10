// Every git (and repo shell) call Wingman makes goes through here, so it runs where the repo
// lives. Linux and macOS: the machine's git. Windows: git for Windows, except for repos WSL owns,
// which run WSL's git through wsl.exe with /mnt/<drive> paths:
// - a repo inside WSL's own files (\\wsl.localhost\<distro>\...), and
// - a repo on a Windows drive that WSL git made: its `.git` file points to a /mnt path (a
//   worktree WSL added), or its config has core.filemode true (Windows git never sets it).
// Windows git can't open the first two and misreads file modes in the third.
import { exec, readTextFile, appHome } from "herdr";

export const onWindows = () => /^[A-Za-z]:/.test(appHome());
const UNC = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i;

// ---- paths (pure) ---------------------------------------------------------------

/** A Windows path as WSL sees it: C:/x -> /mnt/c/x, //wsl.localhost/Ubuntu/home/x -> /home/x. */
export function toWsl(p) {
  const s = p.replace(/\\/g, "/"), unc = UNC.exec(s);
  if (unc) return unc[2] ?? "/";
  const d = /^([A-Za-z]):(\/.*)?$/.exec(s);
  return d ? `/mnt/${d[1].toLowerCase()}${d[2] ?? ""}` : s;
}

/** A path WSL printed, as Windows opens it: /mnt/c/x -> C:/x, /home/x -> //wsl.localhost/<distro>/home/x. */
export function fromWsl(p, distro) {
  const m = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:${m[2] ?? "/"}`;
  return p.startsWith("/") && distro ? `//wsl.localhost/${distro}${p}` : p;
}

/** The distro in a \\wsl.localhost path, or null. */
export const distroOf = (p) => UNC.exec(p.replace(/\\/g, "/"))?.[1] ?? null;

/** An argument for WSL git: Windows absolute paths become /mnt paths; anything else is kept. */
export const wslArg = (a) => (/^(?:[A-Za-z]:[\\/]|\\\\|\/\/(?:wsl\.localhost|wsl\$)\/)/i.test(a) ? toWsl(a) : a);

/** What a repo's `.git` file or config says about who made it: "wsl", "native", or null (no sign). */
export function ownerFrom(gitFile, config) {
  if (gitFile != null) {
    const to = /^gitdir:\s*(.+?)\s*$/m.exec(gitFile)?.[1];
    if (to) return /^\//.test(to) ? "wsl" : "native";
  }
  if (config != null) {
    const core = /^\s*\[core\]([^[]*)/m.exec(config)?.[1] ?? "";
    const fm = /^\s*filemode\s*=\s*(\w+)/im.exec(core)?.[1];
    if (fm) return /^(true|yes|on|1)$/i.test(fm) ? "wsl" : "native";
  }
  return null;
}

// ---- which git ----------------------------------------------------------------

let hasWsl = null, hasNative = null, defaultDistro = null;
const owners = new Map(); // folder -> "wsl" | "native"

async function probe() {
  if (hasWsl !== null) return;
  const [w, n] = await Promise.all([
    exec("wsl.exe", ["-e", "sh", "-c", 'printf %s "$WSL_DISTRO_NAME"'], { timeout: 15000 }).catch(() => ({ code: 1 })),
    exec("where", ["git"]).catch(() => ({ code: 1 })),
  ]);
  hasWsl = w.code === 0; hasNative = n.code === 0;
  defaultDistro = hasWsl ? w.stdout.trim() || null : null;
}

/** The default distro once known (after the first git call), for code that can't wait. */
export const knownDistro = () => defaultDistro;

/** The default WSL distro's name (Windows with WSL), else null. */
export async function wslDistro() { if (onWindows()) await probe(); return defaultDistro; }

/** "wsl" or "native": where git runs for a repo folder (or for no repo, `cwd` null). */
export async function ownerOf(cwd) {
  if (!onWindows()) return "native";
  await probe();
  if (!hasWsl) return "native";
  if (!cwd) return hasNative ? "native" : "wsl";
  const start = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (owners.has(start)) return owners.get(start);
  let owner = UNC.test(start) ? "wsl" : null;
  // Up from the folder to the first .git: a file (a worktree's link) or a folder with a config.
  for (let dir = start, i = 0; !owner && i < 64; i++) {
    const file = await readTextFile(`${dir}/.git`).catch(() => null);
    const config = file == null ? await readTextFile(`${dir}/.git/config`).catch(() => null) : null;
    if (file != null || config != null) { owner = ownerFrom(file, config) ?? "native"; break; }
    const cut = dir.lastIndexOf("/");
    if (cut <= 0 || /^[A-Za-z]:$/.test(dir)) break;
    dir = dir.slice(0, cut);
  }
  owner ??= "native";
  if (owner === "native" && !hasNative) owner = "wsl";
  owners.set(start, owner);
  return owner;
}

/**
 * Runs `cmd args` where the repo at `cwd` lives. For WSL, Windows paths in the arguments become
 * /mnt paths. Windows git ignores file modes (it can't see execute bits).
 */
export async function inRepo(cmd, args, { cwd = null, timeout } = {}) {
  const owner = await ownerOf(cwd), opts = timeout ? { timeout } : {};
  if (owner === "wsl") {
    const at = cwd ? ["--cd", toWsl(cwd)] : [];
    return exec("wsl.exe", [...at, "-e", cmd, ...args.map(wslArg)], opts);
  }
  const fm = onWindows() && cmd === "git" ? ["-c", "core.filemode=false"] : [];
  return exec(cmd, [...fm, ...args], { ...(cwd ? { cwd } : {}), ...opts });
}

/** git in the repo at `cwd` (or with no repo, for --no-index work on temp files). */
export const git = (args, opts = {}) => inRepo("git", args, opts);

/** A path git printed for the repo at `cwd`, as this machine's file calls take it. */
export async function hostOf(p, cwd) {
  const s = p.trim().replace(/\\/g, "/");
  if ((await ownerOf(cwd)) !== "wsl") return s;
  return fromWsl(s, distroOf(cwd ?? "") ?? (await wslDistro()));
}
