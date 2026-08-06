import { describe, expect, it } from "vitest";
import {
  abortOnInterrupt,
  delay,
  onInterrupt,
  INTERRUPT_SIGNALS,
  type InterruptSignal,
  type SignalTarget,
} from "./signals.js";

/** A stand-in for `process` that lets a test count what is still installed. */
function recordingTarget(): SignalTarget & { readonly listeners: Map<string, Set<() => void>> } {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    on(signal: InterruptSignal, listener: () => void) {
      const set = listeners.get(signal) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(signal, set);
    },
    off(signal: InterruptSignal, listener: () => void) {
      listeners.get(signal)?.delete(listener);
    },
  };
}

function installed(target: ReturnType<typeof recordingTarget>): number {
  return [...target.listeners.values()].reduce((total, set) => total + set.size, 0);
}

describe("abortOnInterrupt", () => {
  it("aborts the controller on every interrupt signal", () => {
    for (const signal of INTERRUPT_SIGNALS) {
      const target = recordingTarget();
      const controller = new AbortController();
      abortOnInterrupt(controller, target);

      for (const listener of target.listeners.get(signal) ?? []) listener();
      expect(controller.signal.aborted).toBe(true);
    }
  });

  it("removes every handler it installed, and only once", () => {
    const target = recordingTarget();
    const dispose = abortOnInterrupt(new AbortController(), target);

    expect(installed(target)).toBe(INTERRUPT_SIGNALS.length);
    dispose();
    expect(installed(target)).toBe(0);
    // A second call is a no-op rather than an error: commands dispose in a
    // `finally` that may run after an early return already did.
    dispose();
    expect(installed(target)).toBe(0);
  });
});

describe("onInterrupt", () => {
  function fire(target: ReturnType<typeof recordingTarget>, signal: InterruptSignal): void {
    for (const listener of [...(target.listeners.get(signal) ?? [])]) listener();
  }

  it.each(INTERRUPT_SIGNALS)("tells the handler which signal arrived (%s)", (signal) => {
    const target = recordingTarget();
    const seen: InterruptSignal[] = [];
    onInterrupt((received) => seen.push(received), target);

    fire(target, signal);
    expect(seen).toEqual([signal]);
  });

  it("runs once and then gets out of the way, so a second interrupt is Node's default", () => {
    // The escape hatch: `corpus upgrade` gets one chance to put the server back,
    // and an operator hammering Ctrl-C is never trapped inside it (CLI-030).
    const target = recordingTarget();
    let calls = 0;
    onInterrupt(() => {
      calls += 1;
    }, target);

    fire(target, "SIGINT");
    expect(calls).toBe(1);
    expect(installed(target)).toBe(0);

    // Nothing is listening any more, so the second signal reaches no handler at
    // all — which is exactly how the process gets killed instead.
    fire(target, "SIGINT");
    fire(target, "SIGTERM");
    expect(calls).toBe(1);
  });

  it("installs one handler per signal and removes them all, idempotently", () => {
    const target = recordingTarget();
    const dispose = onInterrupt(() => undefined, target);

    expect(installed(target)).toBe(INTERRUPT_SIGNALS.length);
    dispose();
    dispose();
    expect(installed(target)).toBe(0);
  });

  it("does not run the handler after it has been disposed", () => {
    // Node hands a listener the signal it already queued, so a handler can be
    // invoked after its own `finally` removed it. Holding the reference is how
    // that race is reproduced deterministically.
    const target = recordingTarget();
    let calls = 0;
    const dispose = onInterrupt(() => {
      calls += 1;
    }, target);
    const [stale] = [...(target.listeners.get("SIGINT") ?? [])];

    dispose();
    stale?.();
    expect(calls).toBe(0);
  });
});

describe("delay", () => {
  it("resolves after the delay when nothing interrupts it", async () => {
    const started = Date.now();
    await delay(20, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const started = Date.now();
    await delay(10_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("resolves early when the signal aborts during the wait", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const started = Date.now();
    await delay(10_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
