# [SERVER-098] Derive the key, verify it, and refuse with the document

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049
- Blocks: SERVER-099

## Spec References

- SPEC.md **§7** "A key, not a lock" — every paragraph
- SPEC.md **§9.2** — the Keys bullet
- SPEC.md **§4** — the edit session, which is where the advisory signal comes from

## Summary

The server half of SHARED-041: compute a document's key, check it on the writes
that need one, refuse a stale one with the current document and a fresh key, and
report whether a person has a session open.

This issue **adds**. SERVER-099 removes the lock subsystem. They are separate so
each is reviewable on its own, and they land in the same PR.

## Acceptance Criteria

- [x] Every read that returns a document returns its key, derived per
      CONTRACT-049. No stored state, no registry, nothing to expire
- [x] A body-replacing or whole-frontmatter `PUT` **requires** a key. Missing is
      refused exactly as stale is — an optional check reproduces the lock
- [x] A delta-naming write takes no key and is unaffected: tags, folder, status,
      `reviewed`, archive, unarchive, move. So is `POST /api/docs/{id}/patch`
- [x] A stale key answers `409` with the document as it now stands and a fresh
      key. **Nothing is written** — assert the file on disk is untouched and no
      commit was made
- [x] The advisory signal reports whether a **person** has an edit session open
      (`edit/sessions.ts` already knows — expose it, do not build new tracking).
      It never refuses anything
- [x] An **out-of-band edit invalidates a key**, with no watcher involvement. This
      falls out of deriving from content; prove it rather than assume it
- [x] A **move does not invalidate a key** (§9.2: the id never changes)
- [x] The key a write returns is the key of what was **stored**, after anchor
      reconciliation (§6) — not of what the caller sent. Otherwise a writer's own
      next write is refused by its own reconciliation
- [x] Concurrency: two writes presenting the same key, one wins, one gets `409`.
      Serialised against the same mutex the write path already holds

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/key.ts` (new) — derivation, one place
- `apps/server/src/docs/update.ts`, `read.ts`, `routes.ts`
- `apps/server/src/edit/sessions.ts` — expose "is a session open on this doc"

### Key Implementation Details

Derive from the **stored bytes** — the serialized document — rather than from the
parsed model, so anything that changes the file changes the key, including
changes nothing has modelled yet.

The check belongs where `updateDocumentLocked` already reads the document under
the document mutex. Reading, comparing and writing must be inside one critical
section or the check is decorative.

### Edge Cases

- **A document that does not exist**: `404`, not `409`. The key question never
  arises.
- **A write whose key is valid but whose content is identical**: lands as a
  no-op save (§9.2) and returns the same key. Not a conflict.
- **The reconciliation case above** is the subtle one and deserves its own test:
  write body B with key K, the server reconciles anchors and stores B′, and the
  returned key must be key(B′).

## Testing Strategy

Unit and integration against the real write pipeline. The conflict path is the
one to over-test: assert the refusal's payload, that nothing was written, that
no commit was made, and that the fresh key works on retry.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`. Never write to
`/Users/theophanerupin/cos` — the user's real workspace.

Read a document, edit the file in an external editor, then write with the old
key: refused, with the current content back. Retry with the fresh key: lands.

## E2E Verification Log

**Model: opus.** 2026-08-11.

Real `corpus-server` process (`npx tsx apps/server/src/main.ts --workspace …`), real
git repository, real HTTP over curl. Scratch workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws098`, port **8791** (never
8765 or 5173). The workspace was seeded with an **anchored** document
(`doc_e2ekey01`) and its thread, so every write exercised §6 reconciliation.

**A caveat stated up front, because the evidence depends on it.** CONTRACT-049
deleted `LOCKS_KEY`, `lockKey`, `LockSchema` and `DEFAULT_LOCK_TTL_SECONDS`, and
three server modules still import them *as values*. Under vitest's esbuild
transform that is survivable; under real Node ESM it is a hard
`SyntaxError: … does not provide an export named 'LOCKS_KEY'` at boot, so **the
tree cannot start a server until SERVER-099 lands**. The E2E below therefore ran
with a temporary local shim defining those four symbols in
`events/keys.ts`, `locks/store.ts` and `projection/project-runtime.ts`. The shim
was **reverted from backups before the final gate**, and the final typecheck /
suite numbers below are from the reverted tree. Nothing the shim touched is on
any path this issue changes.

### The derivation is what the contract fixed, checkable with a third-party tool

```
GET /api/docs/doc_e2ekey01      key      = fea9e81a…37a60e21
                                userEditing = False
shasum -a 256 data/docs/inbox/mortgage.md
                                fea9e81a…37a60e21
```

Byte-identical to `shasum`'s digest of the file — frontmatter and body together,
un-normalised.

### Required means required (a body write with no key)

```
PUT {"body":"an overwrite of nothing I read"}     -> 400 bad_request
   issue path    = json.key
   issue message = "`key` is required when the request carries `body`: …"
