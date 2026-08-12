/**
 * Skills as a *surface* (SPEC.md §7). Skills as *documents* — indexing, reading,
 * editing, archiving — belong to `projection/` and `docs/`, which is what "skills
 * and agent definitions are documents" means in code. This module holds only what
 * a skill needs and a document does not: creation into the skills root.
 *
 * Putting a bad skill edit back is deliberately *not* here: §7's loop-safety
 * rider (signed 2026-08-12) makes a revert a write whose content came from
 * history, so it goes through the ordinary document write path like every other
 * change. See the header of `routes.ts`.
 */

export { createSkill } from "./create.js";
export type { CreateSkillOutcome } from "./create.js";
export { archivedSkillFolderPath, skillDocumentPath, skillFolderPath } from "./paths.js";
export { mountSkillRoutes } from "./routes.js";
