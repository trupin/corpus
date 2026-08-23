import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, ServerResponseError } from "../../errors.js";
import { collectRegistryProblems } from "../../registry/validate.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { boardTopic } from "./index.js";
import { orderCommand, runBoardOrder, summaryLine } from "./order.js";

/**
 * The verb is a thin client over `POST /api/boards/order`, so what these assert
 * is what the CLI itself decides: the body it sends, the order it reports in,
 * and the summary line — which is where rider 2's "in one commit" becomes
 * something a caller can check rather than something the tool asserts.
 *
 * That the commit really is one commit is not provable here. The auto-commit is
 * the server's act, `apps/cli` may not depend on `apps/server` (CLAUDE.md
 * dependency direction), and a stub that reports one sha proves only that the
 * stub was written to. The proof is real `git log` output against a real
 * workspace, in CLI-063's E2E verification log.
 */

afterEach(closeStubServers);

const RESULT = {
  boards: [
    { id: "doc_inbox", order: 1, changed: true },
    { id: "doc_attention", order: 2, changed: false },
    { id: "doc_files", order: 3, changed: true },
  ],
  commit: "9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f60718293",
  warnings: [],
};

const ARGS = { id: ["doc_inbox", "doc_attention", "doc_files"] };

describe("corpus board order", () => {
  it("posts the ids as one list, in the order given, in one request", async () => {
    const stub = await startStubServer(jsonResponder(200, RESULT));

    const harness = stubContext(stub, { args: ARGS });
    await runBoardOrder(harness.context);

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.path).toBe("/api/boards/order");
    // A list, never `{id, order}` pairs: the positions are the list's own order,
    // so nothing here computes a number the server would have to agree with.
    expect(JSON.parse(stub.requests[0]?.body ?? "null")).toEqual({
      boards: ["doc_inbox", "doc_attention", "doc_files"],
    });
  });

  it("prints the position each board now carries, whether it moved, and the single commit", async () => {
    const stub = await startStubServer(jsonResponder(200, RESULT));

    const harness = stubContext(stub, { args: ARGS });
    await runBoardOrder(harness.context);

    expect(harness.stdout()).toBe(
      [
        "doc_inbox      1  moved",
        "doc_attention  2  unchanged",
        "doc_files      3  moved",
        `ordered 3 boards — 2 boards moved, in one commit ${RESULT.commit}`,
        "",
      ].join("\n"),
    );
  });

  it("emits the server's result unreshaped under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, RESULT));

    const harness = stubContext(stub, { args: ARGS, json: true });
    await runBoardOrder(harness.context);

    expect(harness.stdout().trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(harness.stdout())).toEqual(RESULT);
  });

  it("sends the actor, because the commit's author is the audit trail", async () => {
    const stub = await startStubServer(jsonResponder(200, RESULT));

    const harness = stubContext(stub, { args: ARGS, actor: "agent" });
    await runBoardOrder(harness.context);

    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
  });

  it("shows a refusal in the route's own words rather than swallowing it", async () => {
    // A view document has no `order` (rider 2), and the route says so. The CLI
    // restates none of that — one copy of the rule, on the server.
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 400, {
        code: "bad_request",
        message: "`doc_view1` is not a board, and only a board has a position on the bar.",
        issues: [{ path: "body.boards.0", message: "doc_view1 is a `type: view` document" }],
      });
    });

    const harness = stubContext(stub, { args: { id: ["doc_view1", "doc_inbox"] } });
    const error = await runBoardOrder(harness.context).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ServerResponseError);
    expect((error as ServerResponseError).exitCode).toBe(ExitCode.serverError);
    expect((error as ServerResponseError).message).toContain("is not a board");
    // The validation issues survive to the caller: `--json` renders them at
    // `.error.details`, and a person sees them under the message.
    expect((error as ServerResponseError).details).toEqual([
      { path: "body.boards.0", message: "doc_view1 is a `type: view` document" },
    ]);
    expect(harness.stdout()).toBe("");
  });

  it("surfaces a 404 for an id that names no document", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no document with id doc_nosuch" });
    });

    const harness = stubContext(stub, { args: { id: ["doc_nosuch"] } });
    await expect(runBoardOrder(harness.context)).rejects.toMatchObject({ code: "not_found" });
    // All or nothing: nothing is printed for a refused reorder, because there is
    // no partial order for a caller to read.
    expect(harness.stdout()).toBe("");
  });
});

describe("the summary line", () => {
  it("names the commit when there is one, and counts the boards that moved", () => {
    expect(summaryLine(RESULT)).toBe(
      `ordered 3 boards — 2 boards moved, in one commit ${RESULT.commit}`,
    );
  });

  it("says nothing was written when the bar was already in that order", () => {
    // A board already at the number it would be given is not written, so a bar
    // dragged back where it started makes no commit and stamps no `updated`.
    expect(
      summaryLine({
        boards: [
          { id: "doc_a", order: 1, changed: false },
          { id: "doc_b", order: 2, changed: false },
        ],
        commit: null,
        warnings: [],
      }),
    ).toBe("ordered 2 boards — none moved, so nothing was written");
  });

  it("never claims a commit it has no sha for, and carries the warning that explains it", () => {
    expect(
      summaryLine({
        boards: [{ id: "doc_a", order: 1, changed: true }],
        commit: null,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
      }),
    ).toBe(
      "ordered 1 board — 1 board moved, not committed — warning: commit_failed (pre-commit hook rejected the commit)",
    );
  });
});

describe("the board topic", () => {
  it("is a valid registry topic", () => {
    expect(collectRegistryProblems({ summary: "s.", commands: [], topics: [boardTopic] })).toEqual(
      [],
    );
  });

  it("holds exactly one verb, because one act has the bar as its subject", () => {
    // A `corpus board create` beside `corpus doc create --type board` would be
    // two ways to make one thing. The topic's rule is in its own description.
    expect(boardTopic.commands.map((command) => command.name)).toEqual(["order"]);
  });

  it("takes one or more required ids and no flags", () => {
    expect(orderCommand.requiresWorkspace).not.toBe(false);
    expect(orderCommand.args).toEqual([
      {
        name: "id",
        required: true,
        variadic: true,
        description:
          "The boards, in the order the bar should be in — first tab first. Each named once.",
      },
    ]);
    expect(orderCommand.flags).toEqual([]);
  });

  it("says why it exists rather than a `doc edit --order` per board", () => {
    expect(orderCommand.description).toContain("corpus doc edit <id> --order N");
    expect(orderCommand.description).toContain("in one commit");
    expect(orderCommand.description).toContain("All or nothing");
  });
});
