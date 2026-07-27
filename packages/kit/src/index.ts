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
 *
 * Importing it is how a plugin — or `apps/ui` itself — inherits Corpus theming,
 * including the light/dark contract described in `src/tokens.css`.
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
  type DocsFilter,
  type JobsParams,
  type RequestOptions,
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
