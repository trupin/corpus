import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { pipe } from "../../testing/stdin.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { createCommand, runThreadCreate } from "./create.js";

const THREAD = {
  id: "th_a1b2c3",
  title: '"assume a 30-year fixed at 6.1%"',
  created: "2026-07-31T10:00:00Z",
  updated: "2026-07-31T10:00:00Z",
  status: "open",
  tags: [],
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "requested",
  turns: [{ author: "user", ts: "2026-07-31T10:00:00Z", body: "@agent is this still right?" }],
};

const ANCHORED = { thread: THREAD, anchorId: "anc_k4f7", eventId: null, warnings: [] };

const WHOLE_DOC = {
  thread: { ...THREAD, anchor: null },
  anchorId: null,
  eventId: null,
  warnings: [],
};

const STANDALONE = {
  thread: { ...THREAD, parent: null, anchor: null },
  anchorId: null,
  eventId: null,
  warnings: [],
};

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
  JSON.parse(raw ?? "{}") as Record<string, unknown>;

afterEach(closeStubServers);

describe("corpus thread create", () => {
  it("anchors on a quote and names the anchor the server wrote", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));
    const harness = stubContext(stub, {
      flags: {
        parent: "doc_a1b2c3",
        quote: "assume a 30-year fixed at 6.1%",
        message: "@agent is this still right?",
      },
    });

    await runThreadCreate(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/threads");
    expect(bodyOf(request?.body)).toEqual({
      body: "@agent is this still right?",
      parent: "doc_a1b2c3",
      selector: { exact: "assume a 30-year fixed at 6.1%" },
    });
    expect(harness.stdout()).toBe("created th_a1b2c3 — anchored at anc_k4f7 on doc_a1b2c3\n");
  });

  it("sends the quote byte for byte and never reads the parent to build context", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));
    const harness = stubContext(stub, {
      flags: { parent: "doc_a1b2c3", quote: "  6.1%  ", message: "why" },
    });

    await runThreadCreate(harness.context);

    // One request: no `GET /api/docs/{id}` to look the quote up, and the
    // surrounding whitespace survives — the anchor resolves on exact characters.
    expect(stub.requests).toHaveLength(1);
    expect(bodyOf(stub.requests[0]?.body)["selector"]).toEqual({ exact: "  6.1%  " });
  });

  it("passes --prefix and --suffix through as the selector's context", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));
    const harness = stubContext(stub, {
      flags: {
        parent: "doc_a1b2c3",
        quote: "6.1%",
        prefix: "fixed at ",
        suffix: " which",
        message: "which one is this?",
      },
    });

    await runThreadCreate(harness.context);

    expect(bodyOf(stub.requests[0]?.body)["selector"]).toEqual({
      exact: "6.1%",
      prefix: "fixed at ",
      suffix: " which",
    });
  });

  it("comments on a whole document when no quote is given", async () => {
    const stub = await startStubServer(jsonResponder(201, WHOLE_DOC));
    const harness = stubContext(stub, { flags: { parent: "doc_a1b2c3" }, actor: "agent" });

    await runThreadCreate(harness.context, {
      stdin: pipe("I split this into two notes.\n"),
      stdinIsBodySource: true,
    });

    const [request] = stub.requests;
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(bodyOf(request?.body)).toEqual({
      body: "I split this into two notes.\n",
      parent: "doc_a1b2c3",
    });
    expect(harness.stdout()).toBe("created th_a1b2c3 — on doc_a1b2c3 (whole document)\n");
  });

  it("opens a standalone thread when there is no parent either", async () => {
    const stub = await startStubServer(jsonResponder(201, { ...STANDALONE, eventId: "evt_9f2a" }));
    const harness = stubContext(stub, {
      flags: { message: "Where did the Q3 numbers end up?", "requests-agent": "true" },
    });

    await runThreadCreate(harness.context);

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      body: "Where did the Q3 numbers end up?",
      requestsAgent: true,
    });
    expect(harness.stdout()).toBe("created th_a1b2c3 — standalone (queued evt_9f2a)\n");
  });

  it("keeps --requests-agent tri-state: omitted is absent, false is sent", async () => {
    const stub = await startStubServer(jsonResponder(201, STANDALONE));

    const omitted = stubContext(stub, { flags: { message: "a note" } });
    await runThreadCreate(omitted.context);

    const noteOnly = stubContext(stub, {
      flags: { message: "@agent a note", "requests-agent": "false" },
    });
    await runThreadCreate(noteOnly.context);

    expect(stub.requests.map((request) => bodyOf(request.body)["requestsAgent"])).toEqual([
      undefined,
      false,
    ]);

    const wrong = stubContext(stub, { flags: { message: "x", "requests-agent": "yes" } });
    const error: unknown = await runThreadCreate(wrong.context).catch((cause: unknown) => cause);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(2);
  });

  it("sends an explicit --title instead of letting the server derive one", async () => {
    const stub = await startStubServer(jsonResponder(201, WHOLE_DOC));
    const harness = stubContext(stub, {
      flags: { parent: "doc_a1b2c3", title: "Rate assumptions", message: "see above" },
    });

    await runThreadCreate(harness.context);

    expect(bodyOf(stub.requests[0]?.body)["title"]).toBe("Rate assumptions");
  });

  it("surfaces the server's orphaned_anchor warning when the quote does not resolve", async () => {
    const stub = await startStubServer(
      jsonResponder(201, {
        ...ANCHORED,
        warnings: [
          { code: "orphaned_anchor", detail: "anc_k4f7 does not resolve in data/docs/note.md" },
        ],
      }),
    );
    const harness = stubContext(stub, {
      flags: { parent: "doc_a1b2c3", quote: "text that is not there", message: "?" },
    });

    await runThreadCreate(harness.context);

    // Not an error: SPEC.md §6 resolves anchors at render time, so the thread is
    // created and the §14 warning is what tells the caller it is orphaned.
    expect(harness.stdout()).toBe(
      "created th_a1b2c3 — anchored at anc_k4f7 on doc_a1b2c3 — warning: orphaned_anchor " +
        "(anc_k4f7 does not resolve in data/docs/note.md)\n",
    );
  });

  it("refuses a quote with no document to anchor it to, before any request", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));
    const harness = stubContext(stub, { flags: { quote: "6.1%", message: "?" } });

    const error: unknown = await runThreadCreate(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--quote");
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses context with no quote to put it around", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));

    for (const flags of [
      { parent: "doc_a1b2c3", prefix: "fixed at ", message: "?" },
      { parent: "doc_a1b2c3", suffix: " which", message: "?" },
    ]) {
      const harness = stubContext(stub, { flags });
      const error: unknown = await runThreadCreate(harness.context).catch(
        (cause: unknown) => cause,
      );
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    }
    expect(stub.requests).toHaveLength(0);
  });

  it("treats a flag given without a value as a typo, not as an instruction", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));
    const harness = stubContext(stub, { flags: { parent: "doc_a1b2c3", quote: "", message: "?" } });

    const error: unknown = await runThreadCreate(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--quote");
    expect(stub.requests).toHaveLength(0);
  });

  it("is a usage error with no first turn — a thread with no turn is not a thread", async () => {
    const stub = await startStubServer(jsonResponder(201, STANDALONE));
    const harness = stubContext(stub, { flags: { parent: "doc_a1b2c3" } });

    const error: unknown = await runThreadCreate(harness.context, {
      stdinIsBodySource: false,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("reports an unknown parent as a clean exit 5", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 404, { code: "not_found", message: "no document with id doc_zzzzzzzz" });
    });
    const harness = stubContext(stub, { flags: { parent: "doc_zzzzzzzz", message: "?" } });

    const error: unknown = await runThreadCreate(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("doc_zzzzzzzz");
    expect(String(error)).not.toContain("at ");
  });

  it("emits the whole response under --json", async () => {
    const stub = await startStubServer(jsonResponder(201, ANCHORED));
    const harness = stubContext(stub, {
      flags: { parent: "doc_a1b2c3", quote: "6.1%", message: "?" },
      json: true,
    });

    await runThreadCreate(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(ANCHORED);
  });

  /**
   * CLI-032. Until SERVER-071 this help promised that a quote occurring twice
   * "still creates the thread and comes back with the `orphaned_anchor`
   * warning". That is now a `400`, and the CLI's tests run against a stub
   * server, so nothing failed and nothing would have: the help was the only
   * place the change was visible and the only place it could be wrong. These
   * assertions are what makes a future divergence fail rather than mislead.
   */
  describe("the repeated-quote help (SERVER-071)", () => {
    const help = (): string =>
      `${createCommand.description ?? ""} ` +
      createCommand.flags.map((flag) => flag.description).join(" ");

    it("no longer promises a thread for a doubly-occurring quote", () => {
      expect(help()).not.toMatch(/contains twice/i);
      expect(help()).not.toMatch(/more than once[^.]*still creates/i);
    });

    it("says the repeated quote is refused, with the exit code", () => {
      expect(help()).toContain("more than once");
      expect(help()).toContain("**is refused**");
      expect(help()).toContain("exit 5");
    });

    it("still promises a thread for a quote the document does not contain", () => {
      expect(help()).toContain("does not contain");
      expect(help()).toContain("orphaned_anchor");
    });

    it("says how to disambiguate", () => {
      expect(help()).toContain("`--prefix`/`--suffix`");
      expect(help()).toContain("occur exactly once");
      // The flag itself has to carry it too: a caller reading `--help` for one
      // flag does not necessarily read the command's prose.
      const prefix = createCommand.flags.find((flag) => flag.name === "prefix");
      expect(prefix?.description).toContain("Required");
    });
  });

  /**
   * CLI-033. `thread create` is the second of the CLI's two doors onto a written
   * turn (`thread reply` is the other, and the sweep found no third): the first
   * turn of a thread the agent opens is an agent turn like any other, and until
   * this flag existed it too rendered blank.
   */
  describe("--model, the first turn's stated model (SPEC.md §11)", () => {
    it("sends a stated model alongside the first turn", async () => {
      const stub = await startStubServer(jsonResponder(201, WHOLE_DOC));
      const harness = stubContext(stub, {
        actor: "agent",
        flags: { parent: "doc_a1b2c3", message: "I split this into two notes.", model: "opus-4-1" },
      });

      await runThreadCreate(harness.context);

      expect(bodyOf(stub.requests[0]?.body)).toEqual({
        body: "I split this into two notes.",
        parent: "doc_a1b2c3",
        model: "opus-4-1",
      });
    });

    it("sends no model field at all when the flag is absent", async () => {
      const stub = await startStubServer(jsonResponder(201, STANDALONE));
      const harness = stubContext(stub, { actor: "agent", flags: { message: "a note" } });

      await runThreadCreate(harness.context);

      const sent = bodyOf(stub.requests[0]?.body);
      expect(sent).toEqual({ body: "a note" });
      expect(Object.keys(sent)).not.toContain("model");
    });

    it("refuses a blank model, and one on a person's turn, before sending anything", async () => {
      const stub = await startStubServer(jsonResponder(201, STANDALONE));

      const blank = stubContext(stub, { actor: "agent", flags: { message: "x", model: "" } });
      const blankError: unknown = await runThreadCreate(blank.context).catch(
        (cause: unknown) => cause,
      );
      expect(exitCodeFor(blankError)).toBe(ExitCode.usageError);

      const asUser = stubContext(stub, { flags: { message: "x", model: "opus-4-1" } });
      const actorError: unknown = await runThreadCreate(asUser.context).catch(
        (cause: unknown) => cause,
      );
      expect(exitCodeFor(actorError)).toBe(ExitCode.usageError);
      expect(String(actorError)).toContain("only an agent turn names the model that wrote it");

      expect(stub.requests).toHaveLength(0);
    });

    it("declares the same flag `thread reply` declares, and says what it is for", () => {
      const flag = createCommand.flags.find((candidate) => candidate.name === "model");
      expect(flag?.type).toBe("string");
      expect(flag?.description).toContain("**report of what ran**");
      expect(flag?.description).toContain("Only an agent turn names a model");
      const help = createCommand.description ?? "";
      expect(help).toContain("only an agent's turn may carry one");
      expect(help).toContain("no model at all");
    });
  });

  it("documents the three creation shapes and that resolution is the server's", () => {
    const text = `${createCommand.summary} ${createCommand.description ?? ""}`;
    expect(text).toContain("standalone");
    expect(text).toContain("whole document");
    expect(text).toContain("orphaned_anchor");
    expect(text).toContain("heredoc");
    // Prose lands verbatim in `docs/cli.md`, which Prettier then reformats:
    // `*emphasis*` would come back as `_emphasis_` and fail the docs drift check.
    expect(text).not.toMatch(/(^|\s)\*[^*]+\*(\s|$|[.,;])/);
  });
});
