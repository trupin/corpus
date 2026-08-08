# [CLI-032] `corpus doc list` cannot ask for top-level documents only

## Domain

cli

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-042, SERVER-073
- Blocks: —

## Spec References

- SPEC.md §2.2 rule 4 — CLI verbs are thin typed-client calls
- SPEC.md §9.2 — the filter set

## Summary

The agent-facing half of the user's `isParent` request. `apps/cli/src/commands/filters.ts`
mirrors the collection query's filters as flags (`--parent` at L112/L202), and
`doc list` documents which of them are thread-only (L137). A filter the agent
cannot pass is a filter the agent cannot use, and the retrieval rules lean on
`doc list` heavily.

P2 rather than P1: the board is what the user asked for, and the CLI can follow.

## Also in scope: a help string SERVER-071 made false

`apps/cli/src/commands/thread/create.ts` (module doc and the `create` command
description) promises that a quote the document "contains twice with nothing to
tell the occurrences apart, still creates the thread and comes back with the
`orphaned_anchor` warning". **SERVER-071 made that a `400` (exit 5)** — a
repeated quote is underspecified and is now refused, escapably, by supplying
framing that occurs once.

CLI tests use a stub server, so nothing failed and nothing will. It is purely a
doc fix, which is exactly why it needs an owner rather than a note in a commit
message.

## Acceptance Criteria

- [x] `thread create`'s help no longer promises a thread for a doubly-occurring
      quote, and says how to disambiguate (`--prefix`/`--suffix`)

- [x] A flag on `corpus doc list` selects top-level documents only, and its
      counterpart selects children
- [x] Its help text says it selects **roots**, not documents that have children
      — the name's trap (CONTRACT-042) reaches the CLI too, and help text is
      where an agent learns what a flag does
- [x] Absent means no filtering; an existing command line behaves exactly as
      before
- [x] `doc list`'s thread-only note (L137) is updated if this filter is **not**
      thread-only, so the list of exceptions stays true
- [x] It stays a thin typed-client call — no filtering client-side, which would
      make `total` and paging lie
- [x] `docs/cli.md` regenerated, not hand-edited

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/filters.ts`, `apps/cli/src/commands/doc/list.ts`.

### Notes

- Follow whatever convention the existing boolean flags use for the false case;
  a bare `--flag` plus a `--no-flag` and a tri-state absent is easy to get
  subtly wrong, and absent must remain distinguishable from false.

## Testing Strategy

The flag reaches the query unchanged; absent sends nothing; the false case is
distinguishable from absent. Plus the generated-docs drift check.

## What was built

### `--is-parent <true|false>` on `corpus doc list`

A **tri-state string flag**, not a bare boolean, and that is the whole design
decision. `--pinned` and `--unread` next to it are bare booleans because they
select their true side only and absent may safely read as `false`; here `false`
is a real query — the board's _children only_ chip — so `true`, `false` and
absent have to reach the wire as three different requests. A bare `--is-parent`
plus `--no-is-parent` would have needed new parser machinery and would have made
absent indistinguishable from `false` in `ParsedFlags.boolean()`, which defaults
every absent boolean to `false`. The convention this repo already has for exactly
this shape is a `true|false` string parsed by `parseTriStateBoolean`
(`--evergreen`, `--requests-agent`, `doc create --pinned`), so that is what it
uses.

It lives in `doc/list.ts`, **not** in the shared `DOC_FILTER_FLAGS`: CONTRACT-042
declares `isParent` on `DocsQuerySchema` alone because §9.2's signed
`/api/search` parameter string does not carry it, so a flag for it on `search`
would go nowhere on the wire. `filters.test.ts` pins both halves of that. It is
spliced in after `--pinned` with `insertFlagAfter`, matching the order
`GET /api/docs` publishes its parameters in.

The `--parent <id>` + `--is-parent true` contradiction is **left to the server**.
It is a `400` with a message that names the pair, and a second copy of the rule
in the CLI is a copy that can disagree with the one that decides.

### The help wording

The name is the trap, so the description leads with what it selects and then
denies the reading the name invites, in that order:

> Whether the document is a **child of something** (SPEC.md §9.2). `true`
> selects **roots** — documents with **no parent** — which is the board's _top-level
> only_; `false` selects the documents that **are** a child of something, its
> _children only_. It does **not** mean _has children_: a standalone note that
> nothing hangs off still matches `true`, because the filter asks what a document
> is _under_, never what is under it. Omitting the flag filters nothing — absent
> is not `false`, and the two are different questions. …

Both sides get an example, because a reader who skims the flag list and stops at
the name concludes the wrong thing, and an example line saying "top-level" is
read where a paragraph is not. Five assertions in `list.test.ts` pin the wording
— the failure they guard is a later rewrite that "tidies" the description into
agreement with the name, which is precisely the correction CONTRACT-042
considered and rejected.

The thread-only note now names it as an exception: no document of any type
carries a parent column, so a note's parent is null by genuinely having none, and
`--is-parent` answers for every type rather than no-opping.

### The stale help strings

**`thread create` (SERVER-071).** The module doc and the command description
promised that a quote the parent "contains twice with nothing to tell the
occurrences apart, still creates the thread and comes back with the
`orphaned_anchor` warning". Half of that sentence was still true and half had
become a `400`, so the two cases are now separated explicitly: a quote the
document **does not contain** still creates the thread with the warning; a quote
it contains **more than once** is refused, `400`, exit 5, nothing written.
`--prefix`/`--suffix` are named as the escape with the actual predicate — prefix,
quote and suffix together must occur **exactly once**, and framing that is itself
repeated is refused the same way — and `--prefix`'s own description changed from
"Only needed when…" to "**Required when the quote occurs more than once**".
It also now says the framing is *not stored*: the server reads the anchor's
context off the parent's own bytes, which is the other half of SERVER-071.

**`thread reply` and `thread create` (SERVER-075, SERVER-076).** Both promised
verbatim byte pass-through and said nothing about the two write-time refusals
added since — an unterminated code fence, and a bare `## user · <ts>` line. A
help text that promises pass-through and omits those teaches an agent to expect a
`201` it will not get. Both now describe the refusal, what it would have cost,
and the escape (quoting inside a fence, an inline code span or a block quote is
ordinary content and is accepted).

