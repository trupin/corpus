# [AGENT-020] Noting a change writes to the document's changelog, not a new thread

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-025 (the §5/§7/§11 rider — **must be signed before this lands**)
- Blocks: UI-089

## Spec References

- SPEC.md **§7** — stewardship: what the agent does when it notices a change
- SPEC.md **§5** — the document model (where a changelog section lives)
- SPEC.md **§11** — collapse: "anything that can be shown can be collapsed"

## Summary

**Requested by the user, 2026-08-07**: *"Anytime an agent takes note of a
document change, it opens a new thread. I'd like the agent to take note of those
changes without creating a new thread each time. Maybe we could annotate
documents with a changelog at the end, maintained by the agent, and I could
choose to comment on it if I want."*

The cost of the current behaviour is that an open thread stops meaning anything:
a corpus accumulates threads nobody needs to answer, so the ones that **do** want
an answer are buried among them.

## The rule, decided

**User decision, 2026-08-07**, chosen against two alternatives:

**A thread means "I need something from you." The changelog means "I noticed."**

- Every observation about a change the agent notices — routine **or**
  worrying-looking — goes to the document's changelog.
- A thread is opened **only** when the agent cannot proceed without a decision
  from the person, and when it does, it asks with a **form** (§7, AGENT-017).

The rejected middle option also opened a thread for changes the agent judged
consequential. It was declined because "consequential" is the agent's own
judgment, and the threads this issue exists to remove would come straight back
through it.

**The accepted cost, stated so nobody re-litigates it later**: an observation the
agent found worrying but had no question about lives only in the changelog, and
a person who never reads the changelog never sees it. That is the trade the
user made knowingly.

## Growth

**User decision, 2026-08-07**: the changelog keeps a bounded number of recent
entries visible and **folds** older ones — it does not drop them. Git holds the
full history regardless, so nothing is lost either way; the fold is what keeps
the document readable, which is the whole reason for putting the log in the
document rather than somewhere else.

Dropping entries outright was declined: a document that silently loses history
is a shape this project has been burned by more than once.

## What is already true, and must not be re-derived

- **The loop cannot feed itself.** `apps/server/src/edit/sessions.ts:10` is
  explicit — the `doc.edited` event is actor-scoped and `SESSION_ACTOR` is
  `"user"`. The agent writing a changelog entry enqueues nothing, so there is no
  risk of it waking itself. Do not add a guard for a loop that cannot happen.
- **Anchors are safe.** The changelog appends at the end of the body, so it
  shifts no earlier offsets and no existing anchor moves.
- **No new machinery is needed to write it.** The agent already edits documents
  through the CLI. This is a stewardship rule and a format, not a new write path.

## Acceptance Criteria

- [x] Noticing a change writes an entry to the document's changelog and **does
      not** open a thread
- [x] A thread is still opened when the agent needs a decision from the person,
      and it asks with a form (§7)
- [x] The changelog is a section at the **end of the document body**, so it is
      ordinary content: commentable, anchorable, searchable, and editable by the
      person like anything else. The person commenting on it is an ordinary
      anchored thread and needs nothing special
- [x] An entry says **what changed and what the agent made of it** — the note is
      the value, since git already holds the diff. An entry that only restates
      the diff is worse than no entry
- [x] Older entries **fold** rather than disappear; the fold says how many are
      inside, the way §11 requires every collapse to report its whole size —
      _the skill's half only_: it is told never to prune, and that the reader
      clips past a threshold and says how many are behind the control. Rendering
      the clip is UI-089, which this issue blocks
- [x] The agent **appends** rather than rewriting the section, so a person's own
      edits inside the changelog survive
- [x] The skill states that the changelog is the agent's to maintain and the
      person's to edit — neither owns it exclusively
- [x] `scripts/workspace-template.test.ts` passes and pins the rule

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` and/or
  `assets/workspace/claude/skills/comment/SKILL.md` — whichever owns the
  reflect-on-a-user-edit behaviour (`## Reflecting on a user edit`, orchestrate
  ~L298), plus the frontmatter `updated` timestamp
