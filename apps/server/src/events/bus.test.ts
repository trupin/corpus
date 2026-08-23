import { describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createLogger, type LogSink } from "../logger.js";
import { createInvalidationBus } from "./bus.js";
import {
  AGENTS_KEY,
  DOCS_KEY,
  INDEX_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  REFLECT_KEY,
  TREE_KEY,
  docKey,
  threadKey,
} from "./keys.js";

function recorder(): { keys: QueryKey[][]; listener: (keys: readonly QueryKey[]) => void } {
  const keys: QueryKey[][] = [];
  return { keys, listener: (batch) => keys.push([...batch]) };
}

describe("createInvalidationBus", () => {
  it("delivers a published batch to every subscriber", () => {
    const bus = createInvalidationBus();
    const first = recorder();
    const second = recorder();
    bus.subscribe(first.listener);
    bus.subscribe(second.listener);

    bus.invalidate([DOCS_KEY, docKey("doc_a")]);

    expect(first.keys).toEqual([[["docs"], ["docs", "doc_a"], ["reflect"]]]);
    expect(second.keys).toEqual(first.keys);
    expect(bus.size).toBe(2);
  });

  it("coalesces duplicate keys within one publish", () => {
    const bus = createInvalidationBus();
    const seen = recorder();
    bus.subscribe(seen.listener);

    bus.invalidate([DOCS_KEY, docKey("doc_a"), ["docs"], docKey("doc_a")]);

    expect(seen.keys).toEqual([[["docs"], ["docs", "doc_a"], ["reflect"]]]);
  });

  it("drops an empty publish, because an empty frame tells a client nothing", () => {
    const bus = createInvalidationBus();
    const seen = recorder();
    bus.subscribe(seen.listener);

    bus.invalidate([]);

    expect(seen.keys).toEqual([]);
  });

  it("stops delivering to a subscriber that unsubscribed", () => {
    const bus = createInvalidationBus();
    const staying = recorder();
    const leaving = recorder();
    bus.subscribe(staying.listener);
    const unsubscribe = bus.subscribe(leaving.listener);

    unsubscribe();
    unsubscribe();
    expect(() => {
      bus.invalidate([QUEUE_KEY]);
    }).not.toThrow();

    expect(staying.keys).toEqual([[["queue"], ["reflect"]]]);
    expect(leaving.keys).toEqual([]);
    expect(bus.size).toBe(1);
  });

  it("keeps notifying peers when one listener throws, and says so", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const bus = createInvalidationBus({ logger: createLogger("info", sink) });
    const healthy = recorder();
    bus.subscribe(() => {
      throw new Error("listener bug");
    });
    bus.subscribe(healthy.listener);

    bus.invalidate([TREE_KEY]);

    expect(healthy.keys).toEqual([[["tree"]]]);
    expect(lines.join("\n")).toContain("invalidation listener failed");
  });

  /**
   * SPEC.md §7's reflection key, and the reason it is applied here rather than
   * by the emitters (CONTRACT-076, SERVER-137).
   *
   * The published rule is a rule about frames — "every frame that names
   * `["docs"]` or `["queue"]`, and no others" — so the bus is where it can be
   * true of the twenty-two call sites that name one of those two without any of
   * them knowing what a reflection is.
   */
  describe("the reflection key rides on the frames the contract says it does", () => {
    it("adds it to a frame naming the document collection", () => {
      const bus = createInvalidationBus();
      const seen = recorder();
      bus.subscribe(seen.listener);

      bus.invalidate([DOCS_KEY, TREE_KEY]);

      expect(seen.keys).toEqual([[["docs"], ["tree"], ["reflect"]]]);
    });

    it("adds it to a frame naming the queue", () => {
      const bus = createInvalidationBus();
      const seen = recorder();
      bus.subscribe(seen.listener);

      bus.invalidate([QUEUE_KEY, JOBS_KEY, AGENTS_KEY]);

      expect(seen.keys).toEqual([[["queue"], ["jobs"], ["agents"], ["reflect"]]]);
    });

    it("adds it once to a frame naming both", () => {
      const bus = createInvalidationBus();
      const seen = recorder();
      bus.subscribe(seen.listener);

      bus.invalidate([DOCS_KEY, QUEUE_KEY]);

      expect(seen.keys).toEqual([[["docs"], ["queue"], ["reflect"]]]);
    });

    // "And no others". A frame about the folder tree, the semantic index or one
    // open reader's row moves nothing the Reflect control reads.
    it("leaves a frame that names neither alone", () => {
      const bus = createInvalidationBus();
      const seen = recorder();
      bus.subscribe(seen.listener);

      bus.invalidate([TREE_KEY, INDEX_KEY]);
      bus.invalidate([docKey("doc_a"), threadKey("th_b")]);

      expect(seen.keys).toEqual([
        [["tree"], ["index"]],
        [
          ["docs", "doc_a"],
          ["threads", "th_b"],
        ],
      ]);
    });

    // Idempotent: a caller that named it itself gets one, not two.
    it("does not double a key an emitter already named", () => {
      const bus = createInvalidationBus();
      const seen = recorder();
      bus.subscribe(seen.listener);

      bus.invalidate([DOCS_KEY, REFLECT_KEY]);

      expect(seen.keys).toEqual([[["docs"], ["reflect"]]]);
    });
  });

  it("survives a subscriber unsubscribing from inside its own notification", () => {
    const bus = createInvalidationBus();
    const seen = recorder();
    const unsubscribe = bus.subscribe((keys) => {
      unsubscribe();
      seen.listener(keys);
    });
    const peer = recorder();
    bus.subscribe(peer.listener);

    bus.invalidate([DOCS_KEY]);
    bus.invalidate([TREE_KEY]);

    expect(seen.keys).toEqual([[["docs"], ["reflect"]]]);
    expect(peer.keys).toEqual([[["docs"], ["reflect"]], [["tree"]]]);
  });
});
