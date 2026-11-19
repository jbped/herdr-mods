# Moddr

Lists the mods you installed, where each came from on GitHub, and whether that source has changed since you installed it.

![Moddr](preview.png)

## Features

- **Update check.** Refresh asks GitHub about every tracked mod and marks the ones with new commits. Nothing is checked on its own.
- **What changed.** A mod with updates lists the new commits that touched its folder, newest first, with their messages and ages.
- **Installed version found from the files.** Moddr hashes the files you have and finds the upstream commit they match, so it knows what you installed without being told.
- **Local edits.** A mod you changed by hand shows "edited here" and the files that differ from the installed version.
- **A toast when updates turn up.** A refresh that finds updates posts a notification that opens the list.
- **Sources from a URL.** Paste a GitHub folder link: the mod's own folder, or the share folder that holds it under `mods/<name>/`. A README that links a GitHub folder is offered as the source.
- **Your mods only.** Herdr's shipped mods update with Herdr and are left out.
- **Vim keys.** `j` and `k` move, `r` refreshes, `s` sets a source, `m` marks the newest version installed, `x` stops tracking.

## Needs

- Herdr and git. Sources must be public GitHub repos.
- It runs `git hash-object` on the files in your mods folder. It reads `installed.json` and each mod's `README.md`, and writes `moddr.json` in the Herdr config folder.
- It calls the GitHub API (api.github.com) when you refresh or set a source. Without a token GitHub allows 60 requests an hour, and each tracked mod takes two or more.

## Install

Tell your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/jbped/herdr-mods/tree/main/moddr
```

Or by hand:

1. Copy `mods/moddr/` to `~/.config/herdr-app/mods/`.
2. Merge `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-shift-g`.
3. Run `herdr-app check ~/.config/herdr-app/mods/moddr`.

## Use

Press the key or pick "Moddr: Open" in the palette. Select a mod, press `s` and paste the GitHub folder you installed it from, then press `r` to check every tracked mod. Click a row to select it and use its buttons.

| Key | Action |
|---|---|
| `ctrl-shift-g` | open the list, again closes it |
| `j` / `k` | down / up |
| `r` | refresh every tracked mod |
| `enter` | refresh the selected mod |
| `s` | set or change the source |
| `m` | count the newest upstream version as installed |
| `x` | stop tracking |
| `q` or `escape` | close |

Every state, how the installed version is found, `moddr.json`, the token and the limits: [`mods/moddr/README.md`](mods/moddr/README.md).
