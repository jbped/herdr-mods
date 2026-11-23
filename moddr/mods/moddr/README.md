# Moddr reference

Moddr lists the folders in `~/.config/herdr-app/mods/` that Herdr did not ship, finds where each came from on GitHub, and compares each tracked one with its source.

## Terms

- **Source**: the GitHub folder a mod was installed from: owner, repo, branch (or the default branch) and the path of the mod's own folder.
- **Installed version**: the newest upstream commit, among the last 30 that touched the source, whose files equal the local files.
- **Update**: a commit that touched the source after the installed version.
- **Trusted repo**: a repo where a mod is tracked even when its files match no recent version. See Finding sources.

## Views

- **List**: a dialog, opened by `ctrl-shift-g`, the palette's "Moddr: Open" or the badge.
- **Badge**: a block in your layout, `{ "mod": "moddr", "props": { "badge": true } }`, 48px wide fits. A box icon in `muted`, or in `done` with the number of mods with updates. A spinner while a refresh runs. The tooltip names the mods with updates, or the last error. A click opens the list. `"bare": true` drops its background and top border.

## States

| Badge | Meaning |
|---|---|
| no source | not tracked. The details say whether Moddr looked, what it found, or that you stopped tracking it |
| not checked | tracked, never checked |
| checking | a check of this mod is running |
| up to date | the local files equal the newest upstream version |
| N updates | N commits touched the source after the installed version. "30+" when the installed version is older than the last 30 |
| edited here | no updates, and local files differ from the installed version |
| unknown version | the local files match none of the newest 11 versions, and no installed version is saved |
| error | the last check failed. The message is under the row |

A mod with updates and local edits shows the updates badge and both lists. A source Moddr found itself says "(found by Moddr)".

## Keys

| Key | Action |
|---|---|
| `j` / `down`, `k` / `up` | move |
| `g` / `home`, `G` / `end` | first / last |
| `ctrl-d` / `ctrl-u` | move 6 |
| `r` | refresh: look for sources not looked for this week, then check every tracked mod |
| `f` | refresh, looking again for every untracked mod's source |
| `enter` | check the selected mod |
| `s` | set or change the selected mod's source |
| `m` | save the newest upstream version as installed (unknown version only) |
| `x` | stop tracking the selected mod. Moddr stops looking for its source until you set one |
| `?` | every key |
| `q` / `escape` | close. In the source box, `escape` cancels and `enter` saves |

## When it refreshes

- The badge looks 30 seconds after Herdr starts and then every 10 minutes. It refreshes when the last refresh is older than `every_hours`.
- The list refreshes when it opens and one is due.
- `r` and `f` refresh at once.
- One copy refreshes at a time. Another copy that wants to meanwhile skips, and the list shows "checking in the background…" and loads the results when it ends.
- After a refresh GitHub cut short, the next one is due after an hour.

## Finding sources

A refresh looks for each untracked mod not looked for in the last 7 days (`f`: all of them). It tries, in order:

1. Repos linked from any mod's `README.md`, repos of tracked mods, and `repos` from `moddr.json`. These are trusted.
2. With `search` on, for each mod still not found: trusted repos found during this refresh, then the top 3 repos GitHub's search returns for `<name> in:name,description,readme topic:herdr-mod`.
3. Once more, the trusted repos, for mods looked up before a repo became trusted.

In each repo, a folder named like the mod with a `main.js` in it is a match: `mods/<name>/` first, then the shallowest. The repo's default branch is used.

- The files match a version: the mod is tracked, and the repo becomes trusted.
- The files match no version and the repo is trusted: the mod is tracked with an unknown version.
- The files match no version and the repo came from search: the folder is offered, not tracked. `s` fills it in.

## Sources by hand

