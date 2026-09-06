# [SHARED-081] Ten design decisions the ledger deferred to triage

## Domain

shared

## Status

todo

## Priority

P2

## Model

fable

**Why fable and not the default opus.** Every item below is a decision the ledger
deliberately did **not** make, several of them cross-domain, two of them likely
needing signed SPEC riders. CLAUDE.md's model policy names exactly this shape —
"spec revisions, architecture decisions, ambiguous cross-domain tradeoffs" — as
the case for fable. An agent that implements these instead of deciding them will
produce ten changes nobody agreed to.

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Batched 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger) by the
audit that closed it. Ten items the ledger recorded with the words "decide at
triage", "consider", "options at triage", or "fix shape at triage". They are
grouped because they share a failure mode: filed as implementation issues they
would each get implemented one way and reviewed as if the way had been chosen.

**This issue carries the `agent.done` producer chain** (item 1), which SPEC.md
cites by name. `SPEC.md:354` points here.

## Spec References

- SPEC.md:325 — §7 core event types, `agent.done` "reserved: nothing produces it
  yet"
- SPEC.md:354 — §7 "Outcomes are never assumed", which names this issue
- SPEC.md §6 — anchors and anchor quotes
- SPEC.md §9.1 — the semantic index and its providers
- SPEC.md §11 — the doctor and its warnings
- SPEC.md §12 — a document of an unrecognised type renders with working
  checkboxes

## Summary

Ten open decisions. **The deliverable is a decision per item, with its reasoning
recorded — not ten implementations.** Where a decision is "do nothing", record
that and why. Where a decision needs a SPEC rider, draft the rider text verbatim
and route it to the user for sign-off rather than applying it. Where a decision
implies work, file the implementing issue in its own domain and link it here.

An item may of course be implemented in the same pass where the decision is
obvious and the change is small. What must not happen is an implementation
standing in for a decision that was never made.

## Acceptance Criteria

Each item below reaches one of three states: **decided and done**, **decided and
filed** (with the new issue id), or **decided as no-change** (with the reason).

- [ ] **1. `agent.done` has no producer.** (sprint-016 OC1.) §7 makes the event
      load-bearing for delegation wake-back, and no route or verb enqueues it.
      The ledger's standing decision was to leave it: settlement happens when
      parking returns, and the producer chain gets filed "when delegation's
      reconcile-at-idle proves insufficient in practice". **Decide whether that
      threshold has been reached.** If it has, the chain is contract + server +
      cli and is three issues with dependencies, not one. If it has not, say so
      and leave the spec text alone — SPEC.md:325 and :354 already describe the
      shipped behaviour honestly. **This is the item SPEC.md:354 references by
      name.** If this issue is ever superseded, repoint that reference; do not
      leave the spec citing a closed issue. _(The related defect — the comment
      skill telling the agent the wake-back works — is not a decision and is
      already filed as AGENT-071.)_

