import { CorpusRequestError } from "@corpus/kit";
import { describe, expect, it } from "vitest";
import { appQueryClient, createQueryClient } from "./queryClient";

function retryDecision(retry: unknown, failureCount: number, error: Error): boolean {
  return typeof retry === "function"
    ? (retry as (count: number, error: Error) => boolean)(failureCount, error)
    : false;
}

describe("createQueryClient", () => {
  const defaults = createQueryClient().getDefaultOptions().queries;

  it("never expires data on its own — SSE invalidation is the only authority", () => {
    expect(defaults?.staleTime).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not refetch on window focus or reconnect", () => {
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.refetchOnReconnect).toBe(false);
  });

  it("does not poll in the background", () => {
    expect(defaults?.refetchInterval).toBeUndefined();
  });

  it("retries once so a server restart does not surface as an outage", () => {
    expect(retryDecision(defaults?.retry, 0, new Error("socket hang up"))).toBe(true);
    expect(retryDecision(defaults?.retry, 1, new Error("socket hang up"))).toBe(false);
  });

  /**
   * A `404` is a normal answer for an unresolved `[[ref]]` (SPEC.md §5), and a
   * refusal the server already decided is not made truer by asking twice.
   */
  it("never retries a client error", () => {
    const notFound = new CorpusRequestError("GET /api/docs/{id}", 404, {
      code: "not_found",
      message: "no such document",
    });
    expect(retryDecision(defaults?.retry, 0, notFound)).toBe(false);

    const serverError = new CorpusRequestError("GET /api/docs/{id}", 503, {
      code: "internal",
      message: "restarting",
    });
    expect(retryDecision(defaults?.retry, 0, serverError)).toBe(true);
  });

  it("exposes a single app-wide instance", () => {
    expect(appQueryClient.getDefaultOptions().queries?.staleTime).toBe(Number.POSITIVE_INFINITY);
  });
});
