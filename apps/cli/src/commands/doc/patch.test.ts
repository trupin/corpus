import type { PatchDocResponse } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError, renderError, toProblem } from "../../errors.js";
import { pipe, unreadable } from "../../testing/stdin.js";
import {
  closeStubServers,
  jsonResponder,
  sendJson,
  startStubServer,
  stubContext,
  type StubContextOptions,
} from "../../testing/stub-server.js";
import { DOC, rekeyed } from "./fixtures.js";
import { docTopic } from "./index.js";
import { patchCommand, runDocPatch } from "./patch.js";

/**
 * `corpus doc patch` (CLI-035, SPEC.md §9.2).
 *
 * The behaviour under test that is not obvious from the handler: the **two
 * refusals stay distinguishable end to end**. The server answers one status with
 * a machine-readable `reason` and a count, and the whole point of the operation
 * is that "0 matches" and "N matches" send the caller in opposite directions —
 * so the tests assert on the count and on the recovery each message names, not
 * merely on the exit code they share.
 */

const ARGS = { id: "doc_a1b2c3" };

const NEXT_KEY = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";

/** What an applied patch answers with: the saved document plus §6's report and the count. */
function patched(replaced = 1, overrides: Partial<PatchDocResponse> = {}): PatchDocResponse {
  return {
    doc: rekeyed(DOC, NEXT_KEY),
    anchors: { remapped: [], orphaned: [] },
    warnings: [],
    replaced,
    ...overrides,
  };
}

/** The `409` the route refuses with — the contract's `PatchConflictError`, verbatim. */
function refusal(reason: "no-match" | "multiple-matches", matches: number): unknown {
  return {
    code: "conflict",
    message: `the text this patch quotes occurs ${String(matches)} times`,
    reason,
    matches,
  };
}

async function failureOf(
  respond: Parameters<typeof startStubServer>[0],
  options: StubContextOptions,
): Promise<{ error: unknown; requests: number; stderr: string }> {
  const stub = await startStubServer(respond);
  const harness = stubContext(stub, options);
  const error: unknown = await runDocPatch(harness.context).catch((cause: unknown) => cause);
  return { error, requests: stub.requests.length, stderr: harness.stderr() };
}

afterEach(closeStubServers);

