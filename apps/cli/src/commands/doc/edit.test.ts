import { RESERVED_FRONTMATTER_KEYS } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError, renderError, toProblem } from "../../errors.js";
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
  parseExtraFlags,
  parseExtraValue,
  runDocEdit,
} from "./edit.js";
import { ARCHIVED_SKILL, archived, DOC, rekeyed, SKILL } from "./fixtures.js";

const ARGS = { id: "doc_a1b2c3" };
const SKILL_ARGS = { id: "doc_gqyrzvto" };
const UPDATED = { doc: DOC, anchors: { remapped: [], orphaned: [] }, warnings: [] };

/**
 * The key a caller presents on a body write (SPEC.md §7). It is `DOC`'s own, so
 * a test that sends it is spelling out the real loop — read, then write back the
 * version you read — rather than passing a token the fixture never handed out.
 */
const KEY = DOC.key;

/** The line every successful edit ends with: the fresh key for the next write. */
const FRESH_KEY_LINE = `key ${DOC.key}\n`;

/** The document a refusal comes back with: the same one, moved on, with a new key. */
const FRESH_KEY = "c0ffee11223344556677889900aabbccddeeff00112233445566778899aabbcc";
const MOVED_ON = rekeyed({ ...DOC, body: "30-year fixed at 6.4%, survey booked.\n" }, FRESH_KEY);

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
  JSON.parse(raw ?? "{}") as Record<string, unknown>;

/** The actionable follow-up line, which is where the refusal names the verb. */
const errorHint = (error: unknown): string => (isCliError(error) ? (error.hint ?? "") : "");

afterEach(closeStubServers);

