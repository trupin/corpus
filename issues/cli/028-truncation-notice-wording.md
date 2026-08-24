# [CLI-028] The truncation notice says "hunk boundary" when the cut may be a line boundary

## Domain
cli

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-058
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/docs/:id/diff`

## Summary
Found by SERVER-058 while fixing the truncation rule it was named for.

`apps/cli/src/commands/doc/diff.ts:171` prints:

> the diff above is cut at a hunk boundary …

asserted at `diff.test.ts:263`. That was accurate when every cut was a hunk
boundary. SERVER-058 changed the rule: whole hunks are still dropped from the
end, but when the hunk that would then be dropped is **larger than the whole
bound**, the cut happens inside it at the last line boundary — because no cut
anywhere could show that hunk whole, so a prefix of it beats none of it.

That case is not exotic; it is the reported one (a document rewrite is a single
oversized hunk). So the notice now sometimes describes the cut incorrectly.

Cosmetic, and worth fixing precisely because the notice exists to stop the agent
reading a partial diff as whole — a sentence that misdescribes the cut
undermines the one job it has.

## Second wording fix, same file (AGENT-011, 2026-08-05)

`docs/cli.md`'s `doc diff` topic prose says the agent "triages on the stats and
comes here when the change looks like it could ripple". AGENT-011 established
there is no safe stats-only skip and wrote the skill to fetch on every event —
proven in a drill where a substantive edit and a typo fix produced **byte-identical**
payloads (`1 commit, +2 -2`). The signed rider says only "on demand", which
always-fetch satisfies, so the skill is right and the prose is now a narrowing
that misdescribes the loop.

- [x] The topic prose no longer claims the agent triages on stats before fetching
- [x] It is edited at its source, not in the generated `docs/cli.md`, and the
      file is regenerated

## Acceptance Criteria
- [x] The notice describes the cut that actually happened, both cases
- [x] It stays one line and keeps saying plainly not to read the diff as the
      whole change — that sentence is the point, not the boundary type
- [x] The pinned assertion moves with it
- [x] Check whether the distinction is even worth surfacing: "cut after N of M
      characters" may serve the reader better than naming the boundary at all.
      Decide deliberately rather than patching the adjective

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/diff.ts`, `diff.test.ts`

## Testing Strategy
Both truncation shapes through the real formatter.

## E2E Verification Log

**Model: Opus 5 (1M context). 2026-08-24, branch `phase-45-not-so`.**

### The decision on criterion 4: the notice names no boundary at all

Taken deliberately, and against naming the boundary correctly. Three reasons, in
order of weight:

1. **Nothing on the wire says which cut happened.** `DocDiff` carries `diff`,
   `truncated` and `totalChars` and no fourth field. A CLI that printed "cut at a
   line boundary" would be repeating a rule it cannot observe — at best inferring
   it from whether `diff` ends in `\n`. That is a guess printed as a fact, in the
   one notice whose whole job is to stop the agent treating a partial answer as a
   whole one.
2. **No fixed adjective is true of both shapes.** After CONTRACT-032,
   `truncateDiff` cuts at *the last line boundary at or before the bound*, and
   falls back to a hard cut at `max` when a single line is longer than the whole
   cap. "hunk boundary" was true of the rule of the day and false of the next one,
   which is exactly how this defect was made. A second adjective would be the same
   bet.
3. **The boundary was never actionable.** Nothing in this repository applies a
   diff — the CLI prints it and the agent reads it. The two escalations are the
   same whichever line the text ended on.

What replaces it is the **measurement**, which is what the reader can act on and
what stays true however the cut is made:

```
# the diff above was cut to fit the 16000-character bound: it stops 13984 characters short of the whole change, and the counts above are for the whole range. Do not read it as the whole change — narrow the range with --from-rev/--to-rev, or read the document as it now stands with: corpus doc show doc_mm2sv5lb
```

One line. `Do not read it as the whole change` is unchanged and still carries the
point. `showing 15938 of 29922 characters` on the size line above the body is the
other half of the same measurement, in its own form, before the body rather than
after it. Rejected as a third form: repeating `cut after N of M characters` inside
the notice, which would state the size line's number a second time in the slot the
"what not to conclude" sentence needs.

Also rejected: adding a clause about the last hunk header's line counts describing
more lines than follow it. It names a detail of the diff *format* for a reader that
does not parse one, and it would put a second sentence in competition with the only
one that matters.

### Shape 1 — cut at a line boundary — real server, real workspace, real document

Real workspace on a free port (8931), never 8765. Built binary, not `tsx`.

