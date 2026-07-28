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
  type AppendTurnInput,
  type CorpusClient,
  type CorpusClientConfig,
  type CorpusEventStreamOptions,
  type CreateDocInput,
  type CreateThreadInput,
  type DocsFilter,
  type JobsParams,
  type RequestOptions,
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
export { useJobs } from "./query/useJobs.js";
export { useLocks } from "./query/useLocks.js";
export { useHealth } from "./query/useHealth.js";

// The write path the board needs today.
export { useAppendTurn, type AppendTurnVariables } from "./query/useAppendTurn.js";
export { useUpdateDoc, useUpdateDocById, type UpdateDocVariables } from "./query/useUpdateDoc.js";
export { useCreateDoc } from "./query/useCreateDoc.js";
export { useCreateThread } from "./query/useCreateThread.js";
export { useDeleteDoc } from "./query/useDeleteDoc.js";
export {
  useMarkThreadSeen,
  useSetThreadStatus,
  type ThreadStatusVariables,
} from "./query/useThreadStatus.js";
export { useBreakLock } from "./query/useBreakLock.js";
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
  jobKey,
  jobsListKey,
  JOBS_KEY,
  lockKey,
  LOCKS_KEY,
  PLUGIN_KEY_PREFIX,
  pluginKey,
  QUEUE_KEY,
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
  LockChip,
  NeedsYouBadge,
  UnreadBadge,
  WorkingDot,
  type AgeChipProps,
  type LockChipProps,
  type NeedsYouBadgeProps,
  type UnreadBadgeProps,
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
  triagePrompt,
  useRowActions,
  type RowActions,
  type RowActionsOptions,
  type RowActionSubject,
  type RowNotice,
} from "./row/useRowActions.js";
export { useAgentActivity, useDocLock, type AgentActivity } from "./row/useRowSignals.js";

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
