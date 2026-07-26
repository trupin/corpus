/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiClient, uiClient } from "./apiClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createUiClient", () => {
  it("defaults to the page's own origin, which the dev proxy makes the server", () => {
    expect(createUiClient().baseUrl).toBe(window.location.origin);
  });

  it("accepts an explicit base URL", () => {
    expect(createUiClient({ baseUrl: "http://127.0.0.1:8765" }).baseUrl).toBe(
      "http://127.0.0.1:8765",
    );
  });

  it("late-binds globalThis.fetch so the transport can be replaced after import", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uiClient.api.GET("/api/health", {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses an injected transport when given one", async () => {
    const injected = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await createUiClient({ fetch: injected }).api.GET("/api/health", {});
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it("opens the SSE stream against the same origin", () => {
    const client = createUiClient({ baseUrl: "http://127.0.0.1:8765" });
    expect(typeof client.connectEvents).toBe("function");
  });
});
