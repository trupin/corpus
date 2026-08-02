# Evaluation: SERVER-045

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

This is the issue that has to prove the batch delivered a feature rather than a schema. It does.
**I did not reuse the implementers' paraphrase fixture** — I composed my own and verified its
keyword-disjointness programmatically before seeding it.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Includes the measured cosine table and the gate-tuning story |
| Commands are specific and concrete | PASS | Real doc ids, both query directions, pasted JSON |
| Real E2E (not mocked) | PASS | Real server, real embedded engine, warm cache, commands through the real bin |
| Scenarios cover acceptance criteria | PASS | All four, with two deferrals named |
| Application restarted after changes | PASS | Restarts for the provider-off leg |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Opus 5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |
| Deferrals recorded, not skipped | PASS | TEST-886 `DEFERRED → SERVER-046`, TEST-888 `DEFERRED → provider sabotage`, both with substitutes |

The log's most falsifiable claim is the relevance-gate story: that 0.25 dropped the paraphrase in one
direction and 0.15 keeps it in both. I could not measure cosines directly through the public
interface, but the **consequence** is checkable and I checked it: my own pair resolves in both
directions. The log also volunteers that its first attempt failed — a detail a fabricated log does not
contain.

## My fixture (composed for this evaluation)

```
$ node /tmp/eval-seed.mjs
A tokens: antibiotics,billing,bills,clinic,consultation,course,directly,evaluated,follow,
          infection,insurer,patient,physician,prescribed,prescribes,scheduled,tuesday
B tokens: cure,days,doctor,examined,fund,gave,goes,hands,health,illness,man,medicine,money,
          payment,returns,seven,sick,straight,visit
INTERSECTION: []
```

`doc_evalphys01` "Physician prescribes antibiotics" and `doc_evaldoct01` "Doctor hands over medicine"
share **no** content word. Seeded alongside 8 unrelated filler documents and later 120 bulk notes.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Lexically-disjoint fixture surfaces in hybrid results and is labeled `similar` in related | PASS | Both directions; `similar` is the **top** related row both ways |
| 2 | Degrades to lexical-only with the honest word when index empty / identity invalid / no provider | PASS | Three separate degradations produced, all 200, all `disabled`, all full lexical results |
| 3 | `indexing`/`stale` per the published mapping; fusion deterministic | PASS | All four wire values observed live; repeated queries byte-identical |
| 4 | Query-embedding failure degrades the request, not a 500 | NOT REPRODUCED | No public way to break one query embedding against a healthy in-process engine; the provider-level degrade is proven instead |

### Criterion 1 — the payoff, both directions

Forward (query matches only the *physician* document lexically):

```
$ corpus search "physician prescribed antibiotics" --json
{"hits":[
  {"id":"doc_evalphys01","title":"Physician prescribes antibiotics","headingPath":"Consultation",
   "snippet":"## Consultation A physician evaluated the patient and prescribed a course of antibiotics…"},
  {"id":"doc_evaldoct01","title":"Doctor hands over medicine","headingPath":"Visit",
   "snippet":"## Visit The doctor examined a sick man, then gave him medicine to cure his illness."}],
 "semanticIndex":"current"}
```

Reverse (query matches only the *doctor* document lexically):

```
$ corpus search "doctor gave medicine illness" --json
{"hits":[{"id":"doc_evaldoct01",…},{"id":"doc_evalphys01",…}],"semanticIndex":"current"}
```

`related`, both directions, top row:

```
$ corpus doc related doc_evalphys01
doc_evaldoct01   similar  ## Visit The doctor examined a sick man, then gave him medicine to cure his illness. …
$ corpus doc related doc_evaldoct01
doc_evalphys01   similar  ## Consultation A physician evaluated the patient and prescribed a course of antibiotics …
```

`both`, after adding `[[doc_evaldoct01]]` to the physician document — and it flips in **both**
directions, so the backlink half is real:

```
doc_evalphys01 → doc_evaldoct01  relation=both
doc_evaldoct01 → doc_evalphys01  relation=both
```

### The lexical half provably cannot do it