file sha unchanged  fea9e81a…            HEAD unchanged  9f373122
```

### The issue's own plan: read, hand-edit the file, write with the old key

```
key read by the writer            fea9e81a…37a60e21
$ vim data/docs/inbox/mortgage.md   (append to the closing paragraph)
file now                          3e4248fc…6e18e96bb1

PUT {"body":"my version…","key":"fea9e81a…"}      -> 409
   code     = stale_key
   message  = "the key presented for doc_e2ekey01 names a version this document no longer is…"
   doc.body = "…Closing paragraph, edited by hand in vim."      ← the current document, back
   doc.key  = 3e4248fc…6e18e96bb1                               ← equals the file's sha256
   doc.frontmatter.id = doc_e2ekey01
file after refusal   3e4248fc…  (unchanged)      HEAD after refusal  9f373122  (unchanged)
```

**Nothing written, no commit.** The refusal carried the hand edit the writer had
never seen — one exchange, not two.

Then the retry landed, and incidentally proved a second thing: the *first* retry
was itself refused, because the watcher had healed the hand edit against `HEAD`
in the meantime (§6) and that heal is a change like any other. Re-read, retry:

```
PUT {"body":"A new opening paragraph.\n\n…","key":"98fef3d1…"}   -> 200
   anchors.remapped = ["anc_e2e00001"]
   returned key     = e1df9b0e…3fef12546
file on disk sha    = e1df9b0e…3fef12546                        ← identical
```

### Criterion 1 — the key names what was **stored**, after reconciliation

The frontmatter the request never sent, rewritten by §6 inside the same save:

```
anchors:
  anc_e2e00001:
    exact: The rate is fixed for five years.
    prefix: |+
      g paragraph.

      Intro paragraph.
```

The returned key is the sha256 of *that* file. And the writer's own next writes,
presenting only the key its previous write answered with and never re-reading:

```
rewrite 2 -> 200  remapped=['anc_e2e00001']  key=d0f87661…
rewrite 3 -> 200  remapped=['anc_e2e00001']  key=cbea4da1…
file sha                                         cbea4da1…
```

No phantom conflict. **Falsified in the unit suite** (`docs/key.test.ts`):
replacing the returned key with one derived from the caller's own patch makes
both reconciliation tests fail, the second with exactly the predicted symptom —
`expected [ 'Second rewrite.', 409 ] to deeply equal [ 'Second rewrite.', 200 ]`.

### A move does not invalidate a key (§9.2)

```
key read before the move   c8…            POST /move {"folder":"finance"}  -> 200
path now                   data/docs/finance/mortgage.md
PUT with the pre-move key                                                  -> 200
```

### Delta writes take no key; a volunteered one is still checked

```
{"tags":["finance"]}                 -> 200      POST /archive     -> 200
{"status":"resolved"}                -> 200      POST /unarchive   -> 200
{"reviewed":"2026-08-11T10:00:00Z"}  -> 200      POST /move        -> 200
{"evergreen":true}                   -> 200
{"title":"…"}                        -> 200

{"tags":["x"],"key":"bbbb…"}         -> 409 stale_key
unknown id + a well-formed key       -> 404 not_found   (never 409)
```

### Someone is editing this — advisory, never a gate

Two fresh documents, one edited by the person and one by the agent:

```
                          A (person)   B (agent)
before any edit           False        False
after each one's save     True         False        ← the agent opens no session
after flushing A          False        False
```

And it refuses nothing: with `userEditing = True` on a document, an agent `PUT`
answered **200**, wrote its body, and left the signal `True`.

### Two writers, one key

```
POST /api/docs → doc_qcuesovy,  both writers read key e9011b6d… (before)
writer B -> 200      writer A -> 409 stale_key
stored body: 'written by B'                    ← whole, never a merge
A's doc.key == B's doc.key == e9011b6d…        ← the loser gets exactly what the winner has
```

### Restart

```
key before restart   c2cd7ded…756c113e
key after  restart   c2cd7ded…756c113e
file sha             c2cd7ded…756c113e
PUT with the pre-restart key -> 200
```

Nothing was stored, so nothing was lost. `git log` for the session shows the
expected acts and §4 windows, and the two refusals left no commit behind.

### Checks run

- `npx tsc --noEmit` in `apps/server`: **47 errors in 17 files, all the lock
  subsystem's** — the same 47 CONTRACT-049 handed over, minus the one in
  `docs/read.ts` this issue fixed. No new error in any file this issue touches.
- `npx vitest run apps/server`: **3812 tests, 99 failures, every one lock-related**
  (`locks/*`, `bulk`'s `lock` refusal field, `projection`'s lock table and
  `LOCKS_KEY`, `watcher`'s lock keys, `errors`' `locked` code, and the lock-guard
  cases in `docs`/`threads`/`skills`/`plugins`). `docs/key.test.ts` 20/20;
  `edit/sessions.test.ts` 42/42.
- `npx eslint` on every touched file: clean. `npx prettier --check apps/server/src`:
  clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
