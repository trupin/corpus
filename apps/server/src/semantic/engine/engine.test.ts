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
import type { InferenceHost, InferenceHostFactory } from "./worker-host.js";

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
 * Waits until an assertion holds, on a **wall-clock** budget.
 *
 * This file previously synchronised by counting event-loop turns — eight
 * `setImmediate`s for the negatives, five hundred for the positives — and that
 * is not a synchronisation primitive, it is a bet. Every fact these tests wait
 * for is produced by *filesystem* work (a `stat` per artifact, a read plus a
 * sha256, a `mkdir`), which completes on libuv's threadpool and is signalled in
 * the poll phase; a loop of `setImmediate`s spins through the check phase
 * without yielding to it, so hundreds of turns can elapse while a single `stat`
 * is still outstanding. The bet paid on a fast, idle Node 25 laptop and lost on
 * CI's loaded Node 22 runners — deterministically, twice, on two different
 * tests. Both are reproducible here by lowering the counts (8 → 1 reproduces
 * CI's `expected [] to deeply equal [ Array(1) ]` verbatim; 500 → 2 reproduces
 * the shutdown failure), which is the proof that the budget, not the product,
 * was the variable.
 *
 * `vi.waitFor` polls on a timer, so the budget is time — the same currency the
 * work is denominated in — and the interval yields to the poll phase.
 */
const until = (assertion: () => void | Promise<void>): Promise<void> =>
  vi.waitFor(assertion, { timeout: 5_000, interval: 5 });

/**
 * A promise the test opens and closes by hand, used to hold a download or a
 * model load open at a chosen instant.
 *
 * Registered for release in `afterEach` so that a *failing* test cannot leave a
 * `fetch` pending forever: an engine holding one never finishes `close()`, and
 * the next test in the file inherits a process that is still doing the previous
 * one's work. Resolving an already-resolved promise is a no-op, so tests that
 * release their own gate pay nothing for this.
 */
const openGates: (() => void)[] = [];

function gate(): { readonly promise: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  openGates.push(() => {
    release();
  });
  return { promise, release: () => release() };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "corpus-engine-"));
});

