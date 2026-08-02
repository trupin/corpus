/**
 * The thread boundary, against real `worker_threads` Workers.
 *
 * The workers here run stub sources rather than the shipped entry, for a reason
 * worth stating: a Worker is spawned with a URL that the *running process* must
 * be able to load, and Vitest transforms TypeScript itself rather than through
 * a Node loader — so `INFERENCE_WORKER_URL` (a `.ts` path under test, the
 * esbuild bundle in an installed tool) is not loadable from inside a test.
 * Splitting it that way is what the module's shape is for: the worker's body is
 * covered in process in `inference-worker.test.ts`, everything the *boundary*
 * does — readiness, transfer, crash, abort, terminate — is covered here with
 * real threads, and the two halves meeting over the real model is the issue's
 * E2E.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingError } from "../provider.js";
import type { InferenceSpec } from "./inference.js";
import type { EmbeddedModelManifest } from "./manifest.js";
import { createWorkerHost, inProcessHostFactory, type InferenceHost } from "./worker-host.js";

const MANIFEST = { model: "tiny-test-model" } as unknown as EmbeddedModelManifest;

/**
 * A worker that reports ready and answers every batch with one 1-dimensional
 * vector per input, carrying **the byte length its previous answer's buffer had
 * after it was posted**.
 *
 * That is the zero-copy proof: a transferred buffer is detached, so the value
 * is `0` from the second answer onwards, and would be the buffer's real size if
 * the host or the worker had settled for a structured clone.
 */
const ECHO = `
const { parentPort } = require("node:worker_threads");
let lastLength = -1;
parentPort.postMessage({ kind: "ready" });
parentPort.on("message", (request) => {
  const data = new Float32Array(request.texts.length);
  data.fill(lastLength);
  parentPort.postMessage({ kind: "vectors", id: request.id, data, dim: 1 }, [data.buffer]);
  lastLength = data.byteLength;
});
`;

/** Ready, then a heartbeat file that only stops growing when the thread is gone. */
const HEARTBEAT = `
const { parentPort, workerData } = require("node:worker_threads");
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const beat = join(workerData.spec.cacheDir, "beat");
setInterval(() => appendFileSync(beat, "x"), 2);
parentPort.postMessage({ kind: "ready" });
parentPort.on("message", () => undefined);
`;

/** Never reports ready — the shape an abort has to be able to interrupt. */
const HANGING_LOAD = `
const { parentPort, workerData } = require("node:worker_threads");
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const beat = join(workerData.spec.cacheDir, "beat");
setInterval(() => appendFileSync(beat, "x"), 2);
parentPort.on("message", () => undefined);
`;

const FAILING_LOAD = `
const { parentPort } = require("node:worker_threads");
parentPort.postMessage({ kind: "failed", message: "the pinned weights are not in the cache" });
`;

/** Ready, then dies the moment it is asked to do any work. */
const CRASH_ON_EMBED = `
const { parentPort } = require("node:worker_threads");
parentPort.postMessage({ kind: "ready" });
parentPort.on("message", () => process.exit(9));
`;

/** Ready, then throws where nobody can catch it — an OOM's shape, roughly. */
const THROW_AFTER_READY = `
const { parentPort } = require("node:worker_threads");
parentPort.postMessage({ kind: "ready" });
setTimeout(() => { throw new Error("wasm heap exhausted"); }, 1);
`;

/** Dies without ever reporting ready: a load that fails by dying, not by saying so. */
const DIE_BEFORE_READY = `process.exit(3);`;

let dir: string;
const opened: InferenceHost[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "corpus-worker-host-"));
});

afterEach(async () => {
  // Nothing may outlive a test: an orphan thread would keep the runner alive.
  for (const host of opened.splice(0)) await host.close();
  await rm(dir, { recursive: true, force: true });
});

const specFor = (): InferenceSpec => ({ cacheDir: dir, manifest: MANIFEST, threads: 2 });

