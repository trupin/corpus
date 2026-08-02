// The seam itself: what every provider gets for free, and what it may not do
// (sprint-021 TEST-839, TEST-849).

import { describe, expect, it, vi } from "vitest";
import { createEmbeddingProvider, redactSecrets, EmbeddingError } from "./provider.js";

const vector = (dim: number, fill = 0.5): number[] => Array.from({ length: dim }, () => fill);

describe("createEmbeddingProvider", () => {
  /**
   * TEST-839, the load-bearing half: the dimension comes from the response, so a
   * model whose *name* advertises 768 that answers with 384 numbers produces
   * `@384`. A table of dimensions keyed by model name would have produced a
   * confident lie here.
   */
  it("reads the dimension from the first response, not from the model name", async () => {
    const provider = createEmbeddingProvider(
      { provider: "ollama", model: "pretend-embed-768" },
      (texts) => Promise.resolve(texts.map(() => vector(384))),
    );

    expect(provider.identity).toBeNull();
    await provider.embed(["one"]);
    expect(provider.identity).toBe("ollama/pretend-embed-768@384");
  });

  it("keeps the identity stable across batches", async () => {
    const provider = createEmbeddingProvider({ provider: "local", model: "m" }, (texts) =>
      Promise.resolve(texts.map(() => vector(8))),
    );
    await provider.embed(["a"]);
    const first = provider.identity;
    await provider.embed(["b", "c"]);
    expect(provider.identity).toBe(first);
  });

  it("returns vectors in request order, one per input", async () => {
    const provider = createEmbeddingProvider({ provider: "local", model: "m" }, (texts) =>
      Promise.resolve(texts.map((text) => [text.length, 0, 0])),
    );
    const vectors = await provider.embed(["a", "bb", "ccc"]);
    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3]);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it("costs nothing for an empty batch", async () => {
    const embedBatch = vi.fn();
    const provider = createEmbeddingProvider({ provider: "local", model: "m" }, embedBatch);
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("rejects a response that does not answer the request", async () => {
    const provider = createEmbeddingProvider({ provider: "local", model: "m" }, () =>
      Promise.resolve([vector(4)]),
    );
    await expect(provider.embed(["a", "b"])).rejects.toBeInstanceOf(EmbeddingError);
  });

  /**
   * The failure this exists for: an endpoint quietly re-pointed at a different
   * model would otherwise write vectors under an identity claiming they are
   * comparable with the ones already stored.
   */
  it("rejects a dimension change mid-life rather than recording it", async () => {
    let dim = 8;
    const provider = createEmbeddingProvider({ provider: "local", model: "m" }, (texts) =>
      Promise.resolve(texts.map(() => vector(dim))),
    );
    await provider.embed(["a"]);
    dim = 16;
    await expect(provider.embed(["b"])).rejects.toThrow(/dimensional vectors after reporting 8/);
    expect(provider.identity).toBe("local/m@8");
  });

  it("rejects empty and non-finite vectors", async () => {
    const empty = createEmbeddingProvider({ provider: "local", model: "m" }, () =>
      Promise.resolve([[]]),
    );
    await expect(empty.embed(["a"])).rejects.toThrow(/empty vector/);

    const nan = createEmbeddingProvider({ provider: "local", model: "m" }, () =>
      Promise.resolve([[1, Number.NaN, 3]]),
    );
    await expect(nan.embed(["a"])).rejects.toThrow(/non-finite/);
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence of every secret", () => {
    expect(redactSecrets("Bearer sk-123 then sk-123 again", ["sk-123"])).toBe(
      "Bearer *** then *** again",
    );
  });

  it("ignores absent and empty secrets rather than rewriting everything", () => {
    expect(redactSecrets("nothing to hide", [undefined, ""])).toBe("nothing to hide");
  });

  /**
   * PR #17: credentials written into a URL's authority are never in the secret
   * list — an operator puts them in `endpoint`, not in `apiKey` — and the
   * endpoint is quoted verbatim in every error this seam raises.
   */
  it("redacts credentials embedded in a URL's authority", () => {
    expect(redactSecrets("connect ECONNREFUSED https://alice:hunter2@host/v1/embeddings", [])).toBe(
      "connect ECONNREFUSED https://***@host/v1/embeddings",
    );
  });

  it("redacts a bare userinfo token, with no password half", () => {
    expect(redactSecrets("http://sk-live-abc@127.0.0.1:11434/api/embed", [])).toBe(
      "http://***@127.0.0.1:11434/api/embed",
    );
  });

  it("redacts every URL in one string, and any scheme", () => {
    expect(redactSecrets("a https://u:p@x/1 and ftp://u2:p2@y/2 and wss://t@z", [])).toBe(
      "a https://***@x/1 and ftp://***@y/2 and wss://***@z",
    );
  });

  it("leaves ordinary text and credential-free URLs alone", () => {
    for (const text of [
      "https://host/v1/embeddings",
      "mail me at nobody@example.com",
      "ollama endpoint http://127.0.0.1:11434/api/embed answered 404",
      "path/@scope/pkg",
    ]) {
      expect(redactSecrets(text, [])).toBe(text);
    }
  });

  it("still applies the secret list on top of the URL rule", () => {
    expect(redactSecrets("https://u:p@host said sk-1", ["sk-1"])).toBe("https://***@host said ***");
  });
});
