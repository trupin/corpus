/**
 * The semantic index (SPEC.md §9.1, "Semantic index"): the third derived search
 * structure beside the full-text index and the links graph.
 *
 * What lives here in Retrieval Phase B's first issue is its foundation — the
 * deterministic, content-addressed chunker, the projection rows it writes, and
 * the chunk-granular address lookup ranked search uses to name a passage.
 * Embedding, storage of vectors and hybrid ranking arrive on top of it.
 *
 * The directory is `semantic/` rather than `index/` because `src/index.ts` is
 * already the package barrel and a sibling `index/` directory is a trap on a
 * case-insensitive filesystem (sprint-021, Open Conflict 7).
 *
 * This file is the surface: nothing outside `semantic/` imports its internals.
 */

export { loadChunkAddresses } from "./address.js";
export type { ChunkAddressLoader } from "./address.js";
export {
  CHUNK_CHAR_BUDGET,
  CHUNK_CHARS_PER_TOKEN,
  CHUNK_TOKEN_BUDGET,
  chunkBody,
  chunkId,
  renderHeadingPath,
} from "./chunker.js";
export type { Chunk, ChunkSource } from "./chunker.js";
export {
  countPendingChunks,
  deleteDocumentChunks,
  insertChunkRows,
  orphanedEmbeddingIds,
  pendingChunkIds,
  turnHeadingFor,
  turnRef,
} from "./chunks.js";
export type { ChunkablePassage } from "./chunks.js";
export { attachSemanticIndex } from "./attach.js";
export type {
  AttachSemanticIndexDeps,
  SemanticIndexBootReport,
  SemanticIndexHandle,
} from "./attach.js";
export {
  EMBEDDED_ENGINE_UNAVAILABLE_REASONS,
  EMBEDDED_PROVIDER,
  createStaticEmbeddedEngine,
} from "./embedded-engine.js";
export {
  EMBEDDED_MODEL,
  MODEL_CACHE_DIR_ENV,
  MODEL_RETRY_COOLDOWN_MS,
  attachEmbeddedEngine,
  createEmbeddedEngine,
} from "./engine/index.js";
export type {
  CorpusEmbeddedEngine,
  EmbeddedEngineOptions,
  EmbeddedModelManifest,
} from "./engine/index.js";
export type {
  EmbeddedEngine,
  EmbeddedEngineAvailability,
  EmbeddedEngineOpenOptions,
  EmbeddedEngineUnavailableReason,
} from "./embedded-engine.js";
export {
  EMBEDDING_STATES,
  blobToVector,
  recordedIdentities,
  recordedIdentity,
  vectorToBlob,
  writeEmbedding,
} from "./embeddings.js";
export type { EmbeddingRecord, EmbeddingState } from "./embeddings.js";
export { EMBED_TIMEOUT_MS, createConfiguredProvider, embedUrl } from "./http-provider.js";
export type { ConfiguredProviderDeps, FetchLike } from "./http-provider.js";
export {
  checkIndexIdentity,
  formatIdentity,
  identityNamesModel,
  identityPrefix,
} from "./identity.js";
export type { EmbeddingModelRef, IndexIdentityCheck } from "./identity.js";
export { EmbeddingError, createEmbeddingProvider, redactSecrets } from "./provider.js";
export type { EmbedBatchFn, EmbeddingProvider } from "./provider.js";
export { PROBE_TEXT, describeResolution, resolveEmbeddingProvider } from "./resolve.js";
export { RESOLVE_COOLDOWN_MS, createSemanticRetrieval } from "./retrieval.js";
export type { SemanticOutcome, SemanticRetrieval, SemanticRetrievalOptions } from "./retrieval.js";
export { createIndexRebuildFlag, semanticIndexState } from "./state.js";
export type { IndexRebuildFlag, SemanticIndexFacts } from "./state.js";
export {
  SEMANTIC_MIN_SIMILARITY,
  UNFILTERED_SCOPE,
  cosineSimilarity,
  documentCentroid,
  nearestDocuments,
  normalizeVector,
  vectorCensus,
  vectorFromBlob,
} from "./vectors.js";
export type {
  DocumentVectorMatch,
  SemanticScope,
  VectorCensus,
  VectorScanOptions,
} from "./vectors.js";
export {
  EMBED_BACKOFF_MS,
  EMBED_BATCH_SIZE,
  EMBED_CLAIM_SIZE,
  EMBED_DEBOUNCE_MS,
  EMBED_INTERVAL_MS,
  EMBED_MAX_DEFER_MS,
  EMBED_MODEL_POLL_MS,
  MAX_CHUNK_FAILURES,
  chunkEmbedInput,
  embedBackoffMs,
  indexCounts,
  startEmbedWorker,
} from "./worker.js";
export type { EmbedWorkerHandle, EmbedWorkerOptions, IndexCounts } from "./worker.js";
export { attachEmbedWorker } from "./worker-attach.js";
export type { AttachEmbedWorkerDeps } from "./worker-attach.js";
export type {
  DisabledReason,
  ProviderResolution,
  ProviderSource,
  ResolutionErrorReason,
  ResolveProviderOptions,
} from "./resolve.js";
export {
  CONFIGURED_PROVIDER_KINDS,
  EMBEDDING_PROVIDER_NONE,
  EmbeddingConfigSchema,
  resolveEmbeddingSettings,
} from "./settings.js";
export type {
  ConfiguredEmbeddingProvider,
  ConfiguredProviderKind,
  EmbeddingConfig,
  EmbeddingSettings,
} from "./settings.js";
