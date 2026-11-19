# Moddr reference

Moddr lists the folders in `~/.config/herdr-app/mods/` that Herdr did not ship, and compares each tracked one with its Source on GitHub.

## Terms

- **Source**: the GitHub folder a mod was installed from: owner, repo, branch (or the default branch) and the path of the mod's own folder.
- **Installed version**: the newest upstream commit, among the last 30 that touched the Source, whose files equal the local files.
- **Update**: a commit that touched the Source after the installed version.

## States

| Badge | Meaning |
|---|---|
| no source | not tracked |
| not checked | tracked, never refreshed |
| checking | a refresh of this mod is running |
| up to date | the local files equal the newest upstream version |
| N updates | N commits touched the Source after the installed version. "30+" when the installed version is older than the last 30 |
| edited here | no updates, and local files differ from the installed version |
| unknown version | the local files match none of the newest 11 versions, and no installed version is saved |
| error | the last refresh failed. The message is under the row |

A mod with updates and local edits shows the updates badge and both lists.

## Keys

| Key | Action |
|---|---|
| `j` / `down`, `k` / `up` | move |
| `g` / `home`, `G` / `end` | first / last |
| `ctrl-d` / `ctrl-u` | move 6 |
| `r` | refresh every tracked mod, one at a time |
| `enter` | refresh the selected mod |
| `s` | set or change the selected mod's source |
| `m` | save the newest upstream version as installed (after a refresh) |
| `x` | stop tracking the selected mod |
| `?` | every key |
| `q` / `escape` | close. In the source box, `escape` cancels and `enter` saves |

## Sources

The source box takes:

- `https://github.com/<owner>/<repo>/tree/<branch>/<folder>`
- `https://github.com/<owner>/<repo>`
- `<owner>/<repo>/<folder>`

The folder may be the mod's own folder or a share folder that holds it at `mods/<name>/`. Moddr checks that `main.js` is there before it saves. A branch name with a `/` in it is not supported.

When a mod has no source, the first GitHub link in its `README.md` is filled in for you.

## How a refresh works

For each tracked mod:

1. `git hash-object --no-filters` hashes every local file, as git would for a commit. `jsconfig.json`, `*.d.ts`, dot files and `node_modules` are skipped: Herdr writes the first two into every mod folder.
2. GitHub lists the last 30 commits that touched the Source folder, and the file tree at the newest one. Equal hashes mean up to date, and the newest commit is saved as installed.
3. Otherwise, with no installed version saved, the trees of the next 10 commits are tried, newest first. The first match is saved as installed.
4. The commits newer than the installed version are the updates. The installed version's tree gives the locally edited files.

A current mod takes 2 requests. One behind or edited takes 3. An unknown one takes up to 12.

When updates are found, a notification names the mods. Clicking it opens Moddr.

Reinstalling a mod needs no step in Moddr: the next refresh finds the new files' version.

## moddr.json

`~/.config/herdr-app/moddr.json`, written by Moddr:

```json
{
  "token": "github_pat_...",
  "mods": {
    "notifyr": {
      "source": { "owner": "jbped", "repo": "herdr-mods", "ref": "main", "path": "notifyr/mods/notifyr" },
      "installed": "3ca957c32b5f48552d8f7870a8c9274b78bfeb30",
      "tracked": 1763550000000,
      "check": { "at": 1763550000000, "latest": { "sha": "…", "message": "…", "date": "…" }, "behind": [], "more": false, "edited": [], "error": null }
    }
  }
}
```

- `token` is optional and only added by hand. With it, requests are signed and GitHub allows 5,000 an hour. A fine-grained token with no permissions is enough for public repos. Moddr keeps it in this file as plain text and sends it only to api.github.com.
- A write that finds the file changed by another copy reads it again and keeps that copy's other mods.

## Limits

- GitHub only, public repos only (a token with repo access also reads private ones).
- 30 commits are read per Source. Older updates show as "30+".
- A repo too big for GitHub to list in one tree answer cannot be checked.
- Moddr does not install updates. Reinstall the mod as you installed it, then refresh.
