# Sprint 012 — Phase 4, wave 1: the loop's text, the validation wire, and the plugin substrate

**Issues**: AGENT-002, CONTRACT-008, PLUGINS-001
**Domains**: agent-runtime (`assets/workspace` + `scripts/`), contract (`packages/contract`), plugins (`plugins/` + `apps/ui` + `apps/server` + `apps/cli` + `packages/kit` + `eslint.config.js`)
**Date**: 2026-07-28
**Plan phase**: Phase 4 — Agent Loop, Plugins, Packaging (first of two waves)
**Branch**: `phase-4-agent-loop` (currently at `8d99313`, working tree carries only issue/PLAN status flips; agents work in worktrees cut from it)

---

## What makes this sprint different

**Two of the three deliverables are not code.** AGENT-002 ships prose that a language model executes,
and CONTRACT-008 ships type declarations that no process serves yet. Neither can be verified the way
Phase 3 was verified — by clicking something and watching a file change. So this contract does two
unusual things:

- **For AGENT-002 the acceptance surface is split in half.** Half the criteria are *textual* and are
  enforced by an automated test in `scripts/workspace-template.test.ts` (sections present, rules
  present, every `corpus …` invocation resolves against `docs/cli.md`). The other half are
  *behavioral* and are only provable by starting a real `claude` session in a real workspace and
  watching a real queue event go `pending → in-progress → processed`. **A skill that passes the
  textual half and was never run is a fail.** §12 M5's "or simulate with `corpus thread reply --from
  agent`" is a fallback for *M5's server-side* check; it is **not** a substitute for AGENT-002's own
  verification, which is precisely the claim that the prose drives the loop.
- **For CONTRACT-008 the "real application" is the generated artifacts plus a stub app.** Per
  adjudication 2 there are no handlers this sprint. The §12 M1 check is the bar: `npm run generate -w
  packages/contract` idempotent from a clean tree, `openapi.json` carrying the declared shapes, and
  the *generated* typed client calling the *real* route definitions mounted on an `OPENAPIHono` stub
  over real HTTP. Reading the route source and declaring it correct is not verification.

**PLUGINS-001 is the only genuinely cross-domain issue in the batch, and it is the reason the other
two must not drift into its files.** It writes into `packages/kit`, `apps/ui`, `apps/server`,
`apps/cli`, `eslint.config.js`, `plugins/`, and `docs/`. It also *wants* to write into
`assets/workspace/claude/skills/orchestrate/SKILL.md`, which is AGENT-002's exclusive file this
sprint — **adjudication 1** settles that and shrinks PLUGINS-001's skills criterion to *loading*
only.

**The substrate is more built than the issue files think.** Verified by reading the shipped tree at
`8d99313`, not by inventory:

- **`plugins/` already exists and is already an npm workspace.** Root `package.json` has
  `workspaces: ["apps/*", "packages/*", "plugins/*"]` and root `clean` removes `plugins/*/dist`. A
  plugin can carry its own `package.json` and build like any workspace.
- **`NewListSource` already has a `plugin` member.** `apps/ui/src/board/newList.ts` exports
  `type NewListSource = "folder" | "preset" | "plugin" | "search"`. UI-003 left the seat; PLUGINS-001
  fills it. There is no need to widen the union or redesign the picker.
- **`apps/cli/src/registry/index.ts`'s docblock already anticipates plugin verbs**, and
  `validateRegistry` runs at module load — so a plugin topic merged before validation gets the same
  description/example enforcement core verbs get, for free.
- **`routes/inventory.ts`'s `ENDPOINT_INVENTORY` is a pinned, asserted list of the complete HTTP
  surface**, and its docblock already says plugin routes under `/api/x/<plugin>/…` are "discovered at
  runtime … never declared in a static document". CONTRACT-008 must extend that list or
  `routes/index.test.ts`'s *"declares exactly the pinned endpoint inventory"* fails.
- **`apps/server/src/core/check.ts` is complete, I/O-free, and has no caller but its own tests.**
  13 codes, exactly two of them warnings. CONTRACT-008 is pinning a validator that already works.

**And three things the issue files assert are simply not true today**, each of which costs a
debugging cycle if discovered mid-implementation:

- **`corpus skill rollback` and `corpus doc check` do not exist.** Not in `docs/cli.md`, not in
  `apps/cli/src` (`grep -r rollback apps/cli/src` → zero hits). They land in **CLI-006, next wave**.
  AGENT-002 is required to name `corpus skill rollback` in its recovery section *and* to ship a test
  that fails on any `corpus …` invocation absent from `docs/cli.md`. **Open Conflict 1 — blocking.**
- **`corpus thread create` does not exist.** The thread topic is `reopen | reply | resolve`.
  AGENT-002's E2E step 2 offers it as an alternative to the UI; it is not one.
- **`packages/eslint-config` does not exist**, and `eslint.config.js` contains **no**
  `no-restricted-imports` and no boundary rules of any kind. PLUGINS-001 writes both rules from
  scratch into the single root config.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue            | The real application in this sprint                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AGENT-002**    | A **real `corpus init` workspace on `9062`**, a **real server**, a **real browser**, and a **real `claude` session** started in that workspace with `/orchestrate` invoked by hand. Every loop claim is verified against `.corpus/queue/<status>/`, `.corpus/jobs/<eventId>.jsonl`, `GET /api/threads/:id`, and `git log` in the workspace. "The skill says it does this" is not evidence that it does. |
| **CONTRACT-008** | The **committed `openapi.json`**, the **generated `src/client/schema.generated.ts`**, and the **real route definitions mounted on an `OPENAPIHono` stub** listening on `9067`, called by the **generated typed client** over real HTTP. Plus the real server on `9067` proving the routes are *not* served yet (the SERVER-019 before-state).                                                       |
| **PLUGINS-001**  | A **real workspace on `9072`**, a **real Vite dev server on `5281`** (see the port note — `npm run dev -w apps/ui` **cannot** use its default), a **real browser**, a **real `corpus` binary**, and **`plugins/_fixture/`** as the plugin under test. Every column claim is verified against the view document **on disk** and in `git log`; every route claim against `curl` + the SSE stream.      |

### Port allocation

This sprint takes `9060`–`9074` and Vite `5281`. Verified free at contract time
(`lsof -nP -iTCP -sTCP:LISTEN` showed nothing bound in `9000`–`9199`).

| Consumer                   | Range         | Primary | UI dev server              |
| -------------------------- | ------------- | ------- | -------------------------- |
| AGENT-002                  | `9060`–`9064` | `9062`  | — (uses the served board)  |
| CONTRACT-008               | `9065`–`9069` | `9067`  | —                          |
| PLUGINS-001                | `9070`–`9074` | `9072`  | `5281`                     |
| Automated tests, every workspace | —       | `0` (ephemeral). Never hardcode. | — |

**Reserved and off-limits:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the workspace default and the
  target of `apps/ui/vite.config.ts`'s proxy (`SERVER_ORIGIN = process.env.CORPUS_SERVER_ORIGIN ??
  "http://127.0.0.1:8765"`). `apps/ui/e2e/smoke.spec.ts` asserts the console strip reads exactly
  `"server unreachable"`, which is only true when nothing listens on 8765. Always pass `--port`
  explicitly to `corpus init` so its upward probe never reaches it, and check
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done. Verified free at contract time.
- **`5173` and `5174` are held by an `ssh` process**, re-confirmed at contract time. This is not
  advisory for PLUGINS-001: **`apps/ui/vite.config.ts` sets `server.port: 5173, strictPort: true`,
  and the config does not read `CORPUS_UI_PORT`.** A bare `npm run dev -w apps/ui` **will fail to
  start**. PLUGINS-001 runs:

  ```sh
  CORPUS_SERVER_ORIGIN=http://127.0.0.1:9072 npm run dev -w apps/ui -- --port 5281 --strictPort
  ```

  `CORPUS_UI_PORT` is read **only** by `apps/ui/playwright.config.ts`; use it for `npm run e2e`.
- **Playwright is single-holder.** `reuseExistingServer: false` + `--strictPort` means an
  `npm run e2e` run owns `CORPUS_UI_PORT` for its whole duration. Only **one** e2e run at a time on
  this machine. The orchestrator schedules it; PLUGINS-001 is the only claimant in this batch.

### Scratch directories — one prefix per issue

| Issue        | Prefix                                            |
| ------------ | ------------------------------------------------- |
| AGENT-002    | `mktemp -d /tmp/corpus-s012-agent002-XXXXXX`      |
| CONTRACT-008 | `mktemp -d /tmp/corpus-s012-contract008-XXXXXX`   |
| PLUGINS-001  | `mktemp -d /tmp/corpus-s012-plugins001-XXXXXX`    |

Automated tests use `fs.mkdtemp`/`mkdtempSync` with the same prefix.

**Never** `rm -rf /tmp/corpus-*`. Delete only paths you created and captured in a variable.

**The scratch hazard specific to this sprint:** AGENT-002 and PLUGINS-001 both run `git` against a
scratch workspace to prove auto-commits, and AGENT-002 additionally runs a **live `claude` session**
whose working directory is that workspace. Every `git` invocation carries an explicit `cwd` or `-C`.
A `git` command with the wrong working directory operates on **the Corpus repository itself**, and a
`claude` session started in the wrong directory will happily steward *this repo*. Run
`git -C <repo> status` before declaring done.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` and `pkill claude`
kill sibling agents' servers and sessions — **forbidden for the duration of this sprint.** Stop what
you started, by pid:

```sh
node --import tsx apps/cli/src/bin/corpus.ts server start   # then: corpus server stop
npm run dev -w apps/ui -- --port 5281 --strictPort & UI=$!  ; kill -TERM "$UI"
curl -N "http://127.0.0.1:9072/events?token=$TOK" & SSE=$!  ; kill -TERM "$SSE"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. AGENT-002 also
terminates its `claude` session by recorded pid and confirms no orphaned child remains.

### Machine-load discipline — binding on every agent in this batch

- **Scoped tests only during development**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`.
  **Never** the repo-wide suite, never `npm test` without a workspace filter, never `npm run coverage`
  from a worktree. The orchestrator's harvest run is the single repo-wide gate (adjudication 4).
- **One workspace-scoped run at the very end of your session is the maximum**
  (e.g. `VITEST_MAX_THREADS=4 npm test -w packages/contract`).
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time.** Never overlap builds, test runs, e2e, or `npm install`.
- **Playwright/e2e is single-holder** — it starts its own Vite.
- **A live `claude` session is a heavy process.** AGENT-002 runs at most one at a time and never
  while an e2e run or a build is in flight.
- **Before ending, kill every process you started (recorded pids only) and verify your ports are
  free.** After any interrupted run: `ps aux | grep [v]itest`, kill by pid.
- **Cap concurrent implementation agents at three.** This batch is exactly three; they launch
  staggered, not simultaneously.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree at `8d99313` while writing this contract.

**The CLI surface, exactly as generated**

`docs/cli.md` header: `<!-- Generated by \`npm run docs:cli -w apps/cli\` — do not edit by hand. -->`.
Generator: `apps/cli/package.json` → `docs:cli` → `apps/cli/scripts/generate-docs.ts` →
`generateCliDocs(registry)`. Staleness is enforced by `scripts/check-generated-artifacts.ts` in
pre-push and CI.

The complete documented surface — **this is the closed set AGENT-002's skill may draw from**:

```
health · init
db doctor | rebuild
doc archive | create | delete | edit | move
job abandon | list | log | retry
lock acquire | break | list | reap | release
queue abandon | claim-all | complete | fail | halt | idle | reap-stale | resume | status
server logs | start | status | stop
thread reopen | reply | resolve
```

Flag details that a skill written from memory gets wrong:

- **`corpus queue fail <event-id> --reason <text>`** — the reason is a **flag**, not a positional.
- **`corpus job log <event-id> [line]`** — **no flags at all**; the line is an optional positional,
  otherwise read from stdin. (CLI-007 fixed the stdin hang.)
- **`corpus queue idle --wait <seconds>`**, default `480`. Its documented exits: `{"idle":true,
  "reason":"timeout"}` on rearm (**exit 0**, not an error) and `reason: "halted"` while halted.
- **`corpus thread reply <id> -m <text> | --file <path> | stdin`.** There is **no `--agent` flag**;
  attribution is the **global** `--from <user|agent>`, which defaults to **`user`** on every mutating
  verb *including* `lock acquire`.
- **`corpus lock acquire <doc-id> --ttl <seconds>`** — `--ttl` is its only local flag.
- Global flags on every command: `--from`, `--json`, `--workspace`, `--timeout` (10000 ms),
  `--verbose`, `--no-color`, `-h/--help`, `--version`.
- Exit codes: `0` ok · `1` internal · `2` usage · `3` not-a-workspace · `4` server unreachable ·
  `5` server error response · `6` check-style failure.
- `docs/cli.md` on `doc edit`: *"A `423` from the other party's edit lock is reported as a server
  error (exit 5) and is never retried — **the orchestrate skill defers instead**."* The CLI reference
  already promises the behavior AGENT-002 must define. **Open Conflict 2.**

**The workspace template, exactly**

Dotless by design (`docs/workspace-template.md` and `scripts/workspace-template.ts`'s
`INSTALL_RENAMES`): `claude/` installs as `.claude/`, `gitignore` as `.gitignore`, `.gitkeep` is
filtered. The tree:

```
assets/workspace/README.md · gitignore
assets/workspace/claude/agents/.gitkeep
assets/workspace/claude/skills/{orchestrate,comment}/SKILL.md
assets/workspace/data/docs/{inbox/.gitkeep, templates/note.md, views/{attention,inbox,open-threads}.md}
assets/workspace/data/threads/.gitkeep
```

- The orchestrate skeleton's frontmatter ids are **`doc_skillorchestrate`** / **`doc_skillcomment`**
  (not `skill_orchestrate` — AGENT-001's issue text predates the contract's id schema).
- Its current section headings are **seven**: Invariants · The loop · Routing · Job logs · HALT ·
  Stewardship · Worked example. AGENT-002 requires **fourteen**. The existing parameterized test
  `"$name carries its required section headings"` asserts the seven for **both** skills — extending
  the orchestrate list must not break the comment skeleton's assertions (AGENT-003 owns those).
- The existing suite also asserts *"leaves queue terminal-state handling to the orchestrate skill"*
  — the **comment** body must not match `corpus queue (complete|fail)`. AGENT-002 must not
  relocate queue verbs into the comment skill to satisfy a section list.
- `scripts/workspace-template.ts` exports `listTemplateFiles`, `installedPath`,
  `loadTemplateDocuments`, `parseFrontmatter`, `readContractDoc`, `INSTALL_RENAMES`,
  `INSTALL_FILTERS`, `INIT_GENERATED`. **The install rules are deliberately duplicated** in
  `apps/cli/src/commands/init/template.ts` (because `scripts/` is outside the npm workspaces), and
  `apps/cli/src/commands/init/template.test.ts` proves the three implementations agree. Anything that
  changes what `corpus init` creates must keep that agreement — see the AGENT-002 ↔ PLUGINS-001
  integration point.
- `corpus init` (`apps/cli/src/commands/init/scaffold.ts`) creates `.claude/skills`,
  `.claude/skills-archived`, `.claude/agents` among `WORKSPACE_DIRECTORIES`, copies via
  `planTemplateInstall(templateRoot)`, and records `{path, sha256}` per copied file into
  **`.corpus/template-manifest.json`** — which CLI-005's `workspace upgrade` reads. `.gitkeep` is
  never copied; `--force` does not exist.

**The validator CONTRACT-008 is pinning**

`apps/server/src/core/check.ts`, I/O-free, no HTTP route, no CLI verb, consumers today are its own
tests only:

```ts
export type CheckSeverity = "error" | "warning";
export type CheckFinding = { code: CheckCode; severity: CheckSeverity;
                             docId: string | null; path: string; detail: string };
export type CheckReport  = { errors: readonly CheckFinding[]; warnings: readonly CheckFinding[] };
export type CheckDocument =
  | { path: string; ok: true;  document: ParsedDocument }
  | { path: string; ok: false; error: string };
export const toCheckDocument = (path: string, raw: string): CheckDocument;
export const checkCorpus = (documents: readonly CheckDocument[], options?: CheckOptions): CheckReport;
```

`CHECK_CODES` has thirteen members. **Exactly two are warnings**: `anchor-unresolved` and
`ref-unresolved` — matching §11's "unresolvable-but-well-formed anchors (orphaned threads) and
unresolved `[[refs]]` are warnings". The other eleven (`frontmatter-unparseable`,
`frontmatter-invalid`, `id-prefix-mismatch`, `duplicate-id`, `anchor-malformed`,
`duplicate-anchor-id`, `thread-parent-missing`, `thread-anchor-missing`, `anchor-claimed-twice`,
`anchor-unused`, `duplicate-turn-timestamp`) are errors — note `anchor-unused` is deliberately an
**error**.

**Precision the issue file gets slightly wrong:** `CheckDocument` is *not* the `(path, content)`
pair — it is the **parsed** union. The pair is `toCheckDocument`'s **argument list**. The wire's pair
is therefore `{path, content}`, and adjudication 2's "reuse `CheckDocument`'s pair shape" means:
`content` is the raw file bytes the server hands to `toCheckDocument(path, content)`, and the
response reuses `CheckFinding`/`CheckReport`'s field names verbatim.

**The contract package's conventions**

- One file per resource under `src/routes/` and `src/schemas/`; `routes/index.ts` exports the
  `contractRoutes` object and `ALL_CONTRACT_ROUTES`. **Registration order is load-bearing** (static
  segments before `{id}` params) and is pinned by tests.
- `src/routes/inventory.ts` exports `ENDPOINT_INVENTORY`, a pinned complete list asserted by
  `routes/index.test.ts` → *"declares exactly the pinned endpoint inventory"*. **Adding a route
  without extending it fails that test.**
- Errors: `src/schemas/error.ts` — `ERROR_CODES = ["bad_request","unauthorized","forbidden",
  "not_found","conflict","locked","internal_error"]`, discriminated on `code`;
  `ValidationErrorSchema` carries `issues: {path, message}[]`. Response constants live in
  `src/routes/responses.ts`: `jsonContent`, `UNAUTHORIZED_RESPONSE` (401), `VALIDATION_RESPONSE`
  (400), `NOT_FOUND_RESPONSE` (404), `CONFLICT_RESPONSE`, `LOCK_CONFLICT_RESPONSE`,
  `LOCKED_RESPONSE` (423), `FORBIDDEN_RESPONSE`, `PAYLOAD_TOO_LARGE_RESPONSE`. **No route declares
  500** — an asserted invariant. **Routes declare only the codes they can return** — also asserted.
- Actor attribution rides `ActorHeaderSchema` in `request.headers`, not a body field.
- `npm run generate -w packages/contract` writes **both** `openapi.json` and
  `src/client/schema.generated.ts`.

**The plugin substrate's shipped seams**

- `apps/ui/src/` is domain-foldered: `anchors app board compose console dev editor keyboard reader
  search shell thread testing`. **There is no `apps/ui/src/plugins/`** — PLUGINS-001 creates it.
- The board strip is `apps/ui/src/shell/Board.tsx`; the column card is `apps/ui/src/board/Column.tsx`
  (+ `ColumnHead/ColumnList/ColumnMenu`); view documents map to columns through
  `apps/ui/src/board/viewDoc.ts` (`BoardColumn`). The picker is `apps/ui/src/board/NewListPicker.tsx`
  over the model in `apps/ui/src/board/newList.ts`, which **already exports
  `NewListSource = "folder" | "preset" | "plugin" | "search"`**, `NewListChoice`, `PRESET_CHOICES`,
  `folderChoices`, `searchChoice`, `columnRequest(choice, order)`, `VIEW_DOCUMENT_FOLDER = "views"`.
- `packages/kit/src/index.ts` is documented as *"the only import surface plugins may use (SPEC.md
  §10)"* and deliberately does **not** re-export the openapi-fetch transport. `packages/kit/
  package.json`'s exports map has `.`, `./testing`, and four CSS entries — **no `./plugin`**;
  PLUGINS-001 adds it, and `files:` must carry anything outside `dist`.
- `apps/server/src/app.ts` mounts by calling `mountEventStream · mountQueueRoutes · mountLockRoutes ·
  mountDocsRoutes · mountThreadRoutes · mountCaptureRoutes · mountJobRoutes · mountDbRoutes ·
  mountAttachmentRoutes`, then `app.get(OPENAPI_PATH)` and `mountStaticUi`. **Zero occurrences of
  "plugin".** Discovery is a new `mountPluginRoutes(app, …)` placed **after** the core mounts.
- `apps/cli/src/registry/index.ts` assembles
  `validateRegistry({summary, commands: [healthCommand, initCommand], topics: [server, doc, thread,
  queue, lock, job, db]})` **at module load**. `TopicSpec = {name, summary, description?, commands}`;
  `CommandSpec` is the `WorkspaceCommandSpec | StandaloneCommandSpec` union carrying
  `{name, summary, args, flags, examples, handler}` — every command needs ≥1 example, enforced by
  `validateRegistry`.
- `eslint.config.js` is a **single ~48-line root config**. `packages/eslint-config` **does not
  exist**. There are **no** `no-restricted-imports` or import-boundary rules today.
- `scripts/coverage-config.ts`: `COVERAGE_INCLUDE = ["apps/*/src/**", "packages/*/src/**",
  "plugins/*/src/**"]`. Note the third glob is **`plugins/*/src/**`**, while §10's layout puts
  `manifest.ts`, `server/routes.ts` and `cli/commands/*.ts` at the plugin **root**. **Open Conflict 6.**

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification — is marked `DEFERRED → <issue>` or
`STRUCK → Adjudication N` / `STRUCK → Open Conflict N` in the E2E Verification Log, with the reason
and the substitute evidence supplied. **Silent omission is a fail.**

---

## Acceptance Tests

### AGENT-002: Orchestrate skill — the agent's main loop

Ports `9060`–`9064`, primary `9062`. Scratch `/tmp/corpus-s012-agent002-*`. **P0, fable. 47 criteria.**
Half are textual and machine-checked; half require a live `claude` session. **Both halves are
required.** The file under test is `assets/workspace/claude/skills/orchestrate/SKILL.md` — owned
exclusively by this issue this sprint (adjudication 1).

#### The file and its frontmatter

```
TEST-1: Frontmatter shape preserved, `updated` advanced, `created` untouched
  Given: The AGENT-001 skeleton at HEAD
  When:  The shipped file's YAML block is parsed
  Then:  One YAML block carries BOTH field sets — `name: orchestrate` (equal to the containing
         directory name), `description`, `id: doc_skillorchestrate`, `type: skill`,
         `title: Orchestrate`, `status`, `created`, `updated`, `tags`, `evergreen: true` — with
         `created` byte-identical to the skeleton's and `updated` strictly later. `git diff` on the
         frontmatter is quoted and shows exactly those changes

TEST-2: The path stays dotless
  Then:  The file is at `assets/workspace/claude/skills/orchestrate/SKILL.md`. No path under
         `assets/workspace/` begins with a dot except `.gitkeep` — the existing test
         "uses no dot-prefixed name other than .gitkeep" still passes. (PLUGINS-001's file list names
         `assets/workspace/.claude/skills/…`, which does not exist and is forbidden — Open Conflict 9)

TEST-3: No skeleton remnants, no placeholders
  Then:  The body contains no `TODO`, `TBD`, `<fill`, `Arrives with AGENT-002`, "skeleton", or
         "placeholder". Every surviving `<…>` token is an argument placeholder inside a documented
         example, and the E2E log ENUMERATES them

TEST-4: The skill is the product's voice, not the dev harness's
  Then:  The body names no dev-harness artifact — no `issues/`, no `SPEC.md`, no `CLAUDE.md`, no
         `.claude/agents/server-dev`-style domain agent, no `/implement` or `/decompose`. It
         addresses an operator running `corpus` in their own workspace (CLAUDE.md "Product vs. dev
         harness")
```

#### Required sections, machine-checked

```
TEST-5: All fourteen required sections are present and substantive
  Then:  Purpose/when to run · Invariants · The loop · Claiming and batching · Routing table ·
         Concurrency and ordering · Locks and deferral · Progress and job logs · Completing and
         failing · HALT · Stewardship charter · Skills and subagents are documents · If the loop
         breaks (operator recovery) · Worked example. Each is asserted by
         `scripts/workspace-template.test.ts` against a keyword set, and each carries more than a
         heading — the test asserts a minimum substantive body per section, so a heading with one
         sentence fails

TEST-6: The extension does not break the comment skeleton
  Then:  The existing parameterized suite still passes for `comment`: its seven headings, its
         "states the CLI-only invariant", and "leaves queue terminal-state handling to the
         orchestrate skill" (the comment body must still not match `corpus queue (complete|fail)`).
         AGENT-002 does not move queue verbs into the comment skill to satisfy a section list
```

#### The loop, literally

```
TEST-7: The loop appears once, as literal copy-pasteable commands, in order
  Then:  `corpus queue claim-all` → handle → `corpus queue complete|fail <id>` →
         `corpus queue idle` → repeat, shown once as a literal block with nothing left to infer

TEST-8: `idle` is the only wait, and the file proves it
  Then:  The text forbids `sleep`, polling and busy-waiting in so many words, AND the whole body
         contains no `sleep`, `while true`, `watch `, or timer construct outside that prohibition
         sentence. Grep output quoted

TEST-9: The rearm exit is a normal outcome, spelled the way the CLI actually spells it
  Then:  The text states that `corpus queue idle` exits **0** after its ~8-minute window with
         `{"idle":true,"reason":"timeout"}` and that the loop simply re-invokes it; and that while
         halted it reports `reason: "halted"`. No invented exit code, no invented flag —
         `--wait <seconds>` (default 480) is the only flag it has

TEST-10: `claim-all` is one batch, claimed once
  Then:  The text says `claim-all` returns the whole pending batch as one JSON payload; parse it,
         group it, work it, and do NOT claim again mid-batch

TEST-11: An empty batch is not an error
  Then:  The text states that an empty `claim-all` result (halted, or a race) goes straight to
         `idle`
```

#### The routing table

```
TEST-12: One row per core event type, no gaps
  Then:  `comment.created` → the comment skill · `form.respond` → the comment skill ·
         `agent.done` → resume the parked work identified by the payload ·
         `<plugin>.<action>` → the skill named `<plugin>` by convention ·
         unknown type → `corpus queue fail <id> --reason "<why>"`. Presented as a table

TEST-13: Unknown types are never guessed and never silently completed
  Then:  The text says so explicitly, and the failure reason format is shown

TEST-14: The plugin row is generic — no plugin name appears anywhere in the skill
  Then:  Grep the body for `todos`, `_fixture`, or any concrete plugin name → empty. The convention
         is stated as `<plugin>.<action>` → skill `<plugin>` with nothing hardwired. This is the
         criterion PLUGINS-001 depends on and does not write (adjudication 1)

TEST-15: A missing or archived plugin skill fails the event, naming the skill
  Then:  The text states that if no skill named `<plugin>` is installed, or it has been archived
         into `.claude/skills-archived/`, the event is failed with a reason NAMING the missing
         skill — so the console row is actionable

TEST-16: §8's structured routing is honored
  Then:  The routing section states that the event payload carries structured `mentions` and
         `skills`; `@<subagent>` routes to that `type: agent-def` persona and `/<skill>` applies
         that skill (both may combine); a missing or archived target is NOT silently ignored — the
         agent says so in its reply. Generic `@agent` leaves routing to triage
```

#### Concurrency and ordering

```
TEST-17: "The document an event touches" is computed, not hand-waved
  Then:  For thread events: the thread id AND its `parent` document id. For plugin events: the
         document ids in the payload. Stated as a rule an implementer can execute

TEST-18: Serial per document in claim order, parallel across documents, with a STATED cap
  Then:  Events touching the same document run serially in claim order (and the text says why: the
         second must see the first's effects). Independent documents may run in parallel via
         subagents, with an explicit numeric cap

TEST-19: A subagent never touches queue state
  Then:  Stated explicitly, as a prohibition, with the reason (it corrupts queue accounting). The
         orchestrator alone owns `claim-all`/`complete`/`fail`
```

#### Locks and deferral

```
TEST-20: The deferral protocol is concrete, executable, and matches the CLI's actual behavior
  Given: `docs/cli.md` states a `423` on `doc edit` surfaces as exit 5, is never retried, and
         "the orchestrate skill defers instead"
  Then:  The skill states the adjudicated deferral protocol (Open Conflict 2) as an ordered command
         sequence: what the agent does with the claimed event, what it posts to the waiting user,
         and how the deferred work re-enters the loop when the lock clears. "Defers" as a bare verb
         with no mechanism is a FAIL — the whole point of this criterion is that the next agent can
         execute it without inventing anything

TEST-21: The agent never forces a lock
  Then:  The text states that `corpus lock break` is the human's escape hatch and the agent does not
         use it; that the CLI acquires locks implicitly on edit verbs; and that `corpus lock reap`
         clears expired (TTL'd) locks including one left by the agent's own crashed run

TEST-22: Attribution is unmissable and correct in every example
  Then:  The skill states that `--from` defaults to **user** on every mutating verb INCLUDING
         `lock acquire`, and instructs the agent to set `CORPUS_FROM=agent` (or pass
         `--from agent` on every call). Then: every mutating `corpus …` invocation in the body
         either carries `--from agent` or is explicitly covered by the stated environment rule.
         Enumerated invocation by invocation in the E2E log
```

#### Progress, terminal states, HALT

```
TEST-23: Job logging is specified with a good line and a bad line
  Then:  `corpus job log <eventId> "<line>"` at claimed / routed / acted / terminal, with a concrete
         useful example ("edited [[doc_a1b2c3]] — updated the rate assumption") contrasted against a
         useless one ("working"), and an explicit prohibition on narrating tool calls or streaming
         tokens. The command is spelled with NO flags — it has none

TEST-24: Every claimed event reaches a terminal state, stated as an invariant
  Then:  Stated up front in Invariants and restated in Completing and failing, including error paths
         and interruptions; `corpus queue reap-stale` is named as the recovery for events stranded
         in `in-progress`, and the text says to run it at loop start after an unclean stop

TEST-25: Failing is specified end to end
  Then:  `corpus queue fail <id> --reason "<concise reason>"` (a FLAG, not a positional), the same
         reason written to the job log, and — when a user is waiting on a `comment.created` or
         `form.respond` — a short reply posted through `corpus thread reply` BEFORE failing, so §8's
         pending indicator resolves instead of hanging

TEST-26: HALT is stated as a quiet loop, not an exit
  Then:  `.corpus/HALT`; while present `idle` parks (`reason: "halted"`) and `claim-all` returns
         empty; the correct behavior is to keep looping quietly, never to exit or error; and
         `corpus queue halt` / `corpus queue resume` are named as the operator's controls
```

#### Stewardship, skills-as-documents, recovery, worked example

```
TEST-27: The §7 charter is complete, rule by rule
  Then:  All of: durable knowledge from threads becomes documents (created or updated); stale
         content updated; obsolete archived; misfiled moved; near-duplicates merged; overgrown
         split; what changed is stated in the reply that occasioned it; **the agent archives and
         never deletes** (deletion is user-only); every change traceable via the CLI's auto-commit
         with agent authorship. Each mapped to a quoted line in the E2E log

TEST-28: Stewardship gives decision rules, not "use your judgment"
  Then:  Grep the body for "use your judgment", "consider whether", "you may want", "if
         appropriate" → each hit is either absent or immediately followed by a concrete rule and an
         example. The issue's writing standard is a criterion, not advice

TEST-29: Skills and subagents are documents
  Then:  The text states that new or edited skills and `type: agent-def` documents take effect as
         files under `.claude/`, are visible and commentable on the board, and are edited through
         the CLI like any document — and that editing `orchestrate` from inside the loop is allowed
         but takes effect only on the NEXT `/orchestrate`

TEST-30: The operator recovery section is written for the human
  Then:  Symptoms of a broken core-loop skill; the ordered path `corpus queue halt` →
         `corpus skill rollback orchestrate|comment` → `corpus queue resume`; and the note that
         archiving a skill (`corpus doc archive`) disables it by moving it to
         `.claude/skills-archived/` while it stays indexed. Subject to Open Conflict 1

TEST-31: The worked example is a real trace
  Then:  One end-to-end `comment.created` trace from `claim-all` through the reply to `complete`,
         with the literal commands in order, realistic ids (`evt_…`, `th_…`, `doc_…`), and no
         ellipsis standing in for a required argument. Every command in it is copy-pasteable

TEST-32: The heredoc convention holds everywhere
  Then:  Every multi-line text argument in the body goes through a quoted heredoc (`<<'EOF'`), so
         the agent's own content is never re-interpreted by the shell. No unquoted heredoc, no
         `-m "$(...)"`
```

#### The CLI-command-existence test — the thing that keeps the skill honest

```
TEST-33: The extractor exists and handles both forms
  Then:  `scripts/workspace-template.ts` exports a helper that extracts `corpus …` invocations from
         template markdown — from FENCED CODE BLOCKS and from INLINE CODE — normalizes each to
         `topic verb` (or a bare top-level command), and resolves it against `docs/cli.md`. Its unit
         tests cover: a fenced multi-line invocation, an inline one, a heredoc body that merely
         MENTIONS the word corpus (must not be extracted), a prose sentence (must not be extracted),
         and a top-level command with no topic (`corpus init`)

TEST-34: The test actually fails on a nonexistent command
  When:  `corpus doc frobnicate` is temporarily inserted into the skill body
  Then:  `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts`
         FAILS naming `doc frobnicate`. Removing it makes the suite pass. BOTH runs are quoted in
         the E2E log. A test asserted to exist but never made to fail is not evidence

TEST-35: The test's scope is declared, and the README is accounted for
  Then:  The E2E log states whether the check covers the whole template tree or only skill bodies,
         and the choice is consistent with what the tree contains: `assets/workspace/README.md`
         ALREADY names `corpus skill rollback <name>`, which does not exist in `docs/cli.md`. Either
         the scope excludes the README (stated), or the allowlist of Open Conflict 1 covers it
         (stated). A green suite achieved by silently narrowing the scope is a FAIL

TEST-36: `docs/workspace-template.md` records the coupling
  Then:  It notes that skill bodies are verified against `docs/cli.md`, so a CLI surface change can
         break AGENT skills, and names the regeneration command
```

#### The live loop — real workspace, real server, real `claude` session

```
TEST-37: A real workspace boots on 9062
  When:  `corpus init <scratch> --port 9062` then `corpus server start`
  Then:  The board URL is printed and loads in a real browser; `corpus queue status` reports zero
         pending; `corpus db rebuild && corpus db doctor` is clean. (The issue's step-1
         `corpus doc check` is STRUCK — it does not exist until CLI-006; `db doctor` is the
         substitute and the log says so)

TEST-38: An agent-requested comment enqueues a real event
  When:  A comment requesting the agent is posted through the real UI (or `POST /api/threads` with
         `requestsAgent: true` — `corpus thread create` does NOT exist and the log names the
         interface actually used)
  Then:  A `comment.created` JSON file appears in `.corpus/queue/pending/`, quoted verbatim, and the
         UI shows the §8 pending indicator

TEST-39: A live `claude` session drives the event to a terminal state
  When:  `claude` is started in the workspace and `/orchestrate` is invoked by the operator
  Then:  ALL of, each captured: the `claim-all` output; the event file moving
         `pending/ → in-progress/ → processed/`; `corpus job log` lines present in
         `.corpus/jobs/<eventId>.jsonl` AND rendered in the console drawer for that job; an agent
         turn present in `GET /api/threads/:id` AND appearing in the browser WITHOUT a reload (SSE);
         and the loop parking on `idle`. This is the criterion the whole issue exists for

TEST-40: The agent's writes are attributed to the agent
  Then:  `git -C <workspace> log` shows the reply commit authored as `agent`, and the thread file's
         turn header reads `## agent · <ts>`. This is what proves the TEST-22 attribution
         instruction works in practice rather than on paper

TEST-41: The parked loop wakes promptly, not on rearm
  When:  A second comment is posted in the same thread while the loop is parked
  Then:  It is handled with no operator intervention, and the wall-clock gap between the POST and
         the `claim-all` is STATED and is on the order of a second — not ~8 minutes

TEST-42: Two events on the same document are serial and ordered
  When:  Agent-requested comments are posted on two threads of the SAME parent document in quick
         succession
  Then:  They are handled serially in claim order; the second reflects the first's effects; job-log
         timestamps are quoted and show no interleaving

TEST-43: Two events on independent documents keep queue accounting correct
  When:  The same test across two unrelated documents
  Then:  Handling may overlap, and afterwards `corpus queue status` shows zero `in-progress`, no
         event appears in two status directories, and no event was completed twice

TEST-44: HALT stops consumption without stopping production
  When:  `corpus queue halt`, then an agent-requested comment is posted
  Then:  The loop stays quiet, `claim-all` returns an empty batch, the event REMAINS in
         `.corpus/queue/pending/`, and the console shows the halted state. `corpus queue resume` →
         the event is picked up without restarting the session

TEST-45: Lock deferral happens for real, and nothing is forced
  Given: The document's lock held by the user (the UI editor, or
         `corpus lock acquire <docId> --from user`)
  When:  An `@agent` comment asks for an edit to that document
  Then:  The agent does NOT break the lock (grep the session transcript for `corpus lock break` →
         empty), it posts a reply so the user is not left hanging, and it follows the adjudicated
         deferral protocol exactly as the skill states it. Releasing the lock → the edit lands and
         the file changes on disk

TEST-46: Force unlock is observed honestly
  When:  An agent-held lock is broken via the UI or `corpus lock break`
  Then:  The break is recorded in the commit trail. Whether the deferred edit re-enters the queue
         (§7 says it should) is VERIFIED against `.corpus/queue/`; if the server does not re-enqueue,
         that is recorded as a SERVER finding for the next wave and is NOT worked around inside the
         skill text

TEST-47: An unknown event type fails loudly
  When:  A queue event with a bogus `type` is hand-placed in `.corpus/queue/pending/`
  Then:  The loop fails it with a reason; the event lands in `.corpus/queue/failed/`; the console
         shows a failed job carrying that reason; nothing was silently completed

TEST-48: `reap-stale` recovers a killed session
  When:  The `claude` session is killed mid-event
  Then:  The event is stranded in `.corpus/queue/in-progress/`; `corpus queue reap-stale` recovers
         it; a fresh `/orchestrate` picks it up and drives it to terminal

TEST-49: Stewardship happens, and leaves a trace
  When:  A durable preference is stated to the agent in a thread
  Then:  It lands in a document (created or updated) VIA THE CLI; `git -C <workspace> log` shows the
         commit authored by the agent; and the agent's reply states what it changed

TEST-50: The CLI-only invariant holds behaviorally, not just textually
  Then:  Across the whole live session, every workspace commit was made by the server's
         auto-committer — no commit produced by the session's own file-writing tools — and the
         session transcript contains no Write/Edit of, or shell redirection into, `data/`,
         `.corpus/` or `.claude/`. Grep output quoted. This is the one invariant whose violation is
         invisible in the finished artifact

TEST-51: Loop safety is proven, not merely documented
  When:  The orchestrate skill document is edited through the UI editor into something broken, the
         loop is restarted to observe the failure mode, and the skill's OWN recovery section is
         followed verbatim
  Then:  The loop returns. If `corpus skill rollback` has not landed (CLI-006), this is
         `DEFERRED → CLI-006` with substitute evidence: recovery performed by restoring the file
         through `corpus doc edit`/git, AND the recovery text verified to name exactly the verb and
         argument shape CLI-006 will ship (`corpus skill rollback <name> [--to <ref>]`), so the text
         is correct on the day the verb exists (Open Conflict 1)
```

---

### CONTRACT-008: Validation + skill-rollback routes

Ports `9065`–`9069`, primary `9067`. Scratch `/tmp/corpus-s012-contract008-*`. **P1, opus. 20 criteria.**
**Wire surface only — no consumer changes** (adjudication 2). The issue file's Technical Design says
"to be refined when scheduled"; this section IS the refinement, and the shapes below are the contract
SERVER-019 and CLI-006 will implement against.

#### The declared surface

```
TEST-52: Exactly two routes are added, and the inventory knows about them
  Then:  `packages/contract/src/routes/` gains the validation route and the skill-rollback route
         (one new resource file, following the one-file-per-resource convention), both exported
         through `contractRoutes` and `ALL_CONTRACT_ROUTES`. `src/routes/inventory.ts`'s
         `ENDPOINT_INVENTORY` is extended, so `routes/index.test.ts`'s "declares exactly the pinned
         endpoint inventory" passes. No OTHER route is added, renamed, or removed —
         `git diff` on `inventory.ts` shows exactly two added entries

TEST-53: Registration order is preserved
  Then:  The new routes are inserted so that static segments still precede `{param}` segments in the
         registration order the existing tests pin. `routes/index.test.ts`'s method/path uniqueness
         and ordering assertions pass unchanged

TEST-54: The paths are the adjudicated ones
  Then:  `POST /api/check` (validation) and `POST /api/skills/{name}/rollback` (targeted revert).
         The skill name rides the PATH, per the convention every other resource route follows; the
         issue file's `{name, to?}` request is satisfied with `name` in the path and `{to?}` in the
         body. Subject to Open Conflict 4 if the orchestrator rules otherwise
```

#### Validation route

```
TEST-55: The request is ids XOR (path, content) pairs, enforced by the schema itself
  Given: The route definition's request body schema
  Then:  `{ids: string[]}` is accepted; `{documents: [{path, content}]}` is accepted; supplying BOTH
         is rejected by the route's own validator with the standard 400 `bad_request` +
         `issues[]`; supplying NEITHER is likewise rejected. The XOR lives in the schema (a
         discriminated union or a refinement), not in a handler that does not exist yet

TEST-56: The pair shape reuses the validator's, field for field
  Then:  The wire pair is `{path: string, content: string}` — exactly `toCheckDocument(path, raw)`'s
         argument list, so SERVER-019's handler is a one-line `documents.map(d =>
         toCheckDocument(d.path, d.content))`. The E2E log quotes `apps/server/src/core/check.ts`'s
         signature beside the contract schema (adjudication 2)

TEST-57: Empty collections are legal and mean "nothing to check"
  Then:  `{documents: []}` and `{ids: []}` validate and are documented as returning an empty report
         — matching CLI-006's "no staged document paths → exit 0, silent". A rejection here would
         force the CLI to branch on emptiness

TEST-58: The response separates errors from warnings, reusing CheckReport's shape
  Then:  `{ok: boolean, errors: Finding[], warnings: Finding[]}` where `Finding` is
         `{code, severity, docId: string|null, path, detail}` — the field names of `CheckFinding`
         verbatim. `ok` is documented as `errors.length === 0`, i.e. exactly the exit-6 class

TEST-59: The code vocabulary matches the validator's, exhaustively
  Then:  The schema's `code` is a closed enum equal to `CHECK_CODES`' thirteen members, and the
         route description records which two are warnings — `anchor-unresolved` and `ref-unresolved`
         (§11: orphaned anchors and unresolved `[[refs]]`). The other eleven are errors, INCLUDING
         `anchor-unused`. The log quotes both lists side by side and asserts they agree

TEST-60: Validation is read-only and says so
  Then:  The route declares NO actor header (it mutates nothing), and its description states that it
         exposes the same validator the write path runs (§11: "hooks and API share one
         implementation")
```

#### Skill-rollback route

```
TEST-61: Request and response shapes
  Then:  Request body `{to?: string | null}` (a git ref; omitted means last-known-good). Response
         carries the restored `commit` (sha) and the workspace-relative `path`, plus the skill
         `name` and the skill document's `docId`. Every field's meaning is in the route description

TEST-62: 404 for an unknown skill, using the standard envelope
  Then:  The route declares `NOT_FOUND_RESPONSE` with the shipped `NotFoundErrorSchema`
         (`code: "not_found"`). No new error shape is introduced, and the description states the
         condition: no skill directory of that name under `.claude/skills/`

TEST-63: Rollback is a mutation and carries the acting party
  Then:  The route declares `ActorHeaderSchema` in `request.headers`, exactly as every other mutating
         route does (§9.2: "every mutating request carries the acting party — it becomes the git
         author"). The description states the revert lands as a normal auto-commit

TEST-64: Routes declare only the codes they can return
  Then:  Each route's `responses` map is minimal and honest — 200, plus `VALIDATION_RESPONSE` (400)
         and `UNAUTHORIZED_RESPONSE` (401) where applicable, plus 404 on rollback. NEITHER declares
         500 (the asserted no-500 invariant), and neither declares a 423/409 it cannot produce.
         `src/openapi.test.ts`'s existing "routes declare only the codes they can return" passes
```

#### Auth, artifacts, client

```
TEST-65: Both routes require the workspace bearer token
  Then:  Neither carries `security: []`; neither joins the documented exception list (health probe,
         loopback job-log ingest). Verified against the generated `openapi.json`'s security blocks

TEST-66: Generation is idempotent from a clean tree, twice
  When:  `npm run generate -w packages/contract` is run on a clean tree, then again
  Then:  `git status --porcelain packages/contract` is empty after BOTH runs (§12 M1). Output quoted

TEST-67: The artifact drift check is green, twice in a row
  When:  `node --import tsx scripts/check-generated-artifacts.ts`
  Then:  Green on both runs, and it FAILS when a route is hand-edited without regenerating —
         demonstrated once and reverted

TEST-68: `openapi.json` carries the declared shapes
  Then:  The committed artifact contains both paths with their request schemas, their 200 response
         schemas, the 400/401 responses, and rollback's 404. Quoted FROM THE ARTIFACT, not from the
         route source — the artifact is what SERVER-019 and every future consumer read

TEST-69: The generated client exposes both, typed
  Then:  `src/client/schema.generated.ts` carries both operations, and the client surface exposes a
         named method per route following the shipped naming convention. A call with a wrong-shaped
         body is a COMPILE-TIME error, asserted with `@ts-expect-error` or `expectTypeOf` — not a
         runtime test

TEST-70: Round-trip against a stub app, over real HTTP
  Given: The REAL route definitions mounted on an `OPENAPIHono` stub with trivial handlers, listening
         on 9067
  When:  Both routes are called through the GENERATED typed client
  Then:  Typed responses come back and type-check; a malformed body is rejected by the ROUTE's own
         validator with the standard 400 + `issues[]` (proving the schema does the work, not the
         stub handler); an unknown skill name reaches the handler with the path param parsed. This
         is §12 M1's check, instantiated

TEST-71: Zod round-trips per schema
  Then:  Vitest covers parse/serialize round-trips for both request schemas and both response
         schemas, including the XOR rejection cases and a finding of each severity
```

#### Scope discipline

```
TEST-72: No consumer changed
  Then:  `git diff --stat` for this issue touches `packages/contract/**` and its generated artifacts
         ONLY. Zero files under `apps/server`, `apps/cli`, `apps/ui`, `packages/kit`
         (adjudication 2). SERVER-019 and CLI-006 are the next wave

TEST-73: The server does not accidentally serve them — the SERVER-019 before-state
  Given: The real server running on 9067
  When:  `curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:9067/api/check`
  Then:  404 — the routes are declared but not mounted. Recorded so SERVER-019's evaluator has an
         unambiguous before-state, and so nobody mistakes "the contract shipped" for "the endpoint
         works"

TEST-74: The SPEC amendment is drafted, not smuggled
  Then:  §9.2's route list does not mention validation or skill rollback. A drafted amendment adding
         both bullets is prepared and HELD for user sign-off at the phase PR (SHARED-002's process
         rule). It is not committed silently, and the issue's log records the draft text
```

---

### PLUGINS-001: Plugin extension points

Ports `9070`–`9074`, primary `9072`, Vite `5281`. Scratch `/tmp/corpus-s012-plugins001-*`.
**P1, fable. 58 criteria.** The success condition is subtractive: **deleting any plugin directory
must leave the core fully functional.**

#### The kit contract

```
TEST-75: `@corpus/kit/plugin` is a real subpath export
  Then:  `packages/kit/package.json`'s exports map gains `./plugin` (types + dist), `files:` still
         covers everything shipped, and a file under `plugins/` can
         `import { definePlugin } from "@corpus/kit/plugin"` and type-check. The existing `.` and
         `./testing` entries are unchanged

TEST-76: `PluginManifest` is exactly the §10 shape, with the stated optionality
  Then:  `{id, name, icon?, order?, docTypes: [{type, ListItem?, View?, DocPanel?, validate?}],
         columns: [{type, label, icon?, Component, defaultQuery?}]}`. `expectTypeOf` asserts: a
         minimal manifest (id, name, empty arrays) satisfies it; a fully-populated one satisfies it;
         a manifest with an unknown key is REJECTED

TEST-77: `definePlugin` is an identity helper and nothing more
  Then:  It returns its argument by reference (asserted with `toBe`), exists only for type
         inference, and adds no runtime behavior a plugin could depend on

TEST-78: The props contracts are exported and consumed without casts
  Then:  `DocViewProps`, `ListItemProps`, `DocPanelProps`, `ColumnComponentProps` are exported from
         `@corpus/kit/plugin`, and `plugins/_fixture/` consumes all four with zero `as any` and zero
         `@ts-expect-error` — the fixture is the proof the contract is usable, not just declarable
```

#### UI discovery and the registry

```
TEST-79: Discovery is the glob, and nothing in core names a plugin
  Then:  `apps/ui/src/plugins/registry.ts` discovers via
         `import.meta.glob('../../../plugins/*/manifest.ts', {eager: true})`. Grep `apps/ui/src`,
         `apps/server/src`, `apps/cli/src`, `packages/kit/src` for `_fixture` (or any plugin
         directory name) → zero hits outside test fixtures. Nothing in core enumerates plugin names

