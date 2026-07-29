# [CONTRACT-008] Validation + skill-rollback routes (doc check / skill rollback surface)

## Domain

contract

## Status

in_progress

## Priority

P1

## Model

opus — the validator's shape already exists server-side; this pins it to the wire.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: SERVER-019, CLI-006

## Spec References

- SPEC.md §14 — validation ("hooks and API share one implementation"), `doc check --staged`
- SPEC.md §7 — skills as documents, `corpus skill rollback` loop safety
- `issues/sprints/sprint-007.md` — Open Conflicts (discovery: no validation or targeted-revert endpoint exists)

## Summary

Deferred out of CLI-003 (2026-07-27 adjudication): `corpus doc check` and `corpus skill rollback` have no server endpoints. The validator itself already exists (`apps/server/src/core/check.ts`; its `CheckDocument` type is already the `(path, content)` pair shape `--staged` needs) — this issue declares the wire surface: a validation route accepting either document ids or `(path, content)` pairs and returning structured findings (errors vs warnings), and a targeted-revert route restoring a skill's last-known-good version, returning the restored commit and path.

## Acceptance Criteria

- [x] Validation route: request accepts ids XOR `(path, content)` pairs; response distinguishes errors (exit-6 class) from warnings (orphaned anchors, unresolved `[[refs]]`); shapes reuse/align with `CheckDocument`.
- [x] Skill-rollback route: request `{name, to?}`; 404 for unknown skill; response carries restored commit + file path.
- [x] All standing contract invariants hold; artifacts regenerated; client round-trips.

## Technical Design

Refined by `issues/sprints/sprint-012.md` (TEST-52…TEST-74) and adjudications 2 and 8. As shipped:

**`POST /api/check`** (`src/routes/check.ts`, `src/schemas/check.ts`) — no actor header (it writes
nothing), body **required**, responses `200/400/401`.

- Request: `z.union([z.strictObject({ids: DocumentId[]}), z.strictObject({documents: CheckDocumentInput[]})], {error: CHECK_REQUEST_XOR_MESSAGE})`.
  Both branches are strict, so a body naming both keys matches neither branch and a body naming
  neither matches neither — the XOR is in the schema, not in a handler. The union carries its own
  message, because Zod reports a failed union as one top-level issue and the default `Invalid input`
  would be the caller's entire explanation.
- `CheckDocumentInput = {path: string(min 1), content: string}` — exactly `toCheckDocument(path, raw)`'s
  argument list. Named `…Input` because the server's `CheckDocument` is the *parsed* union, not the pair.
- Response: `CheckReport = {ok, errors: CheckFinding[], warnings: CheckFinding[]}`;
  `CheckFinding = {code, severity, docId: string|null, path, detail}` — `CheckFinding`'s field names
  verbatim. `docId` is a deliberately unvalidated nullable string: `id-prefix-mismatch` and
  `frontmatter-invalid` exist to report a malformed id, so validating it would make the report
  unserializable in exactly the cases it is written for.
- `code` is the closed thirteen-member enum. `CHECK_WARNING_CODES` is exactly `anchor-unresolved` +
  `ref-unresolved`; `CHECK_ERROR_CODES` is the other eleven, `anchor-unused` among them.

**`POST /api/skills/{name}/rollback`** (`src/routes/skills.ts`, `src/schemas/skill.ts`) —
`ActorHeaderSchema`, body **optional**, responses `200/400/401/404`.

