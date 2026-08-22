# [PLUGINS-004] Todos `mutateItems` uses the atomic mutate seam (lost-update fix)

## Domain
plugins

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-034 (seam implemented), CONTRACT-019 (seam typed)
- Blocks: —

## Spec References
- SPEC.md §12 — todos plugin behavior
- SPEC.md §12 — plugins write only through the core write path

## Summary
PR #11 review (finding 2, MAJOR): `mutateItems`
(`plugins/todos/server/routes.ts:87-116`) is a non-atomic read-modify-write —
`context.getDoc` (line 93) runs outside the document mutex; only the write serializes,
and each write carries a whole `items` array computed from a possibly stale read.
A user toggling checkbox 1 then checkbox 2 inside the first write's git-commit window
(the list deliberately stays interactive while `busy`) lets request B read pre-A state,
pass its per-item `expectedText` guard, and silently revert A's toggle after A returned
200. Same interleaving is reachable agent-CLI vs. browser. Port `mutateItems` to the
atomic seam CONTRACT-019/SERVER-034 add.

## Acceptance Criteria
- [x] `mutateItems` performs its type check, `readItems` parse, `apply`, and write inside a single `context.mutateDoc(...)` (or the seam's final name) call — no `getDoc` outside the lane
- [x] `TodoItemError` thrown inside the callback (wrong type, malformed items, per-item guard failure) propagates to the route with its status, exactly as today
- [x] `broadcastInvalidate` still fires only after a successful write, with the same keys
- [x] Lost-update regression test: two interleaved item mutations against one list — the second observes the first's result; final frontmatter holds both changes (deterministic interleaving)
- [x] Existing todos route tests and CLI/browser parity tests stay green unchanged (or updated only where they stubbed `getDoc`/`updateDoc` and now stub the seam)

## Technical Design

### Files to Create/Modify
- `plugins/todos/server/routes.ts` — port `mutateItems`
- colocated tests

### Key Implementation Details
The refactor should be shape-preserving: everything currently between the `getDoc` and
`updateDoc` calls moves into the seam's callback. Keep the "refuse malformed items
rather than overwrite" behavior — it's the point of the parse (routes.ts:100-108).

### Edge Cases
- Doc deleted mid-flight → the seam's not-found surfaces with the same route behavior as today.

## Testing Strategy
plugins/todos scoped tests (VITEST_MAX_THREADS=4): interleaving regression, error-propagation parity, invalidation keys unchanged.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Real server + scratch workspace (explicit --workspace, ports 9180+), todos list with ≥2 items
2. Fire two toggle requests so the second dispatches inside the first's commit window (two quick browser clicks, or curl with the bearer token)
3. Expected: both toggles persist. Actual (pre-fix): second write reverts the first.

### Verification Steps
1. Restart after the fix; repeat step 2 — both toggles persist in the file's frontmatter and the UI
2. `corpus todos` CLI verbs still round-trip

## E2E Verification Log

Implemented on: **opus** (plugins-dev).

### 1. Pre-fix reproduction — real server, real plugin (LOST UPDATE CONFIRMED)

Scratch workspace `…/tmp/prefix-ws`, `corpus init . --port 9181`, `corpus server start`
(pid 84905). The plugin's compiled `dist/server/routes.js` was still the pre-fix build
(`grep -c mutateDoc dist/server/routes.js` → `0`), and discovery prefers `dist/` over
source, so the running server was executing the `getDoc` → `updateDoc` pair.

`corpus doc create --type todo --title 'Race list'` → `doc_evyazmuk`. Three concurrent
`POST /api/x/todos/doc_evyazmuk/items` (separate curl processes):

```
201 {"docId":"doc_evyazmuk","index":0,"item":{"text":"alpha",...}}
201 {"docId":"doc_evyazmuk","index":0,"item":{"text":"bravo",...}}   ← index 0 twice
201 {"docId":"doc_evyazmuk","index":1,"item":{"text":"charlie",...}}
```

`data/docs/inbox/race-list.md` frontmatter held **2 items** (`alpha`, `charlie`) —
`bravo` was written and then reverted, after its own request had already answered 201.

Repeated warm on a second document (`doc_ttmfqixq`, four concurrent appends via one
Node process, so genuinely simultaneous):

```
201 … "index":0 "text":"a1"
201 … "index":1 "text":"a2"
201 … "index":1 "text":"a3"     ← three responses claiming index 1
201 … "index":1 "text":"a4"
```

On disk: **2 of 4 items** (`a1`, `a4`). `a2` and `a3` silently lost. This is PR #11
review finding 2, reproduced end to end.

(Two concurrent *toggles* did **not** reproduce on this machine across 5 rounds — the
commit window happened to close before the second read. The window is timing-dependent
in production but not in the unit harness, which is why the deterministic regression
lives there; see §2.)

Server stopped (`stopped (pid 84905)`), port 9181 free, `/Users/theophanerupin/code/corpus/.corpus` absent.

### 2. Deterministic reproduction at test level

`plugins/todos/server/routes.test.ts` — the fake context now models the two production
properties that make the race reachable: writes to one document serialize in a lane, and
a write stays open across a macrotask (the git-commit window). Run against the **pre-fix**
`mutateItems` (temporarily restored, then reverted), the three new interleaving tests fail
exactly as the bug describes:

```
× keeps both toggles when a second dispatches inside the first's write window
    expected [ false, true, true ] to deeply equal [ true, true, true ]
× lands every one of four concurrent appends, each at its own index
    expected [ 0, 0, 0, 0 ] to deeply equal [ 0, 1, 2, 3 ]
× never resurrects a deleted item through a toggle that raced the delete
    expected [ 200, 200 ] to deeply equal [ 200, 409 ]
```

The fourth test in that block ("two different lists stay independent") passes before and
after — it is the non-regression guard that the lane is per-document, not global.

### 3. Post-fix verification — real server, real plugin

`npm run build -w corpus-plugin-todos` (`grep -c mutateDoc dist/server/routes.js` → `4`).
Fresh workspace `…/tmp/postfix-ws`, port 9182, pid 90392, `doc_ljnbt7vx`.

**Four concurrent appends** — the drill that lost two items pre-fix:

```
201 … "index":0 "text":"a1"
201 … "index":1 "text":"a2"
201 … "index":2 "text":"a3"
201 … "index":3 "text":"a4"
```
All four in frontmatter, in order, distinct indices.

**Four concurrent toggles** (`PUT /items/0..3 {"done":true}`): all `200`,
`grep -c 'done: true'` → `4`.

**Concurrent delete + toggle** (`DELETE /items/0 expectedText=a1` ‖
`PUT /items/1 {"done":false} expectedText=a2`):

```
DELETE /items/0 -> 200 {"removed":{"text":"a1",...}}
PUT    /items/1 -> 409 {"code":"conflict","message":"item 1 is now “a3”, not “a2” — it changed under you; nothing was written"}
```
`a1` stays deleted; the guard fires *because* the toggle read post-delete state. This is
also the live proof that `TodoItemError` still propagates unwrapped through the seam and
reaches the plugin's own status mapping (`plugins/todos/server/errors.ts`).

**Error parity, all through the mounted sub-app:**

| case | result |
| --- | --- |
| unknown document | `404 {"code":"not_found","message":"no document with id doc_missing"}` |
| `type: note` document | `400 {"code":"bad_request","message":"doc_5bxe63ve is a note document, not a todo list"}` |
| out-of-range index | `400 {"code":"bad_request","message":"item index 99 is out of range — this list has 4 items"}` |
| agent holds the edit lock (`corpus lock acquire … --from agent`) | `423 {"code":"locked","message":"doc_ljnbt7vx is being edited by agent; the lock was acquired at …"}`, item count unchanged |
| after `lock release` | `201`, write lands |

**Invalidation keys unchanged, and only on success.** `GET /events` during one successful
append plus one 409:

```
data: {"keys":[["docs"],["docs","doc_ljnbt7vx"]]}
data: {"keys":[["x","todos","lists"],["x","todos","lists","doc_ljnbt7vx"]]}
```
Two frames total — the core write path's own, then the plugin's `x/todos/lists…` pair.
The 409 broadcast nothing.

**CLI round-trip** (`corpus todos …`, unchanged and untouched):

```
$ corpus todos list                                        → Race list [doc_ljnbt7vx] — 0 open · 3 done
$ corpus todos add doc_ljnbt7vx 'from the CLI' --due 2026-08-15
                                                           → added item 4 to Race list …
$ corpus todos check doc_ljnbt7vx 'from the CLI'           → checked item 4 of Race list …
$ corpus todos list                                        → Race list [doc_ljnbt7vx] — 0 open · 4 done
```
Frontmatter carries the new item with its `due: 2026-08-15`.

Server stopped (`stopped (pid 90392)`), ports 9181/9182 free, no vitest workers left,
`/Users/theophanerupin/code/corpus/.corpus` absent after every drill.

### 4. Checks

- `VITEST_MAX_THREADS=4 vitest run plugins/todos` → **10 files, 199 tests passed** (was 195).
- `npm run lint` → clean.
- `npm run typecheck` → clean across **all** workspaces; the known TS2741 on
  `routes.test.ts:78` (fake context missing `mutateDoc`) is gone, so the
  CONTRACT-019 / SERVER-034 / PLUGINS-004 trio now typechecks as a whole.
- `npm run format:check` → one pre-existing warning on `.claude/agents/server-dev.md`,
  untouched by this issue and outside this domain; not fixed here.
- The SPEC §12/M5 plugin-deletion drill was **not** re-run: this change touches no
  discovery code path, only the body of one route helper.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
