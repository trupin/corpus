# [AGENT-035] A `$` in a quoted argument is eaten by the shell, and no skill says so

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md **§7** — the agent works through the CLI and nothing else
  (architecture decision 2)

## Summary

**Money silently loses its leading digits when an agent writes it.**

Observed during AGENT-033's drill, 2026-08-17, in a real Claude Code session
against a real workspace. A listener set a thread title through the CLI and it
landed as:

```
Kitchen rebuild — cabinet quote, ,400
```

while the same session's reply, written through a heredoc, correctly said
`$18,400`. The cause is ordinary shell expansion: `$18` inside a **double-quoted
flag argument** expands to the empty string (positional parameter 18), so
`"… , $18,400"` reaches the CLI as `… , ,400`. Nothing errors, nothing warns, and
the wrong value is committed and shown to a person as if it were what the agent
meant.

**The skills cover the heredoc case and not this one.** Existing guidance tells
the agent to use heredocs for message bodies, which is why the reply survived and
the title did not. A short argument — a title, a tag, a form answer, a commit
subject — has no such rule, and it is exactly where a currency amount is most
likely to appear.

This is a **data-corruption** bug in the ordinary path, not a formatting nit: the
document that reaches the corpus is wrong, and the agent has no way to notice.

## What has to be decided

Whether the fix is guidance, mechanism, or both:

1. **Guidance only** — a rule in the skills: single-quote every short argument
   carrying user text, or use `--file`/stdin. Cheapest, and it is one more rule
   an agent has to remember under load.
2. **Mechanism** — the CLI grows a way to pass short values that cannot be
   expanded (stdin, a `--title-file`, or a `--json` request body), and the skills
   point at it. Costs a CLI issue; removes the failure mode rather than warning
   about it.
3. **Detection** — the CLI or the server notices a value that looks mangled
   (`, ,` , a lone `,` after a space) and refuses. Unreliable, and it cannot tell
   a real empty field from an eaten one. Probably not this.

Route 1 alone is what the repo already tried for heredocs, and it worked there
because the heredoc rule is stated where the body is written. The same may hold
here, but note that **an agent under load re-derives quoting from habit**, and
double quotes are the habit.

## Acceptance Criteria

**Added 2026-08-18 after PR #50's third review (NIT 10).** The review noted that
the `CORPUS_EOF` sweep into the CLI shipped under this issue's commit with no
criterion owning it — nine sites across six command files, `input.ts`,
`docs/cli.md` and a new hygiene rule, checked against nothing. The change was
right; the record did not say who asked for it. It does now:

- [x] **Every surface an agent copies a heredoc from teaches one terminator.**
      The shipped skills, the plugin skills, the CLI's `--help` examples, its
      error hints, and the generated `docs/cli.md`. A skill saying *"never
      `EOF`"* beside a `corpus --help` demonstrating `EOF` teaches the old word
      from the more authoritative surface *(nine CLI sites; three of them —
      a doc comment, an error hint, and a terminator split across a string
      concatenation — were invisible to a grep for the opener)*
- [x] **A rule forbids the demonstration while permitting the mention**, since
      the error hint has to name `EOF` in order to rule it out
      *(`apps/cli/src/commands/hygiene.test.ts`; verified against the real thing
      by restoring the pre-fix files and watching it list all nine)*
- [x] **The two rules agree on the predicate.** Both the workspace and the CLI
      rule reject any delimiter that is not `CORPUS_EOF`, not merely `EOF` — a
      rule banning one word leaves the next author choosing between the rest,
      which is the weighing the fix exists to remove *(PR #50 third review,
      MINOR 6; falsified with `<<'BODY'`)*

- [x] An agent writing `$18,400` into a title, tag, or form answer through the
      CLI produces `$18,400` in the document — verified in a **real drill**, not
      by reading the rule *(E2E §4: title, tag, `--extra`, skill description and
      a form answer, all byte for byte)*
