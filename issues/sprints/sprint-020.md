# Sprint 020 — React 19, router 8, and two CI gates the repo has never had

**Issues**: UI-029 · UI-016 · INFRA-013 · INFRA-014 · UI-030 · UI-031
**Domains**: ui, infra
**Branch**: `phase-7b-upgrades-ci` (orchestrator-owned)
**Date**: 2026-07-31
**Test numbering**: continues the ladder from sprint-019's `TEST-732`; this sprint runs
`TEST-733`–`TEST-822`.

---

## What this wave is

Two unrelated things that share a branch, and one of them is a **chain disguised as a batch**.

The UI lane is a forced sequence. UI-016 has been blocked since 2026-07-31 for a measured reason:
every `react-router@8.x` release declares `react >=19.2.7` **and** statically imports
`useOptimistic`. So UI-029 is not a modernization — it is UI-016's install precondition, and UI-016
is in turn INFRA-013's precondition, because the only two `npm audit` findings in the tree today are
`react-router` and `react-router-dom`. **UI-029 → UI-016 → INFRA-013 is a hard chain, and the last
link is a gate that makes the branch uncommittable if it lands early.** That is the single most
important operational fact in this contract.

The infra lane is two CI directives. INFRA-013 makes `npm audit` a blocking gate for the first time
in this repository's life — there is no `npm audit` in `.githooks/` or `.github/workflows/` today,
verified. INFRA-014 makes CI produce an installable artifact on every PR, and turns releases into a
deliberate act. INFRA-014 also collides with something already on disk: **`release.yml` publishes to
npm**, which the standing decision forbids. That is Open Conflict 1.

UI-030 and UI-031 ride along. They are the two evaluator/sign-off findings left open from Phase 6 —
small, real, and both smaller than their issue files imply, because in each case the mechanism they
need already exists a few lines away.

**The bar for this wave is "nothing changed except what was supposed to".** Four of the six issues
are dependency and CI plumbing with zero intended product-behavior delta. The tests below are
therefore weighted toward *proving absence of change* — named suites, named specs, named counts —
because a React major and a router major are exactly the changes that pass a green suite while
quietly moving something nobody was watching.

---

## Premise corrections — what the pre-flight found

Verified against the tree at contract time (2026-07-31), read-only, no installs, no builds, no git.
**Seventeen premises in the issue files are wrong, incomplete, or unmeasured.** They are corrected
here once; every acceptance test below is written against the corrected facts.

### C1 — UI-029: "code only where React 19 semantics force it (expected: none)" is wrong

UI-016's grep audit is **re-verified and holds** — for *runtime* APIs. Re-run at contract time over
`apps/ui/src`, `packages/kit/src`, `plugins`:

| Pattern                | Hits | Pattern              | Hits |
| ---------------------- | ---- | -------------------- | ---- |
| `defaultProps`         | 0    | `contextTypes`       | 0    |
| `propTypes`/`PropTypes`| 0    | `childContextTypes`  | 0    |
| `ReactDOM.render`      | 0    | `useRef()` (no arg)  | 0    |
| `ReactDOM.hydrate`     | 0    | `JSX.Element`        | 0    |
| `unmountComponentAtNode`| 0   | `JSX.IntrinsicElements`| 0  |
| `findDOMNode`          | 0    | `React.FC`           | 0    |
| `react-dom/test-utils` | 0    | `createFactory`      | 0    |

But the audit only covered removed *runtime* APIs. The **types** migration is where this repository
gets hit, and its surface is non-empty and enumerable. In `@types/react@19`, `RefObject<T>` became
`{ current: T }` (mutable, non-null) and `useRef<T>(null)` now returns `RefObject<T | null>`. Seven
declaration sites type a prop or parameter with the **non-nullable** form and are fed by
`useRef<T>(null)`:

| Site                                             | Declaration                              |
| ------------------------------------------------ | ---------------------------------------- |
| `apps/ui/src/reader/popover.ts:52`               | `usePopoverShift(ref: RefObject<HTMLElement>, …)` |
| `apps/ui/src/reader/useReaderSurface.ts:48`      | `scrollRef: RefObject<HTMLDivElement>`   |
| `apps/ui/src/anchors/useAnchorLayer.ts:71`       | `mainRef: RefObject<HTMLDivElement>`     |
| `apps/ui/src/anchors/useAnchorLayer.ts:72`       | `marginRef: RefObject<HTMLDivElement>`   |
| `apps/ui/src/anchors/useMarginLayout.ts:23`      | `main: RefObject<HTMLElement>`           |
| `apps/ui/src/anchors/useMarginLayout.ts:24`      | `margin: RefObject<HTMLElement>`         |
| `apps/ui/src/anchors/AnchoredThreads.tsx:72`     | `innerRef: React.RefObject<HTMLDivElement>` |
| `apps/ui/src/keyboard/useRowCursor.ts:30`        | `board: RefObject<HTMLElement>`          |

Feeders confirmed: `DocMenu.tsx:49`, `CommentsPopover.tsx:40`, `useReaderSurface.ts:65`,
`useAnchorLayer.ts:136-137`, `Board.tsx:90` — 34 `useRef<…>(null)` sites in total.

Four further sites use `MutableRefObject<T>` (`editor/RefNodeView.tsx:29,37,87`,
`packages/kit/src/markdown/MarkdownView.tsx:46`). Whether `@types/react@19` still exports it, and
under what deprecation, is **not verifiable without installing** — Open Conflict 3.

`ReactElement` appears 273 times, but almost entirely as a **return-type annotation**
(`function X(): ReactElement`), which survives the `P = any → unknown` default change. The one site
that reads props off an element is `apps/ui/src/dev/devRoutes.test.tsx:9`
(`expect(route?.props).toMatchObject(…)`) — named so it is checked rather than discovered.

### C2 — UI-029: the manifest surface is four manifests; the root has none

The issue says "root/ui/kit/plugins dev". `/usr/bin/grep` over every non-`node_modules`
`package.json`: **the root manifest declares no React at all.** The real surface:

| Manifest                      | React declarations                                                        |
| ----------------------------- | ------------------------------------------------------------------------- |
| `apps/ui/package.json`        | deps `react:29`, `react-dom:30`; devDeps `@types/react:43`, `@types/react-dom:44` |
| `packages/kit/package.json`   | peer `react:48`; devDeps `@types/react:52`, `react:53`, `react-dom:54`     |
| `plugins/todos/package.json`  | peer `react:18`; devDeps `@types/react:22`, `react:23`, `react-dom:24`     |
| `plugins/_fixture/package.json`| peer `react:18`; devDeps `@types/react:22`, `react:23`                    |

Plus `package-lock.json`. **`@types/react` and `@types/react-dom` must move together**: the installed
`@types/react-dom@18.3.7` peers `@types/react: ^18.0.0`, and `@types/react-dom@19.2.4` peers
`@types/react: ^19.2.0` (registry, contract time). Bumping one alone produces exactly the unmet peer
UI-029's own criterion forbids. Note `packages/kit` declares **no `react-dom` peer** and carries no
`@types/react-dom` — it relies on hoisting from `apps/ui`; that asymmetry is pre-existing and is not
this issue's to fix.

### C3 — UI-029: "React 19.x" is too loose a floor, and the looseness is load-bearing

`react-router@8.3.0`'s peer is `react: >=19.2.7` — not `^19`. Latest at contract time is
**19.2.8**. A manifest declaring `^19.0.0` resolves to 19.2.8 today and satisfies the router, but it
also permits a lockfile that pins below 19.2.7 and silently breaks UI-016's install. **Declare
`^19.2.8` in all four manifests** (`@types/react ^19.2.18`, `@types/react-dom ^19.2.4`), and let
UI-016 verify the installed version, not the range.

### C4 — UI-016: the surface is five files plus the lockfile, and it gains a transitive

Re-verified verbatim at contract time (`/usr/bin/grep -rn "react-router"` over `apps packages
plugins scripts`, excluding `node_modules` and the lockfile) — the sprint-018 baseline **holds
exactly**:

```
apps/ui/package.json:31:    "react-router-dom": "^6.30.4",
apps/ui/src/app/App.tsx:4:import { BrowserRouter, Route, Routes } from "react-router-dom";
apps/ui/src/dev/devRoutes.tsx:2:import { Route } from "react-router-dom";
apps/ui/src/dev/DataProbe.tsx:13:import { useSearchParams } from "react-router-dom";
apps/ui/src/dev/DataProbe.test.tsx:5:import { MemoryRouter } from "react-router-dom";
```

Four source files + one manifest + `package-lock.json`. The v6 `future` flags are at
`App.tsx:41`: `<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>`,
with the comment "Opt into the v7 behaviours now, while there is one route to migrate" — that comment
becomes false on v8 and must go with the flags.

**Dependency delta**: `react-router@8.3.0` depends on `cookie-es@^3.1.1`; `react-dom@19.2.8` depends
on `scheduler@^0.27.0`. Three packages enter the tree that the "post-router-8 audits clean" claim was
never measured against (C5).

### C5 — UI-016 / INFRA-013: the audit is exactly two moderates today, and both are the router

Measured at contract time, `npm audit --json`:

```
metadata.vulnerabilities: {"info":0,"low":0,"moderate":2,"high":0,"critical":0,"total":2}
vulnerability keys:       react-router, react-router-dom
```

So INFRA-013's premise ("post-router-8 the tree audits clean") is **credible and unproven in this
tree** — UI-016's 0-finding measurement was taken in an isolated scratch package containing the
router alone, not this tree with React 19, `scheduler` and `cookie-es` in it. INFRA-013's gate must
not be armed on an assumption; TEST-757 measures it in the real tree first.

### C6 — INFRA-013: exit codes CANNOT distinguish findings from an unreachable registry

This is the correction the issue most needs. Measured at contract time (npm 11.6.2, node 25.2.1):

| Invocation                                       | Exit |
| ------------------------------------------------ | ---- |
| `npm audit` (2 moderates present)                | 1    |
| `npm audit --audit-level=low`                    | 1    |
| `npm audit --audit-level=critical`               | 0    |
| `npm audit --json --audit-level=low`             | 1    |
| `npm audit --json --audit-level=critical`        | 0    |
| `npm audit --registry=http://127.0.0.1:9` (dead) | **1** |
| `npm audit --registry=http://127.0.0.1:9 --json` | **1** |

**"Registry unreachable" and "audit found things" are the same exit code.** An offline-detection
scheme built on exit codes is not implementable. The discriminator is the **`--json` payload shape on
stdout**:

*Reachable* — three top-level keys, and a numeric total:

```
keys: auditReportVersion,vulnerabilities,metadata
metadata.vulnerabilities.total → 2
```

*Unreachable* — no `auditReportVersion`, no `metadata`, no `vulnerabilities`; a `message` and an
`error` envelope instead:

```json
{
  "message": "request to http://…/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED …",
  "error": { "summary": "", "detail": "" }
}
```

