# Sprint 015 — Phase 5 wave 1: stop `init` destroying directories, close the two §7 honesty gaps

**Issues**: CLI-013 (stage A, alone) · CLI-011, SERVER-030 (stage B, parallel)
**Domains**: cli, server (+ contract rider, see Open Conflict 1)
**Branch**: `phase-5-followups`
**Date**: 2026-07-29
**Test numbering**: continues the ladder from sprint-014's `TEST-297`; this sprint runs `TEST-298`–`TEST-372`.

---

## Machine rules — binding on every agent in this batch

### Ports

Continuing the ladder upward from sprint-014's `9130`–`9159`. Verified free at contract time:
`lsof -nP -iTCP -sTCP:LISTEN` shows **nothing bound in `9180`–`9199`**.

| Consumer                         | Range         | Primary |
| -------------------------------- | ------------- | ------- |
| CLI-013                          | `9180`–`9184` | `9181`  |
| CLI-011                          | `9185`–`9189` | `9186`  |
| SERVER-030                       | `9190`–`9194` | `9191`  |
| sprint-015 evaluator             | `9195`–`9199` | `9196`  |
| Automated tests, every workspace | —             | `0` (ephemeral). **Never hardcode.** |

**`8765` is NEVER bound and NEVER killed, by anyone, for any reason.** The maintainer's personal
server lives there (user directive, 2026-07-29). Binding it fails; killing whatever answers there
destroys the user's own data. The hazard is structural, not hypothetical: `corpus init` with no
`--port` probes upward from `DEFAULT_PORT` 8765 (`apps/cli/src/commands/init/port.ts:19,51-63`), so
**every `corpus init` in this sprint passes `--port` explicitly**, including runs expected to fail.
Check `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done and leave what is there alone.

`5173`/`5174` are held by an `ssh` process; `apps/ui/vite.config.ts` pins `server.port: 5173,
strictPort: true` and does not read `CORPUS_UI_PORT`, so a bare `npm run dev -w apps/ui` fails to
start — use `-- --port 5290 --strictPort`. `5273` is the pre-push hook's e2e port; nobody binds it.
**No issue in this batch runs `npm run e2e`** — Playwright is single-holder and the orchestrator
runs it once at harvest.

### Scratch directories

All scratch work lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` — **not** `/tmp`
(sprint-014's prefix), and never inside the repository.

| Issue      | Prefix                                                                            |
| ---------- | --------------------------------------------------------------------------------- |
| CLI-013    | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-cli013-XXXXXX`    |
| CLI-011    | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-cli011-XXXXXX`    |
| SERVER-030 | `mktemp -d /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-server030-XXXXXX` |

Automated tests use `fs.mkdtemp`/`mkdtempSync`. **Never** glob-delete the prefix — other agents'
evidence lives there. Delete only paths you created and captured in a variable.

### The `corpus init` cwd rule — binding, and the whole point of CLI-013

Until CLI-013 lands, **`corpus init` ignores `--workspace` and scaffolds `process.cwd()`**
(`apps/cli/src/commands/init/index.ts:68`). Therefore, for **every** issue in this batch:

```sh
# CORRECT — the subshell cd is what makes the target real
( cd "$WS" && node --import tsx "$REPO/apps/cli/src/bin/corpus.ts" init --port 9186 )

# FORBIDDEN until CLI-013 lands — this scaffolds your cwd, whatever it is
corpus init --workspace "$WS" --port 9186
```

- **Never rely on `--workspace` for `init` until CLI-013 itself has landed**, and even then prefer
  the subshell `cd` in other issues' setup, since CLI-013 may land after your session starts.
- **CLI-013's own E2E must run from a cwd OUTSIDE this repository** — not the repo root, not a
  worktree, not any subdirectory of either. `cd` to the scratch prefix first and `pwd` to confirm it
  in the log. The 2026-07-29 CLI-014 drill did exactly this wrong and clobbered the repo's
  `README.md` and `.gitignore` irrecoverably.
- `corpus --workspace <path> <other verb>` is fine and unaffected — the bug is `init`-specific.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` kill sibling
agents' servers and the maintainer's `8765` server — **forbidden.** Stop what you started, by pid,
and verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring done.

### Tests and load

- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm test` unfiltered, never `npm run coverage` or `npm run test:coverage`,
  never `npm run e2e`. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum.**
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time** — never overlap builds, test runs, or `npm install`.
- **Two concurrent implementation agents maximum**, and stage A makes it one.
- From-source CLI is `node --import tsx apps/cli/src/bin/corpus.ts` — **never `npx`**.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed is marked `STRUCK → Adjudication N`,
`STRUCK → Open Conflict N`, or `DEFERRED → <reason>` in the E2E Verification Log, **with the reason
and the substitute evidence supplied**. Silent omission is a fail. Each agent also states
`implemented on: opus | fable` per CLAUDE.md's Record-actuals rule.

---

## Acceptance Tests

### CLI-013: `corpus init` honors `--workspace`; the guard refuses hostile directories

`apps/cli/src/commands/init/index.ts` + `scaffold.ts`, their colocated tests, and a regenerated
`docs/cli.md`. **Stage A, alone.** The highest-stakes issue in the batch: this bug has fired three
times, and the third time it fired inside this repository.

Three facts from the shipped tree at `d1965e3` govern the whole ladder:

- **`--workspace` is parsed and discarded.** `index.ts:68` is
  `const target = resolve(context.cwd, context.args.optional("path") ?? ".");` — the only target
  resolution there is. `context.flags.string("workspace")` **is** populated (globals are merged into
  every command's flag set by `mergedFlags`, `parse-args.ts:91`) and init never reads it. The rest of
  the CLI resolves `--workspace ?? CORPUS_WORKSPACE ?? cwd` exactly once, in `workspace.ts:75`.
- **The first write is `created.mkdir(target)` at `index.ts:101`.** Everything after it writes.
  There are exactly three refusal points today (`:70` not-a-directory, `:76` existing-workspace,
  `:94` `claimPort`) and all three precede it. The new guard belongs in that window and nowhere else.
- **`unwind()` cannot repair an overwrite.** `CreatedPaths.writeFile`/`copyFile`
  (`scaffold.ts:123,126,131,133`) record a path **only when `!existed`**, and `unwind()` only
  deletes — it never snapshots and never restores. So the fix is **refuse before the first write**,
  not roll back after.

#### A. Pre-fix reproduction — mandatory, and disposable

TEST-298: The `--workspace` divergence is reproduced before any code changes
  Given: HEAD before CLI-013, a scratch dir `$A` and a separate empty target `$B`, cwd `$A`
  When: `corpus init --workspace "$B" --port 9180` runs
  Then: `$B` is **empty** and `$A` has been scaffolded — the flag was parsed, bound, and discarded.
  The exact command, the cwd, and both directory listings are pasted into the E2E log. This is the
  bug, reproduced deliberately in a directory that does not matter.

TEST-299: The unrecoverable-overwrite failure is reproduced before any code changes
  Given: HEAD before CLI-013; a scratch dir seeded as a git repo with a **committed** `README.md`
  and `.gitignore` whose sha256 are recorded in the log; cwd = that directory
  When: `corpus init --port 9180` runs
  Then: Both files are **overwritten by the template** and the pre-existing content is gone. Whether
  the run then succeeds or fails, `CreatedPaths.unwind()` does not restore them. Post-run sha256 of
  both files is pasted alongside the pre-run values. **This runs nowhere near the repository.**

TEST-300: The enclosing-repository escape is reproduced and explained
  Given: HEAD before CLI-013; a git repo, and an **empty subdirectory** inside it as cwd
  When: `corpus init --port 9180` runs
  Then: `isRepositoryRoot` (`git.ts:99`, a bare `existsSync(join(dir,".git"))`) is false for the
  subdirectory, so `initRepository` runs `git init -b main` there, git discovers and **reinitializes
  the enclosing repository's gitdir**, and `commitAll`'s `git add --all -- .` (`git.ts:120`) stages
  against it. The log records the observed effect on the parent repo (`git -C <parent> config --get
  core.bare`, `git -C <parent> status --porcelain`). This is the mechanism behind the 2026-07-29
  repo-root incident.

#### B. `--workspace` is honored, or loudly refused — never silently ignored

TEST-301: `--workspace <path>` with no positional targets `<path>`
  Given: cwd `$A`, empty target `$B`
  When: `corpus init --workspace "$B" --port 9181`
  Then: `$B` holds the workspace (`.corpus/config.json`, `data/docs`, `data/threads`, the template,
  one commit) and **`$A` is untouched** — listing identical to before; `report.workspace` is `$B`.
  **Or**, if the chosen semantics is refusal, the command exits **2** with a message naming the
  positional form, and `$A` and `$B` are **both** untouched. Whichever ships, parse-and-drop is a
  fail: the flag must never be silently ignored.

TEST-302: A positional and `--workspace` disagreeing is resolved explicitly
  Given: cwd `$A`; `corpus init "$B" --workspace "$C" --port 9181`
  When: Run
  Then: The behavior is **stated in the help text and the generated docs** and is one of: positional
  wins (documented precedence), or a `UsageError` naming the conflict. Never a silent pick. At most
  one of `$B`/`$C` is written; the other is untouched.

TEST-303: `CORPUS_WORKSPACE` is handled consistently with `--workspace`
  Given: `CORPUS_WORKSPACE=$B` in the environment, cwd `$A`, no positional
  When: `corpus init --port 9181`
  Then: The result matches the precedence chain the rest of the CLI already uses (`workspace.ts:75`)
  or explicitly refuses. It is not a third, undocumented behavior, and the choice is in the docs.

TEST-304: The no-flag, no-positional path still targets cwd
  Given: An empty scratch dir as cwd
  When: `corpus init --port 9181`
  Then: It scaffolds cwd exactly as before. `index.test.ts:48`
  (`creates the §4 tree, the config, the template and one commit`) passes **unchanged** — the fix
  adds a target source, it does not remove the default.

#### C. The guard refuses a non-empty non-workspace directory, naming its evidence

TEST-305: A directory holding unrelated files is refused without `--force`
  Given: A scratch dir containing `notes.txt` and nothing corpus-shaped
  When: `corpus init --port 9181` targets it
  Then: Exit **2**, `code: "usage_error"`, and the message **names the evidence found** — at minimum
  the count, ideally the names, of the pre-existing entries. The directory is **byte-identical
  afterward**: same `readdirSync` listing, same file contents, no `.corpus`, no `.git`.

TEST-306: A git repository is named as evidence, distinctly
  Given: A scratch dir that is a git repo (a `.git` **directory**) with a committed file
  When: `corpus init --port 9181` targets it
  Then: Refused, and the message names **the git repository** specifically — not merely "non-empty".
  The two evidence kinds are distinguishable in the output, because they are different hazards.

TEST-307: A linked worktree is caught too
  Given: A scratch dir that is a git **linked worktree** (a `.git` **file**, not a directory)
  When: `corpus init --port 9181` targets it
  Then: Refused with the git evidence named. `isRepositoryRoot`'s bare `existsSync` is true for both
  shapes; the guard must not regress to a directory-only check.

TEST-308: A subdirectory *inside* a repository is refused even when empty
  Given: An **empty** directory inside a git repo, as the target
  When: `corpus init --port 9181` targets it
  Then: Refused unless `--force`, with the **enclosing repository** named. This is the TEST-300
  mechanism and the one case a "non-empty" test alone would miss: the directory is empty, and
  initializing there still reinitializes the parent's gitdir. Note the existing enclosing-**workspace**
  check (`index.ts:86-92`) is warning-only and inspects `dirname(target)`; whether it is upgraded to
  match is an adjudication, but the enclosing-**repository** case is in scope here.

TEST-309: The refusal happens **before the first write**
  Given: Each refusal case above
  When: The run is observed
  Then: **No path was written at all** — not `data/`, not `.corpus/`, not one template file, and no
  `git init`. Proven two ways: the target's `readdirSync` listing and every pre-existing file's
  content hash are identical before and after; **and** a unit test with an injected fs/git that fails
  loudly if any write is attempted confirms the guard is evaluated before
  `created.mkdir(target)` at `index.ts:101`. Ordering is the whole fix — an after-the-fact rollback
  cannot restore an overwrite.

TEST-310: `unwind()` is not load-bearing for this fix, and its gap is pinned
  Given: `scaffold.ts`'s `CreatedPaths`
  When: A test writes over a pre-existing file through `writeFile`/`copyFile`, then calls `unwind()`
  Then: The test **asserts the file is not restored**, with a comment naming CLI-013 — so the
  refuse-before-write guard cannot later be softened into a rollback by someone who assumes `unwind`
  restores. If the agent instead implements snapshot-and-restore, this test inverts and TEST-309
  still governs. Either way the behavior is asserted, never assumed.
  (`scaffold.test.ts`'s four `CreatedPaths` cases cover create/remove; none covers overwrite.)

TEST-311: `--force` proceeds, and says what it is doing
  Given: A non-empty non-workspace directory
  When: `corpus init --force --port 9181` targets it
  Then: It scaffolds, and the output **warns** which pre-existing files were overwritten (or that it
  is proceeding over N existing entries). A `--force` that is silent about clobbering is a fail.

TEST-312: `--force` does **not** override the existing-workspace guard
  Given: A directory that already holds `.corpus/config.json`, or a non-empty `data/`
  When: `corpus init --force --port 9181` targets it
  Then: Still refused. `--force` is about *unrelated* content; it never authorizes writing a fresh
  token and config over a live workspace. `index.test.ts:134` and `:145` pass unchanged, and a new
  case pins the `--force` variant of each.

#### D. Post-fix E2E — the incident cannot recur

TEST-313: The TEST-298 reproduction now passes
  Given: The fix, the same commands as TEST-298
  When: Re-run from cwd `$A`
  Then: Either `$B` is the workspace or the command refuses — and in **both** cases `$A` is
  untouched. Before/after listings of `$A` are in the log.

TEST-314: The TEST-299 reproduction now refuses, harmlessly
  Given: The fix, and a freshly seeded repo-with-README scratch dir
  When: `corpus init --port 9181` targets it
  Then: Refused; both files' sha256 are **identical to their pre-run values**. This is the concrete
  proof that the third incident cannot happen again.

TEST-315: The TEST-300 escape now refuses
  Given: The fix, an empty subdirectory inside a git repo
  When: `corpus init --port 9181` runs there
  Then: Refused before any write; the parent repo's `core.bare`, config, index and worktree are
  unchanged — `git -C <parent> status --porcelain` empty and the config values compared before/after.

TEST-316: A real, `--workspace`-targeted workspace actually works end to end
  Given: The fix
  When: A workspace is created at `$B` (via whichever form TEST-301 ships), then
  `corpus --workspace "$B" server start --port 9181`, a `corpus doc create`, and `server stop`
  Then: The server starts, the document is created and committed, `git -C "$B" log` shows both
  commits, and the server stops cleanly with `9181` free afterward. A guard fix that produces
  unusable workspaces is not a fix.

TEST-317: The safe-cwd rule was actually followed
  Given: The E2E log
  When: Read
  Then: Every `corpus init` invocation in it shows its cwd, and **no invocation ran with the
  repository or any subdirectory of it as cwd**. `git -C <repo> status --porcelain` is pasted at the
  end of the session showing only the intended source edits.

#### E. Regression surface, docs, and the prose that must change

TEST-318: The three "there is no `--force`" prose sites are updated together
  Given: `index.ts:32-33` (module comment), `index.ts:79` (the guard's hint text), `index.ts:150`
  (the published command description, which feeds `docs/cli.md:134`)
  When: `--force` ships
  Then: All three read truthfully. A stale "there is no `--force`" surviving in any of them is a
  fail; the third is **user-visible in the generated reference**.

TEST-319: `docs/cli.md` regenerates with the new surface
  Given: `npm run docs:cli -w apps/cli`
  When: Run in the agent's tree
  Then: `corpus init`'s entry documents `--force`, the argument/flag precedence from TEST-302, and
  the refusal behavior; a new example covers the `--workspace` form.
  `apps/cli/src/docs/generate.test.ts:26` (`matches the committed docs/cli.md`) is green.
  **The artifact-drift check (`scripts/check-generated-artifacts.ts`) cannot be green inside a
  worktree** — it requires `git diff --stat HEAD --` over the artifacts to be empty and the agent
  cannot commit. Record the red output verbatim with that reason; the orchestrator's post-commit run
  is authoritative. This is the accepted pattern (CONTRACT-008, CLI-006, PLUGINS-002).

TEST-320: Registry validation still passes, and no global is shadowed
  Given: The new flags
  When: `collectRegistryProblems([initCommand])` runs (`index.test.ts:224`)
  Then: Empty. In particular **init must not declare a flag named `workspace`** — `validate.ts:126`
  rejects it as shadowing a global (`validate.test.ts:86` pins the message). Init reads
  `context.flags.string("workspace")`, which `mergedFlags` already populates for it.
  `initCommand.requiresWorkspace === false` is unchanged.

TEST-321: The blessed-behavior test is resolved, not deleted
  Given: `index.test.ts:152` — `reuses an existing repository instead of re-initializing it` — which
  currently asserts that init into a **non-empty git repo with a committed file** succeeds
  When: The guard lands
  Then: The test is **rewritten to pass `--force`**, keeping the reuse-not-reinitialize branch
  covered (`report.repository === "reused"`, branch still `trunk`, two commits), and a **new** test
  asserts the same directory is refused **without** `--force`. Deleting the test to make the suite
  green is a fail — the reuse branch is real behavior that must stay covered.

TEST-322: The other pinned init tests survive or are consciously inverted
  Given: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli/src/commands/init apps/cli/src/commands/server/lifecycle.test.ts apps/cli/src/commands/workspace`
  When: Run
  Then: Green. `index.test.ts:165` (`fails before creating anything when git is missing`), `:176`
  (occupied port leaves the target empty) and `:185` (`unwinds everything it created when the commit
  fails`) still pass — they are the existing expressions of "refuse before writing" and the new guard
  must not weaken them. `scaffold.test.ts:189`/`:207` (`is undefined for an empty directory`,
  `ignores an empty data directory`) gain companions for the new evidence kinds.
  `lifecycle.test.ts:92` and `upgrade.test.ts`'s `makeWorkspace` use fresh temp dirs / call
  `scaffoldWorkspace` directly, so they should be unaffected — confirm rather than assume. Every
  inversion is listed in the log with its reason.

TEST-323: The model actually used is recorded
  Given: The E2E Verification Log
  When: Read
  Then: It states `implemented on: opus | fable`.

---

### CLI-011: `corpus skill create` (through the server write path) + `corpus doc list`

Two verbs. `corpus doc list` is a thin wrapper over a read route that already exists.
`corpus skill create` is **not** thin: it needs a server write path that can create a document
**outside `data/docs/`**, and no such path exists today.

**Blocking, contract-first: see Open Conflicts.** Sprint-014's Open Conflict 1 established against
the shipped tree that `apps/server/src/core/paths.ts`'s `normalizeDocFolder` unconditionally prefixes
`DOCS_ROOT` and throws `PathTraversalError` otherwise, that `write.ts:347`'s `resolveFolder` turns
that into a 400 reading *"folder must be a path under data/docs"*, that `corpus doc move` refuses
skills outright, and that `apps/cli/src/commands/skill/` holds only `rollback.ts`. The **only** write
path that touches `.claude/skills/` today is archive, and only for a document already there. So
`corpus skill create` requires a **new route plus a contract change**, and sprint-014 Adjudication 3's
standing rule is that no agent amends `packages/contract` inside a sprint. **cli-dev must not paper
over this**: the route half is a contract-first escalation to the orchestrator (a CONTRACT issue and
a SERVER issue, sequenced before the CLI verb), not something to implement inside the CLI by writing
files directly — that would break the CLI-only/server-sole-writer invariant this verb exists to
uphold. The `corpus doc list` half is independent and unblocked; it may ship on its own.

#### A. The dependency is confirmed or escalated, before any code

TEST-324: The skill-create write path is proven present or absent, in writing
  Given: `packages/contract`'s route definitions, `apps/server/src/documents/write.ts`, and
  `apps/server/src/core/paths.ts`
  When: Audited for any route that can create `.claude/skills/<name>/SKILL.md`
  Then: The E2E log records a decisive finding with file:line evidence — either an existing route is
  named and used, or the absence is recorded and the issue **escalates to the orchestrator** for a
  contract + server rider before the CLI verb is written. A `corpus skill create` that reaches the
  filesystem directly, or that smuggles a skill through `POST /api/docs` by defeating
  `normalizeDocFolder`, is a **fail** regardless of whether it works.

TEST-325: The PLAN/issue dependency discrepancy is reconciled
  Given: `issues/PLAN.md` lists CLI-011's dependencies as `CLI-003`; the issue file lists
  `CLI-006, SERVER-019`
  When: Noticed
  Then: The correct set is recorded in the log and the orchestrator corrects one of the two. Cheap
  bookkeeping, but a wrong dependency row is how a blocked issue gets scheduled as ready.

#### B. `corpus skill create` — through the server, or not at all

Conditional on TEST-324's ruling. If the route is escalated out of this sprint, every test in this
subsection is `STRUCK → Open Conflict 1` with the escalation recorded, and CLI-011 ships as
`corpus doc list` alone.

TEST-326: A skill is created through the server and lands on disk
  Given: A real workspace on `9186` with a running server
  When: `corpus skill create <name>` runs
  Then: `.claude/skills/<name>/SKILL.md` exists on disk with valid frontmatter carrying **both**
  field sets — Claude Code's `name` (equal to the directory basename) and `description`, and Corpus's
  `id`, `type: skill`, `title`, `created`, `updated`, `tags`, `status`, `anchors`. The request went
  over HTTP to the server; the CLI wrote nothing itself.

TEST-327: The write is a real mutation, with the audit trail every other write has
  Given: The created skill
  When: The workspace's git history is inspected
  Then: A **git auto-commit** exists attributing the creation to the acting party (`--from`), exactly
  as `doc create` produces. No commit, or a commit authored by the wrong party, is a fail.

TEST-328: The new skill is projected and discoverable without a restart
  Given: The server running throughout
  When: The skill is created
  Then: The watcher picks it up and the projection indexes it as `type: skill`:
  `GET /api/docs?type=skill` includes it, its synthetic id matches the `doc_skill<8 hex>` shape the
  projection assigns, and it appears on the real board. No server restart is used to make this true.

TEST-329: The name is validated, and the error is readable
  Given: `SkillNameSchema` (which forbids `/`, so a nested skill is unaddressable by
  `corpus skill rollback`)
  When: `corpus skill create` is given a name with a slash, an empty name, and a name colliding with
  an existing skill
  Then: Each is refused with a readable message and a documented exit code; **nothing is written** in
  any of the three cases — no directory, no partial `SKILL.md`, no commit.

TEST-330: A created skill passes `corpus doc check`
  Given: The newly created skill
  When: `corpus doc check` runs over the workspace
  Then: Clean, exit 0. A create verb that emits a document its own validator rejects is a fail.

TEST-331: `corpus skill rollback` composes with `corpus skill create`
  Given: A created skill that is then edited through `corpus doc edit` and committed
  When: `corpus skill rollback <name>` runs
  Then: The previous version is restored and the rollback is itself a commit — the loop-safety path
  §7 promises covers created skills, not just template ones.

TEST-332: Creation cannot escape the skills root
  Given: Names containing `..`, absolute paths, and encoded traversal
  When: Passed to `corpus skill create`
  Then: All refused; nothing is written outside `.claude/skills/`. The `PathTraversalError` posture
  that guards `data/docs/` must guard the new root identically. This is the same class of bug as
  CLI-013 and gets the same scrutiny.

#### C. `corpus doc list` — the enumeration verb the agent has never had

TEST-333: `corpus doc list` returns documents through the existing read route
  Given: A workspace with documents in several folders
  When: `corpus doc list` runs
  Then: It prints the documents via the shipped docs list route (the one `useDocs` consumes — no new
  route, no new contract surface). Human output is readable and columnar; the command contacts the
  server and reads nothing off the filesystem itself.

TEST-334: The collection filters pass through
  Given: The route's existing query parameters
  When: `corpus doc list --type skill`, `--type todo`, and a folder/tag/status filter are run
  Then: Each narrows the result correctly against a known fixture set. `--type skill` in particular
  returns the skills — this is the discovery gap sprint-014 Open Conflicts 1 and 2 both named, and
  the reason the verb was filed.

TEST-335: Pagination is honest
  Given: More documents than one page
  When: `corpus doc list` runs with the route's paging parameters
  Then: The CLI either pages through transparently or exposes the cursor/limit and **says so** in its
  output; it never silently truncates. A truncated list presented as complete is a fail — the agent
  makes filing decisions from this output.

TEST-336: `--json` is machine-readable and stable
  Given: `corpus doc list --json`
  When: Run
  Then: Valid JSON matching the contract's row schema, including each row's `extra`. It is the shape
  a skill can parse without a second call.

TEST-337: The verb behaves correctly on an empty and a fresh workspace
  Given: A workspace with no documents, and a fresh `corpus init` workspace
  When: `corpus doc list` runs
  Then: Empty case prints an honest empty result (and `--json` an empty array), exit 0. On a fresh
  workspace it lists the seed documents and the three shipped folders — `inbox/`, `templates/`,
  `views/` — which is exactly what the comment skill's filing convention needs to survey.

#### D. What CLI-011 landing changes in SPEC §7 — recorded, not edited

SPEC.md §7's genesis bullet was amended in the SHARED-002 sign-off set and now reads that the agent
**extends** an existing skill through the CLI, and for a genuinely new skill **proposes** it —
*"until `corpus skill create` ships (CLI-011), at which point the agent creates the skill directly."*
The sentence is written as a transitional clause, so CLI-011 landing **flips the behavior §7
describes** without making §7 false.

TEST-338: The §7 consequence is recorded and routed, and SPEC.md is not touched by cli-dev
  Given: The amended §7 genesis bullet
  When: `corpus skill create` ships
  Then: `git diff SPEC.md` from the implementing agent is **empty** — a spec amendment is spec-writer
  work with user sign-off, never an implementing agent's. The E2E log records that §7's transitional
  clause is now spent and should be flattened to plain "extends an existing skill or creates a new
  one", and names where that amendment is routed (see Open Conflicts).

TEST-339: The AGENT rider is filed with concrete content, not a stub
  Given: CLI-011's third acceptance criterion — *"AGENT rider filed/executed to upgrade the genesis
  charter"*
  When: CLI-011 completes
  Then: An issue file exists in `issues/agent-runtime/` upgrading the comment skill's Skill-genesis
  section from **propose** to **create**, naming: the section to change
  (`assets/workspace/claude/skills/comment/SKILL.md`), the sprint-014 tests it supersedes (TEST-189's
  creation-versus-extension scope, TEST-210's "created **or** extended" carve-out), and the
  conflict rule that a correction contradicting an existing skill stays an **edit**. It is added to
  `issues/PLAN.md`. Whether it is *executed* this wave is an orchestrator call — agent-runtime is not
  in this batch.

TEST-340: The template extractor stays green and no allowlist entry appears
  Given: `CLI_COMMANDS_PENDING_CLI_006` is `[]` and the extractor resolves every `corpus …`
  invocation in `assets/workspace/**` against `docs/cli.md`
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` runs
  Then: Green, with **no allowlist entry added**. CLI-011 makes `corpus skill create` and
  `corpus doc list` real entries in `docs/cli.md`, which is what *permits* a future skill to name
  them — the permission arrives by the verb existing, never by allowlisting.

#### E. Docs, registry, regression

TEST-341: Both verbs are registry-valid and documented
  Given: The new commands
  When: `collectRegistryProblems` runs and `npm run docs:cli -w apps/cli` regenerates
  Then: No problems; neither command shadows a global flag; each declares at least one example;
  `docs/cli.md` gains `corpus skill create` and `corpus doc list` entries, and
  `apps/cli/src/docs/generate.test.ts:26` is green. The artifact-drift check cannot be green inside a
  worktree — record the red output verbatim with that reason (same accepted pattern as TEST-319).

TEST-342: Scoped tests are green
  Given: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli/src/commands/doc apps/cli/src/commands/skill`
  When: Run
  Then: Green, with new colocated tests for both verbs including the refusal cases in TEST-329 and
  TEST-332. If a server route shipped, its own scoped suite is green too.

TEST-343: The model actually used is recorded
  Given: The E2E Verification Log
  When: Read
  Then: It states `implemented on: opus | fable`.

---

### SERVER-030: the honest queue defer/requeue transition

The end-state is written into SPEC §7 already, as a promise with a date on it. The lock bullet reads
that the orchestrator *"replies to the waiting thread …, fails the event with a `deferred:`-prefixed
reason, and the work re-enters the queue via `corpus job retry`"*, and then names what replaces it:
**"A dedicated defer/requeue queue state that re-enters automatically on lock release is planned
(SERVER-030); until then the deferral is visible as an actionable failed job, never silently
dropped."** The force-unlock bullet adds that a broken lock leaves *"the agent's deferred edit …
retryable (`corpus job retry`) rather than being lost"*.

So the contract is not "add a state" — it is **three specific properties**: (1) a deferral is
**distinguishable from a failure** in the store, the API and the console; (2) release, break **and**
reap **automatically** re-enter the event into `pending`; (3) nothing is ever silently dropped. The
interim `queue fail --reason "deferred:…"` protocol retires when all three hold.

**Blocking, contract-first: see Open Conflicts.** §7 §237 pins the status set as
`pending → in-progress → processed | failed`, plus `abandoned`. That enum lives in
`packages/contract`, the console reads it, and the CLI needs a verb to enter the new state. The issue
file itself says *"Contract (route/schema) and CLI (verb) riders are expected — split them out as
coupled issues when this is scheduled."* server-dev **must not** amend `packages/contract` in place
(standing rule since sprint-008, restated as sprint-014 Adjudication 3): the enum/route half is an
escalation to the orchestrator for a CONTRACT rider sequenced ahead of the server work.

#### A. The transition exists and is not a failure

TEST-344: The contract/CLI rider boundary is settled before code
  Given: The queue status enum in `packages/contract`, the queue/jobs routes, and the CLI's queue and
  job verbs
  When: Audited at the start of the issue
  Then: The log records, with file:line evidence, exactly which surfaces must change and which are
  escalated as riders. A `deferred` state invented server-side that the contract's enum does not
  admit — or a status smuggled through as a free-text `reason` — is a fail.

TEST-345: A claimed event can be deferred without being failed
  Given: A real workspace on `9191`, a claimed `comment.created` whose parent document is locked by
  the **user**
  When: The agent defers it through the CLI
  Then: The event leaves `in-progress` for the deferred state, **not** `failed`. On disk the event
  file sits in the deferred location under `.corpus/queue/`; the API reports it with a status
  distinct from `failed`; and the failed-job count does not increase.

TEST-346: The blocking document is recorded on the event
  Given: A deferred event
  When: Its record is read
  Then: It carries **which document it is blocked on**. Without that, "re-enter on lock release"
  cannot be implemented — `comment.created` carries `parentId` but `form.respond` does not, so the
  docId is supplied at defer time rather than inferred. The field and its source are named in the log.

TEST-347: A deferred event is not claimable while it waits
  Given: A deferred event and a running loop
  When: `corpus queue claim-all` runs
  Then: The deferred event is **not** handed out. It is non-terminal but not pending; a claim-all that
  returns it immediately would spin the agent against a lock it still cannot take.

TEST-348: Deferral is not a silent drop, in any failure mode
  Given: A deferred event whose lock is never released
  When: The workspace is inspected after the TTL and after a server restart
  Then: The event still exists, still deferred, still visible in the API and the console, and still
  retryable by hand. §7's "never silently dropped" is load-bearing.

#### B. Automatic re-entry — the property that retires the interim protocol

TEST-349: Lock **release** re-enters the deferred event into `pending`
  Given: A deferred event blocked on a user-held lock
  When: The user's editor session releases the lock through the server
  Then: The event moves to `pending` **automatically**, with no CLI call and no `corpus job retry`.
  A parked `corpus queue idle` returns promptly, and `claim-all` hands the event back.

TEST-350: Lock **force-break** re-enters it
  Given: The same setup
  When: `corpus lock break <docId>` runs (the banner's human escape hatch)
  Then: Same automatic re-entry. §7 promises exactly this: *"the agent's deferred edit stays retryable
  … rather than being lost"* — and under SERVER-030 it does not merely stay retryable, it returns on
  its own.

TEST-351: Lock **reap** re-enters it
  Given: A deferred event blocked on a lock that then expires
  When: `corpus lock reap` clears it (or the TTL sweeper does)
  Then: Same automatic re-entry. All three release paths are covered — a defer that only wakes on the
  happy-path release is a partial fix, and reap is the crashed-editor case.

TEST-352: Re-entry is idempotent and ordered
  Given: Several events deferred on the same document, and a release
  When: The lock clears
  Then: Each event re-enters exactly once (no duplicates, no lost events), and events touching the
  same document remain serially claimable per §7's ordering rule. A release with **no** deferred
  events is a no-op that logs nothing alarming.

TEST-353: Re-entry survives a restart
  Given: Deferred events on disk and a server stop/start cycle
  When: The lock is released after the restart
  Then: They still re-enter. The deferral lives in the file-backed queue, not in process memory.

#### C. SSE and the console

TEST-354: The transition broadcasts invalidations that cover it
  Given: A live SSE stream
  When: An event is deferred, and later re-enters on release
  Then: Invalidation frames arrive for both transitions, covering the queue/jobs keys **and** the lock
  keys the release itself touches, so the console and any lock banner update live. The exact keys are
  recorded in the log. A transition the UI only sees on refetch is not done.

TEST-355: The console distinguishes deferred from failed
  Given: The real board's bottom drawer at `5290`, with one genuinely failed job and one deferred job
  When: Read in a real browser
  Then: The two render **differently** — distinct label and treatment — and the deferred one reads as
  *waiting*, not *broken*. This is the user-visible point of the whole issue: today a deferral looks
  like a failure. Read from the live DOM, not a fixture.

TEST-356: The deferred row says what it is waiting for, and clears itself
  Given: The deferred job in the console
  When: The blocking lock is released while the drawer is open
  Then: The row shows the blocking document while it waits, and transitions live to pending/running
  when the lock clears — no reload.

#### D. Retiring the interim protocol

TEST-357: The interim `deferred:`-prefixed failure is no longer the deferral path
  Given: The shipped interim protocol (sprint-012 Adjudication 6): reply → `corpus job log <id>
  "deferred: …"` → `corpus queue fail --reason "deferred:…"` → `corpus job retry`
  When: SERVER-030 lands
  Then: The deferral path is the new transition. Whether `queue fail --reason "deferred:…"` is
  **removed**, left as a legacy no-op, or left working but no longer instructed, is stated explicitly
  and consistently in the log, the CLI help, and the regenerated `docs/cli.md`. Two documented ways to
  defer is the outcome to avoid.

TEST-358: `corpus job retry` still works, and its role is stated
  Given: The new transition
  When: `corpus job retry` is run against (a) a deferred event and (b) a genuinely failed event
  Then: Both still re-enter `pending`. §7 names `job retry` in the force-break bullet, and it remains
  the **manual** escape hatch — the operator's override for an event that automatic re-entry did not
  reach (a stale deferral, a lock released out of band). Automatic re-entry supplements it; it does
  not delete it.

TEST-359: An orchestrate-skill rider is filed, and SKILL.md is not edited by server-dev
  Given: SERVER-030's fourth acceptance criterion — *"the orchestrate skill's deferral section is
  updated to the new protocol (AGENT rider)"* — and sprint-014 Adjudication 6, under which only
  agent-runtime owns the core skills
  When: SERVER-030 completes
  Then: `git diff assets/workspace/` from server-dev is **empty**, and an issue file exists in
  `issues/agent-runtime/` naming: the orchestrate skill's deferral paragraph, the interim protocol it
  replaces, and the pinned template assertion
  `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)` — which constrains how the new
  verb may be named in the comment skill (sprint-014 Adjudication 11 keeps queue terminal state with
  orchestrate). It is added to `issues/PLAN.md`. Executing it is an orchestrator call; agent-runtime
  is not in this batch.

TEST-360: The template suite stays green and no allowlist entry appears
  Given: A new CLI verb in `docs/cli.md` and unchanged skill text
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` runs
  Then: Green with `CLI_COMMANDS_PENDING_CLI_006` still `[]`.

#### E. What SERVER-030 landing changes in SPEC §7 — recorded, not edited

TEST-361: The three spent §7 sentences are identified and routed, and SPEC.md is untouched
  Given: §7's status list (`pending → in-progress → processed | failed`; `abandoned`), the lock
  bullet's *"fails the event with a `deferred:`-prefixed reason … A dedicated defer/requeue queue
  state … is planned (SERVER-030); until then …"*, and the force-unlock bullet's *"stays retryable
  (`corpus job retry`)"*
  When: The transition ships
  Then: `git diff SPEC.md` from the implementing agent is **empty**. The log records all three
  sentences with the replacement wording the amendment will need — the status set gains the new
  state, the interim clause is retired, and force-break becomes automatic re-entry with `job retry`
  as the manual override — and names where the amendment is routed (spec-writer + user sign-off; see
  Open Conflicts).

#### F. Regression

TEST-362: Existing queue and lock behavior is unchanged
  Given: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/queue apps/server/src/locks`
  When: Run
  Then: Green. `processed`, `failed`, `abandoned`, `claim-all` atomicity, `reap-stale`, and the HALT
  sentinel all behave exactly as before; every test that pins the old status set is updated
  deliberately, listed in the log with its reason, and none is deleted to make the suite green.

TEST-363: The queue store's on-disk layout stays reconstructible and gitignored correctly
  Given: The new state's directory under `.corpus/queue/`
  When: A fresh workspace is initialized and inspected
  Then: It is created by the scaffold alongside the existing status directories with its `.gitkeep`,
  and `init/index.test.ts`'s `tracks the queue skeleton and the install manifest, and nothing else
  under .corpus` is updated in lockstep if the set of tracked `.gitkeep`s changes. **This test is
  also touched by CLI-013** — see Cross-Issue Tests.

TEST-364: The model actually used is recorded
  Given: The E2E Verification Log
  When: Read
  Then: It states `implemented on: opus | fable`.

---

## Cross-Issue Tests

TEST-365: The init scaffold's queue skeleton is reconciled once, not twice
  Given: CLI-013 touches `init/index.test.ts` (the guard) and SERVER-030 may add a queue status
  directory that the same test enumerates (`tracks the queue skeleton and the install manifest, and
  nothing else under .corpus`)
  When: Both land
  Then: The test reflects both changes and is green on the merged tree. This is the one file the two
  stages can collide on; whoever lands second reconciles rather than reverts.

TEST-366: No agent edited SPEC.md
  Given: `git diff SPEC.md` across all three issues
  When: Inspected
  Then: **Empty.** All three §7 amendment candidates are recorded in logs and routed (Open Conflicts
  3 and 5); none is applied by an implementing agent. Spec text changes need spec-writer plus user
  sign-off.

TEST-367: No agent amended `packages/contract` in place
  Given: `git diff packages/contract`
  When: Inspected
  Then: Empty, unless the orchestrator explicitly sequenced a CONTRACT rider ahead of the work and
  said so. Otherwise a needed shape change is an escalation (Open Conflicts 1 and 5).

TEST-368: No agent ran a state-changing git command
  Given: Every agent's transcript and the repository's reflog
  When: Audited
  Then: No `git commit`, `push`, `checkout`, `reset`, `stash`, `mv`, or `rm` by an implementing
  agent. Sprint-012 Adjudication 20 and sprint-013 Adjudication 24 both recorded breaches; CLI-013's
  own subject matter makes this sprint the worst possible one for a repeat.

TEST-369: The repository is clean of scratch escape
  Given: `git -C <repo> status --porcelain` at the end of each session
  When: Read
  Then: Only intended source edits appear. No `.corpus/`, no scaffolded `data/`, no clobbered
  `README.md`/`.gitignore`, no stray `.claude/skills/` entries. Given the CLI-014 incident this is
  checked and pasted by **every** agent in this batch, not just CLI-013's.

TEST-370: Ports and processes are clean, and `8765` was never touched
  Given: The end of each session
  When: `lsof -nP -iTCP:<port> -sTCP:LISTEN` is run for each allocated port and for `8765`
  Then: Nothing bound that the agent started; no orphaned vitest workers (`ps aux | grep vitest`);
  and whatever is on `8765` is **exactly as it was** — never bound by an agent, never killed.

TEST-371: `docs/cli.md` regenerates cleanly on the merged tree
  Given: Every stage merged
  When: The orchestrator runs `npm run docs:cli -w apps/cli` and the artifact-drift check
  Then: `corpus init`'s new flags, and any new CLI verbs from CLI-011/SERVER-030, are documented; the
  check is green after commit; every `corpus …` invocation in every template markdown file still
  resolves with `CLI_COMMANDS_PENDING_CLI_006` still `[]`.

TEST-372: The repo-wide gate passes at harvest
  Given: The merged tree
  When: The orchestrator runs the single repo-wide `npm run coverage`
  Then: Lint, format, typecheck, unit tests, e2e and the ≥90% four-metric merged gate all pass, with
  no new per-path coverage exemption added to `scripts/coverage-config.ts`.

---

## Out of Scope

- **Any SPEC.md edit.** Three §7 amendment candidates are produced by this batch and all three are
  routed, not applied (Open Conflicts 3 and 5).
- **Any in-place `packages/contract` amendment.** Standing rule since sprint-008.
- **Executing the two AGENT riders.** CLI-011's genesis-charter upgrade and SERVER-030's
  orchestrate-skill deferral rewrite are **filed** here (TEST-339, TEST-359); agent-runtime is not in
  this batch and running it would collide with the skills both riders touch.
- **`corpus tree` / `corpus search`.** `corpus doc list` is the enumeration verb CLI-011 charters.
  `GET /api/tree` still has no CLI wrapper and gets none here.
- **Item-level anchored commenting (PLUGINS-003)** and everything gated on **SHARED-004**
  (AGENT-005, UI-017, UI-018, UI-019). Different wave.
- **Tightening `splitTrace`'s leniency** — still `issues/ui/013-pr10-minor-findings.md` finding (11).
- **A new exit code for refusals.** `UsageError` → exit 2 is the shipped posture and CLI-013 keeps
  it; `EXIT_CODES` is generated into `docs/cli.md` and adding a code is a bigger change than this
  bug fix warrants (Adjudication 6).
- **`corpus init --dry-run`.** Symmetry with `workspace upgrade` is attractive; it is not what any
  of the three incidents needed (Adjudication 7).
- **Upgrading the enclosing-*workspace* warning to a refusal** (`index.ts:86-92`). The
  enclosing-*repository* case is in scope (TEST-308) because it is the incident mechanism; the
  nested-workspace warning is a different, non-destructive hazard (Adjudication 8).
- **Publishing to npm.** Still a user decision; the package name is still provisional.

---

## Integration Points

- **CLI → every other agent's setup.** Until CLI-013 lands, `corpus init` scaffolds `process.cwd()`
  and discards `--workspace`. Every issue's scratch setup uses the subshell-`cd` form.
  **Producer**: CLI-013. **Consumers**: CLI-011, SERVER-030, the evaluator.
- **Contract → CLI-011.** A skill-creation write path accepting a document root outside `data/docs/`.
  Does **not** exist today. **Producer**: escalated CONTRACT + SERVER riders. **Consumer**: CLI-011's
  `corpus skill create`. See Open Conflict 1.
- **Docs list route → `corpus doc list`.** The shipped route `useDocs` consumes, with `extra` on
  every row. No new surface. **Producer**: CONTRACT-011 + the docs list route (shipped).
  **Consumer**: CLI-011.
- **Contract queue status enum → SERVER-030 → the console.** The enum lives in `packages/contract`,
  the store writes it, the console renders it. All three move together or the transition is
  invisible. **Producer**: escalated CONTRACT rider. **Consumers**: server queue store, console UI,
  CLI verb. See Open Conflict 5.
- **Locks → the queue.** Release, force-break and reap each become triggers that re-enter deferred
  events. This is a **new coupling** between two subsystems that are independent today.
  **Producer**: SERVER-030. **Consumer**: the queue store.
- **CLI-011 and SERVER-030 → SPEC §7.** Each lands a capability an amended §7 sentence names as
  pending. **Producer**: this batch (as recorded findings). **Consumer**: spec-writer, at the phase
  PR, with user sign-off.

---

## Open Conflicts — orchestrator decision required

### 1. `corpus skill create` has no server route, and cannot get one inside a CLI issue (**P0 — ESCALATED → RULED, see Adjudication 13**)

> **Correction (2026-07-30, sprint-planner).** The claim below that "no route exists" was inherited
> from sprint-014's Open Conflict 1 and is **wrong as of this branch**: `POST /api/skills` is already
> defined in `packages/contract/src/routes/skills.ts:66-69` and listed in `inventory.ts:82`
> (CONTRACT-020). What is genuinely missing is the **server handler** — hence SERVER-036. The
> escalation was still correct in substance (a CLI issue cannot ship this alone; it needs a
> root-aware server write path), and the orchestrator ruled it into a three-commit chain.
> The rest of this section is preserved as the reasoning that produced that ruling.


CLI-011 is filed in the `cli` domain and its own summary hedges: *"likely a contract rider for the
route"*. It is not a hedge — it is the whole issue. Sprint-014's Open Conflict 1 established against
the shipped tree that `apps/server/src/core/paths.ts`'s `normalizeDocFolder` unconditionally prefixes
`DOCS_ROOT` and throws `PathTraversalError` otherwise; `write.ts:347`'s `resolveFolder` turns that
into a 400; `corpus doc move` refuses skills; and `apps/cli/src/commands/skill/` holds only
`rollback.ts`. The only write path touching `.claude/skills/` is archive, on a document already there.

So `corpus skill create` needs a **new server write path** (a second document root that accepts
creates, with its own traversal guard) **and** a **contract route definition** — and sprint-014
Adjudication 3's standing rule forbids an implementing agent amending `packages/contract` in place.
A cli-dev agent handed this issue as written has three exits and two of them are bad: escalate
(correct), write the file from the CLI (breaks the CLI-only/server-sole-writer invariant the verb
exists to uphold), or defeat `normalizeDocFolder` from the client side (same breach, better hidden).

**Options**: (a) Split CLI-011 into CONTRACT-0xx (route def) → SERVER-0xx (write path + skills root)
→ CLI-011 (the verb), sequenced; ship `corpus doc list` from CLI-011 now, since it is independent and
unblocked. (b) Schedule the whole chain in this wave as three coupled issues — realistic only if the
orchestrator wants three sessions on it. (c) Ship `corpus doc list` only and re-file skill creation.

**Recommendation: (a).** It is the contract-first ladder the repo already runs, it unblocks the half
of CLI-011 that has real value today (the agent has never had an enumeration verb — sprint-014 Open
Conflicts 1 *and* 2 both name the gap), and it keeps the skills-root traversal guard in the server
where CLI-013 is simultaneously proving such guards belong. **This is escalated, not decided**: the
split changes the phase's issue graph, which is the orchestrator's call. Until it is ruled,
TEST-326–TEST-332 are `STRUCK → Open Conflict 1` and CLI-011 ships as `corpus doc list`.

### 2. A green test blesses exactly what CLI-013 must forbid (**blocking CLI-013's guard, DECIDED**)

`apps/cli/src/commands/init/index.test.ts:152` — `reuses an existing repository instead of
re-initializing it` — creates a git repo on branch `trunk` with a committed `notes.txt`, runs init
into it, and asserts success (`report.repository === "reused"`, two commits, branch preserved). That
is a **non-empty git repository**, precisely the case TEST-305/TEST-306 must refuse.

**Ruled (contract time): rewrite, do not delete.** The test passes `--force` and keeps asserting the
reuse-not-reinitialize branch; a **new** sibling asserts the same directory is refused without
`--force`. Both behaviors are real and both stay covered. This is TEST-321. Deleting the test to get
green is a fail. Note the reuse branch is also the *safe* half of the git story —
`isRepositoryRoot` being true is what prevents the `git init` escape of TEST-300.

### 3. CLI-011 spends a §7 sentence the user signed off (**non-blocking, needs routing — ESCALATED**)

SPEC §7's genesis bullet was amended in the SHARED-002 sign-off set to extend-plus-propose *"until
`corpus skill create` ships (CLI-011), at which point the agent creates the skill directly."* The
clause is transitional by construction, so shipping CLI-011 makes §7 *true* while leaving it reading
like a roadmap. Two consequences: the sentence wants flattening, and the **comment skill still says
propose-only** — the behavior §7 promises does not arrive until the AGENT rider (TEST-339) runs.

**Recommendation: fold the flattening into SHARED-004's amendment set** rather than filing a
separate spec issue — SHARED-004 is the phase-5 spec pass and exists so the user reviews one coherent
diff. Note that SHARED-004's current scope (delegation, doc-abandon, context menu, view width,
§12/§2.1) does **not** include this, so its issue file needs a line added. **Escalated**: any SPEC
edit needs spec-writer authorship and user sign-off, and expanding a P0 spec issue's scope is the
orchestrator's call.

### 4. `corpus init --workspace` — honor or refuse? (**blocking CLI-013's shape, RECOMMENDED with a default**)

The issue text allows either: *"must be honored — or explicitly refused with an error telling the
user to pass the positional; silent divergence is the bug."* Both satisfy the acceptance criterion,
and they produce different CLIs.

**Recommendation: honor it**, with precedence `positional ?? --workspace ?? CORPUS_WORKSPACE ?? cwd`
— the same chain `workspace.ts:75` already implements for every other command, minus init's
positional taking the front. Reasons: `--workspace`'s own help text says *"Workspace to act on,
instead of searching upward from the current directory"*, which reads as a target, not a search hint;
refusal leaves a global flag that every command but one accepts; and honoring it is what the three
incident operators (including this harness) actually meant each time. Refusal is defensible on the
grounds that init *creates* rather than *acts on* a workspace — if the orchestrator prefers it,
TEST-301's second branch governs and nothing else in the ladder changes.

**Default if unruled: honor.** The implementing agent proceeds on the recommendation and records it;
this is a shape preference, not an architectural fork, and blocking a destructive-bug fix on it would
be the wrong trade.

### 5. SERVER-030 cannot ship inside the `server` domain alone (**P0 — ESCALATED → RULED, see Adjudication 14**)

The issue file already says it: *"Contract (route/schema) and CLI (verb) riders are expected — split
them out as coupled issues when this is scheduled."* They were never split. SPEC §7 pins the status
set as `pending → in-progress → processed | failed` plus `abandoned`; that enum lives in
`packages/contract`, the console renders from it, and entering the new state needs a CLI verb. A
server-dev agent alone can move files under `.corpus/queue/` but cannot make the state legible to the
API, the console, or the agent.

**Options**: (a) Split into CONTRACT (enum + route/schema) → SERVER-030 (store + lock triggers) →
CLI (verb) → UI (console treatment), sequenced. (b) Grant SERVER-030 a scoped, orchestrator-approved
contract edit for the enum only, keeping everything else in domain. (c) Defer SERVER-030 to a later
wave and leave the interim protocol standing.

**Recommendation: (a), or (b) if the orchestrator wants it in this wave.** (b) is a real option here
because the contract change is genuinely one enum member plus its schema echo, and the standing
no-contract-edits rule exists to prevent *unilateral* shape changes, not orchestrator-sequenced ones.
**Escalated either way** — it changes the issue graph. Until ruled, SERVER-030 should not start:
unlike CLI-011, it has no independently shippable half.

### 6. SERVER-030 spends two more §7 sentences and the status list (**non-blocking, needs routing — ESCALATED**)

§7's lock bullet names the interim protocol *and* its own replacement (*"planned (SERVER-030); until
then …"*); the force-unlock bullet promises *"stays retryable (`corpus job retry`)"*; and §7's status
enumeration omits the new state. All three want amending when the transition lands. **Same
recommendation and same escalation as Open Conflict 3**: route into SHARED-004's set, spec-writer
authored, user signed off, applied by the orchestrator — never by server-dev (TEST-361).

### 7. CLI-011's dependency row disagrees with its issue file (**trivial, bookkeeping**)

`issues/PLAN.md` says `CLI-003`; the issue file says `CLI-006, SERVER-019`. One of them is wrong and
a wrong dependency row is how a blocked issue gets scheduled as ready — which is arguably how this
one reached a "ready" batch with an unbuilt server route under it. The orchestrator corrects one
(TEST-325).

---

## Orchestrator Adjudications (2026-07-29)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

### Pre-ruled at contract time

1. **`8765` is never bound and never killed, by anyone.** The maintainer's personal server lives
   there. Every `corpus init` passes `--port` explicitly, because init's default probes upward from
   8765. Stricter than sprint-014's "must stay unbound" — this is now live user data.
2. **Scoped tests only**, `VITEST_MAX_THREADS=4`, one workspace-scoped run per session maximum, one
   heavy command at a time, nobody runs `npm run e2e` or `npm run coverage`. The orchestrator's
   harvest run is the single repo-wide gate. Carried forward from sprints 012–014.
3. **All scratch lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`**, one prefix per
   issue, never inside the repository, never glob-deleted.
4. **Every `corpus init` uses the subshell-`cd` form until CLI-013 lands**, and **CLI-013's own E2E
   runs from a cwd outside this repository**. This is the direct, non-negotiable lesson of the
   2026-07-29 CLI-014 drill.
5. **No implementing agent edits SPEC.md or `packages/contract`.** Spec text is spec-writer plus user
   sign-off; contract shapes are orchestrator-sequenced riders. Both are escalations (TEST-366,
   TEST-367).
6. **Refusals keep `UsageError` → exit 2, `code: "usage_error"`.** No new exit code. `EXIT_CODES`
   generates into `docs/cli.md` and `errors.test.ts` pins the class→code map; a refusal is a usage
   error and the existing init refusals already use it.
7. **`corpus init --dry-run` is out of scope.** Not what any of the three incidents needed.
8. **The enclosing-*workspace* warning stays a warning.** `index.ts:86-92` inspects
   `dirname(target)` and warns about nesting; that hazard is confusing, not destructive. The
   enclosing-*repository* case **is** in scope (TEST-308) because it is the incident mechanism.
9. **CLI-013 runs alone, first, before the other two start.** It changes `corpus init`, which is the
   setup step of every other issue's E2E. Two concurrent implementation agents remain the cap;
   stage A makes it one.
10. **The two AGENT riders are filed, not executed.** agent-runtime is not in this batch and both
    riders touch the same skill files (TEST-339, TEST-359).
11. **Deleting a test to reach green is a fail, in every issue.** Inversions are deliberate, listed
    in the E2E log with reasons, and keep both branches covered (TEST-321, TEST-322, TEST-362).
12. **The artifact-drift check cannot be green inside a worktree.** Record the red output verbatim
    with the reason and drive the regenerate-and-compare half against a pre-run snapshot; the
    orchestrator's post-commit run is authoritative. Accepted pattern since CONTRACT-008.

### Ruled by the orchestrator (2026-07-30)

13. **Conflict 1 → contract-first split, three commits.** `POST /api/skills` is defined by
    **CONTRACT-020** (`packages/contract/src/routes/skills.ts`, alongside the existing
    `POST /api/skills/{name}/rollback`), implemented by **SERVER-036** (a sanctioned root-aware seam
    — *not* a `normalizeDocFolder` bypass, reusing the rollback handler's skills-root conventions:
    path derivation, synthetic `doc_skill<hex>` ids, name-pattern traversal guard), and only then
    consumed by CLI-011's verb. Sequence: **CONTRACT-020 → SERVER-036 → CLI-011**.
    `corpus doc list` is unblocked and ships from CLI-011 regardless.
    TEST-324's audit now has a decisive answer: the route **exists in the contract**; the CLI agent
    verifies SERVER-036 has landed before writing the verb. TEST-326–TEST-332 are **live**, not
    struck, once SERVER-036 is done.
14. **Conflict 5 → contract rider filed.** **CONTRACT-021** defines the deferred status enum value
    and its transition metadata, scoped strictly to what §7's amended deferral paragraph describes —
    no speculative states — and enumerates consumer impact (server handlers, console rendering, CLI
    verbs) so the downstream riders are filed with real scope. **SERVER-030 depends on CONTRACT-021**
    and does not start before it lands. TEST-344's audit is answered by CONTRACT-021's log.
15. **Conflict 7 → PLAN corrected.** CLI-011's dependency row now reads `CLI-006, SERVER-019,
    SERVER-036`; the stale `CLI-003` is gone. TEST-325 is satisfied by that correction.

**Consequence for the merge order below**: wave 1 is no longer three issues. It is
CLI-013 (alone, first) · CONTRACT-020 → SERVER-036 → CLI-011 · CONTRACT-021 → SERVER-030.
The two contract issues are `in_progress` as of 2026-07-30.

_(Conflict 4 — `--workspace` honor vs. refuse — stands on its stated default: **honor**, precedence
`positional ?? --workspace ?? CORPUS_WORKSPACE ?? cwd`. The implementing agent proceeds and records
it; a later orchestrator preference for refusal only swaps TEST-301's branch.)_

---

## Merge order (recommendation)

1. **Stage A, one cli-dev session, alone**: CLI-013. Reproduce first (TEST-298–TEST-300), from a safe
   cwd; then fix; then re-run the reproductions (TEST-313–TEST-315). Commit as `[CLI-013]` before
   anything else starts.
2. **Rule Open Conflicts 1, 4 and 5** — 4 before stage A begins (or let its default stand), 1 and 5
   before stage B is scheduled at all.
3. **Stage B**: `corpus doc list` (CLI-011's unblocked half) and, if the riders were sequenced,
   the skill-create chain and the SERVER-030 chain. If neither chain is ruled in, stage B is
   `corpus doc list` alone and the rest moves to wave 2.
4. **Harvest**: orchestrator regenerates `docs/cli.md` on the merged tree, runs the single repo-wide
   gate, then `/audit` (CLI-013 qualifies: P1 and destructive-bug class) and the evaluator.

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- CLI-013's pre-fix reproductions and post-fix refusals are both in its E2E log, with hashes
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest with no new exemptions
- `git status` is clean of scratch escape and `8765` is untouched
- Every escalated Open Conflict is either ruled or explicitly carried to wave 2

---

**Orchestrator correction (2026-07-30):** TEST-328 predicted the skill-create id as the
projection's synthetic `doc_skill<8 hex>`; it was written before CONTRACT-020 existed.
The signed contract (CONTRACT-020 route text) and SERVER-036's shipped behavior mint a
`doc_<base32>` id server-side (rationale in SERVER-036's log: a path-derived id would
change on archive). TEST-328 is evaluated against the minted-id behavior; the synthetic
id remains the fallback for hand-written SKILL.md files that declare none.
