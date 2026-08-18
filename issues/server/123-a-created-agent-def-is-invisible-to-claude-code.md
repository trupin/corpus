# [SERVER-123] A created agent-def carries none of Claude Code's frontmatter, and nothing says so

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-122
- Blocks: —
- Related: AGENT-034 (the `profile` skill, which works around this today)

## Spec References

- SPEC.md **§7** line 397 — *"Corpus's frontmatter fields (`id`, `type`, `title`,
  `tags`, `status`, `anchors`) coexist with Claude Code's (`name`,
  `description`) in the same YAML block; `corpus doc check` validates both sets"*

## Summary

**`corpus doc check` does not validate both sets, and §7 says it does.**

Measured by AGENT-034 against a real `claude` session, 2026-08-17:
`corpus doc create --type agent-def --title "Archivist"` writes Corpus's
frontmatter and **none of Claude Code's**. Claude Code loads a subagent only when
**both** `name` and `description` are present:

| frontmatter | listed by Claude Code |
| --- | --- |
| neither | **no** |
| `description` only | **no** |
| `name` only | **no** |
| both | **yes** |

`corpus doc check` reported **no findings** in every one of those states, and
nothing else warned either. So the verb produces a profile Corpus will happily
designate and Claude Code cannot run — a silent failure, and precisely the case
§7's sentence promises is checked.

**A second, independent divergence.** The two resolvers disagree about what a
profile is *called*. With `name: numbers` on `.claude/agents/bareprofile.md`,
Claude Code lists it as `numbers` while Corpus resolves it as `@bareprofile`
(`corpus thread designate --agent numbers` → `404`; `--agent bareprofile` →
designated). One file, two addresses, no error anywhere.

**Not a regression.** Before SERVER-122 the verb filed agent-defs under
`data/docs/`, where Claude Code never looks at all — so this is strictly less
broken than it was, and v0.11.0 ships it improved but incomplete. The `profile`
skill (AGENT-034) works around it with two `--extra` fields and a read-back,
which is why the feature the user asked for works; the raw verb is what does not.

Filed rather than fixed in v0.11.0, deliberately: the fix is a design decision
about who owns a description, and the release's scope was agreed before this was
known.

## What has to be decided

**Who writes `name` and `description`, and what does `check` say when they are
absent?** Three routes, and the issue does not pick one:

1. **The server derives `name` from the file stem** — it must equal the stem
   anyway, since that is what Corpus resolves — and leaves `description` to the
   caller, with `check` warning when it is missing. Fixes the naming divergence
   outright.
2. **`check` warns for both and the server writes neither.** Honest, smallest,
   and leaves a caller who ignores warnings exactly where they are today.
3. **The create route requires both for `type: agent-def`.** Strongest, and it
   makes `corpus doc create --type agent-def` unusable without them — which may
   be right, since a profile without them does not work.

Whichever is chosen: **the silent case must end.** A profile that Claude Code
cannot load must not pass `check` without a word.

## Acceptance Criteria

- [ ] An agent-def missing `name`, `description`, or both is reported by
      `corpus doc check` — §7's "validates both sets" becomes true
- [ ] The warning names which field is missing and what it costs (the profile
      will not load), not merely that a field is absent
- [ ] The naming divergence is resolved or reported: a `name` that differs from
      the stem must not silently produce one file at two addresses
- [ ] Hand-authored profiles that already work are unaffected
- [ ] A profile created through whatever route this settles on is loadable by a
      real `claude` session — verified in a drill, not assumed
