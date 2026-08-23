// SPEC.md §7's "or the dust settles", through the real server (SERVER-137).
//
// The scheduler's own arithmetic is pinned in `scheduler.test.ts`. What is
// proved here is the wiring nothing else can prove: that a real mutation over
// HTTP restarts the window, that an agent's real mutation does not, and that
// when the window elapses a real `workspace.reflect` file lands in
// `.corpus/queue/pending/` under the three conditions §7 names.
//
// Only the timer functions are faked. Everything else — the request, the git
// commit, the projection, the queue write — runs for real, so the clock cannot
// be the thing under test *and* the thing being stubbed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_REFLECT_EVENT_TYPE } from "@corpus/contract";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
} from "../docs/write-fixture.js";
import { minutesToMs } from "./scheduler.js";
import { REFLECT_QUIET_SOURCE } from "./service.js";

const QUIET = 30;
const WINDOW = minutesToMs(QUIET);

let ws: WriteWorkspace;

/**
 * The reflections on the queue, read **through the projection's `events` table**
 * and then off disk.
 *
 * The row is written after the file is (`QueueService.enqueue` awaits the write
 * and then mirrors), so a row is proof the bytes are complete — which reading
 * the directory alone is not. Under a loaded suite the directory listing caught
 * a half-written file often enough to fail a run.
 */
const reflectionIds = (): string[] =>
  (
    ws.db.prepare("SELECT id FROM events WHERE type = ?").all(WORKSPACE_REFLECT_EVENT_TYPE) as {
      id: string;
    }[]
  ).map((row) => row.id);

const reflections = (): Record<string, unknown>[] =>
  reflectionIds().map(
    (id) =>
      JSON.parse(
        readFileSync(join(ws.root, ".corpus", "queue", "pending", `${id}.json`), "utf8"),
      ) as Record<string, unknown>,
  );

const armed = (): number | null => ws.server.reflect?.armedForMs ?? null;

/**
 * Lets the enqueue the timer started finish its real filesystem work.
 *
 * `setTimeout` is faked and `setImmediate` is not, so turning the loop this way
 * drains the promise chain and the async writes behind it without advancing the
 * window under test by a millisecond.
 */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 25; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Advance the quiet window by `ms`, then let whatever it started finish. */
const elapse = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

/**
 * Waits — in real time, without moving the faked window — until `count`
 * reflections are on the queue. Fails loudly rather than silently passing a
 * "toHaveLength" against a listing that had not caught up.
 */
