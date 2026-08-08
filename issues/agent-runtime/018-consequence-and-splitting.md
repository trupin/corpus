# [AGENT-018] Weigh consequence before difficulty; split stages, withhold the gathering context

## Domain

agent-runtime

## Status

done

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: SHARED-023 (signed 2026-08-06; four §7 amendments applied to
  SPEC.md)
- Blocks: —
- Related: AGENT-015 (the weight levels the composer's picker reads, from
  SHARED-022). The two touch the same `## Delegation` region of the orchestrate
  skill and must not be run concurrently without worktree isolation — and
  whichever lands second re-reads the section rather than pattern-matching an
  anchor

## Spec References

- SPEC.md **§7**, Orchestrator skill — "**But weight is judged by consequence
  first and difficulty second**", the two conditions, the "however mechanical it
  looks" consequence, and "**This governs what the orchestrator picks, never a
  weight the request stated**"
- SPEC.md **§7**, same paragraph — "**Work may be split, and its parts need not
  run at the same weight**": material may run lighter, a stage that **decides**
  runs at the governing weight, and splitting binds in **either direction**
- SPEC.md **§7**, Retrieval discipline → "Subagents receive anchors, not
  documents" — "**The same holds between the stages of one piece of work**": a
  stage receives what the previous stage **produced**, not the account of how it
  was produced; each stage briefed as though it were the first; the **quality**
  argument, and the bound that quality decides where the two pull apart
- SPEC.md **§7**, console bullet — "**A job that ran in stages shows every one of
  them**": a dispatch line per stage, in order, each naming its weight and where
  that weight came from
- SPEC.md **§8** — "a directive, not a hint", borrowed by reference through
  SHARED-022. **Not edited**

## Summary

SHARED-023 states the principle; **the behavioural change lives almost entirely
in this skill.** The rider is explicit that it "introduces no contract, server or
UI work at all" — so if any chain issue proposes a schema or endpoint change for
this, it has misread the rider.

Three changes, and the first is a re-ordering rather than an addition.

**Consequence is already in the skill — as one factor of three, averaged in.**
`## Delegation` reads: "Judge weight by three things: how many documents the work
touches, whether the request prescribes the change or asks for a decision, and
the cost of getting it wrong." So this is not a new consideration; it is
**promoting an existing third-of-three into a veto**. The vocabulary exists and
the ranking is wrong. The test SPEC now states is: **not "how hard is this?" but
"what would a bad result do that revising the document afterwards would not
undo?"** Two things make a failure that kind — the output exists to be used
**outside the corpus** (published, sent, handed to someone), or **someone will
decide something real on it** (about a person, about money, about a commitment).
Neither is the ordinary case, and that is the point: the ordinary failure is a
wrong document sitting in the corpus, where noticing it, commenting on it and
revising it is this system working as designed. Where one of the two **does**
hold, the work gets the stronger model **however mechanical it looks** — a
one-line edit to a document about to go out is not small work.

That inverts two rows of the existing table at their edges. The Haiku row's "the
request prescribes the change exactly" needs the exception that carries the whole
point: *not when the result is going out or is going to be decided on*. And the
Opus row's "anything where a wrong answer is expensive to unwind" currently sits
in a list of **difficulty** symptoms beside "cross-document restructuring"; it is
the first pass, not an item.

**Splitting, and what a stage is given.** One request may be done in stages —
collecting the material, or writing a small script to produce it, and then
judging that material and drawing the conclusion. A stage whose output is
**material** (retrieved text, a listing, a mechanical transformation, a script
and what it printed) may run lighter. A stage that **decides** — a conclusion, a
recommendation, the wording of a reply, an edit to a document — may not: those
are the work the request asked for, they carry the consequence, and they run at
the governing weight. The line is drawn at *what a stage outputs* precisely
because "split when useful" is a loophole with a shape: anything can be described
as preparation, and an agent optimising cost will describe more and more of the
work that way until the conclusion itself is "just summarising what the collector
found".

