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
