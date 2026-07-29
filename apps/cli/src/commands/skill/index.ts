import type { TopicSpec } from "../../registry/types.js";
import { rollbackCommand } from "./rollback.js";

/**
 * Skills as documents (SPEC.md §7). A skill is `.claude/skills/<name>/SKILL.md`
 * with `type: skill`, indexed in place and edited with the ordinary document
 * verbs — `corpus doc show`, `corpus doc edit`, and `corpus doc archive`, which
 * is what disabling a skill *is*. The one thing a document verb cannot express
 * is recovery: undoing a bad edit to the loop's own skill needs a targeted
 * revert, and that is the single verb this topic carries.
 *
 * A skill's name is its directory name, so nested skills (`SKILL.md` below one
 * more directory) are indexed but not addressable here — the route's name
 * pattern admits no `/`. Named as a limitation rather than worked around.
 */
export const skillTopic: TopicSpec = {
  name: "skill",
  summary: "Recover a skill: restore its last-known-good version.",
  description:
    "Skills are documents, so reading, editing and archiving one is `corpus doc …` like anything " +
    "else. `rollback` is what has no document equivalent: the agent's skills are the workspace's " +
    "memory and its loop, and a bad edit to `orchestrate` can break the very loop that would " +
    "otherwise repair it (SPEC.md §7). The revert is performed by the server and lands as a " +
    "normal attributed commit.",
  commands: [rollbackCommand],
};