And the context isolation is the reason splitting works, not the price of it: a
stage receives what the previous stage **produced** and not the account of how it
was produced — not the transcript, not the false starts, not the searches that
returned nothing, not the reasoning that got there. Each stage is briefed as
though it were the first. SPEC states this as a **quality** claim, not a saving:
a stage that has to judge does so better on a short relevant input than on a long
one carrying everything an earlier stage happened to look at. Written as pure
frugality — which is how the skill's existing context rule is written — it would
read as a cost tradeoff to be waived whenever quality is on the line, i.e. waived
in exactly the high-consequence cases this exists for. With one honest bound:
where the two pull apart, quality decides — material a later stage genuinely
needs is passed on, and a stage that would otherwise have to guess is briefed
further rather than left short.

**This must not contradict SHARED-022, and the skill has to say how it composes.**
A stated weight is **honoured, never silently substituted — in either direction**,
because running stronger than asked spends against an explicit instruction
exactly as running weaker falls short of one. Consequence governs what the
orchestrator picks **when the request said nothing**. Where a request states a
weight lighter than the consequence calls for, the work is **not** overridden: the
two conditions above are precisely what make proceeding "expensive to unwind", so
the agent **asks first, with a form**, which SHARED-022's standing sentence
already requires. **Asking is not substituting.** And splitting is not a route
around either rule: the deciding stage cannot quietly run lighter than was asked,
and cannot quietly run stronger.

## Acceptance Criteria

- [x] The weight guidance is a **two-pass** rule: consequence first — a test that
      answers **no** for most work and **vetoes** when it answers yes — and
      difficulty second, for everything the first pass did not settle
- [x] The consequence test is stated as SPEC states it: what a bad result would
      do that **revising the document afterwards would not undo**, with the two
      conditions and the **negative** case (a wrong document that stays in the
      corpus is ordinary work)
- [x] Where the test fires, the work takes the stronger model **however
      mechanical it looks** — stated as an instruction, with a concrete instance
- [x] The **Haiku** row's "prescribes the change exactly" carries the exception;
      the **Opus** row's "expensive to unwind" moves out of the difficulty list
      and into the first pass
- [x] The tie-break survives, **scoped**: "in doubt between two tiers, take the
      stronger" governs what the orchestrator picks for itself, and is second to
      the consequence test — not deleted as redundant
- [x] **Splitting** is written into `## Delegation`: when to consider stages,
      that it is always permitted and never required, and which stage carries the
      weight (material may run lighter; a stage that **decides** runs at the
      governing weight)
- [x] **A stage is handed the previous stage's product, never its transcript**,
      extending the existing "A dispatch carries anchors, not documents" rule —
      with the **quality** argument stated, not only the saving, and with the
      bound that a stage which would have to guess is briefed further rather than
      left short
- [x] **Neither rule is a route around SHARED-022**: a stated weight is honoured;
      the deciding stage runs neither lighter nor stronger than stated; where
      consequence outruns a stated weight the agent **asks with a form** rather
      than substituting
- [x] The **dispatch log line covers stages**: one line per stage, in order, each
      naming its weight and where that weight came from. One job, one status, one
      reply, whatever it took internally
- [x] `## Reflecting on a user edit`'s ad-hoc escalation ("Sonnet by default and
      **Opus 5** when step 4 is going to write another document") is either
      re-expressed as an instance of the general test or deleted as subsumed —
      not left as a second, competing rule
- [x] **No model names leave the skill.** SPEC's "model names live in the skill,
      not here" is untouched; this issue adds none to SPEC and changes no schema,
      endpoint or UI
- [x] `scripts/workspace-template.test.ts` passes, section count included

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — `## Delegation`
  (the dispatch-carries-anchors paragraph and the weight table around L202-241),
  `## Reflecting on a user edit` (the tier sentence, ~L304-305), and
  `## Progress and job logs` (the dispatch line, ~L540-541); plus the frontmatter
  `updated` timestamp