afterEach(async () => {
  for (const release of openGates.splice(0)) release();
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

  it("refuses a relative CORPUS_MODEL_CACHE_DIR loudly, instead of using the default (PR #17)", async () => {
    // The silent fallback was worse than useless: it handed back the *shared*
    // per-user cache, so a run that set this to start cold started warm and said
    // nothing. `HOME` is present precisely so the fallback would have succeeded.
    const engine = createEmbeddedEngine({
      manifest: MANIFEST,
      location: {
        env: { CORPUS_MODEL_CACHE_DIR: "relative/models", HOME: "/home/x" },
        platform: "linux",
      },
    });

    const availability = await engine.availability();

    expect(availability).toMatchObject({ available: false, reason: "unsupported-platform" });
    const detail = availability.available === false ? availability.detail : "";
    expect(detail).toContain("CORPUS_MODEL_CACHE_DIR");
    expect(detail).toContain("relative/models");
    expect(detail).toContain("must be absolute");
    // And it is not the generic "no cache could be derived" sentence.
    expect(detail).not.toContain("XDG_CACHE_HOME");
    await engine.close();
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
    // `whenSettled()` is the engine's own "nothing is in flight" — an
    // availability read that had quietly started a download would still be
    // running here, and this would wait for it.
    await engine.whenSettled();

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
    const held = gate();
    const calls: string[] = [];
    const engine = engineWith({
      fetchFn: async (input) => {
        calls.push(input);
        await held.promise;
        return new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS);
      },
    });

    engine.requestModel();
    // The observable, not a guess at how many turns it takes to get there: the
    // first artifact's request has been issued and is being held open.
    await until(() => {
      expect(calls).toEqual([MANIFEST.tokenizer.url]);
    });

    engine.requestModel();
    engine.requestModel();

    // The negative is proved by the *total*, which needs no window at all. Each
    // flight records its URL on entry to `fetchFn`, before it can await
    // anything, so a flight missing from this list is a flight that never
    // started — and `close()` awaits whatever is still running, so one that had
    // started and not yet reached `fetchFn` could not slip past either.
    held.release();
    await engine.whenSettled();
    await engine.close();
    expect(calls).toEqual([MANIFEST.tokenizer.url, MANIFEST.weights.url]);
  });

  it("does nothing when the artifacts are already cached", async () => {
    const { fetchFn, calls } = serveManifest();
    await seedCache();
    const engine = engineWith({ fetchFn });

    engine.requestModel();
    // The attempt runs — it scans the cache and finds nothing missing — so this
    // waits for the very thing that would have downloaded.
    await engine.whenSettled();
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

/**
 * The push half of the 2026-08-01 rider. Everything downstream caches "the model
 * is not here" — resolution for 30 s (`retrieval.ts`) — and the engine is the
 * only party that knows the wait is over, so it says so. Without it a first run
 * kept answering `disabled` for half a minute after the bytes had landed (the
 * SERVER-048 evaluation, LEDGER-1).
 */
describe("createEmbeddedEngine — announcing a completed download", () => {
  it("notifies every listener once the artifacts are cached, and only then", async () => {
    const { fetchFn } = serveManifest();
    const engine = engineWith({ fetchFn });
    const seen: string[] = [];
    engine.onModelReady(() => seen.push("first"));
    engine.onModelReady(() => seen.push("second"));

    engine.requestModel();
    expect(seen).toEqual([]);

    await engine.whenSettled();
    expect(seen).toEqual(["first", "second"]);
    // What a listener is told is true by the time it is told: the availability
    // it will go and re-read has already flipped.
    await expect(engine.availability()).resolves.toEqual({ available: true });
    await engine.close();
  });

  it("stays silent when there was nothing to download", async () => {
    const { fetchFn } = serveManifest();
    await seedCache();
    const engine = engineWith({ fetchFn });
    let announced = 0;
    engine.onModelReady(() => {
      announced += 1;
    });

    engine.requestModel();
    await engine.whenSettled();
    // Nothing transitioned, so nothing downstream needs invalidating: the cached
    // resolution over a warm cache is already the right one.
    expect(announced).toBe(0);
  });

  it("stays silent when the download failed", async () => {
    const engine = engineWith({
      fetchFn: () => Promise.resolve(new Response(null, { status: 500 })),
    });
    let announced = 0;
    engine.onModelReady(() => {
      announced += 1;
    });

    engine.requestModel();
    await engine.whenSettled();
    expect(announced).toBe(0);
  });

  it("contains a listener that throws instead of failing the download over it", async () => {
    const { fetchFn } = serveManifest();
    const reports: EngineReport[] = [];
    const engine = engineWith({ fetchFn, report: (report) => reports.push(report) });
    const after: string[] = [];
    engine.onModelReady(() => {
      throw new Error("listener exploded");
    });
    engine.onModelReady(() => after.push("still called"));

    engine.requestModel();
    await engine.whenSettled();

    // The download succeeded, the later listener still ran, and the throw is a
    // report rather than a retry cooldown over a download that worked.
    await expect(engine.availability()).resolves.toEqual({ available: true });
    expect(after).toEqual(["still called"]);
    expect(reports.some((report) => report.message.includes("listener exploded"))).toBe(true);
    await engine.close();
  });
});

describe("createEmbeddedEngine — failure, progress and retry", () => {
  it("surfaces progress through the availability detail while downloading", async () => {
    const held = gate();
    const engine = engineWith({
      fetchFn: async (input) => {
        if (input === MANIFEST.weights.url) await held.promise;
        return new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS);
      },
    });

    engine.requestModel();
    // The tokenizer lands first; the weights request is held open, so the engine
    // is observably mid-download when the detail is read.
    await until(async () => {
      const state = await engine.availability();
      expect(state).toMatchObject({ available: false, reason: "model-not-downloaded" });
      expect(state.available === false && state.detail).toMatch(/downloading .*%/);
    });

    held.release();
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
    // A request the cooldown declines starts nothing, so there is nothing in
    // flight to wait for — and a request it *wrongly* accepted would be in
    // flight, which is exactly what this waits for before counting.
    await engine.whenSettled();
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
    // Same shape as the cooldown's refusal: a guard that let this through would
    // leave an attempt in flight, and this is what would wait for it.
    await engine.whenSettled();
    expect(calls).toEqual([]);
  });

  it("never downloads where WebAssembly cannot run", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ fetchFn, wasmSupported: false });

    engine.requestModel();
    await engine.whenSettled();
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
    const held = gate();
    const calls: string[] = [];
    const engine = engineWith({
      fetchFn: async (input) => {
        calls.push(input);
        await held.promise;
        return new Response(input === MANIFEST.tokenizer.url ? TOKENIZER_BYTES : WEIGHTS);
      },
    });

    engine.requestModel();
    // The test's premise is a download that is *actually* in flight when
    // `close()` is called; waiting for the request to be issued is what makes
    // that true, rather than hoping enough turns have passed.
    await until(() => {
      expect(calls).toEqual([MANIFEST.tokenizer.url]);
    });

    const closing = engine.close();
    held.release();
    await expect(closing).resolves.toBeUndefined();
  });

  it("does not start a download after close", async () => {
    const { fetchFn, calls } = serveManifest();
    const engine = engineWith({ fetchFn });

    await engine.close();
    engine.requestModel();
    await engine.whenSettled();
    expect(calls).toEqual([]);
  });

  it("releases a session that finished loading during shutdown", async () => {
    await seedCache();
    const held = gate();
    const { factory, released } = stubSession();
    let entered = false;
    const engine = engineWith({
      sessionFactory: async (weights, threads) => {
        entered = true;
        await held.promise;
        return factory(weights, threads);
      },
    });

    const opening = engine.open();
    // Close only once the runtime is actually loading: the point of the test is
    // a session that comes into existence after shutdown began. Getting here
    // costs two artifact reads plus their hashes, which is filesystem work — the
    // reason a turn-counting wait failed this test on CI and not locally.
    await until(() => {
      expect(entered).toBe(true);
    });
    const closing = engine.close();
    held.release();

    await expect(opening).rejects.toThrow(/aborted/);
    await closing;
    expect(released()).toBe(1);
  });
});