describe("corpus doc patch — the applied patch", () => {
  it("sends exactly the excerpt and its replacement, and prints the fresh key", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { old: "30-year fixed at 6.1%.", new: "30-year fixed at 5.8%." },
      actor: "agent",
    });

    await runDocPatch(harness.context);

    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/docs/doc_a1b2c3/patch");
    // No `key`: SPEC.md §7 exempts a patch, and the contract is strict — a key
    // sent here is a `400`, so the CLI must not invent one.
    expect(JSON.parse(request?.body ?? "")).toEqual({
      old: "30-year fixed at 6.1%.",
      new: "30-year fixed at 5.8%.",
    });
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(harness.stdout()).toBe(`patched doc_a1b2c3 — 1 occurrence replaced\nkey ${NEXT_KEY}\n`);
  });

  it("attributes to `user` by default, exactly as every other write does", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, { args: ARGS, flags: { old: "a", new: "b" } });

    await runDocPatch(harness.context);

    expect(stub.requests[0]?.headers["x-corpus-author"]).toBe("user");
  });

  it("carries multi-line text through byte for byte", async () => {
    const old = "## Rates\n\n- 30-year: 6.1%\n";
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { old, new: "## Rates\n\n- 30-year: 5.8%\n" },
    });

    await runDocPatch(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toMatchObject({ old });
  });

  it("opts into every occurrence with --all and says how many it replaced", async () => {
    const stub = await startStubServer(jsonResponder(200, patched(4)));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { old: "the Rate Sheet", new: "the rate sheet", all: true },
    });

    await runDocPatch(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toMatchObject({ all: true });
    expect(harness.stdout()).toContain("patched doc_a1b2c3 — 4 occurrences replaced");
  });

  it("omits `all` rather than sending false, because the server owns the default", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, { args: ARGS, flags: { old: "a", new: "b" } });

    await runDocPatch(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).not.toHaveProperty("all");
  });

  it("deletes the quoted text when --new is empty", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { old: "\n> Draft: do not circulate.\n", new: "" },
    });

    await runDocPatch(harness.context);

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      old: "\n> Draft: do not circulate.\n",
      new: "",
    });
    expect(harness.stdout()).toContain("patched doc_a1b2c3 — 1 occurrence replaced");
  });

  it("reports a no-op as a no-op, not as an edit that never happened", async () => {
    // SPEC.md §9.2: `new` equal to `old` writes nothing and makes no commit. An
    // agent told "patched" would go looking for a diff that does not exist.
    const stub = await startStubServer(jsonResponder(200, patched(2)));
    const harness = stubContext(stub, { args: ARGS, flags: { old: "same", new: "same" } });

    await runDocPatch(harness.context);

    expect(harness.stdout()).toContain("doc_a1b2c3 unchanged");
    expect(harness.stdout()).toContain("nothing was written");
    expect(harness.stdout()).not.toContain("patched");
  });

  it("renders the anchor report and §14's warnings on the same line", async () => {
    const response = patched(1, {
      doc: {
        ...rekeyed(DOC, NEXT_KEY),
        anchors: [
          {
            anchorId: "a1",
            threadId: "th_x9y8",
            threadStatus: "open",
            orphaned: true,
            range: null,
            selector: { exact: "gone", prefix: "", suffix: "" },
          },
        ],
      },
      anchors: { remapped: ["a2"], orphaned: ["a1"] },
      warnings: [{ code: "commit_failed", detail: "pre-commit rejected the change" }],
    });
    const stub = await startStubServer(jsonResponder(200, response));
    const harness = stubContext(stub, { args: ARGS, flags: { old: "a", new: "b" } });

    await runDocPatch(harness.context);

    const [line] = harness.stdout().split("\n");
    expect(line).toContain("1 anchor remapped");
    expect(line).toContain("1 orphaned (th_x9y8)");
    expect(line).toContain("warning: commit_failed");
  });

  it("emits the server's whole response under --json, `replaced` included", async () => {
    const response = patched(3);
    const stub = await startStubServer(jsonResponder(200, response));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { old: "a", new: "b", all: true },
      json: true,
    });

    await runDocPatch(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(response);
  });
});

