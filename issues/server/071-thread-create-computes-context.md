# [SERVER-071] `thread create` stores the context it was sent, so agent anchors are born context-free

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-059 (the prevention half; the repair half is UI-086)
- Sibling of: UI-068 (the other way an anchor is born orphaned)

## Spec References

- SPEC.md §6 Anchoring — the selector is a text-quote selector over the file's
  own bytes; "a visible orphan beats a silent misattachment"

## Summary

Phase A of the route chosen for SERVER-059 (user decision, 2026-08-07):
**stop creating orphans before building anything to repair them.**

`corpus thread create` stores `prefix` and `suffix` **verbatim as sent**. The
agent has no reliable way to produce them — it is quoting from what it read, not
from a byte range it holds — so in practice agent-created anchors arrive either
wrong or empty.

SERVER-055's post-mortem measured the consequence and it is sharper than "some
anchors are weak": because the stored context is empty, `contextCorroborates`
hits its `return true` on the first line, so **every anchor the agent opens
bypassed the safety check entirely**. The one gate meant to stop a fuzzy match
misattaching was inert for exactly the population it most needed to guard.

This is one of the two ways an anchor is **born** orphaned. UI-068 is the other
(the selector quotes the serializer's re-print rather than the file's bytes).
Together they are why SERVER-059's population exists at all, and why it grows.

## Acceptance Criteria

- [x] The server computes `prefix`/`suffix` from the document's own bytes around
      the resolved `exact`, rather than trusting what the caller sent
      (`threads/anchor-context.ts` → `contextualizeSelector`, reusing
      `anchors/context.ts`'s `computeContext` — the one spelling of the context
      window the server has, the same one reconciliation rewrites with)
- [x] An anchor created through `corpus thread create` is byte-faithful to the
      file, and resolves on the next read without any fuzzy rung. Verified E2E:
      three agent-created anchors on a padded table and a hard-wrapped list all
      answer `orphaned: false` from `GET /api/docs/{id}`, whose resolver is
      `resolveAnchorExact` (rungs 1–2 only), and each stored
      `prefix + exact + suffix` occurs **exactly once** in the file's bytes —
      i.e. rung 1 carries them
- [x] A caller that sends context anyway is not silently half-trusted — the
      server's computation wins (`create.test.ts` → "overrules the context a
      caller sent, taking the padded bytes instead"), and the behaviour is
      stated in the route's description
      (`packages/contract/src/routes/thread-create.ts`) and on the request-side
      selector's `prefix`/`suffix` fields (`schemas/anchor.ts`)
- [x] Empty context is no longer manufactured by this path. (Note: the named
      `contextCorroborates` does not exist in the tree — SERVER-055's gate was
      reverted by PR #22. The same defect is live in the code that *is* there:
      rung 1 is skipped outright for a context-free selector and
      `findFuzzyRange`'s `contextAgreement` tie-break scores zero for every
      candidate. Both stop being inert for this population.) Genuinely
      context-free anchors are still possible and still stored that way — a
      quote spanning the whole body, and a quote the parent does not contain
- [x] Existing threads are **not** rewritten by this issue. The change is
      confined to the create path inside the parent's lane; no boot, read,
      projection or watcher path was touched. Verified E2E: server stopped,
      restarted and the document re-read — all four workspace files
      byte-identical (md5), `git status` clean
- [x] A test asserts the created anchor against the file's bytes, not against
      what the request contained (`create.test.ts` → "the stored context comes
      from the file (SERVER-071)": every case re-reads the parent off disk and
      checks that `prefix + exact + suffix` occurs once, there, at the quote)

## Technical Design

### Files to Create/Modify

- The `thread create` write path in `apps/server/src/threads/`, and whichever
  module already computes context for the UI's capture path — reuse it rather
  than writing a second one, or the two spellings will drift and this issue
  will need doing again.

### Notes

- **Do not widen this into resolution.** The temptation is to also "fix up"
  anchors that fail to resolve on read. That is precisely the move SERVER-055
  made and PR #22 reverted; the read path has no evidence and cannot decide.
  This issue only concerns the moment of creation, where the document is in
  hand and the bytes are knowable.
- Check what happens when the `exact` the caller sent matches the file more than
  once. Computing context from the *first* match would attach the thread to a
  place the caller may not have meant. Ambiguity here should refuse, not guess —
  an error at creation is cheap and visible, unlike an orphan discovered months
  later.

## Testing Strategy

Create threads through the real route against files whose canonical spelling
differs from their bytes (a padded table, a list with hard-wrapped items), and
assert the stored selector byte-for-byte against the file. Plus the ambiguous
`exact` case, asserted as refused rather than resolved.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real `corpus` CLI + real server (`corpus server
start`) on **port 8801** (8765 and 5173 deliberately avoided), workspace
`/tmp/s071-ws` created by `corpus init`.

