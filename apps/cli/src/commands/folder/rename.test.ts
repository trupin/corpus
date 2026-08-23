import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { runFolderRename } from "./rename.js";

afterEach(closeStubServers);

const MOVED = {
  documents: [
    { id: "doc_a1b2c3", path: "data/docs/triage/mortgage-options.md" },
    // A thread, at its **unchanged** flat path: what moved is the folder it
    // belongs to through its parent (§6), never the file.
    { id: "th_x9y8", path: "data/threads/th_x9y8.md" },
  ],
  warnings: [],
};

describe("corpus folder rename", () => {
  it("sends both paths in the body and prints one line per document", async () => {
    const stub = await startStubServer(jsonResponder(200, MOVED));
    const harness = stubContext(stub, { args: { from: "inbox", to: "triage" }, actor: "agent" });

    await runFolderRename(harness.context);

    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/folders/rename");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(JSON.parse(request?.body ?? "")).toEqual({ from: "inbox", to: "triage" });
    expect(harness.stdout()).toBe(
      "doc_a1b2c3  data/docs/triage/mortgage-options.md\n" +
        "th_x9y8     data/threads/th_x9y8.md\n" +
        "renamed inbox → triage — 2 documents\n",
    );
  });

  it("sends the paths byte-exactly, normalising nothing", async () => {
    // The server compares exactly — `FINANCE` is a `404` in a workspace holding
    // `finance` — so a path corrected here would move files nobody named.
    const stub = await startStubServer(jsonResponder(200, { documents: [], warnings: [] }));
    const harness = stubContext(stub, { args: { from: "FINANCE", to: "Archive/2024" } });

    await runFolderRename(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      from: "FINANCE",
      to: "Archive/2024",
    });
  });

  it("says so when a folder held nothing", async () => {
    const stub = await startStubServer(jsonResponder(200, { documents: [], warnings: [] }));
    const harness = stubContext(stub, { args: { from: "empty", to: "gone" } });

    await runFolderRename(harness.context);

    expect(harness.stdout()).toBe("renamed empty → gone — no documents\n");
  });

  it("folds a warning onto the summary line", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        documents: [{ id: "doc_a1b2c3", path: "data/docs/triage/x.md" }],
        warnings: [{ code: "commit_failed", detail: "the hook rejected it" }],
      }),
    );
    const harness = stubContext(stub, { args: { from: "inbox", to: "triage" } });

    await runFolderRename(harness.context);

    expect(harness.stdout()).toContain("warning: commit_failed");
  });

  it("emits the server's response unchanged under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, MOVED));
    const harness = stubContext(stub, { args: { from: "inbox", to: "triage" }, json: true });

    await runFolderRename(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(MOVED);
  });

  it("surfaces the server's 409 rather than merging two folders", async () => {
    const stub = await startStubServer(
      jsonResponder(409, { code: "conflict", message: "data/docs/triage already exists" }),
    );
    const harness = stubContext(stub, { args: { from: "inbox", to: "triage" } });

    const error: unknown = await runFolderRename(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("already exists");
  });
});