describe("corpus doc patch — the two refusals", () => {
  it("says the excerpt matched 0 times and sends the caller back to the document", async () => {
    const { error, stderr } = await failureOf(
      (_request, response) => {
        sendJson(response, 409, refusal("no-match", 0));
      },
      { args: ARGS, flags: { old: "not there", new: "x" } },
    );

    expect(exitCodeFor(error)).toBe(ExitCode.patchRefused);
    expect(exitCodeFor(error)).toBe(10);
    expect(isCliError(error) && error.code).toBe("patch_no_match");
    expect(String(error)).toContain("matched 0 times");
    expect(String(error)).toContain("doc_a1b2c3");
    expect(String(error)).toContain("nothing was written");
    // The recovery, and only this one: re-read. Nothing here should suggest
    // quoting more context, which is the *other* refusal's fix.
    expect(isCliError(error) && error.hint).toContain("corpus doc show doc_a1b2c3");
    expect(isCliError(error) && error.hint).not.toContain("--all");
    expect(stderr).toBe("");
  });

  it("says how many times the excerpt matched and names both recoveries", async () => {
    const { error } = await failureOf(
      (_request, response) => {
        sendJson(response, 409, refusal("multiple-matches", 3));
      },
      { args: ARGS, flags: { old: "rate", new: "x" } },
    );

    expect(exitCodeFor(error)).toBe(ExitCode.patchRefused);
    expect(isCliError(error) && error.code).toBe("patch_multiple_matches");
    expect(String(error)).toContain("occurs 3 times");
    expect(String(error)).toContain("doc_a1b2c3");
    // Both ways out, and the count repeated where --all is offered so "all" is
    // never an unquantified leap.
    expect(isCliError(error) && error.hint).toContain("Quote more");
    expect(isCliError(error) && error.hint).toContain("--all to replace all 3");
  });

  it("renders the refusal as prose only — no JSON dump under a message that said it", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 409, refusal("no-match", 0));
    });
    const harness = stubContext(stub, { args: ARGS, flags: { old: "x", new: "y" } });

    const error: unknown = await runDocPatch(harness.context).catch((cause: unknown) => cause);
    harness.context.out.fail(error, { verbose: false });

    expect(harness.stderr()).not.toContain('"reason"');
    expect(harness.stderr()).not.toContain("{");
    expect(harness.stderr()).toContain("matched 0 times");
  });

  it("keeps the two apart in the --json envelope, count as a number", async () => {
    const { error } = await failureOf(
      (_request, response) => {
        sendJson(response, 409, refusal("multiple-matches", 7));
      },
      { args: ARGS, flags: { old: "rate", new: "x" }, json: true },
    );

    expect(toProblem(error)).toMatchObject({
      code: "patch_multiple_matches",
      // Nothing moved: a caller reading the envelope may retry freely.
      changed: false,
      details: { reason: "multiple-matches", matches: 7 },
    });
  });

  it("reports zero matches as a distinct code from several, on the same exit code", async () => {
    const none = await failureOf(
      (_request, response) => {
        sendJson(response, 409, refusal("no-match", 0));
      },
      { args: ARGS, flags: { old: "x", new: "y" } },
    );
    const several = await failureOf(
      (_request, response) => {
        sendJson(response, 409, refusal("multiple-matches", 2));
      },
      { args: ARGS, flags: { old: "x", new: "y" } },
    );

    expect(exitCodeFor(none.error)).toBe(exitCodeFor(several.error));
    expect(toProblem(none.error).code).not.toBe(toProblem(several.error).code);
  });

  it("leaves a stale key as a stale key — an external editor is not a bad quote", async () => {
    // A `409 stale_key` here means something outside Corpus wrote the file
    // between the server's match and its save. Re-quoting would not fix it, so
    // it must not arrive dressed as a patch refusal.
    const { error } = await failureOf(
      (_request, response) => {
        sendJson(response, 409, {
          code: "stale_key",
          message: "the document moved on",
          doc: rekeyed(DOC, NEXT_KEY),
        });
      },
      { args: ARGS, flags: { old: "a", new: "b" } },
    );

    expect(exitCodeFor(error)).toBe(ExitCode.staleKey);
    expect(isCliError(error) && error.code).toBe("stale_key");
  });

  it("tells that stale key to re-run the patch, and never names a `--key` this verb has not got", async () => {
    // End to end through the verb, because this is the text an agent reads and
    // acts on: the refusal is classified in `client.ts` for every route at once,
    // and until PR #44's re-review it handed this one the keyed recovery —
    // "run the same command again with `--key <k>`" — for a flag `corpus doc
    // patch` refuses at exit 2. A dead end reached by following the instruction.
    const moved = rekeyed(DOC, NEXT_KEY);
    const { error } = await failureOf(
      (_request, response) => {
        sendJson(response, 409, {
          code: "stale_key",
          message: "the document moved on",
          doc: moved,
        });
      },
      { args: ARGS, flags: { old: "a", new: "b" } },
    );

    const text = renderError(error, { verbose: false });
    expect(text).not.toContain("--key");
    expect(text).not.toContain(NEXT_KEY);
    expect(text).toContain("the patch itself is still good");
    expect(text).toContain("Run the same patch again");
    expect(text).toContain(`corpus doc show ${ARGS.id}`);
    // And it does not ship the document back on the one verb whose reason to
    // exist is not shipping it — `--json` still carries it as `details`.
    expect(text).not.toContain(DOC.body.trim());
    expect(toProblem(error).details).toEqual(moved);
  });

  it("leaves every other failure classified as it already was", async () => {
    const unknown = await failureOf(
      (_request, response) => {
        sendJson(response, 404, { code: "not_found", message: "no document doc_a1b2c3" });
      },
      { args: ARGS, flags: { old: "a", new: "b" } },
    );
    expect(exitCodeFor(unknown.error)).toBe(ExitCode.serverError);

    // A `409` from some other route's conflict has no `reason` this verb knows,
    // so it stays a server error rather than being reported with a made-up count.
    const other = await failureOf(
      (_request, response) => {
        sendJson(response, 409, { code: "conflict", message: "something else refused" });
      },
      { args: ARGS, flags: { old: "a", new: "b" } },
    );
    expect(exitCodeFor(other.error)).toBe(ExitCode.serverError);
  });
});

