import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, transportError } from "./client.js";
import { ExitCode, ServerResponseError, ServerUnreachableError } from "./errors.js";
import type { Workspace } from "./workspace.js";

/**
 * Real sockets, no mocking library: every case below is a real `node:http`
 * server on an ephemeral port answering a real request from the real generated
 * client (sprint-002's stub-origin precedent).
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

async function listen(handler: Handler): Promise<{ port: number; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { port: address.port, requests };
}

function json(status: number, body: unknown): Handler {
  return (_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
}

function workspaceOn(port: number): Workspace {
  return {
    root: "/tmp/ws",
    configPath: "/tmp/ws/.corpus/config.json",
    host: "127.0.0.1",
    port,
    token: "0123456789abcdef0123456789abcdef",
    dataDir: "data",
    baseUrl: `http://127.0.0.1:${String(port)}`,
  };
}

const HEALTH = { status: "ok", version: "0.0.0", uptimeSeconds: 12, workspace: "/tmp/ws" };

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("createClient", () => {
  it("returns the typed body of a 2xx response", async () => {
    const { port } = await listen(json(200, HEALTH));
    const client = createClient({ workspace: workspaceOn(port) });
    await expect(client.request((api) => api.GET("/api/health"))).resolves.toEqual(HEALTH);
    expect(client.baseUrl).toBe(`http://127.0.0.1:${String(port)}`);
  });

  it("sends the workspace bearer token and attributes the CLI to the agent", async () => {
    const { port, requests } = await listen(json(200, HEALTH));
    await createClient({ workspace: workspaceOn(port) }).request((api) => api.GET("/api/health"));
    const [request] = requests;
    expect(request?.headers.authorization).toBe("Bearer 0123456789abcdef0123456789abcdef");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
  });

  it("exposes the generated client for callers that need it directly", async () => {
    const { port } = await listen(json(200, HEALTH));
    const client = createClient({ workspace: workspaceOn(port) });
    const result = await client.api.GET("/api/health");
    expect(result.data).toEqual(HEALTH);
  });
});

describe("non-2xx responses", () => {
  it("maps 401 to token guidance with exit code 5", async () => {
    const { port } = await listen(json(401, { code: "unauthorized", message: "bad token" }));
    const client = createClient({ workspace: workspaceOn(port) });

    const error = await client.request((api) => api.GET("/api/health")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerResponseError);
    expect(error).toHaveProperty("exitCode", ExitCode.serverError);
    expect((error as Error).message).toBe("401 unauthorized: bad token");
    expect(error).toHaveProperty(
      "hint",
      "The workspace bearer token was rejected — check `token` in .corpus/config.json, or the CORPUS_TOKEN override.",
    );
  });

  it("renders a typed problem as `<status> <code>: <message>`", async () => {
    const { port } = await listen(json(404, { code: "not_found", message: "no such document" }));
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe("404 not_found: no such document");
    expect(error).toHaveProperty("code", "not_found");
  });

  it("carries a validation error's issues as details", async () => {
    const issues = [{ path: "body.title", message: "Required" }];
    const { port } = await listen(json(400, { code: "bad_request", message: "invalid", issues }));
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toHaveProperty("details", issues);
  });

  it("carries a locked error's lock as details", async () => {
    const lock = {
      docId: "doc_a1b2c3",
      holder: "agent",
      acquired: "2026-07-26T00:00:00.000Z",
      ttl: 300,
    };
    const { port } = await listen(json(423, { code: "locked", message: "held", lock }));
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toHaveProperty("details", lock);
  });

  it("renders a body that is not a contract problem through the same path", async () => {
    const { port } = await listen(json(500, { oops: true }));
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerResponseError);
    expect(error).toHaveProperty("exitCode", ExitCode.serverError);
    expect((error as Error).message).toBe("500 http_error: Internal Server Error");
    expect(error).toHaveProperty("details", { oops: true });
  });

  it("reports an empty 2xx body as a server error rather than returning undefined", async () => {
    const { port } = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("");
    });
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toHaveProperty("code", "empty_response");
  });
});

describe("transport failures", () => {
  it("says `run corpus server start` when nothing is listening, with exit code 4", async () => {
    const { port } = await listen(json(200, HEALTH));
    await new Promise<void>((resolve) => {
      const server = servers.pop();
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });

    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerUnreachableError);
    expect(error).toHaveProperty("exitCode", ExitCode.serverUnreachable);
    expect((error as Error).message).toBe(
      "server not running for this workspace — run `corpus server start`",
    );
    expect((error as Error).message).not.toContain("ECONNREFUSED");
  });

  it("classifies a socket closed mid-response as unreachable", async () => {
    const { port } = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
      response.write("{");
      response.socket?.destroy();
    });
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerUnreachableError);
    expect(error).toHaveProperty("exitCode", ExitCode.serverUnreachable);
  });

  it("classifies a timeout as unreachable and names the budget", async () => {
    const { port } = await listen(() => {
      // Never answers: the client's own timeout has to fire.
    });
    const error = await createClient({ workspace: workspaceOn(port), timeoutMs: 40 })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerUnreachableError);
    expect((error as Error).message).toContain("did not answer within 40ms");
  });
});

describe("transportError", () => {
  it("digs the cause out of an AggregateError, as happy-eyeballs produces", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const aggregate = Object.assign(new AggregateError([inner], "fetch failed"), {
      name: "TypeError",
    });
    const error = transportError(
      new Error("fetch failed", { cause: aggregate }),
      "http://127.0.0.1:1",
      100,
    );
    expect(error).toBeInstanceOf(ServerUnreachableError);
  });

  it("rethrows an unrelated failure unchanged so it becomes an internal error", () => {
    const original = new TypeError("something else entirely");
    expect(transportError(original, "http://127.0.0.1:1", 100)).toBe(original);
  });

  it("wraps a thrown non-Error", () => {
    expect(transportError("nope", "http://127.0.0.1:1", 100).message).toBe("nope");
  });
});
