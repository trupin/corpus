# [CONTRACT-028] `doc.edited` queue event + doc-diff route

## Domain
contract

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-008
- Blocks: SERVER-052, CLI-026

## Spec References
- SHARED-008 rider

## Summary
Two additions. (1) A `doc.edited` queue-event payload: document id, the edit
session's commit range (from/to revisions), and change stats (files always 1;
insertions/deletions or hunk count — pick what git furnishes cheaply); NEVER
the diff body (frugal-event rule, same economics as context packs). Fit the
existing event-schema family and the closed event-kind vocabulary. (2) A diff
route for the CLI verb: `GET /api/docs/{id}/diff?from=<rev>&to=<rev>` (shape it
against the existing git/show surface — reuse before inventing), returning the
unified diff bounded by a size cap with a `truncated` flag, matching the
CONTEXT_MAX_* bounding conventions.

## Acceptance Criteria
- [x] Event schema in the queue vocabulary; kind enum extended deliberately
- [x] Diff route with bounded body + truncated flag; errors per house envelope
- [x] openapi.json + generated client regenerated (drift-checked)

## Technical Design
### Files to Create/Modify
- packages/contract event schemas + routes + inventory + generated artifacts

## Testing Strategy
Schema/route tests per house patterns.

## Design Decisions (contract-dev, 2026-08-04)

**Status: todo → done.**

### 1. `doc.edited` joins the closed core vocabulary
`CORE_QUEUE_EVENT_TYPES` becomes `["comment.created", "form.respond",
"doc.edited", "agent.done"]` — ordered by producer, with §7's reserved
`agent.done` last. The payload is declared beside its feature in
`schemas/edit.ts` as a plain (unregistered) `z.object` with a
`parseDocEditedPayload` narrowing function, exactly the arrangement
`form.respond` uses in `schemas/form.ts`: §7 keeps `QueueEvent.type` an open
string so plugins can define their own, so the envelope never becomes a
discriminated union.

```
{ docId, sessionId, actor: "user", endedBy: "close"|"idle", from, to,
  stats: { commits, insertions, deletions } }
```

### 2. "Change stats" resolved to three numbers, and no file count
`insertions` / `deletions` / `commits`, all from `git diff --shortstat`
path-scoped to the document's file — cheap, and enough for the only decision
the agent makes before fetching: a one-line typo fix and a two-hundred-line
rewrite are different jobs. **No `files`**: it is 1 on every surface that
carries these stats, and a constant is not a statistic (the issue predicted
this). No hunk count: `--shortstat` does not furnish one without reading the
diff, which is the cost the frugal event exists to avoid.

### 3. The range: two shas, exclusive base, inclusive head
`from..to`, read exactly as `git diff from..to`. §4's squash means a session is
normally **one** commit, so `commits` is normally 1 and `from` is that commit's
parent — a range of one, said explicitly in the schema rather than left to be
inferred. Where a session's first commit has no parent, `from` is
`EMPTY_TREE_OBJECT_ID` (git's universal empty-tree object, published as a
contract constant) rather than `null`: that keeps the event's range **passable
verbatim** to the diff route, which is the property that makes a frugal event
usable at all. A session whose auto-commits were all rejected or skipped (§14)
has no range and emits **no event** — there is no null-range `doc.edited`.

### 4. Idempotence: `sessionId` is the dedupe key
Both end paths can fire for one session; §4 requires one event. `sessionId` is
a required opaque string with one published invariant: **at most one
`doc.edited` may exist per value**, and a consumer may drop a repeat on that
basis alone without diffing payloads or reasoning about timestamps. `endedBy`
names the trigger that *ended* the session — the first to fire — never the last
thing that happened to it.

### 5. Actor scoping is `z.literal("user")`
Not the `Actor` enum. An agent-authored value is a contract violation rather
than a variant, so `parseDocEditedPayload` **rejects** it: the "the loop cannot
feed itself" guarantee holds at the consumer as well as at the emitter, even if
a future server regresses on the emit side.

