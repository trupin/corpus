# [SERVER-075] A person's reply with an unterminated fence swallows every later turn

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Sibling of: SERVER-066 (`doc check` reports it), AGENT-016 (the skill rule)

## Spec References

- SPEC.md **§6** — a fenced block closes only on a line holding nothing but its
  run; a turn that leaves one open swallows the turns after it
- SPEC.md **§14** — the validator reports an unterminated fence

## Summary

**Found by the pr-reviewer during PR #28's final review**, while checking a
sentence I had written into §6 claiming a person is "never refused" for any of
the shapes the form rules name — one of which is an unterminated fence. The
claim was true of the code, and that is the defect: the reply path guards
nothing.

Probed against the real `parseTurns`:

```
body: user turn → "```js" (never closed) → agent turn → user turn
turns parsed: 1
```

**Two turns vanish.** They are still on disk, but every reader — the board, the
projection, the agent — sees one turn. The conversation silently loses its
later half.

`assertAppendableAnswer` (`apps/server/src/threads/forms.ts:140`) checks for
this, but it runs **only on the form-answer route**. The ordinary reply path
(`apps/server/src/threads/turns.ts:246`) calls only `assertWritableForm`, which
no-ops for a non-agent actor. So the one path a person uses most is the one path
unguarded.

**Why this is P0 and not a footnote**: §11's snippet feature exists to paste
fenced content into composers, so producing an unterminated fence is a mainline
action, not a corner case. SERVER-066 made `doc check` *report* the condition
after the fact; nothing stops it being written, and by then the turns are
already invisible.

## The tension this must resolve, deliberately

SERVER-066 chose **non-blocking** for `doc check`: a pre-existing condition must
not block a save, because refusing a person's edit to protect them from
something already on disk is worse than the condition. That decision was right
and stays.

**This is a different moment.** The write being refused is the one *introducing*
the fault, the writer is present, and the fix is one character. Refusing here is
not blocking a save for a pre-existing condition; it is declining to create a new
one. Say that in the code, or someone will read SERVER-066 and revert this.

## Acceptance Criteria

- [x] Reproduced first, with the swallowing observed before the fix, logged with
      the actual turn count
- [x] A turn whose body leaves a fence open is refused on the **reply** path, for
      **every** actor — this is not the agent-only asymmetry the form rules draw,
      because the damage does not depend on who wrote it
- [x] The refusal **names the line the fence opened on**. `unterminatedFence`
      already returns it (`core/code.ts:231-244`); it is currently discarded
- [x] The person's wording is **never lost** — the refusal is something to fix in
      the composer, not a message arriving after the text is gone
- [x] A turn that merely *quotes* a fence correctly (opened wider, closed on its
      own line) is untouched — §6's snippet rule depends on it
- [x] **Pre-existing unterminated fences still do not block anything.**
      SERVER-066's non-blocking decision is unchanged; only the write that
      introduces one is refused
- [x] `corpus doc check` still reports the condition for files that already have
      it, unchanged

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/turns.ts` (the reply path), reusing
  `unterminatedFence` from `apps/server/src/core/code.ts` — do not write a
  second scanner.

### Notes

- Check `POST /api/threads` (thread creation) and the capture path too. SERVER-070
  found that thread creation is a second door for malformed forms; this is very
  likely the same shape, and finding out after shipping the reply fix would be
  the third time.
- The same scanner is what the UI needs for a pre-check (see CONTRACT-044); if
  moving it to the contract is the right call, coordinate rather than duplicating.

## Testing Strategy

The reviewer's fixture is the regression test: a four-turn body with an
unterminated fence in the first, asserting four turns parse after the fix and
that the write is refused before it. Plus the correctly-quoted-fence case
asserted as accepted, and a pre-existing bad file asserted as still saveable.

## E2E Verification Log

**Model: Opus 5 (1M context)** — server-dev agent, 2026-08-08.

Real server (`tsx apps/server/src/main.ts`) on **port 8791** against a real
`corpus init` workspace at `/tmp/s075-ws`. Ports 8765 and 5173 untouched.

### Pre-fix reproduction (SDLC step 1) — three doors, all open

**Door 1 — `POST /api/threads/{id}/turns` (the reply path).** Four turns posted,
the second leaving a fence open. Every POST answered **201**:

