import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { pipe } from "../../testing/stdin.js";
import { createCommand, runDocCreate } from "./create.js";
import { DOC } from "./fixtures.js";

const CREATED = { doc: DOC, warnings: [] };

afterEach(closeStubServers);

describe("corpus doc create", () => {
  it("posts every documented flag and prints the new id and path", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      flags: {
        type: "note",
        title: "Mortgage options",
        folder: "finance",
        tags: "finance, housing",
        due: "2026-09-01",
      },
      actor: "user",
    });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/docs");
    expect(request?.headers["x-corpus-author"]).toBe("user");
    expect(JSON.parse(request?.body ?? "")).toEqual({
      type: "note",
      title: "Mortgage options",
      folder: "finance",
      tags: ["finance", "housing"],
      due: "2026-09-01",
    });
    expect(harness.stdout()).toBe("created doc_a1b2c3 — data/docs/finance/mortgage-options.md\n");
  });

  it("omits `body` entirely when no source was given, so the template pre-fills", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, { flags: { type: "note", title: "T" } });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    expect(Object.keys(JSON.parse(stub.requests[0]?.body ?? "") as object)).toEqual([
      "type",
      "title",
    ]);
  });

  it("sends a heredoc body byte for byte", async () => {
    const body = "# Notes\n\n```form\nname: x\n```\n";
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, { flags: { type: "note", title: "T" } });

    await runDocCreate(harness.context, { stdin: pipe(body), stdinIsBodySource: true });

    expect((JSON.parse(stub.requests[0]?.body ?? "") as { body: string }).body).toBe(body);
  });

  it("carries the acting party the dispatcher resolved", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      flags: { type: "note", title: "T" },
      actor: "agent",
    });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
  });

  it("emits the server's response unchanged under --json", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, { flags: { type: "note", title: "T" }, json: true });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    expect(JSON.parse(harness.stdout())).toEqual(CREATED);
  });

  it("refuses to send a request when --type or --title is missing", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, { flags: { title: "T" } });

    const error: unknown = await runDocCreate(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("surfaces the server's answer about an unknown folder verbatim", async () => {
    const stub = await startStubServer(
      jsonResponder(400, {
        code: "bad_request",
        message: "no such folder",
        issues: [{ path: "folder", message: "does/not/exist" }],
      }),
    );
    const harness = stubContext(stub, {
      flags: { type: "note", title: "T", folder: "does/not/exist" },
    });

    const error: unknown = await runDocCreate(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("no such folder");
    // The CLI pre-validated nothing: the request went out as typed.
    expect(JSON.parse(stub.requests[0]?.body ?? "")).toMatchObject({ folder: "does/not/exist" });
  });

  it("documents the body sources and the inbox-first default", () => {
    const text = `${createCommand.description ?? ""}`;
    expect(text).toContain("stdin");
    expect(text).toContain("inbox");
    expect(createCommand.examples.length).toBeGreaterThan(0);
  });
});
