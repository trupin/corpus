import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { patchDoc } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, presentsAKey, transportError } from "./client.js";
import { DOC, rekeyed } from "./commands/doc/fixtures.js";
import {
  ExitCode,
  exitCodeFor,
  ServerResponseError,
  ServerUnreachableError,
  StaleKeyError,
} from "./errors.js";
import type { Workspace } from "./workspace.js";

/**
 * Real sockets, no mocking library: every case below is a real `node:http`
 * server on an ephemeral port answering a real request from the real generated
 * client (sprint-002's stub-origin precedent).
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

/** The document a §7 refusal carries: the same one, changed, with a new key. */
const MOVED_ON = rekeyed(DOC, "c0ffee11223344556677889900aabbccddeeff00112233445566778899aabbcc");

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

  it("sends the workspace bearer token and attributes an unnamed actor to the user", async () => {
    const { port, requests } = await listen(json(200, HEALTH));
    await createClient({ workspace: workspaceOn(port) }).request((api) => api.GET("/api/health"));
    const [request] = requests;
    expect(request?.headers.authorization).toBe("Bearer 0123456789abcdef0123456789abcdef");
    expect(request?.headers["x-corpus-author"]).toBe("user");
  });

  it("sends the actor the dispatcher resolved on every request", async () => {
    const { port, requests } = await listen(json(200, HEALTH));
    await createClient({ workspace: workspaceOn(port), actor: "agent" }).request((api) =>
      api.GET("/api/health"),
    );
    expect(requests[0]?.headers["x-corpus-author"]).toBe("agent");
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

  it("turns a stale-key refusal into its own error, carrying the document it came with", async () => {
    // SPEC.md §7: the refusal is classified here rather than in the verb, so no
    // verb has to remember to translate a `409` — and its whole recovery is the
    // body, which nothing on this path slices, truncates or stringifies.
    const { port } = await listen(
      json(409, { code: "stale_key", message: "it moved", doc: MOVED_ON }),
    );
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) => api.GET("/api/health"))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StaleKeyError);
    expect(exitCodeFor(error)).toBe(ExitCode.staleKey);
    expect(error).toHaveProperty("details", MOVED_ON);
    expect(error).toHaveProperty("changed", false);
    expect(error).toHaveProperty("hint", expect.stringContaining(MOVED_ON.key));
  });

  it("names the patch route's recovery instead, because that route presents no key", async () => {
    // The same `409`, same code, same document — and the opposite instruction.
    // `corpus doc patch` has no `--key` (SPEC.md §7 exempts it) and refuses one
    // at exit 2, so the keyed hint would send an agent to a flag that does not
    // exist. Driven over a real socket so the classification sees the URL the
    // generated client actually built (PR #44 re-review).
    const { port } = await listen(
      json(409, { code: "stale_key", message: "it moved", doc: MOVED_ON }),
    );
    const error = await createClient({ workspace: workspaceOn(port) })
      .request((api) =>
        api.POST("/api/docs/{id}/patch", {
          params: { path: { id: DOC.frontmatter.id } },
          body: { old: "6.1%", new: "5.8%" },
        }),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StaleKeyError);
    expect(exitCodeFor(error)).toBe(ExitCode.staleKey);
    expect((error as Error).message).toContain("outside Corpus");
    expect(error).toHaveProperty("hint", expect.stringContaining("Run the same patch again"));
    // The regression, asserted as an absence: neither the flag nor the key it
    // would carry may appear anywhere the caller reads.
    expect((error as Error).message).not.toContain("--key");
    expect(error).toHaveProperty("hint", expect.not.stringContaining("--key"));
    expect(error).toHaveProperty("hint", expect.not.stringContaining(MOVED_ON.key));
    // Still the whole document for `--json`, which asked for structure.
    expect(error).toHaveProperty("details", MOVED_ON);
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

/**
 * Which recovery a §7 refusal names is decided by the route, and the only thing
 * a `Response` says about its route is its URL. These are the edges of reading
 * that: a query string must not make a patch look keyed, a path that merely ends
 * in the same word is not the patch route, and an unparseable URL falls back to
 * the keyed refusal — which is every other write in the API, and at least
 * carries the fresh key.
 */
describe("presentsAKey", () => {
  const patchPath = patchDoc.path.replace("{id}", "doc_a1b2c3");

  it("reads the one keyless route off the contract rather than off a spelling here", () => {
    // If the contract renames the path, this file follows it — the assertion is
    // that the CLI never hard-codes a second copy of it.
    expect(patchDoc.path).toBe("/api/docs/{id}/patch");
    expect(presentsAKey(`http://127.0.0.1:8765${patchPath}`)).toBe(false);
  });

  it("matches the path, not the string, so a query or a fragment cannot fool it", () => {
    expect(presentsAKey(`http://127.0.0.1:8765${patchPath}?dry-run=1`)).toBe(false);
    expect(presentsAKey(`http://127.0.0.1:8765${patchPath}#frag`)).toBe(false);
    expect(presentsAKey(patchPath)).toBe(false);
  });

  it("says every other write presents one", () => {
    expect(presentsAKey("http://127.0.0.1:8765/api/docs/doc_a1b2c3")).toBe(true);
    expect(presentsAKey("http://127.0.0.1:8765/api/docs/doc_a1b2c3/move")).toBe(true);
    // Ends in the same segment, is not the same route: the whole path matches or
    // nothing does.
    expect(presentsAKey("http://127.0.0.1:8765/api/skills/patch")).toBe(true);
    expect(presentsAKey("http://127.0.0.1:8765/api/docs/doc_a1b2c3/patch/extra")).toBe(true);
    // An empty id is not an id.
    expect(presentsAKey("http://127.0.0.1:8765/api/docs//patch")).toBe(true);
  });

  it("falls back to the keyed refusal for a URL it cannot read", () => {
    // `response.url` is `""` on a hand-built `Response`; a classifier must not
    // throw over its own input.
    expect(presentsAKey("")).toBe(true);
    expect(presentsAKey("http://")).toBe(true);
  });
});
