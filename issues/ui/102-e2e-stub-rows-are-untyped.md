# [UI-102] The e2e stub's row builder returns `unknown`, so field drift is silent

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-085 (the same stub answering unhandled routes with `{}`), UI-084
  (found it), SERVER-084

## Spec References

- Not a spec behaviour. This is about whether the e2e suite can be believed.

## Summary

Found while closing UI-084's last criterion. `apps/ui/e2e/stubCorpus.ts`'s row
builder returns `unknown`, and the generated typed client validates nothing at
runtime — so a `DocRow` field the stub **omits entirely** reaches the board as
`undefined` and nothing anywhere complains.

It had already happened. `unansweredForms` was added to `DocRow` by CONTRACT-040
and populated by SERVER-084, and the stub did not carry it, so every stubbed row
would have arrived with `unansweredForms: undefined`. The threshold under test
(`> 1`) is merely *false* against `undefined`, so the spec would have passed
while asserting a row shape the server never sends. It was caught only because
UI-084's author ran a negative control.

This is the same defect class as UI-085 — a stub whose infidelity is invisible —
and it is worth more than UI-085, because UI-085 makes a spec fail confusingly
while this one makes a spec **pass**.

## Acceptance Criteria

- [x] The stub's row builder is typed as the contract's `DocRow`, so omitting a
      field is a **typecheck error** rather than a runtime `undefined`
- [x] Adding a required field to `DocRow` breaks the stub at compile time. Prove
      it by adding one temporarily, not by reasoning about it
- [x] Every other builder in the stub gets the same treatment, or the ones that
      cannot are named with the reason. A partial fix here restores the same
      false confidence for whatever was left out
- [x] No spec is weakened to accommodate the typing — if a spec was relying on a
      partial row, it was relying on a shape the server never sends, and the spec
      is what is wrong
- [x] Check whether any **currently passing** spec is asserting against a row the
      server would not produce. That is the sweep this issue is for; the typing
      is only what stops it recurring

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/stubCorpus.ts`, and whatever specs the sweep turns up.

### Notes

- The stub deliberately answers at the transport boundary, so it will always be
  possible to send bytes the contract forbids. The goal is not to make that
  impossible — it is to make it **deliberate**: a cast with a reason at the one
  place a spec wants a malformed payload, instead of silence everywhere.
- `packages/kit/src/testing/docRow.ts` is the fixture that already models a
  complete row. Check whether the stub should build on it rather than keeping a
  second, weaker idea of what a row is.

## Testing Strategy

The proof is the compile error: add a required field to `DocRow`, confirm the
stub fails to typecheck, remove it. Plus whatever the sweep of existing specs
turns up — each of those is its own assertion to fix.

## E2E Verification Log

**Model: Opus 5 (1M context)** — `claude-opus-5[1m]`. Matches the issue's
recommendation.

### 1. The compile error, demonstrated rather than reasoned about

Added a required field to the contract's `DocRowSchema`
(`packages/contract/src/schemas/query.ts`), rebuilt `@corpus/contract`
(`npm run build -w packages/contract` — the UI resolves `@corpus/contract`
through the package's `exports` map into `dist/`), then
`tsc --noEmit -p apps/ui/tsconfig.json`:

```
    provenanceProbe: z.string(),      // added beside `snippets`
