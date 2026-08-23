import { afterEach, describe, expect, it } from "vitest";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { archiveCommand, runFolderArchive, runFolderUnarchive } from "./status.js";

afterEach(closeStubServers);

const ARCHIVED = {
  documents: [
    { id: "doc_a1b2c3", status: "archived" },
    // Already archived before the act, and still listed: the rows report the
    // state after the act, not what changed.
    { id: "doc_c3d4e5", status: "archived" },
    { id: "th_x9y8", status: "archived" },
  ],
  warnings: [],
};

describe("corpus folder archive", () => {
  it("posts the path and prints each document with its status after the act", async () => {
    const stub = await startStubServer(jsonResponder(200, ARCHIVED));
    const harness = stubContext(stub, { args: { path: "finance/2024" }, actor: "agent" });

    await runFolderArchive(harness.context);

    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/folders/archive");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(JSON.parse(request?.body ?? "")).toEqual({ path: "finance/2024" });
    expect(harness.stdout()).toBe(
      "doc_a1b2c3  archived\n" +
        "doc_c3d4e5  archived\n" +
        "th_x9y8     archived\n" +
        "archived finance/2024 — 3 documents\n",
    );
  });

  it("sends the path byte-exactly", async () => {
    const stub = await startStubServer(jsonResponder(200, { documents: [], warnings: [] }));
    const harness = stubContext(stub, { args: { path: "FINANCE" } });

    await runFolderArchive(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({ path: "FINANCE" });
  });

  it("emits the server's response unchanged under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, ARCHIVED));
    const harness = stubContext(stub, { args: { path: "finance/2024" }, json: true });

    await runFolderArchive(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(ARCHIVED);
  });

  it("tells an agent the verb is theirs to use, unlike delete", () => {
    // The one folder act the agent is *supposed* to reach for (SPEC.md §7).
    expect(archiveCommand.description ?? "").toContain("where a person would reach for delete");
  });
});

describe("corpus folder unarchive", () => {
  it("posts the inverse route and reports the restored status", async () => {
    const restored = {
      documents: [{ id: "doc_a1b2c3", status: "resolved" }],
      warnings: [],
    };
    const stub = await startStubServer(jsonResponder(200, restored));
    const harness = stubContext(stub, { args: { path: "finance/2024" } });

    await runFolderUnarchive(harness.context);

    expect(stub.requests[0]?.path).toBe("/api/folders/unarchive");
    expect(harness.stdout()).toBe("doc_a1b2c3  resolved\nrestored finance/2024 — 1 document\n");
  });
});
