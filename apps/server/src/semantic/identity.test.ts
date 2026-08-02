// The identity string and the check built on it (sprint-021 TEST-839, TEST-847).
//
// Every assertion here is about *comparison*, never about parsing: the format is
// this server's to write and everyone else's to compare, so the tests pin the
// round trip and the prefix rule rather than any decomposition of the string.

import { describe, expect, it } from "vitest";
import {
  checkIndexIdentity,
  formatIdentity,
  identityNamesModel,
  identityPrefix,
} from "./identity.js";

describe("formatIdentity", () => {
  it("writes provider/model@dim", () => {
    expect(formatIdentity({ provider: "ollama", model: "nomic-embed-text" }, 768)).toBe(
      "ollama/nomic-embed-text@768",
    );
    expect(formatIdentity({ provider: "local", model: "all-MiniLM-L6-v2" }, 384)).toBe(
      "local/all-MiniLM-L6-v2@384",
    );
  });

  it("refuses a dimension a provider cannot have reported", () => {
    expect(() => formatIdentity({ provider: "local", model: "m" }, 0)).toThrow(RangeError);
    expect(() => formatIdentity({ provider: "local", model: "m" }, -1)).toThrow(RangeError);
    expect(() => formatIdentity({ provider: "local", model: "m" }, 1.5)).toThrow(RangeError);
  });

  it("carries the prefix the sticky check compares against", () => {
    const ref = { provider: "ollama", model: "mxbai-embed-large" };
    expect(formatIdentity(ref, 1024).startsWith(identityPrefix(ref))).toBe(true);
  });
});

describe("identityNamesModel", () => {
  // The reason this is prefix comparison and not a parser: model names in the
  // wild carry `/`, `:` and `@`, and a split on any of them picks the wrong half.
  it.each([
    ["ollama/nomic-embed-text@768", { provider: "ollama", model: "nomic-embed-text" }, true],
    ["ollama/nomic-embed-text@768", { provider: "ollama", model: "nomic-embed" }, false],
    ["ollama/nomic-embed-text@768", { provider: "local", model: "nomic-embed-text" }, false],
    ["ollama/hf.co/user/repo:q8@1024", { provider: "ollama", model: "hf.co/user/repo:q8" }, true],
    ["local/model@sha256:abc@384", { provider: "local", model: "model@sha256:abc" }, true],
    ["local/model@384", { provider: "local", model: "model@384" }, false],
  ])("%s vs %o → %s", (identity, ref, expected) => {
    expect(identityNamesModel(identity, ref)).toBe(expected);
  });
});

describe("checkIndexIdentity", () => {
  it("reports no-index when nothing has been embedded", () => {
    expect(checkIndexIdentity([], "local/m@384")).toEqual({ kind: "no-index" });
    expect(checkIndexIdentity([], null)).toEqual({ kind: "no-index" });
  });

  it("reports a match when the index and the resolved provider agree", () => {
    expect(checkIndexIdentity(["local/m@384"], "local/m@384")).toEqual({
      kind: "match",
      identity: "local/m@384",
    });
  });

  /**
   * TEST-847: the check *reports*. It returns a value and touches nothing —
   * queueing the rebuild is SERVER-044's, rendering it is SERVER-046's.
   */
  it("reports a mismatch without acting on it", () => {
    expect(checkIndexIdentity(["local/m@384"], "ollama/n@768")).toEqual({
      kind: "mismatch",
      recorded: "local/m@384",
      resolved: "ollama/n@768",
    });
  });

  it("distinguishes a dimension change from a model change", () => {
    // Same provider and model, different dimension: the model behind the name
    // changed, and the vectors are as incomparable as if the name had.
    expect(checkIndexIdentity(["local/m@384"], "local/m@768")).toMatchObject({ kind: "mismatch" });
  });

  it("reports unresolved when an index exists and nothing can embed", () => {
    expect(checkIndexIdentity(["local/m@384"], null)).toEqual({
      kind: "unresolved",
      recorded: "local/m@384",
    });
  });

  it("reports mixed ahead of mismatch, because two identities is drift", () => {
    expect(checkIndexIdentity(["a/m@3", "b/m@3"], "a/m@3")).toEqual({
      kind: "mixed",
      identities: ["a/m@3", "b/m@3"],
    });
    expect(checkIndexIdentity(["a/m@3", "b/m@3"], null)).toMatchObject({ kind: "mixed" });
  });
});
