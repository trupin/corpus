# [UI-119] The client's scope walk still follows the rule SERVER-117 deleted

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Related: SERVER-117 (which changed the server's walk), UI-118 (which turned
  the label into a routing decision), SHARED-044

## Spec References

- SPEC.md **§7** — the scope of a designated thread; *"answering a question does
  not annex the thread it was asked in"*

## Summary

`SERVER-117` rewrote the server's walk as a parent-first DFS over both edges.
**`packages/kit/src/recipient/scopeWalk.ts` was not moved with it** and still
runs the code that was deleted:

```ts
current = node.origin ?? node.parent;   // single chain, no fallback
```

This is an orchestration failure, not a domain one: `SERVER-117` and `UI-118`
ran in parallel and neither was told the other existed.

**It was a label bug until `UI-118`, and is now a routing bug.** Before, an
explicit pick equal to the computed lane was dropped, so the server always
recomputed. `UI-118` made a pick reach the wire — correctly — and
`apps/server/src/queue/lanes.ts:147` returns `input.recipient` verbatim. So:

> `th_c` has `parent → doc_draft` (whose origin reaches Ana's designated
> `th_root`) and `origin → th_q` (undesignated). The client walks
> `th_c → th_q → null → orchestrator` and the composer says **"Orchestrator will
> answer"**. The person reads that, presses the Orchestrator row to confirm it —
> which is now a real pick — and `{recipient: "orchestrator"}` goes on the wire.
> Ana never hears about the conversation on the draft she wrote.

The annexation half is worse, because it names a wrong agent rather than a wrong
fallback: `th_opened` with `parent → doc_theirs` (Bo) and `origin → th_mine`
(Ana) — the client says Ana, the server would have routed Bo.

## The part that should change how this is tested

**The suite certifies the drift, green, in both directions:**

- `packages/kit/src/recipient/scopeWalk.test.ts:73` — *"follows origin before
  parent, **as the enqueue walk does**"* → expects `th_origin`
- `apps/server/src/queue/scope.test.ts` — *"keeps a thread with the scope of the
  document it hangs on, not the job that opened it"* → expects the parent

Each file asserts it encodes the other's rule, and they disagree. Two green
suites is exactly why nobody noticed.

## Acceptance Criteria

- [x] The client's walk matches the server's: parent first, both edges, dead
      branch is not an abort. Match `apps/server/src/queue/scope.ts` edge for
      edge and say where you checked it
- [x] `scopeWalk.test.ts:73` and every sibling asserting the old order are
      **rewritten, not deleted** — the cases are right, the expectations are not