### The population this exists for

Seeded one document whose canonical spelling differs from its bytes — a padded
table and a hard-wrapped list item:

```
| Q1      | 12,400 | ops   |
| Q2      | 18,900 | ops   |
...
- Review the Q2 report by Friday and circulate the
  summary to the steering group before the offsite.
```

### An agent-created anchor, no context sent

`corpus thread create --from agent --parent doc_7bm7dfys --quote "18,900" -m …`
→ `201`, and the parent's frontmatter (`cat -et`) now holds YAML block scalars
carrying the file's own bytes, padding and newlines included:

```
  anc_39906cdf:
    exact: 18,900
    prefix: |2-
       | 12,400 | ops   |$
      | Q2      | $
    suffix: |2-
       | ops   |$
```

Pre-fix, that same request stored `prefix: "", suffix: ""` — the behaviour a
shipped test asserted by name ("stores absent context as the empty string the
contract documents", `create.test.ts`), which this issue replaces.

Two more, still with no usable context from the caller: the wrapped list item
(`--quote "circulate the\n  summary"`) and a deliberately repeated cell
(`--quote "| ops   |" --prefix "| 18,900 "`).

`GET /api/docs/doc_7bm7dfys`, checked against the file's own bytes:

```
anc_263a057d orphaned=False rung1-unique=True byte-faithful=True
   prefix 'iew the Q2 report by Friday and '
   suffix ' to the steering group before th'
anc_39906cdf orphaned=False rung1-unique=True byte-faithful=True
   prefix ' | 12,400 | ops   |\n| Q2      | '
   suffix ' | ops   |\n\n## Actions\n\n- Review'
anc_d2fcd50b orphaned=False rung1-unique=True byte-faithful=True
   prefix '00 | ops   |\n| Q2      | 18,900 '
   suffix '\n\n## Actions\n\n- Review the Q2 re'
```

`byte-faithful` = the API's `range` slices the file back to `exact`;
`rung1-unique` = `prefix + exact + suffix` occurs exactly once in the file, so
`GET /api/docs`'s rungs-1–2-only resolver carries all three.
`git log`: one commit per create, staging both files, authored `agent`.

### Ambiguity refuses, visibly, and writes nothing

`--quote "| ops   |"` with no context (two occurrences):

```
corpus: 400 bad_request: the quoted text occurs more than once in the parent
document; send `prefix`/`suffix` copied from the file around the occurrence you
mean
  [{ "path": "selector.exact", … }]
exit=5
```

`HEAD` unchanged, the parent still carrying its single earlier anchor. Adding
`--prefix "| 18,900 "` then succeeds and lands on the **second** row.

### Nothing existing is rewritten

`corpus server stop` → `start` → `GET /api/docs/{id}`: the four workspace files
are byte-identical by md5 across the restart and the read, and `git status` is
clean. `corpus db doctor`: `projection is clean — 13 documents from 13 files`.

### Checks

- `VITEST_MAX_THREADS=4 npx vitest run apps/server` — **806 files, 3513 passed,
  0 failed**
- `VITEST_MAX_THREADS=4 npx vitest run packages/contract` — **1994 passed, 0
  failed**
- `npm run build` clean; `npm run typecheck -w apps/server -w packages/contract`
  clean; eslint + prettier clean on every touched file
- `npm run generate -w packages/contract` re-run, so `openapi.json` and the
  generated client are in sync with the new description

### Design note — the ambiguity decision

A repeated quote **refuses (400)** rather than taking the first occurrence, and
an **absent** quote still creates the thread. The two look similar and are not:
an absent quote is a fully specified request about text that moved, which §6
answers with *orphaned* — a normal state of a living corpus, and the standing
decision in `create.ts`'s header ("resolution is not a write-time gate"). A
repeated quote is an **underspecified** request: the caller named a passage the
document has more than one of, and the server has no evidence for either. §6's
ordering ("a visible orphan beats a silent misattachment") puts a cheap, visible
error at creation above a conversation silently attached to a passage nobody
chose. The caller's `prefix`/`suffix` are consulted first precisely so this
refusal is escapable: framing that occurs once picks the occurrence, which is
what the UI's capture path and `--prefix`/`--suffix` already produce. Framing
that does not appear in the file is discarded rather than held against the
request — the agent's usual case — and a quote that is unique resolves anyway.

## Completion Checklist (domain agent)

- [x] Tests written and passing (15 new unit tests in
      `threads/anchor-context.test.ts`, 7 new route tests in
      `threads/create.test.ts`; 3 existing assertions updated because they
      asserted the request's context rather than the file's)
- [x] `/lint` passes (eslint + prettier + tsc on the touched workspaces)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