const waitForReflections = async (count: number): Promise<Record<string, unknown>[]> => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (reflectionIds().length >= count) return reflections();
    if (Date.now() > deadline) {
      throw new Error(
        `waited for ${String(count)} reflections, saw ${String(reflectionIds().length)}`,
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
};

beforeEach(() => {
  // Only the timers. Faking `Date` or the microtask queue would break the real
  // git and HTTP work the rest of the fixture does.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  ws = createWriteWorkspace("reflect-auto", { sprint: "s137", reflectQuietMinutes: QUIET });
});

afterEach(async () => {
  // Let anything a fired window started reach disk before the handle it writes
  // to goes away; otherwise a passing test logs a failed job-log append.
  await settle();
  ws.close();
  vi.useRealTimers();
});

describe("the server reflects when the dust settles (SPEC.md §7)", () => {
  it("enqueues one reflection a whole window after a person's write, and not before", async () => {
    await createDoc(ws, { type: "note", title: "Something to say about" }, "user");
    expect(armed()).toBe(WINDOW);

    await elapse(WINDOW - 1);
    expect(reflectionIds()).toHaveLength(0);

    await elapse(1);

    const pending = await waitForReflections(1);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: WORKSPACE_REFLECT_EVENT_TYPE,
      // The source is what tells an operator reading `corpus queue list` that
      // nobody pressed anything.
      source: REFLECT_QUIET_SOURCE,
      payload: { since: null },
    });
  });

  /**
   * §7: "ten changes in five minutes are one reflection, half an hour after the
   * last". The second write replaces the first one's timer, so the moment the
   * first window would have elapsed passes with nothing on the queue.
   */
  it("restarts the window on the next write, so two changes are one reflection", async () => {
    await createDoc(ws, { type: "note", title: "First" }, "user");
    await elapse(WINDOW - 1_000);
    ws.advance(WINDOW - 1_000);
    await createDoc(ws, { type: "note", title: "Second" }, "user");

    // The first window's last second passes and nothing fires.
    await elapse(1_000);
    expect(reflectionIds()).toHaveLength(0);

    await elapse(WINDOW - 1_000);
    expect(await waitForReflections(1)).toHaveLength(1);
  });

  /**
   * §7's amendment: the agent's own writes "do not start the quiet window". A
   * reflection writing forty changelog entries must not schedule its own
   * successor.
   */
  it("never starts the window for the agent's own writes", async () => {
    await createDoc(ws, { type: "note", title: "Agent output" }, "agent");

    expect(armed()).toBeNull();
    await elapse(WINDOW * 2);
    expect(reflectionIds()).toHaveLength(0);
  });

  /**
   * The first of §7's three conditions: "something changed after the last
   * reflection". An archive alone is exactly the case CONTRACT-076 gives —
   * an archived document is not in `changed`, so nothing is left to reflect on.
   */
  it("enqueues nothing when the window elapses over nothing unreflected", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Agent output" }, "agent");
    ws.advance(60_000);
    expect(
      (await ws.post(`/api/docs/${doc.id}/archive`, {}, { "x-corpus-author": "user" })).status,
    ).toBe(200);
    expect(armed()).toBe(WINDOW);

    await elapse(WINDOW);

    expect(reflectionIds()).toHaveLength(0);
    expect(armed()).toBeNull();
  });

  /**
   * The third condition: "no reflection is pending or running". The change that
   * arrived during it is real work, so the window is armed afresh rather than
   * dropped.
   */
  it("waits another window rather than doubling a reflection already pending", async () => {
    expect((await ws.post("/api/workspace/reflect", {})).status).toBe(202);
    ws.advance(60_000);
    await createDoc(ws, { type: "note", title: "Changed during it" }, "user");

    await elapse(WINDOW);

    expect(await waitForReflections(1)).toHaveLength(1);
    expect(armed()).toBe(WINDOW);
  });

  it("arms nothing at all when the window is `0`", async () => {
    ws.close();
    ws = createWriteWorkspace("reflect-off", { sprint: "s137", reflectQuietMinutes: 0 });

    await createDoc(ws, { type: "note", title: "Nobody will reflect on this" }, "user");

    expect(armed()).toBeNull();
    await elapse(minutesToMs(60 * 24));
    expect(reflectionIds()).toHaveLength(0);
    expect((await ws.request("/api/workspace/reflect", { headers: AUTH })).status).toBe(200);
  });

  /**
   * The restart rule: "a server restart with unreflected changes and a quiet
   * corpus enqueues at most one event, after one full window from start (never
   * at the instant of start)".
   *
   * `start()` is what boot calls, and it is asked here on a corpus that already
   * holds an unreflected change with most of a window already elapsed — the
   * state a restart finds. It arms a whole window, not the remainder of one, and
   * it enqueues exactly one thing however long the corpus then stays quiet.
   */
  it("waits a whole window from start, then enqueues at most one", async () => {
    await createDoc(ws, { type: "note", title: "Left unreflected" }, "user");
    await elapse(WINDOW - 1_000);

    ws.server.reflect?.start();

    expect(armed()).toBe(WINDOW);
    await elapse(WINDOW - 1);
    expect(reflectionIds()).toHaveLength(0);

    await elapse(1);
    expect(await waitForReflections(1)).toHaveLength(1);

    await elapse(WINDOW * 5);
    expect(reflectionIds()).toHaveLength(1);
  });
});
