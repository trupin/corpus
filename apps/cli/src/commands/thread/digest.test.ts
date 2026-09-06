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
import { pipe, unreadable } from "../../testing/stdin.js";
import { DIGEST_ORIENTS_HELP, digestCommand, digestLines, runThreadDigest } from "./digest.js";

const SET_ARGS = { action: "set", id: "th_a1b2c3" };
const CLEAR_ARGS = { action: "clear", id: "th_a1b2c3" };

const WRITTEN = {
  threadId: "th_a1b2c3",
  digest: {
    body: "Decided: 30-year fixed. Open: escrow (turn 16).",
    watermark: "2026-09-04T10:00:00.000Z",
    stale: false,
  },
  warnings: [],
};

const CLEARED = { threadId: "th_a1b2c3", digest: null, warnings: [] };

const bodyOf = (raw: string | undefined): Record<string, unknown> =>
  JSON.parse(raw ?? "{}") as Record<string, unknown>;

afterEach(closeStubServers);

describe("corpus thread digest set", () => {
  it("PUTs the body and prints the watermark the server stamped", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, { args: SET_ARGS, actor: "agent" });

    await runThreadDigest(harness.context, { stdin: pipe("what stands\n"), stdinKind: "fifo" });

    const [request] = stub.requests;
    expect(request?.method).toBe("PUT");
    expect(request?.path).toBe("/api/threads/th_a1b2c3/digest");
    expect(request?.headers["x-corpus-author"]).toBe("agent");
    expect(bodyOf(request?.body)).toEqual({ body: "what stands\n" });
    expect(harness.stdout()).toBe(
      "set digest of th_a1b2c3 — covers turns through 2026-09-04T10:00:00.000Z\n",
    );
  });

  it("takes the body from -m, from --file and from stdin, with -m winning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-cli077-digest-"));
    await writeFile(join(dir, "digest.md"), "from the file", "utf8");
    const stub = await startStubServer(jsonResponder(200, WRITTEN));

    const inline = stubContext(stub, {
      args: SET_ARGS,
      flags: { message: "from -m", file: "digest.md" },
      cwd: dir,
    });
    await runThreadDigest(inline.context, { stdin: pipe("from stdin"), stdinKind: "fifo" });

    const fromFile = stubContext(stub, { args: SET_ARGS, flags: { file: "digest.md" }, cwd: dir });
    await runThreadDigest(fromFile.context, { stdin: pipe("from stdin"), stdinKind: "fifo" });

    const fromStdin = stubContext(stub, { args: SET_ARGS });
    await runThreadDigest(fromStdin.context, { stdin: pipe("from stdin"), stdinKind: "fifo" });

    expect(stub.requests.map((request) => bodyOf(request.body)["body"])).toEqual([
      "from -m",
      "from the file",
      "from stdin",
    ]);
  });

  /**
   * The acceptance criterion's hostile body, byte for byte: a heredoc
   * terminator of its own, a `$(...)` that must never run, and a line §6 would
   * read as a turn heading. Nothing in the CLI may summarize, reflow or trim
   * it — CLI-074 is why none of it ever touches argv.
   */
  const HOSTILE =
    "CORPUS_EOF\n$(date)\n## user · 2026-09-04T10:00:00Z\ntrailing spaces   \n\nno final newline";

  it("round-trips hostile content byte for byte from a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-cli077-hostile-"));
    await writeFile(join(dir, "digest.md"), HOSTILE, "utf8");
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, { args: SET_ARGS, flags: { file: "digest.md" }, cwd: dir });

    await runThreadDigest(harness.context);

    expect(bodyOf(stub.requests[0]?.body)["body"]).toBe(HOSTILE);
  });

  it("round-trips hostile content byte for byte from stdin", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, { args: SET_ARGS });

    await runThreadDigest(harness.context, { stdin: pipe(HOSTILE), stdinKind: "fifo" });

    expect(bodyOf(stub.requests[0]?.body)["body"]).toBe(HOSTILE);
  });

  it("refuses an empty body at exit 2 and names the verb that does clear", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));

    const inline = stubContext(stub, { args: SET_ARGS, flags: { message: "" } });
    const first: unknown = await runThreadDigest(inline.context, { stdinKind: "other" }).catch(
      (cause: unknown) => cause,
    );
    expect(exitCodeFor(first)).toBe(ExitCode.usageError);
    expect(String(first)).toContain("no digest to send");

    const piped = stubContext(stub, { args: SET_ARGS });
    const second: unknown = await runThreadDigest(piped.context, {
      stdin: pipe(""),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);
    expect(exitCodeFor(second)).toBe(ExitCode.usageError);
    expect((second as { hint?: string }).hint).toContain("corpus thread digest clear th_a1b2c3");
    expect((second as { hint?: string }).hint).toContain("not a clear");

    expect(stub.requests).toHaveLength(0);
  });

  it("sends a whitespace-only body and reports the server's 422 — blank is the server's call", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 422, {
        code: "bad_request",
        message: "a digest may not be blank: an empty write is not a clear…",
        issues: [{ path: "body", message: "blank" }],
      });
    });
    const harness = stubContext(stub, { args: SET_ARGS, flags: { message: "   \n" } });

    const error: unknown = await runThreadDigest(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(stub.requests).toHaveLength(1);
  });

  it("reports the no-resident 422 as the server answers it, at exit 5", async () => {
    const stub = await startStubServer((_request, response) => {
      sendJson(response, 422, {
        code: "unknown_recipient",
        message: "`th_a1b2c3` holds no resident, and a digest is the resident's (SPEC.md §6).",
        recipient: "th_a1b2c3",
      });
    });
    const harness = stubContext(stub, { args: SET_ARGS, flags: { message: "an account" } });

    const error: unknown = await runThreadDigest(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.serverError);
    expect(String(error)).toContain("unknown_recipient");
    expect(String(error)).toContain("holds no resident");
  });

  it("refuses a socket stdin instead of writing a digest nobody sent (CLI-066)", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, { args: SET_ARGS, actor: "agent" });

    const error: unknown = await runThreadDigest(harness.context, {
      stdin: unreadable(),
      stdinKind: "socket",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("stdin is a socket");
    expect(stub.requests).toHaveLength(0);
  });

  it("emits the whole response under --json, watermark included", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, {
      args: SET_ARGS,
      flags: { message: "an account" },
      json: true,
    });

    await runThreadDigest(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(WRITTEN);
  });
});

