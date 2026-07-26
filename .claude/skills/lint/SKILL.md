---
description: Run all linters, format checks, and the TypeScript compiler across all workspaces
user_invocable: true
---

Run all static checks for the repo, from the repo root. Run the three in parallel:

```bash
npm run lint            # ESLint (flat config, typescript-eslint) across the repo
npm run format:check    # Prettier check
npm run typecheck       # tsc --noEmit in every workspace (--workspaces --if-present)
```

If the user passed `--fix`, instead run `npm run lint:fix` and `npm run format`, then re-run the checks.

Report a summary: which checks passed, which failed, and the specific errors (file:line) for anything that failed.

Never fix a failure by disabling a rule — see Lint Discipline in `CLAUDE.md`.
