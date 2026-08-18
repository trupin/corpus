# [CLI-049] `corpus thread designate` without naming an agent

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-061, SERVER-121
- Blocks: AGENT-033

## Spec References

- SPEC.md **§7** — the SHARED-048 rider

## Summary

`corpus thread designate <id> --agent <name>` requires `--agent`. Make it
optional, so the CLI can put a general resident on a conversation — the same act
the UI will offer and the same act the converse skill's launch depends on.

## Acceptance Criteria

- [x] `corpus thread designate <th_…>` with no `--agent` designates a general
      resident and reports what it did in a way that distinguishes it from a
      profiled designation
- [x] `--agent <name>` is unchanged, including the `404` for a name that
      resolves to nothing
- [x] `--agent ""` is refused rather than treated as absence — a blank name is a
      mistake, not a request for a general resident
- [x] `--json` carries the resident shape CONTRACT-061 defined, with no
      hand-rolled restatement of it
- [x] `corpus agents` lists a general-resident lane legibly — a reader can tell
      "this conversation has an agent with no profile" from "this conversation
      has profile X"
- [x] The help text says when you would want each, in one line, without
      restating §7

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/designate.ts` — the flag and the call
- the `corpus agents` renderer — the general-resident row

### Key Implementation Details

The command is a thin client (architecture decision 2): it sends the shape the
contract defines and renders what comes back. **It does not decide what a
general resident is** — if rendering needs a word for one, take it from the
contract's field rather than inventing a CLI-local vocabulary, or the CLI and
the UI will come to call the same thing two things.

`designate.ts:69` currently documents the name's resolution at length. Update it
for the optional case, and keep the existing rule that the CLI does not repeat
the server's lookup.

### Edge Cases

- A thread with a parent — the server's refusal, rendered verbatim
- Re-designating from profiled to general and back
- Exit codes unchanged from today's refusals

## Testing Strategy

Command tests against a stubbed client for: no flag, flag given, blank flag,
each refusal, and both `--json` shapes. Renderer tests for `corpus agents` with
a mixed roster (orchestrator, a general lane, a profiled lane).

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus thread create`, then `corpus thread designate <id>` with no `--agent`
3. `corpus agents` shows the lane; the thread markdown on disk shows it
4. `corpus thread designate <id> --agent <name>` replaces it; `corpus agents`
   shows the profile
5. `corpus thread release <id>`; the lane leaves
6. Stop the server; confirm the port is free

## E2E Verification Log

Model: **opus** (claude-opus-5[1m]).

Real `corpus` binary (`apps/cli/dist/bin/corpus.js`, built), real server on port
**8842**, throwaway workspace at
`~/.claude/jobs/4dd0ddef/tmp/cli049` (removed afterwards). Every line below is
verbatim.

**Scope note.** The issue named one broken call site; there were two under
`tsc` (`thread/designate.ts`, `agents.ts`) and two more that type-checked while
printing the literal string `null` (`thread/show.ts`, `thread/release.ts` both
interpolated `resident.name`/`docId` raw). All four now render through one
shared label, `src/commands/resident.ts`.

```
$ corpus init cli049 --port 8842
Initialized Corpus workspace at …/cli049
$ corpus server start
corpus 0.10.0 listening on http://127.0.0.1:8842 (pid 8391)

$ corpus thread create --title "Kitchen rebuild" -m "Where do we start?"
created th_umvcyswu — standalone

# 1. no --agent: a general resident, and it says so
$ corpus thread designate th_umvcyswu
designated a general resident on th_umvcyswu           (exit 0)
$ corpus agents
orchestrator · waiting for a listener
th_umvcyswu "Kitchen rebuild" · a general resident · waiting for a listener
$ corpus thread show th_umvcyswu | sed -n 4p
resident a general resident
$ corpus thread designate th_umvcyswu --json
{"thread":{…,"resident":{"name":null,"docId":null}},"warnings":[]}
$ sed -n '12,14p' data/threads/*.md
resident:
  name: null
  docId: null
```

The `POST` carried **no body at all** (asserted in `designate.test.ts`), which
is how CONTRACT-061 spells absence.

```
# 2. --agent unchanged, resolution still reported
$ corpus doc create --title "Researcher" --type agent-def -m "…"
created doc_helf2x7t — .claude/agents/researcher.md
$ corpus thread designate th_umvcyswu --agent RESEARCHER
designated researcher (doc_helf2x7t) on th_umvcyswu     (exit 0)
$ corpus agents
th_umvcyswu "Kitchen rebuild" · researcher (doc_helf2x7t) · waiting for a listener

# 3. the third state: profile deleted, designation stands
$ corpus doc delete doc_helf2x7t --yes
deleted doc_helf2x7t
$ corpus agents
th_umvcyswu "Kitchen rebuild" · researcher (profile missing) · waiting for a listener
$ corpus thread show th_umvcyswu --json | jq .resident
{"name":"researcher","docId":null}
```

Three lanes, three distinct cells: `a general resident`, `researcher (doc_r1)`,
`researcher (profile missing)`. A general resident never occupies the position a
profile name does — it has no parenthesis at all, which is what `schemas/agents.ts`
asks for (it must not be printable as a name).

```
# 4. refusals — exit codes unchanged from today's
$ corpus thread designate th_umvcyswu --agent ""
corpus: --agent was given without an agent name.
  Name the profile to make resident — `--agent researcher` — or leave the flag
  out entirely to designate a general resident, an agent with no profile. A
  blank is neither of those, and nothing was sent to the server.   (exit 2)
$ corpus thread designate th_umvcyswu --agent "   "                (exit 2)
$ corpus thread designate th_umvcyswu --agent nobody
corpus: 404 not_found: no agent named nobody in this workspace …   (exit 5)
$ corpus thread designate th_umvcyswu --from agent
corpus: 403 forbidden: designating a resident is user-only …       (exit 5)
$ corpus thread designate th_w7ydvtiq            # anchored thread
corpus: 409 conflict: only a standalone thread may have a resident … (exit 5)

# 5. profiled → general → released
$ corpus thread designate th_umvcyswu
designated a general resident on th_umvcyswu
$ corpus thread release th_umvcyswu
released a general resident from th_umvcyswu                       (exit 0)
$ corpus agents
orchestrator · waiting for a listener

$ corpus server stop
stopped (pid 8391)
$ lsof -ti :8842 || echo free
free
```

**Checks.** `npm run build` exit 0 (it was red at exactly these two files before
this change, and nowhere else); `tsc --noEmit -p apps/cli` exit 0; `eslint` and
`prettier` clean on every touched file; `vitest run apps/cli` — **93 files, 1533
tests, all passing**. `docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`
(never hand-edited).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-049]` prefix
