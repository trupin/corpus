# [PLUGINS-013] An installed plugin skill teaches a reply without `--model`

## Domain

plugins

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: AGENT-021, CLI-033 (both done)
- Blocks: —

## Spec References

- SPEC.md **§11** — "An agent turn says which model wrote it"
- SPEC.md **§7** — the deciding stage

## Summary

**Found by AGENT-021 while closing the same rule one directory over**, and
reported rather than reached into another domain.

`plugins/todos/skills/todos/SKILL.md:74` shows:

```
corpus thread reply <threadId> --from agent <<'EOF'
```

with no `--model`. **`corpus init` installs that skill into every workspace** —
the init run reports "installed 2 plugin skill files" — so a shipped example
teaches the agent to post a turn that names no model, immediately after
AGENT-021 made stating one the rule.

This is the exact failure AGENT-019 was: an example that contradicts a rule
beats the rule, because the example is what gets copied. The difference is that
AGENT-021's structural sweep covers `assets/workspace/` only, so nothing catches
this one.

## Acceptance Criteria

- [x] Every turn-writing invocation in every skill under `plugins/` states
      `--model`, matching what the comment skill now teaches
- [x] **The sweep is widened to cover plugin skills**, so the next plugin cannot
      reintroduce it. AGENT-021's assertion in `scripts/workspace-template.test.ts`
      already has the right shape — every
      `corpus thread reply|create … --from agent …` must match `--model \S` —
      and needs its file set extended rather than a second copy written
- [x] Any **other** rule the core skills teach and a plugin skill contradicts is
      found in the same pass and either fixed or filed. Check at least: the
      closing-fence rule (AGENT-016), never chaining `claim-all` with `idle`
      (AGENT-019), and asking with a form rather than prose (AGENT-017)
- [x] `scripts/workspace-template.test.ts` passes, including its exhaustive
      `EXPECTED_TREE`

## Technical Design

### Files to Create/Modify

- `plugins/todos/skills/todos/SKILL.md`, and the file set in
  `scripts/workspace-template.test.ts`.

### As built

- `scripts/workspace-template.ts` — exports `PLUGINS_ROOT`, beside
  `TEMPLATE_ROOT`. The only new export.
- `scripts/workspace-template.test.ts` — one module-scope inventory,
  `installedSkills`, built from the CLI's **own** installer
  (`planTemplateInstall` + `planPluginSkillInstall` + `templateSkillNames`,
  imported from `apps/cli/src/template/install.ts` the same way
  `WORKSPACE_DIRECTORIES` already is). It is every skill document `corpus init`
  installs into `.claude/skills/`, from both trees, so a new plugin is swept the
  day it lands and a skill the installer *skips* (name collides with a core one)
  is not held to rules it never reaches a workspace to break.
  `describe("every installed skill")` runs over it: the `--model` rule moved
  there wholesale from AGENT-021's per-core-skill version, joined by the
  trace-is-last rule and the quoted-heredoc rule. What stays core-only next door
  is the non-vacuity half — that each of the two core skills shows a
  turn-writing example, a trace and a heredoc *at all* — which is a demand on a
  skill that teaches the loop, not on every skill that ships.
- `plugins/todos/skills/todos/SKILL.md` — the `--model` fix, plus the three
  sweep findings below.
- `plugins/_fixture/skills/fixture-notes/SKILL.md` — three sweep findings; it
  installs into a dev-checkout workspace like any other and is what a plugin
  author copies.
- `docs/PLUGINS.md` §`skills/` — that a plugin skill is held to the core skills'
  authoring rules and swept by that test (otherwise the rule is enforced but
  undiscoverable until CI says no), and the skill-directory naming constraint the
  routing convention implies but never stated.

### Notes

- Do not copy the assertion into a plugins-specific test. One inventory, two
  consumers — a second copy is what this repo has spent the week deleting.
- A plugin skill is prose the agent executes in a user's workspace, so it is
  product surface, not a fixture. Treat a wrong example there as a defect, which
  is why this is P1 rather than tidy-up.

## Testing Strategy

Extend the existing sweep to the plugin skills and watch it fail before the fix,
so the assertion is known to reach them.

## E2E Verification Log

**Model: Opus 5 (1M context)** — plugins-dev, 2026-08-08.

### The widened assertion fails before the fix

Widened the file set first and ran it against the **unmodified** skill, which is
the whole point of the change — a sweep that reached nothing would have passed
just as quietly as the one that never looked:

