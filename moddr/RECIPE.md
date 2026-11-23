# Moddr

A dialog and a status-bar badge for the person's own mods. Moddr finds the GitHub folder each mod was installed from, works out the installed version by hashing the local files and matching them to an upstream commit, and checks every few hours for new commits. New updates are announced once with a toast, the badge counts them, and the list shows each mod's new commit messages and local edits.

![Moddr](preview.png)

## What you see

- **Badge**: a block the person places, 48px wide in a 28px status row, on `chrome` with a 1px top border in `border`. A 14px box icon (`box.svg`, tinted) in `muted`. With updates, the icon and an 11.8px count beside it are `done`. After a refresh GitHub cut short, the icon is `working`. While a refresh runs, a braille spinner in `accent` replaces the icon. Tooltip: "Updates: a, b", the error, "N tracked mods, none with updates. Checked 5m", or "Moddr has not checked yet", then ". Click to open Moddr (ctrl-shift-g)".
- **List**: a dialog 560px wide and 70% of the window high, on `popover`.
  - Header, 40px with a bottom border: "Mods" in 13px semibold, a summary in 11.5px `dim` ("12 of 14 tracked · 1 with updates · checked 5m · every 6h · unsigned", with "finding sources…", "checking…" or "checking in the background…" in place of the time while a refresh runs), and a "Refresh" button on `raised` ("Refreshing…" and inert while one runs).
  - An error line in 11.5px `blocked` when `moddr.json` or the mods folder cannot be read or written, and one in `working` with the last refresh's error (GitHub's limit).
  - While a source is typed: a box on `raised` with "Source of <name>: a GitHub folder holding the mod or its share" in 12px `muted`, a 28px input with a 1px `input` border on `background`, "Looking it up on GitHub…" in `accent`, the error in `blocked`, and "enter saves · escape cancels" in 11px `dim`.
  - Rows, one per mod folder Herdr did not ship, sorted by name, the only part that scrolls. 14px side and 8px vertical padding, bottom border. Name in 13px semibold, the source as "owner/repo · path" in 11.5px `dim`, and a badge: 11px text and a 1px border in one color, radius 4. "no source" `dim`, "not checked" `muted`, "checking" `accent`, "error" `blocked`, "unknown version" `working`, "N updates" `done`, "edited here" `working`, "up to date" `idle`.
  - The selected row is on `selected` and opens its details in 12px: for an untracked mod why ("Not looked for yet…", "No source found 2d ago…", "<repo · path> has a mod of this name, but the files here match none of its recent versions…", or "Not tracked, and Moddr does not look for its source…"); the source URL in `dim` with "(found by Moddr)"; the error in `blocked`; "New upstream since <sha7>:" and up to 8 commits (sha7 in `dim` 52px wide, the message truncated, the age at the right) and "and N older"; "Changed here since <sha7>: files" in `working`; buttons "Set source"/"Change source", "Check", "Mark installed" (unknown version only) and "Stop tracking".
  - Legend, 28px with a top border, 11px, keys in `accent`: "j/k move", "r refresh", "s source", "m mark installed", "? keys". `?` swaps it for every key on `raised`.

## How it behaves

- `ctrl-shift-g`, the palette entry "Moddr: Open", or a click on the badge opens the list. Again closes it.
- Keys: `j`/`k` and arrows, `g`/`G`, `ctrl-d`/`ctrl-u`; `r` refresh; `f` refresh and look again for every untracked mod; `enter` check the selected mod; `s` source box; `m` save the newest upstream commit as installed; `x` stop tracking (saved as `{ ignored: true }`, never looked for again until a source is set); `?`; `q`/`escape`.
- A refresh: load `moddr.json` and the mods folder; find sources for untracked mods not looked for in 7 days (all with `f`); check every tracked mod not just checked; save `lastRun`; toast the mods whose newest upstream commit was not notified before; share the summary.
- Finding sources: trusted repos first (README links of every mod, repos of tracked mods, `repos` setting), then per remaining mod the trusted repos found so far and the top 3 of GitHub's search `<name> in:name,description,readme topic:herdr-mod`, then the trusted repos once more. A folder named like the mod holding `main.js` (`mods/<name>` first) is checked. A version match tracks it and trusts the repo. A trusted repo tracks it even without a match. A searched repo without a match is only offered.
- A check: hash local files with git; list the last 30 commits touching the folder; compare with the newest tree; when unequal and no installed version is saved, try the next 10 commits' trees, but only once per pair of local fingerprint and newest commit; updates are the commits after the installed one; edits are files differing from the installed tree.
- Automatic refreshes: the badge looks 30 s after start and every 10 min; the list on open. Either refreshes when `lastRun` is older than `every_hours` (default 6, `0` off), or an hour after a refresh GitHub's limit cut short. Shared `moddr.running` keeps it to one copy at a time; shared `moddr.summary` `{ at, updates, tracked, error }` feeds the badge and tells an open list to reload.
- Signing: `moddr.json` `token`, else `gh auth token --hostname github.com` (in memory only), else unsigned.