- [x] `scopeWalk.ts:34-37` still states the old rule in prose (*"The two edges,
      and the order, are the server's: `origin ?? parent`"*). `UI-118` corrected
      two false docblocks in this file and left the one that states the rule.
      Fix it, and consider what else in the file is now describing a dead design
- [x] **Something must fail when these two walks diverge again.** A comment
      asking the next person to remember is what produced this. Options worth
      weighing: publish the walk from one place both consume; or a test that
      runs the same case table through both and asserts they agree. Say which
      you chose and why the other was not possible
- [x] The client's `MAX_SCOPE_WALK` bound is re-examined: the server's walk is
      unbounded and now covers a reachable closure rather than a chain, so a
      bound of 8 is a second way to disagree

## What was done

**There is now one walk.** `packages/contract/src/scope.ts` exports `walkScope`
— the traversal, and nothing else. `apps/server/src/queue/scope.ts` keeps the
payload→start resolution and the projection read; `packages/kit`'s
`scopeWalk.ts` keeps the board's node lookup. Neither holds a traversal any
more, so there is nothing left that *can* diverge.

The parity-test option (`scripts/stub-server-parity.test.ts`'s pattern) was not
available: no workspace here may import `apps/server` **and** `packages/kit`,
and that file's own docblock names the direction taken instead — *"a rule that
becomes shared code should lose its fixture"*.

`MAX_SCOPE_WALK` moved to `useScopeWalk.ts` and became a **read budget**, 8 → 32.
The walk is unbounded, as the server's is. Exhausting the budget stops the
*fetches*, so the walk keeps answering `unread` and the composer says *unknown*
— never `orchestrator`, which is the claim the old bound made at exhaustion.

The lookup gained a third value. `SCOPE_NODE_ABSENT` (a settled `404`) is a dead
branch, as a projection miss is; `undefined` is still *not read yet* and
withholds. Before, a dangling `origin` stranded the walk on a node it would
never read, where the server simply walked past it.

## Testing Strategy

Port the server's enumeration table wholesale — `scope.test.ts` has ten cases
covering both-agree, parent-wins, each dead-end, missing rows, cycles on each
branch, diamond convergence and distant-parent-over-near-origin. Every case
checked red against the current client walk before trusting it.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`), 2026-08-17.

Real workspace at `/tmp/ui119-ws` (`corpus init`), real server on `:8843`, real
Vite dev server on `:5291` proxying it, real Chromium via Playwright. Never
`:8765`, never `:5173`.

The corpus, hand-written as four files (§5 makes the files the source of truth):

| id           | type   | `parent`     | `origin`  | `resident` |
| ------------ | ------ | ------------ | --------- | ---------- |
| `th_root`    | thread | —            | —         | **Ana**    |
| `doc_draft`  | note   | —            | `th_root` | —          |
| `th_q`       | thread | —            | —         | —          |
| `th_c`       | thread | `doc_draft`  | `th_q`    | —          |

`GET /api/agents` confirmed `th_root` as the only designated lane.

### Reproduction (before the fix)

- **Server**: `corpus thread reply th_c --message "@agent …"` →
  `.corpus/queue/pending/evt_rh6dleryqol4.json` carries `"lane": "th_root"`.
- **Browser**: opened `th_c` in the reader. The composer read
  **`agent will answer — no listener yet (default here)`**, with
  `[data-recipient-lane="orchestrator"]` at `data-recipient-default="true"`,
  `aria-pressed="true"`, and `th_root` (Ana) at `data-recipient-default="false"`.

So the composer named the orchestrator for a conversation the server routes to
Ana. Since UI-118 the confirming press on that row is a real pick, and
`queue/lanes.ts:147` returns it verbatim.

The annexation half, added as three more files (`th_bo` resident **Bo**,
`doc_theirs` origin `th_bo`, `th_opened` parent `doc_theirs` + origin `th_root`):
the old walk names **Ana** for a conversation on Bo's note; the server enqueued
`evt_5jqkgwjhulme` with `"lane": "th_bo"`.

### Verification (after the fix)

Same server, same corpus, kit's `dist/` rebuilt, page reloaded:

- `th_c` composer: **`Ana will answer — no listener yet (default here)`**;
  `th_root` is `data-recipient-default="true"` / `aria-pressed="true"`,
  orchestrator is `false`. Matches `evt_rh6dleryqol4`'s `lane: th_root`.
- `th_opened` composer: **`Bo will answer`**, `th_bo` default. Matches
  `evt_5jqkgwjhulme`'s `lane: th_bo` — the annexation is gone.
- **The pick, end to end**: pressed the default row in `th_c`'s picker and sent.
  The request Playwright observed was
  `POST /api/threads/th_c/turns {"body":…,"requestsAgent":true,"recipient":"th_root"}`,
  and the server enqueued `evt_fujeqra4lavc` with `"lane": "th_root"`. Before the
  fix the identical gesture would have put `"recipient":"orchestrator"` on the
  wire.

### Falsification

- The old client walk (`origin ?? parent`, bound 8, absent≡unread) spliced back
  into `walkToLane`: **6 of 18** cases in `scopeWalk.test.ts` fail, including
  *"follows parent before origin"*, the fetch-order case, the deep-chain case and
  all three absent cases. Restored, green.
- The pre-SERVER-117 chain spliced into `walkScope`: **6 of 26** cases in
  `packages/contract/src/scope.test.ts` fail — the annexation case, the
  dead-end-origin case, the missing-origin case, the distant-parent case, the
  origin-branch cycle, and the parent-first fetch-order case. Restored, green.
- The survivors in both runs are the both-edges-agree shapes, which are in the
  table precisely to pin the agreement.

### Checks

`npm run build -w packages/contract -w packages/kit`; `tsc --noEmit` in
contract/kit/server/ui; `eslint` + `prettier --check` on every touched file;
`vitest run packages/kit packages/contract apps/ui/src/recipient
apps/server/src/queue` → 3765 passed; `vitest run plugins
scripts/stub-server-parity.test.ts` → 540 passed.

Processes started (server pid 78894, vite pid 80215) were stopped and `:8843` /
`:5291` verified free.

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-119]` prefix