TEST-80: Adding a plugin costs zero core edits
  When:  A second fixture-shaped plugin directory is added and the dev server rebuilds
  Then:  It appears in the registry, and `git status` shows changes ONLY under `plugins/`. Removing
         it is `rm -rf` with the same property

TEST-81: Manifest validation is Zod and its errors are readable
  Then:  A valid manifest passes. Each of — missing `id`, non-array `docTypes`, duplicate `type`
         within one manifest's `docTypes`, duplicate `type` within one manifest's `columns`, a
         component field that is not a function — fails with an error NAMING the offending field.
         `validate()` returns `{ok: true, manifest} | {ok: false, error}` and never throws

TEST-82: A throwing manifest is contained
  Given: `import.meta.glob` with `eager: true` evaluates every manifest module at bundle init
  Then:  A module that throws at module scope is caught PER MODULE, skipped, recorded in
         `pluginLoadWarnings`, and does not take down the app's init. Every other plugin still
         loads. Verified in the browser, not only in a unit test

TEST-83: Duplicate doc-type claims resolve deterministically
  When:  Two plugins claim the same `docTypes[].type`
  Then:  `order` decides, then directory name; the loser is recorded as a warning. Running the
         resolution with the glob keys in REVERSED order yields the SAME winner — never a coin flip