/**
 * A real (tiny) manifest, for the one host that actually reads the cache. The
 * worker stubs above never open a file, so `MANIFEST` can stay a placeholder;
 * `inProcessHostFactory` runs the shipped loader and needs pinned bytes.
 */
const TOKENIZER_BYTES = new TextEncoder().encode(
  JSON.stringify({
    model: {
      type: "WordPiece",
      unk_token: "[UNK]",
      continuing_subword_prefix: "##",
      max_input_chars_per_word: 100,
      vocab: { "[PAD]": 0, "[UNK]": 1, "[CLS]": 2, "[SEP]": 3, corpus: 4 },
    },
  }),
);
const WEIGHTS = new Uint8Array([9, 8, 7]);
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const REAL_MANIFEST: EmbeddedModelManifest = {
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

const inProcessSpec = (): InferenceSpec => ({
  cacheDir: dir,
  manifest: REAL_MANIFEST,
  threads: 2,
});

const seedInProcessCache = async (): Promise<void> => {
  await writeFile(join(dir, REAL_MANIFEST.tokenizer.name), TOKENIZER_BYTES);
  await writeFile(join(dir, REAL_MANIFEST.weights.name), WEIGHTS);
};

async function hostOn(
  source: string,
  options: Parameters<typeof createWorkerHost>[1] = {},
): Promise<InferenceHost> {
  const host = await createWorkerHost(specFor(), { ...options, entry: { source } });
  opened.push(host);
  return host;
}

const beatSize = async (): Promise<number> => {
  try {
    return (await stat(join(dir, "beat"))).size;
  } catch {
    return 0;
  }
};

/** Turns the loop until `predicate` holds; fails the test rather than hanging. */
async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("condition never held");
}

describe("createWorkerHost — the batch round trip", () => {
  it("resolves only once the worker says the model is loaded", async () => {
    const host = await hostOn(ECHO);
    const vectors = await host.embed(["a", "b", "c"]);
    expect(vectors).toHaveLength(3);
  });

  it("transfers the answer's buffer instead of copying it", async () => {
    const host = await hostOn(ECHO);

    const first = await host.embed(["a"]);
    const second = await host.embed(["b"]);

    // The first answer has no predecessor to report on.
    expect(first[0]?.[0]).toBe(-1);
    // The buffer the first answer travelled in was detached by the transfer.
    expect(second[0]?.[0]).toBe(0);
  });

  it("pairs answers with requests, whichever finishes first", async () => {
    const host = await hostOn(ECHO);
    const [one, two] = await Promise.all([host.embed(["a", "b"]), host.embed(["c"])]);
    expect(one).toHaveLength(2);
    expect(two).toHaveLength(1);
  });

  it("answers an empty batch without waking the worker", async () => {
    const host = await hostOn(ECHO);
    await expect(host.embed([])).resolves.toEqual([]);
  });
});

describe("createWorkerHost — a model that will not load", () => {
  it("rejects with the worker's own reason and leaves no thread behind", async () => {
    await expect(createWorkerHost(specFor(), { entry: { source: FAILING_LOAD } })).rejects.toThrow(
      /not in the cache/,
    );
  });

  it("reports a load failure as a plain Error, so the engine wraps it as its own", async () => {
    // `EmbeddingError` would be rethrown untouched by `open()`; a load failure
    // has to read the same whether it happened here or on this thread.
    await expect(
      createWorkerHost(specFor(), { entry: { source: FAILING_LOAD } }),
    ).rejects.not.toBeInstanceOf(EmbeddingError);
  });
});

