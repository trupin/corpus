# [SERVER-018] `["tree"]` invalidate-key gaps: thread deletion and archive/unarchive

## Domain

server

## Status

done

## Priority

P2

## Model

opus — two narrow, well-located fixes surfaced by the sprint-006 evaluator; no design ambiguity.

## Dependencies

- Depends on: SERVER-006, SERVER-009
- Blocks: — (UI-008 and UI-011 consume the corrected behavior but are not hard-blocked)

## Spec References

- SPEC.md §9 — SSE invalidation keys
- `issues/evals/CLI-004-eval.md` — the two "minor, not failures" notes at the end of the sprint-006 verdict

## Summary

`["tree"]` invalidate-key gaps on mutation paths that change what `GET /api/tree` returns:

1. **Thread deletion emits no `["tree"]` SSE key, though thread creation does** (sprint-006 evaluator). A deletion changes the tree exactly as much as a creation; a board subscribed on `["tree"]` shows a stale entry until an unrelated invalidation arrives.
2. **`doc archive`/unarchive emit no `["tree"]` key either** (sprint-007 planner, by inspection of every `TREE_KEY` emitter in `docs/archive.ts`) — yet archived documents are excluded from every folder count, so the board's folder badges silently desynchronize. Sprint-007 contract TEST-132b covers this.

The governing invariant (sprint-007 contract): **a mutation's invalidate frame carries `["tree"]` exactly when the response of `GET /api/tree` actually changed.**

> **Scope adjudication (orchestrator, 2026-07-27):** the originally filed second half — populating `originTitle` in the jobs listing — is **struck**: `JobSchema` has no such field anywhere in the contract, so it is a contract change, not a population fix. It is now a CONTRACT-007 rider (jobs-listing origin title), consumed by UI-011.

## Acceptance Criteria

- [x] Deleting a thread (both direct deletion and last-turn cascade) broadcasts the same key set shape as creation, including `["tree"]` — and, per the invariant, omits it in the standalone case where creation omits it too.
- [x] `doc archive` and unarchive broadcast `["tree"]` (their folder counts change), for documents and parented threads alike; a skill's folder move correctly stays silent.
- [x] Reproduction logged first for both paths (these are bugs); regression tests for both; SSE key vocabulary unchanged (no new key names).
- [x] Audit of the remaining tree-changing mutations against the invariant — twelve paths checked, three gaps found (archive/unarchive, `PUT status`, and over-emission on delete/move/create), one deviation left open on the out-of-band watcher path with a follow-up recommendation.

## Technical Design

Expected footprint: the invalidation frame construction in the thread-delete/cascade path and `docs/archive.ts`. No contract changes.

## Testing Strategy

Colocated Vitest: one SSE-frame assertion on thread delete/cascade; one jobs-listing assertion with a thread-origin job. E2E: curl -N on /events during a delete; jobs listing after a thread-origin job.

## E2E Verification Plan

### Verification Steps

1. Real workspace: create anchored thread, delete it; capture SSE frames; `["tree"]` present on both creation and deletion.
2. Enqueue a thread-origin job; `GET /api/jobs` shows the thread title in `originTitle`.

## E2E Verification Log

**implemented on: opus**

### Reproduction (before any code changed)