```
FAIL scripts/workspace-template.test.ts > skills > every installed skill >
'plugins/todos/skills/todos/SKILL.md' posts no example turn without a model
AssertionError: plugins/todos/skills/todos/SKILL.md: turn written with no model:
  expected 'corpus thread reply <threadId> --from…' to match / --model \S/
+ Received: "corpus thread reply <threadId> --from agent <<'EOF'"
Tests  1 failed | 158 passed (159)
```

One failure, naming the right file, with the other 158 green — so the widening
reached plugin files without disturbing the template's own rules. After the fix:
`159 passed (159)`, and the verbose run shows all four skill files swept by each
rule (`assets/workspace/claude/skills/{comment,orchestrate}`,
`plugins/_fixture/skills/fixture-notes`, `plugins/todos/skills/todos`).

### Real app: what a workspace actually gets

`corpus init` from source into a scratch workspace outside the repo
(`tsx apps/cli/src/bin/corpus.ts init /tmp/plugins013-drill --port 9271` — 8765
and 5173 avoided; no server started):

```
installed 8 template files, recorded in .corpus/template-manifest.json
installed 2 plugin skill files into .claude/skills/
```

`.claude/skills/` contains `comment/ fixture-notes/ orchestrate/ todos/`, and
every turn-writing line across all four now carries a model:

```
.claude/skills/todos/SKILL.md:78:corpus thread reply <threadId> --from agent --model claude-sonnet-4-5 <<'EOF'
.claude/skills/comment/SKILL.md:265,317,489,699,722,753,770  … --model …
.claude/skills/orchestrate/SKILL.md:419,606,686,845          … --model …
```

Re-run after the sweep fixes, the same way — every mutating example in both
installed plugin skills now carries `--from agent`, the fixture's included:

```
.claude/skills/todos/SKILL.md:39:corpus todos add "Week of Jul 20" "Renew passport" --from agent
.claude/skills/todos/SKILL.md:49:corpus doc create --type todo … --from agent
.claude/skills/todos/SKILL.md:73:corpus todos check "Week of Jul 20" "Renew passport" --from agent
.claude/skills/todos/SKILL.md:89:corpus thread reply <threadId> --from agent --model claude-sonnet-4-5 <<'EOF'
.claude/skills/fixture-notes/SKILL.md:19:corpus _fixture add "<title>" --from agent
```

That is the defect's actual blast radius closed: the file the agent reads in a
user's workspace, not just the file in this repository. Scratch workspace
removed afterwards; nothing was left listening on any port.

### Checks

- `npx vitest run scripts/workspace-template.test.ts plugins` → **981 passed**
  (38 files), `EXPECTED_TREE` included (no template file added or removed).
- After the sweep fixes, widened to the install path the changed skills go
  through: `vitest run scripts plugins apps/cli/src/commands/init apps/cli/src/template`
  → **1108 passed** (45 files).
- `eslint` + `prettier --check` clean on all four touched files;
  `tsc --noEmit -p scripts/tsconfig.json` clean.

### The wider sweep — what else a plugin skill contradicted

Swept twice: by hand against the rule list, and by a fresh read-only agent given
both core skills, both plugin skills and no knowledge of this conversation, asked
to classify every core rule as CONTRADICTS / SILENT / CONSISTENT. Six defects,
five fixed here.

**In `plugins/todos/skills/todos/SKILL.md`** — two of the AGENT-017 rule (ask
with a form, not with a sentence):

1. **Ambiguous list name.** "An ambiguous name is refused with the candidates
   named: ask which one rather than picking." — an ask whose whole purpose is to
   get something from the person, and the comment skill's reason for a form is
   exactly that a prose question stops signalling the moment the thread is read.
   Now asks with a single `choose one` field whose options are the candidates the
   refusal printed, and defers to the comment skill for the grammar rather than
   restating it.
2. **Ambiguous item text.** "If the text matches more than one item the command
   refuses and prints the numbers — **use one**." Worse than the first: it told
   the agent to pick, in a skill whose next sentence is "Check off only what the
   person said is done". Now: re-run with the number the person's own words pick
   out, and when they pick out none, ask with a form the same way.