describe("corpus doc edit", () => {
  it("sends the piped body with the key it was given, and prints the fresh one back", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { key: KEY }, actor: "agent" });

    await runDocEdit(harness.context, { stdin: pipe("new body\n"), stdinKind: "fifo" });

    const [request] = stub.requests;
    expect(request?.method).toBe("PUT");
    expect(request?.path).toBe("/api/docs/doc_a1b2c3");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    // Echoed verbatim: the CLI never derives, shortens or reshapes a key.
    expect(bodyOf(request?.body)).toEqual({ key: KEY, body: "new body\n" });
    // The fresh key on its own line is what makes a chain of edits need one read
    // at the start rather than one between every pair (SPEC.md §7).
    expect(harness.stdout()).toBe(`edited doc_a1b2c3\n${FRESH_KEY_LINE}`);
  });

  it("sends NO body key for a frontmatter-only edit — an empty body would wipe the document", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { title: "New title" } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({ title: "New title" });
    expect(bodyOf(stub.requests[0]?.body)).not.toHaveProperty("body");
  });

  it("stamps --reviewed with an instant, not with true", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { reviewed: true } });

    await runDocEdit(harness.context, {
      stdinKind: "other",
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

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[1]?.body)).toEqual({
      status: "resolved",
      due: "2026-09-01",
      evergreen: false,
    });
  });

  it("rejects a status outside the contract's enum before sending anything", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { status: "done" } });

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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
      // The key is present so that the guard under test is the archived-skill
      // one: without it the write would be refused a step earlier, for a
      // different reason, and this test would pass while proving nothing.
      flags: { status: "open", title: "Back in play", key: KEY },
    });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("new body"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is an archived skill");
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

      const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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
      const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[1]?.body)).toEqual({ status: "archived" });
  });

  it("leaves every status edit on a non-archived document exactly as it was", async () => {
    for (const status of ["open", "resolved", "archived"]) {
      const stub = await startStubServer((request, response) => {
        if (request.method === "GET") return sendJson(response, 200, DOC);
        sendJson(response, 200, UPDATED);
      });
      const harness = stubContext(stub, { args: ARGS, flags: { status } });

      await runDocEdit(harness.context, { stdinKind: "other" });

      // A status flip names its own delta: no key is sent, and none was asked
      // for (SPEC.md §7).
      expect(bodyOf(stub.requests[1]?.body)).toEqual({ status });
      expect(harness.stdout()).toBe(`edited doc_a1b2c3\n${FRESH_KEY_LINE}`);
    }
  });

  it("still reads once for --status, and sends the tag delta alongside it", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { status: "resolved", "add-tag": ["housing"] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    // The `GET` is `--status`'s alone now: it phrases the archived refusal.
    expect(stub.requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
    expect(bodyOf(stub.requests[1]?.body)).toEqual({
      status: "resolved",
      addTags: ["housing"],
    });
  });

  // SERVER-102: the merge moved to the server, so the wire carries the change
  // rather than a list the client computed from a read that may already be
  // stale. `DOC` carries `tags: ["finance"]`; nothing here consults it.
  it("sends --add-tag/--remove-tag as a delta, in one request and with no read", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, DOC);
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { "add-tag": ["housing"], "remove-tag": ["finance"] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests.map((request) => request.method)).toEqual(["PUT"]);
    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      addTags: ["housing"],
      removeTags: ["finance"],
    });
    // The whole-set field is never sent: it is what loses a concurrent tag.
    expect(JSON.stringify(bodyOf(stub.requests[0]?.body))).not.toContain('"tags"');
  });

  it("issues exactly one request when no tag flag is used, so a refusal is one round trip", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 409, {
        code: "stale_key",
        message: "the key presented names a version this document no longer is",
        doc: MOVED_ON,
      });
    });
    const harness = stubContext(stub, { args: ARGS, flags: { key: KEY }, actor: "agent" });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("new body"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.staleKey);
    expect(stub.requests).toHaveLength(1);
    expect(harness.stdout()).toBe("");
  });

  it("renders a refusal as the two facts it is: what the document says now, and the fresh key", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 409, {
        code: "stale_key",
        message: "the key presented names a version this document no longer is",
        doc: MOVED_ON,
      });
    });
    const harness = stubContext(stub, { args: ARGS, flags: { key: KEY }, actor: "agent" });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("my new body"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    const rendered = renderError(error, { verbose: false });

    // Fact one: what it now says — the body itself, not a summary of it and not
    // a JSON payload with the newlines escaped.
    expect(rendered).toContain("30-year fixed at 6.4%, survey booked.");
    // Fact two: the fresh key, beside the flag it goes in, so the retry is one
    // line below the sentence that asks for it.
    expect(rendered).toContain(`--key ${FRESH_KEY}`);
    // Recoverable from its own message: the next two commands are named, and the
    // retry is called the expected path rather than a failure.
    expect(rendered).toContain("corpus doc show doc_a1b2c3");
    expect(rendered).toContain("Retrying after a re-read is the expected path");
    expect(rendered).toContain("nothing was written");
    // Not a stack trace, and not a payload dump.
    expect(rendered).not.toContain("at Object");
    expect(rendered).not.toContain('"frontmatter"');
  });

  it("gives a refused write its own exit code and asserts nothing changed", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 409, { code: "stale_key", message: "stale", doc: MOVED_ON });
    });
    const harness = stubContext(stub, { args: ARGS, flags: { key: KEY } });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("body"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    // Distinguishable from a usage error (2) and from a server failure (5),
    // because an agent branches on the exit code.
    expect(exitCodeFor(error)).toBe(ExitCode.staleKey);
    expect(exitCodeFor(error)).not.toBe(ExitCode.usageError);
    expect(exitCodeFor(error)).not.toBe(ExitCode.serverError);
    // And the machine reader gets the same two facts structurally.
    const problem = toProblem(error);
    expect(problem.code).toBe("stale_key");
    expect(problem.changed).toBe(false);
    expect(problem.details).toEqual(MOVED_ON);
  });

  it("refuses a body edit that presents no key, before anything is sent", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, actor: "agent" });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("a body nobody asked to overwrite"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    // A usage error, not the stale-key code: the invocation is malformed, the
    // world is not stale, and the two recoveries are different.
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("needs its `--key`");
    expect(errorHint(error)).toContain("corpus doc show doc_a1b2c3");
    expect(errorHint(error)).toContain("--key <key>");
    // Impossible, not discouraged: nothing reached the server.
    expect(stub.requests).toHaveLength(0);
  });

  it("still refuses the body write when other flags would have carried it", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { title: "New title" } });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("and a body too"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it.each([
    ["a truncated key", "3b2ec1f04d75a2c6"],
    ["the document's id", "doc_a1b2c3"],
    ["upper case", "3B2EC1F04D75A2C6EF2B8B9A1F0C4D3E5A6B7C8D9E0F1A2B3C4D5E6F708192A3"],
  ])("refuses %s as a key rather than sending it to be called stale", async (_case, key) => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { key } });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: pipe("body"),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is not a document key");
    expect(stub.requests).toHaveLength(0);
  });

  it("presents a key on a delta-only edit when one is given, and it is checked", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { title: "Renamed", key: KEY } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    // Welcome, and still checked: a caller that always sends what it read needs
    // no rule about which fields are keyed.
    expect(bodyOf(stub.requests[0]?.body)).toEqual({ title: "Renamed", key: KEY });
  });

  it("does not count a bare --key as something to change", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { key: KEY } });

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("nothing to change");
    expect(stub.requests).toHaveLength(0);
  });

  it("is a usage error when nothing at all was named", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS });

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    const human = stubContext(stub, { args: ARGS, flags: { key: KEY } });
    await runDocEdit(human.context, { stdin: pipe("rewritten"), stdinKind: "fifo" });
    expect(human.stdout()).toBe(
      `edited doc_a1b2c3 — 2 anchors remapped, 1 orphaned (th_x9y8)\nkey ${doc.key}\n`,
    );

    const machine = stubContext(stub, { args: ARGS, flags: { key: KEY }, json: true });
    await runDocEdit(machine.context, { stdin: pipe("rewritten"), stdinKind: "fifo" });
    expect(JSON.parse(machine.stdout())).toEqual({ doc, anchors, warnings: [] });
  });

  it("folds a §11 warning onto the same single line", async () => {
    const stub = await startStubServer(
      jsonResponder(200, {
        ...UPDATED,
        warnings: [{ code: "commit_failed", detail: "pre-commit hook rejected the commit" }],
      }),
    );
    const harness = stubContext(stub, { args: ARGS, flags: { key: KEY } });

    await runDocEdit(harness.context, { stdin: pipe("x"), stdinKind: "fifo" });

    expect(harness.stdout()).toBe(
      "edited doc_a1b2c3 — warning: commit_failed (pre-commit hook rejected the commit)\n" +
        FRESH_KEY_LINE,
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

    await runDocEdit(harness.context, { stdinKind: "other" });

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

    await runDocEdit(harness.context, { stdinKind: "other" });

    const extra = bodyOf(stub.requests[0]?.body)["extra"] as Record<string, unknown>;
    expect(extra["width"]).toBe(520);
    expect(typeof extra["width"]).toBe("number");
  });

  it('sends null for a deletion, not the string "null"', async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["width=null"] } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests[0]?.body).toBe('{"extra":{"width":null}}');
  });

  it("combines with a body and the other frontmatter flags in one request", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { title: "Finance", extra: ["width=640"], key: KEY },
    });

    await runDocEdit(harness.context, { stdin: pipe("body\n"), stdinKind: "fifo" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      title: "Finance",
      extra: { width: 640 },
      key: KEY,
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

      const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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
      const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
        (cause: unknown) => cause,
      );
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    }
    expect(stub.requests).toHaveLength(0);
  });

  it("stores an empty value as the empty string rather than dropping the key", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { extra: ["note="] } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests[0]?.body).toBe('{"extra":{"note":""}}');
  });

  it("passes an odd key through verbatim — only the *reserved* names are refused", async () => {
    // The server owns what an `extra` key may be called; the CLI's only rule is
    // that it may not shadow a core field. A key with a dot, a space or unicode
    // in it is the server's judgement to make, and the wire carries it intact.
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { extra: ["ledger.fy26.v=1", "with space=x", "TITLE=not-title", "é=1"] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      extra: { "ledger.fy26.v": 1, "with space": "x", TITLE: "not-title", é: 1 },
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
      stdinKind: "fifo",
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
      stdinKind: "fifo",
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

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests.map((request) => request.method)).toEqual(["PUT"]); // no GET
    expect(bodyOf(stub.requests[0]?.body)).toEqual({ extra: { width: 520 } });
    expect(harness.stdout()).toBe(`edited doc_gqyrzvto\n${FRESH_KEY_LINE}`);
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
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

    await runDocEdit(harness.context, { stdinKind: "other" });

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

describe("corpus doc edit — the §10 board keys (CLI-018, CLI-060)", () => {
  it("repositions a board and reconfigures its query in one request", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: {
        columns: "doc_v1e2w3,doc_v4e5w6",
        order: "1.5",
        query: ["type=thread", "status=open", "tag=finance"],
      },
      actor: "agent",
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests[0]?.method).toBe("PUT");
    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      columns: ["doc_v1e2w3", "doc_v4e5w6"],
      order: 1.5,
      query: { type: "thread", status: "open", tag: "finance" },
    });
    // No read: the board keys cost no round trip, unlike `--add-tag`/`--status`.
    expect(stub.requests).toHaveLength(1);
  });

  it("takes a board off the default without touching anything else", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { "default-open": "false" } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests[0]?.body).toBe('{"defaultOpen":false}');
  });

  it("sends an empty columns list, which is a board with no columns and not a removal", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { columns: "" } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests[0]?.body).toBe('{"columns":[]}');
  });

  it("removes named frontmatter keys with --unset, and needs no key to do it", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { unset: ["pinned", "default-open"] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    // File spellings, in the order they were given, and no `--key`: `unset`
    // names its own delta exactly as `removeTags` does.
    expect(bodyOf(stub.requests[0]?.body)).toEqual({ unset: ["pinned", "default-open"] });
    expect(stub.requests).toHaveLength(1);
  });

  it("refuses --unset id before anything is sent", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { unset: ["id"] } });

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("id");
    expect(stub.requests).toHaveLength(0);
  });

  it("clears each key with the `null` the update schema gives a meaning to", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { order: "null", query: ["null"] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({ order: null, query: null });
  });

  it("replaces the whole query rather than merging into it", async () => {
    // `query` is one core field, not an RFC 7386 sub-object like `extra`: the
    // server stores what it is sent, so a key left out of the command is gone.
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { query: ["type=view"] } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({ query: { type: "view" } });
  });

  it("composes with the extra merge patch, the body and the other flags", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: {
        title: "Finance",
        extra: ["width=640"],
        stage: "doing",
        unset: ["pinned"],
        key: KEY,
      },
    });

    await runDocEdit(harness.context, { stdin: pipe("body\n"), stdinKind: "fifo" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      title: "Finance",
      extra: { width: 640 },
      stage: "doing",
      unset: ["pinned"],
      key: KEY,
      body: "body\n",
    });
  });

  it("is refused on an archived document exactly as before — CLI-017 still holds", async () => {
    const stub = await startStubServer((request, response) => {
      if (request.method === "GET") return sendJson(response, 200, archived(DOC));
      sendJson(response, 200, UPDATED);
    });
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { status: "open", stage: "doing" },
    });

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("is archived");
    expect(stub.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it.each([
    { order: "1e400" },
    { order: '"4"' },
    { "default-open": "maybe" },
    { stage: "" },
    { columns: "a,,b" },
    { kanban: "{nope}" },
    { unset: ["created"] },
    { query: ["filters={}"] },
    { query: ["null", "type=note"] },
    { query: ['{"type":"note"}', "status=open"] },
  ])("refuses %o before any request", async (flags) => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags });

    const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
      (cause: unknown) => cause,
    );

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });

  it("counts a view flag as a change, so it is not the empty edit", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { order: "2" } });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(stub.requests).toHaveLength(1);
  });
});