TEST-84: An empty glob is an empty registry
  Then:  No plugins → an empty registry, no warnings, no error, and the app behaves as if the plugin
         system did not exist

TEST-85: Load warnings are visible to a human
  Then:  Every skipped or invalid manifest produces a `console.error` AND a visible notice in the
         console strip naming the plugin and the reason. A warning that only exists in an array is
         not "surfaced"
```

#### Slots, renderers, error boundaries

```
TEST-86: Slot resolution is the only coupling, and null is the fallback
  Then:  Core calls `resolveDocView(type)`, `resolveListItem(type)`, `resolveDocPanel(type)`,
         `resolveColumnType(key)` and receives either a boundary-wrapped plugin component or `null`.
         Core components import no plugin code. The "renders as plain markdown" fallback is the
         natural consequence of `null`, not a special case

TEST-87: "Plain markdown" means the standard document view, which is the editor
  Given: Sprint-011 adjudication 7 — the editor owns the document body ALWAYS; `MarkdownView`
         renders non-document bodies (turns, snippets)
  Then:  When `resolveDocView` returns `null`, the body renders through the SHIPPED editor at
         `apps/ui/src/editor/`, not through a second `MarkdownView` path. §10's and §12 M6's "renders
         as plain markdown" is satisfied by the standard document view. The E2E log states this
         explicitly — it is the single most likely way to accidentally introduce a second body
         renderer

