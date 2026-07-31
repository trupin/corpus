// The configured-provider path: the one leg of resolution that opens a socket
// (sprint-021 TEST-843's mechanism, TEST-849's redaction).

import { describe, expect, it, vi } from "vitest";
import { createConfiguredProvider, embedUrl, type FetchLike } from "./http-provider.js";
import { EmbeddingError } from "./provider.js";
import type { ConfiguredEmbeddingProvider } from "./settings.js";

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const ollama: ConfiguredEmbeddingProvider = {
  kind: "ollama",
  endpoint: "http://127.0.0.1:11434",
  model: "nomic-embed-text",
};

describe("embedUrl", () => {
  it.each([
    ["ollama" as const, "http://host:1", "http://host:1/api/embed"],
    ["ollama" as const, "http://host:1/", "http://host:1/api/embed"],
    ["ollama" as const, "http://host:1/api/embed", "http://host:1/api/embed"],
    ["openai" as const, "https://api.example.com", "https://api.example.com/v1/embeddings"],
    ["openai" as const, "https://api.example.com/v1", "https://api.example.com/v1/embeddings"],
    ["openai" as const, "https://api.example.com/v1/", "https://api.example.com/v1/embeddings"],
    [
      "openai" as const,
      "https://gateway.example.com/embeddings",
      "https://gateway.example.com/embeddings",
    ],
  ])("%s + %s → %s", (kind, endpoint, expected) => {
    expect(embedUrl(kind, endpoint)).toBe(expected);
  });
});

describe("createConfiguredProvider", () => {
  it("speaks the ollama shape and reads the dimension off the answer", async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(json({ embeddings: [[1, 2, 3]] })));
    const provider = createConfiguredProvider(ollama, { fetchFn });

    const vectors = await provider.embed(["hello"]);

    expect(vectors[0]).toEqual(Float32Array.from([1, 2, 3]));
    expect(provider.identity).toBe("ollama/nomic-embed-text@3");
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    const body = init?.body;
    expect(url).toBe("http://127.0.0.1:11434/api/embed");
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "")).toEqual({
      model: "nomic-embed-text",
      input: ["hello"],
    });
  });

  it("speaks the openai shape and restores the order `index` declares", async () => {
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.resolve(
        json({
          data: [
            { index: 1, embedding: [9, 9] },
            { index: 0, embedding: [1, 1] },
          ],
        }),
      ),
    );
    const provider = createConfiguredProvider(
      { kind: "openai", endpoint: "https://api.example.com/v1", model: "text-embedding-3-small" },
      { fetchFn },
    );

    const vectors = await provider.embed(["first", "second"]);

    expect(Array.from(vectors[0] ?? [])).toEqual([1, 1]);
    expect(Array.from(vectors[1] ?? [])).toEqual([9, 9]);
  });

  it("sends the key as a bearer token, and sends no header without one", async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(json({ embeddings: [[1]] })));

    await createConfiguredProvider({ ...ollama, apiKey: "sk-secret" }, { fetchFn }).embed(["x"]);
    await createConfiguredProvider(ollama, { fetchFn }).embed(["x"]);

    const withKey = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const without = fetchFn.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(withKey["authorization"]).toBe("Bearer sk-secret");
    expect(without["authorization"]).toBeUndefined();
  });

  it("turns a refused connection into a provider error naming the endpoint", async () => {
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.reject(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })),
    );
    const provider = createConfiguredProvider(ollama, { fetchFn });

    await expect(provider.embed(["x"])).rejects.toBeInstanceOf(EmbeddingError);
    await expect(provider.embed(["x"])).rejects.toThrow(
      /http:\/\/127\.0\.0\.1:11434\/api\/embed is unreachable/,
    );
  });

  /**
   * Ollama's "model … not found, try pulling it first" arrives exactly here. It
   * is a provider failure like any other — the seam never re-resolves behind an
   * operator's back on the strength of one 404.
   */
  it("reports a non-2xx with its status and a bounded snippet of the body", async () => {
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.resolve(
        new Response('{"error":"model \\"nope\\" not found, try pulling it first"}', {
          status: 404,
        }),
      ),
    );
    await expect(createConfiguredProvider(ollama, { fetchFn }).embed(["x"])).rejects.toThrow(
      /answered 404: .*not found, try pulling it first/,
    );
  });

  it("never lets the key reach the error message, however the endpoint echoes it", async () => {
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response("invalid credentials: Bearer sk-live-9999", { status: 401 })),
    );
    const provider = createConfiguredProvider({ ...ollama, apiKey: "sk-live-9999" }, { fetchFn });

    const error = await provider.embed(["x"]).catch((thrown: unknown) => thrown);

    expect(String(error)).not.toContain("sk-live-9999");
    expect(String(error)).toContain("***");
  });

  it("rejects a 200 that is not vectors", async () => {
    const html = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response("<html>proxy error</html>", { status: 200 })),
    );
    await expect(createConfiguredProvider(ollama, { fetchFn: html }).embed(["x"])).rejects.toThrow(
      /invalid JSON/,
    );

    const wrongShape = vi.fn<FetchLike>(() => Promise.resolve(json({ embedding: [1, 2] })));
    await expect(
      createConfiguredProvider(ollama, { fetchFn: wrongShape }).embed(["x"]),
    ).rejects.toThrow(/did not carry an `embeddings` array/);
  });

  it("gives up on a black hole instead of hanging the caller", async () => {
    const fetchFn = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("This operation was aborted"));
          });
        }),
    );
    const provider = createConfiguredProvider(ollama, { fetchFn, timeoutMs: 5 });

    await expect(provider.embed(["x"])).rejects.toThrow(/unreachable/);
  });

  it("abandons an in-flight batch when the server shuts down", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const pending = createConfiguredProvider(ollama, {
      fetchFn,
      signal: controller.signal,
    }).embed(["x"]);

    controller.abort();

    await expect(pending).rejects.toThrow(/unreachable/);
  });
});