describe("corpus doc patch — where the text comes from", () => {
  it("reads either side from a file, byte for byte", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const files = new Map([
      ["/tmp/old.md", "## Rates\n\n- 30-year: 6.1%\n"],
      ["/tmp/new.md", "## Rates\n\n- 30-year: 5.8%\n"],
    ]);
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { "old-file": "/tmp/old.md", "new-file": "/tmp/new.md" },
    });

    await runDocPatch(harness.context, {
      readTextFile: (path) =>
        Promise.resolve(files.get(path) ?? Promise.reject(new Error(`ENOENT: ${path}`))),
    });

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      old: "## Rates\n\n- 30-year: 6.1%\n",
      new: "## Rates\n\n- 30-year: 5.8%\n",
    });
  });

  it("resolves a relative --old-file against the invocation directory", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, {
      args: ARGS,
      flags: { "old-file": "excerpt.md", new: "x" },
      cwd: "/workspace/notes",
    });
    const seen: string[] = [];

    await runDocPatch(harness.context, {
      readTextFile: (path) => {
        seen.push(path);
        return Promise.resolve("quoted");
      },
    });

    expect(seen).toEqual(["/workspace/notes/excerpt.md"]);
  });

  it("reports an unreadable file as a usage error, before anything is sent", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, { args: ARGS, flags: { "old-file": "/nope.md", new: "x" } });

    const error: unknown = await runDocPatch(harness.context, {
      readTextFile: () => Promise.reject(new Error("ENOENT: no such file or directory")),
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--old-file /nope.md");
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses two sources for one side rather than silently preferring one", async () => {
    const { error, requests } = await failureOf(jsonResponder(200, patched()), {
      args: ARGS,
      flags: { old: "a", "old-file": "/tmp/old.md", new: "b" },
    });

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--old and --old-file");
    expect(requests).toBe(0);
  });

  it("takes the whole request as JSON on stdin", async () => {
    const stub = await startStubServer(jsonResponder(200, patched(2)));
    const harness = stubContext(stub, { args: ARGS, flags: { stdin: true } });

    await runDocPatch(harness.context, {
      stdinIsBodySource: true,
      stdin: pipe('{"old": "It\'s `here`.\\n", "new": "It is here.\\n", "all": true}\n'),
    });

    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual({
      old: "It's `here`.\n",
      new: "It is here.\n",
      all: true,
    });
    expect(harness.stdout()).toContain("2 occurrences replaced");
  });

  it("refuses --stdin beside any flag it would duplicate", async () => {
    const { error, requests } = await failureOf(jsonResponder(200, patched()), {
      args: ARGS,
      flags: { stdin: true, old: "a", all: true },
    });

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--old");
    expect(String(error)).toContain("--all");
    expect(requests).toBe(0);
  });

  it("never reads a stdin that carries no body — the socket an agent harness leaves", async () => {
    // CLI-007: fd 0 under an agent harness is a socket that never ends, so
    // "--stdin with nothing piped" has to be an error rather than a wait. The
    // fixture rejects on read, which turns a hang into a failed assertion.
    const stub = await startStubServer(jsonResponder(200, patched()));
    const harness = stubContext(stub, { args: ARGS, flags: { stdin: true } });

    const error: unknown = await runDocPatch(harness.context, {
      stdinIsBodySource: false,
      stdin: unreadable(),
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("nothing is piped in");
    expect(stub.requests).toHaveLength(0);
  });

  it("names what is wrong with a --stdin document that is not a patch", async () => {
    const stub = await startStubServer(jsonResponder(200, patched()));
    const cases: readonly (readonly [string, string])[] = [
      ["not json at all", "not valid JSON"],
      ['{"old": "a"}', "new"],
      ['{"old": "", "new": "b"}', "old"],
      // Strict: an unknown key is refused rather than dropped, because a
      // silently ignored `replace` would be a `new` of "", which is a deletion.
      ['{"old": "a", "new": "b", "replace": "c"}', "replace"],
    ];

    for (const [document, expected] of cases) {
      const harness = stubContext(stub, { args: ARGS, flags: { stdin: true } });
      const error: unknown = await runDocPatch(harness.context, {
        stdinIsBodySource: true,
        stdin: pipe(document),
      }).catch((cause: unknown) => cause);

      expect(exitCodeFor(error), document).toBe(ExitCode.usageError);
      expect(String(error), document).toContain(expected);
    }
    expect(stub.requests).toHaveLength(0);
  });
});

