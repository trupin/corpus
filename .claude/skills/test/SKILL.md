---
description: Run the Vitest suite, optionally scoped to a workspace or test name; e2e via Playwright
user_invocable: true
---

Run the project's tests (Vitest) from the repo root.

Parse the user's arguments:

- No args → `npm test` (all workspaces)
- A workspace/domain name (`server`, `cli`, `ui`, `contract`, `kit`) → `npx vitest run apps/<name>` or `npx vitest run packages/<name>` (whichever exists)
- A test name/pattern → `npx vitest run -t "<pattern>"`
- Both → combine path filter and `-t`
- `e2e` → `npm run e2e` (Playwright; requires the app to be runnable — skips with a notice when no specs exist in `apps/ui/e2e/`)

Report the results: number of tests passed/failed per workspace, and full failure details for anything that failed.