TEST-88: A registered `View` renders, and does not get an editor
  Then:  A document whose frontmatter `type` matches a registered `docTypes[].type` with a `View`
         renders with that `View`; no editor mounts for it (sprint-011's TEST-5 stays true)

TEST-89: `DocPanel` renders in a fixed slot ABOVE the body, in both surfaces
  Then:  For a doc type the plugin owns, its `DocPanel` renders above the document body in the
         column reader AND in focus mode. Verified in a real browser at both measures

TEST-90: `ListItem` replaces the default row for that type in every column list
  Then:  Not just in one column — a document of the plugin's type rendered in two different columns
         uses the plugin row in both

TEST-91: `DocPanel` is the only injection slot in v1
  Then:  Exactly four resolution helpers exist; no other core component calls into the registry.
         Grep for additional `resolve*` slot helpers → none

TEST-92: Every plugin component gets its own boundary, keyed per role
  Then:  Boundaries are per-slot, keyed `<plugin>/<role>/<type>`. A single board-level boundary is a
         FAIL — the criterion is that one crash cannot blank everything

TEST-93: A throwing component shows an in-place error card and the board survives
  When:  The fixture's column `Component` is made to throw on render, and separately its `View`
  Then:  An error card appears IN PLACE naming the plugin and the component role; every other column
         still renders and scrolls; there is no white screen and no lost column; the console strip
         shows no unhandled error. Screenshots captured, then reverted

TEST-94: The boundary does not loop
  Then:  A component that throws again on retry leaves the error card TERMINAL until remount;
         navigating away and back resets it (the boundary key is what makes this true)
```

#### Plugin columns

```
TEST-95: Registered column types appear in the picker
  Then:  Every `columns` entry appears in "＋ New list" with its label and icon, through the
         ALREADY-EXISTING `NewListSource = "plugin"` member of `apps/ui/src/board/newList.ts`. The
         union is not widened and the picker is not redesigned

TEST-96: Choosing one creates a pinned view document, on disk
  When:  A fixture column type is picked
  Then:  A `type: view`, `pinned: true` document is created under `data/docs/views/` whose
         frontmatter carries `column: "_fixture/<type>"` merged with `defaultQuery` if provided.
         Verified by `cat`-ing the FILE and by `git -C <workspace> log`, not from the DOM

TEST-97: A plugin column is an ordinary column in every respect
  Then:  It is ordered, persisted across reload, drag-reorderable (the drag writes `order` into the
         view document ON DISK), and deletable — through the same code path folder and search
         columns use. Grep the board for a plugin special case in ordering/persistence → none

TEST-98: The plugin `Component` renders the column body and receives its props
  Then:  The body is the plugin's `Component`, mounted with `ColumnComponentProps`, inside the
         kit's reader/focus affordances

TEST-99: An unresolvable `column:` shows the missing card and keeps the column
  Given: A view document referencing an unregistered plugin, and one referencing a registered plugin
         with a renamed column type
  Then:  BOTH render `PluginMissingCard` in the column BODY while the column header and controls
         remain present, reorderable and deletable, and the view document's frontmatter is left
         UNTOUCHED — so restoring the type restores the column
```

#### Server discovery, context, SSE

```
TEST-100: Routers mount at /api/x/<plugin>, verified by curl
  Then:  At boot the server dynamically imports `plugins/*/server/routes.ts` and mounts each exported
         Hono router at `/api/x/<plugin>`. `curl` with the workspace bearer token against
         `http://127.0.0.1:9072/api/x/_fixture/...` returns 200 and the expected body

TEST-101: The prefix comes from the directory, not from the plugin
  Then:  A plugin whose manifest declares `id: something-else` still mounts at its DIRECTORY name; a
         plugin cannot choose or escape its prefix. Attempting to register outside `/api/x/<name>`
         has no effect

TEST-102: Discovery runs after core, and cannot shadow core routes
  Given: A fixture routes module that registers `/api/docs`
  Then:  `GET /api/docs` is still answered by the CORE handler. `mountPluginRoutes` is called after
         every `mount*` in `apps/server/src/app.ts` — the call site is quoted

TEST-103: No server/ directory is skipped silently
  Then:  A plugin with no `server/` produces no warning and no log noise. Absence is normal

TEST-104: A throwing routes module does not prevent boot
  Then:  The plugin is skipped with a logged warning naming it; the server boots and serves core
         routes; `/api/x/<plugin>/*` then 404s like any unknown path. Server log quoted

TEST-105: Plugin routes get a context, never raw filesystem or database access
  Then:  `PluginServerContext` exposes typed doc read/write services and `broadcastInvalidate`. The
         fixture's route has no `fs`, no `better-sqlite3`, no `simple-git` import — grep quoted

TEST-106: A plugin write goes through the core write path
  When:  The fixture route creates or edits a document
  Then:  The file lands on disk, a git commit appears with the correct author, the projection row
         updates, and anchor reconciliation ran — exactly as a core write. `corpus db doctor` is
         clean afterwards. Architecture Decision 2 holds: the server is still the sole writer

TEST-107: broadcastInvalidate is namespaced and cannot touch core keys
  Then:  Every key is prefixed `x/<plugin>/`; a plugin attempting to invalidate any member of core's
         closed vocabulary (`docs`, `tree`, `threads`, `queue`, `jobs`, `locks`) is REJECTED. The
         core write path continues to broadcast core keys itself, so a plugin write still refreshes
         the board — the log states this division explicitly, because "plugins cannot invalidate
         docs" reads like a bug when a plugin write must refresh a list

TEST-108: Live update through the core SSE connection, observed
  When:  `curl -N "http://127.0.0.1:9072/events?token=$TOK"` is running and the fixture route is
         called
  Then:  An `event: invalidate` frame carrying `x/_fixture/…` keys is observed on the SAME core
         stream, and an open plugin column in the browser updates WITHOUT a reload. The raw SSE
         frame is quoted
```

#### CLI discovery

```
TEST-109: Plugin topics merge into the registry before validation
  Then:  `apps/cli/src/registry/plugins.ts` scans `plugins/*/cli/commands/`, wraps each module's
         `CommandSpec` in a `TopicSpec` named after the DIRECTORY, and appends it in
         `apps/cli/src/registry/index.ts` BEFORE `validateRegistry` runs — so plugin commands get the
         same enforcement core commands get, at module load

TEST-110: Plugin verbs appear at all three help levels
  Then:  `corpus --help` lists the topic; `corpus _fixture --help` lists its verbs; `corpus _fixture
         <verb> --help` renders args, flags and examples — indistinguishable in shape from a core
         verb

TEST-111: Registry validation applies to plugin commands
  Then:  A plugin command with no example, or no description, fails `validateRegistry` LOUDLY with a
         message naming the plugin and the command. Demonstrated and reverted

TEST-112: A broken command file is skipped, not fatal
  Then:  A command module with a syntax error is reported and skipped; `corpus --help` still renders
         and every core verb still works. Demonstrated and reverted

TEST-113: Plugin handlers are thin HTTP clients like every other verb
  Then:  The fixture's command receives the same `CommandContext`/`WorkspaceCommandContext` and
         performs its effect through the server. No `fs` write, no `git`, no direct file touch —
         grep quoted. Running it against 9072 changes state on disk and in the UI

TEST-114: docs/cli.md's story is decided and consistent
  Then:  Whatever Open Conflict 5 rules — fixture verbs appear in the committed `docs/cli.md`, or
         underscore-prefixed plugins are excluded from generation — the outcome is IMPLEMENTED, and
         `node --import tsx scripts/check-generated-artifacts.ts` is green twice with no manual edit
         to the artifact
```

#### Skills loading

```
TEST-115: `corpus init` installs plugin skills, verified against a real workspace
  When:  `corpus init <scratch> --port 9072`
  Then:  `<workspace>/.claude/skills/<fixture-skill>/SKILL.md` exists and is byte-identical to
         `plugins/_fixture/skills/<name>/SKILL.md`. The workspace template's own `orchestrate` and
         `comment` skills are still present and unmodified

TEST-116: The three install-rule implementations still agree
  Then:  `apps/cli/src/commands/init/template.test.ts`'s agreement assertions still pass, and
         `scripts/workspace-template.test.ts`'s install-contract suite ("accounts for every
         directory `corpus init` creates", "lists nothing `corpus init` does not create", "generates
         nothing the copy already installs") still passes. Whether plugin skills are recorded in
         `.corpus/template-manifest.json` is DECIDED and stated (Open Conflict 7) — CLI-005's
         `workspace upgrade` reads that manifest

TEST-117: A name collision with a core skill cannot disable the loop
  Given: A plugin shipping a skill named `orchestrate`
  Then:  The adjudicated rule (Open Conflict 7) is implemented and the core skill survives, with a
         warning naming the collision. A plugin silently overwriting the loop skill is the failure
         this catches

TEST-118: PLUGINS-001 does not touch the orchestrate skill
  Then:  `git diff --stat` for this issue shows
         `assets/workspace/claude/skills/orchestrate/SKILL.md` UNCHANGED. The `<plugin>.*` routing
         convention is AGENT-002's text (TEST-14); this issue verifies skills LOADING only
         (adjudication 1). The issue file's acceptance criterion "the orchestrate skill routes
         `<plugin>.*`" is satisfied by AGENT-002 and is recorded as such in the log

TEST-119: The dev flow loads plugin skills too, and it is documented
  Then:  The dev path installs plugin skills by the same mechanism as `init` (copy is the safe
         default), and `docs/PLUGINS.md` documents it
```

#### types.yaml parity

```
TEST-120: The non-TS mirror exists and the server/CLI never import the manifest
  Then:  `plugins/<name>/types.yaml` has shape `types: [{type, label, seedTemplate?}]`, parsed with
         the `yaml` library. Grep `apps/server/src` and `apps/cli/src` for `manifest.ts` → zero
         hits. The server reads YAML to validate/route owned types; the UI reads the manifest

TEST-121: Parity is enforced in BOTH directions, by a test and at boot
  When:  The fixture's `types.yaml` is made to disagree with its `manifest.ts` (a `docTypes[].type`
         missing from the YAML, then a YAML type missing from the manifest)
  Then:  A test FAILS in both directions, AND the server logs a boot warning naming the mismatch.
         Both halves demonstrated and reverted — "a test exists" is not evidence the test fires