Not an argument — a measurement. During the cold-cache model download (state `disabled`, no vectors
usable), the **same query on the same corpus** returned one hit; the moment the index came up it
returned two:

```
+  1303ms {"indexed":0,"pending":80,"identity":null,"state":"disabled"} | search → disabled [doc_evalphys01]
        … 116 consecutive samples, all one hit …
+ 31433ms {"indexed":80,"pending":0,"identity":"local/…@384","state":"current"} | search → current [doc_evalphys01 doc_evaldoct01]
```

And again with `"embedding": {"provider":"none"}`-equivalent degradation (dead configured provider):
`{"hits":[{"id":"doc_evalphys01",…}],"semanticIndex":"disabled"}` — one hit, and `related` drops from
`both` back to `linked`, i.e. the semantic half is genuinely not consulted rather than merely
relabelled.

### Criterion 2/3 — all four states on the wire, and the two envelopes agree

| state | how produced | search | related |
| --- | --- | --- | --- |
| `disabled` | model not yet downloaded; and separately a dead configured provider | full lexical, 200 | full lexical, `linked` only |
| `indexing` | `POST /api/index/rebuild` in flight | 200 | 200 |
| `stale` | one-section edit, `pending 1`, no rebuild | 200 | 200 |
| `current` | drained | 200 | 200 |

`indexing` outranks `stale` (OC4) — throughout the 16 s rebuild, `pending` was 545→0 yet the word
stayed `indexing` while `rebuilding: true`, flipping to `current` only when the flag dropped.

### Response shape — Phase A plus exactly one field

```
search  top-level keys: ['hits', 'semanticIndex']      hit keys: ['headingPath','id','snippet','title']
related top-level keys: ['related','semanticIndex']    row keys: ['excerpt','id','relation','title']
```

Nothing added, nothing renamed, nothing removed.

### Determinism

`corpus search "physician prescribed antibiotics" --json` repeated across two server restarts and
~120 polls in a loop returned byte-identical `hits` arrays every time.

## Failures

None.

## Observations (not failures)

- **O-1 (worth ledgering).** There is a window of up to ~30 s in which a *fully built* index reports
  `disabled`. Observed twice, both times immediately after the model download completed: with
  `indexed: 81, pending: 0, identity: local/all-MiniLM-L6-v2@384` the state stayed `disabled` and
  search stayed lexical for ~3 s past the end of the drain, and on the first cold boot for ~30 s from
  the first failed resolution. It self-heals with no restart. This is the provider-resolution cooldown
  behaving as designed and it is **honest** — search really is lexical in that window and both
  surfaces say so together — but a first-run operator sees "downloaded, indexed, still disabled" for
  half a minute with no explanation. Worth a follow-up: re-resolve immediately when the model
  transitions from absent to present.
- **O-2.** On a small corpus, `related` fills its whole limit with `similar` rows regardless of actual
  relatedness — `doc_evalphys01` (a medical note) is returned as `similar` to "Note template"
  (`## Context ## Notes ## Open questions`) and "Bicycle brake pads". The top row is always right and
  the ordering is sensible, but the `similar` **label** carries little information at the tail with
  `SEMANTIC_MIN_SIMILARITY = 0.15`. The implementer's own design note anticipated this trade-off; I am
  recording where it lands in practice, not calling it a defect.
- **O-3.** `corpus index rebuild` executed while the configured provider is unreachable discards a
  complete, valid 561-vector index that then cannot be rebuilt (`{"indexed":0,"pending":561,
  "identity":null,"state":"disabled"}`). This is exactly what §9.1 says the verb does, and it is an
  explicit user act — but it is unrecoverable-by-waiting and there is no confirmation prompt.

## Summary

3 of 4 criteria verified directly against a fixture I composed myself, 1 not reproducible through any
public interface and deferred in the log with a named unit-test substitute. A keyword-disjoint
paraphrase pair is found in both directions and labeled `similar`, `both` appears when the pair is also
linked, and the lexical half is proven incapable of the same result on the same corpus. This is the
sprint's feature test and it passes.
