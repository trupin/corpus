# [AGENT-024] The skills reach for a patch when the change is bounded

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-046 (`PatchDocRequest`, the `409` shape), SERVER-079 (the
  route), CLI-035 (`corpus doc patch`) — all landed on this branch
- Extends: AGENT-022 (the key loop), AGENT-023 (the revert loop) — this issue
  grows the same two sections rather than adding a heading

## Spec References

- SPEC.md **§9.2** — `POST /api/docs/:id/patch`, rider signed 2026-08-12:
  "the CLI exposes it as `corpus doc patch`, and **the agent's skills prefer it
  over a whole-body edit for bounded changes**"
- SPEC.md **§7** — "What needs a key": _"An anchored patch (§9.2) needs no key
  either: it names the text it expects to find, which is the same check by
  another route"_
- SPEC.md **§6** (anchor reconciliation), **§14** (validation), **§4** (one
  attributed commit) — a patch is an ordinary write once applied

## Summary

§9.2's patch bullet is signed, and the sentence that says the agent's skills
prefer a patch over a whole-body edit for bounded changes is currently **false**:
`corpus doc patch` shipped in this PR and neither installed skill knows the verb
exists. Every write example in `assets/workspace/` still reads the document,
sends the whole body back, and pays the length of the document for a one-line
correction — which is exactly the pricing §9.2 exists to fix.

This is not a mention to add. The verb changes _which write an agent reaches
for_, and that choice has to be legible without a lookup table: **a change you
can quote is a patch; a change you cannot quote is a whole-body edit.** Both
mistakes cost something real. An agent that rewrites for a line pays the whole
document for it and puts every other line at risk of a bad paste; an agent that
patches what should have been a rewrite turns one change into a pile of tiny
commits and a document left half-migrated.

Three things the text has to get right beyond "the verb exists":

1. **When to reach for it**, as a rule an agent can apply without a table.
2. **The revert loop grows a patch step.** A bounded revert — one paragraph, not
   a whole file — is precisely this verb's case, and it side-steps AGENT-023's
   frontmatter trap: `git show <sha>:<path>` piped into `corpus doc edit` writes
   the YAML block into the body a second time at exit 0, and a patch cannot make
   that mistake because both halves of it are body text.
3. **The two refusals must not blur.** They share exit `10` and have opposite
   recoveries. An agent that cannot tell "look again" from "quote more" guesses,
   and both guesses cost a round trip that teaches it nothing.

## Acceptance Criteria

- [x] Both installed skills teach `corpus doc patch` as the verb for a bounded
      change, with the literal `--old` / `--new` flags as the example — not
      `--old-file`, `--new-file` or `--stdin`, which are escape hatches
- [x] The choice between patch and whole-body edit is stated as one legible
      rule (quotable → patch; not quotable → edit), with the cost of getting it
      wrong in **both** directions
- [x] Matching is stated as **byte-exact against the body as stored** — no
      trimming, no normalisation — and the body is named as excluding the
      frontmatter block
- [x] **No `--key` on a patch**, said as a consequence rather than an omission:
      the excerpt _is_ the staleness check (§7), and it is the better one because
      it says _which_ text is gone
- [x] The two refusals are distinguished in the agent's own decision terms, each
      with its own next move: **0 matches → re-read the document and quote what
      it says now**; **more than one → quote more context, or `--all` if every
      occurrence is what you meant**. Both are exit `10`, nothing written
- [x] A `stale_key` from this route (exit `9`) is named as a **different** fact:
      something outside Corpus wrote the file
- [x] `--new ''` is stated as how a deletion is spelled, and an omitted `--new`
      as a usage error rather than a deletion
- [x] The revert loop in **both** skills gains a patch step for the bounded case,
      saying why it is safer than pasting a file: a patch quotes body text, so
      the frontmatter cannot be written in twice
- [x] `scripts/workspace-template.test.ts` pins the above the way it pins the key
      loop, and additionally checks **every flag the template names against
      `docs/cli.md`** — a flag that does not exist must fail the suite
