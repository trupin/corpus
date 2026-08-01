/**
 * The embedded embedding engine (SERVER-048): an in-process WebAssembly
 * runtime over a hash-pinned model in a per-user cache.
 *
 * This is the surface `semantic/` re-exports; nothing outside the directory
 * reaches past it.
 */

export { attachEmbeddedEngine } from "./attach.js";
export { modelCacheDir, modelCacheRoot, MODEL_CACHE_DIR_ENV } from "./cache.js";
export type { CacheLocation } from "./cache.js";
export {
  artifactPath,
  downloadArtifact,
  inspectArtifact,
  ModelDownloadError,
  readVerifiedArtifact,
} from "./download.js";
export type { CachedArtifactState, DownloadProgress } from "./download.js";
export { createEmbeddedEngine, EMBED_BATCH_ROWS, MODEL_RETRY_COOLDOWN_MS } from "./engine.js";
export type { CorpusEmbeddedEngine, EmbeddedEngineOptions, EngineReport } from "./engine.js";
export { loadInferenceRuntime, packVectors, unpackVectors } from "./inference.js";
export type { InferenceRuntime, InferenceSpec } from "./inference.js";
export {
  INFERENCE_WORKER_KIND,
  INFERENCE_WORKER_URL,
  isInferenceWorkerData,
  startInferenceWorker,
} from "./inference-worker.js";
export type {
  InferenceRequest,
  InferenceResponse,
  InferenceWorkerData,
} from "./inference-worker.js";
export { createWorkerHost, inProcessHostFactory } from "./worker-host.js";
export type { InferenceHost, InferenceHostFactory, InferenceHostOptions } from "./worker-host.js";
export { EMBEDDED_MODEL, manifestBytes, modelArtifacts } from "./manifest.js";
export type { EmbeddedModelManifest, ModelArtifact } from "./manifest.js";
export {
  createOnnxSession,
  defaultThreadCount,
  embeddingThreadCount,
  meanPoolNormalize,
  wasmAvailable,
} from "./runtime.js";
export type { ModelSession, SessionFactory, SessionInput, SessionOutput } from "./runtime.js";
export { createTokenizer, normalizeText, preTokenize, TokenizerError } from "./tokenizer.js";
export type { NormalizerOptions, Tokenizer } from "./tokenizer.js";
