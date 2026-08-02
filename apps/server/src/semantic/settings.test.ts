// The `embedding` block: permissive at parse, judged at boot (sprint-021 TEST-850).

import { describe, expect, it } from "vitest";
import { EmbeddingConfigSchema, resolveEmbeddingSettings } from "./settings.js";

const CONFIG_PATH = "/ws/.corpus/config.json";

describe("EmbeddingConfigSchema", () => {
  it("parses a minimal block and passes unknown keys through", () => {
    const parsed = EmbeddingConfigSchema.parse({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
      futureKey: 12,
    });
    expect(parsed.provider).toBe("ollama");
  });

  /**
   * The reason every field but `provider` is optional: `.corpus/config.json` is
   * read by more than this server, and a block a newer build wrote must not make
   * the file unreadable to an older one. Refusal happens at boot instead.
   */
  it("accepts a block this build cannot serve rather than failing the file", () => {
    expect(EmbeddingConfigSchema.safeParse({ provider: "some-future-thing" }).success).toBe(true);
    expect(EmbeddingConfigSchema.safeParse({ provider: "openai" }).success).toBe(true);
  });

  it("still refuses a block with no provider at all", () => {
    expect(EmbeddingConfigSchema.safeParse({ endpoint: "http://x" }).success).toBe(false);
    expect(EmbeddingConfigSchema.safeParse({ provider: "" }).success).toBe(false);
  });
});

describe("resolveEmbeddingSettings", () => {
  it("treats an absent block as the zero-config case, with no warning", () => {
    expect(resolveEmbeddingSettings(undefined, CONFIG_PATH)).toEqual({
      settings: { kind: "absent" },
    });
  });

  it('reads "none" as an operator turning it off, not as a problem', () => {
    expect(resolveEmbeddingSettings({ provider: "none" }, CONFIG_PATH)).toEqual({
      settings: { kind: "off" },
    });
  });

  it("accepts a complete configured provider", () => {
    const result = resolveEmbeddingSettings(
      {
        provider: "openai",
        endpoint: "https://api.example.com/v1",
        model: "text-embedding-3-small",
        apiKey: "sk-live-1",
      },
      CONFIG_PATH,
    );
    expect(result.warning).toBeUndefined();
    expect(result.settings).toEqual({
      kind: "configured",
      provider: {
        kind: "openai",
        endpoint: "https://api.example.com/v1",
        model: "text-embedding-3-small",
        apiKey: "sk-live-1",
      },
    });
  });

  it.each([
    [
      "an unknown provider",
      { provider: "magic-embed" },
      /does not know the provider "magic-embed"/,
    ],
    ["no endpoint", { provider: "ollama", model: "m" }, /needs an "endpoint"/],
    [
      "an endpoint that is not http",
      { provider: "ollama", endpoint: "ftp://host/x", model: "m" },
      /must be an http\(s\) URL/,
    ],
    [
      "an endpoint that is not a URL",
      { provider: "ollama", endpoint: "127.0.0.1:11434", model: "m" },
      /must be an http\(s\) URL/,
    ],
    ["no model", { provider: "openai", endpoint: "https://api.example.com" }, /needs a "model"/],
    [
      "a blank model",
      { provider: "openai", endpoint: "https://api.example.com", model: "   " },
      /needs a "model"/,
    ],
  ])("refuses %s at boot, non-fatally, naming the file", (_label, raw, expected) => {
    const result = resolveEmbeddingSettings(raw, CONFIG_PATH);
    expect(result.settings.kind).toBe("invalid");
    expect(result.warning).toMatch(expected);
    expect(result.warning).toContain(CONFIG_PATH);
    // Loud, but never fatal: a document server serves documents whether or not
    // anything can embed them.
    expect(result.warning).toMatch(/search stays lexical/);
  });

  it("never puts the key in the warning it produces", () => {
    const result = resolveEmbeddingSettings(
      { provider: "wrong", endpoint: "https://api.example.com", model: "m", apiKey: "sk-live-2" },
      CONFIG_PATH,
    );
    expect(result.warning).not.toContain("sk-live-2");
  });

  it("drops a blank key rather than sending an empty bearer token", () => {
    const result = resolveEmbeddingSettings(
      { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "m", apiKey: "  " },
      CONFIG_PATH,
    );
    expect(result.settings).toEqual({
      kind: "configured",
      provider: { kind: "ollama", endpoint: "http://127.0.0.1:11434", model: "m" },
    });
  });
});
