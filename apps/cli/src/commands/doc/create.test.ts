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

  it("creates a pinned view in one request — SPEC.md §11's promise, on the wire", async () => {
    // The command from the verb's own example, minus the body: what an agent
    // types for "pin me a view of unresolved finance threads".
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      flags: {
        type: "view",
        title: "Unresolved finance",
        folder: "views",
        evergreen: "true",
        pinned: "true",
        order: "4",
        query: ["type=thread", "status=open", "tag=finance"],
      },
      actor: "agent",
    });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      type: "view",
      title: "Unresolved finance",
      folder: "views",
      evergreen: true,
      pinned: true,
      // A YAML number, not a quoted one: the board sorts on it.
      order: 4,
      query: { type: "thread", status: "open", tag: "finance" },
    });
  });

  it("sends what the board's own new-column creator sends", async () => {
    // `apps/ui/src/board/newList.ts#columnRequest`: a CLI-created column must
    // not be a second dialect of the one document type.
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, {
      flags: {
        type: "view",
        title: "Todos",
        folder: "views",
        evergreen: "true",
        pinned: "true",
        order: "5",
        query: ["type=note"],
        column: "todos/board",
      },
    });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    expect(Object.keys(JSON.parse(stub.requests[0]?.body ?? "") as object).sort()).toEqual(
      ["type", "title", "folder", "evergreen", "pinned", "order", "query", "column"].sort(),
    );
  });

  it("omits every view key the caller did not name", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    const harness = stubContext(stub, { flags: { type: "note", title: "T", pinned: "false" } });

    await runDocCreate(harness.context, { stdinIsBodySource: false });

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      type: "note",
      title: "T",
      pinned: false,
    });
  });

  it("refuses a malformed view flag before any request", async () => {
    const stub = await startStubServer(jsonResponder(201, CREATED));
    for (const flags of [
      { order: "first" },
      { column: "nonsense" },
      { pinned: "yes" },
      { query: ["type"] },
    ]) {
      const harness = stubContext(stub, { flags: { type: "view", title: "T", ...flags } });
      const error: unknown = await runDocCreate(harness.context, {
        stdinIsBodySource: false,
      }).catch((cause: unknown) => cause);
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    }
    expect(stub.requests).toHaveLength(0);
  });

  it("documents the body sources and the inbox-first default", () => {
    const text = `${createCommand.description ?? ""}`;
    expect(text).toContain("stdin");
    expect(text).toContain("inbox");
    expect(createCommand.examples.length).toBeGreaterThan(0);
  });

  // CLI-050 / SERVER-122 Decision 1. The root a document lands in is the
  // server's answer: an omitted `folder` files it in the root the `type`
  // declares, and an explicit `folder` always wins. The CLI's whole part in
  // that is to send `type` and `folder` exactly as typed — so these assert the
  // *request*, and would go red the moment this verb started defaulting,
  // rewriting or refusing a folder per type.
  describe("routes nothing itself — the type's root is the server's answer", () => {
    it("sends no `folder` for an agent-def, so the agent-def root files it", async () => {
      const stub = await startStubServer(
        jsonResponder(201, {
          doc: { ...DOC, path: ".claude/agents/analyst.md" },
          warnings: [],
        }),
      );
      const harness = stubContext(stub, {
        flags: { type: "agent-def", title: "Analyst" },
        actor: "agent",
      });

      await runDocCreate(harness.context, { stdinIsBodySource: false });

      expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
        type: "agent-def",
        title: "Analyst",
      });
      // The reported path is the server's, never one the CLI assembled.
      expect(harness.stdout()).toBe("created doc_a1b2c3 — .claude/agents/analyst.md\n");
    });

    it("reports the agent-def's real path under --json too", async () => {
      const created = { doc: { ...DOC, path: ".claude/agents/analyst.md" }, warnings: [] };
      const stub = await startStubServer(jsonResponder(201, created));
      const harness = stubContext(stub, {
        flags: { type: "agent-def", title: "Analyst" },
        json: true,
      });

      await runDocCreate(harness.context, { stdinIsBodySource: false });

      expect(JSON.parse(harness.stdout())).toEqual(created);
    });

    it("passes a declared root named outright straight through", async () => {
      const stub = await startStubServer(jsonResponder(201, CREATED));
      const harness = stubContext(stub, {
        flags: { type: "agent-def", title: "Critic", folder: ".claude/agents" },
      });

      await runDocCreate(harness.context, { stdinIsBodySource: false });

      expect(JSON.parse(stub.requests[0]?.body ?? "")).toMatchObject({
        folder: ".claude/agents",
      });
    });

    it("lets an explicit folder win, so a document *about* a persona stays expressible", async () => {
      const stub = await startStubServer(jsonResponder(201, CREATED));
      const harness = stubContext(stub, {
        flags: { type: "agent-def", title: "About Analyst", folder: "inbox" },
      });

      await runDocCreate(harness.context, { stdinIsBodySource: false });

      // Not dropped, not rewritten to the type's root, not refused here.
      expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
        type: "agent-def",
        title: "About Analyst",
        folder: "inbox",
      });
    });

    it("surfaces a type/root mismatch as the server's own words", async () => {
      const stub = await startStubServer(
        jsonResponder(400, {
          code: "bad_request",
          message: "that root holds one kind of document, and this is not it",
          issues: [{ path: "folder", message: ".claude/agents indexes every file as agent-def" }],
        }),
      );
      const harness = stubContext(stub, {
        flags: { type: "note", title: "Wrong", folder: ".claude/agents" },
      });

      const error: unknown = await runDocCreate(harness.context, {
        stdinIsBodySource: false,
      }).catch((cause: unknown) => cause);

      expect(exitCodeFor(error)).toBe(ExitCode.serverError);
      expect(String(error)).toContain("that root holds one kind of document");
      expect(JSON.parse(stub.requests[0]?.body ?? "")).toMatchObject({
        type: "note",
        folder: ".claude/agents",
      });
    });

    it("sends every other type byte for byte as it did before", async () => {
      // The falsification guard for the change above: had routing been added
      // here, one of these would carry a folder it was never given.
      const stub = await startStubServer(jsonResponder(201, CREATED));
      for (const type of ["note", "view", "template", "skill", "todos/todo"]) {
        const harness = stubContext(stub, { flags: { type, title: "T" } });
        await runDocCreate(harness.context, { stdinIsBodySource: false });
      }

      const bodies = stub.requests.map((request) => JSON.parse(request.body ?? "") as unknown);
      expect(bodies).toEqual([
        { type: "note", title: "T" },
        { type: "view", title: "T" },
        { type: "template", title: "T" },
        { type: "skill", title: "T" },
        { type: "todos/todo", title: "T" },
      ]);
    });

    // A thread is the one type `allocatePath` places *before* `folder` is
    // consulted (`apps/server/src/docs/create.ts`), so the help's two rules are
    // both false of it — measured, not reasoned: `--type thread --folder
    // finance` lands at `data/threads/th_….md`. The CLI's part is unchanged
    // regardless: it sends what it was given, so the server can still refuse a
    // folder that names nothing.
    it("sends a thread's folder unchanged, even though it decides nothing", async () => {
      const stub = await startStubServer(
        jsonResponder(201, {
          doc: {
            ...DOC,
            frontmatter: { ...DOC.frontmatter, id: "th_a1b2c3", type: "thread" },
            path: "data/threads/th_a1b2c3.md",
          },
          warnings: [],
        }),
      );
      const harness = stubContext(stub, {
        flags: { type: "thread", title: "Fin thread", folder: "finance" },
      });

      await runDocCreate(harness.context, { stdinIsBodySource: false });

      expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
        type: "thread",
        title: "Fin thread",
        folder: "finance",
      });
      expect(harness.stdout()).toBe("created th_a1b2c3 — data/threads/th_a1b2c3.md\n");
    });

    it("says in the help which root each type lands in, and who wins", () => {
      const text = `${createCommand.description ?? ""}`;
      // The amended sentence: inbox-first is stated as the ordinary case, not
      // as the rule for every type.
      expect(text).toContain("the root its `--type` declares");
      expect(text).toContain("`.claude/agents/`");
      expect(text).toContain("**An explicit `--folder` wins over that default**");
      // The two types the two rules are *not* true of, each said outright
      // rather than left to be inferred from the general sentence (PR #49
      // review, third pass): a thread is placed by neither, and a skill's own
      // root cannot be named.
      expect(text).toContain("**`--type thread` is placed by neither rule**");
      expect(text).toContain("`data/threads/<id>.md`");
      expect(text).toContain("a skill created with no `--folder` lands in the inbox");
      // `--type skill` is stated rather than left ambiguous (SERVER-122
      // Decision 2): genesis is owned by `corpus skill create`.
      expect(text).toContain("`corpus skill create`");

      const folderFlag = createCommand.flags.find((flag) => flag.name === "folder");
      expect(folderFlag?.description).toContain("`.claude/agents`");
      expect(folderFlag?.description).toContain("`data/threads/<id>.md`");
    });

    // SERVER-123: the example promises a profile Claude Code actually loads,
    // and it may promise that only because the *server* writes `name` and
    // `description` with the document. The claim is pinned so that a future
    // edit which drops either field leaves this example visibly overclaiming.
    it("claims of the persona example only what SERVER-123 makes true", () => {
      const example = createCommand.examples.find((entry) =>
        entry.command.includes("--type agent-def"),
      );

      expect(example?.description).toContain("`.claude/agents/analyst.md`");
      expect(example?.description).toContain("SPEC.md §7");
      expect(example?.description).toContain("`name`, derived from the filename");
      expect(example?.description).toContain("`description`, defaulted to the title");
      // The old wording cited §11 — a section that exists, so `spec:check`
      // passed it, and that says nothing about the one file both readers share.
      expect(example?.description).not.toContain("SPEC.md §11");
      expect(example?.description).not.toContain("no separate registry");
    });
  });
});
