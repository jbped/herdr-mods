// Neovim as Wingman's editor (setting "editor": "nvim"): one Neovim per space, in a terminal
// beside the Wingman pane, started with --listen so later files open in it through --remote-send.
// On Windows it's a native nvim.exe when one is on PATH, else WSL's nvim.
import { exec, appHome, terminals, run } from "herdr";

const onWindows = () => /^[A-Za-z]:/.test(appHome());
let runner = null; // "native" | "wsl", found once

async function where() {
  if (runner) return runner;
  if (!onWindows()) return (runner = "native");
  const r = await exec("where", ["nvim"]).catch(() => ({ code: 1 }));
  return (runner = r.code === 0 ? "native" : "wsl");
}

/** A Windows or WSL UNC path as WSL sees it: C:/x -> /mnt/c/x, //wsl.localhost/Ubuntu/x -> /x. */
export function wslPath(p) {
  const s = p.replace(/\\/g, "/");
  const unc = /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+(\/.*)$/i.exec(s);
  if (unc) return unc[1];
  const m = /^([A-Za-z]):\/(.*)$/.exec(s);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2]}` : s;
}

/** A path as an Ex command argument, inside keys sent with --remote-send. */
export function exArg(p) {
  return p.replace(/[ \\%#|"]/g, "\\$&").replace(/</g, "<lt>");
}

const socketFor = (space, how) => (how === "wsl" || !onWindows() ? `/tmp/wingman-nvim-${space}.sock` : `\\\\.\\pipe\\wingman-nvim-${space}`);

// Buffers reload when the file changes on disk (the agent's writes) unless they hold unsaved edits.
const INIT = "set autoread | call timer_start(1000, {-> execute('silent! checktime')}, {'repeat': -1})";

/** The space's Neovim terminal, if it's still running. */
function liveTerminal(sock) {
  return terminals().find((t) => t.state === "live" && (t.argv ?? []).includes(sock));
}

/**
 * Opens `path` at `line` (0-based) in the space's Neovim, starting one in `root` (beside the
 * focused pane) when there's none, and focuses it.
 */
export async function openInNvim(space, root, path, line) {
  const how = await where(), sock = socketFor(space, how);
  const file = how === "wsl" ? wslPath(path) : path.replace(/\\/g, "/");
  const t = liveTerminal(sock);
  if (t) {
    const keys = `<C-\\><C-N>:drop +${line + 1} ${exArg(file)}<CR>zz`;
    const args = ["--server", sock, "--remote-send", keys];
    const r = how === "wsl" ? await exec("wsl.exe", ["-e", "nvim", ...args]) : await exec("nvim", args);
    if (r.code !== 0) throw new Error(`nvim: ${(r.stderr || r.stdout).trim()}`);
    run("pane.focus", { terminal: t.address });
    return;
  }
  const nv = ["nvim", "--listen", sock, "-c", INIT, `+${line + 1}`, file];
  const argv = how === "wsl" ? ["wsl.exe", "--cd", wslPath(root), "-e", ...nv] : nv;
  run("terminal.open", { argv, folder: root, place: "right", name: "Neovim" });
}

// ---- E9: Open in VS Code ------------------------------------------------------

/**
 * Opens `path` at `line`/`col` (0-based) in VS Code with `code -g`. On Windows `code` is a .cmd,
 * so it runs through cmd. A file inside WSL (a \\wsl.localhost path) opens through Remote - WSL.
 */
export async function openInVSCode(path, line, col = 0) {
  const p = path.replace(/\\/g, "/"), at = `:${line + 1}:${col + 1}`;
  const unc = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)$/i.exec(p);
  const args = unc ? ["--remote", `wsl+${unc[1]}`, "-g", unc[2] + at] : ["-g", p + at];
  const r = onWindows() ? await exec("cmd", ["/d", "/c", "code", ...args]) : await exec("code", args);
  if (r.code !== 0) throw new Error(`code: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
}
