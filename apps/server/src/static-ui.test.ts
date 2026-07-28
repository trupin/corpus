import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, silentLogger, type LogSink } from "./logger.js";
import {
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  RESERVED_PREFIXES,
  UI_MISSING_MESSAGE,
  isAppShellPath,
  isImmutableAsset,
  isReservedPath,
  mountStaticUi,
} from "./static-ui.js";
import { RUNTIME_CONFIG_ELEMENT_ID, TOKEN_SHELL_CACHE_CONTROL } from "./ui-runtime-config.js";

const INDEX_HTML =
  '<!doctype html><html><head><title>Corpus</title></head><body><div id="root"></div></body></html>';
const ASSET_JS = "export const board = 1;\n";
const TOKEN = "tok_s024_abcdef0123456789";
/** `app.request`'s third argument: the bindings `getPeerAddress` reads. */
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-ui-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeDist(): string {
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), INDEX_HTML, "utf8");
  writeFileSync(join(dist, "assets", "app.a1b2c3d4.js"), ASSET_JS, "utf8");
  writeFileSync(join(dist, "favicon.svg"), "<svg/>", "utf8");
  return dist;
}

/** An app shaped like `createServer`'s: reserved routes first, UI mounted last. */
function appWith(distDir: string | undefined, logger = silentLogger): Hono {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  mountStaticUi(app, { distDir, logger });
  app.notFound((c) => c.json({ code: "not_found", message: c.req.path }, 404));
  return app;
}

/** The same app with a token to provision — the installed-tool shape (SERVER-024). */
function appWithToken(distDir: string | undefined, token = TOKEN): Hono {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  mountStaticUi(app, { distDir, logger: silentLogger, token });
  app.notFound((c) => c.json({ code: "not_found", message: c.req.path }, 404));
  return app;
}

describe("isReservedPath", () => {
  it.each([
    ["/api", true],
    ["/api/health", true],
    ["/attachments", true],
    ["/attachments/a.png", true],
    ["/events", true],
    ["/", false],
    ["/apiary", false],
    ["/attachmentsx", false],
    ["/eventsource", false],
    ["/doc/abc", false],
  ])("%s -> %s", (path, expected) => {
    expect(isReservedPath(path)).toBe(expected);
  });

  it("covers exactly the three prefixes the API owns", () => {
    expect(RESERVED_PREFIXES).toEqual(["/api", "/attachments", "/events"]);
  });
});

describe("isImmutableAsset", () => {
  it.each([
    ["assets/app.a1b2c3d4.js", true],
    ["assets/index-DBo_PnNP.css", true],
    ["assets/logo-Ab12Cd34Ef.svg", true],
    ["index.html", false],
    ["favicon.svg", false],
    ["vendor.min.js", false],
    ["manifest.webmanifest", false],
    ["assets/app.js", false],
  ])("%s -> %s", (path, expected) => {
    expect(isImmutableAsset(path)).toBe(expected);
  });
});

