import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { at, DOC } from "./fixtures.js";
import { runDocMove } from "./move.js";

const ARGS = { id: "doc_a1b2c3" };

afterEach(closeStubServers);

describe("corpus doc move", () => {
  it("reports the new path when the document actually moved", async () => {
    const moved = at(DOC, "data/docs/archive-notes/mortgage-options.md");
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: moved, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, flags: { folder: "archive-notes" } });

    await runDocMove(harness.context);

    const post = stub.requests[1];
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/api/docs/doc_a1b2c3/move");
    expect(JSON.parse(post?.body ?? "")).toEqual({ folder: "archive-notes" });
    expect(harness.stdout()).toBe(
      "moved doc_a1b2c3 — data/docs/archive-notes/mortgage-options.md\n",
    );
  });

  it("says so when the document was already in that folder", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, flags: { folder: "finance" } });

    await runDocMove(harness.context);

    expect(harness.stdout()).toBe(
      "doc_a1b2c3 is already at data/docs/finance/mortgage-options.md\n",
    );
  });

  it("emits the server's response under --json", async () => {
    const moved = at(DOC, "data/docs/archive-notes/mortgage-options.md");
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: moved, warnings: [] });
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { folder: "archive-notes" },
      json: true,
    });

    await runDocMove(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ doc: moved, warnings: [] });
  });

  it("requires --folder before sending anything", async () => {
    const stub = await startStubServer(jsonResponder(200, { doc: DOC, warnings: [] }));
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runDocMove(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("reports an unknown id as a server error, not a crash", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no document doc_zzzzzzzz" });
    });
    const harness = stubContext(stub, { args: { id: "doc_zzzzzzzz" }, flags: { folder: "x" } });

    const error: unknown = await runDocMove(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("doc_zzzzzzzz");
  });
});
