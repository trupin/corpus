// Resolution order, stickiness, and the one place where loud beats graceful
// (sprint-021 TEST-840, TEST-843, TEST-845, TEST-846; TEST-841/842/848 in the
// form the 2026-07-31 user ruling leaves them — see the notes on each).
//
// Nothing here touches the network. `fetchFn` is always a stub, and several
// tests assert it was never called at all: after the ruling, the only leg
// allowed to open a socket is a provider an operator configured by hand.

import { describe, expect, it, vi } from "vitest";
import { createStaticEmbeddedEngine, type EmbeddedEngine } from "./embedded-engine.js";
import type { FetchLike } from "./http-provider.js";
import { describeResolution, resolveEmbeddingProvider } from "./resolve.js";
import type { EmbeddingSettings } from "./settings.js";

const CONFIGURED: EmbeddingSettings = {
  kind: "configured",
  provider: { kind: "ollama", endpoint: "http://127.0.0.1:9", model: "nomic-embed-text" },
};

const engineOf = (model: string, dim = 8): EmbeddedEngine =>
  createStaticEmbeddedEngine({
    model,
    embedBatch: (texts) => Promise.resolve(texts.map(() => Array.from({ length: dim }, () => 0.1))),
  });

/** The provider always sends a JSON string body; anything else is a test bug. */
const sentInput = (body: RequestInit["body"]): string[] => {
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return (JSON.parse(body) as { input: string[] }).input;
};

const answering = (dim: number): FetchLike =>
  vi.fn<FetchLike>((_url, init) =>
    Promise.resolve(
      Response.json({
        embeddings: sentInput(init.body).map(() => Array.from({ length: dim }, () => 0.2)),
      }),
    ),
  );

/** Any call is a test failure: used to prove a leg opened no socket. */
const forbiddenFetch = (): FetchLike =>
  vi.fn<FetchLike>(() => {
    throw new Error("the resolution path must not touch the network here");
  });

