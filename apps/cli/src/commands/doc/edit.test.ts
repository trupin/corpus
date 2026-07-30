import { RESERVED_FRONTMATTER_KEYS } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError } from "../../errors.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
} from "../../testing/stub-server.js";
import { pipe } from "../../testing/stdin.js";
import {
  describeAnchors,
  editCommand,
  instantNow,
  mergeTags,
  parseExtraFlags,
  parseExtraValue,
  runDocEdit,
} from "./edit.js";
import { archived, DOC } from "./fixtures.js";

const ARGS = { id: "doc_a1b2c3" };
const UPDATED = { doc: DOC, anchors: { remapped: [], orphaned: [] }, warnings: [] };

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
  JSON.parse(raw ?? "{}") as Record<string, unknown>;

/** The actionable follow-up line, which is where the refusal names the verb. */
const errorHint = (error: unknown): string => (isCliError(error) ? (error.hint ?? "") : "");

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
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { status: "resolved", due: "2026-09-01", evergreen: "false" },
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(bodyOf(stub.requests[1]?.body)).toEqual({
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

  it("refuses --status open on an archived document and names the unarchive verb", async () => {
    // CLI-017 / Adjudication 13: the half-state — frontmatter `open`, folder
    // still in `.claude/skills-archived/`, name still 409-blocked — is the bug.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: ARGS, flags: { status: "open" } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is archived");
    expect(errorHint(error)).toContain("corpus doc unarchive doc_a1b2c3");
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]); // nothing written
    expect(harness.stdout()).toBe("");
  });

  it("refuses --status resolved on an archived document too — the same half-state", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: ARGS, flags: { status: "resolved" } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("refuses before sending a body, so no half-state is reachable by pairing the flags", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { status: "open", title: "Back in play" },
    });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("new body"),
      stdinIsBodySource: true,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests.filter((request) => request.method === "PUT")).toHaveLength(0);
  });

  it("still lets an archived document be re-archived — the guard is narrow", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: ARGS, flags: { status: "archived" } });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(bodyOf(stub.requests[1]?.body)).toEqual({ status: "archived" });
  });

  it("leaves every status edit on a non-archived document exactly as it was", async () => {
    for (const status of ["open", "resolved", "archived"]) {
      const stub = await startStubServer((request, response) => {
        if (request.method === "GET") return sendJson(response, 200, DOC);
        sendJson(response, 200, UPDATED);
      });
      const harness = stubContext(stub, { args: ARGS, flags: { status } });

      await runDocEdit(harness.context, { stdinIsBodySource: false });

      expect(bodyOf(stub.requests[1]?.body)).toEqual({ status });
      expect(harness.stdout()).toBe("edited doc_a1b2c3\n");
    }
  });

  it("reads the document once when --status and --add-tag are used together", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { status: "resolved", "add-tag": ["housing"] },
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
    expect(bodyOf(stub.requests[1]?.body)).toEqual({
      status: "resolved",
      tags: ["finance", "housing"],
    });
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

describe("corpus doc edit --extra", () => {
  it("sends one merge patch carrying only the keys that were named", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { extra: ["width=520", "note=keep it wide"] },
      actor: "agent",
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(stub.requests).toHaveLength(1); // one PUT, no read-modify-write
    expect(stub.requests[0]?.method).toBe("PUT");
    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("agent");
    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      extra: { width: 520, note: "keep it wide" },
    });
  });

  it("writes width as a number, which is the only form the board's reader consumes", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["width=520"] } });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    const extra = bodyOf(stub.requests[0]?.body)["extra"] as Record<string, unknown>;
    expect(extra["width"]).toBe(520);
    expect(typeof extra["width"]).toBe("number");
  });

  it('sends null for a deletion, not the string "null"', async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["width=null"] } });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(stub.requests[0]?.body).toBe('{"extra":{"width":null}}');
  });

  it("combines with a body and the other frontmatter flags in one request", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { title: "Finance", extra: ["width=640"] },
    });

    await runDocEdit(harness.context, { stdin: pipe("body\n"), stdinIsBodySource: true });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      title: "Finance",
      extra: { width: 640 },
      body: "body\n",
    });
  });

  it.each([
    ["title=Nope", "--title"],
    ["status=archived", "--status"],
    ["due=2026-01-01", "--due"],
    ["tags=a", "--add-tag"],
    ["reviewed=2026-01-01T00:00:00Z", "--reviewed"],
    ["evergreen=true", "--evergreen"],
  ])("refuses the reserved key in %s before any request, naming %s", async (entry, flag) => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: [entry] } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is a core frontmatter key");
    expect(errorHint(error)).toContain(flag);
    expect(stub.requests).toHaveLength(0);
  });

  it.each(["id=doc_x", "type=note", "created=2026-01-01T00:00:00Z", "updated=x", "anchors={}"])(
    "refuses %s plainly, since no flag writes it",
    async (entry) => {
      const stub = await startStubServer(jsonResponder(200, UPDATED));
      const harness = stubContext(stub, { args: ARGS, flags: { extra: [entry] } });

      const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
        (cause: unknown) => cause,
      );

      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(errorHint(error)).toContain("not user-writable");
      expect(stub.requests).toHaveLength(0);
    },
  );

  it("derives the refusal list from the contract, so a key added there is refused too", () => {
    // Not a hand-copied list: every reserved key the contract declares is
    // rejected, including any added after this test was written.
    for (const key of RESERVED_FRONTMATTER_KEYS) {
      expect(() => parseExtraFlags([`${key}=x`]), key).toThrow(/core frontmatter key/);
    }
  });

  it("is a usage error when the pair has no `=` or no key", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    for (const entry of ["width", "=520"]) {
      const harness = stubContext(stub, { args: ARGS, flags: { extra: [entry] } });
      const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
        (cause: unknown) => cause,
      );
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    }
    expect(stub.requests).toHaveLength(0);
  });
});