### 6. The diff route: `GET /api/docs/{id}/diff?from=&to=`
- **Bound: `DOC_DIFF_MAX_CHARS = 16000`** characters — 4× the context pack's
  `CONTEXT_MAX_SECTION_CHARS` (a diff carries both sides of every hunk plus
  context, where a pack carries one section once), and under a quarter of
  `EXTRA_MAX_BYTES`. Pinned by a test so moving it means revisiting the
  rationale.
- **Over-limit: truncate, never refuse.** Whole hunks are dropped from the end
  so the answer is still a valid unified diff; `truncated` says so and
  `totalChars` says by how much. Refusing would leave a caller that already
  spent a wake-up with nothing (contrast the job-log cap, which drops a *line*
  because a log has no front-loaded substance; a diff does).
- **Both range halves optional**, no Zod default (both defaults are computed
  from history): `to` → newest commit touching this document, `from` → parent
  of `to`. So the bare `corpus doc diff <id>` the rider itself spells reads as
  "what changed in this document's last commit". Resolved values come back in
  the response.
- **Sha-only grammar.** `HEAD~1`, tags and `--output=…` are a `400` naming the
  parameter before a handler — and therefore before a `git` argv — exists. A
  well-formed sha the repository does not contain is *also* a `400` naming the
  parameter, never a `404`: `404` on this route means the **document** is
  unknown.
- **No committed history** (never-committed file, or no git — §14): `200` with
  `from`/`to` null, empty diff, zero stats. An answer, not an error.

### 7. No flush route declared
§4's `close` path is the UI flushing the session, and §7 already has the signal:
the user's editor session releases its edit lock on close
(`DELETE /api/locks/{docId}`). Documented on `EditSessionEndReasonSchema`. If
SERVER-052/UI-044 find they need a call the contract does not carry, that is a
contract change here, not a server-local addition (§9.3).

## SPEC amendments — DRAFTED HERE, APPLIED BY THE ORCHESTRATOR (signed 2026-08-05)

Both were applied to SPEC.md and signed by the user on 2026-08-05, after the
PR #22 review flagged that this file and `routes/inventory.ts` still described
them as held. The text below is what shipped.

The signed rider landed in §4 only. Two places still describe a world without
`doc.edited`; both are consequences of already-signed text, so they are drafted
here and **not applied** (this package never edits SPEC.md).

1. **§7, "Core event types" sentence** — insert after the `form.respond` clause:

   > `doc.edited` (a user edit session that ended, §4 — payload
   > `{docId, sessionId, actor: "user", endedBy: "close"|"idle", from, to,
   > stats: {commits, insertions, deletions}}`, where `from`..`to` is the
   > session's commit range and `sessionId` is the key that makes the event
   > idempotent across the two end paths; never the diff body),

2. **§9.2, new bullet after `GET /api/docs/:id/related`**:

   > - `GET /api/docs/:id/diff?from=&to=` — the unified diff of one document
   >   across a commit range, path-scoped, and the read behind `corpus doc diff`
   >   (§4). Both range halves are optional: `to` defaults to the newest commit
   >   that touched the document and `from` to its parent. Bounded — the body is
   >   capped and a larger diff is truncated at a hunk boundary with a
   >   `truncated` flag and the full size, never refused. Revisions are commit
   >   shas only; a sha this workspace does not contain is a `400` naming the
   >   parameter, and the `404` means the document is unknown. A document with no
   >   committed history answers a null range and an empty diff. Read-only; no
   >   acting party.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-04, branch
`phase-11-edit-ack`. Contract-only change; nothing outside `packages/contract`
was touched (two other agents were live in `apps/ui/src/anchors/` and
`apps/server/src/docs/`).

**1. Typed client against the real route definition, over a real HTTP socket**
(port 9412 — never 8765 or 5173). A throwaway tsx script mounted
`contractRoutes.getDocDiff` on `@hono/node-server` and drove it with
`createCorpusClient` from the *regenerated* client types, replaying the agent's
actual loop:

