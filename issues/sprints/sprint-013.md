# Sprint 013 — Phase 4, wave 2: the validation loop closes, and the tool becomes installable

**Issues**: SERVER-019, CLI-010, INFRA-008 _(stage A)_ · CLI-006, CLI-005, CONTRACT-015 _(stage B)_ · ~~CONTRACT-013~~ **struck — already shipped (Open Conflict 1)**
**Domains**: server (`apps/server`), cli (`apps/cli` + `scripts/`), infra (root tooling, `.github/`, `scripts/`), contract (`packages/contract`)
**Date**: 2026-07-28
**Plan phase**: Phase 4 — Agent Loop, Plugins, Packaging (second of two waves)
**Branch**: `phase-4-agent-loop`, at `6e7e709`, working tree clean, no worktrees outstanding. Agents work in worktrees cut from it.
**Fleet cap**: 3 concurrent implementation agents, staged. All six issues recommend **opus**.

---

## What makes this sprint different

**This is the wave where the deferred halves get consumed, and every one of them consumes something
that turns out to be shaped differently than its issue file says.** Sprint-012 shipped three
deliverables that were deliberately incomplete: CONTRACT-008's routes with no handlers, AGENT-002's
skill naming two verbs that do not exist, and PLUGINS-001's `_fixture` typed by hand because the
types it wanted were in forbidden packages. Wave 2 closes all three. The risk profile is therefore
inverted from wave 1: nothing here is novel design, and almost everything here is an **integration
against a shipped surface that the issue file describes from memory**. Fifteen conflicts below are
the product of reading the shipped tree at `6e7e709` rather than the issue text.

**Three of the six issues are near-one-liners that are not.**

- **SERVER-019** was scoped as "attach handlers to CONTRACT-008's routes; the validator already
  exists". True for `/api/check`'s core — `checkCorpus(documents.map(d => toCheckDocument(d.path,
  d.content)))` really is the body. But the write path calls that same function with **two injected
  seams** (`resolveAnchor`, `documentExists`) and a **leniency escape** for skill/agent-def
  frontmatter, and getting either wrong produces a validator that is not "the same implementation the
  write path runs" (§14) — it produces one that reports every `[[ref]]` in the workspace as
  unresolved, or that fails every hand-written `SKILL.md`. **Open Conflicts 2 and 3.** And the
  rollback half has **no API to build on at all**: `git grep` finds no `revert`, no `restore`, no
  ref-parameterised `git show` anywhere in `apps/server`. **Open Conflict 4.**
- **CLI-006** was scoped as "thin mappings onto CONTRACT-008 routes; the `--staged` collection is
  read-only git plumbing". The `doc` topic is **structurally forbidden from running git**, by a
  guard test that pins an exact module list and greps for the bare word `git` in stripped code.
  **Open Conflict 8 — blocking, and not discoverable cheaply mid-implementation.**
- **CONTRACT-015** was scoped as "type relocation along the existing dependency direction; the shapes
  already exist". `PluginServerContext` moves cleanly except for `Logger`. `CommandContext` does
  **not** move at all: `ParsedArgs`/`ParsedFlags` are classes with `#private` fields (nominally
  typed — no structural type can satisfy them), `Workspace`'s module reads `node:fs`, and `CliClient`
  is bound to the `@corpus/contract/client` subpath that the plugin lint rule exists to forbid.
  **Open Conflicts 12 and 13.**

**INFRA-008 is the only issue in the batch that can fail for reasons outside the repository.** The
npm name `corpus` is **taken** by a published 2011-era package (`corpus@0.0.1`, "Corpus.js is a
Javascript framework for large client side web applications"), `corpus-cli` is taken too, this
machine has no npm session (`npm whoami` → `ENEEDAUTH`), and `gh secret list --repo trupin/corpus`
returns **nothing** — there is no `NPM_TOKEN`. Its headline acceptance criterion ("publishes to npm
with provenance") is not verifiable by any agent. **Open Conflicts 5 and 6.** What *is* verifiable —
and is the issue's actual value — is the tarball: today `files: ["dist"]` ships neither the workspace
template, nor the plugins, nor the server, nor the UI, while **four separate resolvers already expect
a packaged layout that no build produces**.

**The substrate is more built than three of the issue files think.** Read out of the tree at
`6e7e709`, not inventoried:

- **CLI-005's AC1 is already done.** `.corpus/template-manifest.json` is written today by
  `scaffoldWorkspace` (`apps/cli/src/commands/init/scaffold.ts:371-377`) with
  `{version: 1, tool, installedAt, files: [{path, sha256, source?}]}` — including PLUGINS-001's
  `source: "plugin:<dir>"` marker (Adjudication 11). CLI-005 builds the **upgrade** verb over an
  existing baseline; it does not invent the baseline.
- **CONTRACT-013 is shipped.** Its code is on `HEAD` via PR #10's squash (`e6ce966`), its issue file
  reads `done`, and the ui-dev follow-up it named (the duplicate `FORM_ANSWER_LABEL` in
  `apps/ui/src/thread/parseFormBlock.ts`) is also gone. Only `issues/PLAN.md:116` still says `todo`.
- **`packages/kit` already models the exact pattern CONTRACT-015 needs**: `@corpus/kit/plugin` is a
  types-only subpath, kept off the `.` barrel *"so the manifest contract does not bloat the
  app-facing kit surface"* (`packages/kit/src/plugin/index.ts:4-10`). `packages/contract` already
  keeps `./client` off its root barrel for the same reason. The shape of the answer is on disk.
- **`apps/server/src/core/check.ts` is complete and its 13 codes match the contract's enum member for
  member, in order** — re-derived by the CONTRACT-008 evaluator, honesty-audit row 4.

**And four things the issue files assert are simply not true today.** Each costs a debugging cycle
if found mid-implementation:

- **`404 → exit 4` is wrong.** CLI-010's AC says *"errors follow the CLI's standard exit-code mapping
  (404 → exit 4, etc.)"*. Exit 4 is `ServerUnreachableError`, raised **only** by transport failures
  (`client.ts:140-164`); every non-2xx status, 404 included, is `ServerResponseError` → **exit 5**.
  CLI-006's own text says exit 5 and is right. **Open Conflict 9.**
- **`GET /api/threads/{id}` returns no `events` and no read-state.** CLI-010 promises *"(turns,
  events, status, anchor, read-state)"*. `ThreadSchema` is `{id, title, created, updated, status,
  tags, parent, anchor, agent, turns}` — no events array, no `unread`, no `lastSeenTs`. Read state is
  a `POST /api/threads/{id}/seen` response field and a `GET /api/docs?type=thread` row concern.
  **Open Conflict 10.**
- **`corpus doc list` and `corpus thread list` do not exist.** The documented surface is
  `doc archive|create|delete|edit|move` and `thread reopen|reply|resolve`. CLI-010's two verbs are the
  CLI's **first** document/thread read surface; the pattern precedent is `corpus lock list`.
- **`.githooks/pre-push` never blocks a push.** It ends at `step "unit tests"` with no
  `if [ "$fail" -ne 0 ]; then exit 1; fi` epilogue and `set -uo pipefail` (no `-e`), so it always
  exits 0; it also exports `CORPUS_UI_PORT` for a Playwright step its header claims and its body does
  not contain. INFRA-008 is told to add the version check *to this hook*. **Open Conflict 7.**

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue            | The real application in this sprint                                                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SERVER-019**   | A **real `corpus init` workspace on `9092`** with a **real server**, driven by **real `curl`** with the workspace bearer token. Every claim is checked against the file on disk, `git log` in the workspace, the projection (`GET /api/docs/{id}`), and the SSE stream. The CONTRACT-008 evaluator recorded the 404 before-state on `9080`; SERVER-019 records the 200 after-state on its own port. |
| **CLI-010**      | A **real workspace on `9097`**, a **real server**, and the **real binary** — `node --import tsx apps/cli/src/bin/corpus.ts` from source. Output is compared against `curl` on the same ids: the verb must print what the endpoint returned, not a re-derivation. `--json` is piped through `jq -e` to prove it is exactly one JSON value. |
| **INFRA-008**    | A **packed tarball installed into a scratch prefix with no path to the repo** (`npm pack -w apps/cli` → `npm install <tarball>` in `$(mktemp -d)`), and the **installed `corpus` binary** — never `npm run dev`, never `tsx`, never the repo checkout. Workspace on `9102`, board loaded in a **real browser** with the network panel open. This is the issue's entire point: everything else in the batch verifies code, this one verifies the *artifact*. |
| **CLI-006**      | A **real workspace on `9107`** with a deliberately drifted corpus (a duplicate id, an orphaned anchor, an unresolved `[[ref]]`), a **real server carrying SERVER-019's handlers**, a **real git repository with real staged files**, and the **real binary**. Exit codes are read from `$?`, not asserted in a unit test.               |
| **CLI-005**      | Two **real workspaces on `9112`** — one initialised before a simulated tool upgrade, one after — a **real edit** to a skill in the workspace, a **real edit** to its template counterpart, and `git log` in the workspace repo proving the single attributed commit. Run **both** with the server stopped and with it running (SSE + re-projection observed). |
| **CONTRACT-015** | The **committed generated artifacts** (`openapi.json`, `schema.generated.ts`, `docs/cli.md` — all three must be byte-identical after the change or regenerated and committed), `tsc --noEmit` across `packages/contract`, `apps/server`, `apps/cli`, `plugins/_fixture`, and **`npm run lint` proving the boundary rules still fire** via `scripts/eslint-boundaries.test.ts`. Plus a real server on `9117` proving `_fixture`'s routes still mount and `corpus _fixture add` still round-trips after the retyping. |

### Port allocation

Continuing the ladder upward from sprint-012's `9060`–`9074` and its evaluator's `9080`–`9089`.
Verified free at contract time: `lsof -nP -iTCP -sTCP:LISTEN` shows **nothing bound in `9000`–`9199`**,
and `8765` is free.

| Consumer                         | Range         | Primary | Vite (only if needed) |
| -------------------------------- | ------------- | ------- | --------------------- |
| SERVER-019                       | `9090`–`9094` | `9092`  | —                     |
| CLI-010                          | `9095`–`9099` | `9097`  | —                     |
| INFRA-008                        | `9100`–`9104` | `9102`  | `5283`                |
| CLI-006                          | `9105`–`9109` | `9107`  | —                     |
| CLI-005                          | `9110`–`9114` | `9112`  | —                     |
| CONTRACT-015                     | `9115`–`9119` | `9117`  | —                     |
| sprint-013 evaluator             | `9120`–`9129` | `9122`  | `5284`                |
| Automated tests, every workspace | —             | `0` (ephemeral). **Never hardcode.** | — |

**Reserved and off-limits:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the workspace default and the
  target of `apps/ui/vite.config.ts`'s proxy; `apps/ui/e2e/smoke.spec.ts` asserts the console strip
  reads exactly `"server unreachable"`, which is only true when nothing listens there. **Always pass
  `--port` explicitly to `corpus init`** so its upward probe never reaches it, and check
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done. Re-verified free at contract time.
- **`5173` and `5174` are held by an `ssh` process**, re-confirmed at contract time. `apps/ui/vite.config.ts`
  sets `server.port: 5173, strictPort: true` and does **not** read `CORPUS_UI_PORT`, so a bare
  `npm run dev -w apps/ui` **fails to start**. Only INFRA-008 might want a Vite server (it should not
  — the packaged UI is static); if it does: `npm run dev -w apps/ui -- --port 5283 --strictPort`.
  `CORPUS_UI_PORT` is read **only** by `apps/ui/playwright.config.ts`.
- **Playwright is single-holder** (`reuseExistingServer: false` + `--strictPort`). **No issue in this
  batch runs `npm run e2e`.** The orchestrator runs it once at harvest.

### Scratch directories — one prefix per issue

| Issue        | Prefix                                            |
| ------------ | ------------------------------------------------- |
| SERVER-019   | `mktemp -d /tmp/corpus-s013-server019-XXXXXX`     |
| CLI-010      | `mktemp -d /tmp/corpus-s013-cli010-XXXXXX`        |
| INFRA-008    | `mktemp -d /tmp/corpus-s013-infra008-XXXXXX`      |
| CLI-006      | `mktemp -d /tmp/corpus-s013-cli006-XXXXXX`        |
| CLI-005      | `mktemp -d /tmp/corpus-s013-cli005-XXXXXX`        |
| CONTRACT-015 | `mktemp -d /tmp/corpus-s013-contract015-XXXXXX`   |

Automated tests use `fs.mkdtemp`/`mkdtempSync` with the same prefix.

**Never** `rm -rf /tmp/corpus-*`. There are **46** leftover `corpus-*` directories in `/tmp` from
sprints 003–012; a glob delete would destroy other agents' in-flight evidence. Delete only paths you
created and captured in a variable.

**The scratch hazard specific to this sprint is git, and it is worse than sprint-012's.** Four of the
six issues run `git` against a scratch workspace — CLI-006 against a scratch repo with *staged*
files, CLI-005 against a workspace it commits into, INFRA-008 inside an npm install prefix, SERVER-019
to prove rollback commits. **Every `git` invocation carries an explicit `cwd` or `-C`.** A `git`
command with the wrong working directory operates on **the Corpus repository itself** — and CLI-006's
`--staged` path reads `git diff --cached`, so a mis-rooted run would happily post this repository's
staged files to a scratch server. Run `git -C <repo> status` before declaring done; it must be clean.

**INFRA-008 additionally must prove it wrote nothing outside its prefix.** Record the install
directory's `find <dir> -newer <marker>` before and after `corpus init`; the tool directory must be
byte-identical afterward (issue edge case: *"`corpus init` inside the tarball install must not touch
the tool directory"*).

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` kill sibling agents'
servers — **forbidden for the duration of this sprint.** Stop what you started, by pid:

```sh
node --import tsx apps/cli/src/bin/corpus.ts server start   # then: corpus server stop
curl -N "http://127.0.0.1:9092/events?token=$TOK" & SSE=$! ; kill -TERM "$SSE"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. INFRA-008 stops the
**installed** binary's server with the **installed** binary, not by pid-killing, so that
`corpus server stop`'s pidfile cleanup is itself under test.

### Machine-load discipline — binding on every agent in this batch

- **Scoped tests only during development**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`.
  **Never** the repo-wide suite, never `npm test` without a workspace filter, never `npm run coverage`
  or `npm run test:coverage` from a worktree. The orchestrator's harvest run is the single repo-wide
  gate (sprint-012 Adjudication 4, carried forward).
- **One workspace-scoped run at the very end of your session is the maximum**
  (e.g. `VITEST_MAX_THREADS=4 npm test -w apps/cli`).
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time.** Never overlap builds, test runs, or `npm install`. INFRA-008's
  `npm pack` + tarball install is a heavy command and must not run while another agent is building.
- **`npm run build` is a shared, serialized resource.** It writes `dist/` in every workspace of the
  **worktree it runs in**, so worktree isolation makes it safe — but three agents building at once
  saturates the machine. Stagger.
- **Nobody runs `npm run e2e`.** Playwright is the orchestrator's at harvest.
- **Cap concurrent implementation agents at three**, staged as below.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree at `6e7e709` while writing this contract.

**The validator's two injected seams and the leniency escape** — `apps/server/src/docs/write.ts:227-241`:

```ts
const report = checkCorpus([toCheckDocument(path, text)], {
  resolveAnchor: resolveAnchorExact,
  documentExists: (id) => isIdTaken(workspace.projection, id),
});
const lenientFrontmatter = classifyPath(path)?.synthesizeId === true;
const blocking = report.errors.filter(
  (finding) =>
    LOCAL_CHECK_CODES.has(finding.code) &&
    !(lenientFrontmatter && finding.code === CHECK_CODES.frontmatterInvalid),
);
```

`LOCAL_CHECK_CODES` is the **six** single-document codes a save may block on. `/api/check` sees the
whole corpus and must **not** apply that filter and must **not** throw — a drifted corpus is a `200`
with a non-empty `errors` array. The comment at `write.ts:68-70` says so: the cross-document rules
*"belong to `corpus doc check`, which sees the whole workspace"*.

**The two `CHECK_CODES` have different shapes.** Server (`core/check.ts:36-50`) is a **keyed object**
(`{frontmatterUnparseable: "frontmatter-unparseable", …}`); contract (`schemas/check.ts:39-53`) is a
**string tuple** (`["frontmatter-unparseable", …]`). Adjudication 23's drift guard is therefore
`expect(Object.values(CHECK_CODES_SERVER)).toEqual([...CHECK_CODES_CONTRACT])` — declaration order on
both sides, 13 members. `CHECK_WARNING_CODES = ["anchor-unresolved", "ref-unresolved"]`.

**The server's `CheckReport` has no `ok`.** `core/check.ts:101-104` is `{errors, warnings}`; the wire
schema is `{ok, errors, warnings}` with `ok` documented as `errors.length === 0`. The handler derives it.

