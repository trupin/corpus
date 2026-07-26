/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthQueryKey, useHealth } from "./useHealth";

const HEALTH_BODY = {
  status: "ok",
  version: "0.0.0",
  uptimeSeconds: 12.5,
  workspace: "/tmp/corpus-workspace",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function wrapper(client: QueryClient): (props: { children: ReactNode }) => ReactElement {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("useHealth", () => {
  it("uses a stable query key so the SSE bridge can invalidate it", () => {
    expect(healthQueryKey).toEqual(["health"]);
  });

  it("requests /api/health on the current origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(HEALTH_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useHealth(), { wrapper: wrapper(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(HEALTH_BODY);
    const request: unknown = fetchMock.mock.calls[0]?.[0];
    const url = request instanceof Request ? request.url : String(request);
    expect(url).toBe(`${window.location.origin}/api/health`);
  });

  it("surfaces a non-2xx response as an error carrying the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "internal" } }, 500)),
    );

    const { result } = renderHook(() => useHealth(), { wrapper: wrapper(client) });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("500");
  });

  it("treats an empty success body as a failed probe", async () => {
    // A 204 leaves openapi-fetch with neither data nor an error payload — the
    // server answered, but not with a health document.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const { result } = renderHook(() => useHealth(), { wrapper: wrapper(client) });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("204");
    expect(result.current.error?.message).toContain("null");
  });

  it("surfaces a transport failure as an error rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { result } = renderHook(() => useHealth(), { wrapper: wrapper(client) });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain("Failed to fetch");
  });
});