describe("corpus thread digest clear", () => {
  it("DELETEs the digest and states the post-state rather than claiming a change", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEARED));
    const harness = stubContext(stub, { args: CLEAR_ARGS, actor: "agent" });

    await runThreadDigest(harness.context);

    const [request] = stub.requests;
    expect(request?.method).toBe("DELETE");
    expect(request?.path).toBe("/api/threads/th_a1b2c3/digest");
    // No pre-read: the surface that exists to avoid whole-thread reads must not
    // pay one for a courtesy sentence, so the line is true in both cases.
    expect(stub.requests).toHaveLength(1);
    expect(harness.stdout()).toBe("th_a1b2c3 now carries no digest\n");
  });

  it("refuses a body flag beside clear, with nothing sent", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEARED));
    const harness = stubContext(stub, { args: CLEAR_ARGS, flags: { message: "an account" } });

    const error: unknown = await runThreadDigest(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("clearing takes no body");
    expect((error as { hint?: string }).hint).toContain("corpus thread digest set th_a1b2c3");
    expect(stub.requests).toHaveLength(0);
  });

  it("never reads stdin — a clear with a piped body sends the DELETE untouched", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEARED));
    const harness = stubContext(stub, { args: CLEAR_ARGS });

    // `unreadable()` rejects on the first read, so this passing proves the
    // clear consumed nothing.
    await runThreadDigest(harness.context, { stdin: unreadable(), stdinKind: "socket" });

    expect(stub.requests[0]?.method).toBe("DELETE");
  });

  it("emits the whole response under --json", async () => {
    const stub = await startStubServer(jsonResponder(200, CLEARED));
    const harness = stubContext(stub, { args: CLEAR_ARGS, json: true });

    await runThreadDigest(harness.context);

    expect(JSON.parse(harness.stdout())).toEqual(CLEARED);
  });
});