**Skill ids are synthetic and start `doc_`, not `skill_`.** `projection/project-document.ts:84-87`:
`` `doc_${root.idPrefix}${sha1(relativePath).slice(0,8)}` `` → `doc_skill<8 hex>`, which satisfies the
contract's `DocIdSchema` (`^doc_[A-Za-z0-9]+$`). A skill's identity is its **path**, not its
frontmatter; `documents.path` is `TEXT NOT NULL UNIQUE` and the by-path lookup pattern is
`SELECT id FROM documents WHERE path = ?` (`project-document.ts:221`). There is **no**
`findDocumentByPath` helper and **no** skills module.

**`SkillNameSchema` forbids `/`** (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) but the `skill-tree` root shape
matches `SKILL.md` at **any depth**. A nested skill is therefore indexable but unaddressable by
`POST /api/skills/{name}/rollback`. Say so; do not silently widen the pattern.

**The rollback route's body is optional**; `/api/check`'s is required. `request-body-required.test.ts`
pins both (`"POST /api/check": true`, `"POST /api/skills/{name}/rollback": false`).

**The XOR is enforced by the schema, before any handler runs.** `CheckRequestSchema` is an unnamed
`z.union` of two `strictObject`s with `CHECK_REQUEST_XOR_MESSAGE`. Both keys, neither key, or an
unknown key → `400` with one top-level issue at path `json`. SERVER-019's handler never sees them.

**The CLI's error surface is by class, not by status.** `errors.ts:8-16`:
`0 success · 1 internalError · 2 usageError · 3 noWorkspace · 4 serverUnreachable · 5 serverError ·
6 checkFailed`. `client.request` throws `ServerUnreachableError` (4) only on ECONNREFUSED/ENOTFOUND/
abort/timeout; **every** non-2xx including 404 is `ServerResponseError` (5). Handlers never catch.

**The `out.emit`/`out.line` pattern makes `--json` branch-free.** `emit` is a no-op in human mode,
`line` is a no-op under `--json`, and **`emit` throws `InternalError` if called twice** — exactly one
JSON value per command. Precedent, `apps/cli/src/commands/lock/manage.ts:34-46`: emit the raw server
payload unreshaped, then render human lines; the empty case gets its own line and still exits 0.

**Every example that shows `--json` must inline the literal JSON shape in its `description`** — that
string lands verbatim in `docs/cli.md`, and that is the house style (`lock list --json` →
`` 'One JSON value: `{"locks":[{"docId":"doc_a1b2c3","holder":"user",…}]}`.' ``).

**`validateRegistry` runs at module load** and enforces: kebab-case names, non-empty summary, ≥1
example whose `command` starts with `"corpus "` and has a non-empty description, no duplicate arg
names, **no required arg after an optional one**, and no flag shadowing `GLOBAL_FLAG_NAMES` — note
**`--from` is global**, so no verb may declare it.

**`docs/cli.md` is generated, sorted, and drift-checked against HEAD.** Generator
`apps/cli/scripts/generate-docs.ts` via `npm run docs:cli -w apps/cli`; `_`-prefixed topics are
filtered out (`generate.ts:27`, Adjudication 9). `scripts/check-generated-artifacts.ts` hashes →
regenerates → re-hashes → **and** requires `git diff --stat HEAD --` over the artifacts to be empty,
*"so a stale commit cannot slip through either"*. Consequence, exactly as CONTRACT-008 hit it: **an
agent cannot turn this check green inside its own worktree before the orchestrator commits.** Record
the red output verbatim with the reason, and drive `checkGeneratedArtifacts` with the regenerate-and-
compare half against a pre-run snapshot. That is the accepted pattern; skipping or hand-editing is not.

**Two hygiene guards fire on new CLI modules.** `apps/cli/src/commands/hygiene.test.ts` scopes
`WRITE_RESTRICTED_TOPICS = ["doc","thread","db"]` **by path prefix** — *"nothing is out of scope by
being new"* — pins the guarded module list with an exact `toEqual([...])` of 12 paths (line 132-148),
forbids `node:child_process`, forbids `spawn|spawnSync|exec|execSync|execFile|execFileSync`, requires
every request to go through `client.request(...)`, and asserts `expect(module.code).not.toMatch(/\bgit\b/)`
on **prose-stripped** code. Any new file at `commands/doc/check.ts` is automatically in scope and
fails the pinned list until it is updated. **This is Open Conflict 8.**

**`runGit` has no `maxBuffer` and no `timeout`.** `apps/cli/src/commands/init/git.ts` promisifies
`execFile` with neither, so `git show :<path>` on a staged blob larger than Node's 1 MB default
`maxBuffer` rejects. Whatever CLI-006 builds for `--staged` must set both.

**`resolveTemplateRoot`, `resolvePluginsRoot`, `serverEntryCandidates` and `resolveUiDistDir` are four
independent two-layout resolvers, and only the dev candidate of each exists today.**

| Resolver | Packaged candidate | Dev candidate | Exists today |
| --- | --- | --- | --- |
| `apps/cli/src/paths.ts:50-55` | `apps/cli/assets/workspace` | `<repo>/assets/workspace` | dev only |
| `apps/cli/src/paths.ts:67-70` | `apps/cli/plugins` | `<repo>/plugins` | dev only |
| `apps/cli/src/commands/server/daemon.ts:109-136` | `apps/cli/server/main.js` | `apps/server/src/main.ts` (+ tsx loader) | dev only |
| `apps/server/src/config.ts:286-293` | `apps/server/ui` | `apps/ui/dist` | dev only |

All four derive their root from `import.meta.dirname`, **never `process.cwd()`** — that part is
already right. `resolveTemplateRoot` throws `InternalError("the bundled workspace template is missing
from this installation")` when neither candidate exists, which is exactly what an `npm pack` of
`apps/cli` produces today (`files: ["dist"]`). Note the **candidate orders disagree**: `paths.ts`
puts packaged first and its comment claims it *"Mirrors `resolveUiDistDir` … packaged first, dev
second"*, while `resolveUiDistDir` puts **dev first**. One of those two comments is wrong.

**`apps/server` has no `build` script and `main: "./src/index.ts"`.** The root build runs
`-w apps/server -w apps/ui --if-present`, so the server is never compiled. Nothing in the repo emits
`server/main.js`. `apps/cli/tsconfig.build.json` sets `rootDir: "src"`, so `tsc` cannot emit
`assets/` or `plugins/` into `dist/` — they must be staged at pack time.

**`plugins/_fixture` is the only plugin**, and it is underscore-prefixed, so Adjudication 9 excludes
it from production bundles and Adjudication 12's "include built plugin dist for non-underscore
plugins" has **no subject to demonstrate against** until PLUGINS-002 lands. **Open Conflict 11.**

**The plugin lint allowlist has an asymmetry, deliberately.** `eslint.config.js:73-80` negates
`"!@corpus/kit"`, `"!@corpus/kit/**"` and `"!@corpus/contract"` — with **no `/**` sibling for
contract**, because the rule exists to ban `@corpus/contract/client`. A new `@corpus/contract/plugin`
subpath is rejected until a **targeted** `"!@corpus/contract/plugin"` negation is added; a blanket
`"!@corpus/contract/**"` would re-open the `/client` hole. `scripts/eslint-boundaries.test.ts` writes
real probe files and lints them programmatically — *"a rule that was never seen to fire is a rule that
may not exist"* — and must be updated in lockstep.

**`@corpus/contract` imports nothing from `apps/*`** (grep: zero hits) and has no workspace
dependencies. That invariant is the point of CONTRACT-015 and must survive it.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification, or an external precondition (npm credentials, a package
name) is unavailable — is marked `STRUCK → Adjudication N`, `STRUCK → Open Conflict N`, or
`DEFERRED → <reason>` in the E2E Verification Log, **with the reason and the substitute evidence
supplied**. Silent omission is a fail. INFRA-008 will have several; that is expected and honest.

---

## Acceptance Tests

### SERVER-019: Mount validation + skill-rollback handlers

Ports `9090`–`9094`, primary `9092`. Scratch `/tmp/corpus-s013-server019-*`. **P1, opus. 30 criteria.**
Consumes CONTRACT-008's committed artifacts (already on the branch at `fcb52cf`). Blocks CLI-006.

**Mounting and scope**

TEST-1: The routes are served
  Given: A real workspace on `9092` with the server running
  When: `curl -sS -o /dev/null -w '%{http_code}' -X POST :9092/api/check -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"ids":[]}'`
  Then: `200` — replacing the `404` the CONTRACT-008 evaluator recorded on `9080` for the same request. Both statuses are quoted in the log.

TEST-2: Rollback is served
  Given: The same server
  When: `POST /api/skills/orchestrate/rollback` with the bearer token and no body
  Then: Not `404 not_found` for *route* reasons. (Content of the response is TEST-16 onward.)

TEST-3: Mount placement follows the convention
  Given: `apps/server/src/app.ts`
  When: Reading the mount table
  Then: Both handlers are mounted by `mount*Routes(app, …)` functions called **inside** the `if (deps.projection !== undefined)` block (both need the projection) and **before** `mountPluginRoutes` — the last core mount. No route is registered inline except `getHealth`, which is unchanged.

TEST-4: Registration touches no other route
  Given: `git diff` for this issue
  When: Inspecting `packages/contract/**`
  Then: Zero files changed under `packages/contract` — the wire surface is CONTRACT-008's and is not amended. `routes/index.test.ts`, `inventory.test.ts` and `openapi.test.ts` pass unchanged.

TEST-5: Unauthenticated requests are refused
  Given: The server on `9092`
  When: `POST /api/check` and `POST /api/skills/orchestrate/rollback` with **no** `Authorization` header
  Then: `401` on both. Neither joins the exempt three (`/api/health`, `/events`, `POST /api/jobs/{id}/log`).

**Validation handler — the shared implementation**

TEST-6: One validator, injected the same way as the write path
  Given: The handler source
  When: Reading how it calls the core
  Then: It calls `checkCorpus(...)` from `apps/server/src/core/check.js` with **both** seams supplied — `resolveAnchor: resolveAnchorExact` and `documentExists: (id) => isIdTaken(projection, id)` — the same two `validateBeforeWrite` supplies. There is no second validator, no re-implementation, and no translation of finding shapes.

TEST-7: The whole-corpus rules are NOT filtered to `LOCAL_CHECK_CODES`
  Given: A workspace containing two documents that both declare `id: doc_dupe01`
  When: `POST /api/check {"ids":["doc_dupe01"]}` — or the pair form carrying both files
  Then: The response carries a `duplicate-id` finding. `duplicate-id` is **not** in `LOCAL_CHECK_CODES`, so a handler that reused the save-path filter would return `ok: true` here. This is the test that distinguishes the two call sites.

TEST-8: A drifted corpus is a 200, not a throw
  Given: A workspace with at least one error-severity finding
  When: `POST /api/check` over it
  Then: HTTP `200`, body `{"ok": false, "errors": [...], "warnings": [...]}` with a non-empty `errors`. The handler never calls `validationError`/`badRequest` for findings; `400` is reserved for a malformed **request**.

