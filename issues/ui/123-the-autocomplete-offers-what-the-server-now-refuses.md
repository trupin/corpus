# [UI-123] The autocomplete offers what the server now refuses

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-125
- Blocks: — (but v0.12.0 must not ship without it)
- Related: UI-122 (the designate menu), AGENT-036

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root
- SPEC.md **§8** — `@<subagent-name>` is a directive routed to that persona
- SPEC.md **§11** line 539 — the `@` autocomplete, backed by `GET /api/docs`

## Summary

SERVER-125 stopped indexing an off-root `type: agent-def` (and `type: skill`)
document as a mention target. `targetIndex` now skips any row whose
`invocableName` is null, the title alias included. That is the right call and its
reasoning is in that issue.

**It leaves both client surfaces one release behind the server.** The client
never asked the server what resolves. It computes the same two aliases again,
independently, in two places:

| Surface | The code | What it does now |
| --- | --- | --- |
| `@` autocomplete | `packages/kit/src/components/Autocomplete/useAutocomplete.ts:63` — `invocableName(row.path) ?? row.title` | Offers an off-root agent-def under its title. Picking it inserts a mention the server resolves to nothing |
| Designate menu | `apps/ui/src/thread/residentActions.ts:92` — `name: row.title.trim()` | Offers an off-root agent-def. Designating it now gets a 404 that SERVER-125 rewrote to name the file |

**This is a regression that SERVER-125 introduced**, not pre-existing debt. Before
it, both surfaces were right: the title alias did resolve. The server changed and
the clients did not.

SERVER-125's own acceptance criterion states the standard: *"The autocomplete and
the resolver must agree: offering what will not resolve is worse than either."*
That criterion is not met until this issue lands, which is why this is P0 and in
v0.12.0 rather than filed for later.

## What must not break

**`GET /api/docs?type=agent-def` must keep returning every agent-def.** The
board's `type:` filter and the seeded "Skills & agents" view both read that
endpoint, and a document about a persona is a legitimate document that must stay
listed, readable and editable. **The filter belongs in the client, at the point
where a row becomes an offer** — not in the query.

That is the same shape SERVER-125 chose: the document stays, and only its
addressability goes.

## Acceptance Criteria

- [x] The `@` autocomplete offers an agent-def only when `invocableName(row.path)`
      is non-null, and offers it under that name
- [x] The designate menu offers the same set, by the same rule
- [x] A row dropped from the offers is still listed by the board and still
      readable and editable — nothing about the document changes, only whether it
      is offered
- [x] `type: skill` rows follow the identical rule, because SERVER-125 gated both
- [x] **The kit and the UI do not each grow a third copy of this rule.** One
      exported predicate, used by both surfaces
- [x] A test proves client and server agree on the same row: the same off-root
      fixture is absent from the offers and unresolved by the server

## Technical Design

### Files to Create/Modify

- `packages/kit/src/components/Autocomplete/useAutocomplete.ts` — `rowToken`
- `apps/ui/src/thread/residentActions.ts` — the designate list
- `packages/kit/src/index.ts` — the export, if the predicate is new
- Tests beside each

### Key Implementation Details

`invocableName` already lives in the kit and already returns null off-root. The
change is to stop falling back to the title, and to drop the row instead.

**Read `residentActions.ts:80-92` before editing it.** Its docblock explains that
the title is a *spelling* and not an identity, and that the server stores the name
it resolved to. That reasoning stays true. What changes is which rows are offered
at all, not how a designation is spelled.

**`useWeightLevels.ts:109` also calls `invocableName`** and is not part of this
bug — it looks up the orchestrate skill by its invocable name, which is exactly
right. Do not change it.

### Edge Cases

- An on-root agent-def whose title differs from its file stem. This is the
  **common** case since SERVER-122, and it must keep working. Designation sends
  the title today and the server resolves it
- An agent-def with a blank title, already dropped by `residentActions`
- An archived agent-def
- A `type: skill` document under `data/docs/`, which is a document *about* a
  skill

## Testing Strategy

