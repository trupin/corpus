import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadInferenceRuntime,
  packVectors,
  unpackVectors,
  type InferenceSpec,
} from "./inference.js";
import type { EmbeddedModelManifest } from "./manifest.js";
import type { ModelSession, SessionFactory } from "./runtime.js";

const TOKENIZER = JSON.stringify({
  model: {
    type: "WordPiece",
    unk_token: "[UNK]",
    continuing_subword_prefix: "##",
    max_input_chars_per_word: 100,
    vocab: { "[PAD]": 0, "[UNK]": 1, "[CLS]": 2, "[SEP]": 3, corpus: 4, doc: 5 },
  },
});
const TOKENIZER_BYTES = new TextEncoder().encode(TOKENIZER);
const WEIGHTS = new Uint8Array([9, 8, 7, 6, 5]);

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const MANIFEST: EmbeddedModelManifest = {
  model: "tiny-test-model",
  revision: "deadbeef",
  license: "apache-2.0",
  maxTokens: 8,
  tokenizer: {
    name: "tokenizer.json",
    url: "https://example.invalid/tokenizer.json",
    sha256: sha256(TOKENIZER_BYTES),
    bytes: TOKENIZER_BYTES.byteLength,
  },
  weights: {
    name: "model.onnx",
    url: "https://example.invalid/model.onnx",
    sha256: sha256(WEIGHTS),
    bytes: WEIGHTS.byteLength,
  },
};

interface StubSession {
  readonly factory: SessionFactory;
  readonly rows: number[];
  readonly threads: number[];
  released: () => number;
}

function stubSession(dim = 4): StubSession {
  let releases = 0;
  const rows: number[] = [];
  const threads: number[] = [];
  const session: ModelSession = {
    run: ({ rows: count, cols }) => {
      rows.push(count);
      const hidden = new Float32Array(count * cols * dim);
      for (let i = 0; i < hidden.length; i++) hidden[i] = (i % 7) + 1;
      return Promise.resolve({ hidden, dim });
    },
    release: () => {
      releases += 1;
      return Promise.resolve();
    },
  };
  return {
    factory: (_weights, count) => {
      threads.push(count);
      return Promise.resolve(session);
    },
    rows,
    threads,
    released: () => releases,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "corpus-inference-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const seed = async (): Promise<void> => {
  await writeFile(join(dir, MANIFEST.tokenizer.name), TOKENIZER_BYTES);
  await writeFile(join(dir, MANIFEST.weights.name), WEIGHTS);
};

const specFor = (): InferenceSpec => ({ cacheDir: dir, manifest: MANIFEST, threads: 3 });

describe("loadInferenceRuntime", () => {
  it("embeds through the pinned tokenizer and the session it was given", async () => {
    await seed();
    const stub = stubSession();
    const runtime = await loadInferenceRuntime(specFor(), stub.factory);

    const vectors = await runtime.embed(["corpus doc", "doc"]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(4);
    expect(stub.threads).toEqual([3]);
    // L2-normalised, which is what lets SERVER-045's scan treat a dot product
    // as a cosine.
    const norm = Math.sqrt(Array.from(vectors[0] ?? []).reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);

    await runtime.release();
    expect(stub.released()).toBe(1);
  });

  it("splits a large batch into bounded forward passes", async () => {
    await seed();
    const stub = stubSession();
    const runtime = await loadInferenceRuntime(specFor(), stub.factory);

    await runtime.embed(Array.from({ length: 19 }, () => "corpus"));

    expect(stub.rows).toEqual([8, 8, 3]);
  });

  it("costs nothing for an empty batch", async () => {
    await seed();
    const stub = stubSession();
    const runtime = await loadInferenceRuntime(specFor(), stub.factory);

    await expect(runtime.embed([])).resolves.toEqual([]);
    expect(stub.rows).toEqual([]);
  });

  it("refuses bytes that are not the pinned artifact, before the runtime sees them", async () => {
    await seed();
    const tampered = new Uint8Array(WEIGHTS);
    tampered[0] = 0;
    await writeFile(join(dir, MANIFEST.weights.name), tampered);
    const stub = stubSession();

    await expect(loadInferenceRuntime(specFor(), stub.factory)).rejects.toThrow(
      /not the pinned artifact/,
    );
    expect(stub.threads).toEqual([]);
  });

  it("reports a cache with nothing in it rather than pretending to load", async () => {
    await expect(loadInferenceRuntime(specFor(), stubSession().factory)).rejects.toThrow(
      /could not be read/,
    );
  });

  it("abandons a load whose signal aborted after the artifacts were read", async () => {
    await seed();
    const controller = new AbortController();
    const stub = stubSession();
    const factory: SessionFactory = (weights, threads) => {
      controller.abort();
      return stub.factory(weights, threads);
    };

    await expect(loadInferenceRuntime(specFor(), factory, controller.signal)).rejects.toThrow(
      /aborted/,
    );
    // The session came into existence during shutdown and was not leaked.
    expect(stub.released()).toBe(1);
  });

  it("abandons a load aborted before the session is opened", async () => {
    await seed();
    const controller = new AbortController();
    controller.abort();
    const stub = stubSession();

    await expect(loadInferenceRuntime(specFor(), stub.factory, controller.signal)).rejects.toThrow(
      /aborted/,
    );
    expect(stub.threads).toEqual([]);
  });
});

describe("packVectors / unpackVectors", () => {
  it("round-trips a batch through one contiguous buffer", () => {
    const vectors = [Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6])];
    const { data, dim } = packVectors(vectors);

    expect(dim).toBe(3);
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(unpackVectors(data, dim).map((vector) => Array.from(vector))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("owns its buffer outright, so transferring it moves nothing else", () => {
    const source = Float32Array.from([1, 2]);
    const { data } = packVectors([source]);
    expect(data.buffer).not.toBe(source.buffer);
    expect(data.byteOffset).toBe(0);
    expect(data.buffer.byteLength).toBe(data.byteLength);
  });

  it("refuses a ragged batch instead of shipping a buffer nobody can cut up", () => {
    expect(() => packVectors([Float32Array.from([1, 2]), Float32Array.from([1])])).toThrow(
      /differing dimensions/,
    );
  });

  it("packs an empty batch into an empty buffer", () => {
    const { data, dim } = packVectors([]);
    expect(dim).toBe(0);
    expect(data).toHaveLength(0);
    expect(unpackVectors(data, dim)).toEqual([]);
  });

  it("stops at the last whole vector rather than inventing a short one", () => {
    expect(unpackVectors(Float32Array.from([1, 2, 3, 4, 5]), 2)).toHaveLength(2);
  });
});