describe("corpus doc edit --extra-json (SPEC 38)", () => {
  it("writes an object into the same merge patch --extra writes scalars into", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { "extra-json": ['publish={"target":"blog","draft":true}'] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      extra: { publish: { target: "blog", draft: true } },
    });
  });

  it("combines with --extra when the keys are disjoint", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { extra: ["width=520"], "extra-json": ['publish={"target":"blog"}'] },
    });

    await runDocEdit(harness.context, { stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({
      extra: { width: 520, publish: { target: "blog" } },
    });
  });

  it("refuses a key both flags name, and a value that is not JSON", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    for (const flags of [
      { extra: ["publish=x"], "extra-json": ["publish={}"] },
      { "extra-json": ["publish={oops}"] },
      { "extra-json": ['title={"x":1}'] },
    ]) {
      const harness = stubContext(stub, { args: ARGS, flags });
      const error: unknown = await runDocEdit(harness.context, { stdinKind: "other" }).catch(
        (cause: unknown) => cause,
      );
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    }
    expect(stub.requests).toHaveLength(0);
  });

  it("stops claiming a totality it does not have, and names the escape hatch", () => {
    // SPEC 38: `--extra` is total *over scalars*; the object case is a flag of
    // its own, and the description says so rather than implying otherwise.
    const extra = editCommand.flags.find((flag) => flag.name === "extra")?.description ?? "";
    expect(extra).toContain("total over scalars");
    expect(extra).toContain("--extra-json");
  });
});

