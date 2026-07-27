import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runDocArchive } from "./archive.js";
import { archived, DOC } from "./fixtures.js";

const ARGS = { id: "doc_a1b2c3" };

afterEach(closeStubServers);

describe("corpus doc archive", () => {
  it("archives an open document and prints one line", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: archived(DOC), warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runDocArchive(harness.context);

    const post = stub.requests[1];
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/api/docs/doc_a1b2c3/archive");
    expect(post?.headers["x-corpus-author"]).toBe("agent");
    expect(harness.stdout()).toBe("archived doc_a1b2c3\n");
  });

  it("reports an already-archived document as a no-op and exits 0", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: archived(DOC), warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocArchive(harness.context);

    expect(harness.stdout()).toBe("doc_a1b2c3 is already archived\n");
  });

  it("emits the server's response under --json", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: archived(DOC), warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, json: true });

    await runDocArchive(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ doc: archived(DOC), warnings: [] });
  });
});
