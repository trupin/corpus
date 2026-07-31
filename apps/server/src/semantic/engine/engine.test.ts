import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDED_PROVIDER } from "../embedded-engine.js";
import type { FetchLike } from "../http-provider.js";
import { createEmbeddedEngine, type EngineReport } from "./engine.js";
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

/** Answers with the pinned bytes for each pinned URL, and counts the calls. */
function serveManifest(): { fetchFn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const bodies = new Map<string, Uint8Array>([
    [MANIFEST.tokenizer.url, TOKENIZER_BYTES],
    [MANIFEST.weights.url, WEIGHTS],
  ]);
  return {
    calls,
    fetchFn: (input) => {
      calls.push(input);
      const body = bodies.get(input);
      return Promise.resolve(
        body === undefined ? new Response(null, { status: 404 }) : new Response(body),
      );
    },
  };
}

/** A session that returns a fixed hidden state, so `open` is testable without ONNX. */
function stubSession(dim = 4): { factory: SessionFactory; released: () => number; rows: number[] } {
  let releases = 0;
  const rows: number[] = [];
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
  return { factory: () => Promise.resolve(session), released: () => releases, rows };
}

/**
 * Flushes the event loop, including the filesystem I/O every cache check does.
 * Used for the negative assertions ("nothing was fetched"), where there is no
 * promise to await; the positive ones await `whenSettled()` instead.
 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Turns the loop until `predicate` holds; fails the test rather than hanging. */
async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition never held");
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "corpus-engine-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const engineWith = (overrides: Parameters<typeof createEmbeddedEngine>[0] = {}) =>
  createEmbeddedEngine({ manifest: MANIFEST, cacheDir: dir, ...overrides });

const seedCache = async (): Promise<void> => {
  await writeFile(join(dir, MANIFEST.tokenizer.name), TOKENIZER_BYTES);
  await writeFile(join(dir, MANIFEST.weights.name), WEIGHTS);
};

describe("createEmbeddedEngine — identity and availability", () => {
  it("names itself under the local provider token before anything is loaded", () => {
    const engine = engineWith();
    expect(engine.ref).toEqual({ provider: EMBEDDED_PROVIDER, model: MANIFEST.model });
  });

  it("reports the model as not downloaded, and says what would fix it", async () => {
    const engine = engineWith();
    await expect(engine.availability()).resolves.toEqual({
      available: false,
      reason: "model-not-downloaded",
      detail: expect.stringContaining("has not been downloaded yet") as unknown as string,
    });
  });

  it("is available once both artifacts are cached at their pinned size", async () => {
    const engine = engineWith();
    await seedCache();
    await expect(engine.availability()).resolves.toEqual({ available: true });
  });

  it("reports a damaged cache differently from an empty one", async () => {
    await writeFile(join(dir, MANIFEST.weights.name), WEIGHTS.slice(0, 2));
    const availability = await engineWith().availability();
    expect(availability).toMatchObject({ available: false, reason: "model-not-downloaded" });
    expect(availability.available === false && availability.detail).toContain("damaged");
  });

  it("is unsupported where WebAssembly cannot run", async () => {
    const engine = engineWith({ wasmSupported: false });
    await expect(engine.availability()).resolves.toMatchObject({
      available: false,
      reason: "unsupported-platform",
    });
  });

  it("is unsupported when the environment names no per-user cache", async () => {
    const engine = createEmbeddedEngine({
      manifest: MANIFEST,
      location: { env: {}, platform: "linux" },
    });
    const availability = await engine.availability();
    expect(availability).toMatchObject({ available: false, reason: "unsupported-platform" });
    expect(availability.available === false && availability.detail).toContain(
      "CORPUS_MODEL_CACHE_DIR",
    );
  });

  it("derives its directory from the environment when given a location", async () => {
    const root = join(dir, "root");
    await mkdir(root, { recursive: true });
    const engine = createEmbeddedEngine({
      manifest: MANIFEST,
      location: { env: { CORPUS_MODEL_CACHE_DIR: root }, platform: "linux" },
      fetchFn: serveManifest().fetchFn,
    });
    engine.requestModel();
    await engine.whenSettled();
    // `<root>/<model>@<revision>`, so a manifest bump lands beside this one.
    expect(await readdir(root)).toEqual([`${MANIFEST.model}@${MANIFEST.revision}`]);
    await engine.close();
  });
});

