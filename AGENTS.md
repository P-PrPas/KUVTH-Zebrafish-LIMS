# Workspace rules

- Work only in the primary repository at `C:\Code\Freelance\VETKU`.
- Use Git branches and checkout in this repository. Do not create separate worktrees, repository copies, or temporary project folders beside it in `C:\Code\Freelance`, unless the user explicitly requests them.
- Before switching branches, inspect `git status`. Preserve uncommitted and untracked user work; never reset, clean, overwrite, or stash it without authorization. If a safe checkout is blocked, explain the conflict before proceeding.
- Keep necessary temporary test artifacts inside the repository in an ignored location. Remove artifacts created for the task when finished; do not delete pre-existing user files.
- Preserve running application containers, database volumes, and real accounts during development and cleanup unless the user explicitly requests changes to them.
- Before recursive cleanup, verify the absolute target path and restrict deletion to the explicitly authorized folders. Remove Git worktrees through Git and handle directory junctions without deleting their targets.
