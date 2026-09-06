# [AGENT-068] The skills read whole documents the CLI can slice

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-076** (the thread half needs `--index` / `--last` /
  `--turn` to exist)
- Related: CLI-055 (built the document half a fortnight ago), AGENT-051 (the
  precedent — when CLI-064/065 shipped, a dedicated issue taught the skills to
  use them; nothing did that for CLI-055)

## Spec References

- SPEC.md **§7** — retrieval discipline: reading is bounded on purpose
- **CLAUDE.md Architecture Decision 2** — the agent works only through the CLI

## Summary

Measured 2026-09-05 across
`assets/workspace/claude/skills/*/SKILL.md` and their references:

- `corpus doc show` appears **41 times** — the most-instructed verb in the
  product.
- `--headings` appears **0 times**. `--section` appears **0 times**.

CLI-055 shipped the bounded document read on 2026-08-21 with a measured 175×
saving, precisely so that a patch-shaped change never pays for a whole body.
Two weeks later, no skill has ever told an agent it exists. The orchestrate
skill's own invariant 6 ends every retrieval at *"a separate, deliberate act:
`corpus doc show <id>`"* — the whole document, every time.

When CLI-064/065 shipped, AGENT-051 was filed the same day to make the skills
collect the saving. CLI-055 got no AGENT-051, and this issue is it — plus the
same adoption for CLI-076's thread reads, which would otherwise repeat the
identical miss.

**Measured, per event, on a seeded 0.32.0 workspace** (19-turn thread, 3,500-B
parent):

| Read | Today | Bounded |
| --- | --- | --- |
| thread (context + show) | 3,272 + 17,635 B | 3,272 + ~1,500 index + ~2,600 last-3 |
| parent document | 4,104 B whole | 35 headings + 2,295 section |
| **event total** | **~25,100 B (~6,300 tok)** | **~9,800 B (~2,500 tok)** |

The real `cos` thread that prompted Phase 57 is 32,375 B, so the real-world
today column is ~40 KB per event. This issue is where Phase 57's CLI work
actually starts saving tokens: **a bounded read nobody is instructed to make
saves nothing.**

## What to change

In `comment`, `converse` and `orchestrate` (and `profile` where it reads):

1. **The document read forks on the write it feeds.** Before a patch-shaped
   change: `doc show <id> --headings`, then `--section "<path>"`, then
   `doc patch` quoting from the section — never the whole body. Before a
   whole-body `doc edit`: the full read, exactly as today, because a rewrite
   needs everything and the `--key` comes from that read. The skills already
   distinguish patch-shaped from rewrite-shaped work — the fork attaches to a
   distinction they draw, it does not add one.
2. **The thread read starts at the index.** `thread show <id> --index`, then
   verbatim fetches of the turns the work needs (`--last <n>`, `--turn <n>`).
   The whole-thread read remains for the case that genuinely needs every turn,
   and the skill says what that case is instead of leaving it the default.
3. **The quoting invariant travels with both**: what is patched or quoted is
   fetched verbatim first (`--section`, `--turn`) — CLI-055 and CLI-076 built
   byte-exact outputs for exactly this, and search snippets and index excerpts
   remain non-quotable, as the skills already say of snippets.
4. **`corpus search` composes in**: its `headingPath` is what `--section`
   accepts (CLI-055's decision 2) — a search hit goes straight to a section
   read without a whole-document stop in between. Say so where invariant 6
   sends the reader to `doc show`.

## What must not change

- **The full-read-before-rewrite rule.** The comment skill's warning is
  correct and stays: rewriting a parent from its section alone deletes the
  rest of the document.
- **Anchor resolution reads.** Anchors resolve server-side against the current
  body; where a skill reads a document to see anchor state, the bounded forms
  do not answer that and the skill must not pretend they do.
- **INFRA-038's anti-gaming rule.** These instructions land in the sections
  agents already read, sized to replace what they amend — not as a new
  always-read reference file.

## Acceptance Criteria

- [x] Every `doc show` instruction in the four skills either reads a section
      path or states why that site needs the whole body. Zero unexplained
      whole-body reads remain. _(Verified by grep and read; the surviving whole
      reads and their stated reasons are listed in the E2E log.)_
- [x] Every `thread show` instruction starts at `--index` or states why not.
      _(One deliberate exception, measured: the `form.respond` parent
      re-derivation keeps the bare read because the `--index` header does not
      print the parent — the skill now says so in as many words.)_
- [x] The byte-exact quoting rule is stated once per skill and cited at the
      patch and reply sites. _(`comment` states it at the patch grammar and
      cites `--section` at the quote bullet; `orchestrate` states it at its
      patch grammar; `converse` binds the whole turn grammar by reference to
      `comment` and slices in its own invariant 6.)_
- [x] The skills grow by less than they direct readers to save — net change
      recorded: **comment −24 B, converse −29 B, orchestrate −4 B, profile 0 —
      total −57 B** (cap was +500 B). Every addition displaced prose of at
      least its own size, per INFRA-038's anti-gaming rule.
- [x] `workspace-template.test.ts` guards updated. _(New AGENT-068 describe with
      three wording guards, marked as wording guards; two existing pins updated
      to the new text, none deleted.)_
- [x] One `comment.created` handled end-to-end on a seeded workspace with the
      new instructions, its reads logged, and the per-event total recorded
      against the ~25,100 B baseline above. _(See the E2E log: 3,751 B of
      instructed reads on the seeded fixture, and a baseline-shaped 19-turn
      thread measured at 19,218 B whole vs 5,028 B index + last-3.)_

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md`
- `assets/workspace/claude/skills/converse/SKILL.md`
- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/profile/SKILL.md` (audit; amend only if it
  instructs reads)
- `scripts/workspace-template.test.ts`

### Key Implementation Details

**Sequence against AGENT-067.** That issue rewrites orchestrate wholesale. Land
this one's orchestrate edits either before it (small, surgical — the rewrite
carries them forward) or fold them into its brief explicitly. Decide with the
orchestrator at dispatch time and record which; do not let the two race on the
same file (worktree isolation if parallel).

