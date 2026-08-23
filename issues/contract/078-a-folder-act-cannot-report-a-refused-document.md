# [CONTRACT-078] A folder act cannot report a document it refused

## Domain
contract

## Priority
P2

## Status
done

## Model
opus

## Dependencies
- Depends on: CONTRACT-075, SERVER-136 (which found it)

## Spec References
- SPEC.md §9.2 — "a response's warnings also carry effects on documents the request never named"

## Summary

Escalated by SERVER-136's implementer, 2026-08-22, against a shape it could not
change from its own workspace.

A folder act — rename, archive, unarchive, delete — plans a write per document
under the folder. A single document can refuse its write. **The caller is never
told which one.** `WARNING_CODES` is a closed enum with no code for a refused
document, and `FolderRenameResult`, `FolderArchiveResult` and
`FolderDeleteResult` have no `refused` array. So the act reports the documents it
moved and stays silent about the one it did not.

SERVER-136 recorded this rather than inventing a code, which was right: adding a
warning code is a contract change, and a server that invents one puts a value on
the wire no client can parse.

## Why it is P2 and not in the v0.19.0 release

A per-document refusal inside a folder act is an edge — a file the write lane
could not take. The act still commits what it could, and the projection stays
truthful. The gap is that the explorer's folder menu (UI-150) cannot tell the
user "eleven of twelve moved". That is worth fixing and is not worth widening a
release for.

## Acceptance Criteria
- [x] Either `WARNING_CODES` gains a code for a refused document, or each
      `Folder*Result` gains a `refused` array naming the document and the reason
      — the array, on the two results whose act can produce one
- [x] Whichever is chosen, exactly one of them exists — a refusal is not
      reportable two ways
- [x] SERVER-136's acts emit it, and a test proves a refused document reaches
      the caller
- [ ] UI-150's folder menu says what was refused — **not done here**, see below

## Testing Strategy
Contract: the published shape and its example. Server: an act with one document
whose write is refused.

## E2E Verification Plan
### Verification Steps
1. Make one document under a folder unwritable.
2. Archive the folder.
3. The response names the refused document, and the other documents archived.

## E2E Verification Log

Model: **opus** (claude-opus-5, 1M context).

### The choice, and why

**A `refused` array on the result, not a warning code.** `Warning.detail` is
prose and is published as "never parsed, which is why every distinction a client
must act on lives in `code`" — and the distinction a client must act on here is
*which document*, which cannot live in an enum. The gap this issue names is that
the explorer cannot say "eleven of twelve moved"; a count and an id are
structure. `POST /api/docs/bulk` already reports its refusals as an array, so
this is the repository's existing answer to the same question rather than a new
one. No warning code was added, which is the second criterion — and a test now
pins that `WARNING_CODES` is unchanged and holds nothing matching `refus`.

**No reason class beside the message**, where the bulk result carries one. Two
reasons, both recorded in `FolderRefusalSchema`'s docblock. Bulk's four classes
exist because a bulk request *names* its rows, so `not-found` and
`not-applicable` are facts about the caller's own request; a folder act names a
folder and the server enumerates what is under it, so no refusal here is the
caller's mistake and every one has the same remedy — read the message, fix that
document, run the act again. And the class would have to be **guessed from a
caught `unknown`**: `loadDocument` answers a vanished file with the same kind of
throw as a validator's refusal, so a class would be a guess published as a fact,
which is worse than a message that is true.

**The rename result gets no `refused`, deliberately.** It is one directory move
(`renameDir`, one operation for the whole folder — there is no per-document
`try` in `renameFolder` and there cannot be one), so it applies to every document
under the folder or to none, and a failure is the request's `4xx`. `bulk.ts`
already argues that a declared class with no producer is not free: a client
author writes a recovery that can never run. The absence is stated in the schema
and pinned by a test, so nobody reads it as an oversight.

### What landed

- `packages/contract/src/schemas/folders.ts` — `FolderRefusalSchema`
  (`{id, message}`, both required, `message` non-empty), published as
  `FolderRefusal`; `refused` on `FolderStatusResult` and `DeleteFolderResult`.
  Each result's `documents` description now says where a refused document also
  appears, because **the two shapes disagree**: a status act reports the status
  each document *has*, so a refused one is listed there with the status it kept,
  while a delete reports what it removed and a refused document is not among
  them.
- `packages/contract/src/routes/folders.ts` — the three route descriptions say
  it where a caller reads them.
- `apps/server/src/folders/acts.ts` — `refusalLogged` became `refusalReported`:
  it still logs for an operator (§11's log half) **and** returns the entry. The
  message is the error's own.
- `apps/ui/e2e/stubCorpus.ts` and the contract's own mount fixtures — `refused:
  []`, mechanically, so the repository stays green.

### The field is required, and that broke every constructor

As it should: adding a required response field is additive on the wire and
breaking in TypeScript for anything that *builds* one. `tsc` named all four —
the kit's client (which turned out to need only a rebuilt `dist`), the UI's e2e
stub, and the contract's two mount fixtures. Every *reader* compiled unchanged.

```
$ npm run build && npm run generate -w packages/contract && npm run build
$ npm run typecheck -w packages/contract → 0
$ npm run typecheck -w apps/server       → 0
$ npm run typecheck -w packages/kit      → 0
$ npm run typecheck -w apps/ui           → 0
```

### Tests

Contract: `schemas/folders.test.ts` gains the refused round-trip, the
required-ness of the list on both results, the empty-message refusal, and the
rename's deliberate absence. `openapi.test.ts` gains the published shape, the
`required` arrays, the no-warning-code check, the route prose, and the
`documents` disagreement. `client/index.test.ts` reads a refusal back **through
the typed client**, because the shape is what a consumer compiles against.

Server: two real-workspace tests, one per shape.

```
$ VITEST_MAX_THREADS=4 vitest run packages/contract
Test Files  69 passed (69)     Tests  2906 passed (2906)

$ VITEST_MAX_THREADS=4 vitest run apps/server/src/folders
Test Files  2 passed (2)       Tests  40 passed (40)
```

**How a document is made to refuse, deterministically.** Its file is replaced by
a **directory**, so the read fails with `EISDIR` — the trick `withBrokenQueue`
already uses in this repository, and for its reason: a permission bit proves
nothing in a container running as root. The projection still holds the row, so
the act counts the document as a member of the folder and then cannot apply to
it. The directory is given a file of its own, because the delete's tidy-up pass
prunes an empty one and the point of that test is that the document's place
survives.

### Falsification

The server was made to log the refusal and not report it — the exact behaviour
before this issue:

```
$ # `refused.push(...)` → `refusalReported(...)` in both loops
× POST /api/folders/archive and /unarchive > names the document it could not apply to, and archives the rest
× POST /api/folders/delete > names the document it could not delete, and leaves it on disk
Tests  2 failed | 29 passed (31)
```

Restored. Both tests fail without the fix, which is what makes them tests.

### Lint

```
$ eslint <9 touched files>              → 0
$ prettier --check <9 files + openapi.json> → clean
```

### Not done here, and it is a whole domain away

**AC 4 — UI-150's folder menu — is untouched.** It is `apps/ui`/`packages/kit`
work: the menu has to render the count and the names, and that is a design
decision about the explorer rather than a contract one. The field is on the
generated client and the kit's `archiveFolder`/`unarchiveFolder`/`deleteFolder`
already return it, so the UI issue is unblocked. **The orchestrator should file
or assign it**; this issue is otherwise complete.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-078]` prefix