```
1. narrowed doc.edited: {"docId":"doc_a1b2c3","sessionId":"sess_1","actor":"user",
   "endedBy":"idle","from":"0a1b2c3…4567","to":"9f1c2ab…3456",
   "stats":{"commits":1,"insertions":900,"deletions":900}}
2. diff over HTTP: {"status":200,"from":"0a1b2c3…4567","to":"9f1c2ab…3456",
   "truncated":true,"diffChars":16000,"totalChars":61200,"withinBound":true}
3. agent-authored payload narrows to: undefined
4. bare `corpus doc diff <id>`: 200 0a1b2c3…4567 9f1c2ab…3456
5. from=HEAD~1 → 400 {"code":"bad_request","message":"request failed validation",
   "issues":[{"path":"query.from","message":"Invalid string: must match pattern
   /^[0-9a-f]{7,64}$/"}]}
6. from=<empty tree> → 200 4b825dc642cb6eb9a060e54bf8d69288fbee4904
```

Line 2 is the bound holding over the wire (61 200 characters of diff arriving as
16 000 with the flag and the true size); line 3 is actor scoping refusing an
agent-authored event at the narrowing boundary; line 5 is the sha-only grammar
rejecting a git-DSL string before any handler ran.

**2. Generation idempotence.** `shasum` of both artifacts → `npm run generate -w
packages/contract` → `shasum` again: `diff` exit **0**.
`openapi.json` = `db68e6fd49d1585be2de22b14bb869c802376fef76eaddda383e030558470803`,
`schema.generated.ts` = `58554d60defc50341a28bd9705179db72a4ff044bc3d7a04b2517e5730c26f5e`.

**3. Drift check fires.** Hand-edited the committed `openapi.json` (changed the
diff route's `summary` to `HAND EDITED - drift probe`) and ran
`node --import tsx scripts/check-generated-artifacts.ts` → **exit 1**:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add …
✓ CLI reference is up to date (docs/cli.md).
```

Regenerated; the hashes returned to the values above (`diff` exit 0) and the
hash-across-regeneration half of the check now passes. The check still exits 1
on its `diffAgainstHead` half — the regenerated artifacts are uncommitted, which
the orchestrator's commit resolves; the two failure modes print differently (the
hand-edit case prints no git summary, this one prints `179 ++…`), so they are
distinguishable in the evidence above.

**4. Scoped gates.**
- `VITEST_MAX_THREADS=4 vitest run packages/contract` → **49 files, 1750 tests,
  all passing** (80 of them new: 60 in `schemas/edit.test.ts`, 20 in
  `routes/doc-diff.test.ts`, plus new cases in `openapi.test.ts` and
  `routes/index.test.ts`).
- `tsc --noEmit -p packages/contract/tsconfig.json` → clean.
- `eslint <10 touched files> --max-warnings 0` → no issues, no rule disabled.
- `prettier --check` → clean after `--write` on the three test files.

**5. Cleanup.** Scratch script removed, no listener left on 9412, no vitest
workers alive.

## Notes for the consuming issues

- **SERVER-052** — the contract pins the interleaving rule rather than leaving
  it open: a user session is ended *before* another author's commit to the same
  document could enter its range, so a range never spans an agent commit on that
  document (an interrupted session becomes two events, not one range crediting
  the user with the agent's work). Stats are path-scoped to the document's file.
  Emitter obligations stated in the schema: one event per `sessionId`; never
  emit for a session with no commit; `commits` ≥ 1 on any emitted event
  (`DocChangeStats` allows 0 only because the diff route's no-history answer
  needs it, and it cannot be refined per-use without propagating the registered
  component's name).
- **CLI-026** — `corpus doc diff <id>` with no flags is a legal call: both range
  halves are optional and the server defaults them. Print `truncated` from the
  flag, and the scale from `totalChars` vs `diff.length`. A bad revision and an
  unknown revision are both `400` with `issues[].path` = `query.from`/`query.to`;
  `404` means the document is unknown.
- **UI-044 / SERVER-052** — no flush endpoint was declared: §7's edit-lock
  release is already the close signal. If a distinct flush call turns out to be
  needed, it is a new contract issue, not a server-local route.
- **Ambiguity found in the rider**: it says "commit range" without saying
  whether an interleaved agent commit or a rejected auto-commit is in scope.
  Both are decided above and are the only judgment calls the rider left open.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