- `scripts/workspace-template.test.ts` — the assertions that move with it

The directory is `assets/workspace/claude/…`, without the dot; the `.` is added
at install time. **SHARED-023's cited line numbers have drifted** (it cites
SKILL.md:238-240, :300, :204, :220-227, :256) — the locations above were
re-verified against the file. Re-read before editing; do not seek by line number.

### The skill-file constraints that have bitten repeatedly

Enforced by `scripts/workspace-template.test.ts`, and **verified against the file
today** — a remembered count has been wrong before:

- **Exact section counts**: `expect(sections.size).toBe(16)` for orchestrate
  (~L457-474), `toBe(13)` for the comment skill (~L836-858). Adding a `## `
  section here is a two-file change.
- **Every `## ` section body must exceed 400 characters** after trimming.
- **Orchestrate's counter is NOT fence-aware** (the comment skill's is). A `## `
  line inside a fenced block in this file **breaks the count**. Worked examples
  and dispatch-prompt samples are exactly where that mistake gets made.
- **Required headings** are checked by lowercased substring and include
  `delegation`, `job logs` and `user edit` — the three sections this issue
  touches. They may be reworded only if those words survive.
- **Forbidden prose.** Both skills ban the hedges `use your judgment`, `consider
  whether`, `you may want`, `if appropriate`. This one bites hard here: SPEC's
  own text says "whether work divides cleanly is a judgment", and transcribing
  that register produces a banned phrase. The skill must **instruct** — say what
  to do and when — rather than describe a consideration.
- Orchestrate also bans `SPEC.md`, `CLAUDE.md`, `issues/`, `/implement`,
  `/decompose`, `while true`, `setTimeout`/`setInterval`, `deferred:` and the
  literal `**3**`, and allows the word "sleep" **exactly once**.
- Every multi-line shell argument uses a quoted heredoc (`/^<<'EOF'$/`); `-m "$(`
  is banned.
- **`EXPECTED_TREE` is exhaustive equality** — no new files under
  `assets/workspace/` without updating it. (The agents directory holds only a
  `.gitkeep`; this issue adds no persona file.)

### Key Implementation Details

**The re-ordering is the deliverable.** The failing outcome for this issue is a
skill that mentions consequence in a new paragraph while the table and the
"judge weight by three things" sentence keep sending prescribed one-document
edits to the lightest tier. The single test that proves the change landed is
mechanically trivial work with a costly failure: a one-line prescribed edit to a
document that is about to go out must dispatch **strong**, with the dispatch line
naming **consequence** as the reason.

**Keep the negative case load-bearing.** A test that fires on everything changes
no dispatch. The skill has to make "does this apply to the task in front of me?"
answer **no** for ordinary work — an ordinary reply, an inbox capture retitle, a
doc-edit reflection — and the guidance should say so with those examples, not
only with the positive ones.

**Splitting is permission, never obligation.** Do not write it as a requirement
above some threshold: a split introduces a handoff, handoffs lose things, and for
genuinely entangled work a single strong pass beats two stages with a summary
between them. What *is* obligatory once split is everything around it — which
stage carries the weight, what a stage receives, that the split is visible, and
that one request stays one piece of work with one reply.

**The log needs no new plumbing.** Subagents already log against the dispatching
event's job id, so a split job is already one log. The change is that the skill
emits a dispatch line **per stage** rather than one per job.

### Edge Cases

- A **stated strong** weight on a splittable request — the deciding stage runs at
  the stated weight; a collecting stage may run lighter; the log shows both. A
  run that puts the *deciding* stage lighter than stated is a failure
- A **stated light** weight on a splittable request — **no** stage runs stronger.
  Splitting is not a back door to a silent upgrade
- A stated light weight on high-consequence work — not upgraded; a **form** is
  asked first; answering "proceed anyway" runs it at the stated weight with no
  substitution anywhere
