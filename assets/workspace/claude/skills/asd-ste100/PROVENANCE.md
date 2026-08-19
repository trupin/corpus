# Provenance

This skill is vendored, not written here.

|         |                                                                           |
| ------- | ------------------------------------------------------------------------- |
| Source  | https://github.com/danyuchn/asd-ste100-skill                              |
| Commit  | `d5ce157870cf9c41efd1d6e836706a2be3c7b9da` (`master`, fetched 2026-08-18) |
| Author  | Dustin Yuchen Teng                                                        |
| Licence | MIT — see `LICENSE` in this directory                                     |
| Version | 0.4.0, per the SKILL.md frontmatter                                       |

`SKILL.md`, `references/writing-rules.md` and `examples/before-after.md` are
copied byte for byte. Do not edit them. An edit here is lost the next time the
skill is refreshed, and it makes the vendored copy disagree with its source
without saying so.

**To update:** refetch all three files and the LICENSE from the same paths, then
change the commit and the date above. Read the diff before you commit it — this
skill governs how the orchestrator writes to the user, so a change to it is a
change to every reply.

## What it does not contain

ASD-STE100 is free to obtain and **not** free to redistribute. The standard's own
terms grant reproduction rights to eight categories of organisation, and this
project is in none of them. The upstream skill therefore leaves ASD's ~900-word
approved dictionary out, and applies the underlying principle instead.

The practical consequence is stated in the skill itself: the **structural** rules
are checkable from the description alone, and the **lexical** rules degrade to a
preference for plain words. Neither this repository nor anything it ships may
claim ASD-STE100 compliance.

## Where the rule that uses it lives

The skill file alone changes nothing, because a skill fires when something
invokes it. The standing rule that applies it to every reply is in `CLAUDE.md`,
under **How the orchestrator writes**. Delete one and the other stops meaning
anything.

The product ships its own copy for its own agent (AGENT-037). That copy is
separate on purpose: `.claude/` is the development harness and reaches no user,
and `assets/workspace/` is the product. Changing one does not change the other.
