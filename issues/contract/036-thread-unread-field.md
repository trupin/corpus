# [CONTRACT-036] `GET /api/threads/{id}` carries no `unread`, so a reader has to guess

## Domain

contract

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md **§7**, Read state — the mark lives on the server (`.corpus/seen.json`)
  and "survives browser changes"; unread is "turns after the mark"
- SPEC.md **§6**, thread frontmatter — `status: open | resolved; a resolved
  thread is collapsed by default wherever it is shown (§10)`
- SPEC.md **§10**, Thread view — "a conversation carrying a turn you have not
  seen is never collapsed **by the rule**" (the unread interlock)

## Summary

**`unread` exists on `DocRow` and nowhere else.** `DocRowSchema` carries it
(`boolean | null`, "null on non-threads"), so any surface that reached a
conversation through a *list* knows whether it holds an unseen turn. A surface
that reached one through `GET /api/threads/{id}` — `ThreadSchema`: `id`, `title`,
`created`, `updated`, `status`, `tags`, `parent`, `anchor`, `agent`, `turns` —
does not, and the resource carries nothing it could derive the answer from
either: no last-seen mark, no per-turn seen flag.

That is fine for every surface that only *displays* a conversation. It stopped
being fine when UI-077 made read state an **input to a placement decision**:
SPEC.md §10's interlock says the by-rule fold never applies to a conversation
carrying an unseen turn, so a placement that cannot answer "is this unread"
cannot apply §6's rule either.

**Where the UI has no row.** Two cases, both real:

1. **A standalone thread** (`parent: null`) — SPEC.md §6's own category, and what
   the board's global composer creates on every Ask (`useCompose`, `parent:
   null`). There is no parent to list, so no `useDocs({parent, type: thread})`
   can ever return a row for it.
2. **A thread past the first page of a busy parent.** The rows come from one
   paginated list (`DEFAULT_PAGE_LIMIT = 50`); a document's anchors are not
   paginated. Past that page the row is simply not in the answer.

**What the UI does today, and why it is not good enough.** `DocView`'s
`openThreadReadState` falls back to `hasSeenMark(threadId, lastTurnTs)` — the
kit's record of the `POST /api/threads/{id}/seen` **this tab** sent, a
module-level `Map` with a page session's lifetime. It can confirm a read and can
never deny one, so the fallback answers `read` or `unknown`, never `unread`, and
`unknown` stands the by-rule fold down (`resolvedRuleCollapses` asks for `read`).

The behaviour that leaves is honest but wrong: **a resolved standalone thread
opens expanded on its first visit after every reload**, even when it was read
weeks ago and the server knows it, because the only browser that could vouch for
it is the one whose `Map` the reload emptied. §6 says "collapsed by default
wherever it is shown"; for this placement it is collapsed by default only from
the second visit of a page session onwards. It was written up in
`issues/ui/077-resolved-threads-collapse.md` (PR #25 re-review, MAJOR) as
"derivation where a field would do", and the derivation is what this issue
deletes.

## Acceptance Criteria

- [ ] `ThreadSchema` carries `unread: boolean` — true exactly when the thread's
      last turn is newer than the caller's last-seen mark, the same comparison
      `DocRow.unread` already makes, so the two agree by construction
- [ ] The field is **required**, not optional, and not nullable: this resource is
      only ever a thread, so there is no "null on non-threads" case to spell —
      `false` means "nothing unseen" and never "unknown"
- [ ] The description ties it to `DocRow.unread` by name rather than restating
      the rule, the way `DocRow.unreadThreads` already ties itself to the
      per-thread flag
- [ ] A thread with no turns reads `false` — there is nothing to have read, which
      is how `useMarkSeenOnce` and the projection both already treat it
- [ ] A partial read (`lastSeenTs` naming an earlier turn, `MarkSeenResult.unread
      === true`) leaves the thread `unread: true`, same as the row
- [ ] `openapi.json` regenerated and drift-checked; the generated client's
      `Thread` type gains the field
- [ ] `apps/server` populates it on the read path (server issue, if the projection
      does not already have the value to hand at that point — split it out rather
      than widening this one)
- [ ] `apps/ui`'s `openThreadReadState` loses its second branch: with the field in
      hand it is `readStateOf(thread.unread)` and the `hasSeenMark` import, the
      `useDocs({parent, type: thread})` row lookup and the `"unknown"` branch all
      go. `ThreadReadState` itself stays — `summaryFromAnchor` still has no answer
      to give, and the depth-clamped and row-less anchored placements still rely
      on it

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/thread.ts` — `unread` on `ThreadSchema`
- `packages/contract/src/schemas/thread.test.ts` — the field's shape and its
  required-ness
