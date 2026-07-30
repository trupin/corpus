/**
 * The document surface (SPEC.md §9.2): the collection query behind every list,
 * the folder tree it agrees with, read-one, and the whole mutation surface —
 * create, edit, move, archive, unarchive and delete, all funnelling through one
 * write pipeline (Architecture Decision 2, "the server is the sole writer").
 *
 * This file is the surface: nothing outside `docs/` imports its internals.
 */

export { actorOf } from "./actor.js";
export { SKILLS_ARCHIVED_ROOT, SKILLS_ROOT, setArchived, skillDocumentsUnder } from "./archive.js";
export { MAX_SLUG_ATTEMPTS, allocatePath, createDocument } from "./create.js";
export {
  AGENT_DELETE_MESSAGE,
  anchoredThreadParent,
  deleteDocument,
  deleteDocumentLocked,
} from "./delete.js";
export type { DeleteOutcome } from "./delete.js";
export { moveDocument } from "./move.js";
export {
  anchorClaimantIds,
  findDocumentRow,
  findDocumentRowByPath,
  isIdTaken,
  loadDocument,
  readAnchorsMap,
  resolveDocumentAnchors,
  toWireDoc,
  wireFrontmatter,
} from "./read.js";
export type { DocumentRow, LoadedDocument } from "./read.js";
export { findTemplate } from "./templates.js";
export type { TemplatePrefill } from "./templates.js";
export { changedFields, updateDocument, updateDocumentLocked } from "./update.js";
export { mountDocWriteRoutes, reportWarnings, serializeWarnings } from "./write-routes.js";
export {
  CREATE_LANE,
  SEEN_LANE,
  WARNING_DETAIL_LENGTH,
  WARNING_DETAIL_LINES,
  allowAllWrites,
  checkSave,
  checkSeams,
  createDocumentMutex,
  isSkillFrontmatterException,
  runInLanes,
  runMutation,
  validateBeforeWrite,
  validationError,
  warningDetail,
  writeFileAtomically,
} from "./write.js";
export type {
  DocsWorkspace,
  DocumentMutex,
  FileOperation,
  MutationPlan,
  MutationResult,
  SaveCheck,
  WriteGuard,
} from "./write.js";
export {
  MAX_QUERY_TOKENS,
  MAX_SNIPPETS_PER_ROW,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  parseSnippets,
  toFtsMatchExpression,
  toSegments,
} from "./fts.js";
export {
  AWAITING_AGENT_SQL,
  NEEDS_REASON_SQL,
  UNREAD_SQL,
  isThreadUnread,
  rowAttention,
} from "./needs.js";
export { DOCS_ROOT, folderPathPrefix, queryDocs } from "./query.js";
export { mountDocsRoutes } from "./routes.js";
export type { DocsRoutesOptions } from "./routes.js";
export { STALENESS_THRESHOLD_DAYS, STALE_TIER_SQL, stalenessCutoffs } from "./staleness.js";
export { folderTree } from "./tree.js";