describe("edit helpers", () => {
  it("tells a caller the tag flags send a change, and no longer advertises a race", () => {
    // CLI-008 item 3 is CLOSED by SERVER-102 rather than waived: the merge is
    // the server's, so the help must not go on offering `--key` as the way to
    // close a window that no longer exists.
    expect(editCommand.description).toContain("send the change, not the resulting list");
    expect(editCommand.description).toContain("both land");
    expect(editCommand.description).not.toContain("later one's tag");
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

describe("corpus doc edit — a body on a socket (CLI-066)", () => {
  /**
   * CLI-066 — the socket that swallowed five documents.
   *
   * The SHARED-070 audit ran this verb through `spawnSync(…, { input })`, which
   * hands the child a socketpair on fd 0. A socket is never read (CLI-007: an
   * agent harness leaves one there that never ends), and treating "not read" as
   * "not offered" wrote the document's body silently left alone at exit 0 with the caller's bytes verifiably
   * absent. The refusal below is decided by `fstat` alone — `unreadable()` rejects
   * on the first read, so "nothing was blocked on" is an assertion here rather
   * than a timeout.
   */
  it("refuses rather than performing a frontmatter-only edit the caller never asked for", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { title: "A new title" } });

    const error: unknown = await runDocEdit(harness.context, {
      stdin: unreadable(),
      stdinKind: "socket",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("stdin is a socket");
    expect(stub.requests).toHaveLength(0);
  });

  it("still allows a frontmatter-only edit once the caller says it sends no body", async () => {
    const stub = await startStubServer(jsonResponder(200, UPDATED));
    const harness = stubContext(stub, { args: ARGS, flags: { title: "A new title" } });

    await runDocEdit(harness.context, { stdin: unreadable(), stdinKind: "other" });

    expect(bodyOf(stub.requests[0]?.body)).toEqual({ title: "A new title" });
  });
});