describe("createEmbeddedEngine — nothing downloads by itself", () => {
  it("makes no request while merely being asked whether it is available", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ fetchFn });

    await engine.availability();
    await engine.availability();
    await flush();

    expect(calls).toEqual([]);
  });

  it("downloads both artifacts, smallest first, only when asked", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ fetchFn });

    engine.requestModel();
    await engine.whenSettled();

    expect(calls).toEqual([MANIFEST.tokenizer.url, MANIFEST.weights.url]);
    await expect(engine.availability()).resolves.toEqual({ available: true });
    await engine.close();
  });

  it("is single-flight: a second request while one is running starts nothing", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const engine = engineWith({
      fetchFn: async (input) => {
        calls.push(input);
        await gate;
        return new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS);
      },
    });

    engine.requestModel();
    await flush();
    engine.requestModel();
    engine.requestModel();
    await flush();
    expect(calls).toEqual([MANIFEST.tokenizer.url]);

    release();
    await engine.whenSettled();
    expect(calls).toEqual([MANIFEST.tokenizer.url, MANIFEST.weights.url]);
    await engine.close();
  });

  it("does nothing when the artifacts are already cached", async () => {
    const { fetchFn, calls } = serveManifest();
    await seedCache();
    const engine = engineWith({ fetchFn });

    engine.requestModel();
    await flush();
    expect(calls).toEqual([]);
  });

  it("keeps an artifact it already has and fetches only the missing one", async () => {
    const { fetchFn, calls } = serveManifest();
    await writeFile(join(dir, MANIFEST.tokenizer.name), TOKENIZER_BYTES);
    const engine = engineWith({ fetchFn });

    engine.requestModel();
    await engine.whenSettled();
    expect(calls).toEqual([MANIFEST.weights.url]);
    await engine.close();
  });
});

describe("createEmbeddedEngine — failure, progress and retry", () => {
  it("surfaces progress through the availability detail while downloading", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = engineWith({
      fetchFn: async (input) => {
        if (input === MANIFEST.weights.url) await gate;
        return new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS);
      },
    });

    engine.requestModel();
    // The tokenizer lands first; the weights request is held open, so the engine
    // is observably mid-download when the detail is read.
    await waitFor(async () => {
      const state = await engine.availability();
      return state.available === false && /downloading .*%/.test(state.detail);
    });

    const availability = await engine.availability();
    expect(availability).toMatchObject({ available: false, reason: "model-not-downloaded" });
    expect(availability.available === false && availability.detail).toMatch(/downloading .*%/);

    release();
    await engine.whenSettled();
    await engine.close();
  });

  it("reports a failed download and refuses to retry inside the cooldown", async () => {
    const reports: EngineReport[] = [];
    let attempts = 0;
    const engine = engineWith({
      retryCooldownMs: 60_000,
      now: () => 1_000,
      report: (report) => reports.push(report),
      fetchFn: () => {
        attempts += 1;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
    });

    engine.requestModel();
    await engine.whenSettled();
    expect(attempts).toBe(1);
    expect(reports.some((report) => report.level === "error")).toBe(true);

    // A worker that ticks every few seconds must not turn a dead host into a loop.
    engine.requestModel();
    engine.requestModel();
    await flush();
    expect(attempts).toBe(1);

    const availability = await engine.availability();
    expect(availability.available === false && availability.detail).toContain("could not be");
  });

  it("tries again once the cooldown has passed", async () => {
    let attempts = 0;
    let clock = 1_000;
    const engine = engineWith({
      retryCooldownMs: 60_000,
      now: () => clock,
      fetchFn: (input) => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? new Response(null, { status: 500 })
            : new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS),
        );
      },
    });

    engine.requestModel();
    await engine.whenSettled();
    expect(attempts).toBe(1);

    clock += 60_001;
    engine.requestModel();
    await engine.whenSettled();
    expect(attempts).toBe(3);
    await expect(engine.availability()).resolves.toEqual({ available: true });
    await engine.close();
  });

  it("keeps nothing from a download whose hash does not match the pin", async () => {
    const engine = engineWith({
      fetchFn: (input) =>
        Promise.resolve(
          new Response(
            input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : new Uint8Array([1, 2, 3, 4, 5]),
          ),
        ),
    });

    engine.requestModel();
    await engine.whenSettled();

    expect(await readdir(dir)).toEqual([MANIFEST.tokenizer.name]);
    await expect(engine.availability()).resolves.toMatchObject({ available: false });
  });

  it("never downloads and never reports when there is nowhere to cache", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = createEmbeddedEngine({
      manifest: MANIFEST,
      location: { env: {}, platform: "linux" },
      fetchFn,
    });

    engine.requestModel();
    await flush();
    expect(calls).toEqual([]);
  });

  it("never downloads where WebAssembly cannot run", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ fetchFn, wasmSupported: false });

    engine.requestModel();
    await flush();
    expect(calls).toEqual([]);
  });
});