**The rehearsal harness covers regressions** (INFRA-033/034): scenarios that
exercise comment work must still pass — a skill that now under-reads and
patches the wrong section would surface there, not in wording guards.

### Edge Cases

- A document with no headings: `--headings` prints nothing useful and the
  whole read is correct. The instruction says so.
- Duplicate heading paths: CLI-055 decision 4 governs; the skill defers to the
  verb's own failure rather than restating it.
- A workspace running an older CLI (upgrade lag): the flags exist since
  v0.20.0 — confirm the version floor and state it, or drop the concern with a
  sentence.

## Testing Strategy

- Wording guards for the fork rule and the index-first rule, marked as wording
  guards per CLAUDE.md's standing caveat.
- The rehearsal suite, unchanged, as the behavioural check.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace with the amended skills; seed the Phase 57
   fixture shape (19-turn thread, sectioned parent).
2. Drive one `comment.created` through a real agent session following the
   comment skill; capture the commands it ran from the job log.
3. Sum the bytes of its reads; record against 25,100 B.
4. Verify the patch it made quoted section-fetched bytes.

## E2E Verification Log

Implementing agent: agent-runtime-dev, ran on **Fable** (claude-fable-5), 2026-09-05.

### Flags verified against the real CLI first

`node apps/cli/dist/bin/corpus.js doc show --help=brief` → `--headings`,
`--section <heading-path>`, `--nth <n>`; `thread show --help=brief` →
`--index`, `--turn <n|ts>`, `--turns`, `--last <n>`, `--since <iso>`
(exclusive). Both byte-for-byte promises are the help text's own words.
`corpus search` prints the heading path as its second column (verified live:
`doc_m72vwiwv  Rates  …`), so a hit's `headingPath` really is what `--section`
accepts. `corpus batch` accepts a flag inside an entry:
`[["thread","show","<id>","--index"]]` ran as one invocation.

### The read fork, as landed

- **comment**: invariant 6 teaches the sliced read; the escalation bullet
  slices (`--headings` then `--section`, whole where a document has no
  headings); the quote bullet cites the byte-exact `--section` read; the patch
  example reads `--section "Rates"`; the opening batch is
  `[["thread","context",…],["thread","show",…,"--index"]]` with `--turn
  <turnTs>` / `--last <n>` fetches and the whole-thread case named (a reply
  that must square with the whole history). The rewrite bullet is untouched:
  the full read stays, with the key, and "rewriting a parent from its section
  alone deletes the rest of the document" is now test-pinned.
- **converse**: invariant 6 slices; startup hydrates `--index` then `--last`;
  the loop's ordering read is `--index`; the return-to-thread read is
  `--since <ts of your last read>`; the retirement header read is `--index`
  (measured: the index header prints the status). The persona read stays whole
  — "what it says binds you for as long as you hold this lane" is the stated
  reason a map cannot answer it.
- **orchestrate**: invariant 6 slices and names `headingPath` as the
  `--section` address; the launch read is `--index` plus `--turn 1`; the patch
  procedure and worked example read `--section "Rates"`; the whole-body-edit
  and revert sites keep their whole reads with the key as the stated reason;
  the board read states why it is whole (`columns` is frontmatter, outside
  every section). The subagent-rules restatements defer to invariant 6, which
  "crosses the subagent boundary intact".
