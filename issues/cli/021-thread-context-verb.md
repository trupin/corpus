# [CLI-021] `corpus thread context <id>`

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-024, SERVER-047
- Blocks: AGENT-009

## Spec References
- SPEC.md §7 context packs (SHARED-006 Edit 4)

## Summary
Thin verb over the context route. Output ordered for an agent's read: the anchored
passage/section first, then related excerpts one line each (id · heading path ·
excerpt · relation), the degrade note when semantic ranking wasn't available; `--json`
mirror. No flags beyond `--json` in v1 — the bounds live in the contract.

## Acceptance Criteria
- [x] All **five** pack shapes render legibly (anchored / whole-doc / orphaned-anchor /
      standalone / parent-deleted — sprint-022 C1 corrected the count of four)
- [x] Related lines are built from the existing formatters — `renderColumns` + `oneLine`
      (sprint-022 C9 / Open Conflict 5 **overrides** "one formatter, shared": no shared
      hit-line formatter exists, and creating one would edit `search.test.ts`'s exact-output
      assertion, which the product's skills paste verbatim). `search` and `doc related` are
      byte-identical to before — no assertion edited.
- [x] 404 and error paths per existing verb conventions (documented in the description, not
      caught; `ServerResponseError` → exit 5)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/thread/context.ts` (new + tests); share the hit-line formatter with `search`/`related`

## Testing Strategy
apps/cli scoped: rendering against stubbed packs.

## E2E Verification Plan
Real server via the bin: comment on a doc, `corpus thread context th_…` shows the briefing; verify against the file.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context), 2026-08-02. Port **8806** only (8765 never
touched); scratch `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s022-cli/021-e2e`; no git
command run by this agent; nothing edited outside `apps/cli/`, `docs/cli.md` (generated) and
this issue file. Warm per-user model cache, no download.

### Files touched

New: `apps/cli/src/commands/thread/context.ts` (the verb), `.../context.test.ts` (27 tests).
Edited: `thread/index.ts` (registration + topic prose), `commands/hygiene.test.ts` (both pinned
module inventories), `docs/cli.md` (**regenerated**, never hand-edited).

### The rendering contract, as shipped

Blocks, separated by one blank line, in reading order: **parent block** (shape-appropriate) →
**truncation line** when the flag is set → **excerpt rows** → **degrade note**. `--json` mirrors
the wire. No local flags (`flags: []`); a local `--json` would shadow the global and be rejected
at module load.

### All five shapes, through the real bin (TEST-983, TEST-994, TEST-995)

Workspace: `corpus init … --port 8806`, four notes, five threads, `corpus index rebuild` to
`state current` (71 chunks) so the excerpts are genuinely semantic.

```
$ node apps/cli/dist/bin/corpus.js thread context --workspace …/ws th_zht5w47h     [exit 0]
parent doc_so3kyka7 · Mortgage options · Mortgage › Escrow

> recalculated annually under fixed terms

## Escrow

The escrow reserve is recalculated annually under fixed terms.

A second paragraph inside the escrow section, so the anchor is not the whole of it.

# related excerpts
doc_im4g7qfj          Cabinet delivery schedule    linked   # Cabinet delivery schedule Cabinets arrive on Tuesday…
doc_vgh2k22r          Impound account true-up      similar  # Impound account true-up The lender re-runs the impound analysis…
th_hrbdhleg           user · 2026-08-02T03:34:47Z  similar  Does this note still reflect the June quote?
…                                                          (7 rows; `linked` and `similar` both present)
```

```
$ … thread context th_hrbdhleg          (whole-document)                          [exit 0]
parent doc_so3kyka7 · Mortgage options

# Mortgage

Opening preamble above the first heading, so a whole-document thread has an opening to show.

# related excerpts
…
```

```
$ … thread context th_36j6gj3c          (standalone)                              [exit 0]
# related excerpts
doc_skillorchestrate  Stewardship  similar  the git log answers "what did the agent change, and when" completely.
…                                           ← no parent block, no empty heading, no leading blank
```

```
$ … thread context th_hywg6l7p          (orphaned-anchor)                         [exit 0]
parent doc_im4g7qfj · Cabinet delivery schedule
the anchor no longer resolves in the parent (SPEC.md §6); the quote the thread was opened on is preserved below, and where that text went is not guessed at:

> THE ANCHOR PHRASE LIVES HERE

# related excerpts
doc_so3kyka7  Mortgage › Escrow  both  ## Escrow The escrow reserve is recalculated annually…
…
```

```
$ … thread context th_wh7bdgp3          (parent-deleted)                          [exit 0]
parent doc_ggo6ca6p was deleted; this conversation outlived it, so there is no parent content to show (SPEC.md §9.2).

# related excerpts
…
```

The orphan was produced with `corpus doc edit` (`edited doc_im4g7qfj — 1 orphaned
(th_hywg6l7p) — warning: orphaned_anchor`) and the deletion with `corpus doc delete`
(`deleted doc_ggo6ca6p — orphaned 1 thread (th_wh7bdgp3)`) — real state, not fixtures.

### The passage verified against the file on disk (TEST-994)

```
$ /usr/bin/awk '/^## Escrow$/{f=1} /^## Fees$/{f=0} f' ws/data/docs/finance/mortgage-options.md > file-section.txt
$ … thread context th_zht5w47h | /usr/bin/awk '/^## Escrow$/{f=1} /^# related excerpts$/{f=0} f' > pack-section.txt
$ /usr/bin/diff file-section.txt pack-section.txt
    (no output)                    → IDENTICAL to the file's own section
$ /usr/bin/grep -c "recalculated annually under fixed terms" …/mortgage-options.md
2                                  → the quote is in the parent verbatim
```

### `--json` (TEST-988)

```
$ … thread context th_zht5w47h --json | /usr/bin/wc -l
       1                           → exactly one line
$ … thread context th_zht5w47h --json | /usr/bin/grep -c "^# related excerpts"
0                                  → every human line suppressed
{"shape":"anchored","parent":{"id":"doc_so3kyka7","title":"Mortgage options","headingPath":"Mortgage › Escrow","quote":"recalculated annually under fixed terms","section":"## Escrow\n\n…","truncated":false},"threadId":"th_zht5w47h","excerpts":[…7…],"semanticIndex":"current"}
```

### The truncation indicator, on a real over-cap section

An 8813-byte document whose single `## Long` section runs past `CONTEXT_MAX_SECTION_CHARS`,
anchored deep inside it:

```
$ … thread context th_zlii3iii                                                    [exit 0]
parent doc_obup3sn2 · Long section doc · Long doc › Long

> THE DEEP ANCHOR PHRASE SITS HERE
…
# the parent text above was cut to fit the pack's bounds — read all of it with: corpus doc show doc_obup3sn2

# related excerpts
$ … --json | node -e '…'
shape anchored | section chars 4000 | truncated true | quote at offset 1984
```

The cut is anchored on the anchor (the quote sits mid-window), and the indicator names the
escalation — never silence.

### Error paths (TEST-991, TEST-995)

```
$ … thread context th_nope00000
corpus: 404 not_found: no document with id th_nope00000
[exit 5]
```

Server-down is the shared client path (exit 4), unchanged by this verb — it catches no status
and inspects no error.

### Checks

```
$ npm run build                                                      → exit 0
$ npm run lint                                                       → exit 0
$ npm run format:check     All matched files use Prettier code style! → exit 0
$ npm run typecheck -w apps/cli                                      → exit 0
$ npm run docs:cli -w apps/cli   generated ../../docs/cli.md          → no diff on re-run
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli
    Test Files  77 passed (77)
         Tests  1088 passed (1088)                                   → exit 0
```

**+27 tests** in `thread/context.test.ts`: the route call with no query, the five shapes on
exact output, reading order (note last), the four-column row with the excerpt last, `oneLine`
on the heading path and excerpt but not on `relation`, the `—` fallback, the empty-excerpts
line, truncation present/absent/on the orphan, multi-line quotes, `--json`, the three degraded
wire values plus silence on `current`/absent, the 404, and the spec-object guards (registry
validity, `flags: []`, documented 404, `--json` example, no `untimedApi`).

`search.test.ts` and `doc/related.test.ts` are inside that run **with no assertion edited**
(TEST-986); `search.ts:56-58` and `doc/related.ts:52-54` are untouched, so the transcripts the
product's skills paste stay valid. `docs/generate.test.ts`'s
`expect(committed).toBe(generateCliDocs(registry))` is green, and `docs/cli.md` gained
`### \`corpus thread context\`` above `### \`corpus thread create\`` with anchor
`#corpus-thread-context` plus its ToC entry — **this is AGENT-009's hard gate (sprint-022 C7),
and it is now open**.

### Decisions worth recording

- **No shared hit-line formatter** (Open Conflict 5, adjudicated). The rows are assembled
  inline from `renderColumns`/`oneLine`, in this surface's own order `[id, headingPath,
  relation, excerpt]` — free text last, because `renderColumns` pads every column but the last.
- **A `#`-prefixed `# related excerpts` marker** separates the parent's prose from the
  positional rows. Without it, a briefing whose parent block is arbitrary markdown gives a
  reader no reliable boundary between prose and rows — the one ambiguity a pack has that a flat
  result list does not. It rides the existing meta channel (`semanticIndexNote`'s `#`), so a
  machine caller uses `--json` and ignores it.
- **The degrade note is last**, unlike `search`/`related` where it is first: in a pack it
  qualifies the excerpts, which are the last thing printed (TEST-984).
- **`switch` on `shape`, exhaustively** — never probing for a present-but-empty parent. The
  contract's discriminant is closed, so a sixth shape breaks the build.

### Deferred / not done

- **No `assets/workspace/` edit.** The comment skill starting from the pack is AGENT-009.
- **`npm run e2e` not run** — this verb touches no UI, and the sprint makes Playwright
  single-holder.
- **No SPEC.md edit** — §7's signed context-packs paragraph already describes this rendering.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
