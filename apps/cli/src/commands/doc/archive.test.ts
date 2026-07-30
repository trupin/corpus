import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runDocArchive } from "./archive.js";
import { archived, ARCHIVED_SKILL, DOC, SKILL } from "./fixtures.js";

const ARGS = { id: "doc_a1b2c3" };
const SKILL_ARGS = { id: "doc_gqyrzvto" };

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

  it("archives a skill and prints one line", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, SKILL);
      sendJson(response, 200, { doc: ARCHIVED_SKILL, warnings: [] });
    });
    const harness = stubContext(stub, { args: SKILL_ARGS });

    await runDocArchive(harness.context);

    expect(stub.requests[1]?.path).toBe("/api/docs/doc_gqyrzvto/archive");
    expect(harness.stdout()).toBe("archived doc_gqyrzvto\n");
  });

  it("sends nothing at all for an already-archived document, and exits 0", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: archived(DOC), warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocArchive(harness.context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(harness.stdout()).toBe("doc_a1b2c3 is already archived\n");
  });

  it("still posts for a skill whose folder has not followed its status — that is a repair", async () => {
    // `archived(SKILL)` is the half-state: `status: archived`, folder still in
    // `.claude/skills/`. The server plans the move off the *path*, so the
    // request heals it; skipping on the status alone would give that up.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(SKILL));
      sendJson(response, 200, { doc: ARCHIVED_SKILL, warnings: [] });
    });
    const harness = stubContext(stub, { args: SKILL_ARGS });

    await runDocArchive(harness.context);

    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(harness.stdout()).toBe("archived doc_gqyrzvto\n");
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

  it("emits the same shape under --json when it sends nothing", async () => {
    // A caller parsing `{doc, warnings}` must not have to know which branch ran.
    const stub = await startStubServer((_request, response) =>
      sendJson(response, 200, archived(DOC)),
    );
    const harness = stubContext(stub, { args: ARGS, json: true });

    await runDocArchive(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ doc: archived(DOC), warnings: [] });
    expect(stub.requests).toHaveLength(1);
  });
});