The source box takes `https://github.com/<owner>/<repo>/tree/<branch>/<folder>`, `https://github.com/<owner>/<repo>` or `<owner>/<repo>/<folder>`. The folder may be the mod's own or a share folder holding it at `mods/<name>/`. Moddr checks that `main.js` is there before it saves. A branch name with a `/` in it is not supported. The box is filled with the current source, else the folder Moddr offered, else the first GitHub link in the mod's README.

## How a check works

1. `git hash-object --no-filters` hashes every local file, as git would for a commit. `jsconfig.json`, `*.d.ts`, dot files and `node_modules` are skipped: Herdr writes the first two into every mod folder.
2. GitHub lists the last 30 commits that touched the source folder, and the file tree at the newest one. Equal hashes mean up to date, and the newest commit is saved as installed.
3. Otherwise, with no installed version saved, the trees of the next 10 commits are tried, newest first. The first match is saved as installed. That search is not repeated until the local files or the newest commit change.
4. The commits newer than the installed version are the updates. The installed version's tree gives the locally edited files.

A current mod takes 2 requests, one behind or edited 3, an unknown one 12 the first time and 2 after. Finding sources takes 1 request per repo, 1 per search, and a check per folder found.

Each update is notified once: a refresh that finds a newer upstream commit than the last one notified posts a toast naming the mods. Clicking it opens the list.

Reinstalling a mod needs no step in Moddr: the next check finds the new files' version.

## Signing in

GitHub requests use the first of:

1. `token` in `moddr.json`.
2. The token `gh auth token --hostname github.com` prints, when the GitHub CLI is installed and signed in where Herdr runs. The list asks each time it opens, the badge before its first refresh. The token is kept in memory only.
3. Nothing: unsigned requests, 60 an hour (10 searches a minute), public repos only.

The list's header ends with which one is in use. On Windows, gh must be installed on Windows itself: a gh inside WSL is not seen.

## moddr.json

`~/.config/herdr-app/moddr.json`, written by Moddr. The settings are added by hand:

```json
{
  "every_hours": 6,
  "search": true,
  "repos": ["jbped/herdr-mods"],
  "token": "github_pat_...",
  "lastRun": { "at": 1763550000000, "error": null },
  "mods": {
    "notifyr": {
      "source": { "owner": "jbped", "repo": "herdr-mods", "ref": null, "path": "notifyr/mods/notifyr" },
      "installed": "3ca957c32b5f48552d8f7870a8c9274b78bfeb30",
      "found": true,
      "notified": "add86772c617d859ce899a9aab9cda33cd7897b0",
      "check": { "at": 1763550000000, "latest": { "sha": "…", "message": "…", "date": "…" }, "behind": [], "more": false, "edited": [], "fp": "1a2b3c4d", "error": null }
    },
    "artifacts": { "discovered": 1763550000000, "candidate": { "owner": "…", "repo": "…", "ref": null, "path": "artifacts" } },
    "old-thing": { "ignored": true }
  }
}
```

| Setting | Default | Meaning |
|---|---|---|
| `every_hours` | `6` | hours between automatic refreshes, at least 1. `0` refreshes only when you press `r` or `f` |
| `search` | `true` | look for sources in GitHub's `herdr-mod` repos. `false` uses only the README links, tracked repos and `repos` |
| `repos` | `[]` | repos to look in first, trusted, as `owner/repo` or a GitHub URL |
| `token` | none | a GitHub token. It wins over gh's. A fine-grained token with no permissions is enough for public repos. It is kept here as plain text: prefer gh, which keeps its token in the system's keyring |

A write that finds the file changed by another copy reads it again and keeps that copy's other mods.

## Limits

- GitHub.com only. Private repos need gh or a token with access to them.
- 30 commits are read per source. Older updates show as "30+".
- A repo too big for GitHub to list in one tree answer cannot be searched or checked.
- A found source follows the repo's default branch. Set the source by hand to follow another branch.
- Background checks run only while the badge is in the shown layout, or the list is open.
- Moddr does not install updates. Reinstall the mod as you installed it, and the next check sees it.
