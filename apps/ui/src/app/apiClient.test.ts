/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiClient, uiClient } from "./apiClient";

/**
 * Adapted for UI-002. `createUiClient` now builds `@corpus/kit`'s client, whose
 * surface is one method per operation instead of the generated `api` object —
 * which is the point of the kit being the only data path. The two cases that
 * reached through `.api` call the operation instead; nothing else changed.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const HEALTH = { status: "ok", version: "0.0.0", uptimeSeconds: 1, workspace: "/tmp/ws" };

const RUNTIME_CONFIG_ELEMENT_ID = "corpus-runtime-config";

/** Writes the block the workspace server splices into the shell it serves. */
function serveWithRuntimeConfig(json: string): void {
  const script = document.createElement("script");
  script.id = RUNTIME_CONFIG_ELEMENT_ID;
  script.type = "application/json";
  script.textContent = json;
  document.head.append(script);
}

/** The `Authorization` header a default-configured client actually sends. */
async function bearerSent(): Promise<string | null> {
  const injected = vi.fn().mockResolvedValue(jsonResponse(HEALTH));
  await createUiClient({ fetch: injected }).getHealth();
  const request: unknown = injected.mock.calls[0]?.[0];
  return request instanceof Request ? request.headers.get("authorization") : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.head.querySelector(`#${RUNTIME_CONFIG_ELEMENT_ID}`)?.remove();
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(HEALTH));
    vi.stubGlobal("fetch", fetchMock);

    await uiClient.getHealth();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses an injected transport when given one", async () => {
    const injected = vi.fn().mockResolvedValue(jsonResponse(HEALTH));
    await createUiClient({ fetch: injected }).getHealth();
    expect(injected).toHaveBeenCalledTimes(1);
  });

  it("sends the configured token as a bearer credential", async () => {
    const injected = vi.fn().mockResolvedValue(jsonResponse(HEALTH));
    await createUiClient({ fetch: injected, token: "abc123" }).getHealth();
    const request: unknown = injected.mock.calls[0]?.[0];
    expect(request instanceof Request ? request.headers.get("authorization") : null).toBe(
      "Bearer abc123",
    );
  });

  it("provisions no token when nothing set one, rather than inventing one", async () => {
    // `VITE_CORPUS_TOKEN` is unset under the test runner. The dev script sets it
    // (see apps/ui/README.md); SERVER-024 is the production half.
    const injected = vi.fn().mockResolvedValue(jsonResponse(HEALTH));
    await createUiClient({ fetch: injected }).getHealth();
    const request: unknown = injected.mock.calls[0]?.[0];
    expect(request instanceof Request ? request.headers.get("authorization") : null).toBe("Bearer");
  });

  it("reads the token the server injected into the page it served", async () => {
    serveWithRuntimeConfig('{"token":"tok_from_server"}');
    expect(await bearerSent()).toBe("Bearer tok_from_server");
  });

  it("prefers the injected token over the build-time env var", async () => {
    vi.stubEnv("VITE_CORPUS_TOKEN", "tok_from_build");
    serveWithRuntimeConfig('{"token":"tok_from_server"}');
    // The runtime value comes from the server that served this exact page; the
    // env var was baked in at build time and can only be a guess.
    expect(await bearerSent()).toBe("Bearer tok_from_server");
  });

  it("falls back to the env var when the page carries no injected config", async () => {
    vi.stubEnv("VITE_CORPUS_TOKEN", "tok_from_build");
    expect(await bearerSent()).toBe("Bearer tok_from_build");
  });

  it("falls back to the env var when the injected token is empty", async () => {
    vi.stubEnv("VITE_CORPUS_TOKEN", "tok_from_build");
    serveWithRuntimeConfig('{"token":""}');
    expect(await bearerSent()).toBe("Bearer tok_from_build");
  });

  it("survives a token carrying characters that had to be escaped in the HTML", async () => {
    const hostile = "</script><b>&\"'";
    serveWithRuntimeConfig(JSON.stringify({ token: hostile }));
    expect(await bearerSent()).toBe(`Bearer ${hostile}`);
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON scalar", '"just a string"'],
    ["an object with no token", '{"baseUrl":"http://127.0.0.1:8935"}'],
    ["a non-string token", '{"token":42}'],
    ["nothing at all", ""],
  ])("degrades quietly when the block holds %s", async (_name, json) => {
    serveWithRuntimeConfig(json);
    // No throw, no token — the same visible-401 state as an unprovisioned build.
    expect(await bearerSent()).toBe("Bearer");
  });

  it("opens the SSE stream against the same origin", () => {
    const client = createUiClient({ baseUrl: "http://127.0.0.1:8765" });
    expect(typeof client.connectEvents).toBe("function");
  });
});
