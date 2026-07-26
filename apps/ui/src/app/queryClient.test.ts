import { describe, expect, it } from "vitest";
import { appQueryClient, createQueryClient } from "./queryClient";

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
    expect(defaults?.retry).toBe(1);
  });

  it("exposes a single app-wide instance", () => {
    expect(appQueryClient.getDefaultOptions().queries?.staleTime).toBe(Number.POSITIVE_INFINITY);
  });
});
