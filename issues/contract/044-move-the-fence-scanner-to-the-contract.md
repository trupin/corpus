# [CONTRACT-044] The UI cannot pre-check a fence, because the scanner lives in the server

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: UI-091
- Related: SERVER-075 (which needs the same scanner on the reply path)

## Spec References

- SPEC.md §11 — the form says what is wrong before it is sent
- SPEC.md §6 — the fence rule

## Summary

Reported by ui-dev while implementing PR #28's pre-check, and confirmed by the
final review. `formPreflight.ts` catches the marker-collision refusals before a
person submits, but **not** the unterminated fence or the fabricated turn
heading — because `unterminatedFence` and `parseTurns` live in `apps/server`,
which `apps/ui` cannot import.

The agent that hit this refused to hand-roll a second scanner in the UI, and was
right to: a duplicated fence scanner is exactly the drifting copy that PR #28
spent two findings eliminating elsewhere. It wrote the constraint into the
module docblock instead of guessing.

## Acceptance Criteria

- [x] The fence scan is callable from `apps/ui` and `apps/server` **as one
      implementation**, not two that agree today
- [x] Moving it changes no server behaviour — `doc check`'s `unterminated-fence`
      code, its severity, and its non-blocking posture are all unchanged
- [x] It keeps returning the line the fence opened on; that is what both the
      refusal (SERVER-075) and the pre-check need to name
- [x] The container-awareness the scanner already has survives the move —
      block-quote and list markers, and tab expansion. That logic was got wrong
      once and fixed; a move is a good way to lose it
- [x] Whether `parseTurns` should move too is answered explicitly. It is the
      other half the UI cannot pre-check, and it is a bigger piece — a decision,
      not an omission
- [x] `openapi.json` and the typed client regenerated if the public surface moves
      (regenerated; byte-identical — the HTTP API is untouched)

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/code.ts` → `packages/contract/src/`, with the server
  importing it back.

### Notes

- The contract is where the format's rules already live (the form grammar and
  the answer format both moved there in PR #28 for this same reason). A fence
  rule is a format rule.

## Testing Strategy

The existing scanner tests move with it and must pass unchanged — that is the
evidence the move is behaviour-preserving. Plus an import from `apps/ui` proving
it is reachable.

## What was done

`apps/server/src/core/code.ts` and `code.test.ts` are now
`packages/contract/src/code.ts` and `code.test.ts`. The test file moved
**byte-for-byte** (md5 `a97c089d…` both sides of the move, and it only ever
imported `./code.js`, which is still its neighbour). `code.ts` differs from the
committed original in its module docblock and one comment paragraph and in
**nothing else** — `diff` from the first declaration to EOF reports one comment
hunk, so every line of the scanner, its container walk and its tab expansion are
the same bytes they were.

The server imports it back. `core/index.ts` re-exports the nine names explicitly,
so `core` still is the server's document-model surface and `core/index.test.ts`
passes with its list untouched; the five modules that imported `./code.js`
directly now import `@corpus/contract`.

### The `parseTurns` decision: **no, and here is what moved instead**

`parseTurns` stays in `apps/server`, and `turns.ts`'s grammar — which lines are
delimiters — is now `packages/contract/src/turns.ts` (`turnHeadings`,
`TURN_SEPARATOR`, `CANONICAL_INSTANT`). Three reasons, in the order they decided
it:

1. **Moving `parseTurns` means moving the writer.** `core/turns.ts` is one
   module and most of it writes: `appendTurn`, `nextTurnTs`, `deleteTurn`, and
   the timestamp-is-identity invariant §6 puts on them. Splitting the reader out
   still drags `time.ts` behind it, and taking the module whole would put turn
   *serialization* in the package that describes the HTTP API — against
   Architecture Decision 2, where the server is the sole writer.
2. **`Turn[]` is not what the second caller wants.** A composer pre-check is not
   asking for the turns of the text somebody typed; it is asking whether that
   text contains a line that would *become* a delimiter, and where. That is one
   rule of the grammar, not the parser built on it.
3. **The grammar had already been copied twice**, which is the failure this issue
   exists to stop: `core/turns.ts` built the heading regex, and
   `apps/ui/e2e/serverParity.ts` hand-rolls it again (with a fence scanner beside
   it) because there was no package both sides could import. There is one now.

So the answer to "can SERVER-076 also serve the UI" is yes: `assertNoTurnHeadings`
(which landed in this tree while this issue was in flight) reaches the same
`turnHeadings` through `parseThreadBody`, and `apps/ui` can call it directly.
UI-091's second acceptance criterion does **not** need to be dropped.

`CANONICAL_INSTANT` moved with it, and `core/time.ts` re-exports it: a heading
stamped any other way is not a heading, so the instant form and the heading
grammar must not be able to disagree.

Deliberately **not** touched: `apps/ui/src/thread/formPreflight.ts`'s docblock,
which still says these scanners are unreachable. It is UI-091's file and UI-091
owns the correction; two other agents were working this tree.

## E2E Verification Log

**Model: Opus 5 (1M context).** Verified 2026-08-07 against a real workspace
(`corpus init` in a scratch dir, real server on port 8791, real CLI — never 8765
or 5173), with the tool built from this working tree.

**Generation.** `npm run generate -w packages/contract` after the move rewrote
`openapi.json` and `src/client/schema.generated.ts` **identically** —
`git status --porcelain packages/contract` lists neither as modified. The HTTP
API is untouched, which is the expected result: what moved is a format rule, not
a route or a schema.

**`doc check` is unchanged, code, severity and posture.** Four documents created
through `POST /api/docs`, one per fence shape:

| document                 | body                                        | created | reported |
| ------------------------ | ------------------------------------------- | ------- | -------- |
| `open-fence.md`          | ` ```js ` never closed                      | exit 0  | **yes**  |
| `bulleted-fence.md`      | ` - ```js ` … closed under the bullet       | exit 0  | no       |
| `quoted-fence.md`        | ` > ``` ` … closed inside the block quote   | exit 0  | no       |
| `tab-closer.md`          | bulleted fence closed by a **tab**-indented run | exit 0 | no    |

