/**
 * The real thing: the pinned int8 `all-MiniLM-L6-v2` graph, loaded by
 * `onnxruntime-web`'s WebAssembly backend, tokenized by this package's own
 * WordPiece implementation.
 *
 * **Gated on the artifact already being in the per-user cache**, and it does not
 * download one — a unit suite that can pull 22 MiB over the network is a unit
 * suite that fails on a train. Populate the cache by running the engine once
 * (the E2E procedure in the issue does), or point `CORPUS_MODEL_CACHE_DIR` at a
 * directory holding the two pinned files.
 *
 * The numbers below are not this implementation's own output: they were
 * produced by `@huggingface/transformers@4.2.0` on the same checkpoint, on the
 * native runtime, in an isolated scratch package. Agreement to 1e-2 across a
 * different runtime — and the *ordering* being identical — is what says the
 * tokenizer, the pooling and the normalisation are right rather than merely
 * self-consistent.
 */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modelCacheDir, modelCacheRoot } from "./cache.js";
import { artifactPath } from "./download.js";
import { createEmbeddedEngine } from "./engine.js";
import { EMBEDDED_MODEL, modelArtifacts } from "./manifest.js";
import { createOnnxSession } from "./runtime.js";

const location = { env: process.env, platform: process.platform };
const root = modelCacheRoot(location);
const dir = root === undefined ? undefined : modelCacheDir(root, EMBEDDED_MODEL);
const cached =
  dir !== undefined &&
  modelArtifacts(EMBEDDED_MODEL).every((artifact) => existsSync(artifactPath(dir, artifact)));

/** transformers.js, native runtime, mean-pooled and L2-normalised. */
const REFERENCE_HEAD = [0.1288, -0.02078, -0.02509, 0.03412, -0.03014, 0.04272, 0.0408, 0.03182];
const REFERENCE_CAT_KITTEN = 0.6394;
const REFERENCE_CAT_POSTGRES = -0.0119;

const dot = (a: Float32Array, b: Float32Array): number =>
  a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

/**
 * Inference on **this** thread (SERVER-049).
 *
 * Production hosts the model in a `worker_threads` Worker, whose entry is a
 * module URL the running process must be able to load — `tsx` in a source
 * checkout, the bundle in an installed tool. Vitest transforms TypeScript
 * itself and hands a raw Worker no loader, so the shipped entry cannot be
 * spawned from here; the thread boundary is covered by `worker-host.test.ts`
 * against real Workers and by the issue's E2E against the real server.
 *
 * What this file is for is unaffected either way: the arithmetic — tokenizer,
 * pooling, normalisation — is the same `loadInferenceRuntime` in both hosts,
 * and comparing it against transformers.js is better done with no transport in
 * between.
 */
const IN_PROCESS = { sessionFactory: createOnnxSession } as const;

describe.skipIf(!cached)("embedded engine over the real model", () => {
  it("embeds in process and agrees with the reference implementation", async () => {
    const engine = createEmbeddedEngine({
      location,
      // No transport at all: a network call would fail loudly, not silently fetch.
      fetchFn: () => Promise.reject(new Error("the cached path must not touch the network")),
      ...IN_PROCESS,
    });

    await expect(engine.availability()).resolves.toEqual({ available: true });

    const provider = await engine.open();
    const [cat, kitten, postgres] = await provider.embed([
      "The cat sits on the mat.",
      "A kitten rests on a rug.",
      "PostgreSQL replication lag monitoring",
    ]);

    expect(provider.identity).toBe(`local/${EMBEDDED_MODEL.model}@384`);
    expect(cat).toBeDefined();
    if (cat === undefined || kitten === undefined || postgres === undefined) return;

    expect(cat).toHaveLength(384);
    expect(dot(cat, cat)).toBeCloseTo(1, 4);
    REFERENCE_HEAD.forEach((value, index) => {
      expect(cat[index] ?? 0).toBeCloseTo(value, 2);
    });
    expect(dot(cat, kitten)).toBeCloseTo(REFERENCE_CAT_KITTEN, 2);
    expect(dot(cat, postgres)).toBeCloseTo(REFERENCE_CAT_POSTGRES, 2);
    // The property ranked search actually depends on.
    expect(dot(cat, kitten)).toBeGreaterThan(dot(cat, postgres));

    await engine.close();
  }, 60_000);

  it("truncates a chunk far longer than the model's window instead of failing", async () => {
    const engine = createEmbeddedEngine({ location, ...IN_PROCESS });
    const provider = await engine.open();

    const [vector] = await provider.embed(["the corpus grows. ".repeat(1000)]);
    expect(vector).toHaveLength(384);
    expect(vector === undefined ? 0 : dot(vector, vector)).toBeCloseTo(1, 4);

    await engine.close();
  }, 60_000);
});
