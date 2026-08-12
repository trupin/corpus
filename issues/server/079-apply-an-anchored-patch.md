# [SERVER-079] Apply an anchored string patch through the ordinary write path

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-037 (rider must be signed first), CONTRACT-046
- Blocks: CLI-035

## Spec References

- SPEC.md §9.2 — the patch operation, as added by SHARED-037 (rider pending
  sign-off; §9.2 currently documents whole-body `PUT` only)
- SPEC.md §6 — anchors reconciled on every write
- SPEC.md §4 — git auto-commit, author attribution, squashing
- SPEC.md §14 — every server mutation validates before writing

## Summary

Implement `POST /api/docs/:id/patch`: locate `old` in the document's body,
verify uniqueness (or `all`), replace, and then hand the resulting body to the
**existing** write path — validation, anchor reconciliation, projection, git
commit with the acting party. The patch is a smarter front door to the same
write, not a second write path.

## Acceptance Criteria

- [ ] A unique match replaces exactly the quoted range; the rest of the body is
      byte-identical afterwards
- [ ] Zero matches → the contract's refusal with count 0; N > 1 without `all` →
      refusal with count N; nothing written in either case
- [ ] `all: true` replaces every occurrence, left-to-right, non-overlapping
- [ ] The write is ordinary downstream: anchors reconciled (§6) — including
      remap/orphan reporting when the patch hits an anchored range — validation
      before writing (§14), one attributed commit (§4), projection and SSE
      invalidation exactly as a `PUT` produces them
- [ ] A patch against a document locked by the other party is refused naming
      the holder, as any edit is (§7)
- [ ] `old` matching across the frontmatter/body boundary is impossible — the
      match runs against the body only
- [ ] A no-op patch (`old` === `new`, or replacement yields the identical body)
      follows the existing "only a real change" behaviour: success, no commit,
      no `updated` bump
- [ ] Concurrency: the match and the write are atomic under the document mutex —
      a body that changed between match and apply cannot produce a misplaced
      patch

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/patch.ts` (+ test) — the locate/replace, then delegate
- `apps/server/src/docs/update.ts` — if its internals need a seam to accept a
  computed body; prefer reusing its guts over duplicating them
- the docs routes module — mount the contract route

### Key Implementation Details

Exact string matching on the raw body — no normalisation, no trimming. The
agent quoted what `corpus doc show` served (SHARED-035's decision), and any
cleverness here is how a patch lands on the wrong text. Count occurrences with
a plain scan; report the count in the refusal so the caller knows whether to
add context (N > 1) or re-read the document (0).

Do the match **inside** the same mutex/critical section the write path already
uses (`mutateDoc` — see the todos routes' usage for the pattern), so the body
cannot move between verification and write.

### Edge Cases

- `old` containing the anchor-quoted text of a thread — the reconciliation
  reports `remapped`/`orphaned` in the response exactly as an equivalent `PUT`
  would; the patch adds nothing special
- A patch whose `new` introduces an unterminated fence — refused by the §14
  validator like any write (SERVER-075's rule holds here too)
- A patch to a document with unreadable frontmatter — same behaviour as `PUT`
  on that document today
- Very large `old` (the whole body quoted) — legal; it degrades to a whole-body
  edit

## Testing Strategy

Vitest against a real temp workspace: unique replace; both refusals with
counts and no write; `all` semantics including the overlapping-match scan;
anchor remap and orphan through a patch; lock refusal; no-op; the atomicity
test (concurrent edit between two patches serialised by the mutex). Assert
`git log` afterwards: one commit per effective patch, correctly attributed.

## E2E Verification Plan

### Verification Steps

1. Start the server on a real workspace; create a document with a known body
   and an anchored thread
2. `curl` a patch replacing a phrase away from the anchor — confirm the body on
   disk, one attributed commit, anchors intact
3. Patch the anchored phrase itself — confirm the anchor remaps (or orphans)
   and the response reports it
4. Patch with an ambiguous `old` — confirm the refusal names the count and the
   file is untouched
5. Patch while the user holds the lock, `--from agent` — confirm the refusal
   names the holder
6. `corpus db rebuild && corpus db doctor` — clean

## E2E Verification Log

**Model:** opus (claude-opus-5, 1M context). **Date:** 2026-08-12.

Not a bug, so no pre-fix reproduction: the route was declared by CONTRACT-046 and
unmounted, which `apps/server/src/json-body.test.ts` reported as 4 failing
assertions before this change and 0 after (that sweep is driven by
`ALL_CONTRACT_ROUTES`; mounting the route is what closes it — it was not
touched).

### Checks run

- `npm run build` — clean.
- `VITEST_MAX_THREADS=4 npx vitest run apps/server` — **179 files, 3748 tests, all
  passing** (78.6 s). `apps/server/src/docs/patch.test.ts` contributes 22.
- `npx eslint` + `npx prettier` on the four touched files — no issues.
- `npx tsc --noEmit -p apps/server/tsconfig.json` — clean.

### Real server, real workspace

`corpus init` + `corpus server start` on port **8791** (never 8765 or 5173), in a
scratch workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws-server079`. Seeded
`doc_jkr3xv3s` ("Mortgage options") with the body
`Intro paragraph.\n\nThe rate is fixed for five years.\n\nClosing paragraph.` and
an anchored thread `th_3b3ovtca` on the middle sentence (`anc_05e7823f`).