Every create returned exit 0 — the fence finding is still **non-blocking** on the
save path (SERVER-066), and the three container cases are still not reported,
which is the container-awareness and tab-expansion criterion verified through the
real validator rather than by reading the code:

```
$ corpus doc check doc_2xove7ph doc_lp6senjx doc_vm6hlrss doc_4bu7vhx3 ; echo $?
error unterminated-fence data/docs/inbox/open-fence.md: unterminated fenced code
  block opened at line 16 with a run of 3 backticks: …
corpus: 1 error in 4 documents.
6
$ corpus doc check doc_2xove7ph --json
{"ok":false,"errors":[{"code":"unterminated-fence","severity":"error", …}],"warnings":[]}
```

`unterminated-fence`, severity `error`, exit 6, one finding of four documents.

**The write refusal still names the opening line** (`POST /api/threads/{id}/turns`
against a real thread):

```
$ corpus thread reply th_u7igut5f --file reply-open.md          # ```js, never closed
corpus: 400 bad_request: this turn leaves a code fence open: the ``` on line 3 is
never closed, …            [{"path":"body","message":"unterminated ``` code fence
                             opened on line 3"}]                        exit 5
$ corpus thread reply th_u7igut5f --file reply-ok.md            # ````md quoting ```js
replied to th_u7igut5f — turn 2026-08-08T04:18:57Z                      exit 0
$ corpus thread reply th_u7igut5f --file bullet.md              # bulleted fence, closed
replied to th_u7igut5f — turn 2026-08-08T04:18:58Z                      exit 0
```

**The moved heading grammar, through the guard that landed beside it:**

```
$ corpus thread reply th_u7igut5f --file reply-head.md          # bare ## user · <ts>
corpus: 400 bad_request: this turn contains a line that reads as a turn heading:
line 3 is `## user · 2026-01-01T00:00:00Z`, … signed by user.            exit 5
$ corpus thread reply th_u7igut5f --file reply-headfence.md     # the same, inside ```md
replied to th_u7igut5f — turn 2026-08-08T04:18:59Z                       exit 0
```

And the masking agrees end to end: the thread file holds **5** lines starting
`## `, `GET /api/threads/{id}` reports **4** turns, and the fifth is the one at
line 38 inside the fence — content, not a delimiter.

**Checks.**

- `npm run build` (all workspaces, dependency order) — exit 0.
- `npm run typecheck -w packages/contract -w apps/server` — exit 0. (A repo-wide
  `npm run typecheck` also reports `apps/ui/src/testing/readerFixture.ts:201
  Cannot find name 'refusal'` — a concurrent agent's in-flight edit, in a file
  this issue does not touch.)
- `npx vitest run packages/contract apps/server` — **225 files, 5565 tests, all
  passing**, exit 0. The moved `code.test.ts` is in that run, unchanged.
- Scoped run over the moved module and every consumer of it
  (`packages/contract/src/{code,turns,index}.test.ts`, `apps/server/src/core`,
  `threads/fences.test.ts`, `semantic`) — 46 files, 963 tests, exit 0.
- `eslint` and `prettier --check` over all 15 changed files — clean, no
  suppressions added.
- Scratch server stopped (`stopped (pid 42084)`), port 8791 confirmed free, the
  scratch workspace removed.

## Follow-ups surfaced (not done here)

- `apps/ui/e2e/serverParity.ts` still hand-rolls a fence scanner and the turn
  heading regex, with a docblock saying a shared package "is worth filing".
  There is one now. Retiring that port belongs to UI-091, which already owns the
  e2e-stub parity criterion — but it needs a check that importing
  `@corpus/contract` is acceptable in a module the parity test compiles into the
  repo tooling's type program.
- `apps/ui/src/thread/formPreflight.ts`'s docblock is now stale in the good
  direction. UI-091 owns it.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier over the changed files; the repo-wide
      gate is the orchestrator's)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
