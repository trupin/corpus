// SERVER-116 — the index's state word reaches the two surfaces that embed a
// copy of it, and progress ticks still do not.
//
// The criterion the issue is emphatic about is a **count**, not an assertion:
// "progress ticks do not cause board-wide re-reads — state the measurement, do
// not assert it". So the last block runs a whole index pass through a real
// announcer and counts what came out, by key.

import type { SemanticIndexState } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { createInvalidationBus } from "../events/bus.js";
import { DOCS_KEY, INDEX_KEY } from "../events/keys.js";
import { createIndexAnnouncer } from "./announce.js";

/**
 * Every key the bus published, newest last, as JSON so `toEqual` reads plainly.
 *
 * The bus widens `["docs"]` to name `["reflect"]` alongside it (`events/bus.ts`),
 * so the assertions below count the two keys they are about rather than
 * comparing whole frames — a rule of the bus is not a claim of this module's.
 */
function recorder(): { keys: string[]; bus: ReturnType<typeof createInvalidationBus> } {
  const bus = createInvalidationBus();
  const keys: string[] = [];
  bus.subscribe((batch) => {
    for (const key of batch) keys.push(JSON.stringify(key));
  });
  return { keys, bus };
}

const INDEX = JSON.stringify(INDEX_KEY);
const DOCS = JSON.stringify(DOCS_KEY);

/** `[index frames, board-wide frames]`. */
const count = (keys: readonly string[]): [number, number] => [
  keys.filter((key) => key === INDEX).length,
  keys.filter((key) => key === DOCS).length,
];

/** Lets every pending `changed()` finish reading the state word. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

describe("the index announcer (SERVER-116)", () => {
  it("announces `[docs]` when the state word moves, and only then", async () => {
    const { keys, bus } = recorder();
    let state: SemanticIndexState = "indexing";
    const announcer = createIndexAnnouncer({ bus, readState: () => Promise.resolve(state) });

    announcer.changed();
    await settle();
    // The first reading is announced deliberately — see the module comment.
    expect(count(keys)).toEqual([1, 1]);

    keys.length = 0;
    announcer.changed();
    announcer.changed();
    announcer.changed();
    await settle();
    // Three progress ticks at the same word: three `["index"]` frames, and not
    // one board-wide read.
    expect(count(keys)).toEqual([3, 0]);

    keys.length = 0;
    state = "current";
    announcer.changed();
    await settle();
    expect(count(keys)).toEqual([1, 1]);
  });

  it("answers a tick that arrives mid-question with a fresh reading", async () => {
    const { keys, bus } = recorder();
    const words: SemanticIndexState[] = ["indexing", "stale", "current"];
    let at = 0;
    const announcer = createIndexAnnouncer({
      bus,
      readState: () => Promise.resolve(words[Math.min(at++, words.length - 1)] ?? "current"),
    });

    // Both land before the first read resolves, so the second must not be lost:
    // the word it would have seen is the one the overlay is waiting for.
    announcer.changed();
    announcer.changed();
    await settle();

    expect(keys.filter((key) => key === DOCS)).toHaveLength(2);
  });

  it("keeps announcing after a reading throws", async () => {
    const { keys, bus } = recorder();
    let broken = true;
    const announcer = createIndexAnnouncer({
      bus,
      readState: () =>
        broken ? Promise.reject(new Error("database is closed")) : Promise.resolve("current"),
    });

    announcer.changed();
    await settle();
    // The `["index"]` half went out regardless — a frame is never worth a throw.
    expect(count(keys)).toEqual([1, 0]);

    broken = false;
    keys.length = 0;
    announcer.changed();
    await settle();
    expect(count(keys)).toEqual([1, 1]);
  });

  it("is exactly the old behaviour when no reader is supplied", async () => {
    // What every test that constructs a worker with a bare `bus` gets, and what
    // a server built without a semantic half gets.
    const { keys, bus } = recorder();
    const announcer = createIndexAnnouncer({ bus });

    announcer.changed();
    announcer.changed();
    await settle();

    expect(count(keys)).toEqual([2, 0]);
  });

  it("says nothing at all with no bus", () => {
    const announcer = createIndexAnnouncer({ readState: () => Promise.resolve("current") });
    expect(() => {
      announcer.changed();
    }).not.toThrow();
  });

  /**
   * The measurement the issue asks for, rather than an assertion about it: an
   * index run that starts empty, embeds forty batches and settles.
   */
  it("costs two board-wide frames across a whole run, against forty progress ticks", async () => {
    const { keys, bus } = recorder();
    let pending = 40;
    const announcer = createIndexAnnouncer({
      bus,
      readState: () => Promise.resolve<SemanticIndexState>(pending > 0 ? "indexing" : "current"),
    });

    // The rebuild's opening edge, then one frame per batch, then the closing one.
    announcer.changed();
    await settle();
    while (pending > 0) {
      pending -= 1;
      announcer.changed();
      await settle();
    }
    announcer.changed();
    await settle();

    // 42 index frames — one per announcement, unchanged from before SERVER-116 —
    // and two board-wide frames, one per state change.
    expect(count(keys)).toEqual([42, 2]);
  });
});