/**
 * SERVER-049 put the model on a worker thread, and the only thing the engine
 * itself learned is what to do when that thread dies: forget it, so the next
 * resolution builds another. The thread boundary is `worker-host.test.ts`'s;
 * these are the engine's own consequences of it.
 */
describe("createEmbeddedEngine — a host that dies", () => {
  interface Recorded {
    readonly hosts: { closed: boolean }[];
    readonly lost: ((detail: string) => void)[];
    readonly factory: InferenceHostFactory;
  }

  function recordingHosts(): Recorded {
    const hosts: { closed: boolean }[] = [];
    const lost: ((detail: string) => void)[] = [];
    const factory: InferenceHostFactory = (_spec, options) => {
      const state = { closed: false };
      hosts.push(state);
      if (options.onLost !== undefined) lost.push(options.onLost);
      const host: InferenceHost = {
        embed: (texts) => Promise.resolve(texts.map(() => Float32Array.from([1, 0]))),
        close: () => {
          state.closed = true;
          return Promise.resolve();
        },
      };
      return Promise.resolve(host);
    };
    return { hosts, lost, factory };
  }

  it("starts a fresh host on the next open, and says so once", async () => {
    await seedCache();
    const recorded = recordingHosts();
    const reports: EngineReport[] = [];
    const engine = engineWith({ hostFactory: recorded.factory, report: (r) => reports.push(r) });

    const first = await engine.open();
    await expect(first.embed(["a"])).resolves.toHaveLength(1);
    expect(recorded.hosts).toHaveLength(1);

    recorded.lost[0]?.("the embedding worker exited unexpectedly (code 9)");

    const second = await engine.open();
    expect(second).not.toBe(first);
    expect(recorded.hosts).toHaveLength(2);
    // The one nobody will hold again was released, not left behind.
    expect(recorded.hosts.map((host) => host.closed)).toEqual([true, false]);
    expect(reports.filter((report) => report.level === "error")).toEqual([
      {
        level: "error",
        message:
          "the tiny-test-model embedding worker stopped: the embedding worker exited " +
          "unexpectedly (code 9); it will be started again on the next index pass",
      },
    ]);

    await engine.close();
  });

  it("ignores a death report from a host it has already replaced", async () => {
    await seedCache();
    const recorded = recordingHosts();
    const reports: EngineReport[] = [];
    const engine = engineWith({ hostFactory: recorded.factory, report: (r) => reports.push(r) });

    await engine.open();
    recorded.lost[0]?.("first died");
    const second = await engine.open();
    // The first host's late report must not throw away the live one.
    recorded.lost[0]?.("first died again");

    expect(await engine.open()).toBe(second);
    expect(recorded.hosts).toHaveLength(2);
    expect(reports.filter((report) => report.level === "error")).toHaveLength(1);

    await engine.close();
  });

  it("says nothing, and starts nothing, when a host dies during shutdown", async () => {
    await seedCache();
    const recorded = recordingHosts();
    const reports: EngineReport[] = [];
    const engine = engineWith({ hostFactory: recorded.factory, report: (r) => reports.push(r) });

    await engine.open();
    await engine.close();
    recorded.lost[0]?.("terminated");

    expect(reports.filter((report) => report.level === "error")).toEqual([]);
    expect(recorded.hosts).toHaveLength(1);
  });

  it("closes the host it holds, exactly once", async () => {
    await seedCache();
    const recorded = recordingHosts();
    const engine = engineWith({ hostFactory: recorded.factory });

    await engine.open();
    await engine.close();

    expect(recorded.hosts.map((host) => host.closed)).toEqual([true]);
  });

  it("closes a host that finished loading during shutdown rather than leaking it", async () => {
    await seedCache();
    const recorded = recordingHosts();
    const held = gate();
    let entered = false;
    const engine = engineWith({
      hostFactory: async (spec, options) => {
        entered = true;
        await held.promise;
        return recorded.factory(spec, options);
      },
    });

    const opening = engine.open();
    await until(() => {
      expect(entered).toBe(true);
    });
    const closing = engine.close();
    held.release();

    await expect(opening).rejects.toThrow(/aborted/);
    await closing;
    expect(recorded.hosts.map((host) => host.closed)).toEqual([true]);
  });
});
