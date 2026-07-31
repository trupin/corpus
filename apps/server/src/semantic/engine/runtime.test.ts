import { availableParallelism } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultThreadCount,
  embeddingThreadCount,
  meanPoolNormalize,
  wasmAvailable,
  type SessionOutput,
} from "./runtime.js";

describe("embeddingThreadCount", () => {
  it.each([
    [1, 1],
    [2, 1],
    [4, 2],
    [8, 4],
    [16, 4],
    [128, 4],
  ])("gives %i logical cpus %i indexing threads", (parallelism, expected) => {
    expect(embeddingThreadCount(parallelism)).toBe(expected);
  });

  it("never asks for more than half the machine, and never for none of it", () => {
    for (let cpus = 1; cpus <= 64; cpus++) {
      const threads = embeddingThreadCount(cpus);
      expect(threads).toBeGreaterThanOrEqual(1);
      expect(threads).toBeLessThanOrEqual(Math.max(1, Math.floor(cpus / 2)) + 0);
    }
  });

  it("is what the default reads off this machine", () => {
    expect(defaultThreadCount()).toBe(embeddingThreadCount(availableParallelism()));
  });
});

describe("wasmAvailable", () => {
  it("is true on a Node that can run WebAssembly, which every supported Node can", () => {
    expect(wasmAvailable()).toBe(true);
  });

  it("is false when the runtime exposes no WebAssembly at all", () => {
    const original = Reflect.get(globalThis, "WebAssembly") as unknown;
    Reflect.deleteProperty(globalThis, "WebAssembly");
    try {
      expect(wasmAvailable()).toBe(false);
    } finally {
      Reflect.defineProperty(globalThis, "WebAssembly", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("meanPoolNormalize", () => {
  const output = (hidden: number[], dim: number): SessionOutput => ({
    hidden: Float32Array.from(hidden),
    dim,
  });

  it("averages only the real tokens and returns a unit vector", () => {
    // Two rows of two columns: each row's second column is padding, and the
    // second row's padding is deliberately enormous.
    const vectors = meanPoolNormalize(output([3, 4, 0, 0, 6, 8, 100, 100], 2), [1, 1], 2);

    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      // Same direction, different magnitude before normalisation — identical after.
      expect(vector[0]).toBeCloseTo(0.6, 6);
      expect(vector[1]).toBeCloseTo(0.8, 6);
    }
  });

  it("means across tokens rather than summing them", () => {
    const vectors = meanPoolNormalize(output([1, 0, 0, 1], 2), [2], 2);
    const [x, y] = Array.from(vectors[0] ?? []);
    expect(x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("returns a finite zero vector rather than dividing by zero", () => {
    const vectors = meanPoolNormalize(output([0, 0], 2), [1], 1);
    expect(Array.from(vectors[0] ?? [])).toEqual([0, 0]);
  });

  it("treats a row with no tokens as empty rather than reading past it", () => {
    const vectors = meanPoolNormalize(output([5, 5], 2), [0], 1);
    expect(Array.from(vectors[0] ?? [])).toEqual([0, 0]);
  });
});

/**
 * The binding to `onnxruntime-web` is covered with the library mocked. Loading
 * a real 22 MiB graph belongs in `engine.integration.test.ts`, which is gated on
 * the model actually being cached; what needs pinning here is the wiring —
 * threads, execution provider, the single-segment input, and the two shapes of
 * output this build refuses.
 */
describe("createOnnxSession", () => {
  afterEach(() => {
    vi.doUnmock("onnxruntime-web");
    vi.resetModules();
  });

  async function withOrt(module: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock("onnxruntime-web", () => module);
    return import("./runtime.js");
  }

  const tensor = class {
    constructor(
      readonly type: string,
      readonly data: unknown,
      readonly dims: readonly number[],
    ) {}
  };

  it("configures threads, runs the graph and releases it, without a model on disk", async () => {
    const run = vi.fn().mockResolvedValue({
      last_hidden_state: { data: Float32Array.from([1, 2, 3, 4]), dims: [1, 2, 2] },
    });
    const release = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ run, release });
    const env = { wasm: { numThreads: 0 }, logLevel: "verbose" };

    const { createOnnxSession } = await withOrt({
      env,
      InferenceSession: { create },
      Tensor: tensor,
    });

    const weights = new Uint8Array([1, 2, 3]);
    const session = await createOnnxSession(weights, 3);

    expect(env.wasm.numThreads).toBe(3);
    expect(env.logLevel).toBe("error");
    expect(create).toHaveBeenCalledWith(
      weights,
      expect.objectContaining({ executionProviders: ["wasm"] }),
    );

    const output = await session.run({
      ids: new BigInt64Array([1n, 2n]),
      mask: new BigInt64Array([1n, 1n]),
      rows: 1,
      cols: 2,
    });
    expect(output.dim).toBe(2);
    expect(Array.from(output.hidden)).toEqual([1, 2, 3, 4]);
    // One segment per row, always: this model embeds sentences, never pairs.
    const inputs = run.mock.calls[0]?.[0] as Record<string, { data: BigInt64Array }>;
    expect(Array.from(inputs["token_type_ids"]?.data ?? [])).toEqual([0n, 0n]);

    await session.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it("refuses an output that is not a float hidden state", async () => {
    const { createOnnxSession } = await withOrt({
      env: { wasm: {}, logLevel: "" },
      InferenceSession: {
        create: () => Promise.resolve({ run: () => Promise.resolve({}), release: () => undefined }),
      },
      Tensor: tensor,
    });
    const session = await createOnnxSession(new Uint8Array(), 1);

    await expect(
      session.run({ ids: new BigInt64Array(), mask: new BigInt64Array(), rows: 0, cols: 0 }),
    ).rejects.toThrow(/no float last_hidden_state/);
  });

  it("refuses a hidden state with no hidden size", async () => {
    const { createOnnxSession } = await withOrt({
      env: { wasm: {}, logLevel: "" },
      InferenceSession: {
        create: () =>
          Promise.resolve({
            run: () =>
              Promise.resolve({ last_hidden_state: { data: new Float32Array(), dims: [1, 1] } }),
            release: () => undefined,
          }),
      },
      Tensor: tensor,
    });
    const session = await createOnnxSession(new Uint8Array(), 1);

    await expect(
      session.run({ ids: new BigInt64Array(), mask: new BigInt64Array(), rows: 1, cols: 1 }),
    ).rejects.toThrow(/without a hidden size/);
  });
});