TEST-9: `ok` is derived, and is exactly `errors.length === 0`
  Given: Two runs — one over a clean workspace, one over the drifted one
  When: Comparing `ok` to `errors.length`
  Then: `ok === (errors.length === 0)` in both, **including** the case where `warnings` is non-empty and `errors` is empty → `ok: true`. Warnings never flip `ok`. (The server's own `CheckReport` has no `ok`; the handler adds it.)

TEST-10: Warnings are exactly the two §14 carve-outs
  Given: A workspace with an orphaned anchor and a `[[ref]]` to a non-existent id
  When: `POST /api/check` over it
  Then: `warnings[].code` ⊆ `{anchor-unresolved, ref-unresolved}` and both appear; **neither** appears in `errors`. Every other emitted code appears only in `errors`.

TEST-11: The `{ids}` branch resolves through the projection and reads the real file
  Given: A document whose id is known
  When: `POST /api/check {"ids":["<id>"]}`
  Then: Findings reference that document's real `path` (workspace-relative, matching `documents.path`) and its real content. Mutating the file on disk and re-running changes the result without a server restart.

TEST-12: The `{documents}` branch validates without touching disk
  Given: A `(path, content)` pair whose `path` names a file that **does not exist** in the workspace and whose `content` has malformed frontmatter
  When: `POST /api/check {"documents":[{"path":"data/docs/nope.md","content":"---\nbad: [\n---\n"}]}`
  Then: `200` with a `frontmatter-unparseable` (or `frontmatter-invalid`) finding at that path, and **no file is created**: `ls data/docs/nope.md` still fails and `git -C <ws> status --porcelain` is unchanged before and after. This is the CLI-006 `--staged` path — content that exists only in the git index.

TEST-13: Unknown ids are silent
  Given: An id matching `DocumentIdSchema` that names no document
  When: `POST /api/check {"ids":["doc_zzzzzz"]}`
  Then: `200 {"ok":true,"errors":[],"warnings":[]}`. **No 404**, no synthetic finding, no code outside the closed thirteen. Adjudication 23, and the route declares no 404 at all.

TEST-14: Empty collections are legal and cheap
  Given: The server
  When: `POST /api/check {"ids":[]}` and `POST /api/check {"documents":[]}`
  Then: Both `200 {"ok":true,"errors":[],"warnings":[]}`. This is what makes CLI-006's "no staged document paths → exit 0, silent" a server-side no-op rather than a client-side special case.

TEST-15: The XOR is rejected by the schema, before the handler
  Given: The server
  When: `POST /api/check` with `{"ids":[],"documents":[]}`, with `{}`, and with `{"foo":1}`
  Then: `400` on all three, each carrying `CHECK_REQUEST_XOR_MESSAGE` as a single top-level issue at path `json`. Instrument the handler (a log line or a counter) to prove it **never ran** for these three.

**Rollback handler**

TEST-16: A rollback restores the previous content and lands as a normal auto-commit
  Given: A workspace whose `.claude/skills/orchestrate/SKILL.md` has been edited and committed at least twice
  When: `POST /api/skills/orchestrate/rollback` with `x-corpus-author: agent` and no body
  Then: The file on disk holds the **previous** version's bytes; `git -C <ws> log -1 --format='%an <%ae> %s'` shows author `agent <agent@corpus.local>` and a structured subject naming the rollback; `git -C <ws> log --oneline -- .claude/skills/orchestrate/SKILL.md` shows a **new** commit, not a rewritten history.

TEST-17: The response's `commit` is the new HEAD
  Given: The rollback from TEST-16
  When: Comparing `response.commit` to `git -C <ws> rev-parse HEAD`
  Then: They are the same commit (allowing for the response's short form; `/^[0-9a-f]{7,64}$/`). It is **not** the ref the content came from — the contract description says so explicitly.

TEST-18: `--to <ref>` restores that ref's version
  Given: Three committed versions of a skill, with the oldest sha recorded
  When: `POST /api/skills/orchestrate/rollback` with body `{"to":"<oldest-sha>"}`
  Then: The file holds the oldest version's bytes and a new commit is created. `{"to":null}` and an omitted body behave identically to TEST-16.

TEST-19: `docId` is the stable synthetic id and does not change
  Given: The document id from `GET /api/docs?type=skill` before the rollback
  When: Reading `response.docId` and re-querying after
  Then: Identical, and of the form `doc_skill<8 hex>` — ids are immutable (§5) and a skill's id is derived from its **path**, which a rollback does not move.

TEST-20: The projection and SSE reflect the rollback
  Given: An SSE stream open on `/events?token=$TOK`
  When: The rollback runs
  Then: An `invalidate` frame arrives carrying the document's key and the docs key; an immediate `GET /api/docs/{docId}` returns the restored body **without a refetch race** (server-originated writes re-project synchronously before responding). No document payload is streamed — keys only (§2.2 rule 3).

TEST-21: Unknown skill → 404 with the standard envelope
  Given: No `.claude/skills/never-installed/` directory
  When: `POST /api/skills/never-installed/rollback`
  Then: `404` rendered from `NotFoundErrorSchema`. No new error shape is introduced.

TEST-22: An archived skill is likewise not installed
  Given: A skill moved to `.claude/skills-archived/<name>/SKILL.md` (still indexed, `status: archived`)
  When: `POST /api/skills/<name>/rollback`
  Then: `404`. The contract description states archived is not installed; the handler resolves against `.claude/skills/` only.

TEST-23: A malformed skill name is rejected by the param schema
  Given: The server
  When: `POST /api/skills/Orchestrate/rollback` (wrong case) and `POST /api/skills/a/b/rollback`
  Then: `400` from `SkillNameSchema`'s pattern for the first; the second does not route to this handler at all. The handler is not reached in either case.

TEST-24: A skill with no prior version is handled honestly
  Given: A skill whose file has exactly one commit (the `corpus init` commit)
  When: `POST /api/skills/<name>/rollback` with no `to`
  Then: A defined, documented outcome — **not** a 500 and **not** a silent success that rewrites nothing. Whichever the implementation picks (a 404-class "no earlier version", or a `200` whose `warnings` say so), it is stated in the response, in the route's behaviour, and in the issue log. **See Open Conflict 4.**

TEST-25: Git serialization is honored
  Given: The handler's source
  When: Reading how it reaches git
  Then: Every git invocation the rollback makes runs inside `AutoCommitter.withGitLock(...)` — `.git/index` is one shared file and the reads a rollback needs (`git show <ref>:./<path>`, ref resolution) must not race a concurrent auto-commit.

TEST-26: The restoration goes through the standard mutation pipeline
  Given: The handler's source
  When: Reading how the file is written
  Then: It builds a `MutationPlan` (`{kind: "write", path, content}`) and calls `runMutation(...)` — it does **not** `writeFileSync` and then commit by hand. Consequence, observable: `registerSelfWrites` means the watcher does not double-process the write, and the projection/invalidate ordering matches every other mutation.

**The drift guard (Adjudication 23)**

TEST-27: The server's `CHECK_CODES` equals the contract's, member for member, in order
  Given: A new colocated test in `apps/server`
  When: It runs
  Then: `expect(Object.values(CHECK_CODES_FROM_SERVER)).toEqual([...CHECK_CODES_FROM_CONTRACT])` passes with **13** members. The two constants have different shapes (keyed object vs. string tuple) — the assertion normalises, it does not restate a literal list.

TEST-28: The guard is load-bearing
  Given: The passing guard
  When: A code is renamed on the server side (temporarily, in the agent's worktree)
  Then: The guard **fails**, naming the mismatch; reverted, it passes. Both outputs are in the log. A guard never seen to fire is a guard that may not exist.

TEST-29: The warning split is guarded too
  Given: The same test file
  When: It runs
  Then: It asserts the server's warning-emitting codes are exactly the contract's `CHECK_WARNING_CODES` (`anchor-unresolved`, `ref-unresolved`) — the severity split is §14's and is the half that a rename would silently invert.

**Scope and tests**

TEST-30: Colocated tests, and nothing outside the domain
  Given: `git diff --stat` for this issue
  When: Inspecting it
  Then: Changes are confined to `apps/server/**` (plus the issue file). Zero files under `packages/contract`, `apps/cli`, `apps/ui`, `packages/kit`, `plugins/`. New tests are colocated `*.test.ts` next to the handlers, and `VITEST_MAX_THREADS=4 vitest run apps/server` is green.

---

### CLI-010: Read verbs — `corpus doc show` + `corpus thread show`

Ports `9095`–`9099`, primary `9097`. Scratch `/tmp/corpus-s013-cli010-*`. **P1, opus. 20 criteria.**
Blocks AGENT-003. The CLI's **first** document/thread read surface — precedent is `corpus lock list`.

TEST-31: `corpus doc show <id>` exists and returns the document
  Given: A real workspace on `9097` with a document `doc_a1b2c3` created through the CLI
  When: `corpus doc show doc_a1b2c3`
  Then: Exit 0; human-readable output naming at minimum the title, type, status, path, and the body.

TEST-32: `corpus doc show --json` emits exactly one JSON value, unreshaped
  Given: The same document
  When: `corpus doc show doc_a1b2c3 --json | jq -e .` and `curl -sS :9097/api/docs/doc_a1b2c3 -H "Authorization: Bearer $TOK"`
  Then: `jq` exits 0 (exactly one well-formed JSON value on stdout, nothing else), and the two payloads are **identical** after normalising key order. The verb emits the server's payload; it does not re-derive it.

TEST-33: Nullable timestamps render as `—`, not as a substituted date
  Given: A skill document (`type: skill`) whose frontmatter has no `created`/`updated`
  When: `corpus doc show <skill-doc-id>`
  Then: Both fields render as `—`. The contract prescribes this (`schemas/doc.ts:45-67`); inventing a date is a fail. Under `--json` they are `null`.

TEST-34: Anchors are rendered with their resolution state
  Given: A document with one resolved anchor and one orphaned anchor (edit the body so a selector no longer matches)
  When: `corpus doc show <id>`
  Then: Both anchors appear, each naming its `anchorId`, its `threadId`, its `threadStatus`, and whether it is orphaned; the resolved one shows its `range`, the orphaned one shows that it did not resolve. This is the anchor context AGENT-003's comment skill reads before replying.

TEST-35: `corpus thread show <id>` exists and returns the thread with its turns
  Given: A thread with three turns, oldest first
  When: `corpus thread show th_x9y8`
  Then: Exit 0; the turns render in order with author and timestamp; `status`, `agent`, `parent` and `anchor` are all shown, with `parent: null`/`anchor: null` rendered honestly for a standalone thread.

TEST-36: `corpus thread show --json` matches the endpoint
  Given: The same thread
  When: `corpus thread show th_x9y8 --json | jq -e .` compared against `curl :9097/api/threads/th_x9y8`
  Then: One JSON value; payloads identical.

TEST-37: All three thread shapes render correctly
  Given: An anchored thread, a whole-document thread (`parent` set, `anchor: null`), and a standalone thread (`parent: null`, `anchor: null`)
  When: `corpus thread show` on each
  Then: Each renders without error and the distinction is visible in the output. §7's comment skill branches on exactly this.

TEST-38: A 404 exits **5**, not 4
  Given: The server running and reachable
  When: `corpus doc show doc_zzzzzz; echo $?` and `corpus thread show th_zzzzzz; echo $?`
  Then: **`5`** in both cases (`ServerResponseError`), with a message rendering the server's problem shape. Exit 4 is reserved for transport failure and is proven separately in TEST-39. **The issue file's "404 → exit 4" is wrong — Open Conflict 9.**

TEST-39: Server down exits 4 with the actionable message
  Given: The server stopped
  When: `corpus doc show doc_a1b2c3; echo $?`
  Then: `4`, and the message names `corpus server start` — never a raw connection error (§2.1).

TEST-40: A malformed id is a server-side 400 → exit 5
  Given: The server running
  When: `corpus doc show not-an-id; echo $?`
  Then: `5` with the validation message. (It is not a usage error: the registry declares one required string arg and the *server* owns id validity.)

TEST-41: Both verbs appear at all three help levels
  Given: The built registry
  When: `corpus --help`, `corpus doc --help`, `corpus doc show --help`, `corpus thread --help`, `corpus thread show --help`
  Then: `show` is listed under both topics, and each verb's own help renders its summary, its `<id>` argument table, and its examples — all from the registry, no hand-written help text.

TEST-42: `docs/cli.md` regenerates with both entries
  Given: `npm run docs:cli -w apps/cli`
  When: Inspecting the diff
  Then: `### \`corpus doc show\`` and `### \`corpus thread show\`` sections exist with the generated shape (summary → description → synopsis fence → **Arguments** table → **Examples**), and both are listed in the `## Contents` TOC. Running the generator twice is byte-identical.

TEST-43: Each verb carries ≥1 example, and the `--json` example inlines its shape
  Given: The command specs
  When: `validateRegistry` runs at module load
  Then: It passes; and each verb has both a plain and a `--json` example, the latter's description containing the literal JSON skeleton it produces — the house style, and the string that lands in `docs/cli.md`.

TEST-44: The verbs are thin clients
  Given: The two new modules
  When: Reading them
  Then: Each is one `context.client.request((api) => api.GET("/api/docs/{id}", {params:{path:{id}}}))` (resp. `/api/threads/{id}`) through the **generated typed client**, then `out.emit(result)` followed by `out.line(...)` renders. No `fetch(`, no literal URL, no `if (json)` branch. `apps/cli/src/commands/hygiene.test.ts`'s guards pass without amendment.

TEST-45: `emit` is called exactly once
  Given: Either verb
  When: Run under `--json`
  Then: Exit 0 and stdout is one JSON value. (`Output.emit` throws `InternalError` on a second call, so a double-emit is exit 1, not silently-two-values.)

TEST-46: No write path is introduced
  Given: `git diff` for this issue
  When: Inspecting it
  Then: No mutation verb changed, no server file changed, no contract file changed. Both new commands are `WorkspaceCommandSpec` (they require a workspace and a client) and neither declares `--from` (it is a global flag; declaring it fails `validateRegistry`).

TEST-47: Read state is **not** invented
  Given: `GET /api/threads/{id}`'s response carries no `unread` and no `lastSeenTs`
  When: Reading `corpus thread show`'s output
  Then: It reports no read-state, **or** it reports read-state obtained from a second, named call — and whichever is chosen is stated in the issue log with its reason. Printing a fabricated or defaulted unread flag is a fail. **Open Conflict 10.**

TEST-48: `events` is not invented either
  Given: `ThreadSchema` has `turns` and no `events` array
  When: Reading the output and the issue file's summary
  Then: The verb prints what the schema carries. The issue file's "(turns, events, status, anchor, read-state)" is corrected rather than implemented. **Open Conflict 10.**

TEST-49: Unit tests follow registry conventions
  Given: The new colocated tests
  When: `VITEST_MAX_THREADS=4 vitest run apps/cli/src/commands/doc apps/cli/src/commands/thread`
  Then: Green, covering: the human rendering for each thread shape, the `—` rendering of null timestamps, `--json` emitting the payload unchanged, and the registry-shape assertions the other verbs' tests make.

TEST-50: E2E against the real binary, from source
  Given: A real server on `9097`
  When: Running both verbs via `node --import tsx apps/cli/src/bin/corpus.ts …` (**never `npx`**)
  Then: The log carries the exact commands, the exact stdout, the exit codes from `$?`, and the `curl` comparisons. Server stopped afterward; `9097` confirmed free.

---

### INFRA-008: npm packaging & release — the installable `corpus` tool

Ports `9100`–`9104`, primary `9102`; Vite `5283` only if a dev server is genuinely needed (it should
not be). Scratch `/tmp/corpus-s013-infra008-*`. **P1, opus. 35 criteria.** The only issue whose
acceptance depends on facts outside the repository — see Open Conflicts 5, 6, 7, 11.

**The strategy decision (do this first, write it down)**

TEST-51: One strategy is chosen, recorded, and consistently applied
  Given: The issue's two options — (1) bundle CLI + server into `dist/` with the UI copied in, (2) publish the `@corpus/*` graph
  When: Reading the issue file before any code
  Then: The choice **and its reason** are written into the issue file's design notes, and the implementation does exactly one of them. Evidence that it was chosen against the tree: `apps/server` has **no build script** and `main: "./src/index.ts"`, and `apps/cli/tsconfig.build.json` has `rootDir: "src"` — so option 1 requires a bundler step and option 2 requires making `apps/server` buildable and publishable. "Half of both" is a fail.

TEST-52: Version singularity is defined before it is checked
  Given: Every workspace is `0.0.0` and the root `package.json` has **no `version` field at all**
  When: Reading the implementation
  Then: A single version source is named (root `version`, added if absent), every workspace matches it, and the rule is stated in the issue file.

**The published manifest**

TEST-53: Exactly one package is publishable
  Given: `npm pack --dry-run --json` across the repo
  When: Inspecting which manifests lack `private: true`
  Then: Exactly one (or exactly the set option 2 declares, each named in the issue file). Every other workspace keeps `private: true`.

TEST-54: The manifest carries every required field
  Given: The published `package.json`
  When: Reading it
  Then: `name`, `version`, `description`, `license: "MIT"`, `repository` (pointing at `github.com/trupin/corpus`), `engines.node: ">=22"`, `bin.corpus`, `files`, and `publishConfig.access: "public"` are all present, and `private` is **absent**.

TEST-55: The `license` field matches the `LICENSE` file
  Given: `LICENSE` exists at the repo root — **MIT, "Copyright (c) 2026 Theophane RUPIN"** — and GitHub reports the repo as PUBLIC/MIT
  When: Comparing to the manifest
  Then: `"license": "MIT"`. No first-party `package.json` declares a license today; this issue adds it. **The license question is already settled by the file on disk — do not re-ask the user about MIT; do ask about the package name (Open Conflict 5).**

TEST-56: `tsx`, `vitest`, `eslint`, `playwright` are not runtime dependencies
  Given: The published manifest's `dependencies`
  When: Reading them
  Then: None of the four appear. A global install must not pull Playwright. If the source-layout server launcher's `tsx` requirement (`daemon.ts:143-152`) survives into the package, that is a bug: the packaged layout must take the `server/main.js` branch and never the tsx branch.

**The tarball**

TEST-57: The tarball carries the workspace template
  Given: `npm pack -w apps/cli` (or the chosen package) then `tar -tzf <tarball>`
  When: Grepping the file list
  Then: `assets/workspace/` (post-staging: the eleven template files, including `claude/skills/orchestrate/SKILL.md`, `claude/skills/comment/SKILL.md`, `gitignore`, `README.md`, `data/docs/views/*.md`, `data/docs/templates/note.md`) is present at the path `resolveTemplateRoot`'s **packaged** candidate expects. Today it is absent and `resolveTemplateRoot` would throw.

TEST-58: The tarball carries the UI build
  Given: The same file list
  When: Grepping
  Then: `index.html` **and** the hashed asset bundle(s) are present at the path `resolveUiDistDir`'s packaged candidate expects. Assert positively on the hashed bundle, not only on `index.html` — a UI that loads `index.html` and 404s its bundle is the exact failure TEST-70 exists to catch.

TEST-59: The tarball carries the server
  Given: The same file list
  When: Grepping
  Then: The server entry exists at `serverEntryCandidates`' packaged path (`server/main.js` relative to the package root, under the current shape), together with whatever its chosen strategy requires to run.

TEST-60: The tarball carries the bin, with its shebang and exec bit
  Given: The extracted tarball
  When: `head -1` on the bin and `ls -l`
  Then: `#!/usr/bin/env node` is the first line and the file is executable. (`apps/cli`'s build already does `chmod +x dist/bin/corpus.js`; the pack must preserve it.)

TEST-61: The tarball carries `README.md` and `LICENSE`
  Given: The file list
  When: Grepping
  Then: Both present.

TEST-62: The tarball excludes everything it must
  Given: The file list
  When: Grepping
  Then: **Zero** matches for `*.test.ts`, `node_modules/`, `issues/`, `design/`, `.claude/`, `.githooks/`, `data/`, `.corpus/`, `.env`, and `coverage`.

TEST-63: Underscore-prefixed plugins are excluded (Adjudication 9)
  Given: `plugins/_fixture` is the only plugin today
  When: Grepping the file list for `_fixture`
  Then: **Zero** matches. The dev-only fixture never reaches a production tarball, consistent with the generator filter (`generate.ts:27`) and the coverage exclude (`plugins/_*/**`).

TEST-64: Non-underscore plugins' built `dist` WOULD be included (Adjudication 12)
  Given: No non-underscore plugin exists yet
  When: Verifying the mechanism
  Then: A **unit test over the pack rule** proves a synthetic `plugins/todos/dist/**` entry is admitted while `plugins/_fixture/**` is denied, and the issue log records that the live proof is `DEFERRED → PLUGINS-002`. Asserting only the exclusion would let a rule that excludes *everything* pass. **Open Conflict 11.**

TEST-65: The pack check asserts in both directions and is wired into CI
  Given: `scripts/check-pack.ts` (new — it does not exist today)
  When: `npm run pack:check`
  Then: It runs `npm pack --dry-run --json`, asserts the **positive** list (bin, `dist/**`, template, UI build, server entry, `README.md`, `LICENSE`) and the **negative** list (TEST-62/63), and exits non-zero on violation. A negative-only check passes on an empty tarball; both directions are required. It is added to `.github/workflows/ci.yml`'s `validate` job.

TEST-66: The pack check has unit tests over fixtures
  Given: Captured `npm pack --dry-run --json` output as a fixture
  When: `VITEST_MAX_THREADS=4 vitest run scripts/check-pack.test.ts`
  Then: A clean list passes; a list containing `issues/README.md` fails; a list containing a `.test.ts` fails; an **empty** list fails. Note `COVERAGE_INCLUDE` does not cover `scripts/**`, so these tests are the only gate on this file.

**Version singularity**

TEST-67: `check-versions.ts` exists and fails on drift
  Given: `scripts/check-versions.ts` (new)
  When: `npm run version:check`
  Then: Exit 0 with every workspace at one version; drifting one workspace's `version` by hand makes it exit non-zero naming the offender; reverted, green. Unit-tested against fixture manifests (matching set passes, one drifted version fails).

TEST-68: The tag/version guard refuses a mismatch
  Given: The release workflow's guard, exercised locally with a stubbed `GITHUB_REF`
  When: `GITHUB_REF=refs/tags/v9.9.9` against a package at a different version
  Then: The guard fails. With a matching tag it passes. Both runs are in the log.

TEST-69: The version check is wired into pre-push and CI
  Given: `.githooks/pre-push` and `.github/workflows/ci.yml`
  When: Reading them
  Then: `version:check` appears in both. **And the pre-push hook actually blocks**: see TEST-84.

**The real acceptance test — a clean install**

TEST-70: The installed binary runs from a directory with no path to the repo
  Given: `D=$(mktemp -d /tmp/corpus-s013-infra008-XXXXXX); cd "$D"; npm init -y; npm install /abs/path/to/<tarball>`
  When: `npx corpus --version` (or the global binary)
  Then: It prints the expected version. This proves the bin, the shebang, the exec bit, and that `cliPackageRoot()`'s `import.meta.dirname` walk lands correctly in an installed layout.

TEST-71: `corpus init` scaffolds a workspace from the packaged template
  Given: `mkdir "$D/scratch" && cd "$D/scratch"`
  When: `corpus init --port 9102`
  Then: `data/`, `.corpus/config.json` (mode `0600`, fresh token), `.claude/skills/orchestrate/SKILL.md`, `.claude/skills/comment/SKILL.md`, `.gitignore`, the seed views, and `.corpus/template-manifest.json` all exist; `git -C . log --oneline` shows exactly one initial commit. **`resolveTemplateRoot` did not throw** — which it does today.

TEST-72: `corpus init` does not touch the tool directory
  Given: A recorded checksum/manifest of the install directory before `init`
  When: Re-taking it after
  Then: Byte-identical. The tool is code; the workspace is data.

TEST-73: The server starts and serves the packaged board with zero asset 404s
  Given: `corpus server start` in the scratch workspace
  When: Opening the printed URL in a **real browser** with the network panel open
  Then: The board renders; **zero 404s for JS/CSS**; the token is provisioned to the UI (SERVER-024) so the board is authenticated. Capture what is on screen. A screenshot of a blank page with a green server log is not evidence.

TEST-74: A document round-trips through the installed tool
  Given: The running installed server
  When: `corpus doc create …` then `corpus doc show <id>` (CLI-010's verb, if landed — otherwise `curl`)
  Then: (a) the markdown file exists under `data/` with valid frontmatter, (b) the CLI/API returns it, (c) it appears in the browser **without a manual refresh** (SSE invalidation from the packaged server).

TEST-75: Plugin discovery behaves correctly in the packaged layout
  Given: The installed tool, whose tarball contains no plugins (TEST-63)
  When: `corpus --help` and the server's boot log
  Then: `resolvePluginsRoot()` returns `undefined` cleanly, no plugin topics appear, `_fixture` is absent from `corpus --help`, and the server boots with no plugin warnings or errors. A missing plugins directory is a normal state, not a failure.

TEST-76: `corpus server stop` shuts down cleanly, using the installed binary
  Given: The running server
  When: `corpus server stop`
  Then: Clean shutdown, pidfile removed, `lsof -nP -iTCP:9102 -sTCP:LISTEN` empty. Not killed by pid — the lifecycle verb is under test.

TEST-77: Nothing was written outside the prefix
  Given: The whole run
  When: Removing `"$D"` and checking
  Then: No files remain outside it that the run created; `git -C <repo> status` is clean; `8765` still unbound.

**Release workflow**

TEST-78: `release.yml` exists, is tag-triggered, and parses
  Given: `.github/workflows/release.yml` (new — the repo has exactly one workflow today, `ci.yml`)
  When: Validating it with `actionlint` (or at minimum a YAML parse)
  Then: Valid; triggered on `v*` tags; `permissions: {contents: read, id-token: write}`; `actions/setup-node` with `registry-url: https://registry.npmjs.org`; runs the full validate gate and `npm run build` before publishing; `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

TEST-79: The workflow fails loudly if provenance is impossible
  Given: The provenance precondition (public repo + GitHub Actions) — the repo **is** PUBLIC, so it holds today
  When: Reading the publish step
  Then: The flag is unconditional, or a guard fails loudly. Silently dropping `--provenance` is a fail.

TEST-80: Re-running the release on an existing tag fails cleanly
  Given: The workflow's guards
  When: Reasoning about a repeat run (npm rejects republishing a version)
  Then: The workflow fails at the version guard or at `npm publish`, never half-publishes. Stated in the issue log with the mechanism named.

TEST-81: A real publish is **not** attempted
  Given: `npm whoami` → `ENEEDAUTH` and `gh secret list --repo trupin/corpus` → empty
  When: Reaching the publish step
  Then: **No publish, no prerelease tag pushed.** The issue log records `DEFERRED → user provisions NPM_TOKEN and the package name` with the two command outputs quoted as the reason. The issue file itself says "Do not publish a real release without the user's go-ahead". **Open Conflict 6.**

**README and docs**

TEST-82: `README.md` exists and documents the operator loop
  Given: The repo root has **no `README.md`** today
  When: Reading the new one
  Then: It states what Corpus is in two sentences, then the operator loop end to end: install, `corpus init`, `corpus server start`, open the board, start `claude`, `/orchestrate`. **The install line names the actual published package name** decided in Open Conflict 5 — not a placeholder, not `npm install -g corpus` if that name was not obtained.

TEST-83: `README.md` documents contributor setup
  Given: The same file
  When: Reading its Contributing section
  Then: clone → `npm install` → **`npm run setup-hooks`** (the one-time step §15 makes a condition of v1) → `npm run build` → `npm test`, plus the per-phase-PR and squash-only merge policy. §15's definition of done names the README explicitly.

**The hook defect this issue walks into**

TEST-84: `.githooks/pre-push` blocks a failing step
  Given: The hook as shipped, which ends at `step "unit tests"` with `set -uo pipefail` and **no** `if [ "$fail" -ne 0 ]; then exit 1; fi` epilogue — so it always exits 0
  When: Making one step fail deliberately and running the hook
  Then: It exits **non-zero**. INFRA-008 is instructed to add `version:check` to this hook; adding a check to a hook that cannot fail is theatre. Fix it here or file it — either is acceptable, silence is not. **Open Conflict 7.**

TEST-85: `CLAUDE.md`'s Build & Dev Commands names the new scripts
  Given: The new `pack:check`, `version:check` and release scripts
  When: Reading `CLAUDE.md`
  Then: The developer-facing ones are documented there, consistent with how `coverage`/`coverage:merge` are documented today.

---

### CLI-006: `corpus doc check` + `corpus skill rollback`

Ports `9105`–`9109`, primary `9107`. Scratch `/tmp/corpus-s013-cli006-*`. **P1, opus. 30 criteria.**
**Stage B — requires SERVER-019 landed.** Blocks AGENT-003. Landing this issue **must empty**
`CLI_COMMANDS_PENDING_CLI_006`; its companion test forces the issue.

**`corpus doc check` — the three input modes**

TEST-86: `corpus doc check <id>…` validates the named documents
  Given: A workspace on `9107` with one clean document and one carrying a duplicate id
  When: `corpus doc check <clean-id>; echo $?`
  Then: Exit `0` with a human line saying the check passed.

TEST-87: Errors exit 6
  Given: The drifted document
  When: `corpus doc check <drifted-id>; echo $?`
  Then: Exit **`6`** (`CheckFailedError` — "a check-style command reported a failure (its work succeeded)"), with the findings rendered: code, severity, path, detail. Not exit 1, not exit 5.

TEST-88: Warnings do not fail
  Given: A document with an orphaned anchor and an unresolved `[[ref]]`, and no errors
  When: `corpus doc check <id>; echo $?`
  Then: Exit **`0`**, with the warnings printed. §14 carves both out as normal states of a living corpus; failing on them would punish the operator for using the system as designed.

TEST-89: `--json` emits the server response unchanged
  Given: The drifted document
  When: `corpus doc check <id> --json | jq -e .`
  Then: One JSON value, identical to `POST /api/check`'s body (`{ok, errors, warnings}` with `CheckFinding` fields verbatim). **The exit code is still 6** — `--json` changes the output channel, not the verdict.

TEST-90: Whole-workspace `corpus doc check` enumerates then posts (Adjudication 22)
  Given: A workspace with more than `MAX_PAGE_LIMIT` (200) documents, or a forced small `limit`
  When: `corpus doc check` with no ids and no `--staged`
  Then: It paginates `GET /api/docs` (offset pagination: `limit` ≤ 200, `offset`, and a `total` in the page meta) until `offset + limit >= total`, collects every id, and posts them as `{ids}` to `POST /api/check` — **one** check request, not one per page, unless batching is documented. No third request branch was added to the contract.

TEST-91: Whole-workspace check covers archived documents
  Given: `GET /api/docs` **excludes** `status: archived` by default (`schemas/query.ts:97-121`), and archived skills live under `.claude/skills-archived/`
  When: `corpus doc check` runs over a workspace containing an archived document with a duplicate id
  Then: The finding is reported. The enumeration passes `includeArchived=true` (the union reading), so "the whole workspace" means the whole workspace. **Open Conflict 15.**

TEST-92: Whole-workspace check covers skills and agent-defs
  Given: `.claude/skills/**/SKILL.md` and `.claude/agents/*.md` are indexed as documents (§7)
  When: `corpus doc check` runs
  Then: They are among the enumerated ids. A whole-workspace check that silently skips the loop's own skills is the one that matters least to skip.

**`--staged`**

TEST-93: `--staged` collects only staged document blobs
  Given: A scratch git repo (`git -C "$WS"`, never the Corpus repo) with: a staged new document, a staged modified document, a staged **deleted** document, an **unstaged** modified document, and a staged non-document file (e.g. `.gitignore`)
  When: `corpus doc check --staged --json`
  Then: The posted `documents` array contains exactly the staged **added/copied/modified/renamed** document paths and their **index** content (`git show :<path>`), not the working-tree content. The deleted file, the unstaged change, and the non-document file are absent.

TEST-94: `--staged` changes no git state
  Given: `git -C "$WS" status --porcelain` captured before
  When: `corpus doc check --staged` runs
  Then: `git -C "$WS" status --porcelain` is byte-identical after. Only read-only plumbing ran. (CLI-003's testing plan already specifies exactly this assertion.)

TEST-95: `--staged` with nothing staged is silent and exits 0
  Given: A clean index
  When: `corpus doc check --staged; echo $?`
  Then: Exit `0` with **no output** on stdout. This is why `POST /api/check {"documents":[]}` returning `200` matters (TEST-14): no client-side special case is needed.

TEST-96: `--staged` posts pairs, never ids
  Given: The staged set
  When: Inspecting the request (server access log, or a `--json`-visible echo)
  Then: The body is the `{documents: [{path, content}]}` branch. Staged content does not exist on disk in that form, so the id branch cannot express it.

TEST-97: `--staged` handles a large blob
  Given: A staged document larger than 1 MB
  When: `corpus doc check --staged`
  Then: It succeeds. `runGit` today promisifies `execFile` with **no `maxBuffer` and no `timeout`**, so the Node default (1 MB) would reject; whatever git helper CLI-006 uses sets both explicitly.

TEST-98: `--staged` and explicit ids are not silently combined
  Given: Both supplied
  When: `corpus doc check <id> --staged`
  Then: A defined behaviour — a usage error (exit 2), or a documented precedence — stated in the verb's description and in `docs/cli.md`. Not a silent drop of one input.

**`corpus skill rollback`**

TEST-99: `corpus skill rollback <name>` restores and reports
  Given: A workspace whose `orchestrate` skill has two committed versions and SERVER-019's handler live
  When: `corpus skill rollback orchestrate --from agent`
  Then: Exit 0; stdout names the **restored commit** and the **path**; the file on disk holds the previous bytes; `git -C "$WS" log -1 --format='%an'` is `agent`.

TEST-100: `--to <ref>` is passed through
  Given: A recorded older sha
  When: `corpus skill rollback orchestrate --to <sha>`
  Then: That version is restored; the request body carried `{"to":"<sha>"}`.

TEST-101: Unknown skill → exit 5 with the stated message
  Given: No skill named `nope`
  When: `corpus skill rollback nope; echo $?`
  Then: Exit **`5`**, message reading `no skill named nope` (the issue's own wording). 404 → `ServerResponseError` → 5; this matches the shipped exit table and CLI-006's own text.

TEST-102: `--json` emits the rollback result
  Given: A successful rollback
  When: `corpus skill rollback orchestrate --json | jq -e .`
  Then: One JSON value carrying `{name, docId, commit, path, warnings}` — `SkillRollbackResult` verbatim from the server, unreshaped.

TEST-103: Attribution defaults to `user` and `--from` is honored
  Given: The global `--from` flag (default `user`)
  When: Running once with no flag and once with `--from agent`
  Then: The `x-corpus-author` header is `user` then `agent`, and the workspace commit authors match. The verb does **not** declare its own `--from` (that would fail `validateRegistry`).

**Registry, docs, and the allowlist**

TEST-104: Both verbs are registered and validated
  Given: `apps/cli/src/registry/index.ts`
  When: The module loads
  Then: `check` is in `docTopic.commands`; a **`skill` topic** exists in `topics` with `rollback`; `validateRegistry` passes (≥1 example each, `corpus `-prefixed example commands, no global-flag shadowing).

TEST-105: `docs/cli.md` regenerates with both, at the exact heading form
  Given: `npm run docs:cli -w apps/cli`
  When: Inspecting the output
  Then: `### \`corpus doc check\`` and `### \`corpus skill rollback\`` exist. The exact backticked heading form matters: `parseCliDoc` in `scripts/workspace-template.ts` matches `/^#{2,3} \`corpus ([^\`]+)\`/gm`, and a `skill` topic with one verb yields `topics ∋ "skill"` and `commands ∋ "skill rollback"`.

TEST-106: The self-invalidating allowlist is emptied
  Given: `scripts/workspace-template.ts:235` — `CLI_COMMANDS_PENDING_CLI_006 = ["doc check", "skill rollback"]`
  When: This issue lands
  Then: It is `[]`. The `"expires the allowlist the moment CLI-006 lands"` test (line 749-760) fails otherwise — by design, per Adjudication 5.

TEST-107: The allowlist's *other* test is updated too
  Given: `scripts/workspace-template.test.ts:745-747` — `expect([...CLI_COMMANDS_PENDING_CLI_006]).toEqual(["doc check", "skill rollback"])`
  When: The allowlist is emptied
  Then: **This assertion also fails** unless updated to `toEqual([])` (or removed with the allowlist). Both edits land in the same commit; emptying one and not the other leaves the suite red either way. **This file is AGENT-002-owned per sprint-012's Integration Points — Open Conflict 14.**

TEST-108: The template tree's invocations now resolve without the allowlist
  Given: `assets/workspace/claude/skills/orchestrate/SKILL.md` names `corpus skill rollback` in its loop-safety section, and `assets/workspace/README.md`
  When: The `"resolves every \`corpus …\` invocation in the whole template tree"` test runs with an empty allowlist
  Then: Green — the verbs are now genuinely documented. No skill text changes.

TEST-109: The generated-artifact drift check is honest
  Given: `scripts/check-generated-artifacts.ts` compares against **HEAD**
  When: Running it in the worktree before the orchestrator commits
  Then: It is red for `docs/cli.md`, and the log says so **verbatim** with the reason, plus the regenerate-and-compare half driven against a pre-run snapshot. CONTRACT-008 set this precedent and the evaluator confirmed the prediction post-commit.

**The hygiene guard**

TEST-110: The git plumbing does not violate the CLI's write-restriction guard
  Given: `apps/cli/src/commands/hygiene.test.ts` scopes `WRITE_RESTRICTED_TOPICS = ["doc","thread","db"]` **by path prefix**, pins the guarded module list with an exact `toEqual([...])` of 12 paths, forbids `node:child_process` and all six `exec*`/`spawn*` calls, and asserts `not.toMatch(/\bgit\b/)` on prose-stripped code
  When: `corpus doc check --staged` ships
  Then: The guard passes — via whichever resolution Open Conflict 8 rules (a shared read-only helper outside the guarded prefixes, or an explicit named carve-out). The guard's **intent** — that `doc`/`thread`/`db` verbs perform no document writes and no state-changing git — is preserved and restated wherever it is relaxed. Silently deleting the assertion is a fail.

TEST-111: The guard still fires
  Given: Whatever resolution lands
  When: A probe adds a `spawnSync("git", ["commit", …])` into a `doc` command module
  Then: The guard **fails**. Reverted, green. Both outputs in the log.

TEST-112: Every request still goes through the typed client
  Given: The two new verbs
  When: Reading them
  Then: Both server calls go through `context.client.request((api) => api.POST(...))` on the generated client. No `fetch(`, no literal URL. Only the `--staged` collection touches git, and only for reads.

**Tests and E2E**

TEST-113: Unit tests cover parsing, collection, and exit mapping
  Given: `VITEST_MAX_THREADS=4 vitest run apps/cli/src/commands/doc apps/cli/src/commands/skill`
  When: They run
  Then: Green, covering: `--staged` collection against a temp git repo (the five-file matrix of TEST-93), the exit-code mapping (0 / 5 / 6), the empty-staged short circuit, `--json` emitting the payload unchanged, and the registry-shape assertions.

TEST-114: E2E through the real binary against a real drifted workspace
  Given: The server on `9107` with SERVER-019's handlers
  When: Running every verb form via `node --import tsx apps/cli/src/bin/corpus.ts`
  Then: The log carries exact commands, exact stdout, exit codes from `$?`, and the scratch repo's `git status --porcelain` before and after. Server stopped; `9107` free; `git -C <repo> status` clean.

TEST-115: The read-only-filesystem constraint holds
  Given: The issue's AC — "read-only-filesystem constraint holds"
  When: Running `corpus doc check` in every mode
  Then: No file under `data/`, `.claude/` or `.corpus/` is created or modified by the check. Only `skill rollback` writes, and it writes **through the server**, never directly. Nothing in this issue touches this repository's `.githooks/` — that hook is the *workspace's*, and it belongs to agent-runtime.

---

### CLI-005: `corpus workspace upgrade`

Ports `9110`–`9114`, primary `9112`. Scratch `/tmp/corpus-s013-cli005-*`. **P1, opus. 25 criteria.**
**Stage B** for fleet-cap reasons only — its dependencies (CLI-002, AGENT-001) are already `done`.

TEST-116: The manifest baseline already exists and is not re-invented
  Given: `corpus init` today writes `.corpus/template-manifest.json` as `{version: 1, tool, installedAt, files: [{path, sha256, source?}]}` (`scaffold.ts:158-187, 337-377`)
  When: Reading this issue's diff
  Then: AC1 is verified as **already satisfied**, not reimplemented. Any change to the manifest shape is additive and stated. The manifest is written with 2-space JSON and a trailing newline; keep that.

TEST-117: The three-way decision matrix is a pure function with full-cell coverage
  Given: A colocated unit test
  When: It exercises every cell of (template-changed × workspace-modified × present/absent)
  Then: unmodified + template-changed → **update**; workspace-modified + template-changed → **keep, report with a one-line diff summary**; workspace-modified + template-unchanged → **silent keep, not even reported**; deleted from workspace → **report, do not reinstall** (unless `--restore`); new-in-template → **install**; in-manifest but dropped from template → **report as "retired", leave the workspace copy, drop from the new manifest**.

TEST-118: Only the (template-changed ∧ workspace-unmodified) cell overwrites
  Given: A workspace with one untouched skill and one edited skill, both changed in the template
  When: `corpus workspace upgrade`
  Then: The untouched one is overwritten; the edited one is byte-identical to before and is reported. Skills are the workspace's memory (§2.1) — clobbering one is the failure this verb exists to prevent.

TEST-119: Plugin-sourced entries are refreshed from the plugin (Adjudication 11)
  Given: A manifest entry `{path: ".claude/skills/<x>/SKILL.md", sha256, source: "plugin:_fixture"}`
  When: `corpus workspace upgrade` runs after the plugin's copy changed
  Then: The new bytes come from **the plugin's `skills/` directory**, not from `assets/workspace/`; a template-sourced entry (absent `source`) is refreshed from the template. Both provenances are exercised in one run and the log shows which source each file came from.

TEST-120: Pairing uses the rename table, never a directory scan
  Given: `INSTALL_RENAMES = [{template: "claude/", installed: ".claude/"}, {template: "gitignore", installed: ".gitignore"}]` (`template.ts:32-35`) and `INSTALL_FILTERS = [".gitkeep"]`
  When: Comparing template files to workspace files
  Then: Hashing happens **after** the rename mapping, so `claude/skills/comment/SKILL.md` pairs with `.claude/skills/comment/SKILL.md`. `.gitkeep` is never installed and never compared. Correct on a case-insensitive filesystem.

TEST-121: The upgrade touches only template-provenance files
  Given: A workspace with real documents under `data/` and runtime state under `.corpus/`
  When: `corpus workspace upgrade` runs
  Then: `git -C "$WS" show --stat HEAD` lists only `.claude/**`, the workspace `README.md`/`.gitignore`, and `.corpus/template-manifest.json`. **Zero** paths under `data/`, and nothing under `.corpus/` except the manifest.

TEST-122: All changes land as one attributed commit naming old → new version
  Given: An upgrade with two file changes
  When: `git -C "$WS" log -1 --format='%an <%ae>%n%s%n%b'`
  Then: **One** commit, authored per the acting party, with a structured subject naming the old and new tool versions. The manifest update is in the **same** commit.

TEST-123: A no-op upgrade says so and makes no commit
  Given: A workspace already current
  When: `corpus workspace upgrade; echo $?`
  Then: Prints "already up to date", exit `0`, and `git -C "$WS" rev-parse HEAD` is unchanged. An empty commit is a fail.

TEST-124: `--dry-run` writes nothing
  Given: A workspace with pending changes in three categories
  When: `corpus workspace upgrade --dry-run`
  Then: The full plan prints — update / keep-modified / install / restore-candidate / retired — and `git -C "$WS" status --porcelain` plus every file's mtime are unchanged. Then the same run without `--dry-run` performs exactly the printed plan.

TEST-125: `--restore` reinstalls deleted files, and only with the flag
  Given: A workspace where a template-installed skill was deleted
  When: `corpus workspace upgrade` then `corpus workspace upgrade --restore`
  Then: The first reports it and does not reinstall; the second reinstalls it and records it in the new manifest.

TEST-126: A pre-manifest workspace is handled conservatively, and `--adopt` writes a baseline
  Given: A workspace with `.corpus/template-manifest.json` removed
  When: `corpus workspace upgrade` then `corpus workspace upgrade --adopt`
  Then: The first treats **every** current template file as modified — reports everything, **overwrites nothing**, makes no commit; the second writes a fresh baseline manifest. Nothing is lost either way.

TEST-127: An interrupted upgrade loses nothing
  Given: A simulated failure between the writes and the commit
  When: Inspecting the workspace
  Then: The partial state is reported **loudly** and the changed files are visible in `git -C "$WS" status`. Files are the source of truth; a failed commit never rolls back a write.

TEST-128: It works with the server stopped
  Given: No server running for `$WS`
  When: `corpus workspace upgrade`
  Then: It succeeds. This is a bootstrap-class operation (§2.2 rule 4) that writes files directly and commits directly, exactly like `corpus init`.

TEST-129: With the server running, the watcher re-projects
  Given: The server up on `9112` and an SSE stream open
  When: The upgrade changes a skill
  Then: An `invalidate` frame arrives, and `GET /api/docs?type=skill` returns the new content. The upgrade's writes are out-of-band edits from the server's point of view (§2.2 rule 1) — it does **not** route them through the API.

TEST-130: The install logic is factored, not duplicated a third time
  Given: `INSTALL_RENAMES` is already duplicated in `apps/cli/src/commands/init/template.ts` **and** `scripts/workspace-template.ts` (pinned equal by a test, for the documented reason that `scripts/` ships in no tarball)
  When: Reading this issue's diff
  Then: `init` and `upgrade` share **one** implementation inside `apps/cli` (the issue's `apps/cli/src/template/` factoring, or an equivalent). The count of rename-table definitions does not go from two to three.

TEST-131: `docs/workspace-template.md` gains the upgrade semantics
  Given: The doc already documents the manifest and mentions upgrade three times without specifying it
  When: Reading the new section
  Then: The three-way rules, the flags, the plugin-source refresh, and the retired-entry rule are documented, and `apps/cli/src/commands/init/template.test.ts`'s "three implementations agree" assertion still passes.

TEST-132: The `workspace` topic is registered and documented
  Given: No `apps/cli/src/commands/workspace/` exists today
  When: The topic lands
  Then: `workspace` appears in `registry.topics`, `validateRegistry` passes, `corpus workspace --help` and `corpus workspace upgrade --help` render from the registry, and `docs/cli.md` regenerates with `### \`corpus workspace upgrade\`` plus a TOC entry.

TEST-133: The verb is a documented write exception, and says so
  Given: §2.2 rule 4 lists `corpus init` and `corpus workspace upgrade` as the two bootstrap-class exceptions
  When: Reading the verb's `description`
  Then: It states that this command writes files directly and commits directly, and why. Every other doc-mutating verb goes through the server; a reader must not conclude the rule is soft.

TEST-134: Unit tests cover the matrix and the filesystem behaviour
  Given: `VITEST_MAX_THREADS=4 vitest run apps/cli/src/commands/workspace apps/cli/src/template`
  When: They run
  Then: Green, covering: manifest write/read round-trip, all decision-matrix cells as a pure function, rename-table pairing, no-manifest conservative mode, plugin-source refresh, and temp-workspace filesystem tests using the `/tmp/corpus-s013-cli005-` prefix.

TEST-135: E2E follows the issue's five steps, both server states
  Given: A real scratch workspace
  When: Running the issue's E2E plan (init → simulate a tool update → dry-run → run → modify-and-collide → re-run → no-op → with the server running)
  Then: Every step's exact command and output is in the log, including `git -C "$WS" log --oneline` after each commit-producing step, and `git -C <repo> status` clean at the end.

TEST-136: The upgrade never bypasses `corpus skill rollback`'s recovery path
  Given: §2.1 — "so `corpus skill rollback` covers a bad upgrade like any other skill change"
  When: An upgrade overwrites a skill and is then rolled back (CLI-006's verb, if landed)
  Then: The rollback restores the pre-upgrade content. If CLI-006 has not landed at verification time, this is `DEFERRED → CLI-006` with the single-commit evidence (TEST-122) supplied as the substitute, since one commit is what makes the revert targetable.

---

### CONTRACT-015: Graduate plugin-facing types into `@corpus/contract`

Ports `9115`–`9119`, primary `9117`. Scratch `/tmp/corpus-s013-contract015-*`. **P1, opus. 22 criteria.**
**Stage B**, contract domain. Blocks PLUGINS-002.

TEST-137: The graduated types live on a subpath, not the root barrel
  Given: `packages/contract/src/index.ts` is five `export *` lines and deliberately excludes `client/`; `@corpus/kit` already publishes `./plugin` as a types-only subpath *"so the manifest contract does not bloat the app-facing kit surface"*
  When: Reading the new module
  Then: A new `packages/contract/src/plugin/` (types only) is published as a **third subpath** `"./plugin"` in the `exports` map, and is **not** re-exported from the root barrel. Precedent followed, not reinvented.

TEST-138: `PluginServerContext` is exported and is the server's implementation type
  Given: `apps/server/src/plugins/context.ts:66-87`
  When: Reading the diff
  Then: The type is defined **once**, in `@corpus/contract`; `apps/server` imports it and annotates `createPluginContext`'s return with it (`satisfies` or an explicit annotation) so drift is a type error **on the server side**. No duplicated shape.

TEST-139: The move drags no server runtime into the contract
  Given: The transitive closure — `Actor`, `CreateDocRequest`, `UpdateDocRequest`, `Doc`, `DocsQuery`, `DocList`, `QueryKeySegment` are already contract types; **`Logger` is not** (`apps/server/src/logger.ts`, whose module also exports `stdoutSink`/`stderrSink` touching `process.stdout`)
  When: Inspecting `packages/contract`'s imports after the change
  Then: `packages/contract` imports **nothing** from `apps/*` (grep proves zero hits, as today) and gains **no** dependency on `better-sqlite3`, `chokidar`, `node:fs`, or `react`. `Logger` is handled by a minimal contract-side declaration (or a narrower `PluginLogger`) — with the choice and reason recorded.

TEST-140: Server-only companions stay in `apps/server`
  Given: `PluginContextDeps` references `DocsWorkspace`, whose members include `ProjectionDb` (first field `readonly sqlite: Database.Database` — the better-sqlite3 leak), `AutoCommitter`, `SelfWriteRegistry`, `InvalidationBus`
  When: Reading the diff
  Then: `PluginContextDeps`, `DocsWorkspace`, `DocumentMutex`, `createPluginContext` and `PluginRoutesFactory` all remain in `apps/server`. Moving any of them is out of scope and would be the naive-move failure.

TEST-141: Hono is not dragged onto the contract's plugin surface
  Given: `PluginRoutesFactory` (`plugins/discover.ts:49`) is `(context: PluginServerContext) => unknown` with a runtime duck-type — a deliberate loosening
  When: Reading the diff
  Then: It stays that way, or the decision to graduate it is recorded with its reason. `packages/contract` already depends on `hono`, so this is a design choice about the plugin surface's browser-friendliness, not a new dependency — and `query-keys.ts`'s "Zod-free on purpose" note is the standard the plugin surface should meet.

TEST-142: The pure-data registry types graduate
  Given: `CommandSpec`, `FlagSpec`, `ArgSpec`, `Example`, `TopicSpec`, `Registry` (`apps/cli/src/registry/types.ts`) are pure data
  When: Reading the diff
  Then: They are defined once in `@corpus/contract` and `apps/cli` implements them (no duplicated shapes). The docblock at `types.ts:105-109` — *"Plugin-contributed verbs register through the same shapes, so nothing may assume a closed set"* — is preserved.

TEST-143: `CommandContext` is graduated as a **narrowed** interface, not verbatim
  Given: Three hard blockers — `ParsedArgs`/`ParsedFlags` are classes with `#private` fields (**nominally typed**: no structural type can satisfy them), `Workspace`'s module reads `node:fs`, and `CliClient` is bound to `@corpus/contract/client`, which the plugin lint rule exists to forbid
  When: Reading the graduated type
  Then: It is a narrow, structural, plugin-facing interface — the shape `plugins/_fixture/cli/commands/add.ts:17-22` already discovered by hand (`args: {get(name): string}`, a two-field `workspace`, a two-method `out`) — and **`apps/cli`'s concrete `WorkspaceCommandContext` satisfies it**. Copying the classes into the contract, or shipping runtime code there, is a fail. **Open Conflict 13.**

TEST-144: `plugins/_fixture` deletes both hand-maintained duplicates
  Given: `FixtureServerContext` (`server/routes.ts:31-38`) and `FixtureCommandContext` (`cli/commands/add.ts:17-22`), the latter with the docblock naming this exact open question
  When: Reading the diff
  Then: Both local interfaces are gone; `server/routes.ts` types its parameter as the imported `PluginServerContext`, and `cli/commands/add.ts` types its handler's context from the imported command type and its default export with `satisfies` (it is an untyped object literal today).

TEST-145: The eslint plugin allowlist is widened **narrowly**
  Given: `eslint.config.js:73-80` negates `"!@corpus/kit"`, `"!@corpus/kit/**"`, `"!@corpus/contract"` — with **no `/**` sibling for contract**, because the rule exists to ban `@corpus/contract/client`
  When: The new subpath ships
  Then: A **targeted** `"!@corpus/contract/plugin"` negation is added. A blanket `"!@corpus/contract/**"` re-opens the `/client` hole and is a fail. **Open Conflict 12.**

TEST-146: The boundary rules still demonstrably fire
  Given: `scripts/eslint-boundaries.test.ts`, which writes real probe files and lints them programmatically — *"a rule that was never seen to fire is a rule that may not exist"*
  When: It runs after the allowlist change
  Then: Green, **and extended**: a probe importing `@corpus/contract/plugin` from `plugins/**` is **allowed**; a probe importing `@corpus/contract/client` from `plugins/**` is still **rejected**; a probe importing `apps/cli/src/...` from `plugins/**` is still rejected.

TEST-147: `PluginManifest` stays in the kit
  Given: `packages/kit/src/plugin/types.ts:106-123`, whose members are React-bound (`ComponentType<...>`, and `ListItemProps = RowProps` from a kit component)
  When: Reading the diff
  Then: It is untouched and stays in kit. `packages/contract` gains no `react` dependency.

TEST-148: No runtime code moves
  Given: The issue's AC — "No runtime code moves"
  When: Reading the diff
  Then: `packages/contract/src/plugin/**` contains type declarations and (at most) `as const` name constants. Every implementation — `createPluginContext`, `validateRegistry`, the dispatcher, the CLI's error classes — stays where it is.

TEST-149: Generated artifacts are unchanged or regenerated idempotently
  Given: `openapi.json`, `schema.generated.ts` and `docs/cli.md`
  When: `npm run generate -w packages/contract` and `npm run docs:cli -w apps/cli` run twice from a clean tree
  Then: Byte-identical both times. A types-only subpath is not OpenAPI surface, so the expected outcome is **no diff at all** in the two contract artifacts. Any diff is explained.

TEST-150: Typecheck passes in every consumer
  Given: The change
  When: `npm run typecheck -w packages/contract`, `-w apps/server`, `-w apps/cli`, `-w packages/kit`, `-w apps/ui`, and the plugin build
  Then: All exit 0. The point of this issue is that drift becomes a type error; a green typecheck across all five is the proof the implementing side is actually annotated.

TEST-151: The fixture plugin still works at runtime
  Given: A real workspace + server on `9117`
  When: `curl -sS :9117/api/x/_fixture/notes` and `corpus _fixture add "Try the fixture"` (dev layout, where `_fixture` is discoverable)
  Then: The route responds, the CLI verb round-trips, the document lands through the core write path (file on disk, commit, projection row), and SSE invalidation fires. Retyping must not break the one plugin that exists.

TEST-152: The contract's invariant suites stay green
  Given: `openapi.test.ts`, `request-body-required.test.ts`, `request-defaults.test.ts`, `index.test.ts`, `inventory.test.ts`, `routes/index.test.ts`
  When: `VITEST_MAX_THREADS=4 vitest run packages/contract`
  Then: Green and **unweakened** — no invariant is relaxed to accommodate the new subpath.

TEST-153: Scope discipline
  Given: `git diff --stat`
  When: Inspecting it
  Then: Changes are confined to `packages/contract/**`, the **annotation-only** edits in `apps/server/src/plugins/context.ts` and `apps/cli/src/registry/types.ts`, `plugins/_fixture/**`, `eslint.config.js`, and `scripts/eslint-boundaries.test.ts`. Zero behavioural changes in `apps/ui`, `packages/kit`, or any server/CLI logic. No route added, renamed, or removed.

TEST-154: The eslint config change is the minimum
  Given: `eslint.config.js` is a single ~48-line root config with three plugin-boundary blocks
  When: Reading the diff
  Then: Exactly one negation string is added. The core→plugin ban (rule B) and the three-path discovery carve-out (rule C) are untouched.

TEST-155: The `_fixture` docblocks are updated, not orphaned
  Given: Both fixture docblocks currently explain *why* the types are local and name the open question
  When: Reading them after
  Then: They state that the types now come from `@corpus/contract/plugin`. A stale comment claiming a forbidden import is the kind of drift the pr-reviewer's interface-docs dimension exists to catch.

TEST-156: PLUGINS-002 is unblocked, provably
  Given: The issue blocks PLUGINS-002
  When: Writing a throwaway probe file under `plugins/` that imports the graduated types and declares a fully-typed `routes.ts` factory and a `CommandSpec`-shaped command
  Then: It typechecks and lints clean, and is deleted after. The claim "a typed plugin can now be written" is demonstrated, not asserted.

TEST-157: The naming question is settled once
  Given: `@corpus/kit/plugin` already exists as a subpath name
  When: Choosing the contract's subpath name
  Then: `@corpus/contract/plugin` — parallel to the kit's, so a plugin author reads two symmetric imports. If a different name is chosen, the reason is recorded.

TEST-158: E2E log states the model
  Given: The completion checklist
  When: Reading the log
  Then: `implemented on: opus` (or the actual model), per INFRA-006.

---

## Cross-Issue Tests

TEST-159: The CLI registry survives three concurrent additions
  Given: CLI-010 adds `doc show` + `thread show`; CLI-006 adds `doc check` + a `skill` topic; CLI-005 adds a `workspace` topic — **all three edit `apps/cli/src/registry/index.ts` and regenerate `docs/cli.md`**
  When: All three have landed
  Then: `registry` validates at module load with all six verbs; `docs/cli.md` regenerates once, cleanly, containing all six; the TOC is complete; `check-generated-artifacts.ts` is green against HEAD. **The merge order below exists for this test.**

TEST-160: The validator has exactly one implementation, reachable two ways
  Given: SERVER-019's handler and `validateBeforeWrite`
  When: Grepping for `checkCorpus` callers in `apps/server/src`
  Then: Exactly two production call sites, both passing the same two seams; zero re-implementations; zero copies of the thirteen codes outside `core/check.ts` and the contract's enum (which the TEST-27 guard pins together).

TEST-161: `corpus doc check` and the server agree, byte for byte
  Given: Both landed
  When: `corpus doc check <id> --json` and `curl -X POST :9107/api/check -d '{"ids":["<id>"]}'`
  Then: Identical payloads. The CLI is a thin client; any difference is the CLI reshaping something it must not.

TEST-162: The packaged tool carries the wave-2 verbs
  Given: INFRA-008's tarball built after CLI-006/CLI-010/CLI-005 land (or rebuilt at harvest)
  When: `corpus --help` from the installed binary
  Then: `doc check`, `doc show`, `thread show`, `skill rollback` and `workspace upgrade` all appear, and `_fixture` does not (Adjudication 9). If INFRA-008 packs before stage B lands, the log records which verbs its tarball predates and the orchestrator re-verifies at harvest.

TEST-163: The workspace template's promise is now true end to end
  Given: The orchestrate skill names `corpus skill rollback` in its loop-safety section, and `CLI_COMMANDS_PENDING_CLI_006` is empty
  When: The template tree's CLI-reference test runs against the regenerated `docs/cli.md`
  Then: Green with **no allowlist**. Adjudication 5's self-invalidating hole has closed itself, as designed.

TEST-164: The three-way install contract still agrees
  Given: `apps/cli/src/commands/init/template.test.ts` asserts `scripts/`, `apps/cli/`, and `docs/workspace-template.md` agree; CLI-005 edits two of the three and INFRA-008 changes where the template physically lives
  When: Both have landed
  Then: The agreement test is green, `INIT_GENERATED` still accounts for exactly what `corpus init` creates, and `scripts/workspace-template.test.ts`'s 13-test install-contract suite passes.

TEST-165: Nothing is a second implementation of anything
  Given: The whole batch
  When: Auditing
  Then: One validator (TEST-160); one rename table pair, not three (TEST-130); one `PluginServerContext` and one `CommandSpec` (TEST-138, TEST-142); one exit-code table (`errors.ts`, rendered into `docs/cli.md`); one git helper for the CLI's read-only plumbing, not one per verb.

TEST-166: The harvest gate is green, once
  Given: All six issues landed
  When: The orchestrator runs `npm run build` → `/lint` → `/test` → `npm run coverage` → `npm run e2e` → `check-generated-artifacts.ts`
  Then: All green, coverage ≥ 90% on all four metrics, `CORPUS_UI_PORT` set away from 5173/5174, and **8765 unbound** for the e2e run.

TEST-167: No stray processes or scratch leakage
  Given: The end of the sprint
  When: Checking
  Then: Nothing bound in `9090`–`9129`; `8765` free; `5283`/`5284` free; `5173`/`5174` still only the `ssh` process; no orphaned vitest, Vite, Playwright or node children; `git -C <repo> status` clean; `git worktree list` shows no leftovers; every scratch directory each agent created was deleted **by captured path**, and the 46 pre-existing `/tmp/corpus-*` directories are untouched.

---

## Out of Scope

- **CONTRACT-013.** Already shipped on `HEAD` via PR #10 (`e6ce966`). Only `issues/PLAN.md:116` needs
  flipping to `done`. **Open Conflict 1** — do not spawn an agent for it.
- **AGENT-003 (the comment skill).** It is what CLI-006 and CLI-010 unblock; it is next, not now. In
  particular, the ruling on whether the agent may read `data/` markdown directly (Adjudication 21's
  "document *content* from `data/`; thread/queue/lock *state* through the CLI") is settled in
  **AGENT-003's text**, not in CLI-010's.
- **The workspace-side pre-commit hook that gates on exit 6.** Agent-runtime domain, after
  `doc check` exists. **Nothing in this sprint touches this repo's `.githooks/` except INFRA-008's
  `version:check` line and the exit-epilogue fix of Open Conflict 7** — this repository is not a
  workspace.
- **A third request branch on `POST /api/check`.** Adjudication 22 is binding: whole-workspace check
  is enumerate-then-post. `packages/contract` is not amended by SERVER-019 or CLI-006.
- **`corpus doc list` / `corpus thread list`.** CLI-010 ships `show` only. Lists go through
  `GET /api/docs` and are the board's job (§9.2 says so on `getThread`'s own description).
- **Read-state on `GET /api/threads/{id}`.** If `thread show` should print unread state, that is a
  **contract change** and belongs in a filed issue, not in CLI-010. **Open Conflict 10.**
- **An actual npm publish.** No credentials, no token, no confirmed package name. INFRA-008 builds and
  proves the machinery; the user pulls the trigger. **Open Conflicts 5 and 6.**
- **A self-contained binary.** CLAUDE.md Decision 6 — npm-installed CLI for v1, binary later.
- **PLUGINS-002 (todos).** CONTRACT-015 unblocks it; it does not implement it. `plugins/_fixture`
  stays a throwaway and is never packaged.
- **Graduating `PluginRoutesFactory`, `PluginContextDeps`, `DocsWorkspace`, `DocumentMutex`, or the
  CLI's error classes** into `@corpus/contract`. TEST-140/141.
- **Widening `SkillNameSchema` to admit nested skills.** Named as a limitation, not fixed.
- **`corpus skill archive|list|show`.** `rollback` is the only skill verb this phase; archiving a
  skill is already `corpus doc archive` (§7).
- **Rewriting the e2e suite to drive a real server.** Standing recommendation since sprint-009; still
  not a requirement. If declined again, record why.
- **Any change to `packages/contract` by the server, cli or infra agents**, and any change to
  `apps/ui`/`apps/server`/`apps/cli` **logic** by the contract agent (CONTRACT-015's annotation-only
  edits in two files are the explicit, bounded exception — TEST-153).
- **SERVER-029, UI-013, CONTRACT-014, CLI-009, UI-012, INFRA-009, AGENT-004, SERVER-030, UI-014.**
  All `todo`, none in this batch.

---

## Integration Points

**CONTRACT-008 (shipped) → SERVER-019 → CLI-006.** The batch's one real serialization.

```
POST /api/check
  request   {ids: string[]} XOR {documents: [{path, content}]}   ← z.union of two strictObjects,
                                                                   rejected by the schema, not the handler
  response  {ok, errors: CheckFinding[], warnings: CheckFinding[]}
  Finding   {code, severity, docId: string|null, path, detail}
  codes     13, order-pinned; warnings are exactly anchor-unresolved + ref-unresolved
  handler   SERVER-019: checkCorpus(docs, {resolveAnchor: resolveAnchorExact,
                                           documentExists: (id) => isIdTaken(projection, id)})
            — NO LOCAL_CHECK_CODES filter, NO throw, `ok` derived
  caller    CLI-006: ids | --staged pairs | whole-workspace (paginate GET /api/docs,
            includeArchived=true, then post {ids})
            errors → exit 6, warnings → exit 0, --json emits the response unchanged

POST /api/skills/{name}/rollback
  params    {name} matching ^[a-z0-9]+(?:-[a-z0-9]+)*$   ← forbids nested skills
  headers   x-corpus-author (ActorHeaderSchema, default "user")
  body      OPTIONAL, {to?: string | null}
  response  {name, docId, commit, path, warnings}   ← commit is the NEW head
  404       unknown or archived skill (NotFoundErrorSchema)
  handler   SERVER-019: resolve ref → read blob → MutationPlan{write} → runMutation,
            inside AutoCommitter.withGitLock
  caller    CLI-006: prints commit + path; unknown skill → "no skill named <name>", EXIT 5
```

**Three CLI issues collide on two files. This is the batch's file hazard.**

```
apps/cli/src/registry/index.ts    CLI-010 (doc/thread verbs) · CLI-006 (doc verb + `skill` topic)
                                  · CLI-005 (`workspace` topic)   — all three append
docs/cli.md                       generated; all three regenerate it; drift-checked against HEAD
apps/cli/src/commands/doc/index.ts  CLI-010 adds `show`, CLI-006 adds `check` — same array
apps/cli/src/commands/hygiene.test.ts  CLI-006 must amend its pinned 12-module list (TEST-110);
                                  CLI-010 must NOT need to (TEST-44)
```

Consequence: **CLI-010 lands in stage A precisely so stage B rebases onto it.** Within stage B,
CLI-006 and CLI-005 run in parallel worktrees and **will** conflict on `registry/index.ts` and
`docs/cli.md`. The rule: each agent edits only its own topic's registration line and regenerates
`docs/cli.md` in its own worktree; the orchestrator resolves the registry conflict at harvest by
taking both additions and running `npm run docs:cli -w apps/cli` **once** on the merged tree. Neither
agent hand-edits `docs/cli.md`, ever.

**CLI-006 must edit an AGENT-002-owned file.**

```
scripts/workspace-template.ts:235       CLI_COMMANDS_PENDING_CLI_006 → []
scripts/workspace-template.test.ts:746  toEqual(["doc check","skill rollback"]) → toEqual([])
```

Sprint-012's Integration Points assigned `scripts/workspace-template.{ts,test.ts}` to AGENT-002
exclusively. AGENT-002 is `done` and no agent-runtime issue is in this batch, so the file has no
current owner — but the rule was written down and must be released deliberately, not assumed.
**Open Conflict 14.**

**CONTRACT-015 touches two files that CLI-006 and CLI-005 also touch.**

```
apps/cli/src/registry/types.ts    CONTRACT-015 re-points CommandSpec et al. at @corpus/contract
                                  (annotation-only). CLI-005/CLI-006 add commands typed BY those
                                  types but do not edit this file.
eslint.config.js                  CONTRACT-015 only. One negation string.
plugins/_fixture/**               CONTRACT-015 only.
```

Low risk, but it means **CONTRACT-015 should land before or after the CLI pair, not interleaved
mid-review** — a registry type change landing between two command additions makes the diff hard to
read for the pr-reviewer.

**INFRA-008 consumes everything and is consumed by nothing.**

```
assets/workspace/**       staged into the package  → resolveTemplateRoot's packaged candidate
apps/ui/dist/**           staged into the package  → resolveUiDistDir's packaged candidate
apps/server (built)       staged into the package  → serverEntryCandidates' packaged candidate
plugins/<non-_>/dist/**   staged into the package  → resolvePluginsRoot's packaged candidate
                                                     (no subject exists yet — TEST-64)
```

It must not change the behaviour of any of the four resolvers in the **dev** layout — every other
agent, and every test in the repo, runs in the dev layout. Adding the packaged artifacts is additive;
reordering a candidate list is not.

**Everything else is disjoint.** SERVER-019 touches only `apps/server`. CONTRACT-015 touches
`packages/contract` plus four annotation-only/lint files. All six can run in worktrees.

---

## Merge order (recommendation)

1. **Adjudicate Open Conflicts 1, 2, 3, 4, 5, 8, 10 and 13 before anyone starts.** 2/3/4 shape
   SERVER-019's handler and are not discoverable cheaply mid-implementation. 8 decides whether
   CLI-006 is buildable as specified at all. 5 decides whether INFRA-008's README can be written. 10
   and 13 correct issue-file text an agent would otherwise implement literally. 1 removes an issue
   from the batch.
2. **Stage A, staggered, three agents**: **SERVER-019** first (it unblocks CLI-006 and is the
   smallest genuinely-blocking piece), then **CLI-010** (it lands the registry/docs churn stage B
   rebases onto), then **INFRA-008** (the largest, the most independent, and the one with the most
   deferred verification — start it early so its Open Conflicts surface early).
3. **Harvest stage A and commit** before stage B starts. CLI-006's dependency on SERVER-019 is a real
   runtime dependency: its E2E requires the handlers to be *served*, not merely written.
4. **Stage B, three agents**: **CLI-006** (needs SERVER-019 on the branch), **CLI-005** (independent),
   **CONTRACT-015** (independent). CLI-006 and CLI-005 collide on `registry/index.ts` and
   `docs/cli.md` — resolve at harvest by regenerating once, per Integration Points.
5. **`docs/cli.md` is regenerated exactly once per harvest**, on the merged tree, by the orchestrator.
   Four issues in this batch change the CLI surface; four independent regenerations produce four
   stale artifacts.
6. **INFRA-008's tarball is re-packed and re-verified at final harvest** if it was built before stage
   B landed (TEST-162).
7. **Harvest gate last, once**: build → lint → format → typecheck → test → coverage → e2e → artifact
   drift.

The genuinely serialized edges are: SERVER-019 → CLI-006 (runtime), CLI-010 → CLI-006/CLI-005
(registry churn), and Open Conflict 8 → CLI-006's design. Everything else is parallel.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. CONTRACT-013 is already shipped (**blocking the batch definition, trivial to resolve**)

`issues/contract/013-thread-upload-exports-form-label.md` reads `## Status: done`, all ACs are
`[x]`, and the E2E log is complete. Its code is on `HEAD`: `packages/contract/src/client/index.ts:46`
exports `uploadCreateThread`, `packages/contract/src/schemas/form.ts:86` defines
`FORM_ANSWER_LABEL`, and `apps/server/src/threads/forms.ts:37` imports it. The pre-squash commit
`d938919` exists only on the remote `phase-3-ui` branch, but the work reached `main` through PR #10's
squash `e6ce966`, which is an ancestor of this branch. Even the ui-dev follow-up the log flagged (the
duplicate `FORM_ANSWER_LABEL` in `apps/ui/src/thread/parseFormBlock.ts`) is gone — grep finds zero
definitions in `apps/ui`.

Only `issues/PLAN.md:116` still says `todo`.

**Options**: (a) strike CONTRACT-013 from sprint-013, flip `issues/PLAN.md:116` to `done` as
bookkeeping. (b) Something remains that I could not find.

**Recommendation: (a).** Spawning an agent for it burns a stage-B slot on a no-op and risks an agent
"fixing" already-correct code. Note this also removes the "CONTRACT-013 + CONTRACT-015 share one
agent session sequentially" plan — CONTRACT-015 runs alone.

### 2. Does `POST /api/check` apply the write path's skill-frontmatter leniency? (**blocking SERVER-019, and blocking CLI-006's usefulness**)

`validateBeforeWrite` does not block on `frontmatter-invalid` for documents under the skill/agent-def
roots: `const lenientFrontmatter = classifyPath(path)?.synthesizeId === true` (`write.ts:236`). The
reason is stated at `write.ts:231-235`: a hand-written `SKILL.md` carries Claude Code's
`name`/`description` and **no Corpus frontmatter at all**, which is why the projection synthesizes an
id for it; demanding §5's canonical block there would make archiving one impossible.

`corpus doc check` runs over the whole workspace, which **includes every skill and agent-def**
(§7, and TEST-92). If `/api/check` does not apply the same leniency, then in a freshly `corpus init`-ed
workspace `corpus doc check` reports `frontmatter-invalid` for every skill, `ok: false`, exit 6 — and
the workspace-side pre-commit hook that agent-runtime is about to build on exit 6 blocks every commit
in every workspace. If it *does* apply the leniency, then §14's "`corpus doc check` exposes the same
validator on demand over the whole workspace" is true in a slightly different sense than §7's "`corpus
doc check` validates both sets [Claude Code's and Corpus's frontmatter]".

Note the shipped template's two skills (`orchestrate`, `comment`) **do** carry full Corpus frontmatter
(AGENT-001 pinned that shape), so a pristine workspace may be clean either way — but any skill the
agent writes by hand, or any skill a plugin ships, may not be.

**Options**: (a) `/api/check` applies the same `synthesizeId ⇒ frontmatter-invalid is not an error`
leniency; skills are checked structurally, not for §5's canonical block. (b) No leniency —
`/api/check` is strict, and §7's "skills are documents" means they must carry Corpus frontmatter;
`corpus doc check` is how you find out they don't. (c) Leniency by default, `--strict` to disable.

**Recommendation: (a)**, with the leniency implemented in **one** named place shared by both call
sites (a predicate, not a copied condition), and a test asserting a hand-written `SKILL.md` with only
`name`/`description` yields `ok: true`. It preserves the "same validator" promise, keeps a fresh
workspace committable, and matches the write path — which is the behaviour §14 actually names. If the
user prefers (b), AGENT-001's template must be re-verified and the workspace hook's exit-6 gate needs
a carve-out, which is a bigger change than it looks.

### 3. Which seams does `/api/check` inject, and what does that mean for the `{documents}` branch? (**blocking SERVER-019**)

The write path injects both `resolveAnchor` and `documentExists`. For `/api/check`:

- **`resolveAnchor`** must be injected, or `anchor-unresolved` warnings are never produced and §14's
  orphaned-thread reporting silently disappears from `corpus doc check`.
- **`documentExists`** is subtler. `CheckOptions`' own docblock says *"`corpus doc check` hands the
  checker the whole workspace and needs none of this"* — because when the whole corpus is in the set,
  a `[[ref]]`'s target is either in the set or genuinely missing. But CLI-006's `--staged` branch
  hands it **a handful of files**, and every `[[ref]]` in them pointing at an unchanged document would
  warn `ref-unresolved` unless the projection seam is supplied.

**Options**: (a) Always inject both. The `documentExists` seam is a superset check — an id in the set
*or* in the projection counts — so it is correct for both branches and strictly better for
`--staged`. (b) Inject `documentExists` only for the `{documents}` branch. (c) Never inject
`documentExists` for `/api/check`, and accept spurious `ref-unresolved` warnings on `--staged` (they
are warnings, exit 0, so the hook still passes).

**Recommendation: (a).** One code path, no branch-dependent behaviour, and it makes `--staged`'s
warnings truthful. (c) is defensible because these are warnings — but a pre-commit hook that prints
five false warnings on every commit gets ignored, and then the real one is ignored too.

### 4. There is no rollback API, and `SkillRollbackResult.commit` is unsatisfiable in one real case (**blocking SERVER-019**)

Two distinct gaps.

**(i) No targeted-revert primitive exists.** `git grep` over `apps/server/src` finds no `checkout`, no
`revert`, no `restore`. The only blob-reading helper is `readHeadVersion`
(`watcher/git-head.ts:42-61`), which is **pinned to `HEAD`**, uses blocking `execFileSync`, has a 5 s
timeout, and returns `null` on any failure. It is not parameterised by ref.

**(ii) The response schema cannot describe a failed commit.** `SkillRollbackResultSchema.commit` is
`z.string().regex(/^[0-9a-f]{7,64}$/)` — **required**. But `CommitOutcome` carries a sha only for
`committed`/`amended`; `skipped` and `failed` carry none. §14 is explicit that a failing workspace git
hook must **not** roll back the file write — the mutation stands and the failure surfaces as a
**warning on the API response**. `SkillRollbackResult` has a `warnings` field for exactly that
(`commit_failed | commit_skipped`), so the intended path is `200` + warning — but then there is no
legal value for `commit`.

**Options for (i)**: (a) Generalise `readHeadVersion` into a ref-parameterised
`readVersionAt(workspaceRoot, ref, relativePath)` using the async `Git.exec(["show", \`${ref}:./${path}\`])`
inside `withGitLock`, and leave `readHeadVersion` as a thin caller. (b) Add a one-off helper in the
skills handler. (c) Add a general `git/restore.ts` module.

**Options for (ii)**: (x) Amend `SkillRollbackResultSchema` to make `commit` nullable — a
**contract change**, which sprint-012 Adjudication 2 and this sprint's Out of Scope both forbid to
SERVER-019, so it would need a CONTRACT rider issue. (y) Return the pre-existing `HEAD` sha when the
commit was skipped/failed, with the warning explaining — satisfies the regex, but the field's own
description says it is "the new HEAD", which would then be a lie. (z) Treat a failed commit as a 5xx
— contradicts §14 ("the server never rolls back a file write because a commit failed") and the route
declares no 500.

**Recommendation: (i)(a) and (ii) a CONTRACT rider making `commit` nullable**, filed now and landed
before or with SERVER-019. (y) is the tempting shortcut and it puts a false value in an audit field.
If the rider is judged too expensive this phase, (y) is acceptable **only** if the description is
amended in the same change — but that is also a contract edit, so the rider is cheaper. Also settle
**TEST-24**: what a rollback of a single-commit skill returns.

### 5. The npm package name `corpus` is taken (**blocking INFRA-008's README and manifest**)

```
$ npm view corpus
corpus@0.0.1 | Proprietary | deps: 2 | versions: 1
Corpus.js is a Javascript framework for large client side web applications.
published over a year ago     maintainers: lancecarlson <lancecarlson@gmail.com>

$ npm view corpus-cli version
0.1.0
```

`corpus` is squatted by an abandoned 2011-era jQuery/underscore framework; `corpus-cli` is also taken.
The issue file's edge case anticipated this — *"If `corpus` is taken on the registry, fall back to a
scoped name and update the README's install line — check availability early, before the workflow is
written"* — so this is the check, done early. `@trupin/corpus` and `corpusd` returned E404 (available,
subject to scope ownership; `npm whoami` is unauthenticated here so scoped lookups are ambiguous).

Every downstream artifact depends on the answer: the manifest's `name`, `publishConfig`, the release
workflow's publish step, and **the README's install line**, which §15 makes a condition of v1.

**Options**: (a) A scoped name under a user/org scope (`@trupin/corpus`, or a new org). The `bin` stays
`corpus`, so the *operator's* experience is unchanged after install. (b) An unscoped alternative
(`corpusd`, `corpus-app`, …). (c) Contact the squatter / file an npm name dispute — slow, uncertain.
(d) Do not publish in v1; ship install-from-tarball/git only, and defer naming.

**Recommendation: (a)** — a scope you control, decided by the **user**, not by an agent. The `bin`
name is what matters for §2.1's operator loop and it is unaffected. **This is a user decision, not an
orchestrator one**: it commits a public identity. Until it is answered, INFRA-008 should implement
everything with the name read from one constant and mark the README's install line
`DEFERRED → name decision`.

### 6. There are no npm credentials and no `NPM_TOKEN` (**blocking INFRA-008's headline AC**)

```
$ npm whoami
npm error code ENEEDAUTH
$ gh secret list --repo trupin/corpus
(no output)
```

INFRA-008's AC — *"`.github/workflows/release.yml` … publishes to npm with `--provenance`
(`id-token: write` permission, `NODE_AUTH_TOKEN` from a repo secret)"* — and its E2E step 11 (push a
prerelease tag or dry-run publish) cannot be executed by any agent. The repo *is* PUBLIC with MIT,
so the provenance precondition itself holds.

**Options**: (a) Scope the issue's verifiable half to: workflow authored, `actionlint`-clean, version
and tag guards **proven to fire locally**, pack audit green, clean-install E2E green — and mark the
publish `DEFERRED → user provisions NPM_TOKEN`. (b) Ask the user to provision `NPM_TOKEN` and the
name **before** the agent starts, so the full AC is reachable. (c) Let the agent run a real
prerelease publish. **Forbidden** — the issue file itself says "Do not publish a real release without
the user's go-ahead", and an agent has no business creating a public package identity.

**Recommendation: (a), with (b) offered.** (a) delivers everything that is actually about this
repository. If the user wants the AC fully closed this sprint, (b) is the prerequisite and should be
done before stage A launches.

### 7. `.githooks/pre-push` cannot fail (**non-blocking but INFRA-008 walks straight into it**)

The hook uses `set -uo pipefail` (no `-e`), accumulates `fail=1` in its `step()` helper, and then
**ends** — there is no `if [ "$fail" -ne 0 ]; then exit 1; fi` epilogue. `.githooks/pre-commit` has
exactly that epilogue at its lines 27-31. So `pre-push` reports failures and exits 0: it has never
blocked a push. Its header comment also claims it runs "plus … Playwright e2e" and it exports
`CORPUS_UI_PORT` for a step that is not in the file.

INFRA-008 is instructed to add `version:check` to this hook. Adding a check to a hook that cannot
fail is theatre.

**Options**: (a) INFRA-008 fixes the epilogue as part of adding its check (three lines, same file,
same domain). (b) File a separate INFRA issue and have INFRA-008 add its step to the broken hook. (c)
Also add the missing e2e step, or delete the comment and the unused export.

**Recommendation: (a) plus the comment/export half of (c).** It is three lines in a file INFRA-008 is
already editing, in its own domain, and leaving it means the version-singularity gate exists only in
CI. Note the blast radius: **fixing this hook makes pre-push actually block for every developer and
every agent**, which is correct but will surface pre-existing failures — worth knowing before it fires
mid-sprint.

### 8. `corpus doc check --staged` needs git, and the `doc` topic is structurally forbidden from running git (**blocking CLI-006 — the batch's hardest conflict**)

`apps/cli/src/commands/hygiene.test.ts` guards `WRITE_RESTRICTED_TOPICS = ["doc","thread","db"]`
**by path prefix**, with the comment *"nothing is out of scope by being new"*. It:

- pins the guarded module list with an exact `toEqual([...])` of 12 paths (line 132-148) — so a new
  `commands/doc/check.ts` fails immediately;
- forbids importing `node:child_process` / `child_process`;
- forbids `spawn|spawnSync|exec|execSync|execFile|execFileSync` as `\b<name>\s*\(`;
- asserts `expect(module.code).not.toMatch(/\bgit\b/)` on **prose-stripped** code — the bare word
  `git`, in a file under `commands/doc/`, fails;
- requires every server call to go through `client.request(...)`.

CLI-006's design (inherited verbatim from CLI-003) is
`git diff --cached --name-only --diff-filter=ACMR -z` + `git show :<path>`. The guard's own comment
frames this as absolute: these topics "may not touch the filesystem at all" and run "no git command,
state-changing or otherwise".

The guard is right about the *intent* (a `doc` verb must not write documents or move git state) and
wrong about *this* case (`--staged` reads the index and changes nothing, TEST-94). But it was written
deliberately, is load-bearing, and CLI-006's issue file describes the plumbing as if none of this
existed.

**Options**: (a) Put the read-only git plumbing in a **shared module outside the guarded prefixes**
(e.g. `apps/cli/src/staged.ts`, beside the existing `apps/cli/src/git-env.ts`, which lives at the src
root for exactly this "shared" reason), have `commands/doc/check.ts` import it, and add a narrow,
commented exemption to the guard for that one import — keeping every other prohibition intact and
adding a positive assertion that the helper runs **only** read-only git subcommands. (b) Relax the
guard's `\bgit\b` rule to a *state-changing*-git rule (an allowlist of `diff`/`show`/`rev-parse`),
keeping the filesystem and child-process bans. (c) Give `doc check` its own topic (`corpus check`) so
it is outside `WRITE_RESTRICTED_TOPICS` — but SPEC §14 names `corpus doc check` literally, and
AGENT-002's shipped skill and the `CLI_COMMANDS_PENDING_CLI_006` allowlist both spell it `doc check`.
(d) Have the CLI post file paths and let the **server** read the index — impossible: the staged
content is not on disk, and the server is not in the user's git index.

**Recommendation: (a).** It preserves every guarantee the guard was written to give, keeps the verb
name §14 mandates, isolates the one dangerous capability in one reviewable file, and is testable in
both directions (TEST-110/111). (c) contradicts the spec and three shipped artifacts. Whatever is
chosen, the guard's comment must be **rewritten to state the new rule**, not quietly weakened — and
the helper must set `maxBuffer` and `timeout`, which `runGit` does not.

### 9. CLI-010's issue text states the wrong exit code (**trivial, correct before the agent reads it**)

CLI-010's AC: *"errors follow the CLI's standard exit-code mapping (404 → exit 4, etc.)"*. Exit 4 is
`ServerUnreachableError`, raised **only** by `transportError()` on ECONNREFUSED/ENOTFOUND/abort/
timeout (`client.ts:140-164`). Every non-2xx status, 404 included, becomes `ServerResponseError` →
**exit 5** (`client.ts:198-217`). Already stated correctly in shipped prose
(`commands/lock/manage.ts:99`: *"document with no lock answers `404` (exit 5)"*) and in CLI-006's own
summary.

**Options**: (a) Correct the issue file to "404 → exit 5". (b) Change the CLI's exit semantics to map
404 → 4. **Recommendation: (a)** — (b) would break `docs/cli.md`'s published table, every existing
verb, and the meaning of "server unreachable". Orchestrator edits the issue file.

### 10. CLI-010 promises thread fields the endpoint does not return (**blocking CLI-010's scope**)

CLI-010's summary: *"`corpus thread show <id>` → `GET /api/threads/{id}` (turns, events, status,
anchor, `--json`)"* and its rationale cites *"thread context (turns, events, anchors, read-state)"*.

`ThreadSchema` is `{id, title, created, updated, status, tags, parent, anchor, agent, turns}`. There
is **no `events` array** and **no read-state**: `unread`/`lastSeenTs` appear only on
`MarkSeenResultSchema` (the `POST /api/threads/{id}/seen` **response**) and, for lists, on
`GET /api/docs?type=thread` rows via `apps/server/src/docs/needs.ts`.

**Options**: (a) Correct the issue file: `thread show` prints what `ThreadSchema` carries; read-state
and any event history are out of scope, filed separately if AGENT-003 needs them. (b) Have
`thread show` make a second call to obtain read-state — but the only endpoint that returns it is
`POST .../seen`, which **mutates** read state; a read verb that marks the thread seen is a bug, not a
feature. (c) File a contract rider adding `unread`/`lastSeenTs` to `ThreadSchema`, and have CLI-010
wait on it.

**Recommendation: (a) now, (c) filed as a P2 if AGENT-003 genuinely needs it.** (b) is actively
harmful. Note AGENT-003's own AC only requires "the thread's turns, the parent document, and the
anchor quote plus surrounding context" — all of which (a) delivers, via `thread show` + `doc show`.
The word "events" in CLI-010's text most likely means "turns"; confirm rather than implement.

### 11. Adjudication 12's packaging rule has no subject to test against (**non-blocking, needs a recorded decision**)

Adjudication 12 requires the packaged tool to include built plugin `dist` for non-underscore plugins;
Adjudication 9 requires underscore-prefixed plugins to be excluded. The **only** plugin is
`plugins/_fixture`. So today the correct tarball contains **zero** plugins, and a pack rule that
excludes everything passes the exclusion test while being completely broken.

**Options**: (a) INFRA-008 unit-tests the pack rule against synthetic entries (a `plugins/todos/dist/**`
path is admitted, a `plugins/_fixture/**` path is denied) and records the live proof as
`DEFERRED → PLUGINS-002`. (b) INFRA-008 creates a throwaway non-underscore plugin to pack against —
adds a production-visible directory for a test. (c) Defer the whole plugin-packaging rule to
PLUGINS-002.

**Recommendation: (a).** It proves the rule in both directions without inventing a shipped plugin, and
it names the exact issue that will close the loop. PLUGINS-002's contract should carry a matching
criterion.

### 12. The plugin lint allowlist blocks a new contract subpath (**blocking CONTRACT-015**)

`eslint.config.js:73-80` negates `"!@corpus/kit"`, `"!@corpus/kit/**"` and `"!@corpus/contract"` —
with no `/**` sibling for contract. The asymmetry is deliberate and documented: the rule exists to
ban `@corpus/contract/client`, because *"a plugin that constructs its own transport bypasses the
kit's cache and invalidation"*. A new `@corpus/contract/plugin` subpath is therefore rejected until
the allowlist changes.

**Options**: (a) Add a targeted `"!@corpus/contract/plugin"`. (b) Add a blanket
`"!@corpus/contract/**"` and a separate explicit `"@corpus/contract/client"` ban. (c) Put the types on
the **root barrel** instead of a subpath, needing no lint change — but that contradicts both the
kit's and the contract's own "keep the specialised surface off the app-facing barrel" precedent.

**Recommendation: (a).** One string, minimum blast radius, keeps the `/client` ban structural rather
than re-derived. `scripts/eslint-boundaries.test.ts` gains a probe for each direction (TEST-146).

### 13. `CommandContext` cannot be graduated as written (**blocking CONTRACT-015's second half**)

CONTRACT-015's AC says *"`CommandSpec` / `CommandContext` (and whatever minimal registry types a
plugin command module needs) — type only"*. `CommandSpec` and friends are pure data and move cleanly.
`CommandContext` does not:

- **`ParsedArgs` and `ParsedFlags` are `class`es with `#private` fields** (`parse-args.ts:14-61`).
  A `#private` field makes a class **nominally** typed — no structural type can ever satisfy it. The
  contract would have to ship the classes, i.e. **runtime code**, violating the issue's own "No
  runtime code moves".
- **`Workspace`'s module reads `node:fs`** at its first two lines.
- **`CliClient` depends on `@corpus/contract/client`** — the one subpath plugins are lint-forbidden
  from importing (Conflict 12's whole reason).

`plugins/_fixture/cli/commands/add.ts:17-22` already discovered the answer by hand: a narrowed
structural interface (`args: {get(name): string}`, a two-field `workspace`, a two-method `out`).

**Options**: (a) Graduate `CommandSpec`/`FlagSpec`/`ArgSpec`/`Example`/`TopicSpec`/`Registry` verbatim,
and graduate a **narrowed `PluginCommandContext`** that `apps/cli`'s `WorkspaceCommandContext`
satisfies — the fixture's shape, promoted and named. (b) Graduate only the spec types and leave the
context structurally typed per-plugin (status quo for context). (c) Move `ParsedArgs`/`ParsedFlags`
into the contract as runtime classes.

**Recommendation: (a).** It delivers the issue's actual goal — *"a plugin's `cli/commands/*.ts` can be
fully typed within the allowed imports"* — without moving runtime code, and it turns a hand-rolled
fixture interface into a maintained contract. (c) is a fail against the issue's own AC.

### 14. CLI-006 must edit a file sprint-012 assigned exclusively to AGENT-002 (**low, but rule it explicitly**)

Sprint-012's Integration Points: *"AGENT-002 owns `scripts/workspace-template.{ts,test.ts}`"*, with an
escalation rule for anyone else needing to touch it. CLI-006 must edit **both** — emptying
`CLI_COMMANDS_PENDING_CLI_006` (`workspace-template.ts:235`) and updating the assertion at
`workspace-template.test.ts:746` that pins the allowlist's exact contents. Adjudication 5 designed
this to happen; the ownership rule was scoped to sprint-012 and AGENT-002 is `done`, but the rule was
written down and no agent-runtime issue is in this batch to release it.

Note **both** edits are required: emptying the array alone leaves `toEqual(["doc check","skill
rollback"])` red.

**Options**: (a) Release the ownership for wave 2 and assign the two lines to CLI-006 explicitly, with
the constraint that it changes **nothing else** in either file. (b) The orchestrator makes the two
edits at harvest, and CLI-006 reports it as a required follow-up. (c) Spawn agent-runtime-dev for two
lines.

**Recommendation: (a).** It is the mechanism's designed trigger, it is two lines, and splitting them
from the commit that ships the verbs means the branch is red in between. Constrain CLI-006 to those
two lines and let the pr-reviewer see them in the phase diff.

### 15. Whole-workspace `corpus doc check` misses archived documents (**blocking CLI-006's correctness**)

Adjudication 22 rules `corpus doc check` = "paginate `GET /api/docs`, then post `{ids}`". But
`GET /api/docs` **excludes archived documents by default** — `schemas/query.ts:97-121`: *"Omitted, the
default result set **excludes** `status: archived`"*, with `includeArchived=true` giving the union and
`status=archived` giving archived-only.

So a literal reading of Adjudication 22 produces a "whole-workspace" check that silently skips every
archived document — including everything under `.claude/skills-archived/`, which §7 makes a first-
class indexed root. §14 says *"`corpus doc check` exposes the same validator on demand over the whole
workspace"*, and a duplicate id between an archived document and a live one is exactly the kind of
structural lie the checker exists to catch.

**Options**: (a) The enumeration passes `includeArchived=true` — whole workspace means whole
workspace. (b) Default to non-archived with a `--all` flag. (c) Leave it as-is and document the
limitation.

**Recommendation: (a).** §14's word is "workspace", `duplicate-id` and `anchor-claimed-twice` are
cross-document rules that an archived document participates in, and a check that quietly skips a
whole root is worse than no check. Confirm the pagination page size too: `MAX_PAGE_LIMIT` is 200, so
the enumeration walks `limit=200` with `offset` until `offset + limit >= total`.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Adjudication N` / `STRUCK → Open Conflict N` / `DEFERRED → <reason>` with the reason and
  substitute evidence recorded. **Silent omission is a fail.**
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication is
  written back into **the issue file it affects**, not only into this contract. Conflicts 1, 9 and 10
  correct stale issue-file text before an agent reads it and implements it literally.
- **The validator has one implementation and two call sites** (TEST-6, TEST-160), the whole-corpus
  call does **not** inherit the save path's `LOCAL_CHECK_CODES` filter (TEST-7), and the
  contract↔server code drift guard was **made to fail and then to pass** (TEST-27, TEST-28). A guard
  asserted to exist but never exercised is not evidence.
- **The rollback really reverts** (TEST-16): a real file, restored to real previous bytes, through the
  standard mutation pipeline, as a new attributed commit, with the projection and SSE following — not
  a handler that returns a plausible JSON body.
- **`corpus doc check` exits 6 on errors and 0 on warnings** (TEST-87, TEST-88), read from `$?` against
  a real drifted workspace. This is the contract the workspace's future pre-commit hook is built on;
  getting the severity split backwards would make every commit fail or every check useless.
- **`--staged` changed no git state** (TEST-94), proven by byte-identical `git status --porcelain`
  before and after, in a scratch repo reached by explicit `-C`.
- **The self-invalidating allowlist emptied itself** (TEST-106, TEST-107, TEST-163) — both the array
  and the assertion pinning it — and the template tree's CLI-reference test is green **without** an
  allowlist. Adjudication 5's designed trigger fired.
- **A stranger could install this.** The single most important line in the batch: a tarball, installed
  into a temp directory with **no path to the repository**, ran `corpus init`, `corpus server start`,
  rendered the board in a real browser with **zero asset 404s**, round-tripped a document, and stopped
  cleanly (TEST-70 … TEST-77). Everything else in INFRA-008 is bookkeeping around that one proof.
- **The pack audit asserts in both directions** (TEST-65) — a negative-only check passes on an empty
  tarball — and **underscore plugins are excluded while non-underscore plugin dist would be included**
  (TEST-63, TEST-64).
- **No publish was attempted and none was faked** (TEST-81). `npm whoami` and `gh secret list` outputs
  are quoted as the reason, and the README's install line names whatever Open Conflict 5 decided.
- **`corpus workspace upgrade` never clobbered an edited skill** (TEST-118) and landed **one**
  attributed commit naming old → new version (TEST-122), verified with the server both stopped and
  running (TEST-128, TEST-129). Skills are the workspace's memory; this verb exists to protect them.
- **`--dry-run` wrote nothing** (TEST-124) and the subsequent real run performed exactly the printed
  plan.
- **`packages/contract` still imports nothing from `apps/*`** and gained no dependency on
  `better-sqlite3`, `node:fs` or `react` (TEST-139) — the invariant CONTRACT-015 exists to exploit
  must survive it.
- **`plugins/_fixture`'s two hand-maintained duplicate interfaces are gone** (TEST-144) and a typed
  plugin probe compiles and lints (TEST-156). PLUGINS-002 is provably unblocked.
- **The boundary lint rules still fire in both directions** (TEST-146): `@corpus/contract/plugin`
  allowed from `plugins/**`, `@corpus/contract/client` still rejected. The allowlist was widened by
  exactly one targeted string (TEST-145, TEST-154).
- **`docs/cli.md` was regenerated exactly once, on the merged tree**, and
  `scripts/check-generated-artifacts.ts` is green against HEAD (TEST-159). Four issues change the CLI
  surface; four independent regenerations produce four stale artifacts.
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands, actual
  output, actual file/git/queue/SSE/browser state — and states which model the implementing agent ran
  on (INFRA-006).
- `npm run build` succeeds in dependency order; `/lint` and `npm run format:check` pass;
  `npm run typecheck` passes in every workspace; `/test` passes with no regressions — as the
  orchestrator's **single** harvest run (sprint-012 Adjudication 4).
- **The merged coverage gate is green at 90% on all four metrics**, with the new check/rollback
  handlers, the upgrade decision matrix, and the staged-collection helper genuinely covered. Note
  `COVERAGE_INCLUDE` does **not** cover `scripts/**`, so `check-pack.ts` and `check-versions.ts` are
  gated only by their own unit tests (TEST-66, TEST-67) — write them.
- `npm run e2e` passes with **nothing bound on 8765**, on a `CORPUS_UI_PORT` away from 5173/5174.
- **`/audit` has been run on INFRA-008** (largest surface, touches CI, hooks, packaging and release
  — the changes whose defects are invisible until a release) **and on CLI-006** (it relaxes a
  deliberately absolute safety guard, Open Conflict 8). SERVER-019, CLI-010, CLI-005 and CONTRACT-015
  are P1 and contained; the orchestrator decides.
- **Any user-observable behavior change carries its SPEC.md amendment**, drafted by spec-writer and
  held for user sign-off at the phase PR (SHARED-002). Candidates in this batch: §9.2's route list
  (CONTRACT-008's amendment is still pending from sprint-012 and SERVER-019 is what makes the routes
  real), §2.1's install line if the package name changes (Open Conflict 5), and §14's wording if
  Conflict 2 rules that `corpus doc check` is lenient for skill frontmatter.
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- **No stray processes** (TEST-167): nothing bound in `9090`–`9129`, `8765` free, `5283`/`5284` free,
  `5173`/`5174` still only the `ssh` process, no orphaned vitest/Vite/Playwright/node children,
  `git status` clean in every worktree and in the Corpus repository, `git worktree list` clean, and
  the 46 pre-existing `/tmp/corpus-*` directories untouched.
- **PLAN.md reflects reality**: SERVER-019, CLI-010, INFRA-008, CLI-006, CLI-005 and CONTRACT-015
  marked `done` only after the evaluator returns; **CONTRACT-013 flipped to `done` as bookkeeping**
  (Open Conflict 1); and AGENT-003 + PLUGINS-002 shown as ready.

---

## Orchestrator Adjudications (2026-07-28)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

### Pre-ruled at contract time

1. **Worktree agents run SCOPED tests only.** `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run
   <path>` during development; at most one workspace-scoped run at the end of a session. Never the
   repo-wide suite, never `npm run coverage`, never `npm run test:coverage` from a worktree, never
   `npm run e2e`. The orchestrator runs the **single** repo-wide gate at harvest. (Carried forward
   from sprint-012 Adjudication 4.)

2. **Real-app verification only, and the from-source CLI is
   `node --import tsx apps/cli/src/bin/corpus.ts` — never `npx`.** INFRA-008 is the sole exception and
   the exception is its point: it must install the packed tarball into a scratch prefix and drive the
   **installed** `corpus` binary for `init`, `server start`, the browser check, and `server stop`.

3. **No agent amends `packages/contract` except CONTRACT-015**, and CONTRACT-015 amends no route.
   SERVER-019 and CLI-006 consume CONTRACT-008's shapes as shipped; if a shape is genuinely wrong
   (Open Conflict 4(ii) is the live candidate), it **escalates to the orchestrator for a rider issue**
   rather than being edited in place. §9.3, restated from sprints 008–012.

4. **`docs/cli.md` is never hand-edited, and is regenerated once per harvest on the merged tree.**
   Four issues change the CLI surface. Each agent regenerates in its own worktree to verify its own
   entry; the authoritative regeneration is the orchestrator's, after the merge.

### Ruled before stage A (orchestrator, 2026-07-28)

5. **Conflict 1 → CONTRACT-013 struck from the batch.** Its code shipped in PR #10's squash
   (`e6ce966`) and the issue file already reads `done`; only PLAN.md's row was stale (now
   corrected). CONTRACT-015 runs alone in the contract domain, preceded by the Conflict-4 rider.

6. **Conflict 2 → yes, same leniency, same code path.** `POST /api/check` applies exactly the
   write path's skill-frontmatter escape (`frontmatter-invalid` skipped for `synthesizeId` roots),
   implemented by REUSING the write path's option/filter — never a duplicated list. A document the
   system would accept on write must not fail `doc check`. A divergence between the two is itself a
   bug.

7. **Conflict 3 → inject both seams, with a staged union.** `/api/check` injects `resolveAnchor`
   and `documentExists`. For `{documents}` requests, `documentExists` consults the union of the
   live corpus and the submitted document set (a `[[ref]]` resolving to either is not an orphan);
   for `{ids}` requests, the live corpus alone.

8. **Conflict 4 → rider first, then SERVER-019.** (i) A contract rider (implemented by the
   contract-dev session ahead of CONTRACT-015, committed separately as `[CONTRACT-016]`) makes
   `SkillRollbackResult.commit` `string | null` — `null` is §14's "commit failed, file write
   stands" value, with the rejected-hook warning in `warnings`. (ii) SERVER-019 builds the missing
   primitive in-domain: a ref-parameterised read (`git show <ref>:<path>` equivalent beside
   `readHeadVersion`), with the write going through `MutationPlan` → `runMutation` inside
   `withGitLock` as the contract requires. SERVER-019 starts only after the rider is harvested and
   committed.

9. **Conflict 5 → HELD FOR USER (npm package name).** `corpus` and `corpus-cli` are taken on npm.
   INFRA-008 proceeds with the provisional, unpublished name `corpus` (bin name stays `corpus`
   regardless); everything name-dependent that is user-visible (`package.json` `name`, README
   install line) is marked provisional in the diff, and the name decision is surfaced at the phase
   PR alongside the SPEC amendments. Candidates for the user: an npm scope (e.g. `@corpus-app/…`),
   `corpus-md`, or another unscoped name. No publish happens this sprint.

10. **Conflict 6 → publish AC is `npm publish --dry-run` + pack assertions only.** No token exists
    and no publish is authorized; the real-publish criterion is DEFERRED → user (with Conflict 5).

11. **Conflict 7 → INFRA-008 fixes the pre-push hook in-scope.** A hook that runs e2e but cannot
    fail the push is a latent gate hole; add the exit-propagation epilogue, prove it blocks (a
    deliberately failing e2e in a scratch clone or an injected false exit), and note the fix in the
    E2E log. Ruled in-scope because INFRA-008 already touches `.githooks/`.

12. **Conflict 8 → shared read-only git helper with a narrow exemption.** The helper lives outside
    the hygiene-guarded module prefixes, exposes read-only staged-state queries (`status
    --porcelain`, staged blob reads), and carries a commented exemption naming this adjudication.
    The `exec*`/`spawn*` ban inside the twelve guarded modules stands untouched.

13. **Conflict 9 → the CLI's standard mapping wins.** CLI-010's issue text said "404 → exit 4";
    the CLI maps server 404s to exit 5. The issue file is corrected; the acceptance criterion is
    "errors follow the standard mapping", not the stale number.

14. **Conflict 10 → render what the wire returns.** `thread show` renders `GET /api/threads/{id}`
    as-is (turns, status, anchor incl. orphan state). The phantom `events`/read-state fields are
    struck from the issue file; no contract change, no call to the mutating unread endpoint.

15. **Conflict 11 → synthetic non-underscore plugin in temp dirs.** Adjudication 12's
    non-underscore path (dist-first resolution, packaging inclusion) is tested against a synthetic
    plugin fabricated in a temp directory by the tests; no committed non-underscore plugin exists
    until PLUGINS-002.

16. **Conflict 12 + Conflict 13 → graduate a reduced structural surface; the `/client` ban
    stands.** CONTRACT-015 exports plugin-facing **interfaces**, not the CLI's internals: a
    `PluginCommandSpec`/`PluginCommandContext` pair whose parsed args/flags are plain-object views
    and whose client is an injected capability on the context — a plugin never imports
    `@corpus/contract/client` (the eslint allowlist keeps banning it). The CLI adapts its internal
    classes (`ParsedArgs`/`ParsedFlags` with `#private`, `Workspace`, `CliClient`) to those
    interfaces at the registry boundary, checked with `satisfies`. `PluginServerContext` graduates
    the same way: interface in contract, implementation + adapter in `apps/server`.

17. **Conflict 14 → ownership expired with sprint-012.** CLI-006 owns BOTH allowlist edits this
    sprint: emptying `CLI_COMMANDS_PENDING_CLI_006` in `scripts/workspace-template.ts` AND the
    companion assertion pinning it in `scripts/workspace-template.test.ts`. No other edits to the
    extractor or the skill text.

18. **Conflict 15 → `includeArchived=true` on enumeration.** Whole-workspace `doc check`
    enumerates with `includeArchived=true` (and pagination) so archived docs — including
    `.claude/skills-archived/` — are checked. §14's "whole workspace" means the whole workspace.

### Post-implementation rulings

_[Orchestrator appends at harvest, numbered from 20.]_
