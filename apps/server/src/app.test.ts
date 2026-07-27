import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_CONTRACT_ROUTES,
  ApiErrorSchema,
  HealthSchema,
  ValidationErrorSchema,
} from "@corpus/contract";
import { OPENAPI_PATH, createServer, formatHostForUrl, mapListenError } from "./app.js";
import { nonLoopbackBindError, type ServerConfig } from "./config.js";
import {
  ConfigError,
  CorpusError,
  badRequest,
  errorResponse,
  notFound,
  toValidationIssues,
} from "./errors.js";
import { createLogger, silentLogger, type LogSink } from "./logger.js";
import { UI_MISSING_MESSAGE } from "./static-ui.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-app-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    workspaceRoot: join(root, "ws"),
    corpusDir: join(root, "ws", ".corpus"),
    dataDir: join(root, "ws", "data"),
    configPath: join(root, "ws", ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    warnings: [],
    ...overrides,
  };
}

function makeDist(): string {
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Corpus</title>", "utf8");
  writeFileSync(join(dist, "assets", "app.a1b2c3d4.js"), "export const x = 1;", "utf8");
  return dist;
}

describe("formatHostForUrl", () => {
  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["localhost", "localhost"],
    ["::1", "[::1]"],
    ["[::1]", "[::1]"],
  ])("%s -> %s", (host, expected) => {
    expect(formatHostForUrl(host)).toBe(expected);
  });
});

describe("mapListenError", () => {
  it("turns EADDRINUSE into the documented, actionable message", () => {
    const error = mapListenError(
      Object.assign(new Error("listen"), { code: "EADDRINUSE" }),
      8765,
      "127.0.0.1",
    );
    expect(error).toBeInstanceOf(CorpusError);
    expect(error.message).toBe(
      "port 8765 already in use — another corpus server may be running (corpus server status)",
    );
  });

  it("explains EADDRNOTAVAIL in terms of the host", () => {
    const error = mapListenError(
      Object.assign(new Error("listen"), { code: "EADDRNOTAVAIL" }),
      8765,
      "127.9.9.9",
    );
    expect(error.message).toMatch(/cannot bind 127\.9\.9\.9/);
  });

  it.each([
    ["an unknown errno", Object.assign(new Error("nope"), { code: "EPERM" })],
    ["a non-Error value", "boom"],
  ])("keeps %s legible and preserves the cause", (_label, thrown) => {
    const error = mapListenError(thrown, 8765, "::1");
    expect(error.message).toMatch(/failed to bind \[::1\]:8765/);
    expect(error.cause).toBe(thrown);
  });
});

