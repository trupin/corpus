# [CLI-001] CLI scaffold: bin, declarative command registry, workspace resolution, typed client

## Domain
cli

## Status
in_progress

## Priority
P0

## Model
opus — structure pinned by SHARED-001's acceptance criteria (registry-driven self-documentation, server-lifecycle error surface); no open design judgment, just careful scaffolding.

## Dependencies
- Depends on: CONTRACT-001, INFRA-007
- Blocks: CLI-002, CLI-003, CLI-004, PLUGINS-001

## Spec References
- SPEC.md §3 (tech stack) — **as revised by SHARED-001**: the CLI is TypeScript, not the pre-pivot "plain Node ESM `.mjs`, zero runtime deps"
- SPEC.md §4 (repository layout, workspace config) — as revised
- SHARED-001 acceptance criteria — CLI self-documentation (single declarative registry drives dispatcher + `--help` + generated `docs/cli.md` with drift check), server-lifecycle error surface
- CLAUDE.md — Architecture Decisions 2 (server is sole writer), 3 (contract-first), 5 (bearer-token auth)

## Summary
Stand up `apps/cli` as the `corpus` binary: a **declarative command registry** that is the single source of truth for the command surface, a dispatcher and help renderer driven by it, a generated-and-committed `docs/cli.md` with a drift check (the CLI mirror of `openapi.json`), workspace resolution by walking up from cwd to `.corpus/config.json`, and typed-client wiring from `@corpus/contract/client` with the workspace bearer token. This issue ships **zero product verbs** — it ships the frame that CLI-002/003/004 and plugin verbs slot into, plus the cross-cutting contracts every later verb inherits: consistent error surface, `--json` machine-readable output for the product agent, and conventional exit codes.

The CLI is a **thin HTTP client**. It performs no file writes of any kind; every mutation is a call to the server. The only filesystem reads it is permitted are workspace discovery (`.corpus/config.json`) and reading input bodies the user points it at (`--file`, stdin).