## Built from

- One mod, `moddr`: `main.js` (both views, chosen by `props().badge`), `engine.js` (the refresh, shared values, notification), `track.js` (sources, GitHub calls through an injected `io`, checks and discovery, no Herdr imports), `store.js` (the file, the mods list, hashing, gh), `box.svg`.
- `mod.json`: `{ "place": "none", "title": "Moddr", "overlay": { "kind": "dialog", "width": 560, "height": 0.7 }, "palette": [ … "Moddr: Open" → mod.open moddr ] }`.
- `herdr` functions: `appHome`, `exec`, `readTextFile`, `writeTextFile`, `props`, `closeOverlay`, `notify`, `run`, `shared`, `setShared`, `theme`, `checking`. `fs/promises` `readdir`. `fetch`. `gpui-base`: `InputState`, `Input`, `ScrollHandle`. `.frames` for the spinner.
- Programs: `git hash-object --no-filters -- <paths>` in the mod's folder; `gh auth token --hostname github.com` (optional).
- GitHub REST: `commits?sha&path&per_page=30`, `git/trees/{commit|HEAD}?recursive=1`, `search/repositories?q=…&per_page=3`, with `Authorization: Bearer` when there is a token.
- Files: reads `installed.json` (its keys are Herdr's shipped mods) and each mod's `README.md`; reads and writes `moddr.json` with `writeTextFile`'s expected-text guard.
- Layout block for the badge: `{ "mod": "moddr", "props": { "badge": true } }`. `keys.json`: `"ctrl-shift-g": "mod.open:moddr"`.

## Watch out

- Hash with git, not by reading text: `readTextFile` cannot read binary files, and the hashes must equal GitHub's blob shas. `--no-filters` keeps a Windows git's autocrlf from changing them.
- Skip `jsconfig.json` and `*.d.ts`: Herdr writes them into every mod folder.
- Keep `installed` on the record, not in `check`. The badge reads `entry.installed`.
- A share URL names the share folder. Resolve to `mods/<name>/` before listing commits, or README edits count as updates.
- GitHub's default repo search does not read READMEs, and a repo of many mods names them only there: add `in:name,description,readme`.
- Mods are looked up in name order, so one can be searched before its repo becomes trusted by a later match. Make a last pass over the trusted repos.
- An unknown version costs 10 extra requests per check. Remember the failed search (`check.fp` and `check.latest`) or every refresh pays it again.
- Unsigned requests are 60 an hour. Stop the whole refresh at the first rate-limit answer, save `lastRun.error`, and retry in an hour.
- A stopped mod must stay stopped: deleting its record would let the next refresh find and track it again.
- `init` runs during `herdr-app check`: return before any file, network or timer work when `checking()` is true.
- Closing the list cancels its refresh. Each mod is saved as it finishes, and a stale `moddr.running` mark is ignored after 20 minutes.
- On Windows, `exec("gh")` finds only a Windows gh. Never write gh's token to a file.

## Done when

- `herdr-app check` passes.
- With no `moddr.json`, the badge's first refresh tracks mods found in a `herdr-mod` repo, shows the number with updates, and posts one toast.
- A copy of an older version shows "N updates" with the right commit messages; the current version shows "up to date"; a copy with one file changed in a trusted repo shows "unknown version" and, after `m`, "edited here".
- A second refresh posts no toast for the same updates.
- `x` then `f` leaves the mod untracked.
- `node --test moddr/tests/*.test.mjs` passes.
