# [CLI-003] Doc, thread, skill and db verbs

## Domain
cli

## Status
todo

## Priority
P0

## Model
opus — thin mappings onto endpoints already pinned by the contract and the spec; the judgment (write semantics, locks, attribution) lives server-side.

## Dependencies
- Depends on: CLI-001, SERVER-005, SERVER-006
- Blocks: AGENT-003

## Spec References
- SPEC.md §7 (agent stewardship — `doc create|edit|move|archive`, deletion is user-only; skills as documents, `corpus skill rollback` loop safety)
- SPEC.md §9.2 (HTTP API — the endpoints these verbs call)
- SPEC.md §14 (validation and git hooks — `doc check --staged`, `db doctor` in pre-commit)
- CLAUDE.md — Architecture Decision 2 (server is the sole writer; CLI is a thin HTTP client)

## Summary
Ship the document-lifecycle surface the product agent actually uses to steward the corpus: `corpus doc create|edit|move|archive|delete`, `corpus thread reply|resolve|reopen`, and `corpus db rebuild|doctor`.

> **Scope adjudication (orchestrator, 2026-07-27, sprint-007 planning):** `corpus doc check` and `corpus skill rollback` are **deferred out of this issue** — the server exposes no validation or targeted-revert endpoint, so they are contract-first work: CONTRACT-008 → SERVER-019 → CLI-006 (Phase 4, before AGENT-003). The `.githooks/pre-commit` edit is **struck entirely**: this repo's hooks run in the Corpus *tool* repo, which is not a workspace — the workspace-side hook belongs to the agent-runtime domain once `doc check` exists. Do not touch `.githooks/`. Every verb is a thin, typed call onto a server endpoint — the CLI parses arguments, reads a body from stdin or `--file`, calls the server, and renders the response. It never touches a document file, never writes YAML, never runs `git commit`; locking, anchor reconciliation, validation, and auto-commit with author attribution all happen server-side. `--from user|agent` is threaded through every mutating verb so `git log` remains the audit trail of who changed what.