- [x] Whatever the fix, it is stated **once**, in the skill that owns the act,
      with a pointer from any other that needs it (the single-owner registry in
      `scripts/workspace-template.test.ts`) *(owner `orchestrate`; three
      pointers; `profile`'s account deleted rather than kept in step)*
- [x] The existing heredoc guidance is reconciled rather than duplicated — one
      rule about untrusted text reaching a shell, not two rules that happen to
      agree *("It is the construction a body already uses, and that makes this
      one rule rather than two")*
- [x] Other expansions are considered, not just `$`: backticks, `!` under
      history expansion, and a trailing backslash *(backtick executes — E2E §2;
      `!` is literal in a non-interactive shell; a trailing backslash is an
      unmatched-quote parse error. The construction covers all of them without
      enumerating any, which is the point of choosing it)*
- [x] If the route chosen is mechanism, a CLI issue is filed and this one depends
      on it *(not applicable — mechanism rejected, see above; no CLI issue filed
      and no new dependency)*

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` and/or
  `converse/SKILL.md` — wherever short arguments are written
- `scripts/workspace-template.test.ts` — the pin

### Key Implementation Details

Reproduce it first, exactly as the drill did: a real session, a title containing
`$18,400`, through the real CLI. A test that asserts the *rule text* exists
proves nothing about whether a session under load follows it — this repo has
been wrong about that three times, and the drill is what found each one.

### A second site, and a measured correction

**`assets/workspace/claude/skills/comment/SKILL.md:809`** carries the same shape:
`corpus skill create weekly-review --description "Run the weekly review over the
corpus."` — person-facing prose through a double-quoted argument. Found while
fixing the `profile` skill's two sites (PR #49 third review); left for this issue.

**The apostrophe half of this defect is loud, not silent** — measured 2026-08-17,
which is a correction to how it was first described:

| written | landed |
| --- | --- |
| `--title "Kitchen quote $18,400"` | `title: Kitchen quote ,400` — **exit 0**, committed |
| `--extra note='it's fine'` | never runs: `bash: unexpected EOF while looking for matching '` |
| `--extra note='it's fine, isn't it'` | runs; CLI refuses `unexpected argument "fine,"` |

That matters for the fix: **the obvious repair for the loud failure is the silent
one.** An agent whose single quote just broke reaches for a double quote, which
is the `$18,400` hole. So a rule that only says "watch your quoting" sends people
from the failure they can see into the one they cannot.

`profile` now solves it by building every person-facing value through a
`<<'EOF'` heredoc and passing `"$var"` — nothing inside a quoted-terminator
heredoc is expanded, so there is no character list to remember. Two real Claude
Code sessions copied that pattern from the skill without being told. Whether that
is the right shape for the *general* rule, and where it lives, is this issue's to
decide — it was deliberately not registered as single-owner, so as not to
prejudge that.

### Edge Cases

- The value comes from a person's message, so it is arbitrary text
- A title set through `doc create --title` and through `doc edit` are two call
  sites
- `--extra name=value` pairs, which AGENT-034's `profile` skill uses

## Testing Strategy

The pin for single-ownership. The behavioural test is a drill that writes a
currency amount and reads the document back.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Real Claude Code session; ask for something whose title carries `$18,400`
3. Read the document off disk and compare byte for byte
4. Repeat for a tag and a form answer
5. Stop the server; confirm the port is free

## The decision, and what it rejected

**Route 1, guidance — but a construction rather than a quote to prefer, plus a recovery
clause.** No CLI issue is filed and no detection is added. Every claim below is a measurement
taken on 2026-08-18 against a real workspace on port 8792, reproduced in the log.

### The measurement that decided it

The issue's own framing — silent `$`, loud apostrophe — is **half right, and the half it gets
wrong is the half that matters**. Single quotes fail loudly on an *odd* number of apostrophes.
On an **even** number they fail **silently**, and an ordinary surname is enough:

| written | landed | how |
| --- | --- | --- |
| `--title "…, $18,400"` | `…, ,400` | zsh: `$18` is positional parameter 18, empty |
| `--title "…, $18,400"` | `…, 8,400` | bash/sh: `$1` then a literal `8` — **a plausible number** |
| ``--title "Ask `whoami` first"`` | `Ask theophanerupin first` | command substitution ran |
| `--title 'O'Brien's report'` | `OBriens report` | three quoted pieces rejoined into **one** argument |
| `--title 'Dan's quote, isn't it fine'` | *(refused)* | rejoined into **three** arguments; CLI: `unexpected argument "quote,"` |

Every row above except the last is exit `0` and a commit. So **both quotes have a silent case**,
and "prefer single quotes" would have traded one silent corruption for another while adding a
loud failure whose reflex repair is the first silent one. That is the inversion the task
warned about, and it is why the rule is a construction and not a quoting preference.

### Chosen

**Build every value carried over from somebody in a `<<'EOF'` heredoc and pass `"$var"`.**
Measured immune to `$`, backtick, backslash, `!`, apostrophe, double quote and `%` in zsh 5.9
and bash 3.2 alike. It needs no character list, and it is the construction bodies already use
— which is the reconciliation the issue asked for: one rule (*a heredoc is how anybody's words
reach the server intact*) with the body as its already-known case, not two rules that agree.

Three deliberate choices inside that:

- **The applicability test is provenance, not inspection.** *"Where did this text come from"*
  is answerable under load; *"does this contain a `$`"* is exactly the check that failed. So a
  title out of the agent's own vocabulary stays a literal in the examples
  (`--title "Quarterly insurance review"`), and a title made out of the person's words does
  not. That difference is visible inside one worked example in `comment` — the document title
  is literal, the thread title beside it is not — which is the rule being applied rather than
  an inconsistency.
- **The recovery clause is load-bearing**, and is the part three earlier passes lacked: *when
  the shell refuses the line, the answer is never a double quote.* Without it, the loud
  failures route an agent straight into the silent one.
- **Single ownership.** `orchestrate` states the mechanism, in `## Writing a document`;
  `comment`, `converse` and `profile` carry a pointer and the outcome. `profile`'s account
  (AGENT-034, PR #49) is **deleted**, not synchronised — the first rule in this repo whose
  consumers outnumber its owner, and the first with three registered pointers.

### Rejected

- **Single quotes as the blanket rule** — the table above. Not a loud-for-silent trade: an
  even apostrophe count deletes characters at exit `0`.
- **Double quotes with escaping** — requires holding a character list against text the agent
  did not write, and the misses are invisible. The bash form (`8,400`) is worse than the zsh
  form (`,400`) precisely because it looks like a correct write.
- **`printf`-built values** — the literal still needs a quote, so it inherits whichever
  failure that quote has. A step added, nothing removed.
- **Mechanism (`--title-file`, a stdin JSON body, a `--extra-file`)** — it does not remove the
  failure, because the agent still has to *choose* it, which is the same act as choosing a
  heredoc; and it costs a flag per field plus a contract change. Stdin is already the body's
  on `doc create`, so a stdin request object collides with it. A general *"read this flag's
  value from a file"* convention is a real idea and is **not** this issue's; no CLI issue is
  filed, so nothing here depends on one.
- **Detection** — by the time the CLI is running, the shell has already eaten the evidence:
  `,400` is indistinguishable from a field a person meant to be `,400`. Detection would have
  to live in the shell, which is not ours.
- **Naming bash 3.2 in the skill text.** Measured: `v=$(cat <<'EOF' … EOF )` is a syntax error
  under bash 3.2 (macOS `/bin/bash`) when the value holds an **odd** number of apostrophes —
  a `$( )`-scanning bug, independent of terminator form (`<<"EOF"`, `<<\EOF`, closing paren on
  the same line all fail identically); zsh 5.9 and bash ≥ 4 are unaffected. It is loud and it
  writes nothing (verified against the real CLI: the `corpus` invocation in the same block
  never ran and no field landed), so the recovery clause already covers it. A shell-version
  matrix in a product skill is noise that gets baselined away; it is recorded here and in the
  agent's Domain Knowledge instead.
  **Half of this was wrong — see *PR #50 review*, MAJOR 3.** Not naming the version still
  stands; *"the recovery clause already covers it"* did not. The clause prescribed a resend of
  the construction that had just failed, so it was non-terminating in precisely this case.
- **`IFS= read -r var <<'EOF'` as the construction** — immune everywhere including bash 3.2,
  and rejected anyway: it silently truncates a multi-line value to its first line, and this
  issue is about not shipping constructions whose misuse is silent.
  **Superseded in part — see *PR #50 review*, MAJOR 3.** Rejected as the *construction*, for
  the reason given, and adopted as the *recovery*, where the truncation is out of scope: the
  values that reach a flag are single-line by nature, and a multi-line value is a body, which
  is never captured into a variable in the first place.

### One adjacent defect found and fixed

A heredoc terminator only closes the heredoc on a line of its own at column zero. Two shipped
examples had an indented one — `comment`'s skill genesis and `converse`'s retirement sign-off
— which under bash swallows the rest of the input into the value (measured:
`[  A line.\n  EOF\n  ]`) and under zsh is a parse error. Both fences are now at column zero,
and `coreSkills` are pinned against indented terminators and for balanced open/close counts.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real workspace at `/tmp/agent035/ws`, real server on port
**8792** (never 8765, never 5173), stopped at the end. Shell facts measured in both `zsh 5.9`
(this machine's `$SHELL`, and what Claude Code's Bash tool runs) and `bash 3.2.57`.

### 1 — Reproduction, through the real CLI, in both shells

```
$ corpus doc create --type note --title "Kitchen rebuild — cabinet quote, $18,400" \
    --folder inbox --from agent -m "body"
=== zsh ===
created doc_7zucxwrl — data/docs/inbox/kitchen-rebuild-cabinet-quote-400.md
=== bash ===
created doc_n74cwi5h — data/docs/inbox/kitchen-rebuild-cabinet-quote-8-400-2.md
```

Read back off disk:

```
"title: Kitchen rebuild — cabinet quote, ,400"    <- kitchen-rebuild-cabinet-quote-400.md
"title: Kitchen rebuild — cabinet quote, 8,400"   <- kitchen-rebuild-cabinet-quote-8-400.md
```

The reported defect, exactly, plus a second form of it: the same command produces two
different wrong figures depending on the shell, and bash's `8,400` is the one nobody queries.

### 2 — Backtick: not corrupted, obeyed

```
$ corpus doc create --type note --title "Ask `whoami` before signing" --folder inbox --from agent -m body
created doc_llyabiw2 — data/docs/inbox/ask-theophanerupin-before-signing.md
"title: Ask theophanerupin before signing"
```

### 3 — Single quotes are not the repair (the inverting measurement)

```
$ count 'O'Brien's report'      # count() prints argc and each argument
=== zsh ===  argc=1  <OBriens report>
=== bash === argc=1  <OBriens report>
$ corpus doc create --type note --title 'O'Brien's report' --folder inbox --from agent -m body
created doc_wblll2nr — data/docs/inbox/obriens-report.md
"title: OBriens report"
```

Exit `0`, committed, both apostrophes silently gone — in **both** shells. The loud cases were
measured too: `'it's fine'` (odd) is `zsh:1: unmatched '` / `bash: unexpected EOF while
looking for matching '`, and `--title "path C:\"` is `unmatched "`. `!` is literal in a
non-interactive shell (no history expansion) in both.

### 4 — The recommended construction, drilled against the real CLI

Exactly as `comment` now spells the thread retitle, with `$18,400`, two apostrophes, a
backtick, a `!` and a `%`:

```
$ title=$(cat <<'EOF'
Kitchen rebuild — Dan's cabinet quote, $18,400, and `whether` it's worth it!
EOF
)
$ corpus doc edit th_mukdx5q5 --title "$title" --from agent
edited th_mukdx5q5
key f3757ad974b14dde9d6124347b3399dd61437a914c2f5783462d10549c95e789
```

Tag and `--extra` through the same construction, then read off disk — byte for byte:

```
id: th_mukdx5q5
title: Kitchen rebuild — Dan's cabinet quote, $18,400, and `whether` it's worth it!
tags:
  - quote-18400
note: Dan's figure was $18,400 — 100% of it due before `demolition`.
```

A skill's `--description`, as `## Skill genesis` now spells it:

```
$ description=$(cat <<'EOF'
Run the weekly review over the corpus — what changed, what drifted, what's owed, down to the last $1.
EOF
)
$ corpus skill create weekly-review --description "$description" --from agent <<'EOF' …
created doc_eethcrj3 — .claude/skills/weekly-review/SKILL.md
# → description: Run the weekly review over the corpus — what changed, what drifted, what's owed, down to the last $1.
```

And a reply body carrying a form and the same characters (the case that already worked, kept
as a non-regression):

```
## agent · 2026-08-18T18:27:23Z
Dan's quote is $18,400, and `demolition` is 100% of the first draw.

form:
- question: Go ahead at $18,400?
  options: [yes, no]
↳ titled this thread and noted the figure
```

**Acceptance criterion 1 met by drill, not by reading the rule:** `$18,400` written into a
title, a tag, an `--extra` value, a skill description and a form answer all come back byte
for byte.

### 5 — The one limitation, measured rather than assumed

Same drill under `bash 3.2.57`: steps with an even apostrophe count landed identically
(`title:` and `tags:` above), and the `--extra` value (one apostrophe, *Dan's*) did not run at
all — `unexpected EOF while looking for matching '`, and the `corpus` command in the same
block never executed. Disk confirms no `note` field was written. Loud, nothing lost, covered
by the skill's *"the answer is never a double quote"* clause.

### 6 — Pins, each falsified individually

`VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts` → **375 passed**.
Every new pin was falsified by deleting the sentence or example it covers and confirming that
pin alone went red (script kept at `/tmp/agent035/falsify.mjs`):

| mutation | test that went red |
| --- | --- |
| drop the second shell's outcome (`8,400`) | `states what the shell does, in outcomes an agent can recognise` |
| drop the backtick sentence | same |
| drop the `O'Brien` measurement | same |
| drop *"nothing afterwards tells you"* | same |
| drop the provenance test | `gives one construction and the test for when it applies` |
| drop *"no character list"* | same |
| drop the recovery clause | `says what to do when the shell complains, which is not a double quote` |
| put the thread title back in a quoted flag | `builds a thread's title in a heredoc, at both sites that set one` |
| drop the cost sentence in `comment` | `shows the cost at the site of the reported defect` |
| put `--description "<literal>"` back | `passes a skill's description by name, like any other prose somebody reads` |
| re-indent the `converse` heredoc | `'converse' indents no heredoc terminator` + `'converse' opens a heredoc it can close` |
| delete any one of the three pointers | `keeps every registered rule in the one skill that owns it` |
| give `comment` or `converse` its own account of the mechanism | same |
| copy the pointer clause verbatim between two skills | `states no passage in two skills that is not a recorded decision` |

Both pins are anti-vacuous in the file's own convention: `catches a second account of the
expansion, and says which paraphrase it misses` asserts the three shapes the account has been
written in are caught, that the outcome a pointer may carry is **not**, and names the
paraphrase the detector admits it misses.

### 7 — Whole-file checks

`npm run lint` clean; `prettier --check` clean on every touched file. Parsed all four skills
with `mdast-util-from-markdown`: `h2` counts unchanged at **16 / 13 / 15 / 7** and zero
unclosed fences. Server stopped (`stopped (pid 44244)`); `lsof -nP -iTCP:8792 -sTCP:LISTEN`
returns nothing.

## PR #50 review

**Model: Fable 5.** Four findings — MAJOR 3, MINOR 6, MINOR 7, NIT 10. Real workspace at
`/tmp/agent035pr50/ws`, real server on port **8797** (never 8765, never 5173), stopped at the
end. Every shell claim below measured in `bash 3.2.57(1)-release (arm64-apple-darwin24)` — the
macOS `/bin/bash` — and `zsh 5.9`, against the real CLI wherever the value reaches a document.
No newer `bash` exists on this machine, so *"bash ≥ 4 is unaffected"* is carried over from the
original run and is **not** re-measured here; the skill text deliberately says *some shells*
and never a version, so nothing shipped depends on it.

### MAJOR 3 — the recovery clause was non-terminating

**Reproduced, first as a script and then through the real CLI.** The reviewer's finding is
exact: the construction the clause prescribes is one the clause's own trigger can be caused
by.

```
$ /bin/bash /tmp/agent035pr50/odd1.sh          # title=$(cat <<'EOF' / O'Brien report / EOF / )
/tmp/agent035pr50/odd1.sh: line 5: unexpected EOF while looking for matching `''
/tmp/agent035pr50/odd1.sh: line 6: syntax error: unexpected end of file
exit=2
$ /bin/zsh /tmp/agent035pr50/odd1.sh
title=[O'Brien report]
exit=0
```

Through the real CLI, the same value going to `corpus doc create --title "$title"`:

```
=== bash 3.2, the construction, odd apostrophe, REAL CLI ===
/tmp/agent035pr50/live_bad.sh: line 4: unexpected EOF while looking for matching `''
/tmp/agent035pr50/live_bad.sh: line 8: syntax error: unexpected end of file
exit=2
```

Nothing was created — the loud half is genuinely loud. The defect is that the shipped clause
answered it with *"Build the value the way above and send it again"*, which reproduces the
same parse error forever, having already forbidden the double quote.

**Scope of the failing construction, measured, because it decides the fix's boundary.** The
bug is in scanning `$( … )`, not in heredocs:

| form | odd apostrophes, bash 3.2 | zsh 5.9 |
| --- | --- | --- |
| `v=$(cat <<'EOF' … EOF )`, single-line | syntax error, exit 2, nothing ran | value exact, exit 0 |
| `v=$(cat <<'EOF' … EOF )`, multi-line | syntax error, exit 2, nothing ran | value exact, exit 0 |
| the command's **own** heredoc, multi-line | value exact, exit 0 | value exact, exit 0 |
| `IFS= read -r v <<'EOF'`, single-line | value exact, exit 0 | value exact, exit 0 |

The third row is what makes the fix's boundary free rather than a compromise: a body is fed to
`corpus doc edit … <<'EOF'` directly and is never captured into a variable, so the only values
that meet this defect are flag values, and a flag value is one line.

**The fix**, in `orchestrate/SKILL.md`, is a new paragraph after the existing clause — *"Nor is
it the same lines again"* — naming the cause (the agent must stop reading the refusal as its
own mistake, or it will keep rebuilding), giving `IFS= read -r` as a copyable block, and
stating the boundary in the same breath so it cannot be promoted to the rule:

> **That is a repair, not the rule, and its boundary is the reason:** it takes **one line** and
> drops anything after it without saying so. So it is right for a flag … and never for a value
> that spans lines. Nothing is lost by that boundary. A value that spans lines is a body, and a
> body is fed to the command's own heredoc rather than captured into a variable first, so it
> never meets the defect this paragraph repairs.

**Proof the repair terminates — one step, both shells, real CLI**, and the value carries every
character the rule exists for (`'`, `$`, a backtick):

```
=== bash 3.2, the RECOVERY, REAL CLI ===
created doc_byx5msh7 — data/docs/inbox/o-brien-report-cabinet-quote-18-400-don-t-whoami-it.md
exit=0
=== zsh, the RECOVERY, REAL CLI ===
created doc_6geg7o33 — data/docs/inbox/zsh-o-brien-report-18-400-don-t-whoami-it.md
exit=0
=== what actually landed ===
doc_6geg7o33  note  open  Zsh — O'Brien report, $18,400, don't `whoami` it
doc_byx5msh7  note  open  O'Brien report — cabinet quote, $18,400, don't `whoami` it
```

Byte-exact, `$18,400` intact, `` `whoami` `` not executed, both apostrophes present. The
skill's example was then run **verbatim** as a `doc edit --title` against a live document:
`edited doc_uyxaoerp` under both shells, and `corpus doc show` reads back
`O'Brien — cabinet quote, $18,400`.

The truncation that keeps `IFS= read -r` out of the general rule was re-measured and is as
silent as the original run recorded — three lines in, one line out, exit `0`, both shells:

```
=== bash 3.2 ===  body=[First line.]  exit=0
=== zsh ===       body=[First line.]  exit=0
```

### MINOR 6 — a fence under the step that forbids it

Correct, and the cause is this issue's own fix: lifting the indented terminator to column zero
turned list content into a section-level block, which then belonged to whichever step it
followed. In `converse/SKILL.md` the `corpus thread reply` block sat under *"If it is resolved,
post nothing"*.

Fixed by **ordering, not indentation** — the terminator stays at column zero. The block now
sits between steps 3 and 4; step 3 says *"the reply is the block directly below"* and step 4
opens *"post nothing — not the reply above, not a shorter one"*, so each step names the block's
direction. Parsed with `mdast-util-from-markdown` to confirm the ordered list resumes correctly
rather than restarting at 1:

```
list ordered start=1  716-731
code                  733-737
list ordered start=4  739-741
```

### MINOR 7 — the totality claim, decided: state the residual, keep the claim

**Verified, and it is worse than the finding suggests.** A body carrying a line that is exactly
the terminator, through the real CLI:

```
=== bash 3.2, a bare EOF line inside a body ===
created doc_x7nnyouq — data/docs/inbox/eof-residual-body.md
/tmp/agent035pr50/live_eof.sh: line 7: hello: command not found
/tmp/agent035pr50/live_eof.sh: line 8: EOF: command not found
$ corpus doc show doc_x7nnyouq
…
They pasted this transcript:

  cat <<'EOF'
```

The write **succeeded** and committed, with the body cut off at that line; the remainder ran as
shell commands. Same under zsh (`doc_576ys5ch`). So it is not covered by the recovery clause
either — the shell never refused the line.

**Decision: state the residual beside the claim rather than weaken the claim.** The claim is
about *characters* and is true of every one of them; the residual is a **line**, which is a
different kind of thing and has a one-word repair. Weakening the claim to *"almost no character
list"* would cost the sentence that makes the construction worth using and would still not tell
an agent what to do. The skill now reads:

> One thing is left, and it is not a character but a **line**. … It is not caught by anything
> downstream: measured, the write still succeeded, exit `0`, the document committed with its
> body cut off at that line, and `command not found` the only sign it went wrong. The
> terminator is a word you choose, so when the text you are carrying could contain one, choose
> a word it cannot.

The repair is verified: the same body under a distinctive terminator created `doc_nsjfbl24`
(bash) and `doc_vfdfygo5` (zsh), exit `0`, no leaked commands, and `doc show` reads the body
back whole including the `EOF` line. **No alternative terminator is shown as an example**, in
prose only: `coreSkills` pins every heredoc opener to `<<'EOF'` exactly and counts openers
against bare closers, so a demonstrated alternative would fail two pins for no reader benefit.

### NIT 10 — the AGENT-036 pin, made reflow-proof

**Confirmed real.** The extraction is now whitespace-flattened and takes the first two string
literals after the branch condition, rather than matching the ternary as currently laid out.
Compared old against new across the shapes the source could take (`apps/cli/` read only, never
written — another agent holds it):

| source shape | old extraction | new extraction |
| --- | --- | --- |
| as shipped | `"no documents match."` | both messages |
| prettier wraps after the `?` | **`undefined` → false red** | both messages |
| ternary becomes `if`/`else` | **`undefined` → false red** | both messages |
| first message reworded | follows the rewording | follows the rewording |
| branch deleted | `undefined` | `undefined` |

The two rows in bold are the false red the finding predicted, and the failure message it would
have printed — *"doc list no longer branches on an empty first page"* — was untrue in both.
The pin also gained a real check it did not have: the second literal is the *later-page*
message, and the skill is now held to not transcribing it, since an empty later page is a state
a roster read passing no offset can never reach.

### Pins added, and each falsified

Every new pin was falsified by deleting the text it covers and confirming it — and nothing else
— goes red. 380 tests, `VITEST_MAX_THREADS=4`.

| mutation | tests failing |
| --- | --- |
| delete the whole recovery paragraph (restores *"send it again"*) | 1 — `hands over a repair that is not the construction that just failed` |
| delete only the boundary paragraph | 1 — same |
| delete only the `IFS= read -r` example block | 1 — same |
| delete the MINOR 7 residual sentences | 1 — `names the one residual the construction does not cover` |
| move the sign-off block back below step 4 | 1 — `puts the sign-off block under the step that sends it` |
| `profile`'s transcript reworded | 1 — `transcribes the empty roster as the CLI actually prints it` |
| `profile`'s transcript takes the later-page branch | 1 — same |

### Whole-file checks

`npx vitest run scripts/workspace-template.test.ts` — **380 passed**. `npx eslint
scripts/workspace-template.test.ts` — no issues. `prettier --check` clean on all three touched
files. All four skills parsed with `mdast-util-from-markdown`: **zero** unclosed fences, and
`sections.size` still 16 / 13 / 15 / 7 (the raw mdast `h2` count is one higher in each file —
the frontmatter's closing `---` reads as a setext underline without a frontmatter plugin — so
the vitest pins, not the parser, are the count of record). Server stopped; port 8797 free.

## PR #50 second review

Three findings, all in this issue's text: **MAJOR 3** (the residual's remedy contradicted the
rule it sits under, and the default terminator was the worst available), **MINOR 4** (the
`$( … )` diagnosis was narrower than the defect), **NIT 8** (a pin forbidding two ordinary
English words across a whole product file).

### MAJOR 3 — the terminator is fixed, not chosen against the text

**Reproduced first, both shells.** A value captured through a quoted heredoc, carrying a pasted
transcript that contains a line reading exactly `EOF`:

```
$ /bin/bash before.sh
before.sh: line 14: EOF: command not found
title=[Transcript from the vendor:
$ cat <<'EOF'
line one]                       # truncated at the carried EOF line
exit=0
-rw-r--r--  1 …  /tmp/agent035b/pwned.txt     # touch ran, from carried text

$ /bin/zsh before.sh
before.sh:7: command not found: EOF
exit=0                          # same truncation, same file created
```

**Through the real CLI**, workspace on port 8801, `corpus` 0.9.0, `--from agent`. Old
terminator, carried text holding a bare `EOF` line:

```
created doc_4ha5os3u — data/docs/inbox/vendor-transcript-old-terminator.md
e2e_before.sh: line 10: They: command not found
e2e_before.sh: line 11: EOF: command not found
```

`corpus doc show doc_4ha5os3u` ends at *"first line of their body"*. Three lines of the person's
message never reached the corpus — including *"They asked whether the quote of $18,400 still
stands."* — and `touch` ran. The create itself reported success.

**After**, same carried text, terminator `CORPUS_EOF`, same script under each shell:

```
created doc_x46apawn — data/docs/inbox/vendor-transcript-bash.md    exit=0
created doc_ag2ktmea — data/docs/inbox/vendor-transcript-zsh.md     exit=0
ls: /tmp/agent035b/pwned3.txt: No such file or directory
```

Both bodies compared byte for byte against the carried text: **identical**, including the line
reading `EOF`, the `<<'EOF'` inside it, the `$18,400` and the `touch` line as text. Nothing ran.

**Why `CORPUS_EOF`.** Every fixed terminator is collidable in principle, so the choice is made
on what carried text actually holds. `EOF` is the terminator of every shell transcript ever
pasted, and the skill names a pasted transcript as the arrival vector — it is the single worst
available word. Any non-`EOF` word is equivalent against outside text; what is left is
self-collision (a corpus transcript pasted back), which no fixed word escapes and a per-message
nonce would only trade for a judgment call — and a judgment call is the inspection the
construction exists to remove. `CORPUS_EOF` is also self-labelling: a heredoc in the wild
carrying it came from these skills.

The remedy is now unconditional and states the mechanism as its reason rather than as an entry
condition: *"you choose it once, not per message: the terminator is always `CORPUS_EOF`, never
`EOF`"*, closing with *"Weighing it is the inspection this whole construction exists to
replace"*. All **34** heredocs in the four core skills moved (orchestrate 8, comment 14,
converse 5, profile 7), plus the todos plugin skill's one — a rule stated as *always* and
demonstrated 34 times with the other word teaches the other word.

### MINOR 4 — the diagnosis widened, re-measured

Re-measured here, not copied. Value in a quoted heredoc inside `$( … )`, `bash 3.2.57(1)` and
`zsh 5.9`:

```
it's here    → bash: unexpected EOF while looking for matching `''   zsh: GOT=[it's here]
he said "go  → bash: unexpected EOF while looking for matching `"'   zsh: GOT=[he said "go]
a ` tick     → bash: unexpected EOF while looking for matching ``'   zsh: GOT=[a ` tick]
```

`IFS= read -r` returned all three byte-exact under both shells. Against the real CLI the repair
landed the title `O'Brien — "cabinet" quote, $18,400 ` + backtick-`whoami` byte-exact under
bash (`doc_del7cnye`) and zsh (`doc_pj5rymkj`); the capture form refused under bash 3.2 and
landed the same title under zsh (`doc_sug6gdgl`). The prose now reads *"one unbalanced quoting
character anywhere in the value"*, names all three with their shells, and says outright it is
*"not about apostrophes and not about counting them"*.

### NIT 8 — scoped to the bullet it guards

The mechanism check ran over the whole `profile` body with `/alias|targetIndex|invocableName|autocomplete/i`.
It now extracts the bullet it exists for (*The write is refused for any other reason*) and
checks that, with `targetIndex|invocableName|\balias(?:es)?\b|indexed under|skips any row`. A
sentence elsewhere in the file about the composer's autocomplete listing an alias now passes
(measured, below); the same words inside the bullet still fail.

### Pins moved, and each falsified

Every pin below was falsified by mutating the text it covers and confirming the run goes red,
then restoring and confirming green.

| mutation | result |
| --- | --- |
| reintroduce `<<'EOF'` as one skill's opener | red — `… ends every heredoc with CORPUS_EOF` |
| close one heredoc with a bare `EOF` line | red — same, and `opens a heredoc it can close` |
| restore the conditional remedy (*choose a word it cannot*) | red — `fixes the terminator once, with no text to weigh it against` |
| drop only the *"weighing it is the inspection"* sentence | red — same |
| narrow the diagnosis back to *odd number of apostrophes* | red — `hands over a repair that is not the construction that just failed` |
| indent a `CORPUS_EOF` terminator | red — `indents no heredoc terminator` |
| indent an `EOF` terminator (old word) | red — same (pattern covers both) |
| a line after a trace, before the terminator | red — `puts a trace last in its turn, or none` |
| remove one heredoc (34 left) | red — `has heredocs in the installed skills for that rule to bind` |
| unquote a delimiter | red — `quotes every heredoc it hands text to` |
| `invocableName` inside the guarded bullet | red — `keeps a misfiled profile's consequence` |
| rename the guarded bullet's lead-in | red — same (no vacuous pass) |
| *"The composer's autocomplete lists an alias"* as a different bullet | **green** — the narrowing works |

The pins that moved rather than being added: the terminator literal in every heredoc regex
(openers, closers, the `String.raw` builder in the `profile` block, and the extractor fixture at
the end of the file), the two `trace not last in its turn` assertions, the indent pattern
(widened to `^\s+(?:CORPUS_)?EOF\s*$` so a reintroduced old word still fails there), and the
open/close counter. Anti-vacuity for the new prohibition is aggregate — a plugin fixture skill
ships no heredoc, so a per-skill *"at least one"* would fail on it — plus the per-core-skill
count that already existed.

### Whole-file checks

`VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts` — **388 passed**.
`npm run lint` — clean. `prettier --check scripts/workspace-template.test.ts` — clean
(`assets/workspace/` is prettier-ignored by design). Test server stopped, port 8801 free; the
user's 8765 was never touched.

### Escalation — the CLI's own help examples still say `EOF`

Out of this domain and left alone: `apps/cli/src/commands/{doc/create,doc/edit,doc/patch,thread/reply,thread/create,skill/create}.ts`
and `apps/cli/src/input.ts` show `<<'EOF'` in `--help` examples and in the *body required* hint,
and those are regenerated into `docs/cli.md`. The agent reads that surface, so it is the same
defect one file over: a rule stated as *always* with the CLI demonstrating the other word. Needs
a CLI issue (the doc is generated and drift-checked, so it cannot be hand-edited here).

## Completion Checklist (domain agent)

- [x] Tests written and passing (380 in `scripts/workspace-template.test.ts`)
- [x] `/lint` passes (eslint + prettier)
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-035]` prefix
