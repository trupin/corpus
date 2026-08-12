/**
 * The document surface (SPEC.md §9.2): the collection query behind every list,
 * the folder tree it agrees with, read-one, and the whole mutation surface —
 * create, edit, move, archive, unarchive and delete, all funnelling through one
 * write pipeline (Architecture Decision 2, "the server is the sole writer").
 *
 * This file is the surface: nothing outside `docs/` imports its internals.
 */

export { actorOf } from "./actor.js";
export {
  SKILLS_ARCHIVED_ROOT,
  SKILLS_ROOT,
  planSetArchived,
  setArchived,
  skillDocumentsUnder,
} from "./archive.js";
export type { ArchivePlan, CarriedDocument } from "./archive.js";
export { applyBulkAction, commitSubject } from "./bulk.js";
export { MAX_SLUG_ATTEMPTS, allocatePath, createDocument } from "./create.js";
export {
  AGENT_DELETE_MESSAGE,
  anchoredThreadParent,
  deleteDocument,
  deleteDocumentLocked,
  planDelete,
} from "./delete.js";
export type { DeleteOutcome, DeletePlan } from "./delete.js";
// SPEC.md §7's key: the one derivation, and the one check.
export { assertDocumentKey, documentKey } from "./key.js";
export { assertMovable, moveDocument, planMove } from "./move.js";
export type { MovePlan } from "./move.js";
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
export type { DocReadContext, DocumentRow, LoadedDocument } from "./read.js";
export { findTemplate } from "./templates.js";
export type { TemplatePrefill } from "./templates.js";
export { changedFields, updateDocument, updateDocumentLocked } from "./update.js";
export { mountDocWriteRoutes, reportWarnings, serializeWarnings } from "./write-routes.js";
export {
  CREATE_LANE,
  SEEN_LANE,
  WARNING_DETAIL_LENGTH,
  WARNING_DETAIL_LINES,
  applyOperations,
  checkSave,
  checkSeams,
  commitWarnings,
  createDocumentMutex,
  finishMutation,
  isSkillFrontmatterException,
  runInLanes,
  runMutation,
  validateBeforeWrite,
  validationError,
  warningDetail,
  writeFileAtomically,
} from "./write.js";
export type {
  ActCommit,
  DocsWorkspace,
  DocumentMutex,
  FileOperation,
  MutationPlan,
  MutationResult,
  MutationTail,
  SaveCheck,
} from "./write.js";
export {
  MAX_QUERY_TOKENS,
  MAX_SNIPPETS_PER_ROW,
  SNIPPET_CLOSE,
  SNIPPET_ELLIPSIS,
  SNIPPET_OPEN,
  parseSnippets,
  toFtsMatchExpression,
  toSegments,
} from "./fts.js";
// The shared read primitives (SERVER-040): ranked retrieval (`GET /api/search`)
// filters through the *same* builder as the collection query, which is what
// makes §9.2's "the same set, with the same semantics" true by construction
// rather than by review.
export {
  Binder,
  DOC_FILTER_JOINS,
  FROM_SQL,
  FTS_HITS_CTE,
  RELEVANCE_ORDER_BY,
  compileFilters,
  notArchivedSql,
  paramsFor,
  whereClause,
} from "./filters.js";
export type { Compiled, FilterQuery } from "./filters.js";
export {
  AWAITING_AGENT_SQL,
  NEEDS_REASON_SQL,
  UNANSWERED_FORM_COUNT_SQL,
  UNREAD_SQL,
  isThreadUnread,
  rowAttention,
} from "./needs.js";
export { DOCS_ROOT, folderPathPrefix, queryDocs } from "./query.js";
export { relatedDocs } from "./related.js";
export type { RelatedDeps } from "./related.js";
export { mountDocsRoutes } from "./routes.js";
export type { DocsRoutesOptions } from "./routes.js";
export { STALENESS_THRESHOLD_DAYS, STALE_TIER_SQL, stalenessCutoffs } from "./staleness.js";
export { folderTree } from "./tree.js";
