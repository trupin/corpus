/**
 * Skills as a *surface* (SPEC.md §7). Skills as *documents* — indexing, reading,
 * editing, archiving — belong to `projection/` and `docs/`, which is what "skills
 * and agent definitions are documents" means in code. This module holds only what
 * a skill needs and a document does not: the targeted revert.
 */

export { rollbackSkill, skillDocumentPath } from "./rollback.js";
export type { SkillsWorkspace } from "./rollback.js";
export { mountSkillRoutes } from "./routes.js";
