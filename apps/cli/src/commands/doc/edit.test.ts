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
import { pipe, unreadable } from "../../testing/stdin.js";
import {
  describeAnchors,
  editCommand,
  instantNow,
  mergeTags,
  parseExtraFlags,
  parseExtraValue,
  runDocEdit,
} from "./edit.js";
import { ARCHIVED_SKILL, archived, DOC, SKILL } from "./fixtures.js";

const ARGS = { id: "doc_a1b2c3" };
const SKILL_ARGS = { id: "doc_gqyrzvto" };
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

  it("refuses --status open on an archived SKILL and names the unarchive verb", async () => {
    // CLI-017 / Adjudication 13: the half-state — frontmatter `open`, folder
    // still in `.claude/skills-archived/`, name still 409-blocked — is the bug.
    // The fixture is a real skill, with the folder that makes the story true
    // (wave-3 audit, TEST 22).
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: SKILL_ARGS, flags: { status: "open" } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is an archived skill");
    expect(errorHint(error)).toContain("corpus doc unarchive doc_gqyrzvto");
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]); // nothing written
    expect(harness.stdout()).toBe("");
  });

  it("refuses --status resolved on an archived skill too — the same half-state", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: SKILL_ARGS, flags: { status: "resolved" } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("refuses before sending a body, so no half-state is reachable by pairing the flags", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: SKILL_ARGS,
      flags: { status: "open", title: "Back in play" },
    });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("new body"),
      stdinIsBodySource: true,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests.filter((request) => request.method === "PUT")).toHaveLength(0);
  });

  it.each(["open", "resolved"])(
    "refuses --status %s on an archived NOTE without the folder story a note has no part in",
    async (status) => {
      // Wave-3 audit, FIX 15. The refusal stays — SERVER-039 refuses the same
      // `PUT` for every type, so passing it through would only trade a local
      // exit 2 naming a *command* for a server 400 naming an HTTP *route* the
      // CLI-only agent cannot issue. What changes is the message: a note has no
      // folder, and the old text told it it did.
      const stub = await startStubServer((request, response) => {
        if (request.method === "GET") return sendJson(response, 200, archived(DOC));
        sendJson(response, 200, UPDATED);
      });
      const harness = stubContext(stub, { args: ARGS, flags: { status } });

      const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
        (cause: unknown) => cause,
      );

      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(String(error)).toContain("is archived");
      expect(String(error)).not.toContain("skill");
      expect(String(error)).not.toContain("skills-archived");
      expect(errorHint(error)).toContain("corpus doc unarchive doc_a1b2c3");
      expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
    },
  );

  it("tells a skill about its folder and a note about nothing of the kind", async () => {
    // The two messages, side by side, since "honest per type" is the whole fix.
    const forDoc = async (doc: typeof DOC): Promise<string> => {
      const stub = await startStubServer((_request, response) => sendJson(response, 200, doc));
      const harness = stubContext(stub, { args: ARGS, flags: { status: "open" } });
      const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
        (cause: unknown) => cause,
      );
      return `${String(error)} ${errorHint(error)}`;
    };

    expect(await forDoc(ARCHIVED_SKILL)).toContain(".claude/skills-archived/");
    expect(await forDoc(archived(DOC))).not.toContain(".claude/skills-archived/");
    // Both name the same recovery command — that is the point of guarding here.
    expect(await forDoc(archived(DOC))).toContain("corpus doc unarchive");
  });

  it("picks the message off the type, not off where the response says the folder is", async () => {
    // A skill whose status is `archived` while its file still sits under
    // `.claude/skills/` is a half-state; the guard must still refuse there, and
    // must still call it a skill — the folder is what `doc unarchive` will fix.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(SKILL));
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: SKILL_ARGS, flags: { status: "open" } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("still lets an archived skill be re-archived — the guard is narrow", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: SKILL_ARGS, flags: { status: "archived" } });

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

  it("stores an empty value as the empty string rather than dropping the key", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["note="] } });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(stub.requests[0]?.body).toBe('{"extra":{"note":""}}');
  });

  it("passes an odd key through verbatim — only the *reserved* names are refused", async () => {
    // The server owns what an `extra` key may be called; the CLI's only rule is
    // that it may not shadow a core field. A key with a dot, a space or unicode
    // in it is the server's judgement to make, and the wire carries it intact.
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { extra: ["plugin.todos.v=1", "with space=x", "TITLE=not-title", "é=1"] },
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      extra: { "plugin.todos.v": 1, "with space": "x", TITLE: "not-title", é: 1 },
    });
  });

  it("does not drain stdin before a usage error that never needed the body", async () => {
    // Wave-3 audit, CLEAN 54. `unreadable()` rejects on the first read, so a
    // verb that touched the heredoc before validating its flags fails this test
    // with *that* error rather than the usage error the caller should see —
    // which in production is a long piped document consumed and discarded.
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["title=Nope"] } });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: unreadable(),
      stdinIsBodySource: true,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is a core frontmatter key");
    expect(stub.requests).toHaveLength(0);
  });

  it("validates the status enum before draining stdin as well", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { status: "done" } });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: unreadable(),
      stdinIsBodySource: true,
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--status must be one of");
  });
});