describe("createServer — the mounted surface", () => {
  it("serves health without a token, matching the contract shape", async () => {
    const { app } = createServer(makeConfig({ workspaceRoot: "/tmp/some/ws" }), { now: () => 0 });
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const parsed = HealthSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.workspace).toBe("/tmp/some/ws");
    expect(parsed.success && parsed.data.version).toBe("9.9.9");
  });

  it("mounts health and the queue surface; every other declared path 404s", async () => {
    const { app } = createServer(makeConfig());

    for (const route of ALL_CONTRACT_ROUTES) {
      // `/api/queue/*` is mounted (SERVER-008) and `idle` deliberately parks for
      // its whole window; `/events` is mounted (SERVER-007) and holds its socket
      // open. Both surfaces are asserted by their own specs.
      if (route.path.startsWith("/api/queue")) continue;
      if (route.path === "/events") continue;
      const path = route.path.replace(/\{[^}]+\}/g, "sample");
      const response = await app.request(path, {
        method: route.method.toUpperCase(),
        headers: AUTH,
      });

      if (path === "/api/health" && route.method === "get") {
        expect(response.status).toBe(200);
        continue;
      }
      expect([path, response.status]).toEqual([path, 404]);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
    }
  });

  it("leaves the lock surface unmounted, and unreachable, without a projection", async () => {
    // A lock is per-document, and "does this document exist?" is a question only
    // the projection can answer — so no projection means no lock routes, which
    // is an honest 404 rather than a half-wired server.
    const server = createServer(makeConfig());

    expect(server.locks).toBeUndefined();
    expect(server.lockGuard).toBeUndefined();
    expect((await server.app.request("/api/locks", { headers: AUTH })).status).toBe(404);
  });

  it("mounts the queue surface and exposes the enqueue path to in-process producers", async () => {
    const server = createServer(makeConfig());
    await server.queue.enqueue({ type: "comment.created", source: "test", payload: {} });

    const response = await server.app.request("/api/queue/status", { headers: AUTH });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ halted: false, pending: 1 });
    await server.close();
  });

  it("returns a contract ApiError 404 for an unknown API path", async () => {
    const { app } = createServer(makeConfig());
    const response = await app.request("/api/definitely-not-a-route", { headers: AUTH });

    expect(response.status).toBe(404);
    const body: unknown = await response.json();
    expect(ApiErrorSchema.safeParse(body)).toMatchObject({ success: true });
    expect(body).toMatchObject({ code: "not_found" });
  });

  it("serves the generated OpenAPI 3.1 document behind the guard", async () => {
    const { app } = createServer(makeConfig());

    expect((await app.request(OPENAPI_PATH)).status).toBe(401);

    const response = await app.request(OPENAPI_PATH, { headers: AUTH });
    expect(response.status).toBe(200);

    const document = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe("3.1.0");
    // The document describes the whole contract, not just what is mounted —
    // it is the artifact clients are generated from (Adjudication 4).
    expect(Object.keys(document.paths)).toContain("/api/docs");
  });

  it("guards /attachments/* as well as /api/*", async () => {
    const { app } = createServer(makeConfig());
    expect((await app.request("/attachments/a.png")).status).toBe(401);
    expect((await app.request("/attachments/a.png", { headers: AUTH })).status).toBe(404);
  });

  it("guards /events, accepting ?token= only there", async () => {
    const server = createServer(makeConfig());
    const { app } = server;

    expect((await app.request("/events")).status).toBe(401);
    expect((await app.request(`/events?token=wrong-${TOKEN}`)).status).toBe(401);
    // The query-token exemption is `/events`-only: the same form anywhere else
    // would put the workspace token into referrers and proxy logs.
    expect((await app.request(`/api/docs?token=${TOKEN}`)).status).toBe(401);

    const stream = await app.request(`/events?token=${TOKEN}`);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    await stream.body?.cancel();
    await server.close();
  });
});

describe("createServer — errors", () => {
  it("renders a thrown HttpError with its status and body", async () => {
    const server = createServer(makeConfig());
    server.app.get("/api/boom", () => {
      throw notFound("no such doc");
    });

    const response = await server.app.request("/api/boom", { headers: AUTH });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "no such doc" });
  });

  it("never leaks an unexpected error's message, and logs it in full", async () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const server = createServer(makeConfig(), { logger: createLogger("silent", sink) });
    server.app.get("/api/boom", () => {
      throw new Error("connection string postgres://user:hunter2@host");
    });

    const response = await server.app.request("/api/boom", { headers: AUTH });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text)).toEqual({ code: "internal_error", message: "internal error" });
    expect(lines.join("\n")).toContain("hunter2");
  });

  it("never answers with an HTML stack trace", async () => {
    const server = createServer(makeConfig());
    server.app.get("/api/boom", () => {
      throw new Error("boom");
    });

    const response = await server.app.request("/api/boom", { headers: AUTH });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("<html");
  });

  it("maps zod-openapi validation failures to a 400 ApiError with issues", async () => {
    const server = createServer(makeConfig());
    server.app.openapi(
      createRoute({
        method: "get",
        path: "/api/validated",
        request: { query: z.object({ n: z.coerce.number().int() }) },
        responses: { 200: { description: "ok" } },
      }),
      (c) => c.json({ n: c.req.valid("query").n }, 200),
    );

    const response = await server.app.request("/api/validated?n=not-a-number", { headers: AUTH });
    expect(response.status).toBe(400);

    const parsed = ValidationErrorSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.code).toBe("bad_request");
    expect(parsed.data.issues[0]?.path).toContain("query");
  });

  it("lets a validating route through when the request is valid", async () => {
    const server = createServer(makeConfig());
    server.app.openapi(
      createRoute({
        method: "get",
        path: "/api/validated",
        request: { query: z.object({ n: z.coerce.number().int() }) },
        responses: { 200: { description: "ok" } },
      }),
      (c) => c.json({ n: c.req.valid("query").n }, 200),
    );

    const response = await server.app.request("/api/validated?n=42", { headers: AUTH });
    expect(await response.json()).toEqual({ n: 42 });
  });
});