## Acceptance Criteria
- [x] `apps/cli` exposes a `corpus` bin (package.json `bin`), runnable as `corpus` after `npm link`/global install and as `npm run corpus -w apps/cli` in-repo.
- [x] A single declarative registry (`apps/cli/src/registry/`) describes every command: topic, verb, positional args (name, required, description), flags (name, alias, type, default, description), one-line description, long description, and at least one runnable example — with a `handler` reference.
- [x] The dispatcher resolves `corpus <topic> <verb> [args] [flags]` from the registry alone; unknown topic/verb and malformed flags produce a usage error listing valid alternatives, exit code 2.
- [x] `--help` works at three levels and is rendered **entirely from the registry**: `corpus --help` (topics), `corpus <topic> --help` (verbs), `corpus <topic> <verb> --help` (args, flags, examples). `corpus --version` prints the package version.
- [x] `npm run docs:cli -w apps/cli` generates `docs/cli.md` from the registry; the file is committed and marked `linguist-generated`. Generation is idempotent (run twice → byte-identical).
- [x] Pre-push **and** CI fail when `docs/cli.md` is stale relative to the registry (regenerate + `git diff --exit-code`), with a message naming the fix command.
- [x] Workspace resolution walks up from cwd (or `--workspace <path>` / `CORPUS_WORKSPACE`) to the nearest directory containing `.corpus/config.json`, and exposes `{ root, port, token }`. Outside a workspace: an actionable error ("not inside a Corpus workspace — run `corpus init` here or pass --workspace"), exit code 3.
- [x] A `createClient()` helper builds the `@corpus/contract/client` typed client against `http://127.0.0.1:<port>` with `Authorization: Bearer <token>`; commands never construct `fetch` calls by hand.
- [x] Error surface is uniform: connection refused/ECONNREFUSED → "server not running for this workspace — run `corpus server start`" (exit 4); 401 → token mismatch guidance (exit 5); other non-2xx → the server's typed problem rendered as `<status> <code>: <message>` plus details (exit 5); unexpected exceptions → exit 1 with a stack only under `--verbose`.
- [x] Global `--json` flag: on success exactly one JSON value is written to stdout and nothing else; on failure a JSON problem object (`{"error":{"code","message","details"}}`) is written to **stderr** and the exit code is unchanged. Without `--json`, success is quiet (human-readable one-liners only).
- [x] Exit codes are centrally defined and documented in `docs/cli.md`: 0 success · 1 internal error · 2 usage error · 3 not in a workspace · 4 server unreachable · 5 server returned an error · 6 command-specific "check failed" (used later by `doc check` / `db doctor` in hooks).
- [x] Vitest suite covers registry validation, dispatcher resolution, help rendering, workspace resolution, error mapping, and docs generation idempotence.

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **`.corpus/config.json` canonical shape**: `{version: 1, port: number, host?: string (default "127.0.0.1"), token: string, dataDir?: string (default "data")}` — parse non-strictly. E2E fixtures use 32+ character tokens so hand-made workspaces are ones a real server accepts.
2. **One built-in verb authorized**: `corpus health` — registry-visible, self-documenting in `docs/cli.md`, calls `GET /api/health` through the typed client. This is the registry→dispatch→workspace-resolution→client→socket proof. Because health is unauthenticated, the 401 mapping is proven against the test stub here and re-proven against a real guarded route in CLI-002.
3. **CI drift step**: you are blessed to edit `.github/workflows/ci.yml` (normally infra domain) to add ONE step, `generated artifacts drift` (regenerate + `git diff --exit-code`), right after build, covering BOTH `packages/contract/openapi.json`/`schema.generated.ts` AND `docs/cli.md`. The pre-push hook and the CI step must consume one shared list (a script), not two drifting copies.

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **`.corpus/config.json` canonical shape**: `{version: 1, port: number, host?: string (default "127.0.0.1"), token: string, dataDir?: string (default "data")}` — parse non-strictly. E2E fixtures use 32+ character tokens so hand-made workspaces are ones a real server accepts.
2. **One built-in verb authorized**: `corpus health` — registry-visible, self-documenting in `docs/cli.md`, calls `GET /api/health` through the typed client. This is the registry→dispatch→workspace-resolution→client→socket proof. Because health is unauthenticated, the 401 mapping is proven against the test stub here and re-proven against a real guarded route in CLI-002.
3. **CI drift step**: you are blessed to edit `.github/workflows/ci.yml` (normally infra domain) to add ONE step, `generated artifacts drift` (regenerate + `git diff --exit-code`), right after build, covering BOTH `packages/contract/openapi.json`/`schema.generated.ts` AND `docs/cli.md`. The pre-push hook and the CI step must consume one shared list (a script), not two drifting copies.

4. **Post-eval edge pin (2026-07-26)**: `port` is optional with default `8765` — the CLI reader must accept `{"version":1,"token":"..."}` exactly as the server does (the evaluator found the CLI rejecting a portless config the server accepts). `host` stays schema-opaque in the CLI; loopback enforcement is the server's boot-time concern.

## Technical Design

### Files to Create/Modify
- `apps/cli/package.json` — `bin: { "corpus": "./dist/bin/corpus.js" }` (or `bin/corpus.js` shim invoking the built entry), `docs:cli` script, dependency on `@corpus/contract`
- `apps/cli/src/bin/corpus.ts` — entry: parse argv, dispatch, map thrown errors to exit codes
- `apps/cli/src/registry/types.ts` — `CommandSpec`, `FlagSpec`, `ArgSpec`, `TopicSpec`, `Registry` types
- `apps/cli/src/registry/index.ts` — the root registry: assembles topic modules; CLI-002/003/004 add their topic modules here
- `apps/cli/src/registry/validate.ts` — structural validation of the registry (unique names, every command has description + ≥1 example, flags well-formed)
- `apps/cli/src/dispatch.ts` — argv → resolved command + parsed args/flags
- `apps/cli/src/parse-args.ts` — small flag parser driven by the command's `FlagSpec[]` (no external arg-parsing dependency that would fork the source of truth)
- `apps/cli/src/help.ts` — renders topic/verb/command help from the registry
- `apps/cli/src/workspace.ts` — upward search for `.corpus/config.json`, config schema (Zod), env overrides
- `apps/cli/src/client.ts` — `createClient(workspace)` over `@corpus/contract/client`
- `apps/cli/src/errors.ts` — `CliError` hierarchy + `ExitCode` enum + error→exit mapping + problem rendering
- `apps/cli/src/output.ts` — `emit(value)` / `emitHuman(line)` honouring `--json`, `--no-color`
- `apps/cli/scripts/generate-docs.ts` — registry → `docs/cli.md` (run with `tsx`)
- `docs/cli.md` — generated, committed
- `.gitattributes` — mark `docs/cli.md` `linguist-generated`
- `.githooks/pre-push` — add the `docs/cli.md` drift check next to the `openapi.json` one
- `.github/workflows/ci.yml` — same drift check in `CI / validate`
- `apps/cli/src/**/*.test.ts` — colocated Vitest specs