describe("`--extra` and the archived-skill guard together (CLI-016 x CLI-017)", () => {
  it("edits an archived skill's extra keys with no read at all — the guard is --status's", async () => {
    // The two features meet on one verb and must not have merged into one rule:
    // `--extra` names no status, so nothing about the document's archived state
    // is its business, and it still costs exactly one request.
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: SKILL_ARGS,
      flags: { extra: ["width=520"] },
      actor: "agent",
    });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    expect(stub.requests.map((request) => request.method)).toEqual(["PUT"]); // no GET
    expect(bodyOf(stub.requests[0]?.body)).toEqual({ extra: { width: 520 } });
    expect(harness.stdout()).toBe("edited doc_gqyrzvto\n");
  });

  it("cannot smuggle a status past the guard through --extra", async () => {
    // `extra.status` is refused locally *and* by the contract's own
    // `ExtraFrontmatterSchema`, so there is no spelling of `--extra` that writes
    // the field `--status` guards — with or without an archived document behind it.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, { args: SKILL_ARGS, flags: { extra: ["status=open"] } });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(errorHint(error)).toContain("--status");
    expect(stub.requests).toHaveLength(0); // refused before even the read
  });

  it("puts the pure flag check first when --extra and --status are both wrong", async () => {
    // Precedence, pinned: `--extra`'s reserved-key refusal costs nothing, the
    // archived check costs a round trip. The cheap, certain error wins, so the
    // caller is told about the flag they can fix without a server in the loop.
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: SKILL_ARGS,
      flags: { status: "open", extra: ["title=Nope"] },
    });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is a core frontmatter key");
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses the pair --status open --extra width=… on an archived skill, writing neither", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, ARCHIVED_SKILL);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: SKILL_ARGS,
      flags: { status: "open", extra: ["width=520"] },
    });

    const error: unknown = await runDocEdit(harness.context, { stdinIsBodySource: false }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is an archived skill");
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
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

  it.each(["1e400", "-1e400", "1E400", "1e999999", "-2.5e308"])(
    "keeps the overflowing literal %s as a string instead of silently deleting the key",
    (raw) => {
      // Wave-3 audit, FIX 1. These *are* canonical JSON number literals whose
      // double is infinite. `JSON.stringify(Infinity)` is `null`, and the
      // server's `extra` patch is RFC 7386, so before the finiteness gate
      // `--extra width=1e400` did not set a huge width — it **removed** `width`.
      expect(parseExtraValue(raw)).toBe(raw);
      expect(typeof parseExtraValue(raw)).toBe("string");
    },
  );

  it("sends an overflowing literal as a string on the wire, never as a deletion", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["width=1e400"] } });

    await runDocEdit(harness.context, { stdinIsBodySource: false });

    // The regression, stated in the only form that can catch it: the serialized
    // body. `{"width":null}` here is the deletion the caller never asked for.
    expect(stub.requests[0]?.body).toBe('{"extra":{"width":"1e400"}}');
  });

  it("takes a finite literal past 2^53 as the number JSON would, losing the digits", () => {
    // Documented rather than refused (wave-3 audit, TEST 25): every JSON parser
    // between here and the file does the same rounding, so refusing would make
    // the CLI stricter than the wire it writes to. The escape hatch is quoting.
    expect(parseExtraValue("9007199254740993")).toBe(9007199254740992);
    expect(parseExtraValue("1e308")).toBe(1e308);
    expect(parseExtraValue('"9007199254740993"')).toBe("9007199254740993");
    // And the flag's own help says so, since that is what `docs/cli.md` carries.
    const extra = editCommand.flags.find((flag) => flag.name === "extra");
    expect(extra?.description).toContain("1e400");
    expect(extra?.description).toContain("2^53");
  });

  it("still takes every finite canonical literal as a number", () => {
    expect(parseExtraValue("1e3")).toBe(1000);
    expect(parseExtraValue("-0")).toBe(-0);
    expect(parseExtraValue("1.5e-3")).toBe(0.0015);
    expect(parseExtraValue("1e-400")).toBe(0); // underflow is finite; it is still a number
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
