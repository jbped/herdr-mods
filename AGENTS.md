## Agent skills

### Issue tracker

Issues live in GitHub Issues for jbped/herdr-mods, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## Worktrees

Do all work in a git worktree under `.worktrees/` at the repo root, one per task or branch. Never edit, commit or switch branches in the main checkout. It stays on `main`, and other sessions share it.

```sh
git worktree add .worktrees/<task> -b <branch> main
```

`.worktrees/` is gitignored. Remove a worktree with `git worktree remove .worktrees/<task>` once its branch is merged.
