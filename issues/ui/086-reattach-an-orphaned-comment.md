# [UI-086] An orphaned comment offers candidate sites, and the person picks

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-041 (the re-attach route), SERVER-072 (the write)
- Blocks: SERVER-059
- Related: SERVER-071, UI-068 (the prevention half — this repairs what those stop creating)

## Spec References

- SPEC.md §6 Anchoring — "a visible orphan beats a silent misattachment"

## Summary

Phase B of the route chosen for SERVER-059 (user decision, 2026-08-07).

SERVER-059 proves, as a construction, that **no reader-side similarity measure
can decide where an orphaned comment belongs**: deleting a line from a parallel
list, and renaming that line while deleting its sibling, produce the same
after-state from the same before-state and demand opposite correct answers. A
reader sees only the after-state.

The evidence problem is unsolvable for a machine and **trivial for the person
who wrote the comment**. So the machine stops guessing and asks.

This is the half that closes the existing backlog. SERVER-071 and UI-068 stop
the population growing; nothing but this drains it.

## Acceptance Criteria

- [x] An orphaned comment is visibly orphaned, and offers a way to re-attach
- [x] Candidate sites are **offered, never pre-selected**. A default selection is
      a guess wearing a person's authority, which is the exact failure SPEC §6
      forbids and SERVER-055 shipped
- [x] "Leave it detached" is always available and always costless
- [x] The person can tell what they are agreeing to: each candidate shows enough
      surrounding text to be judged, not a similarity score
- [x] Choosing a site writes the corrected selector, and the comment resolves
      normally from then on — the repair is durable, not a per-session overlay
- [x] Two threads on disjoint text never end up claiming overlapping text
- [x] Candidate generation is **complete or honest**: if the list is truncated,
      it says so. A silently-capped list looks like "these are the only places"
- [x] Tested adversarially at **three or more parallel items** in every shape —
      list, table, task list, prose, numbered. SERVER-055's safety tests passed
      only because they used two items, which was shape-luck, not safety

## Technical Design

### Files to Create/Modify

*As built* — colocated as one feature rather than spread through `thread/`:

- `apps/ui/src/reattach/` — `candidates.ts` (generation), `ReattachOffer.tsx`
  (the affordance), `reattach.css`, and their tests.
- `apps/ui/src/anchors/AnchoredThreads.tsx` — `DetachedThreads` gains an optional
  `ReattachContext` and renders the offer under an orphan (and only under an
  orphan: a whole-document thread has no passage to search for, and a thread this
  *view* cannot place is not detached at all).
- `apps/ui/src/anchors/useAnchorLayer.ts` — publishes `effectiveAnchors`, so a
  detached row's *anchor* (its preserved selector, and its neighbours' live
  ranges) is reachable beside its row.
- `apps/ui/src/reader/DocView.tsx` — passes the parent's id, body and anchors.
- `packages/kit` — `client.reattachThread`, `useReattachThread`,
  `reattachRefusalReason`, and `CorpusRequestError.payload` (the narrowed `409`
  bodies — `LockConflictError`'s `lock`, this route's `reason` — have no `code`
  to switch on, so the payload is kept for the one caller that understands one).
- `apps/ui/e2e/reattach.spec.ts` and the stub's `reattach` route.

### Notes

- **`findFuzzyRange` is admissible here and inadmissible on a read path.** The
  difference is that its output becomes a *suggestion a person confirms* rather
  than an attachment nobody sees happen. Reuse it to generate candidates; do not
  reuse it to pick one.
- Generate candidates by the pigeonhole-complete route SERVER-059 names, not by
  ranking-and-truncating. The person can dismiss a bad candidate; they cannot
  summon a missing one.
- The empty case matters: when nothing plausible exists, say so plainly rather
  than showing a weak candidate to avoid an empty list. A bad suggestion is
  worse than none, because it invites a click.

## Testing Strategy

Adversarial fixtures first, at three or more parallel items, in every shape
above. Then the flow: orphan → candidates → choose → the selector on disk is
corrected → the comment resolves on a fresh read. Plus the decline path leaving
everything untouched.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real workspace (`corpus init`) at
`/tmp/ui086-e2e/ws`, real server on **127.0.0.1:8767**, real Vite dev server on
**5399** proxying to it (`CORPUS_SERVER_ORIGIN`), driven by a real headless
Chromium. **Never 8765** (the user's live corpus server) and **never 5173** (an
ssh tunnel). Server stopped and both ports confirmed free afterwards.

### The starting state, reproduced

Parent `doc_y7cexmia` (`data/docs/inbox/weekly-actions-2.md`) holding the Q1–Q4
sibling list. Threads created with quotes no version of the document has ever
held — `Review the Q7 report by Friday`, `…Q9…`, `…Q8…` — plus one healthy
thread anchored to Q4. `GET /api/docs/{id}` reported the orphans honestly
(`range: null`, `orphaned: true`), and the reader listed them under **DETACHED
THREADS** with the offer beneath each:

```
DETACHED THREADS
“Review the Q7 report by Friday”  … Who owns this one?
Its quoted text is not in this document, so it has no place to sit. It is fully
repliable where it is.
[ Find where it belongs… ]
```

