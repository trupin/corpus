/**
 * `@corpus/kit` — the shared UI kit `apps/ui` is built from (SPEC.md §10).
 *
 * This module is a contract, not a convenience barrel. The omissions are as
 * deliberate as the exports: the generated `openapi-fetch` client, the raw
 * `CorpusApi`, and `@corpus/contract/client`'s transport internals are **not**
 * re-exported, because a surface that constructs its own client bypasses the
 * kit's cache, its keys and its invalidation — and then the board stops
 * updating in ways no test would catch.
 *
 * The design-token layer is a stylesheet subpath rather than an export here,
 * because CSS has no compile step:
 *
 *     import "@corpus/kit/tokens.css";
 *     import "@corpus/kit/row.css";
 *
 * Importing them is how `apps/ui` inherits Corpus theming, including the
 * light/dark contract described in `src/tokens.css`, and the row anatomy
 * described in `src/row/row.css`.
 */

export { PACKAGE_NAME } from "./packageName.js";

// The data path.
export {
  createCorpusClient,
  CorpusRequestError,
  reattachRefusalReason,
  staleKeyDoc,
  unknownRecipientLane,
  type AppendTurnInput,
  type AppendTurnUpload,
  type CaptureInput,
  type CorpusClient,
  type CorpusClientConfig,
  type CorpusEventStreamOptions,
  type CreateDocInput,
  type CreateThreadInput,
  type CreateThreadUpload,
  type DocsFilter,
  type FormAnswerInput,
  type JobsParams,
  type RelatedParams,
  type RequestOptions,
  type SearchParams,
  type UpdateDocChanges,
} from "./client/createCorpusClient.js";
export {
  CorpusProvider,
  mountedCorpusProviders,
  type CorpusProviderProps,
} from "./client/CorpusProvider.js";
export { createCorpusQueryClient } from "./client/queryClient.js";
export { useCorpusClient } from "./client/context.js";

// Read hooks. Every one is typed straight from the contract's schemas.
export { useDocs } from "./query/useDocs.js";
export { useDoc } from "./query/useDoc.js";
export { useThread } from "./query/useThread.js";
export { useTree } from "./query/useTree.js";
// Ranked retrieval (SPEC.md §9.2) — a separate seam from `useDocs` on purpose:
// which endpoint a surface reads from is a product decision, not a parameter.
export { useRelatedDocs } from "./query/useRelatedDocs.js";
export { useCorpusSearch } from "./query/useCorpusSearch.js";
export { useJobs, type JobsQueryOptions } from "./query/useJobs.js";
// The queue's unfinished work, as one query every surface shares (UI-075).
export {
  OUTSTANDING_JOB_STATUSES,
  OUTSTANDING_JOB_STATUS_PARAM,
  useOutstandingJobs,
  type OutstandingJobs,
} from "./query/useOutstandingJobs.js";
export {
  capLogLines,
  EMPTY_JOB_LOG,
  MAX_BUFFERED_LOG_LINES,
  useJobLog,
  type JobLogView,
  type UseJobLogOptions,
} from "./query/useJobLog.js";
export { useQueueStatus } from "./query/useQueueStatus.js";
// SPEC.md §7's roster — who is running, read behind `["agents"]` like any other
// projection. A read and never a push, so there is no poll and no `staleTime`
// override here or anywhere downstream.
export { useAgentsRoster, type AgentRosterView } from "./query/useAgentsRoster.js";
// …and what one of those lanes owns (SPEC.md §7, CONTRACT-068). The other half
// of the same question, read the same way: an ordinary cached read of the
// server's own walk, never a walk of its own.
export { useThreadScope, type ThreadScopeView } from "./query/useThreadScope.js";
// The semantic index's health report — the console strip's index pill reads it,
// and it refreshes on the `["index"]` frames the embed worker already emits.
export { useIndexStatus } from "./query/useIndexStatus.js";
export { useHealth } from "./query/useHealth.js";