TEST-122: A missing types.yaml is a warning, not a crash
  Then:  With `manifest.ts` declaring doc types and no `types.yaml`, the UI still renders those
         types, the server reports a boot warning, and the parity test fails. The app does not break
```

#### Lint boundaries

```
TEST-123: The kit-only rule fires, proven programmatically
  Then:  A rule in the root `eslint.config.js` (there is no `packages/eslint-config` to extend)
         fails any import from `plugins/**` that resolves into `apps/ui/src` — or any workspace other
         than `@corpus/kit` / `@corpus/contract` — with a message NAMING the allowed imports. Proven
         by running ESLint programmatically over a violating fixture file (reports) and over one
         importing `@corpus/kit` (does not)

TEST-124: `@corpus/contract` imports from a plugin are allowed
  Then:  A plugin importing document/thread schemas from `@corpus/contract` passes lint. This is
         expected and documented, not tolerated

TEST-125: The core → plugin ban has explicit allowlisted entry points
  Then:  A second rule fails any static import of `plugins/**` from `apps/**` or `packages/**`,
         except the three discovery entry points, which are allowlisted BY PATH (the UI registry, the
         server discoverer, the CLI scanner). The allowlist is enumerated in the config with a
         comment naming §10

TEST-126: §12 M6's lint check passes for real
  When:  `import { something } from "../../apps/ui/src/board/Board"` is added to a fixture plugin
         file and `npm run lint` is run; then removed and re-run
  Then:  The first run FAILS naming the kit-only rule; the second passes. Both outputs quoted
```

#### Deletion — the subtractive success condition

```
TEST-127: Deleting the plugin leaves the core fully functional
  When:  `rm -rf plugins/_fixture` and everything is restarted
  Then:  `npm run build` succeeds, the server boots logging no plugin, `corpus --help` no longer
         lists the topic, and the board loads

TEST-128: Its documents render, its column degrades, the board works
  Then:  Documents of the previously-plugin-owned type render through the standard document view
         (TEST-87); its column shows the "plugin missing" card while its header and controls remain;
         every other column renders and scrolls; `/api/x/_fixture/*` 404s

TEST-129: Restoring brings everything back, with no core change in between
  When:  The directory is restored and everything is restarted
  Then:  Renderer, `DocPanel`, `ListItem`, column, server route and CLI verb all return, and
         `git diff` between the two states is empty outside `plugins/`

TEST-130: No plugins at all is a supported state
  Then:  With `plugins/` empty (or absent), every discovery mechanism returns empty, nothing warns,
         and the app behaves as if the plugin system did not exist
```

#### Fixture hygiene, docs, and the deferred question

```
TEST-131: The fixture is test-only and the exclusion is ENFORCED
  Then:  `plugins/_fixture/` is excluded from packaging and from the production UI bundle by the
         leading-underscore convention, and the exclusion is implemented (not merely documented) —
         the log NAMES the file where it is enforced and shows the production bundle contains no
         fixture code. INFRA-008's packaging surface must not inherit it

