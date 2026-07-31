# [UI-029] React 18 → 19 across apps/ui, packages/kit, plugins

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: UI-016

## Spec References
- None product-behavioral — dependency prerequisite (UI-016's react-router@8 requires React ≥19.2.7)

## Summary
UI-016's blocker (2026-07-31, measured): all react-router 8.x releases declare React
≥19.2.7 peers AND statically import `useOptimistic` (absent in 18) — no legacy-peers
workaround exists, and no router line below 8.3.0 is audit-clean. Upgrade React
18.3.1 → 19.x in apps/ui, packages/kit (peer range widened — the kit-manifest
adjudication is granted HERE, recorded per sprint-018 Adjudication 6's naming), and
plugins' dev deps. Feasibility already measured by UI-016's agent: every other React
consumer accepts 19 (react-query, tiptap, testing-library, react-markdown); zero
React-19-removed patterns in the codebase (/usr/bin/grep audit: no defaultProps,
ReactDOM.render, test-utils, string refs, no-arg useRef, JSX-namespace refs).

## Acceptance Criteria
- [x] React/react-dom 19.x everywhere; kit peer range `^19`; no unmet peers, single hoisted React (`npm ls`)
- [x] Full apps/ui + packages/kit suites green; hermetic e2e green; no behavior deltas beyond React's own (document any act() warnings resolved)
- [x] plugins/ typecheck green against the widened kit peer

## Technical Design
### Files to Create/Modify
- package.json manifests (root/ui/kit/plugins dev), package-lock; code only where React 19 semantics force it (expected: none)

## Testing Strategy
Scoped suites per workspace; the phase gate is the single repo-wide run.

## E2E Verification Plan
Real app smoke walk (board, reader, focus, threads, console) post-upgrade.

## E2E Verification Log

**implemented on: opus** (2026-07-31). Sprint contract `issues/sprints/sprint-020.md`, TEST-733–748;
its premise corrections C1–C3 and adjudications 2 and 3 override this issue's Technical Design.
Scratch `…/tmp/s020-ui/029-w99zoR`. Server `8804`, Vite `5282`,
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790`. `8765` never bound, killed or proxied into; `5173`
(ssh, pid 16094) never taken. No git command was run.

### TEST-733 / TEST-734 — the four manifests, and the granted kit exception

`/usr/bin/grep -rn '"react"\|"react-dom"\|"@types/react"\|"@types/react-dom"' --include=package.json . --exclude-dir=node_modules`
after the change — the four files of C2's table and no others:

```
plugins/todos/package.json:18:    "react": "^19.2.8"          (peer)
plugins/todos/package.json:22:    "@types/react": "^19.2.18",
plugins/todos/package.json:23:    "react": "^19.2.8",
plugins/todos/package.json:24:    "react-dom": "^19.2.8",
plugins/_fixture/package.json:18:  "react": "^19.2.8"          (peer)
plugins/_fixture/package.json:21:  "@types/react": "^19.2.18",
plugins/_fixture/package.json:22:  "react": "^19.2.8"
packages/kit/package.json:48:     "react": "^19"              (peer — the granted widening)
packages/kit/package.json:52:     "@types/react": "^19.2.18",
packages/kit/package.json:53:     "react": "^19.2.8",
packages/kit/package.json:54:     "react-dom": "^19.2.8"
apps/ui/package.json:29:          "react": "^19.2.8",
apps/ui/package.json:30:          "react-dom": "^19.2.8",
apps/ui/package.json:43:          "@types/react": "^19.2.18",
apps/ui/package.json:44:          "@types/react-dom": "^19.2.4",
```

Root manifest **unchanged and still declares no React** — `/usr/bin/grep -n "react" package.json`
returns nothing. Negative evidence that no 18.x survives:
`/usr/bin/grep -rn '"react[^"]*": *"\^18\|"@types/react[^"]*": *"\^18' --include=package.json . --exclude-dir=node_modules`
→ **no matches**.

**TEST-734 — the kit-manifest exception, cited.** Sprint-018 Adjudication 6 forbids `packages/kit`
changes outside a named method; UI-029 is where the permission is granted, and it is used here for
the manifest only (no kit source file was opened). Before/after of the widened peer:

```json
"peerDependencies": { "react": "^18.3.1" }   →   "peerDependencies": { "react": "^19" }
```

Plugin peers moved to `^19.2.8` rather than `^19`: they mirrored the dependency floor exactly before
(`^18.3.1` == `apps/ui`'s floor), so this preserves the existing convention, and TEST-733's `^19`
carve-out is written for the kit peer specifically.

### TEST-735 / TEST-736 / TEST-737 / TEST-738 — the installed tree

The first `npm install` produced **the exact failure TEST-736 exists to catch**, and it is worth
recording: npm kept `react@18.3.1` hoisted at the root (serving the hoisted `@tanstack/react-query`,
`@tiptap/react`, `react-router-dom` and `@testing-library/react`) and pushed `react@19.2.8` into
each of the four workspaces' own `node_modules` — **five copies**, with third-party code on 18 and
application code on 19. `npm ls react react-dom` still exited 0 on that tree, so the tree walk, not
the exit code, is what caught it.

It was not a genuine peer conflict — every consumer's declared range accepts 19:

```
@tiptap/react          {"react":"^17.0.0 || ^18.0.0 || ^19.0.0", "react-dom":"^17.0.0 || ^18.0.0 || ^19.0.0"}
@tanstack/react-query  {"react":"^18 || ^19"}
@testing-library/react {"react":"^18.0.0 || ^19.0.0", "react-dom":"^18.0.0 || ^19.0.0", "@types/react":"^18.0.0 || ^19.0.0", "@types/react-dom":"^18.0.0 || ^19.0.0"}
react-markdown         {"react":">=18", "@types/react":">=18"}
react-router-dom       {"react":">=16.8", "react-dom":">=16.8"}
use-sync-external-store {"react":"^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"}
```

— it was a stale placement carried forward by npm's incremental algorithm. Remedy: the 15
`react`/`react-dom`/`@types/react`/`@types/react-dom` entries were deleted from `package-lock.json`
and their directories removed, then **plain `npm install`** re-resolved them. The lockfile was *not*
regenerated wholesale, so no unrelated dependency floated.

**No escape hatch was used at any point: no `--legacy-peer-deps`, no `--force`, no `npm audit fix`,
no `npm ci`.** Both installs were bare `npm install`.

**TEST-735 / TEST-736** — `npm ls react react-dom` (exit 0), verbatim:

```
corpus-monorepo@0.0.0 /Users/theophanerupin/code/corpus
├─┬ @corpus/kit@0.0.0 -> ./packages/kit
│ ├─┬ @tanstack/react-query@5.101.4
│ │ └── react@19.2.8 deduped
│ ├─┬ @testing-library/react@16.3.2
│ │ ├── react-dom@19.2.8 deduped
│ │ └── react@19.2.8 deduped
│ ├─┬ react-dom@19.2.8
│ │ └── react@19.2.8 deduped
│ ├─┬ react-markdown@9.1.0
│ │ └── react@19.2.8 deduped
│ └── react@19.2.8
├─┬ @corpus/ui@0.0.0 -> ./apps/ui
│ ├─┬ @tiptap/react@2.27.2
│ │ ├── react-dom@19.2.8 deduped
│ │ ├── react@19.2.8 deduped
│ │ └─┬ use-sync-external-store@1.6.0
│ │   └── react@19.2.8 deduped
│ ├── react-dom@19.2.8 deduped
│ ├─┬ react-router-dom@6.30.4
│ │ ├── react-dom@19.2.8 deduped
│ │ ├─┬ react-router@6.30.4
│ │ │ └── react@19.2.8 deduped
│ │ └── react@19.2.8 deduped
│ └── react@19.2.8 deduped
├─┬ corpus-plugin-fixture@0.0.0 -> ./plugins/_fixture
│ └── react@19.2.8 deduped
└─┬ corpus-plugin-todos@0.0.0 -> ./plugins/todos
  ├── react-dom@19.2.8 deduped
  └── react@19.2.8 deduped
```

Resolved **19.2.8 ≥ 19.2.7**, the floor `react-router@8.3.0` declares — UI-016's precondition holds.
Every entry is `deduped` against one hoisted copy. On disk, the only React anywhere is
`node_modules/react → 19.2.8` and `node_modules/react-dom → 19.2.8`; a filesystem walk for nested
`node_modules/react*` directories under `apps`, `packages`, `plugins` and `node_modules` returns
those two paths and nothing else.

**TEST-738** — `npm ls @types/react @types/react-dom` (exit 0); both on 19, peer satisfied:

```
├─┬ @corpus/kit@0.0.0 -> ./packages/kit
│ ├─┬ @testing-library/react@16.3.2
│ │ ├── @types/react-dom@19.2.4 deduped
│ │ └── @types/react@19.2.18 deduped
│ ├── @types/react@19.2.18
│ └─┬ react-markdown@9.1.0
│   └── @types/react@19.2.18 deduped
├─┬ @corpus/ui@0.0.0 -> ./apps/ui
│ ├─┬ @types/react-dom@19.2.4
│ │ └── @types/react@19.2.18 deduped
│ └── @types/react@19.2.18 deduped
```

On disk: `node_modules/@types/react → 19.2.18`, `node_modules/@types/react-dom → 19.2.4`.

**TEST-737 — peers.** `npm ls --all`: **zero `UNMET PEER DEPENDENCY`**. Three `invalid` grep hits,
none React and none new:

1. `brace-expansion@5.0.8 … invalid: "^2.0.1" from node_modules/@redocly/openapi-core/node_modules/minimatch`
   — **pre-existing**, forced deliberately by the root manifest's own
   `overrides: {"@redocly/openapi-core": {"brace-expansion": "^5.0.8"}}` from INFRA-010 (commit
   `b11cea5`). The root manifest was not touched by this issue.
2. `character-reference-invalid@2.0.1` — a package *name* containing the substring.
3. the `npm error invalid:` summary line restating (1).

### TEST-748 — the audit did not get worse

`npm audit --json` after the install — **identical to contract time**:

```
metadata.vulnerabilities: {"info":0,"low":0,"moderate":2,"high":0,"critical":0,"total":2}
vulnerability keys:       react-router,react-router-dom
```

React 19 and `scheduler@0.27.x` entering the tree added nothing. Nothing to escalate; UI-016 still
inherits exactly the two router moderates it is expected to remove.

### TEST-739 — the eight `RefObject` sites, one by one

`@types/react@19` redefines `RefObject<T>` as `{ current: T }` while `useRef<T>(null)` returns
`RefObject<T | null>`. The compiler found the mismatch at the **consumers**; the fix is at the
**declarations**, widened to match what the feeders actually produce. All eight were changed, none
was left alone. Every one of these already null-checks `.current` at runtime, so the widening
documents existing behavior rather than changing it.

| # | Site (pre-change line) | Change | Consumer error it cleared |
| - | ---------------------- | ------ | ------------------------- |
| 1 | `apps/ui/src/reader/popover.ts:52` `usePopoverShift(ref: RefObject<HTMLElement>, …)` | → `RefObject<HTMLElement \| null>` | `CommentsPopover.tsx(41,33)` and `DocMenu.tsx(50,33)` TS2345 |
| 2 | `apps/ui/src/reader/useReaderSurface.ts:48` `scrollRef: RefObject<HTMLDivElement>` | → `RefObject<HTMLDivElement \| null>` | `useReaderSurface.ts(166,5)` TS2322 |
| 3 | `apps/ui/src/anchors/useAnchorLayer.ts:71` `mainRef: RefObject<HTMLDivElement>` | → `RefObject<HTMLDivElement \| null>` | `useAnchorLayer.ts(560,5)` TS2322 |
| 4 | `apps/ui/src/anchors/useAnchorLayer.ts:72` `marginRef: RefObject<HTMLDivElement>` | → `RefObject<HTMLDivElement \| null>` | `useAnchorLayer.ts(561,5)` TS2322 |
| 5 | `apps/ui/src/anchors/useMarginLayout.ts:23` `main: RefObject<HTMLElement>` | → `RefObject<HTMLElement \| null>` | no direct error; fed by (3), so it errors the moment (3) is correct |
| 6 | `apps/ui/src/anchors/useMarginLayout.ts:24` `margin: RefObject<HTMLElement>` | → `RefObject<HTMLElement \| null>` | as (5), fed by (4) |
| 7 | `apps/ui/src/anchors/AnchoredThreads.tsx:72` `innerRef: React.RefObject<HTMLDivElement>` | → `React.RefObject<HTMLDivElement \| null>` | as (5), fed by (4) |
| 8 | `apps/ui/src/keyboard/useRowCursor.ts:30` `board: RefObject<HTMLElement>` | → `RefObject<HTMLElement \| null>` | `Board.tsx(257,33)` TS2322 and `useRowCursor.test.ts(46,42)`/`(134,40)` TS2322 |

Sites 5–7 are the reason the contract enumerated declarations rather than errors: they produce no
diagnostic until their feeders are corrected, so an error-driven migration would have missed them
and left the interfaces internally inconsistent.

The two `useRowCursor.test.ts` errors were cleared **by site 8 alone** — the test helper already
returned `{ readonly current: HTMLElement | null }`, so it was the source declaration that had been
lying. **No test assertion was edited.**

`npm run typecheck` across all workspaces: **exit 0**.

### TEST-740 — `MutableRefObject`, measured (Open Conflict 3)

Read from the installed `node_modules/@types/react/index.d.ts` (`@types/react@19.2.18`), lines
1667–1672, verbatim:

```ts
    /**
     * @deprecated Use `RefObject` instead.
     */
    interface MutableRefObject<T> {
        current: T;
    }
```

**Verdict: it survives, exported, JSDoc-deprecated but not removed.** Whether lint flags it decides
the branch, and it does not: `eslint.config.js:26` enables `tseslint.configs.recommendedTypeChecked`
only, and `@typescript-eslint/no-deprecated` ships in `strictTypeChecked`, not in that preset.
`npm run lint` exits 0 with no findings and no occurrence of "deprecat" in its output.

Per Open Conflict 3's ruling ("do not pre-emptively migrate… that is four unnecessary diffs"), the
four sites are **left unchanged**: `apps/ui/src/editor/RefNodeView.tsx:3,29,37,87` and
`packages/kit/src/markdown/MarkdownView.tsx:1,46`. Leaving them also keeps this issue out of
`packages/kit`'s source, which sprint-018 Adjudication 6 protects.

### TEST-741 — `devRoutes.test.tsx:9`

**Unchanged, unweakened, green.** No `as any`, no `@ts-expect-error`, no deleted expectation; the
assertion still reads:

```ts
expect(route?.props).toMatchObject({ path: DEV_PROBE_PATH });
```

It survives the `ReactElement<P = any → unknown>` default change because the props object is passed
**whole** to `toMatchObject` rather than having a property read off it — `unknown` is assignable to
`expect()`'s parameter, and only member *access* on `unknown` would have failed.

### The one real React-19 behavior delta — found, fixed, regression-tested

Not predicted by the contract, and worth flagging: the first post-upgrade unit run was
`151 files / 2364 tests` **all passing** but with **1 unhandled error** — a green suite hiding a real
crash, which is precisely the failure mode this sprint's tests are weighted against.

```
TypeError: Cannot read properties of null (reading 'matchesNode')
 ❯ EditorView.updateStateInner node_modules/prosemirror-view/dist/index.js:5555:49
 ❯ EditorView.updateState      node_modules/prosemirror-view/dist/index.js:5527:14
 ❯ Editor.registerPlugin       node_modules/@tiptap/core/src/Editor.ts:234:15
 ❯ apps/ui/src/anchors/useAnchorLayer.ts:192:12
 ❯ Object.react_stack_bottom_frame … commitHookPassiveMountEffects …
This error originated in "apps/ui/src/reader/Reader.test.tsx"
```

Cause: `useAnchorLayer`'s registration effect ran against an editor that had already been destroyed.
React 19's passive-effect timing exposes it; the guard was simply missing on the mount path while
the effect's own cleanup one line below (`:194`) already had it, and so does every other editor
interaction in that file (`:252`, `:457`, `:463`) and in `useSelectionContextMenu.tsx:60,65`. It was
a pre-existing asymmetry, not a React 19 semantic change — `registerPlugin` on a destroyed view
dereferences a null `docView` inside ProseMirror instead of no-opping.

Fix (`apps/ui/src/anchors/useAnchorLayer.ts`), symmetric with the cleanup it sits above:

```ts
if (editor === null || editor.isDestroyed) return undefined;
```

Regression test added — `useAnchorLayer.test.tsx`, "an editor destroyed before the layer's effect
runs › registers nothing rather than dereferencing a torn-down view". **Proved to fail before the
fix**: with the guard temporarily reverted, the run reports

```
× an editor destroyed before the layer's effect runs > registers nothing rather than dereferencing a torn-down view
  → expected [Function] to not throw an error but 'TypeError: Cannot read properties of …' was thrown
     "TypeError: Cannot read properties of null (reading 'matchesNode')"
  Tests  1 failed | 25 skipped (26)
```

and passes with it restored (26/26). This is a defect fix, not a behavior change: no user-visible
output differs, an operation that used to throw now correctly does nothing.

### TEST-742 — the named unit suites

`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui packages/kit plugins`

| Run | Result |
| --- | ------ |
| Before the upgrade (baseline) | `Test Files 151 passed (151)` · `Tests 2364 passed (2364)` · 0 errors |
| After, before the guard fix   | `151 passed` · `2364 passed` · **1 unhandled error** |
| After, final                  | `Test Files 151 passed (151)` · `Tests 2365 passed (2365)` · **0 errors**, exit 0 |

**No test assertion was edited to accommodate React 19** — nothing was loosened, skipped or deleted.
The only test file touched is `apps/ui/src/anchors/useAnchorLayer.test.tsx`, and the only change is
the **added** regression test above (2364 → 2365 is that one test). The file count is 151 rather
than the contract's 104 + 32 = 136 because the invocation also collects `plugins`.

### TEST-744 / TEST-745 — warnings, counted before and after

Both runs' full output was captured and grepped; the same log files back every number:

| Signal | Before | After |
| ------ | ------ | ----- |
| `not wrapped in act(...)` | **0** | **0** |
| `The current testing environment is not configured to support act(...)` | 5 | 5 |
| `Accessing element.ref` | **0** | **0** |
| `forwardRef render functions` | **0** | **0** |
| Unhandled errors | 0 | 0 |
| `React Router Future Flag Warning` | 2 | 2 |

**Zero new warnings; nothing was silenced.** The 5 act-configuration warnings are pre-existing and
all from `apps/ui/src/editor/editingRegistry.test.tsx`; the 2 router future-flag warnings are v6's
and are UI-016's to remove. A set-difference of the two runs' unique `Warning:`/`Error:` lines
yields **no line present after that was not present before**.

One cosmetic difference explained so it is not misread as a regression: the raw count of the literal
string `Warning:` drops 7 → 2, because React 19 removed the `Warning: ` prefix from its console
messages. The 5 act-configuration messages are still emitted, unchanged in number, without that
prefix — which is why the row above reads 5 → 5.

`forwardRef` appears nowhere in application code:
`/usr/bin/grep -rn "forwardRef" apps/ui/src packages/kit/src plugins` finds only the comment at
`apps/ui/src/plugins/validate.ts:23`, as the contract recorded.

### TEST-746 — plugins typecheck against the widened kit peer

`npm run typecheck` runs `npm run typecheck --workspaces --if-present` plus the scripts project —
**seven `tsc --noEmit` invocations, exit 0**, including `plugins/todos` and `plugins/_fixture`.
`plugins/_fixture` is excluded from production surfaces and coverage but not from typecheck, and it
is green. `npm run lint` exit 0; `npm run format:check` — "All matched files use Prettier code
style!". `npm run build` (contract → kit → apps, then the Vite production bundle) exit 0.

### TEST-743 — the e2e suite, all 14 specs named

`CORPUS_UI_PORT=5282 CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 npm run e2e` → **exit 0,
`148 passed (50.6s)`**. Per-spec counts, from the run's own reporter lines:

| Spec | Tests | | Spec | Tests |
| ---- | ----- | - | ---- | ----- |
| `abandon.spec.ts` | 6 ✓ | | `context-menu.spec.ts` | 20 ✓ |
| `anchor-layer.spec.ts` | 6 ✓ | | `editor.spec.ts` | 10 ✓ |
| `anchors.spec.ts` | 10 ✓ | | `reader.spec.ts` | 6 ✓ |
| `board.spec.ts` | 7 ✓ | | `search.spec.ts` | 11 ✓ |
| `column-width.spec.ts` | 9 ✓ | | `smoke.spec.ts` | 13 ✓ |
| `compose-keyboard.spec.ts` | 19 ✓ | | `thread.spec.ts` | 10 ✓ |
| `console.spec.ts` | 14 ✓ | | `todos.spec.ts` | 7 ✓ |

All **14** contracted specs collected, summing to 148 — none silently skipped. Zero failures (the
only `failed` string in the log is inside a test *title*: `console.spec.ts:62` "keeps the failed-job
count off the health notice's class"). The hermetic premise held: the log is full of
`[vite] http proxy error … ECONNREFUSED 127.0.0.1:8790`, which is the dead origin working as
intended. `5282` and `8790` showed no listener after the run.

### TEST-747 — the real app, walked by hand

Workspace seeded by the agent under scratch, **not** in the dev repo:
`corpus init …/ws --port 8804` → "Initialized Corpus workspace … port 8804 … git: initialized on
main, one commit authored as user". `corpus server start` → "corpus 0.0.0 listening on
http://127.0.0.1:8804 (pid 35418)". Seeded via the CLI: two notes and one thread anchored to the
quote `6.1%` (`created th_2fxzlpek — anchored at anc_049ef064 on doc_2halqyvk`). The walk drove a
real Chromium against the real server (the built UI the server serves statically, rebuilt after the
final source edit), with every console message and page error captured.

| Step | What was done | What appeared |
| ---- | ------------- | ------------- |
| **Board** | loaded `http://127.0.0.1:8804` | `.board` with **3 columns**: `doc_seedattention` "Attention" (0 rows), `doc_seedinbox` "Inbox" (3 rows), `doc_seedopenthreads` "Open threads" (1 row) |
| **Reader** | clicked row `[data-row-doc="doc_2halqyvk"]` in the Inbox column | `.reader[data-reader-doc="doc_2halqyvk"]` opened in-column, reading `‹ Inbox · doc_2halqyvk · git ✓ · 💬 1 · ⋯ · ⤢ · note · inbox/open · updated 2026-07-31 · edit · "The rate assumption is 6.1% today." … "A second paragraph follows it…"` |
| **Anchors** | waited for the anchor layer | **1** `.anchor-slot .t-chip` and **1** `.anchor-hl` highlight span painted on the quoted `6.1%`, with the inline `💬 1 · user` marker |
| **Focus** | clicked `[data-expand]` (⤢) | `.focus.open` portal overlay, `withMargin: 1` (margin mode), header `✕ Close · esc closes · click anywhere to edit`, carrying the same document and frontmatter |
| **Thread** | read + clicked the margin card | `.thread-card[data-thread="th_2fxzlpek"]` → `“6.1%” · open · ✓ resolve · on React 19 smoke note · at “6.1%” · user · Jul 31, 11:07 AM · 💬 ✕ · "Where does 6.1% come from? It looks stale." · 📎 · ◉ ask agent · thread stays open · Reply ↵` |
| **Focus close** | pressed `Escape` | overlay detached, board visible again |
| **Console** | clicked `.console-strip` | `.console-body` expanded: `No jobs yet — agent activity will stream here.` |

**Browser console, verbatim: `(no console output at all)`** — zero messages of any type, zero page
errors. React errors/warnings matching `error|pageerror|Warning|act(|element.ref|forwardRef`: **0**.

Cleanup: `corpus server stop` → "stopped (pid 35418)"; pid 35418 gone; `lsof` shows no listener on
`8804`, `5282`, `8790` or `8765`; `/Users/theophanerupin/code/corpus/.corpus` **absent** (TEST-816);
no stray vite or playwright process. Only the recorded pid was stopped — no `pkill`, no `killall`.

### Files changed

Manifests `apps/ui/package.json`, `packages/kit/package.json`, `plugins/todos/package.json`,
`plugins/_fixture/package.json`, plus `package-lock.json`; source
`apps/ui/src/reader/popover.ts`, `apps/ui/src/reader/useReaderSurface.ts`,
`apps/ui/src/anchors/useAnchorLayer.ts` (types + the destroyed-editor guard),
`apps/ui/src/anchors/useMarginLayout.ts`, `apps/ui/src/anchors/AnchoredThreads.tsx`,
`apps/ui/src/keyboard/useRowCursor.ts`; test
`apps/ui/src/anchors/useAnchorLayer.test.tsx`; and this issue file. **No `packages/kit` source, no
`SPEC.md`, no `packages/contract`, and none of the infra lane's paths (`.github/workflows/**`,
`.githooks/**`, `scripts/**`) were touched.**

### Unresolved / for the orchestrator

- Nothing blocking. UI-016 is unblocked: resolved React is **19.2.8 ≥ 19.2.7**.
- The audit is still `moderate: 2, total: 2` (both router) — UI-016's TEST-753 is expected to take
  it to zero, and INFRA-013 must not be armed before it does.
- Worth a reviewer's eye: the destroyed-editor guard is the one source change beyond the ref types,
  and it is a defect fix surfaced (not caused) by React 19.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