- **profile** (audited, unamended): its one read —
  `corpus doc show <id>` on a name-collision — is followed by "say what it is
  for", which no heading map answers; the whole read is the explained right
  one, and profile sits exactly at its ratchet baseline, so a no-value edit
  was not made.

### Post-Implementation Verification (the measured event)

Workspace: `corpus init` scratch on port **8975**, real server, skills
installed by the installer (and `corpus workspace upgrade` verified to carry a
later template edit in — it rewrote exactly the one changed file). Seeded: a
sectioned parent (`doc_m72vwiwv`, four sections, ~2.1 KB), an anchored thread
`th_4dval5as` grown to 18 turns, then one user ask ("update the rate assumption
to 6.4%") enqueued as `evt_cbw5wzcyzvuo`.

Worked by hand, running exactly the commands the amended comment skill
prescribes, reads captured to files and summed:

| read | bytes |
| --- | --- |
| `corpus batch` (thread context + `thread show --index`) | 2,813 |
| `thread show --turn 2026-09-05T22:12:56Z` | 156 |
| `thread show --last 3` | 343 |
| `doc show doc_m72vwiwv --headings` | 34 |
| `doc show doc_m72vwiwv --section "Rates"` | 405 |
| **event total** | **3,751 B** |

The patch quoted the section read's bytes and landed first try:
`corpus doc patch doc_m72vwiwv --old '6.1% as of 2026-05-02' --new '6.4% as of
2026-07-28'` → `patched doc_m72vwiwv — 1 occurrence replaced — 2 anchors
remapped`, then the reply with its trace line and `queue complete` (exit 0,
next-step line printed).

**Against the 25,100 B baseline.** The seeded thread's turns were smaller than
the Phase 57 fixture's, so the same-fixture whole-read column here is 4,881 B
(context 701 + whole thread 2,128 + whole doc 2,052) — the bounded run reads
77% of it, dominated by the bounded-anyway context pack. To measure the
thread half at the baseline's scale, a second thread was seeded at the
fixture's shape — 19 turns, ~1 KB each, whole `thread show` = **19,218 B**
(the baseline's 17,635 B column) — where the instructed reads cost **2,024 B
(`--index`) + 3,004 B (`--last 3`) = 5,028 B**, matching the baseline table's
bounded column (~1,500 + ~2,600). The document half measured 439 B
(`--headings` + `--section`) against 2,052 B whole. The instructed reads land
the event at the issue's Bounded column on the shape it was measured on.

Server stopped cleanly both times; port 8975 free at the end.

### Edge cases and lag, settled

- No headings: stated in `comment` ("a document with no headings has no map,
  and is read whole").
- Duplicate heading paths: `--nth` exists and the skills defer to the verb's
  own refusal — nothing restated.
- Version floor: the flags shipped in v0.20.0 (`doc show`) and this branch
  (`thread show`); a workspace runs the skills its own `corpus init`/`upgrade`
  installed, so skill text and CLI travel together and no floor sentence is
  needed.

### Sequencing against AGENT-067 (decision, recorded)

The orchestrate edits here are **surgical** — invariant 6's tail, one launch
parenthetical, the patch/worked-example reads, two displacement trims — landed
**before** AGENT-067's wholesale rewrite. AGENT-067 carries them forward: its
brief should treat the sliced-read invariant and the `--section`-quoting
examples as fixed points of the text it restructures. Recorded here per the
issue's dispatch note; the two did not race on the file.

### Sizes (all touched skills, before this pair of issues → after)

| file | before AGENT-065 | after both | net |
| --- | --- | --- | --- |
| `converse/SKILL.md` | 64,952 | 64,111 | −841 B |
| `converse/references/leaving.md` | — | 6,514 | new, read at an ending |
| `orchestrate/SKILL.md` | 139,824 | 139,798 | −26 B |
| `comment/SKILL.md` | 41,132 | 41,108 | −24 B |
| `profile/SKILL.md` | 18,972 | 18,972 | 0 |

`npm run skills:check` green; the ratchet baseline was lowered
(`--update-baseline`) to lock every shrink in, and no entry was raised.
`workspace-template.test.ts` + `skill-budget.test.ts`: **612 passed, 0
failed**. ESLint and Prettier clean on every touched file.

## Completion Checklist (domain agent)

- [x] Zero unexplained whole reads, both kinds, verified by grep and read
- [x] Net skill-size change recorded
- [x] `/lint` passes _(ESLint + Prettier on touched files; `tsc` is CI's)_
- [x] E2E log with the measured event total
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Sequencing against AGENT-067 decided and recorded
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-068]` prefix
