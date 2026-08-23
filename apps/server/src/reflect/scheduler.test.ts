import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReflectScheduler, minutesToMs, type ReflectAttempt } from "./scheduler.js";

/**
 * Every window here is asserted **at its two edges** — one millisecond before it
 * elapses, and at it — rather than by running the clock forward and finding a
 * call. A scheduler with its timer deleted and `attempt()` called inline passes
 * "it fired eventually"; it cannot pass "it had not fired one tick earlier".
 */
const QUIET = 30;
const WINDOW = minutesToMs(QUIET);

describe("the quiet window (SPEC.md §7)", () => {
  let quiet: number;
  let outcome: ReflectAttempt;
  let attempts: number;

  const scheduler = (): ReturnType<typeof createReflectScheduler> =>
    createReflectScheduler({
      quietMinutes: () => quiet,
      attempt: () => {
        attempts += 1;
        return Promise.resolve(outcome);
      },
    });

  beforeEach(() => {
    vi.useFakeTimers();
    quiet = QUIET;
    outcome = "enqueued";
    attempts = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires one whole window after a write, and not a tick before it", async () => {
    const clock = scheduler();

    clock.noteWrite("user");
    expect(clock.armedForMs).toBe(WINDOW);

    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    expect(attempts).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(1);

    clock.stop();
  });

  /**
   * §7: "ten changes in five minutes are one reflection, half an hour after the
   * last". The second write restarts the window rather than letting the first
   * one's timer run out.
   */
  it("restarts the window on every write, so ten changes are one reflection", async () => {
    const clock = scheduler();

    clock.noteWrite("user");
    await vi.advanceTimersByTimeAsync(WINDOW - 1_000);
    clock.noteWrite("user");

    // The first window's remaining second passes and nothing fires: the timer
    // that would have fired was replaced.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(0);

    await vi.advanceTimersByTimeAsync(WINDOW - 1_000);
    expect(attempts).toBe(1);

    clock.stop();
  });

  /**
   * §7's amendment, signed 2026-08-22: "a document changed only by the agent
   * since the clock … does not start the quiet window". A reflection writing
   * forty changelog entries must not hold its own successor off for forty
   * windows, and an agent write on a quiet corpus must arm nothing at all.
   */
  it("neither arms nor restarts for the agent's own writes", async () => {
    const clock = scheduler();

    clock.noteWrite("agent");
    expect(clock.armedForMs).toBeNull();
    await vi.advanceTimersByTimeAsync(WINDOW * 2);
    expect(attempts).toBe(0);

    clock.noteWrite("user");
    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    clock.noteWrite("agent");
    // Still the person's window, unmoved by the agent write inside it.
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(1);

    clock.stop();
  });

  it("arms nothing when the window is `0`, whatever happens", async () => {
    quiet = 0;
    const clock = scheduler();

    clock.start();
    clock.noteWrite("user");

    expect(clock.armedForMs).toBeNull();
    await vi.advanceTimersByTimeAsync(minutesToMs(60 * 24));
    expect(attempts).toBe(0);

    clock.stop();
  });

  // The window is re-read at the fire, not captured at the arm: turning the
  // automatic path off has to stop the reflection already being waited for.
  it("does not fire a window the operator switched off while it was running", async () => {
    const clock = scheduler();

    clock.noteWrite("user");
    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    quiet = 0;
    await vi.advanceTimersByTimeAsync(1);

    expect(attempts).toBe(0);
    clock.stop();
  });

  it("takes the new window from the config on the next arm", async () => {
    const clock = scheduler();

    quiet = 5;
    clock.noteWrite("user");
    expect(clock.armedForMs).toBe(minutesToMs(5));

    await vi.advanceTimersByTimeAsync(minutesToMs(5));
    expect(attempts).toBe(1);

    clock.stop();
  });

  describe("what one fire leaves behind", () => {
    it("arms nothing more after enqueuing: the next write arms the next window", async () => {
      outcome = "enqueued";
      const clock = scheduler();

      clock.noteWrite("user");
      await vi.advanceTimersByTimeAsync(WINDOW);
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(WINDOW * 3);
      expect(attempts).toBe(1);
      expect(clock.armedForMs).toBeNull();

      clock.stop();
    });

    it("arms nothing when there was nothing to reflect on", async () => {
      outcome = "nothing-to-do";
      const clock = scheduler();

      clock.noteWrite("user");
      await vi.advanceTimersByTimeAsync(WINDOW * 4);

      expect(attempts).toBe(1);
      clock.stop();
    });

    /**
     * A change that arrived while a reflection was running is real work. Dropping
     * it here would leave it unreflected until somebody happened to write again,
     * so the window is armed afresh and the next fire finds the queue free.
     */
    it("waits another whole window when a reflection is already running", async () => {
      outcome = "busy";
      const clock = scheduler();

      clock.noteWrite("user");
      await vi.advanceTimersByTimeAsync(WINDOW);
      expect(attempts).toBe(1);
      expect(clock.armedForMs).toBe(WINDOW);

      await vi.advanceTimersByTimeAsync(WINDOW - 1);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(2);

      clock.stop();
    });
  });

  /**
   * The restart rule: "a server restart with unreflected changes and a quiet
   * corpus enqueues at most one event, after one full window from start (never
   * at the instant of start)". A restart is evidence of nothing about how quiet
   * the corpus is, because the process that knew went away.
   */
  it("waits a full window from `start()`, and enqueues at most one", async () => {
    const clock = scheduler();

    clock.start();
    expect(clock.armedForMs).toBe(WINDOW);

    await vi.advanceTimersByTimeAsync(WINDOW - 1);
    expect(attempts).toBe(0);

    await vi.advanceTimersByTimeAsync(1 + WINDOW * 5);
    expect(attempts).toBe(1);

    clock.stop();
  });

  it("fires nothing once stopped", async () => {
    const clock = scheduler();

    clock.noteWrite("user");
    clock.stop();
    await vi.advanceTimersByTimeAsync(WINDOW * 2);

    expect(attempts).toBe(0);
    expect(clock.armedForMs).toBeNull();
  });

  it("cannot be re-armed after it is stopped", async () => {
    const clock = scheduler();

    clock.stop();
    clock.noteWrite("user");
    clock.start();

    expect(clock.armedForMs).toBeNull();
    await vi.advanceTimersByTimeAsync(WINDOW * 2);
    expect(attempts).toBe(0);
  });

  it("logs a failed enqueue and arms nothing", async () => {
    const lines: string[] = [];
    const clock = createReflectScheduler({
      quietMinutes: () => QUIET,
      attempt: () => Promise.reject(new Error("queue is on fire")),
      logger: {
        level: "info",
        error: (message) => {
          lines.push(message);
        },
        info: () => undefined,
        debug: () => undefined,
      },
    });

    clock.noteWrite("user");
    await vi.advanceTimersByTimeAsync(WINDOW);

    expect(lines.join("\n")).toContain("could not enqueue a reflection");
    expect(clock.armedForMs).toBeNull();
    clock.stop();
  });
});
