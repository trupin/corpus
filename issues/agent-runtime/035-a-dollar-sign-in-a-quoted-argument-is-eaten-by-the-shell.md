# [AGENT-035] A `$` in a quoted argument is eaten by the shell, and no skill says so

## Domain

agent-runtime

## Status

todo

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

- [ ] An agent writing `$18,400` into a title, tag, or form answer through the
      CLI produces `$18,400` in the document — verified in a **real drill**, not
      by reading the rule
- [ ] Whatever the fix, it is stated **once**, in the skill that owns the act,
      with a pointer from any other that needs it (the single-owner registry in
      `scripts/workspace-template.test.ts`)
- [ ] The existing heredoc guidance is reconciled rather than duplicated — one
      rule about untrusted text reaching a shell, not two rules that happen to
      agree
- [ ] Other expansions are considered, not just `$`: backticks, `!` under
      history expansion, and a trailing backslash
- [ ] If the route chosen is mechanism, a CLI issue is filed and this one depends
      on it

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

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-035]` prefix