describe("resolveEmbeddingProvider — order", () => {
  it("prefers a configured provider over an available embedded engine", async () => {
    const engine = engineOf("all-MiniLM-L6-v2");
    const open = vi.spyOn(engine, "open");

    const resolution = await resolveEmbeddingProvider({
      settings: CONFIGURED,
      embeddedEngine: engine,
      fetchFn: answering(768),
    });

    expect(resolution).toMatchObject({
      kind: "provider",
      source: "config",
      identity: "ollama/nomic-embed-text@768",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("uses the embedded engine when nothing is configured", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engineOf("all-MiniLM-L6-v2", 384),
      fetchFn: forbiddenFetch(),
    });

    expect(resolution).toMatchObject({
      kind: "provider",
      source: "embedded",
      identity: "local/all-MiniLM-L6-v2@384",
      sticky: false,
    });
  });

  /**
   * The zero-config default this build ships in: no block, no engine registered
   * (SERVER-048 has not landed). `disabled` is an answer, not a failure.
   */
  it("resolves to disabled when nothing is configured and no engine is registered", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      fetchFn: forbiddenFetch(),
    });

    expect(resolution).toMatchObject({ kind: "disabled", reason: "engine-not-installed" });
    expect(describeResolution(resolution).level).toBe("info");
  });

  /**
   * TEST-842 as the ruling leaves it. The original ("a reachable runtime with
   * only chat models falls through silently") is VOID → OC1-REVISED: there is no
   * runtime to be reachable. What survives is the distinction it was protecting
   * — an engine that is present but cannot serve yet falls through exactly like
   * one that is absent, and says which it was.
   */
  it("falls through silently when the engine's model has not been downloaded", async () => {
    const engine = createStaticEmbeddedEngine({
      model: "all-MiniLM-L6-v2",
      availability: {
        available: false,
        reason: "model-not-downloaded",
        detail: "the embedding model has not been downloaded yet",
      },
      embedBatch: () => Promise.reject(new Error("must not be called")),
    });

    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engine,
      fetchFn: forbiddenFetch(),
    });

    expect(resolution).toMatchObject({ kind: "disabled", reason: "model-not-downloaded" });
    expect(describeResolution(resolution)).toMatchObject({ level: "info" });
  });

  it('reads "provider": "none" as off, distinctly from having nothing', async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "off" },
      embeddedEngine: engineOf("all-MiniLM-L6-v2"),
      fetchFn: forbiddenFetch(),
    });
    expect(resolution).toMatchObject({ kind: "disabled", reason: "off-by-config" });
  });

  it("reports an unusable config block as an error, never as absence", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "invalid", detail: 'does not know the provider "magic"' },
      embeddedEngine: engineOf("all-MiniLM-L6-v2"),
      fetchFn: forbiddenFetch(),
    });

    expect(resolution).toMatchObject({ kind: "error", reason: "invalid-config" });
    expect(describeResolution(resolution).level).toBe("error");
  });

  /**
   * TEST-848's substitute. The "bundled path performs no network access"
   * criterion is VOID → OC1-REVISED (there is no bundled model), but the
   * property it asserted is now stronger and is asserted here: *every* leg but a
   * configured provider runs with `fetch` rigged to throw, and all of them
   * resolve.
   */
  it("never touches the network on any leg but a configured provider", async () => {
    const fetchFn = forbiddenFetch();
    const settings: EmbeddingSettings[] = [
      { kind: "absent" },
      { kind: "off" },
      { kind: "invalid", detail: "x" },
    ];

    for (const one of settings) {
      await expect(
        resolveEmbeddingProvider({
          settings: one,
          embeddedEngine: engineOf("all-MiniLM-L6-v2"),
          fetchFn,
        }),
      ).resolves.toBeDefined();
    }

    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("resolveEmbeddingProvider — a configured provider that fails", () => {
  /**
   * TEST-843. Both halves: the error state is present, *and* no other provider
   * was resolved. A configured choice failing is not the same event as
   * zero-config falling back, and reporting the first as the second is how an
   * operator ends up debugging a model they never chose.
   */
  it("fails loudly and resolves nothing else", async () => {
    const engine = engineOf("all-MiniLM-L6-v2");
    const open = vi.spyOn(engine, "open");
    const availability = vi.spyOn(engine, "availability");
    const refused = vi.fn<FetchLike>(() => Promise.reject(new Error("connect ECONNREFUSED")));

    const resolution = await resolveEmbeddingProvider({
      settings: CONFIGURED,
      embeddedEngine: engine,
      fetchFn: refused,
    });

    expect(resolution).toMatchObject({ kind: "error", reason: "provider-unreachable" });
    const described = describeResolution(resolution);
    expect(described.level).toBe("error");
    expect(described.message).toContain("semantic index unavailable");
    expect(open).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
  });

  it("treats a refused model as a provider failure, not as a reason to re-pick", async () => {
    const notFound = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response('{"error":"model not found"}', { status: 404 })),
    );

    const resolution = await resolveEmbeddingProvider({
      settings: CONFIGURED,
      embeddedEngine: engineOf("all-MiniLM-L6-v2"),
      fetchFn: notFound,
    });

    expect(resolution).toMatchObject({ kind: "error", reason: "provider-unreachable" });
  });

  it("never puts the key in the error state it reports", async () => {
    const echoed = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response("bad key: sk-live-42", { status: 401 })),
    );

    const withKey: EmbeddingSettings = {
      kind: "configured",
      provider: {
        kind: "ollama",
        endpoint: "http://127.0.0.1:9",
        model: "nomic-embed-text",
        apiKey: "sk-live-42",
      },
    };

    const resolution = await resolveEmbeddingProvider({ settings: withKey, fetchFn: echoed });

    expect(JSON.stringify(resolution)).not.toContain("sk-live-42");
    expect(describeResolution(resolution).message).not.toContain("sk-live-42");
  });
});

