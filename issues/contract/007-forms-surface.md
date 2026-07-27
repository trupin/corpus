# [CONTRACT-007] Forms surface: formAnswer schema + form.respond producer routes

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — SPEC §8's form fence grammar and §7's form.respond event are specified; the work is schema enumeration.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: SERVER-016, UI-008

## Spec References

- SPEC.md §8 — form fences in agent turns, the answer flow; §7 — `form.respond` event type
- `issues/sprints/sprint-006.md` — Open Conflict 3 (discovery: zero form surface shipped)

## Summary

Discovered by sprint-006: no `formAnswer` schema and no producer of `form.respond` exist anywhere in the contract, so SERVER-006's form AC was struck. This issue designs the form-answer wire surface (the answer submission route/shape, its validation against the form fence's fields, and the `form.respond` event payload) before UI-008 renders forms.

## Acceptance Criteria

- [x] **Rider**: `resolve`/`reopen` responses gain the warnings field (SERVER-006: they return a bare ThreadSummary, so their §14 warnings are log-only today).
- [x] **Rider**: `ReapStaleResult` gains `failed: string[]` (QueueService returns it; the CLI cannot report give-ups without it — CLI-004 harvest note).
- [x] **Rider**: `JobSchema` gains a nullable origin-title field for the jobs listing (thread- and doc-origin jobs carry the origin's title so UI-011's console can label jobs without a second fetch — struck from SERVER-018 on 2026-07-27 because no such field exists in the contract; the server-side population rides with SERVER-016 or a small follow-up).
- [x] Form-answer request/response schemas per §8; the submission route declared; `form.respond` payload pinned in the QueueEvent core types.
- [x] All standing invariants; artifacts regenerated; round-trips.

## Technical Design

### The form fence grammar (Open Conflict 4a — pinned to the minimum §6 states)

`packages/contract/src/schemas/form.ts` is the single written-down grammar:

- **Fence**: info string matched **whole** as `form` at a line start (`FORM_FENCE_PATTERN`), so
  ` ```formula ` / ` ```form-builder ` are not forms. `extractFormSource(body)` returns the YAML;
  the contract parses no YAML (it has no YAML dependency) and hands the block to the caller.
- **Fields**: `prompt` (non-empty) and `options` (≥1, each non-empty, **all distinct** — an answer
  names an option by its text, so duplicates would be ambiguous). Nothing else: no per-option
  types, no required markers, no multi-select. Those are UI-008 decisions.
- **Selection**: single. **Note**: free text, optional, separate from the option.
- **Identity**: the timestamp of the turn carrying the form — already that turn's identity (§6). A
  turn therefore holds **at most one** form, and the route addresses it through the turn's path
  (`POST /api/threads/{id}/turns/{ts}/form`), so no second identifier exists to drift from the first.

### The rest

- Route `POST /api/threads/{id}/turns/{ts}/form` → `FormAnswerRequest {option, note?}` →
  `FormAnswerResponse {thread, turn, eventId, warnings}` (a new §14 carrier). `eventId` is
  **nullable, not optional**: a resolved thread stops re-triggering the agent (§8).
- `validateFormAnswer(form, answer)` lives in the contract, not the server: the wire's own
  definition of a valid answer gets one implementation, which the server rejects with and a client
  can pre-check with.
- `form.respond` payload: `FormRespondPayloadSchema {threadId, formTs, option, note|null}` declared
  **beside** `QueueEventSchema` rather than as a union member — §7 keeps `type` an open string
  because plugins own their own payload shapes, and a union keyed on `type` would close it at the
  three core types. `parseFormRespondPayload()` narrows; a malformed payload returns `undefined`
  rather than throwing, because events come off disk.
- Riders: `ThreadMutationResponse {thread, warnings}` (a wrapper — `ThreadSummary` is a resource and
  stays untouched); `ReapStaleResult.failed`; `Job.originTitle`.

## E2E Verification Log

**implemented on: opus** (worktree `.claude/worktrees/contract-riders`, sprint-008, ports 8910–8919 allocated).

### Reproduction (bugs only)