## Acceptance Criteria
- [ ] `corpus doc create --type <t> --title <s> [--folder <p>] [--tags a,b] [--due <iso>] [--from user|agent] [--file <p>]` — body from `--file` or stdin (heredoc); omitting both is legal (the server pre-fills from the type's template document). Prints the new document id; `--json` prints the created document object.
- [ ] `corpus doc edit <id> [--file <p>|stdin] [--title <s>] [--add-tag <t>…] [--remove-tag <t>…] [--status <s>] [--due <iso>] [--reviewed] [--evergreen true|false] [--from …]` — body replacement is optional (frontmatter-only edits are valid); the server acquires and releases the document lock implicitly. Output reports remapped and newly orphaned anchors when the response includes them.
- [ ] `corpus doc move <id> --folder <path>` and `corpus doc archive <id>` map to their endpoints and report the new path / status.
- [ ] `corpus doc delete <id>` is **user-only**: `--from agent` (or `CORPUS_FROM=agent`) is refused client-side with an explanatory error ("deletion is user-only — the agent archives, never deletes"), exit code 2, and no request is sent. Interactive use requires `--yes` unless stdin is a TTY and the confirm prompt is answered.
- [ ] `corpus thread reply <id> --from user|agent` reads the turn body from stdin (heredoc), `--file`, or `--message/-m`; empty body is a usage error. Prints the created turn's timestamp.
- [ ] `corpus thread resolve <id>` and `corpus thread reopen <id>` flip thread status through the server and are idempotent (already-resolved → says so, exit 0).
- [ ] `corpus db rebuild` triggers a full projection rebuild and prints a summary (documents/threads/turns projected, duration). `corpus db doctor` prints the drift report and exits **6** on drift, 0 when clean — the exit code the pre-commit hook gates on.
- [ ] Every mutating verb accepts `--from user|agent` (default `user`, overridable by `CORPUS_FROM`), sends it to the server, and the resulting git commit carries that author — verified E2E via `git log`.
- [ ] Every command above is registered in the CLI-001 registry with a summary, flag descriptions, and at least one realistic example, and appears in the regenerated `docs/cli.md`.
- [ ] No handler in this issue calls `fs.writeFile`, `fs.rename`, `fs.unlink`, or spawns a state-changing git command; a lint rule or unit assertion enforces the read-only-filesystem constraint.
- [ ] Vitest coverage for argument parsing, body-source resolution, the delete guard, and exit-code mapping.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/{create,edit,move,archive,delete}.ts`
- `apps/cli/src/commands/thread/{reply,resolve,reopen}.ts`
- `apps/cli/src/commands/db/{rebuild,doctor}.ts`
- `apps/cli/src/input.ts` — shared body resolution (stdin / `--file` / `-m`) and `--from` resolution
- `apps/cli/src/registry/index.ts` — register the `doc`, `thread`, `db` topics
- `docs/cli.md` — regenerated
- colocated `*.test.ts`

### Key Implementation Details
**Body resolution** (one helper, used by `doc create`, `doc edit`, `thread reply`): precedence `--message` > `--file` > stdin-when-not-a-TTY > none. Reading stdin means reading it fully before the request (heredocs are the agent's normal invocation form). Reading `--file` is a *read*, which is permitted; the CLI still never writes.

**`--from` attribution.** Resolve once in the dispatcher (`--from` flag ?? `CORPUS_FROM` ?? `"user"`), validate against the union, and pass it in the request body/header exactly as the contract defines. The server maps it to the git author. Commands that are inherently user-only (`doc delete`) reject `agent` before any network call.

**Anchor reporting.** `doc edit` responses carry the reconciliation result (§6). Human output prints e.g. `edited doc_a1b2c3 — 3 anchors remapped, 1 orphaned (th_x9y8)`; `--json` passes the response through untouched so the agent can act on it.

**Idempotence and no-op reporting.** `thread resolve` on an already-resolved thread, `doc archive` on an archived doc: report "already …" and exit 0. The agent's loop must never have to branch on these.

**Quiet by default.** Success output is a single line naming the affected id and the effect. All structured data goes behind `--json`. Errors follow the CLI-001 surface (exit 4 unreachable, 5 server error, 6 check failed).

### Edge Cases
- Editing a document the **user** currently holds the lock on → the server returns a lock conflict; the CLI renders it as "document is locked by user — the edit was not applied" with a distinct, documented exit code path (server error, exit 5) so the orchestrate skill can defer rather than retry blindly.
- `doc create` with a `--folder` that does not exist → the server decides (create-on-demand or reject); the CLI surfaces the typed problem verbatim rather than pre-validating.
- `thread reply` with a body containing a `~~~form` / fenced block → passed through byte-for-byte; no markdown post-processing in the CLI.
- Very large bodies (multi-MB pasted content) → stream/limit sensibly; do not build the request body twice.
- `db rebuild` on a large corpus may exceed the default HTTP timeout → use a longer, explicit timeout for this verb and print progress-free but non-hanging output.
- CRLF/no-trailing-newline stdin bodies → normalized only if the server contract says so; otherwise pass through unchanged and let the server normalize (one implementation).

## Testing Strategy
Vitest in `apps/cli`, colocated, with a **real** `node:http` stub server mounted on an ephemeral port asserting the request shape (method, path, body, `--from` attribution) and returning contract-shaped responses:
- `input.test.ts` — body-source precedence, TTY vs. piped stdin, empty-body rejection.
- `doc/delete.test.ts` — `--from agent` is refused with exit 2 and **no** HTTP request is made (assert the stub received nothing).
- `doc/check.test.ts` — warnings → exit 0, errors → exit 6, `--json` shape; `--staged` with a temp git repo containing staged/unstaged/deleted files, asserting only staged document blobs are posted and no git state changed (`git status --porcelain` identical before/after).
- `doc/edit.test.ts` — frontmatter-only edit sends no body; anchor-report rendering for remapped/orphaned.
- `thread/*.test.ts` — reply body from heredoc-style piped stdin; resolve/reopen idempotence output.
- `db/doctor.test.ts` — drift response → exit 6, clean → exit 0.
- A guard test asserting no command module under `commands/{doc,thread,skill,db}` imports `node:fs` write APIs or invokes state-changing git.

## E2E Verification Plan

### Verification Steps
1. Real workspace, real server: `corpus init` in a temp directory, `corpus server start`, confirm health. Use the installed binary for every command below.
2. `corpus doc create --type note --title "Mortgage options" --folder finance --tags finance,housing --from user <<'EOF' … EOF` → prints an id; confirm the file exists on disk under `data/docs/finance/` with valid frontmatter, and `git log -1 --format='%an %s'` shows the `user` author and a structured message.
3. `corpus doc edit <id> --from agent <<'EOF' … EOF` → file body changed on disk; `git log -1` author is `agent`. Repeat with `--title` only (no body) → frontmatter updated, body untouched.
4. Anchored-thread flow: create a thread on that document through the server (or the UI/`POST /api/threads`), then `corpus doc edit` the anchored text → the CLI reports the remapped/orphaned anchor; verify against `GET /api/docs/:id`.
5. `corpus thread reply <th_id> --from agent <<'EOF' … EOF` → new turn appended to the thread file with a unique timestamp heading; `corpus thread resolve <th_id>` → `status: resolved` on disk; running it again → "already resolved", exit 0.
6. `corpus doc archive <id>` then `corpus doc move <id> --folder archive-notes` → status/path reflected on disk and in `GET /api/docs`.
7. `corpus doc delete <id> --from agent` → refused, exit 2, file still present. `corpus doc delete <id> --from user --yes` → file removed, git history retains it (`git log --diff-filter=D`).
8. Validation: hand-corrupt a staged document (malformed anchor entry), `git add` it, run `corpus doc check --staged` → non-zero exit 6 with the specific finding; `git commit` is blocked by pre-commit; fix and re-run → exit 0 and the commit succeeds.
9. `corpus db rebuild` then `corpus db doctor` → clean, exit 0. Delete a document file out of band, `corpus db doctor` → drift reported, exit 6; `corpus db rebuild` → clean again.
10. `corpus skill rollback comment` after editing `.claude/skills/comment/SKILL.md` through `corpus doc edit` → the file's previous content is restored and a revert commit appears in `git log`.
11. Re-run representative commands with `--json`, pipe through `jq .` → all parse.

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
- [ ] `/audit` run (P0, cross-domain — CLI/server contract surface, user-only deletion guard)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-003]` prefix
