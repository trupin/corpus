import { describe, expect, it, vi } from "vitest";
import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import { DEFAULT_POLL_INTERVAL_MS, WaiterRegistry } from "./waiters.js";

const never = (): Promise<boolean> => Promise.resolve(false);

/** The lane every pre-lane test parked on, spelled once. */
const ANY: Lane = ORCHESTRATOR_LANE;
const OTHER: Lane = "th_resident";

/** "Everyone", for the tests that predate lanes and are not about them. */
const everyone = (): boolean => true;

describe("WaiterRegistry", () => {
  it("parks until notified, and leaves nothing behind", async () => {
    const registry = new WaiterRegistry({ probe: never });
    const parked = registry.wait(ANY, 5_000);
    await vi.waitFor(() => {
      expect(registry.size).toBe(1);
    });

    registry.notify(everyone);
    expect(await parked).toBe("woke");
    expect(registry.size).toBe(0);
  });

  it("expires when the window elapses", async () => {
    const registry = new WaiterRegistry({ probe: never });
    expect(await registry.wait(ANY, 20)).toBe("expired");
    expect(registry.size).toBe(0);
  });

  it("refuses to park at all for a non-positive window", async () => {
    const registry = new WaiterRegistry({ probe: never });
    expect(await registry.wait(ANY, 0)).toBe("expired");
    expect(registry.size).toBe(0);
  });

  it("releases a dropped client and removes its waiter", async () => {
    const registry = new WaiterRegistry({ probe: never });
    const controller = new AbortController();
    const parked = registry.wait(ANY, 5_000, controller.signal);
    await vi.waitFor(() => {
      expect(registry.size).toBe(1);
    });

    controller.abort();
    expect(await parked).toBe("expired");
    expect(registry.size).toBe(0);
  });

  it("does not park a client that is already gone", async () => {
    const registry = new WaiterRegistry({ probe: never });
    expect(await registry.wait(ANY, 5_000, AbortSignal.abort())).toBe("expired");
    expect(registry.size).toBe(0);
  });

  it("wakes on the poll fallback, so an out-of-band event counts", async () => {
    let available = false;
    const registry = new WaiterRegistry({
      probe: () => Promise.resolve(available),
      pollIntervalMs: 5,
    });

    const parked = registry.wait(ANY, 5_000);
    available = true;
    expect(await parked).toBe("woke");
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

    expect(await registry.wait(ANY, 5_000)).toBe("woke");
    expect(onProbeError).toHaveBeenCalled();
  });

  it("releases everyone as expired on close, and refuses to park afterwards", async () => {
    const registry = new WaiterRegistry({ probe: never });
    const parked = registry.wait(ANY, 5_000);
    await vi.waitFor(() => {
      expect(registry.size).toBe(1);
    });

    registry.close();
    expect(await parked).toBe("expired");
    expect(await registry.wait(ANY, 5_000)).toBe("expired");
    expect(registry.size).toBe(0);
  });

  // SPEC.md §7 (SERVER-111): parking takes a lane, and a wake-up concerns some
  // lanes and not others.
  describe("lanes", () => {
    it("wakes only the waiters the notification reaches", async () => {
      const registry = new WaiterRegistry({ probe: never });
      const resident = registry.wait(OTHER, 5_000);
      const orchestrator = registry.wait(ANY, 5_000);
      await vi.waitFor(() => {
        expect(registry.size).toBe(2);
      });

      registry.notify((scope) => scope === OTHER);
      expect(await resident).toBe("woke");
      // Still parked: the other lane's arrival is not this one's business.
      expect(registry.size).toBe(1);
      registry.notify(everyone);
      expect(await orchestrator).toBe("woke");
    });

    it("probes each parked lane and wakes it on its own answer", async () => {
      const asked: Lane[] = [];
      const registry = new WaiterRegistry({
        probe: (scope) => {
          asked.push(scope);
          return Promise.resolve(scope === OTHER);
        },
        pollIntervalMs: 5,
      });

      const resident = registry.wait(OTHER, 5_000);
      const orchestrator = registry.wait(ANY, 200);
      expect(await resident).toBe("woke");
      // The orchestrator's window expires rather than being woken by the other
      // lane's pending work.
      expect(await orchestrator).toBe("expired");
      expect(new Set(asked)).toEqual(new Set([OTHER, ANY]));
    });

    /**
     * SERVER-128. The eviction is a *different outcome* from a wake, not a
     * louder one: the whole point is that the caller can tell "nothing yet" from
     * "nothing ever" and stop re-parking.
     */
    describe("eviction", () => {
      it("settles the lane's waiters as evicted and leaves the others parked", async () => {
        const registry = new WaiterRegistry({ probe: never });
        const resident = registry.wait(OTHER, 5_000);
        const orchestrator = registry.wait(ANY, 5_000);
        await vi.waitFor(() => {
          expect(registry.size).toBe(2);
        });

        expect(registry.evict((scope) => scope === OTHER)).toBe(1);
        expect(await resident).toBe("evicted");
        expect(registry.size).toBe(1);

        registry.notify(everyone);
        expect(await orchestrator).toBe("woke");
      });

      it("evicts every waiter on the lane, and reports how many", async () => {
        const registry = new WaiterRegistry({ probe: never });
        const both = [registry.wait(OTHER, 5_000), registry.wait(OTHER, 5_000)];
        await vi.waitFor(() => {
          expect(registry.size).toBe(2);
        });

        expect(registry.evict((scope) => scope === OTHER)).toBe(2);
        expect(await Promise.all(both)).toEqual(["evicted", "evicted"]);
        expect(registry.size).toBe(0);
      });

      it("evicts nobody when nothing is parked on the lane", () => {
        const registry = new WaiterRegistry({ probe: never });
        expect(registry.evict((scope) => scope === OTHER)).toBe(0);
      });
    });

    it("reports the distinct lanes something is parked on", async () => {
      const registry = new WaiterRegistry({ probe: never });
      void registry.wait(OTHER, 5_000);
      void registry.wait(OTHER, 5_000);
      void registry.wait(ANY, 5_000);
      await vi.waitFor(() => {
        expect(registry.size).toBe(3);
      });

      expect(new Set(registry.parkedLanes)).toEqual(new Set([OTHER, ANY]));
      registry.close();
    });
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

    expect(await registry.wait(ANY, 60)).toBe("expired");
    expect(overlapped).toBe(false);
  });
});