TEST-132: The fixture's layout satisfies the coverage gate's globs
  Then:  Whatever Open Conflict 6 rules, `npm run coverage`'s merged gate is green at 90% on all four
         metrics with the fixture in the tree — either because the fixture's code sits where
         `COVERAGE_INCLUDE`'s `plugins/*/src/**` finds it and is genuinely exercised, or because the
         globs were adjusted deliberately and the change is called out

TEST-133: The discovery root is pinned
  Then:  Plugins ship BUNDLED WITH THE TOOL (§10), so discovery resolves against the tool's install
         directory — the way `resolveTemplateRoot()` in `apps/cli/src/paths.ts` already does for the
         workspace template. `corpus init` does NOT create a `plugins/` directory in the workspace,
         and a `plugins/` directory placed inside a workspace is NOT discovered. Verified against the
         real scratch workspace

TEST-134: docs/PLUGINS.md is the author's guide
  Then:  It documents the directory layout, the manifest contract, the kit-only rule, the
         `types.yaml` requirement and its parity check, the underscore convention, the `/api/x/`
         prefix rule, and the `x/<plugin>/` invalidation namespace

TEST-135: The scoped-template-keys question is filed, not answered
  Then:  No mechanism exists by which a plugin declares frontmatter keys that carry to instances
         created from its template — `types.yaml`'s `seedTemplate` supplies a BODY only, per §9.2's
         body-only pre-fill (SERVER-005). Grep for any frontmatter carry-over path → absent. The
         §10-vs-§9.2 question is written into the issue's E2E log verbatim for user sign-off later
         (adjudication 3). Implementing it this sprint is a FAIL, and so is silently dropping the
         question
```

---

## Cross-Issue Tests

Run by the orchestrator at harvest, after all three issues land.

```
TEST-136: One orchestrate skill, one author
  Then:  `git log -p -- assets/workspace/claude/skills/orchestrate/SKILL.md` on this branch shows the
         `[AGENT-002]` commit and no other (adjudication 1)

TEST-137: The CLI-existence test survives the plugin verbs
  Then:  With PLUGINS-001's plugin topic present in `docs/cli.md`, AGENT-002's extraction test still
         passes — plugin verbs are additive and the skill names none of them (TEST-14). If Open
         Conflict 5 excludes underscore plugins from the artifact, the test still passes for the
         same reason

TEST-138: Generated artifacts are green twice, after everything
  Then:  `node --import tsx scripts/check-generated-artifacts.ts` is green on two consecutive runs
         with `openapi.json`, `schema.generated.ts` and `docs/cli.md` all at their post-sprint state

TEST-139: The single harvest gate
  Then:  `npm run build` succeeds in dependency order; `/lint` passes (ESLint, Prettier,
         `tsc --noEmit` across all workspaces); `/test` passes with no regressions — as the
         orchestrator's ONE repo-wide run (adjudication 4)

TEST-140: The merged coverage gate is green
  Then:  `npm run coverage` is ≥ 90% on lines, statements, functions and branches, with the plugin
         registry, the slot resolvers and the boundary genuinely covered rather than the gate carried
         by easier files

TEST-141: E2E passes with 8765 unbound
  Then:  `CORPUS_UI_PORT=5281 npm run e2e` passes, and `lsof -nP -iTCP:8765 -sTCP:LISTEN` is empty
         before and after (`smoke.spec.ts` asserts "server unreachable", which is only true then)

TEST-142: Every scratch workspace is self-consistent
  Then:  In each issue's scratch workspace, `corpus db rebuild && corpus db doctor` is clean — the
         standing §11 invariant

TEST-143: Each E2E log states the model actually used
  Then:  "implemented on: opus | fable" appears in all three logs. AGENT-002 and PLUGINS-001 are
         recommended fable; CONTRACT-008 opus. A divergence is recorded, not silently absorbed

TEST-144: Nothing is left running
  Then:  Nothing bound in `9060`–`9074`, `8765` free, `5281` free, `5173`/`5174` still the ssh
         process and nothing else, no orphaned `vitest`, Vite, Playwright or `claude` children, and
         `git status` clean in every worktree and in the Corpus repository
```

---

## Out of Scope

- **Server handlers for the CONTRACT-008 routes.** SERVER-019, next wave. Adjudication 2 makes this
  binding: a contract agent that "just wires it up while it's fresh" produces an untested handler
  outside its domain and a diff nobody reviewed against SERVER-019's criteria.
- **`corpus doc check` and `corpus skill rollback` as CLI verbs.** CLI-006, next wave, after
  SERVER-019. AGENT-002 may NAME `corpus skill rollback` in prose subject to Open Conflict 1's
  ruling; it may not implement it.
- **`--staged` collection.** CLI-006's `git diff --cached` plumbing. CONTRACT-008 only declares the
  `(path, content)` pair shape that makes it expressible.
- **The workspace-side pre-commit hook that gates on exit 6.** Agent-runtime domain, after
  `doc check` exists. **Nothing in this sprint touches `.githooks/`** — this repo is not a workspace.
- **The comment skill's behavior.** AGENT-003. AGENT-002 routes to it by name and must not duplicate
  thread-handling rules (reading context, honoring mentions, inbox filing, reply content, skill
  genesis). The existing test asserting the comment skeleton does not own queue terminal states
  stays green.
- **Trace lines in agent turns.** AGENT-004.
- **The todos plugin.** PLUGINS-002. `plugins/_fixture` is a throwaway; it is not a design study for
  todos and does not need to be pretty.
- **The publish plugin.** SPEC.md §13.
- **Any second injection slot.** `DocPanel` is the one core slot in v1 (§10). A plugin wanting a
  header, a footer or a sidebar does not get one this sprint.
- **Runtime plugin loading, third-party distribution, or a plugin marketplace.** §1 non-goal; §10
  pins build-time `import.meta.glob` and bundled-with-the-tool for v1.
- **Scoped template frontmatter keys carried from plugin column declarations.** Adjudication 3 —
  implement without the mechanism, file the §10-vs-§9.2 question for user sign-off.
- **Any change to `packages/contract` by the agent-runtime or plugins agent**, and any change to
  `apps/ui`/`apps/server`/`apps/cli` by the contract agent. §9.3, restated from sprints 008–011.
- **Streaming anything over SSE.** §2.2 rule 3 stays absolute — plugin invalidations carry keys only.
- **Packaging.** INFRA-008. PLUGINS-001 must not break it (TEST-131) but does not implement it.
- **Rewriting the e2e suite to drive a real server.** Still the standing recommendation from
  sprint-009; still not a requirement. If declined, the reason is recorded.

---

## Integration Points

**AGENT-002 produces → PLUGINS-001 consumes.**

```
The `<plugin>.<action>` → skill `<plugin>` routing convention
                       → written ONCE, in AGENT-002's routing table (TEST-14), generic and
                         plugin-name-free. PLUGINS-001 does not edit the file (TEST-118) and
                         satisfies its own "orchestrate routes <plugin>.*" criterion by citing
                         TEST-14 in its log (adjudication 1)
The missing/archived-skill failure rule
                       → AGENT-002 states it (TEST-15); PLUGINS-001's skills-loading tests are
                         what make the skill FINDABLE (TEST-115), which is the other half
```

**AGENT-002 and PLUGINS-001 share the workspace-install contract. This is the batch's one real file
hazard.**

```
scripts/workspace-template.ts / .test.ts   AGENT-002 extends (extraction helper + assertions)
apps/cli/src/commands/init/template.ts     PLUGINS-001 extends (plugin-skill copying)
apps/cli/src/commands/init/scaffold.ts     PLUGINS-001 extends (install + manifest recording)
apps/cli/src/commands/init/template.test.ts
                                           asserts the THREE implementations agree — scripts/,
                                           apps/cli/, and docs/workspace-template.md
scripts/workspace-template.test.ts's "install contract" suite (13 tests)
                                           asserts INIT_GENERATED accounts for every directory
                                           `corpus init` creates and lists nothing it does not
```

Consequence: **PLUGINS-001 changing what `corpus init` installs can break AGENT-002's suite, and
neither agent will see it in its own worktree.** The rule for this sprint: PLUGINS-001 owns
`apps/cli/src/commands/init/**` and `docs/workspace-template.md`'s install rules; AGENT-002 owns
`scripts/workspace-template.{ts,test.ts}` and `docs/workspace-template.md`'s verification note. If
PLUGINS-001's change requires an edit to `scripts/workspace-template.ts`'s `INIT_GENERATED`, it
**escalates to the orchestrator** rather than editing AGENT-002's file. The harvest runs both suites
together (TEST-116, TEST-139).

**CONTRACT-008 produces → SERVER-019 and CLI-006 consume (next wave).** Nothing in this sprint
consumes it, which is exactly why the shapes must be right now:

```
POST /api/check
  request   {ids: string[]} XOR {documents: [{path, content}]}
  response  {ok, errors: Finding[], warnings: Finding[]}
  Finding   {code, severity, docId: string|null, path, detail}     ← CheckFinding, field for field
  codes     the thirteen CHECK_CODES; warnings are exactly anchor-unresolved + ref-unresolved
  handler   SERVER-019: documents.map(d => toCheckDocument(d.path, d.content)) → checkCorpus(...)
  caller    CLI-006: --staged collects (path, content) via git diff --cached + git show :<path>;
            errors → exit 6, warnings → exit 0, --json emits the response unchanged

POST /api/skills/{name}/rollback
  headers   ActorHeaderSchema (mutating → git author)
  request   {to?: string | null}
  response  {name, docId, commit, path}
  404       unknown skill (NotFoundErrorSchema)
  caller    CLI-006: prints commit + path; unknown skill → "no skill named <name>", exit 5
```

**PLUGINS-001 extends four shipped seams rather than inventing parallel ones.**

```
apps/ui/src/board/newList.ts        NewListSource already has "plugin" — fill the seat, do not
                                    widen the union or rewrite NewListPicker.tsx
apps/ui/src/board/viewDoc.ts        BoardColumn is where `column:` is read; the registry lookup
                                    happens here, not in a parallel mapper
apps/ui/src/editor/                 the null-resolution fallback renders through the SHIPPED editor
                                    (TEST-87), NOT a new MarkdownView call site
apps/server/src/app.ts              a new mountPluginRoutes(app, …) AFTER every existing mount*
apps/cli/src/registry/index.ts      plugin topics appended to `topics` BEFORE validateRegistry runs
packages/kit/src/index.ts           unchanged as the `.` surface; `./plugin` is a NEW subpath so the
                                    plugin type contract does not bloat the app-facing barrel
```

**Everything else is disjoint.** CONTRACT-008 touches only `packages/contract`. AGENT-002 touches
only `assets/workspace/claude/skills/orchestrate/SKILL.md`, `scripts/workspace-template.{ts,test.ts}`
and `docs/workspace-template.md`. All three can run concurrently in worktrees.

---

## Merge order (recommendation)

1. **Adjudicate Open Conflicts 1, 2, 5, 6 and 7 before anyone starts.** 1 and 2 block AGENT-002's
   text and are not discoverable cheaply mid-implementation — an agent that writes the recovery
   section, then discovers its own test rejects it, has to redesign the test under time pressure.
   5, 6 and 7 shape PLUGINS-001's fixture layout, which is the first thing it builds.
2. **Launch CONTRACT-008 first and staggered.** It is the smallest, the most isolated, and it
   unblocks the next wave (SERVER-019 → CLI-006 → AGENT-003). Nothing in this batch waits on it.
3. **AGENT-002 and PLUGINS-001 in parallel worktrees**, both fable, both large. They collide only
   through the workspace-install contract above; the ownership split resolves it without
   serialization.
4. **AGENT-002's live-session verification is scheduled, not opportunistic.** It needs a real
   `claude` process and a real browser and it must not overlap PLUGINS-001's e2e run. The
   orchestrator picks the window.
5. **PLUGINS-001 runs the only `npm run e2e` in this batch**, on `CORPUS_UI_PORT=5281`, with nothing
   else heavy in flight.
6. **Harvest gate last**, once: build → lint → test → coverage → e2e → artifact drift.

The genuinely serialized edges are: Open Conflict 1 → AGENT-002's recovery section and its test;
Open Conflict 5/6 → PLUGINS-001's fixture layout. Everything else in this batch is parallel.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. AGENT-002 must name a command its own test will reject (**blocking, P0**)

`corpus skill rollback` does not exist. Not in `docs/cli.md`, not in `apps/cli/src` (`grep -r rollback
apps/cli/src` → zero hits). It lands in **CLI-006, next wave**. Neither does `corpus doc check`.

AGENT-002 is simultaneously required to:

- write a loop-safety section naming `corpus skill rollback orchestrate|comment` as the recovery
  path (its acceptance criteria, and SPEC §7: *"The orchestrate skill documents this recovery path
  for the operator"*), and
- ship a test asserting **every** `corpus …` invocation in the template resolves against
  `docs/cli.md`.

Those two cannot both be satisfied today. Worse, `assets/workspace/README.md` — shipped by AGENT-001
— **already** names `corpus skill rollback <name>`, so a whole-tree extractor fails on an untouched
file the moment it is written.

Options:

- **(a) An expiring allowlist.** The extractor carries a small, named, commented allowlist of verbs
  landing later in Phase 4 (`doc check`, `skill rollback`), with a companion test asserting each
  entry is *still missing* from `docs/cli.md` — so the allowlist **fails** once CLI-006 lands and
  must be emptied. Cost: one deliberate hole, self-closing. Benefit: the skill text is correct on
  the day the verb exists, and the README needs no change.
- **(b) Serialize.** AGENT-002 waits for CLI-006, which waits for SERVER-019, which waits for
  CONTRACT-008. That is the entire wave, in series, for one section of prose.
- **(c) Prose without a command.** The recovery section describes the recovery without naming the
  verb until CLI-006 backfills it. Cheapest now; leaves the P0 loop-safety section vague exactly
  where an operator whose loop is broken needs precision, and creates a follow-up nobody is assigned.

**Recommendation: (a).** The self-invalidating allowlist is the only option that keeps the text
correct, keeps the test honest, and closes itself. TEST-35 and TEST-51 are written assuming it.

### 2. "The orchestrator defers instead" has no mechanism (**blocking, P0**)

`docs/cli.md` on `doc edit`: *"A `423` … is reported as a server error (exit 5) and is never retried
— the orchestrate skill defers instead."* SPEC §7: *"The orchestrator defers edits to user-locked
documents — the work stays queued and applies when the lock clears"*, and on force-break: *"the
agent's deferred edit re-enters the queue rather than being lost."*

But by the time the agent hits a 423, the event has already been **claimed** — it is in
`in-progress/`. There is no re-enqueue verb. The queue surface is
`abandon | claim-all | complete | fail | halt | idle | reap-stale | resume | status`. So "stays
queued" describes a state the CLI cannot produce, and the invariant "every claimed event reaches a
terminal state" forbids the obvious workaround of just leaving it in-progress.

Options:

- **(a) Fail with a `deferred:` reason, re-enter via `corpus job retry`.** `job retry` exists and is
  documented. The agent replies to the waiting thread ("you're editing X — I'll apply this when the
  lock clears"), logs the reason, fails the event with a `deferred:`-prefixed reason, and the console
  row is actionable by the operator or by a later retry. Terminal-state invariant intact; nothing
  new to build. Cost: a deferral shows in the console as a **failed** job, which is honest but ugly.
- **(b) Hold the batch item and re-check after `idle` returns.** The loop keeps the event
  in-progress, parks, re-checks the lock, applies when clear. Matches §7's words most literally.
  Cost: violates the terminal-state invariant for an unbounded time and strands the event if the
  session dies (recoverable only by `reap-stale`).
- **(c) A SERVER/CLI rider** adding an explicit defer/requeue transition. Correct long-term; it is a
  new issue in a wave that has none, and AGENT-002 is P0 and blocked until it lands.

**Recommendation: (a) now, (c) filed.** The skill's deferral section is written against (a), TEST-20
verifies it as an ordered command sequence, and a rider is filed for the honest transition. Note
TEST-46 separately verifies whether the **server** re-enqueues on `lock break`; if it does not, that
is a SERVER finding for the next wave, not something the skill text papers over.

### 3. AGENT-002's E2E plan names an interface that does not exist (**trivial, one debugging cycle**)

Step 2 offers *"`corpus thread create` with the agent flag"* as an alternative to the UI. The thread
topic is `reopen | reply | resolve` — there is no `create`, and there is no `--agent` flag anywhere
(attribution is the global `--from`, and the wire field is `requestsAgent`). Enqueueing a
`comment.created` from a terminal means `POST /api/threads` with `requestsAgent: true` and the bearer
token. TEST-38 is written that way; the issue file should be corrected before the agent reads it.

### 4. The rollback route's shape: path param or body field (**low, but pin it before generation**)

The issue says *"request `{name, to?}`"*. Every other resource route in the contract puts the
resource identifier in the path (`/api/docs/{id}`, `/api/threads/{id}/…`), and `routes/index.test.ts`
pins registration order around exactly that convention. `POST /api/skills/{name}/rollback` with body
`{to?}` satisfies the issue's shape while matching the package's grammar, and gives the 404 a natural
home.

The alternative — `POST /api/skills/rollback` with `{name, to?}` in the body — is what the issue
literally says. It is defensible (rollback is an action, not a subresource) but it is the only route
in the surface that would identify a resource in a body.

**Recommendation: path param.** TEST-54 is written that way and flags the dependency on this ruling.

### 5. `_fixture` cannot be both in `docs/cli.md` and out of production (**blocking for PLUGINS-001**)

PLUGINS-001's E2E step 6: *"Confirm the verb appears in `docs/cli.md` after `npm run docs:cli` with
no other diff."* Its edge-case list: *"`_fixture` is excluded from production builds via a name
convention (leading underscore)."* Its file list: *"explicitly excluded from packaging."*

These are in direct tension, and `docs/cli.md` is a **committed, drift-checked artifact**. If the
fixture registers a CLI topic, the committed reference documents a test fixture as a product verb —
and `scripts/check-generated-artifacts.ts` will enforce that it stays there. If underscore-prefixed
plugins are excluded from generation, step 6 cannot be run as written.

The same fork applies to the UI: `import.meta.glob('plugins/*/manifest.ts', {eager: true})` will
bundle the fixture into the **production** UI build unless the glob or the registry excludes
underscore names.

