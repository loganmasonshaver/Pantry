---
name: commit
description: Stage, commit, and push all changes with a well-structured commit message
---

Commit and push the current changes in the Pantry app.

Follow these steps:

1. Run `git status` to see all modified and untracked files
2. Run `git diff` to understand what actually changed
3. Stage all relevant files — prefer specific file names over `git add -A`. Never stage:
   - `.env` or any file containing secrets
   - `node_modules/`
   - Build artifacts
4. Draft a commit message:
   - First line: short imperative summary under 70 chars (e.g. "feat: add barcode scanner with FatSecret integration")
   - Use prefixes: `feat:` new feature, `fix:` bug fix, `refactor:` cleanup, `chore:` config/deps
   - If multiple features, list them in the body
5. Commit with the message
6. Push to the current branch (`main`)
7. Confirm what was committed and the commit hash

If there is nothing to commit, say so clearly.