### Candidates: offered, four of them, none chosen

Clicking **Find where it belongs…** on `th_tuuz5edl` produced **four**
candidates — one per parallel sibling — in document order, each showing two
whole lines either side with the passage marked and `…` where the document
continues:

```
candidate 0 (start=20)  "# Weekly actions\n\n- Review the Q1 …\n- Review the Q2 …\n- Review the Q3 ……"   [Attach here]
candidate 1 (start=53)  "…\n- Q1 …\n- Q2 …\n- Q3 …\n- Q4 …"                                             [Attach here]
candidate 2 (start=86)  "…- Q1 …\n- Q2 …\n- Q3 …\n- Q4 …"    Another conversation is already anchored to this text.
candidate 3 (start=119) "…- Q2 …\n- Q3 …\n- Q4 …"            Another conversation is already anchored to this text.
```

Measured on the live page: **0 checked controls**, `document.activeElement`
**not inside the picker** (so `↵` cannot commit a repair nobody chose), **no
`%`, "score", "similar" or "match"** anywhere in a candidate's text, and **no
truncation banner** — because the list was everything. Candidates 2 and 3 are
the two ranges other threads already hold: **listed and refused, never hidden**.

**A finding this drill produced, and the fix.** The first run showed every
candidate's context as the *entire* document (the character budget alone exceeds
a short note), so four siblings rendered as the same block four times with a
different word marked — complete, and useless for telling them apart.
`CONTEXT_LINES = 2` now bounds the context in lines as well as characters; the
transcript above is the second run.

### The repair

**Leave it detached** first: the picker closed, the offer returned, and
`POST …/reattach` count was **0** — declining writes nothing and is not a
one-way door.

Then **Attach here** on candidate 0. The request carried the range and the
guard, and nothing else:

```
POST http://localhost:5399/api/threads/th_tuuz5edl/reattach
{"range":{"start":20,"end":50},"expectedText":"Review the Q1 report by Friday"}
```

No candidate index, no score. Immediately after: the offer and the whole
**DETACHED THREADS** section were gone, and `.anchor-hl[data-thread=th_tuuz5edl]`
was painted over `Review the Q1 report by Friday` in the body.

**Durable, not an overlay.** After `page.reload()` the highlight was still on
that line and there was still no detached section. On disk, the parent's
frontmatter holds a selector the request never carried — the document's own
bytes, with its own siblings as context:

```yaml
anc_fbd7e5f2:
  exact: Review the Q1 report by Friday
  prefix: |-
    # Weekly actions

    -
  suffix: |-

    - Review the Q2 report by Frida
```

**One commit per repair, authored as the person, one file:**

```
3d9d385 user <user@corpus.local> comment: re-attach th_tuuz5edl on doc_y7cexmia by user
122962e user <user@corpus.local> comment: re-attach th_g4u7onum on doc_y7cexmia by user
  data/docs/inbox/weekly-actions-2.md | 1 file changed
```

Two repairs of the same document produced **two** commits, so neither decision
is erased. `corpus doc check doc_y7cexmia` → `no findings`; `corpus db doctor` →
`projection is clean — 14 documents from 14 files`.

### Both refusals, live

Driven by freezing the page's view of the document (so the picker keeps the
offsets the person was shown) and then moving the document out from under it:

| what happened while the picker was open | server | what the person is told |
| --- | --- | --- |
| the parent was rewritten (`PUT /api/docs/{id}`) | `409 range-changed` | "The document changed while you were choosing. It has been re-read — pick again." |
| somebody else commented on the chosen line | `409 range-overlaps` | "Another conversation is already anchored to that text. Pick a different passage." |

In both cases the picker stayed open with its list, so the person chooses again
rather than starting over.

**Worth recording separately**: with the view *not* frozen, an out-of-band save
never reached the click at all — the SSE invalidation re-read the parent and the
picker re-derived its candidates from the new bytes. The server's guard is the
backstop for the race the client cannot close, not the ordinary path.

### The honest cap, live

A 30-sibling list (`doc_h2f4qllk`): **24 candidates shown**, banner reading
`30 passages resemble the quoted text; the first 24 are listed here in document
order. The rest are not shown.` Time from click to first candidate painted:
**60 ms**.

### Automated

- `npx vitest run apps/ui packages/kit` → **184 files, 3102 tests passed**.
  New: `apps/ui/src/reattach/candidates.test.ts` (32), `ReattachOffer.test.tsx`
  (17), `apps/ui/src/anchors/detachedReattach.test.tsx` (5),
  `packages/kit/src/query/useReattachThread.test.tsx` (8).
- `npx playwright test reattach.spec.ts` → **6 passed** (`CORPUS_UI_PORT=5399`).
- `npx vitest run scripts/stub-server-parity.test.ts` → **28 passed**.
- ESLint and Prettier clean on every changed file; `tsc --noEmit` clean in both
  `apps/ui` and `packages/kit`.

The completeness claim is pinned rather than asserted: `candidates.test.ts`
brute-forces **every** substring within `maxEdits` of the quote on five fixtures
and requires each one to be covered by a returned candidate.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
