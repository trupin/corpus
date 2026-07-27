import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors.js";
import { ephemeralPort, withListener } from "../../testing/temp.js";
import { claimPort, findFreePort, isPortFree } from "./port.js";

describe("isPortFree", () => {
  it("proves availability by binding, and reports a held port as taken", async () => {
    const port = await ephemeralPort();
    expect(await isPortFree(port)).toBe(true);
    await withListener(port, async () => {
      expect(await isPortFree(port)).toBe(false);
    });
    expect(await isPortFree(port)).toBe(true);
  });
});

describe("findFreePort", () => {
  it("steps upward past a held port", async () => {
    const held = await ephemeralPort();
    await withListener(held, async () => {
      expect(await findFreePort({ start: held })).toBe(held + 1);
    });
  });

  it("returns the starting port when it is free", async () => {
    const port = await ephemeralPort();
    expect(await findFreePort({ start: port })).toBe(port);
  });

  it("gives up with an actionable error rather than scanning forever", async () => {
    await expect(
      findFreePort({ start: 9000, range: 3, isFree: () => Promise.resolve(false) }),
    ).rejects.toThrow(/no free port found between 9000 and 9002/);
  });
});

describe("claimPort", () => {
  it("probes upward from the default when no port was requested", async () => {
    const seen: number[] = [];
    const port = await claimPort(undefined, {
      start: 8790,
      isFree: (candidate) => {
        seen.push(candidate);
        return Promise.resolve(candidate === 8792);
      },
    });
    expect(port).toBe(8792);
    expect(seen).toEqual([8790, 8791, 8792]);
  });

  it("honours an explicit port that is free", async () => {
    const port = await ephemeralPort();
    expect(await claimPort(port)).toBe(port);
  });

  it("refuses an explicit port that is taken, naming it", async () => {
    const port = await ephemeralPort();
    await withListener(port, async () => {
      await expect(claimPort(port)).rejects.toThrow(
        new RegExp(`port ${String(port)} is already in use`),
      );
    });
  });

  it("rejects a value that is not a port number", async () => {
    await expect(claimPort(0)).rejects.toBeInstanceOf(UsageError);
    await expect(claimPort(70000)).rejects.toThrow(/between 1 and 65535/);
    await expect(claimPort(80.5)).rejects.toThrow(/between 1 and 65535/);
  });
});
