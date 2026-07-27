import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { replyCommand, runThreadReply } from "./reply.js";

const ARGS = { id: "th_a1b2c3" };

const APPENDED = {
  thread: {
    id: "th_a1b2c3",
    title: 'Re: "assume a 30-year fixed"',
    status: "open",
    parent: "doc_a1b2c3",
    anchor: "a_1",
    agent: "engaged",
    created: "2026-07-27T10:00:00Z",
    updated: "2026-07-27T10:05:00Z",
    turnCount: 2,
    lastAuthor: "agent",
    lastTs: "2026-07-27T10:05:00Z",
  },
  turn: { author: "agent", ts: "2026-07-27T10:05:00Z", body: "filed it" },
  eventId: null,
  warnings: [],
};

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
  JSON.parse(raw ?? "{}") as Record<string, unknown>;

afterEach(closeStubServers);

describe("corpus thread reply", () => {
  it("appends a heredoc turn as the agent and names the new turn's timestamp", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    await runThreadReply(harness.context, { stdin: pipe("filed it\n"), stdinIsBodySource: true });

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/threads/th_a1b2c3/turns");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(bodyOf(request?.body)).toEqual({ body: "filed it\n" });
    expect(harness.stdout()).toBe("replied to th_a1b2c3 — turn 2026-07-27T10:05:00Z\n");
  });

  it("names the enqueued event when the server enqueued one", async () => {
    const stub = await startStubServer(jsonResponder(201, { ...APPENDED, eventId: "evt_9f2a" }));
    const harness = stubContext(stub, { args: ARGS, flags: { message: "@agent look" } });

    await runThreadReply(harness.context);

    expect(harness.stdout()).toBe(
      "replied to th_a1b2c3 — turn 2026-07-27T10:05:00Z (queued evt_9f2a)\n",
    );
  });

  it("takes the body from -m, from --file and from stdin, with -m winning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-c003-reply-"));
    await writeFile(join(dir, "answer.md"), "from the file", "utf8");
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    const inline = stubContext(stub, {
      args: ARGS,
      flags: { message: "from -m", file: "answer.md" },
      cwd: dir,
    });
    await runThreadReply(inline.context, { stdin: pipe("from stdin"), stdinIsBodySource: true });

    const fromFile = stubContext(stub, { args: ARGS, flags: { file: "answer.md" }, cwd: dir });
    await runThreadReply(fromFile.context, { stdin: pipe("from stdin"), stdinIsBodySource: true });

    const fromStdin = stubContext(stub, { args: ARGS });
    await runThreadReply(fromStdin.context, { stdin: pipe("from stdin"), stdinIsBodySource: true });

    expect(stub.requests.map((request) => bodyOf(request.body)["body"])).toEqual([
      "from -m",
      "from the file",
      "from stdin",
    ]);
  });

  it("passes a fenced form block through byte for byte", async () => {
    const body = "Here:\n\n```form\nfields:\n  - name: rate\n```\n\n~~~\nnested fence\n~~~\n";
    const stub = await startStubServer(jsonResponder(201, APPENDED));
    const harness = stubContext(stub, { args: ARGS });

    await runThreadReply(harness.context, { stdin: pipe(body), stdinIsBodySource: true });

    expect(bodyOf(stub.requests[0]?.body)["body"]).toBe(body);
  });

  it("is a usage error on an empty body — never a request the contract will reject", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));

    const inline = stubContext(stub, { args: ARGS, flags: { message: "" } });
    const first: unknown = await runThreadReply(inline.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );
    expect(exitCodeFor(first)).toBe(ExitCode.usageError);

    const piped = stubContext(stub, { args: ARGS });
    const second: unknown = await runThreadReply(piped.context, {
      stdin: pipe(""),
      stdinIsBodySource: true,
    }).catch((cause: unknown) => cause);
    expect(exitCodeFor(second)).toBe(ExitCode.usageError);

    expect(stub.requests).toHaveLength(0);
  });

  it("reports an unknown thread as a clean exit 5", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no thread th_zzzzzzzz" });
    });
    const harness = stubContext(stub, { args: { id: "th_zzzzzzzz" }, flags: { message: "x" } });

    const error: unknown = await runThreadReply(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("th_zzzzzzzz");
    expect(String(error)).not.toContain("at ");
  });

  it("emits the whole response under --json", async () => {
    const stub = await startStubServer(jsonResponder(201, APPENDED));
    const harness = stubContext(stub, { args: ARGS, flags: { message: "filed it" }, json: true });

    await runThreadReply(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(APPENDED);
  });

  it("documents the heredoc form and §8's participation rules", () => {
    const text = `${replyCommand.description ?? ""}`;
    expect(text).toContain("heredoc");
    expect(text).toContain("@agent");
  });
});
