# Moddr

A dialog that lists the person's own mods, the GitHub folder each was installed from, and whether that folder has new commits since. It finds the installed version by hashing the local files and matching them to an upstream commit, shows the new commit messages, and flags local edits. Nothing is checked until the person refreshes.

![Moddr](preview.png)

## What you see

- A dialog 560px wide and 70% of the window high, on `popover`.
- Header, 40px with a bottom border: "Mods" in 13px semibold, a summary in 11.5px `dim` ("3 of 4 tracked · 1 with updates · checked 5m"), and a "Refresh" button on `raised` at the right ("Refreshing…" while it runs, `dim` and inert with nothing tracked).
- An error line in 11.5px `blocked` when `moddr.json` is invalid or cannot be saved.
- While a source is typed: a box on `raised` with "Source of <name>: a GitHub folder holding the mod or its share" in 12px `muted`, a 28px input with a 1px `input` border on `background`, "Looking it up on GitHub…" in `accent` while it resolves, the error in `blocked`, and "enter saves · escape cancels" in 11px `dim`.
- Rows, one per mod folder Herdr did not ship, sorted by name, the only part that scrolls. 14px side and 8px vertical padding, bottom border. The name in 13px semibold, the source as "owner/repo · path" in 11.5px `dim`, and a badge at the right: 11px text and a 1px border in one color, 6px side padding, radius 4.
  - Badges: "no source" `dim`, "not checked" `muted`, "checking" `accent`, "error" `blocked`, "unknown version" `working`, "N updates" `done`, "edited here" `working`, "up to date" `idle`.
- The selected row is on `selected` and opens its details in 12px: the source URL in `dim`, the error in `blocked`, "New upstream since <sha7>:" then up to 8 commits (sha7 in `dim` 52px wide, the message truncated, the age at the right), "and N older", "Changed here since <sha7>: files" in `working`, and buttons "Set source"/"Change source", "Check", "Mark installed" (unknown version only) and "Stop tracking".
- Legend, 28px with a top border, 11px, keys in `accent`: "j/k move", "r refresh", "s source", "m mark installed", "? keys". `?` swaps it for every key on `raised`.
- Empty: "No mods of your own in the mods folder." centered in `dim`.

## How it behaves

- `ctrl-shift-g` (or the palette entry "Moddr: Open") opens it. Again closes it.
- Keys: `j`/`k` and arrows move, `g`/`G` first/last, `ctrl-d`/`ctrl-u` move 6, `r` refreshes every tracked mod one at a time, `enter` refreshes the selected one, `s` opens the source box (filled with the current source, else the first GitHub link in the mod's README), `m` saves the newest upstream commit as installed, `x` stops tracking, `?` toggles the key list, `q`/`escape` closes. In the source box only `escape` (cancel) and `enter` (save) act.
- Saving a source parses the URL, then reads the repo's newest tree and accepts the folder when it holds `main.js`, else `<folder>/mods/<name>/main.js`. The resolved path is saved and that mod is checked at once.
- A check: hash local files with git; list the last 30 commits touching the folder; compare with the newest tree; when unequal and no installed version is saved, try the next 10 commits' trees; updates are the commits newer than the installed one; edits are files differing from the installed tree.
- After a refresh that found updates, `notify()` posts "<name> has an update" or "N mods have updates" with the names, and an action `mod.open moddr`.
- Ages read "now", "5m", "3h", "2d", then "Nov 16".

## Built from

- One mod, `moddr`: `main.js` (the dialog), `track.js` (Source parsing, GitHub calls through an injected `io`, the comparison, no Herdr imports), `store.js` (the file, the mods list, hashing).
- `mod.json`: `{ "place": "none", "title": "Moddr", "overlay": { "kind": "dialog", "width": 560, "height": 0.7 }, "palette": [ … "Moddr: Open" → mod.open moddr ] }`.
- `herdr` functions: `appHome`, `exec`, `readTextFile`, `writeTextFile`, `props`, `closeOverlay`, `notify`, `theme`, `checking`. `fs/promises` `readdir` with `withFileTypes`. `fetch`. `gpui-base`: `InputState`, `Input`, `ScrollHandle`.
- Programs: `git hash-object --no-filters -- <paths>` in the mod's folder.
- GitHub REST: `GET /repos/{o}/{r}/commits?sha&path&per_page=30` and `GET /repos/{o}/{r}/git/trees/{commit}?recursive=1`, with `Authorization: Bearer` only when `moddr.json` has `token`.
- Files: reads `installed.json` (its keys are Herdr's shipped mods) and each mod's `README.md`. Reads and writes `moddr.json` with the expected-text guard of `writeTextFile`.
- `keys.json`: `"ctrl-shift-g": "mod.open:moddr"`.

## Watch out

- Hash with git, not by reading text: `readTextFile` cannot read binary files, and the hashes must equal GitHub's blob shas. `--no-filters` keeps a Windows git's autocrlf from changing them.
- Skip `jsconfig.json` and `*.d.ts`: Herdr writes them into every mod folder, so they would always differ.
- Keep `installed` on the record, not in `check`. The badge reads `entry.installed`.
- A share URL names the share folder. Resolve to `mods/<name>/` before listing commits, or README edits count as updates.
- Unsigned GitHub requests are limited to 60 an hour. Refresh only on request, and say so plainly when GitHub answers 403 "rate limit".
- `init` runs during `herdr-app check`: return before any file or network work when `checking()` is true.
- Closing the dialog cancels a refresh. Each mod's result is saved as it finishes, so finished ones stay.

## Done when

- `herdr-app check` passes.
- A mod folder Herdr shipped is not listed.
- Setting a share URL on a mod saves the resolved `mods/<name>` path and checks it.
- A copy of an older version shows "N updates" with the right commit messages, and the current version shows "up to date".
- A copy with one file changed shows "unknown version" with that file. After `m` it shows "edited here".
- A refresh that finds updates posts a notification.
- `node --test moddr/tests/*.test.mjs` passes.
