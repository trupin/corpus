import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { InvocationReport } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { REPORT_TIMEOUT_MS, sendInvocationReports } from "./report.js";

/**
 * The channel §9.4 defines as free, tested for the two things freedom means
 * here: it cannot change an outcome, and it cannot hold the process.
 */

const servers: Server[] = [];

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

interface Listening {
  readonly workspace: { readonly baseUrl: string; readonly token: string };
  readonly requests: { path: string; auth: string | undefined; body: string }[];
}

/** A server that answers with `status`, or never answers at all when it is `null`. */
async function listen(status: number | null): Promise<Listening> {
  const requests: Listening["requests"] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        path: request.url ?? "",
        auth: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (status === null) return; // Accepted, and deliberately left hanging.
      response.writeHead(status);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { workspace: { baseUrl: `http://127.0.0.1:${String(port)}`, token: "tok" }, requests };
}

const report = (overrides: Partial<InvocationReport> = {}): InvocationReport => ({
  command: "thread show",
  wroteBytes: 24,
  readBytes: 512,
  subjects: ["th_a1"],
  at: "2026-09-06T10:00:00.000Z",
  ...overrides,
});

describe("sending a cost report", () => {
  it("posts one invocation to the contract's ingestion route, bearing the workspace token", async () => {
    const listening = await listen(204);
    // A generous cap: this test asserts delivery, not runner speed — the
    // production 50ms ceiling raced a loaded CI runner and dropped the report
    // by design, which is the other tests' subject, not this one's.
    await sendInvocationReports(listening.workspace, [report()], { timeoutMs: 5000 });

    expect(listening.requests).toHaveLength(1);
    expect(listening.requests[0]?.path).toBe("/api/telemetry/invocations");
    expect(listening.requests[0]?.auth).toBe("Bearer tok");
    expect(JSON.parse(listening.requests[0]?.body ?? "null")).toEqual(report());
  });

  it("sends several in the contract's batch form, which exists for exactly this", async () => {
    const listening = await listen(204);
    const two = [report(), report({ command: "doc show", subjects: ["doc_b2"] })];
    await sendInvocationReports(listening.workspace, two, { timeoutMs: 5000 });

    expect(listening.requests).toHaveLength(1);
    expect(JSON.parse(listening.requests[0]?.body ?? "null")).toEqual({ invocations: two });
  });

  it("sends nothing at all when there is nothing to report", async () => {
    const listening = await listen(204);
    await sendInvocationReports(listening.workspace, []);
    expect(listening.requests).toEqual([]);
  });
});

describe("the channel is advisory, so nothing about it may be observable", () => {
  it("resolves quietly when the server refuses the connection, and tries exactly once", async () => {
    // A port nothing is listening on. `createClient` would raise
    // `ServerUnreachableError` here and exit 4; this path cannot reach that
    // code at all, because it does not go through `createClient` (sprint-025 R6).
    let attempts = 0;
    const counting: typeof globalThis.fetch = (input, init) => {
      attempts += 1;
      return globalThis.fetch(input, init);
    };
    await expect(
      sendInvocationReports({ baseUrl: "http://127.0.0.1:1", token: "tok" }, [report()], {
        fetch: counting,
      }),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(1);
  });

  it("resolves quietly on a 500, and does not send it again", async () => {
    const listening = await listen(500);
    await expect(sendInvocationReports(listening.workspace, [report()])).resolves.toBeUndefined();
    expect(listening.requests).toHaveLength(1);
  });

  it("resolves quietly on a 400, which is a shape bug and still not the command's problem", async () => {
    const listening = await listen(400);
    await expect(sendInvocationReports(listening.workspace, [report()])).resolves.toBeUndefined();
    expect(listening.requests).toHaveLength(1);
  });

  it("gives up on a server that accepts and never answers, within its cap", async () => {
    const listening = await listen(null);
    const started = process.hrtime.bigint();
    await sendInvocationReports(listening.workspace, [report()], { timeoutMs: 40 });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(listening.requests).toHaveLength(1);
    // The hazard sprint-025 P5 names: the CLI never calls `process.exit` on the
    // normal path, so an un-awaited request would hold the process open for as
    // long as this server felt like. The cap is what bounds it.
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("swallows a transport that throws synchronously", async () => {
    await expect(
      sendInvocationReports({ baseUrl: "http://127.0.0.1:1", token: "tok" }, [report()], {
        fetch: () => {
          throw new Error("no network here");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the reporting path's own shape", () => {
  const source = readFileSync(join(import.meta.dirname, "report.ts"), "utf8");

  it("builds its own request rather than going through the shared client", () => {
    // Asserted against the source because the property is an *absence*: the
    // failure it prevents is `ServerUnreachableError` and exit code 4 reaching a
    // channel that must never decide an outcome (sprint-025 R6).
    expect(source).not.toContain("createClient");
    expect(source).not.toContain("client.js");
  });

  it("never spools to disk, and has nowhere to put a retry", () => {
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("writeFile");
    // One call site and no loop around it: "exactly one attempt" is a property
    // of the shape rather than a promise in a comment.
    expect(source.split("await send(").length - 1).toBe(1);
    expect(source).not.toMatch(/^\s*(for|while)\s*\(/m);
  });

  it("caps the wait at a number it states", () => {
    expect(REPORT_TIMEOUT_MS).toBe(50);
    expect(source).toContain("AbortSignal.timeout");
  });
});
