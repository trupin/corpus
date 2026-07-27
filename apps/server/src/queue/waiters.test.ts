import { describe, expect, it, vi } from "vitest";
import { DEFAULT_POLL_INTERVAL_MS, WaiterRegistry } from "./waiters.js";

const never = (): Promise<boolean> => Promise.resolve(false);

describe("WaiterRegistry", () => {
  it("parks until notified, and leaves nothing behind", async () => {
    const registry = new WaiterRegistry({ probe: never });
    const parked = registry.wait(5_000);
    await vi.waitFor(() => {
      expect(registry.size).toBe(1);
    });

    registry.notify();
    expect(await parked).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("expires with false when the window elapses", async () => {
    const registry = new WaiterRegistry({ probe: never });
    expect(await registry.wait(20)).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("refuses to park at all for a non-positive window", async () => {
    const registry = new WaiterRegistry({ probe: never });
    expect(await registry.wait(0)).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("releases a dropped client and removes its waiter", async () => {
    const registry = new WaiterRegistry({ probe: never });
    const controller = new AbortController();
    const parked = registry.wait(5_000, controller.signal);
    await vi.waitFor(() => {
      expect(registry.size).toBe(1);
    });

    controller.abort();
    expect(await parked).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("does not park a client that is already gone", async () => {
    const registry = new WaiterRegistry({ probe: never });
    expect(await registry.wait(5_000, AbortSignal.abort())).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("wakes on the poll fallback, so an out-of-band event counts", async () => {
    let available = false;
    const registry = new WaiterRegistry({
      probe: () => Promise.resolve(available),
      pollIntervalMs: 5,
    });

    const parked = registry.wait(5_000);
    available = true;
    expect(await parked).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("keeps polling after a failing probe", async () => {
    const onProbeError = vi.fn();
    let calls = 0;
    const registry = new WaiterRegistry({
      probe: () => {
        calls += 1;
        return calls < 3 ? Promise.reject(new Error("readdir exploded")) : Promise.resolve(true);
      },
      pollIntervalMs: 5,
      onProbeError,
    });

    expect(await registry.wait(5_000)).toBe(true);
    expect(onProbeError).toHaveBeenCalled();
  });

  it("releases everyone as expired on close, and refuses to park afterwards", async () => {
    const registry = new WaiterRegistry({ probe: never });
    const parked = registry.wait(5_000);
    await vi.waitFor(() => {
      expect(registry.size).toBe(1);
    });

    registry.close();
    expect(await parked).toBe(false);
    expect(await registry.wait(5_000)).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("polls twice a second by default", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(500);
  });

  it("runs one probe at a time, however slow it is", async () => {
    let inFlight = 0;
    let overlapped = false;
    const registry = new WaiterRegistry({
      probe: async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return false;
      },
      pollIntervalMs: 1,
    });

    expect(await registry.wait(60)).toBe(false);
    expect(overlapped).toBe(false);
  });
});