### Key Implementation Details
**Registry shape.** A command is data, not code-with-metadata-attached:

```ts
interface CommandSpec {
  name: string;                 // verb, e.g. "create"
  summary: string;              // one line, used in help + docs
  description?: string;         // paragraph for `--help` and docs/cli.md
  args: ArgSpec[];              // positionals, in order
  flags: FlagSpec[];            // topic-local flags; globals merged in by the renderer
  examples: Example[];          // { command: string; description: string } — at least one
  handler: (ctx: CommandContext) => Promise<void>;
}
```

`CommandContext` carries `{ args, flags, workspace, client, out }` — handlers never touch `process.argv`, `process.env`, or `fetch` directly, which is what makes them testable and keeps the docs honest. `registry/validate.ts` runs at module load in dev/test (and inside `generate-docs.ts`) so a malformed registry fails loudly rather than producing bad help text.

**Global flags** (`--json`, `--workspace <path>`, `--verbose`, `--no-color`, `--help`, `--version`) are declared once and merged into every command's flag set by the parser and the help renderer; a topic flag may not shadow a global name (registry validation enforces this).

**Docs generation.** `generate-docs.ts` walks the registry and emits a deterministic markdown document: a table of contents, one `##` section per topic, one `###` per command with synopsis line, arguments table, flags table, examples in fenced blocks, and a trailing "exit codes" appendix. Determinism requires sorting topics/commands by name and emitting no timestamps. Header line: `<!-- Generated by \`npm run docs:cli -w apps/cli\` — do not edit by hand. -->`.

**Workspace resolution.** From `--workspace` ?? `CORPUS_WORKSPACE` ?? `process.cwd()`, walk up until `.corpus/config.json` is found or the filesystem root is reached. Parse it with a Zod schema (`{ version: 1, port: number, token: string, dataDir: string }`) — a malformed config is its own error ("workspace config is invalid: <zod issue>", exit 3), not a crash. `CORPUS_PORT` / `CORPUS_TOKEN` override the file values (useful for tests and remote-server setups later).

**Client wiring.** `createClient()` returns the generated typed client bound to base URL + auth header, wrapped so that every call funnels through one `request()` helper that (a) classifies transport failures (`ECONNREFUSED`/`ECONNRESET`/`AbortError`) into `ServerUnreachableError`, and (b) turns non-2xx typed problem responses into `ServerError` carrying status/code/message/details. Handlers therefore write straight-line `await client.POST(...)` code with no error plumbing.

**Lazy workspace.** Commands declare `requiresWorkspace: boolean` (default `true`); `corpus init`, `--help`, and `--version` set it `false` so they run outside a workspace. The dispatcher resolves the workspace and builds the client only for commands that need them.

**Topic extension.** Registry modules are plain exports (`export const docTopic: TopicSpec = {...}`), imported and listed in `registry/index.ts`. Plugin-contributed verbs (PLUGINS-001) will register through the same shape, so nothing here may assume a closed set.

