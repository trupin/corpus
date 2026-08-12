# [UI-107] The board presents a key, and never goes read-only

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049, SERVER-098

## Spec References

- SPEC.md **§7** — both writers participate
- SPEC.md **§11** — "The board is **never read-only**", and "Autosave, no save
  button"

## Summary

The board is the other writer. SHARED-041 decision 2: it presents a key too, and
adopts-then-retries on refusal — reusing the external-change handling
`DocEditor` already has.

And the read-only banner goes. A document the agent is writing stays editable.

## Acceptance Criteria

- [x] The editor's autosave presents the key from its last read or write, and
      keeps the key each save returns
- [x] A `409` is handled by **adopt-then-retry**, not by an error: the editor
      already knows how to take an external change (`DocEditor.tsx`'s "an
      external change while the user is typing"). A conflict is that path, with a
      retry after it
- [x] **Nothing the person typed is lost to a conflict.** This is the criterion
      that matters. A refusal arriving mid-sentence must not discard the
      sentence; state plainly in the log what happens to in-flight text and prove
      it in a spec
- [x] `LockBanner.tsx` and the force-unlock action are **deleted**; no document
      renders read-only, and nothing polls or subscribes to lock state
- [x] The person sees the agent's writes land live, as they always have (§9.4) —
      confirm nothing about that depended on the lock projection
- [x] Frontmatter controls (tags, status, due) are delta writes and keep working
      with no key at all
- [x] The e2e stub carries the key and the `409` shape. `stubCorpus.ts` is typed
      against the contract since UI-102, so an unmodelled field is a typecheck
      error — keep it that way

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/DocEditor.tsx`, `apps/ui/src/reader/useReaderDoc.ts`
- **Delete** `apps/ui/src/reader/LockBanner.tsx` and its usages
- `apps/ui/e2e/stubCorpus.ts`, and whatever specs assert lock behaviour

### Notes

- Conflicts should be rare in practice — the person's own autosave is the most
  frequent writer and it always holds a fresh key. The realistic trigger is the
  agent writing the open document, which is exactly the case the lock banner used
  to make loud and the spec now makes quiet.

## Testing Strategy

Component and Playwright. The conflict path needs a real spec: stub a `409`,
assert the editor adopts, retries, and keeps the person's text.

## E2E Verification Plan

`CORPUS_UI_PORT` set to a free port — **never 5173** (an ssh tunnel holds it) and
never 8765.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`). Run 2026-08-12.

### The arrangement

