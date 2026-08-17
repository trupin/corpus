# [SERVER-117] The scope walk abandons the parent edge, so a resident loses conversations on its own artifacts

## Domain

server

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: SERVER-111 (which wrote the walk), SHARED-044 (the precedence
  question, which this partly answers)

## Spec References

- SPEC.md **§7** — *"The **scope** of a designated thread is: the thread itself;
  every thread whose parent chain reaches it; every **document** whose origin
  reaches it; and every thread on such a document."*
- SPEC.md **§7** — *"the alternative is a resident that owns the talking and
  loses the artifacts the talking produced"*

## Summary

PR #48's review found two defects in `apps/server/src/queue/scope.ts:105`
(`current = node.origin ?? node.parentId`). They are separate and both are real.

### 1. The walk never falls back to the parent edge

The walk is a single linear chain. Once a node has an `origin`, its `parentId`
is **never consulted again** — not even when the origin chain dead-ends at no
designated thread. So §7's *"every thread on such a document"* is unreachable
for any thread that carries an origin.

**And every agent-created thread carries one.** `apps/cli/src/input.ts` exports
`CORPUS_JOB` once per claimed event, so it is always set for an agent's writes.
The parent edge therefore only ever fires for **human-created** threads.

Reviewer's scenario, which reproduces it:

> Ana's conversation `th_root` has a resident; her agent drafts `doc_draft`
> (`origin → th_root`). A person asks the orchestrator, in an ordinary
> undesignated thread `th_q`, to review the draft. The orchestrator's subagent
> runs `corpus thread create --parent doc_draft` with `CORPUS_JOB` set, so
> `th_c` gets `origin → th_q`, `parent → doc_draft`. A person replies in `th_c`
> with `@agent`. The walk goes `th_c → th_q → null → ORCHESTRATOR_LANE`.
> `doc_draft` is never visited.

Ana's resident, which wrote the draft, never hears about a conversation on it —
verbatim the failure §7 says the scope exists to prevent.

The failing test is four lines and `scope.test.ts` has no case like it: no
existing case has an origin chain that dead-ends while the parent chain does not.

### 2. The precedence itself is probably backwards for threads

`SHARED-044` recorded origin-first as adjudicated. **That adjudication was mine
and had no independent review** — the agent spawned for it died before reading
anything. PR #48's reviewer gave the second opinion and disagreed, with an
argument I find stronger than my own:

- §7 lists `origin` as a scope edge **only for documents**. For threads it gives
  two routes, neither of which is the thread's own origin. So the implementation
  either invented a third membership route and ranked it above both
  spec-sanctioned ones, or created the two-scope state §7 says cannot happen.
- **Origin-first has no beneficial case.** Enumerate the divergences: a
  standalone thread created by a job has no parent, so the precedence is moot; a
  thread whose parent is already in the writer's scope — both edges agree; a
  summons — §7 already reads lane and origin off different things so both agree.
  The *only* input where the answers differ is a thread an agent opened on
  another scope's document. That is exactly what §7's summons carve-out warns
  about: *"answering a question does not annex the thread it was asked in."*
- **Detaching is not a remedy here.** §7 offers `corpus doc detach` for a
  mis-filed document. An annexed *thread* has none, and the annexation is
  permanent — whereas the override §7 does sanction "never persists past the
  message it was set on."

## What to do

**Make the code match §7 as written**, which needs no amendment: for a thread,
follow the parent chain; `origin` is a scope edge for documents. And **the walk
must consider both edges** rather than committing to one — a dead end on one
does not mean the artifact is in no scope.

Do not amend SPEC.md here. If after implementing you believe the spec is what is
wrong, say so and it becomes a rider for the user to sign — `SHARED-044` is
already open for exactly that.

## Acceptance Criteria

