# [AGENT-034] A skill that creates an agent profile

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-122, CLI-050
- Blocks: —

## Spec References

- SPEC.md **§7** line 397 — `.claude/agents/*.md` as `type: agent-def`
- SPEC.md **§10** line 539 — *"Creating a new skill or subagent document
  instantly makes it autocompletable — there is no separate registry."*
- SPEC.md **§7** — the SHARED-048 rider: a profile is how a conversation gets an
  agent that behaves differently from the default

## Summary

Ship a product skill that creates an agent profile, so a person can ask for one
in conversation instead of hand-authoring YAML.

Requested by the user 2026-08-17, who will test it manually against the shipped
release. **It is in scope precisely because it is the part a user exercises
directly** — the CLI fix underneath it (CLI-050) is necessary and not
sufficient.

Today there is no skill for this. Three ship — `comment`, `converse`,
`orchestrate` — and while `orchestrate/SKILL.md:1392` tells the agent that *"a
new `type: agent-def` document is all it takes to make a persona addressable as
`@<name>`"*, nothing tells it how to write a good one, and until CLI-050 it
could not put one in the right place.

## Acceptance Criteria

- [x] A new skill under `assets/workspace/claude/skills/<name>/SKILL.md`,
      installed by `corpus init`, that creates a `type: agent-def` document in
      `.claude/agents/`
- [x] It is invocable the way the other product skills are, and its
      `description` says when to reach for it in terms a person would use
- [x] It **gathers what it needs before writing**: what the agent is for, how it
      should behave, what it should avoid. Where the request is thin it asks
      with a form (§6) in one turn rather than interrogating across several, and
      where the request is already specific it does not ask at all
- [x] The document it writes carries the frontmatter Claude Code needs (`name`,
      `description`) and is immediately resolvable as `@<name>` and designatable
      — verified in the drill, not assumed
- [x] It reports what it created, where, and how to use it, in the reply
- [x] **Refusals are honest**: a name that collides with an existing profile, a
      workspace whose root refuses the write, a blank request — each is said,
      not worked around
- [x] It never edits an existing profile as a side effect of being asked for a
      new one
- [x] **One rule, one skill**: it owns profile creation, and nothing about
      creating a profile is restated in `orchestrate` or `comment` beyond a
      pointer. `orchestrate/SKILL.md:1392`'s sentence is reconciled — it may
      keep the *fact* that a profile is a document while ceding the *procedure*