describe("resolveEmbeddingProvider — stickiness", () => {
  /**
   * TEST-845 / TEST-846's positive case: the index records `local/first@8`, a
   * different model appears on the machine, and the seam declines to adopt it.
   * The vectors stay valid and nothing is queued — §9.1's "never as a surprise
   * background rebuild" in one assertion.
   */
  it("declines a better model that is not the one the index was built with", async () => {
    const engine = engineOf("second");
    const open = vi.spyOn(engine, "open");

    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engine,
      recordedIdentities: ["local/first@8"],
    });

    expect(resolution).toMatchObject({ kind: "disabled", reason: "sticky-model-unavailable" });
    expect(open).not.toHaveBeenCalled();
    // Nothing to load means nothing to compare means nothing to invalidate.
    expect(describeResolution(resolution).level).toBe("info");
  });

  it("keeps using the recorded model when the engine still offers it", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engineOf("first", 8),
      recordedIdentities: ["local/first@8"],
    });

    expect(resolution).toMatchObject({
      kind: "provider",
      source: "embedded",
      identity: "local/first@8",
      sticky: true,
    });
  });

  it("adopts whatever is available when the index is empty", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engineOf("second", 16),
      recordedIdentities: [],
    });

    expect(resolution).toMatchObject({ identity: "local/second@16", sticky: false });
  });

  /** TEST-846's other half: an edit to `.corpus/config.json` is the explicit act. */
  it("lets a config change override the recorded identity", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: CONFIGURED,
      recordedIdentities: ["local/first@8"],
      fetchFn: answering(768),
    });

    expect(resolution).toMatchObject({
      kind: "provider",
      source: "config",
      identity: "ollama/nomic-embed-text@768",
      sticky: false,
    });
  });

  it("does not steer on a mixed index, which is drift rather than a recorded choice", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engineOf("second", 16),
      recordedIdentities: ["local/first@8", "local/third@4"],
    });

    expect(resolution).toMatchObject({ kind: "provider", identity: "local/second@16" });
  });

  it("reports the same model at a new dimension as itself, leaving the check to judge", async () => {
    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engineOf("first", 16),
      recordedIdentities: ["local/first@8"],
    });

    expect(resolution).toMatchObject({ identity: "local/first@16", sticky: true });
  });
});

describe("resolveEmbeddingProvider — an engine that misbehaves", () => {
  it("treats an engine that cannot answer as unavailable, quietly", async () => {
    const engine: EmbeddedEngine = {
      ref: { provider: "local", model: "m" },
      availability: () => Promise.reject(new Error("cache directory unreadable")),
      open: () => Promise.reject(new Error("must not be called")),
    };

    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engine,
    });

    expect(resolution).toMatchObject({ kind: "disabled", reason: "engine-not-installed" });
    expect(describeResolution(resolution).level).toBe("info");
  });

  /** Available-then-broken is a fault in the product's own component: loud. */
  it("reports an engine that claims availability and then fails", async () => {
    const engine: EmbeddedEngine = {
      ref: { provider: "local", model: "m" },
      availability: () => Promise.resolve({ available: true }),
      open: () => Promise.reject(new Error("model file is truncated")),
    };

    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engine,
    });

    expect(resolution).toMatchObject({ kind: "error", reason: "engine-failed" });
    expect(describeResolution(resolution).level).toBe("error");
  });

  it("reports an engine that returns no vector to size", async () => {
    const engine = createStaticEmbeddedEngine({
      model: "m",
      embedBatch: () => Promise.resolve([]),
    });

    const resolution = await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engine,
    });

    expect(resolution).toMatchObject({ kind: "error", reason: "engine-failed" });
  });

  it("passes the shutdown signal down to a loading engine", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const engine = createStaticEmbeddedEngine({
      model: "m",
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 2])),
      onOpen: (options) => seen.push(options?.signal),
    });

    await resolveEmbeddingProvider({
      settings: { kind: "absent" },
      embeddedEngine: engine,
      signal: controller.signal,
    });

    expect(seen).toEqual([controller.signal]);
  });
});