- `scripts/workspace-template.test.ts`

### The skill-file constraints that bite

**Re-verify these rather than trusting the numbers** — they have moved:

- Exact section counts: **16** for orchestrate, **13** for comment. Adding a
  `## ` section is a two-file change; prefer editing in place.
- **The orchestrate counter is NOT fence-aware.** A `## ` line inside a fenced
  block in that file *will* be counted. This matters here: a worked example
  showing a changelog section would naturally contain `## Changelog` inside a
  fence, and that would break the count. The comment skill's counter *is*
  fence-aware.
- Every `## ` section body must exceed **400 characters** after trimming.
- Forbidden prose: `use your judgment`, `consider whether`, `you may want`,
  `if appropriate`, and the strings `SPEC.md`, `CLAUDE.md`, `issues/`.
- Heredoc mechanics: quoted heredocs for multi-line shell arguments; `-m "$(`
  banned.
- `EXPECTED_TREE` is exhaustive equality.

### Notes

- **Do not invent a parallel store.** The point of the request is that the log is
  *part of the parent document*. Frontmatter, a sidecar file, or a `.corpus/`
  record would all defeat it.
- Decide the heading's exact spelling once and pin it, or the agent will drift
  between spellings and the fold will not find its own section.
- **Interaction with AGENT-019** (the loop block) — both edit skill files under
  `assets/workspace/`. Sequence them rather than running them concurrently.

## Testing Strategy

`scripts/workspace-template.test.ts` is the surface — the skill is prose. Pin the
rule (changelog for noticing, thread only when something is needed), the section
spelling, and the append-not-rewrite instruction.

## E2E Verification Plan

Verify through the product, not the repo:

1. `corpus init` a scratch workspace from the built package on a non-default port
   (**never 8765**, **never 5173**); confirm the skill installed.
2. Start the real server and the agent loop.
3. Edit a document as the person and let the edit session end. **Expected: a
   changelog entry appears at the end of that document, and no new thread.**
4. Edit it again. **Expected: a second entry appended, the first intact, still
   no thread.**
5. Comment on a changelog entry. Expected: an ordinary anchored thread.
6. Drive enough entries to cross the fold threshold; confirm older ones fold
   and the fold names how many.
7. `corpus doc check` and `corpus db doctor` clean; stop the server.

## E2E Verification Log

**Model: Opus 5 (1M context).** Run 2026-08-07 on branch
`phase-18-isparent-changelog-anchors`.

### What changed

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
  - `## Reflecting on a user edit` step **4** was "Update or comment, and lean to
    commenting" and is now "Update, log, or ask, and lean to logging" — three
    outcomes, only the third of which is a thread, and the ask names the form.
  - Step **5** was "Acknowledge on the document's own surface", which opened one
    whole-document thread per substantive edit. It is now "Write the entry, and
    open no thread", with the rule, the reason, the entry contract, the
    append-not-rewrite mechanics, the anchor check, the lock/defer path, and the
    never-prune rule. The `corpus thread create --parent doc_a1b2c3` acknowledgment
    is gone from the file entirely (asserted).
  - The section's worked example now ends in two appends and a job log saying no
    thread was opened, instead of an acknowledgment thread carrying a trace line.
  - `## Stewardship` gained the charter bullet, and "every change is stated in the
    reply" now says where the statement goes when there is no reply.
- `assets/workspace/claude/skills/comment/SKILL.md` — `## Stewardship in service of
  a thread` gained the same rule scoped to a subagent working a thread.