- [x] `scripts/workspace-template.test.ts` covers the new skill: the manifest
      installs it, and the single-owner registry gains its mechanism vocabulary

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/<name>/SKILL.md` — the skill
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — cede the procedure,
  keep the pointer
- `apps/cli/src/template/manifest.ts` and the template manifest — install it
- `scripts/workspace-template.test.ts` — the pins

### Key Implementation Details

**Name it for what a person asks for.** The existing three are `comment`,
`converse`, `orchestrate` — verbs at the grain of the act. Choose in that
register and record why.

**What makes a good profile is the skill's real content.** A skill that only
runs `corpus doc create --type agent-def` is a wrapper around a CLI verb and
earns nothing. The value is in what it puts *in* the document: a persona that
is specific enough to change how the agent works and short enough to stay true.
Write that guidance, and give a worked example — checked against the prose,
since a worked example contradicting its own skill is a defect this repo has
shipped before (AGENT-026).

**Drill it against a real session.** Same rule as AGENT-033, and it matters more
here because the user will exercise this by hand: drive a real Claude Code
session that asks for a profile in ordinary words, and log what the session
actually produced — the file, its frontmatter, and whether designating it then
worked.

### Edge Cases

- A request for a profile that already exists — offer to open or revise it,
  never silently overwrite
- A request so vague there is nothing to write — ask, with a form
- A name that slugs to something already taken by a *skill* rather than an agent
- Being asked inside a thread that already has a resident — creating a profile
  and designating it are two acts; do not conflate them unless asked

## Testing Strategy

`scripts/workspace-template.test.ts` for installation and single-ownership. The
behavioural test is the drill.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a throwaway workspace, port not 8765 / not 5173; start the
   real server
2. Confirm the skill was installed by `init` into `.claude/skills/`
3. Run a real Claude Code session in that workspace, ask for an agent profile in
   ordinary words, and let the skill run
4. `find .claude/agents` shows the created file; `cat` it and read the
   frontmatter and body
5. `corpus thread designate <th_…> --agent <name>` succeeds; `corpus agents`
   shows it
6. Ask again for the same name; confirm the collision is reported, not
   overwritten
7. Stop the server; confirm the port is free

## E2E Verification Log

Ran on **opus** (Opus 5, 1M context). Workspaces under
`~/.claude/jobs/4dd0ddef/tmp/{probe,s034-drill,s034-drill2}`, real server on port
**8841** throughout, stopped at the end (port verified free; 8765 untouched).
Drill transcripts retained as `s034-drill-transcript.jsonl`, `s034-drill-b.jsonl`,
`s034-drill-c.jsonl`, `s034-drill-d.jsonl`, `s034-drill-e.jsonl`
(`claude -p --output-format stream-json --verbose`).

### The finding the skill is built on (measured, `probe` workspace)

`corpus doc create --type agent-def --title "Archivist"` lands
`.claude/agents/archivist.md` with **neither `name` nor `description`** — Corpus's
frontmatter only. Against a real `claude` session in that workspace, asked to
list its subagent types:

| frontmatter | listed by Claude Code |
| ------------------------- | --------------------- |
| neither field | **no** |
| `description` only | **no** |
| `name` only | **no** |
| both | **yes** |

`corpus doc check` reported *no findings* in every one of those states, and
nothing else warned either. So the CLI verb alone produces a profile Corpus can
designate and Claude Code cannot run, silently — which is what makes this more
than a wrapper, and what the skill's second command exists for.

Second measured fact: the two resolvers disagree independently. Setting
`name: numbers` on `.claude/agents/bareprofile.md` gave `numbers` in Claude
Code's subagent list and `@bareprofile` in Corpus
(`corpus thread designate --agent numbers` → `404`, `--agent bareprofile` →
designated). One file, two addresses, no error. Hence the skill's rule that
`name` must be the stem of the path the create printed.

Collision is honest already: a second `--title "Archivist"` is exit **5**,
*the name `archivist` is already taken in .claude/agents*, nothing written, no
`-2` dedupe (`allocatePath` refuses under that root by design).

### Install

`corpus init s034-drill --port 8841` → *installed **10** template files*;
`.claude/skills/` contains `comment converse fixture-notes orchestrate profile
todos`. No manifest edit was needed: the installer copies the tree wholesale.

### Drill A — ordinary words, near the worked example's domain

Prompt: *"I keep having to remind you where the numbers came from whenever we
talk about the household finances. Can I have an agent of my own that just does
that properly?"*

The session reached for the skill unprompted from the description alone
(`Skill(profile)` on its first tool call), then: `corpus doc list --type
agent-def` → create → `--extra name= --extra description=` → `doc show --json |
jq` read-back → reported. It did **not** designate; it handed the command over.

**Defect found by the drill:** the persona it wrote was a near-verbatim copy of
the worked example (title *Bookkeeper*, same four rules, same closing shape) —
the example was doing the work instead of the guidance. Fixed by adding *"This
is one profile, not a template"* to the worked example, and re-drilled (E).

### Drill B — a different domain, same skill

Prompt: *"…something of my own that goes over my writing before I publish it? I
write long posts and I overdo the qualifiers."* Produced `@editor`, wholly
original: quote-the-line-and-the-trim output, "stacked hedges first", *a
qualifier that is load-bearing stays*, a ten-item cap on long posts, and a
refusal to comment on argument or voice. Behaviour not biography, refusals
present, output shape stated, one-word name, three guesses declared. The
guidance generalises.

### Drill C — collision

Prompt: *"I want an agent called editor that fixes my spelling."* Nothing was
written. It read the existing `@editor`, said what that one is for, offered the
two real choices, and refused the second without consent — *"rewriting a persona
because its name is convenient changes how work already routed to `@editor`
behaves, and you asked for a new agent."* No `@editor-2`.

### Drill D — blank request

Prompt: *"make me an agent."* Nothing written. It named the two things it would
need, listed the profiles that already exist, and volunteered §7's rider: if what
you want is presence rather than different behaviour, no profile is needed.
That claim was checked against the real CLI —
`corpus thread designate th_… ` with no `--agent` → *designated a general
resident*, exit 0; `--agent ""` is a usage error naming both spellings. (Note:
`docs/cli.md` still calls `--agent` *Required*, which is stale — CLI-049 territory,
not this issue's.)

### Drill E — the fix, re-drilled on drill A's exact prompt

Fresh `corpus init` on the edited skill, same prompt as A. This time it wrote
`@ledger`, not a copy: sourcing attached to the figure *"not a footnote, not a
list at the end"*, derived numbers showing their parts, **re-source every time a
figure comes up** — reasoning explicitly from the person's own complaint (*"that's
the drift you've been correcting"*) — and no advice. It also volunteered that the
corpus holds no finance documents yet, so the agent's first honest answers will
be *unsourced*. Same prompt, different persona: the anti-mimicry line is what
changed.

The document it wrote, verbatim frontmatter:

```
---
id: doc_jbkjvzzc
type: agent-def
title: Ledger
created: 2026-08-17T23:22:58Z
updated: 2026-08-17T23:23:02Z
tags: []
status: open
anchors: {}
due: null
reviewed: null
evergreen: false
origin: null
name: ledger
description: Reach for this for anything about the household finances — what a bill or a balance was, what something totalled, what a figure was based on. It cites the source of every number it gives.
---
You answer questions about this household's money, and you never state a figure without saying where it came from.
…
```

Then, without touching the file again:

- `corpus thread designate th_wj2kvexp --agent ledger` → *designated ledger
  (doc_jbkjvzzc) on th_wj2kvexp*
- `corpus agents` → `th_wj2kvexp "June bills" · ledger (doc_jbkjvzzc) · waiting
  for a listener`
- a fresh `claude` session in that workspace lists `ledger` among its subagent
  types

### Tests

`VITEST_MAX_THREADS=4 vitest run scripts apps/cli/src/template
apps/cli/src/commands/init` → **878 passed**, 24 files.
`scripts/workspace-template.test.ts` alone: 350 passed, including the new
`profile skill body` block (sections pinned at 7, the two-command procedure, the
name/filename tie, the read-back, the refusals, and eleven assertions pairing the
worked example against the prose above it). Prettier and ESLint clean on the
changed files.

### Review fix (PR #49, third pass) — person-authored words in shell-quoted arguments

Both of this skill's writes routed a person's words through a quoted flag
argument. Measured against a real workspace (`~/.claude/jobs/4dd0ddef/tmp/ws`,
server on port **8857**, stopped, port verified free):

| what was written | what landed |
| --- | --- |
| `--title "Kitchen quote $18,400"` | `title: Kitchen quote ,400` — exit **0**, file created, committed |
| `--extra note='it's fine'` | never runs: `bash: unexpected EOF while looking for matching '` |
| `--extra note='it's fine, isn't it'` | runs, CLI refuses: `unexpected argument "fine,"` |

So the two quoting styles fail on different characters, and the obvious repair
for the loud one (reach for double quotes) is the silent one. **The CLI has no
way out**: `-m`, `--file` and stdin feed the *body* alone — there is no
`--title-file` and no stdin form for `--extra` (`corpus doc edit --help`,
2026-08-17). The fix is therefore the idiom the body already uses, lifted onto
the short arguments: `value=$(cat <<'EOF' … EOF )` and `"$value"`. Nothing is
expanded on either leg, so the rule carries no list of dangerous characters.

Re-drilled twice on a fresh `corpus init`, prompt containing both hazards
(`"$18,400"` and apostrophes; transcripts `session.jsonl`, `session2.jsonl`).
Both sessions copied the pattern from the worked example without being told to,
spelling `--title "$title"` and `--extra description="$description"`. Read back
off disk with `od -c`:

```
$   1   8   ,   4   0   0        ← intact
w   o   r   k   s   p   a   c   e   '   s     ← intact
d   o   e   s   n   '   t        ← intact
```

Pins updated in the tightening direction (`scripts/workspace-template.test.ts`):
negative pins that no invocation spells `--title "` with a literal or
`--extra <key>='`, positive pins that both writes spell the safe form in both
places they appear, and a pin that the worked description actually contains an
apostrophe. One pre-existing scanner was corrected with them — *quotes every
heredoc it hands text to* read `<<-?\s*\S+`, which swallowed the backtick of a
heredoc merely **named** in prose; it now stops at the delimiter, and still
fails on `<<EOF` and `<<"EOF"`.

AGENT-035 keeps the general problem (the same hazard on tags, form answers, and
`corpus skill create --description`); this fix only stops this skill's own two
commands from mangling input.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-034]` prefix