3. **A `423` user lock was the one refusal it did not govern.** The skill
   enumerates three refusals — ambiguous list, ambiguous item, pre-migration
   `items` — and `add`/`check` take the document's edit lock, so the fourth is
   the one the core skills have a whole procedure for. Worse than plain silence:
   the nearest analogue it did supply ("say so in the thread") produces a reply
   and a *completed* event, where the core sequence is reply-then-hand-back so
   orchestrate can defer with `--blocked-on` and the write lands by itself when
   the lock clears. Now one deferential paragraph pointing at the comment skill,
   naming the `423` and the never-complete rule, restating none of the grammar.

**In `plugins/_fixture/skills/fixture-notes/SKILL.md`** — three, all found by
the second sweep and none by the first, which is the argument for having run it:

4. **Its one write example omitted `--from agent`.** `--from` is a global flag
   merged into every command including plugin verbs
   (`apps/cli/src/registry/globals.ts`), and `DEFAULT_ACTOR` is `user`, so the
   single example in an installed skill wrote a document attributed to the person
   who did not make it — the exact failure this issue is about, one file over.
   Fixed, with the sentence saying why rather than just the flag.
5. **"Nothing else."** Two words after that write, which read as *do the write
   and stop* — against "Always reply", the trace-line rule, and the job log. Now
   scoped to the plugin ("This plugin does nothing else") and followed by a
   deference to the comment skill's reply rules.
6. **It claimed a routing it does not get.** "Events of type `_fixture.*` route
   here by the `<plugin>.<action>` convention" is false: orchestrate hands
   `<plugin>.<action>` to `.claude/skills/<plugin>/`, and this skill installs at
   `.claude/skills/fixture-notes/` because its **skill directory** is not named
   after its **plugin directory** — so such an event fails with `no installed
   skill named _fixture`. Renaming the directory is not cheap (`fixture-notes`
   is written into PLUGINS-001's, CLI-005's and CLI-010's evidence logs), so the
   skill now states what is true — it is reached by name — and `docs/PLUGINS.md`
   §`skills/` gains the constraint the convention implies and never stated: name
   the skill directory after the plugin directory or the events never arrive.
   A plugin author copying the fixture would otherwise have shipped a skill no
   event can reach, with nothing failing until an event did.

Considered and **declined**: the second sweep read `## Finding the list`'s
"`corpus todos list` shows every todo document" as breaking core invariant 6
("you retrieve; you never enumerate"). It does not — that invariant forbids
sweeping the tree and listing folders, and `corpus todos list` is a typed,
bounded query, the plugin's own analogue of `corpus doc list --type todo`, which
is the affordance SPEC §12 gives it. No change.

Checked and clean, so the "nothing else" is a checked one:

- **AGENT-016, closing fences.** Both plugin skills: every fence line is nothing
  but backticks, all balanced (todos 8, fixture 2), no run riding a content line.
- **AGENT-019, `claim-all` chained with `idle`.** Neither plugin skill names any
  `corpus queue` verb at all — queue state stays with the orchestrate skill, so
  the chain is unreachable rather than merely forbidden.
- **Trace lines (SPEC §6).** todos' single trace is its turn's last line, `EOF`
  next; the fixture writes no turn and so carries none. Now asserted.
- **Quoted heredocs.** The one heredoc is `<<'EOF'`; no `-m "$(…)"` anywhere.
  Now asserted.
- **Archive-never-delete, CLI-only writes, invented facts.** todos states all
  three ("Do not delete todo documents", "Never edit a todo document's file", "an
  invented deadline is a fact you were not given"); consistent with both core
  skills.
- **Hedging vocabulary** ("use your judgment", "consider whether", …): absent.
- **Dev-harness leakage** (`SPEC.md`, `CLAUDE.md`, `issues/`): absent from the
  todos skill.

Two things found and deliberately **not** fixed here:

- **Neither plugin skill mentions `corpus job log <eventId>`**, which the core
  skills make binding inside a subagent. Silence, and orchestrate's dispatch
  prompt is what is supposed to carry it into a subagent's hand — so the fix, if
  one is wanted, is a rule about what a plugin skill must restate, not a line in
  two files. Worth an issue; not this one.
- **The `docs/cli.md` resolution sweep still stops at the template.** Extending
  it to plugin skills would resolve `corpus todos add|check|list|migrate` fine,
  but `docs/cli.md` filters `_*` topics in every environment, so the fixture's
  `corpus _fixture add` cannot resolve and the widening needs an underscore
  carve-out to be honest. Out of scope for a P1 about `--model`; worth its own
  issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on the touched files, `tsc -p scripts`)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[PLUGINS-013]` prefix
