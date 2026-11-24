## Agent skills

### Issue tracker

Issues live in GitHub Issues for jbped/herdr-mods, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## Shares

Each top-level folder with `mods/` is one share. Before adding a share, or changing a mod's features, keys, config, install steps or look, read `docs/agents/shares.md`. `./check.sh` prints `ok` before every commit that touches a share.

Before adding or changing a mod's keys, read `docs/agents/keys.md`. Every mod uses the same key for the same idea.

## Worktrees

Do all work in a git worktree under `.worktrees/` at the repo root, one per task or branch. Never edit, commit or switch branches in the main checkout. It stays on `main`, and other sessions share it.

```sh
git worktree add .worktrees/<task> -b <branch> main
```

`.worktrees/` is gitignored. Remove a worktree with `git worktree remove .worktrees/<task>` once its branch is merged.

## Testing mods

Test every mod on screen in a private Herdr app with `tools/private-app/private-app`: `start --mod <mod folder>`, then `app <name> check ...`, `app <name> do ...`, `shot <name>`, and `stop <name>` at the end. Never test by copying a mod into the running Herdr (`~/.config/herdr-app/mods`). That has crashed it. Use a committed copy of the mod (`git archive`) when someone else may be editing the working tree. See `tools/private-app/README.md`. `tools/private-app/selftest.sh` checks the tool itself.
