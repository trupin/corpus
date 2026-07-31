// The engine contract SERVER-048 implements, exercised through its reference
// implementation (sprint-021 TEST-840's second leg).

import { describe, expect, it } from "vitest";
import { EMBEDDED_PROVIDER, createStaticEmbeddedEngine } from "./embedded-engine.js";

describe("createStaticEmbeddedEngine", () => {
  it("names itself under the local provider token, so identities are comparable", async () => {
    const engine = createStaticEmbeddedEngine({
      model: "all-MiniLM-L6-v2",
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 2, 3])),
    });

    expect(engine.ref).toEqual({ provider: EMBEDDED_PROVIDER, model: "all-MiniLM-L6-v2" });
    await expect(engine.availability()).resolves.toEqual({ available: true });

    const provider = await engine.open();
    await provider.embed(["x"]);
    expect(provider.identity).toBe("local/all-MiniLM-L6-v2@3");
  });

  it("refuses to open when it has already said it cannot serve", async () => {
    const engine = createStaticEmbeddedEngine({
      model: "m",
      availability: {
        available: false,
        reason: "unsupported-platform",
        detail: "no build of the engine exists for this platform",
      },
      embedBatch: () => Promise.reject(new Error("must not be called")),
    });

    await expect(engine.availability()).resolves.toMatchObject({
      available: false,
      reason: "unsupported-platform",
    });
    await expect(engine.open()).rejects.toThrow(/unavailable: unsupported-platform/);
  });
});