- Path param `name`, validated `^[a-z0-9]+(?:-[a-z0-9]+)*$` (Claude Code's own skill-name rule), so a
  traversal segment is refused before any handler runs.
- Body `{to?: string | null}` — omitted or `null` means last-known-good.
- Response `SkillRollbackResult = {name, docId, commit, path, warnings}`. `warnings` is present because
  the revert is a normal auto-commit, and §14's rejected-hook warning has to reach every response that
  produces one — the rule `routes/db.ts` states from the other side ("neither route touches workspace
  files, so neither produces a git commit … `warnings` is deliberately absent from both").

Both routes sit in `contractRoutes` between the `db` pair and `streamEvents`; `ENDPOINT_INVENTORY`
gains exactly two entries; `openapi.ts` gains the `check` and `skills` tags.

## E2E Verification Log

**implemented on: opus.** Not a bug, so there is no pre-fix reproduction step. Ports `9065`–`9069`
(primary `9067`); scratch `/tmp/corpus-s012-contract008-syNxga`; `8765` verified unbound throughout.

### Post-Implementation Verification

#### TEST-73 — the SERVER-019 before-state, captured BEFORE any code was written

Real workspace, real server, real HTTP. Recorded first so nobody can mistake "the contract shipped"
for "the endpoint works".

```
$ node --import tsx apps/cli/src/bin/corpus.ts init /tmp/corpus-s012-contract008-syNxga --port 9067
Initialized Corpus workspace at /tmp/corpus-s012-contract008-syNxga
  port 9067, token in .corpus/config.json (mode 600)
$ node --import tsx apps/cli/src/bin/corpus.ts server start --workspace /tmp/corpus-s012-contract008-syNxga
corpus 0.0.0 listening on http://127.0.0.1:9067 (pid 76963)

health:                                200
POST /api/check:                       404
POST /api/skills/orchestrate/rollback: 404

$ curl -sS -i -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
       -d '{"ids":[]}' http://127.0.0.1:9067/api/check
HTTP/1.1 404 Not Found
{"code":"not_found","message":"no route matches POST /api/check"}

$ corpus server stop  →  stopped (pid 76963)
```

The `404` is the server's generic no-route answer (the token was accepted — `/api/health` returned
`200` with the same header), so this is "not mounted", not "not authorised".

#### TEST-52/53/54 — the declared surface

- Two new resource files, per the one-file-per-resource convention the criterion names:
  `packages/contract/src/routes/check.ts` (`POST /api/check`) and
  `packages/contract/src/routes/skills.ts` (`POST /api/skills/{name}/rollback`). Read as two files
  because `/api/check` and `/api/skills/{name}/rollback` are two resources; folding a skills route
  into `check.ts` would break the convention the same sentence invokes.
- `ENDPOINT_INVENTORY` gains **exactly two** entries — `git diff` on `inventory.ts` is `+10 −2`, of
  which the two entries are the only list changes; the other eight added lines are the docblock
  sentence recording that §9.2 does not yet name these two and that an amendment is pending:

```
@@ -65,6 +70,9 @@
+  "POST /api/check",
+  "POST /api/skills/{name}/rollback",
+
   "GET /events",
   "GET /attachments/{path}",
 ] as const;
```

- Registration order: both are inserted after the `db` pair and before `streamEvents`. Neither path
  competes with a `{param}` segment (`/api/check` is top-level; nothing else lives under
  `/api/skills/`), and `routes/index.test.ts`'s uniqueness and static-before-parameterised assertions
  pass unchanged.
- Paths are the adjudicated ones (adjudication 8 / Open Conflict 4): the skill rides the **path**,
  `{to?}` rides the body.

#### TEST-55/56/57 — the request is ids XOR pairs, enforced by the schema

`apps/server/src/core/check.ts` beside the contract schema, side by side:

```ts
// apps/server/src/core/check.ts
export const toCheckDocument = (path: string, raw: string): CheckDocument
export type CheckFinding = { code: CheckCode; severity: CheckSeverity;
                             docId: string | null; path: string; detail: string }
export type CheckReport  = { errors: readonly CheckFinding[]; warnings: readonly CheckFinding[] }

// packages/contract/src/schemas/check.ts
CheckDocumentInputSchema = { path: string(min 1), content: string }        // toCheckDocument's args
CheckFindingSchema       = { code, severity, docId: string|null, path, detail }
CheckReportSchema        = { ok, errors: CheckFinding[], warnings: CheckFinding[] }
```

so SERVER-019's handler is `documents.map((d) => toCheckDocument(d.path, d.content))`.

Live rejections over real HTTP (see TEST-70 for the full transcript):

```
{"ids":["doc_a1b2c3"],"documents":[]}  -> 400  "Provide exactly one of `ids` … or `documents` — never both, never neither, and no other key."
{}                                      -> 400  (same message)
{"ids":[],"scope":"workspace"}          -> 400  (same message — the branches are strict)
{"ids":["anc_k4f7"]}                    -> 400  json.ids.0: Invalid string: must match /^(doc|th)_[A-Za-z0-9]+$/
{"ids":[]}                              -> 200  {"ok":true,"errors":[],"warnings":[]}
{"documents":[]}                        -> 200  {"ok":true,"errors":[],"warnings":[]}
```

Empty collections are legal and mean "nothing to check" (TEST-57), matching CLI-006's "no staged
document paths → exit 0, silent".

#### TEST-58/59 — the report, and the two lists side by side

```
apps/server/src/core/check.ts CHECK_CODES (13, in declaration order)
  frontmatter-unparseable · frontmatter-invalid · id-prefix-mismatch · duplicate-id ·
  anchor-malformed · duplicate-anchor-id · thread-parent-missing · thread-anchor-missing ·
  anchor-claimed-twice · anchor-unused · duplicate-turn-timestamp · anchor-unresolved · ref-unresolved

packages/contract/openapi.json  components.schemas.CheckFinding.properties.code.enum
  ["frontmatter-unparseable","frontmatter-invalid","id-prefix-mismatch","duplicate-id",
   "anchor-malformed","duplicate-anchor-id","thread-parent-missing","thread-anchor-missing",
   "anchor-claimed-twice","anchor-unused","duplicate-turn-timestamp","anchor-unresolved",
   "ref-unresolved"]
```

They agree, member for member and in order. Warnings on both sides are exactly `anchor-unresolved`
and `ref-unresolved`; the other eleven are errors, `anchor-unused` included. `schemas/check.test.ts`
pins the transcription literally and asserts the partition (11 + 2 = 13, disjoint, covering);
`openapi.test.ts` asserts the route description names both warning codes and the sentences
"The other eleven codes are errors" / "`anchor-unused` among them". `ok` is documented as
`errors.length === 0` — the exit-6 class.

The contract cannot `import` the server's `CHECK_CODES` (dependency direction is contract ← server),
so the transcription is pinned by a literal test here. **Recommendation for SERVER-019**: assert the
other direction there — `Object.values(CHECK_CODES)` equals `@corpus/contract`'s `CHECK_CODES` — which
closes the loop with a test that lives on the side that *can* see both.

#### TEST-60 — validation is read-only and says so

`operation("/api/check","post").parameters` contains **no** header entries at all (asserted). The
route description states it runs "the same validator every server mutation runs before writing —
hooks and API share one implementation". The §14-commit-warning carrier is deliberately absent, and
`CheckReport.warnings` is documented on the schema as the *validator's* severity split, explicitly
"unrelated to the `Warning` shape mutation responses carry".

#### TEST-61/62/63 — the rollback, quoted from the artifact

```json
"parameters": [
  {"name":"name","in":"path","required":true,
   "schema":{"type":"string","pattern":"^[a-z0-9]+(?:-[a-z0-9]+)*$"}},
  {"name":"x-corpus-author","in":"header","required":false,
   "schema":{"type":"string","enum":["user","agent"],"default":"user"}}
],
"requestBody": {"required": false, "content": {"application/json":
  {"schema": {"$ref": "#/components/schemas/SkillRollbackRequest"}}}},
"responses": {"200": {"$ref": ".../SkillRollbackResult"}, "400": ..., "401": ...,
              "404": {"$ref": "#/components/schemas/NotFoundError"}}
"SkillRollbackResult".required = ["name","docId","commit","path","warnings"]
"SkillRollbackRequest".properties = {"to": {"type":["string","null"],"minLength":1}}
```

Every field's meaning is in the route description (`commit` is the new commit the revert produced,
not the ref the content came from; `path` is the file rewritten; `docId` never changes because ids are
immutable). `404` uses the shipped `NotFoundErrorSchema` (`code: "not_found"`) with no new error shape,
and the description states the condition ("no skill of that name is installed … archived is likewise
not installed, so rolling it back is a `404`"). The actor header is the standard optional
`ActorHeaderSchema`, and the description says the revert "lands as a normal auto-commit".

#### TEST-64 — routes declare only the codes they can return

```
POST /api/check                     responses = ["200","400","401"]
POST /api/skills/{name}/rollback    responses = ["200","400","401","404"]
```

Neither declares `500` (the asserted no-500 invariant holds), neither declares a `409`/`423` it cannot
produce, and neither declares `403` (there is no user-only rule on either).

#### TEST-65 — both require the workspace bearer token

Neither operation carries a `security` key in `openapi.json`, so both inherit the document-level
`"security": [{"bearerAuth": []}]`. Neither joins the documented exception list — the existing
`it.each` for the exempt three (`/api/health`, `/events`, `POST /api/jobs/{id}/log`) is unchanged, and
`declares 401 on every authenticated operation` passes with both new routes in the set.

#### TEST-66/67 — generation is idempotent, and the drift check fires

Hashes across three consecutive `npm run generate -w packages/contract` runs:

```
463876b744f9ace24fa642b8777ba62cb58faab8128b19a3509697e1c2b8e5d4  packages/contract/openapi.json
c7c851d615772c63fd83e36699ca460c9850628541e065b38a59cb7367d21b8c  packages/contract/src/client/schema.generated.ts
```

Byte-identical every time — generation is a no-op once run.

The shipped `node --import tsx scripts/check-generated-artifacts.ts` was run twice and reported the
issue's own uncommitted artifact diff, because its second half compares against **HEAD** and the
orchestrator (not this agent) owns the commit:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add …
 packages/contract/openapi.json                   | 341 +++++++++++++++++++++
 packages/contract/src/client/schema.generated.ts | 214 ++++++++++++++
 2 files changed, 555 insertions(+)
✓ CLI reference is up to date (docs/cli.md).
```

Note the diffstat is **555 insertions, 0 deletions** — no existing route was renamed, removed or
reshaped. This is expected pre-commit, not a failure of this issue; it turns green the moment the
artifacts are committed.

To prove that, the repo's own `checkGeneratedArtifacts` was driven with only its `diffAgainstHead`
half restated to compare against a pre-run snapshot (the committed-state stand-in). Everything else —
running the real regeneration command and demanding byte-identical output — is the shipped code.
Green **twice in a row**:

```
$ node --import tsx /tmp/corpus-s012-contract008-syNxga/drift-postcommit.ts   # run 1, exit 0
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
$ node --import tsx /tmp/corpus-s012-contract008-syNxga/drift-postcommit.ts   # run 2, exit 0
✓ API contract is up to date (…).
✓ CLI reference is up to date (docs/cli.md).
```

And it **fails** on a hand-edited route, demonstrated and reverted: `routes/check.ts`'s `summary` was
changed to `"DRIFT PROBE — hand-edited without regenerating"` without regenerating —

```
$ node --import tsx …/drift-postcommit.ts   # exit 1
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add …
```

— then the summary was restored, `npm run generate` re-run, and the artifacts hashed back to
`463876b7…` / `c7c851d6…` with `grep -c "DRIFT PROBE"` returning 0 in both.

#### TEST-68 — `openapi.json` carries the declared shapes

Quoted from the committed artifact (not the route source). `paths["/api/check"].post.requestBody`:

```json
{"required": true, "content": {"application/json": {"schema": {"anyOf": [
  {"type":"object","properties":{"ids":{"type":"array","items":{"type":"string",
     "pattern":"^(doc|th)_[A-Za-z0-9]+$"}}},"required":["ids"],"additionalProperties":false},
  {"type":"object","properties":{"documents":{"type":"array",
     "items":{"$ref":"#/components/schemas/CheckDocumentInput"}}},
     "required":["documents"],"additionalProperties":false}
]}}}}
```

Two closed alternatives — that is the XOR, in the artifact. Responses: `200 → CheckReport`,
`400 → ValidationError`, `401 → UnauthorizedError`. The rollback's request/response/404 blocks are
quoted under TEST-61 above, likewise from the artifact.

#### TEST-69 — the generated client exposes both, typed

`src/client/schema.generated.ts` carries both operations. The request body type for `/api/check` is a
real union:

```ts
"application/json": { ids: string[] } | { documents: components["schemas"]["CheckDocumentInput"][] };
```

**Naming convention, stated deliberately**: the shipped client surface is `client.api.<VERB>(path)`
over the generated `paths` — one method per operation, keyed by path. The only hand-written named
methods on `CorpusClient` are for the surfaces `openapi-fetch` cannot serve (`connectEvents` for SSE,
`uploadTurn`/`capture` for multipart). Both new routes are plain JSON, so adding a bespoke wrapper
would *deviate* from the convention rather than follow it.

Compile-time enforcement is asserted, not asserted-about: `routes/check.test.ts` and
`routes/skills.test.ts` carry `@ts-expect-error` probes (`{ids: 3}`, `{documents: [{path}]}` with no
`content`, `{to: 2}`, `{name: "orchestrate"}` in the rollback body, and an unlisted `code`). Each
`@ts-expect-error` **is** the assertion — it fails to compile if the generated types stop catching the
case. `npm run typecheck` exits 0 with all of them in place.

One honest limitation, recorded rather than papered over: TypeScript's excess-property check does not
reject `{ids: [], documents: []}` against a union whose members each declare one of the keys, so the
both-keys case is caught at **runtime** by the route's validator (a `400` with the XOR message), not at
compile time. TEST-55 asks exactly for the validator's rejection, and that is what happens.

#### TEST-70 — round trip against a stub app, over real HTTP on 9067

The **real** route definitions from `@corpus/contract`'s built `dist/`, mounted on an `OPENAPIHono`
carrying the server's own `defaultHook`, served by `@hono/node-server` on `127.0.0.1:9067`, called by
`createCorpusClient` over the generated types. Full transcript:

```
[1] POST /api/check {ids} ->
  {"data":{"ok":true,"errors":[],"warnings":[]}}
[2] POST /api/check {documents} ->
  {"data":{"ok":false,"errors":[{"code":"frontmatter-unparseable","severity":"error","docId":null,
   "path":"data/docs/mortgage.md","detail":"staged bytes: 23"}],
   "warnings":[{"code":"ref-unresolved","severity":"warning","docId":"doc_a1b2c3",
   "path":"data/docs/mortgage.md","detail":"reference `[[doc_zzz]]` does not resolve…"}]}}
[2a] first error, narrowed  -> {"code":"frontmatter-unparseable","severity":"error","docId":null}
[2b] first warning, narrowed-> {"code":"ref-unresolved","severity":"warning"}
[3] POST /api/check both forms   -> 400 {"code":"bad_request","issues":[{"path":"json",
     "message":"Provide exactly one of `ids` … never both, never neither, and no other key."}]}
[3] POST /api/check neither form -> 400 (same)
[3] POST /api/check unknown key  -> 400 (same)
[3] POST /api/check malformed id -> 400 {"issues":[{"path":"json.ids.0",
     "message":"Invalid string: must match pattern /^(doc|th)_[A-Za-z0-9]+$/"}]}
[4] POST /api/skills/orchestrate/rollback (no body) ->
  {"data":{"name":"orchestrate","docId":"doc_a1b2c3","commit":"9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
   "path":".claude/skills/orchestrate/SKILL.md","warnings":[]}}
[5] POST .../rollback {to:'HEAD~2'} as agent -> 200, same shape
[6] POST /api/skills/never-installed/rollback ->
  {"error":{"code":"not_found","message":"No skill `never-installed` under .claude/skills/."}}
[7] POST /api/skills/Orchestrate/rollback -> 400 {"issues":[{"path":"param.name",
     "message":"Invalid string: must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/"}]}
```

`[3]` and `[7]` prove the **schema** does the work: no handler ran. `[6]` proves the path param is
parsed and reaches the handler, which is what gives the `404` a home. `[2a]`/`[2b]` are the typed
narrowing — `code` and `severity` come back as the closed enums, not as `string`. The listener was
closed at the end of the run; `lsof -nP -iTCP:9067 -sTCP:LISTEN` is empty afterwards.

#### TEST-71 — Zod round-trips per schema

`packages/contract/src/schemas/check.test.ts` (54 cases) and `.../skill.test.ts` (28 cases) cover
parse/serialize round-trips for both request schemas and both response schemas — including a finding
of each severity, every one of the thirteen codes, both empty-collection forms, all three XOR
rejections plus the two field-level ones, the nullable/absent `to`, and the rejected skill names.
`packages/contract/src/routes/{check,skills}.test.ts` cover the same through mounted routes and the
generated client.

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
 Test Files  38 passed (38)
      Tests  1167 passed (1167)
```

Repo-wide gates from the worktree root (build first, since `@corpus/*` resolves into `dist/`):

```
$ npm run build        → exit 0
$ npm run typecheck    → exit 0
$ npm run lint         → exit 0
$ npm run format:check → exit 0
```

Existing contract invariants that had to be **extended** (not weakened), each with the reason recorded
in the test file:

- `author attribution → declares the optional actor header on every mutating operation` — `/api/check`
  is exempted via a named `READ_ONLY_POSTS` set: it is a `POST` because a body is the only way to say
  what to check, and it writes nothing, so there is no git author to attribute (TEST-60 asserts the
  absence positively).
- `§14 warnings reach every mutation response` — `SkillRollbackResult` **added** to `CARRIERS`;
  `CheckReport` listed in a new `FOREIGN_WARNINGS` set with an explanation, plus a new positive test
  that its `warnings` is a `CheckFinding[]` rather than a `Warning[]`.
- `request bodies declare whether they are mandatory` — the "wholly optional" computation was replaced
  by `satisfiedByEmptyBody`, which asks the question the rule actually needs and survives a branching
  body (a union is satisfied by `{}` when any branch is). The old "uses no branching schema" test
  became "names every branching request body", pinned to exactly `POST /api/check: anyOf`, so a second
  branching body is still a deliberate act. Body count 12 → 14; the partition gains
  `POST /api/check: true` and `POST /api/skills/{name}/rollback: false`.

#### TEST-72 — no consumer changed

```
$ git status --porcelain
 M packages/contract/openapi.json
 M packages/contract/src/client/request-body-required.test.ts
 M packages/contract/src/client/schema.generated.ts
 M packages/contract/src/openapi.test.ts
 M packages/contract/src/openapi.ts
 M packages/contract/src/routes/index.test.ts
 M packages/contract/src/routes/index.ts
 M packages/contract/src/routes/inventory.ts
 M packages/contract/src/schemas/index.ts
?? packages/contract/src/routes/check.ts        ?? packages/contract/src/routes/check.test.ts
?? packages/contract/src/routes/skills.ts       ?? packages/contract/src/routes/skills.test.ts
?? packages/contract/src/schemas/check.ts       ?? packages/contract/src/schemas/check.test.ts
?? packages/contract/src/schemas/skill.ts       ?? packages/contract/src/schemas/skill.test.ts
```

Zero files under `apps/server`, `apps/cli`, `apps/ui`, `packages/kit` (adjudication 2). No handler, no
CLI verb, no kit hook. `apps/server/src/core/check.ts` was **read** and never touched.

#### TEST-74 — the SPEC amendment is drafted and HELD, not smuggled

`SPEC.md` §9.2 mentions neither validation nor skill rollback today (`grep` confirms: the only
occurrences of `corpus skill rollback` are in §7 and §15 M5; `corpus doc check` in §14). **SPEC.md is
unmodified by this issue.** The drafted amendment, for the orchestrator to carry to the user at the
phase PR:

> Add to §9.2's route list, after the `GET /api/jobs…` bullet:
>
> - `POST /api/check` — the §14 validator on demand: body is **either** `{ids}` (documents to read
>   from the workspace) **or** `{documents: [{path, content}]}` (unsaved content, for
>   `corpus doc check --staged`), never both and never neither. Returns
>   `{ok, errors[], warnings[]}` over the validator's own thirteen codes; `ok` is `errors` empty, which
>   is `corpus doc check`'s exit 0 vs. exit 6. Read-only, so it carries no acting party.
> - `POST /api/skills/:name/rollback` — §7's targeted git revert, restoring a skill's last-known-good
>   version (body `{to?}` overrides the revision). Returns the restored commit, the file path, the
>   skill's name and its document id; `404` when no skill of that name is installed. Lands as a normal
>   auto-commit, so it carries the acting party like any mutation.

Until it is signed off, `src/routes/inventory.ts`'s docblock records that these two entries come from
§14 and §7 rather than §9.2, and that the amendment is pending — so the gap is documented at the one
place that would otherwise read as an unexplained extra.

#### Escalations recorded rather than invented

1. **There is no whole-workspace check request.** §14 says "`corpus doc check` exposes the same
   validator on demand **over the whole workspace**", but TEST-55 binds the request to `{ids}` XOR
   `{documents}` with "neither" rejected, and TEST-57 binds `{ids: []}` to an *empty* report. So a bare
   `corpus doc check` has no direct wire form: CLI-006 must enumerate ids (via `GET /api/docs`) and
   send them. Rather than invent a third branch (outside adjudication 2's shape), the route
   description states the design positively — "There is deliberately no implicit everything form, so an
   empty request can never be mistaken for a whole-workspace check". **Orchestrator decision needed
   before CLI-006**: accept the enumerate-then-post shape, or amend the request to admit a scope form.
2. **Unknown ids are silent.** An id in `{ids}` naming no document contributes no findings; the
   thirteen-code vocabulary has no "unknown id" member and TEST-64 forbids a `404` here. The
   description says so and points callers at `GET /api/docs/{id}`. Flagged for SERVER-019 so the
   handler does not invent a different answer.
3. **Union rejections are one issue, not field-level.** Zod reports a failed union as a single
   top-level issue, so `issues[]` for an XOR violation is `[{path: "json", message: <the rule>}]`. The
   schema now supplies that message (the default would be `Invalid input`). SERVER-019 could unfold
   union sub-issues in `toValidationIssues` for a richer report; not required, and not done here since
   it is server code.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