- A stated weight that **cannot be honoured** (the model is not offered, the
  setup refuses it) — unchanged from SHARED-022: the work is still done at what
  the orchestrator judges best, and the deviation is stated in the job log **and**
  in the reply
- Heavy-looking work whose failure is ordinary — a large in-corpus restructure
  nobody is waiting on. Difficulty still raises it; the log's stated reason must
  distinguish that from consequence having raised it
- A split that should not have happened — entangled work where a stage would have
  to guess. The rule is briefed further, not starved

## Testing Strategy

`scripts/workspace-template.test.ts`, in the register the file already uses:
assert that the consequence test appears **before** the difficulty factors, that
the two conditions and the negative case are stated, that the Haiku row carries
the exception, that splitting states which stage carries the weight, that the
stage-context rule states the quality argument, that the either-direction
prohibition is present, and that the dispatch-line guidance is per stage. Keep
the existing weight-table assertions (~L579-586) alive in updated form.

The behavioural claims are the E2E plan's, not a unit test's — a skill is prose,
and asserting that prose exists is not asserting that it works.

## E2E Verification Plan

### Verification Steps

Verify through the installed product, not the source tree:

1. `corpus init` a scratch workspace on a non-default port from the built
   package; confirm the orchestrate skill landed with the new guidance.
2. Start the real server and the agent loop.
3. **The proving test**: file a request that is mechanically trivial and
   high-consequence — a one-line, exactly-prescribed edit to a document that is
   about to go out. Read the job log: the dispatch must name the **strong** tier
   and give **consequence** as the reason. Today's rule would send this to the
   lightest tier.
4. **The negative**: an ordinary reply and an inbox capture retitle. Dispatch
   weight unchanged from today. If the consequence test fires here it was drawn
   too wide.
5. **The mirror**: a large in-corpus restructure nobody is waiting on. Difficulty
   raises it; the stated reason is difficulty, not consequence.
6. **The collision**: state a light weight on high-consequence work. The work is
   **not** silently upgraded; a form is asked first; the console shows the stated
   weight and the ask. Answer "proceed anyway" and confirm it runs at the stated
   weight with no substitution.
7. **A split**: a request that divides into gathering and judging. Read one job
   log with N dispatch lines in order, each naming weight and provenance, one
   status and one reply. Confirm the second stage's brief carries the first
   stage's **output** and none of its transcript — no search queries, no
   discarded paths, no narration.
8. **The abuse case**: confirm a run that puts the deciding stage lighter than a
   stated weight fails this test rather than passing quietly.
9. `corpus doc check` and `corpus db doctor` clean; stop the server.

## E2E Verification Log

### Post-Implementation Verification

**Implementing model: Opus 5 (1M context) — `claude-opus-5[1m]`.** The loop under
test ran on a separate live `claude` session (`--model opus`), which chose its own
subagent models; those choices are the evidence below.

**Setup — through the installed product, not the source tree.**

```
npm run build && npm run package:build          # corpus@0.4.0 staged in dist-package/
cd /tmp/a18 && npm pack /Users/…/corpus/dist-package && npm install ./corpus-0.4.0.tgz
corpus init ws --port 9765                      # scratch port; 8765 and 5173 never bound
corpus server start                             # pid 44106 on :9765
```

`grep` on the **installed** `/tmp/a18/ws/.claude/skills/orchestrate/SKILL.md`
confirmed the new guidance shipped (`First pass —` L255, `Second pass —` L279,
`Splitting is always permitted` L325, `The anchors rule above holds between the
stages` L334, the three dispatch-line shapes L734–738).

Seeded: `doc_iuqy7e2x` a **Northbank lender letter** whose body says it goes out
tomorrow, `doc_vgos6uyq` an ordinary mortgage note, `doc_qslsjlll` an inbox
capture, `doc_5uwyjmef` an overgrown in-corpus reference, `doc_lw6m64to` spend
notes. Six requests were filed as real threads (`--requests-agent true`).