### Edge Cases
- `corpus` with no arguments → prints top-level help, exit 0 (not an error).
- Unknown topic or verb → usage error listing the valid names, plus a "did you mean" suggestion when edit distance ≤ 2; exit 2.
- `--json` combined with `--help` → help is still human text (help is not data); document this in `docs/cli.md`.
- Config file exists but is unreadable (permissions) → exit 3 with the OS error, not a stack trace.
- Nested workspaces: the **nearest** ancestor wins; do not merge configs.
- Non-TTY stdout (the agent's normal case): never emit spinners, colors, or progress; `--no-color` is implied when `process.stdout.isTTY` is false.
- Registry with a command missing an example → docs generation and the test suite both fail; this is the mechanism that keeps `docs/cli.md` useful.

## Testing Strategy
Vitest in `apps/cli`, colocated:
- `registry/validate.test.ts` — rejects duplicate names, missing summaries, missing examples, flags shadowing globals.
- `dispatch.test.ts` — resolves topic/verb, parses positionals and each flag type (boolean, string, number, repeated), rejects unknown flags and missing required args with exit code 2.
- `help.test.ts` — snapshot the three help levels against a small fixture registry (not the real one, so real-registry churn doesn't break these).
- `workspace.test.ts` — temp-dir fixtures: found in cwd, found in an ancestor, not found, malformed JSON, schema violation, env overrides, nested workspaces.
- `errors.test.ts` — a stub HTTP server (real `node:http` on an ephemeral port, no mocking library) returning 401 / 500 / typed problem / closed socket; asserts the rendered message and exit code for each.
- `output.test.ts` — `--json` emits exactly one JSON value on stdout and nothing else; errors go to stderr as a problem object.
- `generate-docs.test.ts` — generating twice yields identical output; generated docs contain every registry command.

## E2E Verification Plan

### Verification Steps
1. Build/link the CLI (`npm run build -w apps/cli && npm link -w apps/cli`) and run the real binary — not `tsx src/...` — for every step below.
2. `corpus --help`, `corpus --version` from a directory that is **not** a workspace → help renders, exit 0.
3. In a non-workspace directory, run a workspace-requiring probe command → error names `corpus init`, exit code 3 (`echo $?`).
4. Hand-create a minimal workspace (`mkdir -p .corpus && printf '{"version":1,"port":8765,"token":"t","dataDir":"data"}' > .corpus/config.json`), run the probe command with no server listening → "server not running … run `corpus server start`", exit 4.
5. Start a real Hono app mounting the contract routes on that port (the CONTRACT-001 smoke app is sufficient); run the probe with the correct token → success; with `CORPUS_TOKEN=wrong` → 401 guidance, exit 5.
6. Run the probe with `--json` and pipe to `jq .` → parses; run it without `--json` → quiet human output.
7. From a subdirectory three levels below the workspace root → the command still resolves the workspace.
8. `npm run docs:cli -w apps/cli` → `git diff --exit-code docs/cli.md` clean. Add a flag to a registry command, attempt `git push` without regenerating → pre-push blocks with the fix command; regenerate → passes.

## E2E Verification Log

**implemented on: opus** (matches the issue's Model recommendation).

**Environment.** Worktree `.claude/worktrees/agent-a46fb635beb281fe3`, Node v25.2.1, macOS.
`npm install && npm run build && npm link -w apps/cli` → the real binary at
`/opt/homebrew/bin/corpus` (`command -v corpus`), never `tsx src/…`. Stub server: a real
`node:http` process on `127.0.0.1:8865` (sprint-002 port allocation), no mocking library.
Workspace fixture `/tmp/corpus-e2e/ws` with a real 32-character token:
`{"version":1,"port":8865,"token":"9f4c1e7a2b8d6035ae1f47c9d2b0836e","dataDir":"data"}`.
The global link was removed again afterwards (`npm unlink -g @corpus/cli`) so no dangling
`corpus` points into a worktree; re-link with `npm link -w apps/cli` to re-verify.

### Reproduction (bugs only)
_N/A — feature issue._

### Post-Implementation Verification

**TEST-42 — the real binary runs outside a workspace.** From `/tmp`:
`corpus --version` → `0.0.0`, exit `0`. `corpus --help` → topic/command listing, exit `0`.
Bare `corpus` → the same top-level help, exit `0` (not an error).

**TEST-43 — help at three levels, entirely from the registry.** `corpus --help` lists
`Commands: health  Check that this workspace's server is up and answering.` plus the seven
global flags. `corpus health --help` shows the synopsis `corpus health [flags]`, the merged
globals and all three examples. Every string traces to a registry field: `summary`,
`description`, `FlagSpec.description`, `Example.command/description` — the renderer contains
no command names (`apps/cli/src/help.ts`).
_Partially deferred_: the **topic** level (`corpus <topic> --help`) cannot be exercised
against the shipped registry because CLI-001 ships one top-level command and zero topics
(sprint-002 Out of Scope: every product verb is CLI-002/003/004). `DEFERRED → CLI-002` for
the shipped registry. Substitute evidence, all through the same renderer the binary uses:
`help.test.ts` snapshots all three levels against a topic-bearing fixture registry, and
`run.test.ts` drives `run()` with that fixture for `corpus --help`, `corpus widget --help`
and `corpus widget show --help`, asserting `Topics:` / `Verbs:` / the verb synopsis.

**TEST-44 — unknown names, exit 2.**
`corpus nosuchtopic` → `corpus: unknown command "nosuchtopic".` / `Valid: health. Run
\`corpus --help\`.`, exit `2`. Near miss `corpus helth` → `Did you mean "health"? Valid:
health.`, exit `2`. Unknown verb inside a topic is covered against the fixture registry in
`run.test.ts` (`unknown verb "nosuchverb"`, exit 2) — no shipped topic exists yet.

**TEST-45 — registry-driven parsing.** Unknown flag against the real binary:
`corpus health --nosuchflag` → `unknown flag "--nosuchflag" for "health".` +
`Known flags: --json, --workspace, --timeout, --verbose, --no-color, --help, --version`,
exit `2`. The typed matrix (boolean / string / number / repeated + required positional)
runs against the fixture command in `parse-args.test.ts`: `--loud`, `-l`, `--title=Hello`,
`--count 7`, `--tag a --tag b` → `true`, `"Hello"`, `7`, `["a","b"]`; defaults applied;
missing positional and extra positional both exit `2`. A flag shadowing a global fails
registry validation (TEST-49).

**TEST-46 — workspace resolution.** From `$WS/a/b/c` the command resolves `$WS`
(`Nothing answered at http://127.0.0.1:8865.` proves it read that workspace's port). From
`/tmp`: `corpus: not inside a Corpus workspace — run \`corpus init\` here or pass
--workspace`, exit `3`. `--workspace $WS` from `/tmp` succeeds. Malformed JSON →
`workspace config is invalid: …/config.json is not valid JSON (Expected property name …)`,
exit `3`, no stack. Schema violation (`"version":2`) → `workspace config is invalid: … —
version: Invalid input: expected 1`, exit `3`. Nested workspaces (nearest wins, no merge)
and `CORPUS_PORT`/`CORPUS_TOKEN`/`CORPUS_WORKSPACE` overrides are covered in
`workspace.test.ts` against real temp directories.

**TEST-47 — down server, exit 4.** Valid workspace, nothing on 8865:
`corpus: server not running for this workspace — run \`corpus server start\`` /
`  Nothing answered at http://127.0.0.1:8865.`, exit `4`. No `ECONNREFUSED` anywhere in the
output (asserted in `client.test.ts` and `run.test.ts` too).

**TEST-48 — server errors, against the real `node:http` stub on 8865.**
- `401 {code:"unauthorized"}` → `corpus: 401 unauthorized: bearer token does not match this
  workspace` + `The workspace bearer token was rejected — check \`token\` in
  .corpus/config.json, or the CORPUS_TOKEN override.`, exit `5`.
- `404 {code:"not_found"}` → `corpus: 404 not_found: no such resource`, exit `5`.
- `400 {code:"bad_request", issues:[…]}` → the same form plus the issues rendered underneath,
  exit `5`.
- `500` with a non-contract body → `corpus: 500 http_error: Internal Server Error` plus the
  body as details, exit `5`.
- socket destroyed mid-response → `lost the connection to http://127.0.0.1:8865 before it
  answered`, exit `4`.
- hung server with `--timeout 500` → `did not answer within 500ms`, exit `4`.
- forced internal exception (a handler that throws) → exit `1`, stderr exactly
  `corpus: unexpected explosion`; with `--verbose` the stack appears (`run.test.ts`).

**TEST-49 — the registry validates itself.** `registry/validate.test.ts`: duplicate names,
missing summary, zero examples, a topic flag shadowing `--json`/`--workspace`, an alias
shadowing `-h`, repeated booleans, mistyped defaults, required-after-optional arguments —
each fails with a message naming the offending command; the shipped registry and the
fixture registry both pass with zero problems.

**TEST-50 — `--json` writes one JSON value and nothing else.**
`(cd $WS && corpus health --json 2>err) | jq .` → parses; `jq exit=0`; `stderr bytes: 0`.
Output was `{"status":"ok","version":"0.0.0","uptimeSeconds":0.206,"workspace":"/tmp/corpus-e2e/ws"}`.

**TEST-51 — `--json` failures on stderr, exit code unchanged.** Stub in `notfound` mode:
`human=5 json=5`; `stdout bytes under --json: 0`; stderr parsed by `jq`:
`{"error":{"code":"not_found","message":"404 not_found: no such resource"}}`. The same
holds for a usage error outside a workspace: `{"error":{"code":"no_workspace","message":"not
inside a Corpus workspace — run \`corpus init\` here or pass --workspace"}}`, exit `3`.

**TEST-52 — quiet on success without `--json`.** `corpus health | wc -l` → `1`; the line is
`ok — corpus 0.0.0, up 0s, workspace /tmp/corpus-e2e/ws`. No banner, no JSON.

**TEST-53 — `--help` beats `--json`.** `corpus health --help --json` printed the identical
human help text, exit `0`. Documented in `docs/cli.md` §Usage ("`--help` is a deliberate
exception to `--json` …").

**TEST-54 — no colour off a TTY.** `corpus health --help | grep -c $'\033'` → `0`. Colour is
gated on `isTTY && !--no-color`; `run.test.ts` asserts escapes appear with `isTTY: true` and
vanish with `--no-color`.

**TEST-55 — `docs/cli.md` generated, complete, idempotent.** `npm run docs:cli -w apps/cli`
twice → `shasum` identical both times (`af2516eb0dfac8b13b05ebeb1c684a244773e3db`). The file
opens with `<!-- Generated by \`npm run docs:cli -w apps/cli\` — do not edit by hand. -->`,
carries a section for every registry command with its flags and three examples, the global
flag table, and the exit-code appendix `0…6`. `.gitattributes` marks it
`linguist-generated=true`. `generate.test.ts` asserts the committed bytes equal the
generator's output, so a hand edit fails the unit suite as well as the drift check.

**TEST-56 — a stale `docs/cli.md` is blocked.** The pre-push hook and the CI `generated
artifacts drift` step both run the one shared script
`scripts/check-generated-artifacts.ts` (inventory in `scripts/generated-artifacts.ts`).
Clean tree → `✓ API contract is up to date …` / `✓ CLI reference is up to date (docs/cli.md).`,
exit `0`. After adding a `--drift-probe` flag to the health command without regenerating:
```
✗ CLI reference is stale: docs/cli.md
  Fix: npm run docs:cli -w apps/cli && git add docs/cli.md
exit=1
```
Reverting the registry change and re-running returned to exit `0` with `docs/cli.md` back at
`af2516eb…`. `git push` itself was not run — this agent never runs state-changing git
commands — but the failing command is byte-for-byte the one the hook invokes.

**TEST-57 / TEST-58 (integration path) — `DEFERRED → CLI-002`.** SERVER-003 had not landed
in this worktree, so no real `corpus` server process exists to reach. Substitute evidence:
every hop except the server implementation is real — real built binary → real
`@corpus/contract/client` (no CLI-side `fetch`; `apps/cli/src/client.ts` is the only module
that touches transport) → real TCP socket on 8865 → real `node:http` responder, with the
success body validated against the contract's `Health` shape and the failure bodies against
`ApiError`. TEST-58(b)'s real-guarded-route half is deferred by the sprint contract itself,
since `GET /api/health` is unauthenticated by spec.

**Repo gates** (pre-push hook order, Playwright step excluded — UI domain, untouched here):
`build ✓ · generated artifacts drift ✓ · eslint ✓ · prettier check ✓ · typecheck ✓ · unit
tests + coverage ✓`. Full suite: **1029 tests, 69 files, all passing**; coverage
**99.84% lines / 95.68% branches / 100% functions**, above the 90% gate. `apps/cli/src` is
100% lines / 95.38% branches.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, foundational surface for all later CLI issues)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-001]` prefix