1. **Unique match, `--from agent`, away from the anchor.**
   `{"old":"Closing paragraph.","new":"Final paragraph, rewritten."}` → `200`,
   `replaced=1`, body on disk
   `Intro paragraph.\n\nThe rate is fixed for five years.\n\nFinal paragraph, rewritten.`
   `git log`: one new commit,
   `agent | doc edit: Mortgage options (doc_jkr3xv3s) by agent`, `--name-only`
   naming `data/docs/inbox/mortgage-options.md`. The anchor reported
   `remapped: ["anc_05e7823f"]` — its `suffix` was rewritten, exactly as the
   equivalent `PUT` does.

2. **Ambiguous.** `{"old":" paragraph","new":" para"}` → `409`
   `{"code":"conflict","reason":"multiple-matches","matches":2}` with a message
   naming the count and the recovery ("quote more of the surrounding text …").

3. **No match.** `{"old":"a sentence never written here", …}` → `409`
   `{"reason":"no-match","matches":0}`.

3b. **Frontmatter is unreachable.** `{"old":"title: Mortgage options", …}` →
   `409 no-match, matches 0`. Body-only matching confirmed against a live file.

   After 2, 3 and 3b: `git rev-parse HEAD` unchanged
   (`70e29f3373c9c84f64c0341728db06564b25160b`) and `shasum` of the document
   unchanged — **nothing written by either refusal**.

4. **`all: true`.** `{"old":" paragraph","new":" para","all":true}` → `200`,
   `replaced=2`, body `Intro para.\n\nThe rate is fixed for five years.\n\nFinal para, rewritten.`
   A subsequent `GET /api/docs/doc_jkr3xv3s` shows the anchor still resolving,
   `orphaned:false`, `range {start:13,end:46}` (was 18–51) with `prefix`/`suffix`
   refreshed — one reconciliation over one new body, two moved occurrences.

5. **No-op.** `{"old":"Intro","new":"Intro"}` → `200`, `replaced=1`,
   `warnings: []`, `HEAD` unchanged (`96e72fbb…`), `updated:` still
   `2026-08-12T19:38:07Z`. **No commit, no stamp, no file write.**

6. **No key on this request.** Sending `key` → `400`
   `{"code":"bad_request","issues":[{"path":"json","message":"Unrecognized key: \"key\""}]}`
   — the contract's strictness, as §7 intends.

7. **A patch that orphans an anchor.**
   `{"old":"The rate is fixed for five years.\n\n","new":""}` → `200`,
   `anchors {remapped: [], orphaned: ["anc_05e7823f"]}`, and §14's warning
   `orphaned_anchor: anchor `anc_05e7823f` no longer resolves in the body; its
   thread is orphaned`. The selector on disk is preserved byte-for-byte
   (`exact: The rate is fixed for five years.`), and the change is one commit,
   `agent | doc edit: Mortgage options (doc_jkr3xv3s) by agent`.

8. **A replacement containing `old`.** On a fresh `doc_s6nwui2j` with body
   `cat cat cat`: `{"old":"cat","new":"the cat sat","all":true}` → `200` in
   **95 ms**, `replaced=3`, body `the cat sat the cat sat the cat sat`. No loop:
   the scan finishes over the body as read before anything is spliced.

9. **SSE.** A `curl -N /events` held open across a patch received
   `event: invalidate` / `data: {"keys":[["docs"],["docs","doc_s6nwui2j"]]}` —
   the same frame a `PUT` produces, because it is the same pipeline.

10. **`corpus db rebuild` → `corpus db doctor`**: `rebuilt the projection in 16ms
    — 12 documents, 1 thread, 1 turn, 1 anchor …` then `projection is clean — 12
    documents from 12 files (2ms)`.

Server stopped (`stopped (pid 88258)`), port 8791 verified free.

### Two notes for the record

- **Acceptance criterion 5 ("a patch against a document locked by the other
  party is refused naming the holder") is stale.** SPEC.md §7 replaced the
  per-document lock with the key ("A key, not a lock"); there is no lock service
  and the contract declares no `423` on this route. The criterion's intent — a
  patch cannot silently overwrite another writer — is met by the mutex plus the
  key the operation presents for the version it matched against (see below).
- **The patch presents a key even though the request carries none.**
  `updateDocumentLocked` writes a body, and §7 requires a key for that;
  `patchDocumentLocked` satisfies the check honestly by presenting the key of the
  bytes it just read and matched, inside the document's lane. One consequence
  worth knowing: if an *external* editor rewrites the file between that read and
  the save's own read, the refusal surfaces as `stale_key` — a `409` shape this
  route does not declare (it is still a contract `ApiError`). Reported to the
  orchestrator rather than papered over.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-079]` prefix