// The write path the board needs today.
export type { SettledCallbacks } from "./query/settledCallbacks.js";
export { provisionalBody, useAppendTurn, type AppendTurnVariables } from "./query/useAppendTurn.js";
export { useDeleteTurn } from "./query/useDeleteTurn.js";
export { useRespondToForm, type FormAnswerVariables } from "./query/useRespondToForm.js";
export { useUpdateDoc, useUpdateDocById, type UpdateDocVariables } from "./query/useUpdateDoc.js";
export { useSetDocArchived, type DocArchiveVariables } from "./query/useSetDocArchived.js";
// Relocation, and only relocation: the id never changes, so nothing pointing at
// the document is rewritten (SPEC.md §9.2).
export { useMoveDoc, type MoveDocVariables } from "./query/useMoveDoc.js";
export { useCreateDoc } from "./query/useCreateDoc.js";
export { useCapture } from "./query/useCapture.js";
export { useCreateThread, type CreateThreadVariables } from "./query/useCreateThread.js";
export { useDeleteDoc } from "./query/useDeleteDoc.js";
// SPEC.md §9.2's folder acts (rider 7), behind the explorer's folder menu.
export {
  useDeleteFolder,
  useRenameFolder,
  useSetFolderArchived,
  type FolderArchiveVariables,
  type RenameFolderVariables,
} from "./query/useFolderActs.js";
// SPEC.md §10's rider 2: the bar's order, written as one act and one commit.
export { useReorderBoards } from "./query/useReorderBoards.js";
export {
  useMarkThreadSeen,
  useSetThreadStatus,
  type ThreadStatusVariables,
} from "./query/useThreadStatus.js";
export { useSetResident, type ResidentVariables } from "./query/useResident.js";
export { useReattachThread, type ReattachThreadVariables } from "./query/useReattachThread.js";
export {
  hasSeenMark,
  resetSeenMarks,
  useMarkSeenOnce,
  type MarkSeenOnce,
} from "./query/useMarkSeenOnce.js";
export { attachmentKey, useAttachment, type AttachmentBytes } from "./query/useAttachment.js";
export {
  useAbandonJob,
  useHaltQueue,
  useResumeQueue,
  useRetryJob,
} from "./query/useQueueControl.js";
export {
  isPendingTurn,
  mergePendingTurns,
  PendingTurnStore,
  type PendingTurn,
  type ThreadTurn,
  type ThreadView,
} from "./query/pendingTurns.js";

// The query-key vocabulary. Core shapes come from `@corpus/contract` so a
// rename is a compile error rather than a silently ignored `invalidate` frame.
export {
  // `AGENTS_KEY` joined its siblings here in UI-109: UI-108 published the roster
  // hook without the key the server names to invalidate it, so a board surface
  // could read the roster and had no supported way to say it had gone stale.
  AGENTS_KEY,
  canonicalFilter,
  docKey,
  docsListKey,
  DOCS_KEY,
  HEALTH_KEY,
  INDEX_KEY,
  jobKey,
  jobsListKey,
  JOBS_KEY,
  QUEUE_KEY,
  // `REFLECT_KEY` joined in UI-153, for `AGENTS_KEY`'s reason above: the
  // Reflect control reads `GET /api/workspace/reflect` from `apps/ui`, and a
  // consumer that cached it under a key no `invalidate` frame names would serve
  // a stale clock forever.
  REFLECT_KEY,
  relatedKey,
  searchKey,
  threadKey,
  threadScopeKey,
  TREE_KEY,
  type CanonicalFilter,
  type QueryKey,
  type QueryKeySegment,
} from "./query/keys.js";

// Type-aware rows (SPEC.md §10). `Row` is the list-item renderer every column
// uses, and its prop types ship beside it because a host that wraps or
// delegates to it cannot be written without them.
export { Row, type RowProps } from "./row/Row.js";
export {
  AgeChip,
  // One call for the row's agent signal, so no row implementation has to decide
  // for itself which of the two dots an unclaimed event gets (SPEC.md §8).
  AgentActivityDot,
  // §7's unreflected mark. Exported because three surfaces draw it — a row, a
  // column head, a board tab — and one of them is not a row at all.
  CHANGED_MARK_LABEL,
  ChangedMark,
  NeedsYouBadge,
  QueuedDot,
  UnreadBadge,
  // The rule deciding which unread pill a row draws ships with the badge rather
  // than staying private — a second row implementation that re-derived it is how
  // the aggregate pill goes missing again, one surface at a time.
  unreadBadgeProps,
  WorkingDot,
  type AgentActivityDotProps,
  type AgeChipProps,
  type NeedsYouBadgeProps,
  type UnreadBadgeProps,
  type UnreadUnit,
  type WorkingDotProps,
} from "./row/badges.js";
export { reasonChip, reasonChips, REASON_CHIP_CLASSES, type ReasonChip } from "./row/reasons.js";
export {
  ageAnchor,
  ageLabel,
  hasStaleActions,
  humanizeAge,
  stalenessClass,
  stalenessLevel,
  UNKNOWN_AGE_LABEL,
  type StalenessLevel,
} from "./row/staleness.js";
export {
  folderOf,
  isThreadRow,
  rowContext,
  rowExcerpt,
  threadExcerpt,
  threadKind,
  THREAD_DOC_TYPE,
  type ThreadKind,
} from "./row/threadRow.js";
export {
  archivedMessage,
  triagePrompt,
  useRowActions,
  type RowActions,
  type RowActionsOptions,
  type RowActionSubject,
  type RowNotice,
} from "./row/useRowActions.js";
export {
  deferredRowTitle,
  useAgentActivity,
  type AgentActivity,
  type AgentActivityState,
} from "./row/useRowSignals.js";