describe("createWorkerHost — shutdown", () => {
  it("stops the thread mid-load when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = createWorkerHost(specFor(), {
      entry: { source: HANGING_LOAD },
      signal: controller.signal,
    });
    await waitFor(async () => (await beatSize()) > 0);

    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);

    const size = await beatSize();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await beatSize()).toBe(size);
  });

  it("refuses to start at all when the signal is already aborted", async () => {
    await expect(
      createWorkerHost(specFor(), {
        entry: { source: HANGING_LOAD },
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(/aborted/);
  });

  it("leaves no worker running after close, and no request hanging", async () => {
    const host = await hostOn(HEARTBEAT);
    await waitFor(async () => (await beatSize()) > 0);
    const inFlight = host.embed(["never answered"]);

    await host.close();

    await expect(inFlight).rejects.toThrow(/shut down/);
    const size = await beatSize();
    await new Promise((resolve) => setTimeout(resolve, 60));
    // The heartbeat is the assertion: a thread still scheduled would have
    // appended to it during that window.
    expect(await beatSize()).toBe(size);
    expect(await readFile(join(dir, "beat"), "utf8")).not.toBe("");
  });

  it("closes twice without complaining", async () => {
    const host = await hostOn(ECHO);
    await host.close();
    await expect(host.close()).resolves.toBeUndefined();
  });

  it("does not report a close as a lost worker", async () => {
    const lost: string[] = [];
    const host = await hostOn(ECHO, { onLost: (detail) => lost.push(detail) });
    await host.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lost).toEqual([]);
  });
});

describe("createWorkerHost — a worker that dies", () => {
  it("turns an exit into a rejected batch and one lost-worker report", async () => {
    const lost: string[] = [];
    const host = await hostOn(CRASH_ON_EMBED, { onLost: (detail) => lost.push(detail) });

    await expect(host.embed(["boom"])).rejects.toThrow(/exited unexpectedly \(code 9\)/);
    await waitFor(() => lost.length > 0);
    expect(lost).toHaveLength(1);
    // Every later call fails the same way rather than hanging on a dead thread.
    await expect(host.embed(["again"])).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("turns an uncaught throw into one lost-worker report, not a process crash", async () => {
    const lost: string[] = [];
    // The host is *returned*: a worker that posted `ready` before dying loaded
    // fine, so the outage is reported on a live host rather than failing the
    // load. That this holds even when the death overtakes the `ready` — the two
    // travel on different ports, see `lose`'s note — is what `lose` defers for.
    const host = await hostOn(THROW_AFTER_READY, { onLost: (detail) => lost.push(detail) });

    await waitFor(() => lost.length > 0);
    expect(lost[0]).toMatch(/wasm heap exhausted/);
    // `error` and `exit` both fire for an uncaught throw; it is one outage.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lost).toHaveLength(1);
    // A provider outage, not a dead server: the host answers, and answers with
    // the reason it lost.
    await expect(host.embed(["after"])).rejects.toThrow(/wasm heap exhausted/);
  });

  it("fails the load when the worker dies before it can report ready", async () => {
    // The other half of `lose`'s deferred `ready`: settling one turn late must
    // not turn a worker that never loaded into a load that never settles.
    await expect(
      createWorkerHost(specFor(), { entry: { source: DIE_BEFORE_READY } }),
    ).rejects.toThrow(/exited unexpectedly \(code 3\)/);
  });
});

describe("inProcessHostFactory", () => {
  /**
   * A session factory cannot be cloned across a thread boundary, which is
   * exactly why supplying one selects this host — the tests that must not spawn
   * threads, and the reference-value integration test.
   */
  const factoryWith = (released: { count: number }): ReturnType<typeof inProcessHostFactory> =>
    inProcessHostFactory(() =>
      Promise.resolve({
        run: ({ rows, cols }) => {
          const hidden = new Float32Array(rows * cols * 2).fill(1);
          return Promise.resolve({ hidden, dim: 2 });
        },
        release: () => {
          released.count += 1;
          return Promise.resolve();
        },
      }),
    );

  it("embeds on this thread and releases the session on close", async () => {
    await seedInProcessCache();
    const released = { count: 0 };
    const host = await factoryWith(released)(inProcessSpec(), {});

    const vectors = await host.embed(["corpus"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(2);

    await host.close();
    expect(released.count).toBe(1);
  });

  it("fails the load rather than the transport when the cache is empty", async () => {
    const released = { count: 0 };
    await expect(factoryWith(released)(inProcessSpec(), {})).rejects.toThrow(/could not be read/);
  });
});