A **real** stack, not the stubbed one: `corpus init /tmp/ui107-ws`, a real
`corpus server` on **8766**, and the real Vite dev server on **5501**
(`CORPUS_UI_PORT`/`--port 5501`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766`)
driven by a real Chromium through Playwright. Never 5173 (ssh tunnel), never
8765 (the user's live server, untouched throughout and confirmed still bound
afterwards). Both processes stopped and both ports confirmed free at the end.

The agent's writes go through the **real CLI** (`corpus doc edit --key … --from
agent`), so both writers in these drills are the shipped ones.

### 1. The document never renders read-only

With the document open and the agent about to write it:

```
{ lockBanner: 0, forceUnlock: 0, contenteditable: 'true', titleReadOnly: null }
```

No banner, no Force unlock, an editable body and a writable title — on the very
document the old mechanism would have frozen.

### 2. A refusal arriving mid-sentence — what happens to the in-flight text

The sequence, as the browser recorded it on the wire:

```
board read at open        key 2a683cd0…
person types              "Half a sen", then keeps typing while the agent runs
agent (CLI, --from agent) doc edit --key 2a683cd0… → landed; server now 4b68ec83…
board sent   PUT {"body":"Half a sentenThe rate held.\n","key":"2a683cd0…"}
server answered  409 stale_key  doc.key 4b68ec83…  doc.body "The agent rewrote this line."
board sent   PUT {"body":"Half a sentenThe rate held.\n","key":"4b68ec83…"}
server answered  200            doc.key 952e13f5…  doc.body "Half a sentenThe rate held.\n"
```

**What happens to in-flight text, stated plainly: nothing happens to it.** The
buffer is put back before the refusal is even classified, so the two `PUT` bodies
are byte-for-byte identical — the second is not a re-serialisation of the editor
after an adoption, it is the same string. The editor is never reset: the refusal's
document is published into the document cache, where `DocEditor`'s existing *"an
external change while the user is typing"* rule owns it, and that rule holds an
incoming body back for as long as an editing session is open — which a
mid-sentence refusal is, by definition. Only the **key** is adopted, and the
write is re-sent against it.

Afterwards:

```
on screen   "Half a sentenThe rate held."     ← every character the person typed
caret still in the body: true
save chip in error: 0
lock banner: 0
on disk     ---\n…\n---\nHalf a sentenThe rate held.\n
git log     user:  doc edit: Rates (doc_h4hcdpvv) by user
            agent: editing session: 1 document by agent
```

Both writes are in the history, each with its own author. The agent's line was
superseded by the person's retry — SPEC.md §7's *"what a key does not do"*, and
the loser here found out (the board was handed the agent's document and a fresh
key) rather than losing the edit in silence.

The reciprocal case was observed too, on an earlier pass where the board's save
won the race: the **agent** got the `409`, and the CLI printed the document as it
now stood, its fresh key, the retry instruction, and §7's advisory *"someone is
editing this — a person has an edit session open on doc_h4hcdpvv right now"*.
Both writers participate, symmetrically (SHARED-041 decision 2).

### 3. The agent's writes still land live (§9.4)

With nobody typing, `corpus doc edit --from agent` from the CLI:

```
1. the agent's write landed live on screen with no reload (SPEC.md §9.4) ✓
   board wrote nothing back: 0 PUTs
```

Nothing about that path went through the lock projection — it is the same
`["docs", id]` SSE invalidation and refetch it always was, and SERVER-099's
removal of the projection cannot touch it.

### 4. Frontmatter controls are delta writes, and take no key

```
frontmatter write the board sent: {"tags":["finance","tax"]}
carries a key: false
tags on disk: [ 'finance', 'tax' ]
```

### 5. Nothing polls or subscribes to lock state

```
requests to any /locks route from the whole session: []
```

### What was run

- `npm run build -w packages/contract`, then `-w packages/kit`.
- `npx vitest run packages/kit` — **752 passed**, 47 files.
- `npx vitest run apps/ui` — **2956 passed**, 144 files (`VITEST_MAX_THREADS=4`).
- `npx playwright test key-conflict.spec.ts` (`CORPUS_UI_PORT=5502`) — 3 passed.
- `npx playwright test` (whole suite) — 326 passed, 38 failed; **none of them
  this issue's**. 35 are the `plugins/todos` cascade below; the other 3
  (`console.spec.ts:63`, `smoke.spec.ts:241`, `weight.spec.ts:207`) require
  nothing listening on 8765, and the user's live server is bound there.
- `npx eslint apps/ui packages/kit` — clean. `prettier --check` — clean.
  `tsc --noEmit` on both workspaces — clean.

### Escalation: `plugins/todos` still imports the removed kit exports

`plugins/todos/ui/TodoListItem.tsx` imports `useDocLock` and `LockChip` from
`@corpus/kit` (lines 3, 15, 64, 119), and `plugins/todos/ui/testing.tsx` +
`TodoListItem.test.tsx` seed `/api/locks`. That is the fourth breakage CONTRACT-049
handed over and it belongs to plugins-dev. Until it lands it fails
`npm run build` (rollup cannot resolve the import out of the kit) and takes 35
plugin e2e specs with it. Nothing in `apps/ui` or `packages/kit` can fix it from
this side: the chip and the hook are gone because the mechanism is.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