**The loop.** One live session, `claude -p "Invoke the /orchestrate skill …"
--output-format stream-json --verbose --allowedTools "Bash Task Read Write Edit
Glob Grep TodoWrite" --model opus`, transcript captured to
`/tmp/a18/transcript.jsonl` (ephemeral; every load-bearing line is reproduced
verbatim below). It loaded the skill, `reap-stale`, `claim-all` (6 events,
`inProgress` empty), read each thread **before** dispatching, and dispatched
through the Task tool in the background, one subagent per event.

**3 — The proving test.** Mechanically trivial, high-consequence: a one-line,
exactly-prescribed edit to a document about to go out. Today's rule would have
sent this to the lightest tier.

```
## evt_q7jjkgkjfab7
   claimed comment.created on th_v42vmyeb (parent doc_iuqy7e2x)
   dispatched to a comment-skill subagent (Opus 5 — judged, consequence: the edited
     sentence is in [[doc_iuqy7e2x]], signed and going to Northbank tomorrow morning)
   read [[doc_iuqy7e2x]] whole; staging the single-sentence rate correction …
   edited [[doc_iuqy7e2x]] — one sentence only, 4 characters changed; anchor
     anc_e6cc8530 remapped and still resolving; ran on claude-opus-5
   completed — [[doc_iuqy7e2x]] now reads 6.4% as of 2026-07-28, rest of the letter
     byte-identical, anchor anc_e6cc8530 still resolves; replied on th_v42vmyeb
```

The strongest tier, and the dispatch line names **consequence**. The
corresponding Task call carries `model: "opus"`. `corpus doc show doc_iuqy7e2x`
confirms exactly the prescribed sentence changed and the anchor still resolves.

**4 — The negatives.** Both answered **no** on the first pass and stayed light:

```
## evt_jsdm57wuttle   (inbox capture retitle-and-file)
   dispatched to a comment-skill subagent (Haiku — judged, difficulty:
     retitle-and-file an inbox capture, [[doc_qslsjlll]])
## evt_snb4vzvqedbj   (ordinary factual reply)
   dispatched to a comment-skill subagent (Haiku — judged, difficulty:
     one document, a factual read of [[doc_vgos6uyq]])
   completed — replied on th_eyccf67f with the 6.4% assumption; nothing changed
```

The consequence test did not fire on ordinary work; the negative case is real.

**5 — The mirror.** Heavy in-corpus work nobody is waiting on. Same tier as the
proving test, **different stated reason** — which is exactly what the per-stage
grammar exists to keep distinguishable:

```
## evt_knwhjgnpsesf
   dispatched to a comment-skill subagent (Opus 5 — judged, difficulty: a split of
     [[doc_5uwyjmef]] into several documents with refs, a trim to a hub, and moves
     into finance/)
   split [[doc_5uwyjmef]] into [[doc_aeylp3gg]], [[doc_7g3vpl46]], [[doc_fbctl3mz]]
     — all home/; no anchors orphaned
```

**6 — The collision.** A stated *light* weight on high-consequence work. Not
upgraded, not downgraded — **asked**, with a form, before any dispatch:

```
## evt_73h3dhhcxr52
   asked before dispatching — the request states the smallest model, and the insertion
     goes into [[doc_iuqy7e2x]], the signed Northbank letter going out tomorrow; I
     would otherwise have run it at Opus 5 on consequence
   posted a form on th_i6rb7yj6 asking which model should write it; the answer returns
     as its own form.respond event
```

