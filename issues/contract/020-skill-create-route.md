# [CONTRACT-020] Route: `POST /api/skills` (skill create through the server write path)

## Domain
contract

## Status
in_progress

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-008 (skills surface)
- Blocks: SERVER-036, CLI-011 (skill-create half)

## Spec References
- SPEC.md §7 — skill genesis (amended: extend-plus-propose "until `corpus skill create` ships (CLI-011)")
- SPEC.md §9.2 — write-path semantics

## Summary
Sprint-015 Open Conflict 1: CLI-011 promises `corpus skill create` "through the server
write path", but no route exists — the server's write paths refuse document roots
outside `data/docs/` (`normalizeDocFolder` prefixes `DOCS_ROOT` unconditionally) and
the skills surface (CONTRACT-008) covers only check/rollback. Define the creation
route: request (skill name, initial SKILL.md content or template selection — mirror
what the CLI verb per its issue needs), responses (201; 400 validation incl. name
pattern; 401; 409 already-exists; 423 lock parity if applicable), following the skills
surface's existing conventions. Orchestrator ruling 2026-07-30: contract → server
(SERVER-036) → CLI, three commits.

## Acceptance Criteria
- [x] Route defined with the same error-envelope + strictness conventions as the rest of the skills surface; name-pattern traversal guard expressible at the schema level
- [x] openapi.json + generated client regenerated; route tests per house pattern
- [x] Response set consistent with SERVER-036's planned behavior (coordinate via the issue files, not guesswork)

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/skills.ts` (+ tests), `openapi.json`, `schema.generated.ts`

## Testing Strategy
Route response-key + schema strictness tests; generation idempotence.

## E2E Verification Plan
Typecheck across consumers; drift check green.

## E2E Verification Log

**implemented on: opus** (2026-07-30, contract-dev)

### What shipped

- `packages/contract/src/schemas/skill.ts` — `SkillCreateRequestSchema` (`z.strictObject`):
  `name` (required, `SkillNameSchema`), `description` (required, min 1), `title?`, `body?`,
  `tags?`. Type export `SkillCreateRequest`.
- `packages/contract/src/routes/skills.ts` — `createSkill`: `POST /api/skills`, actor header,
  mandatory JSON body, responses `201 DocMutationResponse` / `400` / `401` / `409 ConflictError`.
- Registered in `routes/index.ts` (collection before the parameterised rollback) and
  `routes/inventory.ts`; regenerated `openapi.json` + `src/client/schema.generated.ts`.

### Decisions taken (and why they are the shape SERVER-036 inherits)

1. **Name in the body, not the path.** The path names a resource that exists; creation has none.
   Same convention as `POST /api/docs`. `PUT /api/skills/{name}` was rejected: it reads as
   idempotent replace, which contradicts the `409`.
2. **The traversal guard is the schema.** `SKILL_NAME_PATTERN` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`,
   reused unchanged from CONTRACT-008) admits no `/`, `.` or whitespace, so `../evil`, `a/b`,
   `/etc/passwd`, `..`, `%2e%2e` are `400`s naming `body.name` before any handler runs — verified
   in `routes/skills.test.ts` and `schemas/skill.test.ts`. There is **no wire form on this route
   for writing outside `.claude/skills/`**; a third document root would be a third enumerated
   route, never a `folder`-style parameter.
3. **`description` is required.** Claude Code discovers a skill by frontmatter `name` +
   `description`; without one the verb emits a file that is installed and uninvokable. This makes
   the body mandatory (`required: true`), which the house mandatory-body rule then derives.
   Consequence for CLI-011: `corpus skill create <name>` needs a `--description` (the CLI's call —
   flagged in the report, not decided here).
4. **`title` optional, defaulting to `name`** — stated in the description, never as a JSON Schema
   `default` (optional-in/defaulted-out; a `default` would make the field required in the
   generated client).
5. **No `423`.** An edit lock is held on a document, and this call's document does not exist until
   the call succeeds. A taken name is a conflict, not a lock. Consistent with `POST /api/docs`,
   which also declares none; the route says so in prose so the omission reads as a decision.
6. **Archived-skill collision left open, as instructed.** SERVER-036 decides whether
   `.claude/skills-archived/{name}/` blocks the name. Both rulings are already describable with
   the declared response set — refusing is the same `409`, allowing is the plain `201` — so
   neither answer needs a later contract change. Stated in the route description and pinned by
   `openapi.test.ts` ("leaves the archived-name collision to the server without a third outcome").