describe("corpus thread digest — the action positional", () => {
  it("refuses an action outside set|clear, naming both, with nothing sent", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, {
      args: { action: "update", id: "th_a1b2c3" },
      flags: { message: "an account" },
    });

    const error: unknown = await runThreadDigest(harness.context).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("`set` or `clear`");
    expect(String(error)).toContain('"update"');
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses the action before reading the body, so a heredoc is not consumed for nothing", async () => {
    const stub = await startStubServer(jsonResponder(200, WRITTEN));
    const harness = stubContext(stub, { args: { action: "write", id: "th_a1b2c3" } });

    const error: unknown = await runThreadDigest(harness.context, {
      stdin: unreadable(),
      stdinKind: "fifo",
    }).catch((cause: unknown) => cause);

    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(stub.requests).toHaveLength(0);
  });
});

describe("digestLines — the one rendering every digest surface shares", () => {
  it("renders nothing for no digest, because having none is the ordinary state", () => {
    expect(digestLines(null)).toEqual([]);
    expect(digestLines(undefined)).toEqual([]);
  });

  it("opens a fresh digest with its watermark", () => {
    expect(
      digestLines({ body: "One line.\nTwo.", watermark: "2026-09-04T10:00:00.000Z", stale: false }),
    ).toEqual(["digest · covers turns through 2026-09-04T10:00:00.000Z", "One line.", "Two."]);
  });

  it("marks a stale digest STALE and still prints the body — never hidden, never replaced", () => {
    const lines = digestLines({
      body: "An account of a turn that is gone.",
      watermark: "2026-09-04T10:00:00.000Z",
      stale: true,
    });

    expect(lines[0]).toContain("STALE");
    expect(lines[0]).toContain("2026-09-04T10:00:00.000Z");
    expect(lines[0]).toContain("deleted or revised");
    expect(lines).toContain("An account of a turn that is gone.");
  });

  it("does not say STALE anywhere on a fresh digest", () => {
    const lines = digestLines({
      body: "Fresh.",
      watermark: "2026-09-04T10:00:00.000Z",
      stale: false,
    });

    expect(lines.join("\n")).not.toContain("STALE");
  });
});

describe("the thread digest command spec", () => {
  it("declares set and clear through one action positional and never a positional body", () => {
    expect(digestCommand.args.map((arg) => arg.name)).toEqual(["action", "id"]);
    expect(digestCommand.flags.map((flag) => flag.name)).toEqual(["message", "file"]);
  });

  /**
   * The invariant, asserted as wording (CLI-077). This proves the sentence is
   * present, never that it is true or heeded — the AGENT issue's rehearsal is
   * what tests whether an agent reading it acts on it.
   */
  it("states that summaries orient and never act, in the one shared spelling", () => {
    expect(digestCommand.description).toContain(DIGEST_ORIENTS_HELP);
    expect(DIGEST_ORIENTS_HELP).toContain("Summaries orient, they never act");
    expect(DIGEST_ORIENTS_HELP).toContain("read the turn verbatim");
    expect(DIGEST_ORIENTS_HELP).toContain("never the source of a quotation");
    expect(DIGEST_ORIENTS_HELP).toContain("never the basis of a write");
  });

  it("says the body is sent as given and that an empty set is not a clear", () => {
    const text = digestCommand.description ?? "";
    expect(text).toContain("byte for byte");
    expect(text).toContain("nothing is summarized, reflowed or trimmed");
    expect(text).toContain("refused");
    expect(text).toContain("rather than read as a clear");
    // The watermark is the server's, so the help must not invite one.
    expect(text).toContain("server stamps the **watermark**");
  });
});