// SPEC.md §11's warning channel, as something a surface can show. One tone per
// code, exhaustive over `WarningCode`, so a code added to the contract is a
// compile error here rather than a silent red toast (UI-106).
export { WARNING_PRESENTATION, warningNotice, warningNotices } from "./warnings/warningNotice.js";

// Rendered markdown (SPEC.md §10 names `MarkdownView` in the kit contract), and
// the `[[ref]]` grammar of SPEC.md §5 that only it knows how to render. The
// stylesheet is a subpath, like the tokens: `import "@corpus/kit/markdown.css"`.
export { MarkdownView, type MarkdownViewProps } from "./markdown/MarkdownView.js";
export {
  parseRefs,
  refIds,
  remarkCorpusRefs,
  splitTextNode,
  REF_ALIAS_ATTRIBUTE,
  REF_ID_ATTRIBUTE,
  REF_NODE_TYPE,
  REF_PATTERN,
  type DocRef,
} from "./markdown/refs.js";
// The one raw-HTML token Corpus reads as markdown, and only inside a table cell
// (UI-064). Exported because the document editor parses with the same rule —
// reader and editor must not be two readings of one file.
export { isLineBreakTag, remarkTableCellBreaks } from "./markdown/tableBreaks.js";
// One image renderer for every host (SPEC.md §10's "images open full-size"):
// the authenticated attachment fetch and the click-to-open affordance, so a
// document body draws pictures exactly as a turn does. The viewer
// itself is the app's — `ImageViewerProvider` is the door to it, and images
// below no provider are simply not clickable. See `markdown/imageViewer.tsx`
// for why that split and not a viewer in this package.
export { attachmentTarget, ATTACHMENT_PREFIX } from "./markdown/attachmentSrc.js";
export {
  CorpusImage,
  IMAGE_BROKEN_CLASS,
  IMAGE_CLASS,
  IMAGE_PENDING_CLASS,
  type CorpusImageProps,
} from "./markdown/CorpusImage.js";
export {
  ImageViewerProvider,
  useImageViewer,
  type ImageViewerApi,
  type ImageViewerProviderProps,
  type ViewableImage,
} from "./markdown/imageViewer.js";

// SPEC.md §10's "smart input everywhere": one `@` / `/` / `[[` implementation,
// shared by the thread composer, the document editor and the global composer.
// Its stylesheet is a subpath, like the tokens: `import "@corpus/kit/autocomplete.css"`.
//
// `handleAutocompleteKeyDown` and `useRefCompletions` are the halves the
// document editor's `[[` can share without sharing this hook's trigger grammar
// (UI-053): the keyboard contract, and the list of documents itself.
//
// `isAddressableTarget` is published for the same reason and one level down: it
// is the rule deciding *which* `agent-def` / `skill` rows may be offered at all
// (SERVER-125), and any surface outside this hook that offers a mention target —
// the board's designate menu is the one today — must ask the same question
// rather than re-derive it (UI-123).
export {
  applyCompletion,
  AUTOCOMPLETE_LIMIT,
  AutocompleteMenu,
  completionText,
  detectTrigger,
  GENERIC_AGENT_TOKEN,
  handleAutocompleteKeyDown,
  invocableName,
  isAddressableTarget,
  MENTION_DOC_TYPE,
  rowToken,
  SKILL_DOC_TYPE,
  TRIGGER_KINDS,
  useAutocomplete,
  useRefCompletions,
  type AutocompleteItem,
  type AutocompleteKeyEvent,
  type AutocompleteKeyOptions,
  type AutocompleteMenuProps,
  type AutocompleteState,
  type CompletionResult,
  type RefCompletions,
  type TriggerKind,
  type TriggerMatch,
  type UseAutocompleteOptions,
} from "./components/Autocomplete/index.js";

// SPEC.md §10's composer key contract — `↵` newline, `⌘↵` primary, `⇧⌘↵`
// secondary — as one function, because the sentence binds *every* composer in
// the app, and the several that exist must not each re-derive it.
export {
  AttachButton,
  COMPOSER_NEWLINE_HINT,
  COMPOSER_PRIMARY_KEY,
  COMPOSER_SECONDARY_KEY,
  handleComposerKeyDown,
  PendingAttachments,
  releaseAttachments,
  useAttachmentIntake,
  type AttachButtonProps,
  type AttachmentIntake,
  type ComposerKeyOptions,
  type PendingAttachment,
  type PendingAttachmentsProps,
} from "./components/Composer/index.js";