- `packages/contract/src/openapi.test.ts` — the published `Thread` component
  carries it, required, typed boolean
- `packages/contract/openapi.json` — regenerated
- Consumers (separate issues, in this order): `apps/server` populates it;
  `apps/ui` deletes the fallback

### Key Implementation Details

The comparison is already implemented for rows — reuse it rather than writing a
second one, so a change to the definition of "unread" cannot make the row and the
thread disagree. `MarkSeenResult` (`POST …/seen`) already returns an `unread`
computed this way; that is the same predicate.

### Edge Cases

- **A thread with only pending turns.** The UI's `isPendingTurn` turns are
  client-side optimism and never reach the server, so the server's answer is
  about confirmed turns only. No special case here — noted so a consumer does not
  invent one.
- **Whose mark.** Corpus is single-user (SPEC.md §1), so there is one mark and no
  per-caller dimension to add.

## Testing Strategy

Schema tests in `packages/contract`: the field is required, rejects null, rejects
a string. OpenAPI tests: the `Thread` component lists it under `required` and
types it `boolean`. The behavioural half (does the server compute it correctly)
belongs to the server issue that populates it, beside the existing `DocRow.unread`
projection tests.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus init` a workspace, start the server and the UI.
2. Ask something from the board's global composer — that creates a **standalone**
   thread (`parent: null`).
3. Read the answer, then resolve the thread.
4. Reload the page and open the thread from a `type: thread` column.
5. Expected (SPEC.md §6): it is placed **collapsed**, like every other resolved
   conversation.
6. Actual: it is placed expanded. `GET /api/threads/{id}` says nothing about read
   state and the tab's own seen record was emptied by the reload, so the reader
   has no answer and correctly declines to apply the rule.

### Verification Steps

1. Rebuild and restart after the change.
2. Repeat steps 2–4 above. `curl` the thread endpoint and confirm the response
   carries `"unread": false`.
3. Expected: the reader places it collapsed on the first visit after a reload.
4. Post a new turn to it from the CLI, reload, and confirm the endpoint reports
   `"unread": true` and the reader places it **expanded** — the interlock, now
   answered by the server rather than by the browser.

## E2E Verification Log

### Implemented on

opus. **Contract half only**, as instructed — the server population and the UI
consumption are handed off below and were deliberately not implemented.

### Reproduction, on a real server

Port **8838**, real workspace, `corpus` from source. Thread `th_j7xzwa3j` read
through `GET /api/threads/{id}` before the change:

```
Thread carries `unread`? False
keys: id, title, created, updated, status, tags, parent, anchor, agent,
      resident, turns
```

Nothing on the resource answers read state and nothing on it could derive the
answer: no mark, no per-turn seen flag. That is the gap.

### What the contract now carries

`ThreadSchema` gains `unread: boolean` — **required, non-nullable**, positioned
before `turns`. From the generated document:

```
Thread.required = ['id','title','created','updated','status','tags','parent',
                   'anchor','agent','resident','unread','turns']
