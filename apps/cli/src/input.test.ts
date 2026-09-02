import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isCliError, UsageError } from "./errors.js";
import {
  parseTriStateBoolean,
  plural,
  readAll,
  requireBody,
  requireFlag,
  resolveActor,
  resolveJob,
  resolveBody,
  resolveTurnModel,
  splitTags,
  stdinCarriesABody,
  stdinKind,
  warningSuffix,
} from "./input.js";
import { ParsedFlags, type FlagValue } from "./parse-args.js";
import { createTestContext } from "./registry/fixtures.js";
import { connectedSocket, pipe, unreadable } from "./testing/stdin.js";

const flagsOf = (values: Readonly<Record<string, FlagValue>>): ParsedFlags =>
  new ParsedFlags(new Map(Object.entries(values)));

describe("resolveActor", () => {
  it("defaults to the user, because a human typing a command is not the agent", () => {
    expect(resolveActor(flagsOf({}), {})).toBe("user");
  });

  it("honours CORPUS_FROM, and lets --from beat it", () => {
    expect(resolveActor(flagsOf({}), { CORPUS_FROM: "agent" })).toBe("agent");
    expect(resolveActor(flagsOf({ from: "user" }), { CORPUS_FROM: "agent" })).toBe("user");
    expect(resolveActor(flagsOf({ from: "agent" }), {})).toBe("agent");
  });

  it("treats an empty CORPUS_FROM as unset", () => {
    expect(resolveActor(flagsOf({}), { CORPUS_FROM: "" })).toBe("user");
  });

  it("rejects anything else as a usage error naming the valid values", () => {
    expect(() => resolveActor(flagsOf({ from: "robot" }), {})).toThrow(
      /--from must be one of: user, agent/,
    );
    expect(() => resolveActor(flagsOf({}), { CORPUS_FROM: "robot" })).toThrow(
      /CORPUS_FROM must be one of/,
    );

    let thrown: unknown;
    try {
      resolveActor(flagsOf({ from: "robot" }), {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UsageError);
    expect(exitCodeFor(thrown)).toBe(ExitCode.usageError);
  });

  it("points a commit sha at the range flags it was meant for", () => {
    // The likely mistake, not a hypothetical one: a `doc.edited` event calls its
    // range halves `from`/`to`, and `--from` is this global actor flag.
    const hintFor = (from: string): string | undefined => {
      let thrown: unknown;
      try {
        resolveActor(flagsOf({ from }), {});
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(UsageError);
      return isCliError(thrown) ? thrown.hint : undefined;
    };

    expect(hintFor("b01ab0f78339e6cab716bf37db575f4cde8a123c")).toContain(
      "corpus doc diff <id> --from-rev <sha>",
    );
    // Everything that is not a sha keeps the attribution hint it always had.
    expect(hintFor("robot")).toContain("Writes are attributed to");
  });
});

describe("resolveBody", () => {
  it("prefers --message over --file and stdin", async () => {
    const { context } = createTestContext({ flags: { message: "from -m", file: "/nope" } });
    await expect(
      resolveBody(context, { stdin: pipe("from stdin"), stdinKind: "fifo" }),
    ).resolves.toBe("from -m");
  });

  it("prefers --file over stdin, resolving it against the invocation directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-c003-input-"));
    await writeFile(join(dir, "body.md"), "from the file\n", "utf8");
    const { context } = createTestContext({ flags: { file: "body.md" }, cwd: dir });

    await expect(
      resolveBody(context, { stdin: pipe("from stdin"), stdinKind: "fifo" }),
    ).resolves.toBe("from the file\n");
  });

  it("reads piped stdin when neither flag is given", async () => {
    const { context } = createTestContext({});
    await expect(
      resolveBody(context, { stdin: pipe("line one\n", "line two\n"), stdinKind: "fifo" }),
    ).resolves.toBe("line one\nline two\n");
  });

  it("passes the bytes through verbatim — fences, form blocks and the final newline", async () => {
    const body = "before\n\n```form\nname: x\n```\n\n~~~\nnested\n~~~\n";
    const { context } = createTestContext({});
    await expect(resolveBody(context, { stdin: pipe(body), stdinKind: "fifo" })).resolves.toBe(
      body,
    );
  });

  it("never reads a stdin that is not a body source, so a verb cannot hang", async () => {
    const { context } = createTestContext({});
    await expect(
      resolveBody(context, { stdin: pipe("would hang"), stdinKind: "other" }),
    ).resolves.toBeUndefined();
  });

  it("classifies every real descriptor a caller can put on fd 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "corpus-c003-fd-"));
    const file = join(dir, "body.md");
    await writeFile(file, "body", "utf8");
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);

    const regular = openSync(file, "r");
    // O_NONBLOCK: opening a FIFO for reading otherwise waits for a writer.
    const pipeEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const nullDevice = openSync("/dev/null", "r");
    const socket = await connectedSocket();
    try {
      // The two that are read: a heredoc's regular file and a pipe's FIFO.
      expect(stdinKind(regular)).toBe("file");
      expect(stdinKind(pipeEnd)).toBe("fifo");
      expect(stdinCarriesABody(stdinKind(regular))).toBe(true);
      expect(stdinCarriesABody(stdinKind(pipeEnd))).toBe(true);

      // A real socket — what `spawn`, `exec` and `spawnSync({ input })` hand a
      // child, and what an agent harness leaves behind. Classified on its own,
      // never folded into "no body offered" (CLI-066), and **never read**: this
      // assertion is a `fstat` and nothing else, so it returns whether or not
      // the peer ever writes or closes.
      expect(stdinKind(socket.fd)).toBe("socket");
      expect(stdinCarriesABody(stdinKind(socket.fd))).toBe(false);

      // `< /dev/null`, a closed descriptor: nothing was offered, and that is a
      // decision rather than an ambiguity.
      expect(stdinKind(nullDevice)).toBe("other");
      expect(stdinKind(9999)).toBe("other");
    } finally {
      closeSync(regular);
      closeSync(pipeEnd);
      closeSync(nullDevice);
      await socket.close();
    }
  });

  it("refuses a socket instead of resolving it to no body — and never reads it", async () => {
    const { context } = createTestContext({});
    // `unreadable()` rejects on the first read, so "this never blocked" is an
    // assertion here rather than a timeout: the refusal is decided by `fstat`
    // alone, with zero bytes taken off the descriptor.
    const error: unknown = await resolveBody(context, {
      stdin: unreadable(),
      stdinKind: "socket",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("stdin is a socket");
    expect(String(error)).toContain("no body was taken");
    const hint = isCliError(error) ? (error.hint ?? "") : "";
    // The transport is named, both repairs are named, and the refusal states
    // that nothing was sent — the three things the silent version never said.
    expect(hint).toContain("spawnSync({ input })");
    expect(hint).toContain("--file <path>");
    expect(hint).toContain("< /dev/null");
    expect(hint).toContain("nothing was sent to the server");
  });

  it("names the caller's own noun in the refusal, so a mandatory body reads right", async () => {
    const { context } = createTestContext({});
    const error: unknown = await requireBody(context, "reply body", {
      stdin: unreadable(),
      stdinKind: "socket",
    }).catch((cause: unknown) => cause);

    expect(String(error)).toContain("no reply body was taken");
    // `thread reply` cannot act without a body, so the refusal does **not**
    // offer `< /dev/null`: that repair would only produce a second usage error.
    const hint = isCliError(error) ? (error.hint ?? "") : "";
    expect(hint).not.toContain("< /dev/null");
    expect(hint).toContain("--file <path>");
  });

  it("never refuses a caller that named its own source — -m and --file win over the probe", async () => {
    const inline = createTestContext({ flags: { message: "from -m" } });
    await expect(
      resolveBody(inline.context, { stdin: unreadable(), stdinKind: "socket" }),
    ).resolves.toBe("from -m");

    const dir = await mkdtemp(join(tmpdir(), "corpus-c066-file-"));
    await writeFile(join(dir, "body.md"), "from the file\n", "utf8");
    const fromFile = createTestContext({ flags: { file: "body.md" }, cwd: dir });
    await expect(
      resolveBody(fromFile.context, { stdin: unreadable(), stdinKind: "socket" }),
    ).resolves.toBe("from the file\n");
  });

  it("still reads a heredoc and a pipe, which is what the refusal must not cost", async () => {
    const heredoc = createTestContext({});
    await expect(
      resolveBody(heredoc.context, { stdin: pipe("from a heredoc\n"), stdinKind: "file" }),
    ).resolves.toBe("from a heredoc\n");

    const piped = createTestContext({});
    await expect(
      resolveBody(piped.context, { stdin: pipe("from a pipe\n"), stdinKind: "fifo" }),
    ).resolves.toBe("from a pipe\n");
  });

  it("stays silent for a terminal and for /dev/null — nothing was offered there", async () => {
    for (const kind of ["tty", "other"] as const) {
      const { context } = createTestContext({});
      await expect(
        resolveBody(context, { stdin: unreadable(), stdinKind: kind }),
      ).resolves.toBeUndefined();
    }
  });

  it("treats an empty pipe as no body at all", async () => {
    const { context } = createTestContext({});
    await expect(
      resolveBody(context, { stdin: pipe(""), stdinKind: "fifo" }),
    ).resolves.toBeUndefined();
  });

  it("reports an unreadable --file as a usage error, not a crash", async () => {
    const { context } = createTestContext({ flags: { file: "/definitely/not/here.md" } });
    const error: unknown = await resolveBody(context, { stdinKind: "other" }).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(UsageError);
    expect(exitCodeFor(error)).toBe(ExitCode.usageError);
    expect(String(error)).toContain("cannot read --file");
  });
});

