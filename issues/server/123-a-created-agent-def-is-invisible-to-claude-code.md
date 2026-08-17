# [SERVER-123] A created agent-def carries none of Claude Code's frontmatter, and nothing says so

## Domain

server

## Status

todo

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

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-123]` prefix