**`thread resolve` / `thread reopen` and `thread reply` (SERVER-062).** Found by
the sweep, not in the brief, and the sharpest of the four because it is a claim
about a rule rather than about an error. `resolve`'s help said later turns "stop
re-triggering the agent even while it is `engaged`", and `reply`'s said that in a
resolved thread "an explicit `@agent` mention … still enqueues" — which reads as
"and nothing else does". SPEC.md §8's signed rider (SERVER-062) made a
**person's** turn reopen a resolved thread in the same write that appends it,
after which the ordinary engaged rule enqueues with no mention needed. Both verbs
now say so, both keep the half that still holds (an **agent**-authored turn never
reopens and never re-triggers), and `reopen`'s help no longer reads as the only
door onto `status: open`.

### The stale-help sweep

Server issues 060–076 and contract issues 035–044 with status `done` were read
for behavioural changes, and each was checked against the CLI help describing the
route it touched. Beyond the two in the brief the sweep found **one** more
(SERVER-062, above) and cleared the rest: SERVER-060 (internal, no observable
change), SERVER-061 (`inProgress` on `claim-all`/`idle` — already documented in
full on all three queue verbs), SERVER-064 (unreadable document no longer blocks
boot — no CLI help asserts the old behaviour), SERVER-066/CONTRACT-044
(`unterminated-fence` as a non-blocking `doc check` finding — that verb's help is
generic about "whatever `POST /api/check` returns" and enumerates no codes),
SERVER-068/CONTRACT-038 (form grammar — no CLI form verb exists), CONTRACT-043
(turn model — no CLI surface describes it).

The CLI reaches exactly two turn-writing routes — `POST /api/threads` and
`POST /api/threads/{id}/turns` — enumerated from every `api.POST/PUT/PATCH/DELETE`
call site in `commands/`. There is **no** `corpus capture` verb and no
form-answer verb, so SERVER-075's other two doors have no CLI help to falsify.
`doc create` and `doc edit` go to `POST /api/docs` / `PUT /api/docs/{id}`, which
SERVER-066 deliberately left non-blocking; their "bytes are passed through
untouched" help is therefore still true, and it was verified E2E rather than
assumed (an open fence through `doc create` and a bare turn heading through
`doc edit` on a thread both still return success).

## E2E Verification Log

**Model: Opus 5 (1M context)** — cli-dev agent, 2026-08-08.

Real `corpus init` workspace at `/tmp/cli032-ws`, real server started with
`corpus server start` on **port 8823** (8765 and 5173 deliberately untouched),
driven through the real CLI (`tsx apps/cli/src/bin/corpus.ts`, source layout).
Server stopped afterwards; `lsof -nP -iTCP:8823 -sTCP:LISTEN` returns nothing.

### `--is-parent` against a real corpus

Workspace seeded to 13 documents: two notes (one with a thread anchored on it,
one with nothing hanging off it), one anchored thread, one standalone thread, and
the ten files `corpus init` installs.