with `npm error audit endpoint returned an error` on **stderr**. The rule the gate implements:
**parse stdout as JSON; if `metadata.vulnerabilities.total` is a number, that number is the verdict;
otherwise the registry did not answer.** Nothing else is a reliable signal — not the exit code, not
stderr text, not a timeout.

### C7 — INFRA-013: `--audit-level=low` is not "zero of any severity"

The metadata carries six buckets, and `info` sits below `low`. `--audit-level=info` and
`--audit-level=none` are both accepted (measured: `info` → exit 1 here, `none` → exit 0). The
issue's directive is "zero vulnerabilities of **any** severity — no severity floor", and
`--audit-level=low` silently tolerates `info` findings. **Assert `metadata.vulnerabilities.total ===
0`**, which has no floor at all, and use `--audit-level` only if a second, redundant signal is
wanted.

### C8 — INFRA-013: there is no `npm audit` anywhere today, and the latency budget is not close

`/usr/bin/grep -rn "audit" .githooks/ .github/` returns **five hits, all of them the `pack:check`
tarball audit** (`pre-push:39`, `release.yml:59,62`, `ci.yml:29,33`). No `npm audit` exists in any
hook or workflow. Baseline latency measured in this tree, warm cache, three runs of
`npm audit --json`: **620 ms / 779 ms / 656 ms**. The issue's ~5 s escalation threshold is a factor of
six away; a measurement anywhere near it means something else is wrong.

`.githooks/pre-commit` today runs five steps in order — build, eslint, prettier, typecheck, unit
tests (`pre-commit:21-25`) — via a `step()` helper that accumulates `fail` rather than exiting early
(`:12-19`). An audit step must use the same helper and the same accumulate-don't-exit shape, or it
will change the hook's reporting behavior as a side effect.

### C9 — INFRA-013: a checker script under `scripts/` is inside `npm test` and outside the coverage gate

`vitest.config.ts:21` includes `scripts/**/*.test.ts`, so a colocated test runs in the suite.
`scripts/coverage-config.ts:19` sets `COVERAGE_INCLUDE = ["apps/*/src/**", "packages/*/src/**",
"plugins/*/**"]` — `scripts/` is **not** in the gate. So the checker can be written and tested
without gate risk, and **no coverage exemption may be added for it** — there is nothing to exempt.
The convention already exists: `scripts/pack-audit.ts` + `pack-audit.test.ts`,
`scripts/versions.ts` + `versions.test.ts`. Follow it (pure module + thin runner), don't invent a
shape.

### C10 — INFRA-014: `release.yml` already exists, and it publishes to npm

The issue reads as though the tag-triggered workflow is being built. It exists
(`.github/workflows/release.yml`, 83 lines) and its final step is:

```yaml
      - name: publish to npm with provenance
        working-directory: dist-package
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --provenance --access public
```

with workflow-level `permissions: {contents: read, id-token: write}` — `id-token: write` exists
**solely** for npm provenance. This directly contradicts the standing decision the issue's own Spec
References restate ("NO npm publish, ever"), and it is already on the books:
`issues/shared/003-pr11-review-followups.md:35` — *"only the absent `NPM_TOKEN` bars a `v*` tag from
publishing… (User decision on record: no publish, ever — consider deleting the publish job
instead.)"* **Open Conflict 1.**

Everything above that step (checkout → setup-node → `npm ci` → `version:check` → build → drift →
lint → format → typecheck → coverage → e2e → merged gate → `package:build` + `pack:check`) is exactly
the workflow INFRA-014 wants for a tag; only the terminal step is wrong.

### C11 — INFRA-014: the required status check context is literally `validate`

Read from the live ruleset (`gh api repos/trupin/corpus/rulesets/19767610`, read-only):

- `required_status_checks: [{ "context": "validate" }]`, `strict_required_status_checks_policy:
  false`
- `pull_request: { required_approving_review_count: 0, allowed_merge_methods: ["squash"] }`
- plus `deletion` and `non_fast_forward` rules; enforcement **active**

Consequences INFRA-014 must respect: **the `validate` job may not be renamed** (a rename makes every
PR unmergeable until the ruleset is edited), and a **new packaging job is not a required check** — it
can fail without blocking a merge, which is precisely why its failure must be loud and why the
sticky comment matters.

### C12 — INFRA-014: CI already runs on main pushes; the negative test is narrower than it reads

`ci.yml:3-6` — `on: {pull_request:, push: {branches: [main]}}`. So "main merges trigger nothing" is
false as written and must not be implemented: `CI / validate` **should keep running on main**. The
criterion is about **packaging and release** only. TEST-784 states it that way.

### C13 — INFRA-014: the sticky-comment mechanism exists in the toolchain already

`gh` 2.83.2 is present and supports exactly this:

```
      --edit-last        Edit the last comment of the current user
      --create-if-none   Create a new comment if no comments are found. Can be used only with --edit-last
  -F, --body-file file   Read body text from file (use "-" to read from standard input)
```

So `gh pr comment "$PR" --edit-last --create-if-none --body-file -` is a create-or-update sticky
comment with no third-party action, using `GITHUB_TOKEN` + `pull-requests: write`. Relevant because
**this repository currently uses zero third-party actions** — `/usr/bin/grep -rn "uses:"
.github/workflows/` returns only `actions/checkout@v4`, `actions/setup-node@v4`,
`actions/upload-artifact@v4`. Introducing `peter-evans/create-or-update-comment` would be the first,
and would need a supply-chain justification in a sprint whose other half is a supply-chain gate.
Caveat to verify at implementation time: `--create-if-none` must exist in the `gh` preinstalled on
`ubuntu-latest`; if it does not, `actions/github-script` with the REST API is the fallback, not a
third-party action.

### C14 — INFRA-014: tarball hygiene, and a stray artifact on disk right now

`PACKAGE_NAME = "corpus"` (`scripts/package-manifest.ts:28`), `STAGE_DIR_NAME = "dist-package"`
(`:46`), root version `0.0.0`. So the artifact is `corpus-0.0.0.tgz` until a version bump.
`.gitignore:6` ignores `dist-package/` and `.gitignore:32` ignores `/*.tgz`. **There is an untracked
`corpus-0.0.0.tgz` (802.7 KB) at the repo root at contract time** — a leftover from an earlier local
pack, ignored by git and therefore harmless, but it is exactly the state the workflow must never
create: `npm pack` runs **from `dist-package/`** and writes there, never into the repo root.
`pack:check` (`scripts/check-pack.ts`) asserts the staged tarball in both directions against
`REQUIRED_PACK_ENTRIES` (`scripts/pack-audit.ts:40-62`: manifest, README, LICENSE, CLI bundle, server
bundle, `ui/index.html`, `ui/assets/*.js`, `ui/assets/*.css`, both workspace skills).

### C15 — UI-030: "share the mechanism, don't fork it" is an *extraction*; and half the fix already shipped

Verified in the tree:

- `apps/ui/src/reader/DocMenu.tsx` (75 lines) renders `<div role="menu" aria-label="Document
  actions" data-dm-pop>` at `:63-74` containing `<MenuItems variant="popover">` at `:72`. It has
  `usePopoverShift` (`:50`) and `useEscapeLayer` (`:51`) and **nothing else** — no `autoFocus`, no
  `.focus()`, no `onKeyDown`, no `tabIndex`. `apps/ui/src/menu/MenuItems.tsx:34-70` renders
  `role="menuitem"` buttons with **only** `onClick`.
- `apps/ui/src/menu/ContextMenu.tsx` exports **only** `ContextMenuProps` (`:28`) and `ContextMenu`
  (`:46`). Its roving focus is three inline, unexported pieces: `items(menu)` (`:41-44`), the
  open-focus + focus-restore effect (`:58-73`), and the `onKeyDown` (`:96-131`: Tab→dismiss 107-111,
  Arrows 115-121, Home 122-126, End 127-130). **There is no roving-focus hook anywhere** — every
  other arrow handler in the codebase is bespoke (`SearchOverlay.tsx:158`,
  `RefAutocomplete.tsx:62`, `useConsoleLayout.ts:203`, kit `useAutocomplete.ts:213`).
- **`ContextMenu` deliberately implements no Enter handler** (`:16-20`): activation is the native
  `<button>` default once focus is on the item. The shared hook must preserve that — adding an Enter
  handler would double-fire on the frame that already passes its six keyboard tests.
- **UI-028's fix already covers both popovers.** It landed in scope resolution, not in the menu:
  `shell/overlays.ts:29` `MENU_SURFACE = '[role="menu"]'`, `:49-51` `isMenuOpen()`,
  `keyboard/useShortcuts.ts:55`. Since `DocMenu.tsx:67` and `CommentsPopover.tsx:47` both set
  `role="menu"`, board shortcuts are already out of scope while they are open. UI-030 is
  **purely** missing roving focus, exactly as the issue claims.
- **The 💬 popover is identical, not merely "possibly identical".**
  `apps/ui/src/reader/CommentsPopover.tsx` (75 lines) renders `<div role="menu" aria-label="Threads
  on this document">` (`:44-51`) with `role="menuitem"` buttons (`:58-70`), `useEscapeLayer` (`:42`),
  and no focus management. Same frame class, same `usePopoverShift`. It is in scope.
