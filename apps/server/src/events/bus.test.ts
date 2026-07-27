import { describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createLogger, type LogSink } from "../logger.js";
import { createInvalidationBus } from "./bus.js";
import { DOCS_KEY, QUEUE_KEY, TREE_KEY, docKey } from "./keys.js";

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

    expect(first.keys).toEqual([[["docs"], ["docs", "doc_a"]]]);
    expect(second.keys).toEqual(first.keys);
    expect(bus.size).toBe(2);
  });

  it("coalesces duplicate keys within one publish", () => {
    const bus = createInvalidationBus();
    const seen = recorder();
    bus.subscribe(seen.listener);

    bus.invalidate([DOCS_KEY, docKey("doc_a"), ["docs"], docKey("doc_a")]);

    expect(seen.keys).toEqual([[["docs"], ["docs", "doc_a"]]]);
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

    expect(staying.keys).toEqual([[["queue"]]]);
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

    expect(seen.keys).toEqual([[["docs"]]]);
    expect(peer.keys).toEqual([[["docs"]], [["tree"]]]);
  });
});
