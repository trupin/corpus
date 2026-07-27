import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createClient, type CliClient } from "../client.js";
import { createTestContext, type TestContextOptions } from "../registry/fixtures.js";
import type { WorkspaceCommandContext } from "../registry/types.js";
import type { Workspace } from "../workspace.js";

/**
 * A real `node:http` server on an ephemeral port, scripted per test. The queue
 * verbs are all about socket behaviour — a hold that answers late, a connection
 * dropped mid-request, a restart on the same port — and none of that is
 * observable through a mocked `fetch`, so the tests drive the real generated
 * client over a real socket (`client.test.ts`'s precedent).
 *
 * Every server started here is registered for `closeStubServers()`, which
 * `afterEach` calls: a stub left listening would hold a port for the rest of the
 * run.
 */

export interface StubRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export type StubResponder = (request: StubRequest, response: ServerResponse) => void;

export interface StubServer {
  readonly port: number;
  readonly baseUrl: string;
  /** Every request the stub has received, in order, with its body already read. */
  readonly requests: readonly StubRequest[];
  readonly workspace: Workspace;
  readonly client: CliClient;
  /** Requests whose path matches, for counting how many polls a window issued. */
  requestsTo(path: string): readonly StubRequest[];
  /** Drops every open socket, as a killed server would. */
  dropConnections(): void;
  close(): Promise<void>;
}

const servers: Server[] = [];

export async function closeStubServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
}

/** Starts a stub. `port` reuses a port a previous stub released, for restart tests. */
export async function startStubServer(respond: StubResponder, port = 0): Promise<StubServer> {
  const requests: StubRequest[] = [];
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const url = new URL(incoming.url ?? "/", "http://stub.invalid");
      const request: StubRequest = {
        method: incoming.method ?? "GET",
        url: incoming.url ?? "/",
        path: url.pathname,
        query: url.searchParams,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(request);
      respond(request, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const bound = (server.address() as AddressInfo).port;
  const workspace = workspaceOn(bound);
  return {
    port: bound,
    baseUrl: workspace.baseUrl,
    requests,
    workspace,
    client: createClient({ workspace }),
    requestsTo: (path) => requests.filter((request) => request.path === path),
    dropConnections: () => {
      server.closeAllConnections();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export function workspaceOn(port: number): Workspace {
  return {
    root: "/tmp/corpus-cli004-ws",
    configPath: "/tmp/corpus-cli004-ws/.corpus/config.json",
    host: "127.0.0.1",
    port,
    token: "0123456789abcdef0123456789abcdef",
    dataDir: "data",
    baseUrl: `http://127.0.0.1:${String(port)}`,
  };
}

/** Answers one JSON body, whatever is asked. */
export function jsonResponder(status: number, body: unknown): StubResponder {
  return (_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function sendNoContent(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

export interface StubContext {
  readonly context: WorkspaceCommandContext;
  stdout(): string;
  stderr(): string;
}

/** A `WorkspaceCommandContext` wired to the stub's real client. */
export function stubContext(stub: StubServer, options: TestContextOptions = {}): StubContext {
  const harness = createTestContext(options);
  return {
    stdout: () => harness.stdout(),
    stderr: () => harness.stderr(),
    context: { ...harness.context, workspace: stub.workspace, client: stub.client },
  };
}