describe("resolveTurnModel", () => {
  const resolve = (model: string | undefined, actor: Actor = "agent"): string | undefined =>
    resolveTurnModel({ flags: flagsOf(model === undefined ? {} : { model }), actor });

  it("is undefined when the flag is absent, so the request carries no field at all", () => {
    // The distinction the whole feature rests on (SPEC.md §10): a turn nobody
    // recorded a model for must show nothing rather than a guess, and `undefined`
    // is what lets the caller *omit* the key instead of sending an empty one.
    expect(resolve(undefined)).toBeUndefined();
  });

  it("passes a stated model through verbatim, validating nothing about the name", () => {
    // Still a display string, never an enum in any package (SPEC.md §7,
    // CONTRACT-043). Whether the *workspace* declares the name is the next
    // step's question — `commands/thread/declared-models.ts` (AGENT-061), which
    // reads the tier table at call time — so this resolver keeps every byte,
    // spacing included, for that comparison to see unchanged.
    expect(resolve("claude-opus-4-1")).toBe("claude-opus-4-1");
    expect(resolve("Some Model 9 (preview)")).toBe("Some Model 9 (preview)");
    expect(resolve("  claude-opus-4-1  ")).toBe("  claude-opus-4-1  ");
  });

  it("refuses a blank, so absence has exactly one spelling", () => {
    for (const blank of ["", "   ", "\t"]) {
      let thrown: unknown;
      try {
        resolve(blank);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(UsageError);
      expect(exitCodeFor(thrown)).toBe(ExitCode.usageError);
      expect(String(thrown)).toContain("--model was given without a model name");
    }
  });

  it("refuses a model on anyone but the agent, and explains rather than just failing", () => {
    // The server's `400` stays the backstop; this is the same answer one round
    // trip earlier, with the reason attached (SPEC.md §10).
    let thrown: unknown;
    try {
      resolve("claude-opus-4-1", "user");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UsageError);
    expect(exitCodeFor(thrown)).toBe(ExitCode.usageError);
    expect(String(thrown)).toContain("only an agent turn names the model that wrote it");
    expect(isCliError(thrown) ? thrown.hint : "").toContain("--from agent");
  });

  it("reports the wrong actor before the blank, because stating one at all was the mistake", () => {
    expect(() => resolve("", "user")).toThrow(/only an agent turn names the model/);
  });
});

describe("readAll", () => {
  it("joins chunks of both kinds, decoding multi-byte characters across a split", async () => {
    const encoded = new TextEncoder().encode("é");
    // The split that a naive per-chunk `toString()` mangles: one character
    // arriving as two reads, which is what a real pipe does under load.
    async function* split(): AsyncGenerator<string | Uint8Array> {
      yield "a";
      yield await Promise.resolve(encoded.slice(0, 1));
      yield encoded.slice(1);
      yield "b";
    }

    await expect(readAll(split())).resolves.toBe("aéb");
  });
});

describe("requireBody", () => {
  it("rejects an absent body and an explicitly empty one with the same usage error", async () => {
    const empty = createTestContext({ flags: { message: "" } });
    const absent = createTestContext({});

    for (const harness of [empty, absent]) {
      const error: unknown = await requireBody(harness.context, "reply body", {
        stdin: pipe(""),
        stdinKind: "fifo",
      }).catch((cause: unknown) => cause);
      expect(exitCodeFor(error)).toBe(ExitCode.usageError);
      expect(String(error)).toContain("no reply body to send");
    }
  });

  it("returns a body that is only whitespace — the server owns what is meaningful", async () => {
    const { context } = createTestContext({ flags: { message: " " } });
    await expect(requireBody(context, "reply body", { stdinKind: "other" })).resolves.toBe(" ");
  });
});

describe("small parsers", () => {
  it("splits --tags on commas and drops the blanks", () => {
    expect(splitTags("finance, housing ,")).toEqual(["finance", "housing"]);
    expect(splitTags(undefined)).toBeUndefined();
    expect(splitTags("")).toEqual([]);
  });

  it("keeps a true|false flag tri-state", () => {
    expect(parseTriStateBoolean("evergreen", undefined)).toBeUndefined();
    expect(parseTriStateBoolean("evergreen", "true")).toBe(true);
    expect(parseTriStateBoolean("evergreen", "false")).toBe(false);
    expect(() => parseTriStateBoolean("evergreen", "yes")).toThrow(UsageError);
  });

  it("requires a flag before sending anything", () => {
    const { context } = createTestContext({ flags: { title: "" } });
    expect(() => requireFlag(context, "title", "text")).toThrow(/--title is required/);
    expect(() => requireFlag(context, "type", "type")).toThrow(UsageError);
  });

  it("folds warnings onto one line, collapsing multi-line hook output", () => {
    expect(warningSuffix([])).toBe("");
    expect(warningSuffix([{ code: "commit_failed", detail: "hook said\nno\n" }])).toBe(
      " — warning: commit_failed (hook said no)",
    );
    expect(
      warningSuffix([
        { code: "commit_failed", detail: "a" },
        { code: "unresolved_ref", detail: "b" },
      ]),
    ).toBe(" — 2 warnings: commit_failed, unresolved_ref");
  });

  it("pluralises counts so the one-line reports read like English", () => {
    expect(plural(1, "anchor")).toBe("1 anchor");
    expect(plural(2, "anchor")).toBe("2 anchors");
    expect(plural(3, "seen", "seen")).toBe("3 seen");
  });
});

describe("resolveJob — the work a write serves (CLI-044)", () => {
  const flagsWith = (job?: string): ParsedFlags => flagsOf(job === undefined ? {} : { job });

  it("takes the flag when one is given", () => {
    expect(resolveJob(flagsWith("evt_a1b2c3"), {})).toBe("evt_a1b2c3");
  });

  it("falls back to the environment, which is how an agent stops remembering", () => {
    // The whole design: a working agent exports CORPUS_JOB once when it claims
    // an event, and every write it makes afterwards is attributed without the
    // agent naming the job per command. §9.2 makes forgetting cost provenance
    // rather than correctness, so a mechanism that had to be remembered per
    // command is one that quietly stops working.
    expect(resolveJob(flagsWith(), { CORPUS_JOB: "evt_fromenv" })).toBe("evt_fromenv");
  });

  it("lets the flag win over the variable", () => {
    expect(resolveJob(flagsWith("evt_flag"), { CORPUS_JOB: "evt_env" })).toBe("evt_flag");
  });

  it("is absent when neither names one, with exactly one spelling for absent", () => {
    // §9.2: a write with no job records no origin — a fact about the document,
    // not a missing field. `undefined` is what omits the wire field entirely.
    expect(resolveJob(flagsWith(), {})).toBeUndefined();
  });

  it("treats an empty variable as unset, because that is how a shell clears one", () => {
    // `CORPUS_JOB=` is a clear. Reading it as "the job named empty string" would
    // turn clearing the variable into a 422.
    expect(resolveJob(flagsWith(), { CORPUS_JOB: "" })).toBeUndefined();
  });

  it("refuses something that is not an event id, before any request is sent", () => {
    // Shape only. Whether the id names a live event is the server's 422 — it
    // reads the queue and the CLI does not, and a second opinion here would be a
    // second source of truth about what is claimable.
    expect(() => resolveJob(flagsWith("th_x9y8"), {})).toThrow(/evt_/);
    expect(() => resolveJob(flagsWith("nonsense"), {})).toThrow(/evt_/);
  });

  it("says how to clear a stale variable, since that is the likely cause", () => {
    // A subagent's environment outliving its work is the realistic way this
    // goes wrong, and "unset it or override it" is the recovery.
    try {
      resolveJob(flagsWith(), { CORPUS_JOB: "not-an-event" });
      expect.unreachable();
    } catch (error) {
      expect((error as { hint?: string }).hint).toMatch(/CORPUS_JOB/);
    }
  });
});
