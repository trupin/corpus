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
- [ ] `apps/cli` exposes a `corpus` bin (package.json `bin`), runnable as `corpus` after `npm link`/global install and as `npm run corpus -w apps/cli` in-repo.
- [ ] A single declarative registry (`apps/cli/src/registry/`) describes every command: topic, verb, positional args (name, required, description), flags (name, alias, type, default, description), one-line description, long description, and at least one runnable example — with a `handler` reference.
- [ ] The dispatcher resolves `corpus <topic> <verb> [args] [flags]` from the registry alone; unknown topic/verb and malformed flags produce a usage error listing valid alternatives, exit code 2.
- [ ] `--help` works at three levels and is rendered **entirely from the registry**: `corpus --help` (topics), `corpus <topic> --help` (verbs), `corpus <topic> <verb> --help` (args, flags, examples). `corpus --version` prints the package version.
- [ ] `npm run docs:cli -w apps/cli` generates `docs/cli.md` from the registry; the file is committed and marked `linguist-generated`. Generation is idempotent (run twice → byte-identical).
- [ ] Pre-push **and** CI fail when `docs/cli.md` is stale relative to the registry (regenerate + `git diff --exit-code`), with a message naming the fix command.
- [ ] Workspace resolution walks up from cwd (or `--workspace <path>` / `CORPUS_WORKSPACE`) to the nearest directory containing `.corpus/config.json`, and exposes `{ root, port, token }`. Outside a workspace: an actionable error ("not inside a Corpus workspace — run `corpus init` here or pass --workspace"), exit code 3.
- [ ] A `createClient()` helper builds the `@corpus/contract/client` typed client against `http://127.0.0.1:<port>` with `Authorization: Bearer <token>`; commands never construct `fetch` calls by hand.
- [ ] Error surface is uniform: connection refused/ECONNREFUSED → "server not running for this workspace — run `corpus server start`" (exit 4); 401 → token mismatch guidance (exit 5); other non-2xx → the server's typed problem rendered as `<status> <code>: <message>` plus details (exit 5); unexpected exceptions → exit 1 with a stack only under `--verbose`.
- [ ] Global `--json` flag: on success exactly one JSON value is written to stdout and nothing else; on failure a JSON problem object (`{"error":{"code","message","details"}}`) is written to **stderr** and the exit code is unchanged. Without `--json`, success is quiet (human-readable one-liners only).
- [ ] Exit codes are centrally defined and documented in `docs/cli.md`: 0 success · 1 internal error · 2 usage error · 3 not in a workspace · 4 server unreachable · 5 server returned an error · 6 command-specific "check failed" (used later by `doc check` / `db doctor` in hooks).
- [ ] Vitest suite covers registry validation, dispatcher resolution, help rendering, workspace resolution, error mapping, and docs generation idempotence.

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
_[Agent fills]_

### Reproduction (bugs only)
_N/A — feature issue._

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, foundational surface for all later CLI issues)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-001]` prefix