Not a bug. The pre-state was confirmed by reading the shipped artifacts before any edit: `openapi.json`
had no `Form*` component, no `/api/threads/{id}/turns/{ts}/form` path, `ReapStaleResult.required ==
["reaped"]`, `Job` with six fields and no title, and `resolve`/`reopen` both returning a bare
`ThreadSummary`.

### Post-Implementation Verification

**The contract suite, in isolation** — `./node_modules/.bin/vitest run packages/contract`:

```
Test Files  33 passed (33)
     Tests  881 passed (881)
```

(Baseline at checkout: 32 files / 827 tests, of which the pre-existing 818 all passed. The suite
covers both issues; the CONTRACT-007-only checkpoint was **32 files / 844 tests green** before
CONTRACT-009's first line.)

**Generation is idempotent.** See the final-state evidence in
`issues/contract/009-thread-multipart-rider.md` (both issues share the two artifacts, so only the
final hashes are meaningful). At the CONTRACT-007-only checkpoint the artifacts hashed
`0ca72eba…` / `3938b034…` and were byte-stable across consecutive runs; those hashes were superseded
when CONTRACT-009's media type and `413` landed.

**The forms surface, over real HTTP against the contract's own routes mounted on a Hono app**
(`src/routes/index.test.ts`, `mountCreateThread`/`app.openapi` harness — the same registration
`apps/server` performs). The answer is validated against the *fence's* options, not against a
static enum:

- `POST /api/threads/th_x9y8/turns/2026-07-19T10%3A05%3A00Z/form` with `{"option":"6.4%"}` → **201**,
  body `{turn:{body:"6.4%"}, eventId:"evt_7c1d", warnings:[]}`.
- same with `{"option":"6.1%","note":"matches the Q2 sheet"}` → **201**, turn body
  `"6.1%\n\nmatches the Q2 sheet"`.
- same with `{"option":"5.0%"}` (not offered by the form) → **400**,
  `{"code":"bad_request","issues":[{"path":"body.option","message":"`5.0%` is not one of this form's options: `6.1%`, `6.4%`."}]}`.
- `{"note":"hmm"}` and `{"option":""}` → **400** (schema); `.../turns/yesterday/form` → **400**
  (the ISO path parameter).

**Fence detection, the half SERVER-022 finding 3 consumes.** `FORM_FENCE_PATTERN` matches the info
string whole: ` ```form ` matches; ` ```formula `, ` ```form-builder `, ` ```formatting `, ` ```yaml `
and a bare ` ``` ` do not. TEST-107's `formula` case is fixed by construction. Trailing whitespace on
either fence line is tolerated; the first fence wins when a turn carries two.

**The three riders, round-tripped and observed on the wire:**

- `POST /api/threads/{id}/resolve` → **200** `{"thread":{…,"status":"resolved"},"warnings":[{"code":"commit_failed","detail":"pre-commit hook exited 1"}]}`.
  `ThreadSummary` itself is unchanged — asserted from both sides (`ThreadSummarySchema.shape` has no
  `warnings`; the `warnings`-carrier sweep finds no stray component).
- `POST /api/queue/reap-stale` → **200** `{"reaped":["evt_7c1d"],"failed":["evt_dead"]}`; the arrays
  are disjoint and both are required.
- `GET /api/jobs` → row `{…,"originId":"th_x9y8","originTitle":"Re: 30-year fixed assumption"}`;
  `originTitle` is nullable-not-optional, and `Job` still publishes as a plain non-nullable
  undefaulted object (`required` = the seven fields).

**`form.respond` payload.** `FormRespondPayloadSchema` round-trips `{threadId, formTs, option, note}`
and rejects a `doc_*` id, a non-instant `formTs`, an empty option and an omitted (rather than null)
note. `parseFormRespondPayload` narrows a `form.respond` event and returns `undefined` for
`comment.created`, for a plugin type (`todos.moved`), and for a `form.respond` whose payload does not
match. `QueueEventSchema.payload` stays `z.record(z.string(), z.unknown())` — the open `type: string`
survives, asserted in `openapi.test.ts`.

**Standing invariants — all green, none weakened.** Every diff in `*.test.ts` either adds an
assertion or updates a pinned literal to its new correct value:

| Invariant | Outcome |
| --- | --- |
| exactly the pinned endpoint inventory | `POST /api/threads/{id}/turns/{ts}/form` added to `ENDPOINT_INVENTORY` in the same change |
| 401 on every authenticated operation | green |
| 400 on every operation validating input / none on those that do not | green |
| no `500` declared anywhere | green |
| every named component a plain, non-nullable, undefaulted object | green (`Job` included) |
| no server-applied default in a request body; none in a `required` array | green |
| §14 `warnings` required on every carrier | `CARRIERS` 7 → 9 (`ThreadMutationResponse`, `FormAnswerResponse`); the "no other component carries a differently-shaped warnings field" sweep still passes |
| request bodies: `RULE_EXEMPTIONS === {}` | unchanged, still empty |
| request-body count | 11 → **12** (the form-answer body; CONTRACT-009 adds a media type, not a body) |
| mandatory/omittable partition | `POST /api/threads/{id}/turns/{ts}/form: true` added |
| SSE query-key vocabulary | untouched — no key added, still nine shapes |
| optional actor header on every mutating operation; no actor in any body | green, form route included |

**Deferred, with the reason and the substitute evidence** (silent omission would be a fail):

- **TEST-56 / TEST-57 / TEST-59** (answer appends a real turn on disk; exactly one `evt_*.json` with
  `type: form.respond`; the thread leaves `needs=form`) — `DEFERRED → SERVER-016`. No server handler
  exists for this route yet, and `packages/contract` may not write one (§9.3). Substitute: the route,
  both schemas, the payload schema and the fence-matching predicate are exercised over real HTTP
  through the mounted contract routes, as quoted above.
- **TEST-60** (a real `resolve` against a workspace whose git hook rejects the auto-commit returns a
  non-empty `warnings` array) — `DEFERRED → SERVER-023`. The server still returns a bare summary
  until it consumes this shape. Substitute: the mounted route returns the `commit_failed` warning
  over real HTTP, quoted above.
- **TEST-62** (a real reap past the attempt cap returns the event in `failed`) — `DEFERRED →
  SERVER-023`; `apps/server/src/queue/routes.ts:35` drops `failed` today.
- **TEST-64** (`GET /api/jobs` against a real server) — `DEFERRED → SERVER-023`. The field is
  **required and nullable**, deliberately: the alternative (optional) would let the server keep
  silently omitting it forever, and the contract's response-side convention is nullable-not-optional.
  The server must send `originTitle: null` at minimum; that is a named item in the follow-through
  list below, and it is a **compile error** until it does — which is the point.
- **TEST-52's SPEC.md §6 amendment** — the fence grammar is user-observable behaviour, so per
  SHARED-002's process rule it lands with a spec-writer-drafted §6 amendment held for user sign-off
  at the phase PR. **Not drafted here**: `packages/contract` does not edit SPEC.md. Escalated to the
  orchestrator; the grammar as pinned is quoted verbatim in the Technical Design above, ready to be
  turned into spec text.

### Downstream compile breaks this issue creates (for SERVER-023 / CLI-008)

See the consolidated, **measured** list in `issues/contract/009-thread-multipart-rider.md` →
Post-Implementation Verification → *Blast radius*. The sites this issue owns are
`apps/server/src/queue/routes.ts:34` (TS2345, `failed`), `apps/server/src/threads/routes.ts:76` and
`:84` (TS2345, resolve/reopen wrapper), `apps/server/src/jobs/project.ts:85` (TS2741, `originTitle`),
and — with **no** compile error — `apps/cli/src/commands/thread/status.ts:33`, where
`corpus thread resolve/reopen --json` changes output shape and `docs/cli.md` must be regenerated with
a corrected description.

## Completion Checklist (domain agent)

- [x] Tests written and passing (33 files / 881 tests green in `packages/contract`)
- [x] `/lint` passes — eslint exit 0, prettier clean, `tsc --noEmit` exit 0 **for `packages/contract`**. Repo-wide `typecheck` is red **only** in `apps/server` (5 errors, measured); `apps/cli`, `packages/kit` and `apps/ui` are all exit 0. Exact sites in CONTRACT-009's log for SERVER-023.
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
