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

// ---- E9: Open in an external editor ---------------------------------------------

/** The editors offered in Settings. "vscode" ones take -g path:line:col and open WSL files through
 *  Remote - WSL; "colon" ones take path:line:col. "custom" runs the user's command template. */
export const EDITORS = {
  code: { name: "VS Code", cmd: "code", style: "vscode" },
  cursor: { name: "Cursor", cmd: "cursor", style: "vscode" },
  windsurf: { name: "Windsurf", cmd: "windsurf", style: "vscode" },
  zed: { name: "Zed", cmd: "zed", style: "colon" },
  subl: { name: "Sublime Text", cmd: "subl", style: "colon" },
  custom: { name: "Custom", cmd: null, style: "custom" },
};

export const editorName = (id) => (EDITORS[id] ?? EDITORS.code).name;

/** A command template split into words ("quotes" keep spaces), with {path}, {line} and {col} filled in each. */
export function fillTemplate(template, path, line, col) {
  const words = [...template.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  return words.map((w) => w.replaceAll("{path}", path).replaceAll("{line}", String(line)).replaceAll("{col}", String(col)));
}

/** The command and arguments that open `path` at 1-based line/col in editor `id`. */
export function editorArgv(id, path, line, col, template = "") {
  const ed = EDITORS[id] ?? EDITORS.code, p = path.replace(/\\/g, "/"), at = `:${line}:${col}`;
  if (ed.style === "custom") {
    const argv = fillTemplate(template, p, line, col);
    if (!argv.length) throw new Error("Set the custom editor command in Settings");
    return argv;
  }
  if (ed.style === "colon") return [ed.cmd, p + at];
  const unc = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)$/i.exec(p);
  return [ed.cmd, ...(unc ? ["--remote", `wsl+${unc[1]}`, "-g", unc[2] + at] : ["-g", p + at])];
}

// cmd.exe re-reads its command line, so a .cmd launcher only gets arguments without these.
const CMD_UNSAFE = /[&|<>^%!"\r\n]/;

/**
 * Opens `path` at `line`/`col` (0-based) in the chosen editor. On Windows an .exe on PATH runs
 * directly; a .cmd/.bat launcher (VS Code's `code`) runs through cmd, refusing arguments cmd would
 * read as commands.
 */
export async function openInEditor(id, path, line, col = 0, template = "") {
  const [cmd, ...args] = editorArgv(id, path, line + 1, col + 1, template);
  let r;
  if (onWindows()) {
    const found = await exec("where", [cmd]).catch(() => ({ code: 1, stdout: "" }));
    const first = found.code === 0 ? found.stdout.split(/\r?\n/).find(Boolean) ?? "" : "";
    if (/\.exe$/i.test(first)) r = await exec(first, args);
    else {
      if ([cmd, ...args].some((a) => CMD_UNSAFE.test(a))) throw new Error(`${cmd}: the path has characters cmd.exe can't pass safely`);
      r = await exec("cmd", ["/d", "/c", cmd, ...args]);
    }
  } else r = await exec(cmd, args);
  if (r.code !== 0) throw new Error(`${cmd}: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
}