describe("corpus doc patch — what it refuses before sending anything", () => {
  it("needs an excerpt", async () => {
    const { error, requests } = await failureOf(jsonResponder(200, patched()), {
      args: ARGS,
      flags: { new: "x" },
    });

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(isCliError(error) && error.hint).toContain("--old-file");
    expect(isCliError(error) && error.hint).toContain("--stdin");
    expect(requests).toBe(0);
  });

  it("refuses an empty excerpt: replacing nothing is not an edit", async () => {
    const { error, requests } = await failureOf(jsonResponder(200, patched()), {
      args: ARGS,
      flags: { old: "", new: "x" },
    });

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("--old is empty");
    expect(requests).toBe(0);
  });

  it("will not infer a deletion from a missing --new", async () => {
    // Absence and emptiness must stay distinguishable: `--new ''` deletes, so
    // treating an omitted flag as empty would make a forgotten flag a deletion.
    const { error, requests } = await failureOf(jsonResponder(200, patched()), {
      args: ARGS,
      flags: { old: "something" },
    });

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(isCliError(error) && error.hint).toContain("--new ''");
    expect(requests).toBe(0);
  });
});

describe("corpus doc patch — the registry entry", () => {
  it("is a verb of the doc topic", () => {
    expect(docTopic.commands).toContain(patchCommand);
  });

  it("declares no --key, because SPEC.md §7 exempts a patch from presenting one", () => {
    expect(patchCommand.flags.map((flag) => flag.name)).toEqual([
      "old",
      "new",
      "old-file",
      "new-file",
      "stdin",
      "all",
      // `--job` (CLI-044): the work this write serves, not a key. §7's exemption
      // is about presenting a *version* — a patch names the text it expects to
      // find, which is the staleness check — and says nothing about attribution.
      "job",
    ]);
  });

  it("teaches both refusals and the deletion in its own examples", () => {
    const examples = patchCommand.examples.map((example) => example.command).join("\n");
    expect(examples).toContain("--all");
    expect(examples).toContain("--new ''");
    expect(examples).toContain("--stdin");
    expect(patchCommand.examples.map((example) => example.description).join("\n")).toContain(
      "exit **10**",
    );
  });
});
