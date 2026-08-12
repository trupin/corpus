import { describe, expect, it } from "vitest";
import { CorpusRequestError } from "./createCorpusClient.js";
import { createCorpusQueryClient, isClientError } from "./queryClient.js";

describe("isClientError", () => {
  it("is true only for a refusal the server already decided", () => {
    const of = (status: number): CorpusRequestError =>
      new CorpusRequestError("GET /api/docs/{id}", status, {
        code: "not_found",
        message: "no such document",
      });
    expect(isClientError(of(404))).toBe(true);
    expect(isClientError(of(403))).toBe(true);
    expect(isClientError(of(409))).toBe(true);
    expect(isClientError(of(500))).toBe(false);
    expect(isClientError(of(503))).toBe(false);
    // A transport failure is not an answer at all.
    expect(isClientError(new Error("socket hang up"))).toBe(false);
    expect(isClientError(undefined)).toBe(false);
  });
});

describe("createCorpusQueryClient", () => {
  const defaults = createCorpusQueryClient().getDefaultOptions().queries;

  it("lets SSE invalidation be the only authority on freshness", () => {
    expect(defaults?.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.refetchOnReconnect).toBe(false);
  });

  it("retries a transient failure once, and a client error never", () => {
    const decide = defaults?.retry as (count: number, error: Error) => boolean;
    const notFound = new CorpusRequestError("GET /api/docs/{id}", 404, {
      code: "not_found",
      message: "no such document",
    });
    expect(decide(0, new Error("socket hang up"))).toBe(true);
    expect(decide(1, new Error("socket hang up"))).toBe(false);
    // An unresolved `[[ref]]` is legitimate (SPEC.md §5) and must not cost two
    // requests and two console entries per occurrence.
    expect(decide(0, notFound)).toBe(false);
  });
});