7. **Response is `DocMutationResponse`, not a bespoke `SkillCreateResult`.** A skill is an
   ordinary document (§7), and the created file's `path`, `frontmatter.id` and §14 `warnings` are
   exactly what that shape carries. Reusing it also means the existing "§14 warnings reach every
   mutation response" sweep already covers this route.

### Tests

- `VITEST_MAX_THREADS=4 vitest run packages/contract` → **39 files, 1304 tests, all pass** (this
  count includes CONTRACT-021's tests; the run is shared).
- New/extended: `schemas/skill.test.ts` (+9 cases incl. the traversal set and the strictness set),
  `routes/skills.test.ts` (+13 cases through the generated typed client: 201 minimal, 201 full
  with actor echo, 409 envelope, six `400` name refusals, missing description, unknown key,
  bad actor, plus compile-time `paths` probes), `openapi.test.ts` (+11 cases in "the skill create
  (CONTRACT-020)"), `client/request-body-required.test.ts` (+1 mandatory-body entry),
  `routes/index.test.ts` (stub handler so every route stays registered).
- `npm run typecheck -w packages/contract` → exit 0. `eslint packages/contract` → exit 0.
  `prettier --check` → clean. No rule disabled anywhere.

### Artifact regeneration and idempotence

```
$ npm run generate -w packages/contract   # writes openapi.json + src/client/schema.generated.ts
$ shasum -a 256 openapi.json src/client/schema.generated.ts > before.sha
$ npm run generate -w packages/contract && shasum -a 256 -c before.sha
openapi.json: OK
src/client/schema.generated.ts: OK      # exit 0 — byte-stable across runs
```

Document now: **41 paths, 75 components**. This issue adds `POST /api/skills` and the
`SkillCreateRequest` component (`required: ["name","description"]`,
`additionalProperties: false`).

**Drift check (`scripts/check-generated-artifacts.ts`) not run**: it compares committed artifacts
via `git diff --stat HEAD --`, and this agent runs no git commands at all (harness rule). The
substitute evidence is the double-generation checksum above; the orchestrator's post-commit run is
authoritative. Accepted pattern since CONTRACT-008 / sprint-015 Adjudication 12.

### Consumer typecheck

`packages/contract` 0 errors · `packages/kit` 0 · `apps/cli` 0 · `apps/ui` 5 · `apps/server` 2.
**None of the seven is caused by this issue** — all are CONTRACT-021's enum/`Job` widening; see
that issue's log. Nothing in `apps/*` references the skills surface yet, which is expected:
SERVER-036 mounts the handler and CLI-011 calls it.

### Addendum — `SKILL_NAME_MAX_LENGTH = 64` (orchestrator ruling, 2026-07-30)

Open question 1 was ruled: bound the name. `SkillNameSchema` gains `.max(64)`, published as the
exported `SKILL_NAME_MAX_LENGTH` and stated in the schema's description. The bound is deliberately
shared with the rollback **path parameter** — a name past it can name no installed skill, so
`400` ("this input cannot be right") is truer than `404` ("no such skill"), and both routes keep
one definition of a name. Every shipped skill name is far inside it (`orchestrate`, eleven).

Both edges are asserted on both surfaces, so an off-by-one cannot pass as the same contract:
`schemas/skill.test.ts` (64 parses, 65 refused; the same pair through `SkillCreateRequestSchema`;
the shipped names asserted under the bound), `routes/skills.test.ts` (a 64-char create returns
`201` with the directory in its path, a 65-char create is a `400` on `json.name`; a 64-char
rollback path reaches the handler and answers `404`, a 65-char one is a `400` on `param.name` —
the `404` is what proves the name passed validation rather than being rejected for length), and
`openapi.test.ts` (the published `maxLength: 64` on the request body property **and** on the
rollback path parameter, read from the same constant).

Verification after the change: artifacts regenerated, double-generation `shasum -c` OK on both
files (`openapi.json` carries `"maxLength": 64` in both places); scoped suite
`VITEST_MAX_THREADS=4 vitest run packages/contract` → **39 files, 1314 tests, all pass** (+10);
`typecheck`, `eslint`, `prettier --check` on `packages/contract` all exit 0. Nothing outside
`packages/contract/src/schemas/skill.ts`, its tests, `routes/skills.test.ts`, `openapi.test.ts`
and the regenerated artifacts was touched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc, scoped to `packages/contract`)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