- `scripts/workspace-template.test.ts` — orchestrate's section counter is now
  fence-aware (the comment skill's already was, for the same reason: a `## Changelog`
  line inside a heredoc is that document's content, not a section of the skill).
  `sections.size` stays **16** / **13**, re-derived by a real CommonMark parser
  (`mdast-util-from-markdown`: 16 and 13 top-level `depth: 2` headings, 13 and 12
  code blocks, **zero** ending anywhere but on a fence line). Nine new assertions
  for orchestrate, one for comment; the acknowledgment-thread test is deleted.

### The E2E, and what it corrected

Real workspace on **port 8791** (never 8765, never 5173), scaffolded by `corpus init`
from the built CLI into `/tmp/agent020-e2e`, real server started and stopped, real
CLI throughout.

1. `corpus init` → the skill installed with the rule in it (`## Changelog` present
   in the installed `.claude/skills/orchestrate/SKILL.md`; the comment skill's bullet
   likewise).
2. Created `doc_7fyuvgg7`, then an anchored thread on its **last line** — the worst
   case for appending.
3. Ran the exact sequence step 5 prescribes: `corpus doc show` → `corpus doc edit
   --from agent` with the body reproduced plus a `## Changelog` section.
   **This is where the first draft of the skill was wrong.** It claimed the edit
   "names nothing remapped and nothing orphaned". The server reported
   `edited doc_7fyuvgg7 — 1 anchor remapped`. Inspecting the JSON: the anchor's
   `range` was **unchanged** (75–140) and `orphaned: false` — the remap is only the
   selector's `suffix` window, which the arriving section rewrote. The skill text was
   corrected to name **`orphaned`** as the signal and to disarm `remapped` by name,
   with the first-entry case called out. Telling the agent to expect a clean report
   would have had it redoing a correct append forever.
4. A second anchor earlier in the body, then a **person** edit adding their own
   sentence inside an entry, then a second agent append. Result: `edited doc_7fyuvgg7`
   with **no anchor report at all**; both entries present oldest-first; the person's
   parenthetical intact; both anchors at their original offsets. Later appends land
   past the section and disturb nothing — as the corrected text now says.
5. **No thread, ever.** `corpus doc list --type thread` shows three threads, all
   `--from user`. The agent's three writes opened none.
6. **The loop cannot feed itself, observed rather than assumed.** `corpus queue status`
   read `pending 0 … processed 0` before the first agent write and identically after
   all three. No guard was added.
7. Commenting on a changelog entry: `corpus thread create --parent … --quote "the
   thirty-year range was widened to 6.1%–6.9%"` → an ordinary anchored thread whose
   `corpus thread context` prints heading path `Mortgage options › Changelog` and the
   whole enclosing section. Nothing special was needed.
8. **The forbidden move, exercised on purpose.** Rewriting the section instead of
   appending returned
   `edited doc_7fyuvgg7 — 1 orphaned (th_tmflhmsp) — warning: orphaned_anchor` and
   destroyed the person's sentence. Both skills now state that consequence.
9. `corpus doc check` → 14 documents, **1 warning, no errors** — the warning is
   exactly the orphan deliberately created in step 8. `corpus db doctor` → clean,
   14 documents from 14 files. Server stopped, port 8791 confirmed free.

### What was **not** exercised

- **No live `claude` session and no `doc.edited` event.** That event is emitted by
  the UI's edit-session flush, not by a CLI write, so driving it needs a browser
  session; the CLI has no verb that produces one. What is proved is the mechanics
  the skill prescribes once the event arrives — the read, the append, anchor
  behaviour, the absence of a thread and of an enqueue — not the dispatch into
  step 5. Steps 2–4 of the issue's plan are covered in that sense; the *trigger* is
  not.
- **The clip is not implemented.** Nothing renders a fold yet; that is UI-089.
  Only the skill's obligation not to prune is verified here.
- **Tests run**: `npx vitest run scripts/workspace-template.test.ts` → **142 passed,
  0 failed**. Prettier and ESLint clean on the test file (the template tree is
  prettier-ignored by design). No repo-wide suite was run.

### One thing for the orchestrator

SPEC **§4**'s "Edit acknowledgment" rider (signed 2026-08-02) still reads
"…acknowledges briefly on the document's own surface where it does not [ripple]".
That is now satisfied by the changelog rather than by a thread, so it is not a
contradiction — the §7 rider signed 2026-08-07 is later and explicit — but the
sentence reads as though a thread were still meant. Worth a one-line amendment by
whoever owns spec edits; I did not touch SPEC.md.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (scoped: prettier + eslint on the changed test file)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