Thread.properties.unread.type = "boolean"
DocRow.properties.unread.type = ["boolean","null"]   # unchanged
```

The asymmetry is the point and is asserted: `DocRow.unread` is nullable because a
row may be a document, this resource is only ever a thread, so `false` means
*nothing unseen* and never *unknown*.

The description ties itself to `DocRow.unread` **by name** rather than restating
the comparison — the way `DocRow.unreadThreads` already ties itself to the
per-thread flag — and states the two edge cases the criteria name: a thread with
no turns reads `false`, a partial read reads `true` like the row and like
`MarkSeenResult.unread`. The route description says the same at the operation
level, since an OpenAPI reader meets the operation first.

### Tests

`packages/contract/src/schemas/thread.test.ts` — required, rejects a missing key,
rejects `null`, rejects a string; and the description names `DocRow.unread`.
`packages/contract/src/openapi.test.ts` — a CONTRACT-036 block against the
**generated** component: published and required, typed `boolean`, **not**
`["boolean","null"]` while `DocRow`'s still is, the description's three
load-bearing phrases, and the route's sentence.

### Handoff — server (`apps/server`)

`apps/server/src/threads/read.ts:203` builds the `Thread` and is the one place to
change; it is the third of the three intended compile errors in `apps/server`.

- **The field**: `unread: boolean` on the `Thread` this function returns.
- **What to compute it from**: the projection's existing comparison, **not a
  second one**. `apps/server/src/docs/needs.ts` already owns it as
  `unreadSql(mark)` — `t.last_ts IS NOT NULL AND t.last_ts > COALESCE(<mark>,
  '')` — and exports `isThreadUnread(db, threadId, mark)`, which is exactly this
  predicate against a bound mark. Call that with the thread's own id and the mark
  from `.corpus/seen.json`, the same mark `DocRow.unread` and
  `MarkSeenResult.unread` are computed against. A thread with no turns has
  `last_ts IS NULL` and therefore reads `false` with no special case.
- **Do not** re-derive it from the turns array in the response: the row, the mark
  result and the thread must agree by construction, and three call sites of one
  SQL fragment is how that is guaranteed today.
- Tests belong beside the existing `DocRow.unread` projection tests: no turns →
  `false`; a mark at the last turn → `false`; a `lastSeenTs` naming an earlier
  turn → `true`, agreeing with the `MarkSeenResult` the mark itself returned.

### Handoff — UI (`apps/ui`)

`apps/ui/src/reader/DocView.tsx`, `openThreadReadState`:

- **Replace the whole derivation with `readStateOf(thread.unread)`.** The field
  is required and non-nullable, so there is no `"unknown"` to produce here any
  more.
- **What goes with it**: the `hasSeenMark(threadId, lastTurnTs)` fallback and its
  import, the `useDocs({parent, type: thread})` row lookup that fed the first
  branch, and the `"unknown"` branch itself. The reason the fallback existed —
  a browser-lifetime `Map` that can confirm a read and never deny one — is
  exactly what the field removes.
- **What stays**: `ThreadReadState` itself. `summaryFromAnchor` still has no
  answer to give, and the depth-clamped and row-less anchored placements still
  rely on it.
- **The behaviour to verify**: a **resolved standalone thread** (the board's
  global composer creates one on every Ask, `parent: null`) must be placed
  **collapsed** on the first visit after a reload, which is what it does not do
  today. Then post a turn to it from the CLI, reload, and it must be placed
  **expanded** — SPEC.md §10's interlock, answered by the server rather than by
  the browser.
- `apps/ui/src/testing/readerFixture.ts` and any `Thread` literal in the UI's
  tests need `unread`.

Note for whoever picks these up: `apps/ui`'s typecheck is **not** trustworthy
from a fresh worktree without `packages/kit/dist` — it silently resolves
`@corpus/*` to the main checkout and reports green.

### Gates

`vitest run packages/contract` — 2972 tests, exit 0. `npm run typecheck -w
packages/contract` — exit 0 (four contract-owned fixtures updated:
`schemas/thread.test.ts`, `client/upload.test.ts`,
`client/request-defaults.test.ts`, `routes/index.test.ts`,
`routes/thread-create.test.ts`). ESLint and Prettier clean. `openapi.json` and
`schema.generated.ts` regenerated.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
