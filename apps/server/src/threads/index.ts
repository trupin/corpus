/**
 * The thread surface (SPEC.md §6, §7, §8): creation in its three modes, turn
 * append with the §8 enqueue decision, resolve/reopen, read marks, and the
 * deletion cascade.
 *
 * Every mutation here is a document mutation — it goes through `docs/`'s one
 * write pipeline — so this module owns what is *particular* to a conversation:
 * the turn format's write policy, mention parsing, participation, and the anchor
 * entry a comment leaves in the document it comments on.
 *
 * This file is the surface: nothing outside `threads/` imports its internals.
 */

export { AGENT_TURN_DELETE_MESSAGE, deleteThreadTurn } from "./cascade.js";
export type { TurnDeletion } from "./cascade.js";
export { createThread, normalizeSelector, threadRequestBody } from "./create.js";
export type { ThreadCreateInput, ThreadCreation } from "./create.js";
export { commentPayload, enqueueComment } from "./events.js";
export type { CommentEventInput } from "./events.js";
export {
  FORM_ANSWER_LABEL,
  answerThreadForm,
  formAnswerBody,
  formCommitSubject,
  formRespondPayload,
  requireForm,
} from "./forms.js";
export {
  GENERIC_AGENT_MENTION,
  INVOCATION_TYPE,
  MENTION_TYPE,
  NO_MENTIONS,
  invocableName,
  parseMentions,
  requestsAgent,
  scanMentionTokens,
} from "./mentions.js";
export type { ParsedMentions, ResolvedTarget } from "./mentions.js";
export { decideParticipation } from "./participation.js";
export type { ParticipationDecision, ParticipationInput } from "./participation.js";
export { loadThread, readThread, toThreadSummary, toWireThread } from "./read.js";
export type { LoadedThread } from "./read.js";
export { mountThreadRoutes } from "./routes.js";
export { markThreadSeen, movesForward, readSeenMarks } from "./seen.js";
export { setThreadStatus } from "./status.js";
export type { StatusChange } from "./status.js";
export {
  ANCHOR_TITLE_QUOTE_LENGTH,
  STANDALONE_TITLE_LENGTH,
  UNTITLED_THREAD,
  deriveThreadTitle,
  firstProseLine,
} from "./title.js";
export {
  appendThreadTurn,
  buildTurnAppend,
  commitTurnAppend,
  storeTurnFiles,
  turnRequestBody,
  whileUnreferenced,
} from "./turns.js";
export type { PreparedTurn, TurnAppend, TurnInput } from "./turns.js";
export { COMMENT_CREATED, EVENT_SOURCE } from "./workspace.js";
export type { EnqueueEvent, EnqueueInput, EnqueuedEvent, ThreadsWorkspace } from "./workspace.js";
