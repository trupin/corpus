# [CLI-069] The help does not say which types retrieval skips

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-144
- Blocks: —

## Spec References

- SPEC.md **§9.2** — retrieval surfaces and their filters
- SPEC.md **§7**, signed rider 2026-08-24 — skills and agent-defs do not rank in
  an unfiltered search; a `template` always ranks

## Summary

SERVER-144 shipped once, was withdrawn from v0.21.0, and returns in v0.22.0 on
the signed rider. Its revert took six CLI help blocks with it, and the
re-implementation restored the behaviour without them.

So the agent's only interface now silently skips document types in an unfiltered
search and says nothing about it anywhere. That is the exact failure this release
is named for: the tool behaves one way and describes another.

**The numbers changed between the two implementations and the old text is
stale.** The withdrawn version excluded three types; the signed one excludes two
on search and four on the neighbour surfaces, and `template` is excluded from
none of them. The `3 of 5 hits` figure in the old wording no longer holds — this
release's probe returns two user rows where four used to be machinery.

## Acceptance Criteria

- [x] The six help blocks are restored, describing **two** excluded types on
      search and **four** on the neighbour surfaces
- [x] `template` appears in none of them, as an exclusion or as an example
- [x] The help says how to reach an excluded type — `--type skill` still returns
      every skill — so the exclusion never reads as "out of reach"
- [x] No stale count survives. Any figure in the text either matches this
      release's behaviour or is removed rather than guessed
- [x] A test pins the help text against the server's exclusion lists, so the two
      cannot drift apart again the way they did across the withdrawal

## Technical Design

The pin is the point. This text has now been wrong twice for the same reason —
it restates a server-side list in prose with nothing tying the two together. If a
mechanical pin is not possible, say so in the E2E log and explain what was tried,
rather than restating the list a third time.

## Testing Strategy

Unit coverage for the help output. The falsification is direct: change the
server's exclusion list and the help test must go red.

## E2E Verification Log

_Filled by the implementing agent (cli-dev, **Opus 5 (1M context)**), 2026-08-24._

### What the current server actually does, read before any prose was written

`apps/server/src/docs/filters.ts` is the only place the lists exist:

```
UNRANKED_DOC_TYPES           = ["skill", "agent-def"]
UNRANKED_NEIGHBOUR_DOC_TYPES = [...UNRANKED_DOC_TYPES, "view", "board"]
```

and `apps/server/src/search/search.ts:212` is the `--type` gate:

```ts
if (query.type === undefined) compiled.conditions.push(rankableSql("d"));
```

So: **two** types on search, **four** on the neighbour surfaces, `template` on
neither, and naming any type lifts the search default whole. Every figure in the
restored text is composed from those arrays rather than typed.

### The pin — built, and it is a measurement rather than a comparison of constants

`scripts/retrieval-exclusion-parity.test.ts`. A mechanical pin **is** possible,
but not by import: `apps/server` is not upstream of `apps/cli`, so the CLI cannot
read `UNRANKED_DOC_TYPES` and compose from it. `scripts/` is the one tree allowed
to see both (the reason `missing-profile-parity.test.ts` and
`stub-server-parity.test.ts` live there).

It does not read the server's constants at all. It seeds a real workspace with
one document of every core type, all carrying one phrase, and calls the real
`searchCorpus`, `relatedDocs` and `threadContextPack`. The types missing from
each answer are the measurement; the CLI's arrays are compared to it; and the
three help blocks are asserted to **contain the composed strings**, which only
interpolation can produce.

Falsification, run for real. `UNRANKED_DOC_TYPES` was temporarily edited to
`["skill", "agent-def", "template"]` and the file restored afterwards:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose \
    scripts/retrieval-exclusion-parity.test.ts
exit=1
 × drops exactly the types `corpus search`'s help names
 × drops exactly the types `corpus doc related`'s help names
 × drops exactly the types `corpus thread context`'s help names
 × ranks a template on all three surfaces, because a template is the user's own
```

Four tests red on a one-word server edit. Restored: `exit=0`, 12 passed.

### E2E against a real server

Throwaway workspace, port 8891 (never 8765, never 5173), server started and
stopped by `corpus server start` / `corpus server stop`.

```
$ corpus search "reconcile in-progress"
doc_seedboardbystatus   By status     …
doc_seedattention       Attention     …
doc_seedboardattention  Attention     …
doc_seedopenthreads     Open threads  …
doc_44xd6a7r            Big note      …

$ corpus search "reconcile in-progress" --type skill
doc_skillconverse     Settling your own lane   …
doc_skillorchestrate  The loop                 …
doc_skillcomment      Comment                  …
doc_skillb8a2308c     Simplified Technical English (ASD-STE100) › Output Format  …
doc_skillprofile      Worked example           …
```

Exactly what the restored help predicts: no skill and no `agent-def` in the
unfiltered ranking, views and boards kept, and `--type skill` returning every
skill. The help as it now prints:

```
$ corpus search --help
**The ranking skips two document types by default** (SERVER-144): `skill` and
`agent-def` — the skills and personas `corpus init` installed. …

**Naming any `--type` turns that default off entirely** … `template` is **not**
on the list — a template is the user's own writing …

**`view` and `board` are kept here, deliberately.** …

$ corpus doc related --help
**Four document types are never neighbours** (SERVER-144): `skill`, `agent-def`,
`view` and `board`. …
```

### Checks

- `npm run typecheck -w apps/cli` — clean
- `./node_modules/.bin/eslint apps/cli/src scripts/…` — clean, no rule disabled
- `prettier --check` — clean
- `npm run docs:cli -w apps/cli` — regenerated, never hand-edited
- `vitest run apps/cli scripts/missing-profile-parity.test.ts
  scripts/retrieval-exclusion-parity.test.ts` — **109 files, 2148 tests, exit 0**

### One judgment recorded

The withdrawn text's `3 of 5 hits` is gone rather than re-measured. The only
figure kept is the SHARED-070 audit's **52% of seven retrieval calls' output
tokens**, because that number is still asserted in the current
`apps/server/src/docs/filters.ts` comment and measures token share rather than
list length. Every other number in the three blocks is `array.length` rendered
as an English word.
