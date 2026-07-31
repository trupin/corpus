/**
 * Skills as a *surface* (SPEC.md §7). Skills as *documents* — indexing, reading,
 * editing, archiving — belong to `projection/` and `docs/`, which is what "skills
 * and agent definitions are documents" means in code. This module holds only what
 * a skill needs and a document does not: creation into the skills root, and the
 * targeted revert.
 */

export { createSkill } from "./create.js";
export type { CreateSkillOutcome } from "./create.js";
export { archivedSkillFolderPath, skillDocumentPath, skillFolderPath } from "./paths.js";
export { rollbackSkill } from "./rollback.js";
export type { SkillsWorkspace } from "./rollback.js";
export { mountSkillRoutes } from "./routes.js";
