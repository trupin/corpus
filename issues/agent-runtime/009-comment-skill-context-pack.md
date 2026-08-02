# [AGENT-009] Comment skill starts from the context pack

## Domain
agent-runtime

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-021, AGENT-008
- Blocks: —

## Spec References
- SPEC.md §7 comment skill (SHARED-006 Edit 3), context packs (Edit 4)

## Summary
Amend the comment skill per the signed Edit 3: handling `comment.created` starts from
`corpus thread context <id>` — the pack IS the default context; full-document reads
are the escalation, taken only when the pack is insufficient for the ask, and the
skill says what "insufficient" looks like (the ask references content the pack didn't
carry; an edit must preserve surrounding structure the pack didn't include). Keep
coherent with AGENT-008's rules and the existing reply/trace/lock flow.

## Acceptance Criteria
- [x] Skill's worked flow opens with the context verb; escalation criteria stated; no step reads the parent wholesale by default
- [x] Standalone-thread path (no parent) reads naturally with the pack's related-only shape
- [x] Consistent with AGENT-008 rules (one retrieval doctrine, not two)
- [x] All **five** pack shapes carry a handling note (sprint-022 C1 corrected the count of three)
- [x] `orchestrate/SKILL.md:470-473`'s worked-example read path corrected to pack-first
      (sprint-022 Open Conflict 8, adjudicated: minimal — that paragraph only)

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/comment/SKILL.md`
- `assets/workspace/claude/skills/orchestrate/SKILL.md` (Open Conflict 8: the one narrated
  read path at `:470-473`, nothing else)

## Testing Strategy
Prose audit (`/usr/bin/grep` for contradicting instructions), format check; template-copy test green.

## E2E Verification Plan
`corpus init` scratch workspace: installed skill text opens with the context verb.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context), 2026-08-01. Port **8806** only (8765 never bound
— `lsof` below shows zero listeners on it); scratch
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s022-agent/009-e2e`; no git command run by this
agent; nothing edited outside the two `assets/workspace/claude/skills/*/SKILL.md` files and this
issue file. No model download (the pack's excerpts ranked on the warm per-user cache).

### Files touched

- `assets/workspace/claude/skills/comment/SKILL.md` — `## Gather context` rewritten (its opening,
  its escalation rule and its shape list); invariant 6, *Doing the work*'s edit bullet, *Inbox
  filing* step 1 and worked example 1 woven to match; `updated` bumped.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the one narrated read path in *Worked
  example* (`:470-473`) and `updated`. Nothing else (Open Conflict 8, as adjudicated).

### What the skill now says (TEST-997, TEST-998, TEST-999)

`## Gather context` opens with the verb, in a fence, as the first instruction:

```
**Start from the briefing.** One command tells you what the conversation is about and what
else in the corpus bears on it:

    corpus thread context th_4b8e2c

That is the default context for every event that reaches this skill, and it is the first thing
you run.
```

The default is exactly two reads — the pack, then `corpus thread show` for the turns — stated as
"**Those two reads are the whole default.**" **Insufficiency is enumerated, not gestured at**, in
four named cases: (1) the ask turns on a figure/section/decision carried by neither the parent
block nor any excerpt line; (2) a body is about to be rewritten, because `corpus doc edit`'s
heredoc replaces the whole body (`docs/cli.md:518` — "The body comes from `-m`, `--file` or
stdin"), so a section-only rewrite deletes the rest of the document; (3) the pack's own
truncation line, quoted verbatim from CLI-021's rendered output and read as the instruction it
is — `# the parent text above was cut to fit the pack's bounds — read all of it with: corpus doc
show doc_a1b2c3` — with the converse stated ("a parent block with no such line is the section
entire"); (4) the degrade note, where the excerpts were ranked on links alone and
`corpus search` is the reach past them. Closing rule: "Nothing else earns a full read — not a
hunch, not background nobody asked for, and not the habit of opening the parent because it is
there."

Every surviving `corpus doc show` was audited (TEST-999):

```
$ /usr/bin/grep -n "corpus doc show" assets/workspace/claude/skills/comment/SKILL.md
70   invariant 6 — "reading a body is the separate, deliberate next step on an id retrieval returned"
101  *State goes through the CLI* — a rule about where a read comes from, not a step
109  *Locating goes through retrieval* — same bullet pair
117  ESCALATION — "the ask reaches past what it carried"
126  ESCALATION — the pack's own truncation line, quoted
252  Inbox filing step 1 — labelled "the escalation earning the full read" (step 3 rewrites the body)
264  Inbox filing step 4 — a read on the id a search ranked
474  Worked example 1 — labelled "# escalation: the edit below replaces the whole body"
518/531  Worked example 3 (inbox capture)
```

No occurrence is a default step of the read order; the old anchored path's step 2 is gone.

### The five shapes (sprint-022 C1), one handling note each (TEST-1001)

`**Anchored**` (quote + whole section is almost always the answer) · `**Whole-document**`
(title + opening; "the shape that escalates most often") · `**Orphaned anchor**` (the pack says
the anchor is **orphaned** and prints the preserved quote; answer from it, never repair the
`anchors` map by hand) · `**Standalone**` (`parent: null`; "The pack prints no parent block at
all, only the excerpts, because **the thread is the whole context** — the pack's related-only
shape is that rule expressed as a command") · `**Parent deleted**` ("The conversation outlived
the document it was about … never recreate what was deleted"). The retitle obligation and its
`corpus doc edit th_9f21c4 --title "…" --from agent` line are untouched below the shapes
(TEST-1004).

### One doctrine, not two (TEST-1003)

Invariant 6 and the new section, side by side:

> 6. **You retrieve; you never enumerate.** Locating something is `corpus search "<query>"` or
>    `corpus doc related <id>` … **For a thread you were handed, the bounded briefing of *Gather
>    context* is that same rule aimed at a conversation.** Reading a body is the separate,
>    deliberate next step on an id retrieval returned: `corpus doc show <id>`.

> **Locating goes through retrieval.** The pack *is* retrieval — ranked, bounded, one frugal
> line per hit — and so are `corpus search "<query>"` and `corpus doc related <id>` when you
> need to reach past what the pack carried.

> **Escalating past the pack** is a deliberate read of one named document, never a sweep — the
> same doctrine as invariant 6, not an exception to it.

The one clause added to invariant 6 names the pack as an *instance* of the rule; the rule itself
(and orchestrate's authoritative copy of it) is unchanged. Contradiction audit:

```
$ /usr/bin/grep -n -i "then the parent\|read the parent\|read the thread, then\|first read\|read in this order" \
    assets/workspace/claude/skills/comment/SKILL.md assets/workspace/claude/skills/orchestrate/SKILL.md
(no output — exit 1)
```

### Open Conflict 8, executed minimally (TEST-1006)

`orchestrate/SKILL.md` *Worked example*, before → after:

```
- Inside the subagent, the comment skill reads `th_4b8e2c` with `corpus thread show` and
- opens the one anchor that matters — `corpus doc show doc_a1b2c3`, the second line never
- read at all — finds the request, and does the work: …
+ Inside the subagent, the comment skill briefs itself on the one thread that matters —
+ `corpus thread context th_4b8e2c`, one bounded pack carrying the anchored passage with its
+ enclosing section and whatever else bears on it, the second line never opened at all — reads
+ the turns with `corpus thread show`, escalates to `corpus doc show doc_a1b2c3` because the
+ edit below replaces the whole body, and does the work: …
```

The dispatch rules at `:167-174` are untouched — a dispatch still carries anchors, and the pack
is anchors. `updated` bumped there too, because a body was rewritten
(`workspace-template.test.ts:141-155` requires exactly that pairing).

### The pinned structure (TEST-996, TEST-1000, TEST-1002, TEST-1005, TEST-1007)

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts
    Test Files  1 passed (1)
         Tests  96 passed (96)                                            → exit 0
```

That single suite is the whole gate for these bytes, and it carries all seven pinning assertions:
13 fence-aware `##` sections each > 400 chars (`:546`, `:551`), the `"gather context"` heading
keyword (`:261`), the literal `corpus thread show <id>` / `corpus doc show <id>` /
`/anchor resolution/i` / `data/docs/` / ``never parse anything under `.corpus/` `` set
(`:573-580`), the three bold shape labels + `` `parent: null` `` + `/orphaned/` + ≥ 3 "stop"
(`:582-589` — 4 occurrences of "stop" now), the verbatim command list (`:555-570`), the
timestamp rule (`:141-155`), and the forbidden dev-harness strings (`:503-504`).

```
$ /usr/bin/grep -n "CLI_COMMANDS_PENDING_CLI_006" scripts/workspace-template.ts
239:export const CLI_COMMANDS_PENDING_CLI_006: readonly string[] = [];   → still empty, untouched
$ /usr/bin/grep -c "SPEC.md\|CLAUDE.md\|issues/\|npm run\|/implement" <both skills>
0
$ /usr/bin/grep -oi "\bstop\b" .../comment/SKILL.md | /usr/bin/wc -l
4
$ /usr/bin/grep -n "^updated:" assets/workspace/claude/skills/*/SKILL.md
comment/SKILL.md:8:updated: 2026-08-01T00:00:00Z      (created 2026-07-26, was 2026-07-31)
orchestrate/SKILL.md:8:updated: 2026-08-01T00:00:00Z
```

Every `` `corpus …` `` invocation in the tree — fences and inline prose spans — resolves against
a `docs/cli.md` heading; the new one, `corpus thread context`, resolves against
``### `corpus thread context` `` (`docs/cli.md:1684`), which CLI-021 committed. **The C7 gate was
open before a byte was written**, and no allowlist assertion was edited.

**No prettier run, and none needed** (TEST-1007): `.prettierignore:12-14` excludes
`assets/workspace/` — "its bytes are what `corpus init` installs, so Prettier must never rewrap
or re-mark it" — so `format:check`, which globs `.`, is a no-op on both files.

### E2E — the installed skill, and the verb it names (TEST-1008)

Fresh workspace from the current build; no `db rebuild` step, since nothing pre-existed.

```
$ node --import tsx apps/cli/src/bin/corpus.ts init …/s022-agent/009-e2e --port 8806
Initialized Corpus workspace at …/s022-agent/009-e2e
  installed 8 template files, recorded in .corpus/template-manifest.json

$ /usr/bin/diff …/009-e2e/.claude/skills/comment/SKILL.md assets/workspace/claude/skills/comment/SKILL.md
    (no output)                       → IDENTICAL
$ /usr/bin/diff …/009-e2e/.claude/skills/orchestrate/SKILL.md assets/workspace/.../orchestrate/SKILL.md
    (no output)                       → IDENTICAL
```

The *installed* copy's `## Gather context` opens with the verb (pasted from
`…/009-e2e/.claude/skills/comment/SKILL.md`, not the repo path):

````
## Gather context

**Start from the briefing.** One command tells you what the conversation is about and what
else in the corpus bears on it:

```bash
corpus thread context th_4b8e2c
```

That is the default context for every event that reaches this skill, and it is the first thing
you run. …
````

And the verb the skill now names exists and answers, in that same workspace, on a real anchored
thread (server on 8806 from the built bin, seeded with one note and one anchored comment):

```
$ … thread create --parent doc_wgjinulv --quote "recalculated annually under fixed terms" \
      -m "@agent is this still right?" --from user
created th_e2o5i6zh — anchored at anc_21ad0b33 on doc_wgjinulv (queued evt_hezidpcnottg)

$ … thread context th_e2o5i6zh                                                    [exit 0]
parent doc_wgjinulv · Mortgage options · Mortgage options › Escrow

> recalculated annually under fixed terms

## Escrow

The escrow reserve is recalculated annually under fixed terms.

# related excerpts
doc_skill61c2325d     Todos › Reporting back  similar  ## Reporting back Reply in the thread that woke you…
doc_skillcomment      Worked examples         similar  **1 — Anchored comment that edits the parent.** … corpus thread context th_4b8e2c …
doc_skillorchestrate  Stewardship             similar  the git log answers "what did the agent change, and when" completely.
doc_seedattention     Attention               similar  Everything waiting on you, in one column…
```

The second excerpt is the newly-written skill's own worked example, indexed as a `type: skill`
document — the skill telling the agent to run `corpus thread context` is itself in the pack that
verb returns. No degrade note printed (ranking was not degraded), and the parent block carries no
truncation line, so the section shown is the section entire.

```
$ … server stop           stopped (pid 91027)
$ /usr/sbin/lsof -nP -iTCP:8806 -sTCP:LISTEN     (no output — free)
$ /usr/sbin/lsof -nP -iTCP:8765 -sTCP:LISTEN | wc -l
       0                                          → never bound
```

### Deferred / not done

- **No `SPEC.md` edit.** §7's Edit-3 sentence and the context-packs paragraph are signed text and
  already describe this behaviour exactly; this issue implements prose, not spec.
- **No repo-wide suite, no `npm run e2e`, no coverage run.** `scripts/workspace-template.test.ts`
  is the only suite that binds these bytes (C8: the byte-fidelity copy test compares bytes and
  cannot notice a wrong rule), and prettier is excluded from the path. The harvest gate is the
  orchestrator's.
- **The `description` frontmatter was left alone** on both skills, per TEST-1005 — only `updated`
  moved.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