- **No e2e touches the ⋯ popover at all.** `/usr/bin/grep` for `data-doc-menu`, `comments-btn` and
  `⋯` across `apps/ui/e2e/*.spec.ts` → zero hits. `context-menu.spec.ts:411` ("the open reader offers
  its ⋯ set") right-clicks `.fm-chips` — it asserts the *action set* through the `ContextMenu` frame,
  with no keyboard and no `DocMenu`.
- Existing keyboard coverage is Escape-only for both popovers: `DocMenu.test.tsx:366`,
  `CommentsPopover.test.tsx:75`. `ContextMenu.test.tsx` has the six that must stay green:
  `:119`, `:136`, `:155`, `:172`, `:185`, and the `:236` describe with `:257`/`:276`.

### C16 — UI-031: the latch the issue signs off on already exists, and "the focus spec" does not

- **Hover-adoption site**: `apps/ui/src/board/Column.tsx:234-235` — `onMouseOver={onActivate}` and
  `onFocus={onActivate}` on the `<section data-col>`. It is **`onMouseOver`** (bubbling), not
  `onMouseEnter`, which is why the suppression cannot live on the element: `mouseover` also fires on
  every move between descendants.
- **Wiring**: `shell/Board.tsx:563-565` → `active.activate(column.id)` →
  `keyboard/useActiveColumn.ts:68-71` `setWanted(columnId)`, guarded only by
  `if (keyboardOwns.current) return;`.
- **The latch is already there.** `useActiveColumn.ts:50` `const keyboardOwns = useRef(false)`, armed
  by `pin()` (`:73-76`), **released by a real `mousemove`** (`:52-60`). That is precisely the
  "one-shot latch cleared by real movement" the signed rule describes. It is armed today only by
  `switchBy`/`⇧←⇧→` — never by opening or closing focus mode. **The fix arms the existing latch from
  the close path**, it does not build a new mechanism.
- **Close path**: `FocusMode.tsx:83` `useEscapeLayer({priority: EscapeLayerPriority.Focus, onEscape:
  onClose})`; close keys are `Escape` **and `Backspace`** (`useEscapeStack.ts:49`); also the ✕
  (`FocusMode.tsx:110`), the depth-0 auto-close (`:87-89`), and the `f` toggle
  (`Board.tsx:405-411`). All land on `Board.tsx:632-634` `setFocusDoc(null)`, which unmounts the
  `createPortal` overlay (`FocusMode.tsx:91,143`). **All four paths are programmatic closes** — the
  issue names only esc/⌫.
- **`ActiveColumn`'s interface** (`useActiveColumn.ts:15-37`) is exactly `id`, `index`, `activate`,
  `pin`, `switchBy`; the return is at `:91`. Arming from the close path means extending that
  interface — a deliberate, testable widening, not an internal tweak.
- **"the focus spec" does not exist.** There is no dedicated focus e2e file. Only
  `anchor-layer.spec.ts:114-119` enters focus mode against the real app (and never closes it);
  `reader.spec.ts:174` and `editor.spec.ts:273` inject a static `.focus.open` shell and are CSS-only.
  So UI-031's "e2e case in the focus spec" means extending `anchor-layer.spec.ts` or adding a new
  spec — the issue's instruction is unexecutable as written.
- **No test today combines a resting pointer with a focus close.** `useActiveColumn.test.ts:56`
  ("keeps a keyboard-pinned column against a stationary pointer, and yields when it moves") is the
  closest, and it is about `pin`, not about closing.

### C17 — bookkeeping: UI-016's priority disagrees with itself

`issues/PLAN.md:137` lists UI-016 at **P2**; `issues/ui/016-react-router-v8.md` says **P1**. Also its
PLAN row still reads `blocked`, correctly, and must flip to `todo` once UI-029 lands. One of the two
priorities is wrong — orchestrator bookkeeping, not an agent's.

---

## Machine rules — binding on every agent in this batch

### Ports

Probed at contract time (`lsof -nP -iTCP:<port> -sTCP:LISTEN`): `8804`–`8810` and `5282`–`5285` are
all **free**. `5173` is held by `ssh` (pid 16094) — never take it.

**`8765` read as free at probe time, and that changes nothing.** The standing directive (2026-07-29,
carried through sprints 015–019) is that `8765` is **never bound, never killed, and never proxied
into, by anyone, for any reason.** Every `corpus init` in this sprint passes `--port` explicitly.

| Consumer             | Server port | Vite / `CORPUS_UI_PORT` |
| -------------------- | ----------- | ----------------------- |
| UI-029               | `8804`      | `5282`                  |
| UI-016               | `8805`      | `5283`                  |
| UI-030               | `8806`      | `5284`                  |
| UI-031               | `8807`      | `5285`                  |
| INFRA-013            | `8808`      | —                       |
| INFRA-014            | `8809`      | —                       |
| sprint-020 evaluator | `8810`      | `5286`                  |
| Automated tests      | `0` (ephemeral) — **never hardcode** | — |

### The e2e hazard, restated because this sprint has four UI issues

`apps/ui/vite.config.ts:14` defaults the API proxy to `http://127.0.0.1:8765` — the maintainer's live
corpus. This has twice pointed agent writes at real data. **Every Playwright run in this sprint
exports both:**

```sh
export CORPUS_UI_PORT=<your port from the table>
export CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790   # dead on purpose, same value pre-push uses
```

`8790` is what `.githooks/pre-push:24` pins, and the suite's hermetic premise is a *dead* origin —
two specs assert the console strip reads "server unreachable". `playwright.config.ts:44`
(`reuseExistingServer: false`) plus `--strictPort` turn a collision into a loud failure rather than a
silent cross-worktree coverage attribution.

**Playwright is single-holder.** The UI lane is sequential (see Ordering), so at most one e2e run
exists at a time. An agent that finds a Vite server already up **stops and reports** — it does not
kill it.

### Scratch directories

All scratch under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` — **never bare `/tmp`, never
inside the repository.**

| Issue      | Prefix                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| UI-029     | `mkdir -p …/tmp/s020-ui && mktemp -d …/tmp/s020-ui/029-XXXXXX`           |
| UI-016     | `mkdir -p …/tmp/s020-ui && mktemp -d …/tmp/s020-ui/016-XXXXXX`           |
| UI-030     | `mkdir -p …/tmp/s020-ui && mktemp -d …/tmp/s020-ui/030-XXXXXX`           |
| UI-031     | `mkdir -p …/tmp/s020-ui && mktemp -d …/tmp/s020-ui/031-XXXXXX`           |
| INFRA-013  | `mkdir -p …/tmp/s020-infra && mktemp -d …/tmp/s020-infra/013-XXXXXX`     |
| INFRA-014  | `mkdir -p …/tmp/s020-infra && mktemp -d …/tmp/s020-infra/014-XXXXXX`     |
| evaluator  | `mkdir -p …/tmp/s020-eval && mktemp -d …/tmp/s020-eval/XXXXXX`           |

(`…` is `/Users/theophanerupin/.claude/jobs/4dd0ddef`.) **`s020-ui` is shared by four agents and
`s020-infra` by two — never glob-delete a prefix.** Delete only paths you created and captured in a
variable. Automated tests use `fs.mkdtemp`, never these paths.

### `npm install` — the one sprint where it is legitimate, and its rules

Unlike every recent sprint, **UI-029 and UI-016 must run `npm install` in this tree.** That makes the
serialization rules non-negotiable:

- **Only UI-029 and UI-016 may install**, and never at the same time as each other or as anything
  else. INFRA-013, INFRA-014, UI-030 and UI-031 have **no reason to install** — one that thinks it
  does has misunderstood its scope and escalates instead.
- Install with `npm install` (which updates `package-lock.json`), **never `--legacy-peer-deps`,
  never `--force`** — the whole point of TEST-737 is that the peer graph is honestly satisfied.
  `npm audit fix` and `npm audit fix --force` are **forbidden** in this tree: they rewrite the
  lockfile on their own judgment, and this sprint's changes are deliberate.
- **`npm ci` is forbidden** — it would discard the lockfile edit the issue exists to make.
- One heavy command at a time. Never overlap an install with a build, a test run or an e2e run.

### Tests and load

- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm test` unfiltered, never `npm run coverage`, `npm run test:coverage`.
  The orchestrator's harvest run is the single repo-wide gate.
- **`npm run e2e` is the exception this sprint**: UI-029 and UI-016 each need one full e2e run,
  because "no behavior change" is the entire claim and 14 specs are the evidence. UI-030 and UI-031
  run e2e once each at the end of their session. **One at a time, ports from the table.**
- **One workspace-scoped unit run at the very end of your session is the maximum**, apart from the
  e2e allowance above.
- **Three concurrent implementation agents maximum** — and the ordering below caps the real number
  at two.
- `npm run build` before lint/typecheck/test — `@corpus/*` imports resolve through `dist/`.

### Process cleanup — pid-targeted only

`pkill -f vite`, `pkill -f tsx`, `pkill node`, `killall node` kill sibling agents' servers and the
maintainer's — **forbidden.** Stop what you started, by recorded pid, and verify with
`lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring done.

### Grep

**Use `/usr/bin/grep` for any grep-based evidence.** The `rtk` proxy has produced false negatives.
Every "X does not appear anywhere" claim must come from `/usr/bin/grep` with the command pasted.

### Deferred verification is recorded, not skipped

Any criterion that cannot be executed is marked `STRUCK → Open Conflict N` or `DEFERRED → <reason>`
in the E2E Verification Log, **with the reason and the substitute evidence supplied**. Silent
omission is a fail. Each agent states `implemented on: opus | fable` per CLAUDE.md's record-actuals
rule.

---

## Acceptance Tests

### UI-029: React 18 → 19 (the install precondition)

Four manifests + the lockfile, plus whatever the types force. Model: **opus**. Port `8804`, Vite
`5282`. Read C1, C2 and C3 before touching anything: the issue's "expected: no code changes" is
wrong, its manifest list is wrong, and its version floor is too loose.

TEST-733: All four manifests move, and the root is left alone
  Given: C2's table — `apps/ui`, `packages/kit`, `plugins/todos`, `plugins/_fixture`
  When: the manifests are diffed
  Then: every `react`, `react-dom`, `@types/react` and `@types/react-dom` declaration in those four
  files is on the 19 line, at the floors C3 fixes (`react`/`react-dom` `^19.2.8`, `@types/react`
  `^19.2.18`, `@types/react-dom` `^19.2.4`). The **root `package.json` is unchanged** — it declares
  no React and must not start. `packages/kit`'s `peerDependencies.react` reads `^19` (the widened
  peer this issue is explicitly granted).

TEST-734: The kit peer widening is recorded as the adjudication it is
  Given: sprint-018 Adjudication 6 forbade `packages/kit` changes outside a named method, and UI-029
  is where that permission is granted
  Then: the kit manifest change is named in UI-029's E2E log as the granted exception, quoting the
  before/after of `peerDependencies.react`. A permission used without being cited is
  indistinguishable from a permission ignored.

TEST-735: The installed tree is React 19.2.7 or later — the number UI-016 depends on
  When: `npm ls react react-dom` is run after the install
  Then: the resolved versions are `>= 19.2.7`, pasted verbatim. This is not a formality: it is the
  exact condition `react-router@8.3.0` declares (`peerDependencies: {react: ">=19.2.7", react-dom:
  ">=19.2.7"}`), and a resolution below it makes UI-016 uninstallable for a reason that will look
  like a router problem.

TEST-736: One hoisted React, no nested copies
  When: `npm ls react` and `npm ls react-dom` are run
  Then: a single hoisted copy each; **no nested `node_modules/*/node_modules/react`**. Two Reacts in
  one tree produce hook-dispatch failures that look like application bugs.

TEST-737: Zero unmet peers, and the install used no escape hatch
  Then: `npm ls` reports **no `UNMET PEER DEPENDENCY`** and no `invalid` marker, pasted. The E2E log
  states that the install ran as plain `npm install` — **no `--legacy-peer-deps`, no `--force`, no
  `npm audit fix`**. UI-016's blocker analysis rests on peers being honest; an install that suppressed
  them proves nothing.

TEST-738: `@types/react` and `@types/react-dom` moved together
  Given: `@types/react-dom@19.2.4` peers `@types/react: ^19.2.0` (C2)
  Then: both are on 19, and `npm ls @types/react @types/react-dom` shows the peer satisfied. A lone
  `@types/react` bump is the specific failure this test exists to catch.

TEST-739: The `RefObject` sites are migrated, individually and deliberately
  Given: C1's eight declaration sites
  When: `npm run typecheck` runs across all workspaces
  Then: it is green, and the E2E log **lists each of the eight sites and what happened to it** —
  changed to `RefObject<T | null>`, or left alone with the reason it still compiles. "Typecheck
  passed" alone is not evidence here: the sites were enumerated before the work started precisely so
  the outcome could be checked site by site.

TEST-740: `MutableRefObject`'s status is determined by measurement, not assumption
  Given: the four sites at `editor/RefNodeView.tsx:29,37,87` and
  `packages/kit/src/markdown/MarkdownView.tsx:46`, and Open Conflict 3
  When: `@types/react@19` is installed
  Then: the agent reads the installed `node_modules/@types/react/index.d.ts` and records whether
  `MutableRefObject` is exported, deprecated, or gone — with the quoted declaration. If it survives,
  the sites stay; if it is deprecated and lint flags it, they migrate to `RefObject`; if it is gone,
  they migrate and the change is called out. Any of the three is acceptable; guessing is not.

TEST-741: `devRoutes.test.tsx:9` still compiles and still asserts the same thing
  Given: it reads `route?.props` off a `ReactElement`, whose default type parameter changes from
  `any` to `unknown` in `@types/react@19` (C1)
  Then: `apps/ui/src/dev/devRoutes.test.tsx` typechecks and passes with its assertion **unweakened** —
  no `as any`, no `@ts-expect-error`, no deleted expectation. If the types force a change, the change
  is a narrowing that preserves the assertion, and it is called out.

TEST-742: The named unit suites are green, unmodified
  Given: 104 test files under `apps/ui/src` and 32 under `packages/kit/src` (counted at contract
  time)
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui packages/kit plugins` runs
  Then: all green, and **no test assertion was edited to accommodate React 19**. A test changed to
  make an upgrade pass is the upgrade failing quietly. Any test file that had to change is listed in
  the log with the reason, and a change of the form "loosened an expectation" is escalated, not made.

TEST-743: The e2e suite is green — all 14 specs, named
  When: `CORPUS_UI_PORT=5282 CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 npm run e2e` runs
  Then: **`abandon`, `anchor-layer`, `anchors`, `board`, `column-width`, `compose-keyboard`,
  `console`, `context-menu`, `editor`, `reader`, `search`, `smoke`, `thread`, `todos`** all pass, and
  the pass/fail line per spec is pasted. Naming them is the point: a run that silently collected
  fewer specs than this list is a failure that reads like a success.

TEST-744: `act()` warnings are counted, not waved at
  Given: 265 `act(` call sites and 141 `renderHook` uses across 98 jsdom test files, and React 19's
  changed act semantics
  When: the unit suites run
  Then: the console output is checked for `not wrapped in act(...)` warnings and the count is
  recorded — **before and after**, so a pre-existing warning is not counted as a regression and a new
  one is not lost in the noise. Zero new warnings is the bar. Any new one is fixed by wrapping the
  update, never by silencing the console.

TEST-745: No `ref`-as-prop or element-access warnings appear
  Given: React 19 warns on accessing `element.ref` and changes ref forwarding (`forwardRef` is
  deprecated but functional; `/usr/bin/grep` finds exactly one mention, a comment at
  `apps/ui/src/plugins/validate.ts:23`)
  Then: no `Accessing element.ref` and no `forwardRef render functions` warning is emitted by any
  suite or by the e2e run. Console output is checked, not assumed.

TEST-746: `plugins/` typechecks against the widened kit peer
  When: `npm run typecheck` runs (which includes `plugins/todos` and `plugins/_fixture` via
  `--workspaces --if-present`)
  Then: both plugins are green. `plugins/_fixture` is excluded from production surfaces and from
  coverage but **not** from typecheck — a widened peer that breaks the fixture breaks the build.

TEST-747: The real app still works, walked by hand
  Given: a workspace the agent seeds itself, server on `8804`
  When: the agent walks board → open a document → focus mode → a thread → the console drawer
  Then: each step is described concretely (what was clicked, what appeared) and the browser console
  is pasted showing **no React errors or warnings**. "Smoke walk passed" without the transcript is
  not evidence.

TEST-748: The audit did not get worse
  When: `npm audit --json` runs after the install
  Then: `metadata.vulnerabilities` is pasted. The expected value is **unchanged from contract time**
  — `{info:0, low:0, moderate:2, high:0, critical:0, total:2}`, both from the router. React 19 and
  `scheduler@^0.27.0` entering the tree must add nothing. Any new finding is escalated immediately,
  because INFRA-013 is two issues downstream and its gate is unconditional.

---

### UI-016: react-router 6 → 8 (the four-file swap, finally unblocked)

Five files plus the lockfile (C4). Model: **opus**. Port `8805`, Vite `5283`. **Do not start until
UI-029 is committed** — this issue's install fails without React ≥ 19.2.7, and that failure is the
issue's entire history.

TEST-749: `react-router-dom` is gone; `react-router@^8.3.0` is in
  Then: `apps/ui/package.json` declares `react-router` at `^8.3.0` or later and **no
  `react-router-dom`**; `npm ls react-router react-router-dom` shows one hoisted `react-router` and
  **no `react-router-dom` at any depth**. The `-dom` package does not exist on the v8 line.

TEST-750: All four source files import from `react-router`, and nothing else does
  Given: C4's verbatim baseline
  Then: `/usr/bin/grep -rn "react-router-dom" apps packages plugins scripts` (excluding
  `node_modules` and the lockfile) returns **zero hits**, pasted; and the four sites — `App.tsx:4`
  (`BrowserRouter, Route, Routes`), `devRoutes.tsx:2` (`Route`), `DataProbe.tsx:13`
  (`useSearchParams`), `DataProbe.test.tsx:5` (`MemoryRouter`) — all import from `react-router`. All
  five exports are confirmed present on `8.3.0`.

TEST-751: The v6 `future` flags are removed, and so is the comment that explains them
  Given: `App.tsx:41` `<BrowserRouter future={{v7_startTransition: true, v7_relativeSplatPath:
  true}}>` and the comment above it ("Opt into the v7 behaviours now…")
  Then: both the prop and the now-false comment are gone. A stale comment describing a migration
  that completed is a lie the next reader will believe.

TEST-752: Route declaration style is decided once, in writing
  Given: v8's handling of `<Route>` as a child of `<Routes>`, and `devRoutes()` returning a bare
  `<Route>` element (`devRoutes.tsx:16-18`) that `App.tsx` splices into `<Routes>`
  When: the migration is performed
  Then: whichever form v8 requires is used consistently, and the E2E log **states what v8 actually
  demanded** and whether `devRoutes()`'s return type had to change. This was sprint-018's Open
  Conflict 2, deferred to this issue on the grounds that it could be answered once v8 was
  installable. It is now installable; answer it.

TEST-753: `npm audit` reports **zero** findings — the whole point of the issue
  When: `npm audit --json` runs after the install
  Then: `metadata.vulnerabilities` reads `{info:0, low:0, moderate:0, high:0, critical:0, total:0}` —
  pasted in full, replacing the contract-time `moderate:2, total:2`. The two
  `react-router`/`react-router-dom` moderates are gone, and `cookie-es@^3.1.1` (router 8's new transitive) added nothing. **This is INFRA-013's
  precondition and it is a measurement, not an inference** (C5): UI-016's earlier 0-finding result
  came from an isolated scratch package, not from this tree with React 19 in it.

TEST-754: If the total is not zero, INFRA-013 does not start
  Given: TEST-753
  When: the total is anything but zero
  Then: the agent **stops and escalates with the full report** rather than proceeding. INFRA-013's
  gate is unconditional and has no allowlist by directive; arming it over a non-zero tree makes the
  branch uncommittable. This is a stop condition, not a warning.

TEST-755: Reader navigation behaves identically — the claim sprint-018 could only restate
  Given: sprint-018 TEST-598 could only assert that `useNavStack.ts`, `useBoardLocalState.ts` and
  `useReaderSurface.ts` were not opened, because no migration happened
  When: the app runs on `8805` and the agent drives the reader by hand
  Then: **Back through a navigation stack, scroll restoration on return, and stack-empty exit** are
  each exercised and described concretely. The three files are also confirmed untouched by the diff.
  This is the first time the criterion can be tested rather than restated.

TEST-756: The named suites and all 14 e2e specs are green, unmodified
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui` and
  `CORPUS_UI_PORT=5283 CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 npm run e2e` run
  Then: green, with `apps/ui/src/dev/DataProbe.test.tsx` (the only router-touching unit test) called
  out by name, and the 14 specs listed as in TEST-743. No assertion edited.

TEST-757: The `useOptimistic` blocker is confirmed resolved rather than assumed
  Given: the 2026-07-31 measurement — `react-router@8.x`'s `dist/production/lib/components.js` line
  18 does `import { useOptimistic } from "react"`
  Then: after the install, the agent confirms the shipped bundle's import resolves — the declarative
  router (`BrowserRouter`/`Routes`/`Route`) actually renders in the running app, not merely in a
  type-check. TEST-755's hand-driven walk is that proof; the log says so explicitly.

TEST-758: The four-file claim held
  Then: `git diff --stat` for this issue shows **exactly** `apps/ui/package.json`,
  `apps/ui/src/app/App.tsx`, `apps/ui/src/dev/devRoutes.tsx`, `apps/ui/src/dev/DataProbe.tsx`,
  `apps/ui/src/dev/DataProbe.test.tsx`, `package-lock.json` — and nothing else. A migration that
  reached further reached too far, and says why in the log.

---

### INFRA-013: the audit gate (zero findings, no allowlist, both gates)

`.githooks/pre-commit`, `.github/workflows/ci.yml`, and a checker under `scripts/`. Model: **opus**.
Port `8808` (unused in practice — this issue starts no server). **Do not start until UI-016 is
committed and TEST-753 measured zero.** Read C6 before writing a line: the offline detection this
issue asks for cannot be built on exit codes.

TEST-759: The gate is a total-zero assertion with no severity floor
  Given: the directive "zero vulnerabilities of any severity — no allowlist, no severity floor", and
  C7 (`--audit-level=low` tolerates `info`)
  Then: the gate asserts `metadata.vulnerabilities.total === 0` from `npm audit --json`. If
  `--audit-level` is used at all it is `info` and it is redundant, not load-bearing. The choice is
  documented in the script's module comment, as the issue asks.

TEST-760: The failure message names every advisory
  Given: the issue's requirement of "a crisp failure message naming each advisory"
  When: the gate fails
  Then: the output names each vulnerable package, its severity, and its advisory title or URL — one
  line per finding, from the `vulnerabilities` map. A failure that says "2 vulnerabilities found, run
  npm audit" makes the developer run the command the gate just ran.

TEST-761: Registry-unreachable is detected by payload shape, and the mechanism is tested
  Given: C6 — both cases exit 1; the discriminator is the `--json` payload
  Then: the checker parses stdout and treats a **numeric `metadata.vulnerabilities.total`** as the
  verdict and **anything else** (a `message`/`error` envelope, unparseable output, empty stdout) as
  "registry did not answer". A unit test covers **both** payload shapes as fixtures — the reachable
  shape (`{auditReportVersion, vulnerabilities, metadata}`) and the unreachable shape
  (`{message, error:{summary, detail}}`) — quoting the real payloads recorded in C6.

TEST-762: The gate never mistakes an unreachable registry for a clean tree
  Given: the failure mode that matters most — a network blip silently reporting success
  When: the checker is handed the unreachable payload
  Then: it reports **unreachable**, never **clean**. There is exactly one code path that can print
  "clean", and it is reachable only from a numeric zero total. A test asserts this directly.

TEST-763: Pre-commit warns loudly and proceeds when the registry is unreachable
  Given: the orchestrator default (fail on findings; warn and continue when unreachable)
  When: the drill runs the hook against an unreachable registry (`npm_config_registry=http://127.0.0.1:9`
  or an equivalent local dead port — **never by editing `.npmrc` or touching real network config**)
  Then: the hook prints an unmissable warning naming the reason, and **exits 0 for that step**; the
  commit is not blocked. The warning text is pasted in the log. A quiet warning is the same as no
  gate on the day it matters.

TEST-764: CI is fail-closed on unreachable, with no shared "warn" path
  Given: "CI always fail-closed"
  Then: the CI step **fails** on the unreachable payload, and the code proves it structurally — the
  warn-and-proceed branch is selected by an explicit flag/env the workflow never sets, not by
  sniffing `CI`. A test covers the fail-closed path. Two behaviors that differ by an environment
  variable nobody reads is how a gate quietly turns off.

TEST-765: The vulnerable-pin drill fails pre-commit, with the advisory named
  Given: the issue's drill — temporarily pin a known-vulnerable version, prove the gate catches it,
  revert
  When: the drill runs
  Then: the hook **blocks the commit** and names the advisory. The exact package/version pinned and
  the exact output are pasted. **The vulnerable pin is never committed** — the log states that the
  tree and the lockfile were restored, and shows `git status` clean afterwards. The agent runs no
  state-changing git command to do this; the pin is made and reverted by editing files.

TEST-766: The same drill fails CI
  Given: the drill must prove both gates, and the agent cannot push
  Then: the CI step is exercised locally by running **the exact command the workflow runs** against
  the pinned tree, with the command line and output pasted, and the E2E log marks the real-CI half
  `DEFERRED → orchestrator, on the batch PR`. The orchestrator confirms it during PR babysitting.
  A workflow step whose only evidence is that it was written is not verified.

TEST-767: Clean tree passes both gates
  When: the pin is reverted and both commands run
  Then: both pass, output pasted, and `metadata.vulnerabilities.total` is **0** — the number UI-016
  established (TEST-753).

TEST-768: Pre-commit latency is measured and recorded against the 5 s bar
  Given: the contract-time baseline of `npm audit --json` alone — **620 ms / 779 ms / 656 ms**, warm
  cache (C8)
  Then: the added latency of the new hook step is timed over at least three runs and recorded. If it
  exceeds ~5 s it is raised in the report — **and the step is not moved to pre-push**, because the
  user chose pre-commit knowingly.

TEST-769: The hook step uses the existing `step()` shape
  Given: `.githooks/pre-commit:12-19` accumulates `fail` rather than exiting early, so a developer
  sees every failing check in one run
  Then: the audit step goes through `step()` like the other five (`:21-25`) and preserves that
  accumulate-don't-exit behavior. Its position in the order is chosen deliberately and explained in a
  comment — the issue asks for "early, so audit failures are cheap", and the hook's first step today
  is the expensive `build`.

TEST-770: The CI step is early, before build, and clearly labeled
  Given: "a dedicated step in the validate workflow, early (before build), so audit failures are
  cheap and clearly labeled"
  Then: the step sits before `npm run build` in `ci.yml` — adjacent to `version:check`, the existing
  cheap-and-needs-no-build step (`ci.yml:24-25`) — with a name that says what it enforces and a
  comment recording the zero-total policy and why there is no allowlist.

TEST-771: The `validate` job is not renamed
  Given: C11 — the ruleset's required status check context is literally `validate`
  Then: the job id and name are unchanged. A rename makes every open PR unmergeable until a human
  edits the repository ruleset.

TEST-772: No allowlist mechanism exists anywhere
  Given: the directive "No allowlist mechanism exists anywhere in the implementation"
  Then: `/usr/bin/grep -rn "allowlist\|allow-list\|ignore\|exception\|waiver\|--omit" ` over the new
  script, the hook and the workflow returns nothing that could exempt an advisory — pasted. No
  `.npmrc` is added (there is none today), no `audit-level` floor above `info`, no per-package
  skip, no env override. The absence is proved, not asserted.

TEST-773: The checker follows the `scripts/` convention and needs no coverage exemption
  Given: C9 — `vitest.config.ts:21` runs `scripts/**/*.test.ts`; `COVERAGE_INCLUDE`
  (`coverage-config.ts:19`) excludes `scripts/`
  Then: the checker is a pure module plus a thin runner with a colocated `*.test.ts`, matching
  `pack-audit.ts`/`pack-audit.test.ts` and `versions.ts`/`versions.test.ts`, and
  **`scripts/coverage-config.ts` is not modified**. Adding a coverage exemption here would be adding
  one for a path that was never in the gate.

TEST-774: Workspace coverage is confirmed, not assumed
  Given: the design note "Workspaces are covered by the root audit"
  Then: the log shows it: the two contract-time findings were `react-router`/`react-router-dom`,
  **`apps/ui` dependencies**, reported by a root-level `npm audit`. One sentence, one piece of
  evidence, and the claim is retired.

---

### INFRA-014: CI packaging, PR artifacts, and deliberate releases

`.github/workflows/`, `CLAUDE.md`. Model: **opus**. Port `8809` (unused in practice). Read C10, C11,
C12 and C13 first: the tag workflow already exists and does the forbidden thing, the required check
is named `validate`, and "main triggers nothing" is narrower than the issue says.

TEST-775: A PR push uploads the installable tarball as a workflow artifact
  Given: the build chain `npm run build && npm run package:build && npm run pack:check`, then
  `npm pack` **from `dist-package/`**
  When: a PR receives a push
  Then: an `actions/upload-artifact@v4` step uploads the resulting `corpus-<version>.tgz`. The
  artifact name includes the version and the short sha so two runs are distinguishable, and
  `if-no-files-found` is **`error`**, not `warn` — a packaging job that uploads nothing must fail,
  not shrug. Retention is set explicitly with `retention-days` and the number is justified in a
  comment rather than inherited from repository defaults.

TEST-776: `npm pack` writes into `dist-package/`, never the repository root
  Given: C14 — a stray `corpus-0.0.0.tgz` sits at the repo root right now, and `.gitignore:32`
  (`/*.tgz`) is the only thing hiding it
  Then: the workflow's pack step runs with `working-directory: dist-package` (as
  `publish:dry-run` already does, root `package.json`), and the log shows the tarball path under
  `dist-package/`. `git status` in the job is clean of new tarballs.

TEST-777: One sticky PR comment, created then updated — never appended
  Given: C13 — `gh pr comment --edit-last --create-if-none --body-file -` (gh 2.83.2 verified
  locally)
  When: a PR is pushed twice
  Then: the PR carries **exactly one** packaging comment, whose body changed between the two runs.
  Two comments is a fail; so is a comment that grew by appending.

TEST-778: The comment records version, head sha and size, and links the download
  Then: the body contains the package version, the head commit sha, the tarball size in bytes (or
  KB), and a link to the run's artifact. A note states that downloading requires a logged-in GitHub
  user — the issue accepted that, and the comment should not pretend otherwise.

TEST-779: No third-party action is introduced
  Given: C13 — this repository uses only `actions/checkout@v4`, `actions/setup-node@v4` and
  `actions/upload-artifact@v4`
  Then: `/usr/bin/grep -rn "uses:" .github/workflows/` shows only first-party `actions/*` after this
  change, pasted. If `--create-if-none` turns out to be unavailable on the runner's `gh`, the
  fallback is `actions/github-script` — **not** a third-party marketplace action. Adding an
  unaudited third-party action in the same sprint that adds a supply-chain gate would be a
  self-inflicted wound.

TEST-780: Permissions are per-job and minimal
  Given: the issue's instruction to scope them per-job, not workflow-wide
  Then: the PR packaging job declares `contents: read` + `pull-requests: write`; the release job
  declares `contents: write`. No workflow-level blanket grant. The current `release.yml`'s
  workflow-level `permissions: {contents: read, id-token: write}` is replaced, and **`id-token:
  write` is removed** — it exists solely for npm provenance (C10) and has no purpose once publishing
  is gone.

TEST-781: `pack:check` failure fails the job before any comment or upload
  Given: `scripts/check-pack.ts` exits non-zero on a bad tarball (its `fail()` at `:31-34`)
  When: `pack:check` fails
  Then: the job stops — **no artifact uploaded, no sticky comment posted or updated**. Ordering is
  structural (the comment step runs after, with no `if: always()`), not incidental. The E2E log
  shows the step ordering and states how a stale comment from a previous green run is handled.

TEST-782: The tag-triggered release packages and attaches, and publishes nothing
  Given: C10 and Open Conflict 1
  When: a `v*` tag is pushed
  Then: the workflow runs build → drift → lint → format → typecheck → tests → e2e → merged gate →
  `package:build` → `pack:check` → `npm pack`, then creates a **GitHub Release** with the tarball
  attached and notes generated since the previous tag. **No `npm publish` step exists anywhere in
  `.github/workflows/`** — proved with `/usr/bin/grep -rn "npm publish" .github/`, pasted (the root
  `package.json`'s `publish:dry-run` script is out of scope and stays).

TEST-783: `version:check`'s tag guard is verified intact, not merely left in place
  Given: `scripts/check-versions.ts` reads `GITHUB_REF`, so a `v1.2.3` tag against a differently
  versioned manifest fails before anything is built (`release.yml:38-39`)
  When: the guard is exercised locally with `GITHUB_REF=refs/tags/v9.9.9` against the current
  `0.0.0` manifests
  Then: it **fails**, output pasted; and with the matching version it passes. "Existing behavior not
  weakened" is a claim that costs one command to prove.

TEST-784: Main merges create no release and run no packaging publish — stated precisely
  Given: C12 — `ci.yml:3-6` already runs on `push: branches: [main]`, and that must not change
  When: a commit lands on `main`
  Then: **`CI / validate` still runs** (unchanged), and **no release is created and no packaging
  artifact is published**. The workflow trigger blocks make this structural: the release job is
  `on: push: tags: v*` only, and any packaging job is `on: pull_request` only. The negative test is
  the merge of this batch's own PR (TEST-820).

TEST-785: `CLAUDE.md` carries the release-decision rule
  Then: the Git Workflow section gains a bullet stating that releases are **orchestrator-judged or
  user-requested**, never automatic, and that the mechanism is a version bump
  (`npm version <x.y.z> --workspaces --include-workspace-root`) plus a `v*` tag push. It sits with
  the other numbered Git Workflow rules, not in a new section.

TEST-786: The tgz-only decision is stated
  Given: the issue's "If the user wants a literal .zip alongside, it's one extra step — flag in the
  report, default to tgz-only"
  Then: the implementation ships tgz-only and the report says so in one line, so the user can ask
  for the zip if they want it. A default taken silently is a default nobody agreed to.

TEST-787: The installable proof — a real tarball, really installed
  Given: the acceptance criterion "download the PR artifact, `npm install -g <tgz>` into a scratch
  prefix, `corpus --version` works"
  When: the proof is executed
  Then: the install runs into a **scratch prefix under `…/tmp/s020-infra/`** (`npm install -g
  --prefix "$SCRATCH/prefix"`), never the machine's global prefix, and `"$SCRATCH/prefix/bin/corpus"
  --version` prints the version. The full transcript is pasted, and the prefix is removed by captured
  path at the end.

TEST-788: If the artifact cannot be downloaded yet, the proof is run on a locally packed tarball and marked
  Given: the PR artifact does not exist until the batch's PR runs
  Then: the agent performs TEST-787 against the tarball its own `npm run package:build && npm pack`
  produced, marks the download half `DEFERRED → orchestrator, on the batch PR`, and the orchestrator
  completes it during babysitting (TEST-819). Substitute evidence, stated as substitute.

TEST-789: The release job is gated on validation, not parallel to nothing
  Given: "keep the packaging job parallel to validate, but gate release creation on validate success
  (a broken main merge must not publish an artifact)"
  Then: on the PR trigger the packaging job may run in parallel with `validate`; on the tag trigger
  the release creation runs only after the full validation sequence succeeds — which the existing
  `release.yml` already achieves by running them as ordered steps in one job. Whichever shape is
  chosen, the log states it and why.

TEST-790: SHARED-003 finding 6 is closed by this issue, or explicitly left open
  Given: `issues/shared/003-pr11-review-followups.md:35` is the ledger entry for the publish job
  Then: if Open Conflict 1 is ruled "delete the job", that finding is struck from the ledger with a
  pointer to INFRA-014's commit. A ledger that still lists a finding fixed two sprints ago is a
  ledger nobody trusts.

TEST-791: The workflow files are the only diff
  Then: `git diff --stat` for this issue touches `.github/workflows/*`, `CLAUDE.md`, and at most a
  small `scripts/` support module with a test. No `package.json` change, no `.gitignore` change
  (`/*.tgz` and `dist-package/` are already there), no `scripts/coverage-config.ts` change.

---

### UI-030: roving focus for the ⋯ and 💬 popovers

`apps/ui/src/reader/DocMenu.tsx`, `apps/ui/src/reader/CommentsPopover.tsx`, a new shared hook
extracted from `apps/ui/src/menu/ContextMenu.tsx`. Model: **opus**. Port `8806`, Vite `5284`. Read
C15: the mechanism to "share" is not currently shareable, and UI-028's half of the fix already
covers these frames.

TEST-792: The roving-focus mechanism is extracted, and `ContextMenu` consumes the extraction
  Given: C15 — `ContextMenu.tsx` exports only the component; the logic is inline at `:41-44`,
  `:58-73`, `:96-131`
  Then: a single hook (or equivalent shared module) owns item discovery, open-focus, arrow/Home/End
  movement, Tab-dismissal and focus restore, and **`ContextMenu` uses it** rather than keeping a
  private copy. Two implementations of roving focus in `apps/ui/src/menu` at the end of this issue is
  a fail — that is precisely the "share the mechanism, don't fork it" instruction.

TEST-793: `ContextMenu`'s six keyboard tests pass through the extraction, unmodified
  Given: `ContextMenu.test.tsx:119`, `:136`, `:155`, `:172`, `:185`, and the `:236` describe with
  `:257` (Enter/NumpadEnter) and `:276` (esc runs nothing)
  Then: all green with **no assertion edited**. A refactor proved only by tests it was allowed to
  rewrite is not proved.

TEST-794: The ⋯ popover takes focus when it opens, and the arrows move it
  Given: `ReaderHead.tsx:128-141` opens `DocMenu` from the `⋯` button
  When: the popover opens from the keyboard and ArrowDown/ArrowUp/Home/End are pressed
  Then: `document.activeElement` is a `role="menuitem"` button inside `[data-dm-pop]` — **not the
  trigger** — and moves as expected, skipping disabled items. Asserted on `activeElement`, which is
  the exact thing the evaluator found stuck on the trigger.

TEST-795: Enter, NumpadEnter and Space activate — asserted by effect, and without double-firing
  Given: the criterion "Enter/NumpadEnter/Space activate (asserted by effect)", and C15's finding
  that `ContextMenu` deliberately implements no Enter handler because native `<button>` activation
  suffices
  Then: with a menu item focused, each key **runs the action** (the effect is observed — a mutation
  fired, a toast shown, the menu closed), and it runs **exactly once**. A test asserts the handler is
  called a single time per press: an added Enter handler on top of native activation is the obvious
  wrong fix and it double-fires.

TEST-796: Escape closes without running anything, and focus goes back to the trigger
  Given: `DocMenu.tsx:51`'s `useEscapeLayer(EscapeLayerPriority.Popover)`
  Then: esc closes the popover, **no action runs**, and focus returns to the `⋯` button — matching
  `ContextMenu.tsx:58-73`'s restore-to-opener behavior, which `DocMenu.test.tsx:366` never covered.

TEST-797: The 💬 popover gets the same treatment, because it is the same gap
  Given: C15 — `CommentsPopover.tsx:44-51` is structurally identical (same `role="menu"`, same
  `role="menuitem"` buttons at `:58-70`, same `useEscapeLayer` at `:42`, no focus management)
  Then: arrows move focus among the thread items, activation opens the thread, esc closes and
  restores focus. The issue says "audited and fixed if identical" — the audit is done and the answer
  is yes; it is in scope, with its own tests.

TEST-798: The `.cp-empty` case degrades sanely
  Given: `CommentsPopover` renders a `.cp-empty` div when there are no threads
  Then: opening it with no threads does not throw, does not trap focus, and esc still closes. A
  roving-focus hook handed zero items is the edge case that ships broken.

TEST-799: A real e2e keyboard case on the ⋯ popover — the first one that has ever existed
  Given: C15 — `/usr/bin/grep` for `data-doc-menu`, `comments-btn` and `⋯` across
  `apps/ui/e2e/*.spec.ts` returns **zero hits**; `context-menu.spec.ts:411` exercises the *right-click*
  frame
  When: an e2e case opens the ⋯ popover from the keyboard, arrows to an action, and presses Enter
  Then: the action runs in the real app. The spec's file and test title are named in the log. It is
  a **new** case; extending `context-menu.spec.ts` is fine, silently reusing `:411` is not.

TEST-800: UI-028's protection still holds for both frames
  Given: `shell/overlays.ts:29,49-51` + `keyboard/useShortcuts.ts:55` put board shortcuts out of
  scope whenever any `[role="menu"]` is in the DOM, which already covers both popovers
  Then: `useShortcuts.test.tsx:204` stays green, and with either popover open the board's `↵`/`j`/`k`
  still do nothing. UI-030 must not regress the fix it sits on top of.

---

### UI-031: the close-time hover latch

`apps/ui/src/keyboard/useActiveColumn.ts` + `apps/ui/src/shell/Board.tsx`, plus tests and an e2e
case. Model: **opus**. Port `8807`, Vite `5285`. Read C16: the latch already exists, the event is
`mouseover` not `mouseenter`, there are four close paths, and the "focus spec" the issue names is not
a file.

TEST-801: The fix arms the existing latch; it does not build a second one
  Given: C16 — `useActiveColumn.ts:50` `keyboardOwns`, armed by `pin()` (`:73-76`), released by a
  real `mousemove` (`:52-60`)
  Then: the close path arms **that** ref through a new, named member on the `ActiveColumn` interface
  (`:15-37`, returned at `:91`), called from `Board.tsx:632-634`. A parallel suppression flag beside
  an identical existing one is a fail — the signed rule describes the latch that is already there.

TEST-802: Suppression lives in `useActiveColumn`, not on the element
  Given: `Column.tsx:234` is `onMouseOver` (bubbling), which fires on re-entry **and** on any move
  between descendants
  Then: no guard is added to `Column.tsx`'s handler; the early return stays in `activate`. A
  component-level guard would misfire on ordinary intra-column pointer movement.

TEST-803: Close with a parked pointer keeps the origin column — the eval's exact drill
  Given: the UI-022 eval finding (7 dead `esc` presses, survived reload, hovering restored it)
  When: focus mode is entered from column A with the pointer parked over column B's area, then
  closed with `esc`
  Then: **column A is still active**, and `esc` keeps working — the next `esc` acts on the reader
  beneath, as `useEscapeStack.ts:28-37`'s priorities require. Asserted in a unit test and reproduced
  by hand in the real app on `8807`.

TEST-804: All four close paths are covered, not just `esc`
  Given: C16 — `Escape` **and `Backspace`** (`useEscapeStack.ts:49`), the ✕ button
  (`FocusMode.tsx:110`), the depth-0 auto-close (`:87-89`), and the `f` toggle (`Board.tsx:405-411`)
  all reach `setFocusDoc(null)`
  Then: the latch is armed for every programmatic close, and a test covers each. The issue names only
  esc/⌫; arming one path and not the others produces a bug that reproduces "only sometimes".

TEST-805: Real mouse movement resumes hover-follows-active immediately
  Given: `useActiveColumn.ts:52-60` releases on `mousemove`
  Then: after a suppressed close, the **first** real `mousemove` releases the latch and the very next
  `mouseover` adopts normally — no second move required, no delay. Asserted directly.

TEST-806: Click and keyboard activation are untouched
  Given: the criterion "No change to click/keyboard column activation"
  Then: `useActiveColumn.test.ts:21` ("follows hover, focus or a click through `activate`"), `:56`,
  `:76`, and `Board.test.tsx:175` ("follows hover for the active-column cue"), `:123` (`⇧→`) all pass
  **unmodified**. `Board.test.tsx:175` is the one that would catch an over-broad latch, and it must
  not be relaxed.

TEST-807: The e2e case exists, and its home is named
  Given: C16 — there is no focus spec; only `anchor-layer.spec.ts:114-119` enters focus mode against
  the real app
  Then: a real e2e case enters focus mode, parks the pointer over another column (`mouse.move` to
  that column's box, then no further movement), closes, and asserts the origin column keeps
  `.kactive` — and the log names the file and title chosen (extending `anchor-layer.spec.ts` or a new
  spec). Both are acceptable; leaving it implicit is not.

TEST-808: Focus mode's own behavior is unchanged
  Given: `FocusMode.test.tsx:205` ("closes on ✕") and `:216` ("Escape closes the menu, then focus,
  then the column reader")
  Then: both pass unmodified, and `Board.test.tsx:689` (`f` toggles) and `:608` (`⇧↵` opens in full
  screen) too. This issue changes what happens *after* a close, never whether closes happen.

---

## Cross-cutting

TEST-809: The chain was respected — UI-029 → UI-016 → INFRA-013, in commits
  Then: `git log --oneline` on the branch shows `[UI-029]` before `[UI-016]` before `[INFRA-013]`.
  Nothing else about this batch matters if this is wrong: UI-016 cannot install before UI-029, and
  INFRA-013's hook makes the branch uncommittable before UI-016.

TEST-810: INFRA-013's commit is the last of the batch, or at minimum after UI-016's
  Given: the audit gate lands in `.githooks/pre-commit` and fires on **every subsequent commit**
  When: the batch is assembled
  Then: no commit after INFRA-013's would have failed the gate. If the orchestrator pushes
  intermediate states, no pushed head has INFRA-013's CI step without UI-016's router upgrade — CI
  would be red on a branch that is actually fine.

TEST-811: The UI lane ran sequentially; UI-030 and UI-031 never overlapped UI-029's manifest churn
  Given: UI-029 and UI-016 rewrite `package-lock.json` and the installed `node_modules`
  Then: no UI-030 or UI-031 work — no test run, no e2e run, no typecheck — overlapped an install.
  Each agent's log states when it started relative to the previous UI commit. An agent that ran its
  suite against a half-installed tree proved nothing about its own change.

TEST-812: The two lanes touched disjoint files
  Then: the UI issues' combined diff touches only `apps/ui/**`, `packages/kit/package.json`,
  `plugins/*/package.json` and `package-lock.json`; the infra issues' diff touches only
  `.githooks/**`, `.github/workflows/**`, `scripts/**` and `CLAUDE.md`. **The one file both lanes
  could want is `package-lock.json`** — infra has no reason to touch it, and must not.

TEST-813: No implementing agent ran a state-changing git command
  Then: no `commit`, `push`, `checkout`, `reset`, `stash`, `merge`, `rebase` in any agent's session.
  Only the orchestrator commits. This matters more than usual here: INFRA-013's drill involves
  pinning and reverting a vulnerable dependency, which is a file edit, never a git operation.

TEST-814: `SPEC.md` and `packages/contract` are untouched
  Then: `git diff SPEC.md` and `git diff packages/contract` are empty for the whole batch. Nothing in
  this sprint is product-behavioral; a spec gap found mid-implementation is escalated, never patched
  in passing.

TEST-815: Scratch discipline held
  Then: every agent worked under its `…/tmp/s020-*` prefix, never bare `/tmp`, never inside the
  repository; **no glob-delete** of `s020-ui` (four agents) or `s020-infra` (two); only captured
  paths removed. INFRA-014's scratch npm prefix is removed by captured path.

TEST-816: No workspace was scaffolded into the dev repo
  Then: `/Users/theophanerupin/code/corpus/.corpus` is absent — checked and pasted by every agent
  that ran `corpus init`. Confirmed absent at contract time.

TEST-817: Ports and processes are clean, and `8765` was never touched
  Then: each agent's recorded pids are stopped and its ports show no listener; `5173` (ssh, pid
  16094) was never taken; `8765` was never bound, never killed, never proxied into. Every Playwright
  run exported `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790`.

TEST-818: Generated artifacts and the repo-wide gate pass at harvest
  Then: on the merged tree, `node --import tsx scripts/check-generated-artifacts.ts` is green;
  `/lint` and `/test` are green; `npm run coverage` is ≥ 90% on all four metrics with **no new
  per-path exemption** in `scripts/coverage-config.ts`. UI-030's new shared hook and UI-031's widened
  `ActiveColumn` are both inside `COVERAGE_INCLUDE` and must carry their own tests.

TEST-819: The batch's own PR displays INFRA-014's sticky comment — the live proof
  Given: the issue's own testing strategy ("exercised on the implementing PR itself")
  When: the phase PR is opened and then pushed to a second time
  Then: the PR shows **exactly one** packaging comment, updated in place, linking a downloadable
  artifact and naming version/sha/size — and the orchestrator downloads it and completes TEST-787's
  install proof against the **real** artifact. Screenshot or pasted comment body in the PR thread.
  This is the sprint's live test of INFRA-014 and nothing substitutes for it.

TEST-820: Merging the batch's own PR creates no release and publishes nothing
  Given: TEST-784, and that this PR's merge is the negative test the issue names
  When: the phase PR is squash-merged to `main`
  Then: `CI / validate` runs (as it does today), **no GitHub Release is created**, and no packaging
  artifact is published. Confirmed by the orchestrator on the Actions tab and `gh release list`,
  pasted.

TEST-821: The audit gate is green on the merged `main`
  Given: INFRA-013 is fail-closed in CI with no allowlist
  Then: the post-merge `CI / validate` run on `main` passes its audit step with
  `metadata.vulnerabilities.total === 0`. The first red main this gate could cause would be caused by
  this very batch.

TEST-822: Every agent recorded the model it ran on
  Then: each issue's E2E Verification Log states `implemented on: opus | fable`, per CLAUDE.md's
  record-actuals rule. The escalation ladder recalibrates on this data and this batch has two
  P1 upgrades and two P1 CI issues in it.

---

## Out of Scope

- **Any product-behavior change from UI-029 or UI-016.** These are dependency moves. A React 19
  feature (`useOptimistic`, `use()`, the new form actions, `useActionState`) adopted in application
  code during this sprint is out of scope, however tempting it is once the version supports it.
- **Fixing `packages/kit`'s missing `react-dom` peer and missing `@types/react-dom`.** Pre-existing
  asymmetry (C2); it works by hoisting. If it should be fixed, that is a filed kit issue.
- **Any `packages/kit` change beyond the React/type version declarations.** Sprint-018 Adjudication
  6's naming rule stands; UI-029's grant is the manifest, by name.
- **`react-router` data APIs.** No `createBrowserRouter`, no loaders, no actions, no `RouterProvider`
  migration. UI-016 is a five-file import swap and the removal of two `future` flags. The app has one
  real route.
- **New routes.** `/doc/:id`, `/thread/:id` and the search-overlay route are still future work;
  `App.tsx`'s comment about them stays accurate and unimplemented.
- **`npm audit fix` in any form.** The lockfile changes in this sprint are deliberate and made by
  UI-029 and UI-016 only.
- **Any allowlist, severity floor, waiver, or `.npmrc`.** By directive (TEST-772). If a
  genuinely-unfixable advisory appears, that is an escalation to the user, not a mechanism.
- **Moving the audit gate to pre-push.** The user chose pre-commit knowingly; latency is reported,
  not acted on unilaterally.
- **`npm publish`, provenance, and the npm package name.** The name is still provisional (`corpus`
  and `corpus-cli` are taken — sprint-013 Adjudication 9) and nothing has ever been published.
  INFRA-014 removes the ability to publish; it does not resolve the naming question.
- **A `.zip` artifact.** tgz-only by default (TEST-786).
- **Editing the repository ruleset.** The required check stays `validate` (C11); nothing in this
  sprint changes branch protection.
- **The stray root `corpus-0.0.0.tgz`.** Untracked and gitignored (C14); orchestrator bookkeeping, not
  an agent's to delete mid-session.
- **The other 26 open items in SHARED-003's ledger.** Only finding 6 is touched, and only because
  INFRA-014 lands on the exact lines it names (TEST-790).
- **Refactoring the other bespoke arrow handlers** — `SearchOverlay.tsx:158`,
  `RefAutocomplete.tsx:62`, `useConsoleLayout.ts:203`, kit `useAutocomplete.ts:213`. UI-030 unifies
  the three **menu** surfaces (context menu, ⋯, 💬). The autocompletes and the console are different
  interaction models and a different issue.
- **Changing hover-follows-active generally.** UI-031 is a one-shot latch on programmatic close. §10's
  rule is unchanged.
- **Everything Phase 7/8/9 (retrieval).** Sprint-019's chain is a separate branch.

---

## Integration Points

Four seams, and three of them are ordering constraints rather than interfaces:

- **UI-029 → UI-016: a version floor, not an API.** The producer is a lockfile. The consumer is an
  install that fails loudly otherwise. The contracted value is **`react` and `react-dom` resolved
  at ≥ 19.2.7** (TEST-735), because that is `react-router@8.3.0`'s declared peer — not "React 19",
  which is what the issue file says and what a `^19.0.0` range would permit. UI-016 verifies the
  resolved version before it installs anything.
- **UI-016 → INFRA-013: a measured zero, not an assumed one.** The producer is a clean
  `npm audit --json` in **this** tree, with React 19, `scheduler` and `cookie-es` in it (TEST-753).
  The consumer is a gate with no allowlist and no floor. **If the total is not zero, INFRA-013 does
  not start** (TEST-754) — an unconditional gate armed over a non-zero tree makes the branch
  uncommittable, and the failure surfaces as "every commit is blocked", which reads like a broken
  hook rather than a real finding.
- **INFRA-013 ⇄ INFRA-014: one file, two issues, no shared job.** Both edit
  `.github/workflows/ci.yml`. INFRA-013 adds an early step **inside the existing `validate` job**;
  INFRA-014 adds a **separate job** and a separate tag-triggered workflow. Neither renames `validate`
  (C11). Whichever commits second rebases its hunk rather than reformatting the file — a workflow
  YAML reflow is a diff nobody can review. If they must be worked concurrently, INFRA-014 goes first
  (it restructures; INFRA-013 inserts one step).
- **INFRA-014 → the batch's own PR: the artifact is the test.** The producer is a workflow that does
  not exist until it is merged onto a branch and pushed. The consumer is the orchestrator, during PR
  babysitting. So INFRA-014's own acceptance evidence is **split by construction**: the agent proves
  the packaging chain locally (TEST-788), and the orchestrator proves the sticky comment and the
  artifact download on the live PR (TEST-819). Neither half alone closes the issue.

---

## Escalations and Open Conflicts

**Open Conflict 1 — `release.yml` publishes to npm, and the decision on record forbids it.**
`release.yml:78-82` runs `npm publish --provenance --access public`, gated only by an absent
`NPM_TOKEN`, with workflow-level `id-token: write` that exists solely to make provenance possible
(C10). The standing decision is "NO npm publish, ever — distribution is repo-hosted artifacts",
restated in INFRA-014's own Spec References, and `issues/shared/003-pr11-review-followups.md:35`
already recommends deleting the job. INFRA-014's issue text describes *building* a tag workflow
without acknowledging that one exists.
**Recommendation: rule it now — INFRA-014 repurposes the existing `publish` job into a `release`
job**: keep every validation step, replace the terminal `npm publish` step with a GitHub Release
creation that attaches the `npm pack` tarball and generates notes since the previous tag, drop
`id-token: write`, scope `contents: write` to the job. Strike SHARED-003 finding 6 (TEST-790). The
decision is already on the user's record, so this is an orchestrator ruling, not a new user
question — but it changes a file the user has previously reviewed, so **name it in the PR body**.

**Open Conflict 2 — the React version floor.** UI-029's criterion says "React/react-dom 19.x"; the
router's peer is `>=19.2.7` and latest is 19.2.8 (C3). `^19.0.0` satisfies the criterion as written
and can still produce a lockfile that breaks UI-016.
**Recommendation: declare `^19.2.8`** in all four manifests (`@types/react ^19.2.18`,
`@types/react-dom ^19.2.4`), and have UI-016 assert the **resolved** version rather than trusting the
range. Cheap now, an hour of confusion later.

**Open Conflict 3 — `MutableRefObject` in `@types/react@19` is unverifiable without installing.**
Four sites depend on it (C1). The pre-flight is read-only and cannot resolve it.
**Recommendation: TEST-740 as written** — the implementing agent reads the installed
`index.d.ts` and records the declaration verbatim, then takes the corresponding branch. Do not
pre-emptively migrate to `RefObject` "to be safe": if the alias survives, that is four unnecessary
diffs in files nobody else is touching.

**Open Conflict 4 — the audit floor.** The directive is "zero of any severity, no severity floor",
but `--audit-level=low` (the issue's first suggestion) silently tolerates `info` findings (C7).
**Recommendation: `metadata.vulnerabilities.total === 0`** from `--json`, which has no floor and
yields the per-advisory failure message the issue asks for. `--audit-level` becomes decoration.

**Open Conflict 5 — pre-commit warn-and-proceed is a hole, and it is the right hole.** Warning and
continuing when the registry is unreachable means a developer with flaky network commits ungated,
and — since C6 proved the two cases are indistinguishable by exit code — an implementation that got
the discriminator subtly wrong would warn-and-proceed on **real findings**. That is the failure mode
worth losing sleep over, not the network outage.
**Recommendation: keep the issue's default** (local warn+proceed, CI fail-closed), but make it safe
structurally: exactly one code path prints "clean" and it is reachable only from a numeric zero
(TEST-762); the warn branch is selected by an explicit flag the CI workflow never passes, never by
sniffing `CI` (TEST-764); and the warning is unmissable (TEST-763). If the reviewer challenges the
default, the fallback is fail-closed everywhere with a documented `--no-verify` escape — but that is
the user's call, not the agent's.

**Open Conflict 6 — is the 💬 popover in UI-030's scope?** The issue hedges ("check the 💬 comments
popover for the same gap while there"). The audit is now done: `CommentsPopover.tsx` is structurally
identical to `DocMenu.tsx` — same `role="menu"` frame, same `role="menuitem"` buttons, same
`useEscapeLayer`, same absence of focus management (C15).
**Recommendation: in scope, with its own tests (TEST-797, TEST-798).** The extraction is the
expensive part; applying it to a second identical frame is nearly free, and leaving one of two
identical popovers broken is a worse outcome than either fixing or deferring both.

**Open Conflict 7 — UI-031's e2e home.** The issue says "e2e case in the focus spec"; there is no
focus spec (C16). Only `anchor-layer.spec.ts:114-119` enters focus mode against the real app, and it
never closes it.
**Recommendation: extend `anchor-layer.spec.ts`** rather than add a fifteenth spec file — the batch
already has UI-029 and UI-016 asserting "all 14 specs green" (TEST-743, TEST-756), and a new file
mid-batch makes that count ambiguous. If the agent prefers a new spec, it lands **after** UI-016 and
the count is restated in the log. Either way the choice is named, not silent.

**Open Conflict 8 — INFRA-014's install proof cannot be executed by its agent.** The artifact does
not exist until the batch PR runs (C13/TEST-788).
**Recommendation: split it** — agent proves the packaging chain on a locally packed tarball and
marks the download half `DEFERRED`; orchestrator completes it on the live PR (TEST-819). Do not
accept a log that claims the download happened.

**Escalate to the user, not resolvable here:**
- If UI-016's post-install audit is **not** zero (TEST-754). The gate has no allowlist by directive,
  so a residual advisory is a user decision about the directive, not an implementation choice.
- If React 19 forces an application-behavior change anywhere (a rendering difference the suites
  catch). "No behavior change" is the sprint's premise; a real delta invalidates the premise rather
  than the test.

---

## Orchestrator bookkeeping (not an agent's work)

1. **`issues/PLAN.md:137`** lists UI-016 at **P2**; the issue file says **P1** (C17). Reconcile.
2. **UI-016's PLAN status** flips `blocked` → `todo` when UI-029 commits, and its issue file's
   `## Status` (currently `blocked`) with it.
3. **UI-016's stale acceptance criteria.** The issue file's criteria carry inline **BLOCKED**
   annotations from the sprint-018 session. They describe a world that ends when UI-029 lands; clear
   them when the issue is picked up, or the implementing agent will read its own criteria as
   unreachable.
4. **The stray `corpus-0.0.0.tgz`** at the repo root (802.7 KB, untracked, gitignored by
   `.gitignore:32`). Harmless; sweep it before the PR so `git status` reads clean.

---

## Merge order (recommendation)

1. **UI-029 alone, first.** Nothing else in the UI lane may run while it installs. It is the largest
   risk in the batch (React major, 136 test files, 14 e2e specs) and it gets the closest read.
   `/audit` qualifies: >5 files, cross-workspace, and it moves the foundation every UI file sits on.
2. **INFRA-014 in the parallel infra lane, concurrent with UI-029.** Disjoint files (TEST-812), and
   it restructures `ci.yml`/`release.yml` before INFRA-013 has to insert a step into them. Two
   concurrent agents, which is this batch's real ceiling.
3. **UI-016 second in the UI lane**, only once UI-029 is committed and `npm ls react` shows ≥ 19.2.7.
   Small diff, high symbolic value — it is the issue this whole branch exists to unblock. Its
   `npm audit --json` output is the gate for step 4 and goes in the log verbatim.
4. **INFRA-013 after UI-016, and last of the batch** (TEST-810). Its pre-commit step fires on every
   commit that follows, so it goes at the end where nothing follows it. Rule Open Conflicts 4 and 5
   before spawning.
5. **UI-030 and UI-031 after UI-016**, sequentially, never during an install (TEST-811). UI-030 is
   the larger of the two (an extraction plus three consumers plus a new e2e case); UI-031 is a latch
   arm plus tests. They may run concurrently with INFRA-013 — different files, and INFRA-013 starts
   no server.
6. **Audit** — `/audit` qualifies for **UI-029** (foundation-wide) and **INFRA-013** (security-
   sensitive by construction: it is the supply-chain gate, and a subtly wrong offline discriminator
   makes it silently permissive). UI-016, UI-030, UI-031 and INFRA-014 qualify only if they reached
   beyond their stated files.
7. **Harvest** — regenerate the artifact drift check, run the single repo-wide gate (TEST-818).
8. **PR, then babysit** — and the babysitting *is* INFRA-014's acceptance test (TEST-819, TEST-820,
   TEST-821). Push twice deliberately to prove the sticky comment updates rather than appends.
9. **Evaluate** with TEST-803 and TEST-794 as the headline behavioral checks — the two findings a
   real user actually hit — and TEST-819 as the headline infra check.

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- **TEST-753 passes with a pasted `metadata.vulnerabilities` of total 0** — measured in this tree
  with React 19 in it, not inferred from a scratch package. This is the number INFRA-013 is armed
  over, and arming an allowlist-free gate over an unverified tree is how a branch becomes
  uncommittable
- **TEST-735 passes** — the resolved React version is ≥ 19.2.7, pasted from `npm ls`. "React 19" is
  not the requirement; `react-router@8.3.0`'s peer floor is
- **TEST-742, TEST-743, TEST-756 pass with no assertion edited** — 104 + 32 unit test files and all
  **14** named e2e specs green across both upgrades. A test loosened to make a major version pass is
  the major version failing quietly, and this batch has two of them
- **TEST-761 and TEST-762 pass** — the offline discriminator is payload-shaped, tested against both
  real payloads, and there is exactly one code path that can print "clean". Exit codes cannot tell
  the two cases apart (C6) and an implementation that thinks they can is permissive in the one
  scenario the gate exists for
- **TEST-765 and TEST-767 pass, and the vulnerable pin was never committed** — the drill's evidence
  is pasted output plus a clean `git status`, both halves
- **TEST-772 passes** — the absence of any allowlist mechanism is *proved* with a pasted grep, not
  asserted. "No allowlist" is the directive's whole content
- **TEST-782 passes** — `/usr/bin/grep -rn "npm publish" .github/` returns nothing. Open Conflict 1
  is ruled and the workflow that could publish no longer can
- **TEST-819 and TEST-820 pass on the batch's own PR** — one sticky comment, updated in place, with a
  downloadable artifact that installs (TEST-787); and the merge creates no release. INFRA-014's issue
  says its own PR is the live test, and no amount of YAML review substitutes for the comment
  appearing
- **TEST-809, TEST-810 and TEST-811 pass** — the chain held in commit order, the gate landed last,
  and no UI agent ran its suite against a half-installed tree
- **TEST-794, TEST-795 and TEST-803 pass in the real app** — the ⋯ menu is operable from the keyboard
  and `esc` is not stranded by a parked mouse. These are the two findings a human actually reported;
  green unit tests around them are necessary and not sufficient
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest with **no new exemption** in
  `scripts/coverage-config.ts`
- `git diff SPEC.md` and `git diff packages/contract` are empty; the two lanes' diffs are disjoint
  except for nothing at all
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent,
  `5173` was never taken, and `8765` was never bound, killed, or proxied into
- Every Open Conflict is either ruled or explicitly carried forward, and the orchestrator bookkeeping
  items (C17 and the four listed) are cleared

## Orchestrator adjudications (2026-07-31, pre-dispatch)

All eight Open Conflicts resolved per the contract's recommendations: (1) release.yml's
npm-publish job is repurposed into the GitHub Release job under INFRA-014 (id-token
dropped; ledger finding 6 closes; named in the PR body); (2) React floor ^19.2.8;
(3) MutableRefObject measure-then-branch; (4) audit asserts total === 0; (5) offline
warn branch structurally unselectable by CI-sniffing; (6) 💬 popover in UI-030's
scope; (7) UI-031 e2e extends anchor-layer.spec.ts; (8) INFRA-014 install proof split
agent/orchestrator. Bookkeeping applied: UI-016 P1 in PLAN; stray root tgz removed.
