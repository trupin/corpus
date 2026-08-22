# [UI-116] No e2e spec has ever posted an attachment, on any surface

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
- Related: UI-070, UI-111, UI-112, PLUGINS-012 (the attachment work this release
  ships), INFRA-028 (the other way the e2e suite tests the wrong thing)

## Spec References

- SPEC.md **§10** — *"Every composer takes attachments"* (rider signed
  2026-08-05)
- SPEC.md **§6** — attachments, chips, and what a comment may carry

## Summary

`apps/ui/e2e/stubCorpus.ts:889` records every request with
`JSON.parse(request.postData())`. That throws on `multipart/form-data`.

The consequence, found by PLUGINS-012 and stated in its own words:

> **No spec in the suite has ever posted an attachment on any surface** — not
> the reply box, not the comment popover, not the global composer.

So this release ships §10's rider made true across five composers, and **CI
checks none of the send path**. Every proof that attachments actually reach the
server in this phase — UI-111's four drills, UI-112's, PLUGINS-012's md5-verified
bytes on disk — came from a human-driven browser drill that runs once, by hand,
and then never again. The specs stop at the chips.

That is a real asymmetry and worth being blunt about: the chips are the easy
half. A chip is a local object URL and a bit of DOM. The part that breaks is the
part after — the multipart body, the server's parse, the bytes on disk, the
markdown link, and the restore-on-failure path when the post is refused. None of
it has a regression test that runs on a push.

## Acceptance Criteria

- [x] `stubCorpus` records multipart requests without throwing, and exposes
      enough of the body that a spec can assert **which files** were sent and
      with what field names — not merely that the request was multipart
- [x] At least one spec posts a real attachment through a composer and asserts
      it arrived; it must fail if the files are dropped from the request
- [x] The **attachment-only** case (no text) is covered, since §6 allows it and
      it is the one most likely to be broken by a `canSend` regression
- [x] The **restore-on-failure** path is covered: a refused post returns the
      words *and* the chips. UI-111's issue says why this matters — "a comment
      that loses its screenshot because the post failed is worse than one that
      could never take it" — and it is currently proven only by hand