```
corpus doc list                      → showing 1–13 of 13 documents
corpus doc list --is-parent true     → showing 1–12 of 12 documents
corpus doc list --is-parent false    → showing 1–1 of 1 document
```

The three numbers are the acceptance criteria, in order:

- **Absent filters nothing** — 13 is the unfiltered set, so an existing command
  line behaves exactly as before.
- **`true` is roots, not "has children"** — 12, and the two documents that make
  the point are both in it: `doc_xoxrvjgm` ("Standalone note", nothing hangs off
  it) and `th_v2b5kmv4` (a standalone thread). The one row it drops is
  `th_bfz6hx5j`, the thread that *is* a child of `doc_hi2hvht5`.
- **`false` is the counterpart** — exactly that one child thread.

`total` comes from the server in every case (12 and 1, not 13-with-rows-hidden),
so paging does not lie — the thin-client criterion, observable rather than
asserted.

The contradiction and the enum, on the wire:

```
corpus doc list --parent doc_hi2hvht5 --is-parent true
  → 400 bad_request, exit 5
    query.isParent: "`parent=<id>` and `isParent=true` contradict: `parent` asks
    for the children of a document and `isParent=true` asks for documents with no
    parent. Drop one."
corpus doc list --parent doc_hi2hvht5 --is-parent false  → 1 row, exit 0 (redundant, accepted)
corpus doc list --is-parent root
  → corpus: --is-parent expects "true" or "false", got "root".   exit 2, no request sent
corpus doc list --is-parent false --json  → {"items":[…],"page":{…}} — the server's envelope
```

### The help strings, verified against the behaviour they now describe

`thread create`, on a note containing `6.1%` twice:

```
--quote "6.1%"                            → 400, exit 5
    "the quoted text occurs more than once in the parent document; send
     `prefix`/`suffix` copied from the file around the occurrence you mean"
--quote "6.1%" --suffix " appears here"   → created th_mnud5but — anchored at anc_43496d3c
--quote "text that is not there at all"   → created th_5ywtovck — anchored at anc_58c60fd9
                                             — warning: orphaned_anchor (…)
```

All three sentences of the rewritten paragraph, confirmed in order: the repeated
quote is refused, the framing is the escape, and the absent quote is still a
created thread carrying the warning.

`thread reply` (and `thread create`, the same door):

```
reply, unterminated ``` fence   → 400, exit 5, "the ``` on line 3 is never closed…"
reply, bare `## agent · <ts>`   → 400, exit 5, "line 2 … which §6 makes a turn delimiter"
reply, the same two shapes quoted (````markdown fence, `> ` block quote, inline span)
                                → 201, "replied to th_v2b5kmv4 — turn 2026-08-08T05:00:20Z"
thread create, unterminated fence in the first turn → 400, exit 5, same message
```

The escapes the new help names are accepted, which is the half a refusal-only
sentence would have left an agent unable to act on.

The reopen rule (SERVER-062), measured rather than read off the code — a thread
taken to `engaged`, then resolved, then replied to four ways:

```
resolve th_47b2jeiz                          → status resolved, agent engaged
reply --from user  "one more thought, no mention here."
                                             → replied … (queued evt_gs6z4xhgwimq)
                                             → status OPEN, agent engaged
resolve, then reply --from agent             → replied … (no event)
                                             → status RESOLVED, agent engaged
resolve, then reply --from user              → replied … (queued evt_kqtgga524tid)
```

An ordinary person's reply with **no `@agent` in it** both reopens and enqueues;
the agent's does neither. That is the exact pair of sentences the old help had
backwards, and the pair the new help now states.

The surfaces the sweep concluded were **not** stale, checked rather than assumed:

```
doc create -m '…```js\nconst z = 3;'            → created doc_gdxilr7q, exit 0
doc edit th_v2b5kmv4 -m '## user · <ts>\n…'     → edited th_v2b5kmv4, exit 0
```

Both still accepted, so SERVER-066's non-blocking decision holds and those help
strings stay true.

### Checks

```
npx vitest run apps/cli   → 85 files, 1314 tests, all passing
npx tsc --noEmit -p apps/cli → clean
npx eslint apps/cli          → no issues
npx prettier --check "apps/cli/**/*.ts" docs/cli.md → clean
apps/cli/src/docs/generate.test.ts → 16 passed, including
                                     "matches the committed docs/cli.md"
```

The hooks no longer build, typecheck or run tests (INFRA-025), so these were run
directly rather than inferred from a clean commit.

`docs/cli.md` was regenerated with `npm run docs:cli -w apps/cli` and never
hand-edited.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
