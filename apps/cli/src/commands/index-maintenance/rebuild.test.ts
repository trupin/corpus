import type { IndexStatus } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../client.js";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { GLOBAL_FLAG_NAMES } from "../../registry/globals.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { acknowledgment, rebuildCommand, runIndexRebuild } from "./rebuild.js";

/**
 * Two properties carry this verb, and both are about what it does *not* do: it
 * makes exactly one call, and it comes back from it. A watch loop or the
 * untimed client would each turn a queueing acknowledgment into an open-ended
 * wait, so both are asserted rather than assumed.
 */

const QUEUED: IndexStatus = {
  indexed: 0,
  pending: 660,
  failed: 0,
  identity: "local/all-MiniLM-L6-v2@384",
  rebuilding: true,
  state: "indexing",
};

afterEach(closeStubServers);

describe("corpus index rebuild", () => {
  it("posts a bodiless rebuild and acknowledges what was queued, with a hint", async () => {
    const stub = await startStubServer(jsonResponder(202, QUEUED));
    const harness = stubContext(stub, {});

    await runIndexRebuild(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/index/rebuild");
    expect(request?.body).toBe("");
    expect(harness.stdout()).toBe(
      "queued a full rebuild of the semantic index — 660 chunks to embed, " +
        "identity local/all-MiniLM-L6-v2@384, state indexing.\n" +
        "it runs in the background — watch it with `corpus index status`.\n",
    );
  });

  it("makes exactly one call and never polls the status route", async () => {
    const stub = await startStubServer(jsonResponder(202, QUEUED));
    const harness = stubContext(stub, {});

    await runIndexRebuild(harness.context);

    expect(stub.requests).toHaveLength(1);
    expect(stub.requestsTo("/api/index/status")).toEqual([]);
    expect(rebuildCommand.flags).toEqual([]);
  });

  it("acknowledges a snapshot that has not re-picked an identity yet, without printing null", () => {
    const line = acknowledgment({ ...QUEUED, identity: null, pending: 1 });

    expect(line).toContain("1 chunk to embed");
    expect(line).not.toContain("null");
  });

  it("says nothing about completion — the snapshot is true only at the call", async () => {
    const stub = await startStubServer(jsonResponder(202, QUEUED));
    const harness = stubContext(stub, {});

    await runIndexRebuild(harness.context);

    expect(harness.stdout()).not.toMatch(/rebuilt|done|complete|finished/i);
  });

  it("emits the queued-moment snapshot verbatim under --json, and no prose", async () => {
    const stub = await startStubServer(jsonResponder(202, QUEUED));
    const harness = stubContext(stub, { json: true });

    await runIndexRebuild(harness.context);

    expect(harness.stdout()).toBe(`${JSON.stringify(QUEUED)}\n`);
  });

  it("uses the ordinary timed client, not `db rebuild`'s ten-minute untimed one", async () => {
    // A queueing call that has not answered inside the transport deadline is a
    // server that is wrong, not a long rebuild: this must abort where
    // `corpus db rebuild` deliberately would not. If the verb ever reached for
    // `client.untimedApi`, the slow answer below would arrive and this
    // expectation would fail rather than hang.
    const stub = await startStubServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify(QUEUED));
      }, 400);
    });
    const harness = stubContext(stub, {});
    const context = {
      ...harness.context,
      client: createClient({ workspace: stub.workspace, timeoutMs: 25 }),
    };

    const error: unknown = await runIndexRebuild(context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect(GLOBAL_FLAG_NAMES.has("timeout")).toBe(true);
  });

  it("surfaces a refused token as the shipped server error, exit 5", async () => {
    const stub = await startStubServer(
      jsonResponder(401, { code: "unauthorized", message: "missing or invalid bearer token" }),
    );
    const harness = stubContext(stub, {});

    const error: unknown = await runIndexRebuild(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("401 unauthorized: missing or invalid bearer token");
  });
});