describe("with a UI build present", () => {
  it("serves index.html at the root, revalidated", async () => {
    const response = await appWith(makeDist()).request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(REVALIDATE_CACHE_CONTROL);
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it("serves a hashed asset with an immutable cache header", async () => {
    const response = await appWith(makeDist()).request("/assets/app.a1b2c3d4.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(await response.text()).toBe(ASSET_JS);
  });

  it("serves an unhashed asset without the immutable header", async () => {
    const response = await appWith(makeDist()).request("/favicon.svg");
    expect(response.headers.get("cache-control")).toBe(REVALIDATE_CACHE_CONTROL);
  });

  it("falls back to index.html for a deep SPA route", async () => {
    const response = await appWith(makeDist()).request("/doc/abc/thread/def");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it.each([
    ["/api/nope", "an unregistered API path"],
    ["/attachments/a.png", "an attachment path"],
    ["/events", "the SSE path"],
  ])("never hands %s the SPA shell (%s)", async (path) => {
    const response = await appWith(makeDist()).request(path);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("leaves routes registered earlier alone", async () => {
    const response = await appWith(makeDist()).request("/api/health");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "does not answer %s with the shell",
    async (method) => {
      const response = await appWith(makeDist()).request("/doc/abc", { method });
      expect(response.status).toBe(404);
    },
  );

  it("answers HEAD for a real file", async () => {
    const response = await appWith(makeDist()).request("/assets/app.a1b2c3d4.js", {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
  });

  it.each(["/../secrets.txt", "/%2e%2e/secrets.txt", "/assets/../../secrets.txt"])(
    "does not escape the dist directory for %s",
    async (path) => {
      writeFileSync(join(root, "secrets.txt"), "TOP SECRET", "utf8");
      const response = await appWith(makeDist()).request(path);
      expect(await response.text()).not.toContain("TOP SECRET");
    },
  );
});

describe("with no UI build", () => {
  it("returns a 503 naming the fix, not a confusing 404", async () => {
    const response = await appWith(undefined).request("/");

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain(UI_MISSING_MESSAGE);
    expect(body).toContain("npm run build -w apps/ui");
  });

  it("keeps the API fully functional", async () => {
    const app = appWith(undefined);
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/nope")).status).toBe(404);
  });

  it("returns 503 for deep routes too", async () => {
    expect((await appWith(undefined).request("/doc/abc")).status).toBe(503);
  });

  it("logs once at mount time when a named dist directory is missing", () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    appWith(join(root, "no-such-dist"), createLogger("silent", sink));

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "error", msg: UI_MISSING_MESSAGE });
  });

  it("says nothing at mount time when no dist was configured at all", () => {
    const lines: string[] = [];
    appWith(undefined, createLogger("silent", { write: (line) => lines.push(line) }));
    expect(lines).toEqual([]);
  });
});

describe("isAppShellPath", () => {
  it.each([
    ["/", true],
    ["/index.html", true],
    // A nested index.html is a file the build shipped, not the SPA shell: it
    // keeps `serveStatic`'s old behaviour and gets no token.
    ["/sub/", false],
    ["/sub/index.html", false],
    ["/doc/abc", false],
    ["/assets/app.a1b2c3d4.js", false],
    ["/favicon.svg", false],
  ])("%s -> %s", (path, expected) => {
    expect(isAppShellPath(path)).toBe(expected);
  });
});

describe("provisioning the token into the served shell (SERVER-024)", () => {
  function injectedToken(html: string): string {
    const match = new RegExp(
      `<script id="${RUNTIME_CONFIG_ELEMENT_ID}" type="application/json">([\\s\\S]*?)</script>`,
    ).exec(html);
    if (match === null) throw new Error("no runtime config block in the shell");
    const parsed = JSON.parse(match[1] ?? "") as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : "";
  }

  it("hands the root shell a runtime config block carrying the token", async () => {
    const response = await appWithToken(makeDist()).request("/", undefined, LOOPBACK);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(injectedToken(await response.text())).toBe(TOKEN);
  });

  it("hands a deep SPA route the same block, since it is the same shell", async () => {
    const response = await appWithToken(makeDist()).request("/doc/abc", undefined, LOOPBACK);
    expect(injectedToken(await response.text())).toBe(TOKEN);
  });

  it("answers /index.html through the shell path too, not raw off disk", async () => {
    const response = await appWithToken(makeDist()).request("/index.html", undefined, LOOPBACK);
    expect(injectedToken(await response.text())).toBe(TOKEN);
  });

  it("never stores a credential-bearing shell", async () => {
    const response = await appWithToken(makeDist()).request("/", undefined, LOOPBACK);
    expect(response.headers.get("cache-control")).toBe(TOKEN_SHELL_CACHE_CONTROL);
    expect(response.headers.get("cache-control")).not.toContain("immutable");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("injects into no other asset, and leaves immutable caching intact", async () => {
    const app = appWithToken(makeDist());

    for (const path of ["/assets/app.a1b2c3d4.js", "/favicon.svg"]) {
      const response = await app.request(path, undefined, LOOPBACK);
      const body = await response.text();
      expect(body).not.toContain(TOKEN);
      expect(body).not.toContain(RUNTIME_CONFIG_ELEMENT_ID);
    }

    const asset = await app.request("/assets/app.a1b2c3d4.js", undefined, LOOPBACK);
    expect(asset.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("escapes a token that would otherwise break out of the block", async () => {
    const hostile = "</script><script>steal()</script>";
    const response = await appWithToken(makeDist(), hostile).request("/", undefined, LOOPBACK);
    const body = await response.text();

    expect(body).not.toContain("<script>steal()</script>");
    expect(injectedToken(body)).toBe(hostile);
  });

  it("refuses a non-loopback peer rather than handing over the token", async () => {
    const response = await appWithToken(makeDist()).request(
      "/",
      { headers: { "X-Forwarded-For": "127.0.0.1" } },
      { incoming: { socket: { remoteAddress: "198.51.100.9" } } },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(TOKEN);
  });

  it.each(["https://evil.example", "http://127.0.0.1:8935"])(
    "refuses a request carrying Origin: %s",
    async (origin) => {
      const response = await appWithToken(makeDist()).request(
        "/",
        { headers: { Origin: origin } },
        LOOPBACK,
      );

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(TOKEN);
    },
  );

  it("still serves ordinary assets to an Origin-bearing request", async () => {
    // Same-origin module scripts are fetched in CORS mode and DO send `Origin`.
    // Guarding every static response would break the app it is protecting.
    const response = await appWithToken(makeDist()).request(
      "/assets/app.a1b2c3d4.js",
      { headers: { Origin: "http://127.0.0.1:8935" } },
      LOOPBACK,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ASSET_JS);
  });

  it("keeps the missing-build 503 a 503, whoever asks", async () => {
    const refused = await appWithToken(undefined).request(
      "/",
      { headers: { Origin: "https://evil.example" } },
      { incoming: { socket: { remoteAddress: "198.51.100.9" } } },
    );

    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain(UI_MISSING_MESSAGE);
  });

  it("provisions nothing, and guards nothing, when no token is configured", async () => {
    // The `appWith` shape: a shell with no credential is the plain bytes, and
    // stays reachable from a test harness that has no socket at all.
    const response = await appWith(makeDist()).request("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
    expect(response.headers.get("cache-control")).toBe(REVALIDATE_CACHE_CONTROL);
  });
});

describe("with a partial UI build", () => {
  it("serves whatever assets exist", async () => {
    const dist = join(root, "partial");
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), INDEX_HTML, "utf8");

    const response = await appWith(dist).request("/assets/missing.a1b2c3d4.js");
    // A missing asset falls through to the shell, which is what a SPA router
    // expects; only a missing *directory* is the 503 case.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
  });

  it("degrades to the 503 message when index.html itself is unreadable", async () => {
    const dist = join(root, "no-index");
    mkdirSync(dist, { recursive: true });

    const lines: string[] = [];
    const app = appWith(dist, createLogger("silent", { write: (line) => lines.push(line) }));
    const response = await app.request("/doc/abc");

    expect(response.status).toBe(503);
    expect(await response.text()).toContain(UI_MISSING_MESSAGE);
    expect(lines.some((line) => line.includes("index.html"))).toBe(true);
  });
});