// SPEC.md §10's "every composer can choose how much thought the work gets"
// (rider signed 2026-08-06). Here rather than in `apps/ui` for the same reason
// the key contract and the attachment intake are: the sentence binds every
// composer in the app, so the choice ships once and every composer reads it.
//
// The levels are never enumerated here — `weight/weightLevels.ts` says why an
// enum in this package would be wrong per workspace rather than merely
// inelegant.
export {
  chooseWeight,
  composerReachesAgent,
  docWeightScope,
  findOrchestrateSkill,
  GLOBAL_COMPOSE_WEIGHT_SCOPE,
  ORCHESTRATE_SKILL_NAME,
  parseWeightLevels,
  subscribeWeightChoices,
  threadWeightScope,
  useComposerWeight,
  useWeightLevels,
  weightChoice,
  WEIGHT_TABLE_HEADER,
  type ComposerReach,
  type ComposerWeight,
  type WeightLevel,
} from "./weight/index.js";

// The control both of the above are shown through since UI-126: one line
// stating who answers and at what weight, opening to change either — and, for
// a resident's lane, the sentence that replaces a weight control whose choice
// would be discarded (SPEC.md §7 and §10, rider signed 2026-08-19). Here for
// the same reason: §10's enumeration binds every composer, and five of them
// mount this control. Stylesheet subpath: `import "@corpus/kit/address.css"`.
export {
  answeringRow,
  composerAddress,
  ComposerAddress,
  lanesCappedNote,
  residentWeightSentence,
  weightLabel,
  ADDRESS_FLOOR_TITLE,
  ADDRESS_OPEN_TITLE,
  ADDRESSED_TO,
  LAUNCH_WEIGHT_CLAUSE,
  LINE_SEPARATOR,
  NOBODY_ASKED,
  RECIPIENT_GROUP_LABEL,
  RECIPIENT_LEAD,
  WEIGHT_GROUP_LABEL,
  WEIGHT_LEAD,
  WEIGHT_UNKNOWN_TITLE,
  type AddressWeight,
  type ComposerAddressInput,
  type ComposerAddressModel,
  type ComposerAddressProps,
  type ResidentWeight,
} from "./address/index.js";

// SPEC.md §7's recipient — the composer offers the live roster, the default is
// computed from where the message is posted, and an override routes one
// message. Here for the weight family's reason: the sentence binds every
// composer in the app, and one copy is what keeps them saying the same thing.
export {
  laneLine,
  laneLiveness,
  laneMark,
  laneName,
  laneNote,
  laneOf,
  laneResidentKind,
  laneRow,
  laneRows,
  statementFor,
  unknownLaneRow,
  useComposerRecipient,
  useLaneRow,
  useResidentLane,
  useScopeWalk,
  walkToLane,
  DEFAULT_ROW_NOTE,
  GENERAL_RESIDENT_LABEL,
  LaneDot,
  LAPSED_FALLBACK,
  LAPSED_ORCHESTRATOR,
  LIVE_WITHOUT_SUMMARY,
  MAX_SCOPE_WALK,
  MISSING_PROFILE_CAUSES,
  MISSING_PROFILE_MARK,
  MISSING_PROFILE_NOTE,
  NEVER_SEEN_LINE,
  ORCHESTRATOR_LABEL,
  RECIPIENT_REFUSED_STATEMENT,
  RECIPIENT_UNKNOWN_STATEMENT,
  SCOPE_NODE_ABSENT,
  UNNAMED_RESIDENT_LABEL,
  type ComposerRecipient,
  type ComposerRecipientInput,
  type ComposerRecipientRestore,
  type LaneDotProps,
  type LaneLiveness,
  type LaneResidentKind,
  type LaneRow,
  type MissingProfileCause,
  type ResidentLane,
  type ScopeNode,
  type ScopeNodeLookup,
  type ScopeWalk,
  type ScopeWalkInput,
} from "./recipient/index.js";

// How any surface asks a reader to open a document, and where inside it to
// land (UI-037). Types only, and here rather than in `apps/ui` because the
// board, the comments tab, the anchored threads and focus mode all speak this
// vocabulary — one spelling of an open is what keeps "open it" and "point at
// something inside it" from becoming two mechanisms.
export type {
  OpenPayload,
  OpenRequest,
  RevealItem,
  RevealTarget,
  RevealThread,
} from "./open/openRequest.js";

// One spelling of "how long ago" for the whole board (SPEC.md §7's roster line
// and §8's pending row sit one composer apart).
export { humanizeElapsed } from "./time/elapsed.js";

// The live-update connection.
export { useConnectionState } from "./events/useConnectionState.js";
export {
  backoffDelay,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_BATCH_WINDOW_MS,
  DEFAULT_MAX_DELAY_MS,
  type BridgeLogger,
  type ConnectionState,
} from "./events/sseBridge.js";
export type { EventSourceFactory, EventSourceLike } from "@corpus/contract/client";
