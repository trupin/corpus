/**
 * The worker body, driven on this thread through a fake port.
 *
 * `startInferenceWorker` takes its port and its loader as arguments precisely
 * so this is possible: the only worker-only code in the module is the two-line
 * dispatch at its bottom, and everything a message can do to it is decided
 * here. `worker-host.test.ts` covers the other side against real threads.
 */

import { describe, expect, it, vi } from "vitest";
import {
  INFERENCE_WORKER_KIND,
  INFERENCE_WORKER_URL,
  isInferenceWorkerData,
  startInferenceWorker,
  type InferencePort,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceWorkerData,
} from "./inference-worker.js";
import type { InferenceRuntime, InferenceSpec } from "./inference.js";
import type { EmbeddedModelManifest } from "./manifest.js";

const MANIFEST = { model: "tiny-test-model" } as unknown as EmbeddedModelManifest;
const SPEC: InferenceSpec = { cacheDir: "/nowhere", manifest: MANIFEST, threads: 2 };
const DATA: InferenceWorkerData = { kind: INFERENCE_WORKER_KIND, spec: SPEC };

interface Sent {
  readonly message: InferenceResponse;
  readonly transfer: readonly ArrayBufferLike[] | undefined;
}

/** A port that records what the worker said and lets a test say things back. */
function fakePort(): {
  port: InferencePort;
  sent: Sent[];
  send: (request: InferenceRequest) => void;
} {
  const sent: Sent[] = [];
  let listener: ((value: InferenceRequest) => void) | undefined;
  return {
    sent,
    send: (request) => listener?.(request),
    port: {
      postMessage: (message, transferList) => {
        sent.push({ message, transfer: transferList });
      },
      on: (_event, handler) => {
        listener = handler;
      },
    },
  };
}

/** A runtime that answers with one `dim`-long vector per input, counting calls. */
function stubRuntime(dim = 3): { runtime: InferenceRuntime; batches: readonly string[][] } {
  const batches: string[][] = [];
  return {
    batches,
    runtime: {
      embed: (texts) => {
        batches.push([...texts]);
        return Promise.resolve(
          texts.map((text, index) =>
            Float32Array.from({ length: dim }, (_v, k) => index + k + text.length),
          ),
        );
      },
      release: () => Promise.resolve(),
    },
  };
}

/** Lets the worker's promise chain settle; nothing here waits on real I/O. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("startInferenceWorker", () => {
  it("announces itself ready once the model has loaded, and not before", async () => {
    const { port, sent } = fakePort();
    let finish = (value: InferenceRuntime): void => void value;
    const load = (): Promise<InferenceRuntime> =>
      new Promise<InferenceRuntime>((resolve) => {
        finish = resolve;
      });

    startInferenceWorker(port, DATA, load);
    await settle();
    expect(sent).toEqual([]);

    finish(stubRuntime().runtime);
    await settle();
    expect(sent.map((entry) => entry.message.kind)).toEqual(["ready"]);
  });

  it("answers a batch with one packed buffer, and asks for it to be transferred", async () => {
    const { port, sent, send } = fakePort();
    const { runtime, batches } = stubRuntime();
    startInferenceWorker(port, DATA, () => Promise.resolve(runtime));
    await settle();

    send({ id: 7, texts: ["ab", "cde"] });
    await settle();

    const answer = sent[1];
    expect(answer?.message.kind).toBe("vectors");
    if (answer === undefined || answer.message.kind !== "vectors") return;
    expect(answer.message.id).toBe(7);
    expect(answer.message.dim).toBe(3);
    expect(answer.message.data).toHaveLength(6);
    // Zero-copy: the buffer carrying the batch is handed over, not cloned.
    expect(answer.transfer).toEqual([answer.message.data.buffer]);
    expect(batches).toEqual([["ab", "cde"]]);
  });

  it("passes the spec it was given straight to the loader", async () => {
    const { port } = fakePort();
    const load = vi.fn(() => Promise.resolve(stubRuntime().runtime));
    startInferenceWorker(port, DATA, load);
    await settle();

    expect(load).toHaveBeenCalledWith(SPEC);
  });

  it("runs one batch at a time, whatever order the requests arrive in", async () => {
    const { port, sent, send } = fakePort();
    const order: string[] = [];
    let releaseFirst = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime: InferenceRuntime = {
      embed: async (texts) => {
        const label = texts[0] ?? "";
        order.push(`start:${label}`);
        if (label === "first") await gate;
        order.push(`end:${label}`);
        return texts.map(() => Float32Array.from([1]));
      },
      release: () => Promise.resolve(),
    };

    startInferenceWorker(port, DATA, () => Promise.resolve(runtime));
    await settle();
    send({ id: 1, texts: ["first"] });
    send({ id: 2, texts: ["second"] });
    await settle();

    // The second batch has not been started while the first is in the session.
    expect(order).toEqual(["start:first"]);
    releaseFirst();
    await settle();
    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
    expect(sent.slice(1).map((entry) => (entry.message as { id: number }).id)).toEqual([1, 2]);
  });

  it("reports a load failure once, and then refuses every request with the same reason", async () => {
    const { port, sent, send } = fakePort();
    startInferenceWorker(port, DATA, () => Promise.reject(new Error("no model here")));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toEqual({ kind: "failed", message: "no model here" });

    send({ id: 1, texts: ["x"] });
    await settle();
    expect(sent[1]?.message).toEqual({ kind: "error", id: 1, message: "no model here" });
  });

  it("turns a forward pass that threw into an answer, not a dead worker", async () => {
    const { port, sent, send } = fakePort();
    const runtime: InferenceRuntime = {
      embed: () => Promise.reject(new Error("graph exploded")),
      release: () => Promise.resolve(),
    };
    startInferenceWorker(port, DATA, () => Promise.resolve(runtime));
    await settle();

    send({ id: 4, texts: ["x"] });
    send({ id: 5, texts: ["y"] });
    await settle();

    expect(sent.slice(1).map((entry) => entry.message)).toEqual([
      { kind: "error", id: 4, message: "graph exploded" },
      { kind: "error", id: 5, message: "graph exploded" },
    ]);
  });

  it("reports a non-Error rejection as text rather than [object Object]", async () => {
    const { port, sent } = fakePort();
    const rejectWith = async (value: unknown): Promise<InferenceRuntime> => {
      await Promise.resolve();
      throw value;
    };
    startInferenceWorker(port, DATA, () => rejectWith("plain string"));
    await settle();

    expect(sent[0]?.message).toEqual({ kind: "failed", message: "plain string" });
  });
});

describe("the worker's identity", () => {
  it("recognises only its own workerData", () => {
    expect(isInferenceWorkerData(DATA)).toBe(true);
    expect(isInferenceWorkerData({ kind: "vitest" })).toBe(false);
    expect(isInferenceWorkerData(null)).toBe(false);
    expect(isInferenceWorkerData(undefined)).toBe(false);
    expect(isInferenceWorkerData("corpus-inference-worker")).toBe(false);
  });

  it("names a module URL, which is what a Worker is spawned with", () => {
    expect(INFERENCE_WORKER_URL).toMatch(/^file:\/\/.*inference-worker\.[tj]s$/);
  });
});