- [ ] `assets/workspace/claude/skills/profile/SKILL.md` is revisited: if the
      server now supplies what the skill supplies by hand, the skill sheds the
      workaround rather than keeping a second copy of the rule

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/check.ts` (or wherever `CHECK_CODES` findings are
  produced) — the new finding
- `apps/server/src/docs/write.ts` / `create.ts` — only if route 1 or 3 is chosen
- `packages/contract` — if a new warning code is needed, §14's warning set is
  closed and this is a cross-domain change; escalate rather than widening it
  quietly

### Key Implementation Details

Note the constraint `isSkillFrontmatterException` already encodes: §5's canonical
frontmatter block is **waived** under the skill and agent-definition roots,
because those files legitimately carry Claude Code's fields and not Corpus's.
This issue is the mirror image — the fields that root *does* need — so the
waiver and the new finding must not contradict each other.

Sprint-013 Adjudication 6 binds: **a document the system accepts on write must
not fail a check.** If `check` starts reporting these, decide whether the create
route must therefore supply them, or whether the finding is a *warning* rather
than an error.

## Testing Strategy

Check-path tests for each of the four frontmatter combinations. A test that the
waiver still holds for a hand-authored `SKILL.md`. Falsify by removing the
finding and watching the specific combinations go green.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Create an agent-def through the route this settles on
3. Run a **real `claude` session** in that workspace and confirm it lists the
   subagent — the only test that matters here
4. Create one missing each field and confirm `corpus doc check` says so
5. Stop the server; confirm the port is free

## Route chosen

**Route 3, adapted: the create route supplies both fields, and `check` reports
them as errors under `frontmatter-invalid`.** Concretely — `name` is *derived*
from the allocated filename (route 1's insight: it is not caller data, since
`.claude/agents/<stem>.md` is what makes `@<stem>` resolve), and `description`
is taken from `extra.description` when the caller sends one and **defaulted to
the title** when it does not. A caller-supplied `name` that disagrees with the
filename is a `400`; an explicitly empty `description` is a `400`.

**Why the others lost.**

- **Route 2 (check warns, server writes neither)** fails acceptance criterion 5
  outright: `corpus doc create --type agent-def` would go on producing a file
  Claude Code silently does not load — the exact defect SERVER-122 made
  consequential — and, in the issue's own words, "leaves a caller who ignores
  warnings exactly where they are today".
- **Route 1 (derive `name`, warn for `description`)** fails the same criterion
  for the same reason: the drill confirms a `name`-only profile is **not
  listed**. Its good half is kept — deriving `name` is exactly what closes the
  naming divergence at the source.
- **Both also need a new wire code.** `corpus doc check`'s vocabulary *is* §14's:
  `apps/server/src/core/check.ts`'s `CHECK_CODES` is pinned member-for-member to
  the contract's `CHECK_CODES` by `apps/server/src/check/codes.test.ts`, and
  `CHECK_WARNING_CODES` is closed at two. Reporting these as *warnings* is
  therefore a contract change. Reporting them as **errors** needs none:
  `frontmatter-invalid` already means "this document's frontmatter does not carry
  what a file in its position must", which is precisely what §7:399 asks to be
  checked, for both sets.
- **Adjudication 6 then forces the create half.** `frontmatter-invalid` is in
  `LOCAL_CHECK_CODES`, so it blocks a save. A blocking finding the create route
  did not satisfy would make `--type agent-def` a verb that always fails, so the
  create must supply what the check demands — which is what route 3 says.
- **Why `description` is defaulted rather than required.** §11's creation is
  zero-form ("a type and a title are the whole requirement, and everything else
  the server fills in"), and `corpus doc create` has **no `--extra` flag** — so a
  hard requirement would be unsendable through the agent's only interface
  (Architecture Decision 2) and would break the `profile` skill outright. The
  title is what the caller said the agent is; thin, and **loadable**, which is
  the whole difference this issue is about. `corpus doc edit --extra
  description=…` (which does exist) is how it is made good.

**The waiver and the finding do not contradict, structurally.** They are now two
answers from one seam: `CheckOptions.claudeCodeRoot`, supplied by `checkSeams`.
Non-null waives §5's canonical block; a non-null `discoveredAs` requires Claude
Code's. `isSkillFrontmatterException` — a post-filter over `code` + `path`
applied in two consumers — is **deleted**, because it could not have told §5's
finding from this one: same code, opposite reason.

**Scope: `.claude/agents/` only, deliberately.** Claude Code discovers a skill by
`name`/`description` too, but nothing in this system can produce a skill without
them (`SkillCreateRequestSchema` requires `description`, in these very words), so
§7:399's promise is already kept there on the create side. Since the finding is
blocking, extending it to `.claude/skills/**` would refuse writes — *unarchiving*
a skill among them, which validates at its `.claude/skills/` destination — to
hand-authored files this system never wrote, for a defect nobody has measured.
Extending it later is one expression (`claudeCodeRootFor`). **Residual, reported:
a hand-authored `SKILL.md` missing `description` is still not reported, so
§7:399 is true for agent-defs and not yet for skills.**

**No contract change was needed.**

## E2E Verification Log

**Model: Opus 5 (1M context). Date: 2026-08-17.**

Throwaway workspace `~/.claude/jobs/4dd0ddef/tmp/s123-ws`, real server on port
**8851** (`corpus server start`, pid 19411, running `apps/server/src/main.ts`
under tsx — i.e. the code under test), real `claude` **2.1.233**.

### 1. The create writes both fields

```
$ corpus doc create --type agent-def --title "Archivist" <<'EOF' … EOF
created doc_7dpwvwqu — .claude/agents/archivist.md

$ cat .claude/agents/archivist.md
---
name: archivist
description: Archivist
id: doc_7dpwvwqu
type: agent-def
…
```

### 2. The only test that matters — a real `claude` session lists it

Five more profiles were then written **by hand** into `.claude/agents/` covering
every combination, and one real session was asked to list its subagent types:

```
$ claude --print --permission-mode plan "List every subagent type available to you…"
archivist
claude
drillboth
Explore
general-purpose
numbers
Plan
statusline-setup
```

| file | frontmatter | listed by Claude Code |
| --- | --- | --- |
| `archivist.md` (**server-created**) | both | **yes — `archivist`** |
| `drillboth.md` | both | **yes — `drillboth`** |
| `drillneither.md` | neither | no |
| `drillname.md` | `name` only | no |
| `drilldesc.md` | `description` only | no |
| `drillnumbers.md` | `name: numbers` | **yes — as `numbers`** |

The issue's table reproduces exactly, and the last row reproduces the second
divergence: one file, listed by Claude Code under a word its filename does not
contain.

### 3. `corpus doc check` now says so — all four combinations plus the divergence

```
$ corpus doc check
error frontmatter-invalid .claude/agents/drillneither.md: name: missing — Claude Code loads a
  subagent only when its frontmatter carries both `name` and `description`, so this profile is
  listed by nothing, dispatched to by nothing, and warned about by nothing; it must be
  `drillneither`, the filename Corpus resolves `@drillneither` by
error frontmatter-invalid .claude/agents/drillneither.md: description: missing or empty — …
error frontmatter-invalid .claude/agents/drilldesc.md: name: missing — …
error frontmatter-invalid .claude/agents/drillname.md: description: missing or empty — …
error frontmatter-invalid .claude/agents/drillnumbers.md: name: `numbers` is not the filename
  `drillnumbers` — Claude Code dispatches to this subagent as `numbers` while Corpus resolves it
  as `@drillnumbers`, so one file answers to two addresses and neither reader knows about the other
corpus: 5 errors in 17 documents.
$ echo $?
6
```

`archivist.md` and `drillboth.md` produce nothing: `corpus doc check doc_7dpwvwqu`
→ *"checked 1 document — no findings."*, exit **0**. The two skills `corpus init`
installs, and every seeded document, are also silent — the run's 5 errors are the
5 hand-broken files and nothing else.

### 4. The two-address divergence, measured

`sqlite3 .corpus/cache.db` shows the projection titled `drillnumbers.md`
**`numbers`** (a file with no Corpus `title:` falls back to `name`), so Corpus
answered to *both* words:

```
$ corpus thread designate th_rsqct3ng --agent numbers
designated drillnumbers (doc_agentdef413368b9) on th_rsqct3ng
$ corpus thread designate th_rsqct3ng --agent drillnumbers
designated drillnumbers (doc_agentdef413368b9) on th_rsqct3ng
```

That is a second shape of the same defect (the issue measured the other one — a
profile carrying its own `title:`, where `numbers` resolves to nothing). Both are
now reported, and neither can be created through the API any more.

### 5. The write path refuses to make one

```
$ corpus doc edit doc_drillnei --add-tag research
  "path": "frontmatter-invalid",
  "message": "description: missing or empty — …"

$ corpus doc edit doc_7dpwvwqu --extra name=numbers
  "path": "frontmatter-invalid",
  "message": "name: `numbers` is not the filename `archivist` — …"
```

### 6. And the repair is one command

```
$ corpus doc edit doc_agentdef5a136e5d --extra description="Only a name, until now."
edited doc_agentdef5a136e5d
$ corpus doc check doc_agentdef5a136e5d
checked 1 document — no findings.
```

### 7. Teardown

Server stopped; port 8851 confirmed free.

### Checks

`eslint apps/server/src` 0 · `prettier --check apps/server/src` 0 ·
`tsc --noEmit -p apps/server` 0 · full `apps/server` vitest suite green.

## Handed back to the orchestrator

1. **`assets/workspace/claude/skills/profile/SKILL.md` (agent-runtime domain,
   criterion 6) — one paragraph is now false.** It says *"`corpus doc check`
   passes a profile carrying neither field, so a green check proves nothing
   here"* and calls the read-back "the only check that exists". Both are now
   wrong. The `--extra name=<stem>` half of its second command is redundant (the
   server derives it, and a disagreeing value is refused), and the read-back can
   go. What should stay: `--extra description=…` as a **quality** step — the
   server's default is the title, which loads but says nothing about *when to
   reach for this one*. Nothing in the skill is broken, so this is not a blocker.
2. **Residual §7:399 gap for skills**, scoped out above with reasons — worth its
   own issue if you want the sentence true for both roots.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified (criterion 6 handed back — `assets/workspace/`
      is the agent-runtime domain; nothing there is broken, one paragraph is now
      stale)

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-123]` prefix
