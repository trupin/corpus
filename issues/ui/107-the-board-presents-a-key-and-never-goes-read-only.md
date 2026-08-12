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

### Follow-up: PR #43 review findings (2026-08-12)

**Model: opus** (`claude-opus-5[1m]`). Two MAJORs and five MINORs (three named in
the review, two of the same class found in the sweep).

#### MAJOR 1 — the mockup still implemented the lock UI

`design/index.html` is authoritative for look & feel, so leaving the lock banner
in it would have handed the removed design back to the next agent that opened it.
Removed: `.lock-banner` CSS, `lockBannerHTML()`, the `locked` field on
`doc_cashflow`, the `contenteditable` gating in `bodyHTML()`/`readerHTML()`, the
`data-force-unlock` handler and its `Lock broken…` toast, and the `?.locked`
guard that suppressed the selection toolbar.

**What replaced it**: a `.change-notice` — a past-tense report shown *only* after
an adopt-then-retry, i.e. when the person's save went on top of a change they
never read. Copy: *"the agent edited this while you were typing — your save went
on top of it. its version is in the history."*, with `see what it wrote` (selects
that job in the console) and a dismiss. Nothing is shown for an agent write that
lands while nobody is typing: that is §9.4's live landing, and the text changing
*is* the event. Nothing anywhere says another writer "has" the document — that is
the banner in miniature, rejected in PLUGINS-017, and false besides. The mockup
now simulates the whole path on `doc_cashflow`: type in it, and the agent's
`doc.edit` job appears in the console, the save takes a round trip longer, and
the notice lands with the document still editable underneath.

Verified in a real browser (headless Chromium via Playwright, `file://`, no
server, so no port was bound):

```
before typing   { editable: 'true', notice: 0, lockBanner: 0 }
during          save chip 'saving…' — never 'save failed'
after           notice '↯ the agent edited this while you were typing — your save
                went on top of it. its version is in the history. see what it wrote ✕'
                editable 'true' · caret still in the body · lock banner 0
                chip settles to 'committed · git ✓'
'see what it wrote' → console opens on job 'doc.edit · Cashflow 2026':
                claimed evt_key1 (doc.edit)
                corpus doc edit --key 2a683cd0 --from agent
                committed 4b68ec8 · key now 4b68ec83
dismiss         notices 0, document still editable
page errors     []
```

Looked at, not just parsed: screenshots in column view, full-screen (focus) view
and dark theme. The notice's copy takes the full width with its actions beneath,
right-aligned, so it does not squeeze into a ragged column in a narrow reader.

#### MAJOR 2 — published docs advertised removed API

`packages/kit/README.md`: deleted the `["locks"]`/`["locks","<docId>"]` rows,
corrected *"The ten core shapes"* → **eight** (`QUERY_KEY_NAMES`), corrected
*"Two entry points"* → three code entry points plus five CSS subpaths (`./plugin`
was undocumented), added the missing `["attachments","<target>"]` row, added a
**Writes present a key** section (key on every `Doc`; required only when the patch
carries `body`, per `KEYED_UPDATE_FIELDS`, `400` if omitted; `409 stale_key`
carries the document as it now stands; `staleKeyDoc(error)`; adopt-then-retry with
the same buffer), and a **What else is in here** map of the row / markdown /
autocomplete / composer / weight families.

`apps/ui/README.md`: `useLocks` gone from the probe (the real set is `useDocs`,
`useTree`, `useJobs`, `useQueueStatus`, `useConnectionState`, plus the `?thread=`
half); React 18 → **19**; the proxy is `/api`, `/attachments` **and** `/events`,
with `CORPUS_SERVER_ORIGIN`; the auth exemption is **two** routes (health, and the
loopback job-log ingest); the token precedence (injected beats
`VITE_CORPUS_TOKEN`) stated rather than left as a forward reference to SERVER-024;
and `npm test -w apps/ui` corrected — this workspace declares no `test` script, so
that command **fails**.

#### MINORs

- `apps/ui/src/testing/readerFixture.ts` — deleted the `POST /api/locks/{id}/break`
  branch. Nothing referenced it.
- `plugins/todos/ui/TodoItemComposer.test.tsx` — the refusal fixture was
  `423 / code: "locked"`, neither of which the system can produce. Now `404 /
  not_found`, which `POST /api/threads` actually declares (400, 401, 404). One
  fixture changed, nothing else.
- `packages/contract/src/client/index.test.ts` — dropped `locks: 0` from the
  mocked `RebuildResult`.
- `packages/kit/src/client/queryClient.test.ts` — `isClientError(of(423))` →
  `of(409)`; 423 is on no operation, 409 is the refusal the system does produce.
- `packages/kit/src/query/retrievalHooks.test.tsx` — the "some other shape" frame
  was `["locks"]`; now `["queue"]`, a shape that exists.

#### What was run

- `npm run build` — clean.
- `VITEST_MAX_THREADS=4 npx vitest run packages/contract plugins` — **2835 passed**.
- `VITEST_MAX_THREADS=4 npx vitest run packages/kit` — **757 passed**.
- `VITEST_MAX_THREADS=4 npx vitest run apps/ui` — **2956 passed**.
- `npx eslint` on every touched source file — clean. `npx prettier --check` on
  every touched file — clean (the two READMEs were formatted).
- The mockup drill above. No dev server and no Playwright suite was started, so
  neither 5173 nor 8765 was touched; the user's live server stayed bound.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