The turn it posted on `th_i6rb7yj6` carries the prose commitment plus a two-field
` ```form ` fence ("Smallest and fastest, as I asked — proceed" / "Strongest
model, since the letter is going out"). Answering *proceed anyway* as the person
(`POST /api/threads/th_i6rb7yj6/turns/2026-08-08T21:51:00Z/form`,
`x-corpus-author: user` — there is no CLI verb for answering a form, it is a
composer action) enqueued `evt_wlfth6fgofva`, which the same running loop claimed
and dispatched at the **stated** weight with no substitution anywhere:

```
## evt_wlfth6fgofva
   claimed form.respond on th_i6rb7yj6 — answered 'Smallest and fastest, as I asked
     — proceed'; placement field left blank, which is a complete answer
   dispatched to a comment-skill subagent (Haiku — stated by the request, reaffirmed
     after the consequence ask on evt_73h3dhhcxr52)
```

All three dispatch-line provenances observed in one run: `judged, consequence`,
`judged, difficulty`, `stated by the request`.

**8 — The abuse case.** The deciding stage never ran lighter than stated: the one
job with a stated weight ran at exactly that weight, and the one job with a
costly failure ran at the top tier. A run that put the deciding stage lighter
than stated would have shown a `Haiku — stated by the request` line on
`evt_q7jjkgkjfab7`, which it does not.

**The Task calls corroborate the log lines**, independently of what the agent
wrote about itself — the `model` argument on each of the six dispatches:

```
haiku  Answer rate question            (negative — ordinary reply)
haiku  File insurance screenshot       (negative — inbox retitle-and-file)
opus   Correct Northbank letter rate   (THE PROVING TEST — one prescribed line, going out)
opus   Split household reference       (mirror — difficulty)
haiku  Insert sentence in letter       (collision — the reaffirmed stated weight)
opus   Reconcile finance figures       (cross-document sweep — difficulty)
```

**CLI-only invariant, measured from the transcript** rather than asserted: tool
counts across the whole session were `{Skill: 7, Bash: 94, Agent: 6, Read: 1}` —
**zero `Write`/`Edit`/`NotebookEdit` calls**, zero `corpus lock break`, zero
direct HTTP to `127.0.0.1:9765`. `Write`/`Edit` were in the allowlist precisely
so the invariant would be tested rather than enforced by the harness.

**Not verified, and why.**

- **Step 7, a live split with N dispatch lines, did not happen — and the reason
  is the rule working, not the rule failing.** `evt_4s2i3jarpqiv` was the
  designed-to-split request (gather every rate in `finance/`, then judge which
  disagree and call the current truth). It was first **held for ordering** — "a
  sweep of the finance folder has a touched set the payload does not name, so it
  runs after the rest of the batch", the correct call, since three other events
  were writing into `finance/` — and when it finally went out the loop chose
  **one strong pass**:

  ```
  ## evt_4s2i3jarpqiv
     claimed comment.created on th_y6ahrqeb (standalone)
     held for ordering — a sweep of the finance folder has a touched set the payload
       does not name, so it runs after the rest of the batch
     dispatched to a comment-skill subagent (Opus 5 — judged, difficulty: a
       cross-document sweep of the finance folder, reconciling figures that disagree
       and calling which is current)
  ```

  That is the branch the skill explicitly licenses — "Splitting is always
  permitted and never required… for entangled work one strong pass beats two
  stages with a summary between them" — and gathering the figures here is not
  separable from judging which one is current, so the choice is defensible rather
  than an evasion. What this run therefore did **not** exercise: a job log
  carrying several dispatch lines in stage order, and a second stage briefed on
  the first's output with none of its transcript. Those remain asserted only by
  `scripts/workspace-template.test.ts` over the skill text. Worth re-testing under
  AGENT-015 with a request whose gathering half is genuinely mechanical (a script
  and what it printed), which is the shape SPEC names and this scenario was not.
- **A stated weight has no transport yet.** SHARED-022's picker and payload field
  are AGENT-015/UI-082 work; the weight in the collision case was stated in the
  request's prose, which is the only channel that exists today. The composition
  rule is written to be indifferent to how the weight arrives.

**9 — Teardown.** `corpus doc check` clean, `corpus db doctor` clean, server
stopped, port 9765 released.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-018]` prefix
