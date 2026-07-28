import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { pipe } from "../../testing/stdin.js";
import { describeAnchors, editCommand, instantNow, mergeTags, runDocEdit } from "./edit.js";
import { DOC } from "./fixtures.js";

const ARGS = { id: "doc_a1b2c3" };
const UPDATED = { doc: DOC, anchors: { remapped: [], orphaned: [] }, warnings: [] };

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
  JSON.parse(raw ?? "{}") as Record<string, unknown>;

afterEach(closeStubServers);

describe("corpus doc edit", () => {
  it("sends the piped body and prints one line", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runDocEdit(harness.context, { stdin: pipe("new body\n"), stdinIsBodySource: true });

    const [request] = stub.requests;
    expect(request?.method).toBe("PUT");
    expect(request?.path).toBe("/api/docs/doc_a1b2c3");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(bodyOf(request?.body)).toEqual({ body: "new body\n" });
    expect(harness.stdout()).toBe("edited doc_a1b2c3\n");
  });

  it("sends NO body key for a frontmatter-only edit — an empty body would wipe the document", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { title: "New title" } });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({ title: "New title" });
    expect(bodyOf(stub.requests[0]?.body)).not.toHaveProperty("body");
  });

  it("stamps --reviewed with an instant, not with true", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { reviewed: true } });

    await runDocEdit(harness.context, {
      stdinIsBodySource: false,
      now: () => Date.parse("2026-07-27T10:07:12.999Z"),
    });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({ reviewed: "2026-07-27T10:07:12Z" });
  });

  it("passes --status, --due and --evergreen through as the fields they are", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { status: "resolved", due: "2026-09-01", evergreen: "false" },
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      status: "resolved",
      due: "2026-09-01",
      evergreen: false,
    });
  });

  it("rejects a status outside the contract's enum before sending anything", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { status: "done" } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("reads the current tags before merging --add-tag and --remove-tag", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { "add-tag": ["housing"], "remove-tag": ["finance"] },
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
    expect(bodyOf(stub.requests[1]?.body)).toEqual({ tags: ["housing"] });
  });

  it("issues exactly one request when no tag flag is used, so a lock conflict is not retried", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 423, {
        code: "locked",
        message: "document is locked by user",
        lock: { docId: "doc_a1b2c3", holder: "user", acquired: "2026-07-27T10:00:00Z", ttl: 120 },
      });
    });
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("new body"),
      stdinIsBodySource: true,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("locked by user");
    expect(stub.requests).toHaveLength(1);
    expect(harness.stdout()).toBe("");
  });

  it("is a usage error when nothing at all was named", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("nothing to change");
    expect(stub.requests).toHaveLength(0);
  });

  it("reports the anchor reconciliation and passes it through untouched under --json", async () => {
    const anchors = { remapped: ["a_1", "a_2"], orphaned: ["a_3"] };
    const doc = {
      ...DOC,
      anchors: [
        {
          anchorId: "a_3",
          selector: { exact: "gone", prefix: "", suffix: "" },
          threadId: "th_x9y8",
          threadStatus: "open" as const,
          range: null,
          orphaned: true,
        },
      ],
    };
    const stub = await startStubServer(jsonResponder(200, { doc, anchors, warnings: [] }));

    const human = stubContext(stub, { args: ARGS });
    await runDocEdit(human.context, { stdin: pipe("rewritten"), stdinIsBodySource: true });
    expect(human.stdout()).toBe("edited doc_a1b2c3 — 2 anchors remapped, 1 orphaned (th_x9y8)\n");

    const machine = stubContext(stub, { args: ARGS, json: true });
    await runDocEdit(machine.context, { stdin: pipe("rewritten"), stdinIsBodySource: true });
    expect(JSON.parse(machine.stdout())).toEqual({ doc, anchors, warnings: [] });
  });

  it("folds a §14 warning onto the same single line", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        ...UPDATED,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
      }),
    );
    const harness = stubContext(stub, { args: ARGS });

    await runDocEdit(harness.context, { stdin: pipe("x"), stdinIsBodySource: true });

    expect(harness.stdout()).toBe(
      "edited doc_a1b2c3 — warning: commit_failed (pre-commit hook rejected the commit)\n",
    );
  });
});

describe("edit helpers", () => {
  it("merges tags with removal winning over addition", () => {
    expect(mergeTags(["a", "b"], ["c"], ["a"])).toEqual(["b", "c"]);
    expect(mergeTags(["a"], ["a"], [])).toEqual(["a"]);
    expect(mergeTags(["a"], ["b"], ["b"])).toEqual(["a"]);
  });

  it("removing a tag the document does not carry leaves the list alone", () => {
    expect(mergeTags(["a", "b"], [], ["c"])).toEqual(["a", "b"]);
    expect(mergeTags([], [], ["c"])).toEqual([]);
  });

  it("states the accepted read-modify-write race where a caller will read it", () => {
    // CLI-008 item 3 is WAIVED-with-rationale: there is no conditional write to
    // mitigate with, so the hazard is documented instead — in the help, which is
    // what `docs/cli.md` publishes.
    expect(editCommand.description).toContain("no conditional write");
  });

  it("writes instants to the second, like the frontmatter the server stamps", () => {
    expect(instantNow(() => Date.parse("2026-07-19T10:07:12.999Z"))).toBe("2026-07-19T10:07:12Z");
  });

  it("says nothing when no anchor moved", () => {
    expect(describeAnchors({ remapped: [], orphaned: [] }, DOC)).toBe("");
  });

  it("falls back to the anchor id when the response carries no thread for it", () => {
    expect(describeAnchors({ remapped: [], orphaned: ["a_9"] }, DOC)).toBe(" — 1 orphaned (a_9)");
  });
});