```
$ corpus init . --port 8931
Initialized Corpus workspace at …/scratchpad/ws
$ corpus server start
corpus 0.21.0 listening on http://127.0.0.1:8931 (pid 44005)
$ corpus doc create --type note --title "Mortgage options" --folder finance --file /tmp/small.md
created doc_mm2sv5lb — data/docs/finance/mortgage-options.md
$ corpus doc edit doc_mm2sv5lb --key bb896dad… --file /tmp/big-new.md   # 28 689-byte body
edited doc_mm2sv5lb

$ corpus doc diff doc_mm2sv5lb
doc_mm2sv5lb · data/docs/finance/mortgage-options.md
4b825dc642cb6eb9a060e54bf8d69288fbee4904..3e8ffaad1671a9109f2916d5e30ee6b76228e555
1 commit · +813 -0 · showing 15938 of 29922 characters

diff --git a/data/docs/finance/mortgage-options.md b/…
…446 more lines…

# the diff above was cut to fit the 16000-character bound: it stops 13984 characters short of the whole change, and the counts above are for the whole range. Do not read it as the whole change — narrow the range with --from-rev/--to-rev, or read the document as it now stands with: corpus doc show doc_mm2sv5lb
EXIT=0
```

`--json` on the same call confirms the shape rather than assuming it:
`{"truncated":true,"totalChars":29922,"shown":15938,"endsWithNewline":true}`, and
29922 − 15938 = 13984, the number the notice prints. The old wording would have
called this a hunk boundary. It is not one: the body ends mid-hunk, at
`…thirty years.\n+\n`.

### Shape 2 — the mid-line fallback — real binary, stub payload

**The fallback is not reachable through the real route**, and the run above shows
why: the first newline in a real `git diff` falls at index 90, in the
`diff --git a/… b/…` header line, so `lastIndexOf("\n", max - 1)` never returns
`-1`. Measured, not assumed. That is an accident of git's output format rather than
a guarantee the CLI holds, so the shape is still exercised — through the shipped
`dist/bin/corpus.js`, a real workspace config and real HTTP, against a stub server
returning a payload cut mid-line.

```
$ (cd stubws && corpus doc diff doc_a1b2c3)      # stub returns a mid-line cut
doc_a1b2c3 · data/docs/finance/mortgage-options.md
0a1b2c3d4e5f60718293a4b5c6d7e8f901234567..9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
1 commit · +900 -900 · showing 152 of 61200 characters

diff --git a/data/docs/finance/mortgage-options.md b/data/docs/finance/mortgage-options.md
@@ -1,3 +1,4 @@
-30-year fixed at 6.1%.
+30-year fixed at 6.4

# the diff above was cut to fit the 16000-character bound: it stops 61048 characters short of the whole change, and the counts above are for the whole range. Do not read it as the whole change — narrow the range with --from-rev/--to-rev, or read the document as it now stands with: corpus doc show doc_a1b2c3
EXIT=0
```

The same stub with a line-boundary cut prints the identical notice with its own
number (`stops 61045 characters short`, `showing 155 of 61200`). Both notices are
true of their own body, and neither had to know which cut it was describing.

### The topic prose (AGENT-011)

Edited at source in `diffCommand.description`, then regenerated:
`npm run docs:cli -w apps/cli` → `docs/cli.md` +2 −2. `docs/cli.md` was never
hand-edited. `tsx scripts/generated-artifacts.ts --check` exits 0.

From the real binary, `corpus doc diff --help`:

> **This is the follow-up to a `doc.edited` event, and it is made on every one of
> them.** … **The stats size this read, they never decide it.** A substantive edit
> and a typo fix can produce the same numbers — `will` becomes `will not` at
> `+1 -1` exactly as a misspelling does, and a drill produced two byte-identical
> payloads (`1 commit, +2 -2`) for exactly that pair — so there is no stats-only
> skip, and the diff is the only thing that says which change happened.

That matches the skill, which reads "**1 — Read the change, always, exactly
once**" and "The stats do not decide whether to make that call … What they are for
is sizing the read".

### Checks

- `vitest run --reporter=verbose apps/cli/src/commands/doc/diff.test.ts` — **EXIT=0**, 39 passed.
- `vitest run --reporter=verbose apps/cli` — **EXIT=0**, 107 files, 2126 tests passed.
- `eslint` on both touched files — exit 0, no suppressions added.
- `prettier --check` on both files and `docs/cli.md` — exit 0.
- `tsc --noEmit -w apps/cli` — exit 0.
- Server stopped, ports 8931 and 8932 verified free. 8765 untouched.

### One thing another domain should pick up

**SPEC.md §9.2 states the never-mid-line rule without the exception the code has.**
The signed rider says "The cut is never mid-line, and never mid hunk-header: a
truncated diff is always something a reader can read." `truncateDiff` keeps a
documented fallback that cuts at `max` when no line boundary exists at or before
it. It is unreachable through this route today only because git always emits a
header line first — an accident of git's output, not a rule. Escalated in the
report rather than fixed here: SPEC.md and `apps/server` are both out of this
issue's scope. It is also the reason the notice claims nothing about readability.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
