import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { archived, DOC } from "./fixtures.js";
import { describeOutcome, runDocUnarchive, unarchiveCommand } from "./unarchive.js";

const ARGS = { id: "doc_a1b2c3" };

const withStatus = (status: "open" | "resolved" | "archived") => ({
  ...DOC,
  frontmatter: { ...DOC.frontmatter, status },
});

afterEach(closeStubServers);

describe("corpus doc unarchive", () => {
  it("round-trips the shipped route and prints one line", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runDocUnarchive(harness.context);

    const post = stub.requests[1];
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/api/docs/doc_a1b2c3/unarchive");
    expect(post?.headers["x-corpus-author"]).toBe("agent");
    expect(harness.stdout()).toBe("unarchived doc_a1b2c3\n");
  });

  it("reports a document that is not archived as a no-op and exits 0, mirroring archive", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(harness.stdout()).toBe("doc_a1b2c3 is not archived\n");
  });

  it("says so when unarchiving a resolved document opens it — the route sets `open`, not the old status", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, withStatus("resolved"));
      sendJson(response, 200, { doc: withStatus("open"), warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(harness.stdout()).toBe("doc_a1b2c3 was not archived — status is now open\n");
  });

  it("emits the server's response under --json", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, { doc: DOC, warnings: [] });
    });
    const harness = stubContext(stub, { args: ARGS, json: true });

    await runDocUnarchive(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual({ doc: DOC, warnings: [] });
  });

  it("folds a §14 warning onto the same line", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, {
        doc: DOC,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
      });
    });
    const harness = stubContext(stub, { args: ARGS });

    await runDocUnarchive(harness.context);

    expect(harness.stdout()).toBe(
      "unarchived doc_a1b2c3 — warning: commit_failed (pre-commit hook rejected the commit)\n",
    );
  });

  it("surfaces the destination-collision refusal with its message intact", async () => {
    // `apps/server/src/docs/archive.ts` refuses when the skill folder's
    // destination already exists. The CLI must hand that message through — an
    // agent that cannot read why it failed cannot recover.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 400, {
        code: "bad_request",
        message: "the archive destination already exists",
        issues: [
          {
            path: "id",
            message: ".claude/skills/weekly-review already exists; move or remove it first",
          },
        ],
      });
    });
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runDocUnarchive(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("the archive destination already exists");
    expect(harness.stdout()).toBe("");
  });

  it("reports an unknown id the way `doc archive` does — the server's own error", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no document with id doc_a1b2c3" });
    });
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runDocUnarchive(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("no document with id doc_a1b2c3");
    expect(stub.requests).toHaveLength(1); // the read failed; nothing was posted
  });
});

describe("unarchive helpers", () => {
  it("describes each outcome from the before/after statuses alone", () => {
    expect(describeOutcome("doc_x", true, "archived", "open")).toBe("unarchived doc_x");
    expect(describeOutcome("doc_x", false, "open", "open")).toBe("doc_x is not archived");
    expect(describeOutcome("doc_x", false, "resolved", "open")).toBe(
      "doc_x was not archived — status is now open",
    );
  });

  it("tells the agent, in the published help, that this is what the skill-name 409 means", () => {
    // TEST-540: the instruction the server's 409 gives has to name a command
    // `docs/cli.md` documents, and this description is what `docs/cli.md`
    // publishes.
    expect(unarchiveCommand.description).toContain("409");
    expect(unarchiveCommand.description).toContain("frees its name");
  });
});