- [ ] **2. The doctor's per-finding git spawn is synchronous in the request
      handler.** (PR #14 review MINOR 2, `unindexable.ts:94-126`.) Bounded at
      50 × 5s, so a pathological workspace can block the single-threaded server
      for ~250s and stall SSE heartbeats. Healthy workspaces spawn nothing.
      Decide the shape: async exec, resolve commits lazily, or move the
      resolution CLI-side. Then file it in `server` (or `cli`) with the shape
      chosen.

- [ ] **3. Thread-create warnings are document-scoped, not call-scoped.** (Phase
      6 eval LEDGER-P6-2.) A create response carries every unresolved anchor on
      the parent, so the CLI's warning suffix can list other threads' orphans.
      The server behaviour is **by design** — §11 validates the whole rewritten
      frontmatter. So the decision is about the CLI's presentation: scope the
      printed list to the new anchor id, or document the semantics in the verb
      help. Pick one.

- [ ] **4. `unindexable_files_truncated` is a server-only warning kind.**
      (SERVER-038.) It is legal under CONTRACT-025's open kind space. Publishing
      it in `DOCTOR_WARNING_KINDS` is an optional contract rider. Decide whether
      the kind space's openness is the answer (leave it) or whether a kind the
      server actually emits should be nameable by clients (publish it).

- [ ] **5. `related`'s `similar` label is uninformative at the tail on small
      corpora.** The 0.15 gate admits "Bicycle brake pads" as similar to a
      physician note. Ordering is correct; the **label** is the false claim.
      Options the ledger named: raise the gate, cap the number of `similar` rows,
      or carry the score so the caller can judge. Decide. **This item and item 6
      are the same underlying question and should be decided together.**

- [ ] **6. `SEMANTIC_MIN_SIMILARITY` fails open for configured providers.** (PR
      #17 review MINOR 5.) 0.15 is measured for MiniLM. OpenAI-family cosine
      scales unrelated pairs to ~0.6-0.8, so for those providers the gate
      excludes nothing and `similar` becomes a claim the product cannot support.
      Options: a per-identity gate, score-carrying rows, or a documented caveat.
      A per-identity gate is the only one that makes the label true for every
      provider, and it is also the most work — say which tradeoff was taken.

- [ ] **7. Search snippets include raw heading markup.** ("## Rate assumptions
      The base…", UI-026 observation.) Server-side cosmetic. Decide whether
      heading markers are stripped at snippet composition, and if so whether
      other markdown syntax gets the same treatment or only headings.

- [ ] **8. The degrade note says "ranked on the lexical half alone" while
      embedded rows are present.** Two surfaces have the same defect and want
      **one shared phrasing**: the pack degrade note, and the ⌘K overlay's note,
      which `searchApi.ts` prefixes with "Ranked on text alone —" for `stale` and
      `indexing`. Only `disabled` is truly text-alone. This is not drift — the
      behaviour is right and the sentence overstates. Write one honest phrasing
      and apply it to both.

- [ ] **9. Truncated section windows can open mid-word.** Legal — §6 governs
      anchor quotes, not pack windows — and the escalation is printed. A craft
      nit. Decide whether windows snap to a word boundary or whether "legal and
      printed" is the answer.

- [ ] **10. The editor schema normalises a mixed list into a full task list.** A
      list mixing a plain bullet with a task item gets the plain bullet a
      checkbox. Decide whether mixed lists are preserved. **This is more
      load-bearing than when it was filed**: SPEC §12's M6 makes checkbox
      rendering on an unrecognised document type the guarantee that protects
      existing `type: todo` documents, so what the editor does to a mixed list is
      now a documented promise's neighbour. If the decision changes behaviour, it
      probably needs a spec rider.

- [ ] Every decision is recorded in this file with its reasoning, not only in a
      commit message.
- [ ] Every SPEC rider drafted is quoted **verbatim** and routed to the user for
      sign-off. None is applied unsigned. (Per the standing rule: riders are read
      back one at a time, in the drafted text, before signature.)
- [ ] Every filed follow-up issue is listed here with its id.

## Technical Design

### Files to Create/Modify

- This file — the decisions and their reasoning.
- `issues/<domain>/NNN-*.md` — one per decision that implies work.
- `issues/PLAN.md` — rows for whatever is filed.
- Code only where a decision is obvious and its change is small.

### Key Implementation Details

Take the items in dependency order, not list order:

1. **Items 5 and 6 first**, together. They are one question about what `similar`
   is allowed to claim, and deciding 5 without 6 produces a gate tuned for one
   provider — which is the defect 6 describes.
2. **Item 8** next, because it is the same family (an honest word in an
   overstated sentence) and its answer may inform 5/6's caveat wording.
3. **Item 1** stands alone and is the one with a spec citation pointing at it.
   Decide it explicitly rather than letting it roll forward a third time.
4. The rest are independent.

For each item, the record should say: what was decided, what was rejected, and
what would change the answer. The last one matters most — several of these items
have now been deferred twice, and a deferral with no stated trigger is how that
happens.

### Edge Cases

- An item whose subject has been fixed or removed since 2026-08 is struck with
  evidence. Verify before deciding.
- Items 5, 6 and 8 all touch user-visible wording about search quality. If three
  separate phrasings emerge, that is a worse outcome than three deferred items.
- Item 1's decision must not silently edit SPEC.md:325 or :354. Both currently
  describe the shipped behaviour correctly. Only a signed rider changes them.

## Testing Strategy

Per filed issue, once decided. This issue's own deliverable is decisions.

## E2E Verification Plan

### Verification Steps

1. Read this file back: every item carries a decision, a reason, and either a
   "done" or a filed issue id.
2. `issues/PLAN.md` carries a row for every issue this one filed.
3. Any SPEC rider exists as drafted text awaiting signature, and SPEC.md is
   unchanged until it is signed.

## E2E Verification Log

_[Agent fills. Where an item was implemented rather than filed, the ordinary E2E
evidence is required for that change. State which model the implementing agent
ran on.]_

## Completion Checklist (domain agent)

- [ ] All ten items decided
- [ ] Reasoning recorded in this file
- [ ] Follow-up issues filed and listed here
- [ ] Any SPEC rider drafted verbatim and routed for sign-off, not applied
- [ ] `/lint` passes on anything actually changed

## Completion Checklist (orchestrator)

- [ ] Decisions reviewed; anything needing user sign-off routed to the user
- [ ] `/evaluate` passes for anything implemented
- [ ] Committed with `[SHARED-081]` prefix