describe("the --extra value grammar", () => {
  it("is total: every input maps to exactly one JSON value", () => {
    expect(parseExtraValue("null")).toBeNull();
    expect(parseExtraValue("true")).toBe(true);
    expect(parseExtraValue("false")).toBe(false);
    expect(parseExtraValue("520")).toBe(520);
    expect(parseExtraValue("-1.5")).toBe(-1.5);
    expect(parseExtraValue("1e3")).toBe(1000);
    expect(parseExtraValue("0")).toBe(0);
    expect(parseExtraValue("wide")).toBe("wide");
    expect(parseExtraValue("")).toBe("");
  });

  it("keeps a non-canonical number as the string it looks like", () => {
    // `007` is an identifier, not arithmetic; `1.` and `+1` are not JSON numbers.
    expect(parseExtraValue("007")).toBe("007");
    expect(parseExtraValue("1.")).toBe("1.");
    expect(parseExtraValue("+1")).toBe("+1");
    expect(parseExtraValue("0x10")).toBe("0x10");
    expect(parseExtraValue("Infinity")).toBe("Infinity");
  });

  it("takes a JSON string literal as its contents — the way to force a string", () => {
    expect(parseExtraValue('"520"')).toBe("520");
    expect(parseExtraValue('"null"')).toBe("null");
    expect(parseExtraValue('"true"')).toBe("true");
    expect(parseExtraValue('"a\\"b"')).toBe('a"b');
  });

  it("falls back to the verbatim string when the quoting is not valid JSON", () => {
    expect(parseExtraValue('"unclosed')).toBe('"unclosed');
    expect(parseExtraValue('"a" "b"')).toBe('"a" "b"');
    expect(parseExtraValue('{"a":1}')).toBe('{"a":1}');
  });

  it("splits on the first `=` only, so a value may contain one", () => {
    expect(parseExtraFlags(["filter=type=note"])).toEqual({ filter: "type=note" });
  });

  it("lets the last assignment of a key win", () => {
    expect(parseExtraFlags(["width=1", "width=2"])).toEqual({ width: 2 });
  });

  it("sends nothing at all when the flag is absent", () => {
    expect(parseExtraFlags([])).toBeUndefined();
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