Options:

- **(a) Underscore plugins are excluded from `docs/cli.md` generation and from the production
  bundle**, but present in dev and in tests. Step 6 is verified against `corpus --help` and the
  registry, plus a unit test that a *non*-underscore plugin's verb WOULD reach the generator. Clean
  artifact; step 6 rewritten.
- **(b) The fixture lives outside `plugins/` entirely** — created into a temp directory by the tests
  and by the E2E script, with discovery pointed at it via an env var or option. Purest, and it makes
  the discovery root configurable, which TEST-133 wants anyway. Costs more scaffolding, and the
  committed repo then has no worked example for plugin authors.
- **(c) The fixture is in `plugins/` and in the artifact.** Simplest; ships a fixture verb in the
  product's CLI reference and in the npm package. Rejected unless the orchestrator says otherwise.

**Recommendation: (a)**, with the underscore exclusion implemented in exactly one place per surface
and named in the E2E log (TEST-114, TEST-131).

### 6. The coverage gate's plugin glob does not match §10's layout (**blocking for the harvest gate**)

`scripts/coverage-config.ts`: `COVERAGE_INCLUDE = ["apps/*/src/**", "packages/*/src/**",
"plugins/*/src/**"]`. But §10's layout — which `import.meta.glob('plugins/*/manifest.ts')` hard-codes
— puts `manifest.ts`, `server/routes.ts`, `cli/commands/*.ts` and `ui/` at the plugin **root**, not
under `src/`.

So either the fixture's code is invisible to the 90% gate (and PLUGINS-002's todos plugin will be
too, permanently), or the layout moves under `src/` and contradicts §10 and the glob, or the include
list changes.

Options: **(a)** widen `COVERAGE_INCLUDE` to `plugins/*/**` with the fixture excluded like a test
file; **(b)** put plugin source under `plugins/<name>/src/` and adjust the manifest glob to
`plugins/*/src/manifest.ts` (a SPEC §10 wording change); **(c)** accept plugins as uncovered and say
so in the config's docblock.

**Recommendation: (a)** — it keeps §10's documented layout, which is the thing plugin authors read,
and it is a one-line change in the single place thresholds are enforced. TEST-132 checks whichever
way it is ruled.

### 7. A plugin skill can overwrite the loop, and the manifest does not know about it (**P1**)

`corpus init` copies the template into `.claude/skills/` and records `{path, sha256}` per file into
`.corpus/template-manifest.json` — which **CLI-005's `workspace upgrade` reads** to decide what to
refresh. PLUGINS-001 adds a second source of files into the same directory.

Two unanswered questions:

- **Collision.** A plugin shipping `skills/orchestrate/SKILL.md` would silently replace the
  product's main loop. Nothing today prevents it. Recommendation: **core wins**, the plugin skill is
  skipped with a warning naming the collision — a plugin must not be able to disable the loop
  (TEST-117).
- **Manifest.** Are plugin-installed skills recorded in `template-manifest.json`? If yes, CLI-005
  will try to "upgrade" them from the template and find nothing; if no, they are invisible to
  upgrade and go stale after a tool update. Recommendation: **record them with a source marker**
  (`{path, sha256, source: "plugin:<name>"}`) so CLI-005 can refresh them from the plugin instead of
  the template — but this is CLI-005's design being pre-empted, and the orchestrator should say
  whether PLUGINS-001 may add the field or must leave a documented gap.

### 8. The plugin discovery root, and who compiles plugin TypeScript (**P1, shapes the server half**)

`plugins/` is already an npm workspace member and root `clean` removes `plugins/*/dist` — so the
build system has a place for compiled plugin output. But three things are unpinned:

- **Does `npm run build` build plugins?** CLAUDE.md documents the order as contract → kit → apps.
  The server dynamically imports `plugins/*/server/routes.ts`; the packaged tool ships `dist/`.
  Either plugins build to `dist/` and the server imports the compiled entry, or the server resolves
  `.ts` through the same mechanism it already uses in dev.
- **Where is the root at runtime?** §10 says plugins ship **bundled with the tool**, so discovery
  resolves against the tool's install directory — the pattern `resolveTemplateRoot()` in
  `apps/cli/src/paths.ts` already establishes for the workspace template. TEST-133 asserts a
  workspace-local `plugins/` is NOT discovered; confirm that is the intent.
- **Does the UI's build-time glob and the server's runtime import agree on that root?** The glob is
  relative to `apps/ui/src`; the server's is relative to the install directory. They are two
  different resolutions of "the plugins directory" and only one is checked at build time.

Not blocking for the UI half, blocking for the server half. Needs a stated strategy before
`apps/server/src/plugins/discover.ts` is written.

### 9. PLUGINS-001's file list names paths that do not exist (**trivial, correct before the agent reads it**)

- `assets/workspace/.claude/skills/orchestrate/SKILL.md` — the template is **dotless**
  (`assets/workspace/claude/…`) and a literal `.claude` inside `assets/workspace/` is forbidden by
  AGENT-001's rule and its passing test. Moot under adjudication 1, but the line should go.
- `packages/eslint-config` — does not exist. Both boundary rules land in the single root
  `eslint.config.js`, which today has no `no-restricted-imports` at all.
- `apps/cli/src/commands/init.ts` — the real path is `apps/cli/src/commands/init/` (a directory:
  `index.ts`, `git.ts`, `port.ts`, `scaffold.ts`, `template.ts`).

### 10. PLAN.md and the issue file disagree on AGENT-002's dependencies (**bookkeeping**)

`issues/PLAN.md` lists `CLI-004, CLI-007, AGENT-001`; the issue file lists `CLI-004, AGENT-001`.
CLI-007 (the `job log` stdin hang) is landed and is plausibly a real dependency — the skill's
progress-logging section depends on `corpus job log` accepting a positional line without hanging.
Reconcile the two lists; nothing blocks on it.

### 11. PLUGINS-001's stated dependencies understate what it builds on (**non-blocking, worth stating**)

Its dependencies read `UI-003, CLI-001, SERVER-003` — all long landed. In practice it extends
UI-005's reader, UI-006's editor (TEST-87), UI-003's board and picker, and the whole kit surface
sprints 008–011 built. That is fine and expected, but an agent computing "what I can rely on" from
the dependency line will under-read the tree. The Verification Environment section above is the
authoritative statement of what is shipped.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Adjudication N` / `STRUCK → Open Conflict N` / `DEFERRED → <issue>` with the reason and
  substitute evidence recorded. **Silent omission is a fail.**
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication is
  written back into the issue file it affects — not only into this contract. Conflicts 3, 9 and 10
  correct stale issue-file text before the agent reads it. Conflicts 1, 2, 5, 6 and 7 are decided
  once and bind the implementing agents.
- **The orchestrate skill was RUN, not just written** (TEST-39). A live `claude` session in a real
  workspace drove at least one `comment.created` from `pending` to `processed`, with the agent turn
  visible over the API and in the browser via SSE, job log lines in the console, and the loop parking
  on `idle`. This is the single criterion that distinguishes a shipped loop from a shipped document.
- **The CLI-only invariant holds behaviorally** (TEST-50): across the whole live session, every
  workspace mutation went through the server's auto-committer and nothing was hand-edited. §7's
  "reply and mutate only via the `corpus` CLI" is a data-integrity guarantee, not a stylistic
  preference, and it is invisible in the finished file.
- **The command-existence test was made to fail and then to pass** (TEST-34). A test asserted to
  exist but never exercised is not evidence; this one is the mechanism that keeps every future
  AGENT skill honest as the CLI evolves.
- **The deferral protocol is executable** (TEST-20, TEST-45): the skill states an ordered command
  sequence a fresh agent can follow, and a real user-held lock was really deferred to, without the
  lock being broken, with the edit landing after release.
- **The contract's two routes are declared with the validator's own vocabulary** (TEST-56, TEST-58,
  TEST-59): the `(path, content)` pair is `toCheckDocument`'s argument list, the findings are
  `CheckFinding` field for field, and exactly `anchor-unresolved` + `ref-unresolved` are warnings.
  Getting this wrong makes SERVER-019 a translation layer instead of a one-liner.
- **Generation is idempotent and the drift check is green twice** (TEST-66, TEST-67, TEST-138), and
  `ENDPOINT_INVENTORY` was extended so the pinned-surface test passes (TEST-52).
- **CONTRACT-008 changed no consumer** (TEST-72) and the server's 404 before-state is recorded
  (TEST-73).
- **§12 M6's four named checks pass against the real app** (TEST-126, TEST-127, TEST-128, TEST-129,
  TEST-93): delete the plugin → the app still boots and its documents render as the standard document
  view with a "plugin missing" card in its column; restore → renderer, DocPanel, column, route and
  verb return; the kit-only import rule is lint-enforced and demonstrably fires; a deliberately
  throwing plugin column shows an error card while the rest of the board keeps working.
- **Discovery is convention, provably** (TEST-79, TEST-80): nothing in core enumerates a plugin name,
  and adding or removing a plugin is a change under `plugins/` and nowhere else.
- **The server is still the sole writer** (TEST-105, TEST-106): plugin routes hold a context, not a
  filesystem, and a plugin write produces the same commit, projection row and reconciliation a core
  write does, with `db doctor` clean afterwards.
- **Nothing is a second implementation of anything** (TEST-87, TEST-95, TEST-118): one body renderer
  for documents, one `NewListSource` union, one orchestrate skill with one author, one registry
  validation path, one validator vocabulary.
- **Adjudication 1 held**: `git log` on the orchestrate skill shows exactly one commit this sprint
  (TEST-136).
- **Adjudication 3 held**: the scoped-template-keys question is filed verbatim for user sign-off and
  no carry-over mechanism was built (TEST-135).
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands, actual
  output, actual file/git/queue/SSE/browser state — and states which model the implementing agent ran
  on (TEST-143).
- `npm run build` succeeds in dependency order; `/lint` passes; `/test` passes with no regressions —
  as the orchestrator's **single** harvest run (TEST-139, adjudication 4).
- **The merged coverage gate is green at 90% on all four metrics** (TEST-140), with the plugin
  registry, slot resolvers and error boundary genuinely covered.
- `CORPUS_UI_PORT=5281 npm run e2e` passes with **nothing bound on 8765** (TEST-141).
- **`/audit` has been run on AGENT-002** (P0, and the one deliverable whose defects are invisible to
  the type system) **and on PLUGINS-001** (cross-domain: UI, server, CLI, kit, lint config — the
  largest surface in the batch). CONTRACT-008 is P1 and contained; the orchestrator decides.
- **Any user-observable behavior change carries its SPEC.md amendment**, drafted by spec-writer and
  held for user sign-off at the phase PR (SHARED-002). In this batch the candidates are §9.2's route
  list (TEST-74), whatever Open Conflict 2 decides about deferral semantics in §7, and — if Open
  Conflict 6 goes that way — §10's plugin directory layout.
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- **No stray processes**: nothing bound in `9060`–`9074`, `8765` free, `5281` free, `5173`/`5174`
  still only the ssh process, no orphaned Vite, Playwright, vitest or `claude` children, and
  `git status` clean in every worktree and in the Corpus repository (TEST-144).
- **PLAN.md reflects reality**: AGENT-002, CONTRACT-008 and PLUGINS-001 marked `done` only after the
  evaluator returns, and wave 2 (SERVER-019 → CLI-006 → AGENT-003, plus PLUGINS-002) shown as ready.

---

## Orchestrator Adjudications (2026-07-28)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

### Pre-ruled at contract time

1. **AGENT-002 owns `assets/workspace/claude/skills/orchestrate/SKILL.md` exclusively this sprint.**
   PLUGINS-001 must **not** modify it. The plugin event-routing convention — `<plugin>.<action>` →
   the skill named `<plugin>`; a missing or archived skill ⇒ `corpus queue fail` naming the skill —
   is already a required part of AGENT-002's routing table (TEST-14, TEST-15). PLUGINS-001's
   acceptance criterion *"the orchestrate skill routes `<plugin>.*`"* is **satisfied by AGENT-002's
   text**, and PLUGINS-001 cites TEST-14 in its log rather than editing the file. PLUGINS-001
   verifies skills **loading** only — that `corpus init` copies `plugins/*/skills` into
   `.claude/skills` (TEST-115 … TEST-119). Enforced by TEST-118 and TEST-136.

2. **CONTRACT-008 is wire-surface only.** No consumer changes: no handler in `apps/server`, no verb
   in `apps/cli`, no hook in `packages/kit`. SERVER-019 and CLI-006 land next wave. Route shapes
   **must reuse `CheckDocument`'s `(path, content)` pair shape** — concretely, the wire pair is
   `{path, content}`, exactly `toCheckDocument(path, raw)`'s argument list, and the response reuses
   `CheckFinding` / `CheckReport` field names verbatim. Enforced by TEST-56, TEST-58, TEST-72.

3. **PLUGINS-001's open spec question is NOT resolved in-sprint.** Whether plugins may declare
   *scoped* template keys that carry from a column declaration to created instances (§10's
   "starting frontmatter/body" vs §9.2's body-only pre-fill, per the SERVER-005 template-bleed fix)
   stays open. Implement **without** the mechanism; file the question verbatim in the issue's E2E
   log for user sign-off later. Building it is a fail; dropping the question silently is also a
   fail. Enforced by TEST-135.

4. **Worktree agents run SCOPED tests only.** `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run
   <path>` during development; at most one workspace-scoped run at the end of a session. Never the
   repo-wide suite, never `npm run coverage`, never `npm run test:coverage` from a worktree. The
   orchestrator runs the **single** repo-wide gate at harvest (TEST-139, TEST-140).

### Ruled before wave start (orchestrator, 2026-07-28)

5. **Conflict 1 → (a), the self-invalidating allowlist.** The extractor carries a named, commented
   allowlist of exactly two verbs landing in CLI-006 this phase (`doc check`, `skill rollback`),
   with a companion test asserting each entry is **still absent** from `docs/cli.md` — so the
   moment CLI-006 lands, the companion test fails and the allowlist must be emptied. The skill's
   loop-safety section names `corpus skill rollback` normally; `assets/workspace/README.md` needs
   no change. The allowlist lives in `scripts/workspace-template.ts` next to the extractor, never
   in the skill text.

6. **Conflict 2 → (a) now, rider filed.** The deferral protocol on a user-held lock (423): reply to
   the waiting thread through the CLI ("you're editing X — I'll apply this when the lock clears"),
   `corpus job log` the deferral, then `corpus queue fail <id>` with a `deferred:`-prefixed reason;
   `corpus job retry` is the documented re-entry. The terminal-state invariant stays intact.
   **SERVER-030 is filed** for the honest defer/requeue transition (P2, next wave or later). §7's
   "stays queued" wording is a SPEC amendment candidate at the phase PR: either SERVER-030's
   transition makes it literally true, or §7 is reworded to the fail-and-retry semantics — user
   signs off either way. TEST-46's server-side re-enqueue-on-break check records a finding, not a
   skill-text change.

7. **Conflict 3 → corrected.** AGENT-002's E2E step 2 now reads: enqueue via the UI (`@agent`
   comment) or `POST /api/threads` with `requestsAgent: true` and the bearer token. There is no
   `corpus thread create` and no `--agent` flag. Issue file updated by the orchestrator.

8. **Conflict 4 → path param.** `POST /api/skills/{name}/rollback`, body `{to?}`, 404 for unknown
   `{name}`. Matches the package's resource grammar and `routes/index.test.ts`'s registration-order
   convention. TEST-54 stands as written.

9. **Conflict 5 → (a), underscore exclusion.** Underscore-prefixed plugins are excluded from
   `docs/cli.md` generation and from production bundles (UI glob filter + CLI registry filter +
   server discovery all skip `_*` in production; present in dev and tests). E2E step 6 is verified
   against `corpus --help` and the registry in dev, plus a unit test proving a non-underscore
   plugin's verb WOULD reach the generator. The exclusion is implemented in exactly one named place
   per surface (TEST-114, TEST-131). The committed `docs/cli.md` never documents `_fixture`.

10. **Conflict 6 → (a), widen the include.** `COVERAGE_INCLUDE` gains `plugins/*/**` (replacing
    `plugins/*/src/**`), with underscore-prefixed plugin directories excluded the way test files
    are. §10's root-level layout stands — it is what plugin authors read. One-line change in
    `scripts/coverage-config.ts`, made by PLUGINS-001. TEST-132 verifies this ruling.

11. **Conflict 7 → core wins + source marker.** (i) A plugin shipping a skill whose directory name
    collides with a core template skill (`orchestrate`, `comment`, or any template-shipped skill)
    is **skipped with a warning naming the collision** — a plugin can never replace the loop
    (TEST-117). (ii) Plugin-installed skills ARE recorded in `.corpus/template-manifest.json` with
    a source marker: `{path, sha256, source: "plugin:<name>"}`; template-sourced entries keep their
    current shape (absent `source` ⇒ template). This is the minimal forward-compatible record;
    CLI-005 consumes it in wave 2 and refreshes plugin-sourced entries from the plugin, not the
    template. PLUGINS-001 may add the field; CLI-005's issue gets a note when scheduled.

12. **Conflict 8 → pinned strategy for the server half.** (i) The discovery root is the **tool's
    install directory**, resolved by a single `resolvePluginsRoot()` following the
    `resolveTemplateRoot()` pattern in `apps/cli/src/paths.ts` — a workspace-local `plugins/` is
    NOT discovered in v1 (TEST-133's assertion is confirmed intent). (ii) `npm run build` builds
    plugins after kit/contract (they import only those two); compiled output to
    `plugins/<name>/dist/`. (iii) Server discovery imports `dist/server/routes.js` when present,
    else falls back to `server/routes.ts` under a TS-capable loader (dev via tsx) — one resolution
    helper, both paths tested. (iv) In the dev layout the UI's build-time glob and the server's
    runtime resolution must agree on the repo-root `plugins/`; a parity test asserts both resolve
    to the same directory.

13. **Conflict 9 → corrected.** PLUGINS-001's file list: the `assets/workspace/.claude/…` line is
    struck (moot under Adjudication 1, and a literal `.claude` there is forbidden by AGENT-001's
    test); `packages/eslint-config` → the root `eslint.config.js`; `apps/cli/src/commands/init.ts`
    → the `apps/cli/src/commands/init/` directory. Issue file updated by the orchestrator.

14. **Conflict 10 → issue file gains CLI-007.** AGENT-002's dependency list is reconciled to
    `CLI-004, CLI-007, AGENT-001` (all done) — `corpus job log`'s stdin fix is a real dependency of
    the progress-logging section. Issue file updated by the orchestrator.

15. **Conflict 11 → noted, no action.** The Verification Environment section of this contract is
    the authoritative statement of what PLUGINS-001 may rely on; the dependency line stays as-is.

### Post-implementation rulings (orchestrator, 2026-07-28, harvest time)

16. **PLUGINS-001 deviation: lazy glob accepted.** `import.meta.glob` without `{eager: true}`,
    published through a reactive store, replaces the issue text's eager suggestion — eager
    evaluation makes per-module throw containment (TEST-82) physically impossible because a
    static-import throw kills bundle init. §10's text is eager-free; the acceptance criterion's
    mechanism (glob discovery, zero core edits) is intact.
17. **PLUGINS-001 deviation: TEST-121's boot warning narrowed** to what the server can see without
    loading UI code (manifest present with `types.yaml` missing/malformed). The bidirectional
    manifest↔types.yaml mismatch remains the parity test's job. Accepted.
18. **PLUGINS-001 deviation: three test files outside the nominal surface** minimally edited
    (`apps/server/src/lifecycle.test.ts` empty-discovery injection; `apps/ui/src/shell/Board.test.tsx`
    and `apps/ui/e2e/board.spec.ts` pre-plugin placeholder assertions). Accepted — injection seams,
    not behavior changes; pr-reviewer sees them in the phase diff.
19. **PLUGINS-001 deviation: `TOPIC_NAME_PATTERN` relaxed** to admit one leading underscore for
    dev-only fixture topics. Accepted — paired with the generator/production filters of
    Adjudication 9, so underscore topics can never reach `docs/cli.md` or a production bundle.
20. **PLUGINS-001 disclosure recorded:** the implementing agent ran `git checkout --` on two
    bookkeeping copies inside its own worktree (a forbidden state-changing git command). Effect was
    confined to that worktree's copies of the issue file and agent definition; the authoritative
    versions live in the main repo and were harvested normally. No code or history affected. Noted
    for the record; agent briefs continue to carry the prohibition.
21. **AGENT-002 escalation 1 → CLI-010 filed** (`corpus doc show` + `corpus thread show`, P1,
    blocks AGENT-003). AGENT-003's skill will state the read path: document *content* may be read
    from `data/` markdown; thread/queue/lock *state* goes through the CLI.
22. **CONTRACT-008 escalation 1 → enumerate-then-post.** CLI-006 implements whole-workspace
    `corpus doc check` by paginating `GET /api/docs` and posting `{ids}` to `POST /api/check`. No
    third request branch is added to the contract.
23. **CONTRACT-008 escalations 2+4 → SERVER-019 brief.** Unknown ids stay silent per the closed
    finding enum (the route description says so); SERVER-019 adds the server-side drift guard
    asserting the server's `CHECK_CODES` equals the contract's.