- [x] Section counts unchanged: orchestrate **16**, comment **13**. No new
      heading; the teaching belongs inside `## Writing a document` and
      `## Doing the work`
- [x] No fence in either skill is left open (a closing run alone on its line,
      AGENT-016), verified with a real CommonMark parser

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — `## Writing a document`
  gains the choice rule, the patch loop, the two refusals, and a patch step in
  the revert loop
- `assets/workspace/claude/skills/comment/SKILL.md` — `## Doing the work` gains
  the same, proportionally: it is the skill that edits a parent document in
  service of a thread, so it needs the whole rule, told shorter
- `scripts/workspace-template.ts` — parse per-command **flag** surfaces out of
  `docs/cli.md` (global flags table + each command's `**Flags**` table) and
  expose the flags used by each `corpus …` invocation in the template
- `scripts/workspace-template.test.ts` — a `prefer a patch for a bounded change`
  block; plus the general flag check across the whole template tree

### Key Implementation Details

The verb's real surface (`apps/cli/src/commands/doc/patch.ts`, `docs/cli.md`):

- `corpus doc patch <id> --from agent --old '<excerpt>' --new '<replacement>'`,
  plus `--all`. `--old-file` / `--new-file` read a file byte-for-byte; `--stdin`
  takes the whole request as one JSON object and therefore takes no other patch
  flag. Naming two sources for one side is a usage error, never a precedence.
- Byte-exact match against the body as stored. The trailing newline of a file or
  a heredoc is text like any other.
- No `key` field exists on the request — there is no flag to add.
- Refusals: exit **10** with `code: patch_no_match` or `patch_multiple_matches`,
  both naming the count, nothing written. Exit **9** (`stale_key`) from this
  route means an external editor moved the file between match and save.
- `--new ''` deletes; `--new` equal to `--old` is a no-op answered normally,
  writing nothing and making no commit, and the CLI says so.
- On success: `patched <id> — N occurrences replaced`, the anchor report, then
  `key <sha256>` on the next line — a patch hands back a fresh key like any
  other write.

Placement follows AGENT-022/023: no new heading, so `sections.size` stays 16/13.
In orchestrate the choice rule opens `## Writing a document` (it is the first
decision, before the key loop, which is now explicitly the whole-body path); in
comment it lands in the `Edit the parent` bullet plus the writing-loop paragraph
that follows the bullets.

The flag check is the generalisation the acceptance criterion asks for: the
invocation extractor drops flags today, so a skill could name `--replace` or
`--key` on a patch and nothing would notice. `parseCliDoc` gains a per-command
flag map (and the global flags), and a new scan reports the flags each template
invocation uses so the test can resolve them against the command they were used
with.

### Edge Cases

- The extractor is line-based: a multi-line quoted value only has its first line
  scanned, so keep each example's flags on the line that starts with `corpus`.
- `|` and `;` split an invocation into segments — never put either inside a
  quoted flag value in an example.
- A quoted value beginning with `-` must not be mistaken for a flag.
- `--all` must never be shown as the fix for an ambiguous excerpt without also
  saying "if that is what you meant" — an agent reaching for `--all` to make a
  refusal go away rewrites text it never looked at.

## Testing Strategy

`scripts/workspace-template.test.ts`, run scoped (`npx vitest run scripts`):

- Every `corpus doc patch` example in the template carries both `--old` and
  `--new` and no `--key`.
- Both skills state the quotable/not-quotable rule, byte-exactness, both
  refusals with their distinct recoveries and the shared exit `10`, the deletion
  spelling, and the no-key consequence.
- The revert loop in both skills offers the patch for the bounded case.
- Anti-vacuity: at least one worked patch example exists in each skill (a rule
  with no example is how AGENT-019's bug survived two rewrites).
- Every flag named in every template `corpus …` invocation resolves against
  `docs/cli.md` — for the command it was used with, or as a global flag.
- Section counts still 16 / 13; a CommonMark parse agrees and no code node is
  left unterminated.

## E2E Verification Plan

Real workspace, real server, real CLI — the skill text is only true if the
commands in it behave as written.

### Verification Steps

1. `corpus init` a scratch workspace under
   `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, server on a free port
   (never 8765, never 5173).
2. Create a document, `corpus doc show` it, and walk the patch example verbatim:
   quote one line, replace it, read the printed key.
3. Force **both** refusals and record the exit codes and messages: an excerpt
   that is not there, and one that occurs twice — then fix the second by quoting
   more context, and again with `--all`.
4. Confirm `--new ''` deletes, an omitted `--new` is a usage error, and
   `--new` equal to `--old` writes nothing.
5. Confirm a patch needs no key: run one with no `--key` at all against a
   document whose key is stale in hand, and confirm it lands.
6. Confirm the anchor report and the commit: patch a passage a thread is
   anchored to and check the anchor still resolves, and that one commit was made
   authored by the agent.
7. Walk the bounded revert end to end: `git show` an old passage, patch it back,
   and confirm the frontmatter did not enter the body.

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** 2026-08-12. Scratch workspaces
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s024/ws` (server on port
**8947**) and `.../ws2` (port 8948, init only). 8765 and 5173 untouched;
`~/cos` never written.

### How "when to patch" is framed

One rule, stated before either verb is named, and identically in both skills:
**a change you can quote is a patch; a change you cannot quote is a whole-body
edit.** Quotable means you can point at the text that is wrong — a figure, a
sentence, a paragraph that should go. Not quotable means the document is being
restructured, its argument rewritten, two sections folded into one, and there is
nothing to point at. One qualifier keeps the rule from being read as "always
patch": **several separate corrections in one pass are a rewrite by volume**.

The rule carries the cost of getting it wrong in **both** directions, because
half a rule produces the opposite failure: rewriting for one line "pays the
length of the document for that line and puts every other line in your hands,
where a bad paste can lose them"; patching what should have been a rewrite
"becomes a pile of little ones … with the document sitting half migrated between
them and a commit for every step".

Three further claims, each measured against the real CLI rather than read off
the docs:

- **No key, as a consequence.** `corpus doc patch … --key <k>` → **exit 2**,
  `unknown flag "--key" for "patch"`. So the skills say there is no flag and that
  passing one is a usage error, and give the reason (§7): the excerpt is the
  staleness check, and the better one, because it names *which* text has gone.
- **The excerpt really is that check.** With a key read and then invalidated by
  another party's write: `corpus doc edit --key <stale>` → **exit 9** carrying
  the current document and a fresh key, while `corpus doc patch` with no key at
  all, at the same moment, landed at **exit 0**.
- **A patch is an ordinary write once applied.** Anchor report on the same line
  (`— 1 anchor remapped`, `— 1 orphaned (th_p7gvdnh4)`), one commit authored
  `agent`, fresh `key <sha256>` on the next line.

### The two refusals, kept apart

Both **exit 10**, nothing written, opposite recoveries — so each is stated with
its own next move rather than with the CLI's message:

```
$ corpus doc patch doc_yt75ducv --from agent --old '30-year fixed at 6.1%.' --new 'x'
corpus: the text --old quotes is not in the body of doc_yt75ducv — it matched 0 times…
exit=10
$ corpus doc patch doc_yt75ducv --from agent --old 'fixed at' --new 'fixed rate at'
corpus: the text --old quotes occurs 2 times in the body of doc_yt75ducv…
exit=10   (--json: {"code":"patch_multiple_matches","details":{"reason":"multiple-matches","matches":2}})
```

0 matches → **re-read and quote what it says now** (and do not go hunting for a
normalisation; there is none). More than one → **quote more context**; quoting
the whole line fixed the ambiguous case at exit 0, and `--all` replaced both at
exit 0 — which is why `--all` is written as "right only when every occurrence is
genuinely what you meant, never to make a refusal go away". Exit `9` from this
route is named as a **third** fact (something outside Corpus wrote the file);
it was not force-reproduced — the window is between the server's match and its
save — so the skills state it as the CLI's own classification does.

Also measured and stated: `--new ''` deleted the quoted passage and took its
blank line with it; an omitted `--new` is **exit 2** (`needs the text to put in
--old's place`), an empty `--old` is **exit 2**; `--new` equal to `--old` printed
`unchanged … nothing was written`; case matters (`the Rate Sheet` matched once
where `The Rate Sheet` was a different byte string).

### What the revert loop looks like now

Unchanged in shape — read the history → work out the content → write it — with
the write step deciding the same way every other write does: *"A passage you can
quote goes back as a **patch**: `--old` the text standing there now, `--new` the
text you are restoring. Only a document that changed wholesale needs a read for
its key and the whole body back through `corpus doc edit`."* The bounded case is
placed immediately after AGENT-023's frontmatter trap, because it is the answer
to it: **a patch cannot make that mistake** — it matches body text and writes
body text, so the file `git show` handed you is not something either half can
carry. Safety is stated for both branches: the key guards a whole-body revert
(exit 9), the excerpt guards a patched one (a passage somebody has since
rewritten is not there to match).

Verified end to end on the real server: `corpus doc diff` → `git show` → patch
the current sentence back to the old one → exit 0, and the anchor that had been
orphaned by the original change **resolved again** (`orphaned: false`,
`chars 108–150`) once the passage came back.

### Two contradictions the rule created, and both are fixed

A rule that a worked example contradicts loses (AGENT-019). Two examples became
whole-body writes of bounded changes the moment this rule landed:

- **The changelog append** (`## Reflecting on a user edit`). It was
  `corpus doc edit` sending the whole body back, which is exactly what §9.2
  prices out — and the section's own argument (the person writes here too; a
  rewrite orphans anchors and loses their entries) is the argument *for* a patch.
  It is now a patch quoting the tail of the last entry, with the read kept and
  its reason restated (*you cannot quote bytes you have not seen*), and the
  whole-body branch kept for the one append that has nothing to quote — the
  first entry, which creates the section. Run verbatim against the server:
  `patched doc_hfbmjnkm — 1 occurrence replaced`, the new entry landing under the
  July 14th one with every byte above it untouched. **Reverted 2026-08-12 —
  the conversion was wrong; see "The append goes back under a key" below.**
- **The 6.1% → 6.4% rate edit**, told from both sides (comment worked example 1,
  orchestrate's `## Worked example`). Both now patch the sentence, and both were
  run verbatim: `patched doc_… — 1 occurrence replaced — 1 anchor remapped`, the
  thread anchored on `6.1%` following the text into the new sentence.

### Test surface

`scripts/workspace-template.test.ts` gains `a bounded change is a patch, not a
rewrite` (choice rule + both costs; a worked patch in each skill carrying both
halves; no `--key` on any patch invocation; byte-exactness, body-only,
`--new ''`; the two refusals with their distinct recoveries and exit `9` as a
third thing; the revert step; the changelog append; the comment skill's
quote-from-a-read rule). The invocation matcher joins continuation lines, since a
patch's excerpts are routinely multi-line.

The read-through the issue asks for is now mechanical: `parseCliDoc` also reads
**flags** — each command's own table plus the global table, first cells only, so
a description mentioning `--key` cannot document it — and
`extractCorpusInvocationUses` reports the flags each template invocation spells.
The new check resolves every flag in the whole template tree **and** in every
plugin skill against `docs/cli.md`. Its anti-vacuity case is the exact
regression: `corpus doc patch … --key abc` reports `doc patch --key`, and a
flag-looking word inside a quoted value (`--old 'ship it --tomorrow'`) is read as
the text it is.

`npx vitest run scripts` → **596 passed, 0 failed**.
`vitest run apps/cli/src/template apps/cli/src/commands/init` → **144 passed**
(the install contract is unchanged: same 8 template files).
ESLint clean, Prettier clean, `tsc --noEmit -p scripts/tsconfig.json` clean.

Structural checks (AGENT-016): parsed both bodies with
`mdast-util-from-markdown` — **16** and **13** top-level `depth: 2` headings,
equal to the pinned `sections.size`, and **0** code nodes whose closing line is
anything but a bare backtick run.

`corpus init` into a fresh workspace (`ws2`) installed the updated skills — 6
`corpus doc patch` invocations in orchestrate, 5 in comment — so a workspace
created today gets the verb.

### Post-Implementation Verification

Commands and their observed output are quoted above; every claim in the skill
text about `corpus doc patch` was run against the server on port 8947 rather than
read off `docs/cli.md`. The one claim not force-reproduced is the external-editor
`stale_key` (exit 9), noted as such above.

---

## E2E Verification Log — PR #44 re-review (three findings)

**Model: opus (claude-opus-5, 1M context).** 2026-08-12, second pass. Scratch
workspaces `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s024r/ws` (server on
port **8951**) and `.../ws2` (port 8952, `init` only). 8765 and 5173 untouched;
`~/cos` never written. Server stopped and both ports confirmed free at the end.

### MAJOR 1 — the append goes back under a key, and the general claim is scoped

**Reproduced first, against the real server.** The document holds one entry; the
agent reads it and quotes that entry's tail; a person appends a newer entry
through the ordinary write path; the agent then runs the patch the skill
prescribed:

```
$ corpus doc edit doc_abjkt4l7 --key 2926852c… --from user   # the person's append
edited doc_abjkt4l7
$ corpus doc patch doc_abjkt4l7 --from agent --old '  corpus quoted those figures.' --new '…'
patched doc_abjkt4l7 — 1 occurrence replaced
exit=0
## Changelog
- **2026-07-14** — … Nothing else in the
  corpus quoted those figures.
- **2026-07-28** — the working rate assumption moved from 6.1% to 6.4%. …   ← the agent's
- **2026-07-27** — called two lenders; both quoted within 10bp of the sheet. …  ← the person's
```

Exit **0**, `1 occurrence replaced`, and the agent's entry spliced **above** the
person's newer one, breaking the oldest-first rule the same section states.
Nothing refused. The reviewer's reading is exact.

**Why no quote can fix it, and what replaced it.** The quote is a check on the
text it *replaces*: it proves that text is unchanged. An append is an
**insertion**, and what makes an insertion wrong is another insertion at the same
point — which leaves the quoted text exactly as it was. The two possible repairs
were weighed and measured:

- **Quote something a later append necessarily changes.** There is nothing: an
  append at the end of the body is purely additive, and `--old` has no
  end-of-body anchor. Rejected on the mechanism, not on taste.
- **Quote across the insertion point** — the tail of what precedes *and* the head
  of what follows, as one excerpt. This works wherever there *is* a far side, and
  was measured on a list: a person inserted a line between the two the agent had
  quoted across, and the patch was **refused at exit 10, 0 matches**. The naive
  one-sided quote on the same document applied at **exit 0** and put the new line
  in the wrong place. Both runs are the evidence for the rule as written.
- The changelog has no far side — it is the last thing in the body — so **that
  one append goes back whole under a key**, which is the only check that covers
  text the write did not name. Measured end to end: the agent's read key, the
  person's append against it, then the agent's whole-body write with the key it
  read → **exit 9**, carrying the current text and a fresh key; retried against
  *that* body → exit 0 with all three entries in date order and one commit
  authored `agent`. An anchor sitting inside an existing entry survived the
  append (`orphaned: false`), so "an honest append orphans nothing" still holds
  on the keyed path.

So the safety sentence was not deleted with the example left standing: the
example moved to the write whose check is true, and the *reason* is now stated as
a rule an agent can apply anywhere — **a patch replaces; it does not insert** —
in both skills. The general claim both skills carried ("the staleness check, and
a better one") is scoped in both: better **for the text it replaces**, and
covering nothing it did not quote. SPEC §7/§9.2 needed no change — they say "the
same check by another route" and "a patch whose *text* has moved is refused",
both of which stay true; the overreach was the skills'.

### MAJOR 2 / MINOR — the extractor, probed the way the reviewer probed it

`scripts/workspace-template.ts` now scans a fenced line **once, quote-aware**
(`scanShell`), producing both the separator split and the quote left open at the
end, and joins a line whose quote is still open with the next — but only when the
fragment already holds a `corpus …` invocation, so an apostrophe in prose or in
command output never swallows the lines below it. `invocationFlags` decides
"flag" by where the quoting starts: at the first character it is a quoted
argument, partway through it is a flag with an attached value.

Probed directly through the exported function (`--reporter` output in the suite;
the probe script is the same call the tests make):

| input                                            | before                | now                                |
| ------------------------------------------------ | --------------------- | ---------------------------------- |
| `--key='abc' --old 'a' --new 'b'`                | `--old`, `--new`      | `--key`, `--old`, `--new`          |
| `--old '\| a \| b \|' --key zzz`                 | `--old`               | `--old`, `--key`                   |
| `--old 'a; b' --key zzz`                         | `--old`               | `--old`, `--key`                   |
| `--old 'line one⏎line two' --key zzz --new 'x'`  | `--old`               | `--old`, `--key`, `--new`          |
| continuation line starting with `corpus `        | 2 invocations         | **1** invocation                   |
| `--new '--all is not what I meant'`              | no flag (kept)        | no flag                            |
| `corpus doc show d && corpus queue idle`         | 2 invocations (kept)  | 2 invocations                      |
| `# the document's own body` then a `corpus` line | both read (kept)      | both read                          |

All eight are now cases in `scripts/workspace-template.test.ts`, next to the
existing `--key` regression. The real skills gained flags that had been unread:
the multi-line patches in both skills now report `--new` as well as `--old`, and
the whole-tree check still passes, so no undocumented flag was hiding behind a
quote.

`scripts/workspace-template.test.ts:2866` — `declared?.has(flag) !== true` now
returns early when `declared` is `undefined`, so an undocumented command fails
once (naming the verb) instead of twice.

### The line-wrap workaround: reverted

Yes, and it is moot. The July 14th entry in the reflection's worked example is
back to its natural wrap — `Nothing else in the / corpus quoted those figures.` —
because that example is a heredoc again rather than a `--old` value, and because
the extractor no longer mistakes a continuation line for a command. A test pins
the reverted case directly, so a future reflow cannot resurrect the phantom.

### One assertion that had been passing vacuously

`works the whole procedure once` matched `corpus doc show doc_a1b2c3` … `corpus
doc patch` **anywhere within 400 characters**, which the unrelated example in
`## Writing a document` satisfied — so it never checked the reflection's append
at all. It now matches the append exactly: the key the read printed must be the
key the write presents, and the July 14th entry must appear before the new one in
the body that is sent.

### Checks

`npx vitest run scripts` (`VITEST_MAX_THREADS=4`) → **603 passed, 0 failed**.
`vitest run apps/cli/src/template apps/cli/src/commands/init` → **144 passed**
(install contract unchanged: 8 template files).
ESLint clean, Prettier clean, `tsc --noEmit -p scripts/tsconfig.json` clean —
that last one caught a real defect, `TS7022` on the joined logical line, which
had made it `any` and produced two `no-unsafe-*` warnings.
CommonMark re-check (AGENT-016): **16** and **13** top-level `depth: 2` headings,
matching the pinned `sections.size`, and **0** unterminated code nodes.
`corpus init` into a fresh workspace installed the corrected skills, with **no**
`corpus doc patch` invocation left anywhere in the changelog append rule.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
