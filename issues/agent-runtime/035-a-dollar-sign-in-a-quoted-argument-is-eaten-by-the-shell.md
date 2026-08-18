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
- **`IFS= read -r var <<'EOF'` as the construction** — immune everywhere including bash 3.2,
  and rejected anyway: it silently truncates a multi-line value to its first line, and this
  issue is about not shipping constructions whose misuse is silent.

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

## Completion Checklist (domain agent)

- [x] Tests written and passing (375 in `scripts/workspace-template.test.ts`)
- [x] `/lint` passes (eslint + prettier)
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-035]` prefix