describe("createServer — UI serving", () => {
  it("serves the shell and hashed assets when a build is present", async () => {
    const { app } = createServer(makeConfig({ uiDistDir: makeDist() }));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/assets/app.a1b2c3d4.js")).headers.get("cache-control")).toContain(
      "immutable",
    );
    expect((await app.request("/doc/abc")).status).toBe(200);
  });

  it("degrades to 503 without a build while the API keeps working", async () => {
    const { app } = createServer(makeConfig());

    const shell = await app.request("/");
    expect(shell.status).toBe(503);
    expect(await shell.text()).toContain(UI_MISSING_MESSAGE);
    expect((await app.request("/api/health")).status).toBe(200);
  });
});

describe("createServer — purity", () => {
  it("uses only the passed config, whatever the environment says", async () => {
    const previous = { ...process.env };
    process.env.CORPUS_WORKSPACE = "/somewhere/else";
    process.env.CORPUS_PORT = "1";
    process.env.CORPUS_LOG_LEVEL = "debug";
    process.env.CORPUS_UI_DIST = makeDist();

    try {
      const config = makeConfig({ workspaceRoot: "/the/real/ws" });
      const { app } = createServer(config);

      const health = (await (await app.request("/api/health")).json()) as { workspace: string };
      expect(health.workspace).toBe("/the/real/ws");
      // CORPUS_UI_DIST was set, yet the config said there is no UI.
      expect((await app.request("/")).status).toBe(503);
    } finally {
      process.env = previous;
    }
  });

  it("does not call process.exit", async () => {
    // Throwing rather than returning keeps the spy honest about `never`: if
    // `createServer` ever reaches it, the test fails loudly instead of
    // continuing into a half-torn-down process.
    const exit = vi.spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
      throw new Error(`process.exit(${String(code)}) called`);
    });

    try {
      const server = createServer(makeConfig({ port: 0 }));
      await server.start();
      await server.close();
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("defaults its logger to the config's level", () => {
    expect(createServer(makeConfig({ logLevel: "debug" })).logger.level).toBe("debug");
  });

  it("exposes the config it was handed", () => {
    const config = makeConfig();
    expect(createServer(config).config).toBe(config);
  });
});

describe("createServer — lifecycle", () => {
  it("binds an ephemeral port and answers over a real socket", async () => {
    const server = createServer(makeConfig({ port: 0 }));
    const address = await server.start();

    try {
      expect(address.port).toBeGreaterThan(0);
      expect(address.url).toBe(`http://127.0.0.1:${address.port}`);

      const response = await fetch(`${address.url}/api/health`);
      expect(response.status).toBe(200);
      expect(HealthSchema.safeParse(await response.json()).success).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("refuses connections after close", async () => {
    const server = createServer(makeConfig({ port: 0 }));
    const address = await server.start();
    await server.close();

    await expect(fetch(`${address.url}/api/health`)).rejects.toThrow();
  });

  it("runs disposers in reverse registration order", async () => {
    const server = createServer(makeConfig({ port: 0 }));
    const order: string[] = [];
    server.registerDisposer(() => {
      order.push("first");
    });
    server.registerDisposer(async () => {
      await Promise.resolve();
      order.push("second");
    });
    server.registerDisposer(() => {
      order.push("third");
    });

    await server.start();
    await server.close();

    expect(order).toEqual(["third", "second", "first"]);
  });

  it("is idempotent: a second close neither throws nor re-disposes", async () => {
    const server = createServer(makeConfig({ port: 0 }));
    let disposals = 0;
    server.registerDisposer(() => {
      disposals += 1;
    });

    await server.start();
    await Promise.all([server.close(), server.close()]);
    await server.close();

    expect(disposals).toBe(1);
  });

  it("closes cleanly when it was never started", async () => {
    const server = createServer(makeConfig({ port: 0 }));
    let disposed = false;
    server.registerDisposer(() => {
      disposed = true;
    });

    await expect(server.close()).resolves.toBeUndefined();
    expect(disposed).toBe(true);
  });

  it("keeps disposing after one disposer throws, and logs the failure", async () => {
    const lines: string[] = [];
    const server = createServer(makeConfig({ port: 0 }), {
      logger: createLogger("silent", { write: (line) => lines.push(line) }),
    });

    const order: string[] = [];
    server.registerDisposer(() => {
      order.push("first");
    });
    server.registerDisposer(() => {
      throw new Error("disposer exploded");
    });

    await server.close();

    expect(order).toEqual(["first"]);
    expect(lines.join("\n")).toContain("disposer exploded");
  });

  it("rejects a second bind of the same port with the documented message", async () => {
    const first = createServer(makeConfig({ port: 0 }));
    const address = await first.start();

    const second = createServer(makeConfig({ port: address.port }));
    try {
      await expect(second.start()).rejects.toThrow(
        `port ${address.port} already in use — another corpus server may be running (corpus server status)`,
      );
    } finally {
      await second.close();
      await first.close();
    }
  });
});

describe("createServer — loopback-only bind (Adjudication 6)", () => {
  it.each([["0.0.0.0"], ["192.168.1.10"], ["::"], ["example.com"], [""]])(
    "refuses to bind host %j with an actionable message",
    async (host) => {
      const config = makeConfig({ host, port: 0 });
      const server = createServer(config);

      try {
        await expect(server.start()).rejects.toThrow(ConfigError);
        // The operator sees the value, the rule and the file to edit.
        await expect(server.start()).rejects.toThrow(
          nonLoopbackBindError(host, config.configPath).message,
        );
      } finally {
        await server.close();
      }
    },
  );

  it("still constructs the app — the config is valid, only the bind is refused", async () => {
    const { app } = createServer(makeConfig({ host: "0.0.0.0" }));
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("opens no socket: the port stays free for a loopback server", async () => {
    const probe = createServer(makeConfig({ port: 0 }));
    const { port } = await probe.start();
    await probe.close();

    const refused = createServer(makeConfig({ host: "0.0.0.0", port }));
    await expect(refused.start()).rejects.toThrow(/refusing to bind/);
    await refused.close();

    const loopback = createServer(makeConfig({ port }));
    try {
      await expect(loopback.start()).resolves.toMatchObject({ port, host: "127.0.0.1" });
    } finally {
      await loopback.close();
    }
  });

  it.each([["127.0.0.1"], ["localhost"]])("binds loopback host %s", async (host) => {
    const server = createServer(makeConfig({ host, port: 0 }));
    try {
      await expect(server.start()).resolves.toMatchObject({ host });
    } finally {
      await server.close();
    }
  });
});

describe("shared error helpers on a bare app", () => {
  it("errorResponse and toValidationIssues compose into the same body shape", async () => {
    const app = new OpenAPIHono();
    const issues = toValidationIssues(z.object({ a: z.string() }).safeParse({}).error!, "body");
    app.get("/x", (c) => errorResponse(c, badRequest("nope", issues)));

    const response = await app.request("/x");
    expect(ApiErrorSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("silentLogger can drive a server without writing anything", async () => {
    const server = createServer(makeConfig(), { logger: silentLogger });
    expect((await server.app.request("/api/health")).status).toBe(200);
  });
});
