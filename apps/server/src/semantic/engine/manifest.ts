/**
 * The model this build embeds with, pinned three ways.
 *
 * SPEC.md §9.1 promises that semantic indexing "never requires a network
 * account or an API key" and "never depends on separate model-server software":
 * a small model is downloaded once into a per-user cache and everything then
 * runs in-process. The user's ruling of 2026-07-31 is what makes that safe to
 * say — *a bare model file is inert data*. This file is where that claim is
 * made concrete, and every field exists to keep it true:
 *
 * - **`revision`** is a content-addressed commit on the hosting repository, not
 *   a branch. `resolve/main/...` is a moving target; `resolve/<sha>/...` names
 *   bytes that cannot change under us.
 * - **`sha256` and `bytes`** are verified against what actually arrives, and
 *   again immediately before the bytes are handed to the runtime. A download
 *   that does not match is deleted, reported, and never parsed.
 * - **`license`** is recorded because the artifact is redistributed to the
 *   user's machine on our instruction; Apache-2.0 is what makes that fine.
 *
 * Nothing downloaded here is code. Both artifacts are data files: an ONNX graph
 * (protobuf) parsed by `onnxruntime-web`, a dependency already in this
 * package's `node_modules`, and a tokenizer vocabulary (JSON) parsed by `zod`.
 * No script is fetched, no native module is fetched, nothing is `eval`ed, and
 * no plugin is loaded — see `runtime.ts` and `tokenizer.ts`.
 *
 * Changing the model is deliberately a code change, reviewed like any other: it
 * moves the identity string (`local/<model>@<dim>`), which §9.1 makes an
 * index-invalidating event.
 */

/** One pinned file: where it comes from, what it must hash to, how big it is. */
export interface ModelArtifact {
  /** The file's name inside the per-model cache directory. */
  readonly name: string;
  readonly url: string;
  /** Lowercase hex sha256 of the exact bytes expected. */
  readonly sha256: string;
  readonly bytes: number;
}

export interface EmbeddedModelManifest {
  /** The model half of the identity string; `local/<model>@<dim>`. */
  readonly model: string;
  /** The immutable upstream revision both artifact URLs resolve against. */
  readonly revision: string;
  readonly license: string;
  /**
   * Wordpieces kept per chunk, including `[CLS]`/`[SEP]`. The published
   * `max_seq_length` of the sentence-transformers checkpoint this is quantized
   * from — text past it contributes nothing, so paying for it would be waste.
   */
  readonly maxTokens: number;
  readonly weights: ModelArtifact;
  readonly tokenizer: ModelArtifact;
}

const REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";

const resolveUrl = (path: string): string =>
  `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${REVISION}/${path}`;

/**
 * `all-MiniLM-L6-v2`, int8-quantized to ONNX — 22 MiB of weights for a
 * 384-dimensional sentence embedding, Apache-2.0.
 *
 * Measured against the fp32 export (86 MiB) and against `bge-small-en-v1.5` /
 * `gte-small` (32 MiB each, same 384 dimensions): four times the download for
 * no benefit this product can observe, since ranked search compares vectors
 * only against other vectors from the same model.
 */
export const EMBEDDED_MODEL: EmbeddedModelManifest = {
  model: "all-MiniLM-L6-v2",
  revision: REVISION,
  license: "apache-2.0",
  maxTokens: 256,
  weights: {
    name: "model_quantized.onnx",
    url: resolveUrl("onnx/model_quantized.onnx"),
    sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
    bytes: 22_972_370,
  },
  tokenizer: {
    name: "tokenizer.json",
    url: resolveUrl("tokenizer.json"),
    sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    bytes: 711_661,
  },
};

/** Both artifacts, in the order they are fetched: the small one first. */
export function modelArtifacts(manifest: EmbeddedModelManifest): readonly ModelArtifact[] {
  return [manifest.tokenizer, manifest.weights];
}

/** Total download for a cold cache, for the sentence a person reads while waiting. */
export function manifestBytes(manifest: EmbeddedModelManifest): number {
  return manifest.tokenizer.bytes + manifest.weights.bytes;
}
