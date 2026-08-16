/**
 * `@corpus/kit` — the only import surface plugins may use (SPEC.md §10).
 *
 * This module is a contract, not a convenience barrel. Everything a plugin or a
 * board component is allowed to reach for is here, and the omissions are as
 * deliberate as the exports: the generated `openapi-fetch` client, the raw
 * `CorpusApi`, and `@corpus/contract/client`'s transport internals are **not**
 * re-exported, because a plugin that can construct its own client bypasses the
 * kit's cache, its keys and its invalidation — and then the board stops
 * updating in ways no test would catch.
 *
 * The design-token layer is a stylesheet subpath rather than an export here,
 * because CSS has no compile step:
 *
 *     import "@corpus/kit/tokens.css";
 *     import "@corpus/kit/row.css";
 *
 * Importing them is how a plugin — or `apps/ui` itself — inherits Corpus theming,
 * including the light/dark contract described in `src/tokens.css`, and the row
 * anatomy described in `src/row/row.css`.
 */

export { PACKAGE_NAME } from "./packageName.js";

// The data path.
export {
  createCorpusClient,
  CorpusRequestError,
  reattachRefusalReason,
  staleKeyDoc,
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
  type PluginRequestInit,
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
export { usePluginQuery } from "./query/usePluginQuery.js";
export { useQueueStatus } from "./query/useQueueStatus.js";
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
export { useCreateDoc } from "./query/useCreateDoc.js";
export { useCapture } from "./query/useCapture.js";
export { useCreateThread, type CreateThreadVariables } from "./query/useCreateThread.js";
export { useDeleteDoc } from "./query/useDeleteDoc.js";
export {
  useMarkThreadSeen,
  useSetThreadStatus,
  type ThreadStatusVariables,
} from "./query/useThreadStatus.js";
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
  canonicalFilter,
  docKey,
  docsListKey,
  DOCS_KEY,
  HEALTH_KEY,
  INDEX_KEY,
  jobKey,
  jobsListKey,
  JOBS_KEY,
  PLUGIN_KEY_PREFIX,
  pluginKey,
  QUEUE_KEY,
  relatedKey,
  searchKey,
  threadKey,
  TREE_KEY,
  type CanonicalFilter,
  type QueryKey,
  type QueryKeySegment,
} from "./query/keys.js";

// Type-aware rows (SPEC.md §11). `Row` is the default renderer and the seam a
// plugin's registered `ListItem` replaces (PLUGINS-001) — which is why the prop
// types ship beside the component: a conforming `ListItem` cannot be written
// without them.
export { Row, type ListItemComponent, type RowProps } from "./row/Row.js";
export {
  AgeChip,
  NeedsYouBadge,
  UnreadBadge,
  // A plugin's own `ListItem` replaces `Row` wholesale, so the rule deciding
  // which unread pill a row draws ships with the badge rather than staying
  // private — re-deriving it per plugin is how the aggregate pill goes missing
  // again, one surface at a time.
  unreadBadgeProps,
  WorkingDot,
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
export { useAgentActivity, type AgentActivity } from "./row/useRowSignals.js";

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
// One image renderer for every host (SPEC.md §11's "images open full-size"):
// the authenticated attachment fetch and the click-to-open affordance, so a
// plugin's read surface draws pictures exactly as a turn does. The viewer
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

// SPEC.md §11's "smart input everywhere": one `@` / `/` / `[[` implementation,
// shared by the thread composer, the document editor and the global composer.
// Its stylesheet is a subpath, like the tokens: `import "@corpus/kit/autocomplete.css"`.
//
// `handleAutocompleteKeyDown` and `useRefCompletions` are the halves the
// document editor's `[[` can share without sharing this hook's trigger grammar
// (UI-053): the keyboard contract, and the list of documents itself.
export {
  applyCompletion,
  AUTOCOMPLETE_LIMIT,
  AutocompleteMenu,
  completionText,
  detectTrigger,
  GENERIC_AGENT_TOKEN,
  handleAutocompleteKeyDown,
  invocableName,
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

// SPEC.md §11's composer key contract — `↵` newline, `⌘↵` primary, `⇧⌘↵`
// secondary — as one function, because the sentence binds every composer in the
// app *and* every composer a plugin contributes, and a plugin may import
// nothing but this package.
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

// SPEC.md §11's "every composer can choose how much thought the work gets"
// (rider signed 2026-08-06). Here rather than in `apps/ui` for the same reason
// the key contract and the attachment intake are: the sentence binds every
// composer in the app *and* every composer a plugin contributes, and a plugin
// may import nothing but this package. Its stylesheet is a subpath, like the
// tokens: `import "@corpus/kit/weight.css"`.
//
// The levels are never enumerated here — `weight/weightLevels.ts` says why an
// enum in this package would be wrong per workspace rather than merely
// inelegant.
export {
  childThreadWeightScope,
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
  WeightPicker,
  WEIGHT_INERT_TITLE,
  WEIGHT_LIVE_TITLE,
  WEIGHT_PICKER_LABEL,
  WEIGHT_TABLE_HEADER,
  WEIGHT_UNKNOWN_TITLE,
  type ComposerReach,
  type ComposerWeight,
  type WeightLevel,
  type WeightPickerProps,
} from "./weight/index.js";

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
