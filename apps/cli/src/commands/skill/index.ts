import type { TopicSpec } from "../../registry/types.js";
import { createCommand } from "./create.js";
import { rollbackCommand } from "./rollback.js";

/**
 * Skills as documents (SPEC.md §7). A skill is `.claude/skills/<name>/SKILL.md`
 * with `type: skill`, indexed in place and edited with the ordinary document
 * verbs — `corpus doc show`, `corpus doc edit`, and `corpus doc archive`, which
 * is what disabling a skill *is*. Two things a document verb cannot express live
 * here: **genesis**, because a skill is the one document that lives outside
 * `data/docs/` and `POST /api/docs` files everything under it; and **recovery**,
 * because undoing a bad edit to the loop's own skill needs a targeted revert.
 *
 * A skill's name is its directory name, so nested skills (`SKILL.md` below one
 * more directory) are indexed but not addressable here — the route's name
 * pattern admits no `/`. Named as a limitation rather than worked around.
 */
export const skillTopic: TopicSpec = {
  name: "skill",
  summary: "Create a skill, and recover one: restore its last-known-good version.",
  description:
    "Skills are documents, so reading, editing and archiving one is `corpus doc …` like anything " +
    "else. These two verbs are what has no document equivalent. `create` is SPEC.md §7's skill " +
    "genesis — a recurring pattern becomes a skill, written under `.claude/skills/` rather than " +
    "`data/docs/`, which is the one thing `corpus doc create` cannot do. `rollback` is its safety " +
    "net: the agent's skills are the workspace's memory and its loop, and a bad edit to " +
    "`orchestrate` can break the very loop that would otherwise repair it. Both are performed by " +
    "the server and land as normal attributed commits.",
  commands: [createCommand, rollbackCommand],
};
