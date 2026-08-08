# [SERVER-072] Write the corrected selector when a person re-attaches a thread

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-041, SERVER-071 (the selector computation this reuses)
- Blocks: UI-086

## Spec References

- SPEC.md §4 — one action, one commit
- SPEC.md §6 Anchoring

## Summary

The write behind CONTRACT-041. A person has chosen where an orphaned comment
belongs; this makes the choice durable.

## Acceptance Criteria

- [x] The thread's selector is recomputed from the document's bytes over the
      chosen range and persisted — the same computation SERVER-071 establishes
      for creation, called, not re-implemented
- [x] The change lands as **one commit** with an author that makes it auditable
      as a person's repair rather than a reconciliation
- [x] The comment resolves normally on the next read, with no fuzzy rung
- [x] A range that vanished between the person seeing it and choosing it is
      refused, not approximated. The document is live and the window is real
- [x] Overlap with another thread's text is refused (§6: two threads on disjoint
      text never claim overlapping text)
- [x] Nothing else about the thread changes — not its status, not its turns, not
      its timestamps beyond what the commit itself records

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/`, reusing SERVER-071's context computation.

### Notes

- **This is the one path where a selector is rewritten without a diff**, so it
  is worth being explicit in the code about why that is admissible here and
  nowhere else: the evidence is the person's choice, which reconciliation does
  not have and a reader cannot obtain. Say it in the docblock — SERVER-055 was
  reverted for making the opposite call and a future reader will meet this
  function before they meet that history.
- Check the projection: an orphan that becomes attached changes what the board
  shows, so the invalidation has to be right or the repair looks like it failed
  until a reload.

## Testing Strategy

Round-trip through the real route: orphan → re-attach → the file's stored
selector matches the chosen bytes → a fresh read resolves it. Plus the vanished
range, the overlapping range, and an assertion that the commit is one commit.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real server (`corpus init` + `corpus server
start`) on **127.0.0.1:8766** — never 8765 or 5173 — against a real workspace at
`/tmp/s072-e2e/ws`, driven with `curl`, with an SSE stream (`GET /events`) open
across the whole session. Server stopped and the port confirmed free afterwards.

### The starting state, reproduced

Parent `doc_czrhxl6j` (`data/docs/inbox/actions.md`) holding the Q1–Q4 sibling
list; thread `th_3tdcjmpj` created with `selector.exact` =
`Review the Q7 report by Friday`, a quote no version of the document has ever
held. `GET /api/docs/doc_czrhxl6j` reported it honestly:

```
{"anchorId":"anc_f4e43f57", "selector":{"exact":"Review the Q7 report by Friday","prefix":"","suffix":""},
 "threadId":"th_3tdcjmpj","range":null,"orphaned":true}
```

### The repair

`POST /api/threads/th_3tdcjmpj/reattach` with `{"range":{"start":47,"end":77},
"expectedText":"Review the Q2 report by Friday"}` → **200**, answering
`range {"start":47,"end":77}`, `orphaned:false`, and a selector the request never
carried:

```
"selector":{"exact":"Review the Q2 report by Friday",
            "prefix":"eview the Q1 report by Friday\n- ",
            "suffix":"\n- Review the Q3 report by Frida"}
```

Those are the parent's own bytes — the *siblings* — which is what no candidate
index or similarity score could have produced from this document.

**On disk** (`data/docs/inbox/actions.md`), the `anc_f4e43f57` entry now holds
that selector, and nothing else in the frontmatter moved (`updated` still
`2026-08-08T15:22:16Z`, the document create's stamp).

**A fresh `GET /api/docs/{id}` resolves it on rung 1**, not fuzzily:

```
orphaned: False | range: {'start': 47, 'end': 77}
rung-1 indexOf(prefix+exact+suffix) + len(prefix) = 47
occurrences of framed quote in body: 1
```

**One commit, authored as the person, staging only the parent:**

```
92b9705 user <user@corpus.local> comment: re-attach th_3tdcjmpj on doc_czrhxl6j by user
--- files in HEAD ---
data/docs/inbox/actions.md
```

**The SSE frame:** `{"keys":[["docs"],["docs","th_3tdcjmpj"],["docs","doc_czrhxl6j"]]}`
— both documents, and never `["tree"]` (an anchor entry cannot move a folder
badge). A second repair a moment later produced its **own** commit (`6 → 7`), so
§4 folding does not erase the first decision.

### Every refusal, live

| request                                        | answer                                              |
| ---------------------------------------------- | --------------------------------------------------- |
| `expectedText` the parent does not hold there  | `409` `reason:"range-changed"`                       |
| range past the end of the body                 | `409` `reason:"range-changed"`                       |
| Q4's range, occupied by `th_ub56aep7`'s anchor | `409` `reason:"range-overlaps"` (names the thread)   |
| whole-document thread                          | `409` `reason:"not-anchored"`                        |
| `x-corpus-author: agent`                       | `403` `forbidden`                                    |
| unknown thread id                              | `404`                                                |
| body carrying `candidate: 2`                   | `400`, `Unrecognized key: "candidate"`               |
| agent holding the parent's edit lock           | `423`, carrying the lock                             |

`HEAD` did not move for any of them, and no SSE frame was emitted.

### Consistency afterwards

`corpus db doctor` → `projection is clean — 13 documents from 13 files (4ms)`.
`corpus doc check doc_czrhxl6j` → `checked 1 document — no findings.`

### Automated

`VITEST_MAX_THREADS=4 npx vitest run apps/server` → **173 files, 3564 tests
passed**. That includes `json-body.test.ts` (7 tests), which was failing before
this handler existed because it derives its route list from the contract; the
sweep was not touched. New: `apps/server/src/threads/reattach.test.ts`, 28 tests.
ESLint and Prettier clean on every changed file; `tsc --noEmit` clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
