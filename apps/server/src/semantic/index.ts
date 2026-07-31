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