- [x] Whatever is added is checked red against the unfixed behaviour: a spec
      that passes against a composer sending no files proves nothing

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/stubCorpus.ts` — the request recorder
- `apps/ui/e2e/` — the spec(s)

### Notes

The stub is shared fixture code that every spec depends on, so a change to how
it records requests can break specs that have nothing to do with attachments.
Make the multipart path additive rather than replacing the JSON path.

Do not reach for a fully general multipart parser if a narrow one will do — what
the assertions need is the file parts' names and filenames, and possibly their
sizes. Parsing bodies the suite will never send is scope this issue does not
have.

## Testing Strategy

The specs are the deliverable. The check on the fixture itself is that the
existing suite still passes unchanged.

## E2E Verification Log

**Model: Opus 5 (1M context).** No workspace server ran (`playwright.config.ts`
starts none); `CORPUS_UI_PORT=5273` and `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766`
throughout, so nothing touched 5173 or the live 8765 (INFRA-028's hazard, worked
around, not fixed).

### What changed in the fixture

`apps/ui/e2e/stubCorpus.ts`:

- The recorder no longer calls `JSON.parse(request.postData())` unconditionally.
  When the request's `content-type` names a `multipart/form-data` boundary it
  parses the body byte-wise into `{text: [{field, value}], files: [{field,
  filename, type, size}]}` and records it on a **new** `StubRequest.multipart`
  field. `body` keeps its exact previous meaning — the JSON reading, `undefined`
  when there is none — so every existing spec reads what it always read. That is
  what makes the change additive: nothing that was recorded before is recorded
  differently now, and the parse is byte-wise so a PNG is neither corrupted nor
  counted in replacement characters.
- The parser is deliberately narrow (`name`, `filename`, part `Content-Type`).
  No nested multiparts, no `Content-Transfer-Encoding`, no RFC 2231. The only
  thing that builds these bodies is `packages/contract/src/client/upload.ts`, via
  `FormData`, so a part this cannot read is a part the app cannot send.
- `multipartBodyOf(request)` is exported, for specs that answer a route
  themselves (a refusal registered ahead of the stub never reaches the recorder,
  and a restore test that could not read what it refused would pass against a
  composer that attached nothing).
- Two routes gained handlers they never had: **`POST /api/threads/{id}/turns`**
  and **`POST /api/capture`**. Both fell through to the `{}` fallback before.
  That was survivable on the JSON branch, but `uploadTurn` **parses** its
  response with `AppendTurnResponseSchema`, so `{}` came back as a failed upload
  and an attachment send could not be observed to succeed at all. The turn
  handler writes the turn into the thread's body (as `commitAnswerTurn` does), so
  a spec can assert the reply landed rather than merely that it was posted. It
  counts its own events (`appended`), not `created` — several specs read
  `th_new1` / `anc_new1` off that counter and a reply creates no document.
- `POST /api/threads` now reads its fields through `inputOf()`, which folds a
  multipart body into a record with **verbatim field names** (only
  `requestsAgent`'s string and the JSON-encoded `selector` are decoded). The
  multipart spelling of a turn's prose is `text` and the JSON one is `body`;
  folding those two together would have let a composer send the wrong one and
  still be answered, so `prose()` reads both explicitly.

### Specs added

`apps/ui/e2e/attachments.spec.ts` (9 tests) and one test in
`apps/ui/e2e/todos-menu.spec.ts`. All five composers §10's rider binds:

| Surface | Route | Covered |
| --- | --- | --- |
| Reply box (`ThreadComposer`) | `POST /api/threads/{id}/turns` | text + 2 files; **attachment-only**; refusal restores words + chips (blob thumbnail still resolves) |
| Comment popover (`CommentPopover`) | `POST /api/threads` | file + quote on one request, selector still attached, highlight drawn; refusal re-opens holding words + chip |
| Composer under a turn (`NewChildThread`) | `POST /api/threads` | file + parent + `requestsAgent: false`; refusal keeps everything (this one holds rather than takes/restores); then accepts and empties |
| Global composer (`ComposeOverlay`) | `POST /api/threads`, `POST /api/capture` | Ask with 2 files (no `parent`, no `selector` parts); Capture with a file; refused Ask restores words + chips |
| Plugin composer (`TodoItemComposer`) | `POST /api/threads` | 2 files + prose + item selector on one request |

Assertions are on part **names, filenames and byte sizes** — never on
"content-type was multipart", which is satisfied by a composer that attached
nothing. `todos-menu.spec.ts`'s existing chips test had a docblock stating the
gap ("It stops before the send … a fixture limit"); that paragraph is now
corrected and points at the new test.

### Falsification — every added spec checked red

Three mutations, each reverted and rebuilt afterwards.

1. **"A composer that sends no files."** `packages/kit/src/query/useAppendTurn.ts`
   and `useCreateThread.ts` forced `files = []`, and
   `createCorpusClient.capture` forced `files: []`. **`packages/kit/dist` was
   rebuilt** — a source-only mutation there cannot falsify anything in
   `apps/ui`, which resolves `@corpus/kit` through the exports map into `dist/`.
   Result: **all 10 new tests red**, and the 9 pre-existing `todos-menu` tests
   still green, so the mutation is attachment-specific rather than a general
   break. Sample failure: `Expected [["files","shot.png",24]] / Received []`.
2. **"A composer that loses the chips on a refusal."** `intake.restore(...)`
   removed from `ThreadComposer` and `ComposeOverlay`, and `useAnchorLayer`'s
   re-open changed to `attachments: []`. Result: the three restore tests red on
   the chip count, with the text assertions still passing — so those tests are
   about the attachments and not about the words.
3. **"A `canSend` that requires text."** `ThreadComposer`'s `hasContent`
   narrowed to `trimmed !== ""`. Result: the attachment-only test red on
   `toBeEnabled` (`<button disabled class="send">`).

### The existing suite, unchanged

Full Playwright suite, four runs:

- baseline (this branch's `HEAD` fixture, no new specs): **382 passed, 0 failed**
- new fixture, new `todos-menu` test, **without** `attachments.spec.ts`: **383 passed, 0 failed** — the fixture change alone is inert
- full tree: **391 passed / 1 failed**, twice, then **392 passed / 0 failed**

The intermittent failure is `anchor-layer.spec.ts:475` — `allInnerTexts()` on
`.anchor-hl` returning `""` while `toHaveCount(2)` had already passed, i.e.
`innerText` read before layout was flushed. It is **not** caused by this change:
the run carrying the new fixture but not the new spec file was clean, and the
same two files run together with `--repeat-each=3` (63 tests) were clean. It is a
pre-existing load-sensitivity that nine extra tests on four workers tipped over,
and CI's `retries: 2` covers it. Worth a follow-up issue to use `textContent`
there; deliberately not touched here.

Unit suites (`vitest run apps/ui packages/kit`): **202 files, 3945 tests, all
passing.** `tsc --noEmit -p apps/ui`, `eslint apps/ui/e2e`, `prettier --write`:
clean.

### Nothing found broken in the send paths

The hand drills were right: every surface really does put its files on the wire
under `files`, with the prose under `text`, and every refusal really does give
back what was typed. Two honest asymmetries recorded rather than "fixed":
`TodoItemComposer` passes `files:` unconditionally and relies on
`useCreateThread` to choose JSON for an empty list; and Capture requires text
(`canCapture`), which is correct — `CaptureRequest.text` is required by the
contract, and §6's phrase is "screenshot + **one line**".

What *was* broken is the fixture, worse than the issue claimed: the suite had no
handler for `POST /api/threads/{id}/turns` at all, so every reply any spec has
ever sent was answered `200 {}` by the untyped fallback and no spec had ever seen
a reply land in a conversation. It does now (`.turn` count 2 after a send).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-116]` prefix