```
turn2(unterminated fence) http=201
turn3(agent)  http=201
turn4(user)   http=201
GET /api/threads/th_j2zokpwl → TURNS PARSED BY THE SERVER: 2
 - user  2026-08-08T02:14:01Z "First turn, plain."
 - user  2026-08-08T02:14:02Z "Here is the snippet:\n\n```js\nconst x = 1;\n\n## agent · 2026-08-08T02:14:"
```

**Four turns on disk, two visible.** Turns 3 and 4 are swallowed into turn 2's
body — the file (`cat data/threads/th_j2zokpwl.md`) holds all four `## author ·`
headings; the reader sees two.

**Door 2 — `POST /api/threads` (thread creation), the issue's own fixture.**
Unterminated fence in the *first* turn, three replies after it:

```
create http=201 → th_e7s6jofr
turn2 http=201 / turn3 http=201 / turn4 http=201
turns on disk: 4, turns parsed: 1
```

**Door 3 — `POST /api/capture`.** The captured text becomes the filing thread's
first turn:

```
capture http=201 → th_r3xvyxm4
turn2 http=201 / turn3 http=201
turns on disk: 3, turns parsed: 1
```

So the issue's suspicion was right: thread creation and capture were the second
and third doors, exactly the SERVER-070 shape.

### Post-fix, same server restarted with the change

```
1. reply, user, unterminated fence            → 400
   {"code":"bad_request",
    "message":"this turn leaves a code fence open: the ``` on line 3 is never
      closed, so everything after it reads as code and every later turn in the
      thread would become invisible. Close it with a line holding nothing but ```.",
    "issues":[{"path":"body","message":"unterminated ``` code fence opened on line 3"}]}
2. reply, AGENT, same shape                   → 400 ("… the ``` on line 1 …")
3. reply quoting a fence wider (````markdown) → 201, then agent 201, then user 201
   GET → TURNS PARSED: 4 -> user, user, agent, user
4. POST /api/threads, fence open in turn 1    → 400, same message, line 3
5. POST /api/threads, fence closed            → 201
6. POST /api/capture, fence open              → 400, issues[0].path = "text"
7. POST /api/capture, fence closed            → 201
```

Nothing was written by any refusal: `ls data/docs/inbox/` shows only the
pre-fix capture (`note-this.md`), the doc from step 9 and the *accepted* post-fix
capture (`snippet.md`) — the refused capture left no file, no commit, no event.

### The two things that must NOT have changed (SERVER-066)

```
8. reply to th_j2zokpwl — the thread broken BEFORE the fix → 201
   server log: {"level":"error","msg":"document saved with validation errors",
     "path":"data/threads/th_j2zokpwl.md",
     "errors":["unterminated-fence: … opened at line 19 …"]}
9. PUT /api/docs/doc_mr2uetbe with an open fence in the body → 200
   server log: same non-blocking `unterminated-fence` error, file saved
```

`corpus doc check` on the same workspace still reports every pre-existing case,
unchanged — 5 errors across the threads and documents the pre-fix run created:

```
error unterminated-fence data/threads/th_j2zokpwl.md: … so those turns are lost
error unterminated-fence data/threads/th_r3xvyxm4.md: …
error unterminated-fence data/threads/th_e7s6jofr.md: …
error unterminated-fence data/docs/inbox/note-this.md: …
error unterminated-fence data/docs/inbox/fence-doc.md: …
corpus: 5 errors in 20 documents.
```

### Wording is never lost

The refusal is thrown **before the document lane and before any byte is
written** (no attachment directory is created either — asserted in
`turns.test.ts`), so the request fails with the composer still holding the text.
`apps/ui/src/thread/ThreadComposer.tsx:120` already restores it on error
("the composer goes back to exactly what it held"), so the end-to-end promise
holds with no UI change.

### Checks

- `VITEST_MAX_THREADS=4 npx vitest run apps/server` — **170 files, 3491 tests, all passing**
- `tsc --noEmit` in `apps/server` — clean
- `eslint apps/server/src` — clean, no suppressions
- `prettier --check apps/server/src` — clean

### Notes / not done

- The heading-hijack half of `assertAppendableAnswer` (a turn body containing a
  literal `## user · <ts>` line) is **not** extended to the reply path. Out of
  scope, and it differs in kind: a fabricated heading is visible when it
  happens, where a swallowed turn is silent. Worth its own issue if wanted.
- No contract change was needed: `400` is already declared on all three routes.
  A UI pre-check (CONTRACT-044) would need the scanner in `@corpus/contract`;
  that stays a coordination question, not something done here.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