Unit tests on both surfaces with an on-root and an off-root fixture. The pair
that matters asserts the client's offer set and the server's resolution agree on
the same fixture, so the two cannot drift apart again silently.

Falsify by restoring the `?? row.title` fallback and confirming the off-root
cases go red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Create an on-root agent-def and an off-root one with a one-word title
3. In a real thread composer, type `@` — only the on-root persona is offered
4. Open the designate menu — same set
5. Confirm the off-root document is still listed on the board and still opens
6. Stop the server; confirm the port is free

## E2E Verification Log

**Model: Opus 5 (1M context).** Date: 2026-08-18.

### The change

One exported rule, in a new dependency-free kit module
`packages/kit/src/components/Autocomplete/invocable.ts`: `invocableName`,
`rowToken` (now `string | null` — the `?? row.title` fallback is gone) and
`isAddressableTarget`, the predicate both offer surfaces apply. The `@` / `/`
menu drops a row with no token (`useAutocomplete.ts`'s `toItem` returns `null`);
the designate menu filters with `isAddressableTarget` and still *sends* the
title, which the server still resolves for an addressable row. No query changed.

### 1. Reproduction, in the real app (this is a regression)

Throwaway workspace `/tmp/corpus-ui123`, real server on **8793** (never 8765 —
the user's live server was left running and untouched — and never 5173, which
holds an ssh tunnel; Vite dev on **5273**). Real Chromium via Playwright against
`http://localhost:5273`.

```
$ corpus init /tmp/corpus-ui123 --port 8793
Initialized Corpus workspace at /tmp/corpus-ui123
$ corpus server start --workspace /tmp/corpus-ui123
corpus 0.11.0 listening on http://127.0.0.1:8793 (pid 20923)
$ corpus doc create --type agent-def --title "Researcher"
created doc_mb55mqui — .claude/agents/researcher.md
$ corpus doc create --type agent-def --title "Legacy" --folder data/docs/inbox
created doc_ulkvkk5q — data/docs/inbox/legacy.md
$ corpus thread create --title "Q3 planning" -m "Where did the forecast land?"
created th_nggtvvlz — standalone
```

With the `?? row.title` fallback restored in the kit (and `packages/kit/dist`
rebuilt, or the page keeps running the old copy):

```
`@` menu offers: ["agent — …", "Legacy — Legacy", "researcher — Researcher"]
  "@leg" -> ["Legacy"]   (menu open: true)
designate menu:
  resident-designate-general      :: Designate a resident
  resident-designate-doc_ulkvkk5q :: Designate Legacy
  resident-designate-doc_mb55mqui :: Designate Researcher
```

…and what the server does with that offer, on the same workspace:

```
$ curl -X POST …/api/threads/th_nggtvvlz/resident -d '{"name":"Legacy"}'
404 {"code":"not_found","message":"no agent named Legacy in this workspace —
 data/docs/inbox/legacy.md declares `type: agent-def` but is not under
 `.claude/agents/`, so nothing loads it as a subagent and nothing resolves
 `@Legacy` to it; a persona has to live in that root"}
```

Both surfaces offered a designation the server answers with a `404`.

### 2. After the fix, same workspace, same browser

```
rows on board:
  doc_ulkvkk5q :: agent-def Legacy inbox/ just now      ← still listed
  th_nggtvvlz  :: thread Q3 planning …
reader opened, title: Legacy                             ← still readable
`@` menu offers: ["agent — the agent — routing is its own triage",
                  "researcher — Researcher"]
  "@res" -> ["researcher"] (menu open: true)
  "@leg" -> []             (menu open: false)
designate menu:
  resident-designate-general      :: Designate a resident
  resident-designate-doc_mb55mqui :: Designate Researcher
```

Screenshots taken during the run: `/tmp/ui123-mention.png`,
`/tmp/ui123-designate.png` (throwaway, not committed).

### 3. The endpoint that must not change

```
$ curl …/api/docs?type=agent-def
total: 2
  doc_ulkvkk5q | Legacy     | data/docs/inbox/legacy.md
  doc_mb55mqui | Researcher | .claude/agents/researcher.md
```

Both rows still returned; the filter is in the client, at the point a row becomes
an offer. And the on-root persona still designates by its **title**:

```
$ curl -X POST …/resident -d '{"name":"Researcher"}'
200 {"thread":{…,"resident":{"name":"researcher","docId":"doc_mb55mqui"}}}
```

### 4. Automated tests

- `vitest run packages/kit` — **56 files, 885 tests, all pass**
- `vitest run apps/ui` — **148 files, 3143 tests, all pass**
  (`npm test -w <ws>` is not available: there is one root vitest config and no
  per-workspace `test` script)
- `vitest run scripts/mention-offer-parity.test.ts` — **11 tests, pass**
- `npm run lint` — clean. `npm run typecheck` — clean (all workspaces + `scripts`)
- `playwright test e2e/resident.spec.ts e2e/autocomplete-keys.spec.ts`
  (`CORPUS_UI_PORT=5273`) — **15 passed**, including the new
  `resident.spec.ts:254 › lists a document about a persona, and offers it in
  neither menu`

### 5. Falsification

Restored `invocableName(row.path) ?? row.title` in `invocable.ts` and rebuilt
`packages/kit/dist` (a source-only mutation cannot falsify anything that
resolves the kit through its `exports` map). **11 tests went red**, across all
three surfaces:

```
× scripts/mention-offer-parity.test.ts › holds rows on both sides of the gate…
× scripts/mention-offer-parity.test.ts › a mention … resolves on the server…
× scripts/mention-offer-parity.test.ts › an invocation … resolves on the server…
× scripts/mention-offer-parity.test.ts › a mention row the menu drops › resolves
    under no spelling at all, its title included
× scripts/mention-offer-parity.test.ts › an invocation row the menu drops › …
× scripts/mention-offer-parity.test.ts › the board's designate menu › offers only
    names a designation resolves…
× scripts/mention-offer-parity.test.ts › … does not offer the document about a
    persona, which the server refuses
× apps/ui … agentDefRows › does not offer a document *about* a persona…
× apps/ui … agentDefRows › drops the row without touching the list it came from
× packages/kit … useAutocomplete › does not offer an agent-def the server would
    resolve to nothing
× packages/kit … useAutocomplete › does not offer a document *about* a skill as
    an invocable one
```

The first pass of `invocable.test.ts` **survived** the mutation — its fixtures
carried no `title`, so `?? row.title` had nothing to fall back to and the test
could not tell the fix from the bug. It was rewritten onto `docRowFixture` rows
that carry titles and re-run under the mutation: **4 more failures**
(`rowToken › has no token for an off-root row…` and three `isAddressableTarget`
cases). Mutation reverted, `dist` rebuilt, all green again.

### 6. Teardown

Server stopped (`stopped (pid 20923)`), Vite killed, `/tmp/corpus-ui123` removed.
Ports 5273 and 8793 confirmed free; **8765 left listening — the user's server,
never touched**. No stray vitest/playwright/chromium/vite processes remain.

### Notes for the orchestrator

- **`packages/kit`'s public surface changed**: `rowToken` now returns
  `string | null` (was `string`), and `isAddressableTarget` is a new export.
  Nothing outside the kit called `rowToken`, and no plugin imports either, so no
  consumer breaks — but it is a kit-export change and is recorded here.
- **Two fixtures were wrong rather than the code**: `apps/ui/e2e/resident.spec.ts`
  seeded its one profile at `data/docs/agents/researcher.md`, and
  `ComposeOverlay` / `ThreadPanel` unit fixtures used `docRowFixture`'s default
  `data/docs/…` path for agent-defs. Those are paths the server no longer
  addresses, so they were moved under `.claude/agents/`.
- **`apps/ui/e2e/stubCorpus.ts` was one release behind too**: its
  `POST /resident` handler still applied the title alias to off-root rows, so a
  spec could have certified a designation the real server refuses. It now applies
  SERVER-125's gate, and its `AGENT_DEF_STEM` no longer matches a nested path
  (the server's agents root is `markdown-flat`).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-123]` prefix