```

```
e2e/stubCorpus.ts(575,5): error TS2741: Property 'provenanceProbe' is missing in
type '{ id: string; type: string; title: string; path: string; status: "open" |
"resolved" | "archived"; tags: never[]; … 18 more …; extra: Record<…>; }' but
required in type '{ unreadThreads: number; unansweredForms: number; attention:
(…)[]; provenanceProbe: string; snippets: …[]; … 26 more …; excerpt: string; }'.
```

Line 575 is `asRow`. The field was then removed, the contract rebuilt, and the
typecheck is clean again. Before this change the same experiment produced **no
error at all** — that is the defect.

### 2. Every builder, and the ones that are deliberately not

`apps/ui/e2e/stubCorpus.ts` had four builders returning `unknown` and eighteen
inline payload literals typed by nothing. Now:

| builder / payload                       | type                                        |
| --------------------------------------- | ------------------------------------------- |
| `asRow`                                 | `DocRow`                                    |
| `asJob`                                 | `Job`                                       |
| `asDoc`                                 | `Doc`                                       |
| `resolveAnchor`                         | `ResolvedAnchor`                            |
| `attentionOf`                           | `NeedsReason[]` (was `readonly string[]`)   |
| `/api/locks`, `/api/jobs`, `/api/tree`  | `LockList`, `JobList`, `FolderTree`         |
| `/api/queue/status`                     | `QueueStatus`                               |
| `GET/POST /api/docs`, PUT, DELETE, arch | `DocList`, `DocMutationResponse`, `UpdateDocResponse`, `DeleteDocResult` |
| `POST /api/threads` + the thread verbs  | `CreateThreadResponse`, `ThreadMutationResponse`, `MarkSeenResult`, `Thread` |
| form answer, reattach                   | `FormAnswerResponse`, `ReattachThreadResponse` |
| search, related                         | `SearchResults`, `RelatedDocs`              |
| every refusal                           | `NotFoundError`, `ConflictError`, `ValidationError`, `ReattachConflictError` |

The seed types were tightened with them, because a seed is where a bad value
enters: `StubRow.status` → `DocStatus` (was `string`), `.query` → `ViewQuery`,
`.stale` → `StaleTier | null` (was `unknown`), `StubJob.status` →
`QueueEventStatus`, `SeedRelated.relation` → `Relation`,
`SeedAnchor.threadStatus` → `ThreadStatus`, `StoredAnchor.selector` →
`TextQuoteSelector`.

`json()` now takes a `StubPayload` union so a route added later without a
`satisfies` still cannot send an arbitrary object. **One cast survives, with its
reason written next to it**: the unhandled-route fallback `{} as StubPayload`,
which is UI-085's `200 {}` — now the whole of the stub's dishonesty rather than
one silence among twenty.

**`packages/kit/src/testing/docRow.ts` was considered and deliberately not
adopted for `asRow`** (the issue asks). Spreading over `docRowFixture` would fill
any field `asRow` forgets with the fixture's "nothing to report" default — so the
next `DocRow` field would compile clean and answer a plausible value on every
stubbed row. That is the same silence in a new costume. A test that does not care
what a field says wants that default; a stand-in for the server has to be made to
decide. The fixture stays right for unit tests, which is what it is for.

### 3. What the sweep found

The sweep ran in two passes: the compiler over every payload the suite puts on
the wire, and a hand comparison of the stub's derived columns against
`apps/server/src/docs/needs.ts` and `query.ts`.

**It found things.** Nine defects, all live before this issue:

1. **`query-editor.spec.ts` was serving rows with no `unansweredForms` at all** —
   a hand-built `DocRow` literal predating CONTRACT-040. The exact defect this
   issue was filed about, still in the tree, in a second place.
2. **`console.spec.ts` refused a retry with `{error: "queue is halted"}`**, which
   is not an `ApiError`. `isApiError` rejects it, so `CorpusRequestError` fell
   back to `POST /api/jobs/{id}/retry failed (HTTP 409): {"error":…}` — the
   un-substituted route template that PR #28's re-review exists to keep out of a
   360px toast. The spec asserted only the `Could not retry evt_e2e` prefix, so it
   **passed while covering the wrong branch**. Body fixed to `ConflictError`; the
   assertion **strengthened** to `Could not retry evt_e2e: queue is halted` — the
   server's own sentence.
3. **`POST /api/threads` reported `anchorId: "anc_newN"` for an unanchored
   thread.** The composer's *Ask* sends `selector: null`, and the guard tested
   `=== undefined`, so a thread anchored to nothing claimed an anchor id.
   (Surfaced as a real failure in `weight.spec.ts:265` the moment the selector
   was typed — the typing found it.)
4. **`/api/queue/status` was wrong in both directions**: it omitted `abandoned`
   (required) and carried an `agent: "idle"` key the contract has never had.
5. **`Thread.agent: null` in `clipboard.spec.ts`** — a value the three-state §8
   vocabulary has no room for.
6. **Every hand-built `Turn` in `clipboard`, `fences`, `images`, `render-fixes`
   and `turn-breaks` omitted `model`** (required since CONTRACT-043).
7. **`POST …/turns` answered two of `AppendTurnResponse`'s four fields**
   (`turn-breaks.spec.ts`): no `thread`, no `eventId`.
8. **`POST …/seen` answered `"{}"`** in five specs instead of `MarkSeenResult`.
9. **`edit-session-close.spec.ts` refused a save with `code: "internal"`** —
   not a member of `ERROR_CODES` (`internal_error` is), so that body also failed
   `isApiError`.

Also corrected in passing, each type-legal and therefore invisible to the
compiler: `Doc.frontmatter.anchors` was flatly `{}` on a document carrying
highlights; three thread responses passed a document's `status` straight through,
so an archived thread would have reported `status: "archived"` on routes whose
contract has two statuses; `console-index.spec.ts` kept a local `interface Status`
with `state: string` instead of `IndexStatus`; the SSE frames in `eventStream.ts`
and `console-index.spec.ts` are now `InvalidatePayload`.

**No spec was weakened.** One was strengthened (finding 2). `query-editor.spec.ts`
stopped spreading a `body` key into a row shape that has none.

**What the sweep did _not_ find**: no currently-passing spec asserts the *absence*
of something the server would show. The stub hardcodes `unreadThreads: 0`,
`awaitingAgent: false`, empty `snippets`, and an `attention` array carrying only
two of the five reasons — all type-legal, all places a spec could assert less than
the truth — but nothing shipped does. Those four gaps are now named in `asRow`'s
doc comment with what the server would say instead, so the next author meets them
as documentation rather than as a surprise. Deriving them is behaviour, not
typing, and belongs with UI-085.

Routes that keep no contract type, named with the reason: `/api/x/todos/**` in
five specs is the **plugin's** own vocabulary (SPEC.md §10), outside
`@corpus/contract` — and it is the one payload in the suite that is already
validated at runtime, by the plugin's own `ListsSchema` in
`plugins/todos/ui/queries.ts`, so an omission there fails loudly without help.
The one request body built inside `page.evaluate` (`forms.spec.ts`) runs in the
browser realm where a type import cannot reach, and the server validates it
strictly on arrival.

### 4. Checks

- `tsc --noEmit -p apps/ui/tsconfig.json` — clean.
- `eslint apps/ui/e2e --max-warnings=0` — clean; no rule disabled anywhere.
- `prettier --check "apps/ui/e2e/**/*.ts"` — clean.
- `npm run build` — clean (run first; `@corpus/*` resolves through `dist/`).
- **Full Playwright suite, three times**, `CORPUS_UI_PORT=5373` (8765 and 5173
  never bound): **357 passed** on the last two runs. Failures, all diagnosed and
  none owned by this issue:
  - `smoke.spec.ts:241` and `console.spec.ts:63` — every run. Both need 8765
    unbound; the user's live `corpus` server holds it. Known, expected.
  - `list-blocks.spec.ts:219` — runs 1 and 3, not run 2. It asserts markdown out
    of `apps/ui/src/editor/markdown/serialize.ts`, which UI-104 is editing in this
    same working tree (mtime 19:03, mid-run). Passes on its own: 3/3.
  - `todos.spec.ts:594` — run 2 only, `.anchor-hl` read `"Call the "` instead of
    `"Call the plumber"`. A truncated **browser selection** under load, so the
    stub stored and the layer highlighted exactly what was selected — the same
    load-sensitive family as the known `todos.spec.ts:555`. Passes on its own:
    3/3 targeted plus 11/11 file runs.
  - `weight.spec.ts:265` — run 1 only, and it was **mine**: the real defect in
    finding 3, surfaced by the new typing. Fixed; green in runs 2 and 3.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
