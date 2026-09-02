# Skill genesis — where a rule goes, and how one is written

The comment skill says what earns codification. This file is the act itself: choosing between
extending a skill and creating one, the creation mechanics and what the server refuses, and
the two rules that keep a workspace's guidance coherent. Read it before you create or edit
any skill.

**Where it goes.**

- **Extend an existing skill when one fits.** Find the skill whose job the pattern belongs to
  the way you find anything else — `corpus search "<the pattern>" --type skill`, since a
  skill is indexed like every other document — and edit it, including the comment skill
  itself, whose subject is exactly how threads are handled. A skill is a document, so it is
  read and written like one: `corpus doc show <skillDocId>` for its body and its key, then
  `corpus doc edit <skillDocId> --key <the key that read printed> --from agent` with a
  heredoc body, keeping **both** frontmatter field sets intact — `name` and `description` for
  Claude Code, `id`/`type`/`title`/`tags`/`status` for Corpus — so both readers keep seeing
  it.
- **Create a genuinely new skill when nothing installed fits**, with
  `corpus skill create <name> --flag-file description=<path> --from agent` and a heredoc body.

**Nothing searches for a skill, so a description is the only way one is found.** An undirected
turn runs no step that lists this workspace's skills and matches them against what was asked —
the runtime invokes a skill whose description covers the request, exactly as it invoked the
loop you are reading. **Do not add such a step.** It would be a second mechanism beside a
working one, and it would be the expensive kind: a listing on every turn, in a loop whose whole
discipline is that you retrieve rather than enumerate.

Everything below follows from that.

**A description says when to reach for the skill, not what the skill is.** It is the only text
read when deciding whether to use one at all, so write it as the trigger: the occasions, in
the words somebody would actually say. `profile` is the pattern to copy — *"Reach for this
whenever somebody asks for an agent of their own, in whatever words they use — 'make me a
proofreader', 'I want an agent that keeps the finances straight'"*. A description that says
only what the skill **is** will be found only when somebody names it, which for a skill nobody
knows about is never.

This is the rule the whole arrangement rests on. Nothing lists your skills and matches them
against a request — the comment loop says so outright — so a skill is reached for because its
description said this was the occasion, and for no other reason.

**The honest limit, so nobody is surprised by it later**: none of this is enforced by anything.
The runtime invokes by description because that is what it does, and if it stops, the rule
stops holding and nothing fails loudly. Writing a description that names its occasions is the
whole of what you can do about that.

**The three loop skills are the exception, and it is not a loophole.** Nothing discovers
`comment`, `orchestrate` or `converse` — one invokes the next by name, and a person types
`/orchestrate`. A trigger on them would be a rule applied where it cannot bite. Every skill
anybody has to *find* is covered.

**Creating one, in full.** The description is prose a person and another agent both read, and
it comes out of what somebody kept telling you — so it goes in by path, never quoted straight
into the flag. Write `/tmp/corpus-description-evt_5a2b7c.txt` — named for the skill it
creates — with your file-writing tool:

```
Run the weekly review over the corpus — what changed, what drifted, what's owed.
```

The body below is **yours**, so it rides the command's own heredoc. Note where the fences sit:
a heredoc terminator only closes the heredoc on a line of its own with nothing in front of it,
so an indented copy of this block ends up with the rest of the file inside the body.

```bash
corpus skill create weekly-review --flag-file description=/tmp/corpus-description-evt_5a2b7c.txt --from agent <<'CORPUS_EOF'
# Weekly review

Survey what changed this week, update what drifted, and reply with the findings.
CORPUS_EOF
```

The server owns the mechanics; do not pre-check them — know what comes back when one is
violated. The name is lowercase letters, digits and single hyphens, at most 64 characters
(anything else is a `400`). A name already installed **or archived** is a `409`; for an
archived skill that `409` means unarchive it with `corpus doc unarchive <id>` — never
create the same skill again under a different name. `--description` is required, not
decoration: Claude Code discovers a skill
by its `name` and `description`, so a skill without one is installed but never invoked.
The file lands at `.claude/skills/<name>/SKILL.md` with **both** frontmatter vocabularies
written by the server — `name`/`description` for Claude Code, `id`/`type`/`title`/`tags`/
`status` for Corpus — live immediately, findable on the board, and editable like any
document as long as a later `corpus doc edit` keeps both field sets intact. The ways back
are cheap and are the ordinary ones: `corpus doc archive` disables a skill that misbehaves
or that stopped earning its place, and a wording you regret is reverted like any other
document — read the history, write the old text back with the key (the skill's *Doing the
work*, and `references/history.md` beside it).

**The conflict rule.** A correction that contradicts an existing skill is an **edit to that
skill**, never a second skill saying the opposite. Two rules in disagreement is worse than the
wrong rule, because nothing tells you which one is current.

**Announce it in the reply**, always, naming the skill you changed or created — codified
behavior the person did not agree to is the one change they cannot see coming, and a genesis
is a real, immediate write into `.claude/`. Add that a skill change — edit or genesis alike —
takes effect on the **next** run of the loop, not in the session that is running.