- [x] The reviewer's four-line case passes: `th_c` with `parent → doc_draft`
      (in Ana's scope) and `origin → th_q` (undesignated) resolves to `th_root`
- [x] A dead-ending chain falls back rather than concluding "no scope"
- [x] The cycle guard still terminates, now that the walk may branch
- [x] Enumerate what the two edges can disagree about and **test each case**,
      rather than testing the one that prompted this
- [x] `provenance.ts`'s invariant is re-read against the change: it is about the
      document a job creates, and the comment should not be left implying more
- [x] `SHARED-044` updated to record that its adjudication was overturned on
      review, and by what argument

## Testing Strategy

Unit in `scope.test.ts`. Every new case checked red against the current walk.

## E2E Verification Log

**Model: fable (claude-fable-5).** Reproduced before any code was changed, on a
real `corpus init` workspace with a real server (port 8791; 8765 and 5173
untouched), driven through the CLI only.

### Reproduction (before the fix)

Built exactly the reviewer's scenario:

| artifact | how it was made | `parent` | `origin` |
| --- | --- | --- | --- |
| `th_lprcg63c` | `corpus thread create`, then `corpus thread designate --agent researcher` | — | — |
| `doc_h3um5vat` | `CORPUS_JOB=evt_sqnsinfwrtqr corpus doc create --from agent` | — | `th_lprcg63c` |
| `th_gecoorlv` | `corpus thread create` (ordinary, undesignated) | — | — |
| `th_bdtk2jg6` | `CORPUS_JOB=evt_3l6kpftmtfow corpus thread create --parent doc_h3um5vat --from agent` | `doc_h3um5vat` | `th_gecoorlv` |

The thread file on disk confirms both edges at once:

```
id: th_bdtk2jg6
parent: doc_h3um5vat
origin: th_gecoorlv
```

Then `corpus thread reply th_bdtk2jg6 --from user -m "@agent …"`, and the event
the server wrote to `.corpus/queue/pending/evt_vrmxwxf7vvfi.json`:

```json
  "payload": { "threadId": "th_bdtk2jg6", "parentId": "doc_h3um5vat", … },
  "lane": "orchestrator"
```

**`orchestrator`.** The resident that wrote the draft never hears about the
conversation on it — verbatim the failure §7 says the scope exists to prevent.

Unit-level, before the fix: 5 of the 11 newly enumerated cases in
`scope.test.ts` fail against the old walk (`keeps a thread with the scope of the
document it hangs on`, `reaches the resident when the origin chain dead-ends…`,
`treats a missing origin as a dead branch…`, `prefers a distant parent chain…`,
`escapes a cycle on the origin branch…`). The other 6 pass today and exist to
stop the branching walk regressing into an abort-on-dead-end or a
non-terminating branch.

### After the fix

Same workspace, server stopped and restarted so it ran the new code, same reply
verb:

```json
  "id": "evt_ha4ivkdtxree",
  "payload": { "threadId": "th_bdtk2jg6", "parentId": "doc_h3um5vat", … },
  "lane": "th_lprcg63c"
```

and the resident's own scoped claim picks it up —
`corpus queue claim-all --thread th_lprcg63c` returns
`{"events":[{"id":"evt_ha4ivkdtxree", …}]}` — so the routing reaches an actual
consumer, not just the stamp.

**The annexation half, also live.** `th_gecoorlv` (the job's own conversation)
was then designated too, so `th_bdtk2jg6`'s two edges reach two *different*
live scopes. A third reply enqueued `evt_jxr5snputkmd` with
`"lane": "th_lprcg63c"` — the host document's scope, not the job's. Under the old
precedence this is exactly the event that would have been annexed.

### Checks

- `vitest run apps/server` — **191 files, 4015 tests, all passing** (exit 0).
- `tsc --noEmit` in `apps/server` — exit 0 (read from the exit code, not from
  the proxy's output line).
- `eslint` + `prettier --check` on every touched file — clean, no suppressions.
- Server stopped and its workspace removed; port 8791 released.

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-117]` prefix