describe("createEmbeddedEngine — open", () => {
  it("embeds in process and reports an identity sized by the response", async () => {
    await seedCache();
    const { factory } = stubSession(4);
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ sessionFactory: factory, fetchFn });

    const provider = await engine.open();
    const vectors = await provider.embed(["corpus doc", "doc"]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(4);
    expect(provider.identity).toBe(`local/${MANIFEST.model}@4`);
    // Every vector is L2-normalised, which is what lets the scan use a dot product.
    const norm = Math.sqrt(Array.from(vectors[0] ?? []).reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
    // Loading a cached model touches the network nowhere.
    expect(calls).toEqual([]);

    await engine.close();
  });

  it("splits a large batch into bounded forward passes", async () => {
    await seedCache();
    const { factory, rows } = stubSession();
    const engine = engineWith({ sessionFactory: factory });

    const provider = await engine.open();
    await provider.embed(Array.from({ length: 19 }, () => "corpus"));

    expect(rows).toEqual([8, 8, 3]);
    await engine.close();
  });

  it("loads the model once however often it is opened", async () => {
    await seedCache();
    const factory = vi.fn(stubSession().factory);
    const engine = engineWith({ sessionFactory: factory });

    const [a, b] = await Promise.all([engine.open(), engine.open()]);
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledOnce();
    await engine.close();
  });

  it("refuses to load a cached artifact whose bytes were tampered with, and discards it", async () => {
    await seedCache();
    const tampered = new Uint8Array(WEIGHTS);
    tampered[0] = 0;
    await writeFile(join(dir, MANIFEST.weights.name), tampered);
    const factory = vi.fn(stubSession().factory);
    const reports: EngineReport[] = [];
    const engine = engineWith({
      sessionFactory: factory,
      report: (report) => reports.push(report),
    });

    await expect(engine.open()).rejects.toThrow(/not the pinned artifact/);
    // Never handed to the runtime, and gone from the cache.
    expect(factory).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([MANIFEST.tokenizer.name]);
    expect(reports.some((report) => report.level === "error")).toBe(true);
  });

  it("refuses a cached tokenizer that is not a tokenizer this build can use", async () => {
    const junk = new TextEncoder().encode("[]");
    const manifest: EmbeddedModelManifest = {
      ...MANIFEST,
      tokenizer: { ...MANIFEST.tokenizer, sha256: sha256(junk), bytes: junk.byteLength },
    };
    await writeFile(join(dir, manifest.tokenizer.name), junk);
    await writeFile(join(dir, manifest.weights.name), WEIGHTS);
    const engine = createEmbeddedEngine({
      manifest,
      cacheDir: dir,
      sessionFactory: stubSession().factory,
    });

    await expect(engine.open()).rejects.toThrow(/could not be loaded/);
  });

  it("reports the missing model rather than pretending to load one", async () => {
    const engine = engineWith({ sessionFactory: stubSession().factory });
    await expect(engine.open()).rejects.toThrow(/could not be read/);
  });

  it("has no cache to open when the environment names none", async () => {
    const engine = createEmbeddedEngine({
      manifest: MANIFEST,
      location: { env: {}, platform: "linux" },
    });
    await expect(engine.open()).rejects.toThrow(/no model cache/);
  });
});

describe("createEmbeddedEngine — shutdown", () => {
  it("releases the session and refuses to serve afterwards", async () => {
    await seedCache();
    const { factory, released } = stubSession();
    const engine = engineWith({ sessionFactory: factory });

    await engine.open();
    await engine.close();

    expect(released()).toBe(1);
    await expect(engine.availability()).resolves.toMatchObject({
      available: false,
      reason: "engine-not-installed",
    });
    await expect(engine.open()).rejects.toThrow(/shut down/);
  });

  it("closes cleanly when nothing was ever opened", async () => {
    await expect(engineWith().close()).resolves.toBeUndefined();
  });

  it("waits for an in-flight download instead of leaving it writing into a closed server", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = engineWith({
      fetchFn: async (input) => {
        await gate;
        return new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS);
      },
    });

    engine.requestModel();
    await flush();
    const closing = engine.close();
    release();
    await expect(closing).resolves.toBeUndefined();
  });

  it("does not start a download after close", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ fetchFn });

    await engine.close();
    engine.requestModel();
    await flush();
    expect(calls).toEqual([]);
  });

  it("releases a session that finished loading during shutdown", async () => {
    await seedCache();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { factory, released } = stubSession();
    let entered = false;
    const engine = engineWith({
      sessionFactory: async (weights, threads) => {
        entered = true;
        await gate;
        return factory(weights, threads);
      },
    });

    const opening = engine.open();
    // Close only once the runtime is actually loading: the point of the test is
    // a session that comes into existence after shutdown began.
    await waitFor(() => entered);
    const closing = engine.close();
    release();

    await expect(opening).rejects.toThrow(/aborted/);
    await closing;
    expect(released()).toBe(1);
  });
});