Real `corpus init` workspace (`/tmp/corpus-s018-I92ixo`), real server started with `corpus server start` (pid 22624, port `8993` — the sprint contract's SERVER-018 range; the post-fix pass below re-ran everything on `8956` after the orchestrator narrowed the allocation), a real `curl -N /events` subscriber attached across the whole sequence, `GET /api/tree` read immediately before and after every mutation. Markers were appended into the SSE log between steps, so each frame below sits directly above the mutation that produced it.

**The issue's premise is half wrong, and the bug is bigger than filed.** Thread deletion already emitted `["tree"]` — Open Conflict 7 confirmed. What it got wrong is the other direction: it emitted the key for a *standalone* thread, whose deletion changes nothing. And archive/unarchive was silent on three routes, not one.

| # | Mutation | `GET /api/tree` | Frame carried `["tree"]`? | Verdict |
|---|---|---|---|---|
| 1 | `POST /api/docs` (note in `finance`) | `finance` 0 → 1 | yes | correct |
| 2 | `POST /api/threads` parented + anchored | `finance` 1 → 2 | yes | correct |
| 3 | `DELETE /api/docs/<th>` (parented thread) | `finance` 2 → 1 | yes | **correct — nothing to fix** (Open Conflict 7) |
| 4a | `POST /api/threads` standalone (`parent: null`) | unchanged | no | correct |
| 4b | `DELETE /api/docs/<th>` (standalone thread) | **unchanged** | **YES** | **BUG — over-emission** |
| 5 | `DELETE /api/threads/<th>/turns/<ts>`, single-turn (cascade) | `finance` 2 → 1 | yes | correct |
| 6 | same route, middle turn of three | unchanged | no | correct |
| 7a | `POST /api/docs/<D>/archive` | `finance` 2 → 1 | **no** | **BUG — missing** |
| 7b | `POST /api/docs/<D>/unarchive` | `finance` 1 → 2 | **no** | **BUG — missing** |
| 8b/8c | archive + unarchive of a parented **thread** | `finance` 3 ⇄ 2 | **no** | **BUG — missing** |
| 9a/9b | `PUT /api/docs/<D>` with `status: archived` / `open` | `finance` 3 ⇄ 2 | **no** | **BUG — missing, not in the filed issue** |
| 10 | `POST /api/docs/<D>/move` | `finance` 3 → `finance/2026` 3 | yes | correct |

Verbatim frames for the two headline cases (pre-fix):

```
data: {"keys":[["docs"],["docs","th_vo54l254"],["tree"],["threads","th_vo54l254"]]}
### 4b. deleted STANDALONE thread S=th_vo54l254        ← ["tree"] on a tree that did not move

data: {"keys":[["docs"],["docs","doc_76sxgwti"]]}
### 7a. archived doc D=doc_76sxgwti                    ← finance 2 → 1, and no ["tree"]

data: {"keys":[["docs"],["docs","doc_76sxgwti"]]}
### 9a. PUT status=archived on D=doc_76sxgwti          ← finance 3 → 2, and no ["tree"]
```

### The fix

`MutationPlan.mayChangeTree` replaces every hand-pushed `TREE_KEY`. `runMutation` snapshots `folderTreeSignature()` — `JSON.stringify(folderTree(db))`, the same function `GET /api/tree` answers from — after the write and before the projection moves, compares it once the projection is current, and appends `TREE_KEY` iff the two differ. The invariant is therefore satisfied *by construction* rather than by seven call sites agreeing with `docs/tree.ts`. Writes that provably cannot move a badge (body edits, turns, mark-seen, locks, queue) leave the flag unset and pay nothing; `update.ts` sets it only when the patch actually changes `status`, keeping the extra query off the autosave path.

### Post-Implementation Verification

Fresh workspace `/tmp/corpus-s018-JfVPBI`, `corpus server start` (pid 87674, **port 8956**), same script, same `curl -N /events` subscriber, rebuilt bundle.

**1. The whole reproduction sequence, re-run.** Every row of the table above now satisfies the invariant. The four bug rows, verbatim:

```
data: {"keys":[["docs"],["docs","th_nwcqwhj3"],["threads","th_nwcqwhj3"]]}
### 4b. deleted STANDALONE thread          ← tree byte-identical, key correctly absent

data: {"keys":[["docs"],["docs","doc_wt7drdxo"],["tree"]]}
### 7a. archived doc D                     ← finance 2 → 1, announced

data: {"keys":[["docs"],["docs","doc_wt7drdxo"],["tree"]]}
### 7b. unarchived doc D                   ← finance 1 → 2, announced

data: {"keys":[["docs"],["docs","th_znf4t7gb"],["tree"]]}
### 8b. archived parented thread TA        ← finance 3 → 2, announced

data: {"keys":[["docs"],["docs","doc_wt7drdxo"],["tree"]]}
### 9a. PUT status=archived on D           ← finance 3 → 2, announced
```

And the ones that were already right stayed right: parented delete and the last-turn cascade both carry `["tree"]` (`finance` 2 → 1 each), the middle-turn deletion does not, and creation/deletion of the same parented thread carry the same key-set shape.

**2. The archived-document corner** (the case that proves the mechanism measures rather than guesses). An archived, thread-less document is counted in no folder, so neither moving nor deleting it changes anything:

```
### A2. archived A            → {"keys":[["docs"],["docs","doc_vfcskoc5"],["tree"]]}
### A3. moved ARCHIVED A legal → legal/archive-2026 → {"keys":[["docs"],["docs","doc_vfcskoc5"]]}
### A4. deleted ARCHIVED A    → {"keys":[["docs"],["docs","doc_vfcskoc5"]]}
```

The three `GET /api/tree` bodies around A3 and A4 are byte-identical. Before this issue both frames claimed `["tree"]`.

**3. Frames are still invalidation-only (§2.2 rule 3).** Grepping the captured stream for the document bodies, the anchor quote and both titles (`SECRETBODYTEXT`, `SECRETTURNTEXT`, `UNIQUEQUOTE`, `Retired ledger`, `Rate lock`) returns **0 occurrences each**. Every frame is `event: invalidate` with a `keys` array and nothing else.

**4. Key vocabulary unchanged.** No new key name is emitted anywhere; `packages/contract` is untouched and `query-keys.test.ts` passes unmodified. Across the full post-fix sequence the only first segments observed were `docs`, `threads` and `tree`.

**5. Regression tests are real.** `docs/tree-key.test.ts` (15 cases) asserts the biconditional by comparing `GET /api/tree` either side of each mutation, never by looking for a `TREE_KEY` push. Perturbing the mechanism proves both directions are caught: forcing it to always announce fails **6** cases (standalone delete, standalone cascade, symmetry, skill archive, `PUT` non-status edits, the archived-document corner); forcing it never to announce fails **10** (parented delete, cascade, archive, unarchive, thread archive, `PUT status`, doc lifecycle, move, capture, vocabulary).

### Audit — every tree-changing mutation checked against the invariant

| Path | Before | Now |
|---|---|---|
| `POST /api/docs` (`docs/create.ts`) | literal `TREE_KEY`; over-emitted for a `type: thread` create (lands under `data/threads/`) | measured |
| `PUT /api/docs/:id` (`docs/update.ts`) | **no key at all**, though `status: archived` is writable here | measured when the patch changes `status` |
| `POST /api/docs/:id/move` (`docs/move.ts`) | literal; over-emitted for an archived thread-less document | measured |
| `POST /api/docs/:id/archive`\|`unarchive` (`docs/archive.ts`) | **no key at all** | measured (a skill's folder move correctly stays silent) |
| `DELETE /api/docs/:id` (`docs/delete.ts`) | literal; correct for a parented thread, over-emitted for a standalone or archived one | measured (a doc's deletion also un-counts its orphaned threads) |
| `POST /api/threads` (`threads/create.ts`) | conditional on `parent !== null`; over-emitted for a parent outside `data/docs/` | measured |
| `DELETE /api/threads/:id/turns/:ts` (`threads/cascade.ts`) | cascade delegates to `deleteDocumentLocked`; middle-turn branch never claimed the tree | unchanged — cascade inherits the measurement, middle-turn stays silent |
| `POST /api/capture` (`capture/capture.ts`) | literal | measured |
| `POST /api/threads/:id/turns` (`threads/turns.ts`) | no key | correct, unchanged — a turn cannot move a count |
| thread resolve/reopen (`threads/status.ts`) | no key | correct, unchanged — the tree filters on `archived` only, verified by a `PUT status: resolved` case |
| mark-seen (`threads/seen.ts`), locks, jobs, queue routes | no key | correct, unchanged |
| `POST /api/db/rebuild` (`projection/routes.ts`) | coarse `["docs"],["tree"],["queue"],["jobs"],["locks"]` | unchanged — deliberately coarse (SERVER-017), not a per-mutation frame |

**One deviation found and deliberately left in place — the out-of-band watcher path** (`watcher/watcher.ts`), which is not a mutation frame and is outside this issue's stated footprint. It decides the key from a `structural` heuristic (file appeared/disappeared) rather than from the tree, so it breaks the invariant in both directions. Reproduced on the real server (port 8956): editing `data/docs/oob/out-of-band.md` on disk to `status: archived` removed the `oob` folder from `GET /api/tree` entirely (`{finance: 2, oob: 1, …}` → `{finance: 2, …}`) while the watcher's frame carried only `{"keys":[["docs"],["docs","doc_fidnedel"]]}`. The converse also holds by inspection: a skill file appearing under `.claude/skills/` is "structural" and emits `["tree"]` though skills are counted nowhere. `folderTreeSignature()` (exported from `docs/tree.ts`) would drop straight into the watcher's `flush()`, which already collects a batch's keys before broadcasting — **recommend a follow-up issue**.

**Gate.** `npm run build` clean · `npm run lint` clean · `npm run format:check` clean · `npm run typecheck` clean across all five workspaces · full suite **3128 passed / 184 files** (15 new) · coverage **98.75% lines, 94.96% branches, 99.37% functions**, above the 90% gate.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-018]` prefix
